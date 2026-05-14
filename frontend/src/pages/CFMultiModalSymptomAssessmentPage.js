// === Batch 06 Gaps & Frontend Mounts ===
// Custom Feature: Multi-modal symptom assessment
// Multi-modal symptom assessment: Combine audio (patient speech), video (facial grimacing analysis), vital trends; holistic triage score more accurate than ESI alone
import React, { useState } from 'react';

export default function CFMultiModalSymptomAssessmentPage() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '';
      const res = await fetch('/api/cf-multi-modal-symptom-assessment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ input }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Request failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, color: '#e5e7eb' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Multi-modal symptom assessment</h1>
      <p style={{ color: '#9ca3af', marginBottom: 16 }}>Multi-modal symptom assessment: Combine audio (patient speech), video (facial grimacing analysis), vital trends; holistic triage score more accurate than ESI alone</p>
      <div style={{ background: '#111827', padding: 16, borderRadius: 8, marginBottom: 12 }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Input / Prompt</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          placeholder="Describe the scenario, paste data, or enter free-form input..."
          style={{ width: '100%', padding: 10, background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }}
        />
        <button
          onClick={run}
          disabled={loading || !input.trim()}
          style={{ marginTop: 12, padding: '8px 18px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontWeight: 600 }}
        >
          {loading ? 'Running…' : 'Run'}
        </button>
      </div>
      {error && (
        <div style={{ background: '#7f1d1d', color: '#fecaca', padding: 12, borderRadius: 6, marginBottom: 12 }}>{error}</div>
      )}
      {result && (
        <div style={{ background: '#0b1220', padding: 16, borderRadius: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Result</h3>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', fontSize: 12, color: '#d1d5db' }}>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
