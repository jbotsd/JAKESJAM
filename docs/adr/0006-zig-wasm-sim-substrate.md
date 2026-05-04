# ADR-0006: The sim layer compiles from Zig to WASM

## Status

Accepted (2026-05-04). Migration in progress — see
`docs/zig-wasm-migration.md` for the phased rollout. Until that
migration completes, the sim still lives in TypeScript at
`client/src/sim/`. Read this ADR alongside ADR-0001 (which states
*what* the sim must be — pure and deterministic) and ADR-0005 (which
states *how* prediction + reconciliation work above the sim).

## Context

ADR-0001 established that the sim must produce byte-identical
`WorldState`s on the authoritative Bun server and every Phaser
client (for prediction). Two weeks of production wear in May 2026
revealed that the chosen substrate — TypeScript with native `number`
— **cannot satisfy that contract**.

Symptoms:

- "Barely detects standing on anything" — micro-jitter in the rig
  even when sim says grounded.
- "Falls through terrain" — recoverable in single-player tests, but
  reproduces under multiplayer reconcile pressure.
- Console + video evidence: per-entity reconcile firing every
  snapshot tick (60 Hz) because predicted vs authoritative
  `WorldState` hashes differ by sub-pixel float drift.

Diagnosis:

IEEE 754 floating-point arithmetic is **not bit-deterministic across
host runtimes**. V8 (browsers) and JSC (Bun's runtime) use platform
libm for `Math.sin`, `Math.cos`, `Math.atan2`, `Math.sqrt` and may
apply different polynomial approximations or domain reductions. Even
plain `+`, `-`, `*` are guaranteed equal *within* IEEE 754 only when
the FPU rounding mode and precision are identical, which the JS
engines do not jointly guarantee. Each tick, two hosts diverge by
~1e-7 per op. Across 60 ops per tick × 60 ticks/sec, drift is
visible inside a few seconds.

The hash-based per-entity reconcile in `clientLoop.ts:687-728`
turns this into 60 Hz of position rebuilds. The render-side
`RenderSmoother` absorbs ~80% of the visual delta, but the
remaining 20% is exactly what users describe as "barely detects
standing".

## Considered alternatives

1. **Stay in TS, accept drift and use heavier render smoothing**
   (status quo through commits `b3bcbf2..272fa0e`). Rejected. Has
   been tried for two weeks. The smoothing window and reconcile
   thresholds bottomed out at "good enough for testing, bad enough
   that users notice".
2. **TS with Q16.16 fixed-point arithmetic** (proposed and prototyped
   in commit `894e4b2`, since reverted). Workable. ~7-day migration.
   ~18× slower for hot arithmetic per published benchmarks
   ([@shaisrc/fixed-point](https://www.npmjs.com/package/@shaisrc/fixed-point)).
   Rejected in favour of option 4 below — wasm gives the same
   determinism guarantee for free, with native float performance.
3. **Rust → WASM**. Workable. Mature ecosystem (Bevy, Rapier).
   ~2-4 week migration. Larger binary (~200 KB+ with `wasm-bindgen`
   glue), bigger build pipeline, two languages in the codebase.
   Rejected in favour of Zig (option 4) which produces 10-30 KB
   binaries with no glue layer.
4. **Zig → WASM**. Selected. See "Decision" below.
5. **GGPO-style rollback netcode** (e.g.
   [DelayNoMore](https://github.com/genxium/DelayNoMore)). Solves a
   different problem (input latency, not host drift). Not directly
   applicable until the sim is deterministic; revisit if input
   latency becomes the next felt limit.
6. **Switch the front end to Elm**. Considered. Rejected — Elm
   targets the same IEEE 754 underneath and doesn't address the
   determinism root cause. 6+ month rewrite for orthogonal
   benefits (zero runtime exceptions, better type system).

## Decision

**The deterministic sim core compiles from Zig to WASM.** The wasm
module is loaded by both the browser client and the Bun server.
Both sides execute the *same wasm bytecode*. Per the
[WebAssembly specification (Numeric Instructions)](https://webassembly.github.io/spec/core/exec/numerics.html),
IEEE 754 ops on `f32`/`f64` are **bit-exact across all wasm hosts**.
Drift is impossible by construction.

Zig is selected over Rust because:

1. `zig build-lib -target wasm32-freestanding` produces ~10-30 KB
   binaries for the sim's scope. Rust + `wasm-bindgen` is ~200 KB+.
2. No `wasm-bindgen` glue layer to maintain.
3. Manual memory model with no GC, matching the existing "no
   allocations during step" rule from ADR-0001.
4. `comptime` makes lookup tables, struct layouts, and bitmask
   constants zero-cost at runtime.
5. Bun has native `WebAssembly` support, so the server runs the
   same `.wasm` as the client. **One binary, both sides.** This is
   stronger than ADR-0001's by-convention shared `sim/` package: the
   convention becomes a build artifact.

## Consequences

### Positive

- Determinism is enforced by the wasm spec, not by manual
  discipline. Adding a new sim system can't accidentally introduce
  drift.
- The 60-Hz reconcile churn drops to ~0 Hz in steady-state — the
  sim's predicted state matches authoritative state bit-for-bit.
  Visible jitter eliminated by construction.
- Wasm is roughly 10-30× faster than TS for hot-path arithmetic.
  We have headroom for richer per-tick logic.
- Server-side wasm execution in Bun has the same characteristics —
  no Node-only dependencies, no two-runtime support burden.

### Negative / cost

- Two languages in the codebase (TS + Zig). New contributor onboard
  has a higher first-day cost.
- Hot reload during dev requires a Vite plugin to rebuild the wasm
  on Zig source change. Initial dev-loop friction; tooling matures
  fast.
- Zig is pre-1.0 (currently 0.13). Some friction on language
  upgrades over the project's lifetime. Pinned via `.zig-version`.
- Migration is ~3 weeks of dedicated work — see
  `docs/zig-wasm-migration.md`. Hard PR boundaries so each phase
  can land or revert independently.

### Neutral

- The sim's *contract* (ADR-0001) is unchanged. The wasm module
  exposes the same conceptual `World.step(state, inputs, dt)`
  surface; only the implementation language differs.
- The TS layers above the sim (clientLoop.ts, snapshotDelta.ts,
  Phaser scenes) are unchanged. They wrap the wasm export with the
  same shape they wrap the current TS World class.
- Replay file format unaffected — replays record inputs + RNG seed,
  both substrate-neutral. The wasm sim consumes the same replay
  files as the TS sim does today.

## What this replaces

- Implicitly, the line in ADR-0001 that says *"Server and client
  divergence is not possible by code path"* — formally true under
  shared-package import, but undermined by the float-drift bug. With
  this ADR the statement becomes operationally true.
- The "accept small drift, let snapshots correct it" guidance in
  the Determinism section of `docs/netcode-architecture.md` is
  superseded; that section now points at the Implementation
  Substrate section that records this decision.
- The Q16.16 fixed-point branch (commit `894e4b2`, reverted in
  `0d322bd`) is replaced by this decision.

## References

- [WASM Spec — Numeric Instructions (IEEE 754 mandate)](https://webassembly.github.io/spec/core/exec/numerics.html)
- [Zig — Targets](https://ziglang.org/documentation/master/#Targets)
- [Glenn Fiedler — Floating-Point Determinism](https://gafferongames.com/post/floating_point_determinism/)
- [Photon Quantum — Fixed Point ECS](https://doc.photonengine.com/quantum/current/manual/quantum-ecs/fixed-point) (alternative substrate at game-engine scale)
- [DelayNoMore — websocket rollback platformer](https://github.com/genxium/DelayNoMore) (orthogonal netcode reframe, not part of this decision)
- ADR-0001 — sim purity contract
- ADR-0005 — Gambetta prediction model
- `docs/netcode-architecture.md` — substrate-neutral architecture doc, §"Implementation Substrate"
- `docs/zig-wasm-migration.md` — phased rollout plan
- Memory note: `~/.claude/projects/.../memory/jakesjam-zig-wasm-pivot.md`
