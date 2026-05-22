const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { Problem, Patient, AuditLog, AiResult } = require('../models');
const { Op } = require('sequelize');
const router = express.Router();

// ── Rate limiter (20 AI calls per hour per user/IP) ───────────────────────────
const problemRateLimitMap = new Map();
function problemAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const limit = 20;

  const entry = problemRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  problemRateLimitMap.set(key, entry);

  if (entry.count > limit) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 20 AI calls per hour.' });
  }
  next();
}

// ── 3-strategy JSON parser ────────────────────────────────────────────────────
function parseAIJson(content) {
  if (!content) return { raw_response: '' };
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (e) {}
  }
  try { return JSON.parse(content); } catch (e) {}
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

// ── Apply auth to all routes ──────────────────────────────────────────────────
router.use(auth);

// =============================================================================
// CRUD ENDPOINTS (18)
// =============================================================================

// 1. GET / — paginated list + optional ?status filter
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const { count, rows } = await Problem.findAndCountAll({
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

// 11. GET /count — must be before /:id to avoid route conflict
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.isChronicCondition !== undefined) {
      where.isChronicCondition = req.query.isChronicCondition === 'true';
    }
    if (req.query.patientId) where.patientId = req.query.patientId;

    const count = await Problem.count({ where });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET /search — ?q in problem/notes — must be before /:id
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await Problem.findAndCountAll({
      where: {
        [Op.or]: [
          { problem: { [Op.like]: `%${q}%` } },
          { notes: { [Op.like]: `%${q}%` } }
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

// 16. GET /export/csv — must be before /:id
router.get('/export/csv', async (req, res) => {
  try {
    const where = {};
    if (req.query.patientId) where.patientId = req.query.patientId;
    if (req.query.status) where.status = req.query.status;

    const problems = await Problem.findAll({ where, order: [['createdAt', 'DESC']] });

    const headers = [
      'id', 'patientId', 'problem', 'icd10Code', 'snomedCode', 'status',
      'severity', 'onsetDate', 'resolvedDate', 'notes', 'recordedBy',
      'isChronicCondition', 'aiPriorityScore', 'createdAt', 'updatedAt'
    ];

    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = [
      headers.join(','),
      ...problems.map(p =>
        headers.map(h => escape(p[h])).join(',')
      )
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="problems.csv"');
    res.send(rows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. GET /stats/summary — counts by status, severity dist, top 10 ICD-10 — must be before /:id
router.get('/stats/summary', async (req, res) => {
  try {
    const allProblems = await Problem.findAll({
      attributes: ['status', 'severity', 'icd10Code', 'isChronicCondition']
    });

    const statusCounts = {};
    const severityCounts = {};
    const icd10Counts = {};
    let chronicCount = 0;

    for (const p of allProblems) {
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
      if (p.severity) severityCounts[p.severity] = (severityCounts[p.severity] || 0) + 1;
      if (p.icd10Code) icd10Counts[p.icd10Code] = (icd10Counts[p.icd10Code] || 0) + 1;
      if (p.isChronicCondition) chronicCount++;
    }

    const top10Icd10 = Object.entries(icd10Counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, count]) => ({ code, count }));

    res.json({
      total: allProblems.length,
      chronicCount,
      statusCounts,
      severityDistribution: severityCounts,
      top10Icd10Codes: top10Icd10
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /by-patient/:patientId — active problems for patient
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const problems = await Problem.findAll({
      where: { patientId: req.params.patientId, status: 'Active' },
      order: [['createdAt', 'DESC']]
    });
    res.json({ data: problems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /chronic/:patientId — only isChronicCondition=true
router.get('/chronic/:patientId', async (req, res) => {
  try {
    const problems = await Problem.findAll({
      where: { patientId: req.params.patientId, isChronicCondition: true },
      order: [['createdAt', 'DESC']]
    });
    res.json({ data: problems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /batch — create multiple problems
router.post('/batch', async (req, res) => {
  try {
    const { problems } = req.body;
    if (!Array.isArray(problems) || problems.length === 0) {
      return res.status(400).json({ error: 'problems array is required' });
    }
    const created = await Problem.bulkCreate(problems, { validate: true });
    res.status(201).json({ data: created, count: created.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. PUT /batch — update multiple problems
router.put('/batch', async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates array is required (each item needs id + fields)' });
    }
    const results = await Promise.all(
      updates.map(async ({ id, ...fields }) => {
        const [affectedRows] = await Problem.update(fields, { where: { id } });
        return { id, updated: affectedRows > 0 };
      })
    );
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. DELETE /batch — soft-delete multiple problems
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const [affectedRows] = await Problem.update(
      { status: 'Resolved' },
      { where: { id: { [Op.in]: ids } } }
    );
    res.json({ softDeleted: affectedRows, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. POST /import/csv
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
        if (values[idx] !== undefined && values[idx] !== '') {
          record[h] = values[idx];
        }
      });
      if (record.problem) records.push(record);
    }

    if (records.length === 0) {
      return res.status(400).json({ error: 'No valid records found in CSV' });
    }

    const created = await Problem.bulkCreate(records, { validate: true, ignoreDuplicates: true });
    res.status(201).json({ imported: created.length, total: records.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST / — create
router.post('/', async (req, res) => {
  try {
    const problem = await Problem.create(req.body);
    res.status(201).json({ data: problem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /:id — get by id, AuditLog action='view_problem'
router.get('/:id', async (req, res) => {
  try {
    const problem = await Problem.findByPk(req.params.id);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });

    try {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'view_problem',
        resourceType: 'Problem',
        resourceId: problem.id,
        patientId: problem.patientId || null,
        details: `Viewed problem: ${problem.problem}`
      });
    } catch (auditErr) {
      console.error('AuditLog error:', auditErr.message);
    }

    res.json({ data: problem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /:id — update
router.put('/:id', async (req, res) => {
  try {
    const problem = await Problem.findByPk(req.params.id);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });
    await problem.update(req.body);
    res.json({ data: problem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /:id — soft-delete (status='Resolved')
router.delete('/:id', async (req, res) => {
  try {
    const problem = await Problem.findByPk(req.params.id);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });
    await problem.update({ status: 'Resolved' });
    res.json({ message: 'Problem soft-deleted (status set to Resolved)', id: problem.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /:id/archive — status='Inactive'
router.post('/:id/archive', async (req, res) => {
  try {
    const problem = await Problem.findByPk(req.params.id);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });
    await problem.update({ status: 'Inactive' });
    res.json({ message: 'Problem archived', data: problem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /:id/restore — status='Active'
router.post('/:id/restore', async (req, res) => {
  try {
    const problem = await Problem.findByPk(req.params.id);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });
    await problem.update({ status: 'Active' });
    res.json({ message: 'Problem restored to Active', data: problem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. GET /:id/history
router.get('/:id/history', async (req, res) => {
  try {
    const problem = await Problem.findByPk(req.params.id);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });

    let auditHistory = [];
    try {
      auditHistory = await AuditLog.findAll({
        where: { resourceType: 'Problem', resourceId: req.params.id },
        order: [['createdAt', 'DESC']],
        limit: 100
      });
    } catch (e) {
      // AuditLog may not have these columns; return what we can
    }

    res.json({ data: problem, history: auditHistory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// AI ENDPOINTS (16) — rate-limited
// =============================================================================

// 1. POST /ai/suggest-icd-codes
router.post('/ai/suggest-icd-codes', problemAiRateLimit, async (req, res) => {
  try {
    const { problemText } = req.body;
    if (!problemText) return res.status(400).json({ error: 'problemText is required' });

    const prompt = `You are a clinical coding specialist. Suggest the most accurate ICD-10-CM codes for the following problem description.

Problem: ${problemText}

Respond ONLY with valid JSON:
{
  "primary_code": { "code": "<ICD-10 code>", "description": "<full description>", "confidence": "<high|medium|low>" },
  "alternative_codes": [
    { "code": "<code>", "description": "<description>", "rationale": "<why this applies>" }
  ],
  "coding_notes": "<any clarifying advice for the coder>",
  "specificity_tips": "<what additional detail would allow more specific coding>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical coding specialist. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/suggest-icd-codes', null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /ai/prioritize-problems
router.post('/ai/prioritize-problems', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const problems = await Problem.findAll({ where: { patientId, status: 'Active' } });
    if (problems.length === 0) {
      return res.status(404).json({ error: 'No active problems found for patient' });
    }

    const prompt = `You are a clinical decision-support AI. Prioritize the following active problems for clinical management in an ER setting.

Problems:
${problems.map((p, i) => `${i + 1}. [ID:${p.id}] ${p.problem} | Severity: ${p.severity || 'Unknown'} | Chronic: ${p.isChronicCondition} | Onset: ${p.onsetDate || 'Unknown'}`).join('\n')}

Respond ONLY with valid JSON:
{
  "prioritized_list": [
    {
      "problem_id": "<id>",
      "problem": "<name>",
      "priority_rank": <1-N>,
      "priority_score": <0-100>,
      "rationale": "<clinical reasoning>",
      "urgency": "<immediate|urgent|routine>"
    }
  ],
  "overall_complexity": "<low|moderate|high|critical>",
  "recommended_focus": "<the single most critical problem to address first and why>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical decision-support AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Update aiPriorityScore on each problem
    if (Array.isArray(parsed.prioritized_list)) {
      for (const item of parsed.prioritized_list) {
        if (item.problem_id && item.priority_score !== undefined) {
          await Problem.update(
            { aiPriorityScore: item.priority_score },
            { where: { id: item.problem_id } }
          ).catch(() => {});
        }
      }
    }

    await persistAiResult(req.user?.id, '/problems/ai/prioritize-problems', patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /ai/suggest-careplan
router.post('/ai/suggest-careplan', problemAiRateLimit, async (req, res) => {
  try {
    const { problemId } = req.body;
    if (!problemId) return res.status(400).json({ error: 'problemId is required' });

    const problem = await Problem.findByPk(problemId);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });

    const prompt = `You are a care plan specialist. Generate a comprehensive care plan for the following clinical problem.

Problem: ${problem.problem}
ICD-10: ${problem.icd10Code || 'Not coded'}
Severity: ${problem.severity || 'Unknown'}
Status: ${problem.status}
Chronic: ${problem.isChronicCondition}
Notes: ${problem.notes || 'None'}

Respond ONLY with valid JSON:
{
  "goals": ["<short-term goal>", "<long-term goal>"],
  "interventions": [
    { "type": "<nursing|medical|therapy|education>", "intervention": "<description>", "frequency": "<how often>" }
  ],
  "monitoring_parameters": ["<what to track>"],
  "patient_education": ["<key teaching point>"],
  "referrals": ["<specialist or service>"],
  "expected_outcomes": "<measurable outcome with timeframe>",
  "follow_up_interval": "<recommended follow-up schedule>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a care plan specialist. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await problem.update({ aiCareplanSuggestion: JSON.stringify(parsed) }).catch(() => {});
    await persistAiResult(req.user?.id, '/problems/ai/suggest-careplan', problem.patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /ai/classify-chronic-acute
router.post('/ai/classify-chronic-acute', problemAiRateLimit, async (req, res) => {
  try {
    const { problemText, onsetDate, notes } = req.body;
    if (!problemText) return res.status(400).json({ error: 'problemText is required' });

    const prompt = `You are a clinical classification AI. Determine whether the following problem is chronic or acute.

Problem: ${problemText}
Onset Date: ${onsetDate || 'Unknown'}
Clinical Notes: ${notes || 'None'}

Respond ONLY with valid JSON:
{
  "classification": "<chronic|acute|sub-acute|chronic-with-acute-exacerbation>",
  "confidence": "<high|medium|low>",
  "is_chronic": <true|false>,
  "rationale": "<clinical reasoning>",
  "typical_duration_threshold": "<how long this condition is typically chronic>",
  "flags": ["<any flags or considerations>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical classification AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/classify-chronic-acute', null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /ai/detect-comorbidity-clusters
router.post('/ai/detect-comorbidity-clusters', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const problems = await Problem.findAll({ where: { patientId } });
    if (problems.length === 0) {
      return res.status(404).json({ error: 'No problems found for patient' });
    }

    const prompt = `You are a clinical informatics AI. Analyze this patient's problem list and identify comorbidity clusters, interactions, and compound risk.

Problem List:
${problems.map(p => `- ${p.problem} (${p.icd10Code || 'no ICD'}) | ${p.status} | Severity: ${p.severity || 'unknown'} | Chronic: ${p.isChronicCondition}`).join('\n')}

Respond ONLY with valid JSON:
{
  "clusters": [
    {
      "cluster_name": "<e.g. Cardiometabolic Syndrome>",
      "problems": ["<problem name>"],
      "interaction_risk": "<low|moderate|high>",
      "description": "<how these conditions interact>"
    }
  ],
  "compound_risk_score": <0-100>,
  "highest_risk_cluster": "<cluster name>",
  "management_priorities": ["<actionable recommendation>"],
  "specialist_referrals": ["<specialty needed>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical informatics AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/detect-comorbidity-clusters', patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /ai/generate-problem-summary
router.post('/ai/generate-problem-summary', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId, problemId } = req.body;

    let problems = [];
    let patient = null;

    if (problemId) {
      const p = await Problem.findByPk(problemId);
      if (!p) return res.status(404).json({ error: 'Problem not found' });
      problems = [p];
      try { patient = await Patient.findByPk(p.patientId); } catch {}
    } else if (patientId) {
      problems = await Problem.findAll({ where: { patientId }, order: [['createdAt', 'DESC']] });
      try { patient = await Patient.findByPk(patientId); } catch {}
    } else {
      return res.status(400).json({ error: 'patientId or problemId is required' });
    }

    const prompt = `You are a clinical documentation AI. Generate a concise, structured medical summary of the following problem list.

${patient ? `Patient: ${patient.firstName || ''} ${patient.lastName || ''} | DOB: ${patient.dateOfBirth || 'Unknown'}` : `Patient ID: ${patientId || problemId}`}

Problem List (${problems.length} problems):
${problems.map(p => `- ${p.problem} | ICD: ${p.icd10Code || 'N/A'} | Status: ${p.status} | Severity: ${p.severity || 'N/A'} | Onset: ${p.onsetDate || 'N/A'} | Chronic: ${p.isChronicCondition}`).join('\n')}

Provide a narrative clinical summary suitable for an ER handoff note. Include:
1. Chief active problems (2-3 sentences)
2. Significant chronic conditions
3. Recent or new concerns
4. Overall clinical complexity
5. Key management considerations`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/problems/ai/generate-problem-summary', patientId || null, aiResult.result, aiResult.model);
    res.json({ success: true, summary: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /ai/suggest-uspstf-screenings
router.post('/ai/suggest-uspstf-screenings', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId, age, gender, problemText, problems: problemsInput } = req.body;

    let problemList = problemsInput || [];
    if (!problemList.length && patientId) {
      const dbProblems = await Problem.findAll({ where: { patientId, status: 'Active' } });
      problemList = dbProblems.map(p => p.problem);
    }

    const prompt = `You are a preventive medicine AI. Based on this patient's profile and active problems, recommend applicable USPSTF preventive screenings.

Patient Age: ${age || 'Unknown'}
Patient Gender: ${gender || 'Unknown'}
Active Problems: ${problemList.length ? problemList.join(', ') : problemText || 'None specified'}

Respond ONLY with valid JSON:
{
  "recommended_screenings": [
    {
      "screening": "<test name>",
      "uspstf_grade": "<A|B|C|D|I>",
      "indication": "<why applicable to this patient>",
      "frequency": "<how often>",
      "last_due": "<now|overdue|calculate based on age>"
    }
  ],
  "deferred_screenings": [
    { "screening": "<test>", "reason": "<why not applicable>" }
  ],
  "priority_order": ["<screening name in order of importance>"],
  "notes": "<any additional preventive care considerations>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a preventive medicine AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/suggest-uspstf-screenings', patientId || null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /ai/extract-from-note
router.post('/ai/extract-from-note', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId, noteText } = req.body;
    if (!noteText) return res.status(400).json({ error: 'noteText is required' });

    const prompt = `You are a clinical NLP AI. Extract all medical problems mentioned in the following clinical note and structure them for a problem list.

Clinical Note:
"""
${noteText}
"""

Respond ONLY with valid JSON:
{
  "extracted_problems": [
    {
      "problem": "<problem name>",
      "suggested_icd10": "<ICD-10 code if determinable>",
      "status": "<Active|Inactive|Resolved|Recurrence>",
      "severity": "<Mild|Moderate|Severe|unknown>",
      "is_chronic": <true|false|null>,
      "onset_mentioned": "<any onset date/duration mentioned or null>",
      "confidence": "<high|medium|low>"
    }
  ],
  "total_extracted": <number>,
  "note_summary": "<brief summary of the note's clinical content>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical NLP AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/extract-from-note', patientId || null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /ai/reconcile-duplicates
router.post('/ai/reconcile-duplicates', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const problems = await Problem.findAll({ where: { patientId }, order: [['createdAt', 'ASC']] });
    if (problems.length === 0) return res.json({ success: true, result: { duplicates: [], message: 'No problems found' } });

    const prompt = `You are a clinical data quality AI. Review the following problem list for duplicate or near-duplicate entries and recommend reconciliation.

Problem List for Patient ${patientId}:
${problems.map(p => `[ID:${p.id}] ${p.problem} | ICD: ${p.icd10Code || 'none'} | SNOMED: ${p.snomedCode || 'none'} | Status: ${p.status} | Added: ${p.createdAt}`).join('\n')}

Respond ONLY with valid JSON:
{
  "duplicate_groups": [
    {
      "group_id": <number>,
      "problem_ids": [<id>, <id>],
      "problem_names": ["<name>", "<name>"],
      "similarity_reason": "<why these are duplicates>",
      "recommended_keep_id": <id>,
      "recommended_action": "<merge|archive_secondary|manual_review>"
    }
  ],
  "total_duplicates_found": <number>,
  "unique_problem_count": <number>,
  "reconciliation_notes": "<any other data quality observations>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical data quality AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/reconcile-duplicates', patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST /ai/predict-progression
router.post('/ai/predict-progression', problemAiRateLimit, async (req, res) => {
  try {
    const { problemId, patientId } = req.body;
    if (!problemId) return res.status(400).json({ error: 'problemId is required' });

    const problem = await Problem.findByPk(problemId);
    if (!problem) return res.status(404).json({ error: 'Problem not found' });

    let relatedProblems = [];
    if (problem.patientId) {
      relatedProblems = await Problem.findAll({
        where: { patientId: problem.patientId, id: { [Op.ne]: problemId } }
      });
    }

    const prompt = `You are a clinical prognosis AI. Predict the progression trajectory of this medical problem given current status and comorbidities.

Primary Problem: ${problem.problem}
ICD-10: ${problem.icd10Code || 'N/A'}
Current Severity: ${problem.severity || 'Unknown'}
Status: ${problem.status}
Onset: ${problem.onsetDate || 'Unknown'}
Is Chronic: ${problem.isChronicCondition}
Notes: ${problem.notes || 'None'}

Comorbidities:
${relatedProblems.length ? relatedProblems.map(p => `- ${p.problem} (${p.status})`).join('\n') : 'None recorded'}

Respond ONLY with valid JSON:
{
  "progression_trajectory": "<improving|stable|worsening|variable>",
  "30_day_outlook": "<prognosis statement>",
  "90_day_outlook": "<prognosis statement>",
  "1_year_outlook": "<prognosis statement>",
  "risk_factors_for_worsening": ["<factor>"],
  "protective_factors": ["<factor>"],
  "predicted_complications": [
    { "complication": "<name>", "probability": "<low|moderate|high>", "timeframe": "<when likely>" }
  ],
  "intervention_impact": "<how treatment adherence affects trajectory>",
  "monitoring_recommendations": ["<what to track>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical prognosis AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/predict-progression', problem.patientId || patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST /ai/suggest-snomed
router.post('/ai/suggest-snomed', problemAiRateLimit, async (req, res) => {
  try {
    const { problemText, icd10Code } = req.body;
    if (!problemText) return res.status(400).json({ error: 'problemText is required' });

    const prompt = `You are a clinical terminology specialist. Suggest the most accurate SNOMED CT codes for the following problem.

Problem: ${problemText}
ICD-10 (if known): ${icd10Code || 'Not provided'}

Respond ONLY with valid JSON:
{
  "primary_snomed": {
    "code": "<SNOMED CT concept ID>",
    "display": "<fully specified name>",
    "confidence": "<high|medium|low>"
  },
  "alternative_snomed": [
    { "code": "<concept ID>", "display": "<FSN>", "rationale": "<why this might apply>" }
  ],
  "hierarchy": "<clinical hierarchy path e.g. Clinical finding > Disease>",
  "coding_notes": "<any disambiguation or specificity guidance>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical terminology specialist. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/suggest-snomed', null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /ai/calculate-cci-score — Charlson Comorbidity Index
router.post('/ai/calculate-cci-score', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId, age, problems: problemsInput } = req.body;

    let problemList = problemsInput || [];
    if (!problemList.length && patientId) {
      const dbProblems = await Problem.findAll({ where: { patientId } });
      problemList = dbProblems.map(p => ({ problem: p.problem, icd10Code: p.icd10Code }));
    }

    const prompt = `You are a clinical risk scoring AI. Calculate the Charlson Comorbidity Index (CCI) for this patient.

Patient Age: ${age || 'Unknown'}
Problem List:
${problemList.map(p => typeof p === 'string' ? `- ${p}` : `- ${p.problem} (ICD: ${p.icd10Code || 'N/A'})`).join('\n')}

CCI Scoring Reference:
- MI, CHF, PVD, CVD, Dementia, COPD, Connective tissue disease, Ulcer, Mild liver disease, DM: 1 point each
- Hemiplegia, Moderate-severe renal disease, DM with end-organ damage, Any tumor, Leukemia, Lymphoma: 2 points each
- Moderate-severe liver disease: 3 points
- Metastatic solid tumor, AIDS: 6 points
- Age 50-59: +1, 60-69: +2, 70-79: +3, ≥80: +4

Respond ONLY with valid JSON:
{
  "cci_score": <number>,
  "age_adjusted_cci": <number>,
  "matched_conditions": [
    { "condition": "<CCI condition>", "matched_problem": "<patient problem>", "points": <number> }
  ],
  "unmatched_conditions": ["<conditions that did not map to CCI>"],
  "1_year_mortality_estimate": "<percentage range>",
  "10_year_survival": "<percentage range>",
  "risk_category": "<low (0-1)|moderate (2-3)|high (4-5)|very high (6+)>",
  "clinical_implications": "<narrative interpretation for ER clinician>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical risk scoring AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/calculate-cci-score', patientId || null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /ai/recommend-specialist
router.post('/ai/recommend-specialist', problemAiRateLimit, async (req, res) => {
  try {
    const { problemId, patientId, problemText } = req.body;

    let problem = null;
    let problemDescription = problemText;

    if (problemId) {
      problem = await Problem.findByPk(problemId);
      if (!problem) return res.status(404).json({ error: 'Problem not found' });
      problemDescription = problem.problem;
    }

    if (!problemDescription) return res.status(400).json({ error: 'problemId or problemText is required' });

    const prompt = `You are a clinical referral AI. Recommend the appropriate medical specialist(s) for the following problem.

Problem: ${problemDescription}
${problem ? `ICD-10: ${problem.icd10Code || 'N/A'} | Severity: ${problem.severity || 'Unknown'} | Chronic: ${problem.isChronicCondition}` : ''}

Respond ONLY with valid JSON:
{
  "primary_specialist": {
    "specialty": "<specialty name>",
    "urgency": "<emergent|urgent|semi-urgent|routine>",
    "rationale": "<why this specialist>"
  },
  "secondary_specialists": [
    { "specialty": "<name>", "role": "<consultant|co-management>", "rationale": "<why>" }
  ],
  "referral_timeframe": "<immediate|within 24h|within 1 week|routine>",
  "information_to_include_in_referral": ["<key data points>"],
  "pre_referral_workup": ["<tests or actions before referring>"],
  "alternative_if_unavailable": "<what to do if specialist is not available>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical referral AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/recommend-specialist', problem?.patientId || patientId || null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /ai/identify-care-gaps
router.post('/ai/identify-care-gaps', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const problems = await Problem.findAll({ where: { patientId } });
    let patient = null;
    try { patient = await Patient.findByPk(patientId); } catch {}

    const prompt = `You are a care quality AI. Identify care gaps for this patient based on their active problem list and clinical guidelines.

${patient ? `Patient: ${patient.firstName || ''} ${patient.lastName || ''} | DOB: ${patient.dateOfBirth || 'Unknown'} | Gender: ${patient.gender || 'Unknown'}` : `Patient ID: ${patientId}`}

Problem List:
${problems.map(p => `- ${p.problem} | ${p.icd10Code || 'no ICD'} | Status: ${p.status} | Severity: ${p.severity || 'N/A'} | Care plan: ${p.aiCareplanSuggestion ? 'exists' : 'missing'}`).join('\n')}

Respond ONLY with valid JSON:
{
  "care_gaps": [
    {
      "gap_type": "<screening|monitoring|treatment|follow-up|education>",
      "description": "<specific gap>",
      "related_problem": "<problem name>",
      "guideline_reference": "<relevant guideline or standard>",
      "priority": "<high|medium|low>",
      "recommended_action": "<what to do>"
    }
  ],
  "total_gaps": <number>,
  "high_priority_count": <number>,
  "gap_summary": "<brief narrative overview>",
  "quality_metrics_at_risk": ["<metric name>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a care quality AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/identify-care-gaps', patientId, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /ai/draft-patient-letter
router.post('/ai/draft-patient-letter', problemAiRateLimit, async (req, res) => {
  try {
    const { problemId, patientId, letterType, additionalContext } = req.body;

    let problem = null;
    let patient = null;

    if (problemId) {
      problem = await Problem.findByPk(problemId);
      if (!problem) return res.status(404).json({ error: 'Problem not found' });
    }

    const resolvedPatientId = patientId || problem?.patientId;
    if (resolvedPatientId) {
      try { patient = await Patient.findByPk(resolvedPatientId); } catch {}
    }

    if (!problem && !problemId) return res.status(400).json({ error: 'problemId is required' });

    const prompt = `You are a medical communication AI. Draft a patient-friendly letter about their medical problem.

Letter Type: ${letterType || 'general patient education'}
Patient: ${patient ? `${patient.firstName || 'Patient'} ${patient.lastName || ''}` : 'Patient'}
Problem: ${problem?.problem || 'Medical concern'}
ICD-10: ${problem?.icd10Code || 'N/A'}
Severity: ${problem?.severity || 'Unknown'}
Status: ${problem?.status || 'Active'}
Notes from clinician: ${problem?.notes || additionalContext || 'None'}

Draft a clear, empathetic, jargon-free patient letter that:
1. Explains the diagnosis in plain language
2. Describes what this means for their health
3. Lists what they need to do (medications, lifestyle, follow-up)
4. Explains warning signs to watch for
5. Encourages questions and follow-up
6. Closes with supportive language

Write the full letter text, ready to print.`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/problems/ai/draft-patient-letter', resolvedPatientId || null, aiResult.result, aiResult.model);
    res.json({ success: true, letter: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /ai/score-complexity
router.post('/ai/score-complexity', problemAiRateLimit, async (req, res) => {
  try {
    const { patientId, problems: problemsInput } = req.body;

    let problems = problemsInput || [];
    if (!problems.length && patientId) {
      const dbProblems = await Problem.findAll({ where: { patientId } });
      problems = dbProblems.map(p => ({
        id: p.id,
        problem: p.problem,
        icd10Code: p.icd10Code,
        severity: p.severity,
        status: p.status,
        isChronicCondition: p.isChronicCondition,
        aiPriorityScore: p.aiPriorityScore
      }));
    }

    if (!problems.length) return res.status(400).json({ error: 'patientId or problems array is required' });

    const prompt = `You are a clinical complexity scoring AI. Score the overall medical complexity of this patient based on their problem list.

Problems:
${problems.map(p => typeof p === 'string'
  ? `- ${p}`
  : `- ${p.problem} | ICD: ${p.icd10Code || 'N/A'} | Severity: ${p.severity || 'N/A'} | Chronic: ${p.isChronicCondition} | Priority Score: ${p.aiPriorityScore || 'N/A'}`
).join('\n')}

Respond ONLY with valid JSON:
{
  "complexity_score": <0-100>,
  "complexity_level": "<low|moderate|high|very high>",
  "cms_complexity_category": "<straightforward|low|moderate|high>",
  "problem_count": <number>,
  "chronic_problem_count": <number>,
  "severe_problem_count": <number>,
  "complexity_drivers": ["<primary factors driving complexity>"],
  "care_coordination_needs": "<minimal|moderate|intensive>",
  "estimated_visit_time": "<in minutes for appropriate ER workup>",
  "recommended_mdm_level": "<straightforward|low|moderate|high>",
  "narrative": "<brief clinical complexity statement for documentation>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical complexity scoring AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/problems/ai/score-complexity', patientId || null, parsed, aiResult.model);
    res.json({ success: true, result: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
