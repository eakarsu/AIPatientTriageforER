const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

// User Model
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'doctor', 'nurse', 'receptionist'), defaultValue: 'nurse' }
}, { tableName: 'users', timestamps: true });

// Patient Model
const Patient = sequelize.define('Patient', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  firstName: { type: DataTypes.STRING, allowNull: false },
  lastName: { type: DataTypes.STRING, allowNull: false },
  dateOfBirth: { type: DataTypes.DATEONLY },
  gender: { type: DataTypes.ENUM('Male', 'Female', 'Other') },
  phone: { type: DataTypes.STRING },
  email: { type: DataTypes.STRING },
  address: { type: DataTypes.TEXT },
  insuranceProvider: { type: DataTypes.STRING },
  insuranceNumber: { type: DataTypes.STRING },
  emergencyContact: { type: DataTypes.STRING },
  emergencyPhone: { type: DataTypes.STRING },
  bloodType: { type: DataTypes.STRING },
  allergies: { type: DataTypes.TEXT },
  status: { type: DataTypes.ENUM('Registered', 'In Triage', 'Waiting', 'In Treatment', 'Discharged'), defaultValue: 'Registered' }
}, { tableName: 'patients', timestamps: true });

// Triage Assessment Model
const TriageAssessment = sequelize.define('TriageAssessment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  chiefComplaint: { type: DataTypes.TEXT, allowNull: false },
  symptoms: { type: DataTypes.TEXT },
  painLevel: { type: DataTypes.INTEGER, validate: { min: 0, max: 10 } },
  onsetTime: { type: DataTypes.STRING },
  triageLevel: { type: DataTypes.ENUM('1-Resuscitation', '2-Emergency', '3-Urgent', '4-Less Urgent', '5-Non-Urgent') },
  aiRecommendation: { type: DataTypes.TEXT },
  aiConfidence: { type: DataTypes.FLOAT },
  nurseOverride: { type: DataTypes.BOOLEAN, defaultValue: false },
  notes: { type: DataTypes.TEXT },
  assessedBy: { type: DataTypes.INTEGER }
}, { tableName: 'triage_assessments', timestamps: true });

// Vital Signs Model
const VitalSign = sequelize.define('VitalSign', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  heartRate: { type: DataTypes.INTEGER },
  bloodPressureSystolic: { type: DataTypes.INTEGER },
  bloodPressureDiastolic: { type: DataTypes.INTEGER },
  temperature: { type: DataTypes.FLOAT },
  respiratoryRate: { type: DataTypes.INTEGER },
  oxygenSaturation: { type: DataTypes.FLOAT },
  glucoseLevel: { type: DataTypes.FLOAT },
  weight: { type: DataTypes.FLOAT },
  height: { type: DataTypes.FLOAT },
  aiAnalysis: { type: DataTypes.TEXT },
  alertLevel: { type: DataTypes.ENUM('Normal', 'Warning', 'Critical'), defaultValue: 'Normal' },
  recordedBy: { type: DataTypes.INTEGER }
}, { tableName: 'vital_signs', timestamps: true });

// Symptom Analysis Model
const SymptomAnalysis = sequelize.define('SymptomAnalysis', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  symptoms: { type: DataTypes.TEXT, allowNull: false },
  duration: { type: DataTypes.STRING },
  severity: { type: DataTypes.ENUM('Mild', 'Moderate', 'Severe', 'Critical') },
  bodyRegion: { type: DataTypes.STRING },
  aiDiagnosis: { type: DataTypes.TEXT },
  differentialDiagnosis: { type: DataTypes.TEXT },
  recommendedTests: { type: DataTypes.TEXT },
  urgencyScore: { type: DataTypes.FLOAT },
  notes: { type: DataTypes.TEXT }
}, { tableName: 'symptom_analyses', timestamps: true });

// Priority Queue Model
const PriorityQueue = sequelize.define('PriorityQueue', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  priority: { type: DataTypes.INTEGER, validate: { min: 1, max: 5 } },
  queuePosition: { type: DataTypes.INTEGER },
  estimatedWaitMinutes: { type: DataTypes.INTEGER },
  department: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Waiting', 'Called', 'In Progress', 'Completed', 'Left'), defaultValue: 'Waiting' },
  aiPriorityReason: { type: DataTypes.TEXT },
  checkInTime: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  calledTime: { type: DataTypes.DATE }
}, { tableName: 'priority_queue', timestamps: true });

// Doctor Assignment Model
const DoctorAssignment = sequelize.define('DoctorAssignment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  doctorName: { type: DataTypes.STRING, allowNull: false },
  specialty: { type: DataTypes.STRING },
  department: { type: DataTypes.STRING },
  assignedTime: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  status: { type: DataTypes.ENUM('Assigned', 'In Consultation', 'Completed', 'Transferred'), defaultValue: 'Assigned' },
  aiMatchScore: { type: DataTypes.FLOAT },
  aiMatchReason: { type: DataTypes.TEXT },
  room: { type: DataTypes.STRING },
  notes: { type: DataTypes.TEXT }
}, { tableName: 'doctor_assignments', timestamps: true });

