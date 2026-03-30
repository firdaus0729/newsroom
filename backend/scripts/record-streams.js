/**
 * Auto-record live reporter streams with FFmpeg. Run on the server alongside the API.
 * When a stream ends, the recorded file is POSTed to /admin/register-recording so it
 * appears in Uploaded Clips.
 *
 * Requires: FFmpeg installed, ADMIN_EMAIL and ADMIN_PASSWORD in .env (or pass as env).
 * Usage: API_URL=http://localhost:4000 SRT_BASE_URL=srt://localhost:9999/live node scripts/record-streams.js
 */
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = process.env.API_URL || process.env.BACKEND_URL || 'http://localhost:4000';
const SRT_BASE = process.env.SRT_BASE_URL || 'srt://localhost:9999/live';
const POLL_MS = 8000;
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(__dirname, '..', 'recordings');

const activeProcesses = new Map(); // streamName -> { process, outputPath, reporterId }

async function getAdminToken() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set');
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
// Stream shape: { stream_name, reporter_id, is_live, ... }

function startRecording(streamName, reporterId) {
  if (activeProcesses.has(streamName)) return;
  const srtUrl = `${SRT_BASE}/${streamName}_srt`;
  const outDir = path.join(RECORDINGS_DIR, String(reporterId));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${streamName}_${Date.now()}.mp4`);
  const proc = spawn(
    'ffmpeg',
    [
      '-i', srtUrl,
      '-c', 'copy',
      '-f', 'mp4',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  proc.on('error', (err) => {
    console.error(`[${streamName}] FFmpeg error:`, err.message);
    activeProcesses.delete(streamName);
  });
  proc.on('exit', (code) => {
    activeProcesses.delete(streamName);
  });
  activeProcesses.set(streamName, { process: proc, outputPath, reporterId });
  console.log(`[${streamName}] Recording started -> ${outputPath}`);
}

function stopRecording(streamName) {
  const entry = activeProcesses.get(streamName);
  if (!entry) return;
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

async function poll(token) {
  const live = await getLiveStreams(token);
  const liveSet = new Set(live.map((s) => s.stream_name));
  const liveByStream = new Map(live.map((s) => [s.stream_name, s]));

  for (const [streamName, entry] of Array.from(activeProcesses)) {
    if (!liveSet.has(streamName)) {
      const { outputPath, reporterId } = entry;
      stopRecording(streamName);
      if (fs.existsSync(outputPath)) {
        try {
          await registerRecording(token, reporterId, outputPath, path.basename(outputPath));
          console.log(`[${streamName}] Registered recording for reporter ${reporterId}`);
          try { fs.unlinkSync(outputPath); } catch (_) {}
        } catch (e) {
          console.error(`[${streamName}] Failed to register recording:`, e.message);
        }
      }
    }
  }

  for (const s of live) {
    const reporterId = s.reporter_id;
    if (!reporterId) continue;
    startRecording(s.stream_name, reporterId);
  }
}

async function main() {
  if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  console.log('Record-streams: polling', API_BASE, 'SRT', SRT_BASE);
  for (;;) {
    try {
      const token = await getAdminToken();
      await poll(token);
    } catch (e) {
      console.error('Poll error:', e.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
