import React, { useState } from 'react';
import API from '../services/api';
import { toast } from 'react-toastify';

const INTENSITY_COLORS = {
  low: '#22c55e',
  moderate: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

const URGENCY_COLORS = {
  routine: '#22c55e',
  urgent: '#f59e0b',
  critical: '#ef4444',
};

export default function ResourcePredictorPage() {
  const [form, setForm] = useState({ currentStaff: '', expectedArrivals: '' });
  const [result, setResult] = useState(null);
  const [census, setCensus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handlePredict = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const { data } = await API.post('/ai/resource-predict', {
        currentStaff: form.currentStaff || undefined,
        expectedArrivals: form.expectedArrivals || undefined,
      });
      setResult(data.prediction);
      setCensus(data.census);
      toast.success('Resource prediction generated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Prediction failed');
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Resource Predictor</h1>
        <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
          AI-powered 2-hour resource needs forecast based on live department census
        </p>
      </div>

      {/* Input Form */}
      <form onSubmit={handlePredict} style={{
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        gap: '16px',
        alignItems: 'flex-end',
        marginBottom: '24px',
        flexWrap: 'wrap'
      }}>
        <div>
          <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
            Current Staff on Duty
          </label>
          <input
            className="form-input"
            value={form.currentStaff}
            onChange={e => handleChange('currentStaff', e.target.value)}
            placeholder="e.g. 3 nurses, 2 physicians"
            style={{ width: '260px' }}
          />
        </div>
        <div>
          <label style={{ color: '#94a3b8', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
            Expected Arrivals (next 2h)
          </label>
          <input
            className="form-input"
            value={form.expectedArrivals}
            onChange={e => handleChange('expectedArrivals', e.target.value)}
            placeholder="e.g. 8-10 patients"
            style={{ width: '220px' }}
          />
        </div>
        <button
          type="submit"
          className="btn-primary"
          disabled={loading}
          style={{ opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap' }}
        >
          {loading ? 'Predicting...' : 'Generate Prediction'}
        </button>
      </form>

      {/* Live Census */}
      {census && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          {[
            { label: 'Patients Waiting', value: census.waitingCount, color: '#818cf8' },
            { label: 'Occupied Beds', value: `${census.occupiedBeds}/${census.totalBeds}`, color: '#f97316' },
            { label: 'Bed Occupancy', value: `${census.occupancyRate}%`, color: census.occupancyRate > 80 ? '#ef4444' : '#22c55e' },
            { label: 'Available Beds', value: census.availableBeds, color: '#22c55e' },
            { label: 'Pending Labs', value: census.pendingLabOrders, color: '#f59e0b' },
          ].map((s, i) => (
            <div key={i} style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '16px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '26px', fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Prediction Results */}
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Overview */}
          <div style={{
            gridColumn: '1 / -1',
            background: '#1e293b',
            border: `2px solid ${INTENSITY_COLORS[result.predicted_peak_intensity] || '#334155'}`,
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}>
            <div>
              <div style={{ color: '#94a3b8', fontSize: '13px' }}>2-Hour Forecast</div>
              <div style={{ fontSize: '20px', color: '#e2e8f0', fontWeight: 700 }}>
                +{result.predicted_additional_patients} expected patients
              </div>
              <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>
                Generated: {result.generated_at ? new Date(result.generated_at).toLocaleTimeString() : 'now'}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#94a3b8', fontSize: '12px' }}>Peak Intensity</div>
              <div style={{
                fontSize: '22px',
                fontWeight: 700,
                color: INTENSITY_COLORS[result.predicted_peak_intensity] || '#94a3b8',
                textTransform: 'uppercase'
              }}>
                {result.predicted_peak_intensity}
              </div>
              <div style={{ color: '#64748b', fontSize: '11px' }}>Confidence: {result.confidence}</div>
            </div>
          </div>

          {/* Bed Needs */}
          {result.bed_needs && (
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Bed Requirements</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>Beds Needed</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{result.bed_needs.predicted_beds_needed}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>Available</span>
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>{result.bed_needs.beds_available}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>Shortage Risk</span>
                  <span style={{
                    fontWeight: 600,
                    color: result.bed_needs.shortage_risk === 'high' ? '#ef4444' : result.bed_needs.shortage_risk === 'moderate' ? '#f59e0b' : '#22c55e'
                  }}>{result.bed_needs.shortage_risk}</span>
                </div>
                {result.bed_needs.recommendation && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    background: '#0f172a',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    fontSize: '12px'
                  }}>
                    {result.bed_needs.recommendation}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Staffing */}
          {result.staffing_needs && (
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Staffing Needs</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { label: 'Nurses', value: result.staffing_needs.nurses_recommended },
                  { label: 'Physicians', value: result.staffing_needs.physicians_recommended },
                  { label: 'Technicians', value: result.staffing_needs.techs_recommended },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px' }}>{s.label} Recommended</span>
                    <span style={{ color: '#818cf8', fontWeight: 600 }}>{s.value}</span>
                  </div>
                ))}
                {result.staffing_needs.current_gap && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    background: '#0f172a',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    fontSize: '12px'
                  }}>
                    Gap: {result.staffing_needs.current_gap}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Supply Needs */}
          {result.supply_needs?.length > 0 && (
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Supply Requirements</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {result.supply_needs.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    background: '#0f172a',
                    borderRadius: '6px'
                  }}>
                    <div>
                      <div style={{ color: '#e2e8f0', fontSize: '13px' }}>{s.supply}</div>
                      <div style={{ color: '#64748b', fontSize: '11px' }}>{s.quantity}</div>
                    </div>
                    <span style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: `${URGENCY_COLORS[s.urgency] || '#94a3b8'}22`,
                      color: URGENCY_COLORS[s.urgency] || '#94a3b8',
                      fontWeight: 600,
                      textTransform: 'uppercase'
                    }}>{s.urgency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lab Capacity */}
          {result.lab_capacity && (
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '20px' }}>
              <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Lab Capacity</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>Pending Orders</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{result.lab_capacity.pending_orders}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>Predicted New</span>
                  <span style={{ color: '#818cf8', fontWeight: 600 }}>{result.lab_capacity.predicted_new_orders}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>Bottleneck Risk</span>
                  <span style={{
                    fontWeight: 600,
                    color: result.lab_capacity.bottleneck_risk === 'high' ? '#ef4444' : result.lab_capacity.bottleneck_risk === 'moderate' ? '#f59e0b' : '#22c55e'
                  }}>{result.lab_capacity.bottleneck_risk}</span>
                </div>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations?.length > 0 && (
            <div style={{
              gridColumn: '1 / -1',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '20px'
            }}>
              <h4 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>AI Recommendations</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {result.recommendations.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', color: '#cbd5e1', fontSize: '13px', lineHeight: '1.5' }}>
                    <span style={{ color: '#818cf8', fontWeight: 700, minWidth: '20px' }}>{i + 1}.</span>
                    {r}
                  </div>
                ))}
              </div>
              {result.surge_plan && (
                <div style={{
                  marginTop: '12px',
                  padding: '10px 14px',
                  background: '#0f172a',
                  borderRadius: '8px',
                  borderLeft: '3px solid #f97316'
                }}>
                  <div style={{ color: '#f97316', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>SURGE PLAN</div>
                  <div style={{ color: '#94a3b8', fontSize: '13px' }}>{result.surge_plan}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
