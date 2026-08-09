#!/usr/bin/env bash
# gospel-goal E2 — flip the LIVE host to Zig (wasm) authority, observed,
# with automatic rollback.
#
# Direction was ratified 2026-08-05 ("GO ALL ZIG"); execution is
# evidence-gated only. This script is the execution half, written so the
# most consequential action in the goal is one deterministic command
# instead of an ad-hoc restart typed under pressure.
#
# WHAT IT DOES
#   1. refuses unless the gate is actually green (--force to override,
#      which you should not need and should have to think about)
#   2. captures the running server's exact environment and relaunches it
#      identically PLUS USE_WASM_STEP_WORLD=1
#   3. verifies /health reports authority=wasm AND wasmReady=true
#   4. watches for OBSERVE_S, failing on the first fallback tick
#   5. rolls back automatically on any failure — same env, flag removed
#
# WHAT IT DELIBERATELY DOES NOT DO
#   · set WASM_STRICT. Live, the per-tick fallback is the kill-switch that
#     keeps a match alive when a tick throws. Strict mode is for gates.
#   · touch cloudflared. The tunnel is its own process (verified: the
#     server's parent is host-public.sh, cloudflared is a sibling), so a
#     server restart does not drop play.elyad.io.
#   · run while humans are playing. It checks and refuses (L6).
#
#   scripts/e2-flip.sh [--observe 600] [--force]
#   scripts/e2-flip.sh --rollback     # put TS authority back, now

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8088}"
OBSERVE_S="${OBSERVE_S:-600}"
FORCE=0
ROLLBACK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --observe) OBSERVE_S="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --rollback) ROLLBACK_ONLY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

LOG_DIR=".host-logs"
STAMP="$(date +%Y%m%d-%H%M%S)"
RECORD="$LOG_DIR/e2-flip-$STAMP.log"
mkdir -p "$LOG_DIR"

say() { echo "[e2-flip] $*" | tee -a "$RECORD"; }

health() { curl -sf --max-time 5 "http://localhost:$PORT/health" || true; }
field() { echo "$1" | grep -o "\"$2\":[^,}]*" | head -1 | cut -d: -f2- | tr -d '"'; }

server_pid() {
  # The live host, not a soak or e2e instance: match the port it listens on.
  ss -tlnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $NF}' \
    | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

# Relaunch with the CURRENT process's environment plus/minus the flag, so
# the flip cannot silently change anything else about how the host runs
# (secrets, bots, dist path, public URL).
relaunch() { # $1 = "wasm" | "ts"
  local mode="$1" pid env_file
  pid="$(server_pid)"
  [ -n "$pid" ] || { say "no server on :$PORT — nothing to relaunch"; return 1; }

  env_file="$(mktemp)"
  tr '\0' '\n' < "/proc/$pid/environ" \
    | grep -vE '^(USE_WASM_STEP_WORLD|WASM_STRICT)=' > "$env_file"
  if [ "$mode" = "wasm" ]; then echo "USE_WASM_STEP_WORLD=1" >> "$env_file"; fi

  say "stopping pid $pid"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do
    ss -tlnp 2>/dev/null | grep -q ":$PORT " || break
    sleep 0.5
  done

  say "starting under $mode authority"
  # `env -i` with the captured pairs, never `source`: values are arbitrary
  # (base64 secrets carry =, +, /) and sourcing would re-parse them. Read
  # into an ARRAY rather than word-splitting `tr '\n' ' '` — one env value
  # containing a space would otherwise silently become two variables, and
  # SERVE_CLIENT_DIR is a filesystem path. PATH/HOME come from the captured
  # environ, so `bun` still resolves under env -i.
  local -a envpairs=()
  while IFS= read -r line; do
    [ -n "$line" ] && envpairs+=("$line")
  done < "$env_file"
  rm -f "$env_file"
  ( env -i "${envpairs[@]}" nohup setsid bun --cwd server src/index.ts \
      >> "$LOG_DIR/server.log" 2>&1 < /dev/null & disown ) || true

  for _ in $(seq 1 60); do
    [ -n "$(health)" ] && return 0
    sleep 1
  done
  say "server did not become healthy on :$PORT"
  return 1
}

if [ "$ROLLBACK_ONLY" = "1" ]; then
  say "MANUAL ROLLBACK requested"
  relaunch ts && say "back on TS authority" || say "ROLLBACK FAILED — check $LOG_DIR/server.log"
  exit 0
