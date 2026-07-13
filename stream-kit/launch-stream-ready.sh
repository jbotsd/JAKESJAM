#!/usr/bin/env bash
# Game + capture server + OBS (JAKESJAM profile).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "== JAKESJAM stream software =="
echo "Profile:     JAKESJAM"
echo "Collection:  JAKESJAM"
echo "Overlays:    $ROOT/assets/png/"
echo "Game feed:   http://127.0.0.1:9876/stream.mjpg"
echo "Recordings:  $HOME/Videos/JAKESJAM"
echo

if [[ ! -f "$HOME/.config/obs-studio/basic/scenes/JAKESJAM.json" ]]; then
  echo "Missing OBS scene collection."
  exit 1
fi

# Game window capture (grim → MJPEG)
CAPTURE_PID=""
if ! curl -sS -m 1 http://127.0.0.1:9876/health >/dev/null 2>&1; then
  echo "Starting game-capture-server…"
  nohup python3 "$ROOT/game-capture-server.py" >/tmp/jj-capture-srv.log 2>&1 &
  CAPTURE_PID=$!
else
  echo "game-capture-server already healthy (reusing — if the feed looks stale/wrong, run stop-stream.sh first)"
fi
# Voice-reactive gnostic seal for OBS (mic → geometry)
VOICE_PID=""
if ! curl -sS -m 1 http://127.0.0.1:9877/health >/dev/null 2>&1; then
  echo "Starting voice-overlay-server…"
  nohup python3 "$ROOT/voice-overlay-server.py" >/tmp/jj-voice-overlay.log 2>&1 &
  VOICE_PID=$!
else
  echo "voice-overlay-server already healthy (reusing — if it looks stale, run stop-stream.sh first)"
fi
sleep 1
curl -sS -m 2 http://127.0.0.1:9876/health || echo "(game feed not healthy yet)"
curl -sS -m 2 http://127.0.0.1:9877/health || echo "(voice overlay not healthy yet)"

CHROME=""
for c in /usr/bin/chromium /usr/local/bin/chromium /usr/bin/google-chrome-stable /usr/local/bin/brave; do
  if [[ -x "$c" ]]; then CHROME="$c"; break; fi
done
if [[ -x "$ROOT/launch-game-kiosk.sh" ]]; then
  echo "Opening kiosk game shell (no browser chrome)…"
  KIOSK_WS=6 "$ROOT/launch-game-kiosk.sh" "https://play.elyad.io/?kiosk=1&world=1" || true
elif [[ -n "$CHROME" ]]; then
  echo "Opening game → https://play.elyad.io/?kiosk=1"
  if command -v hyprctl >/dev/null 2>&1; then
    hyprctl dispatch exec "[workspace 6 silent] $CHROME --app=https://play.elyad.io/?kiosk=1" >/dev/null 2>&1 || true
  else
    "$CHROME" --app="https://play.elyad.io/?kiosk=1" >/dev/null 2>&1 &
  fi
fi

if command -v obs >/dev/null 2>&1; then
  echo "Launching OBS…"
  if command -v hyprctl >/dev/null 2>&1; then
    hyprctl dispatch exec "[workspace 5 silent] obs --profile JAKESJAM --collection JAKESJAM" >/dev/null 2>&1 || true
  else
    obs --profile "JAKESJAM" --collection "JAKESJAM" >/dev/null 2>&1 &
  fi
  echo
  echo "Scenes: STARTING SOON · GAME · BRB · ENDING"
  echo "GAME uses Media Source 'Game Feed' → local MJPEG (no PipeWire pick needed)."
  echo "Paste YouTube stream key when ready → Start Streaming."
  echo
  echo "Run stop-stream.sh when you're done — see it for why that matters"
  echo "(this script never used to clean anything up on exit)."

  # Auto-cleanup: OBS was launched fire-and-forget via `hyprctl dispatch
  # exec`, with nothing tracking when it actually closes — the helper
  # servers just ran forever afterward, and the NEXT launch's health-check
  # then saw a stale one as "healthy" and reused it (see stop-stream.sh's
  # header for the full story — this is the likely cause of "worked once,
  # broke the next session"). This background watcher polls for OBS itself
  # exiting and kills only the servers THIS invocation started (never a
  # pre-existing one someone else is relying on).
  if [[ -n "$CAPTURE_PID" || -n "$VOICE_PID" ]]; then
    (
      # Wait for OBS to actually appear first (hyprctl dispatch exec is
      # fire-and-forget — it can take a moment to launch) so the exit-poll
      # below doesn't see "not running yet" on its very first check and
      # kill the servers before OBS ever opened.
      for _ in $(seq 1 20); do
        pgrep -f "obs --profile JAKESJAM" >/dev/null 2>&1 && break
        sleep 1
      done
      while pgrep -f "obs --profile JAKESJAM" >/dev/null 2>&1; do
        sleep 5
      done
      [[ -n "$CAPTURE_PID" ]] && kill "$CAPTURE_PID" 2>/dev/null
      [[ -n "$VOICE_PID" ]] && kill "$VOICE_PID" 2>/dev/null
    ) >/tmp/jj-stream-watcher.log 2>&1 &
    disown
  fi
else
  echo "obs not found"
  exit 1
fi
