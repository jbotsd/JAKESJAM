#!/usr/bin/env bash
# Host JAKESJAM multiplayer from THIS machine — fully self-contained.
# No Fly, no Convex, no Vercel: one Bun process serves the built client
# AND the game server; one tunnel exposes both.
#
#   1. builds the client (if client/dist is missing; force with --build)
#   2. starts the Bun game server on :$PORT serving client/dist statics
#   3. opens tunnel (cf / funnel / lhr) and prints ONE shareable link
#
# Players open the link, pick a name, and join the pub world.
# Client uses same origin for the game server.
#
# Ctrl-C tears everything down.
# Docs: docs/hosting-elyad-io.md
#
# TUNNEL PROVIDERS (this network is CGNAT — verified 2026-07-02/03):
#   cf (preferred) — Named Cloudflare tunnel "jakesjam" + play.elyad.io.
#                    Config: ops/cloudflared/config.yml only.
#                    Needs elyad.io on Cloudflare (see docs/hosting-elyad-io.md).
#                    Falls back to funnel if public URL won't verify.
#   funnel         — Tailscale Funnel. STABLE but *.ts.net hostname.
#                    (https://randel.<tailnet>.ts.net). Falls back to lhr.
#   lhr            — localhost.run over SSH. Free URLs ROTATE ~15-30 min.
#   cloudflared    — quick tunnels (trycloudflare.com). Unreliable here.
#   none           — direct mode: LAN / public IP only.
#
# Env knobs:
#   PORT              game server port (default 8088)
#   TUNNEL=cf|funnel|lhr|cloudflared|none   (default: cf if play DNS is
#                         not parking, else funnel — see below)
#   PUBLIC_URL        brand https URL when TUNNEL=cf (default
#                         https://play.elyad.io)
#   HOST_MODE=direct  alias for TUNNEL=none

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8088}"
LOG_DIR=".host-logs"
mkdir -p "$LOG_DIR"

# Resolve a hostname via 1.1.1.1 DNS-over-HTTPS. Sidesteps LAN resolvers
# that block *.trycloudflare.com. Prints the first A record or nothing.
doh_resolve() {
  python3 - "$1" <<'EOF' 2>/dev/null || true
import json, sys, urllib.request
req = urllib.request.Request(
    f"https://1.1.1.1/dns-query?name={sys.argv[1]}&type=A",
    headers={"accept": "application/dns-json"})
d = json.load(urllib.request.urlopen(req, timeout=8))
for a in d.get("Answer", []):
    if a.get("type") == 1:
        print(a["data"]); break
EOF
}

# ── 0. Client build ───────────────────────────────────────────────────────
if [ "${1:-}" = "--build" ] || [ ! -f client/dist/index.html ]; then
  echo "[host] building client (vite + wasm)..."
  bun run build >"$LOG_DIR/build.log" 2>&1 || {
    echo "[host] ERROR: client build failed — $LOG_DIR/build.log:"
    tail -20 "$LOG_DIR/build.log"
    exit 1
  }
fi
echo "[host] client build present: client/dist"

# World tokens are minted AND verified by this same process, so any
# per-session random secret is fine — nothing external shares it.
GAME_SERVER_SECRET="$(head -c 32 /dev/urandom | base64)"
export GAME_SERVER_SECRET

# Operator console (/ops) — fail-closed unless ADMIN_SECRET is set.
# Persist across host restarts so the same cookie/login keeps working.
ADMIN_SECRET_FILE="$LOG_DIR/admin-secret"
if [ -z "${ADMIN_SECRET:-}" ]; then
  if [ -f "$ADMIN_SECRET_FILE" ]; then
    ADMIN_SECRET="$(tr -d '\n' < "$ADMIN_SECRET_FILE")"
  else
    ADMIN_SECRET="$(head -c 32 /dev/urandom | base64)"
    umask 077
    printf '%s\n' "$ADMIN_SECRET" >"$ADMIN_SECRET_FILE"
  fi
fi
export ADMIN_SECRET

SERVER_PID=""
TUNNEL_PID=""

# Children are spawned into their own process groups (setsid) so cleanup
# can kill the whole tree — `bun run --filter` wraps the real server in a
# child process that a bare `kill $PID` leaves running.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "[host] shutting down..."
  kill_tree "$TUNNEL_PID"
  kill_tree "$SERVER_PID"
  wait 2>/dev/null || true
  echo "[host] done."
}
trap cleanup EXIT INT TERM

