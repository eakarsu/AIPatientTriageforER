import React from 'react';
import CrudPage from '../components/CrudPage';

const statusBadge = (s) => {
  const map = { 'Pending': 'badge-warning', 'Approved': 'badge-info', 'Completed': 'badge-success' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function DischargePage() {
  return <CrudPage
    title="Discharge Planning"
    apiPath="/discharges"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'Diagnosis', render: r => (r.diagnosis || '').substring(0, 30) },
      { header: 'Discharged By', key: 'dischargedBy' },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'diagnosis', label: 'Diagnosis', type: 'textarea' },
      { key: 'dischargeSummary', label: 'Discharge Summary', type: 'textarea' },
      { key: 'followUpInstructions', label: 'Follow-Up Instructions', type: 'textarea' },
      { key: 'prescriptions', label: 'Prescriptions', type: 'textarea' },
      { key: 'dischargedBy', label: 'Discharged By' },
      { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Approved', 'Completed'] },
      { key: 'returnPrecautions', label: 'Return Precautions', type: 'textarea' }
    ]}
    defaultFormData={{ status: 'Pending' }}
    renderBadge={(val) => statusBadge(val)}
    aiConfig={{
      endpoint: '/ai/discharge-plan',
      buttonLabel: 'AI Discharge Plan',
      getPayload: (data) => ({
        diagnosis: data.diagnosis,
        treatment: data.dischargeSummary,
        medications: data.prescriptions,
        procedures: ''
      })
    }}
  />;
}
