import React, { useEffect, useState } from 'react';

// NON-VIZ: triage protocol rules editor — CRUD ESI thresholds
export default function TriageProtocolRulesEditor() {
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    const token = localStorage.getItem('token') || '';
    fetch('/api/custom-views/protocol-rules', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)))
      .then(d => setRules(d.rules))
      .catch(e => setError(String(e)));
  };

  useEffect(load, []);

  const updateField = (idx, field, value) => {
    const copy = { ...rules, esiLevels: rules.esiLevels.map((l, i) =>
      i === idx ? { ...l, [field]: field === 'vitalsCritical' ? value : (field === 'label' || field === 'description') ? value : Number(value) } : l
    ) };
    setRules(copy);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch('/api/custom-views/protocol-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ esiLevels: rules.esiLevels }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const data = await res.json();
      setRules(data.rules);
      setStatus(`Saved at ${new Date(data.rules.updatedAt).toLocaleTimeString()}`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const resetRow = (idx) => {
    const defaults = [
      { maxWaitMinutes: 0, minPainLevel: 0, vitalsCritical: true },
      { maxWaitMinutes: 10, minPainLevel: 7, vitalsCritical: true },
      { maxWaitMinutes: 30, minPainLevel: 4, vitalsCritical: false },
      { maxWaitMinutes: 60, minPainLevel: 2, vitalsCritical: false },
      { maxWaitMinutes: 120, minPainLevel: 0, vitalsCritical: false },
    ];
    const copy = { ...rules, esiLevels: rules.esiLevels.map((l, i) => i === idx ? { ...l, ...defaults[idx] } : l) };
    setRules(copy);
  };

  if (!rules) {
    return (
      <div data-testid="protocol-rules-editor" style={{ background: '#0b1220', padding: 16, borderRadius: 8, color: '#9ca3af' }}>
        {error ? <div style={{ color: '#fecaca' }}>Error: {error}</div> : 'Loading protocol rules…'}
      </div>
    );
  }

  return (
    <div data-testid="protocol-rules-editor" style={{ background: '#0b1220', padding: 16, borderRadius: 8 }}>
      <h3 style={{ margin: 0, marginBottom: 8, color: '#e5e7eb', fontSize: 16, fontWeight: 600 }}>
        Triage Protocol Rules Editor (ESI Thresholds)
      </h3>
      <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 12 }}>
        Edit max wait, pain threshold, and vitals criticality for each ESI level. Updates are persisted.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e5e7eb' }}>
          <thead>
            <tr style={{ background: '#1f2937', color: '#9ca3af', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>ESI</th>
              <th style={{ padding: 8 }}>Label</th>
              <th style={{ padding: 8 }}>Max Wait (min)</th>
              <th style={{ padding: 8 }}>Min Pain</th>
              <th style={{ padding: 8 }}>Vitals Critical</th>
              <th style={{ padding: 8 }}>Description</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {rules.esiLevels.map((l, i) => (
              <tr key={l.level} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: 8, fontWeight: 600 }}>{l.level}</td>
                <td style={{ padding: 8 }}>
                  <input
                    value={l.label || ''}
                    onChange={e => updateField(i, 'label', e.target.value)}
                    style={{ width: 120, padding: 4, background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 4 }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    type="number" min={0}
                    value={l.maxWaitMinutes}
                    onChange={e => updateField(i, 'maxWaitMinutes', e.target.value)}
                    style={{ width: 70, padding: 4, background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 4 }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    type="number" min={0} max={10}
                    value={l.minPainLevel}
                    onChange={e => updateField(i, 'minPainLevel', e.target.value)}
                    style={{ width: 60, padding: 4, background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 4 }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!l.vitalsCritical}
                    onChange={e => updateField(i, 'vitalsCritical', e.target.checked)}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    value={l.description || ''}
                    onChange={e => updateField(i, 'description', e.target.value)}
                    style={{ width: '100%', padding: 4, background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 4 }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <button
                    onClick={() => resetRow(i)}
                    style={{ padding: '4px 8px', background: '#374151', color: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                  >
                    Reset
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Saving…' : 'Save Rules'}
        </button>
        <button
          onClick={load}
          style={{ padding: '8px 16px', background: '#374151', color: '#e5e7eb', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          Reload
        </button>
        {status && <span style={{ color: '#86efac', fontSize: 13 }}>{status}</span>}
        {error && <span style={{ color: '#fecaca', fontSize: 13 }}>Error: {error}</span>}
      </div>
    </div>
  );
}
