import crypto from 'crypto';
import { query } from './db.js';

const EVENT_BATCH_SIZE = Number(process.env.AUTOMATION_EVENT_BATCH_SIZE || 10);
const JOB_BATCH_SIZE = Number(process.env.AUTOMATION_JOB_BATCH_SIZE || 5);
const WORKER_INTERVAL_MS = Number(process.env.AUTOMATION_WORKER_INTERVAL_MS || 4000);
const MAX_EVENT_ATTEMPTS = Number(process.env.AUTOMATION_EVENT_MAX_ATTEMPTS || 5);
const DEFAULT_JOB_RETRY_DELAY_MS = Number(process.env.AUTOMATION_JOB_RETRY_DELAY_MS || 10000);

let workerTimer = null;
let running = false;

function nowPlusMs(ms) {
  return new Date(Date.now() + ms);
}

function checksumForText(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

export async function enqueueAutomationEvent(eventType, payload, idempotencyKey = null) {
  await query(
    `INSERT INTO automation_events (event_type, payload, idempotency_key, status, available_at)
     VALUES ($1, $2::jsonb, $3, 'pending', NOW())
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [eventType, JSON.stringify(payload || {}), idempotencyKey]
  );
}

async function markStoryStatus(storyId, status) {
  await query(
    `UPDATE stories SET status = $2, updated_at = NOW() WHERE id = $1`,
    [storyId, status]
  );
}

async function emitJobEvent(jobId, storyId, eventType, message, payload = {}) {
  await query(
    `INSERT INTO job_events (job_id, story_id, event_type, message, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [jobId, storyId, eventType, message || null, JSON.stringify(payload || {})]
  );
}

async function enqueueProcessingJob({
  storyId,
  jobType,
  priority = 5,
  inputAssetId = null,
  payload = {},
  idempotencyKey = null,
}) {
  await query(
    `INSERT INTO processing_jobs
       (story_id, job_type, status, priority, input_asset_id, payload, idempotency_key, available_at)
     VALUES ($1, $2, 'queued', $3, $4, $5::jsonb, $6, NOW())
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [storyId, jobType, priority, inputAssetId, JSON.stringify(payload || {}), idempotencyKey]
  );
}

async function handleUploadCompleted(payload) {
  const uploadId = Number(payload?.upload_id);
  if (!uploadId) throw new Error('upload_id missing');

  const existing = await query(`SELECT id FROM stories WHERE source_upload_id = $1`, [uploadId]);
  if (existing.rows[0]) return;

  const uploadQ = await query(
    `SELECT u.id, u.reporter_id, u.file_name, u.file_path, u.file_size, u.mime_type, u.created_at, r.name AS reporter_name
     FROM uploads u
     LEFT JOIN reporters r ON r.id = u.reporter_id
     WHERE u.id = $1`,
    [uploadId]
  );
  const upload = uploadQ.rows[0];
  if (!upload) throw new Error('upload not found');

  const title = `Story from ${upload.reporter_name || `Reporter ${upload.reporter_id}`}`;
  const storyRes = await query(
    `INSERT INTO stories (title, reporter_id, source_type, source_upload_id, status, priority)
     VALUES ($1, $2, 'upload', $3, 'uploaded', 5)
     RETURNING id`,
    [title, upload.reporter_id, upload.id]
  );
  const storyId = storyRes.rows[0].id;

  const rawAsset = await query(
    `INSERT INTO story_assets
       (story_id, asset_type, file_path, file_name, mime_type, metadata, checksum)
     VALUES ($1, 'raw_video', $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      storyId,
      upload.file_path,
      upload.file_name,
      upload.mime_type || 'application/octet-stream',
      JSON.stringify({
        upload_id: upload.id,
        file_size: upload.file_size || null,
        upload_created_at: upload.created_at,
      }),
      checksumForText(`${upload.id}:${upload.file_name}:${upload.file_path}`),
    ]
  );

  await enqueueProcessingJob({
    storyId,
    jobType: 'metadata_extraction',
    inputAssetId: rawAsset.rows[0].id,
    idempotencyKey: `story:${storyId}:metadata_extraction`,
  });
}

async function processOneEvent() {
  const claim = await query(
    `UPDATE automation_events
     SET status = 'processing', attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = (
       SELECT id
       FROM automation_events
       WHERE status IN ('pending', 'retrying') AND available_at <= NOW()
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, event_type, payload, attempt_count`
  );
  const event = claim.rows[0];
  if (!event) return false;

  try {
    if (event.event_type === 'upload_completed' || event.event_type === 'live_recording_completed') {
      await handleUploadCompleted(event.payload || {});
    } else {
      throw new Error(`Unsupported event_type: ${event.event_type}`);
    }

    await query(
      `UPDATE automation_events
       SET status = 'completed', processed_at = NOW(), updated_at = NOW(), last_error = NULL
       WHERE id = $1`,
      [event.id]
    );
  } catch (e) {
    const attempts = Number(event.attempt_count || 0) + 1;
    const failed = attempts >= MAX_EVENT_ATTEMPTS;
    await query(
      `UPDATE automation_events
       SET status = $2,
           available_at = $3,
           last_error = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [
        event.id,
        failed ? 'failed' : 'retrying',
        failed ? new Date() : nowPlusMs(DEFAULT_JOB_RETRY_DELAY_MS),
        String(e.message || e),
      ]
    );
  }
  return true;
}

async function createSyntheticTranscript(storyId) {
  const text =
    'Auto transcript placeholder. Replace with real ASR integration in production. This transcript allows downstream highlight and clip workflow to function.';
  const transcriptJson = {
    language: 'en',
    segments: [{ start: 0, end: 20, text }],
  };

  const textAsset = await query(
    `INSERT INTO story_assets (story_id, asset_type, file_path, file_name, mime_type, metadata, checksum)
     VALUES ($1, 'transcript_text', $2, $3, 'text/plain', '{}'::jsonb, $4)
     RETURNING id`,
    [storyId, `generated://stories/${storyId}/transcript.txt`, `story_${storyId}_transcript.txt`, checksumForText(text)]
  );
  await query(
    `INSERT INTO story_assets (story_id, asset_type, file_path, file_name, mime_type, metadata, checksum)
     VALUES ($1, 'transcript_json', $2, $3, 'application/json', $4::jsonb, $5)`,
    [
      storyId,
      `generated://stories/${storyId}/transcript.json`,
      `story_${storyId}_transcript.json`,
      JSON.stringify(transcriptJson),
      checksumForText(JSON.stringify(transcriptJson)),
    ]
  );
  await query(
    `INSERT INTO transcript_segments (story_id, start_seconds, end_seconds, speaker, text, confidence)
     VALUES ($1, 0, 20, 'reporter', $2, 0.7500)`,
    [storyId, text]
  );
  return textAsset.rows[0].id;
}

async function createInitialClipSuggestions(storyId, jobId) {
  const presets = [
    { clip_preset: 'breaking_16_9', title: 'Breaking Clip', start: 0, end: 30, score: 0.89 },
    { clip_preset: 'sixty_sec_16_9', title: '60 Second Clip', start: 0, end: 60, score: 0.83 },
    { clip_preset: 'vertical_reel_9_16', title: 'Vertical Reel', start: 5, end: 35, score: 0.8 },
  ];
  for (const p of presets) {
    await query(
      `INSERT INTO generated_clips
         (story_id, clip_preset, title, start_seconds, end_seconds, score, status, created_by_job_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'suggested', $7)`,
      [storyId, p.clip_preset, p.title, p.start, p.end, p.score, jobId]
    );
  }
}

async function materializeClipAssets(storyId) {
  const clipsQ = await query(
    `SELECT id, clip_preset, title FROM generated_clips WHERE story_id = $1 ORDER BY id`,
    [storyId]
  );
  for (const c of clipsQ.rows) {
    const asset = await query(
      `INSERT INTO story_assets
         (story_id, asset_type, file_path, file_name, mime_type, metadata, checksum)
       VALUES ($1, 'clip_video', $2, $3, 'video/mp4', $4::jsonb, $5)
       RETURNING id`,
      [
        storyId,
        `generated://stories/${storyId}/clip_${c.id}.mp4`,
        `${c.clip_preset}_${storyId}.mp4`,
        JSON.stringify({ clip_id: c.id, synthetic: true }),
        checksumForText(`${storyId}:${c.id}:clip`),
      ]
    );
    await query(
      `UPDATE generated_clips SET asset_id = $2, status = 'rendered', updated_at = NOW() WHERE id = $1`,
      [c.id, asset.rows[0].id]
    );
  }
}

async function createSubtitleAsset(storyId) {
  const srt = `1
00:00:00,000 --> 00:00:06,000
Auto-generated subtitle placeholder for Story ${storyId}.
`;
  await query(
    `INSERT INTO story_assets
       (story_id, asset_type, file_path, file_name, mime_type, metadata, checksum)
     VALUES ($1, 'subtitle_srt', $2, $3, 'application/x-subrip', '{}'::jsonb, $4)`,
    [
      storyId,
      `generated://stories/${storyId}/subtitles.srt`,
      `${storyId}.srt`,
      checksumForText(srt),
    ]
  );
}

async function processOneJob() {
  const claim = await query(
    `UPDATE processing_jobs
     SET status = 'running', started_at = NOW(), heartbeat_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = (
       SELECT id
       FROM processing_jobs
       WHERE status IN ('queued', 'retrying') AND available_at <= NOW()
       ORDER BY priority ASC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, story_id, job_type, input_asset_id, attempt_count, max_attempts, payload`
  );
  const job = claim.rows[0];
  if (!job) return false;
  await emitJobEvent(job.id, job.story_id, 'started', `${job.job_type} started`);

  try {
    if (job.job_type === 'metadata_extraction') {
      await markStoryStatus(job.story_id, 'transcribing');
      await enqueueProcessingJob({
        storyId: job.story_id,
        jobType: 'transcription',
        idempotencyKey: `story:${job.story_id}:transcription`,
      });
    } else if (job.job_type === 'transcription') {
      await createSyntheticTranscript(job.story_id);
      await markStoryStatus(job.story_id, 'transcript_ready');
      await enqueueProcessingJob({
        storyId: job.story_id,
        jobType: 'highlight_detection',
        idempotencyKey: `story:${job.story_id}:highlight_detection`,
      });
    } else if (job.job_type === 'highlight_detection') {
      await createInitialClipSuggestions(job.story_id, job.id);
      await enqueueProcessingJob({
        storyId: job.story_id,
        jobType: 'clip_generation',
        idempotencyKey: `story:${job.story_id}:clip_generation`,
      });
    } else if (job.job_type === 'clip_generation') {
      await materializeClipAssets(job.story_id);
      await enqueueProcessingJob({
        storyId: job.story_id,
        jobType: 'subtitle_render',
        idempotencyKey: `story:${job.story_id}:subtitle_render`,
      });
    } else if (job.job_type === 'subtitle_render') {
      await createSubtitleAsset(job.story_id);
      await markStoryStatus(job.story_id, 'under_review');
    } else {
      throw new Error(`Unknown job_type: ${job.job_type}`);
    }

    await query(
      `UPDATE processing_jobs
       SET status = 'completed', completed_at = NOW(), heartbeat_at = NOW(), updated_at = NOW(), error_log = NULL
       WHERE id = $1`,
      [job.id]
    );
    await emitJobEvent(job.id, job.story_id, 'completed', `${job.job_type} completed`);
  } catch (e) {
    const attempts = Number(job.attempt_count || 0) + 1;
    const failed = attempts >= Number(job.max_attempts || 3);
    await query(
      `UPDATE processing_jobs
       SET status = $2,
           error_log = $3,
           available_at = $4,
           heartbeat_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [job.id, failed ? 'failed' : 'retrying', String(e.message || e), failed ? new Date() : nowPlusMs(DEFAULT_JOB_RETRY_DELAY_MS)]
    );
    await markStoryStatus(job.story_id, failed ? 'failed' : 'processing_retry');
    await emitJobEvent(job.id, job.story_id, failed ? 'failed' : 'retrying', String(e.message || e));
  }
  return true;
}

async function sweepStaleRunningJobs() {
  await query(
    `UPDATE processing_jobs
     SET status = 'retrying',
         available_at = NOW() + INTERVAL '10 seconds',
         error_log = COALESCE(error_log, '') || E'\\nRecovered stale running job',
         updated_at = NOW()
     WHERE status = 'running' AND heartbeat_at < NOW() - INTERVAL '90 seconds'`
  );
}

async function workerTick() {
  if (running) return;
  running = true;
  try {
    await sweepStaleRunningJobs();
    for (let i = 0; i < EVENT_BATCH_SIZE; i += 1) {
      const had = await processOneEvent();
      if (!had) break;
    }
    for (let i = 0; i < JOB_BATCH_SIZE; i += 1) {
      const had = await processOneJob();
      if (!had) break;
    }
  } catch (e) {
    console.warn('Automation worker tick error:', e.message);
  } finally {
    running = false;
  }
}

export function startAutomationWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(workerTick, Math.max(1000, WORKER_INTERVAL_MS));
  workerTick().catch(() => {});
}

export async function listStories({ status, reporter_id, limit = 50, offset = 0 } = {}) {
  const params = [];
  let i = 1;
  let where = 'WHERE 1=1';
  if (status) {
    params.push(status);
    where += ` AND s.status = $${i++}`;
  }
  if (reporter_id) {
    params.push(Number(reporter_id));
    where += ` AND s.reporter_id = $${i++}`;
  }
  params.push(Math.min(Number(limit) || 50, 200));
  params.push(Math.max(Number(offset) || 0, 0));

  const { rows } = await query(
    `SELECT s.id, s.external_story_id, s.title, s.location, s.reporter_id, r.name AS reporter_name,
            s.source_type, s.source_upload_id, s.status, s.priority, s.language, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM processing_jobs j WHERE j.story_id = s.id AND j.status IN ('queued','retrying','running'))::int AS pending_jobs,
            (SELECT COUNT(*) FROM generated_clips c WHERE c.story_id = s.id)::int AS clip_count
       FROM stories s
       LEFT JOIN reporters r ON r.id = s.reporter_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
    params
  );
  return rows;
}

export async function getStoryDetails(storyId) {
  const storyQ = await query(
    `SELECT s.*, r.name AS reporter_name
     FROM stories s
     LEFT JOIN reporters r ON r.id = s.reporter_id
     WHERE s.id = $1`,
    [storyId]
  );
  const story = storyQ.rows[0];
  if (!story) return null;

  const [assets, jobs, clips, segments, reviews, events] = await Promise.all([
    query(`SELECT * FROM story_assets WHERE story_id = $1 ORDER BY created_at DESC`, [storyId]),
    query(`SELECT * FROM processing_jobs WHERE story_id = $1 ORDER BY created_at DESC`, [storyId]),
    query(`SELECT * FROM generated_clips WHERE story_id = $1 ORDER BY created_at DESC`, [storyId]),
    query(`SELECT * FROM transcript_segments WHERE story_id = $1 ORDER BY start_seconds ASC`, [storyId]),
    query(`SELECT * FROM clip_reviews WHERE story_id = $1 ORDER BY created_at DESC`, [storyId]),
    query(`SELECT * FROM job_events WHERE story_id = $1 ORDER BY created_at DESC LIMIT 200`, [storyId]),
  ]);

  return {
    story,
    assets: assets.rows,
    jobs: jobs.rows,
    clips: clips.rows,
    transcript_segments: segments.rows,
    clip_reviews: reviews.rows,
    job_events: events.rows,
  };
}

export async function retryStoryJob(storyId, jobId) {
  const { rows } = await query(
    `UPDATE processing_jobs
     SET status = 'queued', error_log = NULL, available_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND story_id = $2
     RETURNING *`,
    [jobId, storyId]
  );
  return rows[0] || null;
}

export async function reviewClip({ storyId, clipId, action, reviewerRole, reviewerId, note }) {
  const normalizedAction = action === 'approve' ? 'approved' : 'rejected';
  const { rows } = await query(
    `UPDATE generated_clips
     SET status = $3, review_note = $4, updated_at = NOW()
     WHERE id = $1 AND story_id = $2
     RETURNING *`,
    [clipId, storyId, normalizedAction, note || null]
  );
  const clip = rows[0];
  if (!clip) return null;
  await query(
    `INSERT INTO clip_reviews (clip_id, story_id, reviewer_role, reviewer_id, action, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [clipId, storyId, reviewerRole || 'editor', reviewerId || null, action, note || null]
  );

  const pendingQ = await query(
    `SELECT COUNT(*)::int AS cnt FROM generated_clips WHERE story_id = $1 AND status IN ('suggested', 'rendered')`,
    [storyId]
  );
  const pending = pendingQ.rows[0]?.cnt || 0;
  await markStoryStatus(storyId, pending === 0 ? 'approved' : 'under_review');
  return clip;
}

export async function getQueueHealth() {
  const [events, jobs] = await Promise.all([
    query(
      `SELECT status, COUNT(*)::int AS count
       FROM automation_events
       GROUP BY status
       ORDER BY status`,
      []
    ),
    query(
      `SELECT status, COUNT(*)::int AS count
       FROM processing_jobs
       GROUP BY status
       ORDER BY status`,
      []
    ),
  ]);
  return {
    events: events.rows,
    jobs: jobs.rows,
    worker_interval_ms: Math.max(1000, WORKER_INTERVAL_MS),
    timestamp: new Date().toISOString(),
  };
}
