import React from 'react';
import CrudPage from '../components/CrudPage';

const severityBadge = (s) => {
  const map = { 'Mild': 'badge-success', 'Moderate': 'badge-warning', 'Severe': 'badge-critical', 'Critical': 'badge-critical' };
  return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
};

export default function SymptomsPage() {
  return <CrudPage
    title="Symptom Analysis"
    apiPath="/symptoms"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'Symptoms', render: r => (r.symptoms || '').substring(0, 35) + '...' },
      { header: 'Severity', render: r => severityBadge(r.severity) },
      { header: 'Body Region', key: 'bodyRegion' },
      { header: 'AI Diagnosis', render: r => (r.aiDiagnosis || '-').substring(0, 30) },
      { header: 'Urgency', render: r => r.urgencyScore ? `${r.urgencyScore}/10` : '-' }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'symptoms', label: 'Symptoms', type: 'textarea' },
      { key: 'duration', label: 'Duration' },
      { key: 'severity', label: 'Severity', type: 'select', options: ['Mild', 'Moderate', 'Severe', 'Critical'] },
      { key: 'bodyRegion', label: 'Body Region' },
      { key: 'aiDiagnosis', label: 'AI Diagnosis', type: 'textarea' },
      { key: 'differentialDiagnosis', label: 'Differential Diagnosis', type: 'textarea' },
      { key: 'recommendedTests', label: 'Recommended Tests', type: 'textarea' },
      { key: 'urgencyScore', label: 'Urgency Score (1-10)', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]}
    defaultFormData={{ severity: 'Moderate' }}
    renderBadge={(val) => severityBadge(val)}
    aiConfig={{
      endpoint: '/ai/symptom-analysis',
      buttonLabel: 'AI Symptom Analysis',
      getPayload: (data) => ({
        symptoms: data.symptoms,
        duration: data.duration,
        severity: data.severity,
        bodyRegion: data.bodyRegion
      })
    }}
  />;
}
