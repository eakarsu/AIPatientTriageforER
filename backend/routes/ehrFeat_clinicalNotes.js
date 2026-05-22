const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { ClinicalNote, Encounter, Patient, AuditLog, AiResult } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// ── Rate limiter (20 AI calls / hour / user or IP) ───────────────────────────
const noteLimitMap = new Map();
function noteAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const limit = 20;

  const entry = noteLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  noteLimitMap.set(key, entry);

  if (entry.count > limit) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 20 AI calls per hour.' });
  }
  next();
}

// ── 3-strategy JSON parser ────────────────────────────────────────────────────
function parseAIJson(content) {
  if (!content) return { raw_response: '' };
  // Strategy 1: extract from markdown code block
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (e) {}
  }
  // Strategy 2: direct JSON parse
  try { return JSON.parse(content); } catch (e) {}
  // Strategy 3: extract first { ... } block
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (e) {}
  }
  return { raw_response: content };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function persistAiResult(userId, endpoint, patientId, result, model) {
  try {
    await AiResult.create({
      userId: userId || null,
      endpoint,
      patientId: patientId || null,
      result: typeof result === 'string' ? result : JSON.stringify(result),
      model: model || 'unknown'
    });
  } catch (e) {
    console.error('Failed to persist AI result:', e.message);
  }
}

async function logAudit(userId, action, resourceId, meta) {
  try {
    await AuditLog.create({
      userId: userId || null,
      action,
      resourceId: resourceId ? String(resourceId) : null,
      meta: meta ? JSON.stringify(meta) : null
    });
  } catch (e) {
    console.error('Failed to write audit log:', e.message);
  }
}

// ── All routes require auth ───────────────────────────────────────────────────
router.use(auth);

// ═════════════════════════════════════════════════════════════════════════════
// CRUD ROUTES (18)
// ═════════════════════════════════════════════════════════════════════════════

