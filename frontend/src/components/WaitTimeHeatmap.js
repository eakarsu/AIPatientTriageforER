import React, { useEffect, useState } from 'react';

// VIZ: Wait-time heatmap (severity x hour-of-day)
export default function WaitTimeHeatmap() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    fetch('/api/custom-views/wait-heatmap', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 12, color: '#9ca3af' }}>Loading wait-time heatmap…</div>;
  if (error) return <div style={{ padding: 12, color: '#fecaca' }}>Error: {error}</div>;
  if (!data) return null;

  const matrix = data.matrix || [];
  // Find max for color scaling
  let max = 1;
  matrix.forEach(row => row.cells.forEach(c => { if (c.value > max) max = c.value; }));

  const colorFor = (v) => {
    const t = Math.min(1, v / max);
    // green -> yellow -> red
    const r = Math.round(34 + t * (220 - 34));
    const g = Math.round(197 - t * (197 - 38));
    const b = Math.round(94 - t * (94 - 38));
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div data-testid="wait-time-heatmap" style={{ background: '#0b1220', padding: 16, borderRadius: 8 }}>
      <h3 style={{ margin: 0, marginBottom: 8, color: '#e5e7eb', fontSize: 16, fontWeight: 600 }}>
        Wait Time Heatmap — Severity x Hour of Day
      </h3>
      <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 12 }}>
        Average wait (minutes). Synthesized cells shown lighter.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, color: '#e5e7eb' }}>
          <thead>
            <tr>
              <th style={{ padding: '4px 8px', textAlign: 'left', color: '#9ca3af' }}>Severity</th>
              {data.hours.map(h => (
                <th key={h} style={{ padding: '4px 6px', color: '#9ca3af', fontWeight: 500 }}>{String(h).padStart(2, '0')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map(row => (
              <tr key={row.severity}>
                <td style={{ padding: '4px 8px', fontWeight: 600 }}>{row.severity}</td>
                {row.cells.map(c => (
                  <td
                    key={c.hour}
                    title={`${row.severity} @ ${c.hour}:00 → ${c.value} min${c.synthesized ? ' (estimated)' : ` (n=${c.samples})`}`}
                    style={{
                      background: colorFor(c.value),
                      color: '#111827',
                      textAlign: 'center',
                      padding: '6px 4px',
                      minWidth: 26,
                      border: '1px solid #0b1220',
                      opacity: c.synthesized ? 0.55 : 1,
                      fontWeight: 600,
                    }}
                  >
                    {c.value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
