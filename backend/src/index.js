import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { authMiddleware, login, signup, getReporterById } from './auth.js';
import { editorAuthMiddleware, editorLogin, createEditor } from './editorAuth.js';
import * as dashboardApi from './dashboardApi.js';
import { ensureDatabaseAndSchema } from './ensureDb.js';
import { getUploadFilePath, ensureUploadsDir, UPLOADS_DIR, createUpload, validateUploadFile } from './uploads.js';
import { isObjectStorageEnabled, getObjectStream } from './objectStorage.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const reporterUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'clip').replace(/\W/g, '_').slice(0, 120);
      cb(null, `${req.user.id}_${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: (Number(process.env.UPLOAD_MAX_SIZE_MB) || 500) * 1024 * 1024 },
}).single('file');

const rateBuckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket) {
      bucket = [];
      rateBuckets.set(key, bucket);
    }
    const cutoff = now - windowMs;
    while (bucket.length && bucket[0] < cutoff) {
      bucket.shift();
    }
    if (bucket.length >= max) {
      return res.status(429).json({ error: 'Too many requests, slow down' });
    }
    bucket.push(now);
    next();
  };
}

// Health
app.get('/health', (_, res) => res.json({ ok: true }));

// POST /login — email + password, returns JWT and reporter info
app.post('/login', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const result = await login(email, password);
  if (!result.ok) {
    return res.status(401).json({ error: result.error });
  }
  return res.json({
    token: result.token,
    reporter: result.reporter,
  });
});

// POST /signup — name, email, password; creates reporter and returns JWT + reporter
app.post('/signup', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const { email, password, name } = req.body || {};
  const result = await signup(email, password, name);
  if (!result.ok) {
    const status = result.error === 'Email already registered' ? 409 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.status(201).json({
    token: result.token,
    reporter: result.reporter,
  });
});

// GET /me — current reporter (requires Authorization: Bearer <token>)
app.get('/me', authMiddleware, async (req, res) => {
  const reporter = await getReporterById(req.user.id);
  if (!reporter) {
    return res.status(404).json({ error: 'Reporter not found' });
  }
  return res.json(reporter);
});

// POST /logout — client discards token
app.post('/logout', authMiddleware, (_, res) => {
  return res.json({ message: 'Logged out' });
});

// Reporter: breaking news alert
app.post('/alerts', authMiddleware, rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const { message } = req.body || {};
  try {
    const alert = await dashboardApi.createBreakingNews(req.user.id, message);
    return res.status(201).json(alert);
  } catch (e) {
    if (e.code === 'VALIDATION') {
      return res.status(400).json({ error: e.message });
    }
    return res.status(500).json({ error: e.message });
  }
});

// ----- Reporter: stream start/stop (for activity and live list) -----
app.post('/streams/start', authMiddleware, rateLimit({ windowMs: 10_000, max: 5 }), async (req, res) => {
  const streamName = `reporter_${req.user.id}`;
  try {
    const session = await dashboardApi.startStreamSession(req.user.id, streamName);
    return res.status(201).json(session);
  } catch (e) {
    if (e.code === 'MAX_STREAMS_REACHED' || e.message === 'MAX_STREAMS_REACHED') {
      return res.status(429).json({ error: 'Maximum number of concurrent live streams reached. Try again later.' });
    }
    return res.status(500).json({ error: e.message });
  }
});

app.post('/streams/stop', authMiddleware, async (req, res) => {
  const streamName = `reporter_${req.user.id}`;
  try {
    const session = await dashboardApi.endStreamSession(req.user.id, streamName);
    return res.json(session || { message: 'No active session' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /upload — reporter uploads a clip (multipart/form-data, field name: file)
app.post('/upload', authMiddleware, rateLimit({ windowMs: 60_000, max: 30 }), (req, res, next) => {
  reporterUpload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file; use field name "file"' });
  }
  const validation = validateUploadFile(req.file);
  if (!validation.ok) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(400).json({ error: validation.error });
  }
  try {
    const upload = await createUpload(req.user.id, {
      path: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
    return res.status(201).json(upload);
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(500).json({ error: e.message });
  }
});

// ----- Newsroom Dashboard (editor auth) -----
app.post('/dashboard/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const result = await editorLogin(email, password);
  if (!result.ok) {
    return res.status(401).json({ error: result.error });
  }
  return res.json({ token: result.token, editor: result.editor });
});

app.post('/dashboard/editors', editorAuthMiddleware, async (req, res) => {
  const { email, password, name } = req.body || {};
  const result = await createEditor(email, password, name);
  if (!result.ok) {
    const status = result.error === 'Email already registered' ? 409 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.status(201).json(result.editor);
});

app.get('/dashboard/reporters', editorAuthMiddleware, async (_, res) => {
  try {
    const reporters = await dashboardApi.getReporters();
    const live = await dashboardApi.getLiveReporters();
    const liveIds = new Set(live.map((r) => r.id));
    const withStatus = reporters.map((r) => ({
      ...r,
      status: liveIds.has(r.id) ? 'live' : (r.status === 'live' ? 'live' : 'offline'),
      stream_name: live.find((l) => l.id === r.id)?.stream_name,
      started_at: live.find((l) => l.id === r.id)?.started_at,
      rtmp_url: live.find((l) => l.id === r.id)?.rtmp_url,
      webrtc_url: live.find((l) => l.id === r.id)?.webrtc_url,
    }));
    return res.json(withStatus);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/reporters/live', editorAuthMiddleware, async (_, res) => {
  try {
    const live = await dashboardApi.getLiveReporters();
    return res.json(live);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/streams', editorAuthMiddleware, async (_, res) => {
  try {
    const streams = await dashboardApi.getStreams();
    return res.json(streams);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/uploads', editorAuthMiddleware, async (req, res) => {
  try {
    const reporter_id = req.query.reporter_id ? parseInt(req.query.reporter_id, 10) : undefined;
    const from_date = req.query.from_date || undefined;
    const to_date = req.query.to_date || undefined;
    const uploads = await dashboardApi.getUploads({ reporter_id, from_date, to_date });
    return res.json(uploads);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/uploads/:id', editorAuthMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const upload = await dashboardApi.getUploadById(id);
    if (!upload) return res.status(404).json({ error: 'Upload not found' });
    return res.json(upload);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/uploads/:id/download', editorAuthMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const upload = await dashboardApi.getUploadById(id);
    if (!upload) return res.status(404).json({ error: 'Upload not found' });
    if (isObjectStorageEnabled()) {
      const obj = await getObjectStream(upload.file_path);
      if (!obj || !obj.Body) return res.status(404).json({ error: 'File not found' });
      res.setHeader('Content-Disposition', `attachment; filename="${upload.file_name}"`);
      if (upload.mime_type) res.setHeader('Content-Type', upload.mime_type);
      obj.Body.pipe(res);
      return;
    }
    const filePath = getUploadFilePath(upload);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${upload.file_name}"`);
    if (upload.mime_type) res.setHeader('Content-Type', upload.mime_type);
    return res.sendFile(path.resolve(filePath));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/activity', editorAuthMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const activity = await dashboardApi.getActivityFeed(limit);
    return res.json(activity);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is in use. Stop the other process (e.g. run: kill $(lsof -t -i:${port})) or set PORT to a different value in backend/.env`));
      } else {
        reject(err);
      }
    });
  });
}

async function start() {
  try {
    await ensureDatabaseAndSchema();
  } catch (e) {
    console.error('Startup: database setup failed.', e.message);
    process.exit(1);
  }
  ensureUploadsDir();
  let port = PORT;
  try {
    await listen(port);
    console.log(`Reporter Portal API listening on http://localhost:${port}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

start();
