#!/usr/bin/env bash
# gpu-screen-recorder -sc hook: $1 = path of the just-saved replay clip.
# Uploads it through the SAME /clips/upload pipeline browser clips use, so
# host kill clips get the share page, ops console, quota and the NVENC
# 720x1280 vertical (focus trace synthesized as static center — the host
# recording is the full monitor, there's no per-frame fight-pair focus).
set -euo pipefail

FILE="${1:?usage: on-replay-saved.sh <saved-clip>}"
SERVER="${JJ_SERVER:-http://localhost:8088}"

read -r W H < <(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height -of csv=p=0 "$FILE" | tr ',' ' ')

TRACE="[{\"t\":0,\"x\":$((W / 2))}]"

curl -s -X POST "$SERVER/clips/upload" \
  -F "file=@$FILE;type=video/mp4" \
  -F "focusTrace=$TRACE" \
  -F "srcW=$W" \
  -F "srcH=$H" \
  && echo "" && echo "uploaded host clip: $FILE"

# The buffer restarts itself (-restart-replay-on-save). Keep the local file
# as the archival master; the store owns quota for the uploaded copies.
