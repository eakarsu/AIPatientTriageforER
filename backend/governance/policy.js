'use strict';
const crypto = require('node:crypto');

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SCOPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const SECRET = /(authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|raw[-_]?credential)/i;
const TRANSITIONS = Object.freeze({
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: ['retired', 'erasure_pending'],
  rejected: ['erasure_pending'],
  retired: ['erasure_pending'],
  erasure_pending: ['erased'],
  erased: []
});

function context(user) {
  const actor = String(user && (user.id || user.sub) || '').trim();
  const tenant = String(user && (user.tenantId || user.tenant_id) || '').trim();
  const role = String(user && user.role || '').trim();
  return actor && SCOPE.test(tenant) && role ? { actor, tenant, role } : null;
}

function validKey(value) {
  return typeof value === 'string' && KEY.test(value);
}

function canonicalize(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('request contains a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  throw new TypeError('request contains an unsupported value');
}

function requestDigest(value) {
  return crypto.createHash('sha256').update(canonicalize(value)).digest('hex');
}

function containsSecret(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => containsSecret(item, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => SECRET.test(key) || containsSecret(child, depth + 1));
}

function provenanceErrors(records) {
  if (!Array.isArray(records) || !records.length) return ['at least one provenance record is required'];
  const errors = [];
  records.forEach((record, index) => {
    if (!record || typeof record !== 'object') return errors.push(`provenance[${index}] must be an object`);
    if (!String(record.sourceRef || '').trim()) errors.push(`provenance[${index}].sourceRef required`);
    if (!String(record.rightsBasis || '').trim()) errors.push(`provenance[${index}].rightsBasis required`);
    if (!record.capturedAt || Number.isNaN(Date.parse(record.capturedAt))) errors.push(`provenance[${index}].capturedAt invalid`);
    if (record.sha256 && !/^[a-f0-9]{64}$/i.test(record.sha256)) errors.push(`provenance[${index}].sha256 invalid`);
  });
  if (containsSecret(records)) errors.push('provenance must not contain credentials');
  return errors;
}

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

function canApprove({ actor, creator, role, status, roles }) {
  return status === 'submitted' && actor !== String(creator) && roles.includes(role);
}

function deliveryState(status, attempts) {
  if (status === 'delivered') return 'delivered';
  if (status !== 'failed') throw new Error('unsupported result');
  return Number(attempts) + 1 >= 5 ? 'dead_letter' : 'failed';
}

module.exports = { TRANSITIONS, context, validKey, canonicalize, requestDigest, containsSecret, provenanceErrors, canTransition, canApprove, deliveryState };
