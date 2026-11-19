#!/usr/bin/env bash
# Isolated dev stack for one agent/worker N (1..40): API on 8800+N (temp DB), Vite on 5200+N.
# Usage: scripts/dev-iso.sh N        → prints the URL; Ctrl-C / `scripts/dev-iso.sh stop N` to stop.
set -euo pipefail
cd "$(dirname "$0")/.."
N="${2:-${1:-1}}"
if [ "${1:-}" = "stop" ]; then for f in /tmp/rep-iso-$N.*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done; exit 0; fi
API=$((8800+N)); WEB=$((5200+N)); DB=/tmp/rep-iso-$N.db; rm -f $DB $DB-wal $DB-shm
ANON_RATE_LIMIT=100000 LOGIN_RATE_LIMIT=100000 GYM_DB=$DB PORT=$API nohup bun src/server/index.ts > /tmp/rep-iso-$N.api.log 2>&1 & echo $! > /tmp/rep-iso-$N.api.pid
API_PORT=$API VITE_PORT=$WEB nohup bunx vite --strictPort > /tmp/rep-iso-$N.web.log 2>&1 & echo $! > /tmp/rep-iso-$N.web.pid
for i in $(seq 1 40); do curl -sf "http://localhost:$WEB/app/" >/dev/null && break; sleep 0.5; done
echo "http://localhost:$WEB/app/"
