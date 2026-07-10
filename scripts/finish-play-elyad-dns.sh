#!/usr/bin/env bash
# After elyad.io is added to Cloudflare and Hover NS → CF NS:
#   ./scripts/finish-play-elyad-dns.sh
# Then host with:
#   TUNNEL=cf PUBLIC_URL=https://play.elyad.io bun run host:public
set -euo pipefail
TUNNEL_ID="4019d70d-f4ae-4423-941b-a13ae9a0112a"
echo "[dns] routing play.elyad.io → tunnel jakesjam ($TUNNEL_ID)"
cloudflared tunnel route dns -f jakesjam play.elyad.io
echo "[dns] optional alias jakesjam.elyad.io"
cloudflared tunnel route dns -f jakesjam jakesjam.elyad.io || true
echo "[dns] checking health..."
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://play.elyad.io/health || true)
  echo "  try $i → $code"
  if [ "$code" = "200" ]; then
    echo "[dns] LIVE: https://play.elyad.io/?world=1"
    exit 0
  fi
  sleep 5
done
echo "[dns] not 200 yet — is Bun on :8088 and cloudflared running?"
echo "  curl -s http://127.0.0.1:8088/health"
echo "  pgrep -x cloudflared"
exit 1
