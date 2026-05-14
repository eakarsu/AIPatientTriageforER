import React, { useState } from 'react';
import { toast } from 'react-toastify';
import API from '../services/api';
import AIResultDisplay from '../components/AIResultDisplay';

const TOOLS = [
  { id: 'history-summary', label: 'Patient History Summarize', endpoint: '/ai/patient-history-summarize' },
  { id: 'staffing-optimize', label: 'Staffing Optimize', endpoint: '/ai/staffing-optimize' },
  { id: 'readmission-risk', label: 'Readmission Risk', endpoint: '/ai/readmission-risk' },
];

export default function AIPredictivePage() {
  const [activeTool, setActiveTool] = useState('history-summary');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [hist, setHist] = useState({
    patientId: '',
    chartNotes: '',
    medications: '',
    allergies: '',
    chronicConditions: '',
  });
  const [staff, setStaff] = useState({
    shiftStart: '',
    shiftEnd: '',
    expectedArrivals: '',
    currentStaff: '',
    constraints: '',
  });
  const [read, setRead] = useState({
    patientId: '',
    primaryDiagnosis: '',
    dischargeNotes: '',
    socialFactors: '',
    priorAdmissions: '',
  });

  const parseJsonOrText = (s) => {
    if (!s || !s.trim()) return undefined;
    try { return JSON.parse(s); } catch { return s; }
  };

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const tool = TOOLS.find((t) => t.id === activeTool);
      let body;
      if (activeTool === 'history-summary') {
        body = {
          patientId: hist.patientId ? parseInt(hist.patientId, 10) : undefined,
          chartNotes: hist.chartNotes,
          medications: hist.medications,
          allergies: hist.allergies,
          chronicConditions: hist.chronicConditions,
        };
      } else if (activeTool === 'staffing-optimize') {
        body = {
          shiftStart: staff.shiftStart,
          shiftEnd: staff.shiftEnd,
          expectedArrivals: staff.expectedArrivals ? parseInt(staff.expectedArrivals, 10) : undefined,
          currentStaff: parseJsonOrText(staff.currentStaff),
          constraints: staff.constraints,
        };
      } else {
        body = {
          patientId: read.patientId ? parseInt(read.patientId, 10) : undefined,
          primaryDiagnosis: read.primaryDiagnosis,
          dischargeNotes: read.dischargeNotes,
          socialFactors: read.socialFactors,
          priorAdmissions: read.priorAdmissions ? parseInt(read.priorAdmissions, 10) : undefined,
        };
      }
      const res = await API.post(tool.endpoint, body);
      setResult(res.data);
      toast.success('AI analysis complete');
    } catch (err) {
      toast.error(err.response?.data?.message || err.response?.data?.error || err.message || 'AI request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>AI Predictive Tools</h1>
        <p>Patient history, staffing optimization, and readmission risk</p>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap' }}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`btn ${activeTool === t.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setActiveTool(t.id); setResult(null); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 16 }}>
        {activeTool === 'history-summary' && (
          <>
            <h3>Patient History Summarize</h3>
            <div className="form-group">
              <label>Patient ID</label>
              <input type="number" value={hist.patientId} onChange={(e) => setHist({ ...hist, patientId: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Chart Notes</label>
              <textarea rows={5} value={hist.chartNotes} onChange={(e) => setHist({ ...hist, chartNotes: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Medications</label>
              <textarea rows={2} value={hist.medications} onChange={(e) => setHist({ ...hist, medications: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Allergies</label>
              <input value={hist.allergies} onChange={(e) => setHist({ ...hist, allergies: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Chronic Conditions</label>
              <input value={hist.chronicConditions} onChange={(e) => setHist({ ...hist, chronicConditions: e.target.value })} />
            </div>
          </>
        )}

        {activeTool === 'staffing-optimize' && (
          <>
            <h3>Staffing Optimize</h3>
            <div className="form-group">
              <label>Shift Start</label>
              <input type="datetime-local" value={staff.shiftStart} onChange={(e) => setStaff({ ...staff, shiftStart: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Shift End</label>
              <input type="datetime-local" value={staff.shiftEnd} onChange={(e) => setStaff({ ...staff, shiftEnd: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Expected Arrivals</label>
              <input type="number" value={staff.expectedArrivals} onChange={(e) => setStaff({ ...staff, expectedArrivals: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Current Staff (JSON)</label>
              <textarea rows={3} value={staff.currentStaff} onChange={(e) => setStaff({ ...staff, currentStaff: e.target.value })} placeholder='[{"role":"RN","count":4}]' />
            </div>
            <div className="form-group">
              <label>Constraints</label>
              <textarea rows={2} value={staff.constraints} onChange={(e) => setStaff({ ...staff, constraints: e.target.value })} />
            </div>
          </>
        )}

        {activeTool === 'readmission-risk' && (
          <>
            <h3>Readmission Risk</h3>
            <div className="form-group">
              <label>Patient ID</label>
              <input type="number" value={read.patientId} onChange={(e) => setRead({ ...read, patientId: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Primary Diagnosis</label>
              <input value={read.primaryDiagnosis} onChange={(e) => setRead({ ...read, primaryDiagnosis: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Discharge Notes</label>
              <textarea rows={3} value={read.dischargeNotes} onChange={(e) => setRead({ ...read, dischargeNotes: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Social Factors</label>
              <textarea rows={2} value={read.socialFactors} onChange={(e) => setRead({ ...read, socialFactors: e.target.value })} placeholder="Housing, support, transportation..." />
            </div>
            <div className="form-group">
              <label>Prior Admissions (count)</label>
              <input type="number" value={read.priorAdmissions} onChange={(e) => setRead({ ...read, priorAdmissions: e.target.value })} />
            </div>
          </>
        )}

        <button className="btn btn-primary" onClick={run} disabled={loading} style={{ marginTop: 16 }}>
          {loading ? 'Running...' : 'Run AI'}
        </button>
      </div>

      <AIResultDisplay
        loading={loading}
        result={result ? (typeof (result.result || result.analysis || result.data) === 'string' ? (result.result || result.analysis || result.data) : JSON.stringify(result.result || result.data || result, null, 2)) : null}
        model={result?.model}
      />
    </div>
  );
}
