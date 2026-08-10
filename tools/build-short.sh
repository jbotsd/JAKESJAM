#!/usr/bin/env bash
# build-short.sh — turn a host-rendered landscape clip into a daily vertical
# short (docs/CLIPPING-PROFESSION.md §3 craft rules).
#
#   tools/build-short.sh --in server/.clips/<id>.mp4 --hook $'line one\nline two' \
#                        --out out/2026-08-10-triplekill.mp4
#
# WHY THIS EXISTS, AND WHY IT DOESN'T CROP
# The 9:16 centre-crop was deliberately removed from the server on
# 2026-07-15 (clipStore.ts:331 — "was cutting real action out of frame"), so
# clips are landscape-native 1920x1080 now. This composes rather than crops:
# the full frame sits in a band, a blurred/darkened copy of the same frame
# fills the 9:16 plate behind it, and the freed space above/below carries the
# hook and the mark instead of covering gameplay with them.
#
# --zoom lets you punch in when the action is centred (the host render already
# follows the star via `follow=`, so the star IS near centre). zoom 1.0 = no
# pixel discarded; 1.4 = a reasonable punch that still keeps most of the width.
#
# Craft rules encoded here (CLIPPING-PROFESSION.md §3):
#   - hook burned into frame one (feeds preview muted, ~85% of viewing)
#   - safe zones respected: top ~10% / bottom ~15% belong to platform UI
#   - real game audio kept (never synthesized); music optional and ducked
#   - --from/--to for a mid-action cold open and a loop seam
set -euo pipefail
cd "$(dirname "$0")/.."

FFMPEG=$([ -x /usr/bin/ffmpeg ] && echo /usr/bin/ffmpeg || echo ffmpeg)
FFPROBE=$([ -x /usr/bin/ffprobe ] && echo /usr/bin/ffprobe || echo ffprobe)
ASSETS="tools/short-assets"
FONT_HOOK="$ASSETS/space-grotesk-700.ttf"
FONT_MARK="$ASSETS/space-mono-700.ttf"

W=1080; H=1920; FPS=30
# IDENT-GRAMMAR palette: bone-ivory + dim gold on obsidian, teal = the single
# energy accent. Never introduce a colour that isn't one of these.
OBSIDIAN="0x0a0c10"; BONE="0xf2ece0"; GOLD="0xb08d3f"; TEAL="0x4fd8d8"

# zoom 2.0 default: the source is now follow-cam renders (tools/render-replay.mjs
# with follow=first), where the subject is already centred, so a tighter punch
# is safe and the fighters actually read on a phone. The old 1.55 was tuned for
# wide static spectator framing. it's the point where
# characters actually read at phone size, the arena keeps its context, and the
# band clears both safe zones. zoom 1.0 keeps every pixel but the fighters are
# too small to follow on a phone.
IN=""; OUT=""; HOOK=""; ZOOM="2.0"; FROM=""; TO=""; MUSIC=""; MUSIC_START="0"; VO=""; CAPS=""
MARK="play.elyad.io"; HOOK_DUR="2.6"

while [ $# -gt 0 ]; do
  case "$1" in
    --in) IN="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --hook) HOOK="$2"; shift 2 ;;
    --zoom) ZOOM="$2"; shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    --vo) VO="$2"; shift 2 ;;
    --captions) CAPS="$2"; shift 2 ;;
    --music) MUSIC="$2"; shift 2 ;;
    --music-start) MUSIC_START="$2"; shift 2 ;;
    --mark) MARK="$2"; shift 2 ;;
    --hook-dur) HOOK_DUR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "$IN" ] && [ -f "$IN" ] || { echo "--in <clip.mp4> required (and must exist)" >&2; exit 2; }
[ -n "$OUT" ] || { echo "--out <file.mp4> required" >&2; exit 2; }
[ -f "$FONT_HOOK" ] || { echo "missing $FONT_HOOK — see tools/short-assets/README" >&2; exit 2; }
mkdir -p "$(dirname "$OUT")"

# Trim window. A mid-action cold open is the single highest-leverage edit:
# 50-60% of drop-off happens in the first 3 seconds.
TRIM=()
[ -n "$FROM" ] && TRIM+=(-ss "$FROM")
[ -n "$TO" ] && TRIM+=(-to "$TO")

# With narration, the VOICE sets the length and the gameplay loops to fill it.
# Cutting the voice off to fit a 10s clip is the wrong way round — the clip is
# wallpaper, the line is the content.
LOOP=(); VO_DUR=""
if [ -n "$VO" ]; then
  [ -f "$VO" ] || { echo "--vo file not found: $VO" >&2; exit 2; }
  VO_DUR=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$VO")
  # +0.45s of tail so the last word is not clipped by the cut.
  VO_DUR=$(awk -v d="$VO_DUR" 'BEGIN{printf "%.3f", d + 0.45}')
  LOOP=(-stream_loop -1)
  TRIM=()
  [ -n "$FROM" ] && TRIM+=(-ss "$FROM")
fi

