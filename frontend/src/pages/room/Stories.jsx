import React, { useEffect, useMemo, useState } from 'react';
import * as roomApi from '../../roomApi';
import './Stories.css';

export default function Stories() {
  const [stories, setStories] = useState([]);
  const [selectedStoryId, setSelectedStoryId] = useState(null);
  const [selectedStory, setSelectedStory] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const role = useMemo(() => roomApi.getRole(), []);

  async function loadStories() {
    setLoading(true);
    setError('');
    try {
      const data = await roomApi.getStories(status ? { status } : {});
      setStories(data);
      if (!selectedStoryId && data[0]) setSelectedStoryId(data[0].id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetails(storyId) {
    if (!storyId) return;
    try {
      const details = await roomApi.getStory(storyId);
      setSelectedStory(details);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadStories();
    const t = setInterval(loadStories, 8000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    loadDetails(selectedStoryId);
  }, [selectedStoryId]);

  async function refreshDetails() {
    await loadStories();
    await loadDetails(selectedStoryId);
  }

  async function handleApprove(clipId) {
    setBusyId(`approve-${clipId}`);
    try {
      await roomApi.approveClip(selectedStoryId, clipId);
      await refreshDetails();
    } catch (e) {
      alert(e.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(clipId) {
    const note = window.prompt('Reason for rejection (optional):', '') || '';
    setBusyId(`reject-${clipId}`);
    try {
      await roomApi.rejectClip(selectedStoryId, clipId, note);
      await refreshDetails();
    } catch (e) {
      alert(e.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRetry(jobId) {
    setBusyId(`retry-${jobId}`);
    try {
      await roomApi.retryStoryJob(selectedStoryId, jobId);
      await refreshDetails();
    } catch (e) {
      alert(e.message || 'Retry failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stories-page">
      <h1>Stories (Module 2)</h1>
      <div className="stories-filter">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="uploaded">uploaded</option>
            <option value="transcribing">transcribing</option>
            <option value="transcript_ready">transcript_ready</option>
            <option value="under_review">under_review</option>
            <option value="approved">approved</option>
            <option value="failed">failed</option>
          </select>
        </label>
      </div>
      {error && <p className="page-error">{error}</p>}
      <div className="stories-layout">
        <section className="stories-list">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : stories.length === 0 ? (
            <p className="muted">No stories yet. They appear automatically after uploads complete.</p>
          ) : (
            stories.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`story-row ${selectedStoryId === s.id ? 'active' : ''}`}
                onClick={() => setSelectedStoryId(s.id)}
              >
                <span className="story-title">{s.title}</span>
                <span className="story-meta">{s.status} · clips {s.clip_count} · pending jobs {s.pending_jobs}</span>
              </button>
            ))
          )}
        </section>

        <section className="story-detail">
          {!selectedStory ? (
            <p className="muted">Select a story</p>
          ) : (
            <>
              <h2>{selectedStory.story.title}</h2>
              <p className="muted">
                Status: {selectedStory.story.status} · Reporter: {selectedStory.story.reporter_name || '-'}
              </p>

              <h3>Generated Clips</h3>
              {selectedStory.clips.length === 0 ? (
                <p className="muted">No clip suggestions yet.</p>
              ) : (
                <div className="list">
                  {selectedStory.clips.map((c) => (
                    <div className="item" key={c.id}>
                      <div>
                        <strong>{c.title}</strong>
                        <div className="muted">{c.clip_preset} · {c.status} · {c.start_seconds}s → {c.end_seconds}s</div>
                      </div>
                      <div className="item-actions">
                        <button
                          type="button"
                          onClick={() => handleApprove(c.id)}
                          disabled={busyId === `approve-${c.id}`}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(c.id)}
                          disabled={busyId === `reject-${c.id}`}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h3>Processing Jobs</h3>
              <div className="list">
                {selectedStory.jobs.map((j) => (
                  <div className="item" key={j.id}>
                    <div>
                      <strong>{j.job_type}</strong>
                      <div className="muted">{j.status} · attempts {j.attempt_count}/{j.max_attempts}</div>
                      {j.error_log && <div className="error-mini">{j.error_log}</div>}
                    </div>
                    {role === 'admin' && j.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => handleRetry(j.id)}
                        disabled={busyId === `retry-${j.id}`}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <h3>Transcript Segments</h3>
              <div className="list">
                {selectedStory.transcript_segments.slice(0, 10).map((t) => (
                  <div className="item" key={t.id}>
                    <div>
                      <strong>{t.start_seconds}s → {t.end_seconds}s</strong>
                      <div>{t.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
