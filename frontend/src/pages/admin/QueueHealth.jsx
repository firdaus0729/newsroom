import React, { useEffect, useState } from 'react';
import * as adminApi from '../../adminApi';

export default function QueueHealth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const d = await adminApi.getQueueHealth();
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load queue health');
      }
    }

    load();
    const t = setInterval(load, 7000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error) return <div className="page-error">{error}</div>;
  if (!data) return <div className="page-loading">Loading queue health…</div>;

  return (
    <div>
      <h1>Queue Health</h1>
      <p className="muted">Worker interval: {data.worker_interval_ms}ms</p>

      <h3>Automation Events</h3>
      <ul>
        {data.events.map((e) => (
          <li key={e.status}>
            {e.status}: {e.count}
          </li>
        ))}
      </ul>

      <h3>Processing Jobs</h3>
      <ul>
        {data.jobs.map((j) => (
          <li key={j.status}>
            {j.status}: {j.count}
          </li>
        ))}
      </ul>
    </div>
  );
}

