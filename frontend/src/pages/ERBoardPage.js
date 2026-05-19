import React, { useState, useEffect, useRef } from 'react';
import API from '../services/api';
import { toast } from 'react-toastify';

const POLL_INTERVAL = 30000; // 30 seconds

export default function ERBoardPage() {
  const [queue, setQueue] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef(null);
  const pollRef = useRef(null);

  const fetchQueue = async () => {
    try {
      const { data } = await API.get('/queue/live');
      setQueue(data.queue || []);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (e) {
      // silent - WS may be providing data
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchQueue();

    // Try WebSocket connection
    const wsUrl = `ws://localhost:3001`;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'queue_update') {
            setQueue(msg.queue || []);
            setLastUpdate(new Date().toLocaleTimeString());
            setLoading(false);
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        setWsConnected(false);
      };

      ws.onerror = () => {
        setWsConnected(false);
      };
    } catch (e) {
      setWsConnected(false);
    }

    // Fallback polling every 30 seconds
    pollRef.current = setInterval(fetchQueue, POLL_INTERVAL);

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const priorityBadge = (p) => {
    const map = { 1: { cls: 'badge-critical', label: 'P1 Critical' }, 2: { cls: 'badge-critical', label: 'P2 Emergency' }, 3: { cls: 'badge-warning', label: 'P3 Urgent' }, 4: { cls: 'badge-info', label: 'P4 Less Urgent' }, 5: { cls: 'badge-success', label: 'P5 Non-Urgent' } };
    const conf = map[p] || { cls: 'badge-default', label: `P${p}` };
    return <span className={`badge ${conf.cls}`}>{conf.label}</span>;
  };

  const waitColor = (minutes) => {
    if (minutes > 60) return '#f87171';
    if (minutes > 30) return '#fb923c';
    return '#4ade80';
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Live ER Board</h1>
          <div style={{ display: 'flex', gap: '12px', marginTop: '4px', alignItems: 'center' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '12px',
              color: wsConnected ? '#4ade80' : '#94a3b8'
            }}>
              <span style={{
                display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
                background: wsConnected ? '#4ade80' : '#64748b',
                boxShadow: wsConnected ? '0 0 6px #4ade80' : 'none'
              }} />
              {wsConnected ? 'Live (WebSocket)' : 'Polling every 30s'}
            </span>
            {lastUpdate && (
              <span style={{ color: '#64748b', fontSize: '12px' }}>Last updated: {lastUpdate}</span>
            )}
          </div>
        </div>
        <button className="btn-secondary" onClick={fetchQueue}>Refresh</button>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#1e293b', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#f8fafc' }}>{queue.length}</div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>Waiting</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#f87171' }}>
            {queue.filter(q => q.priority <= 2).length}
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>Critical/Emergency</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#fb923c' }}>
            {queue.length > 0 ? Math.round(queue.reduce((sum, q) => sum + (q.waitedMinutes || 0), 0) / queue.length) : 0}
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>Avg Wait (min)</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#818cf8' }}>
            {queue.filter(q => q.waitedMinutes > 60).length}
          </div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>Waiting 1hr+</div>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading queue...</div>}

      {!loading && queue.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
          No patients currently waiting in queue.
        </div>
      )}

      {/* Queue Table */}
      {queue.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <th style={{ padding: '12px', textAlign: 'left', color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Pos</th>
                <th style={{ padding: '12px', textAlign: 'left', color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Patient</th>
                <th style={{ padding: '12px', textAlign: 'left', color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Priority</th>
                <th style={{ padding: '12px', textAlign: 'left', color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Department</th>
                <th style={{ padding: '12px', textAlign: 'right', color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Waited</th>
                <th style={{ padding: '12px', textAlign: 'right', color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Est. Remaining</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((entry, idx) => (
                <tr
                  key={entry.id}
                  style={{
                    borderBottom: '1px solid #1e293b',
                    background: entry.priority <= 2 ? 'rgba(239,68,68,0.07)' : 'transparent'
                  }}
                >
                  <td style={{ padding: '14px 12px', color: '#94a3b8' }}>#{entry.queuePosition || idx + 1}</td>
                  <td style={{ padding: '14px 12px', color: '#f1f5f9', fontWeight: '500' }}>
                    {entry.Patient ? `${entry.Patient.firstName} ${entry.Patient.lastName}` : `Patient #${entry.patientId}`}
                  </td>
                  <td style={{ padding: '14px 12px' }}>{priorityBadge(entry.priority)}</td>
                  <td style={{ padding: '14px 12px', color: '#94a3b8' }}>{entry.department || 'General ER'}</td>
                  <td style={{ padding: '14px 12px', textAlign: 'right', fontWeight: '600', color: waitColor(entry.waitedMinutes) }}>
                    {entry.waitedMinutes} min
                  </td>
                  <td style={{ padding: '14px 12px', textAlign: 'right', color: '#94a3b8' }}>
                    ~{entry.estimatedRemainingMinutes} min
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
