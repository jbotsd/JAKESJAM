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

import type { LaunchPadDefinition, PlayerId, WorldState } from "../types.js";
import { MAX_SLOPES, type SlopeStatic } from "../collision.js";
import { loadSim, type Sim } from "./loader.js";
import {
  packWorldState,
  unpackWorldState,
  WORLD_STATE_TOTAL_SIZE,
  PLAYER_ENTITY_SIZE,
  HEADER_SIZE,
  type UnpackedWorldState,
  type WasmSimEvent,
} from "./worldStateBridge.js";
import {
  resolveFireConfigsViaZig,
  type FireConfigResolverExports,
} from "./fireConfigShared.js";

type WorldExports = {
  step_world: (state_ptr: number, dt_ms: number) => number;
  world_state_set_statics: (
    state_ptr: number,
    aabbs_ptr: number,
    one_way_ptr: number,
    count: number,
  ) => number;
  world_state_set_target_score: (state_ptr: number, target: number) => void;
  world_state_set_arena_bounds: (
    ceiling_y: number,
    has_ceiling: number,
    kill_plane_y: number,
  ) => void;
  /** Optional — raw arena width/height (Track Z0b Item C wires it from the
   *  hosts; consumed by the shrink-zone storm + findCollisionFreeLanding). */
  world_state_set_arena_size?: (width: number, height: number) => void;
  /** Optional — older sim.wasm builds predate launch pads. Flat f64
   *  array, 6 per pad: [x, y, w, h, impulse_x, impulse_y]. */
  world_state_set_launch_pads?: (pads_ptr: number, count: number) => number;
  /** Optional — older sim.wasm builds predate slopes. Flat f64 array,
   *  7 per slope (deriveSlopeStatics bits):
   *  [span_min_x, span_max_x, base_x, base_y, dy_dx, tx, ty]. */
  world_state_set_slopes?: (slopes_ptr: number, count: number) => number;
  /** Optional — older sim.wasm builds predate spawn points (Track Z0b
   *  Item A). Flat f64 array, 2 per point: [x, y], map.spawns order. */
  world_state_set_spawn_points?: (points_ptr: number, count: number) => number;
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
 *   5. writeTargetScoreIntoMemory() — match win-target, patched after
 *      pack because packWorldState always writes 0 for target_score
 *      (Track Z0a / 02b74f5 fix — the export existed but was never
 *      called anywhere, so match-end detection and the sudden-death
 *      trigger were both permanently inert).
 *   6. writeScoresIntoMemory(state) — per-player score, patched after
 *      pack because packPlayer always writes 0 (Track Z0a / 02b74f5
 *      fix — this call was missing entirely before, silently resetting
 *      every player's score to 0 every tick and permanently breaking
 *      match-end detection + the sudden-death trigger).
 *   7. writePlayerInputsFromGlobal() — current_keys / prev_keys / aim
 *      patched after pack. Without this, prediction runs on stale
 *      keys → "stuttery laggy" symptom (commit 4a73635).
 *   8. ex.step_world(statePtr, dt_ms).
 *   9. unpack(state) → fresh TS WorldState bytes.
 *  10. mergeUnpacked → identity-stable merge with prior `state`.
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
  writeTargetScoreIntoMemory();
  writeScoresIntoMemory(state);
  writeLoadoutsIntoMemory(state);
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
      // Zig decides the sudden-death trigger at the countdown → fighting
      // transition (Track Z0a / 02b74f5) — mirror its verdict out, including
      // the explicit-undefined clear (matches round.ts's optional-field
      // convention).
      suddenDeathActive: unpacked.round.suddenDeathActive,
      // First-blood wager (Track Z0d): Zig owns the claim on this path
      // (section-4 ranged-hit award sites + its round machine's clears) —
      // mirror the verdict out, including the explicit-undefined clear
      // (round.ts optional-field convention, same as suddenDeathActive).
      firstBloodPlayerId: unpacked.round.firstBloodPlayerId,
      scores: { ...state.round.scores, ...unpacked.scores },
      // Kill tally REPLACES rather than spread-merges (unlike scores,
      // which are match-monotonic): the tally resets every round, so
      // stale prior-round entries must not survive the merge.
      roundKills: unpacked.roundKills,
    },
    players: stableMergeRecord(
      state.players,
      preservePlayerCards(state.players, unpacked.players),
    ),
    firePatches: stableMergeRecord(state.firePatches, unpacked.firePatches),
    destructibles: stableMergeRecord(
      state.destructibles,
      unpacked.destructibles,
    ),
    projectiles: stableMergeRecord(state.projectiles, unpacked.projectiles),
    satellites: stableMergeRecord(state.satellites, unpacked.satellites),
    pickups: stableMergeRecord(state.pickups, unpacked.pickups),
    // Zig's movement memory rides the state object between packs (Track
    // Z0e) — REPLACED wholesale each tick (it's Zig's own post-step
    // truth, keyed by id; a spread-merge would resurrect departed
    // players' slots). No stableMergeRecord: nothing renders from it, so
    // referential churn costs nothing.
    movementMemory: unpacked.movementMemory,
    // Same contract for the melee swing FSM (Track Z1a — Z0e's sibling):
    // without this, the next pack resets every swing to idle and melee
    // can never mature past windup on the wasm path.
    meleeSwingMemory: unpacked.meleeSwingMemory,
  };
}

