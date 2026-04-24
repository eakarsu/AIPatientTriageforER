import React from 'react';
import CrudPage from '../components/CrudPage';

const statusBadge = (s) => {
  const map = { 'Active': 'badge-warning', 'Completed': 'badge-success', 'Discontinued': 'badge-critical', 'On Hold': 'badge-info' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function MedicationsPage() {
  return <CrudPage
    title="Medication Management"
    apiPath="/medications"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'Medication', key: 'medicationName' },
      { header: 'Dosage', key: 'dosage' },
      { header: 'Route', key: 'route' },
      { header: 'Frequency', key: 'frequency' },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'medicationName', label: 'Medication Name' },
      { key: 'dosage', label: 'Dosage' },
      { key: 'frequency', label: 'Frequency' },
      { key: 'route', label: 'Route', type: 'select', options: ['Oral', 'IV', 'IM', 'Topical', 'Inhalation', 'Sublingual'] },
      { key: 'prescribedBy', label: 'Prescribed By' },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Completed', 'Discontinued', 'On Hold'] },
      { key: 'sideEffects', label: 'Side Effects', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]}
    defaultFormData={{ status: 'Active', route: 'Oral' }}
    renderBadge={(val) => statusBadge(val)}
    aiConfig={{
      endpoint: '/ai/medication-check',
      buttonLabel: 'AI Medication Check',
      getPayload: (data) => ({
        medication: data.medicationName,
        dosage: data.dosage,
        currentMedications: '',
        allergies: ''
      })
    }}
  />;
}
