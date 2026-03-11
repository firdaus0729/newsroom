-- Reporter Portal: PostgreSQL schema for reporters
-- Run once: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS reporters (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reporters_email ON reporters (email);

-- Optional: stream_name could be reporter_${id} or custom per reporter
-- ALTER TABLE reporters ADD COLUMN IF NOT EXISTS stream_name VARCHAR(128);

COMMENT ON TABLE reporters IS 'Reporters who can log in and stream via the portal';
