#!/usr/bin/env bash
# Monitoring: active streams, CPU, bandwidth (OME stats + host metrics)
# Usage: ./scripts/monitor-streaming.sh [OME_BASE_URL]
# OME_BASE_URL default: http://localhost:9999
# Optional: OME_API_AUTH=user:password for Basic auth (e.g. ome-admin:changeme)

set -e
OME_BASE="${1:-http://localhost:9999}"
AUTH_ARGS=()
[ -n "${OME_API_AUTH:-}" ] && AUTH_ARGS=(-u "$OME_API_AUTH")

echo "=== Streaming stack monitoring ==="
echo "Time: $(date -Iseconds)"
echo ""

# --- Host: CPU and memory ---
if command -v top &>/dev/null; then
  echo "--- Host CPU (summary) ---"
  top -bn1 | head -5
  echo ""
fi

if command -v free &>/dev/null; then
  echo "--- Host memory ---"
  free -h
  echo ""
fi

# --- OME stats (requires API enabled in Server.xml) ---
# Enable with <API><Port>9999</Port></API> in Server.xml
if command -v curl &>/dev/null; then
  echo "--- OvenMediaEngine stats ---"
  # Try vhost * (default in Server.xml) or default
  if curl -sf -m 2 "${AUTH_ARGS[@]}" "${OME_BASE}/v1/stats/current/vhosts/%2A" >/dev/null 2>&1; then
    curl -sf -m 5 "${AUTH_ARGS[@]}" "${OME_BASE}/v1/stats/current/vhosts/%2A" | head -100
  elif curl -sf -m 2 "${AUTH_ARGS[@]}" "${OME_BASE}/v1/stats/current/vhosts/default" >/dev/null 2>&1; then
    curl -sf -m 5 "${AUTH_ARGS[@]}" "${OME_BASE}/v1/stats/current/vhosts/default" | head -100
  else
    echo "OME API not reachable at ${OME_BASE} (enable API in Server.xml and expose 9999)"
    echo "See: https://docs.ovenmediaengine.com/dev/rest-api/v1/statistics/current"
  fi
  echo ""
fi

# --- Docker container stats (if run via Docker) ---
if command -v docker &>/dev/null; then
  echo "--- Container CPU/memory ---"
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null || true
  echo ""
fi

# --- Bandwidth (optional: requires ifconfig or ip) ---
echo "--- Ports in use (3333=OME, 3478=Coturn, 9999=SRT/API) ---"
if command -v ss &>/dev/null; then
  ss -tuln | grep -E ':(3333|3334|3478|3479|9999|10000)\s' || true
elif command -v netstat &>/dev/null; then
  netstat -tuln | grep -E ':(3333|3334|3478|3479|9999|10000)\s' || true
fi
