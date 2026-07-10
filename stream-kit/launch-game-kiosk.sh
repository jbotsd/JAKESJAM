#!/usr/bin/env bash
# JAKESJAM — fullscreen, chrome-less game shell for streaming / capture.
#
# Why not a "real browser"?
#   OBS needs a clean 16:9 canvas. Chromium tabs = URL bar, shadows, OS
#   chrome, extensions. This launches an *app window* (no tab strip) with a
#   dedicated profile, then Hyprland forces borderless fullscreen on WS6.
#
# Why not Electron/Tauri tonight?
#   Extra dep + packaging. Chromium --app is already installed and hits the
#   same WebGL path as production. Upgrade path later: Tauri wrapper that
#   loads the same URL if we want a .desktop icon and true no-chrome binary.
#
# Usage:
#   ./stream-kit/launch-game-kiosk.sh
#   ./stream-kit/launch-game-kiosk.sh 'https://play.elyad.io/?world=1'
#   KIOSK_WS=6 KIOSK_URL=... ./stream-kit/launch-game-kiosk.sh
set -euo pipefail

URL="${1:-${KIOSK_URL:-https://play.elyad.io/?kiosk=1&world=1}}"
# Ensure kiosk flag is present so client CSS/JS hide residual shell chrome.
case "$URL" in
  *kiosk=1*) ;;
  *\?*) URL="${URL}&kiosk=1" ;;
  *) URL="${URL}?kiosk=1" ;;
esac

WS="${KIOSK_WS:-6}"
CLASS="jakesjam-kiosk"
PROFILE="${KIOSK_PROFILE:-$HOME/.cache/jakesjam-kiosk-profile}"
mkdir -p "$PROFILE"

CHROME=""
for c in /usr/bin/chromium /usr/local/bin/chromium /usr/bin/google-chrome-stable /usr/local/bin/brave; do
  if [[ -x "$c" ]]; then CHROME="$c"; break; fi
done
if [[ -z "$CHROME" ]]; then
  echo "No Chromium/Chrome found"
  exit 1
fi

# Drop omarchy's wayland force-flags when we can — use a clean env for the app shell.
# --app= removes tab bar / URL bar. --start-fullscreen requests FS; Hyprland rules
# enforce borderless fullscreen even if the browser only maximizes.
#
# GPU path: Phaser WebGL + ANGLE. Never --disable-gpu (that melted a whole
# core of software rasterization on the spectator capture chrome). Prefer
# NVIDIA/renderD128 via default Ozone/Wayland GPU process.
ARGS=(
  --user-data-dir="$PROFILE"
  --class="$CLASS"
  --name="$CLASS"
  --app="$URL"
  --start-fullscreen
  --no-first-run
  --no-default-browser-check
  --disable-extensions
  --disable-sync
  --disable-translate
  --disable-features=TranslateUI,MediaRouter
  --enable-gpu
  --ignore-gpu-blocklist
  --enable-gpu-rasterization
  --enable-zero-copy
  --use-gl=angle
  --enable-features=VaapiVideoDecoder,CanvasOopRasterization
  --autoplay-policy=no-user-gesture-required
  --disable-session-crashed-bubble
  --check-for-update-interval=31536000
)

echo "== JAKESJAM kiosk =="
echo "  url:     $URL"
echo "  class:   $CLASS"
echo "  profile: $PROFILE"
echo "  workspace $WS (Hyprland)"
echo

if command -v hyprctl >/dev/null 2>&1; then
  # Spawn directly onto the stream game workspace
  # shellcheck disable=SC2086
  hyprctl dispatch exec "[workspace ${WS} silent] $CHROME ${ARGS[*]}" >/dev/null 2>&1 || true
  sleep 1.2
  # Force fullscreen + focus on matching class
  sleep 0.8
  python3 - <<'PY'
import json, subprocess, os
ws = int(os.environ.get("KIOSK_WS", "6"))
raw = subprocess.check_output(["hyprctl", "clients", "-j"], text=True)

def score(c):
    cname = (c.get("class") or "").lower()
    init = (c.get("initialClass") or "").lower()
    title = (c.get("title") or "")
    # Prefer Chromium --app= shell over a normal chromium tab
    if "chrome-play.elyad.io" in cname or "chrome-play.elyad.io" in init:
        return 100
    if "jakesjam-kiosk" in cname or "jakesjam-kiosk" in init:
        return 90
    if title == "JAKESJAM":
        return 80
    return 0

ranked = sorted(
    (score(c), c) for c in json.loads(raw) if score(c) > 0
)
if not ranked:
    print("window not found yet — Hyprland rules should catch it on map")
else:
    _, c = ranked[-1]
    addr = c["address"]
    cname = c.get("class")
    subprocess.run(["hyprctl", "dispatch", "movetoworkspacesilent", f"{ws},address:{addr}"], capture_output=True)
    subprocess.run(["hyprctl", "dispatch", "focuswindow", f"address:{addr}"], capture_output=True)
    # Toggle fullscreen if not already (0 = real fullscreen)
    if not c.get("fullscreen"):
        subprocess.run(["hyprctl", "dispatch", "fullscreen", "0"], capture_output=True)
    print("kiosk window", cname, "title=", (c.get("title") or "")[:40], "→ ws", ws, "fullscreen")
PY
else
  nohup "$CHROME" "${ARGS[@]}" >/tmp/jakesjam-kiosk.log 2>&1 &
  echo "spawned pid $!"
fi

echo
echo "Escape: leave browser fullscreen · Super+F: Hyprland fullscreen toggle"
echo "Capture title should contain JAKESJAM / play.elyad — grim feed will pick it up."
