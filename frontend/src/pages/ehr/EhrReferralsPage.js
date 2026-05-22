import React from 'react';
import EhrModule from '../../components/EhrModule';

const statusBadgeMap = {
  Pending: 'badge-warning', Accepted: 'badge-info', Scheduled: 'badge-info',
  Completed: 'badge-success', Declined: 'badge-danger', Cancelled: 'badge-danger'
};
const urgencyBadgeMap = {
  Routine: 'badge-default', Urgent: 'badge-warning', Emergent: 'badge-critical'
};

const module = {
  slug: 'referrals',
  label: 'EHR Referrals',
  labelSingular: 'Referral',
  idField: 'referralId',
  titleFn: r => `${r.specialistType || 'Referral'} — ${r.receivingProviderName || ''}`,
  statusOptions: ['Pending', 'Accepted', 'Scheduled', 'Completed', 'Declined', 'Cancelled'],
  statusBadge: s => statusBadgeMap[s] || 'badge-default',
  defaultValues: { urgency: 'Routine', status: 'Pending', inNetwork: true },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Specialist Type', key: 'specialistType' },
    { header: 'Receiving Provider', key: 'receivingProviderName' },
    { header: 'Urgency', render: r => <span className={`badge ${urgencyBadgeMap[r.urgency] || 'badge-default'}`}>{r.urgency}</span> },
    { header: 'Status', render: r => <span className={`badge ${statusBadgeMap[r.status] || 'badge-default'}`}>{r.status}</span> },
    { header: 'In Network', render: r => r.inNetwork ? '✓' : '✗' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'referringProviderId', label: 'Referring Provider ID' },
    { key: 'receivingProviderName', label: 'Receiving Provider' },
    { key: 'specialistType', label: 'Specialist Type' },
    { key: 'reason', label: 'Reason' },
    { key: 'urgency', label: 'Urgency' },
    { key: 'status', label: 'Status' },
    { key: 'appointmentDate', label: 'Appointment Date', render: r => r.appointmentDate ? new Date(r.appointmentDate).toLocaleString() : '—' },
    { key: 'inNetwork', label: 'In Network', render: r => r.inNetwork ? 'Yes' : 'No' },
    { key: 'authorizationNumber', label: 'Authorization Number' },
    { key: 'referralLetter', label: 'Referral Letter' },
    { key: 'aiRecommendedSpecialist', label: 'AI Recommended Specialist' },
    { key: 'aiDraftedLetter', label: 'AI Drafted Letter' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'referringProviderId', label: 'Referring Provider ID', type: 'number' },
    ]},
    { type: 'row', key: 'row2', fields: [
      { key: 'specialistType', label: 'Specialist Type', placeholder: 'e.g. Cardiology' },
      { key: 'receivingProviderName', label: 'Receiving Provider Name' },
    ]},
    { key: 'reason', label: 'Reason', type: 'textarea' },
    { type: 'row', key: 'row3', fields: [
      { key: 'urgency', label: 'Urgency', type: 'select', options: ['Routine', 'Urgent', 'Emergent'] },
      { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Accepted', 'Scheduled', 'Completed', 'Declined', 'Cancelled'] },
    ]},
    { type: 'row', key: 'row4', fields: [
      { key: 'appointmentDate', label: 'Appointment Date', type: 'datetime-local' },
      { key: 'authorizationNumber', label: 'Authorization Number' },
    ]},
    { key: 'inNetwork', label: 'In Network', type: 'checkbox' },
    { key: 'referralLetter', label: 'Referral Letter', type: 'textarea' },
  ],
  aiVerbs: [
    'suggest-specialist', 'draft-referral-letter', 'check-network-status', 'classify-urgency',
    'predict-wait-time', 'suggest-questions-to-ask', 'summarize-history-for-specialist',
    'extract-from-clinical-note', 'generate-pre-auth-justification', 'identify-required-records',
    'draft-patient-instructions', 'score-appropriateness', 'suggest-alternative-specialty',
    'predict-acceptance', 'summarize-specialist-feedback', 'detect-missing-info',
  ],
};

export default function EhrReferralsPage() {
  return <EhrModule module={module} />;
}
