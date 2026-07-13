#!/usr/bin/env bash
# Companion to launch-stream-ready.sh — that script had NO exit-cleanup at
# all: OBS is fired via `hyprctl dispatch exec` (fire-and-forget, no PID
# tracked) and the two Python helper servers (game-capture-server.py,
# voice-overlay-server.py) just kept running forever after OBS closed.
# Next launch's health-check then saw the STALE server as "healthy" (it's
# still bound to the port and answering /health) and skipped starting a
# fresh one — even though its grim capture target was a now-closed kiosk
# window, so the feed it served was black/frozen. This is the likely root
# cause of "worked once, broke on the next session."
#
# Run this after you're done streaming, or before launch-stream-ready.sh
# if you suspect a stale server from an earlier session.
set -uo pipefail

echo "== Stopping JAKESJAM stream software =="

kill_matching() {
  local pattern="$1"
  local label="$2"
  # pgrep -f matches the full command line correctly (no /proc/pid/cmdline
  # NUL-separator grep trap — see env_ollama-style kill-loop gotchas).
  local pids
  pids="$(pgrep -f "$pattern" || true)"
  if [[ -z "$pids" ]]; then
    echo "  $label: not running"
    return
  fi
  echo "  $label: killing PID(s) $pids"
  kill $pids 2>/dev/null || true
  sleep 0.3
  # Escalate only what's still alive after the polite signal.
  local still
  still="$(pgrep -f "$pattern" || true)"
  if [[ -n "$still" ]]; then
    kill -9 $still 2>/dev/null || true
  fi
}

kill_matching "game-capture-server.py" "game-capture-server"
kill_matching "voice-overlay-server.py" "voice-overlay-server"

if [[ "${1:-}" == "--obs" ]]; then
  kill_matching "obs --profile JAKESJAM" "OBS (JAKESJAM profile)"
fi

echo "Done. (pass --obs to also close OBS itself)"
