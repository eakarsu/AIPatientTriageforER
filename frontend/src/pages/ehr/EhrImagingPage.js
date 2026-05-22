import React from 'react';
import EhrModule from '../../components/EhrModule';

const statusBadgeMap = {
  Scheduled: 'badge-default', InProgress: 'badge-warning', Acquired: 'badge-info',
  Read: 'badge-info', Verified: 'badge-success', Cancelled: 'badge-danger'
};

const module = {
  slug: 'imaging',
  label: 'EHR Imaging Studies',
  labelSingular: 'Imaging Study',
  idField: 'studyId',
  titleFn: r => `${r.modality || ''} ${r.studyType || 'Imaging'} — ${r.bodyPart || ''}`,
  statusOptions: ['Scheduled', 'InProgress', 'Acquired', 'Read', 'Verified', 'Cancelled'],
  statusBadge: s => statusBadgeMap[s] || 'badge-default',
  defaultValues: { modality: 'CT', status: 'Scheduled', criticalFindings: false },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Modality', key: 'modality' },
    { header: 'Study Type', key: 'studyType' },
    { header: 'Body Part', key: 'bodyPart' },
    { header: 'Status', render: r => <span className={`badge ${statusBadgeMap[r.status] || 'badge-default'}`}>{r.status}</span> },
    { header: 'Critical', render: r => r.criticalFindings ? <span className="badge badge-critical">Critical</span> : '—' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'encounterId', label: 'Encounter ID' },
    { key: 'orderId', label: 'Order ID' },
    { key: 'modality', label: 'Modality' },
    { key: 'studyType', label: 'Study Type' },
    { key: 'bodyPart', label: 'Body Part' },
    { key: 'studyDate', label: 'Study Date', render: r => r.studyDate ? new Date(r.studyDate).toLocaleString() : '—' },
    { key: 'status', label: 'Status' },
    { key: 'accessionNumber', label: 'Accession Number' },
    { key: 'studyInstanceUid', label: 'Study Instance UID' },
    { key: 'numImages', label: 'Number of Images' },
    { key: 'radiologistId', label: 'Radiologist ID' },
    { key: 'pacsUrl', label: 'PACS URL' },
    { key: 'reportText', label: 'Report Text' },
    { key: 'impression', label: 'Impression' },
    { key: 'criticalFindings', label: 'Critical Findings', render: r => r.criticalFindings ? 'YES — Critical' : 'No' },
    { key: 'aiFindings', label: 'AI Findings' },
    { key: 'aiSuggestedFollowup', label: 'AI Suggested Follow-up' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'encounterId', label: 'Encounter ID', type: 'number' },
    ]},
    { type: 'row', key: 'row2', fields: [
      { key: 'modality', label: 'Modality', type: 'select', options: ['CR', 'CT', 'MR', 'US', 'XR', 'NM', 'PT', 'MG', 'DX'] },
      { key: 'studyType', label: 'Study Type', placeholder: 'e.g. Chest CT w/ Contrast' },
    ]},
    { type: 'row', key: 'row3', fields: [
      { key: 'bodyPart', label: 'Body Part', placeholder: 'e.g. Chest, Abdomen, Head' },
      { key: 'status', label: 'Status', type: 'select', options: ['Scheduled', 'InProgress', 'Acquired', 'Read', 'Verified', 'Cancelled'] },
    ]},
    { type: 'row', key: 'row4', fields: [
      { key: 'accessionNumber', label: 'Accession Number' },
      { key: 'radiologistId', label: 'Radiologist ID', type: 'number' },
    ]},
    { type: 'row', key: 'row5', fields: [
      { key: 'orderId', label: 'Order ID', type: 'number' },
      { key: 'numImages', label: 'Number of Images', type: 'number' },
    ]},
    { key: 'pacsUrl', label: 'PACS URL' },
    { key: 'reportText', label: 'Report Text', type: 'textarea' },
    { key: 'impression', label: 'Impression', type: 'textarea' },
    { key: 'criticalFindings', label: 'Critical Findings', type: 'checkbox' },
  ],
  aiVerbs: [
    'extract-findings', 'suggest-followup', 'classify-abnormalities', 'generate-report',
    'prioritize-worklist', 'suggest-recommended-protocol', 'flag-critical-findings',
    'summarize-comparison', 'extract-measurements', 'suggest-differential',
    'generate-impression', 'score-image-quality', 'suggest-additional-views',
    'draft-patient-summary', 'code-procedure', 'detect-incidental-findings',
  ],
};

export default function EhrImagingPage() {
  return <EhrModule module={module} />;
}
