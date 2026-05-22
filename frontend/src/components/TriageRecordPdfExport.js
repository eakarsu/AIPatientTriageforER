import React, { useEffect, useState } from 'react';

// NON-VIZ: triage record PDF export — pick a patient, download/preview
export default function TriageRecordPdfExport() {
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    fetch('/api/patients?limit=50', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)))
      .then(d => {
        const arr = d.data || d || [];
        setPatients(arr);
        if (arr.length) setSelected(String(arr[0].id));
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const download = async () => {
    if (!selected) return;
    setStatus('Generating…');
    setError(null);
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch(`/api/custom-views/triage-pdf/${selected}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `triage_${selected}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`PDF downloaded (triage_${selected}.pdf, ${blob.size} bytes)`);
    } catch (e) {
      setError(String(e.message || e));
      setStatus(null);
    }
  };

  return (
    <div data-testid="triage-pdf-export" style={{ background: '#0b1220', padding: 16, borderRadius: 8 }}>
      <h3 style={{ margin: 0, marginBottom: 8, color: '#e5e7eb', fontSize: 16, fontWeight: 600 }}>
        Triage Record PDF Export
      </h3>
      <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 12 }}>
        Generate a printable PDF record for a selected patient (triage assessments + vitals).
      </div>
      {loading && <div style={{ color: '#9ca3af' }}>Loading patients…</div>}
      {!loading && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            style={{ padding: 8, background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 6, minWidth: 240 }}
          >
            {patients.length === 0 && <option value="">No patients</option>}
            {patients.map(p => (
              <option key={p.id} value={p.id}>{p.id} — {p.firstName} {p.lastName}</option>
            ))}
          </select>
          <button
            onClick={download}
            disabled={!selected}
            style={{ padding: '8px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: selected ? 'pointer' : 'not-allowed' }}
          >
            Download PDF
          </button>
        </div>
      )}
      {status && <div style={{ marginTop: 10, color: '#86efac', fontSize: 13 }}>{status}</div>}
      {error && <div style={{ marginTop: 10, color: '#fecaca', fontSize: 13 }}>Error: {error}</div>}
    </div>
  );
}
