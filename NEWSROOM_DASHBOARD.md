# Newsroom Dashboard (Editors)

Web dashboard for newsroom staff to monitor reporters, preview live streams, and manage uploaded clips.

## Stack

- **Frontend**: React (Vite), React Router
- **Backend**: Same Node.js (Express) API as Reporter Portal; dashboard routes under `/dashboard/*`
- **Database**: PostgreSQL (editors, stream_sessions, uploads, activity_feed)

## Setup

### 1. Database

Schema is applied automatically on backend start (see `backend/src/ensureDb.js`). New tables: `editors`, `stream_sessions`, `uploads`, `activity_feed`.

### 2. Seed an editor

```bash
cd backend
SEED_EDITOR_EMAIL=editor@newsroom.local SEED_EDITOR_PASSWORD=editor123 node scripts/seed-editor.js
```

### 3. Run dashboard

```bash
# From repo root (backend must be running on port 4000)
npm run dev:dashboard
```

Dashboard runs at **http://localhost:3001**. Proxy forwards `/api` to the backend.

### 4. Reporter Portal → Backend

When reporters go live or stop, the Reporter Portal calls `POST /streams/start` and `POST /streams/stop` (with reporter JWT). That populates `stream_sessions` and `activity_feed`. Ensure the reporter frontend uses the same API base URL so those calls succeed.

## Features

- **Reporters**: List all reporters with status (Live / Offline), stream duration, and actions (View Stream, Copy RTMP URL).
- **Live Streams**: List currently live reporters; preview via WebRTC player; copy RTMP URL for Wirecast.
- **Uploaded Clips**: Filter by reporter and date; download clips. (Uploads are stored in DB + files in `UPLOADS_DIR`; add clips via API or sync from OME recordings.)
- **Activity Feed**: Recent events (went live, stopped stream, clip uploaded).

## API (editor auth: `Authorization: Bearer <token>`)

| Method | Path | Description |
|--------|------|-------------|
| POST | /dashboard/login | Editor login → token |
| GET | /dashboard/reporters | All reporters with status and live info |
| GET | /dashboard/reporters/live | Currently live reporters |
| GET | /dashboard/streams | Stream sessions (recent) |
| GET | /dashboard/uploads | Uploads (query: reporter_id, from_date, to_date) |
| GET | /dashboard/uploads/:id | One upload metadata |
| GET | /dashboard/uploads/:id/download | Download file |
| GET | /dashboard/activity | Activity feed (query: limit) |

## Env (dashboard)

- `VITE_API_URL`: API base (default in dev: `/api` proxied to backend).
- `VITE_OME_WS_URL`: WebRTC signalling base for previews (default: `ws(s)://hostname:3333`).

## Optimizing for 5 editors

- Polling intervals: Reporters list 10s, Live streams 5s. Adjust in the dashboard components if needed.
- Backend: Stateless; scale with more instances behind a load balancer if required.
- DB: Indexes on `stream_sessions(reporter_id, ended_at)`, `uploads(reporter_id, created_at)`, `activity_feed(created_at)` are in the schema.
