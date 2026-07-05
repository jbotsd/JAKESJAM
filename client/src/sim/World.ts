// ───────────────────────────────────────────────────────────────────────────
// MOTHBALLED — the B3 cutover shipped: `sim/src/world.zig` (step_world) is the
// AUTHORITATIVE orchestrator on both client (default prediction) and server
// (USE_WASM_STEP_WORLD=1). `stepWithRuntime` below is retained ONLY as:
//   1. the emergency TS fallback (?wasm-world=off + server flag unset), and
//   2. the parity REFERENCE the wasm-parity tests diff Zig against.
// DO NOT add gameplay here expecting it to run in production — it won't. New
// sim behaviour lands in `sim/src/*.zig`. If you change this file to keep the
// parity oracle honest, mirror the exact change into world.zig in the same PR.
// (Drafting is the one live TS path: a host-side overlay in matchHost, since
//  the card pool stays TS — see jakesjam-drafting-host-overlay memory.)
// Source of truth: docs/adr/0006-zig-wasm-sim-substrate.md, docs/zig-wasm-conversion-status.md
// ───────────────────────────────────────────────────────────────────────────
//
// Real World implementation. Replaces the no-op stub. Orchestrates per-player
// movement + weapon fire, projectile flight, hit detection, damage, round
// state machine. Pure given (state, inputs, dt, rngState).
//
// Authority on the Bun server. Replayed on the client for prediction.

import { getChaosProfile, type ChaosModifierId } from "./data/chaosModifiers.js";
import {
  JETPACK_MAX_FUEL,
  KILL_PLANE_MARGIN_PX,
  type PlayerMovementMemory,
} from "./player.js";
import {
  buildStaticCache,
  platformToAABB,
  type StaticCollisionCache,
} from "./collision.js";
import {
  EntityId,
  PlayerId,
  Tick,
  InputSeq,
} from "./types.js";
import { RoundOrchestrator } from "./RoundOrchestrator.js";
import { wasmHost } from "./wasm/wasmHost.js";
import { writeFireConfigsForState } from "./wasm/writeFireConfigs.js";
import { convertWasmEventsToTs } from "./wasm/convertWasmEvents.js";
import type {
  InputBitfield,
  InputFrame,
  MapDefinition,
  PlayerSpawnInfo,
  StepResult,
  Vec2,
  WorldState,
} from "./types.js";

/**
 * Deterministic spawn assignment — greedy max-spread over the map's spawn
 * points. Players are placed one at a time (in a STABLE id-sorted order so
 * client prediction and server authority agree), each at the spawn point
 * that is farthest from everyone already placed, preferring unused points.
 *
 * This replaces the old `spawns[index % length]`, which had two failures:
 *   1. With more players than spawn points it STACKED players on identical
 *      coordinates (telefrag on the always-on world once bots + joiners
 *      exceeded 4).
 *   2. Every player respawned at the SAME fixed point every round — free
 *      information for a spawn-camper.
 * Pure + order-stable → parity-safe (no Math.random, no wall clock).
 */
