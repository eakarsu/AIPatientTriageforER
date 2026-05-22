import React from 'react';
import EhrModule from '../../components/EhrModule';

const severityBadgeMap = {
  Mild: 'badge-info', Moderate: 'badge-warning',
  Severe: 'badge-critical', Anaphylactic: 'badge-critical'
};
const statusBadgeMap = {
  Active: 'badge-warning', Inactive: 'badge-default',
  Resolved: 'badge-success', EnteredInError: 'badge-danger'
};

const module = {
  slug: 'allergies',
  label: 'EHR Allergies',
  labelSingular: 'Allergy',
  idField: 'allergyId',
  titleFn: r => `${r.allergen || 'Allergy'} — ${r.allergenType || ''}`,
  statusOptions: ['Active', 'Inactive', 'Resolved', 'EnteredInError'],
  statusBadge: s => statusBadgeMap[s] || 'badge-default',
  defaultValues: { allergenType: 'Drug', severity: 'Mild', status: 'Active', source: 'PatientReported' },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Allergen', key: 'allergen' },
    { header: 'Type', key: 'allergenType' },
    { header: 'Severity', render: r => <span className={`badge ${severityBadgeMap[r.severity] || 'badge-default'}`}>{r.severity}</span> },
    { header: 'Status', render: r => <span className={`badge ${statusBadgeMap[r.status] || 'badge-default'}`}>{r.status}</span> },
    { header: 'Reaction', key: 'reaction' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'allergen', label: 'Allergen' },
    { key: 'allergenType', label: 'Allergen Type' },
    { key: 'severity', label: 'Severity' },
    { key: 'status', label: 'Status' },
    { key: 'reaction', label: 'Reaction' },
    { key: 'onsetDate', label: 'Onset Date' },
    { key: 'rxnormCode', label: 'RxNorm Code' },
    { key: 'snomedCode', label: 'SNOMED Code' },
    { key: 'notedBy', label: 'Noted By (Provider ID)' },
    { key: 'source', label: 'Source' },
    { key: 'aiCrossReactivityRisk', label: 'AI Cross-Reactivity Risk' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'allergen', label: 'Allergen', placeholder: 'e.g. Penicillin' },
    ]},
    { type: 'row', key: 'row2', fields: [
      { key: 'allergenType', label: 'Allergen Type', type: 'select', options: ['Drug', 'Food', 'Environmental', 'Latex', 'Other'] },
      { key: 'severity', label: 'Severity', type: 'select', options: ['Mild', 'Moderate', 'Severe', 'Anaphylactic'] },
    ]},
    { key: 'reaction', label: 'Reaction', type: 'textarea', placeholder: 'Describe the reaction...' },
    { type: 'row', key: 'row3', fields: [
      { key: 'onsetDate', label: 'Onset Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Resolved', 'EnteredInError'] },
    ]},
    { type: 'row', key: 'row4', fields: [
      { key: 'rxnormCode', label: 'RxNorm Code' },
      { key: 'snomedCode', label: 'SNOMED Code' },
    ]},
    { type: 'row', key: 'row5', fields: [
      { key: 'notedBy', label: 'Noted By (Provider ID)', type: 'number' },
      { key: 'source', label: 'Source' },
    ]},
  ],
  aiVerbs: [
    'check-cross-reactivity', 'classify-severity', 'normalize-allergen-rxnorm', 'suggest-alternatives',
    'predict-reaction-trajectory', 'generate-allergy-card', 'detect-drug-allergen-conflict',
    'flag-anaphylaxis-risk', 'summarize-allergy-list', 'suggest-skin-test', 'explain-to-patient',
    'validate-reaction-description', 'reconcile-from-text', 'suggest-snomed-code',
    'draft-emergency-plan', 'score-clinical-significance',
  ],
};

export default function EhrAllergiesPage() {
  return <EhrModule module={module} />;
}
