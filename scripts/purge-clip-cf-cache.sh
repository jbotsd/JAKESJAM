#!/usr/bin/env bash
# Purge Cloudflare edge cache for clip URLs that were poisoned as raw video
# (CF caches .mp4 aggressively; a year-long immutable HIT was observed).
#
# Requires: CLOUDFLARE_API_TOKEN with Zone.Cache Purge + Zone.Zone Read
#   export CLOUDFLARE_API_TOKEN=...
#   export CLOUDFLARE_ZONE_ID=...   # optional; auto-looked-up for elyad.io
#
# Usage:
#   ./scripts/purge-clip-cf-cache.sh
#   ./scripts/purge-clip-cf-cache.sh 6360b024-2fe2-4d6b-983d-3ebaa08d6641.mp4
set -euo pipefail

ZONE_NAME="${CLOUDFLARE_ZONE_NAME:-elyad.io}"
TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "Set CLOUDFLARE_API_TOKEN (Zone → Cache Purge)." >&2
  exit 1
fi

ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
if [ -z "$ZONE_ID" ]; then
  ZONE_ID="$(curl -sS -H "Authorization: Bearer $TOKEN" \
    "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["result"][0]["id"] if d.get("result") else "")')"
fi
if [ -z "$ZONE_ID" ]; then
  echo "Could not resolve zone id for $ZONE_NAME" >&2
  exit 1
fi

BASE="https://play.elyad.io"
FILES=()
if [ "$#" -eq 0 ]; then
  FILES+=(
    "$BASE/clips/*"
  )
  # Prefix purge needs enterprise on some plans — also purge known recent via list
  echo "[purge] zone=$ZONE_ID — purging everything under play.elyad.io/clips/ via files list if provided"
fi

for arg in "$@"; do
  f="${arg##*/}"
  FILES+=("$BASE/clips/$f" "$BASE/c/$f" "$BASE/watch/$f" "$BASE/clips/$f?raw=1")
done

if [ "$#" -eq 0 ]; then
  # Full zone purge is heavy — prefer prefix if allowed
  BODY='{"prefixes":["play.elyad.io/clips/"]}'
else
  BODY="$(python3 -c 'import json,sys; print(json.dumps({"files": json.loads(sys.argv[1])}))' "$(printf '%s\n' "${FILES[@]}" | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')")"
fi

echo "[purge] $BODY"
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data "$BODY" | python3 -m json.tool
echo
echo "Then open: ${BASE}/c/<filename>"
