import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';

const features = [
  { path: '/patients', icon: '👥', title: 'Patient Registration', desc: 'Register and manage patient intake', color: '#6366f1', countKey: 'patients' },
  { path: '/triage', icon: '🏥', title: 'AI Triage Assessment', desc: 'AI-powered triage level classification', color: '#ef4444' },
  { path: '/vitals', icon: '💓', title: 'Vital Signs Monitor', desc: 'Real-time vital signs tracking & AI analysis', color: '#f59e0b' },
  { path: '/symptoms', icon: '🔍', title: 'Symptom Analysis', desc: 'AI differential diagnosis engine', color: '#06b6d4' },
  { path: '/queue', icon: '📋', title: 'Priority Queue', desc: 'AI-optimized patient priority queue', color: '#8b5cf6', countKey: 'waitingQueue' },
  { path: '/assignments', icon: '👨‍⚕️', title: 'Doctor Assignment', desc: 'AI-matched physician assignments', color: '#10b981' },
  { path: '/treatments', icon: '💊', title: 'Treatment Plans', desc: 'AI treatment recommendations', color: '#ec4899' },
  { path: '/wait-times', icon: '⏱️', title: 'Wait Time Estimation', desc: 'AI-predicted department wait times', color: '#f97316' },
  { path: '/medical-history', icon: '📁', title: 'Medical History', desc: 'Patient history & AI risk assessment', color: '#14b8a6' },
  { path: '/lab-orders', icon: '🧪', title: 'Lab Orders', desc: 'Lab management with AI interpretation', color: '#a855f7' },
  { path: '/medications', icon: '💉', title: 'Medication Management', desc: 'Prescriptions with AI interaction checks', color: '#3b82f6' },
  { path: '/discharges', icon: '🏠', title: 'Discharge Planning', desc: 'AI-assisted discharge instructions', color: '#22c55e' },
  { path: '/alerts', icon: '🚨', title: 'Emergency Alerts', desc: 'Real-time emergency alert management', color: '#ef4444', countKey: 'activeAlerts' },
  { path: '/beds', icon: '🛏️', title: 'Bed Management', desc: 'AI-optimized bed allocation', color: '#06b6d4', countKey: 'occupiedBeds' },
  { path: '/patient-flow', icon: '📊', title: 'Patient Flow Analytics', desc: 'AI predictive analytics & insights', color: '#8b5cf6' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({});

  useEffect(() => {
    API.get('/dashboard').then(r => setStats(r.data)).catch(() => {});
  }, []);

  return (
    <div>
      <div className="dashboard-header">
        <h1>Emergency Department Command Center</h1>
        <p>AI-powered patient triage and management system</p>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.patients || 0}</div>
          <div className="stat-label">Total Patients</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.waitingQueue || 0}</div>
          <div className="stat-label">In Queue</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.activeAlerts || 0}</div>
          <div className="stat-label">Active Alerts</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.occupancyRate || 0}%</div>
          <div className="stat-label">Bed Occupancy</div>
        </div>
      </div>
      <div className="feature-grid">
        {features.map(f => (
          <div key={f.path} className="feature-card" style={{ '--card-color': f.color }} onClick={() => navigate(f.path)}>
            <div className="feature-icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
            {f.countKey && stats[f.countKey] !== undefined && (
              <div className="feature-count">{stats[f.countKey]}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
