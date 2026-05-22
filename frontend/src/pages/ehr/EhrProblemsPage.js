import React from 'react';
import EhrModule from '../../components/EhrModule';

const statusBadgeMap = {
  Active: 'badge-warning', Inactive: 'badge-default',
  Resolved: 'badge-success', Recurrence: 'badge-critical'
};

const module = {
  slug: 'problems',
  label: 'EHR Problem List',
  labelSingular: 'Problem',
  idField: 'problemId',
  titleFn: r => r.problem || `Problem #${r.id}`,
  statusOptions: ['Active', 'Inactive', 'Resolved', 'Recurrence'],
  statusBadge: s => statusBadgeMap[s] || 'badge-default',
  defaultValues: { status: 'Active', severity: 'Moderate', isChronicCondition: false },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Problem', key: 'problem' },
    { header: 'ICD-10', key: 'icd10Code' },
    { header: 'Severity', key: 'severity' },
    { header: 'Status', render: r => <span className={`badge ${statusBadgeMap[r.status] || 'badge-default'}`}>{r.status}</span> },
    { header: 'Chronic', render: r => r.isChronicCondition ? '✓' : '—' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'problem', label: 'Problem' },
    { key: 'icd10Code', label: 'ICD-10 Code' },
    { key: 'snomedCode', label: 'SNOMED Code' },
    { key: 'status', label: 'Status' },
    { key: 'severity', label: 'Severity' },
    { key: 'onsetDate', label: 'Onset Date' },
    { key: 'resolvedDate', label: 'Resolved Date' },
    { key: 'isChronicCondition', label: 'Chronic Condition', render: r => r.isChronicCondition ? 'Yes' : 'No' },
    { key: 'notes', label: 'Notes' },
    { key: 'recordedBy', label: 'Recorded By (Provider ID)' },
    { key: 'aiPriorityScore', label: 'AI Priority Score' },
    { key: 'aiCareplanSuggestion', label: 'AI Care Plan Suggestion' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'problem', label: 'Problem', placeholder: 'e.g. Type 2 Diabetes Mellitus' },
    ]},
    { type: 'row', key: 'row2', fields: [
      { key: 'icd10Code', label: 'ICD-10 Code' },
      { key: 'snomedCode', label: 'SNOMED Code' },
    ]},
    { type: 'row', key: 'row3', fields: [
      { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Resolved', 'Recurrence'] },
      { key: 'severity', label: 'Severity', type: 'select', options: ['Mild', 'Moderate', 'Severe'] },
    ]},
    { type: 'row', key: 'row4', fields: [
      { key: 'onsetDate', label: 'Onset Date', type: 'date' },
      { key: 'resolvedDate', label: 'Resolved Date', type: 'date' },
    ]},
    { key: 'isChronicCondition', label: 'Chronic Condition', type: 'checkbox' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
    { key: 'recordedBy', label: 'Recorded By (Provider ID)', type: 'number' },
  ],
  aiVerbs: [
    'suggest-icd-codes', 'prioritize-problems', 'suggest-careplan', 'classify-chronic-acute',
    'detect-comorbidity-clusters', 'generate-problem-summary', 'suggest-uspstf-screenings',
    'extract-from-note', 'reconcile-duplicates', 'predict-progression', 'suggest-snomed',
    'calculate-cci-score', 'recommend-specialist', 'identify-care-gaps',
    'draft-patient-letter', 'score-complexity',
  ],
};

export default function EhrProblemsPage() {
  return <EhrModule module={module} />;
}
