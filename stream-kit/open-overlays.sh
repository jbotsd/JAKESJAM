#!/usr/bin/env bash
# Open stream overlays in the default browser so you can copy file:// URLs into OBS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/overlays"

echo "JAKESJAM stream overlays — paths for OBS Browser Source:"
echo
for f in starting-soon.html brb.html ending.html brand-corner.html lower-third.html; do
  path="$DIR/$f"
  url="file://$path"
  echo "  $f"
  echo "    $url"
  echo
done

echo "Thumbnail: $ROOT/assets/thumbnail-friday.jpg"
echo
echo "Opening starting-soon.html in browser…"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DIR/starting-soon.html" 2>/dev/null || true
elif command -v open >/dev/null 2>&1; then
  open "$DIR/starting-soon.html" 2>/dev/null || true
fi
