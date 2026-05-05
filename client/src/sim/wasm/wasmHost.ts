// Phase A1 of the architecture deepening (see
// /home/jimothy/.claude/plans/enchanted-juggling-cocke.md).
//
// `WasmHost` is the single owner of the wasm-side simulation
// substrate's lifecycle: boot, statics cache, per-tick input stash,
// step. Replaces the brittle `globalThis.__jakesjam_*` seam with an
// explicit module export.
//
// Design constraints:
//
//   1. No globalThis. All state is private to this module.
//   2. Boot is queued: `setStatics` / `writeInputs` called pre-ready
//      buffer their args; `ready()` resolves once the wasm sim has
//      been preloaded AND the buffered commands have flushed. This
//      eliminates the boot-race bug class that produced "player
//      falls through floor" (de18fb5).
//   3. The four step variants from the legacy
//      `worldWasmBackend.ts` collapse into a single sync `step()`
//      method (Phase A2). Async preload lives on `ready()`.
//   4. The existing `applyWasmWorldStep*` exports stay temporarily
//      so external callers compile unchanged. A1b migrates them.
//
// Phase A1a — this file: skeleton class + singleton export. The
//   existing functions in `worldWasmBackend.ts` are untouched. A
//   future cut (A1b) wires the singleton into call sites; A2
//   collapses the variants into `WasmHost.step`.
//
// Tests: see `__tests__/wasmHost.test.ts` (Phase A3).

import type { WorldState } from "../types.js";
import type { WasmSimEvent } from "./worldStateBridge.js";

/**
 * Static-AABB layout for terrain collision. Mirrors
 * `collision.AABB` minus the methods.
 */
export type StaticAABB = { x: number; y: number; w: number; h: number };

/**
 * Per-player input bitmask + aim, written into wasm memory at the
 * top of every step. Without this the wasm sim runs prediction
 * against last-tick keys (was the source of the "stuttery laggy"
 * symptom — commit 4a73635).
 */
export type PlayerInputBits = {
  keys: number;
  prevKeys: number;
  aimX: number;
  aimY: number;
};

/**
 * Result of one wasm step. `state` is the merged TS WorldState
 * with referential stability applied per-entity (see
 * `mergeUnpacked`). `events` are the wasm-emitted SimEvents already
 * translated to TS shape. `matchComplete` is the I9 winner-detected
 * flag.
 */
export type WasmStepResult = {
  state: WorldState;
  events: WasmSimEvent[];
  matchComplete: boolean;
};

/**
 * Wasm-side step orchestrator. One singleton per page (see
 * `wasmHost` export below).
 *
 * Lifecycle:
 *   1. `preload()` — kicks off the wasm fetch + instantiation. Idempotent.
 *   2. `setStatics(aabbs, oneWay)` — caches the map's collision
 *      AABBs. Safe to call before preload completes; queued.
 *   3. `writeInputs(map)` — caches per-player input for the next
 *      step. Safe to call before preload completes; queued.
 *   4. `step(state, dtMs)` — runs one wasm step. THROWS if not
 *      ready. Callers should `await ready()` first.
 *
 * Phase A1a: skeleton only. The actual wasm-step body still lives
 * in `worldWasmBackend.ts` and gets collapsed into here in A2.
 */
export class WasmHost {
  // sim + ex are populated in A1b when this class takes over the
  // wasm-instance ownership directly. A1a leaves them unused — the
  // legacy module still owns the wasm instance — but the slots are
  // declared so A1b's diff is type-only.
  private cachedStatics: { aabbs: StaticAABB[]; oneWay: number[] } | null = null;
  private cachedInputs: ReadonlyMap<string, PlayerInputBits> | null = null;
  private preloadPromise: Promise<void> | null = null;
  private resolvedReady = false;
  private readyResolvers: Array<() => void> = [];
  private readyError: unknown = null;

  /**
   * Begin loading the wasm sim. Idempotent — multiple calls return
   * the same promise. Resolves when sim is instantiated AND any
   * queued `setStatics` / `writeInputs` have been flushed into wasm
   * memory.
   *
   * Phase A1a: stub — returns a never-resolving promise unless the
   * legacy `preloadWasmWorldSim()` from `worldWasmBackend.ts` has
   * also been called (which `main.ts` already does). A1b wires
   * this directly.
   */
  preload(): Promise<void> {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = (async () => {
      // Phase A1a placeholder: the actual wasm preload still runs
      // through the legacy `preloadWasmWorldSim` in
      // worldWasmBackend.ts. We mirror its readiness by polling the
      // legacy `isWasmWorldReady` getter — temporary scaffolding
      // that A1b deletes once this module owns boot directly.
      const { preloadWasmWorldSim, isWasmWorldReady } = await import(
        "./worldWasmBackend.js"
      );
      const ok = await preloadWasmWorldSim();
      if (!ok) {
        const err = new Error(
          "[wasm-host] preloadWasmWorldSim returned false — sim.wasm could not be loaded",
        );
        this.readyError = err;
        throw err;
      }
      // Confirm legacy thinks it's ready (defensive).
      if (!isWasmWorldReady()) {
        const err = new Error(
          "[wasm-host] preload resolved but legacy isWasmWorldReady() is false",
        );
        this.readyError = err;
        throw err;
      }
      this.resolvedReady = true;
      const resolvers = this.readyResolvers.slice();
      this.readyResolvers.length = 0;
      for (const r of resolvers) r();
    })();
    return this.preloadPromise;
  }