# ── 1. Game server (+ client statics) ─────────────────────────────────────
echo "[host] starting game server on :$PORT ..."
# NO --watch here: hosting must survive source edits. The dev filter runs
# `bun --watch`, which hot-restarts on every file save — dropping all
# players mid-match and occasionally dying on the port-rebind race
# ("No free port in [8088, 8089)"). Observed live 2026-07-03.
# PUBLIC_URL is the brand face for shareable clip links (never Tailscale Host).
REGION=home PORT="$PORT" PORT_SEARCH_RANGE=1 SERVE_CLIENT_DIR="$PWD/client/dist" \
  WORLD_BOTS="${WORLD_BOTS:-2}" \
  PUBLIC_URL="${PUBLIC_URL:-https://play.elyad.io}" \
  ADMIN_SECRET="$ADMIN_SECRET" \
  setsid bun --cwd server src/index.ts >"$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl -sf --max-time 3 "http://localhost:$PORT/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[host] ERROR: game server exited during boot — $LOG_DIR/server.log:"
    tail -20 "$LOG_DIR/server.log"
    exit 1
  fi
  sleep 0.5
done
if ! curl -sf --max-time 3 "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "[host] ERROR: server did not become healthy on :$PORT"
  tail -20 "$LOG_DIR/server.log"
  exit 1
fi
if ! curl -sf --max-time 3 "http://localhost:$PORT/" | grep -qi "<!doctype html"; then
  echo "[host] ERROR: client statics not served at / — check SERVE_CLIENT_DIR"
  exit 1
fi
echo "[host] game server + client healthy: http://localhost:$PORT/"

LAN_IP="$(ip -4 addr show scope global 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1 | cut -d' ' -f2 || true)"
PUBLIC_IP="$(curl -4 -s --max-time 8 ifconfig.me || true)"

print_direct_banner() {
  echo
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  JAKESJAM is hosted from this PC (DIRECT mode — no tunnel)."
  echo
  echo "  One-time router setup: forward TCP $PORT → ${LAN_IP:-<this-machine>}:$PORT"
  echo
  echo "  Then share this link — players auto-join the pub world:"
  echo "    http://${PUBLIC_IP:-<public-ip>}:$PORT/?world=1"
  echo
  echo "  LAN players : http://${LAN_IP:-<this-machine-ip>}:$PORT/?world=1"
  echo "  Health      : http://${PUBLIC_IP:-<public-ip>}:$PORT/health"
  echo "  Ops console : http://localhost:$PORT/ops  (ADMIN_SECRET in $ADMIN_SECRET_FILE)"
  echo "  Logs        : $LOG_DIR/server.log"
  echo
  echo "  Ctrl-C stops hosting."
  echo "══════════════════════════════════════════════════════════════════════"
  echo
}

# Prefer brand domain when play.elyad.io is not still on Hover parking.
PUBLIC_URL="${PUBLIC_URL:-https://play.elyad.io}"
if [ -z "${TUNNEL:-}" ]; then
  PARK="$(getent hosts play.elyad.io 2>/dev/null | awk '{print $1}' | head -1 || true)"
  if [ "$PARK" = "216.40.34.41" ] || [ -z "$PARK" ]; then
    TUNNEL="funnel"
    echo "[host] play.elyad.io DNS not pointed at CF tunnel yet (parking/missing) — defaulting TUNNEL=funnel"
    echo "[host] set Hover CNAME play → 4019d70d-f4ae-4423-941b-a13ae9a0112a.cfargotunnel.com"
    echo "[host] then: TUNNEL=cf PUBLIC_URL=https://play.elyad.io bun run host:public"
  else
    TUNNEL="cf"
  fi
fi
TUNNEL="${TUNNEL:-funnel}"

if [ "${HOST_MODE:-auto}" = "direct" ] || [ "$TUNNEL" = "none" ]; then
  print_direct_banner
  tail -f "$LOG_DIR/server.log" &
  wait $SERVER_PID
  exit 0
fi

