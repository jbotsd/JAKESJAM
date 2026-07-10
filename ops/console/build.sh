#!/usr/bin/env bash
# Build optimized Elm operator console for /ops
set -euo pipefail
cd "$(dirname "$0")"
elm make src/Main.elm --optimize --output=elm.js
echo "OK → elm.js ($(wc -c < elm.js) bytes)"
