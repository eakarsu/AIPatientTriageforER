import React, { useState } from 'react';
import API from '../services/api';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await API.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
    setLoading(false);
  };

  const autofill = (role) => {
    const creds = {
      admin: { email: 'admin@ertriage.com', password: 'password123' },
      doctor: { email: 'doctor@ertriage.com', password: 'password123' },
      nurse: { email: 'nurse@ertriage.com', password: 'password123' },
      reception: { email: 'reception@ertriage.com', password: 'password123' }
    };
    setEmail(creds[role].email);
    setPassword(creds[role].password);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <h1>ER Triage AI</h1>
          <p>AI-Powered Emergency Department Management</p>
        </div>
        {error && <div className="login-error">{error}</div>}
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email Address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Enter your email" required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required />
          </div>
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '16px' }}>
          <button className="autofill-btn" onClick={() => autofill('admin')}>Admin Login</button>
          <button className="autofill-btn" onClick={() => autofill('doctor')}>Doctor Login</button>
          <button className="autofill-btn" onClick={() => autofill('nurse')}>Nurse Login</button>
          <button className="autofill-btn" onClick={() => autofill('reception')}>Reception Login</button>
        </div>
      </div>
    </div>
  );
}
