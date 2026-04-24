import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PatientsPage from './pages/PatientsPage';
import TriagePage from './pages/TriagePage';
import VitalsPage from './pages/VitalsPage';
import SymptomsPage from './pages/SymptomsPage';
import QueuePage from './pages/QueuePage';
import DoctorAssignmentPage from './pages/DoctorAssignmentPage';
import TreatmentPage from './pages/TreatmentPage';
import WaitTimePage from './pages/WaitTimePage';
import MedicalHistoryPage from './pages/MedicalHistoryPage';
import LabOrdersPage from './pages/LabOrdersPage';
import MedicationsPage from './pages/MedicationsPage';
import DischargePage from './pages/DischargePage';
import AlertsPage from './pages/AlertsPage';
import BedManagementPage from './pages/BedManagementPage';
import PatientFlowPage from './pages/PatientFlowPage';
import Layout from './components/Layout';
import './App.css';

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  if (!user) return <><Login onLogin={handleLogin} /><ToastContainer position="top-right" theme="dark" /></>;

  return (
    <Router>
      <Layout user={user} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/patients" element={<PatientsPage />} />
          <Route path="/triage" element={<TriagePage />} />
          <Route path="/vitals" element={<VitalsPage />} />
          <Route path="/symptoms" element={<SymptomsPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/assignments" element={<DoctorAssignmentPage />} />
          <Route path="/treatments" element={<TreatmentPage />} />
          <Route path="/wait-times" element={<WaitTimePage />} />
          <Route path="/medical-history" element={<MedicalHistoryPage />} />
          <Route path="/lab-orders" element={<LabOrdersPage />} />
          <Route path="/medications" element={<MedicationsPage />} />
          <Route path="/discharges" element={<DischargePage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/beds" element={<BedManagementPage />} />
          <Route path="/patient-flow" element={<PatientFlowPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
      <ToastContainer position="top-right" theme="dark" />
    </Router>
  );
}

export default App;
