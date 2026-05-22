const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

const Encounter = sequelize.define('Encounter', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  encounterType: { type: DataTypes.ENUM('Emergency', 'Inpatient', 'Outpatient', 'Observation', 'Telehealth'), defaultValue: 'Emergency' },
  arrivalTime: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  dischargeTime: { type: DataTypes.DATE },
  chiefComplaint: { type: DataTypes.TEXT },
  providerId: { type: DataTypes.INTEGER },
  facility: { type: DataTypes.STRING },
  location: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Planned', 'Arrived', 'InProgress', 'Finished', 'Cancelled'), defaultValue: 'Arrived' },
  dispositionCode: { type: DataTypes.STRING },
  visitReason: { type: DataTypes.TEXT },
  cptCodes: { type: DataTypes.TEXT },
  icd10Codes: { type: DataTypes.TEXT },
  totalCharge: { type: DataTypes.FLOAT },
  insuranceClaimId: { type: DataTypes.STRING },
  aiSummary: { type: DataTypes.TEXT }
}, { tableName: 'encounters', timestamps: true });

const Allergy = sequelize.define('Allergy', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  allergen: { type: DataTypes.STRING, allowNull: false },
  allergenType: { type: DataTypes.ENUM('Drug', 'Food', 'Environmental', 'Latex', 'Other'), defaultValue: 'Drug' },
  reaction: { type: DataTypes.TEXT },
  severity: { type: DataTypes.ENUM('Mild', 'Moderate', 'Severe', 'Anaphylactic'), defaultValue: 'Mild' },
  onsetDate: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.ENUM('Active', 'Inactive', 'Resolved', 'EnteredInError'), defaultValue: 'Active' },
  rxnormCode: { type: DataTypes.STRING },
  snomedCode: { type: DataTypes.STRING },
  notedBy: { type: DataTypes.INTEGER },
  source: { type: DataTypes.STRING, defaultValue: 'PatientReported' },
  aiCrossReactivityRisk: { type: DataTypes.TEXT }
}, { tableName: 'allergies', timestamps: true });

const Problem = sequelize.define('Problem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  problem: { type: DataTypes.STRING, allowNull: false },
  icd10Code: { type: DataTypes.STRING },
  snomedCode: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Active', 'Inactive', 'Resolved', 'Recurrence'), defaultValue: 'Active' },
  severity: { type: DataTypes.ENUM('Mild', 'Moderate', 'Severe'), defaultValue: 'Moderate' },
  onsetDate: { type: DataTypes.DATEONLY },
  resolvedDate: { type: DataTypes.DATEONLY },
  notes: { type: DataTypes.TEXT },
  recordedBy: { type: DataTypes.INTEGER },
  isChronicCondition: { type: DataTypes.BOOLEAN, defaultValue: false },
  aiPriorityScore: { type: DataTypes.FLOAT },
  aiCareplanSuggestion: { type: DataTypes.TEXT }
}, { tableName: 'problem_list', timestamps: true });

const ClinicalOrder = sequelize.define('ClinicalOrder', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  encounterId: { type: DataTypes.INTEGER },
  providerId: { type: DataTypes.INTEGER },
  orderType: { type: DataTypes.ENUM('Lab', 'Imaging', 'Medication', 'Procedure', 'Consult', 'Nursing', 'Diet'), allowNull: false },
  orderName: { type: DataTypes.STRING, allowNull: false },
  orderDetails: { type: DataTypes.TEXT },
  status: { type: DataTypes.ENUM('Draft', 'Active', 'OnHold', 'Completed', 'Cancelled'), defaultValue: 'Draft' },
  priority: { type: DataTypes.ENUM('Routine', 'Urgent', 'ASAP', 'Stat'), defaultValue: 'Routine' },
  orderedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  completedAt: { type: DataTypes.DATE },
  loincCode: { type: DataTypes.STRING },
  cptCode: { type: DataTypes.STRING },
  reasonForOrder: { type: DataTypes.TEXT },
  aiNecessityScore: { type: DataTypes.FLOAT },
  aiSuggestedAlternatives: { type: DataTypes.TEXT }
}, { tableName: 'clinical_orders', timestamps: true });

