import React from 'react';
import CrudPage from '../components/CrudPage';

const alertBadge = (level) => {
  const map = { 'Normal': 'badge-success', 'Warning': 'badge-warning', 'Critical': 'badge-critical' };
  return <span className={`badge ${map[level] || 'badge-default'}`}>{level}</span>;
};

export default function VitalsPage() {
  return <CrudPage
    title="Vital Signs Monitor"
    apiPath="/vitals"
    columns={[
      { header: 'ID', render: r => `#${r.id}` },
      { header: 'Patient', render: r => r.Patient ? `${r.Patient.firstName} ${r.Patient.lastName}` : `#${r.patientId}` },
      { header: 'HR', render: r => `${r.heartRate} bpm` },
      { header: 'BP', render: r => `${r.bloodPressureSystolic}/${r.bloodPressureDiastolic}` },
      { header: 'Temp', render: r => `${r.temperature}°F` },
      { header: 'SpO2', render: r => `${r.oxygenSaturation}%` },
      { header: 'Alert', render: r => alertBadge(r.alertLevel) }
    ]}
    formFields={[
      { key: 'patientId', label: 'Patient ID', type: 'number' },
      { key: 'heartRate', label: 'Heart Rate (bpm)', type: 'number' },
      { key: 'bloodPressureSystolic', label: 'BP Systolic', type: 'number' },
      { key: 'bloodPressureDiastolic', label: 'BP Diastolic', type: 'number' },
      { key: 'temperature', label: 'Temperature (°F)', type: 'number' },
      { key: 'respiratoryRate', label: 'Respiratory Rate', type: 'number' },
      { key: 'oxygenSaturation', label: 'Oxygen Saturation (%)', type: 'number' },
      { key: 'glucoseLevel', label: 'Glucose Level (mg/dL)', type: 'number' },
      { key: 'weight', label: 'Weight (lbs)', type: 'number' },
      { key: 'height', label: 'Height (in)', type: 'number' },
      { key: 'alertLevel', label: 'Alert Level', type: 'select', options: ['Normal', 'Warning', 'Critical'] }
    ]}
    detailFields={[
      { key: 'heartRate', label: 'Heart Rate (bpm)' },
      { key: 'bloodPressureSystolic', label: 'BP Systolic' },
      { key: 'bloodPressureDiastolic', label: 'BP Diastolic' },
      { key: 'temperature', label: 'Temperature (°F)' },
      { key: 'respiratoryRate', label: 'Respiratory Rate' },
      { key: 'oxygenSaturation', label: 'Oxygen Saturation (%)' },
      { key: 'glucoseLevel', label: 'Glucose Level' },
      { key: 'weight', label: 'Weight (lbs)' },
      { key: 'height', label: 'Height (in)' },
      { key: 'alertLevel', label: 'Alert Level', badge: true },
      { key: 'aiAnalysis', label: 'AI Analysis' }
    ]}
    defaultFormData={{ alertLevel: 'Normal' }}
    renderBadge={(val) => alertBadge(val)}
    aiConfig={{
      endpoint: '/ai/vitals-analysis',
      buttonLabel: 'AI Vitals Analysis',
      getPayload: (data) => ({
        heartRate: data.heartRate,
        bloodPressureSystolic: data.bloodPressureSystolic,
        bloodPressureDiastolic: data.bloodPressureDiastolic,
        temperature: data.temperature,
        respiratoryRate: data.respiratoryRate,
        oxygenSaturation: data.oxygenSaturation,
        glucoseLevel: data.glucoseLevel
      })
    }}
  />;
}
