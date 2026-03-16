import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env.API_URL || process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
const RTMP_BASE = process.env.RTMP_BASE_URL || process.env.RTMP_BASE || 'rtmp://localhost/live';
const POLL_MS = Number(process.env.AUTO_RECORD_POLL_MS || 8000);
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, '..', 'recordings');

const activeProcesses = new Map(); // streamName -> { process, outputPath, reporterId }

async function getAdminToken() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set for auto recording');
  }
  const res = await fetch(`${API_BASE}/dashboard/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(data.error || 'Admin login failed');
  return data.token;
}

async function getLiveStreams(token) {
  const res = await fetch(`${API_BASE}/dashboard/streams`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => []);
  if (!res.ok) return [];
  return Array.isArray(data) ? data.filter((s) => s.is_live) : [];
}

function startRecording(streamName, reporterId) {
  if (activeProcesses.has(streamName)) return;
  const rtmpUrl = `${RTMP_BASE.replace(/\/*$/, '')}/${streamName}_rtmp`;
  const outDir = path.join(RECORDINGS_DIR, String(reporterId));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${streamName}_${Date.now()}.mp4`);
  const proc = spawn(
    'ffmpeg',
    [
      '-i', rtmpUrl,
      '-c', 'copy',
      '-f', 'mp4',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  proc.on('error', (err) => {
    console.error(`[autoRecorder:${streamName}] FFmpeg error:`, err.message);
    activeProcesses.delete(streamName);
  });
  proc.on('exit', () => {
    // we'll handle registration in the poll loop when we see the stream is no longer live
  });
  activeProcesses.set(streamName, { process: proc, outputPath, reporterId });
  console.log(`[autoRecorder:${streamName}] Recording started -> ${outputPath}`);
}

function stopRecording(streamName) {
  const entry = activeProcesses.get(streamName);
  if (!entry) return null;
  entry.process.kill('SIGINT');
  activeProcesses.delete(streamName);
  return entry;
}

async function registerRecording(token, reporterId, filePath, fileName) {
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('reporter_id', String(reporterId));
  form.append('file', new Blob([buffer]), fileName);
  const res = await fetch(`${API_BASE}/admin/register-recording`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Register failed: ${res.status}`);
  }
  return res.json();
}

async function pollOnce(token) {
  const live = await getLiveStreams(token);
  const liveSet = new Set(live.map((s) => s.stream_name));
  const liveByStream = new Map(live.map((s) => [s.stream_name, s]));

  // For any recording whose stream is no longer live, stop and register
  for (const [streamName, entry] of Array.from(activeProcesses)) {
    if (!liveSet.has(streamName)) {
      const { outputPath, reporterId } = entry;
      stopRecording(streamName);
      if (fs.existsSync(outputPath)) {
        try {
          await registerRecording(token, reporterId, outputPath, path.basename(outputPath));
          console.log(`[autoRecorder:${streamName}] Registered recording for reporter ${reporterId}`);
          try { fs.unlinkSync(outputPath); } catch (_) {}
        } catch (e) {
          console.error(`[autoRecorder:${streamName}] Failed to register recording:`, e.message);
        }
      }
    }
  }

  // Start recordings for any new live streams
  for (const s of live) {
    const reporterId = s.reporter_id;
    if (!reporterId) continue;
    startRecording(s.stream_name, reporterId);
  }
}

export function startAutoRecorder() {
  if (process.env.AUTO_RECORD_STREAMS === 'false') {
    console.log('Auto recorder disabled (AUTO_RECORD_STREAMS=false)');
    return;
  }
  if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  console.log('Auto recorder: enabled. API:', API_BASE, 'RTMP:', RTMP_BASE);

  (async function loop() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const token = await getAdminToken();
        await pollOnce(token);
      } catch (e) {
        console.error('Auto recorder poll error:', e.message);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  })();
}

