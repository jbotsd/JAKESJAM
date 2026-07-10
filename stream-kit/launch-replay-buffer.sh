#!/usr/bin/env bash
# JAKESJAM — zero-cost host kill clips via gpu-screen-recorder's replay buffer.
#
# Encodes the screen continuously on the GPU's dedicated NVENC block into a
# RAM ring buffer. The game server (JJ_HOST_REPLAY=1) sends SIGUSR1 ~3s
# after a kill → the buffer's last REPLAY_SECS seconds mux to disk in
# ~100ms → on-replay-saved.sh uploads it through the normal /clips
# pipeline. Game impact is effectively zero (author benchmarks: GTA V
# 60→58fps vs OBS 60→23) — nothing runs on the game's main thread.
#
# CAPTURE SCOPE: KMS plane capture records the VISIBLE screen. Run this on
# the streaming/kiosk host while the game workspace is displayed (the same
# constraint the OBS game feed already has). Window capture is X11-only.
#
# Usage:
#   ./stream-kit/launch-replay-buffer.sh            # monitor auto, 20s buffer
#   MONITOR=DP-1 REPLAY_SECS=30 ./stream-kit/launch-replay-buffer.sh
#
# First run may ask to install a setcap on gsr-kms-server (pacman package
# already ships it configured on this box).
#
# RUN THIS FROM A TERMINAL INSIDE THE HYPRLAND SESSION. gsr initializes
# EGL against the session GPU: from a detached/headless context it falls
# back to llvmpipe and aborts (verified 2026-07-10 — forcing the NVIDIA
# EGL vendor from outside the session core-dumps).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONITOR="${MONITOR:-screen}"      # "screen" = first monitor; or DP-1 etc.
REPLAY_SECS="${REPLAY_SECS:-20}"
FPS="${FPS:-60}"
OUT_DIR="${OUT_DIR:-$REPO/server/.clips-host}"
HOOK="$REPO/stream-kit/on-replay-saved.sh"

mkdir -p "$OUT_DIR"

# One instance only — the server signals by pattern match on this cmdline.
if pgrep -f "gpu-screen-recorder -w" >/dev/null 2>&1; then
  echo "replay buffer already running"
  exit 0
fi

echo "replay buffer: monitor=$MONITOR ${REPLAY_SECS}s @${FPS}fps → $OUT_DIR"
exec gpu-screen-recorder -w "$MONITOR" -f "$FPS" -k h264 \
  -r "$REPLAY_SECS" -restart-replay-on-save yes \
  -c mp4 -a default_output \
  -ro "$OUT_DIR" -sc "$HOOK"
