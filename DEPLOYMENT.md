# Newsroom Live Streaming – Deployment Guide

Low-latency WebRTC ingest from smartphones, RTMP output for vMix/OBS. Up to 20 concurrent reporters, &lt;2s latency target.

---

## 1. Architecture

```
Reporter (Android/browser) --WebRTC--> OvenMediaEngine --RTMP push--> nginx-rtmp
         |                            (STUN: Coturn)                        |
         +-- STUN/TURN (Coturn:3478) --+                                    |
                                                                           v
vMix / OBS Studio <--RTMP pull----------------------------------------  nginx-rtmp
```

- **Coturn**: STUN/TURN for NAT traversal so mobile reporters can connect from cellular/Wi‑Fi.
- **OvenMediaEngine**: WebRTC ingest (reporters), transcodes to H.264/AAC, push-publishes to nginx-rtmp; optional recording; REST API for stats.
- **nginx-rtmp**: Receives RTMP from OME; vMix/OBS pull streams from here.
- **Web server**: Serves the publisher and player pages.

See **[STREAMING_ARCHITECTURE.md](STREAMING_ARCHITECTURE.md)** for STUN/TURN, recording, and monitoring.

---

## 2. Network Ports and Firewall

Open these ports on the cloud server and in any host firewall (e.g. `ufw`).

| Port    | Protocol | Service        | Purpose                          |
|---------|----------|----------------|----------------------------------|
| **80**  | TCP      | nginx (web)    | Publisher/player pages           |
| **443** | TCP      | nginx (web)    | HTTPS (recommended in production)|
| **1935**| TCP      | nginx-rtmp     | RTMP – vMix/OBS connect here     |
| **3333**| TCP      | OvenMediaEngine| WebRTC signalling (HTTP/WS)      |
| **3334**| TCP      | OvenMediaEngine| WebRTC signalling TLS (if used)   |
| **3478**| UDP/TCP  | **Coturn**     | STUN/TURN (reporters NAT)        |
| **3479**| TCP      | OvenMediaEngine| OME embedded TURN               |
| **49152–49251** | UDP | **Coturn** | TURN relay ports          |
| **9999**| TCP      | OvenMediaEngine| REST API (stats, recording)     |
| **10000–10019** | UDP | OvenMediaEngine| WebRTC ICE (20 streams)    |

### Example: UFW (Linux)

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 1935/tcp
sudo ufw allow 3333/tcp
sudo ufw allow 3334/tcp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 3479/tcp
sudo ufw allow 9999/tcp
sudo ufw allow 49152:49251/udp
sudo ufw allow 10000:10019/udp
sudo ufw enable
```

---

## 3. Server Configuration (16 CPU / 32 GB RAM)

The included `docker-compose.yml` already sets:

- **OvenMediaEngine**: up to 14 CPUs, 28 GB RAM (reservation 4 CPU, 4 GB).
- **nginx-rtmp**: up to 2 CPUs, 1 GB RAM.
- **Web**: default nginx limits.

Tuning for 20 concurrent streams:

- **OME** `ome/conf/Server.xml`: decoder `ThreadCount` 8; WebRTC signalling `WorkerCount` 4; ICE ports 10000–10019 (20 UDP); RTMP output profile (720p, fast preset).
- **Coturn**: `coturn/turnserver.conf`; set `TURN_EXTERNAL_IP` to your server’s public IP in production so reporters can use TURN.
- **Recording**: OME FILE publisher enabled; start/stop via REST API on port 9999 (see STREAMING_ARCHITECTURE.md).
- **Monitoring**: OME stats via `GET /v1/stats/current/...` (port 9999, Basic auth); optional script `scripts/monitor-streaming.sh`.

---

## 4. Step-by-Step Deployment

### 4.1 Clone or copy the project

```bash
cd /opt   # or your preferred path
# Copy the project files (docker-compose.yml, ome/, rtmp/, web/)
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
docker compose logs -f rtmp               # check nginx-rtmp
```

If OME fails to start, check `ome/logs/ovenmediaengine.log` and that `ome/conf/Server.xml` is valid (e.g. no missing XML or wrong paths).

---

## 5. Testing the Stream Locally

### 5.1 Reporter (publisher)

1. On the same network as the server, open: `http://YOUR_SERVER_IP/publisher.html`
2. Set **Server URL** to `ws://YOUR_SERVER_IP:3333` (or `wss://...` if you use TLS).
3. Set **Stream name** (e.g. `reporter_1`).
4. Choose camera and microphone, then click **GO LIVE**.
5. When it shows “LIVE”, the stream is being sent to OME and then pushed to RTMP.

