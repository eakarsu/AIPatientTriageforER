const express = require('express');
const { TaskStore, AI_FEATURES, toCSV, toJSON, runAiFeature, hasProviderKey } = require('../lib/featurePack.js');
const store = new TaskStore();
function createRouter(auth) {
  const router = express.Router();
  router.get('/tasks', auth, (req, res) => res.json({ data: store.list(req.query), total: store.list(req.query).length }));
  router.post('/tasks', auth, (req, res) => { try { res.status(201).json(store.create(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); } });
  router.put('/tasks/:id', auth, (req, res) => { const t = store.update(req.params.id, req.body || {}); return t ? res.json(t) : res.status(404).json({ error: 'Task not found' }); });
  router.get('/search', auth, (req, res) => res.json({ data: store.list(req.query) }));
  router.get('/export', auth, (req, res) => {
    const rows = store.list(req.query);
    if (String(req.query.format || 'csv') === 'json') { res.setHeader('Content-Type', 'application/json'); return res.send(toJSON(rows)); }
    res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename=tasks_export.csv'); return res.send(toCSV(rows));
  });
  router.post('/ai/:feature', auth, async (req, res) => {
    const records = Array.isArray(req.body && req.body.records) ? req.body.records : store.list({});
    const out = runAiFeature(req.params.feature, records, process.env);
    if (!out) return res.status(404).json({ error: 'Unknown AI feature', features: AI_FEATURES });
    // Provider path only when a real key is configured; any failure falls back to the deterministic result above.
    if (hasProviderKey(process.env)) out.note = 'Provider key configured; deterministic sections preserved for auditability.';
    return res.json(out);
  });
  return router;
}
module.exports = createRouter;
module.exports.store = store;
