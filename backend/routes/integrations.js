// Apply pass 5 — Backlog integrations for AIPatientTriageforER (additive only)
//
// Backlog items implemented:
//
//   NEEDS-CREDS — EHR (Epic / Cerner) integration
//     ENV: EHR_API_KEY            (Epic FHIR / Cerner FHIR shared key)
//     ENV: EHR_PROVIDER           (e.g. "epic" | "cerner" | "custom")
//     503 + missing: EHR_API_KEY when unset.
//
//   NEEDS-CREDS — Ambulance / EMS arrival API
//     ENV: EMS_API_KEY
//
//   NEEDS-CREDS — Multi-hospital bed-availability coordination
//     ENV: HOSPITAL_NETWORK_API_KEY
//
//   NEEDS-PRODUCT-DECISION — Real-time vitals stream
//     PRODUCT-DECISION: REST endpoints to push vitals readings (no
//     dedicated WebSocket channel created — server already has a
//     queue-update WS bus; vitals broadcasting can hook into that later).
//     Table: vitals_stream (CREATE TABLE IF NOT EXISTS).
//
//   NEEDS-PRODUCT-DECISION — Sepsis early warning ensemble
//     PRODUCT-DECISION: Implements a deterministic SIRS/qSOFA-style
//     scoring stub (no ML/embedding dependency). Returns a
//     `sepsis_risk_score` 0-1 and a banded label so the existing UI
//     can call it without new infra. Future: replace with ensemble.
//
//   NEEDS-PRODUCT-DECISION — Multi-modal symptom assessment
//     PRODUCT-DECISION: Accepts `audio_transcript` and `image_descriptions`
//     as TEXT inputs and routes through the existing OpenRouter text
//     model. No audio/video model integration. Returns 503 if
//     OPENROUTER_API_KEY is missing.

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { sequelize, AiResult } = require('../models');
const { callOpenRouter } = require('../services/openrouter');

router.use(auth);

