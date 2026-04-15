# Newsroom Live Streaming – Deployment Guide

Low-latency WebRTC ingest from smartphones, SRT output for Wirecast/OBS. Up to 20 concurrent reporters, &lt;2s latency target.

---

## 1. Architecture

```
Reporter (Android/browser) --WebRTC--> OvenMediaEngine
         |                            (STUN: Coturn)
         +-- STUN/TURN (Coturn:3478) --+
                                        \
                                         +--> Wirecast / OBS Studio via SRT pull
```

- **Coturn**: STUN/TURN for NAT traversal so mobile reporters can connect from cellular/Wi‑Fi.
- **OvenMediaEngine**: WebRTC ingest (reporters), provides SRT endpoints for studio clients, optional recording; REST API for stats.
- **Web server**: Serves the publisher and player pages.

See **[STREAMING_ARCHITECTURE.md](STREAMING_ARCHITECTURE.md)** for STUN/TURN, recording, and monitoring.

---

## 2. Network Ports and Firewall

Open these ports on the cloud server and in any host firewall (e.g. `ufw`).

| Port    | Protocol | Service        | Purpose                          |
|---------|----------|----------------|----------------------------------|
| **80**  | TCP      | nginx (web)    | Publisher/player pages           |
| **443** | TCP      | nginx (web)    | HTTPS (recommended in production)|
| **3333**| TCP      | OvenMediaEngine| WebRTC signalling (HTTP/WS)      |
| **3334**| TCP      | OvenMediaEngine| WebRTC signalling TLS (if used)   |
| **3478**| UDP/TCP  | **Coturn**     | STUN/TURN (reporters NAT)        |
| **3479**| TCP      | OvenMediaEngine| OME embedded TURN               |
| **49152–49251** | UDP | **Coturn** | TURN relay ports          |
| **9999**| UDP/TCP  | OvenMediaEngine| SRT ingest/output + REST API     |
| **10000–10019** | UDP | OvenMediaEngine| WebRTC ICE (20 streams)    |

### Example: UFW (Linux)

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3333/tcp
sudo ufw allow 3334/tcp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 3479/tcp
sudo ufw allow 9999/tcp
sudo ufw allow 9999/udp
sudo ufw allow 49152:49251/udp
sudo ufw allow 10000:10019/udp
sudo ufw enable
```

---

## 3. Server Configuration (16 CPU / 32 GB RAM)

The included `docker-compose.yml` already sets:

- **OvenMediaEngine**: up to 14 CPUs, 28 GB RAM (reservation 4 CPU, 4 GB).
- **Web**: default nginx limits.

Tuning for 20 concurrent streams:

- **OME** `ome/conf/Server.xml`: decoder `ThreadCount` 8; WebRTC signalling `WorkerCount` 4; ICE ports 10000–10019 (20 UDP); SRT provider enabled on port 9999.
- **Coturn**: `coturn/turnserver.conf`; set `TURN_EXTERNAL_IP` to your server’s public IP in production so reporters can use TURN.
- **Recording**: OME FILE publisher enabled; start/stop via REST API on port 9999 (see STREAMING_ARCHITECTURE.md).
- **Monitoring**: OME stats via `GET /v1/stats/current/...` (port 9999, Basic auth); optional script `scripts/monitor-streaming.sh`.

---

## 4. Step-by-Step Deployment

### 4.1 Clone or copy the project

```bash
cd /opt   # or your preferred path
# Copy the project files (docker-compose.yml, ome/, web/)
```

### 4.2 Set the server’s public IP (production)

Edit `docker-compose.yml` and set the host IP so WebRTC ICE works correctly:

```yaml
environment:
  OME_HOST_IP: "YOUR_SERVER_PUBLIC_IP"
