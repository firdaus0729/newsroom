import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { authMiddleware, login, signup, getReporterById, createReporter, deleteReporter } from './auth.js';
import { editorAuthMiddleware, editorOrAdminMiddleware, editorLogin, createEditor, deleteEditor } from './editorAuth.js';
import { adminAuthMiddleware, adminLogin } from './adminAuth.js';
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
  limits: { fileSize: (Number(process.env.UPLOAD_MAX_SIZE_MB) || 300) * 1024 * 1024 },
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

// Studio return feed info — used by reporter "Load return feed" button
app.get('/studio/return-feed', (_req, res) => {
  try {
    const streamName = process.env.RETURN_FEED_STREAM || 'program';
    const appName = 'live';
    const webrtcPath = `/ome-ws/${appName}/${encodeURIComponent(streamName)}`;
    const rtmpBase = (process.env.RTMP_BASE_URL || 'rtmp://localhost/live').replace(/\/*$/, '');
    const rtmpUrl = `${rtmpBase}/${streamName}_rtmp`;
    return res.json({
      stream_name: streamName,
      app: appName,
      webrtc_path: webrtcPath,
      rtmp_url: rtmpUrl,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ----- Newsroom Dashboard (editor or admin login; role-based) -----
app.post('/dashboard/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  // Try admin first, then editor
  const adminResult = await adminLogin(email, password);
  if (adminResult.ok) {
    return res.json({
      token: adminResult.token,
      editor: adminResult.admin,
      role: 'admin',
    });
  }
  const result = await editorLogin(email, password);
  if (!result.ok) {
    return res.status(401).json({ error: result.error });
  }
  return res.json({ token: result.token, editor: result.editor, role: 'editor' });
});

/** Only admin can add editors */
app.post('/dashboard/editors', editorOrAdminMiddleware, async (req, res) => {
  if (req.role !== 'admin') {
    return res.status(403).json({ error: 'Only administrators can add or remove editors' });
  }
  const { email, password, name } = req.body || {};
  const result = await createEditor(email, password, name);
  if (!result.ok) {
    const status = result.error === 'Email already registered' ? 409 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.status(201).json(result.editor);
});

/** Editor or admin: stop a reporter's stream (emergency control) */
app.post('/dashboard/streams/stop', editorOrAdminMiddleware, async (req, res) => {
  const reporterId = req.body?.reporter_id != null ? parseInt(req.body.reporter_id, 10) : null;
  if (!reporterId || !Number.isFinite(reporterId)) {
    return res.status(400).json({ error: 'reporter_id required' });
  }
  try {
    const session = await dashboardApi.endStreamSessionByEditor(reporterId);
    return res.json(session || { message: 'No active session for that reporter' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/reporters', editorOrAdminMiddleware, async (_, res) => {
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

app.get('/dashboard/reporters/live', editorOrAdminMiddleware, async (_, res) => {
  try {
    const live = await dashboardApi.getLiveReporters();
    return res.json(live);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/streams', editorOrAdminMiddleware, async (_, res) => {
  try {
    const streams = await dashboardApi.getStreams();
    return res.json(streams);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/uploads', editorOrAdminMiddleware, async (req, res) => {
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

app.get('/dashboard/uploads/:id', editorOrAdminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const upload = await dashboardApi.getUploadById(id);
    if (!upload) return res.status(404).json({ error: 'Upload not found' });
    return res.json(upload);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/dashboard/uploads/:id/download', editorOrAdminMiddleware, async (req, res) => {
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

app.get('/dashboard/activity', editorOrAdminMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const activity = await dashboardApi.getActivityFeed(limit);
    return res.json(activity);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ----- Admin-only routes (/admin) -----
app.post('/admin/login', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const result = await adminLogin(email, password);
  if (!result.ok) {
    return res.status(401).json({ error: result.error });
  }
  return res.json({ token: result.token, admin: result.admin });
});

app.get('/admin/reporters', adminAuthMiddleware, async (_, res) => {
  try {
    const reporters = await dashboardApi.getReporters();
    return res.json(reporters);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/admin/reporters', adminAuthMiddleware, rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password and name are required' });
  }
  const result = await createReporter(email, password, name.trim());
  if (!result.ok) {
    const status = result.error === 'Email already registered' ? 409 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.status(201).json(result.reporter);
});

app.delete('/admin/reporters/:id', adminAuthMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || !Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid reporter id' });
  }
  try {
    await deleteReporter(id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/admin/editors', adminAuthMiddleware, async (_req, res) => {
  try {
    const { rows } = await (await import('./db.js')).query(
      'SELECT id, email, name, created_at FROM editors ORDER BY name',
      []
    );
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/admin/editors', adminAuthMiddleware, rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
  const { email, password, name } = req.body || {};
  const result = await createEditor(email, password, name);
  if (!result.ok) {
    const status = result.error === 'Email already registered' ? 409 : 400;
    return res.status(status).json({ error: result.error });
  }
  return res.status(201).json(result.editor);
});

app.delete('/admin/editors/:id', adminAuthMiddleware, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || !Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid editor id' });
  }
  try {
    await deleteEditor(id);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Register a recording file (e.g. from FFmpeg after stream ends) so it appears in Uploaded Clips
const adminUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const reporterId = req.body?.reporter_id || 'unknown';
      const safe = (file.originalname || 'recording').replace(/\W/g, '_').slice(0, 120);
      cb(null, `recording_${reporterId}_${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: (Number(process.env.UPLOAD_MAX_SIZE_MB) || 300) * 1024 * 1024 },
}).single('file');

app.post('/admin/register-recording', adminAuthMiddleware, (req, res, next) => {
  adminUpload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large' });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  const reporterId = req.body?.reporter_id != null ? parseInt(req.body.reporter_id, 10) : null;
  if (!reporterId || !Number.isFinite(reporterId) || !req.file) {
    return res.status(400).json({ error: 'reporter_id and file are required' });
  }
  const validation = validateUploadFile(req.file);
  if (!validation.ok) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(400).json({ error: validation.error });
  }
  try {
    const upload = await createUpload(reporterId, {
      path: req.file.filename,
      originalname: req.file.originalname || `recording_${reporterId}.mp4`,
      size: req.file.size,
      mimetype: req.file.mimetype || 'video/mp4',
    });
    return res.status(201).json(upload);
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
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
