#!/usr/bin/env bash
# vo-record — record a VO take straight off the Volt. No browser involved.
#
# The prompter's in-page recorder depends on getUserMedia, a secure context, a
# per-site device choice and an AudioWorklet. That is four things that can
# silently fail and leave you staring at a dead meter. This is one thing: the
# interface -> a WAV. Levels off this path were measured at -9 to -20 dBFS peak,
# which is a healthy take.
#
#   tools/vo-record.sh              record until Ctrl+C
#   tools/vo-record.sh -t 120       record 120 seconds
#   tools/vo-record.sh --list       show input devices
#
# Writes 48kHz mono WAV to ~/Music/jakesjam-vo/ and prints the level so you
# know before you walk away whether the take is usable.
set -uo pipefail

FFMPEG=$([ -x /usr/bin/ffmpeg ] && echo /usr/bin/ffmpeg || echo ffmpeg)
OUT_DIR="${VO_DIR:-$HOME/Music/jakesjam-vo}"
# Channel 1 of the Volt's 4ch pro-audio input — where the mic actually is.
SRC="${VO_SRC:-alsa_input.usb-Universal_Audio_Volt_476_24482040026582-00.pro-input-0}"
DUR=""

while [ $# -gt 0 ]; do
  case "$1" in
    -t|--time) DUR="$2"; shift 2 ;;
    --list) pactl list short sources 2>/dev/null | grep -v ".monitor"; exit 0 ;;
    --src) SRC="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/vo-$(date +%Y%m%d-%H%M%S).wav"

echo "recording -> $OUT"
echo "source    -> ${SRC}"
[ -n "$DUR" ] && echo "duration  -> ${DUR}s" || echo "duration  -> until Ctrl+C"
echo

# -ac 1 takes the first channel: the mic input. pan= would need the 4ch layout,
# and ffmpeg's downmix already gives us channel 1 as mono here.
# shellcheck disable=SC2086
"$FFMPEG" -hide_banner -loglevel error -f pulse -i "$SRC" -ac 1 -ar 48000 \
  -c:a pcm_s16le ${DUR:+-t $DUR} -y "$OUT"

echo
if [ ! -s "$OUT" ]; then
  echo "NOTHING RECORDED — check the interface is connected (--list)." >&2
  exit 1
fi

secs=$("$FFMPEG" -hide_banner -i "$OUT" 2>&1 | grep -oE "Duration: [0-9:.]+" | head -1)
echo "$secs"
"$FFMPEG" -hide_banner -i "$OUT" -af volumedetect -f null - 2>&1 |
  grep -E "mean_volume|max_volume" | sed 's/.*\] /  /'

peak=$("$FFMPEG" -hide_banner -i "$OUT" -af volumedetect -f null - 2>&1 |
  grep -oE "max_volume: [-0-9.]+" | awk '{print $2}')
awk -v p="${peak:--99}" 'BEGIN{
  if (p < -40)      print "  VERDICT: too quiet — turn the Volt input gain up";
  else if (p > -1)  print "  VERDICT: CLIPPING — turn the gain down and redo it";
  else if (p < -20) print "  VERDICT: usable, but quieter than ideal";
  else              print "  VERDICT: good take level";
}'
echo
echo "  $OUT"
