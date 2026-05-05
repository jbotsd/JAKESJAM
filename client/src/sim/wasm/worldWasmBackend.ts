// Phase J0 — minimal TS shim that calls the wasm `step_world`
// orchestrator (Phase I2). Opt-in via `?wasm-world=1`. Default
// off until full parity against the TS World.step is proven.
//
// Coverage today (matches the I2 step_world skeleton):
//   - tick increment
//   - round phase machine transitions (countdown / fighting /
//     round-over → countdown)
//   - fire-patch lifetime decay
//   - projectile pre-step lifecycle (sticky / lifetime expire)
//   - per-pair projectile×destructible HP application
//
// NOT YET covered (these still run TS-side):
//   - player physics (walk / jump / jetpack / crouch / collision)
//   - projectile motion + pathing dispatch
//   - weapon spawn from resolved build
//   - satellite owner-target lookup + spawn
//   - combat shield drain + parry start (input-driven)
//   - score keeping + winner detection
//   - drafting orchestration
//
// Strategy: callers run TS World.step FIRST, then call
// `applyWasmWorldStep(state, dt)` to layer the wasm-driven
// pieces on top. This is a STRICT no-regress rollout: every
// piece wasm owns is a piece TS no longer mutates, but TS still
// owns everything else. As H phase ports land in wasm, this
// shim grows; eventually World.step becomes a thin wrapper
// around `applyWasmWorldStep` (Phase J1).

import type { WorldState } from "../types.js";
import { loadSim, type Sim } from "./loader.js";
import {
  packWorldState,
  unpackWorldState,
  WORLD_STATE_TOTAL_SIZE,
  type UnpackedWorldState,
  type WasmSimEvent,
} from "./worldStateBridge.js";

type WorldExports = {
  step_world: (state_ptr: number, dt_ms: number) => number;
  memory: WebAssembly.Memory;
};

let cachedSim: Sim | null = null;
let cachedEx: WorldExports | null = null;
let warned = false;

async function ensureSim(): Promise<{ sim: Sim; ex: WorldExports }> {
  if (cachedSim && cachedEx) return { sim: cachedSim, ex: cachedEx };
  const sim = await loadSim();
  const ex = sim.exports as unknown as WorldExports;
  if (typeof ex.step_world !== "function") {
    throw new Error(
      "[wasm-world] step_world export missing from sim.wasm — rebuild required",
    );
  }
  cachedSim = sim;
  cachedEx = ex;
  return { sim, ex };
}

/**
 * Apply one wasm-driven sim tick on top of `state`. Returns a
 * NEW state object (does not mutate `state`). The shim packs the
 * full TS WorldState into the wasm linear-memory state buffer,
 * calls step_world, and unpacks the result.
 *
 * Cost: one full pack/unpack per call (~70 KB each direction).
 * The performance cliff lands once we move the wire format off
 * msgpack-wrapped TS objects (Phase G3 wired the protocol bump;
 * Phase J3 swaps the actual emission path).
 */
export async function applyWasmWorldStep(
  state: WorldState,
  dt_ms: number,
): Promise<WorldState> {
  const { sim, ex } = await ensureSim();
  const buf = packWorldState(state);
  if (buf.byteLength !== WORLD_STATE_TOTAL_SIZE) {
    throw new Error(
      `[wasm-world] packed buffer size mismatch: ${buf.byteLength} vs ${WORLD_STATE_TOTAL_SIZE}`,
    );
  }
  if (sim.stateLen < WORLD_STATE_TOTAL_SIZE) {
    throw new Error(
      `[wasm-world] sim state buffer ${sim.stateLen}B too small for WorldState ${WORLD_STATE_TOTAL_SIZE}B`,
    );
  }
  const heap = new Uint8Array(ex.memory.buffer);
  heap.set(buf, sim.statePtr);
  const rc = ex.step_world(sim.statePtr, dt_ms);
  if (rc !== 0) {
    throw new Error(`[wasm-world] step_world returned ${rc}`);
  }
  const back: Uint8Array = new Uint8Array(
    ex.memory.buffer,
    sim.statePtr,
    WORLD_STATE_TOTAL_SIZE,
  ).slice();
  const unpacked: UnpackedWorldState = unpackWorldState(back);

  return mergeUnpacked(state, unpacked);
}

