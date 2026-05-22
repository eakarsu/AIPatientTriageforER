const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { ClinicalOrder, Encounter, Patient, AuditLog, AiResult } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// ── In-memory rate limiter: max 20 AI calls per hour per user/IP ──────────────
const orderRateLimitMap = new Map();
function orderAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const limit = 20;

  const entry = orderRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  orderRateLimitMap.set(key, entry);

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

// ══════════════════════════════════════════════════════════════════════════════
// CRUD ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// 1. GET / — paginated list with optional ?status and ?orderType filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.orderType) where.orderType = req.query.orderType;

    const { count, rows } = await ClinicalOrder.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'firstName', 'lastName'] },
        { model: Encounter, as: 'encounter', attributes: ['id', 'chiefComplaint'] }
      ]
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

// 11. GET /count — must come before /:id to avoid route collision
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.priority) where.priority = req.query.priority;
    if (req.query.orderType) where.orderType = req.query.orderType;

    const count = await ClinicalOrder.count({ where });
    res.json({ count, filters: where });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET /search — ?q searches orderName, orderDetails, reasonForOrder
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await ClinicalOrder.findAndCountAll({
      where: {
        [Op.or]: [
          { orderName: { [Op.iLike]: `%${q}%` } },
          { orderDetails: { [Op.iLike]: `%${q}%` } },
          { reasonForOrder: { [Op.iLike]: `%${q}%` } }
        ]
      },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      query: q,
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

// 16. GET /export/csv — must come before /:id
router.get('/export/csv', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.orderType) where.orderType = req.query.orderType;

    const orders = await ClinicalOrder.findAll({ where, order: [['createdAt', 'DESC']] });

    const headers = [
      'id', 'patientId', 'encounterId', 'providerId', 'orderType', 'orderName',
      'orderDetails', 'status', 'priority', 'orderedAt', 'completedAt',
      'loincCode', 'cptCode', 'reasonForOrder', 'aiNecessityScore',
      'aiSuggestedAlternatives', 'createdAt', 'updatedAt'
    ];

    const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const csvRows = [
      headers.join(','),
      ...orders.map(o => headers.map(h => escape(o[h])).join(','))
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="clinical_orders.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. GET /stats/summary — must come before /:id
router.get('/stats/summary', async (req, res) => {
  try {
    const allOrders = await ClinicalOrder.findAll({
      attributes: ['orderType', 'priority', 'status']
    });

    const total = allOrders.length;

    // Counts by orderType
    const byOrderType = {};
    // Priority distribution
    const byPriority = {};
    // Completed count
    let completedCount = 0;

    for (const o of allOrders) {
      byOrderType[o.orderType] = (byOrderType[o.orderType] || 0) + 1;
      byPriority[o.priority] = (byPriority[o.priority] || 0) + 1;
      if (o.status === 'Completed') completedCount++;
    }

    const percentCompleted = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    res.json({
      total,
      byOrderType,
      byPriority,
      completedCount,
      percentCompleted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /by-patient/:patientId — must come before /:id
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const orders = await ClinicalOrder.findAll({
      where: { patientId: req.params.patientId },
      order: [['createdAt', 'DESC']]
    });
    res.json({ data: orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /by-encounter/:encounterId — must come before /:id
router.get('/by-encounter/:encounterId', async (req, res) => {
  try {
    const orders = await ClinicalOrder.findAll({
      where: { encounterId: req.params.encounterId },
      order: [['createdAt', 'DESC']]
    });
    res.json({ data: orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /:id — with AuditLog action='view_order'
router.get('/:id', async (req, res) => {
  try {
    const order = await ClinicalOrder.findByPk(req.params.id, {
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'firstName', 'lastName', 'dateOfBirth'] },
        { model: Encounter, as: 'encounter', attributes: ['id', 'chiefComplaint', 'arrivalTime'] }
      ]
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    try {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'view_order',
        resourceType: 'ClinicalOrder',
        resourceId: order.id,
        details: `User viewed clinical order ${order.id}`
      });
    } catch (auditErr) {
      console.error('AuditLog failed:', auditErr.message);
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST / — create a new order
router.post('/', async (req, res) => {
  try {
    const {
      patientId, encounterId, providerId, orderType, orderName, orderDetails,
      status, priority, orderedAt, completedAt, loincCode, cptCode,
      reasonForOrder, aiNecessityScore, aiSuggestedAlternatives
    } = req.body;

    const order = await ClinicalOrder.create({
      patientId,
      encounterId,
      providerId: providerId || req.user?.id,
      orderType,
      orderName,
      orderDetails,
      status: status || 'Draft',
      priority: priority || 'Routine',
      orderedAt: orderedAt || new Date(),
      completedAt,
      loincCode,
      cptCode,
      reasonForOrder,
      aiNecessityScore,
      aiSuggestedAlternatives
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /:id — update an order
router.put('/:id', async (req, res) => {
  try {
    const order = await ClinicalOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await order.update(req.body);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /:id — soft-delete by setting status='Cancelled'
router.delete('/:id', async (req, res) => {
  try {
    const order = await ClinicalOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await order.update({ status: 'Cancelled' });
    res.json({ message: 'Order cancelled', id: order.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /batch — create multiple orders
router.post('/batch', async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'orders array is required' });
    }

    const enriched = orders.map(o => ({
      ...o,
      providerId: o.providerId || req.user?.id,
      status: o.status || 'Draft',
      priority: o.priority || 'Routine',
      orderedAt: o.orderedAt || new Date()
    }));

    const created = await ClinicalOrder.bulkCreate(enriched, { returning: true });
    res.status(201).json({ created: created.length, data: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. PUT /batch — update multiple orders by id
router.put('/batch', async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'orders array with id fields is required' });
    }

    const results = await Promise.allSettled(
      orders.map(async ({ id, ...updates }) => {
        if (!id) throw new Error('Each order must have an id');
        const order = await ClinicalOrder.findByPk(id);
        if (!order) throw new Error(`Order ${id} not found`);
        await order.update(updates);
        return order;
      })
    );

    const updated = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = results
      .filter(r => r.status === 'rejected')
      .map((r, i) => ({ index: i, reason: r.reason?.message }));

    res.json({ updated: updated.length, failed, data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. DELETE /batch — soft-delete multiple orders (status='Cancelled')
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }

    const [affectedCount] = await ClinicalOrder.update(
      { status: 'Cancelled' },
      { where: { id: { [Op.in]: ids } } }
    );

    res.json({ cancelled: affectedCount, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /:id/archive — set status='Cancelled'
router.post('/:id/archive', async (req, res) => {
  try {
    const order = await ClinicalOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await order.update({ status: 'Cancelled' });
    res.json({ message: 'Order archived', id: order.id, status: order.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /:id/restore — set status='Active'
router.post('/:id/restore', async (req, res) => {
  try {
    const order = await ClinicalOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    await order.update({ status: 'Active' });
    res.json({ message: 'Order restored', id: order.id, status: order.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. GET /:id/history — audit log history for this order
router.get('/:id/history', async (req, res) => {
  try {
    const order = await ClinicalOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const logs = await AuditLog.findAll({
      where: { resourceType: 'ClinicalOrder', resourceId: req.params.id },
      order: [['createdAt', 'DESC']]
    });

    res.json({ orderId: req.params.id, history: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. POST /import/csv — parse CSV body and bulk-create orders
router.post('/import/csv', async (req, res) => {
  try {
    const csvText = req.body?.csv || (typeof req.body === 'string' ? req.body : '');
    if (!csvText) return res.status(400).json({ error: 'csv field with CSV text is required' });

    const lines = csvText.trim().split('\n').filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    const parseRow = (line) => {
      const values = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          values.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      values.push(cur.trim());
      return values;
    };

    const records = lines.slice(1).map(line => {
      const values = parseRow(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] || null; });
      // Strip auto-generated fields that shouldn't be imported
      delete obj.id;
      delete obj.createdAt;
      delete obj.updatedAt;
      if (!obj.providerId) obj.providerId = req.user?.id || null;
      if (!obj.status) obj.status = 'Draft';
      if (!obj.priority) obj.priority = 'Routine';
      if (!obj.orderedAt) obj.orderedAt = new Date();
      return obj;
    });

    const created = await ClinicalOrder.bulkCreate(records, { returning: true });
    res.status(201).json({ imported: created.length, data: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// AI VERB ENDPOINTS  (POST /ai/<verb>, rate-limited, persisted to AiResult)
// ══════════════════════════════════════════════════════════════════════════════

// 1. POST /ai/suggest-orders
router.post('/ai/suggest-orders', orderAiRateLimit, async (req, res) => {
  try {
    const { patientId, chiefComplaint } = req.body;

    let patientCtx = '';
    if (patientId) {
      try {
        const patient = await Patient.findByPk(patientId);
        if (patient) patientCtx = `Patient: ${patient.firstName} ${patient.lastName}, DOB: ${patient.dateOfBirth}, Allergies: ${patient.allergies || 'NKDA'}`;
      } catch (e) {}
    }

    const prompt = `You are an emergency medicine physician AI. Suggest clinical orders for this ER patient.
${patientCtx}
Chief Complaint: ${chiefComplaint || 'Not specified'}

Respond with a JSON object:
{
  "suggested_orders": [
    {
      "orderType": "<Lab|Imaging|Medication|Procedure|Consult|Nursing|Diet>",
      "orderName": "<specific order name>",
      "priority": "<Routine|Urgent|ASAP|Stat>",
      "reasoning": "<why this order is indicated>",
      "loincCode": "<LOINC code if applicable>",
      "cptCode": "<CPT code if applicable>"
    }
  ],
  "clinical_rationale": "<overall reasoning>",
  "urgent_orders": ["<list of stat/urgent order names>"],
  "estimated_workup_time": "<estimated time to complete workup>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an emergency medicine physician AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/suggest-orders', patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /ai/check-medical-necessity
router.post('/ai/check-medical-necessity', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const order = await ClinicalOrder.findByPk(orderId, {
      include: [{ model: Patient, as: 'patient', attributes: ['id', 'firstName', 'lastName', 'dateOfBirth', 'allergies'] }]
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const prompt = `You are a clinical review AI. Assess the medical necessity of this clinical order.
Order: ${order.orderName} (${order.orderType})
Details: ${order.orderDetails || 'None'}
Reason for Order: ${order.reasonForOrder || 'Not specified'}
Priority: ${order.priority}
Patient Context: ${order.patient ? `${order.patient.firstName} ${order.patient.lastName}` : 'Unknown'}

Respond with JSON:
{
  "necessity_score": <0-100>,
  "necessity_verdict": "<Medically Necessary|Possibly Necessary|Not Necessary|Unclear>",
  "supporting_criteria": ["<criterion 1>", "<criterion 2>"],
  "concerns": ["<concern if any>"],
  "payer_guidance": "<likely payer approval likelihood>",
  "documentation_tips": "<what to document to support medical necessity>",
  "alternatives_if_denied": ["<alternative approach>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical review AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Persist necessity score to order
    try {
      await order.update({ aiNecessityScore: parsed.necessity_score || null });
    } catch (e) {}

    await persistAiResult(req.user?.id, '/ai/orders/check-medical-necessity', order.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /ai/predict-results
router.post('/ai/predict-results', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId, patientId, orderName, orderType, clinicalContext } = req.body;

    let orderCtx = { orderName, orderType, clinicalContext };
    if (orderId) {
      try {
        const order = await ClinicalOrder.findByPk(orderId);
        if (order) orderCtx = { orderName: order.orderName, orderType: order.orderType, clinicalContext: order.reasonForOrder };
      } catch (e) {}
    }

    const prompt = `You are a diagnostic AI. Predict likely results for this clinical order given the patient context.
Order: ${orderCtx.orderName} (${orderCtx.orderType || 'Unknown type'})
Clinical Context: ${orderCtx.clinicalContext || 'Not provided'}

Respond with JSON:
{
  "predicted_results": [
    {
      "finding": "<expected finding>",
      "probability": "<high|moderate|low>",
      "clinical_significance": "<what this finding means>"
    }
  ],
  "most_likely_outcome": "<summary>",
  "red_flag_results": ["<result that would change management>"],
  "turnaround_time": "<expected result time>",
  "confidence": "<high|medium|low>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a diagnostic AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/predict-results', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /ai/suggest-alternatives
router.post('/ai/suggest-alternatives', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId, patientId, orderName, orderType, reasonForOrder } = req.body;

    let orderCtx = { orderName, orderType, reasonForOrder };
    if (orderId) {
      try {
        const order = await ClinicalOrder.findByPk(orderId);
        if (order) orderCtx = { orderName: order.orderName, orderType: order.orderType, reasonForOrder: order.reasonForOrder };
      } catch (e) {}
    }

    const prompt = `You are a clinical AI advisor. Suggest evidence-based alternatives to this clinical order.
Order: ${orderCtx.orderName} (${orderCtx.orderType || 'Unknown'})
Reason: ${orderCtx.reasonForOrder || 'Not specified'}

Respond with JSON:
{
  "alternatives": [
    {
      "orderName": "<alternative order>",
      "orderType": "<type>",
      "rationale": "<why this is a valid alternative>",
      "advantages": ["<advantage>"],
      "disadvantages": ["<disadvantage>"],
      "evidence_level": "<high|moderate|low>"
    }
  ],
  "recommendation": "<overall recommendation>",
  "cost_comparison": "<relative cost vs original>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical AI advisor. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Persist alternatives to the order if orderId provided
    if (orderId) {
      try {
        await ClinicalOrder.update(
          { aiSuggestedAlternatives: JSON.stringify(parsed.alternatives || []) },
          { where: { id: orderId } }
        );
      } catch (e) {}
    }

    await persistAiResult(req.user?.id, '/ai/orders/suggest-alternatives', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /ai/detect-duplicate-orders
router.post('/ai/detect-duplicate-orders', orderAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const orders = await ClinicalOrder.findAll({
      where: { patientId, status: { [Op.in]: ['Draft', 'Active', 'OnHold'] } },
      order: [['orderedAt', 'DESC']]
    });

    if (orders.length === 0) {
      return res.json({ success: true, analysis: { duplicates: [], message: 'No active orders found for patient' } });
    }

    const orderList = orders.map(o => ({
      id: o.id,
      orderName: o.orderName,
      orderType: o.orderType,
      loincCode: o.loincCode,
      cptCode: o.cptCode,
      orderedAt: o.orderedAt,
      status: o.status
    }));

    const prompt = `You are a clinical AI. Analyze this list of active orders for a patient and identify any potential duplicates or redundancies.
Orders: ${JSON.stringify(orderList, null, 2)}

Respond with JSON:
{
  "duplicate_groups": [
    {
      "order_ids": [<id1>, <id2>],
      "reason": "<why these are duplicates>",
      "recommended_action": "<keep which one and why>",
      "severity": "<low|moderate|high>"
    }
  ],
  "redundant_orders": [
    {
      "order_id": <id>,
      "reason": "<why redundant>"
    }
  ],
  "total_duplicates_found": <number>,
  "summary": "<overall assessment>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/detect-duplicate-orders', patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /ai/estimate-cost
router.post('/ai/estimate-cost', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId, patientId, orderName, orderType, cptCode, insuranceType } = req.body;

    let orderCtx = { orderName, orderType, cptCode };
    if (orderId) {
      try {
        const order = await ClinicalOrder.findByPk(orderId);
        if (order) orderCtx = { orderName: order.orderName, orderType: order.orderType, cptCode: order.cptCode };
      } catch (e) {}
    }

    const prompt = `You are a healthcare cost estimator AI. Estimate the cost for this clinical order.
Order: ${orderCtx.orderName} (${orderCtx.orderType || 'Unknown'})
CPT Code: ${orderCtx.cptCode || 'Not provided'}
Insurance Type: ${insuranceType || 'Not specified'}

Respond with JSON:
{
  "estimated_cost_usd": {
    "low": <number>,
    "mid": <number>,
    "high": <number>
  },
  "medicare_rate": "<approximate Medicare rate if known>",
  "patient_responsibility_estimate": "<copay/coinsurance estimate>",
  "cost_drivers": ["<factor affecting cost>"],
  "cost_saving_tips": ["<tip>"],
  "billing_codes": {
    "cpt": "<CPT code>",
    "icd10_commonly_paired": ["<ICD-10 code>"]
  },
  "disclaimer": "These are estimates only. Actual costs vary by facility, payer, and patient benefit plan."
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a healthcare cost estimator AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/estimate-cost', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /ai/suggest-loinc-codes
router.post('/ai/suggest-loinc-codes', orderAiRateLimit, async (req, res) => {
  try {
    const { orderText } = req.body;
    if (!orderText) return res.status(400).json({ error: 'orderText is required' });

    const prompt = `You are a clinical terminology AI. Suggest appropriate LOINC codes for this order text.
Order Text: ${orderText}

Respond with JSON:
{
  "suggested_codes": [
    {
      "loinc_code": "<code>",
      "long_common_name": "<LOINC long common name>",
      "component": "<what is being measured>",
      "property": "<property type>",
      "timing": "<time aspect>",
      "system": "<specimen/system>",
      "scale": "<quantitative/ordinal/etc>",
      "confidence": "<high|medium|low>",
      "rationale": "<why this code fits>"
    }
  ],
  "best_match": "<top recommended LOINC code>",
  "notes": "<any disambiguation notes>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical terminology AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/suggest-loinc-codes', null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /ai/validate-against-pathway
router.post('/ai/validate-against-pathway', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId, pathway } = req.body;
    if (!orderId || !pathway) return res.status(400).json({ error: 'orderId and pathway are required' });

    const order = await ClinicalOrder.findByPk(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const prompt = `You are a clinical pathway AI. Validate whether this order aligns with the specified clinical pathway.
Order: ${order.orderName} (${order.orderType})
Details: ${order.orderDetails || 'None'}
Reason: ${order.reasonForOrder || 'Not specified'}
Clinical Pathway: ${pathway}

Respond with JSON:
{
  "pathway_alignment": "<Aligned|Partially Aligned|Not Aligned|Not Applicable>",
  "alignment_score": <0-100>,
  "matching_pathway_steps": ["<step that this order fulfills>"],
  "deviations": ["<where order deviates from pathway>"],
  "missing_orders": ["<other orders the pathway recommends>"],
  "recommendation": "<proceed|modify|replace|consult>",
  "evidence_base": "<guideline/source for pathway>",
  "notes": "<additional clinical notes>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical pathway AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/validate-against-pathway', order.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /ai/prioritize-orders
router.post('/ai/prioritize-orders', orderAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const orders = await ClinicalOrder.findAll({
      where: { patientId, status: { [Op.in]: ['Draft', 'Active'] } },
      order: [['createdAt', 'ASC']]
    });

    if (orders.length === 0) {
      return res.json({ success: true, analysis: { prioritized: [], message: 'No active orders to prioritize' } });
    }

    const orderList = orders.map(o => ({
      id: o.id,
      orderName: o.orderName,
      orderType: o.orderType,
      priority: o.priority,
      reasonForOrder: o.reasonForOrder
    }));

    const prompt = `You are an emergency medicine AI. Reprioritize this patient's pending orders based on clinical urgency.
Current Orders: ${JSON.stringify(orderList, null, 2)}

Respond with JSON:
{
  "prioritized_order": [
    {
      "order_id": <id>,
      "orderName": "<name>",
      "recommended_priority": "<Stat|ASAP|Urgent|Routine>",
      "sequence": <1-based execution order>,
      "rationale": "<clinical reason for this priority>",
      "time_sensitive": <true|false>
    }
  ],
  "critical_first": ["<order name that must happen immediately>"],
  "can_defer": ["<order that can be delayed>"],
  "summary": "<overall prioritization rationale>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an emergency medicine AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/prioritize-orders', patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST /ai/generate-order-set
router.post('/ai/generate-order-set', orderAiRateLimit, async (req, res) => {
  try {
    const { diagnosis, patientId, patientAge, patientGender, allergies } = req.body;
    if (!diagnosis) return res.status(400).json({ error: 'diagnosis is required' });

    let patientCtx = '';
    if (patientId) {
      try {
        const patient = await Patient.findByPk(patientId);
        if (patient) patientCtx = `Age: ${patient.dateOfBirth || 'Unknown'}, Allergies: ${patient.allergies || 'NKDA'}`;
      } catch (e) {}
    }

    const prompt = `You are an emergency medicine physician AI. Generate a complete evidence-based order set for this diagnosis.
Diagnosis: ${diagnosis}
${patientCtx || `Age: ${patientAge || 'Unknown'}, Gender: ${patientGender || 'Unknown'}, Allergies: ${allergies || 'NKDA'}`}

Respond with JSON:
{
  "order_set_name": "<name for this order set>",
  "diagnosis": "${diagnosis}",
  "orders": [
    {
      "orderType": "<Lab|Imaging|Medication|Procedure|Consult|Nursing|Diet>",
      "orderName": "<specific order>",
      "orderDetails": "<dosage, instructions, or specifications>",
      "priority": "<Routine|Urgent|ASAP|Stat>",
      "loincCode": "<if applicable>",
      "cptCode": "<if applicable>",
      "reasonForOrder": "<why this order>",
      "sequence": <execution order number>
    }
  ],
  "monitoring_parameters": ["<what to monitor>"],
  "disposition_criteria": "<when patient can be admitted/discharged>",
  "evidence_source": "<guideline or reference>",
  "estimated_workup_duration": "<time estimate>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an emergency medicine physician AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/generate-order-set', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST /ai/predict-positive-yield
router.post('/ai/predict-positive-yield', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId, patientId, orderName, clinicalContext, preTestProbability } = req.body;

    let orderCtx = { orderName, clinicalContext };
    if (orderId) {
      try {
        const order = await ClinicalOrder.findByPk(orderId);
        if (order) orderCtx = { orderName: order.orderName, clinicalContext: order.reasonForOrder };
      } catch (e) {}
    }

    const prompt = `You are a clinical evidence AI. Predict the positive yield (likelihood of a clinically significant result) for this order.
Order: ${orderCtx.orderName}
Clinical Context: ${orderCtx.clinicalContext || 'Not provided'}
Pre-test Probability Estimate: ${preTestProbability || 'Unknown'}

Respond with JSON:
{
  "positive_yield_estimate": "<percentage range, e.g. 15-25%>",
  "likelihood_ratios": {
    "positive_LR": "<number if known>",
    "negative_LR": "<number if known>"
  },
  "pre_test_probability": "<assessment>",
  "post_test_probability_if_positive": "<estimate>",
  "post_test_probability_if_negative": "<estimate>",
  "clinical_utility": "<high|moderate|low>",
  "factors_increasing_yield": ["<factor>"],
  "factors_decreasing_yield": ["<factor>"],
  "recommendation": "<order|consider alternatives|defer>",
  "evidence_quality": "<strong|moderate|weak>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical evidence AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/predict-positive-yield', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /ai/draft-justification
router.post('/ai/draft-justification', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId, patientId, orderName, orderType, clinicalContext } = req.body;

    let orderCtx = { orderName, orderType, clinicalContext };
    if (orderId) {
      try {
        const order = await ClinicalOrder.findByPk(orderId);
        if (order) orderCtx = {
          orderName: order.orderName,
          orderType: order.orderType,
          clinicalContext: order.reasonForOrder
        };
      } catch (e) {}
    }

    const prompt = `You are a clinical documentation AI. Draft a medical necessity justification for this order suitable for payer review.
Order: ${orderCtx.orderName} (${orderCtx.orderType || 'Unknown'})
Clinical Context: ${orderCtx.clinicalContext || 'Not specified'}

Respond with JSON:
{
  "justification_text": "<full written justification suitable for prior auth or payer review>",
  "key_clinical_indicators": ["<ICD-10 or clinical criteria supporting order>"],
  "applicable_guidelines": ["<guideline name and recommendation>"],
  "urgency_statement": "<statement of clinical urgency if applicable>",
  "alternative_considered": "<what alternatives were considered and why rejected>",
  "expected_clinical_impact": "<what actionable information this order provides>",
  "word_count": <approximate word count of justification_text>
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical documentation AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/draft-justification', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /ai/flag-low-value
router.post('/ai/flag-low-value', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    const order = await ClinicalOrder.findByPk(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const prompt = `You are a clinical value AI aligned with Choosing Wisely and evidence-based medicine. Evaluate whether this order may be low-value or unnecessary.
Order: ${order.orderName} (${order.orderType})
Details: ${order.orderDetails || 'None'}
Reason: ${order.reasonForOrder || 'Not specified'}
Priority: ${order.priority}

Respond with JSON:
{
  "low_value_flag": <true|false>,
  "value_assessment": "<High Value|Uncertain Value|Low Value|Potentially Harmful>",
  "choosing_wisely_match": "<Choosing Wisely recommendation if applicable, else null>",
  "overuse_concern": "<description of overuse concern if any>",
  "evidence_summary": "<brief evidence statement>",
  "recommendation": "<proceed|reconsider|cancel|discuss with attending>",
  "patient_harm_risk": "<low|moderate|high>",
  "cost_impact": "<estimated cost burden>",
  "alternatives": ["<lower-value alternative if applicable>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical value AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/flag-low-value', order.patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /ai/summarize-pending
router.post('/ai/summarize-pending', orderAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const orders = await ClinicalOrder.findAll({
      where: { patientId, status: { [Op.in]: ['Draft', 'Active', 'OnHold'] } },
      order: [['priority', 'ASC'], ['orderedAt', 'ASC']]
    });

    let patientCtx = '';
    try {
      const patient = await Patient.findByPk(patientId);
      if (patient) patientCtx = `${patient.firstName} ${patient.lastName}`;
    } catch (e) {}

    if (orders.length === 0) {
      return res.json({ success: true, analysis: { summary: 'No pending orders for this patient.', orders: [] } });
    }

    const orderList = orders.map(o => ({
      id: o.id,
      orderName: o.orderName,
      orderType: o.orderType,
      priority: o.priority,
      status: o.status,
      orderedAt: o.orderedAt,
      reasonForOrder: o.reasonForOrder
    }));

    const prompt = `You are a clinical AI. Summarize the pending orders for this patient in a concise, clinician-friendly format.
Patient: ${patientCtx || patientId}
Pending Orders (${orders.length} total): ${JSON.stringify(orderList, null, 2)}

Respond with JSON:
{
  "summary": "<2-3 sentence summary of all pending orders and their clinical purpose>",
  "stat_orders": ["<any Stat priority order names>"],
  "by_category": {
    "Lab": ["<order names>"],
    "Imaging": ["<order names>"],
    "Medication": ["<order names>"],
    "Procedure": ["<order names>"],
    "Consult": ["<order names>"],
    "Nursing": ["<order names>"],
    "Diet": ["<order names>"]
  },
  "estimated_completion_time": "<rough timeline to complete all orders>",
  "bottlenecks": ["<potential delays>"],
  "next_action": "<what the care team should focus on first>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/summarize-pending', patientId, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /ai/suggest-cpt
router.post('/ai/suggest-cpt', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId, patientId, orderName, orderType, orderDetails, procedureDescription } = req.body;

    let orderCtx = { orderName, orderType, orderDetails, procedureDescription };
    if (orderId) {
      try {
        const order = await ClinicalOrder.findByPk(orderId);
        if (order) orderCtx = {
          orderName: order.orderName,
          orderType: order.orderType,
          orderDetails: order.orderDetails,
          procedureDescription: order.reasonForOrder
        };
      } catch (e) {}
    }

    const prompt = `You are a medical coding AI. Suggest appropriate CPT codes for this order or procedure.
Order/Procedure: ${orderCtx.orderName || orderCtx.procedureDescription}
Type: ${orderCtx.orderType || 'Unknown'}
Details: ${orderCtx.orderDetails || 'None'}

Respond with JSON:
{
  "suggested_cpt_codes": [
    {
      "cpt_code": "<5-digit code>",
      "description": "<official CPT description>",
      "confidence": "<high|medium|low>",
      "rationale": "<why this code applies>",
      "modifiers": ["<applicable modifier codes>"],
      "rvu": "<relative value units if known>"
    }
  ],
  "primary_cpt": "<most appropriate CPT code>",
  "bundling_rules": "<any bundling considerations>",
  "documentation_required": ["<documentation needed to support billing>"],
  "coding_tips": "<tips to maximize accurate reimbursement>",
  "compliance_notes": "<any compliance considerations>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a medical coding AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/suggest-cpt', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /ai/recommend-prep-instructions
router.post('/ai/recommend-prep-instructions', orderAiRateLimit, async (req, res) => {
  try {
    const { orderId, patientId, orderName, orderType, patientAllergies, patientMedications } = req.body;

    let orderCtx = { orderName, orderType };
    let patientAllergiesCtx = patientAllergies;
    let patientMedsCtx = patientMedications;

    if (orderId) {
      try {
        const order = await ClinicalOrder.findByPk(orderId, {
          include: [{ model: Patient, as: 'patient', attributes: ['allergies'] }]
        });
        if (order) {
          orderCtx = { orderName: order.orderName, orderType: order.orderType };
          if (!patientAllergiesCtx && order.patient?.allergies) patientAllergiesCtx = order.patient.allergies;
        }
      } catch (e) {}
    }

    const prompt = `You are a clinical AI. Provide patient preparation instructions for this clinical order.
Order: ${orderCtx.orderName} (${orderCtx.orderType || 'Unknown'})
Patient Allergies: ${patientAllergiesCtx || 'NKDA'}
Current Medications: ${patientMedsCtx || 'Not specified'}

Respond with JSON:
{
  "prep_instructions": {
    "patient_facing": "<plain-language instructions for patient>",
    "staff_facing": "<clinical instructions for nursing/tech staff>"
  },
  "fasting_required": <true|false>,
  "fasting_duration_hours": <number or null>,
  "medications_to_hold": ["<medication to hold and duration>"],
  "medications_to_continue": ["<medication to continue>"],
  "contrast_considerations": "<if imaging, contrast allergy protocol if needed>",
  "timing_requirements": "<when this order should be performed relative to other orders>",
  "patient_education_points": ["<key teaching point>"],
  "contraindications_to_check": ["<safety check before proceeding>"],
  "equipment_needed": ["<item needed for order execution>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a clinical AI. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);
    await persistAiResult(req.user?.id, '/ai/orders/recommend-prep-instructions', patientId || null, parsed, aiResult.model);
    res.json({ success: true, analysis: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