// 1. GET / — paginated list with optional ?noteType and ?signed filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.noteType) where.noteType = req.query.noteType;
    if (req.query.signed !== undefined) {
      where.signedAt = req.query.signed === 'true' ? { [Op.ne]: null } : null;
    }

    const { count, rows } = await ClinicalNote.findAndCountAll({
      where,
      include: [
        { model: Patient, attributes: ['id', 'firstName', 'lastName'], required: false },
        { model: Encounter, attributes: ['id', 'encounterType', 'admissionDate'], required: false }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. GET /count — counts by ?noteType and ?signed (must come before /:id)
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.noteType) where.noteType = req.query.noteType;
    if (req.query.signed !== undefined) {
      where.signedAt = req.query.signed === 'true' ? { [Op.ne]: null } : null;
    }
    const count = await ClinicalNote.count({ where });
    res.json({ count, filters: req.query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET /search — full-text search across subjective/objective/assessment/plan
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Query param ?q is required' });

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const term = { [Op.like]: `%${q}%` };
    const { count, rows } = await ClinicalNote.findAndCountAll({
      where: {
        [Op.or]: [
          { subjective: term },
          { objective: term },
          { assessment: term },
          { plan: term }
        ]
      },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. GET /export/csv — export all (or filtered) notes as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const where = {};
    if (req.query.noteType) where.noteType = req.query.noteType;
    if (req.query.patientId) where.patientId = req.query.patientId;

    const notes = await ClinicalNote.findAll({ where, order: [['createdAt', 'DESC']] });

    const fields = [
      'id', 'patientId', 'encounterId', 'providerId', 'noteType',
      'subjective', 'objective', 'assessment', 'plan',
      'signedAt', 'cosignedBy', 'amendmentOf', 'isAmended',
      'extractedBillingCodes', 'aiQualityScore', 'createdAt', 'updatedAt'
    ];

    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n\r]/.test(s) ? `"${s}"` : s;
    };

    const lines = [
      fields.join(','),
      ...notes.map(n => fields.map(f => escape(n[f])).join(','))
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="clinical_notes.csv"');
    res.send(lines.join('\r\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. GET /stats/summary — counts by noteType, % signed, avg note length
router.get('/stats/summary', async (req, res) => {
  try {
    const all = await ClinicalNote.findAll({
      attributes: ['noteType', 'signedAt', 'subjective', 'objective', 'assessment', 'plan']
    });

    const byType = {};
    let signedCount = 0;
    let totalLength = 0;

    for (const n of all) {
      const t = n.noteType || 'Unknown';
      byType[t] = (byType[t] || 0) + 1;
      if (n.signedAt) signedCount++;
      totalLength +=
        (n.subjective || '').length +
        (n.objective || '').length +
        (n.assessment || '').length +
        (n.plan || '').length;
    }

    res.json({
      total: all.length,
      byNoteType: byType,
      signedCount,
      unsignedCount: all.length - signedCount,
      percentSigned: all.length > 0 ? ((signedCount / all.length) * 100).toFixed(1) : '0.0',
      avgNoteLength: all.length > 0 ? Math.round(totalLength / all.length) : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /by-patient/:patientId
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await ClinicalNote.findAndCountAll({
      where: { patientId: req.params.patientId },
      include: [{ model: Encounter, attributes: ['id', 'encounterType', 'admissionDate'], required: false }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /by-encounter/:encounterId
router.get('/by-encounter/:encounterId', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await ClinicalNote.findAndCountAll({
      where: { encounterId: req.params.encounterId },
      include: [{ model: Patient, attributes: ['id', 'firstName', 'lastName'], required: false }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /batch — create multiple notes
router.post('/batch', async (req, res) => {
  try {
    const { notes } = req.body;
    if (!Array.isArray(notes) || notes.length === 0) {
      return res.status(400).json({ error: 'Body must include a non-empty "notes" array' });
    }
    const created = await ClinicalNote.bulkCreate(
      notes.map(n => ({ ...n, signedAt: null })),
      { validate: true }
    );
    res.status(201).json({ created: created.length, data: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. PUT /batch — update multiple notes by id (only if not signed)
router.put('/batch', async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Body must include a non-empty "updates" array [{id, ...fields}]' });
    }

    const results = [];
    for (const u of updates) {
      const { id, ...fields } = u;
      if (!id) { results.push({ id, status: 'skipped', reason: 'missing id' }); continue; }

      const note = await ClinicalNote.findByPk(id);
      if (!note) { results.push({ id, status: 'not_found' }); continue; }
      if (note.signedAt) { results.push({ id, status: 'error', reason: 'Note is signed and cannot be modified' }); continue; }

      delete fields.signedAt;
      await note.update(fields);
      results.push({ id, status: 'updated' });
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. DELETE /batch — soft-delete multiple notes (drafts only)
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Body must include a non-empty "ids" array' });
    }

    const results = [];
    for (const id of ids) {
      const note = await ClinicalNote.findByPk(id);
      if (!note) { results.push({ id, status: 'not_found' }); continue; }
      if (note.signedAt) { results.push({ id, status: 'error', reason: 'Cannot delete a signed note' }); continue; }
      await note.destroy();
      results.push({ id, status: 'deleted' });
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. POST /import/csv — import notes from CSV body
router.post('/import/csv', async (req, res) => {
  try {
    const raw = req.body && (req.body.csv || (typeof req.body === 'string' ? req.body : null));
    if (!raw) return res.status(400).json({ error: 'Send CSV text in body.csv or as raw text/plain body' });

    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, idx) => { if (vals[idx] !== undefined && vals[idx] !== '') obj[h] = vals[idx]; });
      // Strip non-model fields and ensure no accidental signedAt override on import
      delete obj.id;
      delete obj.createdAt;
      delete obj.updatedAt;
      records.push(obj);
    }

    const created = await ClinicalNote.bulkCreate(records, { validate: true, ignoreDuplicates: true });
    res.status(201).json({ imported: created.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /:id — with audit log
router.get('/:id', async (req, res) => {
  try {
    const note = await ClinicalNote.findByPk(req.params.id, {
      include: [
        { model: Patient, attributes: ['id', 'firstName', 'lastName'], required: false },
        { model: Encounter, attributes: ['id', 'encounterType', 'admissionDate'], required: false }
      ]
    });
    if (!note) return res.status(404).json({ error: 'Clinical note not found' });

    await logAudit(req.user?.id, 'view_clinical_note', note.id, { noteType: note.noteType });

    res.json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST / — create draft note
router.post('/', async (req, res) => {
  try {
    const {
      patientId, encounterId, providerId, noteType,
      subjective, objective, assessment, plan,
      rawDictation, cosignedBy, amendmentOf,
      extractedBillingCodes, aiQualityScore
    } = req.body;

    const note = await ClinicalNote.create({
      patientId,
      encounterId,
      providerId: providerId || req.user?.id,
      noteType: noteType || 'Progress',
      subjective,
      objective,
      assessment,
      plan,
      rawDictation,
      cosignedBy,
      amendmentOf,
      isAmended: false,
      signedAt: null,
      extractedBillingCodes,
      aiQualityScore
    });

    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /:id — update (only if not signed)
router.put('/:id', async (req, res) => {
  try {
    const note = await ClinicalNote.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: 'Clinical note not found' });
    if (note.signedAt) return res.status(409).json({ error: 'Signed notes cannot be modified' });

    const allowed = [
      'patientId', 'encounterId', 'providerId', 'noteType',
      'subjective', 'objective', 'assessment', 'plan',
      'rawDictation', 'cosignedBy', 'extractedBillingCodes', 'aiQualityScore'
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    await note.update(updates);
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /:id — soft-delete drafts only
router.delete('/:id', async (req, res) => {
  try {
    const note = await ClinicalNote.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: 'Clinical note not found' });
    if (note.signedAt) return res.status(409).json({ error: 'Cannot delete a signed note' });

    await note.destroy();
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /:id/sign — sign a note
router.post('/:id/sign', async (req, res) => {
  try {
    const note = await ClinicalNote.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: 'Clinical note not found' });
    if (note.signedAt) return res.status(409).json({ error: 'Note is already signed' });

    await note.update({
      signedAt: new Date(),
      providerId: req.user?.id || note.providerId
    });

    await logAudit(req.user?.id, 'sign_clinical_note', note.id, { noteType: note.noteType, signedAt: note.signedAt });

    res.json({ success: true, note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /:id/amend — create amendment note, mark original as amended
router.post('/:id/amend', async (req, res) => {
  try {
    const original = await ClinicalNote.findByPk(req.params.id);
    if (!original) return res.status(404).json({ error: 'Original note not found' });
    if (!original.signedAt) return res.status(409).json({ error: 'Only signed notes can be amended' });

    const {
      subjective, objective, assessment, plan,
      rawDictation, cosignedBy, extractedBillingCodes
    } = req.body;

    // Create the amendment as a new note
    const amendment = await ClinicalNote.create({
      patientId: original.patientId,
      encounterId: original.encounterId,
      providerId: req.user?.id || original.providerId,
      noteType: original.noteType,
      subjective: subjective !== undefined ? subjective : original.subjective,
      objective: objective !== undefined ? objective : original.objective,
      assessment: assessment !== undefined ? assessment : original.assessment,
      plan: plan !== undefined ? plan : original.plan,
      rawDictation: rawDictation !== undefined ? rawDictation : original.rawDictation,
      cosignedBy: cosignedBy !== undefined ? cosignedBy : original.cosignedBy,
      amendmentOf: original.id,
      isAmended: false,
      signedAt: null,
      extractedBillingCodes: extractedBillingCodes !== undefined ? extractedBillingCodes : original.extractedBillingCodes
    });

    // Mark original as having been amended
    await original.update({ isAmended: true });

    await logAudit(req.user?.id, 'amend_clinical_note', original.id, { amendmentNoteId: amendment.id });

    res.status(201).json({ original, amendment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. GET /:id/history — all amendment chain for a note
router.get('/:id/history', async (req, res) => {
  try {
    const note = await ClinicalNote.findByPk(req.params.id);
    if (!note) return res.status(404).json({ error: 'Clinical note not found' });

    // Find all notes in the amendment chain (both as original and as amendment)
    const amendments = await ClinicalNote.findAll({
      where: { amendmentOf: req.params.id },
      order: [['createdAt', 'ASC']]
    });

    // If this note itself is an amendment, find its root
    let chain = [note, ...amendments];
    if (note.amendmentOf) {
      const root = await ClinicalNote.findByPk(note.amendmentOf);
      if (root) {
        const siblings = await ClinicalNote.findAll({
          where: { amendmentOf: root.id },
          order: [['createdAt', 'ASC']]
        });
        chain = [root, ...siblings];
      }
    }

    res.json({ noteId: req.params.id, history: chain });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AI ROUTES (16) — rate-limited, persist to AiResult
// ═════════════════════════════════════════════════════════════════════════════

// 1. POST /ai/dictate-to-soap
router.post('/ai/dictate-to-soap', noteAiRateLimit, async (req, res) => {
  try {
    const { patientId, rawDictation } = req.body;
    if (!rawDictation) return res.status(400).json({ error: 'rawDictation is required' });

    const prompt = `You are a clinical documentation specialist. Convert the following raw physician dictation into a structured SOAP note. Return valid JSON only.

Raw Dictation:
${rawDictation}

Respond ONLY with valid JSON:
{
  "subjective": "<patient's chief complaint, HPI, ROS, and history as reported>",
  "objective": "<examination findings, vital signs, lab/imaging results>",
  "assessment": "<diagnosis or impression>",
  "plan": "<treatment plan, orders, follow-up>",
  "noteType": "SOAP",
  "extractedBillingCodes": ["<ICD-10 or CPT codes if identifiable>"],
  "confidence": "<high|medium|low>",
  "clarifications_needed": ["<any ambiguous dictation segments>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical documentation AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/dictate-to-soap', patientId, parsed, aiResult.model);
    res.json({ success: true, soap: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /ai/summarize-note
router.post('/ai/summarize-note', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).json({ error: 'noteId is required' });

    const note = await ClinicalNote.findByPk(noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const prompt = `Summarize the following clinical note into a concise 3–5 sentence executive summary suitable for a handoff or rapid review.

Note Type: ${note.noteType}
Subjective: ${note.subjective || ''}
Objective: ${note.objective || ''}
Assessment: ${note.assessment || ''}
Plan: ${note.plan || ''}

Return valid JSON only:
{
  "summary": "<concise summary>",
  "keyFindings": ["<finding 1>", "<finding 2>"],
  "urgentItems": ["<anything requiring immediate attention>"],
  "pendingItems": ["<outstanding orders, follow-ups>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical summarization AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/summarize-note', note.patientId, parsed, aiResult.model);
    res.json({ success: true, summary: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /ai/extract-billable-codes
router.post('/ai/extract-billable-codes', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId, noteText } = req.body;
    let text = noteText;
    let patientId = null;

    if (noteId) {
      const note = await ClinicalNote.findByPk(noteId);
      if (!note) return res.status(404).json({ error: 'Note not found' });
      patientId = note.patientId;
      text = [note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join('\n');
    }

    if (!text) return res.status(400).json({ error: 'Provide noteId or noteText' });

    const prompt = `You are a medical coding specialist (CPC). Extract all billable ICD-10-CM diagnosis codes and CPT procedure codes from the following clinical note text. Return valid JSON only.

Clinical Note Text:
${text}

Respond ONLY with valid JSON:
{
  "icd10Codes": [
    { "code": "<ICD-10 code>", "description": "<description>", "confidence": "<high|medium|low>" }
  ],
  "cptCodes": [
    { "code": "<CPT code>", "description": "<description>", "confidence": "<high|medium|low>" }
  ],
  "primaryDiagnosis": "<primary ICD-10 code>",
  "codingNotes": "<any coder notes or queries>",
  "potentialDenialRisks": ["<reason>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a medical coding AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Persist extracted codes back to note if noteId provided
    if (noteId) {
      const codes = [
        ...(parsed.icd10Codes || []).map(c => c.code),
        ...(parsed.cptCodes || []).map(c => c.code)
      ].join(', ');
      await ClinicalNote.update({ extractedBillingCodes: codes }, { where: { id: noteId } });
    }

    await persistAiResult(req.user?.id, '/ai/extract-billable-codes', patientId, parsed, aiResult.model);
    res.json({ success: true, codes: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /ai/draft-from-template
router.post('/ai/draft-from-template', noteAiRateLimit, async (req, res) => {
  try {
    const { patientId, encounterId, noteType, brief } = req.body;
    if (!patientId || !noteType) return res.status(400).json({ error: 'patientId and noteType are required' });

    let patientContext = '';
    try {
      const patient = await Patient.findByPk(patientId);
      if (patient) patientContext = `Patient: ${patient.firstName} ${patient.lastName}, DOB: ${patient.dateOfBirth || 'unknown'}`;
    } catch (e) {}

    const prompt = `You are a clinical documentation AI. Draft a ${noteType} clinical note template pre-filled with context from the brief below. Use standard medical terminology.

${patientContext}
Note Type: ${noteType}
Clinical Brief: ${brief || 'Not provided'}

Return valid JSON only:
{
  "noteType": "${noteType}",
  "subjective": "<drafted subjective section>",
  "objective": "<drafted objective section with placeholders where data is unknown>",
  "assessment": "<drafted assessment>",
  "plan": "<drafted plan>",
  "templateNotes": "<guidance for clinician completing this note>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical documentation AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/draft-from-template', patientId, parsed, aiResult.model);
    res.json({ success: true, draft: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /ai/identify-quality-issues
router.post('/ai/identify-quality-issues', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).json({ error: 'noteId is required' });

    const note = await ClinicalNote.findByPk(noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const prompt = `You are a clinical quality auditor. Review the following ${note.noteType} note for documentation quality issues including completeness, clarity, specificity, regulatory compliance, and medical necessity support.

Subjective: ${note.subjective || '(empty)'}
Objective: ${note.objective || '(empty)'}
Assessment: ${note.assessment || '(empty)'}
Plan: ${note.plan || '(empty)'}

Return valid JSON only:
{
  "qualityScore": <0-100>,
  "grade": "<A|B|C|D|F>",
  "issues": [
    { "category": "<completeness|clarity|specificity|compliance|medical_necessity>", "severity": "<critical|major|minor>", "description": "<issue>" }
  ],
  "missingElements": ["<element>"],
  "complianceFlags": ["<flag>"],
  "overallAssessment": "<narrative summary>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical quality AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Update aiQualityScore on the note
    if (parsed.qualityScore !== undefined) {
      await ClinicalNote.update({ aiQualityScore: parsed.qualityScore }, { where: { id: noteId } });
    }

    await persistAiResult(req.user?.id, '/ai/identify-quality-issues', note.patientId, parsed, aiResult.model);
    res.json({ success: true, quality: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /ai/suggest-improvements
router.post('/ai/suggest-improvements', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).json({ error: 'noteId is required' });

    const note = await ClinicalNote.findByPk(noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const prompt = `You are a clinical documentation coach. Review the following ${note.noteType} note and provide specific, actionable improvement suggestions to enhance its clinical utility, coding accuracy, and regulatory compliance.

Subjective: ${note.subjective || '(empty)'}
Objective: ${note.objective || '(empty)'}
Assessment: ${note.assessment || '(empty)'}
Plan: ${note.plan || '(empty)'}

Return valid JSON only:
{
  "improvements": [
    {
      "section": "<subjective|objective|assessment|plan>",
      "priority": "<high|medium|low>",
      "current": "<what is written or missing>",
      "suggestion": "<specific improvement>",
      "rationale": "<why this improves the note>"
    }
  ],
  "rewrittenSections": {
    "subjective": "<optional improved version>",
    "objective": "<optional improved version>",
    "assessment": "<optional improved version>",
    "plan": "<optional improved version>"
  },
  "estimatedScoreImprovement": "<e.g. +15 points>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical documentation coach AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/suggest-improvements', note.patientId, parsed, aiResult.model);
    res.json({ success: true, improvements: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /ai/extract-medications
router.post('/ai/extract-medications', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId, noteText } = req.body;
    let text = noteText;
    let patientId = null;

    if (noteId) {
      const note = await ClinicalNote.findByPk(noteId);
      if (!note) return res.status(404).json({ error: 'Note not found' });
      patientId = note.patientId;
      text = [note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join('\n');
    }

    if (!text) return res.status(400).json({ error: 'Provide noteId or noteText' });

    const prompt = `Extract all medications mentioned in the following clinical note text. Include prescribed medications, over-the-counter drugs, supplements, and any medications mentioned in the history. Return valid JSON only.

Text:
${text}

Respond ONLY with valid JSON:
{
  "medications": [
    {
      "name": "<medication name>",
      "genericName": "<generic name if known>",
      "dose": "<dose>",
      "route": "<oral|IV|IM|topical|etc>",
      "frequency": "<frequency>",
      "indication": "<reason for use>",
      "status": "<current|historical|discontinued|allergic_reaction>",
      "notes": "<any additional notes>"
    }
  ],
  "totalCount": <number>,
  "extractionConfidence": "<high|medium|low>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical NLP AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/extract-medications', patientId, parsed, aiResult.model);
    res.json({ success: true, medications: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /ai/extract-allergies
router.post('/ai/extract-allergies', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId, noteText } = req.body;
    let text = noteText;
    let patientId = null;

    if (noteId) {
      const note = await ClinicalNote.findByPk(noteId);
      if (!note) return res.status(404).json({ error: 'Note not found' });
      patientId = note.patientId;
      text = [note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join('\n');
    }

    if (!text) return res.status(400).json({ error: 'Provide noteId or noteText' });

    const prompt = `Extract all allergy and adverse reaction information from the following clinical note text. Return valid JSON only.

Text:
${text}

Respond ONLY with valid JSON:
{
  "allergies": [
    {
      "allergen": "<substance>",
      "allergenType": "<medication|food|environmental|latex|contrast|other>",
      "reaction": "<reaction description>",
      "severity": "<mild|moderate|severe|life-threatening|unknown>",
      "onsetDate": "<date if mentioned>",
      "verified": <true|false>
    }
  ],
  "nkda": <true if No Known Drug Allergies stated>,
  "nka": <true if No Known Allergies stated>,
  "extractionConfidence": "<high|medium|low>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical NLP AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/extract-allergies', patientId, parsed, aiResult.model);
    res.json({ success: true, allergies: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /ai/extract-diagnoses
router.post('/ai/extract-diagnoses', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId, noteText } = req.body;
    let text = noteText;
    let patientId = null;

    if (noteId) {
      const note = await ClinicalNote.findByPk(noteId);
      if (!note) return res.status(404).json({ error: 'Note not found' });
      patientId = note.patientId;
      text = [note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join('\n');
    }

    if (!text) return res.status(400).json({ error: 'Provide noteId or noteText' });

    const prompt = `Extract all diagnoses, differential diagnoses, and clinical impressions from the following clinical note text. Return valid JSON only.

Text:
${text}

Respond ONLY with valid JSON:
{
  "primaryDiagnosis": {
    "description": "<description>",
    "icd10": "<ICD-10 code if determinable>",
    "certainty": "<confirmed|probable|rule-out|suspected>"
  },
  "secondaryDiagnoses": [
    {
      "description": "<description>",
      "icd10": "<ICD-10 code if determinable>",
      "certainty": "<confirmed|probable|rule-out|suspected>",
      "relationship": "<comorbidity|complication|incidental>"
    }
  ],
  "differentialDiagnoses": ["<diagnosis>"],
  "chronicConditions": ["<condition>"],
  "extractionConfidence": "<high|medium|low>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical NLP AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/extract-diagnoses', patientId, parsed, aiResult.model);
    res.json({ success: true, diagnoses: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST /ai/generate-discharge-summary
router.post('/ai/generate-discharge-summary', noteAiRateLimit, async (req, res) => {
  try {
    const { patientId, encounterId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    let patient = null;
    let encounterNotes = [];

    try { patient = await Patient.findByPk(patientId); } catch (e) {}
    try {
      const noteWhere = { patientId };
      if (encounterId) noteWhere.encounterId = encounterId;
      encounterNotes = await ClinicalNote.findAll({
        where: noteWhere,
        order: [['createdAt', 'ASC']],
        limit: 20
      });
    } catch (e) {}

    const noteSummary = encounterNotes.map(n =>
      `[${n.noteType} - ${n.createdAt}]\nAssessment: ${n.assessment || ''}\nPlan: ${n.plan || ''}`
    ).join('\n---\n');

    const prompt = `You are a hospital attending physician. Generate a comprehensive discharge summary for the following patient encounter. Use standard discharge summary format. Return valid JSON only.

Patient: ${patient ? `${patient.firstName} ${patient.lastName}, DOB: ${patient.dateOfBirth}` : `ID ${patientId}`}
Encounter Notes:
${noteSummary || 'No notes available'}

Respond ONLY with valid JSON:
{
  "admissionDate": "<date>",
  "dischargeDate": "<date>",
  "admittingDiagnosis": "<diagnosis>",
  "dischargeDiagnosis": "<final diagnosis>",
  "hospitalCourse": "<narrative of hospital stay>",
  "proceduresPerformed": ["<procedure>"],
  "significantResults": ["<lab/imaging finding>"],
  "dischargeCondition": "<stable|improved|guarded|critical>",
  "dischargeMedications": [
    { "name": "<med>", "dose": "<dose>", "frequency": "<freq>", "instructions": "<instructions>" }
  ],
  "followUpInstructions": "<when and with whom to follow up>",
  "returnPrecautions": ["<symptom requiring ER return>"],
  "patientEducation": "<key points communicated to patient>",
  "pendingResults": ["<results still outstanding>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a hospital physician AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/generate-discharge-summary', patientId, parsed, aiResult.model);
    res.json({ success: true, dischargeSummary: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST /ai/translate-for-patient
router.post('/ai/translate-for-patient', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId, language } = req.body;
    if (!noteId) return res.status(400).json({ error: 'noteId is required' });

    const note = await ClinicalNote.findByPk(noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const targetLanguage = language || 'English';

    const prompt = `You are a patient education specialist. Translate the following clinical note into plain, easy-to-understand language that a patient with no medical background can understand. Target language: ${targetLanguage}. Avoid medical jargon. Return valid JSON only.

Assessment: ${note.assessment || ''}
Plan: ${note.plan || ''}
Subjective Background: ${note.subjective || ''}

Respond ONLY with valid JSON:
{
  "language": "${targetLanguage}",
  "patientFriendlySummary": "<plain language summary>",
  "whatIsWrongWithMe": "<simple explanation of diagnosis>",
  "whatWillHappen": "<simple explanation of plan>",
  "myMedications": ["<medication and simple instructions>"],
  "warningSignsToWatchFor": ["<symptom in plain language>"],
  "whenToCallDoctor": "<clear guidance>",
  "questions_to_ask_provider": ["<suggested question>"]
}`;

    const aiResult = await callOpenRouter(prompt, `You are a patient education AI. Respond ONLY with valid JSON in ${targetLanguage} where specified.`);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/translate-for-patient', note.patientId, parsed, aiResult.model);
    res.json({ success: true, patientTranslation: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /ai/reconcile-conflicts
router.post('/ai/reconcile-conflicts', noteAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const notes = await ClinicalNote.findAll({
      where: { patientId },
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    if (notes.length === 0) return res.status(404).json({ error: 'No notes found for this patient' });

    const notesSummary = notes.map((n, i) =>
      `Note ${i + 1} [${n.noteType} - ${n.createdAt}]:\nSubjective: ${n.subjective || ''}\nAssessment: ${n.assessment || ''}\nPlan: ${n.plan || ''}`
    ).join('\n===\n');

    const prompt = `You are a clinical quality reviewer. Analyze the following set of clinical notes for the same patient and identify any conflicting information, discrepancies, or inconsistencies in the documented history, assessment, and plan. Return valid JSON only.

Patient ID: ${patientId}
Clinical Notes (most recent first):
${notesSummary}

Respond ONLY with valid JSON:
{
  "conflictsFound": <true|false>,
  "conflicts": [
    {
      "type": "<diagnosis|medication|allergy|history|vital|other>",
      "description": "<description of conflict>",
      "note1Reference": "<date/type of first conflicting note>",
      "note2Reference": "<date/type of second conflicting note>",
      "severity": "<critical|significant|minor>",
      "recommendation": "<how to resolve>"
    }
  ],
  "consistentFindings": ["<finding that is consistently documented>"],
  "reconciliationSuggestions": ["<suggestion>"],
  "overallConsistencyScore": <0-100>
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical quality AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/reconcile-conflicts', patientId, parsed, aiResult.model);
    res.json({ success: true, reconciliation: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /ai/generate-progress-note
router.post('/ai/generate-progress-note', noteAiRateLimit, async (req, res) => {
  try {
    const { patientId, encounterId, clinicalUpdate, interval } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    let lastNote = null;
    try {
      const where = { patientId };
      if (encounterId) where.encounterId = encounterId;
      lastNote = await ClinicalNote.findOne({ where, order: [['createdAt', 'DESC']] });
    } catch (e) {}

    const prompt = `You are a hospitalist physician. Generate a daily progress note for the following patient. Return valid JSON only.

Patient ID: ${patientId}
Time Interval: ${interval || '24 hours'}
Clinical Update Provided: ${clinicalUpdate || 'None provided — extrapolate from prior note'}

Prior Note Context:
${lastNote ? `Assessment: ${lastNote.assessment || ''}\nPlan: ${lastNote.plan || ''}` : 'No prior note available'}

Respond ONLY with valid JSON:
{
  "noteType": "Progress",
  "subjective": "<patient's reported status since last note>",
  "objective": "<current exam findings, vitals, notable labs/imaging>",
  "assessment": "<current clinical impression and problem list>",
  "plan": "<updated plan per problem>",
  "intervalChanges": ["<what changed since last assessment>"],
  "goalsForToday": ["<clinical goal>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical documentation AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/generate-progress-note', patientId, parsed, aiResult.model);
    res.json({ success: true, progressNote: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /ai/score-completeness
router.post('/ai/score-completeness', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).json({ error: 'noteId is required' });

    const note = await ClinicalNote.findByPk(noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const prompt = `You are a clinical documentation integrity specialist. Score the completeness of the following ${note.noteType} note on a 0-100 scale across multiple dimensions. Return valid JSON only.

Note Type: ${note.noteType}
Subjective: ${note.subjective || '(empty)'}
Objective: ${note.objective || '(empty)'}
Assessment: ${note.assessment || '(empty)'}
Plan: ${note.plan || '(empty)'}
Signed: ${note.signedAt ? 'Yes' : 'No'}

Respond ONLY with valid JSON:
{
  "overallScore": <0-100>,
  "dimensionScores": {
    "subjectiveCompleteness": <0-100>,
    "objectiveCompleteness": <0-100>,
    "assessmentSpecificity": <0-100>,
    "planActionability": <0-100>,
    "codingSupport": <0-100>,
    "medicalNecessity": <0-100>
  },
  "missingCriticalElements": ["<element>"],
  "passesMinimumStandard": <true|false>,
  "recommendedActions": ["<action to improve score>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical documentation AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    if (parsed.overallScore !== undefined) {
      await ClinicalNote.update({ aiQualityScore: parsed.overallScore }, { where: { id: noteId } });
    }

    await persistAiResult(req.user?.id, '/ai/score-completeness', note.patientId, parsed, aiResult.model);
    res.json({ success: true, completeness: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /ai/suggest-cdi-queries
router.post('/ai/suggest-cdi-queries', noteAiRateLimit, async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).json({ error: 'noteId is required' });

    const note = await ClinicalNote.findByPk(noteId);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const prompt = `You are a Clinical Documentation Improvement (CDI) specialist. Review the following clinical note and generate CDI queries that would help clarify or improve the documentation for accurate coding, case mix index, and severity of illness capture. Return valid JSON only.

Note Type: ${note.noteType}
Subjective: ${note.subjective || '(empty)'}
Objective: ${note.objective || '(empty)'}
Assessment: ${note.assessment || '(empty)'}
Plan: ${note.plan || '(empty)'}

Respond ONLY with valid JSON:
{
  "queriesRecommended": <number>,
  "queries": [
    {
      "queryType": "<clarification|specificity|linkage|etiology|acuity>",
      "targetDiagnosis": "<diagnosis being queried>",
      "clinicalIndicators": ["<lab|vital|medication supporting query>"],
      "queryText": "<the actual query to send to the physician>",
      "potentialCodeImpact": "<e.g. adds CC, MCC, changes DRG>",
      "priority": "<urgent|routine>"
    }
  ],
  "estimatedCMIImpact": "<high|moderate|low|none>",
  "estimatedRevenueImpact": "<rough estimate if determinable>",
  "complianceNote": "<any compliance considerations>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a CDI specialist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/suggest-cdi-queries', note.patientId, parsed, aiResult.model);
    res.json({ success: true, cdiQueries: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /ai/redact-phi
router.post('/ai/redact-phi', noteAiRateLimit, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const prompt = `You are a HIPAA compliance AI. Identify and redact all Protected Health Information (PHI) from the following clinical text. PHI includes: names, geographic data smaller than state, dates (except year), phone numbers, fax numbers, email addresses, SSNs, MRNs, health plan numbers, account numbers, certificate/license numbers, VINs, device identifiers, URLs, IPs, biometric identifiers, full-face photos, and any other unique identifier. Replace PHI with [REDACTED_<TYPE>]. Return valid JSON only.

Original Text:
${text}

Respond ONLY with valid JSON:
{
  "redactedText": "<text with PHI replaced>",
  "phiFound": [
    { "type": "<phi type>", "original": "<original value>", "replacement": "<[REDACTED_TYPE]>" }
  ],
  "phiCount": <number>,
  "hipaaCompliant": <true if no PHI remains>,
  "redactionConfidence": "<high|medium|low>",
  "warnings": ["<any ambiguous items that may need manual review>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a HIPAA compliance AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Do not log original text in audit; log only that redaction was performed
    await persistAiResult(req.user?.id, '/ai/redact-phi', null, { phiCount: parsed.phiCount, hipaaCompliant: parsed.hipaaCompliant }, aiResult.model);
    res.json({ success: true, redaction: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
