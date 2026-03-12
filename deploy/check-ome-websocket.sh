#!/bin/sh
# Run this on the server to verify OME is reachable and Nginx proxy can work.
# Usage: ./deploy/check-ome-websocket.sh

echo "=== 1. OME port 3333 (from this host) ==="
if command -v curl >/dev/null 2>&1; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://127.0.0.1:3333/ 2>/dev/null || echo "fail")
  if [ "$code" = "fail" ] || [ -z "$code" ]; then
    echo "FAIL: Cannot connect to 127.0.0.1:3333 (OME may be stopped or not listening)"
    echo "  -> Start OME: docker-compose up -d  (or: docker compose up -d)"
  else
    echo "OK: OME responded with HTTP $code"
  fi
else
  echo "Skip: curl not found"
fi

echo ""
echo "=== 2. Nginx config contains /ome-ws/ ==="
if [ -r /etc/nginx/sites-enabled/newsroom ] 2>/dev/null; then
  if grep -q "location /ome-ws/" /etc/nginx/sites-enabled/newsroom 2>/dev/null; then
    echo "OK: /ome-ws/ location found in sites-enabled/newsroom"
  else
    echo "MISSING: No 'location /ome-ws/' in sites-enabled/newsroom"
    echo "  -> Add the /ome-ws/ block from project deploy/nginx-newsroom.conf"
  fi
else
  echo "Note: /etc/nginx/sites-enabled/newsroom not found or not readable"
  echo "  -> Copy deploy/nginx-newsroom.conf to sites-available and enable it"
fi

echo ""
echo "=== 3. Nginx test ==="
if command -v nginx >/dev/null 2>&1; then
  if nginx -t 2>/dev/null; then
    echo "OK: nginx -t passed"
  else
    echo "FAIL: nginx -t failed (run: sudo nginx -t)"
  fi
else
  echo "Skip: nginx not in PATH"
fi
