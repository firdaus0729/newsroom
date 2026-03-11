import path from 'path';
import fs from 'fs';
import { query } from './db.js';
import { isObjectStorageEnabled, uploadFileFromPath } from './objectStorage.js';

export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

const ALLOWED_MIME_PREFIXES = ['video/', 'audio/', 'application/mp4', 'application/octet-stream'];
const MAX_FILE_SIZE = Number(process.env.UPLOAD_MAX_SIZE_MB) || 500; // MB

export function getAllowedMimeTypes() {
  return ALLOWED_MIME_PREFIXES;
}

export function getMaxFileSizeBytes() {
  return MAX_FILE_SIZE * 1024 * 1024;
}

function isAllowedMime(mime) {
  if (!mime) return false;
  return ALLOWED_MIME_PREFIXES.some((p) => mime.toLowerCase().startsWith(p) || mime === p);
}

export function validateUploadFile(file) {
  if (!file || !file.originalname) return { ok: false, error: 'No file' };
  if (file.size > getMaxFileSizeBytes()) return { ok: false, error: `File too large (max ${MAX_FILE_SIZE} MB)` };
  if (!isAllowedMime(file.mimetype)) return { ok: false, error: 'File type not allowed (use video or audio)' };
  return { ok: true };
}

/** Create upload record and activity. file: { path, originalname, size, mimetype } (path is relative to UPLOADS_DIR). */
export async function createUpload(reporterId, file) {
  const fileName = (file.originalname || 'clip').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'clip';
  let storagePath = file.path;

  // If object storage is configured, upload file and store object key instead of local path
  if (isObjectStorageEnabled()) {
    const key = `uploads/reporter_${reporterId}/${Date.now()}_${fileName}`;
    const fullLocalPath = path.join(UPLOADS_DIR, file.path);
    await uploadFileFromPath(fullLocalPath, key, file.mimetype);
    storagePath = key;
    // Optional: keep local copy as cache; for now we leave the file on disk
  }

  const { rows } = await query(
    `INSERT INTO uploads (reporter_id, file_name, file_path, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, reporter_id, file_name, file_path, file_size, mime_type, created_at`,
    [reporterId, fileName, storagePath, file.size ?? null, file.mimetype || null]
  );
  const upload = rows[0];
  if (upload) {
    await query(
      `INSERT INTO activity_feed (type, reporter_id, upload_id) VALUES ('uploaded_clip', $1, $2)`,
      [reporterId, upload.id]
    );
  }
  return upload;
}

export async function getUploadById(id) {
  const { rows } = await query(
    'SELECT id, reporter_id, file_name, file_path, file_size, mime_type, created_at FROM uploads WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

export function getUploadFilePath(record) {
  if (!record?.file_path) return null;
  // If object storage is enabled, file_path is an object key, so there may be no local path
  if (isObjectStorageEnabled()) {
    return null;
  }
  const fullPath = path.isAbsolute(record.file_path)
    ? record.file_path
    : path.join(UPLOADS_DIR, record.file_path);
  return fullPath;
}

export function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}
