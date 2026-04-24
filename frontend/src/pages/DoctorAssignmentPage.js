import React from 'react';
import CrudPage from '../components/CrudPage';

const statusBadge = (s) => {
  const map = { 'Assigned': 'badge-info', 'In Consultation': 'badge-warning', 'Completed': 'badge-success', 'Transferred': 'badge-default' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function DoctorAssignmentPage() {
  return <CrudPage
    title="Doctor Assignment"
    apiPath="/assignments"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'Doctor', key: 'doctorName' },
      { header: 'Specialty', key: 'specialty' },
      { header: 'Room', key: 'room' },
      { header: 'Match', render: r => r.aiMatchScore ? `${(r.aiMatchScore * 100).toFixed(0)}%` : '-' },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'doctorName', label: 'Doctor Name' },
      { key: 'specialty', label: 'Specialty' },
      { key: 'department', label: 'Department' },
      { key: 'room', label: 'Room' },
      { key: 'status', label: 'Status', type: 'select', options: ['Assigned', 'In Consultation', 'Completed', 'Transferred'] },
      { key: 'aiMatchReason', label: 'AI Match Reason', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]}
    defaultFormData={{ status: 'Assigned' }}
    renderBadge={(val) => statusBadge(val)}
    aiConfig={{
      endpoint: '/ai/doctor-match',
      buttonLabel: 'AI Doctor Match',
      getPayload: (data) => ({
        diagnosis: data.aiMatchReason || data.notes,
        symptoms: data.aiMatchReason,
        severity: 'Moderate',
        specialtyNeeded: data.specialty
      })
    }}
  />;
}
