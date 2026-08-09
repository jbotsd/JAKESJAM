#!/usr/bin/env bash
# gospel-goal E2 — headless bot-only soak under Zig (wasm) authority.
#
# The E2 flip gate: ">=2 h, zero divergence events, heap flat". This runs
# a SECOND server instance on non-live ports so the public :8088 host is
# never touched (L6 live-host discipline) — no tunnel, no client statics,
# no humans, just bots stepping the Zig core.
#
# Evidence is polled from /health rather than grepped from stderr:
#   sim.authority         must be "wasm" for the whole run
#   sim.wasmReady         must stay true
#   sim.wasmFallbackTicks must stay 0 — non-zero means the host silently
#                         went back to stepping TS, which is exactly the
#                         failure the flip must not hide
#   rss                   sampled each poll; the gate wants it flat
#
# WASM_STRICT is deliberately NOT set: a strict throw would kill the run
# at the first fallback and lose the rest of the soak. The counter above
# catches the same condition without ending the evidence early.
#
# Usage:  scripts/wasm-authority-soak.sh [SECONDS]   (default 7800 = 2h10m)
# Output: .host-logs/soak-<stamp>.{log,csv,verdict,pid}
#
# RUN IT UNDER SYSTEMD, not from an agent/terminal session:
#
#   systemctl --user reset-failed jj-soak 2>/dev/null
#   systemd-run --user --collect --unit=jj-soak --working-directory="$PWD" \
#     --setenv=PATH="$PATH" bash scripts/wasm-authority-soak.sh 7800
#   systemctl --user is-active jj-soak      # watch
#   systemctl --user stop jj-soak           # abort
#
# Why: a 2 h soak launched from a shell session keeps getting reaped
# before it can finish. On 2026-08-09 one run was killed 8 min short of
# target (94%, every row clean, no verdict) and the next died 30 s in to
# a SIGTERM neither the script nor the server asked for. systemd owns the
# process instead of the session, so the run outlives whatever tooling
# started it. The gate compares soak START against the newest sim commit,
# so a run that cannot survive to write a verdict blocks the flip just as
# hard as a failing one.

set -euo pipefail
cd "$(dirname "$0")/.."

DURATION="${1:-7800}"
PORT="${SOAK_PORT:-8188}"
OPS_PORT="${SOAK_OPS_PORT:-8189}"
BOTS="${WORLD_BOTS:-4}"
POLL="${SOAK_POLL:-30}"

LOG_DIR=".host-logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/soak-$STAMP.log"
CSV="$LOG_DIR/soak-$STAMP.csv"
VERDICT="$LOG_DIR/soak-$STAMP.verdict"

if [ "$PORT" = "8088" ] || [ "$OPS_PORT" = "8089" ]; then
  echo "REFUSING: soak must not use the live ports (8088/8089)." >&2
  exit 2
fi

echo "[soak] duration=${DURATION}s port=$PORT bots=$BOTS poll=${POLL}s"
echo "[soak] log=$LOG csv=$CSV"

# sim.wasm must exist and be current or the host loads a stale/absent
# module and pins TS — which would make the soak pass while proving
# nothing (the same hollow-gate shape this soak exists to avoid).
if [ ! -f client/public/wasm/sim.wasm ]; then
  echo "[soak] ERROR: client/public/wasm/sim.wasm missing — run 'bun run sim:build'." >&2
  exit 2
fi

GAME_SERVER_SECRET="$(head -c 32 /dev/urandom | base64)"
export GAME_SERVER_SECRET

REGION=soak PORT="$PORT" OPS_PORT="$OPS_PORT" PORT_SEARCH_RANGE=1 \
  WORLD_BOTS="$BOTS" \
  USE_WASM_STEP_WORLD=1 \
  setsid bun --cwd server src/index.ts >"$LOG" 2>&1 &
SERVER_PID=$!
# Pidfile so an orphan is DISCOVERABLE. `setsid` detaches the host on
# purpose (so cleanup can kill the whole tree), which also means it survives
# the script being killed from outside — the trap below never runs then.
# That happened on 2026-08-09: the run was stopped at 94% and left a live
# server on this port. Recovery is now:
#   kill $(cat .host-logs/soak-<stamp>.pid)
PIDFILE="$LOG_DIR/soak-$STAMP.pid"
printf '%s\n' "$SERVER_PID" >"$PIDFILE"

