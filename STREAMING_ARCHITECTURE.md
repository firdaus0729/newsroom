# Streaming Architecture (OME + Coturn + Recording & Monitoring)

## Overview

- **OvenMediaEngine (OME)**: WebRTC ingest from reporters, transcoding, RTMP push, optional recording, REST API for stats.
- **Coturn**: STUN/TURN server for NAT traversal so mobile reporters can connect from cellular/Wi‑Fi behind NAT/firewalls.
- **nginx-rtmp**: RTMP app for vMix/OBS (studio).
- **Web**: Static publisher/player and Reporter Portal assets.

## 1. STUN/TURN (Coturn)

### Role

- **STUN**: Helps clients discover their public IP and port (NAT traversal).
- **TURN**: Relays media when peer-to-peer/OME direct fails (symmetric NAT, strict firewalls).

Reporters (browser/mobile) use ICE servers in this order: STUN (Coturn) → TURN (Coturn). OME uses Coturn for STUN (`StunServer=coturn:3478`). OME’s embedded TURN runs on **3479** so Coturn can use **3478**.

### Docker

- **Service**: `coturn` (image `coturn/coturn:4.6.3`).
- **Config**: `coturn/turnserver.conf` (realm, static user `reporter`/`reporter123`, relay range 49152–49251).

### Ports

| Port        | Protocol | Service | Purpose                |
|------------|----------|---------|------------------------|
| **3478**   | UDP/TCP  | Coturn  | STUN/TURN              |
| **49152–49251** | UDP | Coturn  | TURN relay (media)     |

### Production

Set your server’s **public IP** so TURN works for external reporters:

```bash
# .env or export
TURN_EXTERNAL_IP=203.0.113.10
```

Then in `docker-compose` the Coturn command uses `--external-ip=${TURN_EXTERNAL_IP}/0.0.0.0`.

### Reporter Portal (ICE)

The Reporter Portal builds `iceServers` from:

- **STUN**: `stun:${host}:3478` (Coturn).
- **TURN**: `turn:${host}:3478` and `turn:${host}:3478?transport=tcp` with username/credential.

Host is from `VITE_TURN_HOST` or current window hostname. Credentials: `VITE_TURN_USER` / `VITE_TURN_PASSWORD` (default `reporter` / `reporter123`, must match `coturn/turnserver.conf`).

Example for production:

```env
VITE_TURN_HOST=stream.yourdomain.com
VITE_TURN_USER=reporter
VITE_TURN_PASSWORD=your_secure_turn_password
```

So reporters connect using STUN/TURN to your Coturn on 3478, then OME on 3333 (signalling) and 10000–10019 (media).

---

## 2. Optimizations for 20 Concurrent WebRTC Publishers

- **WebRTC signalling**: `WorkerCount` 4 (in both Providers and Publishers).
- **ICE**: 20 UDP ports `10000–10019` (one per publisher).
- **Decodes**: `ThreadCount` 8 for decoding incoming WebRTC.
- **OME limits**: CPU 14 cores, 28 GB RAM (docker-compose); adjust for your host.
- **Coturn**: 100 relay ports (49152–49251); enough for 20+ TURN allocations.

---

## 3. Stream Recording (OME)

- **Config**: `Server.xml` includes `<FILE>` publisher with `RootPath`, `FilePath`, `InfoPath`.
- **Storage**: Docker volume `ome_records` → `/var/lib/ovenmediaengine/records`.
- **Control**: Start/stop via OME REST API (see [Recording API](https://docs.ovenmediaengine.com/dev/rest-api/v1/virtualhost/application/recording)).
- **Auth**: API uses Basic auth token (e.g. `ome-admin:changeme` in `Server.xml`; change in production).

Example (start recording for stream `reporter_1` in app `live`, vhost `*`):

```bash
curl -u "ome-admin:changeme" -X POST "http://localhost:9999/v1/vhosts/*/apps/live/streams/reporter_1/recording/start" \
  -H "Content-Type: application/json" \
  -d '{"outputPath":"/var/lib/ovenmediaengine/records"}'
```

---

## 4. Monitoring

### Options

1. **OME REST API** (stats: streams, connections, throughput)  
   - Base URL: `http://localhost:9999` (API enabled in `Server.xml`).  
   - Example: `GET /v1/stats/current/vhosts/default` (or vhost `*`).  
   - Auth: Basic `ome-admin:changeme`.

2. **Script**  
   - `scripts/monitor-streaming.sh [OME_BASE_URL]`  
   - Prints host CPU/memory, OME stats (if API reachable), Docker container stats, and ports in use.

3. **Host**  
   - CPU/memory: `top`, `free`, `docker stats`.  
   - Bandwidth: host/VM metrics or `ss`/`netstat` for listening ports.

### Ports summary (all services)

| Port        | Protocol | Service     | Purpose                    |
|------------|----------|-------------|----------------------------|
| 80, 443    | TCP      | web         | HTTP/HTTPS                 |
| 1935       | TCP      | nginx-rtmp  | RTMP                       |
| 3333, 3334 | TCP      | OME         | WebRTC signalling          |
| 3478       | UDP/TCP  | Coturn      | STUN/TURN                  |
| 3479       | TCP      | OME         | OME embedded TURN          |
| 49152–49251| UDP      | Coturn      | TURN relay                 |
| 9999       | TCP      | OME         | REST API (stats, recording)|
| 10000–10019| UDP      | OME         | WebRTC ICE (20 publishers) |

---

## 5. Docker Compose Layout

- **coturn**: STUN/TURN (3478, 49152–49251).
- **ovenmediaengine**: Ingest, transcoding, push, recording, API (3333, 3334, 3479, 9999, 10000–10019).
- **rtmp**: nginx-rtmp (1935).
- **web**: Static + Reporter Portal (80, 443).
- **nginx-proxy** (optional): Reverse proxy in front of web + OME (example in `nginx-proxy/`).

To use optional Nginx reverse proxy, uncomment the `nginx-proxy` service in `docker-compose.yml`, add `nginx-proxy/nginx.conf` and certs under `nginx-proxy/certs/`, and point public 80/443 to the proxy.