# Does the source actually carry audio? Host-rendered clips do (clip-goal B3
# fixed); a raw autoplay webm may not, and -map of a missing stream is fatal.
#
# "Has a stream" is NOT enough. Some clips in the 07-27 batch carry a
# perfectly valid opus track that is digital silence (-91 dB), and mixing a
# narration against one produced a SILENT short. probe-clip.ts already treats
# audio as "present AND non-silent" for exactly this reason; so does this.
HAS_AUDIO=$("$FFPROBE" -v error -select_streams a -show_entries stream=index \
  -of csv=p=0 "$IN" | head -1)
if [ -n "$HAS_AUDIO" ]; then
  MEANDB=$("$FFMPEG" -hide_banner -i "$IN" -af volumedetect -f null - 2>&1 |
    grep -oE "mean_volume: [-0-9.]+" | awk '{print $2}' || true)
  if [ -n "$MEANDB" ] && awk -v v="$MEANDB" 'BEGIN{exit !(v < -60)}'; then
    echo "[short] NOTE: source audio track is silent (${MEANDB} dB) — treating as no audio"
    HAS_AUDIO=""
  fi
fi

# ── the 9:16 plate ──────────────────────────────────────────────────────
#  bg : same frame, scaled to COVER, blurred and dimmed toward obsidian
#  fg : the frame scaled so ${W}*zoom is its width, then cropped to ${W}
#
# The scale is relative to the OUTPUT width, not the source width. Getting
# that wrong silently discards more than half the frame even at zoom 1.0 —
# which is precisely the 9:16 crop that was ripped out of the server on
# 2026-07-15 for "cutting real action out of frame". At zoom 1.0 the whole
# 1920x1080 frame survives; zoom only ever trims horizontally, never
# vertically, and the trim is opt-in.
BAND_H=$(awk -v z="$ZOOM" -v w="$W" 'BEGIN{ printf "%d", int(w*z*1080/1920/2)*2 }')
BAND_TOP=$(awk -v h="$H" -v b="$BAND_H" 'BEGIN{ printf "%d", int((h-b)/2) }')
BAND_BOT=$((BAND_TOP + BAND_H))

# Hook sits in the freed space ABOVE the band when there's room for it, else
# just inside the band's top edge. Same idea for the mark below.
HOOK_Y=$(awk -v t="$BAND_TOP" 'BEGIN{ y = t - 210; if (y < 230) y = t + 40; printf "%d", y }')
if [ -n "$CAPS" ]; then
  # Captions own the band-to-CTA gap; the mark sits below them.
  MARK_Y=$(awk -v h="$H" 'BEGIN{ printf "%d", h-90 }')
else
  MARK_Y=$(awk -v b="$BAND_BOT" -v h="$H" 'BEGIN{ y = b + 96; if (y > h-300) y = h-360; printf "%d", y }')
fi
NAME_Y=$((MARK_Y - 74))
# Sits in the top dead space, clear of the 10% platform-UI safe zone.
WORDMARK_Y=$(awk -v t="$BAND_TOP" 'BEGIN{ y = t - 62; if (y < 210) y = 210; printf "%d", y }')
echo "[short] plate: band ${W}x${BAND_H} at y=${BAND_TOP}..${BAND_BOT} | hook y=${HOOK_Y} | mark y=${MARK_Y}"

