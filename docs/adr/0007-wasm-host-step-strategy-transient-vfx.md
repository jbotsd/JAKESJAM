# ADR-0007: Three new seams — WasmHost, StepStrategy, TransientVfx

## Status

Accepted (2026-05-06). Implementation shipped across commits
`50fc445` (A1a) → `15f0054` (C2b). See
`/home/jimothy/.claude/plans/enchanted-juggling-cocke.md` for the
full phased plan.

## Context

A 24-hour bug-fix sprint between 2026-05-05 morning and
2026-05-06 morning revealed that four painful production debugging
sessions all resolved to the same architectural smell:

1. **`applyWasmWorldStepFullSync` missing one line** that the
   sister function `applyWasmWorldStepSync` had — produced player
   jitter for hours of debugging. Four near-duplicate step variants
   in `client/src/sim/wasm/worldWasmBackend.ts`; a single missed
   `writePlayerInputsFromGlobal()` call was invisible in code
   review.

2. **`syncWorldStaticsToWasm` racing the wasm-backend boot** →
   "player falls through floor" symptom. The optional-chain
   `wb?.setWorldStatics?.(...)` against
   `globalThis.__jakesjam_wasm_backend__` silently dropped if the
   backend wasn't ready yet. Three `globalThis` keys
   (`__jakesjam_wasm_backend__`, `__jakesjam_wasm_inputs__`,
   `__jakesjam_game__`) had become a brittle informal seam with no
   sequencing.

3. **Cyan diagonal lines blanketing the canvas** — root cause was
   Phaser 4's `GeometryMask` quietly broken on undisplayed mask
   sources, leaking into `paintPlatform` brush streaks. But the
   *class* of bug was bigger: every transient visual in the
   render layer had its own ad-hoc lifetime (tween onComplete →
   destroy, drainActive killTweensOf, scene shutdown sweep).
   When one cleanup path failed, the visual leaked.

4. **Pool-managed Graphics not cleared** on `drainActive` (only on
   tween-completion `release()`). Killing the tween bypassed
   cleanup → cumulative geometry on next acquire → "the sparks
   look like a sewing machine".

Each was patched. None of the underlying seams was deepened.

The improve-codebase-architecture skill's audit (2026-05-05
evening) named the missing modules:

- A `WasmHost` to own wasm boot + statics cache + per-tick input
  stash, replacing the `globalThis` informal seam.
- A `StepStrategy` interface to name the sim ↔ net seam ADR-0006
  promised, so the 1087-line `stepWithRuntime` can become a thin
  delegator and a future Worker / native backend has a plug-in
  point.
- A `TransientVfx` coordinator to own short-lived visual lifetime
  end-to-end (graphic + curve-based fade + pool release + round-end
  drain), replacing the 11+ ad-hoc patterns.

## Decision

Accept the three seams as named architectural modules:

### WasmHost (`client/src/sim/wasm/wasmHost.ts`)

Single owner of the wasm sim substrate's lifecycle. Public surface:

```ts
class WasmHost {
  preload(): Promise<void>;          // idempotent boot
  ready(): Promise<void>;            // multiple awaiters share resolution
  isReady(): boolean;                // sync probe
  setStatics(aabbs, oneWay): void;   // buffers + auto-flushes when ready
  writeInputs(map): void;            // replaces globalThis stash
  step(state, dtMs): WasmStepResult; // sync; the only step variant
}
export const wasmHost = new WasmHost();
```

Replaces `globalThis.__jakesjam_wasm_backend__` and
`globalThis.__jakesjam_wasm_inputs__`. The buffered `setStatics`
queue + auto-flush on `ready()` makes the boot-race bug class
(commit `de18fb5` patched as a workaround) structurally
impossible.

The four `applyWasmWorldStep*` variants in `worldWasmBackend.ts`
collapse to one private helper `runWasmStepSync`. The "one missing
line" bug class is gone — every variant calls the same canonical
sequence.

Tests: `client/src/sim/wasm/__tests__/wasmHost.test.ts` (12
contract tests).

### StepStrategy (`client/src/sim/stepStrategy.ts`)

Interface naming the sim ↔ net seam. The only adapter today is
`WasmStepStrategy` (`client/src/sim/wasmStepStrategy.ts`) which
wraps `wasmHost.step()` + the inputs-map build +
`convertWasmEventsToTs` translation.

```ts
interface StepStrategy {
  step(state, runtime, inputs, dtMs): StepResult;
  ready(): Promise<void>;
  isReady(): boolean;
}
```

Per the improve-codebase-architecture skill: *"One adapter =
hypothetical seam. Two adapters = real seam."* The seam stays
explicit so a future Worker / native backend plugs in without
re-architecting `World.ts`. Until B2/B3 land (TS sim deletion +
server cutover), `World.ts stepWithRuntime` still owns the live
tick — `WasmStepStrategy` is the next-step replacement.

