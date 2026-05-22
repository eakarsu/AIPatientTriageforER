import React from 'react';
import EhrModule from '../../components/EhrModule';

const statusBadgeMap = {
  Planned: 'badge-info', Arrived: 'badge-warning', InProgress: 'badge-warning',
  Finished: 'badge-success', Cancelled: 'badge-danger'
};

const module = {
  slug: 'encounters',
  label: 'EHR Encounters',
  labelSingular: 'Encounter',
  idField: 'encounterId',
  titleFn: r => `Encounter #${r.id} — ${r.chiefComplaint || r.encounterType || ''}`,
  statusOptions: ['Planned', 'Arrived', 'InProgress', 'Finished', 'Cancelled'],
  statusBadge: s => statusBadgeMap[s] || 'badge-default',
  defaultValues: { encounterType: 'Emergency', status: 'Arrived' },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Type', key: 'encounterType' },
    { header: 'Chief Complaint', key: 'chiefComplaint' },
    { header: 'Status', render: r => <span className={`badge ${statusBadgeMap[r.status] || 'badge-default'}`}>{r.status}</span> },
    { header: 'Arrival', render: r => r.arrivalTime ? new Date(r.arrivalTime).toLocaleString() : '—' },
    { header: 'Facility', key: 'facility' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'encounterType', label: 'Encounter Type' },
    { key: 'arrivalTime', label: 'Arrival Time', render: r => r.arrivalTime ? new Date(r.arrivalTime).toLocaleString() : '—' },
    { key: 'dischargeTime', label: 'Discharge Time', render: r => r.dischargeTime ? new Date(r.dischargeTime).toLocaleString() : '—' },
    { key: 'chiefComplaint', label: 'Chief Complaint' },
    { key: 'visitReason', label: 'Visit Reason' },
    { key: 'providerId', label: 'Provider ID' },
    { key: 'facility', label: 'Facility' },
    { key: 'location', label: 'Location' },
    { key: 'dispositionCode', label: 'Disposition Code' },
    { key: 'cptCodes', label: 'CPT Codes' },
    { key: 'icd10Codes', label: 'ICD-10 Codes' },
    { key: 'totalCharge', label: 'Total Charge', render: r => r.totalCharge != null ? `$${r.totalCharge}` : '—' },
    { key: 'insuranceClaimId', label: 'Insurance Claim ID' },
    { key: 'aiSummary', label: 'AI Summary' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'encounterType', label: 'Encounter Type', type: 'select', options: ['Emergency', 'Inpatient', 'Outpatient', 'Observation', 'Telehealth'] },
    ]},
    { key: 'chiefComplaint', label: 'Chief Complaint', type: 'textarea' },
    { key: 'visitReason', label: 'Visit Reason', type: 'textarea' },
    { type: 'row', key: 'row2', fields: [
      { key: 'status', label: 'Status', type: 'select', options: ['Planned', 'Arrived', 'InProgress', 'Finished', 'Cancelled'] },
      { key: 'facility', label: 'Facility' },
    ]},
    { type: 'row', key: 'row3', fields: [
      { key: 'location', label: 'Location' },
      { key: 'providerId', label: 'Provider ID', type: 'number' },
    ]},
    { type: 'row', key: 'row4', fields: [
      { key: 'arrivalTime', label: 'Arrival Time', type: 'datetime-local' },
      { key: 'dischargeTime', label: 'Discharge Time', type: 'datetime-local' },
    ]},
    { key: 'dispositionCode', label: 'Disposition Code' },
    { type: 'row', key: 'row5', fields: [
      { key: 'cptCodes', label: 'CPT Codes' },
      { key: 'icd10Codes', label: 'ICD-10 Codes' },
    ]},
    { type: 'row', key: 'row6', fields: [
      { key: 'totalCharge', label: 'Total Charge ($)', type: 'number' },
      { key: 'insuranceClaimId', label: 'Insurance Claim ID' },
    ]},
  ],
  aiVerbs: [
    'summarize-encounter', 'classify-visit-type', 'suggest-cpt-codes', 'suggest-icd10-codes',
    'predict-readmission', 'generate-discharge-summary', 'extract-chief-complaint-keywords',
    'predict-disposition', 'estimate-charge', 'suggest-followup', 'detect-coding-gaps',
    'generate-soap-skeleton', 'identify-quality-measures', 'flag-documentation-deficiencies',
    'suggest-cdi-queries', 'generate-handoff-note',
  ],
};

export default function EhrEncountersPage() {
  return <EhrModule module={module} />;
}
