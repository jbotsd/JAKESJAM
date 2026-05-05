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
  world_state_set_statics: (
    state_ptr: number,
    aabbs_ptr: number,
    one_way_ptr: number,
    count: number,
  ) => number;
  world_state_set_target_score: (state_ptr: number, target: number) => void;
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
  await ensureSim();
  return runWasmStepSync(state, dt_ms).state;
}

/**
 * Phase A2 — single private helper. All four public step variants
 * (sync/async × events/no-events) collapse to this. Sync because
 * callers in production always preload first. The async variants
 * just await `ensureSim()` then delegate.
 *
 * Steps performed (in order, every call):
 *   1. Validate cachedSim + cachedEx are populated.
 *   2. Validate state buffer size matches packed bytes.
 *   3. pack(state) → wasm linear memory at sim.statePtr.
 *   4. writeStaticsIntoMemory() — terrain AABBs into state.statics[].
 *   5. writePlayerInputsFromGlobal() — current_keys / prev_keys / aim
 *      patched after pack. Without this, prediction runs on stale
 *      keys → "stuttery laggy" symptom (commit 4a73635).
 *   6. ex.step_world(statePtr, dt_ms).
 *   7. unpack(state) → fresh TS WorldState bytes.
 *   8. mergeUnpacked → identity-stable merge with prior `state`.
 *
 * Returns `{ state, events, matchComplete }` always; callers that
 * don't need events drop them. Throws on any wasm-side error.
 *
 * The check that came before each variant (cachedSim/cachedEx +
 * buffer size) is centralised here so a future divergence between
 * variants can't recur.
 */
