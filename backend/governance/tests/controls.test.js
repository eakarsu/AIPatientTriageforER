'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  context, validKey, requestDigest, containsSecret, provenanceErrors,
  canTransition, canApprove, deliveryState
} = require('../policy');

const runtimeRoot = path.resolve(__dirname, '..', '..');
let projectRoot = runtimeRoot;
while (!fs.existsSync(path.join(projectRoot, 'start.sh'))) {
  const parent = path.dirname(projectRoot);
  if (parent === projectRoot) throw new Error('project root not found');
  projectRoot = parent;
}

test('authorization requires explicit tenant and independent approval', () => {
  assert.equal(context({ id: 'u1', role: 'admin' }), null);
  assert.deepEqual(context({ id: 'u1', tenantId: 'tenant-a', role: 'reviewer' }),
    { actor: 'u1', tenant: 'tenant-a', role: 'reviewer' });
  assert.equal(canApprove({ actor: 'u1', creator: 'u1', role: 'reviewer', status: 'submitted', roles: ['reviewer'] }), false);
  assert.equal(canApprove({ actor: 'u2', creator: 'u1', role: 'reviewer', status: 'submitted', roles: ['reviewer'] }), true);
});

test('contract rejects weak keys, secrets, and incomplete provenance', () => {
  assert.equal(validKey('workflow:2026:0001'), true);
  assert.equal(validKey('short'), false);
  assert.equal(containsSecret({ payload: { privateKey: 'x' } }), true);
  assert.deepEqual(provenanceErrors([{ sourceRef: 'record:1', rightsBasis: 'owned',
    capturedAt: '2026-07-18T00:00:00Z', sha256: 'f'.repeat(64) }]), []);
  assert.ok(provenanceErrors([{ sourceRef: 'record:1', token: 'x' }]).length > 0);
});

test('request idempotency is canonical and payload-bound', () => {
  assert.equal(requestDigest({ b: 2, a: { y: 1, x: true } }),
    requestDigest({ a: { x: true, y: 1 }, b: 2 }));
  assert.notEqual(requestDigest({ operation: 'export' }), requestDigest({ operation: 'delete' }));
  assert.throws(() => requestDigest({ invalid: Number.POSITIVE_INFINITY }));
});

test('integration failure state is bounded', () => {
  assert.equal(deliveryState('delivered', 0), 'delivered');
  assert.equal(deliveryState('failed', 0), 'failed');
  assert.equal(deliveryState('failed', 4), 'dead_letter');
  assert.throws(() => deliveryState('unknown', 0));
});

test('end-to-end state machine prevents approval and erasure shortcuts', () => {
  const sequence = ['draft','submitted','approved','retired','erasure_pending','erased'];
  for (let i = 0; i < sequence.length - 1; i += 1) assert.equal(canTransition(sequence[i], sequence[i + 1]), true);
  assert.equal(canTransition('draft', 'approved'), false);
  assert.equal(canTransition('erased', 'draft'), false);
});

test('migration preserves tenant boundaries, connector state, and immutable audit', () => {
  const sql = fs.readFileSync(path.join(runtimeRoot, 'migrations', '001_governed_workflows.sql'), 'utf8');
  assert.match(sql, /FOREIGN KEY\(tenant_id,work_item_id\)/);
  assert.match(sql, /governed_connector_checkpoints/);
  assert.match(sql, /governed_work_events_append_only/);
  assert.match(sql, /UNIQUE\(tenant_id,workflow_type,idempotency_key\)/);
  assert.match(sql, /request_hash CHAR\(64\) NOT NULL/);
  assert.match(sql, /erasure_idempotency_key/);
  assert.match(sql, /lease_expires_at/);
});

test('router contract uses atomic state-plus-audit and provider quarantine', () => {
  const router = fs.readFileSync(path.join(runtimeRoot, 'governance', 'router.js'), 'utf8');
  assert.match(router, /WITH changed AS/);
  assert.match(router, /integration_queued/);
  assert.match(router, /created_by<>\$2/);
  assert.match(router, /tenant_id=\$2/);
  assert.match(router, /dead_letter/);
  assert.match(router, /Idempotency-Key was already used for a different request/);
  assert.match(router, /created_by=\$4 OR approved_by=\$4/);
  assert.match(router, /FOR UPDATE SKIP LOCKED/);
  assert.match(router, /X-Claim-Token/);
});

test('host mount and lifecycle are non-destructive', () => {
  const hostPath = ['server.js','index.js'].map((name) => path.join(runtimeRoot, name)).find(fs.existsSync);
  const host = fs.readFileSync(hostPath, 'utf8');
  const launcher = fs.readFileSync(path.join(projectRoot, 'start.sh'), 'utf8');
  assert.match(host, /require\('\.\/governance'\)/);
  assert.doesNotMatch(launcher, /kill\s+-9|npm install|seed\.js|createdb|brew services/);
  assert.match(launcher, /ALLOW_SCHEMA_MIGRATION/);
  assert.doesNotMatch(host, /routes\/gap-|gap mount fail/);
  const envExample = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
  assert.match(envExample, /^JWT_SECRET=$/m);
  assert.match(envExample, /^GOVERNANCE_TENANT_ID=$/m);
});