cleanup() {
  trap - EXIT INT TERM
  kill -TERM "-$SERVER_PID" 2>/dev/null || kill -TERM "$SERVER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -f "${PIDFILE:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 60); do
  curl -sf --max-time 3 "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[soak] ERROR: server exited during boot:" >&2; tail -20 "$LOG" >&2; exit 1
  fi
  sleep 1
done

BOOT_JSON="$(curl -sf --max-time 5 "http://localhost:$PORT/health" || true)"
AUTHORITY="$(echo "$BOOT_JSON" | grep -o '"authority":"[a-z]*"' | cut -d'"' -f4 || true)"
WASM_READY="$(echo "$BOOT_JSON" | grep -o '"wasmReady":[a-z]*' | cut -d: -f2 || true)"
if [ "$AUTHORITY" != "wasm" ] || [ "$WASM_READY" != "true" ]; then
  echo "[soak] ABORT: host did not come up under wasm authority (authority=$AUTHORITY ready=$WASM_READY)." >&2
  echo "[soak] A soak on TS authority would be evidence of nothing." >&2
  exit 1
fi
echo "[soak] wasm authority confirmed at boot; soaking ${DURATION}s..."

echo "elapsed_s,rss_kb,fallback_ticks,matches,wasm_ready,tick_p99_ms" >"$CSV"

START="$(date +%s)"
FIRST_RSS=""
MAX_FALLBACK=0
FAILED=""

while :; do
  NOW="$(date +%s)"; ELAPSED=$((NOW - START))
  if [ "$ELAPSED" -ge "$DURATION" ]; then break; fi

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    FAILED="server process died at ${ELAPSED}s"; break
  fi

  H="$(curl -sf --max-time 5 "http://localhost:$PORT/health" || true)"
  if [ -z "$H" ]; then
    echo "[soak] warn: health poll failed at ${ELAPSED}s" | tee -a "$LOG"
    sleep "$POLL"; continue
  fi

  # Every extraction is `|| true`: `set -o pipefail` + a `grep -o` that
  # matches nothing makes the assignment fail and, under `set -e`, kills
  # the whole soak. `perf` is null until the world has ticked, so the p99
  # grep legitimately finds nothing early — that cost the first smoke run.
  RSS="$(awk '/VmRSS/{print $2}' /proc/"$SERVER_PID"/status 2>/dev/null || echo 0)"
  FB="$(echo "$H" | grep -o '"wasmFallbackTicks":[0-9]*' | cut -d: -f2 || true)"
  RDY="$(echo "$H" | grep -o '"wasmReady":[a-z]*' | cut -d: -f2 || true)"
  MATCHES="$(echo "$H" | grep -o '"matches":[0-9]*' | cut -d: -f2 || true)"
  P99="$(echo "$H" | grep -o '"p99":[0-9.]*' | head -1 | cut -d: -f2 || true)"
  FB="${FB:-0}"; RDY="${RDY:-false}"; MATCHES="${MATCHES:-0}"; P99="${P99:-}"
  # `cond && assign` is a trap under `set -e`: when cond is false the list
  # returns 1 and kills the run. Cost the first smoke test its whole loop.
  if [ -z "$FIRST_RSS" ]; then FIRST_RSS="$RSS"; fi
  if [ "$FB" -gt "$MAX_FALLBACK" ]; then MAX_FALLBACK="$FB"; fi

  echo "$ELAPSED,$RSS,$FB,$MATCHES,$RDY,$P99" >>"$CSV"

  if [ "$FB" -ne 0 ]; then FAILED="wasmFallbackTicks=$FB at ${ELAPSED}s"; break; fi
  if [ "$RDY" != "true" ]; then FAILED="wasmReady went false at ${ELAPSED}s"; break; fi

  sleep "$POLL"
done

END="$(date +%s)"; RAN=$((END - START))
LAST_RSS="$(awk '/VmRSS/{print $2}' /proc/"$SERVER_PID"/status 2>/dev/null || echo 0)"
DIVERGENCE="$(grep -c "divergence\|desync\|resync" "$LOG" 2>/dev/null || true)"
DIVERGENCE="${DIVERGENCE:-0}"
FALLBACK_LOGGED="$(grep -c "wasm step threw" "$LOG" 2>/dev/null || true)"
FALLBACK_LOGGED="${FALLBACK_LOGGED:-0}"
CYCLES="$(grep -c "match complete" "$LOG" 2>/dev/null || true)"
CYCLES="${CYCLES:-0}"

{
  echo "soak $STAMP"
  echo "ran_s=$RAN target_s=$DURATION"
  echo "authority=wasm bots=$BOTS"
  echo "rss_first_kb=${FIRST_RSS:-0} rss_last_kb=$LAST_RSS"
  echo "fallback_ticks_max=$MAX_FALLBACK fallback_logged=$FALLBACK_LOGGED"
  echo "divergence_lines=$DIVERGENCE match_cycles=$CYCLES"
  if [ -n "$FAILED" ]; then
    echo "VERDICT=FAIL reason=$FAILED"
  elif [ "$RAN" -lt "$DURATION" ]; then
    echo "VERDICT=FAIL reason=short_run"
  elif [ "$MAX_FALLBACK" -ne 0 ] || [ "$FALLBACK_LOGGED" -ne 0 ]; then
    echo "VERDICT=FAIL reason=fallback_ticks"
  elif [ "$DIVERGENCE" -ne 0 ]; then
    echo "VERDICT=FAIL reason=divergence_lines"
  else
    echo "VERDICT=PASS"
  fi
} | tee "$VERDICT"
