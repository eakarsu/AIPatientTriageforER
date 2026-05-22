const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { Referral, Patient, AuditLog, AiResult } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// ── Rate limiter (max 20 AI calls per hour per user/IP) ───────────────────────
const referralRateLimitMap = new Map();
function referralAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const limit = 20;

  const entry = referralRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  referralRateLimitMap.set(key, entry);

  if (entry.count > limit) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 20 AI calls per hour.' });
  }
  next();
}

// ── 3-strategy JSON parser ─────────────────────────────────────────────────────
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

// ── Apply auth to all routes ───────────────────────────────────────────────────
router.use(auth);

// ════════════════════════════════════════════════════════════════════════════════
// 18 CRUD ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════════

// 1. GET / — paginated list with optional ?status and ?urgency filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.urgency) where.urgency = req.query.urgency;

    const { count, rows } = await Referral.findAndCountAll({
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

// 2. GET /:id — single referral + audit log
router.get('/:id', async (req, res) => {
  try {
    const referral = await Referral.findByPk(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    try {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'view_referral',
        resourceType: 'Referral',
        resourceId: req.params.id,
        details: `Viewed referral ${req.params.id}`
      });
    } catch (auditErr) {
      console.error('AuditLog write failed:', auditErr.message);
    }

    res.json(referral);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST / — create referral
router.post('/', async (req, res) => {
  try {
    const {
      patientId, referringProviderId, receivingProviderName, specialistType,
      reason, urgency, status, referralLetter, appointmentDate, inNetwork,
      authorizationNumber, aiRecommendedSpecialist, aiDraftedLetter
    } = req.body;

    const referral = await Referral.create({
      patientId,
      referringProviderId,
      receivingProviderName,
      specialistType,
      reason,
      urgency: urgency || 'Routine',
      status: status || 'Pending',
      referralLetter,
      appointmentDate,
      inNetwork,
      authorizationNumber,
      aiRecommendedSpecialist,
      aiDraftedLetter
    });

    res.status(201).json(referral);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /:id — update referral
router.put('/:id', async (req, res) => {
  try {
    const referral = await Referral.findByPk(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    await referral.update(req.body);
    res.json(referral);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /:id — soft-delete (status='Cancelled')
router.delete('/:id', async (req, res) => {
  try {
    const referral = await Referral.findByPk(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    await referral.update({ status: 'Cancelled' });
    res.json({ success: true, message: 'Referral cancelled', id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /by-patient/:patientId — all referrals for a patient
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const referrals = await Referral.findAll({
      where: { patientId: req.params.patientId },
      order: [['createdAt', 'DESC']]
    });
    res.json(referrals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /by-specialist/:specialistType — all referrals for a specialty
router.get('/by-specialist/:specialistType', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await Referral.findAndCountAll({
      where: { specialistType: req.params.specialistType },
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

// 8. POST /batch — create multiple referrals
router.post('/batch', async (req, res) => {
  try {
    const { referrals } = req.body;
    if (!Array.isArray(referrals) || referrals.length === 0) {
      return res.status(400).json({ error: 'referrals array is required' });
    }

    const created = await Referral.bulkCreate(
      referrals.map(r => ({
        ...r,
        urgency: r.urgency || 'Routine',
        status: r.status || 'Pending'
      })),
      { returning: true }
    );

    res.status(201).json({ success: true, created: created.length, data: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. PUT /batch — update multiple referrals
router.put('/batch', async (req, res) => {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object is required' });
    }

    const [affectedCount] = await Referral.update(updates, {
      where: { id: { [Op.in]: ids } }
    });

    res.json({ success: true, updated: affectedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. DELETE /batch — soft-delete multiple referrals
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const [affectedCount] = await Referral.update(
      { status: 'Cancelled' },
      { where: { id: { [Op.in]: ids } } }
    );

    res.json({ success: true, cancelled: affectedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. GET /count — count with optional ?status, ?urgency, ?inNetwork filters
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.urgency) where.urgency = req.query.urgency;
    if (req.query.inNetwork !== undefined) {
      where.inNetwork = req.query.inNetwork === 'true';
    }

    const count = await Referral.count({ where });
    res.json({ count, filters: { status: req.query.status, urgency: req.query.urgency, inNetwork: req.query.inNetwork } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET /search — ?q in reason/specialistType/receivingProviderName
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'q query parameter is required' });

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await Referral.findAndCountAll({
      where: {
        [Op.or]: [
          { reason: { [Op.like]: `%${q}%` } },
          { specialistType: { [Op.like]: `%${q}%` } },
          { receivingProviderName: { [Op.like]: `%${q}%` } }
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

// 13. POST /:id/archive — set status to 'Cancelled'
router.post('/:id/archive', async (req, res) => {
  try {
    const referral = await Referral.findByPk(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    await referral.update({ status: 'Cancelled' });
    res.json({ success: true, message: 'Referral archived', referral });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /:id/restore — set status back to 'Pending'
router.post('/:id/restore', async (req, res) => {
  try {
    const referral = await Referral.findByPk(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    await referral.update({ status: 'Pending' });
    res.json({ success: true, message: 'Referral restored to Pending', referral });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. GET /:id/history — audit log history for a referral
router.get('/:id/history', async (req, res) => {
  try {
    const referral = await Referral.findByPk(req.params.id);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    let history = [];
    try {
      history = await AuditLog.findAll({
        where: { resourceType: 'Referral', resourceId: req.params.id },
        order: [['createdAt', 'DESC']],
        limit: 100
      });
    } catch (e) {
      console.error('AuditLog query failed:', e.message);
    }

    res.json({ referralId: req.params.id, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. GET /export/csv — export all referrals as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.urgency) where.urgency = req.query.urgency;

    const referrals = await Referral.findAll({ where, order: [['createdAt', 'DESC']] });

    const headers = [
      'id', 'patientId', 'referringProviderId', 'receivingProviderName',
      'specialistType', 'reason', 'urgency', 'status', 'appointmentDate',
      'inNetwork', 'authorizationNumber', 'createdAt', 'updatedAt'
    ];

    const escape = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
    };

    const csvLines = [
      headers.join(','),
      ...referrals.map(r =>
        headers.map(h => escape(r[h])).join(',')
      )
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="referrals.csv"');
    res.send(csvLines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. POST /import/csv — import referrals from CSV body
router.post('/import/csv', async (req, res) => {
  try {
    const { csvData } = req.body;
    if (!csvData || typeof csvData !== 'string') {
      return res.status(400).json({ error: 'csvData string is required in request body' });
    }

    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const record = {};
      headers.forEach((h, idx) => {
        record[h] = values[idx] || null;
      });
      // Apply defaults
      if (!record.status) record.status = 'Pending';
      if (!record.urgency) record.urgency = 'Routine';
      // Remove read-only fields
      delete record.id;
      delete record.createdAt;
      delete record.updatedAt;
      records.push(record);
    }

    const created = await Referral.bulkCreate(records, { returning: true });
    res.status(201).json({ success: true, imported: created.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. GET /stats/summary — counts by status, by specialistType, in-network %
router.get('/stats/summary', async (req, res) => {
  try {
    const allReferrals = await Referral.findAll({
      attributes: ['status', 'specialistType', 'inNetwork']
    });

    const byStatus = {};
    const bySpecialistType = {};
    let inNetworkCount = 0;
    let outNetworkCount = 0;

    for (const r of allReferrals) {
      // Count by status
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;

      // Count by specialist type
      if (r.specialistType) {
        bySpecialistType[r.specialistType] = (bySpecialistType[r.specialistType] || 0) + 1;
      }

      // Count in-network
      if (r.inNetwork === true) inNetworkCount++;
      else outNetworkCount++;
    }

    const total = allReferrals.length;
    const inNetworkPct = total > 0 ? Math.round((inNetworkCount / total) * 100) : 0;

    res.json({
      total,
      byStatus,
      bySpecialistType,
      network: {
        inNetwork: inNetworkCount,
        outOfNetwork: outNetworkCount,
        inNetworkPercentage: inNetworkPct
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 16 AI VERB ENDPOINTS — POST /ai/<verb>
// All routes: auth (already applied globally) + referralAiRateLimit
// ════════════════════════════════════════════════════════════════════════════════

// 1. POST /ai/suggest-specialist
router.post('/ai/suggest-specialist', referralAiRateLimit, async (req, res) => {
  try {
    const { patientId, reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });

    let patientContext = '';
    if (patientId) {
      try {
        const patient = await Patient.findByPk(patientId);
        if (patient) {
          patientContext = `Patient age: ${patient.age || 'unknown'}, Gender: ${patient.gender || 'unknown'}, ` +
            `Medical history: ${patient.medicalHistory || 'not recorded'}, Allergies: ${patient.allergies || 'NKDA'}`;
        }
      } catch (e) {}
    }

    const prompt = `You are an expert emergency physician. Recommend the most appropriate medical specialist for a referral.

Referral Reason: ${reason}
${patientContext ? `Patient Context: ${patientContext}` : ''}

Provide:
1. **Primary Specialist Recommendation** - specialty and rationale
2. **Alternative Specialists** - in case primary is unavailable
3. **Urgency Level** (Routine/Urgent/Emergent) and justification
4. **Key Information to Include** - what the referring provider should communicate
5. **Expected Outcomes** - what the specialist will likely address
6. **Red Flags** - conditions that would escalate urgency`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    if (patientId) {
      try {
        await Referral.update(
          { aiRecommendedSpecialist: typeof parsed === 'object' ? JSON.stringify(parsed) : aiResult.result },
          { where: { patientId, status: 'Pending' } }
        );
      } catch (e) {}
    }

    await persistAiResult(req.user?.id, '/referrals/ai/suggest-specialist', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /ai/draft-referral-letter
router.post('/ai/draft-referral-letter', referralAiRateLimit, async (req, res) => {
  try {
    const { referralId } = req.body;
    if (!referralId) return res.status(400).json({ error: 'referralId is required' });

    const referral = await Referral.findByPk(referralId);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    let patientInfo = '';
    if (referral.patientId) {
      try {
        const patient = await Patient.findByPk(referral.patientId);
        if (patient) {
          patientInfo = `Patient Name: ${patient.firstName || ''} ${patient.lastName || ''}, ` +
            `DOB: ${patient.dateOfBirth || 'unknown'}, MRN: ${patient.mrn || patient.id}`;
        }
      } catch (e) {}
    }

    const prompt = `You are a medical documentation specialist. Draft a professional referral letter for the following case.

${patientInfo ? `Patient: ${patientInfo}` : `Patient ID: ${referral.patientId}`}
Referring Provider ID: ${referral.referringProviderId}
Receiving Provider: ${referral.receivingProviderName || 'Specialist'}
Specialist Type: ${referral.specialistType}
Reason for Referral: ${referral.reason}
Urgency: ${referral.urgency}
Authorization Number: ${referral.authorizationNumber || 'Pending'}

Draft a formal, professional referral letter that includes:
1. Proper salutation and header
2. Patient identification and clinical context
3. Reason for referral with relevant history
4. Urgency and recommended appointment timeframe
5. Any special instructions or information for the specialist
6. Professional closing`;

    const aiResult = await callOpenRouter(prompt);

    await referral.update({ aiDraftedLetter: aiResult.result });
    await persistAiResult(req.user?.id, '/referrals/ai/draft-referral-letter', referral.patientId || null, aiResult.result, aiResult.model);
    res.json({ success: true, letter: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /ai/check-network-status
router.post('/ai/check-network-status', referralAiRateLimit, async (req, res) => {
  try {
    const { receivingProviderName, insurancePlan } = req.body;
    if (!receivingProviderName || !insurancePlan) {
      return res.status(400).json({ error: 'receivingProviderName and insurancePlan are required' });
    }

    const prompt = `You are a healthcare insurance network analyst. Assess the likely network status of this provider referral.

Receiving Provider / Facility: ${receivingProviderName}
Patient Insurance Plan: ${insurancePlan}

Provide a structured JSON response:
{
  "likely_in_network": <true|false|"unknown">,
  "confidence": "<high|medium|low>",
  "network_tier": "<in-network|out-of-network|unknown>",
  "rationale": "<explanation>",
  "recommended_actions": ["<action>"],
  "pre_auth_likely_required": <true|false>,
  "alternative_in_network_options": ["<provider or facility>"],
  "patient_cost_impact": "<estimated cost difference if out-of-network>",
  "disclaimer": "This is an AI estimate only. Verify with the insurance carrier before proceeding."
}`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/check-network-status', null, parsed, aiResult.model);
    res.json({ success: true, networkStatus: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /ai/classify-urgency
router.post('/ai/classify-urgency', referralAiRateLimit, async (req, res) => {
  try {
    const { reason, patientId, currentDiagnosis, vitalSigns } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });

    const prompt = `You are an emergency medicine physician. Classify the urgency of this specialist referral.

Referral Reason: ${reason}
${currentDiagnosis ? `Current Diagnosis: ${currentDiagnosis}` : ''}
${vitalSigns ? `Vital Signs: ${JSON.stringify(vitalSigns)}` : ''}

Provide:
1. **Urgency Classification** (Routine/Urgent/Emergent) with strict definition
2. **Justification** — clinical reasoning
3. **Recommended Timeframe** — how soon the patient should be seen by the specialist
4. **Risk if Delayed** — consequences of not seeing the specialist within the timeframe
5. **Escalation Criteria** — signs/symptoms that would upgrade urgency`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/classify-urgency', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /ai/predict-wait-time
router.post('/ai/predict-wait-time', referralAiRateLimit, async (req, res) => {
  try {
    const { specialistType, urgency, region, insurancePlan, patientId } = req.body;
    if (!specialistType) return res.status(400).json({ error: 'specialistType is required' });

    const prompt = `You are a healthcare operations analyst. Predict the referral wait time for this specialist appointment.

Specialist Type: ${specialistType}
Referral Urgency: ${urgency || 'Routine'}
Geographic Region: ${region || 'Not specified'}
Insurance Plan: ${insurancePlan || 'Not specified'}

Provide:
1. **Estimated Wait Time** — range in days/weeks
2. **Factors Affecting Wait** — shortage, geography, insurance
3. **Urgency Impact** — how urgency classification affects scheduling
4. **Strategies to Reduce Wait** — escalation paths, alternative specialists
5. **Confidence Level** (high/medium/low)`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/predict-wait-time', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /ai/suggest-questions-to-ask
router.post('/ai/suggest-questions-to-ask', referralAiRateLimit, async (req, res) => {
  try {
    const { specialistType, reason, patientId } = req.body;
    if (!specialistType || !reason) {
      return res.status(400).json({ error: 'specialistType and reason are required' });
    }

    const prompt = `You are an expert patient advocate and clinician. Suggest questions a patient and referring provider should ask when meeting with a specialist.

Specialist Type: ${specialistType}
Referral Reason: ${reason}

Provide:
1. **Questions for the Patient to Ask** — 6-8 patient-friendly questions
2. **Questions for the Referring Provider to Ask** — 4-6 clinical questions
3. **Documentation to Bring** — records, imaging, lab results
4. **What to Expect at the Visit** — appointment overview
5. **Follow-up Actions** — what happens after the specialist visit`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/suggest-questions-to-ask', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /ai/summarize-history-for-specialist
router.post('/ai/summarize-history-for-specialist', referralAiRateLimit, async (req, res) => {
  try {
    const { patientId, specialistType } = req.body;
    if (!patientId || !specialistType) {
      return res.status(400).json({ error: 'patientId and specialistType are required' });
    }

    let patientData = { id: patientId };
    let referrals = [];
    try {
      const patient = await Patient.findByPk(patientId);
      if (patient) patientData = patient.toJSON();
    } catch (e) {}
    try {
      referrals = await Referral.findAll({ where: { patientId }, limit: 20, order: [['createdAt', 'DESC']] });
    } catch (e) {}

    const prompt = `You are a medical records specialist. Create a concise, focused patient history summary tailored for a ${specialistType} specialist.

Patient Data: ${JSON.stringify(patientData)}
Referral History: ${JSON.stringify(referrals)}
Target Specialist: ${specialistType}

Provide a specialist-ready summary including:
1. **Patient Overview** — demographics, relevant background
2. **Chief Reason for Referral** — why the patient needs this specialist
3. **Relevant Medical History** — conditions pertinent to ${specialistType}
4. **Current Medications** — with doses
5. **Relevant Lab/Imaging Results** — most recent pertinent findings
6. **Prior Specialist Visits** — any previous consultations with this specialty
7. **Patient Goals and Concerns**
8. **Referring Provider's Key Questions** — what the specialist needs to address`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/summarize-history-for-specialist', patientId, parsed, aiResult.model);
    res.json({ success: true, summary: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /ai/extract-from-clinical-note
router.post('/ai/extract-from-clinical-note', referralAiRateLimit, async (req, res) => {
  try {
    const { patientId, noteText } = req.body;
    if (!noteText) return res.status(400).json({ error: 'noteText is required' });

    const prompt = `You are a clinical data extraction AI. Extract referral-relevant information from the following clinical note.

Clinical Note:
${noteText}

Extract and return structured JSON:
{
  "recommended_specialist": "<specialty or null>",
  "urgency": "<Routine|Urgent|Emergent|null>",
  "reason_for_referral": "<extracted reason>",
  "relevant_diagnoses": ["<diagnosis>"],
  "relevant_medications": ["<medication>"],
  "relevant_lab_results": ["<result>"],
  "relevant_imaging": ["<finding>"],
  "patient_concerns": ["<concern>"],
  "provider_questions_for_specialist": ["<question>"],
  "additional_notes": "<any other referral-relevant information>"
}`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/extract-from-clinical-note', patientId || null, parsed, aiResult.model);
    res.json({ success: true, extracted: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /ai/generate-pre-auth-justification
router.post('/ai/generate-pre-auth-justification', referralAiRateLimit, async (req, res) => {
  try {
    const { referralId, patientId, specialistType, reason, diagnosis, urgency } = req.body;

    let referralData = { specialistType, reason, diagnosis, urgency };
    if (referralId) {
      try {
        const referral = await Referral.findByPk(referralId);
        if (referral) referralData = { ...referralData, ...referral.toJSON() };
      } catch (e) {}
    }

    const prompt = `You are a healthcare prior authorization specialist. Write a compelling pre-authorization justification letter for this specialist referral.

Specialist Type: ${referralData.specialistType || 'Specialist'}
Reason for Referral: ${referralData.reason || 'See clinical notes'}
Primary Diagnosis: ${referralData.diagnosis || 'Not specified'}
Urgency: ${referralData.urgency || 'Routine'}

Write a formal pre-authorization justification that includes:
1. **Medical Necessity Statement** — clear clinical justification
2. **Relevant Diagnosis Codes** — ICD-10 codes if applicable
3. **Clinical Evidence** — supporting guidelines or standards of care
4. **Conservative Treatments Tried** — documenting prior management
5. **Expected Outcomes** — anticipated benefit of the referral
6. **Risk of Non-Authorization** — consequences if denied
7. **Supporting Documentation List** — what records are attached`;

    const aiResult = await callOpenRouter(prompt);

    await persistAiResult(req.user?.id, '/referrals/ai/generate-pre-auth-justification', patientId || null, aiResult.result, aiResult.model);
    res.json({ success: true, justification: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST /ai/identify-required-records
router.post('/ai/identify-required-records', referralAiRateLimit, async (req, res) => {
  try {
    const { specialistType, reason, patientId } = req.body;
    if (!specialistType) return res.status(400).json({ error: 'specialistType is required' });

    const prompt = `You are a medical records coordinator. Identify the records and documentation required for a referral to a ${specialistType}.

Specialist Type: ${specialistType}
Referral Reason: ${reason || 'Not specified'}

Provide a structured list:
1. **Required Records** — must-have documents for the referral
2. **Recommended Records** — helpful but not mandatory
3. **Lab Results Needed** — specific tests and timeframe
4. **Imaging Required** — X-rays, MRI, CT, ultrasound, etc.
5. **Specialist-Specific Forms** — intake forms or questionnaires
6. **Insurance Documents** — authorization, insurance cards
7. **Timeline** — how far back records should go`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/identify-required-records', patientId || null, parsed, aiResult.model);
    res.json({ success: true, records: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST /ai/draft-patient-instructions
router.post('/ai/draft-patient-instructions', referralAiRateLimit, async (req, res) => {
  try {
    const { referralId, patientId, specialistType, reason, appointmentDate } = req.body;

    let refData = { specialistType, reason, appointmentDate };
    if (referralId) {
      try {
        const referral = await Referral.findByPk(referralId);
        if (referral) refData = { ...refData, ...referral.toJSON() };
      } catch (e) {}
    }

    const prompt = `You are a patient education specialist. Write clear, patient-friendly instructions for their upcoming specialist referral.

Specialist Type: ${refData.specialistType || 'Specialist'}
Reason for Referral: ${refData.reason || 'See your provider for details'}
${refData.appointmentDate ? `Appointment Date: ${refData.appointmentDate}` : ''}

Write instructions in plain language (6th grade reading level) covering:
1. **What This Referral Means** — simple explanation
2. **Before Your Appointment** — what to prepare and bring
3. **Questions to Ask the Specialist** — 4-5 patient-friendly questions
4. **What to Expect During the Visit** — what will happen
5. **After Your Visit** — follow-up with referring provider
6. **When to Call Us** — warning signs to report immediately
7. **Contact Information Reminder** — prompt to keep all provider info`;

    const aiResult = await callOpenRouter(prompt);

    await persistAiResult(req.user?.id, '/referrals/ai/draft-patient-instructions', patientId || refData.patientId || null, aiResult.result, aiResult.model);
    res.json({ success: true, instructions: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /ai/score-appropriateness
router.post('/ai/score-appropriateness', referralAiRateLimit, async (req, res) => {
  try {
    const { specialistType, reason, diagnosis, patientHistory, patientId } = req.body;
    if (!specialistType || !reason) {
      return res.status(400).json({ error: 'specialistType and reason are required' });
    }

    const prompt = `You are an expert clinical appropriateness reviewer. Score the appropriateness of this specialist referral.

Specialist Type: ${specialistType}
Referral Reason: ${reason}
Diagnosis: ${diagnosis || 'Not specified'}
Relevant Patient History: ${patientHistory || 'Not provided'}

Provide a structured JSON response:
{
  "appropriateness_score": <1-10>,
  "appropriateness_tier": "<Appropriate|May Be Appropriate|Rarely Appropriate>",
  "clinical_rationale": "<why this score>",
  "evidence_basis": "<guidelines or clinical criteria used>",
  "strengths": ["<strength of referral>"],
  "gaps": ["<missing information or clinical justification>"],
  "recommendations_to_improve": ["<how to strengthen the referral>"],
  "alternative_approach": "<if referral is low-scoring, what else to consider>"
}`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/score-appropriateness', patientId || null, parsed, aiResult.model);
    res.json({ success: true, score: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /ai/suggest-alternative-specialty
router.post('/ai/suggest-alternative-specialty', referralAiRateLimit, async (req, res) => {
  try {
    const { currentSpecialistType, reason, unavailableReason, patientId } = req.body;
    if (!currentSpecialistType || !reason) {
      return res.status(400).json({ error: 'currentSpecialistType and reason are required' });
    }

    const prompt = `You are an expert clinician. The originally planned specialist (${currentSpecialistType}) is not available or appropriate. Suggest alternatives.

Original Specialist: ${currentSpecialistType}
Referral Reason: ${reason}
Reason Original Is Not Ideal: ${unavailableReason || 'Not specified'}

Provide:
1. **Primary Alternative Specialty** — best substitute with rationale
2. **Secondary Alternative** — another option
3. **Overlap Assessment** — how well each alternative covers the clinical need
4. **Any Risk of Alternative** — limitations of the alternative specialist
5. **Combined Approach** — if multiple specialists together would be better
6. **Urgency Consideration** — does the alternative affect timing`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/suggest-alternative-specialty', patientId || null, parsed, aiResult.model);
    res.json({ success: true, alternatives: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /ai/predict-acceptance
router.post('/ai/predict-acceptance', referralAiRateLimit, async (req, res) => {
  try {
    const { specialistType, reason, urgency, inNetwork, authorizationNumber, patientId } = req.body;
    if (!specialistType) return res.status(400).json({ error: 'specialistType is required' });

    const prompt = `You are a referral management AI analyst. Predict the likelihood this referral will be accepted by the specialist.

Specialist Type: ${specialistType}
Referral Reason: ${reason || 'Not specified'}
Urgency: ${urgency || 'Routine'}
In Network: ${inNetwork !== undefined ? inNetwork : 'Unknown'}
Prior Authorization: ${authorizationNumber ? `Obtained (${authorizationNumber})` : 'Not obtained'}

Provide a structured JSON response:
{
  "acceptance_probability": "<percentage or low/medium/high>",
  "confidence": "<high|medium|low>",
  "key_acceptance_factors": ["<positive factor>"],
  "key_rejection_risks": ["<risk factor>"],
  "missing_information": ["<what could improve acceptance odds>"],
  "recommended_actions_before_submission": ["<action>"],
  "typical_processing_time": "<days/weeks>",
  "escalation_path_if_rejected": "<what to do if declined>"
}`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/predict-acceptance', patientId || null, parsed, aiResult.model);
    res.json({ success: true, prediction: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /ai/summarize-specialist-feedback
router.post('/ai/summarize-specialist-feedback', referralAiRateLimit, async (req, res) => {
  try {
    const { feedbackText, referralId, patientId } = req.body;
    if (!feedbackText) return res.status(400).json({ error: 'feedbackText is required' });

    let refContext = '';
    if (referralId) {
      try {
        const referral = await Referral.findByPk(referralId);
        if (referral) {
          refContext = `Original referral to ${referral.specialistType} for: ${referral.reason}`;
        }
      } catch (e) {}
    }

    const prompt = `You are a medical communications specialist. Summarize this specialist feedback/consultation note for the referring provider and patient care team.

${refContext ? `Referral Context: ${refContext}` : ''}
Specialist Feedback:
${feedbackText}

Provide:
1. **Executive Summary** — 2-3 sentence overview
2. **Key Findings** — what the specialist found
3. **Diagnosis / Assessment** — specialist's conclusion
4. **Recommended Treatment Plan** — what the specialist proposes
5. **Action Items for Referring Provider** — what to do next
6. **Follow-Up Schedule** — any planned specialist follow-ups
7. **Patient Communication Points** — how to explain to the patient`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/summarize-specialist-feedback', patientId || null, parsed, aiResult.model);
    res.json({ success: true, summary: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /ai/detect-missing-info
router.post('/ai/detect-missing-info', referralAiRateLimit, async (req, res) => {
  try {
    const { referralId, patientId } = req.body;
    if (!referralId) return res.status(400).json({ error: 'referralId is required' });

    const referral = await Referral.findByPk(referralId);
    if (!referral) return res.status(404).json({ error: 'Referral not found' });

    const referralJson = referral.toJSON();

    // Check what fields are populated
    const fieldStatus = {
      patientId: !!referralJson.patientId,
      referringProviderId: !!referralJson.referringProviderId,
      receivingProviderName: !!referralJson.receivingProviderName,
      specialistType: !!referralJson.specialistType,
      reason: !!referralJson.reason,
      urgency: !!referralJson.urgency,
      referralLetter: !!referralJson.referralLetter,
      appointmentDate: !!referralJson.appointmentDate,
      inNetwork: referralJson.inNetwork !== null && referralJson.inNetwork !== undefined,
      authorizationNumber: !!referralJson.authorizationNumber
    };

    const prompt = `You are a referral quality assurance specialist. Identify missing or incomplete information in this referral record.

Referral Data:
${JSON.stringify(referralJson, null, 2)}

Field Completion Status:
${JSON.stringify(fieldStatus, null, 2)}

Provide a structured JSON response:
{
  "completeness_score": <0-100>,
  "missing_required_fields": ["<field name and why it matters>"],
  "missing_recommended_fields": ["<field name and suggestion>"],
  "incomplete_fields": ["<field that exists but needs more detail>"],
  "critical_gaps": ["<gaps that could delay or reject the referral>"],
  "action_items": [
    { "priority": "<high|medium|low>", "action": "<what to do>", "field": "<field name>" }
  ],
  "ready_to_submit": <true|false>,
  "blockers": ["<what must be resolved before submission>"]
}`;

    const aiResult = await callOpenRouter(prompt);
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/referrals/ai/detect-missing-info', patientId || referral.patientId || null, parsed, aiResult.model);
    res.json({ success: true, missingInfo: parsed, fieldStatus, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