function mergeUnpacked(
  state: WorldState,
  unpacked: UnpackedWorldState,
): WorldState {
  return {
    ...state,
    tick: unpacked.tick,
    rngState: unpacked.rngState,
    round: {
      ...state.round,
      phase: unpacked.round.phase,
      countdownRemainingMs: unpacked.round.countdownRemainingMs,
      roundIndex: unpacked.round.roundIndex,
      // I24 — bridge per-player score from PlayerEntity.score
      // back into round.scores keyed by playerId.
      scores: { ...state.round.scores, ...unpacked.scores },
    },
    players: unpacked.players,
    firePatches: unpacked.firePatches,
    destructibles: unpacked.destructibles,
    projectiles: unpacked.projectiles,
    satellites: unpacked.satellites,
    pickups: unpacked.pickups,
  };
}

/**
 * Variant returning the wasm-emitted SimEvents alongside the
 * merged state. Callers drain `events` for UI / audio / VFX
 * dispatch (round-end banner, hit confirms, kill stack, etc).
 */
export async function applyWasmWorldStepFull(
  state: WorldState,
  dt_ms: number,
): Promise<{ state: WorldState; events: WasmSimEvent[] }> {
  const { sim, ex } = await ensureSim();
  const buf = packWorldState(state);
  const heap = new Uint8Array(ex.memory.buffer);
  heap.set(buf, sim.statePtr);
  const rc = ex.step_world(sim.statePtr, dt_ms);
  if (rc !== 0) throw new Error(`[wasm-world] step_world returned ${rc}`);
  const back = new Uint8Array(
    ex.memory.buffer,
    sim.statePtr,
    WORLD_STATE_TOTAL_SIZE,
  ).slice();
  const unpacked = unpackWorldState(back);
  return {
    state: mergeUnpacked(state, unpacked),
    events: unpacked.events,
  };
}

/**
 * URL-flag check. Default OFF — set `?wasm-world=1` to opt in.
 * The opposite of the F3 default-on rollout because the
 * orchestrator is incomplete; this shim enabling is a regression
 * surface, not a determinism win, until J3 lands.
 */
export function isWasmWorldEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("wasm-world") === "1") return true;
    if (params.get("wasm-world") === "0") return false;
  } catch {
    // localStorage / window access can fail in strict sandboxes.
  }
  return false;
}

/**
 * Sync variant. Requires `preloadWasmWorldSim()` to have completed
 * already — otherwise throws. Use from inside the netcode loop's
 * sync `stepWithRuntime` once the loop has confirmed the boot
 * preload finished.
 */
export function applyWasmWorldStepSync(
  state: WorldState,
  dt_ms: number,
): WorldState {
  if (!cachedSim || !cachedEx) {
    throw new Error(
      "[wasm-world] applyWasmWorldStepSync called before preload — call preloadWasmWorldSim() at boot first",
    );
  }
  const sim = cachedSim;
  const ex = cachedEx;
  const buf = packWorldState(state);
  if (buf.byteLength !== WORLD_STATE_TOTAL_SIZE) {
    throw new Error(
      `[wasm-world] packed buffer size mismatch: ${buf.byteLength} vs ${WORLD_STATE_TOTAL_SIZE}`,
    );
  }
  if (sim.stateLen < WORLD_STATE_TOTAL_SIZE) {
    throw new Error(
      `[wasm-world] sim state buffer ${sim.stateLen}B too small for WorldState ${WORLD_STATE_TOTAL_SIZE}B`,
    );
  }
  const heap = new Uint8Array(ex.memory.buffer);
  heap.set(buf, sim.statePtr);
  const rc = ex.step_world(sim.statePtr, dt_ms);
  if (rc !== 0) {
    throw new Error(`[wasm-world] step_world returned ${rc}`);
  }
  const back = new Uint8Array(
    ex.memory.buffer,
    sim.statePtr,
    WORLD_STATE_TOTAL_SIZE,
  ).slice();
  const unpacked: UnpackedWorldState = unpackWorldState(back);
  return mergeUnpacked(state, unpacked);
}

/**
 * Eagerly load + cache the wasm sim so the sync variant works.
 * Idempotent. Returns true if the sim is ready, false if it
 * couldn't load this boot.
 */
export async function preloadWasmWorldSim(): Promise<boolean> {
  try {
    await ensureSim();
    return true;
  } catch (err) {
    console.error("[wasm-world] preload failed:", err);
    return false;
  }
}

/** True iff the sync variant can be called without throwing. */
export function isWasmWorldReady(): boolean {
  return cachedSim != null && cachedEx != null;
}

/** Boot-time warning if the user opted in but wasm fails to load. */
export async function applyWasmWorldFlag(): Promise<void> {
  if (!isWasmWorldEnabled()) return;
  try {
    await ensureSim();
    if (!warned) {
      console.info(
        "[wasm-world] enabled. step_world will layer onto World.step every tick.",
      );
      warned = true;
    }
  } catch (err) {
    console.error(
      "[wasm-world] enable failed; world will run pure TS this session.",
      err,
    );
  }
}
