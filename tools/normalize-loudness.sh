#!/usr/bin/env bash
# normalize-loudness — two-pass EBU R128 across a set of shorts.
#
#   tools/normalize-loudness.sh out/narrated/*.mp4
#
# Why two passes: single-pass `loudnorm` runs in a dynamic streaming mode and
# routinely undershoots. Measured on the first narrated set it left a 16 dB
# spread (-14.9 to -31.3 LUFS) across six files that were all asking for -14.
# Pass 1 measures, pass 2 applies the measurement. Only then does the filter
# actually hit the target.
#
# -14 LUFS / -1.5 dBTP is the usual social target. A feed where one clip is
# 14 dB quieter than the next gets scrolled past, whatever is in frame.
#
# alimiter needs level=disabled. Its `level` option defaults to TRUE, which
# auto-levels the limited output back up to full scale — so the limiter does
# its job and then immediately undoes it. Left at the default, every file in
# the first narrated set came out pinned at 0.0 dBFS, i.e. clipping, despite
# asking for a -1.5 dBTP ceiling.
#
# Video is stream-copied — this only ever touches audio.
set -euo pipefail
cd "$(dirname "$0")/.."

FFMPEG=$([ -x /usr/bin/ffmpeg ] && echo /usr/bin/ffmpeg || echo ffmpeg)
I=-14; TP=-1.5; LRA=11

[ $# -gt 0 ] || { echo "usage: tools/normalize-loudness.sh <file.mp4> [...]" >&2; exit 2; }

for f in "$@"; do
  [ -f "$f" ] || { echo "skip (missing): $f" >&2; continue; }

  # Measure integrated loudness, then apply exactly the gain that closes the
  # gap and catch the peaks with a limiter.
  #
  # loudnorm itself was tried twice and abandoned: single-pass undershot by up
  # to 16 dB, and two-pass with linear=true refuses any gain that would breach
  # the true-peak ceiling, so quiet-but-peaky material just stays quiet. A
  # measured gain is predictable and lands within ~1 dB.
  cur=$("$FFMPEG" -hide_banner -i "$f" -af ebur128=framelog=quiet -f null - 2>&1 |
    grep -A4 "Integrated loudness" | grep -oE "\-?[0-9.]+ LUFS" | head -1 | awk '{print $1}')

  if [ -z "$cur" ]; then
    echo "  $(basename "$f"): no measurable audio — left alone"
    continue
  fi

  gain=$(awk -v c="$cur" -v t="$I" 'BEGIN{printf "%.2f", t - c}')
  tmp="${f%.mp4}.norm.mp4"
  "$FFMPEG" -hide_banner -loglevel error -i "$f" \
    -af "volume=${gain}dB,alimiter=level_in=1:level_out=1:limit=$(awk -v tp="$TP" 'BEGIN{printf "%.4f", 10^(tp/20)}'):attack=1:release=50:level=disabled" \
    -c:v copy -c:a aac -b:a 192k -movflags +faststart -y "$tmp"
  mv "$tmp" "$f"

  out=$("$FFMPEG" -hide_banner -i "$f" -af ebur128=framelog=quiet -f null - 2>&1 |
    grep -A4 "Integrated loudness" | grep -oE "\-?[0-9.]+ LUFS" | head -1)
  printf "  %-28s %8s LUFS  %+7s dB  ->  %s\n" "$(basename "$f")" "$cur" "$gain" "$out"
done
