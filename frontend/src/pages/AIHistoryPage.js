import React, { useState, useEffect } from 'react';
import API from '../services/api';
import { toast } from 'react-toastify';

export default function AIHistoryPage() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { fetchHistory(); }, [page]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const { data } = await API.get(`/ai/history?page=${page}&limit=20`);
      setHistory(data.data || []);
      setPagination(data.pagination || { total: 0, totalPages: 1 });
    } catch (e) {
      toast.error('Failed to load AI history');
    }
    setLoading(false);
  };

  const endpointLabel = (endpoint) => {
    const map = {
      '/ai/triage': 'Triage Assessment',
      '/ai/vitals-analysis': 'Vitals Analysis',
      '/ai/symptom-analysis': 'Symptom Analysis',
      '/ai/priority-score': 'Priority Score',
      '/ai/doctor-match': 'Doctor Match',
      '/ai/treatment-recommendation': 'Treatment Recommendation',
      '/ai/wait-prediction': 'Wait Prediction',
      '/ai/risk-assessment': 'Risk Assessment',
      '/ai/lab-interpretation': 'Lab Interpretation',
      '/ai/medication-check': 'Medication Check',
      '/ai/discharge-plan': 'Discharge Plan',
      '/ai/emergency-assess': 'Emergency Assessment',
      '/ai/bed-optimization': 'Bed Optimization',
      '/ai/flow-analysis': 'Flow Analysis',
    };
    return map[endpoint] || endpoint;
  };

  const endpointBadgeClass = (endpoint) => {
    if (endpoint.includes('triage') || endpoint.includes('emergency')) return 'badge-critical';
    if (endpoint.includes('risk') || endpoint.includes('medication')) return 'badge-warning';
    if (endpoint.includes('discharge') || endpoint.includes('treatment')) return 'badge-success';
    return 'badge-info';
  };

  return (
    <div>
      <div className="page-header">
        <h1>AI Analysis History</h1>
        <span style={{ color: '#94a3b8', fontSize: '14px' }}>
          {pagination.total} total AI analyses
        </span>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading...</div>}

      {!loading && history.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
          No AI analyses found. Run AI analyses from the triage, vitals, or other pages.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {history.map(entry => (
          <div key={entry.id} style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            overflow: 'hidden'
          }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
                cursor: 'pointer',
                justifyContent: 'space-between'
              }}
              onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className={`badge ${endpointBadgeClass(entry.endpoint)}`}>
                  {endpointLabel(entry.endpoint)}
                </span>
                {entry.patientId && (
                  <span style={{ color: '#818cf8', fontSize: '13px' }}>Patient #{entry.patientId}</span>
                )}
                <span style={{ color: '#64748b', fontSize: '12px' }}>
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
                {entry.model && (
                  <span style={{ color: '#64748b', fontSize: '11px', fontStyle: 'italic' }}>
                    {entry.model}
                  </span>
                )}
              </div>
              <span style={{ color: '#94a3b8', fontSize: '18px' }}>
                {expanded === entry.id ? '▲' : '▼'}
              </span>
            </div>
            {expanded === entry.id && (
              <div style={{
                borderTop: '1px solid #334155',
                padding: '16px',
                background: '#0f172a',
                whiteSpace: 'pre-wrap',
                fontSize: '13px',
                lineHeight: '1.6',
                color: '#cbd5e1',
                maxHeight: '400px',
                overflowY: 'auto'
              }}>
                {entry.result}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '24px' }}>
          <button
            className="btn-secondary"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </button>
          <span style={{ padding: '8px 16px', color: '#94a3b8', alignSelf: 'center' }}>
            Page {page} of {pagination.totalPages}
          </span>
          <button
            className="btn-secondary"
            onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