// Treatment Model
const Treatment = sequelize.define('Treatment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  diagnosis: { type: DataTypes.TEXT },
  treatmentPlan: { type: DataTypes.TEXT },
  procedures: { type: DataTypes.TEXT },
  aiRecommendation: { type: DataTypes.TEXT },
  aiEvidenceLevel: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Planned', 'In Progress', 'Completed', 'Cancelled'), defaultValue: 'Planned' },
  prescribedBy: { type: DataTypes.STRING },
  startTime: { type: DataTypes.DATE },
  endTime: { type: DataTypes.DATE },
  notes: { type: DataTypes.TEXT }
}, { tableName: 'treatments', timestamps: true });

// Wait Time Model
const WaitTime = sequelize.define('WaitTime', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  department: { type: DataTypes.STRING, allowNull: false },
  currentWaitMinutes: { type: DataTypes.INTEGER },
  averageWaitMinutes: { type: DataTypes.INTEGER },
  patientsWaiting: { type: DataTypes.INTEGER },
  patientsInTreatment: { type: DataTypes.INTEGER },
  aiPredictedWait: { type: DataTypes.INTEGER },
  aiPredictionAccuracy: { type: DataTypes.FLOAT },
  peakHour: { type: DataTypes.BOOLEAN, defaultValue: false },
  staffOnDuty: { type: DataTypes.INTEGER },
  lastUpdated: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'wait_times', timestamps: true });

// Medical History Model
const MedicalHistory = sequelize.define('MedicalHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  condition: { type: DataTypes.STRING, allowNull: false },
  diagnosedDate: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.ENUM('Active', 'Resolved', 'Chronic', 'In Remission'), defaultValue: 'Active' },
  treatment: { type: DataTypes.TEXT },
  physician: { type: DataTypes.STRING },
  hospital: { type: DataTypes.STRING },
  aiRiskAssessment: { type: DataTypes.TEXT },
  aiInteractionWarnings: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT }
}, { tableName: 'medical_histories', timestamps: true });

// Lab Order Model
const LabOrder = sequelize.define('LabOrder', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  testName: { type: DataTypes.STRING, allowNull: false },
  testType: { type: DataTypes.STRING },
  urgency: { type: DataTypes.ENUM('Routine', 'Urgent', 'STAT'), defaultValue: 'Routine' },
  status: { type: DataTypes.ENUM('Ordered', 'In Progress', 'Completed', 'Cancelled'), defaultValue: 'Ordered' },
  results: { type: DataTypes.TEXT },
  normalRange: { type: DataTypes.STRING },
  aiInterpretation: { type: DataTypes.TEXT },
  orderedBy: { type: DataTypes.STRING },
  orderedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  completedAt: { type: DataTypes.DATE },
  notes: { type: DataTypes.TEXT }
}, { tableName: 'lab_orders', timestamps: true });

// Medication Model
const Medication = sequelize.define('Medication', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  medicationName: { type: DataTypes.STRING, allowNull: false },
  dosage: { type: DataTypes.STRING },
  frequency: { type: DataTypes.STRING },
  route: { type: DataTypes.ENUM('Oral', 'IV', 'IM', 'Topical', 'Inhalation', 'Sublingual'), defaultValue: 'Oral' },
  startDate: { type: DataTypes.DATEONLY },
  endDate: { type: DataTypes.DATEONLY },
  prescribedBy: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Active', 'Completed', 'Discontinued', 'On Hold'), defaultValue: 'Active' },
  aiInteractionCheck: { type: DataTypes.TEXT },
  aiDosageVerification: { type: DataTypes.TEXT },
  sideEffects: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT }
}, { tableName: 'medications', timestamps: true });

// Discharge Model
const Discharge = sequelize.define('Discharge', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  dischargeDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  diagnosis: { type: DataTypes.TEXT },
  dischargeSummary: { type: DataTypes.TEXT },
  followUpInstructions: { type: DataTypes.TEXT },
  prescriptions: { type: DataTypes.TEXT },
  aiDischargeNotes: { type: DataTypes.TEXT },
  aiFollowUpRecommendation: { type: DataTypes.TEXT },
  dischargedBy: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Pending', 'Approved', 'Completed'), defaultValue: 'Pending' },
  returnPrecautions: { type: DataTypes.TEXT }
}, { tableName: 'discharges', timestamps: true });

