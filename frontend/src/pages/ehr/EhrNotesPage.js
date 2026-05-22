import React from 'react';
import EhrModule from '../../components/EhrModule';

const module = {
  slug: 'notes',
  label: 'EHR Clinical Notes',
  labelSingular: 'Note',
  idField: 'noteId',
  titleFn: r => `${r.noteType || 'Note'} #${r.id}`,
  statusOptions: [],
  statusBadge: () => 'badge-default',
  defaultValues: { noteType: 'SOAP', isAmended: false },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Encounter ID', key: 'encounterId' },
    { header: 'Note Type', key: 'noteType' },
    { header: 'Provider ID', key: 'providerId' },
    { header: 'Signed At', render: r => r.signedAt ? new Date(r.signedAt).toLocaleString() : 'Unsigned' },
    { header: 'Quality Score', render: r => r.aiQualityScore != null ? r.aiQualityScore : '—' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'encounterId', label: 'Encounter ID' },
    { key: 'providerId', label: 'Provider ID' },
    { key: 'noteType', label: 'Note Type' },
    { key: 'subjective', label: 'Subjective (S)' },
    { key: 'objective', label: 'Objective (O)' },
    { key: 'assessment', label: 'Assessment (A)' },
    { key: 'plan', label: 'Plan (P)' },
    { key: 'rawDictation', label: 'Raw Dictation' },
    { key: 'signedAt', label: 'Signed At', render: r => r.signedAt ? new Date(r.signedAt).toLocaleString() : '—' },
    { key: 'cosignedBy', label: 'Co-signed By' },
    { key: 'isAmended', label: 'Is Amended', render: r => r.isAmended ? 'Yes' : 'No' },
    { key: 'extractedBillingCodes', label: 'Extracted Billing Codes' },
    { key: 'aiQualityScore', label: 'AI Quality Score' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'encounterId', label: 'Encounter ID', type: 'number' },
    ]},
    { type: 'row', key: 'row2', fields: [
      { key: 'providerId', label: 'Provider ID', type: 'number' },
      { key: 'noteType', label: 'Note Type', type: 'select', options: ['SOAP', 'Progress', 'Admission', 'Discharge', 'Consult', 'Procedure', 'Nursing'] },
    ]},
    { key: 'subjective', label: 'Subjective (S)', type: 'textarea', placeholder: "Patient's chief complaint, history of present illness..." },
    { key: 'objective', label: 'Objective (O)', type: 'textarea', placeholder: 'Vital signs, physical exam findings, lab results...' },
    { key: 'assessment', label: 'Assessment (A)', type: 'textarea', placeholder: 'Diagnosis, clinical impression...' },
    { key: 'plan', label: 'Plan (P)', type: 'textarea', placeholder: 'Treatment plan, orders, follow-up...' },
    { key: 'rawDictation', label: 'Raw Dictation', type: 'textarea' },
    { key: 'isAmended', label: 'Is Amendment', type: 'checkbox' },
  ],
  aiVerbs: [
    'dictate-to-soap', 'summarize-note', 'extract-billable-codes', 'draft-from-template',
    'identify-quality-issues', 'suggest-improvements', 'extract-medications', 'extract-allergies',
    'extract-diagnoses', 'generate-discharge-summary', 'translate-for-patient', 'reconcile-conflicts',
    'generate-progress-note', 'score-completeness', 'suggest-cdi-queries', 'redact-phi',
  ],
};

export default function EhrNotesPage() {
  return <EhrModule module={module} />;
}
