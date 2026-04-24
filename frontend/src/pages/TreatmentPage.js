import React from 'react';
import CrudPage from '../components/CrudPage';

const statusBadge = (s) => {
  const map = { 'Planned': 'badge-info', 'In Progress': 'badge-warning', 'Completed': 'badge-success', 'Cancelled': 'badge-default' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function TreatmentPage() {
  return <CrudPage
    title="Treatment Plans"
    apiPath="/treatments"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'Diagnosis', render: r => (r.diagnosis || '').substring(0, 30) },
      { header: 'Evidence', key: 'aiEvidenceLevel' },
      { header: 'Prescribed By', key: 'prescribedBy' },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'diagnosis', label: 'Diagnosis', type: 'textarea' },
      { key: 'treatmentPlan', label: 'Treatment Plan', type: 'textarea' },
      { key: 'procedures', label: 'Procedures', type: 'textarea' },
      { key: 'prescribedBy', label: 'Prescribed By' },
      { key: 'status', label: 'Status', type: 'select', options: ['Planned', 'In Progress', 'Completed', 'Cancelled'] },
      { key: 'aiRecommendation', label: 'AI Recommendation', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]}
    defaultFormData={{ status: 'Planned' }}
    renderBadge={(val) => statusBadge(val)}
    aiConfig={{
      endpoint: '/ai/treatment-recommendation',
      buttonLabel: 'AI Treatment Recommendation',
      getPayload: (data) => ({
        diagnosis: data.diagnosis,
        symptoms: data.notes || data.diagnosis,
        allergies: '',
        currentMedications: ''
      })
    }}
  />;
}
