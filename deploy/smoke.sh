#!/usr/bin/env bash
# Post-deploy smoke test. Usage: deploy/smoke.sh <base-url>   e.g. https://rep.example.com
# Read-only against the target (GETs, one unauthenticated MCP POST, one invalid-email POST that is rejected
# before any mail is sent). Exits non-zero if any check fails.
set -uo pipefail
BASE="${1:?usage: smoke.sh <base-url>}"; BASE="${BASE%/}"
fails=0; n=0
H=$(mktemp); B=$(mktemp); trap 'rm -f "$H" "$B"' EXIT

ok()   { n=$((n+1)); printf '  ok    %s\n' "$1"; }
bad()  { n=$((n+1)); fails=$((fails+1)); printf '  FAIL  %s  (%s)\n' "$1" "$2"; }
# req <method> <path> [curl args...]  -> sets CODE; headers in $H, body in $B
req()  { local m="$1" p="$2"; shift 2; CODE=$(curl -sS -m 20 -X "$m" -D "$H" -o "$B" -w '%{http_code}' "$@" "$BASE$p" 2>/dev/null || echo 000); }
hdr()  { grep -i "^$1:" "$H" | tail -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }
expect_code() { # name want
  [ "$CODE" = "$2" ] && ok "$1 -> $2" || bad "$1" "got $CODE, want $2"; }
expect_hdr() { # name header regex
  local v; v=$(hdr "$2"); [[ "$v" =~ $3 ]] && ok "$1 $2: $v" || bad "$1 $2" "got '${v}', want /$3/"; }
expect_body() { grep -qE "$2" "$B" && ok "$1 body matches /$2/" || bad "$1 body" "no match for /$2/"; }

echo "smoke: $BASE"
req GET /                           ; expect_code "GET /" 200; expect_hdr "GET /" content-type 'text/html'; expect_body "GET /" '<html|<!doctype'
req GET /app                        ; { [ "$CODE" = 200 ] || [ "$CODE" = 301 ]; } && ok "GET /app -> $CODE" || bad "GET /app" "got $CODE, want 200 or 301"
req GET /app/                       ; expect_code "GET /app/" 200; expect_hdr "GET /app/" content-type 'text/html'; expect_body "GET /app/" 'id="root"'
INDEX=$(cat "$B")
req GET /app/some/deep/route        ; expect_code "SPA fallback /app/some/deep/route" 200; expect_hdr "SPA fallback" content-type 'text/html'
req GET /api/health                 ; expect_code "GET /api/health" 200; expect_body "GET /api/health" '"ok" *: *true'
req GET /api/does-not-exist         ; [ "$CODE" = 404 ] && ok "unknown /api path -> 404" || bad "unknown /api path" "got $CODE, want 404"
req POST /mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
expect_code "POST /mcp (no token)" 401; expect_hdr "POST /mcp" www-authenticate 'Bearer'
req POST /mcp -H 'content-type: application/json' -H 'authorization: Bearer rep_invalid' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
expect_code "POST /mcp (bogus token)" 401
req GET /app/manifest.webmanifest   ; expect_code "manifest" 200; expect_body "manifest" '"start_url"'; expect_hdr "manifest" cache-control 'no-cache'
req GET /app/sw.js                  ; expect_code "sw.js" 200; expect_hdr "sw.js" content-type 'javascript'; expect_hdr "sw.js" cache-control 'no-(cache|store)'
req GET /app/index.html             ; expect_hdr "index.html" cache-control 'no-cache'
ASSET=$(printf '%s' "$INDEX" | grep -oE '/app/assets/[^"]+\.(js|css)' | head -1)
if [ -n "$ASSET" ]; then req GET "$ASSET"; expect_code "asset $ASSET" 200; expect_hdr "asset" cache-control 'immutable'; else bad "asset discovery" "no /app/assets/* in index.html"; fi
req GET /app/icon-192.png           ; expect_code "icon-192.png" 200; expect_hdr "icon" content-type 'image/png'
req POST /api/magic/request -H 'content-type: application/json' -d '{"email":"not-an-email"}'
expect_code "magic/request invalid email rejected (no mail sent)" 400
case "$BASE" in https://*) ;; *) echo "  note  non-HTTPS base: PWA/geolocation need HTTPS in production" ;; esac

echo "smoke: $((n-fails))/$n passed"
[ "$fails" -eq 0 ] || { echo "smoke: FAILED ($fails)"; exit 1; }
echo "smoke: OK"
