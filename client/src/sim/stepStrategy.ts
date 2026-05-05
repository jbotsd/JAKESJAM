// Phase B1 of the architecture deepening plan
// (/home/jimothy/.claude/plans/enchanted-juggling-cocke.md).
//
// `StepStrategy` is the single named seam between the netcode layer
// and whichever simulation substrate runs the tick. ADR-0006 made
// the substrate decision (Zig→wasm); this file makes the seam
// EXPLICIT so a future Worker-thread or native backend plugs in
// without re-architecting `World.ts` or `clientLoop.ts`.
//
// Today there is one real adapter: `WasmStepStrategy` (Phase B1's
// `wasmStepStrategy.ts`). The B2 cuts delete the legacy TS sim
// modules; the wasm adapter becomes the only path.
//
// Per LANGUAGE.md / improve-codebase-architecture skill:
//   "One adapter = hypothetical seam. Two adapters = real seam."
// Until B2 lands, both adapters technically exist (the
// `stepWithRuntime` orchestrator IS a TsStepStrategy in disguise).
// After B2 there is one adapter — the seam stays explicit so the
// next backend has a clear plug-in point. The deletion test holds:
// removing this interface would scatter wasm-host coupling back
// into clientLoop + World, which is what we just removed.

import type { InputFrame, PlayerId, StepResult, WorldState } from "./types.js";
import type { WorldRuntime } from "./World.js";

/**
 * The single contract between the netcode tick loop and whichever
 * step backend (wasm today, future Worker/native) advances the
 * world state.
 *
 * Implementations OWN the substrate's lifecycle (boot, statics
 * setup, input marshalling). Callers only see `step()`.
 */
export interface StepStrategy {
  /**
   * Advance one tick. Returns the merged WorldState (referential
   * identity preserved per-entity), any events emitted during the
   * tick, and a `matchComplete` flag.
   *
   * Throws if the underlying substrate isn't ready. Callers
   * should `await ready()` first (see WasmStepStrategy).
   */
  step(
    state: WorldState,
    runtime: WorldRuntime,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
    dtMs: number,
  ): StepResult;

  /**
   * Promise that resolves when the substrate is ready to accept
   * `step()` calls. Idempotent — multiple awaiters share the same
   * resolution. Synchronous probes use `isReady()`.
   */
  ready(): Promise<void>;

  /** Synchronous probe: true iff `step()` is callable now. */
  isReady(): boolean;
}