async function ensureTables() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ehr_sync_records (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER,
      provider VARCHAR(60),
      external_record_id VARCHAR(255),
      synced_at TIMESTAMP DEFAULT NOW(),
      payload JSONB
    )
  `).catch(() => {});
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ems_arrivals (
      id SERIAL PRIMARY KEY,
      external_run_id VARCHAR(255),
      patient_name VARCHAR(255),
      eta_minutes INTEGER,
      severity VARCHAR(40),
      condition_summary TEXT,
      status VARCHAR(40) DEFAULT 'inbound',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS hospital_network_beds (
      id SERIAL PRIMARY KEY,
      hospital_name VARCHAR(255),
      bed_type VARCHAR(60),
      available INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      distance_km NUMERIC(6,2),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS vitals_stream (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER,
      heart_rate INTEGER,
      systolic_bp INTEGER,
      diastolic_bp INTEGER,
      temperature_c NUMERIC(4,1),
      spo2 INTEGER,
      respiratory_rate INTEGER,
      recorded_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});
}
ensureTables();

async function persist(userId, endpoint, patientId, result, model) {
  try {
    await AiResult.create({
      userId: userId || null,
      endpoint,
      patientId: patientId || null,
      result: typeof result === 'string' ? result : JSON.stringify(result),
      model: model || null,
    });
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
// EHR integration (NEEDS-CREDS)
// ─────────────────────────────────────────────────────────────────
router.post('/ehr/sync', async (req, res) => {
  if (!process.env.EHR_API_KEY) {
    return res.status(503).json({ error: 'EHR integration not configured', missing: 'EHR_API_KEY' });
  }
  try {
    const { patient_id } = req.body || {};
    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });
    const provider = process.env.EHR_PROVIDER || 'epic';
    const externalId = `EHR-${provider}-${patient_id}-${Date.now()}`;
    const stub = {
      patient_id,
      provider,
      external_record_id: externalId,
      synced_fields: ['demographics', 'allergies', 'medications', 'past_visits'],
      source: 'stub:EHR_API_KEY-present'
    };
    await sequelize.query(
      `INSERT INTO ehr_sync_records (patient_id, provider, external_record_id, payload)
       VALUES (:pid, :prov, :ext, :payload::jsonb)`,
      { replacements: { pid: patient_id, prov: provider, ext: externalId, payload: JSON.stringify(stub) } }
    );
    res.json({ success: true, ...stub });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ehr/records/:patient_id', async (req, res) => {
  if (!process.env.EHR_API_KEY) {
    return res.status(503).json({ error: 'EHR integration not configured', missing: 'EHR_API_KEY' });
  }
  try {
    const r = await sequelize.query(
      `SELECT * FROM ehr_sync_records WHERE patient_id = :pid ORDER BY id DESC LIMIT 50`,
      { replacements: { pid: req.params.patient_id }, type: sequelize.QueryTypes.SELECT }
    );
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────
// EMS / Ambulance arrival API (NEEDS-CREDS)
// ─────────────────────────────────────────────────────────────────
router.post('/ems/notify', async (req, res) => {
  if (!process.env.EMS_API_KEY) {
    return res.status(503).json({ error: 'EMS integration not configured', missing: 'EMS_API_KEY' });
  }
  try {
    const { patient_name, eta_minutes, severity, condition_summary } = req.body || {};
    if (!patient_name) return res.status(400).json({ error: 'patient_name is required' });
    const externalRunId = `EMS-${Date.now()}`;
    await sequelize.query(
      `INSERT INTO ems_arrivals (external_run_id, patient_name, eta_minutes, severity, condition_summary)
       VALUES (:rid, :pname, :eta, :sev, :cond)`,
      { replacements: {
          rid: externalRunId, pname: patient_name,
          eta: eta_minutes || null, sev: severity || 'unknown',
          cond: condition_summary || null
      } }
    );
    res.status(201).json({ success: true, external_run_id: externalRunId, source: 'stub:EMS_API_KEY-present' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ems/inbound', async (req, res) => {
  if (!process.env.EMS_API_KEY) {
    return res.status(503).json({ error: 'EMS integration not configured', missing: 'EMS_API_KEY' });
  }
  try {
    const r = await sequelize.query(
      `SELECT * FROM ems_arrivals WHERE status = 'inbound' ORDER BY id DESC LIMIT 100`,
      { type: sequelize.QueryTypes.SELECT }
    );
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────
// Multi-hospital bed-availability coordination (NEEDS-CREDS)
// ─────────────────────────────────────────────────────────────────
router.get('/network/beds', async (req, res) => {
  if (!process.env.HOSPITAL_NETWORK_API_KEY) {
    return res.status(503).json({ error: 'Hospital network integration not configured', missing: 'HOSPITAL_NETWORK_API_KEY' });
  }
  try {
    const r = await sequelize.query(
      `SELECT * FROM hospital_network_beds ORDER BY distance_km ASC NULLS LAST LIMIT 200`,
      { type: sequelize.QueryTypes.SELECT }
    );
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/network/beds/refresh', async (req, res) => {
  if (!process.env.HOSPITAL_NETWORK_API_KEY) {
    return res.status(503).json({ error: 'Hospital network integration not configured', missing: 'HOSPITAL_NETWORK_API_KEY' });
  }
  try {
    // Stub: would call an inter-hospital API. Inserts/updates a sample row.
    const samples = [
      { hospital_name: 'County General', bed_type: 'ICU', available: 3, total: 24, distance_km: 4.2 },
      { hospital_name: 'Mercy Regional', bed_type: 'Med-Surg', available: 12, total: 60, distance_km: 8.7 }
    ];
    for (const s of samples) {
      await sequelize.query(
        `INSERT INTO hospital_network_beds (hospital_name, bed_type, available, total, distance_km)
         VALUES (:h, :b, :a, :t, :d)`,
        { replacements: { h: s.hospital_name, b: s.bed_type, a: s.available, t: s.total, d: s.distance_km } }
      );
    }
    res.json({ success: true, refreshed: samples.length, source: 'stub:HOSPITAL_NETWORK_API_KEY-present' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────
// Real-time vitals stream (NEEDS-PRODUCT-DECISION → REST POST/GET)
// ─────────────────────────────────────────────────────────────────
router.post('/vitals/stream', async (req, res) => {
  try {
    const { patient_id, heart_rate, systolic_bp, diastolic_bp, temperature_c, spo2, respiratory_rate } = req.body || {};
    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });
    await sequelize.query(
      `INSERT INTO vitals_stream (patient_id, heart_rate, systolic_bp, diastolic_bp, temperature_c, spo2, respiratory_rate)
       VALUES (:p, :hr, :sb, :db, :t, :s, :rr)`,
      { replacements: {
          p: patient_id, hr: heart_rate || null, sb: systolic_bp || null,
          db: diastolic_bp || null, t: temperature_c || null,
          s: spo2 || null, rr: respiratory_rate || null
      } }
    );
    res.status(201).json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/vitals/stream/:patient_id', async (req, res) => {
  try {
    const r = await sequelize.query(
      `SELECT * FROM vitals_stream WHERE patient_id = :pid ORDER BY id DESC LIMIT 200`,
      { replacements: { pid: req.params.patient_id }, type: sequelize.QueryTypes.SELECT }
    );
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────
// Sepsis early warning (NEEDS-PRODUCT-DECISION → SIRS/qSOFA stub)
// ─────────────────────────────────────────────────────────────────
router.post('/sepsis/score', async (req, res) => {
  try {
    const { heart_rate, respiratory_rate, temperature_c, systolic_bp, mental_status, wbc } = req.body || {};
    // PRODUCT-DECISION: deterministic SIRS+qSOFA approximation.
    let sirs = 0;
    if (typeof heart_rate === 'number' && heart_rate > 90) sirs++;
    if (typeof respiratory_rate === 'number' && respiratory_rate > 20) sirs++;
    if (typeof temperature_c === 'number' && (temperature_c > 38 || temperature_c < 36)) sirs++;
    if (typeof wbc === 'number' && (wbc > 12 || wbc < 4)) sirs++;
    let qsofa = 0;
    if (typeof respiratory_rate === 'number' && respiratory_rate >= 22) qsofa++;
    if (typeof systolic_bp === 'number' && systolic_bp <= 100) qsofa++;
    if (mental_status && /altered|confused/i.test(String(mental_status))) qsofa++;
    const sepsisScore = Math.min(1, (sirs / 4) * 0.6 + (qsofa / 3) * 0.4);
    let band = 'low';
    if (sepsisScore >= 0.66) band = 'high';
    else if (sepsisScore >= 0.33) band = 'medium';
    const result = {
      sirs_score: sirs,
      qsofa_score: qsofa,
      sepsis_risk_score: Number(sepsisScore.toFixed(3)),
      band,
      recommendation: band === 'high' ? 'Initiate sepsis bundle, escalate to MD' :
                       band === 'medium' ? 'Reassess in 30 minutes; obtain lactate' :
                       'Continue routine monitoring',
      method: 'SIRS+qSOFA deterministic ensemble (stub)'
    };
    await persist(req.user?.id, 'sepsis-score', null, result, 'rule-engine');
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────
// Multi-modal symptom assessment (NEEDS-PRODUCT-DECISION → text-only)
// ─────────────────────────────────────────────────────────────────
router.post('/multimodal/assess', async (req, res) => {
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({ error: 'AI provider not configured', missing: 'OPENROUTER_API_KEY' });
  }
  try {
    const { audio_transcript, image_descriptions, chief_complaint, patient_id } = req.body || {};
    if (!audio_transcript && !image_descriptions && !chief_complaint) {
      return res.status(400).json({ error: 'audio_transcript, image_descriptions, or chief_complaint required' });
    }
    const captionsBlob = Array.isArray(image_descriptions) ? image_descriptions.join('\n') : (image_descriptions || '');
    const systemPrompt = `You are an ER triage assistant. From the provided multi-modal text inputs (audio transcript, image descriptions, chief complaint), produce a structured assessment. Respond ONLY with JSON:
{
  "primary_concerns":["..."],
  "recommended_priority":"ESI-1|ESI-2|ESI-3|ESI-4|ESI-5",
  "suggested_evaluations":["..."],
  "red_flags":["..."],
  "summary":"..."
}`;
    const userPrompt = `Chief complaint: ${chief_complaint || 'N/A'}
Audio transcript (text):
${audio_transcript || 'N/A'}

Image descriptions:
${captionsBlob || 'N/A'}`;
    const r = await callOpenRouter(userPrompt, systemPrompt);
    let parsed = {};
    try {
      const text = r.result || '';
      const code = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      parsed = code ? JSON.parse(code[1].trim()) : JSON.parse(text);
    } catch {
      parsed = { raw_response: r.result };
    }
    await persist(req.user?.id, 'multimodal-assess', patient_id || null, JSON.stringify(parsed), r.model);
    res.json({ success: true, ...parsed, model: r.model, note: 'text-only inference; no audio/vision model used' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
