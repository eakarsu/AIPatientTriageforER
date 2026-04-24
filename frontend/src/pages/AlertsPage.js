import React from 'react';
import CrudPage from '../components/CrudPage';

const severityBadge = (s) => {
  const map = { 'Low': 'badge-success', 'Medium': 'badge-info', 'High': 'badge-warning', 'Critical': 'badge-critical' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};
const statusBadge = (s) => {
  const map = { 'Active': 'badge-critical', 'Responding': 'badge-warning', 'Resolved': 'badge-success', 'False Alarm': 'badge-default' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function AlertsPage() {
  return <CrudPage
    title="Emergency Alerts"
    apiPath="/alerts"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Type', key: 'alertType' },
      { header: 'Severity', render: r => severityBadge(r.severity) },
      { header: 'Location', key: 'location' },
      { header: 'Description', render: r => (r.description || '').substring(0, 35) + '...' },
      { header: 'Status', render: r => statusBadge(r.status) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID (optional)', type: 'number' },
      { key: 'alertType', label: 'Alert Type', type: 'select', options: ['Code Blue', 'Code Red', 'Code Yellow', 'Code White', 'Code Orange', 'Trauma Alert', 'Stroke Alert', 'STEMI Alert'] },
      { key: 'severity', label: 'Severity', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'] },
      { key: 'location', label: 'Location' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Responding', 'Resolved', 'False Alarm'] },
      { key: 'triggeredBy', label: 'Triggered By' }
    ]}
    defaultFormData={{ severity: 'High', status: 'Active', alertType: 'Code Blue' }}
    renderBadge={(val) => severityBadge(val)}
    aiConfig={{
      endpoint: '/ai/emergency-assess',
      buttonLabel: 'AI Emergency Assessment',
      getPayload: (data) => ({
        alertType: data.alertType,
        description: data.description,
        location: data.location,
        patientCondition: data.aiAssessment
      })
    }}
  />;
}
