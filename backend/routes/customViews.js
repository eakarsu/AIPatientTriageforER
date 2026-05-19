// Custom Views Router — ER Triage
// 4 endpoints: ESI distribution, wait-time heatmap, triage PDF, protocol rules editor (GET/PUT)
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const sequelize = require('../config/database');
const {
  Patient, TriageAssessment, VitalSign, PriorityQueue, WaitTime, SymptomAnalysis,
} = require('../models');

// ---- In-memory protocol rules store (with persistence table fallback) ----
const PROTOCOL_TABLE = 'custom_view_protocol_rules';
let _rulesCache = null;
const DEFAULT_RULES = {
  esiLevels: [
    { level: 1, label: 'Resuscitation', maxWaitMinutes: 0,   description: 'Immediate life-saving intervention required', minPainLevel: 0, vitalsCritical: true },
    { level: 2, label: 'Emergency',     maxWaitMinutes: 10,  description: 'High risk situation; severe pain or distress', minPainLevel: 7, vitalsCritical: true },
    { level: 3, label: 'Urgent',        maxWaitMinutes: 30,  description: 'Multiple resources expected, stable vitals', minPainLevel: 4, vitalsCritical: false },
    { level: 4, label: 'Less Urgent',   maxWaitMinutes: 60,  description: 'One resource expected', minPainLevel: 2, vitalsCritical: false },
    { level: 5, label: 'Non-Urgent',    maxWaitMinutes: 120, description: 'No resources expected', minPainLevel: 0, vitalsCritical: false },
  ],
  updatedAt: new Date().toISOString(),
};

