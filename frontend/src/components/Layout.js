import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiHome, FiUsers, FiActivity, FiHeart, FiAlertTriangle, FiList, FiUserCheck, FiFileText, FiClock, FiFolder, FiDroplet, FiPackage, FiLogOut as FiLogOutIcon, FiAlertCircle, FiGrid, FiTrendingUp } from 'react-icons/fi';

const navItems = [
  { path: '/', icon: <FiHome />, label: 'Dashboard' },
  { path: '/patients', icon: <FiUsers />, label: 'Patient Registration' },
  { path: '/triage', icon: <FiActivity />, label: 'AI Triage Assessment' },
  { path: '/vitals', icon: <FiHeart />, label: 'Vital Signs Monitor' },
  { path: '/symptoms', icon: <FiAlertTriangle />, label: 'Symptom Analysis' },
  { path: '/queue', icon: <FiList />, label: 'Priority Queue' },
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
