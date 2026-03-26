import pg from 'pg';

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS reporters (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reporters_email ON reporters (email);

CREATE TABLE IF NOT EXISTS editors (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_editors_email ON editors (email);

CREATE TABLE IF NOT EXISTS stream_sessions (
  id          SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES reporters(id) ON DELETE CASCADE,
  stream_name VARCHAR(128) NOT NULL,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  ended_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_reporter ON stream_sessions (reporter_id);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_ended ON stream_sessions (ended_at) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS uploads (
  id          SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES reporters(id) ON DELETE CASCADE,
  file_name   VARCHAR(512) NOT NULL,
  file_path   VARCHAR(1024) NOT NULL,
  file_size   BIGINT,
  mime_type   VARCHAR(128),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uploads_reporter ON uploads (reporter_id);
CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads (created_at);

CREATE TABLE IF NOT EXISTS activity_feed (
  id                SERIAL PRIMARY KEY,
  type              VARCHAR(32) NOT NULL,
  reporter_id       INTEGER REFERENCES reporters(id) ON DELETE SET NULL,
  stream_session_id INTEGER REFERENCES stream_sessions(id) ON DELETE SET NULL,
  upload_id         INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_feed_created ON activity_feed (created_at DESC);
ALTER TABLE activity_feed ADD COLUMN IF NOT EXISTS message TEXT;

-- Module 2: durable events + story-centric automation
CREATE TABLE IF NOT EXISTS automation_events (
  id               BIGSERIAL PRIMARY KEY,
  event_type       VARCHAR(64) NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key  VARCHAR(255),
  status           VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  available_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_events_idempotency
  ON automation_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_events_pending
  ON automation_events (status, available_at, created_at);

CREATE TABLE IF NOT EXISTS stories (
  id                BIGSERIAL PRIMARY KEY,
  external_story_id UUID NOT NULL DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL DEFAULT 'Untitled story',
  location          TEXT,
  reporter_id       INTEGER REFERENCES reporters(id) ON DELETE SET NULL,
  source_type       VARCHAR(32) NOT NULL,
  source_upload_id  INTEGER REFERENCES uploads(id) ON DELETE SET NULL,
  status            VARCHAR(32) NOT NULL DEFAULT 'uploaded',
  priority          SMALLINT NOT NULL DEFAULT 5,
  language          VARCHAR(16) NOT NULL DEFAULT 'en',
  editor_notes      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stories_external_story_id ON stories (external_story_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stories_source_upload ON stories (source_upload_id) WHERE source_upload_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stories_status_priority ON stories (status, priority, created_at DESC);

CREATE TABLE IF NOT EXISTS story_assets (
  id               BIGSERIAL PRIMARY KEY,
  story_id         BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  asset_type       VARCHAR(32) NOT NULL,
  file_path        TEXT NOT NULL,
  file_name        TEXT,
  mime_type        VARCHAR(128),
  duration_seconds NUMERIC(10,2),
  resolution       VARCHAR(32),
  checksum         VARCHAR(128),
  version          INTEGER NOT NULL DEFAULT 1,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_story_assets_story_type ON story_assets (story_id, asset_type, created_at DESC);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id               BIGSERIAL PRIMARY KEY,
  story_id         BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  job_type         VARCHAR(64) NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'queued',
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  priority         SMALLINT NOT NULL DEFAULT 5,
  input_asset_id   BIGINT REFERENCES story_assets(id) ON DELETE SET NULL,
  output_asset_id  BIGINT REFERENCES story_assets(id) ON DELETE SET NULL,
  idempotency_key  VARCHAR(255),
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_log        TEXT,
  available_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  heartbeat_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_jobs_idempotency
  ON processing_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_processing_jobs_queue
  ON processing_jobs (status, priority, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_story ON processing_jobs (story_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id               BIGSERIAL PRIMARY KEY,
  story_id         BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  start_seconds    NUMERIC(10,2) NOT NULL,
  end_seconds      NUMERIC(10,2) NOT NULL,
  speaker          VARCHAR(64),
  text             TEXT NOT NULL,
  confidence       NUMERIC(5,4),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_story ON transcript_segments (story_id, start_seconds);

CREATE TABLE IF NOT EXISTS generated_clips (
  id               BIGSERIAL PRIMARY KEY,
  story_id         BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  clip_preset      VARCHAR(32) NOT NULL,
  title            TEXT NOT NULL,
  start_seconds    NUMERIC(10,2) NOT NULL DEFAULT 0,
  end_seconds      NUMERIC(10,2) NOT NULL DEFAULT 0,
  score            NUMERIC(5,2),
  status           VARCHAR(16) NOT NULL DEFAULT 'suggested',
  asset_id         BIGINT REFERENCES story_assets(id) ON DELETE SET NULL,
  review_note      TEXT,
  created_by_job_id BIGINT REFERENCES processing_jobs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_generated_clips_story ON generated_clips (story_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clip_reviews (
  id               BIGSERIAL PRIMARY KEY,
  clip_id          BIGINT NOT NULL REFERENCES generated_clips(id) ON DELETE CASCADE,
  story_id         BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  reviewer_role    VARCHAR(16) NOT NULL,
  reviewer_id      VARCHAR(64),
  action           VARCHAR(16) NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clip_reviews_story ON clip_reviews (story_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_events (
  id               BIGSERIAL PRIMARY KEY,
  job_id           BIGINT REFERENCES processing_jobs(id) ON DELETE CASCADE,
  story_id         BIGINT REFERENCES stories(id) ON DELETE CASCADE,
  event_type       VARCHAR(32) NOT NULL,
  message          TEXT,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_events_story ON job_events (story_id, created_at DESC);
`;

function getDefaultDbUrl(urlString) {
  try {
    const u = new URL(urlString);
    u.pathname = '/postgres';
    return u.toString();
  } catch {
    return null;
  }
}

function getDbName(urlString) {
  try {
    const u = new URL(urlString);
    const name = u.pathname.slice(1).split('?')[0];
    return name || 'postgres';
  } catch {
    return null;
  }
}

export async function ensureDatabaseAndSchema() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('DATABASE_URL not set; skipping database auto-setup.');
    return;
  }

  const dbName = getDbName(url);
  const defaultUrl = getDefaultDbUrl(url);
  if (!dbName || dbName === 'postgres' || !defaultUrl) {
    // Already connecting to postgres or invalid URL; just run schema
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query(SCHEMA_SQL);
      console.log('Schema applied.');
    } catch (e) {
      console.error('Schema apply failed:', e.message);
      throw e;
    } finally {
      await client.end();
    }
    return;
  }

  const adminClient = new pg.Client({ connectionString: defaultUrl });
  try {
    await adminClient.connect();
    const { rows } = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );
    if (rows.length === 0) {
      const safeName = dbName.replace(/"/g, '""');
      await adminClient.query(`CREATE DATABASE "${safeName}"`);
      console.log(`Database "${dbName}" created.`);
    }
  } catch (e) {
    console.warn('Database create check failed (DB may already exist):', e.message);
    // Continue to schema step; target DB might already exist
  } finally {
    await adminClient.end();
  }

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(SCHEMA_SQL);
    console.log('Schema applied.');
  } catch (e) {
    console.error('Schema apply failed:', e.message);
    throw e;
  } finally {
    await client.end();
  }
}
