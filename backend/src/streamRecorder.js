import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR, createUpload } from './uploads.js';

const RTMP_BASE = (process.env.RTMP_BASE_URL || 'rtmp://localhost/live').replace(/\/*$/, '');

// streamName -> { process, outputPath, reporterId, originalName }
const activeRecordings = new Map();

export function startRecording(reporterId, streamName) {
  if (!reporterId || !streamName) return;
  if (activeRecordings.has(streamName)) return;

  const rtmpUrl = `${RTMP_BASE}/${streamName}_rtmp`;
  const safeStream = String(streamName).replace(/\W/g, '_').slice(0, 80);
  const fileName = `recording_${reporterId}_${Date.now()}_${safeStream}.mp4`;
  const outputPath = path.join(UPLOADS_DIR, fileName);

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
    console.error(`[streamRecorder:${streamName}] ffmpeg error:`, err.message);
    activeRecordings.delete(streamName);
    try { fs.existsSync(outputPath) && fs.unlinkSync(outputPath); } catch (_) {}
  });

  proc.on('exit', async () => {
    // If we get here without an explicit stop() call, just clean up;
    // the explicit stop() handler will do the upload.
    if (activeRecordings.has(streamName)) {
      activeRecordings.delete(streamName);
    }
  });

  activeRecordings.set(streamName, {
    process: proc,
    outputPath,
    reporterId,
    originalName: `${safeStream}.mp4`,
  });

  console.log(`[streamRecorder:${streamName}] Recording started -> ${outputPath}`);
}

export async function stopRecording(reporterId, streamName) {
  if (!reporterId || !streamName) return;
  const entry = activeRecordings.get(streamName);
  if (!entry) return;

  const { process: proc, outputPath, originalName } = entry;
  activeRecordings.delete(streamName);

  try {
    proc.kill('SIGINT');
  } catch (_) {}

  // Wait a little for ffmpeg to flush and exit
  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (!fs.existsSync(outputPath)) {
    console.warn(`[streamRecorder:${streamName}] Output file missing, nothing to register.`);
    return;
  }

  try {
    const stats = fs.statSync(outputPath);
    const upload = await createUpload(reporterId, {
      path: path.basename(outputPath),
      originalname: originalName || path.basename(outputPath),
      size: stats.size,
      mimetype: 'video/mp4',
    });
    console.log(`[streamRecorder:${streamName}] Saved recording as upload id=${upload.id} for reporter ${reporterId}`);
  } catch (e) {
    console.error(`[streamRecorder:${streamName}] Failed to register recording:`, e.message);
  }
}

