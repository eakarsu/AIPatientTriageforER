import React from 'react';
import EhrModule from '../../components/EhrModule';

const validationBadgeMap = {
  Pending: 'badge-default', Valid: 'badge-success',
  Invalid: 'badge-critical', Warning: 'badge-warning'
};

const module = {
  slug: 'fhir',
  label: 'EHR FHIR Resources',
  labelSingular: 'FHIR Resource',
  idField: 'resourceId',
  titleFn: r => `${r.resourceType || 'Resource'} ${r.fhirId ? `(${r.fhirId})` : `#${r.id}`}`,
  statusOptions: ['Pending', 'Valid', 'Invalid', 'Warning'],
  statusBadge: s => validationBadgeMap[s] || 'badge-default',
  defaultValues: { syncDirection: 'Inbound', validationStatus: 'Pending' },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Resource Type', key: 'resourceType' },
    { header: 'FHIR ID', key: 'fhirId' },
    { header: 'Source System', key: 'sourceSystem' },
    { header: 'Validation', render: r => <span className={`badge ${validationBadgeMap[r.validationStatus] || 'badge-default'}`}>{r.validationStatus}</span> },
    { header: 'Sync Direction', key: 'syncDirection' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'resourceType', label: 'Resource Type' },
    { key: 'fhirId', label: 'FHIR ID' },
    { key: 'versionId', label: 'Version ID' },
    { key: 'sourceSystem', label: 'Source System' },
    { key: 'syncDirection', label: 'Sync Direction' },
    { key: 'validationStatus', label: 'Validation Status' },
    { key: 'lastSyncedAt', label: 'Last Synced At', render: r => r.lastSyncedAt ? new Date(r.lastSyncedAt).toLocaleString() : '—' },
    { key: 'validationErrors', label: 'Validation Errors' },
    { key: 'aiMappingNotes', label: 'AI Mapping Notes' },
    { key: 'fhirJson', label: 'FHIR JSON' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'resourceType', label: 'Resource Type', placeholder: 'e.g. Patient, Observation, Condition' },
    ]},
    { type: 'row', key: 'row2', fields: [
      { key: 'fhirId', label: 'FHIR ID' },
      { key: 'versionId', label: 'Version ID' },
    ]},
    { type: 'row', key: 'row3', fields: [
      { key: 'sourceSystem', label: 'Source System' },
      { key: 'syncDirection', label: 'Sync Direction', type: 'select', options: ['Inbound', 'Outbound', 'Bidirectional'] },
    ]},
    { key: 'validationStatus', label: 'Validation Status', type: 'select', options: ['Pending', 'Valid', 'Invalid', 'Warning'] },
    { key: 'fhirJson', label: 'FHIR JSON', type: 'textarea', placeholder: '{"resourceType": "Patient", ...}' },
    { key: 'validationErrors', label: 'Validation Errors', type: 'textarea' },
  ],
  aiVerbs: [
    'map-to-fhir', 'validate-fhir', 'extract-from-bundle', 'translate-cda-to-fhir',
    'generate-patient-bundle', 'suggest-extensions', 'classify-resource-type',
    'detect-missing-elements', 'summarize-bundle', 'generate-consent-resource',
    'map-cpt-to-procedure', 'map-icd-to-condition', 'generate-careplan-resource',
    'normalize-codes', 'suggest-references', 'draft-fhir-query',
  ],
};

export default function EhrFhirPage() {
  return <EhrModule module={module} />;
}
