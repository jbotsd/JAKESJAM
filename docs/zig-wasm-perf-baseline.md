# Zig→WASM perf baseline

Generated 2026-05-05 from `tools/wasm-bench.ts` on the dev machine
(Bun 1.3.10, Linux x86_64). Numbers are illustrative — re-run on
the deploy hardware (Vercel + Fly) for production decisions.

## Trig (1M iterations each)

| Op | TS-libm | TS-LUT | wasm-LUT | Notes |
|---|---|---|---|---|
| `sin(x)` | 2.7 ns | 10.9 ns | 17.7 ns | TS-LUT 4× slower than libm but deterministic across hosts |
| `cos(x)` | 3.6 ns | 13.1 ns | 18.1 ns | Same shape as sin |
| `atan2(y, x)` | 35.0 ns | 23.9 ns | 17.7 ns | **LUT is FASTER than libm** here — 4-quadrant decomposition is cheaper than libm's atan2 |

**Takeaway**: TS-LUT trig is 4× slower than libm `Math.sin/cos`,
but every TS sim module has been swapped to LUT anyway because
the determinism win (cross-host bit-equality) dominates. For
`atan2` the LUT is actually faster.

The wasm boundary adds ~6 ns per call vs the in-process TS LUT.
For trig that's significant overhead; for bigger functions it's
amortised.

## RNG (1M iterations)

| Op | TS | wasm | Notes |
|---|---|---|---|
| `nextU32(state)` | 13.0 ns | 44.2 ns | Wasm 3× slower due to boundary crossing |

**Takeaway**: RNG is too small to make the wasm boundary
worthwhile in isolation. The current `setRngBackend` wasm swap
is mainly for production observability (proves wasm is genuinely
running) rather than determinism (TS impl is already
deterministic). TS-native is the better path for hot RNG loops.

## Collision (100k iterations)

| Op | TS-native | Notes |
|---|---|---|
| `resolveMoveCached(...)` | 191 ns | The collision hot path. ~5M ops/sec. |

`resolve_move_cached` wasm export not benched (requires the host
to pack the cache into wasm memory each call, which has its own
cost). The setBackend swap mechanism does that packing — measure
end-to-end via `stepPlayer` below.

## Player physics (50k iterations)

| Op | TS-native | wasm-swap | Notes |
|---|---|---|---|
| `stepPlayer(...)` | 347 ns | 369 ns | Wasm is ~6% slower (cache pack overhead per call) |

**Takeaway**: For composite functions the wasm boundary overhead
is amortised. Production `stepPlayer` runs through wasm by
default (F3 flip) — the 22 ns/call overhead vs TS-native is
worth the cross-host determinism guarantee.

For 4 players × 60 Hz = 240 stepPlayer calls/sec, the wasm tax
is 22 ns × 240 = 5.3 µs/sec — utterly negligible vs the 16.67 ms
frame budget.

## Architectural takeaways

1. **TS-LUT is the right impl for trig in TS sim modules.** The
   cross-host determinism win (LUT bytes are identical to wasm's
   LUT bytes) is worth the 4× cost vs libm. Going through wasm
   adds another ~6 ns boundary tax with no determinism benefit
   when the LUT is already shared.

2. **Wasm boundary works for composite functions but not
   primitives.** A 22 ns boundary cost on a 350 ns operation is
   6%; on a 13 ns operation it's 3.4×. Package multiple ops
   into single wasm calls (like `step_projectile_v2`'s
   all-pathings dispatch) to amortise.

3. **No perf concerns for the default-on production deploy.**
   Player physics + collision (the modules wired through wasm)
   complete in well under the frame budget. The trig LUT is the
   common path everywhere and is plenty fast.

## Re-running the bench

```sh
bun run tools/wasm-bench.ts
```

Run on the actual deploy hardware to validate numbers; dev-machine
numbers are 2-3× faster than typical Fly Performance VMs.
