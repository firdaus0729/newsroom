# Reporter Portal – Setup Instructions

The Reporter Portal is a **mobile-friendly web app** for reporters to log in, **go live** via WebRTC to OvenMediaEngine, and watch the **studio return feed** while streaming.

## Architecture

- **Backend**: Node.js (Express), JWT auth, PostgreSQL (reporters table).
- **Frontend**: React (Vite), responsive UI for phones.
- **WebRTC**: Publisher (camera/mic → OvenMediaEngine), Player (return feed from OvenMediaEngine).

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** (local or Docker)
- **OvenMediaEngine** already running (e.g. from main project `docker compose up`)

## 1. Database (PostgreSQL)

Create a database and run the schema:

```bash
# Create DB (example)
createdb newsroom

# Set connection string (example)
export DATABASE_URL="postgresql://user:password@localhost:5432/newsroom"

# Run schema
psql "$DATABASE_URL" -f backend/schema.sql
```

### Optional: PostgreSQL via Docker

Add to your `docker-compose.yml` (or run standalone):

```yaml
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: newsroom
      POSTGRES_PASSWORD: newsroom
      POSTGRES_DB: newsroom
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
volumes:
  postgres_data:
```

Then:

```bash
export DATABASE_URL="postgresql://newsroom:newsroom@localhost:5432/newsroom"
docker compose up -d postgres
psql "$DATABASE_URL" -f backend/schema.sql
```

## 2. Backend (API)

```bash
cd backend
cp .env.example .env
# Edit .env: set PORT, DATABASE_URL, JWT_SECRET

npm install
npm run dev
```

Backend runs at **http://localhost:4000** (or `PORT` from `.env`).

### Seed a test reporter

```bash
cd backend
SEED_EMAIL=reporter@newsroom.local SEED_PASSWORD=reporter123 SEED_NAME="Test Reporter" node scripts/seed-reporter.js
```

### API endpoints

| Method | Path     | Auth | Description        |
|--------|----------|------|--------------------|
| POST   | /login   | No   | Email + password → JWT + reporter |
| GET    | /me      | Yes  | Current reporter (Bearer token)    |
| POST   | /logout  | Yes  | Logout (client discards token)     |

## 3. Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at **http://localhost:3000**. In dev, `/api` is proxied to the backend (see `vite.config.js`).

### Environment (optional)

Create `frontend/.env` if you need to override:

- `VITE_API_URL` – API base URL (default in dev: `/api` → backend)
- `VITE_OME_WS_URL` – OvenMediaEngine WebSocket URL (default: `ws(s)://current-host:3333`)
- `VITE_RETURN_FEED_STREAM` – Stream name for studio return feed (default: `program`)

## 4. Run everything from repo root

```bash
# One-time: install all dependencies
npm run install:all

# Start backend + frontend
npm run dev
```

- **Backend**: http://localhost:4000  
- **Frontend**: http://localhost:3000  

Log in with the seeded reporter, then use **GO LIVE** and the **Studio return feed** player.

## 5. WebRTC / OvenMediaEngine

- **Publisher (GO LIVE)**: Reporter stream is sent to OME at  
  `ws(s)://OME_HOST:3333/live/reporter_<id>?direction=send`  
  So stream name = `reporter_1`, `reporter_2`, etc. for reporter id 1, 2, …

- **Return feed**: Reporters watch the stream named **program** (or `VITE_RETURN_FEED_STREAM`).  
  The studio should push program output (e.g. RTMP or another WebRTC source) into OvenMediaEngine as the `program` stream so reporters see it in the “Studio return feed” player.

- **Mobile**: Use HTTPS in production so camera/mic and WebRTC work on Android. For local testing on a phone, use the same LAN and either HTTP (if the browser allows) or a tunnel (e.g. ngrok).

## 6. Project structure

```
frontend/                 # React reporter portal
  src/
    context/AuthContext.jsx
    hooks/useWebRTCPublisher.js   # OvenMediaEngine WebRTC publish
    hooks/useWebRTCPlayer.js     # OvenMediaEngine WebRTC play (return feed)
    pages/Login.jsx, Dashboard.jsx
    api.js, App.jsx, main.jsx
backend/
  src/
    index.js    # Express: /login, /me, /logout
    auth.js    # JWT, login, getReporterById
    db.js      # PostgreSQL pool
  schema.sql   # reporters table
  scripts/seed-reporter.js
```

## 7. Deployment notes

- Set **JWT_SECRET** and **DATABASE_URL** in production.
- Build frontend: `cd frontend && npm run build`; serve `frontend/dist` with nginx or your app server.
- Point frontend to backend via **VITE_API_URL** (e.g. `https://api.yourdomain.com`).
- Use **HTTPS** and a real hostname for OME so WebRTC works on mobile (and set **VITE_OME_WS_URL** if OME is on another host/port).
