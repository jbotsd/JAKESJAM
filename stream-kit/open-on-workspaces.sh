#!/usr/bin/env bash
# Hyprland: OBS → workspace 5 · game → workspace 6
#
# Overlays (BRB / Starting Soon / Ending / Brand / Lower Third) are
# image_source in OBS, loaded from stream-kit/assets/png/ — you do NOT need
# browser windows or a file manager open for them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v hyprctl >/dev/null 2>&1; then
  echo "hyprctl not found"
  exit 1
fi

CHROME=""
for c in /usr/bin/chromium /usr/local/bin/chromium /usr/bin/google-chrome-stable /usr/local/bin/brave; do
  if [[ -x "$c" ]]; then CHROME="$c"; break; fi
done
[[ -n "$CHROME" ]] || { echo "No Chromium found"; exit 1; }

echo "== JAKESJAM stream layout (minimal) =="
echo "  workspace 5 = OBS only"
echo "  workspace 6 = game (normal player cam)"
echo "  overlays     = PNGs inside OBS — no preview windows"
echo

spawn5() {
  hyprctl dispatch exec "[workspace 5 silent] $*" >/dev/null 2>&1 || true
}
spawn6() {
  hyprctl dispatch exec "[workspace 6 silent] $*" >/dev/null 2>&1 || true
}

# ── 5: OBS only ──
if ! pgrep -x obs >/dev/null 2>&1; then
  if command -v obs >/dev/null 2>&1; then
    spawn5 obs --profile JAKESJAM --collection JAKESJAM
    sleep 0.5
  fi
else
  echo "  OBS already running"
fi

# ── 6: fullscreen kiosk game (no browser chrome) ──
if [[ -x "$ROOT/launch-game-kiosk.sh" ]]; then
  KIOSK_WS=6 "$ROOT/launch-game-kiosk.sh" "https://play.elyad.io/?kiosk=1&world=1" || true
else
  spawn6 "$CHROME" --new-window "https://play.elyad.io/?kiosk=1"
fi

sleep 1.2

# ── Sweep: OBS → 5, game → 6 ──
python3 - <<'PY'
import json, subprocess

def clients():
    return json.loads(subprocess.check_output(["hyprctl", "clients", "-j"], text=True))

def move(addr: str, ws: int):
    subprocess.run(
        ["hyprctl", "dispatch", "movetoworkspacesilent", f"{ws},address:{addr}"],
        check=False, capture_output=True,
    )

GAME_BITS = (
    "play.elyad.io",
    "crystal-arena",
    "crystal arena",
    "hot lobby",
    "jakesjam — crystal",
)

for c in clients():
    title = (c.get("title") or "").lower()
    cls = (c.get("class") or "").lower()
    addr = c.get("address")
    if not addr:
        continue
    if "obs" in cls or "com.obsproject" in cls:
        move(addr, 5)
        continue
    if any(b in title for b in GAME_BITS):
        move(addr, 6)
        continue

print("workspace assignment done")
PY

hyprctl dispatch workspace 5 >/dev/null 2>&1 || true

sleep 0.2
python3 - <<'PY'
import json, subprocess
from collections import Counter
clients = json.loads(subprocess.check_output(["hyprctl", "clients", "-j"], text=True))
print("\nWindows on 5 / 6:")
for c in clients:
    ws = c.get("workspace", {}).get("id")
    if ws in (5, 6):
        print(f"  [{ws}] {c.get('class')}: {(c.get('title') or '')[:72]}")
print("counts", Counter(
    c.get("workspace", {}).get("id")
    for c in clients
    if c.get("workspace", {}).get("id") in (5, 6)
))
PY

echo
echo "Done. Super+5 = OBS · Super+6 = game"
echo "OBS scenes switch Starting Soon / GAME / BRB / Ending — graphics are files, not windows."
echo "Optional: open stream-kit/overlays/*.html only if you want to re-edit HTML designs."
