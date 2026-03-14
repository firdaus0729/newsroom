import React, { useState, useEffect } from 'react';
import * as adminApi from '../../adminApi';
import '../../pages/room/Reporters.css';
import '../../pages/room/Editors.css';

export default function AdminReporters() {
  const [reporters, setReporters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = React.useCallback(async () => {
    try {
      const list = await adminApi.getAdminReporters();
      setReporters(list);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddReporter(e) {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    setSubmitting(true);
    try {
      await adminApi.createReporter(email.trim(), password, name.trim());
      setAddSuccess(`Reporter "${name.trim()}" created. They can log in at the reporter portal.`);
      setName('');
      setEmail('');
      setPassword('');
      load();
    } catch (err) {
      setAddError(err.message || 'Failed to create reporter');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error) return <div className="page-error">{error}</div>;

  return (
    <div className="reporters-page">
      <h1>Reporters</h1>
      <p className="muted">Add reporters who can log in and go live from the reporter portal.</p>

      <div className="editors-page" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Add reporter</h2>
        <form onSubmit={handleAddReporter} className="editors-form">
          <label htmlFor="rep-name">Name</label>
          <input id="rep-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Doe" required />
          <label htmlFor="rep-email">Email</label>
          <input id="rep-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. jane@newsroom.local" required />
          <label htmlFor="rep-password">Password</label>
          <input id="rep-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6} />
          {addError && <p className="editors-error">{addError}</p>}
          {addSuccess && <p className="editors-success">{addSuccess}</p>}
          <button type="submit" className="btn-submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create reporter'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>All reporters ({reporters.length})</h2>
        {reporters.length === 0 ? (
          <p className="muted">No reporters yet. Add one above.</p>
        ) : (
          <table className="reporters-table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reporters.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
