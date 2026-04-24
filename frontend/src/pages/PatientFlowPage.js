import React from 'react';
import CrudPage from '../components/CrudPage';

export default function PatientFlowPage() {
  return <CrudPage
    title="Patient Flow Analytics"
    apiPath="/patient-flow"
    columns={[
      { header: 'Date', key: 'date' },
      { header: 'Hour', render: r => `${r.hour}:00` },
      { header: 'Department', key: 'department' },
      { header: 'Admissions', key: 'totalAdmissions' },
      { header: 'Discharges', key: 'totalDischarges' },
      { header: 'Avg Wait', render: r => `${r.averageWaitTime} min` },
      { header: 'Occupancy', render: r => {
        const cls = r.occupancyRate >= 90 ? 'badge-critical' : r.occupancyRate >= 70 ? 'badge-warning' : 'badge-success';
        return <span className={`badge ${cls}`}>{r.occupancyRate}%</span>;
      }},
      { header: 'AI Predicted', key: 'aiPredictedAdmissions' }
    ]}
    formFields={[
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'hour', label: 'Hour (0-23)', type: 'number' },
      { key: 'department', label: 'Department' },
      { key: 'totalAdmissions', label: 'Total Admissions', type: 'number' },
      { key: 'totalDischarges', label: 'Total Discharges', type: 'number' },
      { key: 'averageWaitTime', label: 'Avg Wait Time (min)', type: 'number' },
      { key: 'averageTreatmentTime', label: 'Avg Treatment Time (min)', type: 'number' },
      { key: 'occupancyRate', label: 'Occupancy Rate (%)', type: 'number' },
      { key: 'aiStaffingRecommendation', label: 'AI Staffing Recommendation', type: 'textarea' },
      { key: 'aiBottleneckAnalysis', label: 'AI Bottleneck Analysis', type: 'textarea' }
    ]}
    defaultFormData={{ date: new Date().toISOString().split('T')[0], hour: new Date().getHours(), department: 'General ER' }}
    aiConfig={{
      endpoint: '/ai/flow-analysis',
      buttonLabel: 'AI Flow Analysis',
      getPayload: (data) => ({
        admissions: data.totalAdmissions,
        discharges: data.totalDischarges,
        avgWait: data.averageWaitTime,
        avgTreatment: data.averageTreatmentTime,
        occupancy: data.occupancyRate,
        department: data.department
      })
    }}
  />;
}
