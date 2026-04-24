import React from 'react';
import CrudPage from '../components/CrudPage';

const urgencyBadge = (u) => {
  const map = { 'STAT': 'badge-critical', 'Urgent': 'badge-warning', 'Routine': 'badge-info' };
  return <span className={`badge ${map[u] || 'badge-default'}`}>{u}</span>;
};
const statusBadge = (s) => {
  const map = { 'Ordered': 'badge-info', 'In Progress': 'badge-warning', 'Completed': 'badge-success', 'Cancelled': 'badge-default' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function LabOrdersPage() {
  return <CrudPage
    title="Lab Orders"
    apiPath="/lab-orders"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'Test', key: 'testName' },
      { header: 'Type', key: 'testType' },
      { header: 'Urgency', render: r => urgencyBadge(r.urgency) },
      { header: 'Results', render: r => (r.results || '-').substring(0, 25) },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'testName', label: 'Test Name' },
      { key: 'testType', label: 'Test Type' },
      { key: 'urgency', label: 'Urgency', type: 'select', options: ['Routine', 'Urgent', 'STAT'] },
      { key: 'status', label: 'Status', type: 'select', options: ['Ordered', 'In Progress', 'Completed', 'Cancelled'] },
      { key: 'results', label: 'Results', type: 'textarea' },
      { key: 'normalRange', label: 'Normal Range' },
      { key: 'orderedBy', label: 'Ordered By' },
      { key: 'aiInterpretation', label: 'AI Interpretation', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]}
    defaultFormData={{ urgency: 'Routine', status: 'Ordered' }}
    renderBadge={(val) => urgencyBadge(val)}
    aiConfig={{
      endpoint: '/ai/lab-interpretation',
      buttonLabel: 'AI Lab Interpretation',
      getPayload: (data) => ({
        testName: data.testName,
        results: data.results,
        normalRange: data.normalRange,
        patientContext: data.notes
      })
    }}
  />;
}
