import React from 'react';
import EhrModule from '../../components/EhrModule';

const statusBadgeMap = {
  Draft: 'badge-default', Signed: 'badge-info', Transmitted: 'badge-warning',
  Filled: 'badge-success', Cancelled: 'badge-danger', Expired: 'badge-danger'
};

const module = {
  slug: 'rx',
  label: 'EHR Prescriptions (eRx)',
  labelSingular: 'Prescription',
  idField: 'prescriptionId',
  titleFn: r => `${r.drugName || 'Prescription'} ${r.dose ? `${r.dose} ${r.doseUnit || ''}` : ''}`,
  statusOptions: ['Draft', 'Signed', 'Transmitted', 'Filled', 'Cancelled', 'Expired'],
  statusBadge: s => statusBadgeMap[s] || 'badge-default',
  defaultValues: { route: 'Oral', status: 'Draft', refills: 0, isControlled: false, dispenseAsWritten: false },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Drug Name', key: 'drugName' },
    { header: 'Dose', render: r => `${r.dose || ''} ${r.doseUnit || ''}`.trim() || '—' },
    { header: 'Route', key: 'route' },
    { header: 'Status', render: r => <span className={`badge ${statusBadgeMap[r.status] || 'badge-default'}`}>{r.status}</span> },
    { header: 'Controlled', render: r => r.isControlled ? '⚠ Yes' : 'No' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'encounterId', label: 'Encounter ID' },
    { key: 'providerId', label: 'Provider ID' },
    { key: 'drugName', label: 'Drug Name' },
    { key: 'ndcCode', label: 'NDC Code' },
    { key: 'rxnormCode', label: 'RxNorm Code' },
    { key: 'dose', label: 'Dose' },
    { key: 'doseUnit', label: 'Dose Unit' },
    { key: 'route', label: 'Route' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'duration', label: 'Duration' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'refills', label: 'Refills' },
    { key: 'status', label: 'Status' },
    { key: 'isControlled', label: 'Controlled Substance', render: r => r.isControlled ? 'Yes' : 'No' },
    { key: 'deaSchedule', label: 'DEA Schedule' },
    { key: 'dispenseAsWritten', label: 'Dispense As Written', render: r => r.dispenseAsWritten ? 'Yes' : 'No' },
    { key: 'pharmacyId', label: 'Pharmacy ID' },
    { key: 'patientInstructions', label: 'Patient Instructions' },
    { key: 'signedAt', label: 'Signed At', render: r => r.signedAt ? new Date(r.signedAt).toLocaleString() : '—' },
    { key: 'transmittedAt', label: 'Transmitted At', render: r => r.transmittedAt ? new Date(r.transmittedAt).toLocaleString() : '—' },
    { key: 'aiInteractionWarnings', label: 'AI Interaction Warnings' },
    { key: 'aiFormularyStatus', label: 'AI Formulary Status' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'encounterId', label: 'Encounter ID', type: 'number' },
    ]},
    { type: 'row', key: 'row2', fields: [
      { key: 'drugName', label: 'Drug Name', placeholder: 'e.g. Amoxicillin' },
      { key: 'providerId', label: 'Provider ID', type: 'number' },
    ]},
    { type: 'row', key: 'row3', fields: [
      { key: 'dose', label: 'Dose' },
      { key: 'doseUnit', label: 'Dose Unit', placeholder: 'mg, mcg, mL...' },
    ]},
    { type: 'row', key: 'row4', fields: [
      { key: 'route', label: 'Route', type: 'select', options: ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation', 'Rectal', 'Other'] },
      { key: 'frequency', label: 'Frequency', placeholder: 'e.g. BID, TID, QD' },
    ]},
    { type: 'row', key: 'row5', fields: [
      { key: 'duration', label: 'Duration', placeholder: 'e.g. 7 days' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
    ]},
    { type: 'row', key: 'row6', fields: [
      { key: 'refills', label: 'Refills', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Signed', 'Transmitted', 'Filled', 'Cancelled', 'Expired'] },
    ]},
    { type: 'row', key: 'row7', fields: [
      { key: 'ndcCode', label: 'NDC Code' },
      { key: 'rxnormCode', label: 'RxNorm Code' },
    ]},
    { key: 'isControlled', label: 'Controlled Substance', type: 'checkbox' },
    { key: 'dispenseAsWritten', label: 'Dispense As Written', type: 'checkbox' },
    { key: 'patientInstructions', label: 'Patient Instructions', type: 'textarea' },
    { key: 'pharmacyId', label: 'Pharmacy ID' },
  ],
  aiVerbs: [
    'check-drug-interactions', 'suggest-dose', 'generate-patient-instructions', 'check-formulary',
    'suggest-alternatives', 'calculate-pediatric-dose', 'calculate-renal-dose',
    'classify-controlled-status', 'predict-adherence', 'generate-prior-auth',
    'draft-pharmacy-note', 'suggest-monitoring', 'detect-duplicate-therapy',
    'score-prescribing-safety', 'translate-instructions', 'suggest-tapering-plan',
  ],
};

export default function EhrRxPage() {
  return <EhrModule module={module} />;
}
