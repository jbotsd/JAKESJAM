#!/usr/bin/env bash
# Build a self-contained HTML5 zip for portal submission (CrazyGames, Poki,
# etc.). Same source, same build the live site runs — two portal-specific
# differences: relative asset paths (vite.config.ts's base: "./", so it
# works nested under a portal subpath, not just true domain root) and the
# real production game-server WS URL baked in explicitly.
#
# Prod is SELF-HOSTED (see docs/hosting-elyad-io.md): Bun serves both the
# API and the client statics itself from this machine on :8088, fronted by
# a Cloudflare tunnel at play.elyad.io — NOT Fly.io (fly.toml/the GH
# Actions Fly deploy are stale leftovers from an earlier architecture).
# worldClient.ts's sameOriginWsBase() lets the live site self-derive
# wss://play.elyad.io with zero config since client+server share an
# origin there — but a portal zip is served from CrazyGames' own domain,
# so that same-origin trick doesn't apply and the URL must be explicit.
#
# The match/gameplay backend is always the live server — multiplayer logic
# never goes stale. Only client-only visual/UI changes require re-running
# this script and re-uploading the zip.
#
# Usage: scripts/build-portal-zip.sh

set -euo pipefail

cd "$(dirname "$0")/.."

GAME_SERVER_URL="wss://play.elyad.io/ws"
OUT_DIR="dist-portal"
ZIP_NAME="jakesjam-portal-build.zip"

echo "[build-portal-zip] Building sim.wasm ..."
(cd sim && zig build)

echo "[build-portal-zip] Building client (VITE_GAME_SERVER_URL=${GAME_SERVER_URL}) ..."
VITE_GAME_SERVER_URL="${GAME_SERVER_URL}" bun run --filter client build

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
cp -r client/dist/. "${OUT_DIR}/"

rm -f "${ZIP_NAME}"
(cd "${OUT_DIR}" && zip -r "../${ZIP_NAME}" . -x ".*")

echo "[build-portal-zip] Done: ${ZIP_NAME} ($(du -h "${ZIP_NAME}" | cut -f1))"
echo "[build-portal-zip] Upload this zip's contents to the portal's 'Upload files' dropzone."
