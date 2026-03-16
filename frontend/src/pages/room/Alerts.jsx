import React, { useState, useEffect } from 'react';
import * as roomApi from '../../roomApi';
import './Reporters.css';

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const activity = await roomApi.getActivity(100);
        const breaking = activity.filter((a) => a.type === 'breaking_news');
        if (!cancelled) {
          setAlerts(breaking);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (loading && alerts.length === 0) return <div className="page-loading">Loading…</div>;
  if (error && alerts.length === 0) return <div className="page-error">{error}</div>;

  return (
    <div className="reporters-page">
      <h1>Breaking news alerts</h1>
      {alerts.length === 0 ? (
        <p className="muted">No alerts yet. When reporters send breaking news or scripts from the portal, they will appear here.</p>
      ) : (
        <table className="reporters-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Reporter</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.created_at).toLocaleString()}</td>
                <td>{a.reporter_name || 'Reporter'}</td>
                <td>{a.message || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