function runWasmStepSync(
  state: WorldState,
  dt_ms: number,
): { state: WorldState; events: WasmSimEvent[]; matchComplete: boolean } {
  if (!cachedSim || !cachedEx) {
    throw new Error(
      "[wasm-world] runWasmStepSync called before preload — call preloadWasmWorldSim() at boot first",
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
  writeStaticsIntoMemory();
  writePlayerInputsFromGlobal();
  const rc = ex.step_world(sim.statePtr, dt_ms);
  if (rc !== 0) {
    throw new Error(`[wasm-world] step_world returned ${rc}`);
  }
  const back = new Uint8Array(
    ex.memory.buffer,
    sim.statePtr,
    WORLD_STATE_TOTAL_SIZE,
  ).slice();
  const unpacked = unpackWorldState(back);
  return {
    state: mergeUnpacked(state, unpacked),
    events: unpacked.events,
    matchComplete: unpacked.matchWinnerIdx >= 0,
  };
}

function mergeUnpacked(
  state: WorldState,
  unpacked: UnpackedWorldState,
): WorldState {
  // Identity-preserving merge (I44): only replace each entity
  // record if its scalar fields differ from the prior tick's
  // record. This keeps Phaser sprite + procedural-rig
  // bookkeeping stable across ticks (the renderer uses
  // referential identity on entity records as a cheap "did this
  // change?" probe). Without this every tick produces brand-new
  // entity objects → rig redraws every limb every frame → visual
  // streaks (user playtest report 2026-05-05).
  return {
    ...state,
    tick: unpacked.tick,
    rngState: unpacked.rngState,
    round: {
      ...state.round,
      phase: unpacked.round.phase,
      countdownRemainingMs: unpacked.round.countdownRemainingMs,
      roundIndex: unpacked.round.roundIndex,
      scores: { ...state.round.scores, ...unpacked.scores },
    },
    players: stableMergeRecord(state.players, unpacked.players),
    firePatches: stableMergeRecord(state.firePatches, unpacked.firePatches),
    destructibles: stableMergeRecord(
      state.destructibles,
      unpacked.destructibles,
    ),
    projectiles: stableMergeRecord(state.projectiles, unpacked.projectiles),
    satellites: stableMergeRecord(state.satellites, unpacked.satellites),
    pickups: stableMergeRecord(state.pickups, unpacked.pickups),
  };
}

function stableMergeRecord<K extends string | number, V>(
  prev: Record<K, V>,
  next: Record<K, V>,
): Record<K, V> {
  // For each key in `next`, reuse the prev value if shallow-equal.
  // For keys removed from `next`, drop them. Ensures referential
  // stability for unchanged entities.
  const out: Record<K, V> = {} as Record<K, V>;
  for (const k in next) {
    const a = prev[k];
    const b = next[k];
    if (a !== undefined && shallowEqual(a, b)) {
      out[k] = a;
    } else {
      out[k] = b;
    }
  }
  return out;
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (av !== bv) return false;
  }
  return true;
}

/**
 * Variant returning the wasm-emitted SimEvents alongside the
 * merged state. Callers drain `events` for UI / audio / VFX
 * dispatch (round-end banner, hit confirms, kill stack, etc).
 */
export async function applyWasmWorldStepFull(
  state: WorldState,
  dt_ms: number,
): Promise<{ state: WorldState; events: WasmSimEvent[]; matchComplete: boolean }> {
  await ensureSim();
  return runWasmStepSync(state, dt_ms);
}

/**
 * URL-flag check. Default OFF — set `?wasm-world=1` to opt in.
 * The opposite of the F3 default-on rollout because the
 * orchestrator is incomplete; this shim enabling is a regression
 * surface, not a determinism win, until J3 lands.
 */
export function isWasmWorldEnabled(): boolean {
  const loc = (globalThis as { location?: { search: string } }).location;
  if (!loc) return false;
  try {
    const params = new URLSearchParams(loc.search);
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
  return runWasmStepSync(state, dt_ms).state;
}

function writePlayerInputsFromGlobal(): void {
  const stash = (
    globalThis as {
      __jakesjam_wasm_inputs__?: ReadonlyMap<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >;
    }
  ).__jakesjam_wasm_inputs__;
  if (!stash) return;
  writePlayerInputsIntoMemory(stash);
}

/**
 * Patch per-player current_keys / prev_keys / aim_x / aim_y into
 * the packed WorldState in linear memory. Caller computes the
 * fresh keys bitmap, previous-tick keys, and aim per playerId
 * (sorted).
 *
 * Without this call, wasm players never see input bits → no
 * walking, no jumping, no firing. Aim updates also need this
 * path so the muzzle position matches what the player sees.
 */
export function writePlayerInputsIntoMemory(
  inputs: ReadonlyMap<
    string,
    { keys: number; prevKeys: number; aimX: number; aimY: number }
  >,
): void {
  if (!cachedSim || !cachedEx) return;
  const sim = cachedSim;
  const ex = cachedEx;
  const view = new DataView(ex.memory.buffer);
  const playersStart = sim.statePtr + 48 + 8;
  const PLAYER_ENTITY_SIZE = 288;
  // aim_x + aim_y are at f64 slots 4 + 5 (offset 32 + 40).
  const AIMX_OFF = 4 * 8;
  const AIMY_OFF = 5 * 8;
  // current_keys + prev_keys live at +268 / +272.
  const CURR_OFF = 268;
  const PREV_OFF = 272;
  const sortedIds = [...inputs.keys()].sort();
  for (let i = 0; i < sortedIds.length; i++) {
    const pid = sortedIds[i]!;
    const v = inputs.get(pid);
    if (!v) continue;
    const playerOff = playersStart + i * PLAYER_ENTITY_SIZE;
    view.setFloat64(playerOff + AIMX_OFF, v.aimX, true);
    view.setFloat64(playerOff + AIMY_OFF, v.aimY, true);
    view.setUint32(playerOff + CURR_OFF, v.keys >>> 0, true);
    view.setUint32(playerOff + PREV_OFF, v.prevKeys >>> 0, true);
  }
}

/**
 * Sync variant of applyWasmWorldStepFull — returns merged state
 * AND the wasm-emitted SimEvents in one call. Used by the J1-actual
 * path in World.ts so the netcode loop can emit hit-confirms +
 * round-end + pickup-taken events to the renderer.
 */
export function applyWasmWorldStepFullSync(
  state: WorldState,
  dt_ms: number,
): { state: WorldState; events: WasmSimEvent[]; matchComplete: boolean } {
  return runWasmStepSync(state, dt_ms);
}

// Re-export the shared helper so WasmHost can call it directly
// (avoids one extra function indirection per tick).
export { runWasmStepSync };

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

/**
 * Module-level cache of the static AABB layout. The shim writes
 * these into wasm memory via world_state_set_statics after every
 * pack so step_world's stepPlayer + step_projectile_v2 see the
 * full terrain. Without this, players fall through every
 * platform when running ?wasm-world=2.
 */
type StaticAABB = { x: number; y: number; w: number; h: number };
let cachedStatics: { aabbs: StaticAABB[]; oneWay: number[] } | null = null;

/**
 * Set the static-AABB cache for this match. The host (World.ts
 * createRuntime, OnlineMatchScene boot) calls this once after the
 * map loads. Subsequent step_world calls patch the bytes from
 * the cache before running the orchestrator.
 */
export function setWorldStatics(
  aabbs: ReadonlyArray<StaticAABB>,
  oneWay: ReadonlyArray<number>,
): void {
  cachedStatics = {
    aabbs: aabbs.slice(),
    oneWay: oneWay.slice(),
  };
}

const AABB_SIZE_BYTES = 32;

function writeStaticsIntoMemory(): void {
  if (!cachedStatics || !cachedSim || !cachedEx) return;
  const ex = cachedEx;
  const sim = cachedSim;
  // Scratch buffer must live PAST the end of WorldState in
  // linear memory, otherwise the AABBs we're packing trample
  // the very statics region we're about to fill. The static
  // state buffer is 128 KB; WorldState is ~84 KB. Place scratch
  // at the buffer tail (state buffer is 128 KB total — leave
  // ~30 KB for the AABB array (256×32 = 8 KB) + one_way (256 B)
  // + headroom).
  const scratchPtr = sim.statePtr + WORLD_STATE_TOTAL_SIZE + 64;
  const heap = new Uint8Array(ex.memory.buffer);
  const view = new DataView(ex.memory.buffer, scratchPtr);
  const count = Math.min(cachedStatics.aabbs.length, 256);
  for (let i = 0; i < count; i++) {
    const a = cachedStatics.aabbs[i]!;
    view.setFloat64(i * AABB_SIZE_BYTES + 0, a.x, true);
    view.setFloat64(i * AABB_SIZE_BYTES + 8, a.y, true);
    view.setFloat64(i * AABB_SIZE_BYTES + 16, a.w, true);
    view.setFloat64(i * AABB_SIZE_BYTES + 24, a.h, true);
  }
  const oneWayPtr = scratchPtr + count * AABB_SIZE_BYTES;
  for (let i = 0; i < count; i++) {
    heap[oneWayPtr + i] = cachedStatics.oneWay[i] ?? 0;
  }
  ex.world_state_set_statics(sim.statePtr, scratchPtr, oneWayPtr, count);
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
