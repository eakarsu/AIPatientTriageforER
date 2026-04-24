import React from 'react';
import CrudPage from '../components/CrudPage';

const statusBadge = (s) => {
  const map = { 'Active': 'badge-warning', 'Resolved': 'badge-success', 'Chronic': 'badge-info', 'In Remission': 'badge-default' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function MedicalHistoryPage() {
  return <CrudPage
    title="Medical History"
    apiPath="/medical-history"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'Condition', key: 'condition' },
      { header: 'Diagnosed', key: 'diagnosedDate' },
      { header: 'Physician', key: 'physician' },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'condition', label: 'Condition' },
      { key: 'diagnosedDate', label: 'Diagnosed Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Resolved', 'Chronic', 'In Remission'] },
      { key: 'treatment', label: 'Treatment', type: 'textarea' },
      { key: 'physician', label: 'Physician' },
      { key: 'hospital', label: 'Hospital' },
      { key: 'aiRiskAssessment', label: 'AI Risk Assessment', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]}
    defaultFormData={{ status: 'Active' }}
    renderBadge={(val) => statusBadge(val)}
    aiConfig={{
      endpoint: '/ai/risk-assessment',
      buttonLabel: 'AI Risk Assessment',
      getPayload: (data) => ({
        conditions: data.condition,
        currentSymptoms: data.notes || 'Current ER visit',
        medications: data.treatment
      })
    }}
  />;
}
