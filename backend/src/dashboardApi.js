import { query } from './db.js';

const RTMP_BASE = process.env.RTMP_BASE_URL || 'rtmp://localhost/live';
const SRT_BASE = process.env.SRT_BASE_URL || '';
const OME_WS_BASE = process.env.OME_WS_BASE_URL || 'ws://localhost:3333';

export async function getReporters() {
  const { rows } = await query(
    `SELECT r.id, r.email, r.name, r.created_at,
            (SELECT COUNT(*) FROM stream_sessions s WHERE s.reporter_id = r.id AND s.ended_at IS NULL) AS live_count
       FROM reporters r
       ORDER BY r.name`
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    created_at: r.created_at,
    status: r.live_count > 0 ? 'live' : 'offline',
  }));
}

export async function getLiveReporters() {
  const { rows } = await query(
    `SELECT r.id, r.email, r.name, s.id AS session_id, s.stream_name, s.started_at
       FROM reporters r
       JOIN stream_sessions s ON s.reporter_id = r.id AND s.ended_at IS NULL
       ORDER BY s.started_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    session_id: r.session_id,
    stream_name: r.stream_name,
    started_at: r.started_at,
    status: 'live',
    rtmp_url: `${RTMP_BASE}/${r.stream_name}_rtmp`,
    srt_url: SRT_BASE ? `${SRT_BASE}/${r.stream_name}_rtmp` : null,
    webrtc_url: `${OME_WS_BASE}/live/${r.stream_name}`,
  }));
}

export async function getStreams() {
  const { rows } = await query(
    `SELECT s.id, s.reporter_id, s.stream_name, s.started_at, s.ended_at, r.name AS reporter_name
       FROM stream_sessions s
       JOIN reporters r ON r.id = s.reporter_id
       ORDER BY s.started_at DESC
       LIMIT 100`
  );
  return rows.map((s) => ({
    id: s.id,
    reporter_id: s.reporter_id,
    reporter_name: s.reporter_name,
    stream_name: s.stream_name,
    started_at: s.started_at,
    ended_at: s.ended_at,
    is_live: !s.ended_at,
    rtmp_url: !s.ended_at ? `${RTMP_BASE}/${s.stream_name}_rtmp` : null,
    srt_url: !s.ended_at && SRT_BASE ? `${SRT_BASE}/${s.stream_name}_rtmp` : null,
    webrtc_url: !s.ended_at ? `${OME_WS_BASE}/live/${s.stream_name}` : null,
  }));
}

export async function getUploads(filters = {}) {
  let sql = `SELECT u.id, u.reporter_id, u.file_name, u.file_path, u.file_size, u.mime_type, u.created_at, r.name AS reporter_name
              FROM uploads u
              JOIN reporters r ON r.id = u.reporter_id
              WHERE 1=1`;
  const params = [];
  let i = 1;
  if (filters.reporter_id) {
    params.push(filters.reporter_id);
    sql += ` AND u.reporter_id = $${i++}`;
  }
  if (filters.from_date) {
    params.push(filters.from_date);
    sql += ` AND u.created_at >= $${i++}`;
  }
  if (filters.to_date) {
    params.push(filters.to_date);
    sql += ` AND u.created_at <= $${i++}`;
  }
  sql += ` ORDER BY u.created_at DESC LIMIT 200`;
  const { rows } = await query(sql, params);
  return rows;
}

export async function getUploadById(id) {
  const { rows } = await query(
    `SELECT u.id, u.reporter_id, u.file_name, u.file_path, u.file_size, u.mime_type, u.created_at, r.name AS reporter_name
       FROM uploads u
       JOIN reporters r ON r.id = u.reporter_id
       WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function getActivityFeed(limit = 50) {
  const { rows } = await query(
    `SELECT a.id,
            a.type,
            a.reporter_id,
            a.stream_session_id,
            a.upload_id,
            a.message,
            a.created_at,
            r.name AS reporter_name
       FROM activity_feed a
       LEFT JOIN reporters r ON r.id = a.reporter_id
       ORDER BY a.created_at DESC
       LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function startStreamSession(reporterId, streamName) {
  const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_STREAMS || 20);
  if (Number.isFinite(MAX_CONCURRENT) && MAX_CONCURRENT > 0) {
    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS cnt FROM stream_sessions WHERE ended_at IS NULL`,
      []
    );
    const current = countRows[0]?.cnt ?? 0;
    if (current >= MAX_CONCURRENT) {
      const err = new Error('MAX_STREAMS_REACHED');
      err.code = 'MAX_STREAMS_REACHED';
      throw err;
    }
  }

  await query(
    `UPDATE stream_sessions SET ended_at = NOW() WHERE reporter_id = $1 AND ended_at IS NULL`,
    [reporterId]
  );
  const { rows } = await query(
    `INSERT INTO stream_sessions (reporter_id, stream_name) VALUES ($1, $2)
     RETURNING id, reporter_id, stream_name, started_at`,
    [reporterId, streamName]
  );
  const session = rows[0];
  if (session) {
    await query(
      `INSERT INTO activity_feed (type, reporter_id, stream_session_id) VALUES ('went_live', $1, $2)`,
      [reporterId, session.id]
    );
  }
  return session;
}

export async function endStreamSession(reporterId, streamName) {
  const { rows } = await query(
    `UPDATE stream_sessions SET ended_at = NOW()
     WHERE reporter_id = $1 AND stream_name = $2 AND ended_at IS NULL
     RETURNING id, reporter_id, stream_name, started_at, ended_at`,
    [reporterId, streamName]
  );
  const session = rows[0];
  if (session) {
    await query(
      `INSERT INTO activity_feed (type, reporter_id, stream_session_id) VALUES ('stopped_stream', $1, $2)`,
      [reporterId, session.id]
    );
  }
  return session;
}

export async function createBreakingNews(reporterId, message) {
  const trimmed = (message || '').trim();
  if (!trimmed) {
    const err = new Error('Message is required');
    err.code = 'VALIDATION';
    throw err;
  }
  const { rows } = await query(
    `INSERT INTO activity_feed (type, reporter_id, message)
     VALUES ('breaking_news', $1, $2)
     RETURNING id, type, reporter_id, message, created_at`,
    [reporterId, trimmed.slice(0, 500)]
  );
  return rows[0];
}