fi

# ── Gate ────────────────────────────────────────────────────────────────
H="$(health)"
[ -n "$H" ] || { say "no healthy server on :$PORT"; exit 1; }

HUMANS="$(field "$H" humans)"; HUMANS="${HUMANS:-0}"
if [ "${HUMANS:-0}" -gt 0 ] && [ "$FORCE" != "1" ]; then
  say "REFUSING: $HUMANS human(s) in the world right now (L6). Try later or --force."
  exit 1
fi

LATEST_VERDICT="$(ls -t "$LOG_DIR"/soak-*.verdict 2>/dev/null | head -1 || true)"
if [ -z "$LATEST_VERDICT" ] || ! grep -q "VERDICT=PASS" "$LATEST_VERDICT"; then
  say "REFUSING: no PASSing soak verdict in $LOG_DIR (found: ${LATEST_VERDICT:-none})"
  [ "$FORCE" = "1" ] || exit 1
fi
say "gate: soak verdict $(basename "${LATEST_VERDICT:-none}") · humans=$HUMANS"

# "Soak what you flip": the soak must have STARTED after the last commit
# that touched the sim.
#
# Compare against the soak's start, NOT the verdict's mtime — the verdict is
# written 2+ hours later, so a commit landing mid-soak would look "older"
# than it and slip through, which is precisely the stale-evidence hole this
# check exists to close. The start time is in the filename
# (soak-YYYYmmdd-HHMMSS.verdict), which is stamped when the run begins.
LAST_SIM_COMMIT_TS="$(git log -1 --format=%ct -- sim/src server/src client/src/sim 2>/dev/null || echo 0)"
SOAK_STAMP="$(basename "${LATEST_VERDICT:-}" .verdict | sed 's/^soak-//')"
SOAK_START_TS="$(date -d "${SOAK_STAMP:0:8} ${SOAK_STAMP:9:2}:${SOAK_STAMP:11:2}:${SOAK_STAMP:13:2}" +%s 2>/dev/null || echo 0)"
if [ "${SOAK_START_TS:-0}" -lt "$LAST_SIM_COMMIT_TS" ]; then
  say "REFUSING: the soak STARTED before the newest sim/server/client-sim commit."
  say "  soak start: $(date -d "@${SOAK_START_TS:-0}" '+%F %T')   last sim commit: $(date -d "@$LAST_SIM_COMMIT_TS" '+%F %T')"
  say "  re-soak HEAD first — the gate says soak what you flip."
  [ "$FORCE" = "1" ] || exit 1
fi

# ── Flip ────────────────────────────────────────────────────────────────
relaunch wasm || { say "relaunch failed — rolling back"; relaunch ts; exit 1; }

H="$(health)"
AUTH="$(field "$H" authority)"
READY="$(field "$H" wasmReady)"
if [ "$AUTH" != "wasm" ] || [ "$READY" != "true" ]; then
  say "FLIP DID NOT TAKE (authority=$AUTH wasmReady=$READY) — rolling back"
  relaunch ts
  exit 1
fi
say "LIVE UNDER ZIG AUTHORITY — observing ${OBSERVE_S}s"

# ── Observe ─────────────────────────────────────────────────────────────
START="$(date +%s)"
while :; do
  NOW="$(date +%s)"; EL=$((NOW - START))
  [ "$EL" -ge "$OBSERVE_S" ] && break
  H="$(health)"
  if [ -z "$H" ]; then
    say "health went dark at ${EL}s — rolling back"; relaunch ts; exit 1
  fi
  FB="$(field "$H" wasmFallbackTicks)"; FB="${FB:-0}"
  RDY="$(field "$H" wasmReady)"
  if [ "${FB:-0}" -ne 0 ]; then
    say "fallback ticks=$FB at ${EL}s — the host is silently stepping TS. Rolling back."
    relaunch ts; exit 1
  fi
  if [ "$RDY" != "true" ]; then
    say "wasmReady went false at ${EL}s — rolling back"; relaunch ts; exit 1
  fi
  say "  +${EL}s ok — fallback=0 humans=$(field "$H" humans)"
  sleep 30
done

say "FLIP HELD for ${OBSERVE_S}s with zero fallback ticks."
say "Record it in the goal's STATUS. Rollback any time: scripts/e2-flip.sh --rollback"
