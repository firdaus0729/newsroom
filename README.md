# Newsroom Live Streaming (Milestone 1)

Low-latency live streaming: **reporters stream via WebRTC from Android/browser** to **OvenMediaEngine**, with **SRT workflow for studio tools (Wirecast/vMix/OBS)**.

- **Target**: &lt;2 s latency, up to 20 simultaneous reporters
- **Stack**: OvenMediaEngine (WebRTC + SRT) + Coturn + optional restream-forwarder (SRT->RTMP) + static web (publisher/player)
- **Deploy**: Docker Compose on a single cloud server (e.g. 16 CPU / 32 GB RAM)

## Quick start

```bash
mkdir -p ome/logs
# Set OME_HOST_IP in docker-compose.yml to your server public IP
docker compose up -d
```

- **Reporter**: open `http://YOUR_SERVER/publisher.html` → set stream name → GO LIVE
- **Wirecast/vMix/OBS**: pull SRT `srt://YOUR_SERVER:9999?streamid=live/program`
- **Test playback**: `http://YOUR_SERVER/player.html`

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for ports, firewall, server sizing, and step-by-step deployment and vMix/OBS instructions.

## Project layout

```
├── docker-compose.yml   # OME, Coturn, optional restream-forwarder
├── ome/
│   └── conf/
│       ├── Server.xml   # WebRTC bind, app "live", output profiles, push
│       ├── StreamMap.xml
│       └── Logger.xml
├── web/
│   ├── publisher.html   # WebRTC publisher (camera/mic, GO LIVE)
│   ├── player.html      # WebRTC test player
│   ├── index.html
│   └── nginx.conf
├── DEPLOYMENT.md
└── README.md
```
