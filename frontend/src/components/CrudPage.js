import React, { useState, useEffect } from 'react';
import API from '../services/api';
import DataTable from './DataTable';
import Modal from './Modal';
import AIResultDisplay from './AIResultDisplay';
import { toast } from 'react-toastify';

export default function CrudPage({ title, apiPath, columns, formFields, detailFields, defaultFormData, aiConfig, renderBadge }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState(defaultFormData || {});
  const [editing, setEditing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiModel, setAiModel] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  useEffect(() => { fetchData(); }, [page]);

  const fetchData = async () => {
    try {
      const { data } = await API.get(`${apiPath}?page=${page}&limit=20`);
      if (Array.isArray(data)) {
        setItems(data);
      } else {
        setItems(data.data || []);
        setPagination(data.pagination || { total: 0, totalPages: 1 });
      }
    } catch (e) { toast.error(`Failed to load data`); }
  };

  const handleSave = async () => {
    try {
      if (editing) { await API.put(`${apiPath}/${formData.id}`, formData); toast.success('Updated successfully'); }
      else { await API.post(apiPath, formData); toast.success('Created successfully'); }
      setShowModal(false); setFormData(defaultFormData || {}); setEditing(false); fetchData();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this record?')) return;
    try { await API.delete(`${apiPath}/${id}`); toast.success('Deleted successfully'); setSelected(null); fetchData(); } catch (e) { toast.error('Delete failed'); }
  };

  const handleAI = async () => {
    if (!aiConfig) return;
    setAiLoading(true); setAiResult(null);
    try {
      const payload = aiConfig.getPayload(selected || formData, items);
      const { data } = await API.post(aiConfig.endpoint, payload);
      setAiResult(data.analysis); setAiModel(data.model);
    } catch (e) { toast.error('AI analysis failed'); }
    setAiLoading(false);
  };

  const openEdit = (item) => { setFormData({ ...item }); setEditing(true); setShowModal(true); setAiResult(null); };
  const openNew = () => { setFormData(defaultFormData || {}); setEditing(false); setShowModal(true); setAiResult(null); };

  const updateField = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  const renderFormField = (field) => {
    const val = formData[field.key] || '';
    if (field.type === 'select') {
      return (
        <div className="form-group" key={field.key}>
          <label>{field.label}</label>
          <select value={val} onChange={e => updateField(field.key, e.target.value)}>
            <option value="">Select...</option>
            {field.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    }
    if (field.type === 'textarea') {
      return (
        <div className="form-group" key={field.key}>
          <label>{field.label}</label>
          <textarea value={val} onChange={e => updateField(field.key, e.target.value)} />
        </div>
      );
    }
    return (
      <div className="form-group" key={field.key}>
        <label>{field.label}</label>
        <input type={field.type || 'text'} value={val} onChange={e => updateField(field.key, e.target.value)} />
      </div>
    );
  };

  if (selected) {
    return (
      <div>
        <div className="page-header">
          <h1>{title} - Details</h1>
          <div className="header-actions">
            <button className="btn-back" onClick={() => { setSelected(null); setAiResult(null); }}>Back to List</button>
            {aiConfig && <button className="btn-ai" onClick={handleAI}>🤖 AI Analyze</button>}
            <button className="btn-primary" onClick={() => openEdit(selected)}>Edit</button>
            <button className="btn-danger" onClick={() => handleDelete(selected.id)}>Delete</button>
          </div>
        </div>
        <div className="detail-panel">
          <div className="detail-header">
            <h2>Record #{selected.id}</h2>
            {selected.Patient && <span style={{ color: '#818cf8' }}>{selected.Patient.firstName} {selected.Patient.lastName}</span>}
          </div>
          <div className="detail-grid">
            {(detailFields || formFields).map(f => (
              <div className="detail-field" key={f.key}>
                <label>{f.label}</label>
                <span>{renderBadge && f.badge ? renderBadge(selected[f.key]) : (selected[f.key] || '-')}</span>
              </div>
            ))}
          </div>
        </div>
        <AIResultDisplay result={aiResult} loading={aiLoading} model={aiModel} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1>{title}</h1>
        <button className="btn-primary" onClick={openNew}>+ New Record</button>
      </div>
      <DataTable columns={columns} data={items} onRowClick={setSelected} />

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
          <button className="btn-secondary" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
          <span style={{ padding: '8px 16px', color: '#94a3b8', alignSelf: 'center' }}>Page {page} of {pagination.totalPages}</span>
          <button className="btn-secondary" onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}>Next</button>
        </div>
      )}

      {showModal && (
        <Modal title={editing ? `Edit ${title}` : `New ${title}`} onClose={() => setShowModal(false)}>
          {formFields.filter(f => !f.hideInForm).map(f => renderFormField(f))}
          {aiConfig && (
            <div style={{ marginTop: '12px' }}>
              <button className="btn-ai" onClick={handleAI} disabled={aiLoading}>
                🤖 {aiLoading ? 'Analyzing...' : aiConfig.buttonLabel || 'AI Analyze'}
              </button>
              <AIResultDisplay result={aiResult} loading={aiLoading} model={aiModel} />
            </div>
          )}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>{editing ? 'Update' : 'Create'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
