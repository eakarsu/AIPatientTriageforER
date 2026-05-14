require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const {
  sequelize, Patient, TriageAssessment, VitalSign, SymptomAnalysis,
  PriorityQueue, DoctorAssignment, Treatment, WaitTime, MedicalHistory,
  LabOrder, Medication, Discharge, EmergencyAlert, BedManagement, PatientFlow,
  AiResult, AuditLog
} = require('./models');
const createCrudRouter = require('./routes/crud');
const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');
const auth = require('./middleware/auth');

// Try to load helmet; skip gracefully if not installed yet
let helmet;
try { helmet = require('helmet'); } catch (e) { helmet = null; }

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

// Security headers
if (helmet) app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/integrations', require('./routes/integrations'));

// HIPAA Audit Logging - log every patient record view
const patientRouter = createCrudRouter(Patient);
const originalPatientGet = patientRouter.stack.find(l => l.route && l.route.path === '/:id' && l.route.methods.get);

// Override /api/patients/:id to add HIPAA audit log
app.get('/api/patients/:id', auth, async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Not found' });

    // HIPAA audit log
    await AuditLog.create({
      action: 'view_patient',
      userId: req.user?.id || null,
      patientId: parseInt(req.params.id),
      ipAddress: req.ip || req.connection?.remoteAddress || null
    });

    res.json(patient);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Patients list with pagination
app.get('/api/patients', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await Patient.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/patients', createCrudRouter(Patient));
app.use('/api/triage', createCrudRouter(TriageAssessment, { include: [Patient] }));
app.use('/api/vitals', createCrudRouter(VitalSign, { include: [Patient] }));
app.use('/api/symptoms', createCrudRouter(SymptomAnalysis, { include: [Patient] }));

// Queue with pagination + live endpoint
app.get('/api/queue', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await PriorityQueue.findAndCountAll({
      include: [Patient],
      order: [['priority', 'ASC'], ['checkInTime', 'ASC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live queue endpoint with wait times
app.get('/api/queue/live', auth, async (req, res) => {
  try {
    const queue = await PriorityQueue.findAll({
      where: { status: 'Waiting' },
      include: [Patient],
      order: [['priority', 'ASC'], ['checkInTime', 'ASC']]
    });

    const now = Date.now();
    const queueWithWait = queue.map(entry => {
      const checkIn = entry.checkInTime ? new Date(entry.checkInTime).getTime() : now;
      const waitedMinutes = Math.round((now - checkIn) / 60000);
      return {
        ...entry.toJSON(),
        waitedMinutes,
        estimatedRemainingMinutes: Math.max(0, (entry.estimatedWaitMinutes || 30) - waitedMinutes)
      };
    });

    res.json({ queue: queueWithWait, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/queue', createCrudRouter(PriorityQueue, { include: [Patient] }));
app.use('/api/assignments', createCrudRouter(DoctorAssignment, { include: [Patient] }));
app.use('/api/treatments', createCrudRouter(Treatment, { include: [Patient] }));
app.use('/api/wait-times', createCrudRouter(WaitTime));
app.use('/api/medical-history', createCrudRouter(MedicalHistory, { include: [Patient] }));

// Lab Orders with pagination
app.get('/api/lab-orders', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await LabOrder.findAndCountAll({
      include: [Patient],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/lab-orders', createCrudRouter(LabOrder, { include: [Patient] }));
app.use('/api/medications', createCrudRouter(Medication, { include: [Patient] }));
app.use('/api/discharges', createCrudRouter(Discharge, { include: [Patient] }));
app.use('/api/alerts', createCrudRouter(EmergencyAlert, { include: [Patient] }));
app.use('/api/beds', createCrudRouter(BedManagement));
app.use('/api/patient-flow', createCrudRouter(PatientFlow));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// Dashboard stats
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

// Create HTTP server and attach WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Broadcast queue updates to all connected WS clients
function broadcastQueueUpdate() {
  PriorityQueue.findAll({
    where: { status: 'Waiting' },
    include: [Patient],
    order: [['priority', 'ASC'], ['checkInTime', 'ASC']]
  }).then(queue => {
    const now = Date.now();
    const payload = JSON.stringify({
      type: 'queue_update',
      queue: queue.map(entry => {
        const checkIn = entry.checkInTime ? new Date(entry.checkInTime).getTime() : now;
        const waitedMinutes = Math.round((now - checkIn) / 60000);
        return {
          ...entry.toJSON(),
          waitedMinutes,
          estimatedRemainingMinutes: Math.max(0, (entry.estimatedWaitMinutes || 30) - waitedMinutes)
        };
      }),
      timestamp: new Date().toISOString()
    });

    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }).catch(err => console.error('WS broadcast error:', err));
}

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  // Send current queue immediately on connect
  broadcastQueueUpdate();

  ws.on('close', () => console.log('WebSocket client disconnected'));
  ws.on('error', (err) => console.error('WebSocket error:', err));
});

// Export broadcast so routes can use it
app.locals.broadcastQueueUpdate = broadcastQueueUpdate;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');
    // Use alter: false for safety. Use migrations for schema changes in production.
    await sequelize.sync({ alter: false });
    console.log('Database synced');
    server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();


// === Custom Feature Mounts (batch_06) ===
app.use('/api/cf-agentic-er-flow-optimization', require('./routes/customFeat01_AgenticErFlowOptimization'));
app.use('/api/cf-multi-modal-symptom-assessment', require('./routes/customFeat02_MultiModalSymptomAssessment'));
app.use('/api/cf-prediction-action-bundling', require('./routes/customFeat03_PredictionActionBundling'));
app.use('/api/cf-sepsis-early-warning', require('./routes/customFeat04_SepsisEarlyWarning'));
app.use('/api/cf-discharge-risk-stratification', require('./routes/customFeat05_DischargeRiskStratification'));


// === Batch 06 Gaps & Frontend Mounts ===
app.use('/api/gap-patients-without-patient', require('./routes/gapFeat_patients_without_patient'));
app.use('/api/gap-resources-without-staffing', require('./routes/gapFeat_resources_without_staffing'));
app.use('/api/gap-discharge-without-readmission', require('./routes/gapFeat_discharge_without_readmission'));
app.use('/api/gap-backend-collapses-everything-into-crud-js', require('./routes/gapFeat_backend_collapses_everything_into_crud_js'));
app.use('/api/gap-no-production', require('./routes/gapFeat_no_production'));
app.use('/api/gap-no-real', require('./routes/gapFeat_no_real'));
app.use('/api/gap-no-ambulance-ems-integration-arrival-notifications', require('./routes/gapFeat_no_ambulance_ems_integration_arrival_notifications'));
app.use('/api/gap-no-multi', require('./routes/gapFeat_no_multi'));
app.use('/api/gap-no-webhooks-for-critical-alerts-to-pagers-phones', require('./routes/gapFeat_no_webhooks_for_critical_alerts_to_pagers_phones'));
app.use('/api/gap-no-notifications-layer-dedicated-to-clinical-alert', require('./routes/gapFeat_no_notifications_layer_dedicated_to_clinical_alert'));
app.use('/api/gap-no-file-upload-for-imaging-lab-attachments-visible', require('./routes/gapFeat_no_file_upload_for_imaging_lab_attachments_visible'));