export function assignSpawnPoints(
  map: MapDefinition,
  orderedIds: readonly string[],
): Map<string, Vec2> {
  const points: Vec2[] =
    map.spawns.length > 0 ? map.spawns : [{ x: map.size.x / 2, y: map.size.y / 2 }];
  const ids = [...orderedIds].sort();
  const result = new Map<string, Vec2>();
  const placed: Vec2[] = [];
  for (const id of ids) {
    let best = points[0]!;
    let bestScore = -Infinity;
    for (const p of points) {
      let minD = Infinity;
      for (const q of placed) minD = Math.min(minD, Math.hypot(p.x - q.x, p.y - q.y));
      const used = placed.some((q) => q.x === p.x && q.y === p.y);
      // Unused points always beat reused ones; among equals, maximise the
      // distance to the nearest already-placed player.
      const score = (used ? 0 : 1e7) + (minD === Infinity ? 2e7 : minD);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    result.set(id, best);
    placed.push(best);
  }
  return result;
}

/**
 * Per-tick scratch state the WorldState doesn't carry. The host (server or
 * client during prediction) keeps this separate so step() stays pure relative
 * to its inputs.
 */
export type WorldRuntime = {
  /** Last input bitfield seen per player, for edge detection (jump pressed etc.) */
  prevKeys: Map<PlayerId, InputBitfield>;
  /** Movement memory per player (coyote, jump buffer, etc.) */
  movement: Map<PlayerId, PlayerMovementMemory>;
  /** Monotonic entity id allocator. */
  nextEntityId: number;
  /** Cached map (platforms etc.) for the current match. */
  map: MapDefinition;
  /** Pre-computed collision cache — spatial grid + one-way flags. Built
   *  once at runtime creation and reused for the match lifetime.
   *  Always populated by createRuntime (post-H2; the brute-force fallback
   *  was deleted, so the cache is the only collision path). */
  collisionCache: StaticCollisionCache;
  /**
   * Round state orchestrator. Owns the running RoundState and routes it
   * through the pure stepRound each tick. Initialised on createRuntime;
   * synced from snapshots on the client side.
   */
  orchestrator?: RoundOrchestrator;
  /**
   * Per-tick scratch storage. Hoisted out of stepWithRuntime so the same
   * buffers are reused every tick instead of allocating fresh — the
   * `Object.keys().map().sort()` and `new Set()` patterns showed up as
   * dominant per-tick allocations in the game-loop-perf audit.
   */
  scratchSortedProjectileIds: EntityId[];
  /** Projectiles parried this tick → the player who parried them (so a
   *  reflective parry can hand the shard back with reversed velocity). */
  scratchDeflectedProjectiles: Map<EntityId, PlayerId>;
  /** Y of the ceiling's underside (bottom edge of the top wall), or null if the
   *  map has no ceiling. Players are clamped below this each tick so a fast
   *  wall-jump into the wall/ceiling corner can't tunnel them ONTO the roof. */
  ceilingClampY: number | null;
};

/** Underside of the map's ceiling (a wide solid wall whose top sits at the map
 *  top). null when there's no such platform (open-top map). */
function computeCeilingClampY(map: MapDefinition): number | null {
  let bottom: number | null = null;
  for (const p of map.platforms) {
    const top = p.position.y - p.size.y / 2;
    const isCeiling = p.kind === "wall" && p.size.x >= map.size.x * 0.5 && top <= 8;
    if (isCeiling) {
      const b = p.position.y + p.size.y / 2;
      bottom = bottom === null ? b : Math.max(bottom, b);
    }
  }
  return bottom;
}

export function createRuntime(map: MapDefinition): WorldRuntime {
  const runtime: WorldRuntime = {
    prevKeys: new Map(),
    movement: new Map(),
    nextEntityId: 1,
    map,
    // Always build a cache, even for stub maps. An empty cache (no
    // platforms) is fine — the swept resolve gracefully reports "no hit"
    // and the player falls into the void. The previous `undefined`
    // fallback drove a separate brute-force collision path that didn't
    // support one-way platforms, so we collapse to one path here (H2).
    collisionCache: buildStaticCache(
      map.platforms,
      Math.max(1, map.size.x),
      Math.max(1, map.size.y),
    ),
    scratchSortedProjectileIds: [],
    scratchDeflectedProjectiles: new Map(),
    ceilingClampY: computeCeilingClampY(map),
  };
  // Side effect: pre-load the wasm static-AABB cache so the
  // J0/J1 shim's stepPlayer has terrain to collide with. No-op
  // if the wasm backend isn't ready yet — main.ts's preload
  // pre-fills it on completion.
  syncWorldStaticsToWasm(map);
  return runtime;
}

/**
 * Sync the static-AABB cache into the wasm orchestrator (Phase
 * A1b: now goes through `WasmHost`). The host owns the
 * pre-ready buffering; callers can fire this at any tick without
 * worrying about boot order.
 */
export function syncWorldStaticsToWasm(map: MapDefinition): void {
  const aabbs = map.platforms.map(platformToAABB);
  // Platform kind: 'floor' | 'wall' | 'platform'. Only 'platform'
  // is one-way (jump-up-through). 'floor' + 'wall' are solid.
  const oneWay = map.platforms.map((p) => (p.kind === "platform" ? 1 : 0));
  wasmHost.setStatics(aabbs, oneWay);
  // Ceiling clamp + void kill-plane bounds for the Zig orchestrator — same
  // formulas the TS tick uses (computeCeilingClampY + map.size.y + margin).
  wasmHost.setArenaBounds(
    computeCeilingClampY(map),
    map.size.y > 0 ? map.size.y + KILL_PLANE_MARGIN_PX : 0,
  );
}

/**
 * Re-export of `wasmHost.preload().then(...)` flush as a no-op
 * compat shim. Kept so `main.ts` (which still calls this) compiles
 * unchanged in A1b; the actual flush happens automatically inside
 * `wasmHost.setStatics` (it mirrors to the legacy backend, which
 * publishes once preload completes).
 *
 * A2 deletes this function and updates the lone caller.
 */
export function flushPendingStaticsToWasm(): void {
  // `wasmHost.setStatics` already keeps a buffered copy + mirrors
  // to the legacy `setWorldStatics`. The flush is implicit.
}

export class World {
  /**
   * Build a starting WorldState. `runtime` should be created via createRuntime
   * with the same map and held alongside the state by the caller.
   */
  static create(
    map: MapDefinition,
    players: PlayerSpawnInfo[],
    rngSeed: number,
    chaosModifierIds?: readonly string[],
  ): WorldState {
    let nextEntityId: EntityId = EntityId(1);
    const playerEntities: WorldState["players"] = {};
    const scores: WorldState["round"]["scores"] = {};

    const spawnAssignment = assignSpawnPoints(
      map,
      players.map((p) => p.playerId as string),
    );
    for (const [index, spawn] of players.entries()) {
      void index;
      const spawnPoint = spawnAssignment.get(spawn.playerId as string) ?? { x: 0, y: 0 };
      playerEntities[spawn.playerId] = {
        id: spawn.playerId,
        characterId: spawn.characterId,
        x: spawnPoint.x,
        y: spawnPoint.y,
        vx: 0,
        vy: 0,
        aimX: spawnPoint.x + 160,
        aimY: spawnPoint.y,
        health: 100,
        shieldActive: false,
        crouching: false,
        alive: true,
        weaponId: spawn.weaponId,
        cards: [],
        fireCooldownMs: 0,
        ammo: 0,
        abilityCharge: 0,
        lastProcessedInputSeq: InputSeq(0),
        jetpackFuel: JETPACK_MAX_FUEL,
      };
      scores[spawn.playerId] = 0;
    }

    const destructibles: WorldState["destructibles"] = {};
    for (const object of map.destructibles ?? []) {
      const id = nextEntityId;
      nextEntityId = EntityId(nextEntityId + 1);
      destructibles[id] = {
        id,
        kind: object.kind,
        x: object.position.x,
        y: object.position.y,
        width: object.size.x,
        height: object.size.y,
        health: object.health,
        explosive: object.explosive,
        flammable: object.flammable,
      };
    }

    const pickups: WorldState["pickups"] = {};
    for (const pickup of map.pickups ?? []) {
      const id = nextEntityId;
      nextEntityId = EntityId(nextEntityId + 1);
      pickups[id] = {
        id,
        kind: pickup.kind,
        x: pickup.position.x,
        y: pickup.position.y,
        radius: pickup.radius,
        amount: pickup.amount,
        active: true,
        respawnAtTick: Tick(0),
        durationMs: pickup.durationMs,
        respawnMs: pickup.respawnMs,
      };
    }

    const chaos: string[] | undefined =
      chaosModifierIds && chaosModifierIds.length > 0
        ? [...chaosModifierIds]
        : undefined;
    const chaosProfile = getChaosProfile(chaos as ChaosModifierId[] | undefined);

    return {
      tick: Tick(0),
      rngState: rngSeed >>> 0,
      players: playerEntities,
      projectiles: {},
      destructibles,
      firePatches: {},
      pickups,
      satellites: {},
      round: {
        phase: "countdown",
        countdownRemainingMs: 3000,
        scores,
        roundIndex: 0,
        winnerPlayerId: null,
      },
      chaosModifierIds: chaos,
      // Initialise the fire-hazard accumulator only when the modifier is
      // actually active; saves a field on every snapshot for the common case.
      fireHazardTimerMs: chaosProfile.fireHazardActive ? 0 : undefined,
    };
  }

  /**
   * No-runtime convenience wrapper for tests and one-off ticks. Allocates a
   * fresh runtime each call, so movement memory and entity ids don't persist.
   * Real callers should use stepWithRuntime.
   */
  static step(
    state: WorldState,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
    dtMs: number,
  ): StepResult {
    const runtime = createRuntime({
      id: "stub",
      name: "stub",
      size: { x: 0, y: 0 },
      spawns: [],
      platforms: [],
    });
    runtime.nextEntityId = nextIdSeed(state);
    return stepWithRuntime(state, runtime, inputsByPlayer, dtMs);
  }
}

function nextIdSeed(state: WorldState): number {
  let max = 0;
  for (const id of Object.keys(state.projectiles)) max = Math.max(max, Number(id));
  for (const id of Object.keys(state.destructibles)) max = Math.max(max, Number(id));
  for (const id of Object.keys(state.pickups)) max = Math.max(max, Number(id));
  for (const id of Object.keys(state.satellites ?? {})) max = Math.max(max, Number(id));
  for (const id of Object.keys(state.firePatches ?? {})) max = Math.max(max, Number(id));
  return max + 1;
}

/**
 * Authoritative tick. Processes inputs, advances all entities, runs collisions,
 * advances round state. Returns the next world state and any discrete events.
 */
export function stepWithRuntime(
  state: WorldState,
  runtime: WorldRuntime,
  inputsByPlayer: Record<PlayerId, InputFrame | null>,
  dtMs: number,
): StepResult {
  // 100% Zig: client prediction runs the wasm sim (same as server authority).
  // Return its result directly. If the wasm backend isn't ready yet (boot), skip
  // this tick — the TS orchestrator below is DEAD (retained only until the file
  // is trimmed) and must never run in production.
  const wasmActual = maybeWasmActual(state, dtMs, inputsByPlayer, runtime);
  if (wasmActual) return wasmActual;
  return { state, events: [], matchComplete: false };
}

function maybeWasmActual(
  inputState: WorldState,
  dtMs: number,
  inputsByPlayer: Record<PlayerId, InputFrame | null>,
  runtime: WorldRuntime,
): StepResult | null {
  const loc = (globalThis as { location?: { search: string } }).location;
  if (!loc) return null;
  let mode = "";
  try {
    mode = new URLSearchParams(loc.search).get("wasm-world") ?? "";
  } catch {
    return null;
  }
  // B3 CUTOVER — the Zig orchestrator is now the DEFAULT prediction path.
  //
  // The 2026-07-03 gate held it opt-in only because the SERVER still ran the
  // TS orchestrator (USE_WASM_STEP_WORLD OFF) — client-predict-Zig against
  // server-authority-TS produced reconcile churn. That prerequisite is now
  // met: serverWasmHost writes the SAME statics + resolved card configs +
  // arena bounds as the client (shared fireConfigShared), so with the server
  // flag set both sides run byte-identical world.zig. The migration closed the
  // orchestrator gaps that diverged in May (round machine, augments, shield,
  // ceiling/void) and the shared substrate was always bit-identical.
  //
  // Deploy is coordinated: this client default pairs with the server's
  // USE_WASM_STEP_WORLD=1. Dev-only TS fallback: ?wasm-world=off (ONLY valid
  // when the server also runs TS, i.e. USE_WASM_STEP_WORLD unset — otherwise
  // prediction would disagree with authority).
  if (mode === "off") return null;
  type WasmEvent = {
    kind: number;
    playerIdxA: number;
    playerIdxB: number;
    entityId: number;
    scalar: number;
    x: number;
    y: number;
  };
  type WB = {
    isWasmWorldReady(): boolean;
    applyWasmWorldStepFullSync(
      s: WorldState,
      dt: number,
    ): { state: WorldState; events: WasmEvent[]; matchComplete: boolean };
    writePlayerInputsIntoMemory(
      m: Map<
        string,
        { keys: number; prevKeys: number; aimX: number; aimY: number }
      >,
    ): void;
  };
  const wb = (globalThis as { __jakesjam_wasm_backend__?: WB })
    .__jakesjam_wasm_backend__;
  if (!wb || !wb.isWasmWorldReady()) return null;
  try {
    // Build per-player keys map. The pack runs INSIDE
    // applyWasmWorldStepFullSync, so we need to patch keys AFTER
    // the pack — but we don't control the call order. Trick: stash
    // the inputs on globalThis right before, and the shim picks
    // them up after pack via a post-pack hook (next cut). Until
    // that lands, write keys directly to memory after the call's
    // pack has finished but before step_world runs by exposing a
    // new function patchWasmInputs(inputsMap).
    const inputsMap = new Map<
      string,
      { keys: number; prevKeys: number; aimX: number; aimY: number }
    >();
    for (const [pid, frame] of Object.entries(inputsByPlayer)) {
      if (!frame) continue;
      const prev = runtime.prevKeys.get(pid as PlayerId) ?? 0;
      inputsMap.set(pid, {
        keys: frame.keys,
        prevKeys: prev,
        aimX: frame.aimX,
        aimY: frame.aimY,
      });
    }
    // Phase A1b: Inputs go through `wasmHost.writeInputs` (which
    // owns the cache). The legacy `writePlayerInputsFromGlobal`
    // call inside the wasm shim still reads
    // `globalThis.__jakesjam_wasm_inputs__`, which `wasmHost`
    // mirrors for compat — A2 deletes the globalThis read.
    wasmHost.writeInputs(inputsMap);
    // Phase 97: resolve + write per-player fire configs so cards
    // finally apply. Without this every player fires bare starter
    // pistol regardless of their card hand. The helper holds an
    // internal per-player cache (re-resolved only when cards
    // change).
    writeFireConfigsForState(inputState);
    const result = wb.applyWasmWorldStepFullSync(inputState, dtMs);
    return {
      state: result.state,
      events: convertWasmEventsToTs(result.events, result.state),
      matchComplete: result.matchComplete,
    };
  } catch (err) {
    console.error("[wasm-world=2] step_world threw — falling back to TS", err);
    return null;
  }
}

// convertWasmEventsToTs moved to ./wasm/convertWasmEvents.ts (Phase 98).
// Re-export so existing call sites that imported from World.ts
// keep working until B-final cleans up the import paths.
export { convertWasmEventsToTs } from "./wasm/convertWasmEvents.js";


