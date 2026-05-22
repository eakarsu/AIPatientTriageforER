const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { Encounter, Patient, AuditLog, AiResult } = require('../models');
const { Op } = require('sequelize');
const router = express.Router();

// In-memory rate limiter: max 20 AI calls per hour per user/IP
const encounterRateLimitMap = new Map();
function encounterAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const limit = 20;
  const entry = encounterRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  encounterRateLimitMap.set(key, entry);
  if (entry.count > limit) return res.status(429).json({ error: 'Rate limit exceeded. Max 20 AI calls per hour.' });
  next();
}

function parseAIJson(content) {
  if (!content) return { raw_response: '' };
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) { try { return JSON.parse(codeBlock[1].trim()); } catch (e) {} }
  try { return JSON.parse(content); } catch (e) {}
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) { try { return JSON.parse(jsonMatch[0]); } catch (e) {} }
  return { raw_response: content };
}

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

router.use(auth);

// 1. GET / — list with pagination + optional ?status filter
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const { count, rows } = await Encounter.findAndCountAll({
      where,
      order: [['arrivalTime', 'DESC']],
      limit,
      offset,
      include: [{ model: Patient, attributes: ['id', 'firstName', 'lastName'], required: false }]
    });
    res.json({ data: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. GET /count — count with optional ?status, ?patientId (must be before /:id)
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.patientId) where.patientId = req.query.patientId;
    const count = await Encounter.count({ where });
    res.json({ count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. GET /search — search by ?q in chiefComplaint/visitReason/dispositionCode (must be before /:id)
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { count, rows } = await Encounter.findAndCountAll({
      where: {
        [Op.or]: [
          { chiefComplaint: { [Op.like]: `%${q}%` } },
          { visitReason: { [Op.like]: `%${q}%` } },
          { dispositionCode: { [Op.like]: `%${q}%` } }
        ]
      },
      order: [['arrivalTime', 'DESC']],
      limit,
      offset
    });
    res.json({ data: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. GET /by-patient/:patientId — list encounters by patientId
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { count, rows } = await Encounter.findAndCountAll({
      where: { patientId: req.params.patientId },
      order: [['arrivalTime', 'DESC']],
      limit,
      offset
    });
    res.json({ data: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. GET /by-encounter/:encounterId — single encounter with orders count
router.get('/by-encounter/:encounterId', async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.encounterId);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    res.json({ data: encounter, ordersCount: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. GET /export/csv — CSV of all encounters
router.get('/export/csv', async (req, res) => {
  try {
    const encounters = await Encounter.findAll({ order: [['arrivalTime', 'DESC']] });
    const fields = [
      'id', 'patientId', 'encounterType', 'arrivalTime', 'dischargeTime',
      'chiefComplaint', 'providerId', 'facility', 'location', 'status',
      'dispositionCode', 'visitReason', 'cptCodes', 'icd10Codes',
      'totalCharge', 'insuranceClaimId', 'aiSummary', 'createdAt', 'updatedAt'
    ];
    const header = fields.join(',');
    const rows = encounters.map(e => {
      return fields.map(f => {
        const val = e[f] == null ? '' : String(e[f]).replace(/"/g, '""');
        return `"${val}"`;
      }).join(',');
    });
    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="encounters.csv"');
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. GET /stats/summary — counts by status, encounterType, avg LOS for finished
router.get('/stats/summary', async (req, res) => {
  try {
    const [byStatus, byType, finished] = await Promise.all([
      Encounter.findAll({
        attributes: ['status', [Encounter.sequelize.fn('COUNT', Encounter.sequelize.col('id')), 'count']],
        group: ['status'],
        raw: true
      }),
      Encounter.findAll({
        attributes: ['encounterType', [Encounter.sequelize.fn('COUNT', Encounter.sequelize.col('id')), 'count']],
        group: ['encounterType'],
        raw: true
      }),
      Encounter.findAll({ where: { status: 'Finished', dischargeTime: { [Op.ne]: null } }, raw: true })
    ]);

    let avgLosHours = null;
    if (finished.length > 0) {
      const totalMs = finished.reduce((acc, e) => {
        const arrival = new Date(e.arrivalTime).getTime();
        const discharge = new Date(e.dischargeTime).getTime();
        return acc + (discharge - arrival);
      }, 0);
      avgLosHours = Math.round((totalMs / finished.length) / (1000 * 60 * 60) * 10) / 10;
    }

    res.json({ byStatus, byType, avgLosHours, finishedCount: finished.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. POST /batch — batch create
router.post('/batch', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array required' });
    const created = await Encounter.bulkCreate(items, { validate: true });
    res.status(201).json({ data: created, count: created.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. PUT /batch — batch update
router.put('/batch', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array required' });
    const results = await Promise.all(items.map(async ({ id, ...fields }) => {
      if (!id) return { error: 'missing id', item: { id } };
      const enc = await Encounter.findByPk(id);
      if (!enc) return { error: 'not found', item: { id } };
      await enc.update(fields);
      return enc;
    }));
    res.json({ data: results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 10. DELETE /batch — batch soft-delete
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const [count] = await Encounter.update({ status: 'Cancelled' }, { where: { id: { [Op.in]: ids } } });
    res.json({ updated: count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 11. POST /import/csv — parse CSV body and bulk-create encounters
router.post('/import/csv', async (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: 'csv field required' });
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + at least one row' });
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const items = lines.slice(1).map(line => {
      const values = line.match(/(".*?"|[^,]+)/g) || [];
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] ? values[i].replace(/^"|"$/g, '').replace(/""/g, '"') : null;
      });
      return obj;
    });
    const created = await Encounter.bulkCreate(items, { validate: true, ignoreDuplicates: true });
    res.status(201).json({ data: created, count: created.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 12. GET /:id — get by id, write AuditLog
router.get('/:id', async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.id, {
      include: [{ model: Patient, attributes: ['id', 'firstName', 'lastName'], required: false }]
    });
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    try {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'view_encounter',
        patientId: encounter.patientId || null,
        details: JSON.stringify({ encounterId: encounter.id })
      });
    } catch (e) { console.error('AuditLog write failed:', e.message); }
    res.json({ data: encounter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 13. POST / — create encounter
router.post('/', async (req, res) => {
  try {
    const encounter = await Encounter.create(req.body);
    res.status(201).json({ data: encounter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 14. PUT /:id — update encounter
router.put('/:id', async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    await encounter.update(req.body);
    res.json({ data: encounter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 15. DELETE /:id — soft-delete (status='Cancelled')
router.delete('/:id', async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    await encounter.update({ status: 'Cancelled' });
    res.json({ data: encounter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 16. POST /:id/archive — set status='Cancelled'
router.post('/:id/archive', async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    await encounter.update({ status: 'Cancelled' });
    res.json({ data: encounter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 17. POST /:id/restore — set status='InProgress'
router.post('/:id/restore', async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    await encounter.update({ status: 'InProgress' });
    res.json({ data: encounter });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 18. GET /:id/history — AuditLog entries where patientId = encounter.patientId AND action contains 'encounter'
router.get('/:id/history', async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    const logs = await AuditLog.findAll({
      where: {
        patientId: encounter.patientId,
        action: { [Op.like]: '%encounter%' }
      },
      order: [['createdAt', 'DESC']]
    });
    res.json({ data: logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── AI verbs ─────────────────────────────────────────────────────────────────

// Helper: load encounter or fail fast
async function loadEncounter(encounterId, res) {
  if (!encounterId) { res.status(400).json({ error: 'encounterId required' }); return null; }
  const enc = await Encounter.findByPk(encounterId);
  if (!enc) { res.status(404).json({ error: 'Encounter not found' }); return null; }
  return enc;
}

// AI: summarize-encounter
router.post('/ai/summarize-encounter', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Summarize this ER encounter in clear clinical language.
Encounter: ${JSON.stringify(enc)}
Provide: chief complaint, clinical course, interventions, outcome, and follow-up needs.
Respond with a JSON object: { "summary": "...", "key_points": [...] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await enc.update({ aiSummary: typeof parsed.summary === 'string' ? parsed.summary : aiResult.result });
    await persistAiResult(req.user?.id, '/ai/summarize-encounter', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: classify-visit-type
router.post('/ai/classify-visit-type', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Classify the visit type for this encounter.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
Current type: ${enc.encounterType}
Respond with JSON: { "recommended_type": "Emergency|Inpatient|Outpatient|Observation|Telehealth", "confidence": "high|medium|low", "rationale": "..." }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/classify-visit-type', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: suggest-cpt-codes
router.post('/ai/suggest-cpt-codes', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Suggest appropriate CPT codes for this encounter.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
Encounter type: ${enc.encounterType}
Existing CPT codes: ${enc.cptCodes || 'none'}
Respond with JSON: { "suggested_cpt_codes": [{ "code": "...", "description": "...", "rationale": "..." }] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/suggest-cpt-codes', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: suggest-icd10-codes
router.post('/ai/suggest-icd10-codes', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Suggest ICD-10 diagnosis codes for this encounter.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
Disposition: ${enc.dispositionCode || 'unknown'}
Existing ICD-10: ${enc.icd10Codes || 'none'}
Respond with JSON: { "suggested_icd10_codes": [{ "code": "...", "description": "...", "primary": true|false }] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/suggest-icd10-codes', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: predict-readmission
router.post('/ai/predict-readmission', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Predict 30-day readmission risk for this patient encounter.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
Encounter type: ${enc.encounterType}
Disposition: ${enc.dispositionCode || 'unknown'}
Respond with JSON: { "risk_score": 0-100, "risk_tier": "low|moderate|high", "key_drivers": [...], "recommended_interventions": [...] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/predict-readmission', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: generate-discharge-summary
router.post('/ai/generate-discharge-summary', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Generate a complete discharge summary for this encounter.
Encounter: ${JSON.stringify(enc)}
Provide: admission reason, hospital course, discharge condition, medications, follow-up, return precautions.
Respond with JSON: { "discharge_summary": "...", "medications": [...], "follow_up": [...], "return_precautions": [...] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/generate-discharge-summary', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: extract-chief-complaint-keywords
router.post('/ai/extract-chief-complaint-keywords', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Extract structured clinical keywords from this chief complaint and visit reason.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
Respond with JSON: { "keywords": [...], "symptom_clusters": [...], "body_systems": [...], "urgency_signals": [...] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/extract-chief-complaint-keywords', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: predict-disposition
router.post('/ai/predict-disposition', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Predict the most likely patient disposition for this encounter.
Chief complaint: ${enc.chiefComplaint}
Encounter type: ${enc.encounterType}
Current status: ${enc.status}
Respond with JSON: { "predicted_disposition": "...", "confidence": "high|medium|low", "alternatives": [...], "rationale": "..." }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/predict-disposition', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: estimate-charge
router.post('/ai/estimate-charge', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Estimate the expected charge for this encounter.
Encounter type: ${enc.encounterType}
Chief complaint: ${enc.chiefComplaint}
CPT codes: ${enc.cptCodes || 'not yet assigned'}
ICD-10 codes: ${enc.icd10Codes || 'not yet assigned'}
Facility: ${enc.facility || 'unknown'}
Respond with JSON: { "estimated_charge_usd": number, "range_low": number, "range_high": number, "charge_drivers": [...], "caveats": "..." }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/estimate-charge', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: suggest-followup
router.post('/ai/suggest-followup', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Suggest follow-up care plan for this patient after discharge.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
Disposition: ${enc.dispositionCode || 'unknown'}
Respond with JSON: { "followup_appointments": [...], "timeframes": [...], "specialists": [...], "patient_instructions": [...] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/suggest-followup', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: detect-coding-gaps
router.post('/ai/detect-coding-gaps', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Identify coding gaps and undercoded conditions in this encounter.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
Current CPT codes: ${enc.cptCodes || 'none'}
Current ICD-10 codes: ${enc.icd10Codes || 'none'}
Respond with JSON: { "missing_cpt_codes": [...], "missing_icd10_codes": [...], "documentation_gaps": [...], "revenue_impact": "..." }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/detect-coding-gaps', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: generate-soap-skeleton
router.post('/ai/generate-soap-skeleton', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Generate a SOAP note skeleton for this encounter.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
Encounter type: ${enc.encounterType}
Respond with JSON: { "subjective": "...", "objective": "...", "assessment": "...", "plan": "..." }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/generate-soap-skeleton', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: identify-quality-measures
router.post('/ai/identify-quality-measures', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Identify applicable quality measures for this encounter (CMS, TJC, HEDIS, etc.).
Chief complaint: ${enc.chiefComplaint}
ICD-10 codes: ${enc.icd10Codes || 'not assigned'}
CPT codes: ${enc.cptCodes || 'not assigned'}
Encounter type: ${enc.encounterType}
Respond with JSON: { "applicable_measures": [{ "measure_id": "...", "name": "...", "met": true|false|"unknown", "action_needed": "..." }] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/identify-quality-measures', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: flag-documentation-deficiencies
router.post('/ai/flag-documentation-deficiencies', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Flag documentation deficiencies that could affect billing or compliance.
Encounter: ${JSON.stringify(enc)}
Respond with JSON: { "deficiencies": [{ "field": "...", "issue": "...", "severity": "low|moderate|high", "recommendation": "..." }], "overall_completeness_score": 0-100 }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/flag-documentation-deficiencies', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: suggest-cdi-queries
router.post('/ai/suggest-cdi-queries', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Suggest Clinical Documentation Improvement (CDI) queries for this encounter.
Chief complaint: ${enc.chiefComplaint}
Visit reason: ${enc.visitReason}
ICD-10 codes: ${enc.icd10Codes || 'none'}
CPT codes: ${enc.cptCodes || 'none'}
Respond with JSON: { "cdi_queries": [{ "query": "...", "rationale": "...", "expected_impact": "...", "urgency": "routine|urgent" }] }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/suggest-cdi-queries', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI: generate-handoff-note
router.post('/ai/generate-handoff-note', encounterAiRateLimit, async (req, res) => {
  try {
    const enc = await loadEncounter(req.body.encounterId, res);
    if (!enc) return;
    const prompt = `Generate a structured provider handoff note (I-PASS or SBAR format) for this encounter.
Encounter: ${JSON.stringify(enc)}
Provide: illness severity, patient summary, action list, situation awareness, synthesis by receiver.
Respond with JSON: { "handoff_format": "I-PASS", "illness_severity": "...", "patient_summary": "...", "action_list": [...], "situation_awareness": "...", "synthesis": "..." }`;
    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/generate-handoff-note', enc.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