### 5.2 WebRTC player (low-latency test)

1. Open `http://YOUR_SERVER_IP/player.html`
2. **Signalling URL**: `ws://YOUR_SERVER_IP:3333`
3. **Stream name**: same as used in the publisher (e.g. `reporter_1`).
4. Click **Play**. You should see the stream with low latency.

### 5.3 RTMP (vMix/OBS) – see section 6

---

## 6. Connecting vMix or OBS Studio

vMix and OBS **pull** the stream from your server’s RTMP endpoint.

### 6.1 RTMP URL format

- **Server URL**: `rtmp://YOUR_SERVER_IP` (or `rtmp://your-domain.com`).
- **Application**: `live`
- **Stream key**: the same name the reporter used (e.g. `reporter_1`).

So the full RTMP URL is:

```text
rtmp://YOUR_SERVER_IP/live/reporter_1
```

Some software splits this as:

- **Server**: `rtmp://YOUR_SERVER_IP/live`
- **Stream key**: `reporter_1`

### 6.2 vMix

1. **Add Input** → **Stream** (or **RTMP** / **Network Source** depending on version).
2. **URL**: `rtmp://YOUR_SERVER_IP/live/reporter_1`  
   Or set server `rtmp://YOUR_SERVER_IP/live` and stream key `reporter_1`.
3. Add the input and put it on the program bus.

### 6.3 OBS Studio

1. **Sources** → **Add** → **Media Source** or **Browser** (or use **Add Input** if using a plugin that supports RTMP URL).
2. If your version has “Network” or “Stream” source: set URL to `rtmp://YOUR_SERVER_IP/live/reporter_1`.
3. Alternatively, use **VLC Video Source** or an RTMP-capable source and enter the same URL.

### 6.4 Latency

- WebRTC (publisher → OME → player): typically under 2 seconds.
- RTMP (OME → nginx-rtmp → vMix/OBS): add a few seconds; use “low latency” or “minimal delay” options in vMix/OBS if available.

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
| `docker-compose.yml` | OME, nginx-rtmp, web server |
| `ome/conf/Server.xml` | OvenMediaEngine: WebRTC bind, app “live”, output profiles, push |
| `ome/conf/StreamMap.xml` | Push rule: `*_rtmp` → `rtmp://rtmp:1935/live/${SourceStream}` |
| `ome/conf/Logger.xml` | OME logging |
| `rtmp/nginx.conf` | nginx-rtmp application `live` |
| `web/publisher.html` | Reporter WebRTC publisher UI |
| `web/player.html` | WebRTC test player |
| `web/nginx.conf` | Web server for static pages |

---

## 9. Troubleshooting

- **Publisher “Connecting…” then fails**: If using HTTPS, add the `/ome-ws/` Nginx proxy (section 7). Otherwise check that port 3333 (and 3478, 10000–10019 UDP) is open and `OME_HOST_IP` is set to the server’s public IP. Check browser console and `ome/logs/ovenmediaengine.log`.
- **No picture in vMix/OBS**: Confirm the reporter is LIVE and the stream name matches (e.g. `reporter_1`). Use `http://YOUR_SERVER_IP:8080/stat` (if nginx-rtmp stat is enabled) to see active streams.
- **High CPU**: Reduce resolution/bitrate in `Server.xml` RTMP output profile or lower the number of concurrent streams until you scale hardware.
