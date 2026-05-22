import React, { useEffect, useState } from 'react';

// VIZ: ESI triage level distribution chart (pure SVG bars, no extra deps)
export default function EsiDistributionChart() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    fetch('/api/custom-views/esi-distribution', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 12, color: '#9ca3af' }}>Loading ESI distribution…</div>;
  if (error) return <div style={{ padding: 12, color: '#fecaca' }}>Error: {error}</div>;

  const dist = data?.distribution || [];
  const max = Math.max(1, ...dist.map(d => d.count));
  const colors = ['#dc2626', '#f97316', '#eab308', '#22c55e', '#3b82f6'];
  const W = 520, H = 260, P = 40, barW = (W - P * 2) / dist.length - 12;

  return (
    <div data-testid="esi-distribution-chart" style={{ background: '#0b1220', padding: 16, borderRadius: 8 }}>
      <h3 style={{ margin: 0, marginBottom: 8, color: '#e5e7eb', fontSize: 16, fontWeight: 600 }}>
        ESI Triage Level Distribution
      </h3>
      <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 8 }}>
        Total assessments: <strong style={{ color: '#e5e7eb' }}>{data?.total || 0}</strong>
      </div>
      <svg width={W} height={H} role="img" aria-label="ESI distribution bar chart">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#374151" />
        {dist.map((d, i) => {
          const h = ((H - P * 2) * d.count) / max;
          const x = P + i * (barW + 12) + 6;
          const y = H - P - h;
          return (
            <g key={d.level}>
              <rect x={x} y={y} width={barW} height={h} fill={colors[i]} rx={3} />
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fill="#e5e7eb" fontSize="12" fontWeight="600">
                {d.count}
              </text>
              <text x={x + barW / 2} y={H - P + 18} textAnchor="middle" fill="#9ca3af" fontSize="11">
                ESI {d.shortLabel}
              </text>
              <text x={x + barW / 2} y={H - P + 34} textAnchor="middle" fill="#6b7280" fontSize="10">
                {d.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
