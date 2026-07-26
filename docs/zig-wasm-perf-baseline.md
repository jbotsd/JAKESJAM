# Zig→WASM perf baseline

> **CURRENT baseline: 2026-07-26 (Track Z3), see the section of that name
> below.** The 2026-05-05 numbers and the 2026-07-20 spot-check further
> down are KEPT as historical record (the ledger style this repo uses
> elsewhere — extend, don't erase) but are superseded: both pre-date the
> export-surface roughly doubling (144 wasm exports as of the pre-Phase-0
> `zig-wasm-exports.md` audit, growing further through
> `docs/zig-step-world-parity-goal.md` Phases 0-4 and Track Z1/Z2, 157
> exports as of this run) and pre-date `step_world` gaining substantial
> new logic (melee, AOE-queue abilities, Paper Double, ability-cast
> dispatch, draft/offer-roll, first-blood, team peel, ninja i-frames,
> Kindled Ward). The 2026-07-20 spot-check flagged its own `stepPlayer`
> reversal (wasm-swap faster than TS-native, 661.7ns vs 1284.4ns) as "not
> a settled conclusion — a single run, not averaged, not isolated from
> background load." Track Z3 (2026-07-26) re-ran the SAME bench 6 times
> back-to-back on the same dev machine specifically to settle that: see
> below for the averaged numbers and the answer (confirmed, not a fluke —
> wasm was faster in all 6 of 6 runs). This doc's own original
> "Architectural takeaways" conclusion (no perf concerns, wasm boundary
> tax is negligible for production) still holds; only the specific
> ns/op numbers and the stepPlayer relative-speed claim change.

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
   all-pathings dispatch) to amortise. *(2026-07-26 update: the
   specific "22 ns / 6% slower" `stepPlayer` numbers this point
   was built on are the stale 2026-05-05 ones — see the
   "2026-07-26 baseline" section below. The composite-vs-primitive
   shape of the argument still holds; the sign on `stepPlayer`
   flipped.)*

3. **No perf concerns for the default-on production deploy.**
   Player physics + collision (the modules wired through wasm)
   complete in well under the frame budget. The trig LUT is the
   common path everywhere and is plenty fast.

4. **`stepPlayer` wasm-swap is now the faster path, confirmed
   (Track Z3, 2026-07-26).** The 2026-05-05 baseline measured wasm
   ~6% slower than TS-native; a single 2026-07-20 spot-check found
   the opposite and explicitly declined to call it settled. A
   6-run averaged re-bench (below) confirms the reversal is real —
   wasm-swap won in 6 of 6 runs, ~2× faster on average. This
   strengthens takeaway 3, it doesn't change it: production
   `stepPlayer` was already fine on cost grounds even under the old
   "6% slower" number, and is fine (better, even) under the current
   one.

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

## 2026-07-26 baseline (Track Z3 — CURRENT, 6-run average)

Same dev machine, same `tools/wasm-bench.ts`, freshly built `sim.wasm`
(142,354 bytes; `sim && mise exec zig@0.15.2 -- zig build` run
immediately before benching — no Zig source changed this pass, this is
just confirming the binary on disk matches HEAD). Bun 1.3.14. Unlike
every prior entry in this doc, this pass ran the bench **6 times
back-to-back** and reports the average of all 6, specifically to answer
the 2026-07-20 spot-check's own open question honestly rather than
leave it a single-sample footnote forever. Per-run values are given too
(min–max) so the reader can see the actual spread, not just a smoothed
average:

| Op | Backend | Avg (n=6) | Min–Max |
|---|---|---|---|
| `sin(x)` | libm | 3.2 ns | 3.1–3.3 ns |
| `sin(x)` | TS-LUT | 15.5 ns | 13.6–17.4 ns |
| `sin(x)` | wasm-LUT | 23.2 ns | 16.4–26.9 ns |
| `cos(x)` | libm | 5.1 ns | 4.4–5.6 ns |
| `cos(x)` | TS-LUT | 20.9 ns | 14.6–23.4 ns |
| `cos(x)` | wasm-LUT | 26.4 ns | 18.6–32.6 ns |
| `atan2(y, x)` | libm | 36.1 ns | 27.0–44.7 ns |
| `atan2(y, x)` | TS-LUT | 28.1 ns | 23.1–33.2 ns |
| `atan2(y, x)` | wasm-LUT | 22.1 ns | 16.1–27.9 ns |
| `nextU32` | TS | 15.1 ns | 13.2–16.9 ns |
| `nextU32` | wasm | 60.3 ns | 40.0–76.4 ns |
| `resolveMoveCached` | TS-native | 264.3 ns | 203.3–350.1 ns |
| `stepPlayer` | TS-native | **1126.9 ns** | 840.3–1432.1 ns |
| `stepPlayer` | wasm-swap | **556.5 ns** | 433.2–683.5 ns |

**The stepPlayer question, SETTLED:** wasm-swap beat TS-native in all
6 of 6 runs, by a roughly consistent ~2× margin (average 1126.9 ns vs
556.5 ns) despite substantial run-to-run noise in the absolute numbers
on this actively-used dev machine (TS-native ranged 840–1432 ns; wasm
ranged 433–684 ns — machine load noise, not a Zig/wasm change, matches
the 2026-07-20 note's own explanation for its similarly noisy numbers).
This confirms the 2026-07-20 spot-check's reversal was real, not a
fluke of one noisy run: **wasm-swap `stepPlayer` is now the reliably
faster path**, the opposite of the original 2026-05-05 "~6% slower"
finding. Nothing has been identified in this pass that explains the
mechanism (the wasm boundary-tax model from the original takeaways
still applies structurally) — the most likely honest explanation is
that `stepPlayer`'s TS-native cost has grown substantially since May
(same `resolveMoveCached` TS-native call also nearly doubled, 191→264
ns average) as the sim gained logic, while the wasm-side kernel's own
growth has been smaller, but this doc does not have a per-commit
breakdown to prove that causal claim — recorded as the honest
observation, not oversold as a diagnosed root cause.

`resolveMoveCached` wasm-swap end-to-end and the newer `step_world`
surface (melee, abilities, draft/offer-roll, first-blood, team peel,
Kindled Ward etc.) are still NOT covered by this bench — same gap the
2026-07-20 banner already named, still open. If that surface becomes a
real perf question, it needs its own kernels added to
`tools/wasm-bench.ts`, not an inference from `stepPlayer` alone.
