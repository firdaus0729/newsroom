import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import * as adminApi from '../../adminApi';
import '../../pages/room/Login.css';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (adminApi.getAdminToken()) return <Navigate to="/admin" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, admin } = await adminApi.adminLogin(email.trim(), password);
      adminApi.setAdminToken(token);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page room-login-page">
      <div className="login-card">
        <h1>Administrator</h1>
        <p className="login-sub">Admin login</p>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="admin-email">Email</label>
          <input id="admin-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label htmlFor="admin-password">Password</label>
          <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
