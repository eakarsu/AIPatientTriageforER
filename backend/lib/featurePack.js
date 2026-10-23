'use strict';
// Deterministic feature-pack logic: no DB, no network. Provider use lives in the router and only when a key is set.
const DISCLAIMER = 'Operational support only - not a diagnosis or triage decision. Clinical decisions remain with qualified ER staff.';
const AI_FEATURES = ['er-queue-load','wait-bottleneck-summary','handoff-checklist'];

function hasProviderKey(env) {
  const e = env || {};
  const k = e.OPENROUTER_API_KEY || e.OPENAI_API_KEY || '';
  return Boolean(k && k !== 'your_openrouter_key_here' && k !== 'your_openai_key_here');
}
function filterRecords(records, opts) {
  const o = opts || {};
  const q = String(o.q || '').toLowerCase();
  return (records || []).filter((r) => {
    if (o.status && String(r.status || '') !== String(o.status)) return false;
    if (o.priority && String(r.priority || '') !== String(o.priority)) return false;
    if (!q) return true;
    return [r.title, r.description, r.status, r.priority].some((v) => String(v == null ? '' : v).toLowerCase().includes(q));
  });
}
function toCSV(records) {
  const cols = ['id','title','description','status','priority','createdAt','updatedAt'];
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(',')].concat((records || []).map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n');
}
function toJSON(records) { return JSON.stringify(records || [], null, 2); }

class TaskStore {
  constructor() { this.items = []; this.nextId = 1; }
  create(input) {
    const t = { id: this.nextId++, title: String((input && input.title) || ''), description: String((input && input.description) || ''), status: String((input && input.status) || 'open'), priority: String((input && input.priority) || 'normal'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (!t.title) throw new Error('title is required');
    this.items.push(t); return t;
  }
  list(opts) { return filterRecords(this.items, opts); }
  update(id, patch) {
    const t = this.items.find((x) => x.id === Number(id));
    if (!t) return null;
    for (const k of ['title','description','status','priority']) if (patch && patch[k] !== undefined) t[k] = String(patch[k]);
    t.updatedAt = new Date().toISOString(); return t;
  }
}
function runAiFeature(name, records, env) {
  if (!AI_FEATURES.includes(name)) return null;
  const recs = records || [];
  const open = recs.filter((r) => r.status !== 'done').length;
  const high = recs.filter((r) => r.priority === 'high').length;
  const sections = [
    { label: 'Record count', value: recs.length },
    { label: 'Open items', value: open },
    { label: 'High-priority items', value: high },
    { label: 'Completion rate', value: recs.length === 0 ? 0 : Math.round(((recs.length - open) / recs.length) * 100) },
    { label: 'Has records', value: recs.length > 0 },
    { label: 'Note', value: '' },
  ];
  const out = { feature: name, aiGenerated: false, provider: hasProviderKey(env) ? 'provider-configured' : 'deterministic-fallback', sections, summary: open + ' open item(s), ' + high + ' high-priority, across ' + recs.length + ' record(s).' };
  if (DISCLAIMER) out.disclaimer = DISCLAIMER;
  return out;
}
module.exports = { AI_FEATURES, DISCLAIMER, TaskStore, filterRecords, toCSV, toJSON, runAiFeature, hasProviderKey };
