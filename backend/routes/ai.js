const express = require('express');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { body, validationResult } = require('express-validator');
const { callOpenRouter } = require('../services/openrouter');
const {
  Patient, TriageAssessment, VitalSign, SymptomAnalysis,
  MedicalHistory, Medication, Treatment, LabOrder, Discharge,
  PriorityQueue, BedManagement, AiResult
} = require('../models');
const router = express.Router();

// In-memory rate limiter: max 20 AI calls per hour per user/IP
const rateLimitMap = new Map();
function aiRateLimiter(req, res, next) {
  const key = req.user ? `user:${req.user.id}` : `ip:${req.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const limit = 20;

  const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  rateLimitMap.set(key, entry);

  if (entry.count > limit) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 20 AI calls per hour.' });
  }
  next();
}

/**
 * 3-strategy JSON parser for AI responses.
 */
function parseAIJson(content) {
  if (!content) return { raw_response: '' };
  // Strategy 1: extract from markdown code block
  const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (e) {}
  }
  // Strategy 2: direct JSON parse
  try { return JSON.parse(content); } catch (e) {}
  // Strategy 3: extract first { ... } block
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (e) {}
  }
  return { raw_response: content };
}

/**
 * Persist AI result to ai_results table.
 */
async function persistAiResult(userId, endpoint, patientId, result, model) {
  try {
    await AiResult.create({
      userId: userId || null,
      endpoint,
      patientId: patientId || null,
      result: typeof result === 'string' ? result : JSON.stringify(result),
      model: model || 'unknown'
    });
  } catch (e) {
    console.error('Failed to persist AI result:', e.message);
  }
}

// Apply auth + rate limiter to all AI routes
router.use(auth, aiRateLimiter);

// AI Triage Assessment
// Requires role: nurse, doctor, admin
router.post('/triage', authorize('nurse', 'doctor', 'admin'), async (req, res) => {
  try {
    const { patientId, chiefComplaint, symptoms, painLevel, vitalSigns } = req.body;
    const prompt = `Perform an emergency department triage assessment:
Patient Complaint: ${chiefComplaint}
Symptoms: ${symptoms}
Pain Level: ${painLevel}/10
${vitalSigns ? `Vital Signs: HR ${vitalSigns.heartRate}, BP ${vitalSigns.systolic}/${vitalSigns.diastolic}, Temp ${vitalSigns.temperature}°F, SpO2 ${vitalSigns.oxygenSaturation}%` : ''}

Provide:
1. **Triage Level** (ESI 1-5: 1=Resuscitation, 2=Emergency, 3=Urgent, 4=Less Urgent, 5=Non-Urgent)
2. **Confidence Score** (0-100%)
3. **Key Concerns** - critical findings
4. **Recommended Actions** - immediate steps
5. **Potential Diagnoses** - differential diagnosis list
6. **Time Sensitivity** - how quickly patient needs to be seen`;

    const aiResult = await callOpenRouter(prompt);

    // Persist to TriageAssessment if patientId provided
    if (patientId) {
      const confidenceMatch = aiResult.result.match(/(\d{1,3})%/);
      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) / 100 : null;
      await TriageAssessment.update(
        { aiRecommendation: aiResult.result, aiConfidence: confidence },
        { where: { patientId } }
      );
    }

    await persistAiResult(req.user?.id, '/ai/triage', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Vital Signs Analysis
router.post('/vitals-analysis', async (req, res) => {
  try {
    const { vitalsId, patientId, heartRate, bloodPressureSystolic, bloodPressureDiastolic, temperature, respiratoryRate, oxygenSaturation, glucoseLevel } = req.body;
    const prompt = `Analyze these vital signs for an ER patient:
- Heart Rate: ${heartRate} bpm
- Blood Pressure: ${bloodPressureSystolic}/${bloodPressureDiastolic} mmHg
- Temperature: ${temperature}°F
- Respiratory Rate: ${respiratoryRate} breaths/min
- Oxygen Saturation: ${oxygenSaturation}%
${glucoseLevel ? `- Glucose Level: ${glucoseLevel} mg/dL` : ''}

Provide:
1. **Overall Assessment** - normal, concerning, or critical
2. **Abnormal Findings** - any values outside normal range
3. **Alert Level** (Normal/Warning/Critical)
4. **Clinical Significance** - what these values together suggest
5. **Recommended Monitoring** - what to watch
6. **Immediate Actions** - if any values are critical`;

    const aiResult = await callOpenRouter(prompt);

    // Persist to VitalSign record if vitalsId provided
    if (vitalsId) {
      await VitalSign.update(
        { aiAnalysis: aiResult.result },
        { where: { id: vitalsId } }
      );
    }

    await persistAiResult(req.user?.id, '/ai/vitals-analysis', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Symptom Analysis
router.post('/symptom-analysis', async (req, res) => {
  try {
    const { symptomId, patientId, symptoms, duration, severity, bodyRegion, patientAge, patientGender } = req.body;
    const prompt = `Analyze these symptoms for an ER patient:
Symptoms: ${symptoms}
Duration: ${duration}
Severity: ${severity}
Body Region: ${bodyRegion}
${patientAge ? `Patient Age: ${patientAge}` : ''}
${patientGender ? `Patient Gender: ${patientGender}` : ''}

Provide:
1. **Primary Diagnosis** - most likely condition
2. **Differential Diagnoses** - other possibilities ranked by likelihood
3. **Urgency Score** (1-10)
4. **Recommended Tests** - labs, imaging, etc.
5. **Red Flags** - symptoms that need immediate attention
6. **Treatment Considerations** - initial management suggestions`;

    const aiResult = await callOpenRouter(prompt);

    // Persist to SymptomAnalysis record if symptomId provided
    if (symptomId) {
      await SymptomAnalysis.update(
        { aiDiagnosis: aiResult.result },
        { where: { id: symptomId } }
      );
    }

    await persistAiResult(req.user?.id, '/ai/symptom-analysis', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Priority Scoring
router.post('/priority-score', async (req, res) => {
  try {
    const { patientId, chiefComplaint, triageLevel, vitalSigns, symptoms, painLevel } = req.body;
    const prompt = `Determine the priority queue position for this ER patient:
Chief Complaint: ${chiefComplaint}
Current Triage Level: ${triageLevel}
Pain Level: ${painLevel}/10
Symptoms: ${symptoms}
${vitalSigns ? `Vitals: HR ${vitalSigns.heartRate}, BP ${vitalSigns.systolic}/${vitalSigns.diastolic}` : ''}

Provide:
1. **Priority Score** (1-5, 1 being highest priority)
2. **Estimated Wait Time** in minutes
3. **Reasoning** - why this priority level
4. **Escalation Triggers** - what would increase priority
5. **Department Assignment** - where patient should go
6. **Resource Needs** - equipment or specialist needed`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/priority-score', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Doctor Matching
router.post('/doctor-match', async (req, res) => {
  try {
    const { patientId, diagnosis, symptoms, severity, specialtyNeeded } = req.body;
    const prompt = `Recommend the best doctor/specialist match for this ER patient:
Diagnosis/Symptoms: ${diagnosis || symptoms}
Severity: ${severity}
Specialty Needed: ${specialtyNeeded || 'To be determined'}

Provide:
1. **Recommended Specialty** - primary specialty needed
2. **Secondary Specialty** - if consultation needed
3. **Match Reasoning** - why this specialty
4. **Urgency of Consultation** (Immediate/Within 1hr/Within 4hrs/Routine)
5. **Key Qualifications** - what the treating physician should have experience with
6. **Consultation Notes** - what to communicate to the assigned doctor`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/doctor-match', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Treatment Recommendation - requires doctor or admin
router.post('/treatment-recommendation', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { treatmentId, patientId, diagnosis, symptoms, patientAge, allergies, currentMedications } = req.body;
    const prompt = `Recommend treatment for this ER patient:
Diagnosis: ${diagnosis}
Symptoms: ${symptoms}
${patientAge ? `Age: ${patientAge}` : ''}
${allergies ? `Known Allergies: ${allergies}` : 'No known allergies'}
${currentMedications ? `Current Medications: ${currentMedications}` : ''}

Provide:
1. **Recommended Treatment Plan** - step by step
2. **Medications** - name, dosage, route, frequency
3. **Procedures** - any procedures needed
4. **Evidence Level** (High/Moderate/Low)
5. **Monitoring Plan** - what to watch during treatment
6. **Contraindications** - based on patient profile
7. **Expected Outcome** - prognosis with treatment`;

    const aiResult = await callOpenRouter(prompt);

    // Persist to Treatment record if treatmentId provided
    if (treatmentId) {
      await Treatment.update(
        { aiRecommendation: aiResult.result },
        { where: { id: treatmentId } }
      );
    }

    await persistAiResult(req.user?.id, '/ai/treatment-recommendation', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Wait Time Prediction
router.post('/wait-prediction', async (req, res) => {
  try {
    const { department, currentPatients, staffCount, timeOfDay, dayOfWeek } = req.body;
    const prompt = `Predict ER wait times with these parameters:
Department: ${department}
Current Patients Waiting: ${currentPatients}
Staff On Duty: ${staffCount}
Time of Day: ${timeOfDay}
Day of Week: ${dayOfWeek}

Provide:
1. **Predicted Wait Time** in minutes
2. **Confidence Level** - how confident in this prediction
3. **Peak Analysis** - is this peak hours?
4. **Staffing Assessment** - adequate or understaffed
5. **Recommendations** - how to reduce wait times
6. **Predicted Next Hour** - expected changes in next 60 min`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/wait-prediction', null, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Medical History Risk Assessment
router.post('/risk-assessment', async (req, res) => {
  try {
    const { patientId, conditions, currentSymptoms, medications, age, gender } = req.body;
    const prompt = `Assess risk based on medical history for this ER patient:
Medical History: ${conditions}
Current Symptoms: ${currentSymptoms}
Current Medications: ${medications || 'None reported'}
${age ? `Age: ${age}` : ''}
${gender ? `Gender: ${gender}` : ''}

Provide:
1. **Risk Level** (Low/Moderate/High/Critical)
2. **Key Risk Factors** - most concerning elements
3. **Drug Interactions** - potential medication conflicts
4. **Complication Risks** - what could go wrong
5. **Recommended Precautions** - safety measures
6. **History-Symptom Correlation** - how history relates to current presentation`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/risk-assessment', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Lab Interpretation
router.post('/lab-interpretation', async (req, res) => {
  try {
    const { labOrderId, patientId, testName, results, normalRange, patientContext } = req.body;
    const prompt = `Interpret these lab results for an ER patient:
Test: ${testName}
Results: ${results}
Normal Range: ${normalRange || 'Standard reference ranges'}
Patient Context: ${patientContext || 'No additional context'}

Provide:
1. **Interpretation** - what do these results mean
2. **Clinical Significance** - how important is this finding
3. **Abnormalities** - any values out of range
4. **Possible Causes** - why results might be abnormal
5. **Recommended Follow-up Tests** - additional testing needed
6. **Urgency** - how quickly to act on these results`;

    const aiResult = await callOpenRouter(prompt);

    // Persist to LabOrder record if labOrderId provided
    if (labOrderId) {
      await LabOrder.update(
        { aiInterpretation: aiResult.result },
        { where: { id: labOrderId } }
      );
    }

    await persistAiResult(req.user?.id, '/ai/lab-interpretation', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Medication Check
router.post('/medication-check', async (req, res) => {
  try {
    const { medicationId, patientId, medication, dosage, currentMedications, allergies, age, weight } = req.body;
    const prompt = `Check this medication prescription for an ER patient:
Prescribed Medication: ${medication}
Dosage: ${dosage}
Current Medications: ${currentMedications || 'None'}
Known Allergies: ${allergies || 'NKDA'}
${age ? `Age: ${age}` : ''}
${weight ? `Weight: ${weight} kg` : ''}

Provide:
1. **Safety Assessment** (Safe/Caution/Contraindicated)
2. **Drug Interactions** - with current medications
3. **Allergy Cross-Reactivity** - potential allergic reactions
4. **Dosage Verification** - is dosage appropriate
5. **Side Effects** - common and serious
6. **Monitoring Requirements** - labs or vitals to watch
7. **Alternative Medications** - if contraindicated`;

    const aiResult = await callOpenRouter(prompt);

    // Persist to Medication record if medicationId provided
    if (medicationId) {
      await Medication.update(
        { aiInteractionCheck: aiResult.result },
        { where: { id: medicationId } }
      );
    }

    await persistAiResult(req.user?.id, '/ai/medication-check', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Discharge Planning - requires doctor or admin
router.post('/discharge-plan', authorize('doctor', 'admin'), async (req, res) => {
  try {
    const { dischargeId, patientId, diagnosis, treatment, medications, procedures } = req.body;
    const prompt = `Create a discharge plan for this ER patient:
Diagnosis: ${diagnosis}
Treatment Provided: ${treatment}
Medications Prescribed: ${medications || 'None'}
Procedures Performed: ${procedures || 'None'}

Provide:
1. **Discharge Summary** - concise summary of visit
2. **Home Care Instructions** - detailed patient instructions
3. **Medication Instructions** - how to take each medication
4. **Follow-Up Appointments** - when and with whom
5. **Return Precautions** - when to come back to ER
6. **Activity Restrictions** - what to avoid
7. **Diet Recommendations** - if applicable`;

    const aiResult = await callOpenRouter(prompt);

    // Persist to Discharge record if dischargeId provided
    if (dischargeId) {
      await Discharge.update(
        { aiDischargeNotes: aiResult.result },
        { where: { id: dischargeId } }
      );
    }

    await persistAiResult(req.user?.id, '/ai/discharge-plan', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Emergency Alert Assessment
router.post('/emergency-assess', async (req, res) => {
  try {
    const { patientId, alertType, description, location, patientCondition } = req.body;
    const prompt = `Assess this emergency alert in the ER:
Alert Type: ${alertType}
Description: ${description}
Location: ${location}
Patient Condition: ${patientCondition || 'Unknown'}

Provide:
1. **Severity Assessment** (Low/Medium/High/Critical)
2. **Recommended Response** - immediate actions
3. **Team Activation** - who needs to respond
4. **Equipment Needed** - critical equipment list
5. **Protocol** - standard protocol to follow
6. **Estimated Response Time** - how fast team should arrive
7. **Escalation Criteria** - when to escalate further`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/emergency-assess', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Bed Optimization
router.post('/bed-optimization', async (req, res) => {
  try {
    const { totalBeds, occupiedBeds, pendingAdmissions, pendingDischarges, departments } = req.body;
    const prompt = `Optimize bed allocation for this ER:
Total Beds: ${totalBeds}
Occupied: ${occupiedBeds}
Pending Admissions: ${pendingAdmissions}
Pending Discharges: ${pendingDischarges}
Departments: ${departments || 'General ER'}

Provide:
1. **Current Utilization** - occupancy percentage
2. **Optimal Allocation** - how to redistribute
3. **Bottlenecks** - where delays are occurring
4. **Predicted Needs** - next 4 hours
5. **Recommendations** - specific actions to improve flow
6. **Surge Capacity** - options if overcrowded`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/bed-optimization', null, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Patient Flow Analysis
router.post('/flow-analysis', async (req, res) => {
  try {
    const { admissions, discharges, avgWait, avgTreatment, occupancy, department } = req.body;
    const prompt = `Analyze patient flow in this ER department:
Department: ${department || 'General ER'}
Total Admissions Today: ${admissions}
Total Discharges Today: ${discharges}
Average Wait Time: ${avgWait} minutes
Average Treatment Time: ${avgTreatment} minutes
Current Occupancy: ${occupancy}%

Provide:
1. **Flow Efficiency Score** (1-10)
2. **Bottleneck Analysis** - where delays occur
3. **Staffing Recommendation** - optimal staff levels
4. **Peak Hour Prediction** - busiest times
5. **Improvement Strategies** - specific actionable steps
6. **Predicted Admissions Next 4hrs** - expected volume
7. **Capacity Alert** - any concerns`;

    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/flow-analysis', null, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ESI Calculator ───────────────────────────────────────────────────────────
// POST /api/ai/esi-calculate
// Accepts symptoms, vital signs, chief complaint → returns ESI level 1-5 JSON
router.post('/esi-calculate',
  [
    body('chiefComplaint').notEmpty().withMessage('chiefComplaint is required'),
    body('symptoms').notEmpty().withMessage('symptoms is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { chiefComplaint, symptoms, vitalSigns, patientAge, patientGender } = req.body;

      const vs = vitalSigns || {};
      const prompt = `You are an expert emergency medicine physician. Calculate the Emergency Severity Index (ESI) level for this patient and return a structured JSON response.

Patient Information:
- Chief Complaint: ${chiefComplaint}
- Symptoms: ${symptoms}
- Age: ${patientAge || 'Unknown'}
- Gender: ${patientGender || 'Unknown'}
- Vital Signs:
  - Heart Rate: ${vs.heartRate || 'Not recorded'} bpm
  - Blood Pressure: ${vs.bloodPressureSystolic || '--'}/${vs.bloodPressureDiastolic || '--'} mmHg
  - Temperature: ${vs.temperature || 'Not recorded'}°F
  - Respiratory Rate: ${vs.respiratoryRate || 'Not recorded'} breaths/min
  - Oxygen Saturation: ${vs.oxygenSaturation || 'Not recorded'}%

ESI Scale:
- ESI 1: Immediate life-saving intervention required (intubation, defibrillation, etc.)
- ESI 2: High risk of life threat, severe pain/distress, confused/lethargic/disoriented
- ESI 3: Multiple resources needed (labs, imaging, IV fluids, medications)
- ESI 4: One resource needed
- ESI 5: No resources needed

Respond ONLY with valid JSON in this exact format:
{
  "esi_level": <1-5>,
  "esi_label": "<Resuscitation|Emergency|Urgent|Less Urgent|Non-Urgent>",
  "confidence": "<high|medium|low>",
  "rationale": "<detailed explanation of why this ESI level was assigned>",
  "immediate_actions": ["<action 1>", "<action 2>"],
  "disposition_recommendation": "<resuscitation bay|acute care|fast track|waiting room>",
  "estimated_time_to_physician": "<immediate|<10 min|<30 min|<60 min|<120 min>",
  "predicted_resource_needs": ["<resource 1>", "<resource 2>"],
  "escalation_criteria": ["<sign or symptom that would increase ESI level>"],
  "vital_signs_assessment": {
    "heart_rate_status": "<normal|tachycardic|bradycardic>",
    "bp_status": "<normal|hypertensive|hypotensive>",
    "temp_status": "<normal|febrile|hypothermic>",
    "spo2_status": "<normal|hypoxic>",
    "rr_status": "<normal|tachypneic|bradypneic>"
  }
}`;

      const aiResult = await callOpenRouter(prompt, 'You are an expert emergency medicine AI assistant. Respond ONLY with valid JSON.');
      const parsed = parseAIJson(aiResult.result);

      await persistAiResult(req.user?.id, '/ai/esi-calculate', null, parsed, aiResult.model);
      res.json({ success: true, esi: parsed, model: aiResult.model, usage: aiResult.usage });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Resource Predictor ────────────────────────────────────────────────────────
// POST /api/ai/resource-predict
// Fetches live census data from DB, queries AI for 2-hour resource prediction
router.post('/resource-predict', async (req, res) => {
  try {
    // Fetch current department census from DB
    const [waitingCount, occupiedBeds, totalBeds, pendingLabOrders, activeMeds] = await Promise.all([
      PriorityQueue.count({ where: { status: 'Waiting' } }),
      BedManagement.count({ where: { status: 'Occupied' } }),
      BedManagement.count(),
      LabOrder.count({ where: { status: 'Ordered' } }),
      Medication.count({ where: { status: 'Active' } }),
    ]);

    const availableBeds = totalBeds - occupiedBeds;
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
    const timeOfDay = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    const { currentStaff, expectedArrivals } = req.body || {};

    const prompt = `You are an ER operations AI analyst. Based on current department census data, predict resource needs for the next 2 hours.

Current Department Status (${timeOfDay} on ${dayOfWeek}):
- Patients Currently Waiting: ${waitingCount}
- Occupied Beds: ${occupiedBeds} of ${totalBeds} total (${occupancyRate}% occupancy)
- Available Beds: ${availableBeds}
- Pending Lab Orders: ${pendingLabOrders}
- Active Medications Being Administered: ${activeMeds}
- Current Staff on Duty: ${currentStaff || 'Not specified'}
- Expected New Arrivals (next 2h): ${expectedArrivals || 'Standard volume'}

Respond ONLY with valid JSON in this exact format:
{
  "prediction_window": "2 hours",
  "generated_at": "${new Date().toISOString()}",
  "predicted_additional_patients": <number>,
  "predicted_peak_intensity": "<low|moderate|high|critical>",
  "bed_needs": {
    "predicted_beds_needed": <number>,
    "beds_available": ${availableBeds},
    "shortage_risk": "<none|low|moderate|high>",
    "recommendation": "<string>"
  },
  "staffing_needs": {
    "nurses_recommended": <number>,
    "physicians_recommended": <number>,
    "techs_recommended": <number>,
    "current_gap": "<string>"
  },
  "supply_needs": [
    { "supply": "<item>", "quantity": "<amount>", "urgency": "<routine|urgent|critical>" }
  ],
  "lab_capacity": {
    "pending_orders": ${pendingLabOrders},
    "predicted_new_orders": <number>,
    "bottleneck_risk": "<low|moderate|high>"
  },
  "recommendations": ["<action 1>", "<action 2>", "<action 3>"],
  "surge_plan": "<what to do if patient volume exceeds predictions>",
  "confidence": "<high|medium|low>"
}`;

    const aiResult = await callOpenRouter(prompt, 'You are an ER operations AI analyst. Respond ONLY with valid JSON.');
    const parsed = parseAIJson(aiResult.result);

    await persistAiResult(req.user?.id, '/ai/resource-predict', null, parsed, aiResult.model);
    res.json({
      success: true,
      prediction: parsed,
      census: { waitingCount, occupiedBeds, totalBeds, availableBeds, occupancyRate, pendingLabOrders },
      model: aiResult.model,
      usage: aiResult.usage
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Medication Safety Checker ─────────────────────────────────────────────────
// POST /api/ai/med-safety
// Accepts patient allergies + current meds + proposed medication → interaction/allergy risk JSON
router.post('/med-safety',
  [
    body('proposedMedication').notEmpty().withMessage('proposedMedication is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { patientId, proposedMedication, proposedDosage, currentMedications, allergies, patientAge, patientWeight, patientConditions } = req.body;

      // If patientId provided, fetch allergies and current meds from DB
      let fetchedAllergies = allergies || 'NKDA';
      let fetchedMeds = currentMedications || 'None';
      if (patientId) {
        try {
          const patient = await Patient.findByPk(patientId);
          if (patient?.allergies) fetchedAllergies = patient.allergies;
          const meds = await Medication.findAll({ where: { patientId, status: 'Active' } });
          if (meds.length > 0) {
            fetchedMeds = meds.map(m => `${m.medicationName} ${m.dosage}`).join(', ');
          }
        } catch (e) { /* proceed with provided data */ }
      }

      const prompt = `You are a clinical pharmacist AI specializing in drug safety in the emergency department. Perform a comprehensive medication safety check.

Proposed Medication: ${proposedMedication}${proposedDosage ? ` (${proposedDosage})` : ''}
Current Medications: ${fetchedMeds}
Known Allergies: ${fetchedAllergies}
Patient Age: ${patientAge || 'Unknown'}
Patient Weight: ${patientWeight ? `${patientWeight} kg` : 'Unknown'}
Active Medical Conditions: ${patientConditions || 'Not specified'}

Respond ONLY with valid JSON in this exact format:
{
  "safety_verdict": "<SAFE|CAUTION|CONTRAINDICATED>",
  "overall_risk_level": "<low|moderate|high|critical>",
  "allergy_assessment": {
    "allergy_conflict": <true|false>,
    "cross_reactivity_risk": "<none|possible|likely|definite>",
    "details": "<explanation>"
  },
  "drug_interactions": [
    {
      "interacting_drug": "<drug name>",
      "severity": "<minor|moderate|major|contraindicated>",
      "mechanism": "<pharmacokinetic/pharmacodynamic>",
      "clinical_effect": "<what happens>",
      "management": "<what to do>"
    }
  ],
  "dosage_assessment": {
    "proposed_dose": "${proposedDosage || 'not specified'}",
    "appropriate_for_patient": "<yes|no|review needed>",
    "recommended_dose": "<dose range>",
    "adjustment_needed": "<string or null>"
  },
  "contraindications": ["<contraindication 1>", "<contraindication 2>"],
  "monitoring_requirements": ["<parameter to monitor>"],
  "side_effects": {
    "common": ["<effect>"],
    "serious": ["<effect>"],
    "rare_but_significant": ["<effect>"]
  },
  "alternative_medications": [
    { "name": "<alternative>", "rationale": "<why to consider>" }
  ],
  "clinical_notes": "<any additional safety notes for the prescribing clinician>"
}`;

      const aiResult = await callOpenRouter(prompt, 'You are a clinical pharmacist AI. Respond ONLY with valid JSON.');
      const parsed = parseAIJson(aiResult.result);

      await persistAiResult(req.user?.id, '/ai/med-safety', patientId, parsed, aiResult.model);
      res.json({ success: true, safety: parsed, model: aiResult.model, usage: aiResult.usage });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /api/ai/history - paginated AI results for logged-in user
router.get('/history', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await AiResult.findAndCountAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Patient History Summarize
router.post('/patient-history-summarize', async (req, res) => {
  try {
    const { patientId } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId required' });
    let patient = null, history = [], meds = [], visits = [];
    try { patient = await Patient.findByPk(patientId); } catch {}
    try { history = await MedicalHistory.findAll({ where: { patientId }, limit: 30 }); } catch {}
    try { meds = await Medication.findAll({ where: { patientId }, limit: 30 }); } catch {}
    try { visits = await TriageAssessment.findAll({ where: { patientId }, limit: 20 }); } catch {}

    const prompt = `Summarize this patient's medical record into a 1-page ER-relevant overview.
Patient: ${JSON.stringify(patient || { id: patientId })}
Medical history: ${JSON.stringify(history)}
Medications: ${JSON.stringify(meds)}
Recent ER visits: ${JSON.stringify(visits)}

Provide:
1. Headline summary (2-3 sentences)
2. Active conditions
3. Allergies
4. Current medications & doses
5. Recent ER patterns
6. Red flags / clinician must-knows
7. Recommended initial workup`;
    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/patient-history-summarize', patientId, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI Staffing Optimize
router.post('/staffing-optimize', async (req, res) => {
  try {
    const { horizon_hours, current_census, expected_admissions, staffing_levels, weather_or_event } = req.body || {};
    const prompt = `Forecast ER staffing needs for the next ${horizon_hours || 12} hours and recommend adjustments.
Current ED census: ${JSON.stringify(current_census || {})}
Expected admissions / inflow: ${JSON.stringify(expected_admissions || {})}
Current staffing: ${JSON.stringify(staffing_levels || {})}
Local context (weather/event): ${weather_or_event || 'none'}

Provide:
1. Demand forecast by hour
2. Required RN/MD/Tech head counts by hour
3. Gap analysis vs. current staffing
4. Recommended call-ins / reassignments / float-pool actions
5. Confidence and key assumptions`;
    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/staffing-optimize', null, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI Readmission Risk
router.post('/readmission-risk', async (req, res) => {
  try {
    const { patientId, dischargeId } = req.body || {};
    let patient = null, dischargeRow = null, history = [];
    try { if (patientId) patient = await Patient.findByPk(patientId); } catch {}
    try { if (dischargeId) dischargeRow = await Discharge.findByPk(dischargeId); } catch {}
    try { if (patientId) history = await MedicalHistory.findAll({ where: { patientId }, limit: 30 }); } catch {}

    const prompt = `Score 30-day readmission risk for this patient and recommend post-discharge interventions.
Patient: ${JSON.stringify(patient || { id: patientId })}
Discharge plan: ${JSON.stringify(dischargeRow || {})}
Medical history: ${JSON.stringify(history)}

Provide:
1. Risk score (0-100) and risk tier (low/medium/high)
2. Key risk drivers
3. Recommended follow-up calls / appointments
4. Home-health and community resources to engage
5. Patient education priorities
6. Disclaimer note`;
    const aiResult = await callOpenRouter(prompt);
    await persistAiResult(req.user?.id, '/ai/readmission-risk', patientId || null, aiResult.result, aiResult.model);
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
