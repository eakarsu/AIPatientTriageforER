const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { Prescription, Encounter, Patient, AuditLog, AiResult } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// ── In-memory rate limiter for eRx AI endpoints ───────────────────────────────
// Max 20 AI calls per hour per user/IP
const rxRateLimitMap = new Map();
function rxAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const limit = 20;

  const entry = rxRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  rxRateLimitMap.set(key, entry);

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

// ── Persist AI result to ai_results table ────────────────────────────────────
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

// ── Apply auth to all routes ──────────────────────────────────────────────────
router.use(auth);

// =============================================================================
// CRUD ENDPOINTS (18)
// =============================================================================

// 1. GET / — paginated list with optional ?status and ?isControlled filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.isControlled !== undefined) {
      where.isControlled = req.query.isControlled === 'true';
    }

    const { count, rows } = await Prescription.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /count — count with optional ?status and ?isControlled filters
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.isControlled !== undefined) {
      where.isControlled = req.query.isControlled === 'true';
    }
    const count = await Prescription.count({ where });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /search — ?q searches drugName and patientInstructions
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await Prescription.findAndCountAll({
      where: {
        [Op.or]: [
          { drugName: { [Op.like]: `%${q}%` } },
          { patientInstructions: { [Op.like]: `%${q}%` } }
        ]
      },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /stats/summary — counts by status, % controlled, top 10 drugs
router.get('/stats/summary', async (req, res) => {
  try {
    const [all, controlled] = await Promise.all([
      Prescription.findAll({ attributes: ['status', 'drugName', 'isControlled'] }),
      Prescription.count({ where: { isControlled: true } })
    ]);

    const total = all.length;

    // Counts by status
    const byStatus = {};
    all.forEach(p => {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    });

    // % controlled
    const percentControlled = total > 0 ? ((controlled / total) * 100).toFixed(2) : '0.00';

    // Top 10 drugs by frequency
    const drugCounts = {};
    all.forEach(p => {
      if (p.drugName) drugCounts[p.drugName] = (drugCounts[p.drugName] || 0) + 1;
    });
    const topDrugs = Object.entries(drugCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([drugName, count]) => ({ drugName, count }));

    res.json({
      total,
      byStatus,
      controlled,
      percentControlled: parseFloat(percentControlled),
      topDrugs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. GET /export/csv — export all prescriptions as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const prescriptions = await Prescription.findAll({
      order: [['createdAt', 'DESC']]
    });

    const fields = [
      'id', 'patientId', 'encounterId', 'providerId', 'drugName', 'ndcCode',
      'rxnormCode', 'dose', 'doseUnit', 'route', 'frequency', 'duration',
      'quantity', 'refills', 'dispenseAsWritten', 'pharmacyId', 'status',
      'signedAt', 'transmittedAt', 'isControlled', 'deaSchedule',
      'patientInstructions', 'createdAt', 'updatedAt'
    ];

    const header = fields.join(',');
    const rows = prescriptions.map(p => {
      return fields.map(f => {
        const val = p[f] === null || p[f] === undefined ? '' : String(p[f]);
        return `"${val.replace(/"/g, '""')}"`;
      }).join(',');
    });

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="prescriptions.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /import/csv — import prescriptions from CSV body (text/plain or JSON array)
router.post('/import/csv', async (req, res) => {
  try {
    // Accept JSON array of prescription objects in req.body.records
    const records = req.body.records;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required' });
    }

    const created = [];
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      try {
        const rx = await Prescription.create({
          ...records[i],
          status: records[i].status || 'Draft',
          providerId: records[i].providerId || req.user.id
        });
        created.push(rx.id);
      } catch (e) {
        errors.push({ index: i, error: e.message });
      }
    }

    res.status(201).json({ imported: created.length, created, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /by-patient/:patientId — all prescriptions for a patient
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const prescriptions = await Prescription.findAll({
      where: { patientId: req.params.patientId },
      order: [['createdAt', 'DESC']]
    });
    res.json({ data: prescriptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. GET /by-encounter/:encounterId — all prescriptions for an encounter
router.get('/by-encounter/:encounterId', async (req, res) => {
  try {
    const prescriptions = await Prescription.findAll({
      where: { encounterId: req.params.encounterId },
      order: [['createdAt', 'DESC']]
    });
    res.json({ data: prescriptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /batch — create multiple prescriptions
router.post('/batch', async (req, res) => {
  try {
    const records = req.body.records;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'records array is required' });
    }

    const created = [];
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      try {
        const rx = await Prescription.create({
          ...records[i],
          status: 'Draft',
          providerId: records[i].providerId || req.user.id
        });
        created.push(rx);
      } catch (e) {
        errors.push({ index: i, error: e.message });
      }
    }

    res.status(201).json({ created: created.length, data: created, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. PUT /batch — update multiple prescriptions (only Draft ones)
router.put('/batch', async (req, res) => {
  try {
    const updates = req.body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates array [{id, ...fields}] is required' });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < updates.length; i++) {
      const { id, ...fields } = updates[i];
      if (!id) { errors.push({ index: i, error: 'id is required' }); continue; }
      try {
        const rx = await Prescription.findByPk(id);
        if (!rx) { errors.push({ index: i, id, error: 'Not found' }); continue; }
        if (rx.status !== 'Draft') {
          errors.push({ index: i, id, error: 'Only Draft prescriptions can be updated' });
          continue;
        }
        await rx.update(fields);
        results.push(rx);
      } catch (e) {
        errors.push({ index: i, id, error: e.message });
      }
    }

    res.json({ updated: results.length, data: results, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. DELETE /batch — soft-delete (Cancelled) multiple prescriptions
router.delete('/batch', async (req, res) => {
  try {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const cancelled = [];
    const errors = [];

    for (const id of ids) {
      try {
        const rx = await Prescription.findByPk(id);
        if (!rx) { errors.push({ id, error: 'Not found' }); continue; }
        await rx.update({ status: 'Cancelled' });
        cancelled.push(id);
      } catch (e) {
        errors.push({ id, error: e.message });
      }
    }

    res.json({ cancelled: cancelled.length, ids: cancelled, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Parameterised single-record routes (must come after named paths) ──────────

// 12. GET /:id — fetch one prescription, log audit
router.get('/:id', async (req, res) => {
  try {
    const rx = await Prescription.findByPk(req.params.id);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });

    // Audit log
    try {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'view_prescription',
        resourceType: 'Prescription',
        resourceId: rx.id,
        details: JSON.stringify({ prescriptionId: rx.id, patientId: rx.patientId })
      });
    } catch (e) {
      console.error('AuditLog write failed:', e.message);
    }

    res.json({ data: rx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST / — create prescription (status=Draft)
router.post('/', async (req, res) => {
  try {
    const rx = await Prescription.create({
      ...req.body,
      status: 'Draft',
      providerId: req.body.providerId || req.user.id
    });
    res.status(201).json({ data: rx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. PUT /:id — update (only if Draft)
router.put('/:id', async (req, res) => {
  try {
    const rx = await Prescription.findByPk(req.params.id);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });
    if (rx.status !== 'Draft') {
      return res.status(400).json({ error: 'Only Draft prescriptions can be updated' });
    }
    await rx.update(req.body);
    res.json({ data: rx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. DELETE /:id — soft-delete via status='Cancelled'
router.delete('/:id', async (req, res) => {
  try {
    const rx = await Prescription.findByPk(req.params.id);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });
    await rx.update({ status: 'Cancelled' });
    res.json({ success: true, id: rx.id, status: rx.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /:id/sign — set status=Signed, signedAt=now, providerId=req.user.id
router.post('/:id/sign', async (req, res) => {
  try {
    const rx = await Prescription.findByPk(req.params.id);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });
    if (!['Draft'].includes(rx.status)) {
      return res.status(400).json({ error: 'Only Draft prescriptions can be signed' });
    }
    await rx.update({
      status: 'Signed',
      signedAt: new Date(),
      providerId: req.user.id
    });
    res.json({ data: rx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. POST /:id/transmit — set status=Transmitted, transmittedAt=now (must be Signed)
router.post('/:id/transmit', async (req, res) => {
  try {
    const rx = await Prescription.findByPk(req.params.id);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });
    if (rx.status !== 'Signed') {
      return res.status(400).json({ error: 'Prescription must be Signed before transmitting' });
    }
    await rx.update({
      status: 'Transmitted',
      transmittedAt: new Date()
    });
    res.json({ data: rx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. GET /:id/history — audit log entries for this prescription
router.get('/:id/history', async (req, res) => {
  try {
    const rx = await Prescription.findByPk(req.params.id);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });

    let history = [];
    try {
      history = await AuditLog.findAll({
        where: { resourceType: 'Prescription', resourceId: req.params.id },
        order: [['createdAt', 'DESC']]
      });
    } catch (e) {
      console.error('AuditLog query failed:', e.message);
    }

    res.json({ data: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// AI ENDPOINTS (16) — POST /ai/<verb>
// All protected by auth (inherited) + rxAiRateLimit
// =============================================================================

// AI 1: check-drug-interactions
router.post('/ai/check-drug-interactions', rxAiRateLimit, async (req, res) => {
  try {
    const { patientId, candidateDrugName } = req.body;
    if (!candidateDrugName) return res.status(400).json({ error: 'candidateDrugName is required' });

    // Fetch active prescriptions for the patient as context
    let activeMeds = [];
    if (patientId) {
      try {
        activeMeds = await Prescription.findAll({
          where: { patientId, status: { [Op.in]: ['Signed', 'Transmitted', 'Filled'] } },
          attributes: ['drugName', 'dose', 'doseUnit', 'route', 'frequency']
        });
      } catch (e) {}
    }

    const medList = activeMeds.map(m => `${m.drugName} ${m.dose || ''}${m.doseUnit || ''} ${m.route || ''}`).join('; ') || 'None on record';

    const prompt = `You are a clinical pharmacist AI. Check for drug interactions between the candidate drug and the patient's current medications.

Candidate Drug: ${candidateDrugName}
Patient's Active Medications: ${medList}
${patientId ? `Patient ID: ${patientId}` : ''}

Respond ONLY with valid JSON:
{
  "candidate_drug": "${candidateDrugName}",
  "interactions_found": <true|false>,
  "overall_risk": "<none|minor|moderate|major|contraindicated>",
  "interactions": [
    {
      "interacting_drug": "<name>",
      "severity": "<minor|moderate|major|contraindicated>",
      "mechanism": "<pharmacokinetic or pharmacodynamic>",
      "clinical_effect": "<what happens>",
      "management": "<what to do>",
      "evidence_level": "<A|B|C>"
    }
  ],
  "clinical_summary": "<brief narrative>",
  "recommendation": "<proceed|proceed-with-caution|avoid|contraindicated>",
  "monitoring_parameters": ["<parameter>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/check-drug-interactions', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 2: suggest-dose
router.post('/ai/suggest-dose', rxAiRateLimit, async (req, res) => {
  try {
    const { drugName, patientId } = req.body;
    if (!drugName) return res.status(400).json({ error: 'drugName is required' });

    let patientCtx = '';
    if (patientId) {
      try {
        const patient = await Patient.findByPk(patientId);
        if (patient) {
          patientCtx = `Patient age: ${patient.age || 'unknown'}, weight: ${patient.weight || 'unknown'} kg, allergies: ${patient.allergies || 'NKDA'}, conditions: ${patient.conditions || 'none listed'}`;
        }
      } catch (e) {}
    }

    const prompt = `You are an expert clinical pharmacist. Recommend an appropriate dose for the following drug in an ER context.

Drug: ${drugName}
${patientCtx ? `Patient context: ${patientCtx}` : 'No patient context provided'}

Respond ONLY with valid JSON:
{
  "drug": "${drugName}",
  "recommended_dose": "<dose with units>",
  "dose_range": "<min-max>",
  "route_options": ["<route>"],
  "frequency": "<frequency>",
  "duration": "<typical duration>",
  "loading_dose": "<if applicable, else null>",
  "max_daily_dose": "<max>",
  "renal_adjustment_needed": <true|false>,
  "hepatic_adjustment_needed": <true|false>,
  "pediatric_note": "<if applicable>",
  "geriatric_note": "<if applicable>",
  "rationale": "<brief explanation>",
  "evidence_level": "<A|B|C>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/suggest-dose', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 3: generate-patient-instructions
router.post('/ai/generate-patient-instructions', rxAiRateLimit, async (req, res) => {
  try {
    const { prescriptionId } = req.body;
    if (!prescriptionId) return res.status(400).json({ error: 'prescriptionId is required' });

    const rx = await Prescription.findByPk(prescriptionId);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });

    const prompt = `You are a patient education specialist pharmacist. Write clear, plain-language patient instructions for the following prescription.

Drug: ${rx.drugName}
Dose: ${rx.dose || ''} ${rx.doseUnit || ''}
Route: ${rx.route || ''}
Frequency: ${rx.frequency || ''}
Duration: ${rx.duration || ''}
Quantity: ${rx.quantity || ''}
Refills: ${rx.refills || 0}
Provider instructions: ${rx.patientInstructions || 'None'}
Controlled substance: ${rx.isControlled ? 'Yes' : 'No'}
${rx.deaSchedule ? `DEA Schedule: ${rx.deaSchedule}` : ''}

Respond ONLY with valid JSON:
{
  "instructions_plain": "<plain English paragraph for patient>",
  "how_to_take": "<step-by-step>",
  "what_it_is_for": "<indication in lay terms>",
  "timing": "<when to take relative to meals/time of day>",
  "missed_dose": "<what to do>",
  "storage": "<storage instructions>",
  "side_effects_to_watch": ["<common side effect>"],
  "when_to_call_doctor": ["<warning sign>"],
  "when_to_go_to_er": ["<emergency sign>"],
  "do_not": ["<important restriction>"],
  "refill_info": "<refill instructions>",
  "controlled_substance_warnings": "<if applicable, else null>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a patient education pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Persist instructions back to the prescription record
    try {
      await rx.update({ patientInstructions: parsed.instructions_plain || rx.patientInstructions });
    } catch (e) {
      console.error('Failed to update patientInstructions:', e.message);
    }

    await persistAiResult(req.user?.id, '/ai/erx/generate-patient-instructions', rx.patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 4: check-formulary
router.post('/ai/check-formulary', rxAiRateLimit, async (req, res) => {
  try {
    const { drugName, insurancePlan } = req.body;
    if (!drugName) return res.status(400).json({ error: 'drugName is required' });

    const prompt = `You are a pharmacy benefits management AI. Check formulary status for the following drug.

Drug: ${drugName}
Insurance Plan: ${insurancePlan || 'Generic commercial insurance'}

Respond ONLY with valid JSON:
{
  "drug": "${drugName}",
  "plan": "${insurancePlan || 'Generic commercial insurance'}",
  "formulary_status": "<covered|not-covered|prior-auth-required|step-therapy-required|quantity-limit>",
  "tier": "<1|2|3|4|specialty|not-on-formulary>",
  "estimated_copay": "<string or null>",
  "prior_auth_required": <true|false>,
  "prior_auth_criteria": "<criteria or null>",
  "step_therapy_required": <true|false>,
  "step_therapy_drugs": ["<drug>"],
  "quantity_limits": "<limit or null>",
  "preferred_alternatives": ["<alternative drug>"],
  "generic_available": <true|false>,
  "generic_name": "<generic or null>",
  "estimated_days_supply_coverage": "<string>",
  "notes": "<additional coverage notes>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a pharmacy benefits AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/check-formulary', null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 5: suggest-alternatives
router.post('/ai/suggest-alternatives', rxAiRateLimit, async (req, res) => {
  try {
    const { drugName, reason } = req.body;
    if (!drugName) return res.status(400).json({ error: 'drugName is required' });

    const prompt = `You are a clinical pharmacist AI. Suggest therapeutic alternatives for the following drug.

Drug: ${drugName}
Reason for seeking alternative: ${reason || 'Not specified'}

Respond ONLY with valid JSON:
{
  "original_drug": "${drugName}",
  "reason": "${reason || 'Not specified'}",
  "alternatives": [
    {
      "name": "<drug name>",
      "generic_name": "<generic>",
      "drug_class": "<class>",
      "mechanism": "<mechanism>",
      "relative_efficacy": "<similar|superior|inferior>",
      "relative_safety": "<similar|better|worse>",
      "formulary_advantage": <true|false>,
      "typical_dose": "<dose>",
      "key_differences": "<brief comparison>",
      "recommended_for": "<patient profile best suited>"
    }
  ],
  "top_recommendation": "<name of best alternative>",
  "rationale": "<why top recommendation is preferred>",
  "clinical_notes": "<important switching considerations>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/suggest-alternatives', null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 6: calculate-pediatric-dose
router.post('/ai/calculate-pediatric-dose', rxAiRateLimit, async (req, res) => {
  try {
    const { drugName, weightKg } = req.body;
    if (!drugName || !weightKg) return res.status(400).json({ error: 'drugName and weightKg are required' });

    const prompt = `You are a pediatric pharmacist AI. Calculate the appropriate pediatric dose for the following drug.

Drug: ${drugName}
Patient Weight: ${weightKg} kg

Respond ONLY with valid JSON:
{
  "drug": "${drugName}",
  "weight_kg": ${weightKg},
  "calculated_dose": "<dose with units>",
  "dose_per_kg": "<mg/kg>",
  "dose_range_per_kg": "<min-max mg/kg>",
  "max_single_dose": "<max dose>",
  "max_daily_dose": "<max daily>",
  "frequency": "<frequency>",
  "route": "<preferred route>",
  "age_restrictions": "<any age restrictions>",
  "weight_based_formula": "<formula used>",
  "rounding_guidance": "<how to round to practical dose>",
  "available_formulations": ["<formulation>"],
  "warnings": ["<pediatric warning>"],
  "monitoring": ["<parameter to monitor>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a pediatric pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/calculate-pediatric-dose', null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 7: calculate-renal-dose
router.post('/ai/calculate-renal-dose', rxAiRateLimit, async (req, res) => {
  try {
    const { drugName, creatinineClearance } = req.body;
    if (!drugName || creatinineClearance === undefined) {
      return res.status(400).json({ error: 'drugName and creatinineClearance (mL/min) are required' });
    }

    const prompt = `You are a clinical pharmacist AI specializing in renal dose adjustments. Calculate the renally-adjusted dose for the following drug.

Drug: ${drugName}
Creatinine Clearance (CrCl): ${creatinineClearance} mL/min

Renal function classification:
- Normal: CrCl ≥ 90 mL/min
- Mild impairment: CrCl 60-89 mL/min
- Moderate impairment: CrCl 30-59 mL/min
- Severe impairment: CrCl 15-29 mL/min
- Kidney failure: CrCl < 15 mL/min or dialysis

Respond ONLY with valid JSON:
{
  "drug": "${drugName}",
  "crcl_ml_min": ${creatinineClearance},
  "renal_function_stage": "<Normal|Mild|Moderate|Severe|Kidney Failure>",
  "adjustment_required": <true|false>,
  "adjusted_dose": "<dose>",
  "adjusted_frequency": "<frequency>",
  "standard_dose": "<standard dose for reference>",
  "dose_reduction_percent": "<percent reduction or null>",
  "avoid_in_renal_failure": <true|false>,
  "dialysis_supplemental_dose": "<dose or null>",
  "monitoring": ["<parameter>"],
  "rationale": "<explanation of adjustment>",
  "reference_source": "<guideline or package insert>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/calculate-renal-dose', null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 8: classify-controlled-status
router.post('/ai/classify-controlled-status', rxAiRateLimit, async (req, res) => {
  try {
    const { drugName } = req.body;
    if (!drugName) return res.status(400).json({ error: 'drugName is required' });

    const prompt = `You are a DEA regulatory pharmacist AI. Classify the controlled substance status of the following drug under US federal law (DEA scheduling).

Drug: ${drugName}

Respond ONLY with valid JSON:
{
  "drug": "${drugName}",
  "is_controlled": <true|false>,
  "dea_schedule": "<Schedule I|II|III|IV|V|Not Scheduled>",
  "schedule_rationale": "<why this schedule>",
  "abuse_potential": "<none|low|moderate|high|very high>",
  "physical_dependence": "<none|low|moderate|high>",
  "psychological_dependence": "<none|low|moderate|high>",
  "accepted_medical_use": <true|false>,
  "prescribing_requirements": ["<requirement>"],
  "state_level_notes": "<common state-level additions or restrictions>",
  "quantity_limits_per_prescription": "<limit or null>",
  "refill_restrictions": "<refill rules>",
  "e_prescribing_required": <true|false>,
  "dea_registration_required": <true|false>
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a DEA regulatory pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/classify-controlled-status', null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 9: predict-adherence
router.post('/ai/predict-adherence', rxAiRateLimit, async (req, res) => {
  try {
    const { prescriptionId, patientId } = req.body;

    let rxCtx = '';
    let patientCtx = '';

    if (prescriptionId) {
      try {
        const rx = await Prescription.findByPk(prescriptionId);
        if (rx) {
          rxCtx = `Drug: ${rx.drugName}, Dose: ${rx.dose} ${rx.doseUnit}, Frequency: ${rx.frequency}, Duration: ${rx.duration}, Refills: ${rx.refills}, Controlled: ${rx.isControlled}`;
        }
      } catch (e) {}
    }

    if (patientId) {
      try {
        const patient = await Patient.findByPk(patientId);
        if (patient) {
          patientCtx = `Age: ${patient.age || 'unknown'}, Insurance: ${patient.insurance || 'unknown'}`;
        }
        // Count past prescriptions filled vs total
        const total = await Prescription.count({ where: { patientId } });
        const filled = await Prescription.count({ where: { patientId, status: 'Filled' } });
        patientCtx += `, Historical fill rate: ${total > 0 ? Math.round((filled / total) * 100) : 'unknown'}%`;
      } catch (e) {}
    }

    const prompt = `You are a medication adherence prediction AI. Predict how likely a patient is to adhere to a prescribed medication regimen.

Prescription context: ${rxCtx || 'Not provided'}
Patient context: ${patientCtx || 'Not provided'}

Respond ONLY with valid JSON:
{
  "adherence_probability_percent": <0-100>,
  "adherence_risk": "<low|moderate|high|very high>",
  "risk_factors": ["<factor contributing to non-adherence>"],
  "protective_factors": ["<factor supporting adherence>"],
  "predicted_days_to_discontinuation": "<estimate or null>",
  "recommended_interventions": [
    {
      "intervention": "<name>",
      "rationale": "<why>",
      "expected_impact": "<% improvement estimate>"
    }
  ],
  "refill_reminder_recommended": <true|false>,
  "pill_organizer_recommended": <true|false>,
  "patient_education_priority": "<low|moderate|high>",
  "follow_up_recommended_days": <number>,
  "notes": "<additional clinical notes>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a medication adherence AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/predict-adherence', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 10: generate-prior-auth
router.post('/ai/generate-prior-auth', rxAiRateLimit, async (req, res) => {
  try {
    const { prescriptionId } = req.body;
    if (!prescriptionId) return res.status(400).json({ error: 'prescriptionId is required' });

    const rx = await Prescription.findByPk(prescriptionId);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });

    let patientCtx = '';
    if (rx.patientId) {
      try {
        const patient = await Patient.findByPk(rx.patientId);
        if (patient) {
          patientCtx = `Name: ${patient.firstName || ''} ${patient.lastName || ''}, DOB: ${patient.dateOfBirth || 'unknown'}, Diagnosis: ${patient.diagnosis || 'not recorded'}, Insurance: ${patient.insurance || 'unknown'}`;
        }
      } catch (e) {}
    }

    const prompt = `You are a medical prior authorization specialist AI. Generate a complete prior authorization letter for the following prescription.

Prescription:
- Drug: ${rx.drugName}
- Dose: ${rx.dose || ''} ${rx.doseUnit || ''}
- Route: ${rx.route || ''}
- Frequency: ${rx.frequency || ''}
- Duration: ${rx.duration || ''}
- NDC: ${rx.ndcCode || 'N/A'}
- RxNorm: ${rx.rxnormCode || 'N/A'}
- Controlled: ${rx.isControlled ? `Yes (Schedule ${rx.deaSchedule})` : 'No'}

Patient: ${patientCtx || 'Not provided'}

Respond ONLY with valid JSON:
{
  "pa_letter": "<full formal prior authorization letter text>",
  "diagnosis_codes_suggested": ["<ICD-10 code>"],
  "medical_necessity_statement": "<clinical justification paragraph>",
  "criteria_met": ["<criterion>"],
  "supporting_documentation_needed": ["<document>"],
  "alternatives_tried": "<list of step-therapy alternatives if applicable>",
  "urgency": "<routine|urgent|emergent>",
  "estimated_approval_likelihood": "<low|moderate|high>",
  "appeal_points_if_denied": ["<point>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a prior authorization specialist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/generate-prior-auth', rx.patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 11: draft-pharmacy-note
router.post('/ai/draft-pharmacy-note', rxAiRateLimit, async (req, res) => {
  try {
    const { prescriptionId, additionalContext } = req.body;
    if (!prescriptionId) return res.status(400).json({ error: 'prescriptionId is required' });

    const rx = await Prescription.findByPk(prescriptionId);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });

    const prompt = `You are a clinical pharmacist AI. Draft a professional pharmacy communication note for the following prescription.

Prescription details:
- Drug: ${rx.drugName}
- Dose: ${rx.dose || ''} ${rx.doseUnit || ''}
- Route: ${rx.route || ''}
- Frequency: ${rx.frequency || ''}
- Duration: ${rx.duration || ''}
- Quantity: ${rx.quantity || ''}
- Refills: ${rx.refills || 0}
- Dispense As Written: ${rx.dispenseAsWritten ? 'Yes' : 'No'}
- Status: ${rx.status}
- Controlled: ${rx.isControlled ? `Yes (DEA Schedule ${rx.deaSchedule})` : 'No'}
- Patient Instructions: ${rx.patientInstructions || 'None'}
${additionalContext ? `Additional context: ${additionalContext}` : ''}

Respond ONLY with valid JSON:
{
  "pharmacy_note": "<complete pharmacy communication note>",
  "dispensing_instructions": "<specific dispensing notes>",
  "substitution_allowed": <true|false>,
  "substitution_note": "<DAW code rationale or null>",
  "controlled_substance_instructions": "<if applicable, else null>",
  "compounding_required": <true|false>,
  "compounding_instructions": "<if applicable, else null>",
  "patient_counseling_points": ["<point>"],
  "follow_up_required": <true|false>,
  "pharmacist_action_items": ["<action>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/draft-pharmacy-note', rx.patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 12: suggest-monitoring
router.post('/ai/suggest-monitoring', rxAiRateLimit, async (req, res) => {
  try {
    const { prescriptionId, drugName, patientId } = req.body;
    if (!drugName && !prescriptionId) {
      return res.status(400).json({ error: 'prescriptionId or drugName is required' });
    }

    let resolvedDrugName = drugName;
    let resolvedPatientId = patientId;

    if (prescriptionId) {
      try {
        const rx = await Prescription.findByPk(prescriptionId);
        if (rx) {
          resolvedDrugName = rx.drugName;
          resolvedPatientId = resolvedPatientId || rx.patientId;
        }
      } catch (e) {}
    }

    const prompt = `You are a clinical pharmacist AI. Recommend a medication monitoring plan for the following drug therapy.

Drug: ${resolvedDrugName}
${resolvedPatientId ? `Patient ID: ${resolvedPatientId}` : ''}

Respond ONLY with valid JSON:
{
  "drug": "${resolvedDrugName}",
  "monitoring_plan": {
    "baseline_labs": ["<lab test before starting>"],
    "ongoing_labs": [
      {
        "test": "<lab name>",
        "frequency": "<how often>",
        "target_range": "<therapeutic range>",
        "rationale": "<why>"
      }
    ],
    "vital_signs": ["<vital sign to monitor>"],
    "clinical_endpoints": ["<symptom or sign to watch>"],
    "toxicity_signs": ["<toxicity marker>"]
  },
  "therapeutic_drug_monitoring": <true|false>,
  "trough_level_target": "<target or null>",
  "peak_level_target": "<target or null>",
  "monitoring_frequency_weeks": <number>,
  "stop_criteria": ["<when to discontinue>"],
  "dose_adjustment_triggers": ["<trigger>"],
  "patient_self_monitoring": ["<what patient should self-monitor>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/suggest-monitoring', resolvedPatientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 13: detect-duplicate-therapy
router.post('/ai/detect-duplicate-therapy', rxAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const activePrescriptions = await Prescription.findAll({
      where: {
        patientId,
        status: { [Op.in]: ['Draft', 'Signed', 'Transmitted', 'Filled'] }
      },
      attributes: ['id', 'drugName', 'dose', 'doseUnit', 'route', 'frequency', 'ndcCode', 'rxnormCode', 'status']
    });

    if (activePrescriptions.length === 0) {
      return res.json({ success: true, analysis: { duplicates_found: false, message: 'No active prescriptions found for patient' } });
    }

    const rxList = activePrescriptions.map(r =>
      `ID:${r.id} | ${r.drugName} | ${r.dose || ''}${r.doseUnit || ''} | ${r.route || ''} | ${r.frequency || ''} | Status:${r.status}`
    ).join('\n');

    const prompt = `You are a clinical pharmacist AI specializing in medication reconciliation. Analyze the following list of active prescriptions for a single patient and identify any duplicate therapy, overlapping drug classes, or redundant medications.

Patient ID: ${patientId}
Active Prescriptions:
${rxList}

Respond ONLY with valid JSON:
{
  "patient_id": "${patientId}",
  "total_prescriptions_reviewed": ${activePrescriptions.length},
  "duplicates_found": <true|false>,
  "duplicate_groups": [
    {
      "drug_class": "<class>",
      "mechanism": "<shared mechanism>",
      "prescriptions_involved": ["<ID and drug name>"],
      "clinical_concern": "<why this is a problem>",
      "recommendation": "<resolve by doing X>",
      "severity": "<low|moderate|high>"
    }
  ],
  "therapeutic_overlaps": [
    {
      "drugs": ["<drug>"],
      "overlap_type": "<class|mechanism|indication>",
      "recommendation": "<action>"
    }
  ],
  "safe_combinations": "<comment on combinations that appear intentional>",
  "overall_recommendation": "<summary action for prescriber>",
  "priority_review_ids": ["<prescription ID needing immediate review>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a medication reconciliation pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/detect-duplicate-therapy', patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 14: score-prescribing-safety
router.post('/ai/score-prescribing-safety', rxAiRateLimit, async (req, res) => {
  try {
    const { prescriptionId, patientId } = req.body;
    if (!prescriptionId && !patientId) {
      return res.status(400).json({ error: 'prescriptionId or patientId is required' });
    }

    let rxData = null;
    let patientData = null;

    if (prescriptionId) {
      try { rxData = await Prescription.findByPk(prescriptionId); } catch (e) {}
    }
    if (patientId || rxData?.patientId) {
      try { patientData = await Patient.findByPk(patientId || rxData?.patientId); } catch (e) {}
    }

    const prompt = `You are a prescribing safety AI auditor. Score the overall safety of this prescription order.

Prescription: ${rxData ? JSON.stringify({ drug: rxData.drugName, dose: rxData.dose, doseUnit: rxData.doseUnit, route: rxData.route, frequency: rxData.frequency, duration: rxData.duration, isControlled: rxData.isControlled, deaSchedule: rxData.deaSchedule }) : 'Not provided'}
Patient: ${patientData ? JSON.stringify({ age: patientData.age, allergies: patientData.allergies, conditions: patientData.conditions, weight: patientData.weight }) : 'Not provided'}

Respond ONLY with valid JSON:
{
  "safety_score": <0-100>,
  "safety_grade": "<A|B|C|D|F>",
  "overall_risk": "<low|moderate|high|critical>",
  "passed_checks": ["<safety check passed>"],
  "failed_checks": [
    {
      "check": "<check name>",
      "finding": "<what was found>",
      "severity": "<warning|error|critical>",
      "action_required": "<what to do>"
    }
  ],
  "five_rights_assessment": {
    "right_patient": "<pass|fail|unable-to-verify>",
    "right_drug": "<pass|fail|caution>",
    "right_dose": "<pass|fail|caution>",
    "right_route": "<pass|fail|caution>",
    "right_time": "<pass|fail|caution>"
  },
  "controlled_substance_compliance": "<pass|fail|not-applicable>",
  "allergy_cleared": "<pass|fail|not-verified>",
  "weight_based_dose_check": "<pass|fail|not-applicable>",
  "renal_hepatic_check": "<pass|fail|not-applicable>",
  "recommendations": ["<action to improve safety score>"],
  "should_proceed": <true|false>
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a prescribing safety AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Optionally store safety warnings back to prescription
    if (rxData && parsed.failed_checks && parsed.failed_checks.length > 0) {
      try {
        await rxData.update({
          aiInteractionWarnings: JSON.stringify(parsed.failed_checks)
        });
      } catch (e) {
        console.error('Failed to persist aiInteractionWarnings:', e.message);
      }
    }

    await persistAiResult(req.user?.id, '/ai/erx/score-prescribing-safety', patientId || rxData?.patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 15: translate-instructions
router.post('/ai/translate-instructions', rxAiRateLimit, async (req, res) => {
  try {
    const { prescriptionId, language } = req.body;
    if (!prescriptionId) return res.status(400).json({ error: 'prescriptionId is required' });
    if (!language) return res.status(400).json({ error: 'language is required (e.g. "Spanish", "Mandarin")' });

    const rx = await Prescription.findByPk(prescriptionId);
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });

    const instructions = rx.patientInstructions || `Take ${rx.drugName} ${rx.dose || ''} ${rx.doseUnit || ''} ${rx.route || ''} ${rx.frequency || ''} for ${rx.duration || 'as directed'}.`;

    const prompt = `You are a multilingual medical translator AI. Translate the following prescription patient instructions into ${language}. Use plain, simple language appropriate for a patient with limited medical literacy.

Original instructions (English):
${instructions}

Drug: ${rx.drugName}
Dose: ${rx.dose || ''} ${rx.doseUnit || ''}
Route: ${rx.route || ''}
Frequency: ${rx.frequency || ''}
Duration: ${rx.duration || ''}

Respond ONLY with valid JSON:
{
  "original_language": "English",
  "target_language": "${language}",
  "translated_instructions": "<full translation in ${language}>",
  "key_phrases_translated": [
    { "english": "<phrase>", "translated": "<phrase in ${language}>" }
  ],
  "cultural_considerations": "<any cultural adaptations made>",
  "back_translation_check": "<brief back-translation to verify accuracy>",
  "reading_level_estimate": "<approximate reading level>",
  "verbal_counseling_notes": "<tips for verbal delivery of these instructions>"
}`;

    const aiResult = await callOpenRouter(prompt, `You are a multilingual medical translator AI. Respond ONLY with valid JSON.`);
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/translate-instructions', rx.patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI 16: suggest-tapering-plan
router.post('/ai/suggest-tapering-plan', rxAiRateLimit, async (req, res) => {
  try {
    const { prescriptionId, drugName, currentDose, doseUnit, reason } = req.body;
    if (!drugName && !prescriptionId) {
      return res.status(400).json({ error: 'prescriptionId or drugName is required' });
    }

    let resolvedDrug = drugName;
    let resolvedDose = currentDose;
    let resolvedUnit = doseUnit;
    let resolvedPatientId = null;

    if (prescriptionId) {
      try {
        const rx = await Prescription.findByPk(prescriptionId);
        if (rx) {
          resolvedDrug = resolvedDrug || rx.drugName;
          resolvedDose = resolvedDose || rx.dose;
          resolvedUnit = resolvedUnit || rx.doseUnit;
          resolvedPatientId = rx.patientId;
        }
      } catch (e) {}
    }

    const prompt = `You are a clinical pharmacist AI specializing in medication tapering. Create a safe and evidence-based tapering plan for the following medication.

Drug: ${resolvedDrug}
Current Dose: ${resolvedDose || 'unknown'} ${resolvedUnit || ''}
Reason for tapering: ${reason || 'Not specified (assume clinical decision to discontinue)'}

Respond ONLY with valid JSON:
{
  "drug": "${resolvedDrug}",
  "tapering_required": <true|false>,
  "tapering_rationale": "<why tapering is needed for this drug>",
  "total_taper_duration_weeks": <number>,
  "taper_schedule": [
    {
      "week": <week_number>,
      "dose": "<dose>",
      "frequency": "<frequency>",
      "notes": "<any notes for this step>"
    }
  ],
  "monitoring_during_taper": ["<parameter>"],
  "withdrawal_symptoms_to_watch": ["<symptom>"],
  "patient_instructions": "<what to tell the patient>",
  "when_to_slow_taper": ["<condition>"],
  "when_to_stop_taper_and_seek_help": ["<red flag>"],
  "emergency_guidance": "<if withdrawal emergency occurs>",
  "evidence_level": "<A|B|C>",
  "clinical_notes": "<additional prescriber notes>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/erx/suggest-tapering-plan', resolvedPatientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
