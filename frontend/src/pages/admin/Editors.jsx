import React, { useState, useEffect } from 'react';
import * as adminApi from '../../adminApi';
import '../../pages/room/Reporters.css';
import '../../pages/room/Editors.css';

export default function AdminEditors() {
  const [editors, setEditors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = React.useCallback(async () => {
    try {
      const list = await adminApi.getEditors();
      setEditors(list);
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

  async function handleAddEditor(e) {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    setSubmitting(true);
    try {
      await adminApi.createEditor(email.trim(), password, name.trim());
      setAddSuccess(`Editor "${name.trim()}" created. They can log in to the Newsroom Dashboard.`);
      setName('');
      setEmail('');
      setPassword('');
      load();
    } catch (err) {
      setAddError(err.message || 'Failed to create editor');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteEditor(id) {
    if (!window.confirm('Remove this editor?')) return;
    setDeletingId(id);
    try {
      await adminApi.deleteEditor(id);
      load();
    } catch (e) {
      alert(e.message || 'Failed to delete editor');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error) return <div className="page-error">{error}</div>;

  return (
    <div className="reporters-page">
      <h1>Editors</h1>
      <p className="muted">Manage editors who can access the Newsroom Dashboard.</p>

      <div className="editors-page" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Add editor</h2>
        <form onSubmit={handleAddEditor} className="editors-form">
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
          {addError && <p className="editors-error">{addError}</p>}
          {addSuccess && <p className="editors-success">{addSuccess}</p>}
          <button type="submit" className="btn-submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create editor'}
          </button>
        </form>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>All editors ({editors.length})</h2>
        {editors.length === 0 ? (
          <p className="muted">No editors yet. Add one above.</p>
        ) : (
          <table className="reporters-table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {editors.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{e.email}</td>
                  <td>{e.created_at ? new Date(e.created_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-sm btn-delete"
                      onClick={() => handleDeleteEditor(e.id)}
                      disabled={deletingId === e.id}
                    >
                      {deletingId === e.id ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