// Emergency Alert Model
const EmergencyAlert = sequelize.define('EmergencyAlert', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER },
  alertType: { type: DataTypes.ENUM('Code Blue', 'Code Red', 'Code Yellow', 'Code White', 'Code Orange', 'Trauma Alert', 'Stroke Alert', 'STEMI Alert'), allowNull: false },
  severity: { type: DataTypes.ENUM('Low', 'Medium', 'High', 'Critical'), defaultValue: 'High' },
  location: { type: DataTypes.STRING },
  description: { type: DataTypes.TEXT },
  aiAssessment: { type: DataTypes.TEXT },
  aiRecommendedResponse: { type: DataTypes.TEXT },
  status: { type: DataTypes.ENUM('Active', 'Responding', 'Resolved', 'False Alarm'), defaultValue: 'Active' },
  triggeredBy: { type: DataTypes.STRING },
  resolvedBy: { type: DataTypes.STRING },
  resolvedAt: { type: DataTypes.DATE }
}, { tableName: 'emergency_alerts', timestamps: true });

// Bed Management Model
const BedManagement = sequelize.define('BedManagement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  bedNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
  ward: { type: DataTypes.STRING },
  department: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Available', 'Occupied', 'Reserved', 'Maintenance', 'Cleaning'), defaultValue: 'Available' },
  patientId: { type: DataTypes.INTEGER },
  bedType: { type: DataTypes.ENUM('Standard', 'ICU', 'Isolation', 'Pediatric', 'Trauma'), defaultValue: 'Standard' },
  floor: { type: DataTypes.INTEGER },
  aiOptimalAssignment: { type: DataTypes.TEXT },
  lastCleanedAt: { type: DataTypes.DATE },
  notes: { type: DataTypes.TEXT }
}, { tableName: 'bed_management', timestamps: true });

// Patient Flow Analytics Model
const PatientFlow = sequelize.define('PatientFlow', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  hour: { type: DataTypes.INTEGER },
  totalAdmissions: { type: DataTypes.INTEGER },
  totalDischarges: { type: DataTypes.INTEGER },
  averageWaitTime: { type: DataTypes.FLOAT },
  averageTreatmentTime: { type: DataTypes.FLOAT },
  occupancyRate: { type: DataTypes.FLOAT },
  department: { type: DataTypes.STRING },
  aiPredictedAdmissions: { type: DataTypes.INTEGER },
  aiPredictedPeakHour: { type: DataTypes.INTEGER },
  aiStaffingRecommendation: { type: DataTypes.TEXT },
  aiBottleneckAnalysis: { type: DataTypes.TEXT }
}, { tableName: 'patient_flow', timestamps: true });

// AI Results Model - persists all AI endpoint results
const AiResult = sequelize.define('AiResult', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER },
  endpoint: { type: DataTypes.STRING(100) },
  patientId: { type: DataTypes.INTEGER },
  result: { type: DataTypes.TEXT },
  model: { type: DataTypes.STRING(100) }
}, { tableName: 'ai_results', timestamps: true });

// Audit Log Model - HIPAA-compliant access logging
const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  action: { type: DataTypes.STRING(100), allowNull: false },
  userId: { type: DataTypes.INTEGER },
  patientId: { type: DataTypes.INTEGER },
  ipAddress: { type: DataTypes.STRING(50) }
}, { tableName: 'audit_logs', timestamps: true });

// Associations
Patient.hasMany(TriageAssessment, { foreignKey: 'patientId' });
TriageAssessment.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(VitalSign, { foreignKey: 'patientId' });
VitalSign.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(SymptomAnalysis, { foreignKey: 'patientId' });
SymptomAnalysis.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(PriorityQueue, { foreignKey: 'patientId' });
PriorityQueue.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(DoctorAssignment, { foreignKey: 'patientId' });
DoctorAssignment.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(Treatment, { foreignKey: 'patientId' });
Treatment.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(MedicalHistory, { foreignKey: 'patientId' });
MedicalHistory.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(LabOrder, { foreignKey: 'patientId' });
LabOrder.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(Medication, { foreignKey: 'patientId' });
Medication.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(Discharge, { foreignKey: 'patientId' });
Discharge.belongsTo(Patient, { foreignKey: 'patientId' });

Patient.hasMany(EmergencyAlert, { foreignKey: 'patientId' });
EmergencyAlert.belongsTo(Patient, { foreignKey: 'patientId' });

const ehr = require('./ehr');
ehr.setupEhrAssociations(Patient);

module.exports = {
  sequelize,
  User,
  Patient,
  TriageAssessment,
  VitalSign,
  SymptomAnalysis,
  PriorityQueue,
  DoctorAssignment,
  Treatment,
  WaitTime,
  MedicalHistory,
  LabOrder,
  Medication,
  Discharge,
  EmergencyAlert,
  BedManagement,
  PatientFlow,
  AiResult,
  AuditLog,
  Encounter: ehr.Encounter,
  Allergy: ehr.Allergy,
  Problem: ehr.Problem,
  ClinicalOrder: ehr.ClinicalOrder,
  Referral: ehr.Referral,
  ClinicalNote: ehr.ClinicalNote,
  FhirResource: ehr.FhirResource,
  Prescription: ehr.Prescription,
  ImagingStudy: ehr.ImagingStudy
};
