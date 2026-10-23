const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { TaskStore, filterRecords, toCSV, toJSON, runAiFeature, AI_FEATURES } = require('../lib/featurePack.js');

test('tasks create/list/update with search-filter', () => {
  const s = new TaskStore();
  const a = s.create({ title: 'Alpha task', status: 'open', priority: 'high' });
  s.create({ title: 'Beta task', status: 'done', priority: 'low' });
  assert.equal(s.list({ q: 'alpha' }).length, 1);
  assert.equal(s.list({ status: 'done' }).length, 1);
  assert.equal(s.update(a.id, { status: 'done' }).status, 'done');
  assert.equal(s.update(9999, { status: 'done' }), null);
  assert.throws(() => s.create({}), /title is required/);
});
test('export CSV/JSON preserves false/0/empty', () => {
  const rows = [{ id: 1, title: 'x', description: '', status: 'open', priority: 'low' }];
  assert.ok(toCSV(rows).includes('id,title'));
  const parsed = JSON.parse(toJSON([{ id: 0, ok: false, note: '' }]));
  assert.equal(parsed[0].id, 0); assert.equal(parsed[0].ok, false); assert.equal(parsed[0].note, '');
});
test('AI fallback is labelled deterministic with preserved zero sections', () => {
  const out = runAiFeature(AI_FEATURES[0], [], {});
  assert.equal(out.aiGenerated, false);
  assert.equal(out.provider, 'deterministic-fallback');
  assert.equal(out.sections.find((x) => x.label === 'Record count').value, 0);
  assert.equal(out.sections.find((x) => x.label === 'Has records').value, false);
  assert.equal(runAiFeature('nope', [], {}), null);
});
test('feature-pack route is mounted', () => {
  assert.ok(fs.readFileSync(__dirname + '/../server.js', 'utf8').includes('/api/feature-pack'));
});
