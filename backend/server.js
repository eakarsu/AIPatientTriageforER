require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const { sequelize, Patient, TriageAssessment, VitalSign, SymptomAnalysis, PriorityQueue, DoctorAssignment, Treatment, WaitTime, MedicalHistory, LabOrder, Medication, Discharge, EmergencyAlert, BedManagement, PatientFlow } = require('./models');
const createCrudRouter = require('./routes/crud');
const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/patients', createCrudRouter(Patient));
app.use('/api/triage', createCrudRouter(TriageAssessment, { include: [Patient] }));
app.use('/api/vitals', createCrudRouter(VitalSign, { include: [Patient] }));
app.use('/api/symptoms', createCrudRouter(SymptomAnalysis, { include: [Patient] }));
app.use('/api/queue', createCrudRouter(PriorityQueue, { include: [Patient] }));
app.use('/api/assignments', createCrudRouter(DoctorAssignment, { include: [Patient] }));
app.use('/api/treatments', createCrudRouter(Treatment, { include: [Patient] }));
app.use('/api/wait-times', createCrudRouter(WaitTime));
app.use('/api/medical-history', createCrudRouter(MedicalHistory, { include: [Patient] }));
app.use('/api/lab-orders', createCrudRouter(LabOrder, { include: [Patient] }));
app.use('/api/medications', createCrudRouter(Medication, { include: [Patient] }));
app.use('/api/discharges', createCrudRouter(Discharge, { include: [Patient] }));
app.use('/api/alerts', createCrudRouter(EmergencyAlert, { include: [Patient] }));
app.use('/api/beds', createCrudRouter(BedManagement));
app.use('/api/patient-flow', createCrudRouter(PatientFlow));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// Dashboard stats
const auth = require('./middleware/auth');
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const [patients, activeAlerts, waitingQueue, occupiedBeds, totalBeds] = await Promise.all([
      Patient.count(),
      EmergencyAlert.count({ where: { status: 'Active' } }),
      PriorityQueue.count({ where: { status: 'Waiting' } }),
      BedManagement.count({ where: { status: 'Occupied' } }),
      BedManagement.count()
    ]);
    res.json({ patients, activeAlerts, waitingQueue, occupiedBeds, totalBeds, occupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');
    await sequelize.sync({ alter: true });
    console.log('Database synced');
    app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
