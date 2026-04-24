import React from 'react';
import CrudPage from '../components/CrudPage';

const priorityBadge = (p) => {
  const map = { 1: 'badge-critical', 2: 'badge-critical', 3: 'badge-warning', 4: 'badge-info', 5: 'badge-success' };
  const labels = { 1: 'P1 - Critical', 2: 'P2 - Emergency', 3: 'P3 - Urgent', 4: 'P4 - Less Urgent', 5: 'P5 - Non-Urgent' };
  return <span className={`badge ${map[p] || 'badge-default'}`}>{labels[p] || `P${p}`}</span>;
};

const statusBadge = (s) => {
  const map = { 'Waiting': 'badge-warning', 'Called': 'badge-info', 'In Progress': 'badge-critical', 'Completed': 'badge-success', 'Left': 'badge-default' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function QueuePage() {
  return <CrudPage
    title="Priority Queue Management"
    apiPath="/queue"
    columns={[
      { header: 'Pos', render: r => `#${r.queuePosition}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'Priority', render: r => priorityBadge(r.priority) },
      { header: 'Wait (min)', key: 'estimatedWaitMinutes' },
      { header: 'Department', key: 'department' },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'priority', label: 'Priority (1-5)', type: 'number' },
      { key: 'queuePosition', label: 'Queue Position', type: 'number' },
      { key: 'estimatedWaitMinutes', label: 'Estimated Wait (min)', type: 'number' },
      { key: 'department', label: 'Department' },
      { key: 'status', label: 'Status', type: 'select', options: ['Waiting', 'Called', 'In Progress', 'Completed', 'Left'] },
      { key: 'aiPriorityReason', label: 'AI Priority Reason', type: 'textarea' }
    ]}
    defaultFormData={{ status: 'Waiting', priority: 3 }}
    renderBadge={(val) => typeof val === 'number' ? priorityBadge(val) : statusBadge(val)}
    aiConfig={{
      endpoint: '/ai/priority-score',
      buttonLabel: 'AI Priority Score',
      getPayload: (data) => ({
        chiefComplaint: data.aiPriorityReason || 'General assessment',
        triageLevel: data.priority,
        symptoms: data.aiPriorityReason,
        painLevel: 5
      })
    }}
  />;
}
