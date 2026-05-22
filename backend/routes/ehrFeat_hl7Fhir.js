const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { FhirResource, Patient, AuditLog, AiResult } = require('../models');
const router = express.Router();

// ── In-memory rate limiter: max 20 AI calls per hour per user/IP ─────────────
const fhirRateLimitMap = new Map();
function fhirAiRateLimit(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const limit = 20;

  const entry = fhirRateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  fhirRateLimitMap.set(key, entry);

  if (entry.count > limit) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 20 AI calls per hour.' });
  }
  next();
}

// ── 3-strategy JSON parser for AI responses ──────────────────────────────────
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

// ── Apply auth to all routes ─────────────────────────────────────────────────
router.use(auth);

// ═════════════════════════════════════════════════════════════════════════════
//  CRUD ENDPOINTS (18 + 1 bonus)
// ═════════════════════════════════════════════════════════════════════════════

// 1. GET / — paginated list with optional ?resourceType and ?validationStatus filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.resourceType) where.resourceType = req.query.resourceType;
    if (req.query.validationStatus) where.validationStatus = req.query.validationStatus;

    const { count, rows } = await FhirResource.findAndCountAll({
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

// 11. GET /count — must come before /:id to avoid param clash
router.get('/count', async (req, res) => {
  try {
    const where = {};
    if (req.query.resourceType) where.resourceType = req.query.resourceType;
    if (req.query.validationStatus) where.validationStatus = req.query.validationStatus;
    if (req.query.sourceSystem) where.sourceSystem = req.query.sourceSystem;

    const total = await FhirResource.count({ where });
    res.json({ total, filters: where });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. GET /search — ?q searches inside fhirJson (TEXT column)
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter ?q is required' });

    const { Op } = require('sequelize');
    const rows = await FhirResource.findAll({
      where: { fhirJson: { [Op.like]: `%${q}%` } },
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    res.json({ data: rows, query: q, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. GET /export/csv — export all resources as CSV
router.get('/export/csv', async (req, res) => {
  try {
    const where = {};
    if (req.query.resourceType) where.resourceType = req.query.resourceType;
    if (req.query.validationStatus) where.validationStatus = req.query.validationStatus;

    const rows = await FhirResource.findAll({ where, order: [['createdAt', 'DESC']] });

    const headers = [
      'id', 'patientId', 'resourceType', 'fhirId', 'versionId',
      'sourceSystem', 'syncDirection', 'validationStatus', 'lastSyncedAt', 'createdAt', 'updatedAt'
    ];

    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };

    const csvLines = [
      headers.join(','),
      ...rows.map(r =>
        headers.map(h => escape(r[h])).join(',')
      )
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fhir_resources.csv"');
    res.send(csvLines.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. POST /import/csv — import resources from CSV body
router.post('/import/csv', async (req, res) => {
  try {
    const { csvData } = req.body;
    if (!csvData) return res.status(400).json({ error: 'csvData (string) is required in body' });

    const lines = csvData.trim().split('\n');
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const created = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const record = {};
      headers.forEach((h, idx) => { record[h] = values[idx] || null; });

      try {
        // Omit auto-managed fields from import
        const { id, createdAt, updatedAt, ...payload } = record;
        if (!payload.resourceType) throw new Error('resourceType is required');
        const newResource = await FhirResource.create(payload);
        created.push(newResource.id);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    }

    res.json({ imported: created.length, failed: errors.length, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. GET /stats/summary — counts by resourceType, validationStatus, sourceSystem
router.get('/stats/summary', async (req, res) => {
  try {
    const { Op, fn, col, literal } = require('sequelize');

    const [byResourceType, byValidationStatus, bySourceSystem, total] = await Promise.all([
      FhirResource.findAll({
        attributes: ['resourceType', [fn('COUNT', col('id')), 'count']],
        group: ['resourceType'],
        raw: true
      }),
      FhirResource.findAll({
        attributes: ['validationStatus', [fn('COUNT', col('id')), 'count']],
        group: ['validationStatus'],
        raw: true
      }),
      FhirResource.findAll({
        attributes: ['sourceSystem', [fn('COUNT', col('id')), 'count']],
        group: ['sourceSystem'],
        raw: true
      }),
      FhirResource.count()
    ]);

    res.json({
      total,
      byResourceType,
      byValidationStatus,
      bySourceSystem
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /by-patient/:patientId
router.get('/by-patient/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const rows = await FhirResource.findAll({
      where: { patientId },
      order: [['createdAt', 'DESC']]
    });
    res.json({ data: rows, patientId, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /by-type/:resourceType — all resources of a given FHIR type
router.get('/by-type/:resourceType', async (req, res) => {
  try {
    const { resourceType } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const { count, rows } = await FhirResource.findAndCountAll({
      where: { resourceType },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      resourceType,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bonus. GET /fhir/Patient/:fhirId — return raw FHIR JSON object for a specific fhirId
router.get('/fhir/Patient/:fhirId', async (req, res) => {
  try {
    const { fhirId } = req.params;
    const resource = await FhirResource.findOne({
      where: { fhirId, resourceType: 'Patient' }
    });
    if (!resource) return res.status(404).json({ error: `FHIR Patient with fhirId '${fhirId}' not found` });

    let fhirObject;
    try {
      fhirObject = JSON.parse(resource.fhirJson);
    } catch {
      fhirObject = { raw: resource.fhirJson };
    }

    res.json(fhirObject);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /batch — create multiple resources
router.post('/batch', async (req, res) => {
  try {
    const { resources } = req.body;
    if (!Array.isArray(resources) || resources.length === 0) {
      return res.status(400).json({ error: 'resources must be a non-empty array' });
    }

    const created = [];
    const errors = [];

    for (let i = 0; i < resources.length; i++) {
      try {
        const item = resources[i];
        if (item.fhirJson && typeof item.fhirJson === 'object') {
          item.fhirJson = JSON.stringify(item.fhirJson);
        }
        const r = await FhirResource.create(item);
        created.push(r);
      } catch (e) {
        errors.push({ index: i, error: e.message });
      }
    }

    res.status(201).json({ created: created.length, failed: errors.length, data: created, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. PUT /batch — update multiple resources by id
router.put('/batch', async (req, res) => {
  try {
    const { resources } = req.body;
    if (!Array.isArray(resources) || resources.length === 0) {
      return res.status(400).json({ error: 'resources must be a non-empty array with id fields' });
    }

    const updated = [];
    const errors = [];

    for (let i = 0; i < resources.length; i++) {
      try {
        const { id, ...updateData } = resources[i];
        if (!id) throw new Error('id is required for each resource in batch update');
        if (updateData.fhirJson && typeof updateData.fhirJson === 'object') {
          updateData.fhirJson = JSON.stringify(updateData.fhirJson);
        }
        const existing = await FhirResource.findByPk(id);
        if (!existing) throw new Error(`Resource with id ${id} not found`);
        await existing.update(updateData);
        updated.push(existing);
      } catch (e) {
        errors.push({ index: i, error: e.message });
      }
    }

    res.json({ updated: updated.length, failed: errors.length, data: updated, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. DELETE /batch — soft-delete multiple resources by ids array
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const { Op } = require('sequelize');
    const [affectedCount] = await FhirResource.update(
      { validationStatus: 'Invalid' },
      { where: { id: { [Op.in]: ids } } }
    );

    res.json({ softDeleted: affectedCount, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /:id/archive — soft-archive by setting validationStatus='Invalid'
router.post('/:id/archive', async (req, res) => {
  try {
    const resource = await FhirResource.findByPk(req.params.id);
    if (!resource) return res.status(404).json({ error: 'FhirResource not found' });

    await resource.update({ validationStatus: 'Invalid' });
    res.json({ success: true, id: resource.id, validationStatus: 'Invalid' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /:id/restore — restore by setting validationStatus='Pending'
router.post('/:id/restore', async (req, res) => {
  try {
    const resource = await FhirResource.findByPk(req.params.id);
    if (!resource) return res.status(404).json({ error: 'FhirResource not found' });

    await resource.update({ validationStatus: 'Pending' });
    res.json({ success: true, id: resource.id, validationStatus: 'Pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. GET /:id/history — audit log entries for a specific resource
router.get('/:id/history', async (req, res) => {
  try {
    const resource = await FhirResource.findByPk(req.params.id);
    if (!resource) return res.status(404).json({ error: 'FhirResource not found' });

    const logs = await AuditLog.findAll({
      where: {
        resourceId: req.params.id,
        resourceType: 'FhirResource'
      },
      order: [['createdAt', 'DESC']],
      limit: 200
    });

    res.json({ data: logs, resourceId: req.params.id, count: logs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /:id — single resource + audit log
router.get('/:id', async (req, res) => {
  try {
    const resource = await FhirResource.findByPk(req.params.id);
    if (!resource) return res.status(404).json({ error: 'FhirResource not found' });

    // Write audit log entry
    try {
      await AuditLog.create({
        userId: req.user?.id || null,
        action: 'view_fhir_resource',
        resourceType: 'FhirResource',
        resourceId: resource.id,
        details: `User viewed FHIR resource id=${resource.id} type=${resource.resourceType}`
      });
    } catch (auditErr) {
      console.error('Audit log write failed:', auditErr.message);
    }

    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST / — create a new FHIR resource
router.post('/', async (req, res) => {
  try {
    const payload = { ...req.body };

    // Serialize fhirJson if caller passed a parsed object
    if (payload.fhirJson && typeof payload.fhirJson === 'object') {
      payload.fhirJson = JSON.stringify(payload.fhirJson);
    }

    if (!payload.validationStatus) payload.validationStatus = 'Pending';

    const resource = await FhirResource.create(payload);
    res.status(201).json(resource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT /:id — update an existing FHIR resource
router.put('/:id', async (req, res) => {
  try {
    const resource = await FhirResource.findByPk(req.params.id);
    if (!resource) return res.status(404).json({ error: 'FhirResource not found' });

    const payload = { ...req.body };
    if (payload.fhirJson && typeof payload.fhirJson === 'object') {
      payload.fhirJson = JSON.stringify(payload.fhirJson);
    }

    await resource.update(payload);
    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE /:id — soft-delete (validationStatus='Invalid')
router.delete('/:id', async (req, res) => {
  try {
    const resource = await FhirResource.findByPk(req.params.id);
    if (!resource) return res.status(404).json({ error: 'FhirResource not found' });

    await resource.update({ validationStatus: 'Invalid' });
    res.json({ success: true, id: resource.id, message: 'Resource soft-deleted (validationStatus set to Invalid)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  AI VERB ENDPOINTS (POST /ai/<verb>) — rate-limited, persisted to AiResult
// ═════════════════════════════════════════════════════════════════════════════

// 1. POST /ai/map-to-fhir
router.post('/ai/map-to-fhir', fhirAiRateLimit, async (req, res) => {
  try {
    const { sourceData, targetResourceType } = req.body;
    if (!sourceData || !targetResourceType) {
      return res.status(400).json({ error: 'sourceData and targetResourceType are required' });
    }

    const prompt = `You are a FHIR interoperability expert. Map the following source data to a valid HL7 FHIR ${targetResourceType} resource.

Source Data:
${typeof sourceData === 'object' ? JSON.stringify(sourceData, null, 2) : sourceData}

Target FHIR Resource Type: ${targetResourceType}

Respond ONLY with valid JSON representing a complete, standards-compliant FHIR ${targetResourceType} resource, including resourceType, id (if known), meta, and all relevant elements.`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 mapping expert. Respond ONLY with valid FHIR JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/map-to-fhir', null, parsed, aiResult.model);
    res.json({ success: true, fhirResource: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /ai/validate-fhir
router.post('/ai/validate-fhir', fhirAiRateLimit, async (req, res) => {
  try {
    const { resourceId } = req.body;
    if (!resourceId) return res.status(400).json({ error: 'resourceId is required' });

    const resource = await FhirResource.findByPk(resourceId);
    if (!resource) return res.status(404).json({ error: 'FhirResource not found' });

    let fhirJson;
    try { fhirJson = JSON.parse(resource.fhirJson); } catch { fhirJson = resource.fhirJson; }

    const prompt = `You are a FHIR R4 validator. Validate the following FHIR resource for conformance with HL7 FHIR R4 specification.

Resource Type: ${resource.resourceType}
FHIR Resource:
${JSON.stringify(fhirJson, null, 2)}

Respond ONLY with valid JSON in this format:
{
  "isValid": <true|false>,
  "validationStatus": "<Valid|Invalid|Warning>",
  "errors": [{ "field": "<path>", "message": "<error>" }],
  "warnings": [{ "field": "<path>", "message": "<warning>" }],
  "suggestions": ["<improvement suggestion>"],
  "conformanceScore": <0-100>,
  "summary": "<brief overall assessment>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 conformance validator. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    // Update the resource's validation fields based on AI result
    try {
      const updatePayload = {};
      if (parsed.validationStatus) updatePayload.validationStatus = parsed.validationStatus;
      if (parsed.errors && parsed.errors.length > 0) {
        updatePayload.validationErrors = JSON.stringify(parsed.errors);
      }
      if (Object.keys(updatePayload).length > 0) {
        await resource.update(updatePayload);
      }
    } catch (e) {
      console.error('Failed to update resource validation status:', e.message);
    }

    await persistAiResult(req.user?.id, '/ai/fhir/validate-fhir', resource.patientId, parsed, aiResult.model);
    res.json({ success: true, validation: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /ai/extract-from-bundle
router.post('/ai/extract-from-bundle', fhirAiRateLimit, async (req, res) => {
  try {
    const { bundleJson } = req.body;
    if (!bundleJson) return res.status(400).json({ error: 'bundleJson is required' });

    const bundleStr = typeof bundleJson === 'object' ? JSON.stringify(bundleJson, null, 2) : bundleJson;

    const prompt = `You are a FHIR bundle processing expert. Extract and categorize all individual resources from the following FHIR Bundle.

FHIR Bundle:
${bundleStr}

Respond ONLY with valid JSON in this format:
{
  "bundleType": "<transaction|collection|searchset|etc>",
  "totalEntries": <number>,
  "resources": [
    {
      "resourceType": "<type>",
      "id": "<id or null>",
      "summary": "<one-line summary of this resource>",
      "clinicallySignificant": <true|false>,
      "extractedData": { <key fields from the resource> }
    }
  ],
  "clinicalHighlights": ["<notable clinical finding>"],
  "missingCriticalResources": ["<resource type that should be present but is missing>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 bundle processing expert. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/extract-from-bundle', null, parsed, aiResult.model);
    res.json({ success: true, extraction: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /ai/translate-cda-to-fhir
router.post('/ai/translate-cda-to-fhir', fhirAiRateLimit, async (req, res) => {
  try {
    const { cdaXml } = req.body;
    if (!cdaXml) return res.status(400).json({ error: 'cdaXml is required' });

    const prompt = `You are an expert in CDA-to-FHIR transformation. Translate the following HL7 CDA (Clinical Document Architecture) XML document into a valid FHIR R4 Bundle.

CDA XML:
${cdaXml}

Respond ONLY with valid JSON representing a FHIR R4 Bundle resource containing all translated resources (Patient, Encounter, Conditions, Medications, Observations, etc.) derived from the CDA document. Include a translation summary field "_translationNotes" at the top level of the bundle.`;

    const aiResult = await callOpenRouter(prompt, 'You are a CDA-to-FHIR R4 translation expert. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/translate-cda-to-fhir', null, parsed, aiResult.model);
    res.json({ success: true, fhirBundle: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. POST /ai/generate-patient-bundle
router.post('/ai/generate-patient-bundle', fhirAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const [patient, resources] = await Promise.all([
      Patient.findByPk(patientId).catch(() => null),
      FhirResource.findAll({ where: { patientId }, limit: 100 }).catch(() => [])
    ]);

    const prompt = `You are a FHIR R4 Bundle generator. Create a comprehensive FHIR Patient Bundle for the following patient using all available FHIR resources.

Patient Record:
${JSON.stringify(patient || { id: patientId }, null, 2)}

Existing FHIR Resources (${resources.length} total):
${resources.map(r => `- ${r.resourceType} (id=${r.fhirId || r.id}): ${r.fhirJson ? r.fhirJson.substring(0, 200) : 'no fhirJson'}`).join('\n')}

Generate a complete FHIR R4 transaction Bundle with all resources as entries. Respond ONLY with valid JSON.`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 Bundle generator. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/generate-patient-bundle', patientId, parsed, aiResult.model);
    res.json({ success: true, fhirBundle: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. POST /ai/suggest-extensions
router.post('/ai/suggest-extensions', fhirAiRateLimit, async (req, res) => {
  try {
    const { resourceId, resourceType, useCase } = req.body;

    let fhirJson = null;
    let resolvedResourceType = resourceType;

    if (resourceId) {
      const resource = await FhirResource.findByPk(resourceId).catch(() => null);
      if (resource) {
        resolvedResourceType = resource.resourceType;
        try { fhirJson = JSON.parse(resource.fhirJson); } catch { fhirJson = resource.fhirJson; }
      }
    }

    const prompt = `You are a FHIR R4 extension design expert. Suggest appropriate FHIR extensions for the following resource and use case.

Resource Type: ${resolvedResourceType || 'Unknown'}
Use Case / Clinical Context: ${useCase || 'General ER/clinical workflow'}
${fhirJson ? `Current Resource:\n${JSON.stringify(fhirJson, null, 2)}` : ''}

Respond ONLY with valid JSON in this format:
{
  "resourceType": "${resolvedResourceType || 'Unknown'}",
  "suggestedExtensions": [
    {
      "url": "<extension URL>",
      "name": "<human-readable name>",
      "valueType": "<string|boolean|CodeableConcept|Quantity|etc>",
      "rationale": "<why this extension is useful>",
      "example": { <example extension value> },
      "standardReference": "<HL7/US Core/custom>"
    }
  ],
  "existingStandardExtensions": ["<relevant standard extension URL>"],
  "implementationNotes": "<any implementation guidance>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 extension expert. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/suggest-extensions', null, parsed, aiResult.model);
    res.json({ success: true, extensions: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. POST /ai/classify-resource-type
router.post('/ai/classify-resource-type', fhirAiRateLimit, async (req, res) => {
  try {
    const { jsonObject } = req.body;
    if (!jsonObject) return res.status(400).json({ error: 'jsonObject is required' });

    const jsonStr = typeof jsonObject === 'object' ? JSON.stringify(jsonObject, null, 2) : jsonObject;

    const prompt = `You are a FHIR R4 classification expert. Determine the appropriate FHIR resource type for the following JSON object.

JSON Object:
${jsonStr}

Respond ONLY with valid JSON in this format:
{
  "primaryResourceType": "<FHIR resource type>",
  "confidence": "<high|medium|low>",
  "alternativeResourceTypes": ["<type>"],
  "rationale": "<explanation of why this resource type was selected>",
  "keyFieldsIdentified": ["<field that helped classify>"],
  "missingRequiredFields": ["<field required by FHIR but missing>"],
  "suggestedMapping": { "<sourceField>": "<fhirPath>" }
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 resource classifier. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/classify-resource-type', null, parsed, aiResult.model);
    res.json({ success: true, classification: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. POST /ai/detect-missing-elements
router.post('/ai/detect-missing-elements', fhirAiRateLimit, async (req, res) => {
  try {
    const { resourceId, fhirJson: inlineFhirJson, resourceType } = req.body;

    let fhirJson = null;
    let resolvedType = resourceType;

    if (resourceId) {
      const resource = await FhirResource.findByPk(resourceId).catch(() => null);
      if (resource) {
        resolvedType = resource.resourceType;
        try { fhirJson = JSON.parse(resource.fhirJson); } catch { fhirJson = resource.fhirJson; }
      }
    } else if (inlineFhirJson) {
      fhirJson = typeof inlineFhirJson === 'object' ? inlineFhirJson : JSON.parse(inlineFhirJson);
    }

    if (!fhirJson) return res.status(400).json({ error: 'Provide resourceId or fhirJson' });

    const prompt = `You are a FHIR R4 conformance expert. Identify all missing or incomplete elements in the following FHIR resource.

Resource Type: ${resolvedType || fhirJson.resourceType || 'Unknown'}
FHIR Resource:
${JSON.stringify(fhirJson, null, 2)}

Respond ONLY with valid JSON in this format:
{
  "resourceType": "<type>",
  "missingRequired": [{ "field": "<path>", "cardinality": "1..1", "reason": "<why required>" }],
  "missingRecommended": [{ "field": "<path>", "reason": "<why recommended>" }],
  "incompleteElements": [{ "field": "<path>", "issue": "<what is incomplete>" }],
  "codeSystemIssues": [{ "field": "<path>", "issue": "<coding problem>" }],
  "overallCompleteness": <0-100>,
  "priorityFixes": ["<most important fix first>"]
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 completeness auditor. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/detect-missing-elements', null, parsed, aiResult.model);
    res.json({ success: true, missingElements: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. POST /ai/summarize-bundle
router.post('/ai/summarize-bundle', fhirAiRateLimit, async (req, res) => {
  try {
    const { bundleJson, patientId } = req.body;

    let bundleStr;
    if (bundleJson) {
      bundleStr = typeof bundleJson === 'object' ? JSON.stringify(bundleJson, null, 2) : bundleJson;
    } else if (patientId) {
      const resources = await FhirResource.findAll({ where: { patientId }, limit: 100 }).catch(() => []);
      bundleStr = JSON.stringify({ resourceType: 'Bundle', entry: resources.map(r => ({ resource: JSON.parse(r.fhirJson || '{}') })) }, null, 2);
    } else {
      return res.status(400).json({ error: 'Provide bundleJson or patientId' });
    }

    const prompt = `You are a clinical informatics expert. Summarize the following FHIR Bundle into a concise, clinically relevant narrative for ER staff.

FHIR Bundle:
${bundleStr}

Provide:
1. **Patient Overview** — who is this patient, key demographics
2. **Active Conditions** — current diagnoses and problems
3. **Medications** — current medication list
4. **Recent Encounters** — relevant visit history
5. **Pending/Active Orders** — labs, imaging, procedures
6. **Clinical Alerts** — allergies, critical values, high-risk flags
7. **Bundle Completeness** — what is present and what is missing
8. **Recommended Next Steps** — suggested clinical actions based on the bundle`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/fhir/summarize-bundle', patientId || null, aiResult.result, aiResult.model);
    res.json({ success: true, summary: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. POST /ai/generate-consent-resource
router.post('/ai/generate-consent-resource', fhirAiRateLimit, async (req, res) => {
  try {
    const { patientId, scope } = req.body;
    if (!patientId || !scope) return res.status(400).json({ error: 'patientId and scope are required' });

    const patient = await Patient.findByPk(patientId).catch(() => null);

    const prompt = `You are a FHIR R4 Consent resource generator for a hospital ER setting.

Generate a complete, standards-compliant FHIR R4 Consent resource for the following patient and consent scope.

Patient: ${JSON.stringify(patient || { id: patientId }, null, 2)}
Consent Scope: ${scope}
Generated At: ${new Date().toISOString()}

Respond ONLY with valid JSON representing a complete FHIR R4 Consent resource including resourceType, status, scope, category, patient reference, dateTime, provision, and all required elements.`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 Consent resource generator. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/generate-consent-resource', patientId, parsed, aiResult.model);
    res.json({ success: true, consentResource: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. POST /ai/map-cpt-to-procedure
router.post('/ai/map-cpt-to-procedure', fhirAiRateLimit, async (req, res) => {
  try {
    const { cptCodes, patientId } = req.body;
    if (!cptCodes) return res.status(400).json({ error: 'cptCodes (string or array) is required' });

    const codesStr = Array.isArray(cptCodes) ? cptCodes.join(', ') : cptCodes;

    const prompt = `You are a FHIR R4 coding expert. Map the following CPT codes to FHIR R4 Procedure resources.

CPT Codes: ${codesStr}
${patientId ? `Patient ID: ${patientId}` : ''}

Respond ONLY with valid JSON in this format:
{
  "mappings": [
    {
      "cptCode": "<code>",
      "displayName": "<procedure name>",
      "fhirProcedure": { <complete FHIR R4 Procedure resource with coding> },
      "category": "<procedure category>",
      "bodysite": "<body site if applicable>",
      "typicalDuration": "<estimated duration>",
      "notes": "<any mapping notes>"
    }
  ],
  "unmappedCodes": ["<code that could not be mapped>"],
  "totalMapped": <number>
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 CPT mapping expert. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/map-cpt-to-procedure', patientId || null, parsed, aiResult.model);
    res.json({ success: true, procedureMappings: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. POST /ai/map-icd-to-condition
router.post('/ai/map-icd-to-condition', fhirAiRateLimit, async (req, res) => {
  try {
    const { icdCodes, icdVersion, patientId } = req.body;
    if (!icdCodes) return res.status(400).json({ error: 'icdCodes (string or array) is required' });

    const codesStr = Array.isArray(icdCodes) ? icdCodes.join(', ') : icdCodes;
    const version = icdVersion || 'ICD-10-CM';

    const prompt = `You are a FHIR R4 clinical coding expert. Map the following ${version} codes to FHIR R4 Condition resources.

${version} Codes: ${codesStr}
${patientId ? `Patient ID: ${patientId}` : ''}

Respond ONLY with valid JSON in this format:
{
  "icdVersion": "${version}",
  "mappings": [
    {
      "icdCode": "<code>",
      "displayName": "<condition name>",
      "fhirCondition": { <complete FHIR R4 Condition resource with coding> },
      "category": "<problem-list-item|encounter-diagnosis|health-concern>",
      "clinicalStatus": "<active|recurrence|relapse|inactive|remission|resolved>",
      "severity": "<mild|moderate|severe>",
      "notes": "<any mapping notes>"
    }
  ],
  "unmappedCodes": ["<code>"],
  "totalMapped": <number>
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 ICD mapping expert. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/map-icd-to-condition', patientId || null, parsed, aiResult.model);
    res.json({ success: true, conditionMappings: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. POST /ai/generate-careplan-resource
router.post('/ai/generate-careplan-resource', fhirAiRateLimit, async (req, res) => {
  try {
    const { patientId } = req.body;
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const [patient, resources] = await Promise.all([
      Patient.findByPk(patientId).catch(() => null),
      FhirResource.findAll({ where: { patientId }, limit: 50 }).catch(() => [])
    ]);

    const conditions = resources.filter(r => r.resourceType === 'Condition');
    const medications = resources.filter(r => r.resourceType === 'MedicationRequest' || r.resourceType === 'Medication');
    const observations = resources.filter(r => r.resourceType === 'Observation');

    const prompt = `You are a FHIR R4 CarePlan generator for an emergency department. Generate a comprehensive FHIR R4 CarePlan resource.

Patient: ${JSON.stringify(patient || { id: patientId }, null, 2)}
Active Conditions (${conditions.length}): ${conditions.map(c => c.resourceType).join(', ') || 'None'}
Current Medications (${medications.length}): ${medications.length} records
Recent Observations (${observations.length}): ${observations.length} records

Respond ONLY with valid JSON representing a complete FHIR R4 CarePlan resource including resourceType, status (active), intent (plan), title, description, subject reference, period, activity array, goal references, and care team.`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 CarePlan generator. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/generate-careplan-resource', patientId, parsed, aiResult.model);
    res.json({ success: true, carePlanResource: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. POST /ai/normalize-codes
router.post('/ai/normalize-codes', fhirAiRateLimit, async (req, res) => {
  try {
    const { codes, sourceSystem, targetSystem } = req.body;
    if (!codes) return res.status(400).json({ error: 'codes (string or array) is required' });

    const codesStr = Array.isArray(codes) ? codes.join(', ') : codes;

    const prompt = `You are a healthcare terminology normalization expert. Normalize and standardize the following codes.

Input Codes: ${codesStr}
Source System: ${sourceSystem || 'Unknown/Mixed'}
Target System: ${targetSystem || 'FHIR standard (SNOMED CT, LOINC, RxNorm, ICD-10)'}

Respond ONLY with valid JSON in this format:
{
  "normalizations": [
    {
      "originalCode": "<input code>",
      "originalSystem": "<detected source system>",
      "normalizedCode": "<standardized code>",
      "normalizedSystem": "<target code system URL>",
      "displayName": "<human-readable name>",
      "confidence": "<high|medium|low>",
      "alternativeCodes": [{ "system": "<url>", "code": "<code>", "display": "<name>" }],
      "notes": "<any normalization notes>"
    }
  ],
  "failedNormalizations": ["<code that could not be normalized>"],
  "summary": "<overall normalization summary>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a healthcare terminology expert. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/normalize-codes', null, parsed, aiResult.model);
    res.json({ success: true, normalizedCodes: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /ai/suggest-references
router.post('/ai/suggest-references', fhirAiRateLimit, async (req, res) => {
  try {
    const { resourceId, fhirJson: inlineFhirJson, resourceType } = req.body;

    let fhirJson = null;
    let resolvedType = resourceType;

    if (resourceId) {
      const resource = await FhirResource.findByPk(resourceId).catch(() => null);
      if (resource) {
        resolvedType = resource.resourceType;
        try { fhirJson = JSON.parse(resource.fhirJson); } catch { fhirJson = resource.fhirJson; }
      }
    } else if (inlineFhirJson) {
      fhirJson = typeof inlineFhirJson === 'object' ? inlineFhirJson : JSON.parse(inlineFhirJson);
    }

    if (!fhirJson) return res.status(400).json({ error: 'Provide resourceId or fhirJson' });

    const prompt = `You are a FHIR R4 resource linking expert. Suggest appropriate references that should be added to the following FHIR resource to improve interoperability and completeness.

Resource Type: ${resolvedType || fhirJson.resourceType || 'Unknown'}
FHIR Resource:
${JSON.stringify(fhirJson, null, 2)}

Respond ONLY with valid JSON in this format:
{
  "resourceType": "<type>",
  "suggestedReferences": [
    {
      "field": "<fhir path where reference should be added>",
      "referenceType": "<FHIR resource type to reference>",
      "cardinality": "<0..1|0..*|1..1>",
      "rationale": "<why this reference is important>",
      "exampleReference": { "reference": "<ResourceType/id>", "display": "<display name>" },
      "priority": "<required|recommended|optional>"
    }
  ],
  "existingReferences": [{ "field": "<path>", "value": "<current reference>" }],
  "missingCriticalReferences": ["<description of critical missing reference>"],
  "implementationNotes": "<guidance on implementing these references>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 reference linking expert. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/suggest-references', null, parsed, aiResult.model);
    res.json({ success: true, referenceSuggestions: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /ai/draft-fhir-query
router.post('/ai/draft-fhir-query', fhirAiRateLimit, async (req, res) => {
  try {
    const { naturalLanguageQuery } = req.body;
    if (!naturalLanguageQuery) return res.status(400).json({ error: 'naturalLanguageQuery is required' });

    const prompt = `You are a FHIR R4 query expert. Translate the following natural language query into one or more FHIR RESTful API queries (search parameters, operations, or GraphQL).

Natural Language Query: "${naturalLanguageQuery}"

Respond ONLY with valid JSON in this format:
{
  "naturalLanguageQuery": "${naturalLanguageQuery.replace(/"/g, '\\"')}",
  "fhirQueries": [
    {
      "description": "<what this query retrieves>",
      "method": "<GET|POST>",
      "endpoint": "<FHIR base URL path e.g. /Patient?family=Smith>",
      "searchParameters": { "<param>": "<value>" },
      "example": "<full example URL>",
      "notes": "<any important notes about this query>"
    }
  ],
  "alternativeApproaches": ["<alternative query strategy>"],
  "requiredCapabilities": ["<FHIR capability needed>"],
  "graphqlEquivalent": "<FHIR GraphQL equivalent if applicable>",
  "interpretation": "<how the NL query was interpreted>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are a FHIR R4 query translator. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/fhir/draft-fhir-query', null, parsed, aiResult.model);
    res.json({ success: true, fhirQuery: parsed, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
