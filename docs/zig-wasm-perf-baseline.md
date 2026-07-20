# Zig→WASM perf baseline

> **STALE — the 2026-05-05 numbers below pre-date the export-surface
> roughly doubling (144 wasm exports as of the pre-Phase-0
> `zig-wasm-exports.md` audit, growing further through
> `docs/zig-step-world-parity-goal.md` Phases 0-4, active as of
> 2026-07-20) and pre-date `step_world` itself gaining substantial new
> logic (melee, AOE-queue abilities, Paper Double, ability-cast
> dispatch, draft/offer-roll). This doc's own "Architectural takeaways"
> conclusion (no perf concerns, wasm boundary tax is negligible) is NOT
> being reversed here — nothing in this staleness note claims the
> conclusion is wrong, only that the specific ns/op numbers below are
> old and the wasm binary they were measured against was much smaller.
> A fresh spot-check run on 2026-07-20 (below, same dev machine, NOT a
> full re-benchmark of the newly-added `step_world` surface) is
> included as a bonus data point, not a replacement baseline — if you
> need current numbers for a real decision, re-run
> `bun run tools/wasm-bench.ts` yourself first.

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

## 2026-07-20 spot-check (bonus, not a re-baseline)

Same dev machine, same `tools/wasm-bench.ts`, run as a cheap staleness
check while adding this banner — not a rigorous re-benchmark of
everything `step_world` has grown since May (that would need its own
pass, ideally with new kernels for the abilities/melee/draft logic this
doc never covered). Numbers moved enough that they're worth recording
plainly rather than silently leaving the reader with only the old ones:

| Op | Backend | 2026-05-05 | 2026-07-20 |
|---|---|---|---|
| `sin(x)` | TS-LUT | 10.9 ns | 15.3 ns |
| `sin(x)` | wasm-LUT | 17.7 ns | 22.7 ns |
| `atan2(y, x)` | TS-LUT | 23.9 ns | 26.5 ns |
| `atan2(y, x)` | wasm-LUT | 17.7 ns | 19.7 ns |
| `nextU32` | TS | 13.0 ns | 13.1 ns |
| `nextU32` | wasm | 44.2 ns | 46.2 ns |
| `resolveMoveCached` | TS-native | 191 ns | 197.7 ns |
| `stepPlayer` | TS-native | 347 ns | 1284.4 ns |
| `stepPlayer` | wasm-swap | 369 ns | 661.7 ns |

Most kernels are flat-to-slightly-slower, consistent with normal
machine noise/thermal variance and this repo's own general growth. The
one number that moved a lot is `stepPlayer` TS-native (347 ns → 1284
ns) — wasm-swap is now the FASTER path on this run (661.7 ns), the
opposite of the original "wasm 6% slower" takeaway above. This was a
single spot-check run, not averaged across multiple runs or isolated
from background load on this (actively-used) dev machine, so treat the
reversal as "worth re-checking properly," not as a settled new
conclusion — the honest move here is to record what was actually
measured, not to quietly discard an inconvenient number or promote it
to a confident claim either way.
