#!/usr/bin/env bash
# Restart the PUBLIC :8088 game server in place — gospel L6 + the E2 flip.
#
# Only the bun server. The cloudflared tunnel (`jakesjam`) is a separate
# process pointed at :8088, so it survives this and reconnects on its own;
# `host-public.sh` would tear the tunnel down and rebuild the client, which
# is far more than a sim-change restart needs.
#
# THE E2 KILL-SWITCH (gospel Track E2):
#   WASM_AUTHORITY=on   → export USE_WASM_STEP_WORLD=1  (Zig authority)
#   WASM_AUTHORITY=off  → leave it unset                (TS authority)
# Default is OFF, so running this bare always restores the pre-flip
# behaviour. Reverting a bad flip is therefore:
#   scripts/relaunch-public-host.sh          # back to TS
# and nothing else — no file to edit, no flag to remember.
#
# WASM_STRICT is deliberately NEVER set here. Live wants the per-tick
# fallback: it is what keeps a match alive when a tick throws. Strict mode
# is for gate runs and the soak (see wasm-authority-soak.sh).
#
# Verify after: /health carries
#   sim.authority ("wasm"|"ts") · sim.wasmReady · sim.wasmFallbackTicks
# A flipped host reporting authority "wasm" with a RISING fallback count is
# silently stepping TS — the one failure mode the flip must not hide (L8).

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8088}"
LOG_DIR=".host-logs"
LOG="$LOG_DIR/server.log"
mkdir -p "$LOG_DIR"

# L6: never restart out from under a human. Bots are fine — they are the
# only thing on the host most days, and they re-roll a cycle without care.
HUMANS="$(curl -sf --max-time 5 "http://localhost:$PORT/health" 2>/dev/null \
  | grep -o '"humans":[0-9]*' | head -1 | cut -d: -f2 || true)"
HUMANS="${HUMANS:-0}"
if [ "$HUMANS" != "0" ] && [ "${FORCE:-}" != "1" ]; then
  echo "REFUSING: $HUMANS human(s) on the live host. Re-run with FORCE=1 only" >&2
  echo "if you have decided to interrupt them." >&2
  exit 3
fi

# The sim is loaded once at boot, so a stale sim.wasm would go live silently.
if [ ! -f client/public/wasm/sim.wasm ]; then
  echo "ERROR: client/public/wasm/sim.wasm missing — run 'bun run sim:build'." >&2
  exit 2
fi

# ADMIN_SECRET persists across restarts so the same /ops cookie keeps
# working; the world token secret is self-minted per process (this host
# both mints and verifies), so a fresh one is correct.
ADMIN_SECRET_FILE="$LOG_DIR/admin-secret"
if [ -z "${ADMIN_SECRET:-}" ] && [ -f "$ADMIN_SECRET_FILE" ]; then
  ADMIN_SECRET="$(tr -d '\n' < "$ADMIN_SECRET_FILE")"
fi
export ADMIN_SECRET="${ADMIN_SECRET:-$(head -c 32 /dev/urandom | base64)}"
export GAME_SERVER_SECRET="$(head -c 32 /dev/urandom | base64)"

# play.elyad.io is the brand face the tunnel actually serves — clip share
# links are built from it. (The old .host-logs/relaunch.sh had a stale
# jakesjam.elyad.io here, which would have mislabelled every share link.)
export PUBLIC_URL="${PUBLIC_URL:-https://play.elyad.io}"
export SERVE_CLIENT_DIR="$PWD/client/dist"
export WORLD_BOTS="${WORLD_BOTS:-2}"
export PORT PORT_SEARCH_RANGE="${PORT_SEARCH_RANGE:-1}" REGION="${REGION:-home}"

case "${WASM_AUTHORITY:-off}" in
  on|1|true) export USE_WASM_STEP_WORLD=1; AUTH="wasm (Zig)" ;;
  *)         unset USE_WASM_STEP_WORLD || true; AUTH="ts" ;;
esac

OLD_PID="$(ss -tlnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $0}' \
  | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
if [ -n "$OLD_PID" ]; then
  echo "[relaunch] stopping pid $OLD_PID on :$PORT"
  kill -TERM "$OLD_PID" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 "$OLD_PID" 2>/dev/null || break
    sleep 0.25
  done
  kill -0 "$OLD_PID" 2>/dev/null && kill -KILL "$OLD_PID" 2>/dev/null || true
fi

echo "[relaunch] starting :$PORT with authority=$AUTH bots=$WORLD_BOTS"
setsid bun --cwd server src/index.ts >>"$LOG" 2>&1 &
NEW_PID=$!

for _ in $(seq 1 60); do
  curl -sf --max-time 3 "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "[relaunch] ERROR: server exited during boot:" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  sleep 0.5
done

H="$(curl -sf --max-time 5 "http://localhost:$PORT/health" || true)"
echo "[relaunch] pid=$NEW_PID"
echo "[relaunch] sim: $(echo "$H" | grep -o '"sim":{[^}]*}' || echo '(no sim block — server predates the E2 instrument)')"

# Fail loudly if we asked for wasm and did not get it: a host that quietly
# fell back to TS while reporting success is exactly what E2's whole
# evidence chain is built to prevent.
if [ "${WASM_AUTHORITY:-off}" != "off" ]; then
  AUTHORITY="$(echo "$H" | grep -o '"authority":"[a-z]*"' | cut -d'"' -f4 || true)"
  READY="$(echo "$H" | grep -o '"wasmReady":[a-z]*' | cut -d: -f2 || true)"
  if [ "$AUTHORITY" != "wasm" ] || [ "$READY" != "true" ]; then
    echo "[relaunch] WARNING: asked for wasm authority, got authority=$AUTHORITY ready=$READY" >&2
    echo "[relaunch] The kill-switch is a bare re-run of this script." >&2
    exit 4
  fi
fi