const Referral = sequelize.define('Referral', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  referringProviderId: { type: DataTypes.INTEGER },
  receivingProviderName: { type: DataTypes.STRING },
  specialistType: { type: DataTypes.STRING },
  reason: { type: DataTypes.TEXT },
  urgency: { type: DataTypes.ENUM('Routine', 'Urgent', 'Emergent'), defaultValue: 'Routine' },
  status: { type: DataTypes.ENUM('Pending', 'Accepted', 'Scheduled', 'Completed', 'Declined', 'Cancelled'), defaultValue: 'Pending' },
  referralLetter: { type: DataTypes.TEXT },
  appointmentDate: { type: DataTypes.DATE },
  inNetwork: { type: DataTypes.BOOLEAN, defaultValue: true },
  authorizationNumber: { type: DataTypes.STRING },
  aiRecommendedSpecialist: { type: DataTypes.STRING },
  aiDraftedLetter: { type: DataTypes.TEXT }
}, { tableName: 'referrals', timestamps: true });

const ClinicalNote = sequelize.define('ClinicalNote', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  encounterId: { type: DataTypes.INTEGER },
  providerId: { type: DataTypes.INTEGER },
  noteType: { type: DataTypes.ENUM('SOAP', 'Progress', 'Admission', 'Discharge', 'Consult', 'Procedure', 'Nursing'), defaultValue: 'SOAP' },
  subjective: { type: DataTypes.TEXT },
  objective: { type: DataTypes.TEXT },
  assessment: { type: DataTypes.TEXT },
  plan: { type: DataTypes.TEXT },
  rawDictation: { type: DataTypes.TEXT },
  signedAt: { type: DataTypes.DATE },
  cosignedBy: { type: DataTypes.INTEGER },
  amendmentOf: { type: DataTypes.INTEGER },
  isAmended: { type: DataTypes.BOOLEAN, defaultValue: false },
  extractedBillingCodes: { type: DataTypes.TEXT },
  aiQualityScore: { type: DataTypes.FLOAT }
}, { tableName: 'clinical_notes', timestamps: true });

const FhirResource = sequelize.define('FhirResource', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER },
  resourceType: { type: DataTypes.STRING, allowNull: false },
  fhirId: { type: DataTypes.STRING },
  versionId: { type: DataTypes.STRING },
  fhirJson: { type: DataTypes.TEXT, allowNull: false },
  sourceSystem: { type: DataTypes.STRING },
  lastSyncedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  syncDirection: { type: DataTypes.ENUM('Inbound', 'Outbound', 'Bidirectional'), defaultValue: 'Inbound' },
  validationStatus: { type: DataTypes.ENUM('Pending', 'Valid', 'Invalid', 'Warning'), defaultValue: 'Pending' },
  validationErrors: { type: DataTypes.TEXT },
  aiMappingNotes: { type: DataTypes.TEXT }
}, { tableName: 'fhir_resources', timestamps: true });

const Prescription = sequelize.define('Prescription', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  encounterId: { type: DataTypes.INTEGER },
  providerId: { type: DataTypes.INTEGER },
  drugName: { type: DataTypes.STRING, allowNull: false },
  ndcCode: { type: DataTypes.STRING },
  rxnormCode: { type: DataTypes.STRING },
  dose: { type: DataTypes.STRING },
  doseUnit: { type: DataTypes.STRING },
  route: { type: DataTypes.ENUM('Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation', 'Rectal', 'Other'), defaultValue: 'Oral' },
  frequency: { type: DataTypes.STRING },
  duration: { type: DataTypes.STRING },
  quantity: { type: DataTypes.INTEGER },
  refills: { type: DataTypes.INTEGER, defaultValue: 0 },
  dispenseAsWritten: { type: DataTypes.BOOLEAN, defaultValue: false },
  pharmacyId: { type: DataTypes.STRING },
  status: { type: DataTypes.ENUM('Draft', 'Signed', 'Transmitted', 'Filled', 'Cancelled', 'Expired'), defaultValue: 'Draft' },
  signedAt: { type: DataTypes.DATE },
  transmittedAt: { type: DataTypes.DATE },
  isControlled: { type: DataTypes.BOOLEAN, defaultValue: false },
  deaSchedule: { type: DataTypes.STRING },
  patientInstructions: { type: DataTypes.TEXT },
  aiInteractionWarnings: { type: DataTypes.TEXT },
  aiFormularyStatus: { type: DataTypes.STRING }
}, { tableName: 'prescriptions', timestamps: true });

