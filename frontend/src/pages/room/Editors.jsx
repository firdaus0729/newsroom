import React, { useState } from 'react';
import * as roomApi from '../../roomApi';
import './Editors.css';

export default function Editors() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await roomApi.createEditor(email.trim(), password, name.trim());
      setSuccess(`Editor "${name.trim()}" created. They can log in with the email and password you set.`);
      setEmail('');
      setPassword('');
      setName('');
    } catch (err) {
      setError(err.message || 'Failed to create editor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="editors-page">
      <h1>Add editor</h1>
      <p className="editors-intro">Create a new editor account. They can then log in to the Newsroom Dashboard with the email and password you set.</p>
      <form onSubmit={handleSubmit} className="editors-form">
        <label htmlFor="ed-name">Name</label>
        <input
          id="ed-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jane Smith"
          required
        />
        <label htmlFor="ed-email">Email</label>
        <input
          id="ed-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. jane@newsroom.local"
          required
        />
        <label htmlFor="ed-password">Password</label>
        <input
          id="ed-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          required
          minLength={6}
        />
        {error && <p className="editors-error">{error}</p>}
        {success && <p className="editors-success">{success}</p>}
        <button type="submit" className="btn-submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create editor'}
        </button>
      </form>
    </div>
  );
}
