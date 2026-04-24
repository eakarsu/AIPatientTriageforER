import React, { useState, useEffect } from 'react';
import API from '../services/api';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import { toast } from 'react-toastify';

export default function PatientsPage() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({});
  const [editing, setEditing] = useState(false);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try { const { data } = await API.get('/patients'); setItems(data); } catch (e) { toast.error('Failed to load patients'); }
  };

  const handleSave = async () => {
    try {
      if (editing) { await API.put(`/patients/${formData.id}`, formData); toast.success('Patient updated'); }
      else { await API.post('/patients', formData); toast.success('Patient registered'); }
      setShowModal(false); setFormData({}); setEditing(false); fetchData();
    } catch (e) { toast.error(e.response?.data?.error || 'Save failed'); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this patient?')) return;
    try { await API.delete(`/patients/${id}`); toast.success('Patient deleted'); setSelected(null); fetchData(); } catch (e) { toast.error('Delete failed'); }
  };

  const openEdit = (item) => { setFormData(item); setEditing(true); setShowModal(true); };
  const openNew = () => { setFormData({ gender: 'Male', status: 'Registered' }); setEditing(false); setShowModal(true); };

  const statusBadge = (s) => {
    const map = { 'Registered': 'badge-info', 'In Triage': 'badge-warning', 'Waiting': 'badge-default', 'In Treatment': 'badge-critical', 'Discharged': 'badge-success' };
    return <span className={`badge ${map[s] || 'badge-default'}`}>{s}</span>;
  };

  const columns = [
    { header: 'ID', render: r => `#${r.id}` },
    { header: 'Name', render: r => `${r.firstName} ${r.lastName}` },
    { header: 'DOB', key: 'dateOfBirth' },
    { header: 'Gender', key: 'gender' },
    { header: 'Phone', key: 'phone' },
    { header: 'Insurance', key: 'insuranceProvider' },
    { header: 'Status', render: r => statusBadge(r.status) }
  ];

  if (selected) return (
    <div>
      <div className="page-header">
        <h1>Patient Details</h1>
        <div className="header-actions">
          <button className="btn-back" onClick={() => setSelected(null)}>Back to List</button>
          <button className="btn-primary" onClick={() => openEdit(selected)}>Edit</button>
          <button className="btn-danger" onClick={() => handleDelete(selected.id)}>Delete</button>
        </div>
      </div>
      <div className="detail-panel">
        <div className="detail-header"><h2>{selected.firstName} {selected.lastName}</h2>{statusBadge(selected.status)}</div>
        <div className="detail-grid">
          <div className="detail-field"><label>Date of Birth</label><span>{selected.dateOfBirth}</span></div>
          <div className="detail-field"><label>Gender</label><span>{selected.gender}</span></div>
          <div className="detail-field"><label>Phone</label><span>{selected.phone}</span></div>
          <div className="detail-field"><label>Email</label><span>{selected.email}</span></div>
          <div className="detail-field"><label>Address</label><span>{selected.address}</span></div>
          <div className="detail-field"><label>Blood Type</label><span>{selected.bloodType}</span></div>
          <div className="detail-field"><label>Insurance</label><span>{selected.insuranceProvider} - {selected.insuranceNumber}</span></div>
          <div className="detail-field"><label>Allergies</label><span style={{ color: selected.allergies !== 'None' ? '#f87171' : '#4ade80' }}>{selected.allergies || 'None'}</span></div>
          <div className="detail-field"><label>Emergency Contact</label><span>{selected.emergencyContact} ({selected.emergencyPhone})</span></div>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h1>Patient Registration & Intake</h1>
        <button className="btn-primary" onClick={openNew}>+ New Patient</button>
      </div>
      <DataTable columns={columns} data={items} onRowClick={setSelected} />
      {showModal && (
        <Modal title={editing ? 'Edit Patient' : 'Register New Patient'} onClose={() => setShowModal(false)}>
          <div className="form-row">
            <div className="form-group"><label>First Name</label><input value={formData.firstName || ''} onChange={e => setFormData({...formData, firstName: e.target.value})} /></div>
            <div className="form-group"><label>Last Name</label><input value={formData.lastName || ''} onChange={e => setFormData({...formData, lastName: e.target.value})} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Date of Birth</label><input type="date" value={formData.dateOfBirth || ''} onChange={e => setFormData({...formData, dateOfBirth: e.target.value})} /></div>
            <div className="form-group"><label>Gender</label><select value={formData.gender || ''} onChange={e => setFormData({...formData, gender: e.target.value})}><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Phone</label><input value={formData.phone || ''} onChange={e => setFormData({...formData, phone: e.target.value})} /></div>
            <div className="form-group"><label>Email</label><input value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} /></div>
          </div>
          <div className="form-group"><label>Address</label><input value={formData.address || ''} onChange={e => setFormData({...formData, address: e.target.value})} /></div>
          <div className="form-row">
            <div className="form-group"><label>Insurance Provider</label><input value={formData.insuranceProvider || ''} onChange={e => setFormData({...formData, insuranceProvider: e.target.value})} /></div>
            <div className="form-group"><label>Insurance Number</label><input value={formData.insuranceNumber || ''} onChange={e => setFormData({...formData, insuranceNumber: e.target.value})} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Blood Type</label><input value={formData.bloodType || ''} onChange={e => setFormData({...formData, bloodType: e.target.value})} /></div>
            <div className="form-group"><label>Allergies</label><input value={formData.allergies || ''} onChange={e => setFormData({...formData, allergies: e.target.value})} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Emergency Contact</label><input value={formData.emergencyContact || ''} onChange={e => setFormData({...formData, emergencyContact: e.target.value})} /></div>
            <div className="form-group"><label>Emergency Phone</label><input value={formData.emergencyPhone || ''} onChange={e => setFormData({...formData, emergencyPhone: e.target.value})} /></div>
          </div>
          <div className="form-group"><label>Status</label><select value={formData.status || 'Registered'} onChange={e => setFormData({...formData, status: e.target.value})}><option>Registered</option><option>In Triage</option><option>Waiting</option><option>In Treatment</option><option>Discharged</option></select></div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>{editing ? 'Update' : 'Register'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