ESC_MARK=$(printf '%s' "$MARK" | sed "s/'/\\\\'/g; s/:/\\\\:/g")
FILTER="
color=c=${OBSIDIAN}:s=${W}x${H}:r=${FPS}[bg];
[0:v]scale=${W}*${ZOOM}:-2:flags=lanczos,crop='min(iw,${W})':ih,unsharp=5:5:0.35:5:5:0[fg];
[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1[plate];
[plate]
  drawbox=x=0:y=${BAND_TOP}-3:w=iw:h=3:color=${GOLD}@0.75:t=fill,
  drawbox=x=0:y=${BAND_BOT}:w=iw:h=3:color=${GOLD}@0.75:t=fill,
  drawtext=fontfile=${FONT_MARK}:text='${ESC_MARK}':fontsize=52:
    fontcolor=${TEAL}:x=(w-text_w)/2:y=${MARK_Y}:borderw=4:bordercolor=black@0.85,
  drawtext=fontfile=${FONT_HOOK}:text='JAKESJAM':fontsize=40:
    fontcolor=${GOLD}:x=(w-text_w)/2:y=${WORDMARK_Y}:
    alpha='0.9*clip((t-${HOOK_DUR}+0.3)/0.6,0,1)':
    borderw=3:bordercolor=black@0.7
"
# NOTE: the host render already bakes a small "JAKESJAM . play.elyad.io"
# stamp into the gameplay frame (clip-goal B11). A second wordmark here read
# as duplicate branding, so this overlay carries ONE legible CTA line only.

# The hook: frame one, high contrast, fades out so it never fights the payoff.
#
# Written via textfile= rather than text=. drawtext's own escaping cannot be
# made reliable through two layers of quoting — an apostrophe in a hook
# ("you're in the arena") silently killed the whole render. A file plus
# expansion=none means the hook is taken as literal bytes: apostrophes,
# colons, percent signs and commas all just work.
if [ -n "$HOOK" ]; then
  # At fontsize 64 in Space Grotesk Bold, ~24 characters is the widest line
  # that still fits 1080px. Longer runs off both edges and the post is
  # wasted, so say so loudly rather than shipping a clipped hook.
  while IFS= read -r line; do
    n=${#line}
    if [ "$n" -gt 24 ]; then
      echo "[short] WARNING: hook line is ${n} chars (>24) and will overflow 1080px:" >&2
      echo "[short]          \"${line}\"" >&2
      echo "[short]          break it with \\n, or shorten it." >&2
    fi
  done <<< "$HOOK"
  HOOK_FILE=$(mktemp "${TMPDIR:-/tmp}/jj-hook.XXXXXX")
  trap 'rm -f "$HOOK_FILE"' EXIT
  printf '%s' "$HOOK" > "$HOOK_FILE"
  FILTER="${FILTER},
  drawtext=fontfile=${FONT_HOOK}:textfile=${HOOK_FILE}:expansion=none:fontsize=64:
    fontcolor=${BONE}:borderw=6:bordercolor=black:line_spacing=16:
    x=(w-text_w)/2:y=${HOOK_Y}:
    alpha='if(lt(t,0.2),t/0.2,if(gt(t,${HOOK_DUR}-0.4),max(0,(${HOOK_DUR}-t)/0.4),1))'"
fi
if [ -n "$CAPS" ]; then
  [ -f "$CAPS" ] || { echo "--captions file not found: $CAPS" >&2; exit 2; }
  # subtitles= takes a filter-graph argument, so the path needs its colons and
  # commas escaped or the graph parser eats them.
  ESC_CAPS=$(printf '%s' "$CAPS" | sed "s/\\\\/\\\\\\\\/g; s/:/\\\\:/g; s/'/\\\\'/g; s/,/\\\\,/g")
  FILTER="${FILTER},subtitles='${ESC_CAPS}'"
fi
FILTER="${FILTER},fps=${FPS},format=yuv420p[v]"

# ── audio ───────────────────────────────────────────────────────────────
# Narrated shorts are VOICE ONLY (Jake, 2026-08-09: "remove them all, all I
# can hear is the in-game audio effects"). No game bed, no ducking.
#
# The previous "duck the game under the voice" graph shipped six shorts with
# NO VOICE IN THEM AT ALL, and the failure was silent: the [vo] label was
# used twice (sidechain key + amix input), and instead of erroring, ffmpeg
# rebound the second reference to input stream 0:1 — the game clip's own
# audio ("Binding input with label 'vo' to input stream 0:1"). The mix became
# game + game, with the voice audible only to the compressor. If a bed is
# ever wanted again, asplit every label that feeds two filters.
AUDIO_IN=(); AMAP=(); ACODEC=()
if [ -n "$VO" ]; then
  AUDIO_IN=(-i "$VO")
  FILTER="${FILTER};[1:a]aformat=channel_layouts=stereo,
          afade=t=out:st=$(awk -v d="$VO_DUR" 'BEGIN{printf "%.2f", d-0.35}'):d=0.35[a]"
  AMAP=(-map "[a]"); ACODEC=(-c:a aac -b:a 192k)
elif [ -n "$MUSIC" ] && [ -n "$HAS_AUDIO" ]; then
  AUDIO_IN=(-ss "$MUSIC_START" -i "$MUSIC")
  # asplit because [game] feeds BOTH the sidechain and the mix — reusing one
  # label silently rebinds to an input stream (the bug above).
  FILTER="${FILTER};[1:a]volume=0.28,afade=t=in:st=0:d=0.3[mus];
          [0:a]volume=1.0,asplit=2[gkey][gmix];
          [mus][gkey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=350[duck];
          [duck][gmix]amix=inputs=2:duration=first:dropout_transition=0[a]"
  AMAP=(-map "[a]"); ACODEC=(-c:a aac -b:a 192k)
elif [ -n "$MUSIC" ]; then
  AUDIO_IN=(-ss "$MUSIC_START" -i "$MUSIC")
  FILTER="${FILTER};[1:a]volume=0.9,afade=t=in:st=0:d=0.3[a]"
  AMAP=(-map "[a]"); ACODEC=(-c:a aac -b:a 192k)
elif [ -n "$HAS_AUDIO" ]; then
  AMAP=(-map 0:a); ACODEC=(-c:a aac -b:a 192k)
fi

echo "[short] $IN -> $OUT (zoom=${ZOOM} audio=$([ -n "$HAS_AUDIO" ] && echo game || echo none)${MUSIC:+ +music}${VO:+ +VO ${VO_DUR}s looped})"
"$FFMPEG" -y "${LOOP[@]}" "${TRIM[@]}" -i "$IN" "${AUDIO_IN[@]}" \
  -filter_complex "$FILTER" \
  -map "[v]" "${AMAP[@]}" \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  -movflags +faststart ${VO_DUR:+-t $VO_DUR} $([ -z "$VO_DUR" ] && echo -shortest) "${ACODEC[@]}" \
  "$OUT" -loglevel error

"$FFPROBE" -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,nb_frames \
  -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"
echo "[short] done -> $OUT"
