import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiHome, FiUsers, FiActivity, FiHeart, FiAlertTriangle, FiList, FiUserCheck, FiFileText, FiClock, FiFolder, FiDroplet, FiPackage, FiLogOut as FiLogOutIcon, FiAlertCircle, FiGrid, FiTrendingUp, FiMonitor, FiCpu, FiZap, FiBarChart2, FiShield } from 'react-icons/fi';

const navItems = [
  { path: '/', icon: <FiHome />, label: 'Dashboard' },
  { path: '/patients', icon: <FiUsers />, label: 'Patient Registration' },
  { path: '/triage', icon: <FiActivity />, label: 'AI Triage Assessment' },
  { path: '/vitals', icon: <FiHeart />, label: 'Vital Signs Monitor' },
  { path: '/symptoms', icon: <FiAlertTriangle />, label: 'Symptom Analysis' },
  { path: '/queue', icon: <FiList />, label: 'Priority Queue' },
  { path: '/er-board', icon: <FiMonitor />, label: 'Live ER Board' },
  { path: '/assignments', icon: <FiUserCheck />, label: 'Doctor Assignment' },
  { path: '/treatments', icon: <FiFileText />, label: 'Treatment Plans' },
  { path: '/wait-times', icon: <FiClock />, label: 'Wait Time Estimation' },
  { path: '/medical-history', icon: <FiFolder />, label: 'Medical History' },
  { path: '/lab-orders', icon: <FiDroplet />, label: 'Lab Orders' },
  { path: '/medications', icon: <FiPackage />, label: 'Medication Mgmt' },
  { path: '/discharges', icon: <FiLogOutIcon />, label: 'Discharge Planning' },
  { path: '/alerts', icon: <FiAlertCircle />, label: 'Emergency Alerts' },
  { path: '/beds', icon: <FiGrid />, label: 'Bed Management' },
  { path: '/patient-flow', icon: <FiTrendingUp />, label: 'Patient Flow Analytics' },
  { path: '/esi-calculator', icon: <FiZap />, label: 'ESI Calculator' },
  { path: '/resource-predictor', icon: <FiBarChart2 />, label: 'Resource Predictor' },
  { path: '/med-safety', icon: <FiShield />, label: 'Medication Safety' },
  { path: '/ai-history', icon: <FiCpu />, label: 'AI History' },
  { path: '/ai-predictive', icon: <FiBarChart2 />, label: 'AI Predictive' },
  // === Batch 06 Gaps & Frontend Mounts ===
  { path: '/cf-agentic-er-flow-optimization', label: 'Agentic ER flow optimization', icon: '✨' },
  { path: '/cf-multi-modal-symptom-assessment', label: 'Multi-modal symptom assessment', icon: '✨' },
  { path: '/cf-prediction-action-bundling', label: 'Prediction + action bundling', icon: '✨' },
  { path: '/cf-sepsis-early-warning', label: 'Sepsis early warning', icon: '✨' },
  { path: '/cf-discharge-risk-stratification', label: 'Discharge risk stratification', icon: '✨' },
  { path: '/gap-patients-without-patient', label: 'Patients without `/patient', icon: '✨' },
  { path: '/gap-resources-without-staffing', label: 'Resources without `/staffing', icon: '✨' },
  { path: '/gap-discharge-without-readmission', label: 'Discharge without `/readmission', icon: '✨' },
  { path: '/gap-backend-collapses-everything-into-crud-js', label: 'Backend collapses everything into crud.js', icon: '✨' },
  { path: '/gap-no-production', label: 'No production', icon: '✨' },
  { path: '/gap-no-real', label: 'No real', icon: '✨' },
  { path: '/gap-no-ambulance-ems-integration-arrival-notifications', label: 'No ambulance/EMS integration (arrival notifications, field triage data)', icon: '✨' },
  { path: '/gap-no-multi', label: 'No multi', icon: '✨' },
  { path: '/gap-no-webhooks-for-critical-alerts-to-pagers-phones', label: 'No webhooks for critical alerts to pagers/phones', icon: '✨' },
  { path: '/gap-no-notifications-layer-dedicated-to-clinical-alert', label: 'No notifications layer dedicated to clinical alerts', icon: '✨' },
  { path: '/gap-no-file-upload-for-imaging-lab-attachments-visible', label: 'No file upload for imaging/lab attachments visible', icon: '✨' }
];

export default function Layout({ user, onLogout, children }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h2>ER Triage AI</h2>
          <span>Intelligent Emergency Care</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(item => (
            <div
              key={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user.name?.charAt(0)}</div>
            <div>
              <div className="user-name">{user.name}</div>
              <div className="user-role">{user.role}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={onLogout}>Sign Out</button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
