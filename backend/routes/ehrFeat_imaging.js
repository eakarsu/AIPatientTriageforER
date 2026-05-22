const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { ImagingStudy, Encounter, Patient, AuditLog, AiResult } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// ── In-memory rate limiter: max 20 AI calls per hour per user/IP ──────────────
const imagingRateLimitMap = new Map();
function imagingAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const limit = 20;

  const entry = imagingRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  imagingRateLimitMap.set(key, entry);

  if (entry.count > limit) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 20 AI calls per hour.' });
  }
  next();
}

// ── 3-strategy JSON parser for AI responses ───────────────────────────────────
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

// ── Persist AI result to ai_results table ─────────────────────────────────────
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

// ── Helper: log audit event ───────────────────────────────────────────────────
async function logAudit(userId, action, resourceId, resourceType, details) {
  try {
    await AuditLog.create({
      userId: userId || null,
      action,
      resourceId: resourceId ? String(resourceId) : null,
      resourceType: resourceType || 'ImagingStudy',
      details: details ? JSON.stringify(details) : null
    });
  } catch (e) {
    console.error('Failed to write audit log:', e.message);
  }
}

// Apply auth to all routes
router.use(auth);

// =============================================================================
// 18 CRUD ENDPOINTS
// =============================================================================

// 1. GET / — paginated list with ?status, ?modality filters
router.get('/', async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const where = {};

    if (req.query.status)   where.status   = req.query.status;
    if (req.query.modality) where.modality = req.query.modality;

    const { count, rows } = await ImagingStudy.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      include: [
        { model: Patient,   as: 'patient',   attributes: ['id', 'firstName', 'lastName'], required: false },
        { model: Encounter, as: 'encounter',  attributes: ['id', 'chiefComplaint'],        required: false }
      ]
    });

    res.json({
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /:id — single study + audit log
router.get('/:id', async (req, res) => {
  try {
    const study = await ImagingStudy.findByPk(req.params.id, {
      include: [
        { model: Patient,   as: 'patient',   required: false },
        { model: Encounter, as: 'encounter',  required: false }
      ]
    });
    if (!study) return res.status(404).json({ error: 'Imaging study not found' });

    await logAudit(req.user?.id, 'view_imaging_study', study.id, 'ImagingStudy', { studyInstanceUid: study.studyInstanceUid });

    res.json({ data: study });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST / — create
router.post('/', async (req, res) => {
  try {
    const study = await ImagingStudy.create(req.body);
    res.status(201).json({ data: study });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. PUT /:id — update
router.put('/:id', async (req, res) => {
  try {
    const study = await ImagingStudy.findByPk(req.params.id);
    if (!study) return res.status(404).json({ error: 'Imaging study not found' });
    await study.update(req.body);
    res.json({ data: study });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. DELETE /:id — soft-delete (status='Cancelled')
router.delete('/:id', async (req, res) => {
  try {
    const study = await ImagingStudy.findByPk(req.params.id);
    if (!study) return res.status(404).json({ error: 'Imaging study not found' });
    await study.update({ status: 'Cancelled' });
    res.json({ message: 'Imaging study cancelled', data: study });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /by-patient/:patientId
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await ImagingStudy.findAndCountAll({
      where: { patientId: req.params.patientId },
      order: [['studyDate', 'DESC']],
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
    const studies = await ImagingStudy.findAll({
      where: { encounterId: req.params.encounterId },
      order: [['studyDate', 'DESC']]
    });
    res.json({ data: studies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /batch — create multiple
router.post('/batch', async (req, res) => {
  try {
    const records = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Request body must be a non-empty array' });
    }
    const created = await ImagingStudy.bulkCreate(records, { validate: true });
    res.status(201).json({ data: created, count: created.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9. PUT /batch — update multiple by id
router.put('/batch', async (req, res) => {
  try {
    const records = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'Request body must be a non-empty array' });
    }
    const results = await Promise.all(
      records.map(async (rec) => {
        if (!rec.id) return { error: 'Missing id', rec };
        const study = await ImagingStudy.findByPk(rec.id);
        if (!study) return { error: 'Not found', id: rec.id };
        await study.update(rec);
        return study;
      })
    );
    res.json({ data: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 10. DELETE /batch — soft-delete multiple by ids array
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Request body must contain a non-empty ids array' });
    }
    const [affectedCount] = await ImagingStudy.update(
      { status: 'Cancelled' },
      { where: { id: { [Op.in]: ids } } }
    );
    res.json({ message: `${affectedCount} studies cancelled`, affectedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. GET /count — ?status, ?modality, ?criticalFindings
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.status)   where.status   = req.query.status;
    if (req.query.modality) where.modality = req.query.modality;
    if (req.query.criticalFindings !== undefined) {
      where.criticalFindings = req.query.criticalFindings === 'true';
    }
    const count = await ImagingStudy.count({ where });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET /search — ?q in studyType/bodyPart/impression
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await ImagingStudy.findAndCountAll({
      where: {
        [Op.or]: [
          { studyType:  { [Op.like]: `%${q}%` } },
          { bodyPart:   { [Op.like]: `%${q}%` } },
          { impression: { [Op.like]: `%${q}%` } }
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

// 13. POST /:id/finalize — set status='Verified', radiologistId=req.user.id
router.post('/:id/finalize', async (req, res) => {
  try {
    const study = await ImagingStudy.findByPk(req.params.id);
    if (!study) return res.status(404).json({ error: 'Imaging study not found' });
    await study.update({ status: 'Verified', radiologistId: req.user.id });
    await logAudit(req.user?.id, 'finalize_imaging_study', study.id, 'ImagingStudy', { radiologistId: req.user.id });
    res.json({ data: study });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /:id/flag-critical — set criticalFindings=true
router.post('/:id/flag-critical', async (req, res) => {
  try {
    const study = await ImagingStudy.findByPk(req.params.id);
    if (!study) return res.status(404).json({ error: 'Imaging study not found' });
    await study.update({ criticalFindings: true });
    await logAudit(req.user?.id, 'flag_critical_imaging', study.id, 'ImagingStudy', { flaggedBy: req.user.id });
    res.json({ data: study });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. GET /:id/history — audit log for this study
router.get('/:id/history', async (req, res) => {
  try {
    const study = await ImagingStudy.findByPk(req.params.id);
    if (!study) return res.status(404).json({ error: 'Imaging study not found' });

    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await AuditLog.findAndCountAll({
      where: { resourceId: String(req.params.id), resourceType: 'ImagingStudy' },
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

// 16. GET /export/csv — export all studies as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const where = {};
    if (req.query.status)   where.status   = req.query.status;
    if (req.query.modality) where.modality = req.query.modality;

    const studies = await ImagingStudy.findAll({ where, order: [['createdAt', 'DESC']] });

    const fields = [
      'id', 'patientId', 'encounterId', 'orderId', 'studyInstanceUid', 'accessionNumber',
      'modality', 'studyType', 'bodyPart', 'studyDate', 'status', 'numImages', 'pacsUrl',
      'radiologistId', 'reportText', 'impression', 'criticalFindings', 'aiFindings',
      'aiSuggestedFollowup', 'createdAt', 'updatedAt'
    ];

    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const header = fields.join(',');
    const rows   = studies.map(s => fields.map(f => escape(s[f])).join(','));
    const csv    = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="imaging_studies.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. POST /import/csv — import studies from CSV body (text/plain or JSON array)
router.post('/import/csv', async (req, res) => {
  try {
    let records = [];

    // Accept JSON array body (client can pre-parse CSV) or raw CSV text
    if (Array.isArray(req.body)) {
      records = req.body;
    } else if (typeof req.body === 'string') {
      const lines = req.body.trim().split('\n');
      if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + at least 1 data row' });
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      records = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] || null; });
        return obj;
      });
    } else {
      return res.status(400).json({ error: 'Body must be a JSON array or CSV text' });
    }

    if (records.length === 0) return res.status(400).json({ error: 'No records to import' });

    // Strip auto-managed fields
    const sanitized = records.map(({ id, createdAt, updatedAt, ...rest }) => rest);
    const created = await ImagingStudy.bulkCreate(sanitized, { validate: true, ignoreDuplicates: true });

    res.status(201).json({ message: `${created.length} studies imported`, count: created.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 18. GET /stats/summary — counts by modality, by status, % with critical findings
router.get('/stats/summary', async (req, res) => {
  try {
    const { Sequelize } = require('sequelize');

    const [byModality, byStatus, totalCount, criticalCount] = await Promise.all([
      ImagingStudy.findAll({
        attributes: ['modality', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        group: ['modality'],
        raw: true
      }),
      ImagingStudy.findAll({
        attributes: ['status', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        group: ['status'],
        raw: true
      }),
      ImagingStudy.count(),
      ImagingStudy.count({ where: { criticalFindings: true } })
    ]);

    const criticalPercent = totalCount > 0
      ? parseFloat(((criticalCount / totalCount) * 100).toFixed(2))
      : 0;

    res.json({
      byModality,
      byStatus,
      totalCount,
      criticalCount,
      criticalPercent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 16 AI VERB ENDPOINTS  (POST /ai/<verb>)
// All rate-limited + AiResult persisted
// =============================================================================

// 1. POST /ai/extract-findings — body: {studyId}
router.post('/ai/extract-findings', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI assistant. Extract all clinical findings from the following imaging study report.

Study Details:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Study Type: ${study.studyType}
- Report Text: ${study.reportText || 'No report text available'}
- Impression: ${study.impression || 'No impression documented'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "findings": [
    { "finding": "<description>", "location": "<anatomical location>", "severity": "<mild|moderate|severe>", "is_critical": <true|false> }
  ],
  "primary_findings": "<summary of key findings>",
  "incidental_findings": ["<finding>"],
  "normal_structures": ["<structure>"],
  "limitations": "<any scan limitations>",
  "confidence": "<high|medium|low>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    if (study) {
      await study.update({ aiFindings: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) });
    }

    await persistAiResult(req.user?.id, '/ai/imaging/extract-findings', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /ai/suggest-followup — body: {studyId}
router.post('/ai/suggest-followup', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI. Recommend follow-up imaging or clinical actions for this study.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Impression: ${study.impression || 'N/A'}
- Critical Findings: ${study.criticalFindings}
- AI Findings: ${study.aiFindings || 'N/A'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "followup_imaging": [
    { "modality": "<modality>", "bodyPart": "<body part>", "timing": "<immediate|24h|1 week|1 month|3 months|6 months|1 year>", "rationale": "<reason>" }
  ],
  "clinical_actions": ["<action>"],
  "specialist_referrals": ["<specialty>"],
  "urgency": "<routine|semi-urgent|urgent|emergent>",
  "patient_notification": "<should patient be notified immediately>",
  "summary": "<overall follow-up recommendation>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    if (study) {
      await study.update({ aiSuggestedFollowup: typeof parsed === 'string' ? parsed : JSON.stringify(parsed) });
    }

    await persistAiResult(req.user?.id, '/ai/imaging/suggest-followup', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /ai/classify-abnormalities — body: {studyId}
router.post('/ai/classify-abnormalities', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI. Classify all abnormalities found in this imaging study.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Report: ${study.reportText || 'N/A'}
- Impression: ${study.impression || 'N/A'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "abnormalities": [
    {
      "name": "<abnormality name>",
      "category": "<structural|functional|vascular|inflammatory|neoplastic|traumatic|congenital|other>",
      "severity": "<mild|moderate|severe|critical>",
      "confidence": "<high|medium|low>",
      "location": "<anatomical location>",
      "acr_category": "<ACR category if applicable>",
      "is_new": "<yes|no|unknown>",
      "requires_immediate_action": <true|false>
    }
  ],
  "overall_classification": "<normal|abnormal|critical>",
  "critical_count": <number>,
  "summary": "<overall abnormality summary>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/classify-abnormalities', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /ai/generate-report — body: {studyId, findings}
router.post('/ai/generate-report', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId, findings } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI. Generate a structured radiology report for this imaging study.

Study Details:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Study Type: ${study.studyType}
- Study Date: ${study.studyDate}
- Accession: ${study.accessionNumber || 'N/A'}
- Number of Images: ${study.numImages || 'N/A'}
` : JSON.stringify(req.body)}
Additional Findings: ${findings || 'None provided'}

Respond with valid JSON:
{
  "report": {
    "clinical_indication": "<indication>",
    "technique": "<imaging technique and parameters>",
    "comparison": "<prior studies if applicable>",
    "findings": "<detailed structured findings by anatomical region>",
    "impression": "<numbered impression list>",
    "recommendations": "<radiologist recommendations>",
    "radiologist_signature": "AI-Generated Draft — Requires Radiologist Review"
  },
  "report_text": "<full plain text report>",
  "critical_communication_required": <true|false>,
  "estimated_read_time_minutes": <number>
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    if (study && parsed.report_text) {
      await study.update({ reportText: parsed.report_text });
    }

    await persistAiResult(req.user?.id, '/ai/imaging/generate-report', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /ai/prioritize-worklist — body: {radiologistId}
router.post('/ai/prioritize-worklist', imagingAiRateLimit, async (req, res) => {
  try {
    const { radiologistId } = req.body;

    const pendingStudies = await ImagingStudy.findAll({
      where: { status: { [Op.in]: ['Acquired', 'InProgress'] } },
      order: [['studyDate', 'ASC']],
      limit: 100
    });

    const studySummaries = pendingStudies.map(s => ({
      id: s.id,
      modality: s.modality,
      bodyPart: s.bodyPart,
      studyType: s.studyType,
      studyDate: s.studyDate,
      criticalFindings: s.criticalFindings,
      status: s.status
    }));

    const prompt = `You are a radiology workflow AI. Prioritize this reading worklist for radiologist ${radiologistId || 'on duty'}.

Pending Studies (${pendingStudies.length} total):
${JSON.stringify(studySummaries, null, 2)}

Respond with valid JSON:
{
  "prioritized_worklist": [
    {
      "study_id": <id>,
      "priority_rank": <number>,
      "priority_level": "<STAT|urgent|routine>",
      "reason": "<rationale for prioritization>",
      "estimated_read_time_minutes": <number>
    }
  ],
  "stat_count": <number>,
  "urgent_count": <number>,
  "routine_count": <number>,
  "total_estimated_time_minutes": <number>,
  "recommendations": ["<workflow recommendation>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiology workflow AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/prioritize-worklist', null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, pendingCount: pendingStudies.length, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /ai/suggest-recommended-protocol — body: {bodyPart, clinicalQuestion}
router.post('/ai/suggest-recommended-protocol', imagingAiRateLimit, async (req, res) => {
  try {
    const { bodyPart, clinicalQuestion, patientAge, contrastAllergy, renalFunction } = req.body;

    const prompt = `You are a radiologist AI expert in imaging protocols. Recommend the optimal imaging protocol.

Clinical Question: ${clinicalQuestion || 'Not specified'}
Body Part: ${bodyPart || 'Not specified'}
Patient Age: ${patientAge || 'Unknown'}
Contrast Allergy: ${contrastAllergy || 'None known'}
Renal Function: ${renalFunction || 'Not specified'}

Respond with valid JSON:
{
  "recommended_modality": "<modality>",
  "protocol_name": "<specific protocol name>",
  "contrast": "<with contrast|without contrast|with and without|not applicable>",
  "contrast_type": "<agent if applicable>",
  "rationale": "<why this protocol>",
  "alternative_protocols": [
    { "modality": "<modality>", "protocol": "<name>", "use_if": "<condition>" }
  ],
  "patient_prep": ["<preparation step>"],
  "contraindications": ["<contraindication>"],
  "radiation_dose": "<relative dose if applicable>",
  "estimated_scan_time_minutes": <number>,
  "acr_appropriateness": "<usually appropriate|may be appropriate|usually not appropriate>",
  "ordering_instructions": "<clinical instructions for ordering>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/suggest-recommended-protocol', null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /ai/flag-critical-findings — body: {studyId}
router.post('/ai/flag-critical-findings', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI. Evaluate if any critical findings require immediate communication.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Report: ${study.reportText || 'N/A'}
- Impression: ${study.impression || 'N/A'}
- AI Findings: ${study.aiFindings || 'N/A'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "is_critical": <true|false>,
  "critical_findings": [
    {
      "finding": "<critical finding description>",
      "severity": "<life-threatening|urgent|significant>",
      "anatomical_location": "<location>",
      "required_action": "<immediate action required>",
      "communication_timeframe": "<immediate|within 1 hour|within 24 hours>"
    }
  ],
  "acr_communication_standard": "<yes, meets criteria|no>",
  "recommended_notification": {
    "notify_ordering_physician": <true|false>,
    "notify_patient": <true|false>,
    "escalate_to_attending": <true|false>,
    "timeframe": "<when to communicate>"
  },
  "summary": "<overall critical findings assessment>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    if (study && parsed.is_critical === true) {
      await study.update({ criticalFindings: true });
    }

    await persistAiResult(req.user?.id, '/ai/imaging/flag-critical-findings', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /ai/summarize-comparison — body: {studyId, priorStudyId}
router.post('/ai/summarize-comparison', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId, priorStudyId } = req.body;

    let study = null, priorStudy = null;
    if (studyId)      study      = await ImagingStudy.findByPk(studyId);
    if (priorStudyId) priorStudy = await ImagingStudy.findByPk(priorStudyId);

    const prompt = `You are a radiologist AI. Compare the current imaging study with the prior study and summarize changes.

Current Study:
${study ? `
- Modality: ${study.modality} | Body Part: ${study.bodyPart}
- Date: ${study.studyDate}
- Report: ${study.reportText || 'N/A'}
- Impression: ${study.impression || 'N/A'}
` : 'Not found'}

Prior Study:
${priorStudy ? `
- Modality: ${priorStudy.modality} | Body Part: ${priorStudy.bodyPart}
- Date: ${priorStudy.studyDate}
- Report: ${priorStudy.reportText || 'N/A'}
- Impression: ${priorStudy.impression || 'N/A'}
` : 'Not found or not provided'}

Respond with valid JSON:
{
  "interval_period": "<time between studies>",
  "overall_trend": "<improved|stable|worsened|new findings|resolved>",
  "changes": [
    { "finding": "<finding>", "change": "<improved|stable|worsened|new|resolved>", "details": "<details>" }
  ],
  "new_findings": ["<finding>"],
  "resolved_findings": ["<finding>"],
  "stable_findings": ["<finding>"],
  "clinical_significance": "<significance of changes>",
  "recommendation": "<clinical recommendation based on comparison>",
  "summary": "<concise comparison summary for clinical report>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/summarize-comparison', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /ai/extract-measurements — body: {studyId}
router.post('/ai/extract-measurements', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI. Extract all quantitative measurements from this imaging study report.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Report: ${study.reportText || 'N/A'}
- Impression: ${study.impression || 'N/A'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "measurements": [
    {
      "structure": "<anatomical structure>",
      "measurement": "<value with unit>",
      "plane": "<axial|coronal|sagittal|3D>",
      "normal_range": "<normal reference range>",
      "is_abnormal": <true|false>,
      "clinical_significance": "<significance>"
    }
  ],
  "lesion_measurements": [
    {
      "lesion_id": "<identifier>",
      "location": "<location>",
      "max_dimension": "<value>",
      "all_dimensions": "<AxBxC mm>",
      "volume_estimate": "<if available>",
      "recist_category": "<if applicable>"
    }
  ],
  "organ_sizes": { "<organ>": "<size>" },
  "summary": "<measurement summary>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/extract-measurements', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST /ai/suggest-differential — body: {studyId}
router.post('/ai/suggest-differential', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId, clinicalContext } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId, { include: [{ model: Patient, as: 'patient', required: false }] });

    const prompt = `You are a radiologist AI. Generate a differential diagnosis based on this imaging study.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Study Type: ${study.studyType}
- Impression: ${study.impression || 'N/A'}
- AI Findings: ${study.aiFindings || 'N/A'}
- Patient Age: ${study.patient?.dateOfBirth ? 'Available' : 'Unknown'}
` : JSON.stringify(req.body)}
Clinical Context: ${clinicalContext || 'Not provided'}

Respond with valid JSON:
{
  "differential_diagnosis": [
    {
      "rank": <number>,
      "diagnosis": "<diagnosis name>",
      "icd10_code": "<ICD-10 code>",
      "probability": "<high|moderate|low>",
      "supporting_features": ["<feature>"],
      "against_features": ["<feature>"],
      "next_step": "<recommended next step to confirm or exclude>"
    }
  ],
  "most_likely_diagnosis": "<top diagnosis>",
  "least_likely_but_critical": "<dangerous diagnosis not to miss>",
  "additional_imaging_to_clarify": ["<imaging>"],
  "recommended_labs": ["<lab test>"],
  "summary": "<differential summary>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/suggest-differential', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST /ai/generate-impression — body: {studyId}
router.post('/ai/generate-impression', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI. Generate a concise, numbered radiology impression from this study's findings.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Study Type: ${study.studyType}
- Full Report: ${study.reportText || 'N/A'}
- AI Findings: ${study.aiFindings || 'N/A'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "impression": "<full impression text with numbered items>",
  "impression_items": [
    { "number": <n>, "finding": "<impression item>", "is_critical": <true|false> }
  ],
  "recommendations": "<follow-up recommendations appended to impression>",
  "character_count": <number>,
  "confidence": "<high|medium|low>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    if (study && parsed.impression) {
      await study.update({ impression: parsed.impression });
    }

    await persistAiResult(req.user?.id, '/ai/imaging/generate-impression', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /ai/score-image-quality — body: {studyId}
router.post('/ai/score-image-quality', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI and imaging physicist. Score the image quality of this study and identify any technical issues.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Study Type: ${study.studyType}
- Number of Images: ${study.numImages || 'N/A'}
- Report: ${study.reportText || 'N/A'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "overall_quality_score": <1-10>,
  "quality_grade": "<excellent|good|adequate|poor|non-diagnostic>",
  "diagnostic_adequacy": "<fully diagnostic|partially diagnostic|non-diagnostic>",
  "technical_issues": [
    { "issue": "<issue name>", "severity": "<minor|moderate|major>", "impact": "<impact on diagnosis>" }
  ],
  "quality_dimensions": {
    "noise": <1-10>,
    "contrast": <1-10>,
    "resolution": <1-10>,
    "motion_artifact": <1-10>,
    "positioning": <1-10>,
    "coverage": <1-10>
  },
  "repeat_needed": <true|false>,
  "repeat_reason": "<reason if repeat needed>",
  "technical_recommendations": ["<recommendation>"],
  "summary": "<quality summary>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/score-image-quality', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /ai/suggest-additional-views — body: {studyId}
router.post('/ai/suggest-additional-views', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId, clinicalQuestion } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI. Recommend additional imaging views or series that would improve diagnostic yield.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Study Type: ${study.studyType}
- Impression: ${study.impression || 'N/A'}
- AI Findings: ${study.aiFindings || 'N/A'}
` : JSON.stringify(req.body)}
Clinical Question: ${clinicalQuestion || 'Not specified'}

Respond with valid JSON:
{
  "additional_views": [
    {
      "view": "<view name>",
      "modality": "<same or different modality>",
      "rationale": "<why this view helps>",
      "priority": "<immediate|next available|routine>",
      "expected_benefit": "<what it adds>"
    }
  ],
  "supplemental_sequences": ["<sequence name if MRI/CT>"],
  "complementary_studies": [
    { "study": "<study type>", "rationale": "<reason>", "timing": "<when to obtain>" }
  ],
  "not_recommended": ["<views that would NOT add value and why>"],
  "summary": "<overall recommendations for additional views>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/suggest-additional-views', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /ai/draft-patient-summary — body: {studyId, language}
router.post('/ai/draft-patient-summary', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId, language } = req.body;
    const lang = language || 'English';
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiology AI specializing in patient communication. Write a plain-language patient summary of this imaging study in ${lang}.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Impression: ${study.impression || 'N/A'}
- Critical Findings: ${study.criticalFindings}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "patient_summary": "<plain-language summary in ${lang}, written for a general audience at 8th grade reading level>",
  "key_points": ["<key point for patient>"],
  "what_was_found": "<simple explanation of findings>",
  "what_it_means": "<what findings mean for health>",
  "next_steps": ["<patient action item>"],
  "when_to_seek_care": "<when to go to ER or call doctor>",
  "questions_to_ask_doctor": ["<suggested question>"],
  "language": "${lang}",
  "reading_level": "<estimated grade level>"
}`;

    const aiResult = await callOpenRouter(prompt, `You are a patient communication AI. Respond ONLY with valid JSON in ${lang}.`);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/draft-patient-summary', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /ai/code-procedure — CPT codes
router.post('/ai/code-procedure', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a medical coding AI specializing in radiology CPT coding. Assign appropriate CPT codes for this imaging study.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Study Type: ${study.studyType}
- Number of Images: ${study.numImages || 'N/A'}
- Report: ${study.reportText || 'N/A'}
- Impression: ${study.impression || 'N/A'}
- Contrast Used: ${req.body.contrastUsed || 'Unknown'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "primary_cpt": {
    "code": "<CPT code>",
    "description": "<full description>",
    "work_rvu": <number>,
    "total_rvu": <number>
  },
  "additional_cpt_codes": [
    { "code": "<code>", "description": "<description>", "reason": "<why applicable>", "rvu": <number> }
  ],
  "icd10_codes": [
    { "code": "<ICD-10>", "description": "<description>", "type": "<primary|secondary>" }
  ],
  "modifier_codes": ["<modifier with explanation>"],
  "total_rvu": <total>,
  "estimated_reimbursement_usd": <estimate>,
  "coding_notes": "<any special coding considerations>",
  "documentation_requirements": ["<required documentation element>"],
  "confidence": "<high|medium|low>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a medical coding AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/code-procedure', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /ai/detect-incidental-findings — body: {studyId}
router.post('/ai/detect-incidental-findings', imagingAiRateLimit, async (req, res) => {
  try {
    const { studyId } = req.body;
    let study = null;
    if (studyId) study = await ImagingStudy.findByPk(studyId);

    const prompt = `You are a radiologist AI specializing in incidental finding detection and management. Identify all incidental findings in this study.

Study:
${study ? `
- Modality: ${study.modality}
- Body Part: ${study.bodyPart}
- Study Type: ${study.studyType}
- Full Report: ${study.reportText || 'N/A'}
- Impression: ${study.impression || 'N/A'}
` : JSON.stringify(req.body)}

Respond with valid JSON:
{
  "incidental_findings": [
    {
      "finding": "<incidental finding description>",
      "anatomical_location": "<location>",
      "category": "<cardiovascular|pulmonary|abdominal|renal|adrenal|thyroid|musculoskeletal|neurological|other>",
      "clinical_significance": "<benign|indeterminate|potentially significant|significant>",
      "prevalence": "<common incidental finding|uncommon>",
      "management_guideline": "<applicable guideline e.g. Fleischner, ACR Incidental Findings>",
      "recommended_followup": "<recommended action and timeline>",
      "requires_immediate_action": <true|false>
    }
  ],
  "total_incidental_count": <number>,
  "actionable_count": <number>,
  "non_actionable_count": <number>,
  "priority_followup": ["<highest priority finding>"],
  "patient_communication_needed": <true|false>,
  "summary": "<overall incidental findings summary and management plan>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a radiologist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/imaging/detect-incidental-findings', study?.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