print_tunnel_banner() {
  # $1 = public https URL
  echo
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  JAKESJAM is hosted from this PC."
  echo
  echo "  Share this link — players auto-join the pub world from it:"
  echo "    $1/?world=1"
  echo
  echo "  (bare $1 lands on the menu instead)"
  echo
  echo "  LAN players : http://${LAN_IP:-<this-machine-ip>}:$PORT/?world=1"
  echo "  Ops console : $1/ops  (secret: $ADMIN_SECRET_FILE — do not share)"
  echo "  Health      : $1/health"
  echo "  Logs        : $LOG_DIR/server.log  $LOG_DIR/tunnel.log"
  echo
  echo "  Ctrl-C stops hosting."
  echo "══════════════════════════════════════════════════════════════════════"
  echo
}

if [ "$TUNNEL" = "cf" ] || [ "$TUNNEL" = "cf-named" ]; then
  # ── 2a. Named Cloudflare Tunnel "jakesjam" only → play.elyad.io ─────────
  # FAIL CLOSED: project-owned config only (ops/cloudflared/config.yml).
  # One tunnel (jakesjam), one origin (:8088). Multi-app ingress = refuse.
  CF_CONFIG="${CLOUDFLARED_CONFIG:-$PWD/ops/cloudflared/config.yml}"
  JAKESJAM_TUNNEL_ID="4019d70d-f4ae-4423-941b-a13ae9a0112a"
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "[host] cloudflared not installed — falling back to funnel."
    TUNNEL="funnel"
  elif [ ! -f "$CF_CONFIG" ]; then
    echo "[host] ERROR: missing $CF_CONFIG (required for TUNNEL=cf)."
    echo "[host] falling back to funnel."
    TUNNEL="funnel"
  elif ! grep -q "$JAKESJAM_TUNNEL_ID" "$CF_CONFIG"; then
    echo "[host] FATAL: $CF_CONFIG is not the jakesjam tunnel id ($JAKESJAM_TUNNEL_ID)."
    kill_tree "$SERVER_PID"
    exit 1
  elif grep -qiE 'localhost:3001|solas\.|other-app' "$CF_CONFIG"; then
    echo "[host] FATAL: $CF_CONFIG has non-JAKESJAM services — refuse to run."
    kill_tree "$SERVER_PID"
    exit 1
  else
    echo "[host] starting tunnel jakesjam (config=$CF_CONFIG) → $PUBLIC_URL ..."
    : > "$LOG_DIR/tunnel.log"
    pkill -x cloudflared 2>/dev/null || true
    sleep 1
    setsid cloudflared tunnel --config "$CF_CONFIG" run jakesjam \
      >"$LOG_DIR/tunnel.log" 2>&1 &
    TUNNEL_PID=$!
    TUNNEL_OK=0
    for _ in $(seq 1 30); do
      if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
        echo "[host] cloudflared exited — $LOG_DIR/tunnel.log:"
        tail -15 "$LOG_DIR/tunnel.log"
        break
      fi
      CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$PUBLIC_URL/health" || true)"
      if [ "$CODE" = "200" ]; then TUNNEL_OK=1; break; fi
      sleep 2
    done
    if [ "$TUNNEL_OK" = "1" ]; then
      echo "[host] brand URL verified: $PUBLIC_URL"
      echo "$PUBLIC_URL" > "$LOG_DIR/current-url"
      print_tunnel_banner "$PUBLIC_URL"
      tail -f "$LOG_DIR/server.log" &
      wait $SERVER_PID
      exit 0
    fi
    echo "[host] WARNING: $PUBLIC_URL/health not 200 (last: ${CODE:-none})"
    echo "[host] Check Hover CNAME for play → ${JAKESJAM_TUNNEL_ID}.cfargotunnel.com"
    echo "[host] Falling back to Tailscale Funnel (explicit emergency only)."
    kill_tree "$TUNNEL_PID"; TUNNEL_PID=""
    TUNNEL="funnel"
  fi
fi

