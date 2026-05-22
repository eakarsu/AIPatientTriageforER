import React, { useState, useEffect, useCallback } from 'react';
import API from '../services/api';
import DataTable from './DataTable';
import Modal from './Modal';
import { toast } from 'react-toastify';

// ─── AI Verbs Panel ──────────────────────────────────────────────────────────
function AiVerbsPanel({ module, recordId, idField }) {
  const [activeVerb, setActiveVerb] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [verbs] = useState(module.aiVerbs);

  const runVerb = async (verb) => {
    setLoading(true);
    setResult(null);
    try {
      const body = { [idField]: recordId };
      if (prompt.trim()) body.extraContext = prompt.trim();
      const { data } = await API.post(`/ehr/${module.slug}/ai/${verb}`, body);
      setResult(data);
    } catch (e) {
      toast.error(e.response?.data?.error || `AI verb "${verb}" failed`);
      setResult({ error: e.response?.data?.error || 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const handleVerbClick = (verb) => {
    setActiveVerb(verb);
    setPrompt('');
    setResult(null);
  };

  return (
    <div style={{ marginTop: 24, background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.18)', borderRadius: 16, padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(6,182,212,0.15)' }}>
        <span style={{ fontSize: 22 }}>🤖</span>
        <h3 style={{ fontSize: 16, fontWeight: 700, background: 'linear-gradient(135deg,#06b6d4,#6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          AI Verbs Panel
        </h3>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: activeVerb ? 16 : 0 }}>
        {verbs.map(verb => (
          <button
            key={verb}
            onClick={() => handleVerbClick(verb)}
            className={activeVerb === verb ? 'btn-ai' : 'btn-secondary'}
            style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
          >
            {verb}
          </button>
        ))}
      </div>

      {activeVerb && (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
              Running: <strong style={{ color: '#06b6d4' }}>{activeVerb}</strong> — optional extra context:
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Optional additional context for the AI..."
              style={{ width: '100%', padding: '8px 12px', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 60 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-ai"
              onClick={() => runVerb(activeVerb)}
              disabled={loading}
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Running...' : `Run ${activeVerb}`}
            </button>
            <button className="btn-secondary" onClick={() => { setActiveVerb(null); setResult(null); }}>
              Cancel
            </button>
          </div>

          {loading && (
            <div className="ai-loading" style={{ marginTop: 12 }}>
              <div className="spinner" />
              <span>AI is processing...</span>
            </div>
          )}

          {result && !loading && (
            <div className="ai-result" style={{ marginTop: 16 }}>
              <div className="ai-result-header">
                <span className="ai-icon">✨</span>
                <h3>{activeVerb}</h3>
                {result.model && <span className="ai-model">{result.model}</span>}
              </div>
              <div className="ai-result-body">
                {result.error ? (
                  <span style={{ color: '#f87171' }}>{result.error}</span>
                ) : (
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7 }}>
                    {JSON.stringify(result.result || result, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EhrModule: generic list + detail + create/edit ─────────────────────────
export default function EhrModule({ module }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({});
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTimeout, setSearchTimeout] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      let url = `/ehr/${module.slug}?page=${page}&limit=20`;
      if (statusFilter) url += `&status=${encodeURIComponent(statusFilter)}`;
      const { data } = await API.get(url);
      if (Array.isArray(data)) {
        setItems(data);
      } else {
        setItems(data.data || []);
        setPagination(data.pagination || { total: 0, totalPages: 1 });
      }
    } catch (e) {
      toast.error(`Failed to load ${module.label}`);
    }
  }, [module.slug, module.label, page, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (val) => {
    setSearch(val);
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!val.trim()) { fetchData(); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await API.get(`/ehr/${module.slug}/search?q=${encodeURIComponent(val)}&page=1&limit=20`);
        setItems(Array.isArray(data) ? data : (data.data || []));
        setPagination(data.pagination || { total: 0, totalPages: 1 });
      } catch { fetchData(); }
    }, 350);
    setSearchTimeout(t);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        await API.put(`/ehr/${module.slug}/${formData.id}`, formData);
        toast.success(`${module.labelSingular} updated`);
      } else {
        await API.post(`/ehr/${module.slug}`, formData);
        toast.success(`${module.labelSingular} created`);
      }
      setShowModal(false);
      setFormData({});
      setEditing(false);
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Save failed');
    }
  };

  const handleArchive = async (id) => {
    if (!window.confirm(`Archive this ${module.labelSingular}?`)) return;
    try {
      await API.post(`/ehr/${module.slug}/${id}/archive`);
      toast.success('Archived');
      setSelected(null);
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Archive failed');
    }
  };

  const openEdit = (item) => { setFormData({ ...item }); setEditing(true); setShowModal(true); };
  const openNew = () => { setFormData(module.defaultValues || {}); setEditing(false); setShowModal(true); };

  // ── Detail view ────────────────────────────────────────────────────────────
  if (selected) return (
    <div>
      <div className="page-header">
        <h1>{module.labelSingular} Details</h1>
        <div className="header-actions">
          <button className="btn-back" onClick={() => setSelected(null)}>Back to List</button>
          <button className="btn-primary" onClick={() => openEdit(selected)}>Edit</button>
          <button className="btn-danger" onClick={() => handleArchive(selected.id)}>Archive</button>
        </div>
      </div>
      <div className="detail-panel">
        <div className="detail-header">
          <h2>{module.titleFn ? module.titleFn(selected) : `#${selected.id}`}</h2>
          {selected.status && (
            <span className={`badge ${module.statusBadge ? module.statusBadge(selected.status) : 'badge-default'}`}>
              {selected.status}
            </span>
          )}
        </div>
        <div className="detail-grid">
          {module.detailFields.map(f => (
            <div className="detail-field" key={f.key}>
              <label>{f.label}</label>
              <span>{f.render ? f.render(selected) : (selected[f.key] ?? '—')}</span>
            </div>
          ))}
        </div>
        <AiVerbsPanel module={module} recordId={selected.id} idField={module.idField || 'id'} />
      </div>

      {showModal && (
        <Modal title={`Edit ${module.labelSingular}`} onClose={() => setShowModal(false)}>
          {module.formFields.map(field => renderFormField(field, formData, setFormData))}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Update</button>
          </div>
        </Modal>
      )}
    </div>
  );

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <h1>{module.label}</h1>
        <button className="btn-primary" onClick={openNew}>+ New {module.labelSingular}</button>
      </div>

      {/* Search + filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input
          placeholder={`Search ${module.label.toLowerCase()}...`}
          value={search}
          onChange={e => handleSearch(e.target.value)}
          style={{ flex: 1, padding: '10px 14px', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, color: '#e2e8f0', fontSize: 13 }}
        />
        {module.statusOptions && (
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            style={{ padding: '10px 14px', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, color: '#e2e8f0', fontSize: 13, minWidth: 140 }}
          >
            <option value="">All Statuses</option>
            {module.statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      <DataTable columns={module.columns} data={items} onRowClick={setSelected} />

      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
          <span style={{ padding: '8px 16px', color: '#94a3b8', alignSelf: 'center' }}>
            Page {page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <button className="btn-secondary" onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}>Next</button>
        </div>
      )}

      {showModal && (
        <Modal title={editing ? `Edit ${module.labelSingular}` : `New ${module.labelSingular}`} onClose={() => setShowModal(false)}>
          {module.formFields.map(field => renderFormField(field, formData, setFormData))}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>{editing ? 'Update' : 'Create'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Form field renderer ─────────────────────────────────────────────────────
function renderFormField(field, formData, setFormData) {
  const val = formData[field.key] ?? '';
  const update = v => setFormData(prev => ({ ...prev, [field.key]: v }));

  if (field.type === 'row') {
    return (
      <div className="form-row" key={field.key}>
        {field.fields.map(f => renderFormField(f, formData, setFormData))}
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <div className="form-group" key={field.key}>
        <label>{field.label}</label>
        <select value={val} onChange={e => update(e.target.value)}>
          <option value="">— select —</option>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (field.type === 'textarea') {
    return (
      <div className="form-group" key={field.key}>
        <label>{field.label}</label>
        <textarea value={val} onChange={e => update(e.target.value)} placeholder={field.placeholder || ''} />
      </div>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <div className="form-group" key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={!!formData[field.key]} onChange={e => update(e.target.checked)} style={{ width: 'auto' }} />
        <label style={{ margin: 0, cursor: 'pointer' }}>{field.label}</label>
      </div>
    );
  }
  return (
    <div className="form-group" key={field.key}>
      <label>{field.label}</label>
      <input
        type={field.type || 'text'}
        value={val}
        onChange={e => update(e.target.value)}
        placeholder={field.placeholder || ''}
      />
    </div>
  );
}
