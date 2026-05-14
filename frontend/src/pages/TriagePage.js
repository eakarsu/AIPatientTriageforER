import React from 'react';
import CrudPage from '../components/CrudPage';

const triageBadge = (level) => {
  const map = { '1-Resuscitation': 'badge-critical', '2-Emergency': 'badge-critical', '3-Urgent': 'badge-warning', '4-Less Urgent': 'badge-info', '5-Non-Urgent': 'badge-success' };
  return <span className={`badge ${map[level] || 'badge-default'}`}>{level}</span>;
};

export default function TriagePage() {
  return <CrudPage
    title="AI Triage Assessment"
    apiPath="/triage"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `Patient #${r.patientId}` },
      { header: 'Chief Complaint', render: r => (r.chiefComplaint || '').substring(0, 40) + '...' },
      { header: 'Pain', render: r => `${r.painLevel}/10` },
      { header: 'Triage Level', render: r => triageBadge(r.triageLevel) },
      { header: 'AI Confidence', render: r => r.aiConfidence ? `${(r.aiConfidence * 100).toFixed(0)}%` : '-' },
      { header: 'AI Rec', render: r => r.aiRecommendation
        ? <span className="badge badge-info" title={r.aiRecommendation}>AI</span>
        : <span style={{ color: '#475569', fontSize: '12px' }}>-</span> }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'chiefComplaint', label: 'Chief Complaint', type: 'textarea' },
      { key: 'symptoms', label: 'Symptoms', type: 'textarea' },
      { key: 'painLevel', label: 'Pain Level (0-10)', type: 'number' },
      { key: 'onsetTime', label: 'Onset Time' },
      { key: 'triageLevel', label: 'Triage Level', type: 'select', options: ['1-Resuscitation', '2-Emergency', '3-Urgent', '4-Less Urgent', '5-Non-Urgent'] },
      { key: 'aiRecommendation', label: 'AI Recommendation', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]}
    detailFields={[
      { key: 'chiefComplaint', label: 'Chief Complaint' },
      { key: 'symptoms', label: 'Symptoms' },
      { key: 'painLevel', label: 'Pain Level' },
      { key: 'onsetTime', label: 'Onset Time' },
      { key: 'triageLevel', label: 'Triage Level', badge: true },
      { key: 'aiConfidence', label: 'AI Confidence' },
      { key: 'aiRecommendation', label: 'AI Recommendation' },
      { key: 'notes', label: 'Notes' }
    ]}
    defaultFormData={{ triageLevel: '3-Urgent', painLevel: 5 }}
    renderBadge={(val) => triageBadge(val)}
    aiConfig={{
      endpoint: '/ai/triage',
      buttonLabel: 'AI Triage Assessment',
      getPayload: (data) => ({
        patientId: data.patientId,
        chiefComplaint: data.chiefComplaint,
        symptoms: data.symptoms,
        painLevel: data.painLevel
      })
    }}
  />;
}
