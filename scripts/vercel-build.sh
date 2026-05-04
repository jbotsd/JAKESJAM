#!/usr/bin/env bash
# Vercel build script — installs Zig 0.15.2 (matching .zig-version),
# builds the wasm sim, then runs the Vite production build.
#
# Vercel's default build env is a Linux container without Zig.
# Without this script, the Vite plugin's `zig build` spawn fails
# silently and the deployment ships without `dist/wasm/sim.wasm`,
# which means clients 404 on `/wasm/sim.wasm`, the wasm sim never
# loads, and default users get the TS sim with the determinism bug.

set -euo pipefail

ZIG_VERSION="$(cat .zig-version)"
# Tarball naming: cpu-os-version (NOT os-cpu — easy to get backwards).
# Confirmed against https://ziglang.org/download/<ver>/ as of Zig 0.15.2.
ZIG_DIR="zig-x86_64-linux-${ZIG_VERSION}"
ZIG_TARBALL="${ZIG_DIR}.tar.xz"
ZIG_URL="https://ziglang.org/download/${ZIG_VERSION}/${ZIG_TARBALL}"

echo "[vercel-build] Installing Zig ${ZIG_VERSION} ..."
if ! command -v zig >/dev/null 2>&1; then
  curl -sSL "${ZIG_URL}" -o /tmp/zig.tar.xz
  mkdir -p /tmp/zig
  tar -xJf /tmp/zig.tar.xz -C /tmp/zig
  export PATH="/tmp/zig/${ZIG_DIR}:${PATH}"
fi

echo "[vercel-build] zig version: $(zig version)"

echo "[vercel-build] Building sim.wasm ..."
(cd sim && zig build)

if [ ! -f client/public/wasm/sim.wasm ]; then
  echo "[vercel-build] ERROR: sim.wasm did not land at client/public/wasm/sim.wasm"
  exit 1
fi
echo "[vercel-build] sim.wasm size: $(stat -c%s client/public/wasm/sim.wasm) bytes"

echo "[vercel-build] Running Vite client build ..."
bun run --filter client build

echo "[vercel-build] Verifying dist/wasm/sim.wasm ..."
if [ ! -f client/dist/wasm/sim.wasm ]; then
  echo "[vercel-build] ERROR: dist/wasm/sim.wasm missing — Vite did not copy public/wasm/"
  exit 1
fi
echo "[vercel-build] dist wasm size: $(stat -c%s client/dist/wasm/sim.wasm) bytes"

echo "[vercel-build] Done."
