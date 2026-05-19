import React, { useState } from 'react';
import API from '../services/api';
import { toast } from 'react-toastify';

const VERDICT_COLORS = { SAFE: '#22c55e', CAUTION: '#f59e0b', CONTRAINDICATED: '#ef4444' };
const SEVERITY_COLORS = {
  minor: '#22c55e',
  moderate: '#f59e0b',
  major: '#f97316',
  contraindicated: '#ef4444',
};

export default function MedSafetyPage() {
  const [form, setForm] = useState({
    patientId: '',
    proposedMedication: '',
    proposedDosage: '',
    currentMedications: '',
    allergies: '',
    patientAge: '',
    patientWeight: '',
    patientConditions: '',
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleCheck = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const payload = {
        proposedMedication: form.proposedMedication,
        proposedDosage: form.proposedDosage || undefined,
        currentMedications: form.currentMedications || undefined,
        allergies: form.allergies || undefined,
        patientAge: form.patientAge || undefined,
        patientWeight: form.patientWeight || undefined,
        patientConditions: form.patientConditions || undefined,
        patientId: form.patientId ? parseInt(form.patientId) : undefined,
      };
      const { data } = await API.post('/ai/med-safety', payload);
      setResult(data.safety);
      toast.success('Medication safety check complete');
    } catch (err) {
      toast.error(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Safety check failed');
    }
    setLoading(false);
  };

  const verdictColor = result ? VERDICT_COLORS[result.safety_verdict] || '#94a3b8' : null;

  return (
    <div>
      <div className="page-header">
        <h1>Medication Safety Checker</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
          AI-powered drug interaction, allergy, and dosage safety assessment
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: result ? '420px 1fr' : '1fr', gap: '24px', maxWidth: '1200px' }}>
        {/* Form */}
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '24px' }}>
          <h3 style={{ color: '#e2e8f0', marginBottom: '20px', fontSize: '16px', fontWeight: 600 }}>Check Medication</h3>
          <form onSubmit={handleCheck} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Patient ID (optional — auto-fills allergies & meds)</label>
              <input className="form-input" type="number" value={form.patientId} onChange={e => handleChange('patientId', e.target.value)} placeholder="Patient ID" />
            </div>

            <div>
              <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                Proposed Medication <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input className="form-input" value={form.proposedMedication} onChange={e => handleChange('proposedMedication', e.target.value)} placeholder="e.g. Metoprolol" required />
            </div>

            <div>
              <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Proposed Dosage</label>
              <input className="form-input" value={form.proposedDosage} onChange={e => handleChange('proposedDosage', e.target.value)} placeholder="e.g. 25mg twice daily" />
            </div>

            <div>
              <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Current Medications</label>
              <textarea className="form-input" value={form.currentMedications} onChange={e => handleChange('currentMedications', e.target.value)} placeholder="List current medications..." rows={3} style={{ resize: 'vertical' }} />
            </div>

            <div>
              <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Known Allergies</label>
              <input className="form-input" value={form.allergies} onChange={e => handleChange('allergies', e.target.value)} placeholder="e.g. Penicillin, Sulfa drugs — or NKDA" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Age</label>
                <input className="form-input" type="number" value={form.patientAge} onChange={e => handleChange('patientAge', e.target.value)} placeholder="Years" />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Weight (kg)</label>
                <input className="form-input" type="number" step="0.1" value={form.patientWeight} onChange={e => handleChange('patientWeight', e.target.value)} placeholder="kg" />
              </div>
            </div>

            <div>
              <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Active Medical Conditions</label>
              <input className="form-input" value={form.patientConditions} onChange={e => handleChange('patientConditions', e.target.value)} placeholder="e.g. CHF, diabetes, CKD" />
            </div>

            <button type="submit" className="btn-primary" disabled={loading} style={{ opacity: loading ? 0.6 : 1, marginTop: '4px' }}>
              {loading ? 'Checking Safety...' : 'Check Medication Safety'}
            </button>
          </form>
        </div>

        {/* Results */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Verdict Banner */}
            <div style={{
              background: '#1e293b',
              border: `2px solid ${verdictColor}`,
              borderRadius: '12px',
              padding: '20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: verdictColor }}>
                  {result.safety_verdict}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
                  Overall Risk: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{result.overall_risk_level}</span>
                </div>
              </div>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: `${verdictColor}22`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px'
              }}>
                {result.safety_verdict === 'SAFE' ? '✓' : result.safety_verdict === 'CAUTION' ? '⚠' : '✕'}
              </div>
            </div>

            {/* Allergy Assessment */}
            {result.allergy_assessment && (
              <div style={{
                background: '#1e293b',
                border: `1px solid ${result.allergy_assessment.allergy_conflict ? '#ef4444' : '#334155'}`,
                borderRadius: '12px',
                padding: '20px'
              }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Allergy Assessment</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>Allergy Conflict</span>
                    <span style={{ fontWeight: 600, color: result.allergy_assessment.allergy_conflict ? '#ef4444' : '#22c55e' }}>
                      {result.allergy_assessment.allergy_conflict ? 'YES' : 'No'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>Cross-Reactivity Risk</span>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{result.allergy_assessment.cross_reactivity_risk}</span>
                  </div>
                  {result.allergy_assessment.details && (
                    <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px', lineHeight: '1.5' }}>
                      {result.allergy_assessment.details}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Drug Interactions */}
            {result.drug_interactions?.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
                  Drug Interactions ({result.drug_interactions.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {result.drug_interactions.map((di, i) => (
                    <div key={i} style={{
                      background: '#0f172a',
                      borderRadius: '8px',
                      padding: '12px',
                      borderLeft: `3px solid ${SEVERITY_COLORS[di.severity] || '#64748b'}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '13px' }}>{di.interacting_drug}</span>
                        <span style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          background: `${SEVERITY_COLORS[di.severity] || '#64748b'}22`,
                          color: SEVERITY_COLORS[di.severity] || '#64748b',
                          fontWeight: 700,
                          textTransform: 'uppercase'
                        }}>{di.severity}</span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: '1.5' }}>
                        <strong>Effect:</strong> {di.clinical_effect}<br />
                        <strong>Management:</strong> {di.management}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dosage Assessment */}
            {result.dosage_assessment && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Dosage Assessment</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>Appropriate for Patient</span>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{result.dosage_assessment.appropriate_for_patient}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>Recommended Dose</span>
                    <span style={{ color: '#818cf8', fontWeight: 600 }}>{result.dosage_assessment.recommended_dose}</span>
                  </div>
                  {result.dosage_assessment.adjustment_needed && (
                    <div style={{
                      marginTop: '6px',
                      padding: '8px 12px',
                      background: '#f59e0b11',
                      borderRadius: '6px',
                      color: '#f59e0b',
                      fontSize: '12px'
                    }}>
                      Adjustment: {result.dosage_assessment.adjustment_needed}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Monitoring Requirements */}
            {result.monitoring_requirements?.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Monitoring Requirements</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {result.monitoring_requirements.map((m, i) => (
                    <span key={i} className="badge badge-info">{m}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Side Effects */}
            {result.side_effects && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Side Effects</h4>
                {result.side_effects.serious?.length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>SERIOUS</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {result.side_effects.serious.map((s, i) => <span key={i} className="badge badge-critical">{s}</span>)}
                    </div>
                  </div>
                )}
                {result.side_effects.common?.length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ color: '#f59e0b', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>COMMON</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {result.side_effects.common.map((s, i) => <span key={i} className="badge badge-warning">{s}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Alternatives */}
            {result.alternative_medications?.length > 0 && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
                <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>Alternative Medications</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {result.alternative_medications.map((alt, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', color: '#cbd5e1', fontSize: '13px' }}>
                      <span style={{ color: '#22c55e', fontWeight: 700 }}>→</span>
                      <div>
                        <strong>{alt.name}</strong>
                        {alt.rationale && <span style={{ color: '#64748b' }}> — {alt.rationale}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical Notes */}
            {result.clinical_notes && (
              <div style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '12px',
                padding: '20px',
                borderLeft: '3px solid #818cf8'
              }}>
                <h4 style={{ color: '#818cf8', fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Clinical Notes</h4>
                <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.6' }}>{result.clinical_notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
