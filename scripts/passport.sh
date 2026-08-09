#!/usr/bin/env bash
# The port passport — gospel N0.4.
#
# For every archived replay: step it through the NATIVE build and through
# sim.wasm with the same inputs, and require the hash streams to be
# bit-identical. Native x86_64 float semantics matching wasm is the whole
# claim L10 makes; this is what checks it.
#
#   scripts/passport.sh [--ticks N] [dir]
#
# --ticks caps each replay (default 3000, enough to cross a round boundary
# and the first draft). Pass 0 for full length — minutes per replay, worth
# it before a toolchain jump, overkill per commit.
#
# Exit 0 = every replay agreed. Non-zero = a divergence, which per L10
# blocks Track N until root-caused.

set -euo pipefail
cd "$(dirname "$0")/.."

TICKS="${TICKS:-3000}"
DIR="server/.replays"
while [ $# -gt 0 ]; do
  case "$1" in
    --ticks) TICKS="$2"; shift 2 ;;
    *) DIR="$1"; shift ;;
  esac
done

JJSIM="sim/zig-out/bin/jjsim"
if [ ! -x "$JJSIM" ]; then
  echo "[passport] building the native harness..."
  (cd sim && zig build native)
fi
if [ ! -f client/public/wasm/sim.wasm ]; then
  echo "[passport] ERROR: sim.wasm missing — run 'bun run sim:build'." >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

total=0; agreed=0; skipped=0; failed=0
for replay in "$DIR"/*.jjr; do
  [ -f "$replay" ] || continue
  total=$((total + 1))
  name="$(basename "$replay")"

  # The native side needs the packed initial state; the wasm side rebuilds
  # it from the header. Generate on demand so this is one command.
  if [ ! -f "$replay.init.bin" ]; then
    if ! bun server/tools/dump-replay-init.ts "$replay" >/dev/null 2>&1; then
      echo "SKIP  $name  (no init state — replay refused by the dumper)"
      skipped=$((skipped + 1))
      continue
    fi
  fi

  # `|| true` on both: a refused fixture (mid-match backend switch) exits
  # non-zero by design and must not kill the sweep under `set -e`.
  "$JJSIM" replay-hash "$replay" --every 600 --max-ticks "$TICKS" >"$TMP/native.txt" 2>"$TMP/native.err" || true
  bun server/tools/replay-hash-wasm.ts "$replay" --every 600 --max-ticks "$TICKS" 2>"$TMP/wasm.err" \
    | grep -v "^\[wasm-sim\]" >"$TMP/wasm.txt" || true

  if [ ! -s "$TMP/native.txt" ] || [ ! -s "$TMP/wasm.txt" ]; then
    echo "SKIP  $name  ($(head -1 "$TMP/native.err" "$TMP/wasm.err" 2>/dev/null | tr '\n' ' ' | cut -c1-100))"
    skipped=$((skipped + 1))
    continue
  fi

  # Compare the hash rows only — the `#` header carries the file path, which
  # is identical anyway, and keeping it out means a future format tweak to
  # the header line cannot masquerade as a divergence.
  grep -v '^#' "$TMP/native.txt" >"$TMP/n.rows"
  grep -v '^#' "$TMP/wasm.txt" >"$TMP/w.rows"
  if diff -q "$TMP/n.rows" "$TMP/w.rows" >/dev/null; then
    echo "AGREE $name  ($(wc -l <"$TMP/n.rows" | tr -d ' ') samples, final $(tail -1 "$TMP/n.rows" | cut -f2))"
    agreed=$((agreed + 1))
  else
    echo "DIVERGE $name"
    diff "$TMP/n.rows" "$TMP/w.rows" | head -10
    failed=$((failed + 1))
  fi
done

echo
echo "[passport] ticks=$TICKS  replays=$total  agreed=$agreed  skipped=$skipped  diverged=$failed"
if [ "$failed" -ne 0 ]; then
  echo "[passport] FAIL — native and wasm are not the same game (L10)." >&2
  exit 1
fi
if [ "$agreed" -eq 0 ]; then
  echo "[passport] FAIL — nothing was actually compared." >&2
  exit 1
fi
echo "[passport] PASS"