Tests: `client/src/sim/__tests__/stepStrategySeam.test.ts` (10
contract tests).

### TransientVfx (`client/src/game/render/TransientVfx.ts`)

Single owner of every short-lived visual effect's lifetime.
Replaces the 11+ scattered tween-onComplete patterns across
`ProjectileSystem`, `StatusVfxController`, `OnlineMatchScene`,
`MatchScene`, `paintPlatform`. Per FishNet's `NetworkTickSmoother`
+ Niagara's emitter pattern: visual lifetime is owned by the
visual system, with a curve as the termination condition.

```ts
class TransientVfx {
  attach(scene): void;               // bind to scene lifecycle
  spawn(opts): void;                 // factory + lifetimeMs + onTick + release
  drainAll(): void;                  // sweep on round-end
}
export const transientVfx = new TransientVfx();
```

`drainAll` scrubs Graphics geometry via `.clear()` before
release/destroy — locks in the bolt-cumulative-geometry fix from
commit `86d205d` as a module-level invariant rather than a one-off
pool tweak. The cyan-line accumulation bug class can't recur.

Tests: `client/src/game/render/__tests__/transientVfx.test.ts`
(14 contract tests).

## Consequences

### What this gains

- **Boot-race bug class eliminated.** The setStatics queue + ready
  promise pattern means callers can fire commands at any time;
  WasmHost flushes when ready.
- **"One missing line" bug class eliminated.** A single private
  step helper means all variants are byte-identical by
  construction.
- **Cyan-line / cumulative-geometry bug class eliminated.**
  TransientVfx scrubs Graphics on every release path, including
  round-end drain.
- **Three seam contracts in CI.** wasmHost.test (12) +
  stepStrategySeam.test (10) + transientVfx.test (14) = 36 new
  contract tests. Future regressions surface at CI time, not in
  playtest screenshots.
- **OnlineMatchScene shrunk** from 1624 → 1439 LOC. 5 entity
  render methods + 2 bookkeeping maps + 5 graphics fields →
  one `EntityRenderCoordinator` (200 LOC). 120-line
  `handleSimEvents` switch → 25-line lazy-init + dispatch loop
  delegating to `SimEventRouter` (180 LOC).
- **ADR-0006's promise made concrete.** The Zig-WASM substrate
  now has the named seam (`StepStrategy`) it always needed.
- **FishNet's `NetworkTickSmoother` + Niagara's emitter pattern
  applied as the visual-lifetime contract.** Documented in the
  TransientVfx module header so future contributors know the
  source.

### What this costs

- **More files in the sim/wasm + game/render dirs.** WasmHost
  (200 LOC) + StepStrategy (60 LOC) + WasmStepStrategy (90 LOC) +
  TransientVfx (220 LOC) + EntityRenderCoordinator (200 LOC) +
  SimEventRouter (180 LOC) ≈ +950 LOC of new module code; ~100
  LOC of duplicate body removed; net +850 LOC. The trade is
  explicit seams + ~36 contract tests for that surface area.
- **Two open follow-ups.** B2 (delete TS sim) + B3 (server-side
  WasmStepStrategy) are still pending — both need supervised
  playtest. C2b's `MatchUiCoordinator` extraction was deferred
  because the multiple overlay state machines (HudSystem,
  RoundBanner, DeathOverlay, ConnectionOverlay,
  MatchResultsOverlay) couple too tightly to the scene's
  `create()` lifecycle for a clean cut.
- **`globalThis.__jakesjam_wasm_inputs__` mirror still in place**
  for legacy `worldWasmBackend.writePlayerInputsFromGlobal`. A
  follow-up cut (B-final) deletes the mirror once the legacy
  variants are gone.

### Migration

Phase A (4 cuts, ~50 min) — WasmHost + step-variant collapse.
Phase B partial (2 of 4 cuts shipped) — StepStrategy adapter +
contract tests. B2/B3 pending supervised work.
Phase C (5 of 5 cuts shipped) — TransientVfx + EntityRenderCoordinator
+ SimEventRouter. MatchUiCoordinator deferred.

Total: 11 cuts shipped over ~3 hours, every cut gated on typecheck
+ unit tests + parity tests + e2e smoke; zero regressions.

## Related decisions

- ADR-0001 — sim purity + determinism (the contract these seams
  defend).
- ADR-0005 — Gambetta prediction + reconciliation (the layer
  above the WasmHost / StepStrategy seam).
- ADR-0006 — Zig→WASM substrate (the underlying decision; this
  ADR is the architectural follow-through).

## References

- improve-codebase-architecture skill audit, 2026-05-05.
- FishNet Networking docs — `NetworkTickSmoother` +
  `AdaptiveInterpolation` patterns (visual lifetime owned by the
  visual system).
- Niagara (Unreal Engine) — emitter lifetime as a curve, not a
  boolean.
- Plan file: `/home/jimothy/.claude/plans/enchanted-juggling-cocke.md`.
