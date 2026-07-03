#!/usr/bin/env bash
# Host JAKESJAM multiplayer from THIS machine — fully self-contained.
# No Fly, no Convex, no Vercel: one Bun process serves the built client
# AND the game server; one Cloudflare quick tunnel exposes both.
#
#   1. builds the client (if client/dist is missing; force with --build)
#   2. starts the Bun game server on :$PORT serving client/dist statics
#   3. opens a Cloudflare quick tunnel (wss works through CF)
#   4. verifies the tunnel end-to-end, then prints ONE shareable link
#
# Players open the link, pick a name, and join the pub world
# (/world-token + /ws/world — no external matchmaking service needed).
# The client auto-targets its own origin for the game server, so the
# bare tunnel URL is the whole story.
#
# Ctrl-C tears everything down.
#
# NOTE: tunnel reachability is verified through DNS-over-HTTPS (1.1.1.1).
# Some LAN resolvers (Pi-hole style blocklists) block *.trycloudflare.com —
# that only breaks resolution ON THIS LAN; remote players are unaffected.
# LAN players can use http://<this-machine-ip>:$PORT directly.
#
# TUNNEL PROVIDERS (this network is CGNAT — verified 2026-07-02/03):
#   funnel (default) — Tailscale Funnel. STABLE URL
#                    (https://randel.<tailnet>.ts.net), survives reboots,
#                    verified end-to-end (HTTP + WS + browser world-join).
#                    Needs: tailscaled up, funnel enabled on the tailnet,
#                    and `tailscale set --operator=<user>` (all done
#                    2026-07-03). Falls back to lhr if unavailable.
#   lhr            — localhost.run over SSH. Works here but free URLs
#                    ROTATE every ~15-30 min by design. Auto-reconnects.
#   cloudflared    — quick tunnels REGISTER but never carry traffic on
#                    this network (edge 522/404; QUIC + http2, v4 + v6
#                    edges, multiple tunnels). Kept for other networks.
#   none           — direct mode: share http://<public-ip>:$PORT after a
#                    router port-forward (requires CGNAT opt-out at the
#                    ISP; lowest latency once available).
#
# Env knobs:
#   PORT              game server port (default 8088)
#   TUNNEL=funnel|lhr|cloudflared|none   tunnel provider (default funnel)
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
REGION=home PORT="$PORT" PORT_SEARCH_RANGE=1 SERVE_CLIENT_DIR="$PWD/client/dist" \
  WORLD_BOTS="${WORLD_BOTS:-2}" \
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
  echo "  Logs        : $LOG_DIR/server.log"
  echo
  echo "  Ctrl-C stops hosting."
  echo "══════════════════════════════════════════════════════════════════════"
  echo
}

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
  echo "  Health      : $1/health"
  echo "  Logs        : $LOG_DIR/server.log  $LOG_DIR/tunnel.log"
  echo
  echo "  Ctrl-C stops hosting."
  echo "══════════════════════════════════════════════════════════════════════"
  echo
}

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