if [ "$TUNNEL" = "funnel" ]; then
  # ── 2a. Tailscale Funnel (stable URL) ────────────────────────────────────
  if tailscale status >/dev/null 2>&1; then
    echo "[host] configuring Tailscale Funnel for :$PORT ..."
    # Idempotent: re-applies the 443 -> localhost:$PORT proxy. Config
    # persists in tailscaled state, so this is a no-op on re-runs.
    if timeout 25 tailscale funnel --bg "$PORT" >"$LOG_DIR/tunnel.log" 2>&1; then
      FUNNEL_URL="$(tailscale funnel status 2>/dev/null | grep -oE 'https://[a-z0-9.-]+\.ts\.net' | head -1)"
      if [ -n "$FUNNEL_URL" ]; then
        TUNNEL_OK=0
        for _ in $(seq 1 15); do
          CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$FUNNEL_URL/health" || true)"
          if [ "$CODE" = "200" ]; then TUNNEL_OK=1; break; fi
          sleep 3
        done
        if [ "$TUNNEL_OK" = "1" ]; then
          echo "[host] funnel verified end-to-end (stable URL)."
          echo "$FUNNEL_URL" > "$LOG_DIR/current-url"
          print_tunnel_banner "$FUNNEL_URL"
          tail -f "$LOG_DIR/server.log" &
          wait $SERVER_PID
          exit 0
        fi
        echo "[host] WARNING: funnel URL $FUNNEL_URL not confirmed (last: ${CODE:-none})"
      fi
      echo "[host] funnel configured but unverified — falling back to lhr."
    else
      echo "[host] funnel setup failed (see $LOG_DIR/tunnel.log) — falling back to lhr:"
      tail -3 "$LOG_DIR/tunnel.log"
    fi
  else
    echo "[host] tailscaled not running — falling back to lhr tunnel."
    echo "[host] (enable stable URLs: sudo systemctl enable --now tailscaled && sudo tailscale up)"
  fi
  TUNNEL="lhr"
fi

if [ "$TUNNEL" = "lhr" ]; then
  # ── 2a. localhost.run SSH tunnel (auto-reconnecting) ────────────────────
  # Ensure no orphaned session from a previous run keeps a competing
  # (stale) subdomain registered.
  pkill -f "ssh.*localhost\.run" 2>/dev/null || true
  echo "[host] opening localhost.run tunnel (ssh)..."
  : > "$LOG_DIR/tunnel.log"
  (
    # Reconnect loop: free lhr.life URLs rotate per connection, so on a
    # drop we print the NEW share link loudly. ServerAliveInterval keeps
    # NAT state warm; ExitOnForwardFailure makes dead forwards fatal so
    # the loop can retry instead of holding a zombie session.
    while true; do
      ssh -o StrictHostKeyChecking=no \
          -o ServerAliveInterval=30 \
          -o ServerAliveCountMax=3 \
          -o ExitOnForwardFailure=yes \
          -o ConnectTimeout=15 \
          -R 80:localhost:"$PORT" nokey@localhost.run 2>&1
      echo "[host] tunnel dropped — reconnecting in 3s (share link will CHANGE)"
      sleep 3
    done
  ) >> "$LOG_DIR/tunnel.log" &
  TUNNEL_PID=$!

  # localhost.run wraps output in ANSI color + QR-code art; strip escapes
  # before extracting the URL or greps mis-fire.
  lhr_url() {
    sed 's/\x1b\[[0-9;]*m//g' "$LOG_DIR/tunnel.log" 2>/dev/null \
      | grep -aoE 'https://[a-z0-9]+\.lhr\.life' | tail -1 || true
  }

  TUNNEL_HOST=""
  for _ in $(seq 1 60); do
    TUNNEL_HOST="$(lhr_url)"
    [ -n "$TUNNEL_HOST" ] && break
    sleep 1
  done
  if [ -z "$TUNNEL_HOST" ]; then
    echo "[host] ERROR: no lhr.life URL after 60s — $LOG_DIR/tunnel.log:"
    tail -10 "$LOG_DIR/tunnel.log"
    echo "[host] falling back to DIRECT mode."
    kill_tree "$TUNNEL_PID"; TUNNEL_PID=""
    print_direct_banner
    tail -f "$LOG_DIR/server.log" &
    wait $SERVER_PID
    exit 0
  fi

  echo "[host] tunnel assigned: $TUNNEL_HOST — verifying..."
  TUNNEL_OK=0
  for _ in $(seq 1 20); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$TUNNEL_HOST/health" || true)"
    if [ "$CODE" = "200" ]; then TUNNEL_OK=1; break; fi
    sleep 2
  done
  if [ "$TUNNEL_OK" = "1" ]; then
    echo "[host] tunnel verified end-to-end."
  else
    echo "[host] WARNING: tunnel URL assigned but /health not confirmed"
    echo "[host] (last HTTP code: ${CODE:-none}) — sharing it anyway; check"
    echo "[host] $LOG_DIR/tunnel.log if players cannot connect."
  fi
  print_tunnel_banner "$TUNNEL_HOST"

  # Surface NEW urls when the ssh loop reconnects. Compare against a file
  # (not the shell var) so each rotation announces exactly once.
  echo "$TUNNEL_HOST" > "$LOG_DIR/current-url"
  ( tail -f "$LOG_DIR/tunnel.log" 2>/dev/null \
      | sed --unbuffered 's/\x1b\[[0-9;]*m//g' \
      | grep --line-buffered -aoE 'https://[a-z0-9]+\.lhr\.life' \
      | while read -r u; do
          if [ "$u" != "$(cat "$LOG_DIR/current-url" 2>/dev/null)" ]; then
            echo "$u" > "$LOG_DIR/current-url"
            echo ""
            echo "[host] ══════ TUNNEL RECONNECTED — NEW SHARE LINK ══════"
            echo "[host]   $u/?world=1"
            echo "[host] ═════════════════════════════════════════════════"
          fi
        done ) &

  tail -f "$LOG_DIR/server.log" &
  wait $SERVER_PID
  exit 0
