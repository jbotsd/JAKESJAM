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
if ! curl -sS -m 1 http://127.0.0.1:9876/health >/dev/null 2>&1; then
  echo "Starting game-capture-server…"
  nohup python3 "$ROOT/game-capture-server.py" >/tmp/jj-capture-srv.log 2>&1 &
fi
# Voice-reactive gnostic seal for OBS (mic → geometry)
if ! curl -sS -m 1 http://127.0.0.1:9877/health >/dev/null 2>&1; then
  echo "Starting voice-overlay-server…"
  nohup python3 "$ROOT/voice-overlay-server.py" >/tmp/jj-voice-overlay.log 2>&1 &
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
else
  echo "obs not found"
  exit 1
fi
