import React, { useState, useEffect } from 'react';
import * as roomApi from '../../roomApi';
import './Uploads.css';

export default function Uploads() {
  const [uploads, setUploads] = useState([]);
  const [reporters, setReporters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterReporter, setFilterReporter] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [downloading, setDownloading] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadReporters() {
      try {
        const r = await roomApi.getReporters();
        if (!cancelled) setReporters(r);
      } catch (_) {}
    }
    loadReporters();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const params = {};
        if (filterReporter) params.reporter_id = filterReporter;
        if (filterFrom) params.from_date = filterFrom;
        if (filterTo) params.to_date = filterTo;
        const u = await roomApi.getUploads(params);
        if (!cancelled) setUploads(u);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    load();
    return () => { cancelled = true; };
  }, [filterReporter, filterFrom, filterTo]);

  async function handleDownload(id, fileName) {
    setDownloading(id);
    try {
      await roomApi.downloadUpload(id, fileName);
    } catch (e) {
      alert(e.message || 'Download failed');
    } finally {
      setDownloading(null);
    }
  }

  const isVideo = (mime) => mime && (mime.startsWith('video/') || mime === 'application/mp4');

  if (loading && uploads.length === 0) return <div className="page-loading">Loading…</div>;
  if (error && uploads.length === 0) return <div className="page-error">{error}</div>;

  return (
    <div className="uploads-page">
      <h1>Uploaded Clips</h1>
      <div className="uploads-filters">
        <label>
          Reporter
          <select value={filterReporter} onChange={(e) => setFilterReporter(e.target.value)}>
            <option value="">All</option>
            {reporters.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label>
          From date
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
        </label>
        <label>
          To date
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
        </label>
      </div>
      {uploads.length === 0 ? (
        <p className="muted">No uploads. Clips appear here when reporters or the system upload recordings.</p>
      ) : (
        <div className="uploads-grid">
          {uploads.map((u) => (
            <div key={u.id} className="upload-card">
              <div className="upload-preview">
                {previewing === u.id && previewUrl && isVideo(u.mime_type) ? (
                  <video className="upload-video" src={previewUrl} controls playsInline />
                ) : (
                  <div className="upload-placeholder">{isVideo(u.mime_type) ? 'Video clip' : 'Clip'}</div>
                )}
              </div>
              <div className="upload-info">
                <span className="upload-name">{u.file_name}</span>
                <span className="upload-meta">{u.reporter_name} · {new Date(u.created_at).toLocaleString()}</span>
                {isVideo(u.mime_type) && (
                  <button
                    type="button"
                    className="btn-preview"
                    onClick={async () => {
                      setDownloading(null);
                      setPreviewing(u.id);
                      try {
                        const blob = await roomApi.getUploadBlob(u.id);
                        const url = URL.createObjectURL(blob);
                        if (previewUrl) URL.revokeObjectURL(previewUrl);
                        setPreviewUrl(url);
                      } catch (e) {
                        alert(e.message || 'Preview failed');
                        setPreviewing(null);
                      }
                    }}
                    disabled={previewing === u.id}
                  >
                    {previewing === u.id ? 'Previewing…' : 'Preview'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-download"
                  onClick={() => handleDownload(u.id, u.file_name)}
                  disabled={downloading === u.id}
                >
                  {downloading === u.id ? 'Downloading…' : 'Download'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
