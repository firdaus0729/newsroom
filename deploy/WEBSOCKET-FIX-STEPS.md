# Fix "WebSocket connection to .../ome-ws/... failed"

Follow these steps **on your server** (one by one) until the connection works.

---

## Step 1: Check OME is running and port 3333 answers

On the server, run:

```bash
docker ps | grep -i ome
```

You should see the OvenMediaEngine container **Up**. If not:

```bash
cd /opt/newsroom/newsroom
docker-compose up -d
```

Then check that port 3333 responds **from the same machine**:

```bash
curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 http://127.0.0.1:3333/
```

- If you see a **number** (e.g. `200`, `400`, `404`) → OME is listening. Go to Step 2.
- If you see **empty** or `000` or "Connection refused" → OME is not reachable. Fix Docker first (container must be running and `ports: "3333:3333"` in docker-compose).

---

## Step 2: Check Nginx really has the `/ome-ws/` block

Run:

```bash
sudo nginx -T 2>/dev/null | grep -A 15 "location /ome-ws/"
```

You should see the full `location /ome-ws/ { ... }` block. If you see **nothing**, Nginx is not loading that config:

1. Copy the project config:  
   `sudo cp /opt/newsroom/newsroom/deploy/nginx-newsroom.conf /etc/nginx/sites-available/newsroom`
2. Enable it:  
   `sudo ln -sf /etc/nginx/sites-available/newsroom /etc/nginx/sites-enabled/`
3. Remove any **other** site that might handle `www.newznow.org` (e.g. a default or duplicate), or ensure only one server block has `server_name www.newznow.org`.
4. Test and reload:  
   `sudo nginx -t && sudo systemctl reload nginx`

Then run the `nginx -T | grep` command again and confirm the block is there.

---

## Step 3: Reload Nginx and test from the browser

```bash
sudo nginx -t && sudo systemctl reload nginx
```

On your **computer**, open (use HTTPS and the same domain as the app):

**https://www.newznow.org/ome-ws-test.html**

- If the test page shows **"OPEN – WebSocket proxy and OME are working"** → the proxy works; try GO LIVE again in the reporter portal.
- If it shows **CLOSED code 1006** (or connection failed) → the request is not reaching OME. Check Nginx error log:

```bash
sudo tail -30 /var/log/nginx/error.log
```

Look for errors mentioning `proxy_pass`, `upstream`, or `3333`.

---

## Step 4: If the test page is 404

The test file must be in the built frontend. Rebuild and redeploy:

```bash
cd /opt/newsroom/newsroom/frontend
npm run build
```

Then reload Nginx if needed. The file will be at `dist/ome-ws-test.html`, so the URL is **https://www.newznow.org/ome-ws-test.html**.

---

## Summary checklist

| Check | Command / action |
|-------|------------------|
| OME container running | `docker ps \| grep ome` |
| Port 3333 answers on server | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3333/` |
| Nginx has `location /ome-ws/` | `sudo nginx -T \| grep -A 15 "location /ome-ws/"` |
| Nginx reloaded | `sudo nginx -t && sudo systemctl reload nginx` |
| Browser test | Open https://www.newznow.org/ome-ws-test.html |

After all are OK, the reporter portal GO LIVE should connect without the WebSocket error.
