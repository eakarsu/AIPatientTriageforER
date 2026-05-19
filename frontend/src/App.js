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
import AIHistoryPage from './pages/AIHistoryPage';
import ERBoardPage from './pages/ERBoardPage';
import ESICalculatorPage from './pages/ESICalculatorPage';
import ResourcePredictorPage from './pages/ResourcePredictorPage';
import MedSafetyPage from './pages/MedSafetyPage';
import AIPredictivePage from './pages/AIPredictivePage';
import Layout from './components/Layout';
import './App.css';

// // === Batch 06 Gaps & Frontend Mounts ===
import CFAgenticErFlowOptimizationPage from './pages/CFAgenticErFlowOptimizationPage';
import CFMultiModalSymptomAssessmentPage from './pages/CFMultiModalSymptomAssessmentPage';
import CFPredictionActionBundlingPage from './pages/CFPredictionActionBundlingPage';
import CFSepsisEarlyWarningPage from './pages/CFSepsisEarlyWarningPage';
import CFDischargeRiskStratificationPage from './pages/CFDischargeRiskStratificationPage';
import GapPatientsWithoutPatientPage from './pages/GapPatientsWithoutPatientPage';
import GapResourcesWithoutStaffingPage from './pages/GapResourcesWithoutStaffingPage';
import GapDischargeWithoutReadmissionPage from './pages/GapDischargeWithoutReadmissionPage';
import GapBackendCollapsesEverythingIntoCrudJsPage from './pages/GapBackendCollapsesEverythingIntoCrudJsPage';
import GapNoProductionPage from './pages/GapNoProductionPage';
import GapNoRealPage from './pages/GapNoRealPage';
import GapNoAmbulanceEmsIntegrationArrivalNotificationsPage from './pages/GapNoAmbulanceEmsIntegrationArrivalNotificationsPage';
import GapNoMultiPage from './pages/GapNoMultiPage';
import GapNoWebhooksForCriticalAlertsToPagersPhonesPage from './pages/GapNoWebhooksForCriticalAlertsToPagersPhonesPage';
import GapNoNotificationsLayerDedicatedToClinicalAlertPage from './pages/GapNoNotificationsLayerDedicatedToClinicalAlertPage';
import GapNoFileUploadForImagingLabAttachmentsVisiblePage from './pages/GapNoFileUploadForImagingLabAttachmentsVisiblePage';
import CustomViewsPage from './pages/CustomViewsPage';
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
          <Route path="/ai-history" element={<AIHistoryPage />} />
          <Route path="/er-board" element={<ERBoardPage />} />
          <Route path="/esi-calculator" element={<ESICalculatorPage />} />
          <Route path="/resource-predictor" element={<ResourcePredictorPage />} />
          <Route path="/med-safety" element={<MedSafetyPage />} />
          <Route path="/ai-predictive" element={<AIPredictivePage />} />
          <Route path="/custom-views" element={<CustomViewsPage />} />
          <Route path="*" element={<Navigate to="/" />}/>
        
          {/* // === Batch 06 Gaps & Frontend Mounts === */}
          <Route path="/cf-agentic-er-flow-optimization" element={<CFAgenticErFlowOptimizationPage />} />
          <Route path="/cf-multi-modal-symptom-assessment" element={<CFMultiModalSymptomAssessmentPage />} />
          <Route path="/cf-prediction-action-bundling" element={<CFPredictionActionBundlingPage />} />
          <Route path="/cf-sepsis-early-warning" element={<CFSepsisEarlyWarningPage />} />
          <Route path="/cf-discharge-risk-stratification" element={<CFDischargeRiskStratificationPage />} />
          <Route path="/gap-patients-without-patient" element={<GapPatientsWithoutPatientPage />} />
          <Route path="/gap-resources-without-staffing" element={<GapResourcesWithoutStaffingPage />} />
          <Route path="/gap-discharge-without-readmission" element={<GapDischargeWithoutReadmissionPage />} />
          <Route path="/gap-backend-collapses-everything-into-crud-js" element={<GapBackendCollapsesEverythingIntoCrudJsPage />} />
          <Route path="/gap-no-production" element={<GapNoProductionPage />} />
          <Route path="/gap-no-real" element={<GapNoRealPage />} />
          <Route path="/gap-no-ambulance-ems-integration-arrival-notifications" element={<GapNoAmbulanceEmsIntegrationArrivalNotificationsPage />} />
          <Route path="/gap-no-multi" element={<GapNoMultiPage />} />
          <Route path="/gap-no-webhooks-for-critical-alerts-to-pagers-phones" element={<GapNoWebhooksForCriticalAlertsToPagersPhonesPage />} />
          <Route path="/gap-no-notifications-layer-dedicated-to-clinical-alert" element={<GapNoNotificationsLayerDedicatedToClinicalAlertPage />} />
          <Route path="/gap-no-file-upload-for-imaging-lab-attachments-visible" element={<GapNoFileUploadForImagingLabAttachmentsVisiblePage />} />
        </Routes>
      </Layout>
      <ToastContainer position="top-right" theme="dark" />
    </Router>
  );
}

export default App;