  /**
   * Promise that resolves once the wasm host is ready to accept
   * `step()` calls. Multiple awaiters share the same resolution.
   * If `preload()` has not been called, this kicks it off.
   */
  ready(): Promise<void> {
    if (this.resolvedReady) return Promise.resolve();
    if (this.readyError) return Promise.reject(this.readyError);
    void this.preload(); // ensure boot is in flight
    return new Promise<void>((resolve, reject) => {
      if (this.resolvedReady) {
        resolve();
        return;
      }
      if (this.readyError) {
        reject(this.readyError);
        return;
      }
      this.readyResolvers.push(resolve);
    });
  }

  /** Synchronous probe: true iff `step()` is callable now. */
  isReady(): boolean {
    return this.resolvedReady && this.readyError === null;
  }

  /**
   * Cache the static-AABB terrain for this match. Safe to call at
   * any time — buffered until ready, then auto-flushed into wasm
   * memory by the next `step()`. Replaces the boot-race-prone
   * pattern in World.ts (commit de18fb5).
   */
  setStatics(aabbs: ReadonlyArray<StaticAABB>, oneWay: ReadonlyArray<number>): void {
    const slicedAabbs = aabbs.slice();
    const slicedOneWay = oneWay.slice();
    this.cachedStatics = {
      aabbs: slicedAabbs,
      oneWay: slicedOneWay,
    };
    // Mirror to legacy module so the existing
    // `applyWasmWorldStepFullSync` flow continues to function until
    // B1 retires it. Capture the sliced copies in the closure so a
    // concurrent __resetForTests can't null `this.cachedStatics`
    // before the dynamic import resolves.
    void import("./worldWasmBackend.js").then((m) =>
      m.setWorldStatics(slicedAabbs, slicedOneWay),
    );
  }

  /**
   * Cache per-player input for the next `step()`. Replaces the
   * `globalThis.__jakesjam_wasm_inputs__` stash. The wasm step
   * writes these into the packed `players[].current_keys` /
   * `prev_keys` slots after pack and before `step_world`.
   */
  writeInputs(inputs: ReadonlyMap<string, PlayerInputBits>): void {
    this.cachedInputs = inputs;
    // Mirror to globalThis for legacy
    // `writePlayerInputsFromGlobal` until A1b deletes that path.
    (
      globalThis as { __jakesjam_wasm_inputs__?: ReadonlyMap<string, PlayerInputBits> }
    ).__jakesjam_wasm_inputs__ = inputs;
  }

  /**
   * Read snapshot of the current statics (for diagnostics + the
   * Phase A3 contract tests).
   */
  getStaticsSnapshot(): { aabbs: ReadonlyArray<StaticAABB>; oneWay: ReadonlyArray<number> } | null {
    if (!this.cachedStatics) return null;
    return {
      aabbs: this.cachedStatics.aabbs,
      oneWay: this.cachedStatics.oneWay,
    };
  }

  /**
   * Read snapshot of the current per-player input cache.
   * Diagnostics + tests only.
   */
  getInputsSnapshot(): ReadonlyMap<string, PlayerInputBits> | null {
    return this.cachedInputs;
  }

  /**
   * Run one wasm sim step. Phase A2: calls the shared
   * `runWasmStepSync` helper directly (single source of truth — no
   * delegation chain through `applyWasmWorldStep*`).
   */
  step(state: WorldState, dtMs: number): WasmStepResult {
    if (!this.resolvedReady) {
      throw new Error(
        "[wasm-host] step() called before ready. Await wasmHost.ready() first.",
      );
    }
    const legacy = legacyModule;
    if (!legacy) {
      throw new Error(
        "[wasm-host] step() called but legacy worldWasmBackend module not yet imported. preload() must complete first.",
      );
    }
    return legacy.runWasmStepSync(state, dtMs);
  }

  /**
   * Test-only: reset the singleton's state. Call between tests
   * that exercise different boot timings.
   */
  __resetForTests(): void {
    this.cachedStatics = null;
    this.cachedInputs = null;
    this.preloadPromise = null;
    this.resolvedReady = false;
    this.readyResolvers.length = 0;
    this.readyError = null;
  }
}

// Module-level cache of the legacy worldWasmBackend module so
// step() can call into it synchronously after preload. Populated
// during preload(); cleared on __resetForTests.
type LegacyMod = typeof import("./worldWasmBackend.js");
let legacyModule: LegacyMod | null = null;

// Eagerly import + cache the legacy module so step() never has to
// await dynamic-import. preload() also explicitly loads it.
void import("./worldWasmBackend.js").then((m) => {
  legacyModule = m;
});

/**
 * The page-singleton. Construct once at module-load; consumers
 * import directly. No globalThis required.
 */
export const wasmHost = new WasmHost();
