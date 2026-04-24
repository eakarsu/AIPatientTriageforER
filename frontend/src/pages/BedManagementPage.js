import React from 'react';
import CrudPage from '../components/CrudPage';

const statusBadge = (s) => {
  const map = { 'Available': 'badge-success', 'Occupied': 'badge-critical', 'Reserved': 'badge-warning', 'Maintenance': 'badge-default', 'Cleaning': 'badge-info' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function BedManagementPage() {
  return <CrudPage
    title="Bed Management"
    apiPath="/beds"
    columns={[
      { header: 'Bed #', key: 'bedNumber' },
      { header: 'Ward', key: 'ward' },
      { header: 'Department', key: 'department' },
      { header: 'Type', key: 'bedType' },
      { header: 'Floor', key: 'floor' },
      { header: 'Patient', render: r => r.patientId ? `Patient #${r.patientId}` : '-' },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'bedNumber', label: 'Bed Number' },
      { key: 'ward', label: 'Ward' },
      { key: 'department', label: 'Department' },
      { key: 'bedType', label: 'Bed Type', type: 'select', options: ['Standard', 'ICU', 'Isolation', 'Pediatric', 'Trauma'] },
      { key: 'floor', label: 'Floor', type: 'number' },
      { key: 'patientId', label: 'Patient ID (optional)', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: ['Available', 'Occupied', 'Reserved', 'Maintenance', 'Cleaning'] },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]}
    defaultFormData={{ status: 'Available', bedType: 'Standard', floor: 1 }}
    renderBadge={(val) => statusBadge(val)}
    aiConfig={{
      endpoint: '/ai/bed-optimization',
      buttonLabel: 'AI Bed Optimization',
      getPayload: (data, items) => ({
        totalBeds: items.length,
        occupiedBeds: items.filter(i => i.status === 'Occupied').length,
        pendingAdmissions: 3,
        pendingDischarges: 2,
        departments: [...new Set(items.map(i => i.department))].join(', ')
      })
    }}
  />;
}
