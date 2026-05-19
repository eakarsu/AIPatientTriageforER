import React, { useState } from 'react';
import API from '../services/api';
import { toast } from 'react-toastify';

const ESI_COLORS = {
  1: '#dc2626',
  2: '#f97316',
  3: '#f59e0b',
  4: '#22c55e',
  5: '#06b6d4',
};

const ESI_LABELS = {
  1: 'Resuscitation',
  2: 'Emergency',
  3: 'Urgent',
  4: 'Less Urgent',
  5: 'Non-Urgent',
};

export default function ESICalculatorPage() {
  const [form, setForm] = useState({
    chiefComplaint: '',
    symptoms: '',
    patientAge: '',
    patientGender: '',
    heartRate: '',
    bloodPressureSystolic: '',
    bloodPressureDiastolic: '',
    temperature: '',
    respiratoryRate: '',
    oxygenSaturation: '',
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const payload = {
        chiefComplaint: form.chiefComplaint,
        symptoms: form.symptoms,
        patientAge: form.patientAge,
        patientGender: form.patientGender,
        vitalSigns: {
          heartRate: form.heartRate || null,
          bloodPressureSystolic: form.bloodPressureSystolic || null,
          bloodPressureDiastolic: form.bloodPressureDiastolic || null,
          temperature: form.temperature || null,
          respiratoryRate: form.respiratoryRate || null,
          oxygenSaturation: form.oxygenSaturation || null,
        },
      };
      const { data } = await API.post('/ai/esi-calculate', payload);
      setResult(data.esi);
      toast.success('ESI calculation complete');
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'ESI calculation failed');
    }
    setLoading(false);
  };

  const esiColor = result ? ESI_COLORS[result.esi_level] : null;

  return (
    <div>
      <div className="page-header">
        <h1>ESI Calculator</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
          Emergency Severity Index — AI-powered triage level 1-5 with rationale
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: result ? '1fr 1fr' : '1fr', gap: '24px', maxWidth: '1200px' }}>
        {/* Form Panel */}
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ color: '#e2e8f0', marginBottom: '20px', fontSize: '16px', fontWeight: 600 }}>Patient Information</h3>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                Chief Complaint <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                className="form-input"
                value={form.chiefComplaint}
                onChange={e => handleChange('chiefComplaint', e.target.value)}
                placeholder="e.g. Chest pain, shortness of breath"
                required
              />
            </div>

            <div>
              <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                Symptoms <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                className="form-input"
                value={form.symptoms}
                onChange={e => handleChange('symptoms', e.target.value)}
                placeholder="Describe all presenting symptoms..."
                rows={3}
                style={{ resize: 'vertical' }}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Age</label>
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  max="120"
                  value={form.patientAge}
                  onChange={e => handleChange('patientAge', e.target.value)}
                  placeholder="Age in years"
                />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Gender</label>
                <select
                  className="form-input"
                  value={form.patientGender}
                  onChange={e => handleChange('patientGender', e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <h4 style={{ color: '#cbd5e1', fontSize: '14px', fontWeight: 600, marginBottom: '4px', marginTop: '4px' }}>
              Vital Signs (optional)
            </h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Heart Rate (bpm)</label>
                <input className="form-input" type="number" value={form.heartRate} onChange={e => handleChange('heartRate', e.target.value)} placeholder="e.g. 88" />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Temperature (°F)</label>
                <input className="form-input" type="number" step="0.1" value={form.temperature} onChange={e => handleChange('temperature', e.target.value)} placeholder="e.g. 98.6" />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Systolic BP (mmHg)</label>
                <input className="form-input" type="number" value={form.bloodPressureSystolic} onChange={e => handleChange('bloodPressureSystolic', e.target.value)} placeholder="e.g. 120" />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Diastolic BP (mmHg)</label>
                <input className="form-input" type="number" value={form.bloodPressureDiastolic} onChange={e => handleChange('bloodPressureDiastolic', e.target.value)} placeholder="e.g. 80" />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Resp Rate (breaths/min)</label>
                <input className="form-input" type="number" value={form.respiratoryRate} onChange={e => handleChange('respiratoryRate', e.target.value)} placeholder="e.g. 16" />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>SpO2 (%)</label>
                <input className="form-input" type="number" min="0" max="100" value={form.oxygenSaturation} onChange={e => handleChange('oxygenSaturation', e.target.value)} placeholder="e.g. 98" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ marginTop: '8px', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Calculating ESI...' : 'Calculate ESI Level'}
            </button>
          </form>
        </div>

        {/* Result Panel */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* ESI Level Badge */}
            <div style={{
              background: '#1e293b',
              border: `2px solid ${esiColor}`,
              borderRadius: '12px',
              padding: '24px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '72px',
                fontWeight: 800,
                color: esiColor,
                lineHeight: 1
              }}>
                {result.esi_level}
              </div>
              <div style={{ fontSize: '20px', color: esiColor, fontWeight: 600, marginTop: '8px' }}>
                ESI Level {result.esi_level} — {ESI_LABELS[result.esi_level]}
              </div>
              <div style={{ color: '#64748b', fontSize: '13px', marginTop: '4px' }}>
                Confidence: <span style={{ color: '#94a3b8' }}>{result.confidence}</span>
              </div>
              <div style={{
                marginTop: '12px',
                padding: '8px 16px',
                background: `${esiColor}22`,
                borderRadius: '8px',
                color: '#cbd5e1',
                fontSize: '13px'
              }}>
                Disposition: <strong style={{ color: esiColor }}>{result.disposition_recommendation}</strong>
              </div>
              <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '8px' }}>
                Time to Physician: <strong>{result.estimated_time_to_physician}</strong>
              </div>
            </div>

            {/* Rationale */}
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Clinical Rationale</h4>
              <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.6' }}>{result.rationale}</p>
            </div>

            {/* Immediate Actions */}
            {result.immediate_actions?.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Immediate Actions</h4>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {result.immediate_actions.map((a, i) => (
                    <li key={i} style={{ display: 'flex', gap: '8px', color: '#cbd5e1', fontSize: '13px' }}>
                      <span style={{ color: '#ef4444', fontWeight: 700, minWidth: '18px' }}>{i + 1}.</span>
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Resource Needs */}
            {result.predicted_resource_needs?.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Predicted Resources</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {result.predicted_resource_needs.map((r, i) => (
                    <span key={i} className="badge badge-info">{r}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Vital Signs Assessment */}
            {result.vital_signs_assessment && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Vital Signs Assessment</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {Object.entries(result.vital_signs_assessment).map(([key, val]) => {
                    const isAbnormal = val && val !== 'normal';
                    return (
                      <div key={key} style={{
                        padding: '8px 12px',
                        background: '#0f172a',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span style={{ color: '#64748b', fontSize: '12px' }}>
                          {key.replace(/_/g, ' ').replace(' status', '')}
                        </span>
                        <span style={{
                          fontSize: '12px',
                          color: isAbnormal ? '#f59e0b' : '#22c55e',
                          fontWeight: 600
                        }}>{val || 'N/A'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Escalation Criteria */}
            {result.escalation_criteria?.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid #f59e0b44', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#f59e0b', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Escalation Criteria</h4>
                <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {result.escalation_criteria.map((c, i) => (
                    <li key={i} style={{ color: '#cbd5e1', fontSize: '13px', display: 'flex', gap: '8px' }}>
                      <span style={{ color: '#f59e0b' }}>⚠</span> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
