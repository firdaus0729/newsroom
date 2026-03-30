import React, { useEffect, useState } from 'react';
import * as roomApi from '../../roomApi';

export default function QueueHealth() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const role = roomApi.getRole();

  useEffect(() => {
    let stop = false;
    async function load() {
      if (role !== 'admin') return;
      try {
        const d = await roomApi.getQueueHealth();
        if (!stop) setData(d);
      } catch (e) {
        if (!stop) setError(e.message);
      }
    }
    load();
    const t = setInterval(load, 7000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [role]);

  if (role !== 'admin') return <div className="page-error">Only admin can view queue health.</div>;
  if (error) return <div className="page-error">{error}</div>;
  if (!data) return <div className="page-loading">Loading queue health…</div>;

  return (
    <div>
      <h1>Queue Health</h1>
      <p>Worker interval: {data.worker_interval_ms}ms</p>
      <h3>Automation Events</h3>
      <ul>
        {data.events.map((e) => (
          <li key={e.status}>{e.status}: {e.count}</li>
        ))}
      </ul>
      <h3>Processing Jobs</h3>
      <ul>
        {data.jobs.map((j) => (
          <li key={j.status}>{j.status}: {j.count}</li>
        ))}
      </ul>
    </div>
  );
}