```

Replace `YOUR_SERVER_PUBLIC_IP` (e.g. `95.216.x.x` on Hetzner).

### 4.3 Create OME logs directory

```bash
mkdir -p ome/logs
```

### 4.4 Start the stack

```bash
docker compose up -d
```

### 4.5 Check services

```bash
docker compose ps
docker compose logs -f ovenmediaengine   # check OME startup
```

If OME fails to start, check `ome/logs/ovenmediaengine.log` and that `ome/conf/Server.xml` is valid (e.g. no missing XML or wrong paths).

---

## 5. Testing the Stream Locally

### 5.1 Reporter (publisher)

1. On the same network as the server, open: `http://YOUR_SERVER_IP/publisher.html`
2. Set **Server URL** to `ws://YOUR_SERVER_IP:3333` (or `wss://...` if you use TLS).
3. Set **Stream name** (e.g. `reporter_1`).
4. Choose camera and microphone, then click **GO LIVE**.
5. When it shows “LIVE”, the stream is being sent to OME and available through SRT.

### 5.2 WebRTC player (low-latency test)

1. Open `http://YOUR_SERVER_IP/player.html`
2. **Signalling URL**: `ws://YOUR_SERVER_IP:3333`
3. **Stream name**: same as used in the publisher (e.g. `reporter_1`).
4. Click **Play**. You should see the stream with low latency.

### 5.3 SRT (Wirecast/OBS) – see section 6

---

## 6. Connecting vMix or OBS Studio

Wirecast and OBS **pull** the stream from your server’s SRT endpoint.

### 6.1 SRT URL format

- **SRT URL**: `srt://YOUR_SERVER_IP:9999/live/reporter_1_srt` (or with your domain).

Example SRT URL:

```text
srt://YOUR_SERVER_IP:9999/live/reporter_1_srt
```

### 6.2 vMix

1. **Add Input** → **Stream** (or **SRT** / **Network Source** depending on version).
2. **URL**: `srt://YOUR_SERVER_IP:9999/live/reporter_1_srt`.
3. Add the input and put it on the program bus.

### 6.3 OBS Studio

1. **Sources** → **Add** → **Media Source** or any SRT-capable input source.
2. If your version has “Network” or “Stream” source: set URL to `srt://YOUR_SERVER_IP:9999/live/reporter_1_srt`.
3. Use low-latency options if available.

### 6.4 Latency

- WebRTC (publisher → OME → player): typically under 2 seconds.
- SRT (OME → Wirecast/OBS): typically low latency; use “low latency” options in your studio client if available.

---

## 7. Optional: HTTPS / WSS

For production and for `getUserMedia` on non-localhost:

1. Put TLS certificates in `ome/conf/` (e.g. `cert.pem`, `key.pem`) and point OME’s TLS in `Server.xml` to them if you use TLS for OME.
2. Put the same (or another) certificate on the web server and configure HTTPS in `web/nginx.conf` (and in `docker-compose` if needed).
3. With the `/ome-ws/` proxy in place, you do **not** need to open port 3333 to the internet for the web app.

**Nginx snippet** (add inside your HTTPS server block; see `nginx-ome-ws.conf` in the project):

```nginx
location /ome-ws/ {
    proxy_pass http://127.0.0.1:3333/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}
```

---

## 8. Files Reference

| Path | Purpose |
|------|--------|
| `nginx-ome-ws.conf` | Nginx location to proxy `/ome-ws/` to OME (port 3333) for WSS in production |
| `docker-compose.yml` | OME, Coturn, web server |
| `ome/conf/Server.xml` | OvenMediaEngine: WebRTC bind, app “live”, output profiles, push |
| `ome/conf/StreamMap.xml` | Stream mapping and output profile settings |
| `ome/conf/Logger.xml` | OME logging |
| `web/publisher.html` | Reporter WebRTC publisher UI |
| `web/player.html` | WebRTC test player |
| `web/nginx.conf` | Web server for static pages |

---

## 9. Troubleshooting

- **Publisher “Connecting…” then fails**: If using HTTPS, add the `/ome-ws/` Nginx proxy (section 7). Otherwise check that port 3333 (and 3478, 10000–10019 UDP) is open and `OME_HOST_IP` is set to the server’s public IP. Check browser console and `ome/logs/ovenmediaengine.log`.
- **No picture in Wirecast/OBS**: Confirm the reporter is LIVE and use the matching SRT URL (e.g. `srt://YOUR_SERVER_IP:9999/live/reporter_1_srt`).
- **High CPU**: Reduce resolution/bitrate in `Server.xml` output profiles or lower the number of concurrent streams until you scale hardware.