const ImagingStudy = sequelize.define('ImagingStudy', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  patientId: { type: DataTypes.INTEGER, allowNull: false },
  encounterId: { type: DataTypes.INTEGER },
  orderId: { type: DataTypes.INTEGER },
  studyInstanceUid: { type: DataTypes.STRING, unique: true },
  accessionNumber: { type: DataTypes.STRING },
  modality: { type: DataTypes.ENUM('CR', 'CT', 'MR', 'US', 'XR', 'NM', 'PT', 'MG', 'DX'), defaultValue: 'CT' },
  studyType: { type: DataTypes.STRING },
  bodyPart: { type: DataTypes.STRING },
  studyDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  status: { type: DataTypes.ENUM('Scheduled', 'InProgress', 'Acquired', 'Read', 'Verified', 'Cancelled'), defaultValue: 'Scheduled' },
  numImages: { type: DataTypes.INTEGER },
  pacsUrl: { type: DataTypes.STRING },
  radiologistId: { type: DataTypes.INTEGER },
  reportText: { type: DataTypes.TEXT },
  impression: { type: DataTypes.TEXT },
  criticalFindings: { type: DataTypes.BOOLEAN, defaultValue: false },
  aiFindings: { type: DataTypes.TEXT },
  aiSuggestedFollowup: { type: DataTypes.TEXT }
}, { tableName: 'imaging_studies', timestamps: true });

function setupEhrAssociations(Patient) {
  Patient.hasMany(Encounter, { foreignKey: 'patientId' });
  Encounter.belongsTo(Patient, { foreignKey: 'patientId' });

  Patient.hasMany(Allergy, { foreignKey: 'patientId' });
  Allergy.belongsTo(Patient, { foreignKey: 'patientId' });

  Patient.hasMany(Problem, { foreignKey: 'patientId' });
  Problem.belongsTo(Patient, { foreignKey: 'patientId' });

  Patient.hasMany(ClinicalOrder, { foreignKey: 'patientId' });
  ClinicalOrder.belongsTo(Patient, { foreignKey: 'patientId' });
  Encounter.hasMany(ClinicalOrder, { foreignKey: 'encounterId' });
  ClinicalOrder.belongsTo(Encounter, { foreignKey: 'encounterId' });

  Patient.hasMany(Referral, { foreignKey: 'patientId' });
  Referral.belongsTo(Patient, { foreignKey: 'patientId' });

  Patient.hasMany(ClinicalNote, { foreignKey: 'patientId' });
  ClinicalNote.belongsTo(Patient, { foreignKey: 'patientId' });
  Encounter.hasMany(ClinicalNote, { foreignKey: 'encounterId' });
  ClinicalNote.belongsTo(Encounter, { foreignKey: 'encounterId' });

  Patient.hasMany(FhirResource, { foreignKey: 'patientId' });
  FhirResource.belongsTo(Patient, { foreignKey: 'patientId' });

  Patient.hasMany(Prescription, { foreignKey: 'patientId' });
  Prescription.belongsTo(Patient, { foreignKey: 'patientId' });
  Encounter.hasMany(Prescription, { foreignKey: 'encounterId' });
  Prescription.belongsTo(Encounter, { foreignKey: 'encounterId' });

  Patient.hasMany(ImagingStudy, { foreignKey: 'patientId' });
  ImagingStudy.belongsTo(Patient, { foreignKey: 'patientId' });
  Encounter.hasMany(ImagingStudy, { foreignKey: 'encounterId' });
  ImagingStudy.belongsTo(Encounter, { foreignKey: 'encounterId' });
}

module.exports = {
  Encounter,
  Allergy,
  Problem,
  ClinicalOrder,
  Referral,
  ClinicalNote,
  FhirResource,
  Prescription,
  ImagingStudy,
  setupEhrAssociations
};
