import crypto from 'crypto';

const MODULE2_URL = (process.env.MODULE2_URL || 'http://204.168.181.42').replace(/\/+$/, '');
const MODULE2_WEBHOOK_SECRET = process.env.MODULE2_WEBHOOK_SECRET || '';
const DEFAULT_BASE_URL = (process.env.UPLOAD_PUBLIC_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '');

function buildBaseUrl(req) {
  if (DEFAULT_BASE_URL) return DEFAULT_BASE_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function sanitizePathSegment(value) {
  return String(value || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function getFileUrl(req, upload) {
  const base = buildBaseUrl(req).replace(/\/+$/, '');
  const rel = sanitizePathSegment(upload?.file_path || upload?.file_name || '');
  return `${base}/uploads/${rel}`;
}

function postWithTimeout(url, headers, body, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: controller.signal,
  })
    .then(async (res) => {
      if (res.ok) return;
      const responseText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}${responseText ? `: ${responseText}` : ''}`);
    })
    .finally(() => clearTimeout(timeout));
}

function postWebhook(endpointPath, payload) {
  if (!MODULE2_WEBHOOK_SECRET) {
    console.warn('[Module2] MODULE2_WEBHOOK_SECRET missing; skipping webhook.');
    return;
  }
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', MODULE2_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  postWithTimeout(`${MODULE2_URL}${endpointPath}`, {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': signature,
  }, body).catch((err) => {
    console.error('[Module2] webhook failed:', err.message);
  });
}

export function notifyModule2UploadComplete({ req, reporterId, upload, sourceType = 'upload', liveDurationSeconds }) {
  if (!upload) return;
  const payload = {
    upload_id: upload.id,
    reporter_id: reporterId,
    filename: upload.file_name,
    file_url: getFileUrl(req, upload),
    title: (req.body?.title || upload.file_name || 'Untitled').toString(),
    location: (req.body?.location || '').toString(),
    source_type: sourceType,
    language: (req.body?.language || 'as').toString(),
    original_name: req.file?.originalname || upload.file_name,
    file_size: upload.file_size || req.file?.size || null,
    mime_type: upload.mime_type || req.file?.mimetype || 'application/octet-stream',
  };
  if (sourceType === 'live_completion' && Number.isFinite(Number(liveDurationSeconds))) {
    payload.live_duration_seconds = Number(liveDurationSeconds);
  }
  const endpoint = sourceType === 'live_completion'
    ? '/api/webhooks/live-complete'
    : '/api/webhooks/upload-complete';
  postWebhook(endpoint, payload);
}
