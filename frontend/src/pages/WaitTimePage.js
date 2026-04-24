import React from 'react';
import CrudPage from '../components/CrudPage';

export default function WaitTimePage() {
  return <CrudPage
    title="Wait Time Estimation"
    apiPath="/wait-times"
    columns={[
      { header: 'Department', key: 'department' },
      { header: 'Current Wait', render: r => `${r.currentWaitMinutes} min` },
      { header: 'Average', render: r => `${r.averageWaitMinutes} min` },
      { header: 'AI Predicted', render: r => `${r.aiPredictedWait} min` },
      { header: 'Waiting', key: 'patientsWaiting' },
      { header: 'In Treatment', key: 'patientsInTreatment' },
      { header: 'Staff', key: 'staffOnDuty' },
      { header: 'Peak', render: r => r.peakHour ? <span className="badge badge-warning">Peak</span> : <span className="badge badge-success">Normal</span> }
    ]}
    formFields={[
      { key: 'department', label: 'Department' },
      { key: 'currentWaitMinutes', label: 'Current Wait (min)', type: 'number' },
      { key: 'averageWaitMinutes', label: 'Average Wait (min)', type: 'number' },
      { key: 'patientsWaiting', label: 'Patients Waiting', type: 'number' },
      { key: 'patientsInTreatment', label: 'Patients In Treatment', type: 'number' },
      { key: 'staffOnDuty', label: 'Staff On Duty', type: 'number' },
      { key: 'peakHour', label: 'Peak Hour', type: 'select', options: ['true', 'false'] }
    ]}
    defaultFormData={{ peakHour: false }}
    aiConfig={{
      endpoint: '/ai/wait-prediction',
      buttonLabel: 'AI Wait Prediction',
      getPayload: (data) => ({
        department: data.department,
        currentPatients: data.patientsWaiting,
        staffCount: data.staffOnDuty,
        timeOfDay: new Date().getHours() + ':00',
        dayOfWeek: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()]
      })
    }}
  />;
}
