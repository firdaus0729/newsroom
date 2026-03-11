import pg from 'pg';

const SCHEMA_SQL = `
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
