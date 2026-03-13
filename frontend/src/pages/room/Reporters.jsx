import React, { useState, useEffect, useRef } from 'react';
import * as roomApi from '../../roomApi';
import { useWebRTCPlayer } from '../../hooks/useWebRTCPlayer';
import './Reporters.css';

function getOmeWsUrl() {
  const envUrl = import.meta.env.VITE_OME_WS_URL;
  if (envUrl) {
    let base = envUrl.trim();
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && base.startsWith('ws://')) {
      base = 'wss://' + base.slice(5);
    }
    if (base.startsWith('http://') || base.startsWith('https://')) {
      base = base.replace(/^http/, 'ws');
    }
    return base;
  }
  if (typeof window === 'undefined') return 'ws://localhost:3333';
  const { protocol, hostname } = window.location;
  if (protocol === 'https:') return `${protocol}//${hostname}/ome-ws`;
  return `ws://${hostname}:3333`;
}
const OME_WS = getOmeWsUrl();

function formatDuration(startedAt) {
  if (!startedAt) return '—';
  const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${(m % 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function Reporters() {
  const [reporters, setReporters] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewStream, setPreviewStream] = useState(null);
  const previewVideoRef = useRef(null);
  const { status: playerStatus, errorMessage: playerError, play: playPreview, stop: stopPreview } = useWebRTCPlayer(previewVideoRef);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [r, a] = await Promise.all([roomApi.getReporters(), roomApi.getActivity(30)]);
        if (!cancelled) {
          setReporters(r);
          setActivity(a);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  function handleViewStream(webrtcUrl, streamName) {
    stopPreview();
    setPreviewStream(streamName);
    const base = webrtcUrl?.replace(/\/live\/.*$/, '') || OME_WS.replace(/\/+$/, '');
    playPreview(base, streamName);
  }

  function handleCopyRtmp(rtmpUrl) {
    navigator.clipboard.writeText(rtmpUrl || '').then(() => alert('RTMP URL copied')).catch(() => {});
  }

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error) return <div className="page-error">{error}</div>;

  return (
    <div className="reporters-page">
      <h1>Reporters</h1>
      <div className="reporters-grid">
        <div className="reporters-list-panel">
          <table className="reporters-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Quality</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reporters.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <span className={`status-dot status-${r.status}`} />
                    {r.status === 'live' ? 'Live' : 'Offline'}
                  </td>
                  <td>{r.status === 'live' ? formatDuration(r.started_at) : '—'}</td>
                  <td>{r.status === 'live' ? '—' : '—'}</td>
                  <td>
                    {r.status === 'live' && (
                      <>
                        <button type="button" className="btn-sm" onClick={() => handleViewStream(r.webrtc_url, r.stream_name)}>View Stream</button>
                        <button type="button" className="btn-sm" onClick={() => handleCopyRtmp(r.rtmp_url)}>Copy RTMP URL</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="preview-panel">
          <h3>Live Preview</h3>
          {previewStream ? (
            <div className="preview-wrap">
              <video ref={previewVideoRef} className="preview-video" autoPlay playsInline muted={false} />
              {playerStatus === 'connecting' && <div className="preview-placeholder">Connecting…</div>}
              {playerStatus === 'error' && <div className="preview-placeholder preview-error">{playerError}</div>}
              <button type="button" className="btn-sm btn-close-preview" onClick={() => { stopPreview(); setPreviewStream(null); }}>Close</button>
            </div>
          ) : (
            <p className="muted">Select a live reporter and click View Stream.</p>
          )}
        </div>
        <div className="activity-panel">
          <h3>Activity Feed</h3>
          <ul className="activity-list">
            {activity.map((a) => (
              <li key={a.id}>
                <span className="activity-time">{new Date(a.created_at).toLocaleTimeString()}</span>
                {a.type === 'went_live' && <span>{a.reporter_name || 'Reporter'} went live</span>}
                {a.type === 'stopped_stream' && <span>{a.reporter_name || 'Reporter'} stopped stream</span>}
                {a.type === 'uploaded_clip' && <span>{a.reporter_name || 'Reporter'} uploaded a clip</span>}
                {a.type === 'breaking_news' && (
                  <span className="activity-breaking">
                    Breaking: {a.message || 'Alert'} {a.reporter_name ? `— ${a.reporter_name}` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
