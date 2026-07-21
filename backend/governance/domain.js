'use strict';

const present = (value) => typeof value === 'string' && value.trim().length > 0;
const versioned = (value) => value && present(value.version) && present(value.effectiveAt);

function evaluate(input) {
  const errors = [];
  if (!present(input.encounterId) || !present(input.patientId)) errors.push('encounterId and patientId are required');
  if (!input.consent || input.consent.status !== 'active' || !present(input.consent.scope)) errors.push('active scoped consent is required');
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650) errors.push('bounded retentionDays is required');

  if (!Array.isArray(input.observations) || input.observations.length < 1 || input.observations.some((o) => !present(o.code) || !present(o.unit) || !Number.isFinite(o.value) || !present(o.observedAt) || !present(o.sourceRef))) errors.push('timestamped, unit-bearing clinical observations are required');
  if (new Set((input.observations || []).map((o) => `${o.code}:${o.observedAt}:${o.sourceRef}`)).size !== (input.observations || []).length) errors.push('duplicate observations are not allowed');

  const decision = input.triageDecision || {};
  if (!['resuscitation','emergent','urgent','less-urgent','non-urgent'].includes(decision.level)) errors.push('recognized triage level is required');
  if (!present(decision.rationale) || !Array.isArray(decision.evidenceRefs) || decision.evidenceRefs.length < 1) errors.push('explainable triage evidence is required');
  if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1 || !Array.isArray(decision.uncertainties)) errors.push('bounded confidence and explicit uncertainty are required');
  if (decision.autonomousDisposition === true) errors.push('autonomous disposition is prohibited');
  if (!present(decision.escalationOwner) || !present(decision.reassessmentAt)) errors.push('escalation owner and reassessment time are required');

  const review = input.clinicianReview || {};
  if (!present(review.clinicianId) || !present(review.qualification) || review.approved !== true || !present(review.note)) errors.push('qualified clinician approval is required');
  if (review.clinicianId === input.createdBy) errors.push('independent clinician approval is required');

  const arrival = input.emsArrival || {};
  if (!present(arrival.messageId) || !present(arrival.agency) || !present(arrival.receivedAt) || !present(arrival.protocolVersion) || arrival.status !== 'reconciled') errors.push('reconciled, versioned EMS arrival is required');
  if (arrival.autoCommitted === true) errors.push('EMS arrivals must remain staged until clinician reconciliation');

  const validation = input.validation || {};
  if (!versioned(validation.protocol) || !Number.isFinite(validation.underTriageRate) || !Number.isFinite(validation.overTriageRate)) errors.push('versioned validation with under/over-triage rates is required');
  if (!Array.isArray(validation.cohorts) || validation.cohorts.length < 2 || !Array.isArray(validation.edgeCases) || validation.edgeCases.length < 1) errors.push('cohort and edge-case validation is required');
  if (!present(validation.deteriorationEscalation) || !present(validation.missingDataPolicy)) errors.push('deterioration and missing-data policies are required');

  return {
    errors,
    result: { encounterId: input.encounterId, triageLevel: decision.level || null, disposition: errors.length ? 'blocked' : 'clinician-approved' },
    assumptions: ['Triage support does not replace emergency clinician judgment'],
    uncertainty: { confidence: decision.confidence ?? null, factors: decision.uncertainties || [], prospectiveValidationRequired: true }
  };
}

module.exports = { evaluate };
