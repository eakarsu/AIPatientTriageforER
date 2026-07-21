'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../domain');

const valid = () => ({
  encounterId: 'enc-1', patientId: 'patient-1', createdBy: 'intake-1', retentionDays: 365,
  consent: { status: 'active', scope: 'emergency-care' },
  observations: [{ code: 'heart-rate', unit: 'beats/min', value: 110, observedAt: '2026-07-18T12:00:00Z', sourceRef: 'device:monitor:1' }],
  triageDecision: { level: 'urgent', rationale: 'tachycardia and symptoms', evidenceRefs: ['heart-rate'], confidence: 0.8, uncertainties: ['incomplete history'], autonomousDisposition: false, escalationOwner: 'nurse-2', reassessmentAt: '2026-07-18T12:15:00Z' },
  clinicianReview: { clinicianId: 'nurse-2', qualification: 'triage-rn', approved: true, note: 'bedside review completed' },
  emsArrival: { messageId: 'ems-1', agency: 'city-ems', receivedAt: '2026-07-18T11:58:00Z', protocolVersion: 'nemesis-v3', status: 'reconciled', autoCommitted: false },
  validation: { protocol: { version: 'val-v3', effectiveAt: '2026-07-01' }, underTriageRate: 0.01, overTriageRate: 0.08, cohorts: ['adult','geriatric'], edgeCases: ['missing-spo2'], deteriorationEscalation: 'immediate physician escalation', missingDataPolicy: 'block and assess' }
});

test('accepts clinician-approved reconciled ER triage support', () => assert.deepEqual(evaluate(valid()).errors, []));
test('blocks autonomous disposition and unreconciled EMS input', () => { const input = valid(); input.triageDecision.autonomousDisposition = true; input.emsArrival.status = 'received'; assert.ok(evaluate(input).errors.length >= 2); });
