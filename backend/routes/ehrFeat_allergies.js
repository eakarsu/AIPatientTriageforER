const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { Allergy, Patient, AuditLog, AiResult } = require('../models');

const router = express.Router();

// ── In-memory rate limiter: max 20 AI calls per hour per user/IP ──────────────
const allergyRateLimitMap = new Map();
function allergyAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const limit = 20;

  const entry = allergyRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  allergyRateLimitMap.set(key, entry);

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

// ── Persist AI result ─────────────────────────────────────────────────────────
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

// ── Helper: fetch allergy or 404 ──────────────────────────────────────────────
async function findAllergyOrFail(res, id) {
  const allergy = await Allergy.findByPk(id);
  if (!allergy) {
    res.status(404).json({ error: 'Allergy not found' });
    return null;
  }
  return allergy;
}

// ── All routes require auth ───────────────────────────────────────────────────
router.use(auth);

// ═════════════════════════════════════════════════════════════════════════════
// CRUD ENDPOINTS (18)
// ═════════════════════════════════════════════════════════════════════════════

// 1. GET / — list with pagination + optional ?status filter
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const { count, rows } = await Allergy.findAndCountAll({
      where,
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

// 2. GET /:id — get by id (write AuditLog)
router.get('/:id', async (req, res) => {
  try {
    const allergy = await findAllergyOrFail(res, req.params.id);
    if (!allergy) return;

    // Write AuditLog
    try {
      await AuditLog.create({
        action: 'view_allergy',
        patientId: allergy.patientId || null,
        userId: req.user?.id || null,
        resourceId: allergy.id,
        resourceType: 'Allergy',
        details: `Viewed allergy ${allergy.id}`
      });
    } catch (e) {
      console.error('AuditLog write failed:', e.message);
    }

    res.json(allergy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST / — create
router.post('/', async (req, res) => {
  try {
    const allergy = await Allergy.create(req.body);
    res.status(201).json(allergy);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. PUT /:id — update
router.put('/:id', async (req, res) => {
  try {
    const allergy = await findAllergyOrFail(res, req.params.id);
    if (!allergy) return;
    await allergy.update(req.body);
    res.json(allergy);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. DELETE /:id — soft-delete (set status='Inactive')
router.delete('/:id', async (req, res) => {
  try {
    const allergy = await findAllergyOrFail(res, req.params.id);
    if (!allergy) return;
    await allergy.update({ status: 'Inactive' });
    res.json({ success: true, message: 'Allergy marked Inactive' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /by-patient/:patientId — list active allergies for patient
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const allergies = await Allergy.findAll({
      where: { patientId: req.params.patientId, status: 'Active' },
      order: [['severity', 'ASC']]
    });
    res.json(allergies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /by-severity/:severity — list by severity
router.get('/by-severity/:severity', async (req, res) => {
  try {
    const allergies = await Allergy.findAll({
      where: { severity: req.params.severity },
      order: [['createdAt', 'DESC']]
    });
    res.json(allergies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /batch — batch create
router.post('/batch', async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required' });
    }
    const created = await Allergy.bulkCreate(records, { returning: true });
    res.status(201).json({ success: true, count: created.length, data: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9. PUT /batch — batch update
router.put('/batch', async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates array is required (each: {id, ...fields})' });
    }
    const results = await Promise.all(
      updates.map(async ({ id, ...fields }) => {
        const allergy = await Allergy.findByPk(id);
        if (!allergy) return { id, error: 'Not found' };
        await allergy.update(fields);
        return allergy;
      })
    );
    res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 10. DELETE /batch — batch soft-delete
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const { Op } = require('sequelize');
    const [affected] = await Allergy.update(
      { status: 'Inactive' },
      { where: { id: { [Op.in]: ids } } }
    );
    res.json({ success: true, affected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. GET /count — count with optional ?status, ?severity
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.severity) where.severity = req.query.severity;
    const count = await Allergy.count({ where });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET /search — search by ?q in allergen/reaction
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const { Op } = require('sequelize');
    const allergies = await Allergy.findAll({
      where: {
        [Op.or]: [
          { allergen: { [Op.like]: `%${q}%` } },
          { reaction: { [Op.like]: `%${q}%` } }
        ]
      },
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    res.json(allergies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /:id/archive — status='Inactive'
router.post('/:id/archive', async (req, res) => {
  try {
    const allergy = await findAllergyOrFail(res, req.params.id);
    if (!allergy) return;
    await allergy.update({ status: 'Inactive' });
    res.json({ success: true, allergy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /:id/restore — status='Active'
router.post('/:id/restore', async (req, res) => {
  try {
    const allergy = await findAllergyOrFail(res, req.params.id);
    if (!allergy) return;
    await allergy.update({ status: 'Active' });
    res.json({ success: true, allergy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. GET /:id/history — AuditLog entries for patientId
router.get('/:id/history', async (req, res) => {
  try {
    const allergy = await findAllergyOrFail(res, req.params.id);
    if (!allergy) return;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await AuditLog.findAndCountAll({
      where: { patientId: allergy.patientId },
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

// 16. GET /export/csv
router.get('/export/csv', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const allergies = await Allergy.findAll({ where, order: [['createdAt', 'DESC']] });

    const headers = [
      'id', 'patientId', 'allergen', 'allergenType', 'reaction',
      'severity', 'onsetDate', 'status', 'rxnormCode', 'snomedCode',
      'notedBy', 'source', 'aiCrossReactivityRisk', 'createdAt', 'updatedAt'
    ];

    const escape = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };

    const rows = allergies.map(a =>
      headers.map(h => escape(a[h])).join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="allergies.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. POST /import/csv
router.post('/import/csv', async (req, res) => {
  try {
    const { csvText } = req.body;
    if (!csvText) return res.status(400).json({ error: 'csvText is required in request body' });

    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

    const headers = lines[0].split(',').map(h => h.trim());
    const records = lines.slice(1).map(line => {
      const values = line.split(',');
      const record = {};
      headers.forEach((h, i) => {
        const v = (values[i] || '').trim().replace(/^"|"$/g, '').replace(/""/g, '"');
        if (v !== '') record[h] = v;
      });
      return record;
    }).filter(r => r.allergen); // require allergen at minimum

    if (records.length === 0) return res.status(400).json({ error: 'No valid records found in CSV' });

    const created = await Allergy.bulkCreate(records, { returning: true, ignoreDuplicates: true });
    res.status(201).json({ success: true, imported: created.length, skipped: records.length - created.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 18. GET /stats/summary — counts by allergenType, severity distribution, top 10 allergens
router.get('/stats/summary', async (req, res) => {
  try {
    const { Op, fn, col, literal } = require('sequelize');

    const [byType, bySeverity, topAllergens, total] = await Promise.all([
      // counts by allergenType
      Allergy.findAll({
        attributes: ['allergenType', [fn('COUNT', col('id')), 'count']],
        group: ['allergenType'],
        raw: true
      }),
      // severity distribution
      Allergy.findAll({
        attributes: ['severity', [fn('COUNT', col('id')), 'count']],
        group: ['severity'],
        raw: true
      }),
      // top 10 allergens
      Allergy.findAll({
        attributes: ['allergen', [fn('COUNT', col('id')), 'count']],
        group: ['allergen'],
        order: [[fn('COUNT', col('id')), 'DESC']],
        limit: 10,
        raw: true
      }),
      Allergy.count()
    ]);

    res.json({ total, byAllergenType: byType, bySeverity, topAllergens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// AI ENDPOINTS (16) — rate-limited
// ═════════════════════════════════════════════════════════════════════════════

router.use('/ai', allergyAiRateLimit);

// 1. POST /ai/check-cross-reactivity
router.post('/ai/check-cross-reactivity', async (req, res) => {
  try {
    const { allergyId, candidateDrug } = req.body;
    if (!allergyId || !candidateDrug) {
      return res.status(400).json({ error: 'allergyId and candidateDrug are required' });
    }
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are a clinical pharmacist AI. Assess cross-reactivity risk between a documented allergy and a candidate drug.

Documented Allergy:
- Allergen: ${allergy.allergen}
- Allergen Type: ${allergy.allergenType}
- Reaction: ${allergy.reaction}
- Severity: ${allergy.severity}
- RxNorm Code: ${allergy.rxnormCode || 'Not coded'}
- SNOMED Code: ${allergy.snomedCode || 'Not coded'}

Candidate Drug: ${candidateDrug}

Respond ONLY with valid JSON:
{
  "cross_reactivity_risk": "<none|low|moderate|high|definite>",
  "mechanism": "<pharmacological basis>",
  "shared_epitopes": ["<structural or chemical similarity>"],
  "clinical_recommendation": "<safe|use with caution|avoid>",
  "alternative_options": ["<alternative 1>", "<alternative 2>"],
  "evidence_basis": "<supporting literature or guideline>",
  "monitoring_if_used": "<what to watch>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Update aiCrossReactivityRisk field on allergy
    try {
      await allergy.update({ aiCrossReactivityRisk: JSON.stringify(parsed) });
    } catch (e) {}

    await persistAiResult(req.user?.id, '/allergies/ai/check-cross-reactivity', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /ai/classify-severity
router.post('/ai/classify-severity', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are an allergist AI. Classify the severity of this documented allergy reaction.

Allergen: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Reported Reaction: ${allergy.reaction}
Current Severity on Record: ${allergy.severity}
Onset Date: ${allergy.onsetDate || 'Unknown'}

Respond ONLY with valid JSON:
{
  "recommended_severity": "<Mild|Moderate|Severe|Anaphylactic>",
  "confidence": "<high|medium|low>",
  "rationale": "<clinical reasoning>",
  "key_indicators": ["<indicator 1>", "<indicator 2>"],
  "discordance_with_record": <true|false>,
  "discordance_explanation": "<if different from current, why>",
  "anaphylaxis_screening_criteria_met": <true|false>
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an allergist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/classify-severity', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /ai/normalize-allergen-rxnorm
router.post('/ai/normalize-allergen-rxnorm', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are a clinical terminology AI. Normalize this allergen to a standard RxNorm or SNOMED CT code.

Allergen as Documented: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Reaction: ${allergy.reaction}
Existing RxNorm Code: ${allergy.rxnormCode || 'None'}
Existing SNOMED Code: ${allergy.snomedCode || 'None'}

Respond ONLY with valid JSON:
{
  "normalized_allergen_name": "<canonical name>",
  "rxnorm_code": "<code or null>",
  "rxnorm_description": "<description>",
  "snomed_code": "<code or null>",
  "snomed_description": "<description>",
  "ndc_codes": ["<NDC if applicable>"],
  "drug_class": "<class if drug allergen>",
  "confidence": "<high|medium|low>",
  "notes": "<any normalization caveats>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical terminology AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Attempt to update codes on the record
    try {
      const updates = {};
      if (parsed.rxnorm_code) updates.rxnormCode = parsed.rxnorm_code;
      if (parsed.snomed_code) updates.snomedCode = parsed.snomed_code;
      if (Object.keys(updates).length > 0) await allergy.update(updates);
    } catch (e) {}

    await persistAiResult(req.user?.id, '/allergies/ai/normalize-allergen-rxnorm', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /ai/suggest-alternatives
router.post('/ai/suggest-alternatives', async (req, res) => {
  try {
    const { allergyId, drugClass } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are a clinical pharmacist AI. Suggest safe therapeutic alternatives given this documented allergy.

Documented Allergy:
- Allergen: ${allergy.allergen}
- Allergen Type: ${allergy.allergenType}
- Reaction: ${allergy.reaction}
- Severity: ${allergy.severity}

Drug Class Needed: ${drugClass || 'Not specified — suggest across relevant classes'}

Respond ONLY with valid JSON:
{
  "alternatives": [
    {
      "drug_name": "<name>",
      "drug_class": "<class>",
      "cross_reactivity_risk": "<none|low|moderate|high>",
      "rationale": "<why this is a safe alternative>",
      "precautions": "<any warnings>"
    }
  ],
  "classes_to_avoid": ["<class 1>", "<class 2>"],
  "desensitization_option": "<describe if applicable, else null>",
  "clinical_notes": "<prescriber notes>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/suggest-alternatives', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /ai/predict-reaction-trajectory
router.post('/ai/predict-reaction-trajectory', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are an emergency medicine AI. Predict the likely clinical trajectory if this patient is inadvertently re-exposed to their allergen.

Allergy Details:
- Allergen: ${allergy.allergen}
- Allergen Type: ${allergy.allergenType}
- Past Reaction: ${allergy.reaction}
- Severity on Record: ${allergy.severity}
- Onset Date: ${allergy.onsetDate || 'Unknown'}

Respond ONLY with valid JSON:
{
  "predicted_onset_minutes": "<range>",
  "predicted_peak_severity": "<Mild|Moderate|Severe|Anaphylactic>",
  "trajectory_phases": [
    { "phase": "<name>", "timeframe": "<when>", "expected_symptoms": ["<symptom>"] }
  ],
  "escalation_risk": "<low|moderate|high>",
  "anaphylaxis_probability": "<percentage>",
  "biphasic_reaction_risk": "<low|moderate|high>",
  "recommended_observation_window_hours": <number>,
  "emergency_interventions": ["<intervention>"],
  "prognostic_factors": ["<factor that influences severity>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an emergency medicine AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/predict-reaction-trajectory', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /ai/generate-allergy-card
router.post('/ai/generate-allergy-card', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    // Optionally fetch patient
    let patient = null;
    try { if (allergy.patientId) patient = await Patient.findByPk(allergy.patientId); } catch (e) {}

    const prompt = `You are a patient safety AI. Generate a printable allergy wallet card summary for this patient.

Patient: ${patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown' : 'Unknown'}
Allergy:
- Allergen: ${allergy.allergen}
- Type: ${allergy.allergenType}
- Reaction: ${allergy.reaction}
- Severity: ${allergy.severity}
- Status: ${allergy.status}
- RxNorm: ${allergy.rxnormCode || 'N/A'}
- SNOMED: ${allergy.snomedCode || 'N/A'}

Respond ONLY with valid JSON:
{
  "card_title": "ALLERGY ALERT",
  "patient_name": "<name>",
  "allergy_line": "<one-line summary>",
  "reaction_warning": "<brief reaction description>",
  "severity_badge": "<severity label>",
  "avoid_list": ["<substance or class to avoid>"],
  "emergency_instruction": "<what responders should do>",
  "medications_to_avoid": ["<drug>"],
  "safe_alternatives_note": "<brief note>",
  "card_footer": "<e.g., 'Show this card to all healthcare providers'>",
  "printable_text": "<full plain-text version of the card>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a patient safety AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/generate-allergy-card', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, card: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /ai/detect-drug-allergen-conflict
router.post('/ai/detect-drug-allergen-conflict', async (req, res) => {
  try {
    const { patientId, proposedDrug } = req.body;
    if (!patientId || !proposedDrug) {
      return res.status(400).json({ error: 'patientId and proposedDrug are required' });
    }

    const allergies = await Allergy.findAll({ where: { patientId, status: 'Active' } });
    if (allergies.length === 0) {
      return res.json({ success: true, conflicts: [], message: 'No active allergies on file for this patient' });
    }

    const allergyList = allergies.map(a =>
      `- ${a.allergen} (${a.allergenType}): ${a.reaction} — Severity: ${a.severity}`
    ).join('\n');

    const prompt = `You are a clinical decision support AI. Detect conflicts between a proposed drug order and a patient's active allergy list.

Proposed Drug: ${proposedDrug}

Patient Active Allergies:
${allergyList}

Respond ONLY with valid JSON:
{
  "conflict_detected": <true|false>,
  "overall_risk": "<none|low|moderate|high|critical>",
  "conflicts": [
    {
      "allergen": "<allergen name>",
      "conflict_type": "<direct|cross-reactive|class-level>",
      "severity": "<Mild|Moderate|Severe|Anaphylactic>",
      "explanation": "<why this is a conflict>",
      "recommendation": "<block|warn|monitor>"
    }
  ],
  "decision": "<PROCEED|CAUTION|DO NOT ADMINISTER>",
  "rationale": "<overall clinical reasoning>",
  "safe_alternative": "<alternative drug if applicable>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical decision support AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/detect-drug-allergen-conflict', patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /ai/flag-anaphylaxis-risk
router.post('/ai/flag-anaphylaxis-risk', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are an emergency medicine AI. Assess the anaphylaxis risk for this documented allergy.

Allergen: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Reaction: ${allergy.reaction}
Severity: ${allergy.severity}
Status: ${allergy.status}

Respond ONLY with valid JSON:
{
  "anaphylaxis_risk": "<low|moderate|high|definite>",
  "risk_score": <0-100>,
  "criteria_met": ["<World Allergy Organization criterion>"],
  "epinephrine_indicated": <true|false>,
  "epinephrine_dose_note": "<dose guidance if indicated>",
  "allergy_referral_recommended": <true|false>,
  "flag_for_er_protocol": <true|false>,
  "clinical_notes": "<key points for treating clinician>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an emergency medicine AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/flag-anaphylaxis-risk', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /ai/summarize-allergy-list
router.post('/ai/summarize-allergy-list', async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const allergies = await Allergy.findAll({
      where: { patientId, status: 'Active' },
      order: [['severity', 'ASC']]
    });

    if (allergies.length === 0) {
      return res.json({ success: true, summary: 'No active allergies documented for this patient (NKDA).' });
    }

    const allergyData = allergies.map(a => ({
      allergen: a.allergen,
      type: a.allergenType,
      reaction: a.reaction,
      severity: a.severity,
      rxnorm: a.rxnormCode,
      snomed: a.snomedCode
    }));

    const prompt = `You are a clinical documentation AI. Summarize this patient's active allergy list for an ER clinician.

Active Allergies (${allergies.length} total):
${JSON.stringify(allergyData, null, 2)}

Provide a concise clinical summary including:
1. Most critical allergies (anaphylactic/severe) at the top
2. Drug class patterns to avoid
3. Any notable cross-reactivity clusters
4. NKDA note if list is empty
5. Recommendations for prescribers`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/allergies/ai/summarize-allergy-list', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, summary: aiResult.result, count: allergies.length, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST /ai/suggest-skin-test
router.post('/ai/suggest-skin-test', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are an allergy/immunology AI consultant. Advise on whether skin testing is appropriate for this documented allergy.

Allergen: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Reaction: ${allergy.reaction}
Severity: ${allergy.severity}
Onset: ${allergy.onsetDate || 'Unknown'}

Respond ONLY with valid JSON:
{
  "skin_test_recommended": <true|false>,
  "test_type": "<prick|intradermal|patch|RAST/IgE|none>",
  "rationale": "<why or why not>",
  "contraindications": ["<reason skin test not safe>"],
  "pre_test_precautions": ["<precaution>"],
  "referral_specialty": "<Allergy/Immunology|Dermatology|none>",
  "urgency": "<elective|soon|urgent>",
  "alternative_diagnostic_approach": "<if skin test not indicated>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an allergy/immunology AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/suggest-skin-test', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST /ai/explain-to-patient
router.post('/ai/explain-to-patient', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are a patient education AI. Write a plain-language explanation of this allergy for a patient with no medical background.

Allergen: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Reaction: ${allergy.reaction}
Severity: ${allergy.severity}

Write in plain English at a 6th-grade reading level. Include:
1. What the allergy is (in simple terms)
2. What could happen if exposed
3. What to avoid
4. What to do in an emergency
5. When to seek immediate medical help
6. Questions to ask their doctor

Keep it reassuring, clear, and actionable.`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/allergies/ai/explain-to-patient', allergy.patientId, aiResult.result, aiResult.model);
    res.json({ success: true, explanation: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /ai/validate-reaction-description
router.post('/ai/validate-reaction-description', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are a clinical documentation AI. Validate whether this allergy reaction description is clinically consistent and complete.

Allergen: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Documented Reaction: ${allergy.reaction}
Documented Severity: ${allergy.severity}

Respond ONLY with valid JSON:
{
  "is_valid": <true|false>,
  "consistency_score": <0-100>,
  "issues_found": ["<issue 1>", "<issue 2>"],
  "severity_consistent_with_reaction": <true|false>,
  "suggested_reaction_correction": "<improved description or null>",
  "suggested_severity_correction": "<Mild|Moderate|Severe|Anaphylactic|null>",
  "missing_information": ["<what additional info would help>"],
  "clinical_plausibility": "<plausible|questionable|implausible>",
  "notes": "<any documentation recommendations>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical documentation AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/validate-reaction-description', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, validation: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /ai/reconcile-from-text
router.post('/ai/reconcile-from-text', async (req, res) => {
  try {
    const { patientId, narrativeText } = req.body;
    if (!patientId || !narrativeText) {
      return res.status(400).json({ error: 'patientId and narrativeText are required' });
    }

    const existingAllergies = await Allergy.findAll({ where: { patientId, status: 'Active' } });
    const existingList = existingAllergies.map(a => `${a.allergen} (${a.allergenType}): ${a.reaction}`).join('; ');

    const prompt = `You are a clinical NLP AI. Extract and reconcile allergy information from a clinical narrative, comparing it to the structured allergy list on file.

Narrative Text:
"${narrativeText}"

Current Structured Allergy List on File:
${existingList || 'None documented'}

Respond ONLY with valid JSON:
{
  "extracted_allergies": [
    {
      "allergen": "<name>",
      "allergenType": "<Drug|Food|Environmental|Latex|Other>",
      "reaction": "<reaction>",
      "severity": "<Mild|Moderate|Severe|Anaphylactic>",
      "confidence": "<high|medium|low>"
    }
  ],
  "matches_existing": [{"extracted": "<allergen>", "matched_id": "<id or null>"}],
  "new_allergies_to_add": ["<allergen not in current list>"],
  "discrepancies": ["<conflict between narrative and structured data>"],
  "reconciliation_actions": ["<recommended database action>"],
  "summary": "<brief reconciliation summary>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical NLP AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/reconcile-from-text', patientId, parsed, aiResult.model);
    res.json({ success: true, reconciliation: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /ai/suggest-snomed-code
router.post('/ai/suggest-snomed-code', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are a clinical terminology AI specializing in SNOMED CT. Suggest appropriate SNOMED CT codes for this allergy record.

Allergen: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Reaction: ${allergy.reaction}
Severity: ${allergy.severity}
Current SNOMED Code on File: ${allergy.snomedCode || 'None'}

Respond ONLY with valid JSON:
{
  "primary_snomed_code": "<code>",
  "primary_snomed_description": "<term>",
  "reaction_snomed_code": "<code for the reaction finding>",
  "reaction_snomed_description": "<term>",
  "allergen_substance_code": "<code>",
  "allergen_substance_description": "<term>",
  "alternative_codes": [
    { "code": "<code>", "description": "<term>", "rationale": "<when to use>" }
  ],
  "confidence": "<high|medium|low>",
  "coding_notes": "<any nuances or caveats>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical terminology AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Attempt to update snomedCode on record
    try {
      if (parsed.primary_snomed_code) await allergy.update({ snomedCode: parsed.primary_snomed_code });
    } catch (e) {}

    await persistAiResult(req.user?.id, '/allergies/ai/suggest-snomed-code', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, coding: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /ai/draft-emergency-plan
router.post('/ai/draft-emergency-plan', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    let patient = null;
    try { if (allergy.patientId) patient = await Patient.findByPk(allergy.patientId); } catch (e) {}

    const prompt = `You are an emergency medicine AI. Draft a personalized emergency action plan for a patient with this allergy.

Patient: ${patient ? `${patient.firstName || ''} ${patient.lastName || ''}`.trim() || 'Unknown' : 'Unknown'}
Allergen: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Reaction: ${allergy.reaction}
Severity: ${allergy.severity}

Respond ONLY with valid JSON:
{
  "plan_title": "Emergency Allergy Action Plan",
  "patient_name": "<name>",
  "allergen": "<allergen>",
  "trigger_avoidance": ["<how to avoid exposure>"],
  "early_warning_signs": ["<symptom to watch for>"],
  "mild_reaction_steps": ["<step 1>", "<step 2>"],
  "severe_reaction_steps": ["<step 1 — call 911>", "<step 2 — use epinephrine>"],
  "medications_to_carry": [
    { "medication": "<name>", "dose": "<dose>", "route": "<route>", "when_to_use": "<indication>" }
  ],
  "call_911_if": ["<criterion>"],
  "emergency_contacts": ["<placeholder for patient to fill in>"],
  "plan_expiry_date": "<recommend annual review>",
  "provider_signature_line": "Reviewed and approved by: ____________"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an emergency medicine AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/draft-emergency-plan', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, plan: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /ai/score-clinical-significance
router.post('/ai/score-clinical-significance', async (req, res) => {
  try {
    const { allergyId } = req.body;
    if (!allergyId) return res.status(400).json({ error: 'allergyId is required' });
    const allergy = await Allergy.findByPk(allergyId);
    if (!allergy) return res.status(404).json({ error: 'Allergy not found' });

    const prompt = `You are a clinical pharmacovigilance AI. Score the clinical significance of this documented allergy for an ER setting.

Allergen: ${allergy.allergen}
Allergen Type: ${allergy.allergenType}
Reaction: ${allergy.reaction}
Severity: ${allergy.severity}
Onset Date: ${allergy.onsetDate || 'Unknown'}
Status: ${allergy.status}
Source: ${allergy.source || 'Not specified'}

Respond ONLY with valid JSON:
{
  "clinical_significance_score": <1-10>,
  "significance_tier": "<low|moderate|high|critical>",
  "er_relevance": "<low|moderate|high>",
  "prescribing_impact": "<no restriction|soft alert|hard stop>",
  "factors_increasing_significance": ["<factor>"],
  "factors_decreasing_significance": ["<factor>"],
  "documentation_quality_score": <1-10>,
  "recommended_actions": ["<action>"],
  "reassessment_recommended": <true|false>,
  "reassessment_rationale": "<why or null>",
  "clinical_summary": "<2-3 sentence clinical significance statement>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacovigilance AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/allergies/ai/score-clinical-significance', allergy.patientId, parsed, aiResult.model);
    res.json({ success: true, scoring: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