/**
 * Re-seat the HOST's own card ids onto each unpacked player (Track Z1b).
 * The pack encodes `cards` count-only (real ids never cross the ABI), so
 * unpackPlayer returns placeholder empty strings — and before this helper
 * the merge REPLACED every stepped player's hand with those placeholders,
 * destroying the real card ids one tick after any wasm step. The very
 * next tick's build resolution (`resolveFireConfigsViaZig` reads
 * `state.players[..].cards`) then saw an empty hand: bare starter pistol,
 * no equipped actives, broken draft uniqueness gates. Cards are host-owned
 * roster data on this path (Zig only ever reads the index-mapped copy the
 * host writes per tick), so the prior TS hand is authoritative here.
 */
function preservePlayerCards(
  prev: WorldState["players"],
  next: WorldState["players"],
): WorldState["players"] {
  const out = {} as WorldState["players"];
  for (const k in next) {
    const pid = k as keyof WorldState["players"];
    const prior = prev[pid];
    out[pid] = prior ? { ...next[pid]!, cards: prior.cards } : next[pid]!;
  }
  return out;
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
/**
 * Patch each player's score (state.round.scores[p.id] ?? 0) into the
 * packed WorldState in linear memory. Track Z0a port of orphaned-branch
 * commit 02b74f5 — genuinely missing before this: packPlayer's own comment
 * said score is "populated by patcher per pack-callsite," but no such
 * patcher existed anywhere on main. Every call to packWorldState hardcodes
 * score to 0, so without this, step_world's own score-incrementing logic
 * (state.players[i].score += 1 on a round win) got silently WIPED by the
 * very next tick's pack — permanently breaking match-end detection
 * (target_score comparisons never trigger) and the sudden-death trigger
 * (reads player scores) for the entire lifetime of a match. Must be called
 * AFTER the base pack (heap.set(buf, statePtr)) and BEFORE step_world.
 */
export function writeScoresIntoMemory(state: WorldState): void {
  if (!cachedSim || !cachedEx) return;
  const sim = cachedSim;
  const ex = cachedEx;
  const view = new DataView(ex.memory.buffer);
  const playersStart = sim.statePtr + HEADER_SIZE + 8;
  // PlayerEntity.score offset within the 632-byte entity — the same
  // constant unpackWorldState's score-extraction loop reads (worldState-
  // Bridge.ts: "PlayerEntity score is at offset 276"), directly after
  // current_keys/prev_keys at +268/+272 (see writePlayerInputsIntoMemory).
  const SCORE_OFF = 276;
  // Sort MUST match packWorldState's player ordering (localeCompare) so
  // index i here lands on the same entity slot packPlayer wrote.
  const sortedIds = Object.keys(state.players).sort((a, b) =>
    a.localeCompare(b),
  );
  for (let i = 0; i < sortedIds.length; i++) {
    const pid = sortedIds[i]! as PlayerId;
    const score = state.round.scores?.[pid] ?? 0;
    const playerOff = playersStart + i * PLAYER_ENTITY_SIZE;
    view.setUint32(playerOff + SCORE_OFF, score >>> 0, true);
  }
}

/**
 * Resolve + write per-player loadouts (fire config + card hand + the
 * EquippedActives rack) AFTER the pack and before step_world (Track Z1b
 * findings (b)+(c)): the pack's `heap.set` overwrites the ENTIRE
 * WorldState image including the loadout parallel arrays, so the old call
 * order — wasmStepStrategy/World.ts writing fire configs BEFORE the step
 * call whose pack then wiped them — delivered builds that step_world
 * never saw. All-starter-pistol harnesses masked it (`valid=0` falls back
 * to the starter pistol); carded clients on ?wasm-world=2 lost their
 * builds, and no ability was castable at all (the rack read empty every
 * tick). The server host (serverWasmHost.step) always had this ordering
 * right — this brings the client step into line, and centralising it
 * INSIDE the step means no future call site can get the order wrong.
 */
function writeLoadoutsIntoMemory(state: WorldState): void {
  if (!cachedSim || !cachedEx) return;
  const ex = cachedEx as unknown as FireConfigResolverExports & {
    resolve_player_fire_config?: unknown;
  };
  if (typeof ex.resolve_player_fire_config !== "function") return;
  resolveFireConfigsViaZig(ex, cachedSim.statePtr, state);
}

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
  const playersStart = sim.statePtr + HEADER_SIZE + 8;
  // PLAYER_ENTITY_SIZE / HEADER_SIZE now imported from worldStateBridge.ts
  // (2026-07-18) — this used to shadow-declare local copies (same bug
  // fixed in the server's serverWasmHost.ts twin of this function); a
  // stale local copy would have silently corrupted every player's input
  // write past index 0 the moment the shared constants grew (288 → 296 →
  // ... → 512 for PLAYER_ENTITY_SIZE, 48 → 56 for HEADER_SIZE).
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
 * Test-/seam-exposed accessors for the legacy module-level cache.
 * Called by WasmHost to write fire configs directly into wasm
 * memory at the canonical offset (no extra delegation hop).
 *
 * These are NOT part of the public API; the underscore prefix
 * marks them as "internal seam glue, will be deleted once
 * WasmHost owns the wasm instance directly in B-final".
 */
export function __getCachedSim(): Sim | null {
  return cachedSim;
}
export function __getCachedEx(): WorldExports | null {
  return cachedEx;
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

/**
 * Module-level cache of the static AABB layout. The shim writes
 * these into wasm memory via world_state_set_statics after every
 * pack so step_world's stepPlayer + step_projectile_v2 see the
 * full terrain. Without this, players fall through every
 * platform when running ?wasm-world=2.
 */
type StaticAABB = { x: number; y: number; w: number; h: number };
let cachedStatics: { aabbs: StaticAABB[]; oneWay: number[] } | null = null;
let cachedArenaBounds:
  | { ceilingY: number; hasCeiling: number; killPlaneY: number }
  | null = null;

/**
 * Cache the ceiling-clamp + void kill-plane bounds for this match (World.ts
 * createRuntime calls this after the map loads). Applied to wasm module state
 * each tick alongside the statics so step_world's ceiling clamp + void kill
 * match the TS orchestrator.
 */
export function setWorldArenaBounds(
  ceilingY: number | null,
  killPlaneY: number,
): void {
  cachedArenaBounds = {
    ceilingY: ceilingY ?? 0,
    hasCeiling: ceilingY === null ? 0 : 1,
    killPlaneY,
  };
}

/**
 * Cache the arena's raw width/height (map.size — Track Z0b Item C). The
 * Zig export existed unwired since Phase 4c; the shrink-zone storm's
 * center/half-diagonal math now consumes it (fail-closed: unset size =
 * inert storm). Applied each step alongside the arena bounds.
 */
let cachedArenaSize: { x: number; y: number } | null = null;

export function setWorldArenaSize(width: number, height: number): void {
  cachedArenaSize = { x: width, y: height };
}

let cachedTargetScore: number | null = null;

/**
 * Cache the match's target_score. Track Z0a port of orphaned-branch commit
 * 02b74f5 — genuinely missing before this: world_state_set_target_score
 * existed as an export but nothing ever called it, AND even a one-off call
 * gets silently wiped by the very next tick's pack (packWorldState
 * hardcodes target_score to 0, same bug class as scores — see
 * writeScoresIntoMemory). Without this, both match-end detection and the
 * sudden-death trigger (which reads target_score) are permanently inert in
 * the full step_world path. Cached-and-reapplied-every-tick, the same
 * pattern as setWorldArenaBounds. NOTE: not yet wired from the client's
 * production ?wasm-world=2 path (the branch never wired it either — server
 * matchHost is the authority that sets it); tests call it directly.
 */
export function setWorldTargetScore(target: number): void {
  cachedTargetScore = target;
}

function writeTargetScoreIntoMemory(): void {
  if (cachedTargetScore === null || !cachedSim || !cachedEx) return;
  cachedEx.world_state_set_target_score(cachedSim.statePtr, cachedTargetScore);
}

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

/**
 * Cache the map's static launch pads (same cadence as setWorldStatics —
 * World.ts syncWorldStaticsToWasm). Written into the wasm module's
 * module-level pad array (world.zig §8c) alongside the statics each step.
 * Array order = map.launchPads order = event entity_id on both sides.
 */
let cachedLaunchPads: LaunchPadDefinition[] | null = null;

export function setWorldLaunchPads(
  pads: ReadonlyArray<LaunchPadDefinition>,
): void {
  cachedLaunchPads = pads.slice();
}

/**
 * Cache the map's true slopes as PRE-DERIVED statics (collision.ts
 * deriveSlopeStatics — the single derivation site, so the f64 bits that
 * reach wasm are identical to the ones the TS slope pass reads). Same
 * cadence as setWorldStatics (World.ts syncWorldStaticsToWasm); written
 * into the wasm module's module-level slope array (player.zig) alongside
 * the statics each step. An empty array clears.
 */
let cachedSlopes: SlopeStatic[] | null = null;

export function setWorldSlopes(slopes: ReadonlyArray<SlopeStatic>): void {
  cachedSlopes = slopes.slice();
}

/**
 * Cache the map's spawn points (Track Z0b Item A — the Zig mirror of
 * World.ts assignSpawnPoints needs the same point list to seat mid-round
 * fast respawns + round-boundary respawns identically). Same cadence as
 * setWorldStatics (World.ts syncWorldStaticsToWasm); written into the wasm
 * module's module-level spawn array (world.zig) alongside the statics each
 * step. Point order MUST be `map.spawns` order — the assignment's
 * strict-`>` best-score tiebreak makes order load-bearing. Callers are
 * responsible for TS's own no-spawns fallback (`spawns.length > 0 ?
 * spawns : [map center]`) — world.zig has no map size to derive it.
 */
let cachedSpawnPoints: { x: number; y: number }[] | null = null;

export function setWorldSpawnPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
): void {
  cachedSpawnPoints = points.map((p) => ({ x: p.x, y: p.y }));
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
  if (cachedArenaBounds) {
    ex.world_state_set_arena_bounds(
      cachedArenaBounds.ceilingY,
      cachedArenaBounds.hasCeiling,
      cachedArenaBounds.killPlaneY,
    );
  }
  if (cachedArenaSize && typeof ex.world_state_set_arena_size === "function") {
    ex.world_state_set_arena_size(cachedArenaSize.x, cachedArenaSize.y);
  }
  // Launch pads (world.zig §8c). Scratch sits past the max statics region
  // (256×32 AABB + 256 one_way = 8448 bytes, 8-aligned) so the two writes
  // can never trample each other. 6 f64 per pad, order = map order.
  if (cachedLaunchPads && typeof ex.world_state_set_launch_pads === "function") {
    const padScratchPtr = scratchPtr + 256 * AABB_SIZE_BYTES + 256;
    const padView = new DataView(ex.memory.buffer, padScratchPtr);
    const padCount = Math.min(cachedLaunchPads.length, 16);
    for (let i = 0; i < padCount; i++) {
      const pad = cachedLaunchPads[i]!;
      padView.setFloat64(i * 48 + 0, pad.position.x, true);
      padView.setFloat64(i * 48 + 8, pad.position.y, true);
      padView.setFloat64(i * 48 + 16, pad.size.x, true);
      padView.setFloat64(i * 48 + 24, pad.size.y, true);
      padView.setFloat64(i * 48 + 32, pad.impulse.x, true);
      padView.setFloat64(i * 48 + 40, pad.impulse.y, true);
    }
    ex.world_state_set_launch_pads(padScratchPtr, padCount);
  }
  // True slopes (player.zig module-level statics). Scratch sits past the
  // pad region (16×48 = 768 bytes) so statics/pads/slopes never trample
  // each other. 7 f64 per slope, order = map order. Always written when
  // the cache is set — count 0 clears the previous match's slopes.
  if (cachedSlopes && typeof ex.world_state_set_slopes === "function") {
    const slopeScratchPtr = scratchPtr + 256 * AABB_SIZE_BYTES + 256 + 16 * 48;
    const slopeView = new DataView(ex.memory.buffer, slopeScratchPtr);
    const slopeCount = Math.min(cachedSlopes.length, MAX_SLOPES);
    for (let i = 0; i < slopeCount; i++) {
      const s = cachedSlopes[i]!;
      slopeView.setFloat64(i * 56 + 0, s.spanMinX, true);
      slopeView.setFloat64(i * 56 + 8, s.spanMaxX, true);
      slopeView.setFloat64(i * 56 + 16, s.baseX, true);
      slopeView.setFloat64(i * 56 + 24, s.baseY, true);
      slopeView.setFloat64(i * 56 + 32, s.dyDx, true);
      slopeView.setFloat64(i * 56 + 40, s.tx, true);
      slopeView.setFloat64(i * 56 + 48, s.ty, true);
    }
    ex.world_state_set_slopes(slopeScratchPtr, slopeCount);
  }
  // Spawn points (world.zig, Track Z0b Item A). Scratch sits past the max
  // slope region (32×56 = 1792 bytes) so statics/pads/slopes/spawns never
  // trample each other. 2 f64 per point, order = map.spawns order. Always
  // written when the cache is set — count 0 clears (Zig then falls back to
  // respawn-in-place; see world.zig's assignedSpawnPoint fail-safe note).
  if (
    cachedSpawnPoints &&
    typeof ex.world_state_set_spawn_points === "function"
  ) {
    const spawnScratchPtr =
      scratchPtr + 256 * AABB_SIZE_BYTES + 256 + 16 * 48 + MAX_SLOPES * 56;
    const spawnView = new DataView(ex.memory.buffer, spawnScratchPtr);
    const spawnCount = Math.min(cachedSpawnPoints.length, 16);
    for (let i = 0; i < spawnCount; i++) {
      const p = cachedSpawnPoints[i]!;
      spawnView.setFloat64(i * 16 + 0, p.x, true);
      spawnView.setFloat64(i * 16 + 8, p.y, true);
    }
    ex.world_state_set_spawn_points(spawnScratchPtr, spawnCount);
  }
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
