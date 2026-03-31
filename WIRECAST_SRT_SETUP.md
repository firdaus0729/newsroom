# Wirecast SRT Integration Setup

## Overview
Wirecast now connects to the newsroom via **SRT (Secure Reliable Transport)** instead of RTMP. SRT provides better reliability and performance over unreliable networks.

## Wirecast Configuration

### 1. Add SRT Input Source (Reporter Streams)
To ingest individual reporter streams into Wirecast:

1. In Wirecast, select **Add Source → Network Source → SRT**
2. Configure each reporter input:
   - **Remote Address**: `www.newznow.org` (or your server IP)
   - **Port**: `9999`
   - **Stream ID**: `www.newznow.org/live/reporter_1_srt` (include hostname; change `1` for each reporter)
   - **Protocol**: SRT caller

### 2. Wirecast Program Output Configuration (Studio Feed)
To publish the studio program output back to OME (for reporters to see return feed):

1. Select **Output → Add Output → SRT**
2. Configure:
   - **Remote Address**: `www.newznow.org` (or your server IP/hostname)
   - **Port**: `9999`
   - **Stream ID**: `www.newznow.org/live/program` (include hostname)
   - **Protocol**: SRT caller

## SRT Stream Naming Convention
OME requires Stream IDs in format: `{hostname}/{app}/{stream}[/{playlist}]`

- **Reporter streams**: `www.newznow.org/live/reporter_N_srt` (ingest into Wirecast)
  - Example: `www.newznow.org/live/reporter_1_srt`, `www.newznow.org/live/reporter_2_srt`, etc.
- **Program stream**: `www.newznow.org/live/program` (studio output from Wirecast)

## Troubleshooting

### Connection Timeout Issues
If Wirecast shows "Connection Timeout":

1. **Verify OME is running and SRT provider is active**:
   ```bash
   docker ps | grep ome
   docker logs ovenmediaengine | grep -i srt
   ```

2. **Check if port 9999 is accessible**:
   ```bash
   # From client machine
   telnet www.newznow.org 9999
   # Or use nc/nmap
   nc -zv www.newznow.org 9999
   ```

3. **Restart OME container**:
   ```bash
   docker compose down ovenmediaengine
   docker compose up -d ovenmediaengine
   docker compose logs -f ovenmediaengine
   ```

4. **Verify environment variables**:
   - Ensure `.env` has: `SRT_BASE_URL=srt://www.newznow.org:9999/live`
   - Check: `docker inspect ome | grep SRT`

### Stream Not Appearing in OME
1. Check OME logs for SRT errors
2. Verify the Stream ID format is correct: `live/stream_name`
3. Ensure the `live` application is properly configured in `Server.xml`

## Environment Variables

```bash
# .env (Docker Compose)
OME_HOST_IP=www.newznow.org
SRT_BASE_URL=srt://www.newznow.org:9999/live
```

```bash
# backend/.env
SRT_BASE_URL=srt://www.newznow.org:9999/live
```

```bash
# frontend/.env
VITE_SRT_BASE_URL=srt://www.newznow.org:9999/live
```

## Test Steps

### Step 1: Reporter ingest check
- Reporter clicks **GO LIVE** (WebRTC)
- Expected: Reporter video appears in editor portal → Live Streams

### Step 2: Wirecast input check
- Add SRT source `live/reporter_1_srt` in Wirecast
- Expected: Reporter feed visible in Wirecast

### Step 3: Wirecast program output check
- Wirecast publishes program output to `live/program`
- Check `http://SERVER_IP:8080/stat` for active streams

### Step 4: OME received confirm
```bash
docker compose logs -f ovenmediaengine
# Look for: "SRT stream publish" or "live/program"
```

### Step 5: Reporter return feed check
- Reporter portal clicks **Load return feed**
- Expected: Wirecast program output plays as WebRTC stream (low latency)

### Step 6: Restream check (if configured)
- Set `RESTREAM_SRT_URL` env variable
- Check restream logs upload working

## Notes
- SRT runs on port **9999** (both TCP and UDP)
- Stream IDs must follow format: `<app>/<stream>` (e.g., `live/reporter_1_srt` for reporters, `live/program` for the studio return feed)
- All RTMP references have been removed; use SRT instead
- Return feed now auto-loads the `program` stream (no manual URL entry)
