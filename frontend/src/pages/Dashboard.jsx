import React, { useRef, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWebRTCPublisher } from '../hooks/useWebRTCPublisher';
import { useWebRTCPlayer } from '../hooks/useWebRTCPlayer';
import { BITRATE_PRESETS, DEFAULT_BITRATE } from '../constants/bitrate';
import * as api from '../api';
import './Dashboard.css';

const OME_WS_URL = import.meta.env.VITE_OME_WS_URL || '';
const RETURN_FEED_STREAM = import.meta.env.VITE_RETURN_FEED_STREAM || 'program';

function getDefaultOmeUrl() {
  if (OME_WS_URL) return OME_WS_URL;
  if (typeof window === 'undefined') return 'ws://localhost:3333';
  const { protocol, hostname } = window.location;
  // When on HTTPS, use same-origin path /ome-ws so Nginx can proxy to OME (no port 3333 exposed)
  if (protocol === 'https:') {
    return `${protocol}//${hostname}/ome-ws`;
  }
  return `ws://${hostname}:3333`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function Dashboard() {
  const { reporter, signOut } = useAuth();
  const previewVideoRef = useRef(null);
  const returnFeedVideoRef = useRef(null);
  const [bitrate, setBitrate] = useState(DEFAULT_BITRATE);

  const {
    status: pubStatus,
    errorMessage: pubError,
    previewStream,
    networkQuality,
    liveDurationSeconds,
    isMuted,
    startPreview,
    goLive,
    stopStream,
    toggleMute,
    switchCamera,
  } = useWebRTCPublisher();

  const {
    status: playerStatus,
    errorMessage: playerError,
    audioBlocked,
    play: playReturnFeed,
    stop: stopReturnFeed,
    tryUnmute,
  } = useWebRTCPlayer(returnFeedVideoRef, { autoReconnect: true });

  const omeUrl = getDefaultOmeUrl();
  const streamName = reporter ? `reporter_${reporter.id}` : '';
  const [videoDevicesCount, setVideoDevicesCount] = useState(0);
  const [alertText, setAlertText] = useState('');
  const [alertStatus, setAlertStatus] = useState({ type: '', text: '' });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      // MediaDevices is only available on secure origins (https or localhost)
      setVideoDevicesCount(0);
      return;
    }
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => {
        setVideoDevicesCount(d.filter((x) => x.kind === 'videoinput').length);
      })
      .catch(() => {
        setVideoDevicesCount(0);
      });
  }, []);

  useEffect(() => {
    if (previewStream && previewVideoRef.current) {
      previewVideoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // getUserMedia is blocked on insecure origins; avoid crashing
      return;
    }
    startPreview().catch(() => {});
  }, [startPreview]);

  const handleGoLive = () => {
    goLive(omeUrl, streamName, { bitrate, onLive: api.streamStarted });
  };

  const handleStop = () => {
    api.streamStopped();
    stopStream();
  };

  const handleSendAlert = async (e) => {
    e.preventDefault();
    const text = alertText.trim();
    if (!text) return;
    setAlertStatus({ type: '', text: '' });
    try {
      await api.sendBreakingNews(text);
      setAlertStatus({ type: 'success', text: 'Breaking news alert sent to newsroom.' });
      setAlertText('');
    } catch (err) {
      setAlertStatus({ type: 'error', text: err.message || 'Failed to send alert' });
    }
  };

  const handleLoadReturnFeed = () => {
    if (playerStatus === 'idle' || playerStatus === 'error') {
      playReturnFeed(omeUrl, RETURN_FEED_STREAM);
    }
  };

  async function handleUploadClip(e) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploadMessage({ type: '', text: '' });
    setUploading(true);
    try {
      await api.uploadClip(uploadFile);
      setUploadMessage({ type: 'success', text: `"${uploadFile.name}" uploaded. Editors can see it in Uploaded Clips.` });
      setUploadFile(null);
    } catch (err) {
      setUploadMessage({ type: 'error', text: err.message || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  }

  const statusLabel = {
    idle: 'Idle',
    connecting: 'Connecting',
    live: 'Live',
    reconnecting: 'Reconnecting',
    error: 'Error',
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <span className="reporter-name">{reporter?.name || 'Reporter'}</span>
        <button type="button" className="btn-logout" onClick={signOut} aria-label="Logout">
          Log out
        </button>
      </header>

      <main className="dashboard-main">
        <section className="preview-section">
          <div className="preview-wrap">
            <video
              ref={previewVideoRef}
              className="preview-video"
              autoPlay
              muted
              playsInline
              mirror="true"
            />
            <div className={`preview-overlay status-badge status-badge--${pubStatus}`}>
              {pubStatus === 'live' && '● LIVE'}
              {pubStatus === 'idle' && 'Camera preview'}
              {pubStatus === 'connecting' && 'Connecting…'}
              {pubStatus === 'reconnecting' && 'Reconnecting…'}
              {pubStatus === 'error' && 'Error'}
            </div>
            {(pubStatus === 'live' || pubStatus === 'reconnecting') && (
              <div className="streaming-timer">
                {formatDuration(liveDurationSeconds)}
              </div>
            )}
            {networkQuality && (pubStatus === 'live' || pubStatus === 'reconnecting') && (
              <div className={`network-quality network-quality--${networkQuality}`}>
                {networkQuality === 'good' && '● Good'}
                {networkQuality === 'fair' && '◐ Fair'}
                {networkQuality === 'poor' && '○ Poor'}
              </div>
            )}
          </div>

          <div className="controls-row">
            {pubStatus !== 'live' && pubStatus !== 'reconnecting' && (
              <div className="bitrate-selector">
                <span className="bitrate-label">Bitrate</span>
                <select
                  className="bitrate-select"
                  value={bitrate}
                  onChange={(e) => setBitrate(e.target.value)}
                  aria-label="Video bitrate"
                >
                  {Object.entries(BITRATE_PRESETS).map(([key, { label, kbps }]) => (
                    <option key={key} value={key}>{label} ({kbps} kbps)</option>
                  ))}
                </select>
              </div>
            )}
            <div className="preview-actions">
              {videoDevicesCount > 1 && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={switchCamera}
                  title="Switch camera"
                  aria-label="Switch camera"
                >
                  <span className="btn-icon-label">Switch camera</span>
                </button>
              )}
              <button
                type="button"
                className={`btn-icon ${isMuted ? 'btn-icon--muted' : ''}`}
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                <span className="btn-icon-label">{isMuted ? 'Unmute' : 'Mute'}</span>
              </button>
            </div>
          </div>

          <div className="actions">
            {(pubStatus === 'idle' || pubStatus === 'error') && (
              <button
                type="button"
                className="btn btn-go-live"
                onClick={handleGoLive}
                disabled={pubStatus === 'connecting'}
              >
                GO LIVE
              </button>
            )}
            {(pubStatus === 'connecting' || pubStatus === 'reconnecting') && (
              <button type="button" className="btn btn-stop" onClick={handleStop}>
                Cancel
              </button>
            )}
            {pubStatus === 'live' && (
              <button type="button" className="btn btn-stop" onClick={handleStop}>
                STOP STREAM
              </button>
            )}
          </div>
          <p className="status-msg status-msg--state">
            {statusLabel[pubStatus]}
            {pubError && <span className="status-msg--error"> — {pubError}</span>}
          </p>

          <section className="alert-section">
            <h2 className="alert-title">Breaking news alert</h2>
            <p className="alert-intro">Send a short alert to editors when something urgent happens.</p>
            <form onSubmit={handleSendAlert} className="alert-form">
              <textarea
                className="alert-input"
                value={alertText}
                onChange={(e) => {
                  setAlertText(e.target.value);
                  setAlertStatus({ type: '', text: '' });
                }}
                maxLength={280}
                rows={2}
                placeholder="Short headline or description"
              />
              <button type="submit" className="btn btn-alert" disabled={!alertText.trim()}>
                Send alert
              </button>
              {alertStatus.text && (
                <p className={`alert-msg alert-msg--${alertStatus.type}`}>{alertStatus.text}</p>
              )}
            </form>
          </section>
        </section>

        <section className="return-feed-section">
          <h2 className="return-feed-title">Studio return feed</h2>
          <div className="return-feed-actions">
            {(playerStatus === 'idle' || playerStatus === 'error') && (
              <button
                type="button"
                className="btn btn-load-return-feed"
                onClick={handleLoadReturnFeed}
                disabled={playerStatus === 'connecting'}
              >
                {playerStatus === 'error' ? 'Retry return feed' : 'Load return feed'}
              </button>
            )}
            {playerStatus === 'playing' && (
              <button type="button" className="btn btn-stop-return-feed" onClick={stopReturnFeed}>
                Stop return feed
              </button>
            )}
          </div>
          <div className={`return-feed-wrap ${playerStatus === 'playing' ? 'return-feed-wrap--playing' : ''}`}>
            <video
              ref={returnFeedVideoRef}
              className="return-feed-video"
              autoPlay
              playsInline
              muted={false}
            />
            {audioBlocked && (
              <button
                type="button"
                className="return-feed-unmute"
                onClick={tryUnmute}
              >
                Tap to play audio
              </button>
            )}
            <div className="return-feed-placeholder">
              {playerStatus === 'idle' && 'Click "Load return feed" when the studio stream is ready'}
              {playerStatus === 'connecting' && 'Connecting to studio…'}
              {playerStatus === 'error' && (playerError || 'No return feed')}
            </div>
          </div>
        </section>

        <section className="upload-section">
          <h2 className="upload-title">Upload clip</h2>
          <p className="upload-intro">Send a video or audio clip to the newsroom. Editors can view and download it from Uploaded Clips.</p>
          <form onSubmit={handleUploadClip} className="upload-form">
            <label htmlFor="clip-file" className="upload-label">Choose file</label>
            <input
              id="clip-file"
              type="file"
              accept="video/*,audio/*"
              onChange={(e) => {
                setUploadFile(e.target.files?.[0] || null);
                setUploadMessage({ type: '', text: '' });
              }}
              className="upload-input"
              disabled={uploading}
            />
            {uploadFile && <span className="upload-filename">{uploadFile.name}</span>}
            <button type="submit" className="btn btn-upload" disabled={!uploadFile || uploading}>
              {uploading ? 'Uploading…' : 'Upload clip'}
            </button>
            {uploadMessage.text && (
              <p className={`upload-msg upload-msg--${uploadMessage.type}`}>{uploadMessage.text}</p>
            )}
          </form>
        </section>
      </main>
    </div>
  );
}