fi

# ── 2b. Cloudflare quick tunnel (TUNNEL=cloudflared) ─────────────────────
echo "[host] opening Cloudflare quick tunnel..."
setsid cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate \
  >"$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!

TUNNEL_HOST=""
for _ in $(seq 1 60); do
  TUNNEL_HOST="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 || true)"
  [ -n "$TUNNEL_HOST" ] && break
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "[host] ERROR: cloudflared exited — $LOG_DIR/tunnel.log:"
    tail -20 "$LOG_DIR/tunnel.log"
    exit 1
  fi
  sleep 0.5
done
if [ -z "$TUNNEL_HOST" ]; then
  echo "[host] ERROR: no trycloudflare URL after 30s — $LOG_DIR/tunnel.log:"
  tail -20 "$LOG_DIR/tunnel.log"
  exit 1
fi
BARE_HOST="${TUNNEL_HOST#https://}"
echo "[host] tunnel assigned: $TUNNEL_HOST"

# Verify end-to-end through the public edge before advertising the URL.
# Route propagation to Cloudflare's edge can lag the URL print by a minute+.
# DNS goes through DoH; the request is pinned with --resolve so a LAN DNS
# blocklist on *.trycloudflare.com can't break the check.
echo "[host] verifying tunnel end-to-end (edge propagation can take ~1-2 min)..."
EDGE_IP="$(doh_resolve "$BARE_HOST")"
TUNNEL_OK=0
CODE=""
for _ in $(seq 1 60); do
  if [ -z "$EDGE_IP" ]; then EDGE_IP="$(doh_resolve "$BARE_HOST")"; fi
  if [ -n "$EDGE_IP" ]; then
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 \
      --resolve "${BARE_HOST}:443:${EDGE_IP}" "$TUNNEL_HOST/health" || true)"
    if [ "$CODE" = "200" ]; then TUNNEL_OK=1; break; fi
  fi
  sleep 3
done
if [ "$TUNNEL_OK" = "1" ]; then
  echo "[host] tunnel verified end-to-end (edge → this PC)."
  echo
  echo "══════════════════════════════════════════════════════════════════════"
  echo "  JAKESJAM is hosted from this PC."
  echo
  echo "  Share this link — players auto-join the pub world from it:"
  echo "    $TUNNEL_HOST/?world=1"
  echo
  echo "  (bare $TUNNEL_HOST lands on the menu instead)"
  echo
  echo "  LAN players : http://${LAN_IP:-<this-machine-ip>}:$PORT/?world=1"
  echo "  Health      : $TUNNEL_HOST/health"
  echo "  Logs        : $LOG_DIR/server.log  $LOG_DIR/tunnel.log"
  echo
  echo "  Ctrl-C stops hosting."
  echo "══════════════════════════════════════════════════════════════════════"
  echo
else
  echo "[host] tunnel could not be verified (last HTTP code: ${CODE:-none},"
  echo "[host] edge IP: ${EDGE_IP:-unresolved}) — falling back to DIRECT mode."
  echo "[host] (This network is known to register quick tunnels that never"
  echo "[host] carry traffic — see script header.)"
  kill_tree "$TUNNEL_PID"
  TUNNEL_PID=""
  print_direct_banner
fi

# Follow the server log until interrupted.
tail -f "$LOG_DIR/server.log" &
wait $SERVER_PID
