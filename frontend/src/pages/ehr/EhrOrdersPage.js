import React from 'react';
import EhrModule from '../../components/EhrModule';

const statusBadgeMap = {
  Draft: 'badge-default', Active: 'badge-info', OnHold: 'badge-warning',
  Completed: 'badge-success', Cancelled: 'badge-danger'
};
const priorityBadgeMap = {
  Routine: 'badge-default', Urgent: 'badge-warning', ASAP: 'badge-critical', Stat: 'badge-critical'
};

const module = {
  slug: 'orders',
  label: 'EHR Clinical Orders',
  labelSingular: 'Order',
  idField: 'orderId',
  titleFn: r => r.orderName || `Order #${r.id}`,
  statusOptions: ['Draft', 'Active', 'OnHold', 'Completed', 'Cancelled'],
  statusBadge: s => statusBadgeMap[s] || 'badge-default',
  defaultValues: { orderType: 'Lab', status: 'Draft', priority: 'Routine' },
  columns: [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Patient ID', key: 'patientId' },
    { header: 'Order Name', key: 'orderName' },
    { header: 'Type', key: 'orderType' },
    { header: 'Priority', render: r => <span className={`badge ${priorityBadgeMap[r.priority] || 'badge-default'}`}>{r.priority}</span> },
    { header: 'Status', render: r => <span className={`badge ${statusBadgeMap[r.status] || 'badge-default'}`}>{r.status}</span> },
    { header: 'Ordered At', render: r => r.orderedAt ? new Date(r.orderedAt).toLocaleString() : '—' },
  ],
  detailFields: [
    { key: 'patientId', label: 'Patient ID' },
    { key: 'encounterId', label: 'Encounter ID' },
    { key: 'providerId', label: 'Provider ID' },
    { key: 'orderType', label: 'Order Type' },
    { key: 'orderName', label: 'Order Name' },
    { key: 'orderDetails', label: 'Order Details' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'orderedAt', label: 'Ordered At', render: r => r.orderedAt ? new Date(r.orderedAt).toLocaleString() : '—' },
    { key: 'completedAt', label: 'Completed At', render: r => r.completedAt ? new Date(r.completedAt).toLocaleString() : '—' },
    { key: 'loincCode', label: 'LOINC Code' },
    { key: 'cptCode', label: 'CPT Code' },
    { key: 'reasonForOrder', label: 'Reason for Order' },
    { key: 'aiNecessityScore', label: 'AI Necessity Score' },
    { key: 'aiSuggestedAlternatives', label: 'AI Suggested Alternatives' },
    { key: 'createdAt', label: 'Created', render: r => r.createdAt ? new Date(r.createdAt).toLocaleString() : '—' },
  ],
  formFields: [
    { type: 'row', key: 'row1', fields: [
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'encounterId', label: 'Encounter ID', type: 'number' },
    ]},
    { type: 'row', key: 'row2', fields: [
      { key: 'orderType', label: 'Order Type', type: 'select', options: ['Lab', 'Imaging', 'Medication', 'Procedure', 'Consult', 'Nursing', 'Diet'] },
      { key: 'orderName', label: 'Order Name', placeholder: 'e.g. CBC with Differential' },
    ]},
    { key: 'orderDetails', label: 'Order Details', type: 'textarea' },
    { type: 'row', key: 'row3', fields: [
      { key: 'status', label: 'Status', type: 'select', options: ['Draft', 'Active', 'OnHold', 'Completed', 'Cancelled'] },
      { key: 'priority', label: 'Priority', type: 'select', options: ['Routine', 'Urgent', 'ASAP', 'Stat'] },
    ]},
    { type: 'row', key: 'row4', fields: [
      { key: 'loincCode', label: 'LOINC Code' },
      { key: 'cptCode', label: 'CPT Code' },
    ]},
    { key: 'reasonForOrder', label: 'Reason for Order', type: 'textarea' },
    { key: 'providerId', label: 'Provider ID', type: 'number' },
  ],
  aiVerbs: [
    'suggest-orders', 'check-medical-necessity', 'predict-results', 'suggest-alternatives',
    'detect-duplicate-orders', 'estimate-cost', 'suggest-loinc-codes', 'validate-against-pathway',
    'prioritize-orders', 'generate-order-set', 'predict-positive-yield', 'draft-justification',
    'flag-low-value', 'summarize-pending', 'suggest-cpt', 'recommend-prep-instructions',
  ],
};

export default function EhrOrdersPage() {
  return <EhrModule module={module} />;
}
