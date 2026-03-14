import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import * as roomApi from '../../roomApi';
import './Login.css';

export default function RoomLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (roomApi.getToken()) return <Navigate to="/room" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, editor, role } = await roomApi.login(email.trim(), password);
      roomApi.setToken(token, role || 'editor');
      navigate('/room', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page room-login-page">
      <div className="login-card">
        <h1>Newsroom Dashboard</h1>
        <p className="login-sub">Editor login</p>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="room-email">Email</label>
          <input id="room-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label htmlFor="room-password">Password</label>
          <input id="room-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
