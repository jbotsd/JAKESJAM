#!/usr/bin/env bash
# ⚠️  RETIRED 2026-07-12 — DO NOT RUN ON A SHARED-USE DESKTOP. ⚠️
#
# This script full-monitor-captures (KMS `-w screen`) EVERYTHING on the
# real display — browser tabs, messages, whatever's on screen — into a RAM
# ring buffer, and uploads the last N seconds to the PUBLIC clip store on
# every kill anywhere in the persistent world (bots included). On 2026-07-12
# this leaked 26 clips of Jake's actual desktop (open tabs, an Instagram DM
# thread) to jakesjam.elyad.io before anyone noticed. All leaked clips + the
# 390-file/3.5GB raw archive were purged same day; the trigger's env gate
# below now requires a second explicit ack so this can't happen by accident
# again. On Wayland there is no window-scoped alternative to `-w screen`
# (X11-only, per gsr's own docs) — so this approach is safe ONLY on a
# dedicated kiosk/stream box that is NEVER used for anything else. This
# machine is Jake's daily-driver desktop. It is not that box.
#
# The permanent replacement is already live: server/src/clipRenderQueue.ts
# renders host-quality highlight clips in an ISOLATED headless Chromium
# context (offscreen, replay-driven, never touches the real screen) — same
# "the host renders your clip" outcome, zero screen-capture risk, works on
# any box. Use that. Do not re-enable this script unless you are on a
# machine that is provably never used for anything but the stream.
#
# Original design notes (kept for the eventual real kiosk box):
# Encodes the screen continuously on the GPU's dedicated NVENC block into a
# RAM ring buffer. The game server (JJ_HOST_REPLAY=1 AND
# JJ_HOST_REPLAY_DEDICATED_KIOSK_BOX=1) sends SIGUSR1 ~3s after a kill →
# the buffer's last REPLAY_SECS seconds mux to disk → on-replay-saved.sh
# uploads through /clips. CAPTURE SCOPE: KMS plane capture records the
# VISIBLE screen, unconditionally — there is no way to scope it to one
# window/tab on Wayland. First run may ask to install a setcap on
# gsr-kms-server. Must run from a terminal INSIDE the Hyprland session
# (detached/headless EGL init falls back to llvmpipe and aborts).
set -euo pipefail

echo "REFUSING TO RUN: this script full-monitor-captures the real desktop" >&2
echo "and leaked Jake's browser tabs to a public clip store on 2026-07-12." >&2
echo "See the file header. Use clipRenderQueue.ts instead. Exiting." >&2
exit 1

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
# gsr 5.14: -o is the save DIRECTORY in replay mode (-ro is a different
# feature: where regular recordings land while a replay buffer runs).
# DISPLAY unset: with it set, gsr's EGL init goes through Xwayland where
# DRI3 fails on this nvidia box → llvmpipe → abort. Pure-Wayland EGL works.
unset DISPLAY
exec gpu-screen-recorder -w "$MONITOR" -f "$FPS" -k h264 \
  -r "$REPLAY_SECS" -restart-replay-on-save yes \
  -c mp4 -a default_output \
  -o "$OUT_DIR" -sc "$HOOK"