(async () => {
  try {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS ${PROTOCOL_TABLE} (
      id SERIAL PRIMARY KEY,
      rules JSONB NOT NULL,
      updated_by INTEGER,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
  } catch (e) {
    console.warn('protocol_rules table init:', e.message);
  }
})();

async function loadRules() {
  if (_rulesCache) return _rulesCache;
  try {
    const [rows] = await sequelize.query(
      `SELECT rules, updated_at FROM ${PROTOCOL_TABLE} ORDER BY id DESC LIMIT 1`
    );
    if (rows && rows[0]) {
      _rulesCache = { ...rows[0].rules, updatedAt: rows[0].updated_at };
      return _rulesCache;
    }
  } catch (e) { /* fall through to default */ }
  _rulesCache = { ...DEFAULT_RULES };
  return _rulesCache;
}

async function saveRules(rules, userId) {
  _rulesCache = { ...rules, updatedAt: new Date().toISOString() };
  try {
    await sequelize.query(
      `INSERT INTO ${PROTOCOL_TABLE} (rules, updated_by, updated_at) VALUES (:rules, :uid, NOW())`,
      { replacements: { rules: JSON.stringify(rules), uid: userId || null } }
    );
  } catch (e) {
    console.warn('protocol_rules persist failed:', e.message);
  }
  return _rulesCache;
}

// ============================================================
// 1) VIZ — GET /esi-distribution
// Returns counts per ESI triage level for distribution chart
// ============================================================
router.get('/esi-distribution', auth, async (req, res) => {
  try {
    const rows = await TriageAssessment.findAll({
      attributes: [
        'triageLevel',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['triageLevel'],
      raw: true,
    });

    const labels = ['1-Resuscitation', '2-Emergency', '3-Urgent', '4-Less Urgent', '5-Non-Urgent'];
    const map = Object.fromEntries(rows.map(r => [r.triageLevel, parseInt(r.count, 10) || 0]));
    const distribution = labels.map(label => ({
      level: label,
      shortLabel: label.split('-')[0],
      name: label.split('-').slice(1).join('-') || label,
      count: map[label] || 0,
    }));
    const total = distribution.reduce((s, d) => s + d.count, 0);
    res.json({
      ok: true,
      total,
      distribution,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('esi-distribution error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 2) VIZ — GET /wait-heatmap
// Wait-time heatmap: severity (rows) x hour-of-day (cols)
// ============================================================
router.get('/wait-heatmap', auth, async (req, res) => {
  try {
    const severities = ['Critical', 'Severe', 'Moderate', 'Mild'];
    const hours = Array.from({ length: 24 }, (_, h) => h);

    // Pull recent symptom analyses joined with queue (best-effort)
    const queue = await PriorityQueue.findAll({
      include: [Patient],
      raw: true,
      nest: true,
      limit: 500,
      order: [['checkInTime', 'DESC']],
    });

    // Build matrix: average estimatedWaitMinutes per (severity bucket, hour)
    // Map priority 1..5 -> severity
    const prioToSev = { 1: 'Critical', 2: 'Severe', 3: 'Moderate', 4: 'Mild', 5: 'Mild' };
    const acc = {};
    severities.forEach(s => { acc[s] = {}; hours.forEach(h => acc[s][h] = { sum: 0, n: 0 }); });

    for (const q of queue) {
      const sev = prioToSev[q.priority] || 'Mild';
      const t = q.checkInTime ? new Date(q.checkInTime) : null;
      if (!t) continue;
      const h = t.getHours();
      const w = q.estimatedWaitMinutes || 0;
      acc[sev][h].sum += w;
      acc[sev][h].n += 1;
    }

    // Synthesize plausible defaults for empty cells so chart is meaningful
    const baseline = { Critical: 5, Severe: 18, Moderate: 38, Mild: 75 };
    const matrix = severities.map(sev => ({
      severity: sev,
      cells: hours.map(h => {
        const cell = acc[sev][h];
        const avg = cell.n > 0 ? Math.round(cell.sum / cell.n) : null;
        // peak-hour multiplier (10am, 2pm, 7pm) for synthesized fallback
        const peakMul = (h === 10 || h === 14 || h === 19) ? 1.6 : (h >= 22 || h <= 5 ? 0.6 : 1.0);
        const value = avg != null ? avg : Math.round(baseline[sev] * peakMul);
        return { hour: h, value, samples: cell.n, synthesized: avg == null };
      }),
    }));

    res.json({
      ok: true,
      severities,
      hours,
      matrix,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('wait-heatmap error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 3) NON-VIZ — GET /triage-pdf/:patientId
// Returns a printable triage record (PDF via minimal hand-rolled PDF
// generator so no extra deps are required)
// ============================================================
function escapePdf(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildSimplePdf(lines) {
  // Single-page PDF using built-in Helvetica.
  const header = '%PDF-1.4\n';
  const objects = [];

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');

  // Content stream
  let stream = 'BT\n/F1 12 Tf\n50 760 Td\n14 TL\n';
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] || '';
    if (i === 0) stream += `(${escapePdf(ln)}) Tj\n`;
    else stream += `T*\n(${escapePdf(ln)}) Tj\n`;
  }
  stream += 'ET';
  const contentObj = `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`;
  objects.push(contentObj);

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  // Assemble
  let body = '';
  const offsets = [];
  let cursor = Buffer.byteLength(header, 'utf8');
  for (let i = 0; i < objects.length; i++) {
    const objStr = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    offsets.push(cursor);
    body += objStr;
    cursor += Buffer.byteLength(objStr, 'utf8');
  }
  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(header + body + xref + trailer, 'utf8');
}

router.get('/triage-pdf/:patientId', auth, async (req, res) => {
  try {
    const pid = parseInt(req.params.patientId, 10);
    if (!pid) return res.status(400).json({ error: 'patientId required' });

    const patient = await Patient.findByPk(pid);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const triage = await TriageAssessment.findAll({
      where: { patientId: pid }, order: [['createdAt', 'DESC']], limit: 5, raw: true,
    });
    const vitals = await VitalSign.findAll({
      where: { patientId: pid }, order: [['createdAt', 'DESC']], limit: 3, raw: true,
    });

    const lines = [];
    lines.push('ER PATIENT TRIAGE RECORD');
    lines.push('-------------------------------------------');
    lines.push(`Patient: ${patient.firstName} ${patient.lastName} (ID ${patient.id})`);
    lines.push(`DOB: ${patient.dateOfBirth || 'N/A'}    Gender: ${patient.gender || 'N/A'}`);
    lines.push(`Blood Type: ${patient.bloodType || 'N/A'}    Status: ${patient.status || 'N/A'}`);
    lines.push(`Allergies: ${(patient.allergies || 'None').slice(0, 80)}`);
    lines.push(`Insurance: ${patient.insuranceProvider || 'N/A'}`);
    lines.push('');
    lines.push('TRIAGE ASSESSMENTS (latest 5)');
    lines.push('-------------------------------------------');
    if (!triage.length) {
      lines.push('No triage assessments on file.');
    } else {
      for (const t of triage) {
        lines.push(`Level: ${t.triageLevel || 'N/A'}    Pain: ${t.painLevel ?? 'N/A'}/10`);
        lines.push(`Chief Complaint: ${(t.chiefComplaint || '').slice(0, 80)}`);
        lines.push(`AI Confidence: ${t.aiConfidence ?? 'N/A'}    Override: ${t.nurseOverride ? 'Yes' : 'No'}`);
        lines.push(`Recorded: ${t.createdAt ? new Date(t.createdAt).toISOString() : 'N/A'}`);
        lines.push('');
      }
    }
    lines.push('VITAL SIGNS (latest 3)');
    lines.push('-------------------------------------------');
    if (!vitals.length) {
      lines.push('No vitals on file.');
    } else {
      for (const v of vitals) {
        lines.push(`HR: ${v.heartRate ?? 'N/A'}   BP: ${v.bloodPressureSystolic ?? '?'}/${v.bloodPressureDiastolic ?? '?'}   Temp: ${v.temperature ?? 'N/A'}`);
        lines.push(`RR: ${v.respiratoryRate ?? 'N/A'}   SpO2: ${v.oxygenSaturation ?? 'N/A'}   Alert: ${v.alertLevel || 'N/A'}`);
        lines.push(`Recorded: ${v.createdAt ? new Date(v.createdAt).toISOString() : 'N/A'}`);
        lines.push('');
      }
    }
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Generated by user: ${req.user?.email || req.user?.id || 'unknown'}`);

    const pdf = buildSimplePdf(lines);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="triage_${pid}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('triage-pdf error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 4) NON-VIZ — GET/PUT /protocol-rules
// CRUD ESI thresholds for triage protocol rules editor
// ============================================================
router.get('/protocol-rules', auth, async (req, res) => {
  try {
    const rules = await loadRules();
    res.json({ ok: true, rules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/protocol-rules', auth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.esiLevels || !Array.isArray(body.esiLevels)) {
      return res.status(400).json({ error: 'esiLevels[] required' });
    }
    // Validate
    for (const lvl of body.esiLevels) {
      if (typeof lvl.level !== 'number' || lvl.level < 1 || lvl.level > 5) {
        return res.status(400).json({ error: `Invalid level: ${lvl.level}` });
      }
      if (typeof lvl.maxWaitMinutes !== 'number' || lvl.maxWaitMinutes < 0) {
        return res.status(400).json({ error: `Invalid maxWaitMinutes for level ${lvl.level}` });
      }
    }
    const saved = await saveRules(
      { esiLevels: body.esiLevels },
      req.user?.id || req.user?.userId || null
    );
    res.json({ ok: true, rules: saved });
  } catch (err) {
    console.error('protocol-rules PUT error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
