const express = require('express');
const auth = require('../middleware/auth');
const { callOpenRouter } = require('../services/openrouter');
const { Patient, TriageAssessment, VitalSign, SymptomAnalysis, MedicalHistory, Medication } = require('../models');
const router = express.Router();

// AI Triage Assessment
router.post('/triage', auth, async (req, res) => {
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Vital Signs Analysis
router.post('/vitals-analysis', auth, async (req, res) => {
  try {
    const { heartRate, bloodPressureSystolic, bloodPressureDiastolic, temperature, respiratoryRate, oxygenSaturation, glucoseLevel } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Symptom Analysis
router.post('/symptom-analysis', auth, async (req, res) => {
  try {
    const { symptoms, duration, severity, bodyRegion, patientAge, patientGender } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Priority Scoring
router.post('/priority-score', auth, async (req, res) => {
  try {
    const { chiefComplaint, triageLevel, vitalSigns, symptoms, painLevel } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Doctor Matching
router.post('/doctor-match', auth, async (req, res) => {
  try {
    const { diagnosis, symptoms, severity, specialtyNeeded } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Treatment Recommendation
router.post('/treatment-recommendation', auth, async (req, res) => {
  try {
    const { diagnosis, symptoms, patientAge, allergies, currentMedications } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Wait Time Prediction
router.post('/wait-prediction', auth, async (req, res) => {
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Medical History Risk Assessment
router.post('/risk-assessment', auth, async (req, res) => {
  try {
    const { conditions, currentSymptoms, medications, age, gender } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Lab Interpretation
router.post('/lab-interpretation', auth, async (req, res) => {
  try {
    const { testName, results, normalRange, patientContext } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Medication Check
router.post('/medication-check', auth, async (req, res) => {
  try {
    const { medication, dosage, currentMedications, allergies, age, weight } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Discharge Planning
router.post('/discharge-plan', auth, async (req, res) => {
  try {
    const { diagnosis, treatment, medications, procedures } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Emergency Alert Assessment
router.post('/emergency-assess', auth, async (req, res) => {
  try {
    const { alertType, description, location, patientCondition } = req.body;
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Bed Optimization
router.post('/bed-optimization', auth, async (req, res) => {
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI Patient Flow Analysis
router.post('/flow-analysis', auth, async (req, res) => {
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
    res.json({ success: true, analysis: aiResult.result, model: aiResult.model, usage: aiResult.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
