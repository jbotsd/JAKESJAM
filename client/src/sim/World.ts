// ───────────────────────────────────────────────────────────────────────────
// The "MOTHBALLED" label below is stale/aspirational — a Zig `step_world`
// cutover exists (`sim/src/world.zig`) and CAN become authoritative, but only
// when the server is explicitly launched with `USE_WASM_STEP_WORLD=1`
// (matchHost.ts) — an opt-in nobody has flipped for the live host-public
// server. VERIFIED against the actual running process's environment
// (2026-07-08): `USE_WASM_STEP_WORLD` is unset there, so the switch defaults
// false and `stepWithRuntime` below (client prediction + server authority)
// IS what's actually running in production today. Only PLAYER MOVEMENT
// physics runs through Zig-wasm by default (see player.ts/player.zig +
// playerWasmBackend.ts) — weapon/combat/round/draft orchestration in THIS
// file is TS-authoritative and needs no Zig mirror to ship. If you flip
// USE_WASM_STEP_WORLD=1 for a real cutover, then yes, mirror changes here
// into world.zig too — but don't assume that's the live path without
// checking the actual server env first (this comment nearly sent a future
// session down the wrong path).
// Source of truth: docs/adr/0006-zig-wasm-sim-substrate.md, docs/zig-wasm-conversion-status.md
// ───────────────────────────────────────────────────────────────────────────
//
// Real World implementation. Replaces the no-op stub. Orchestrates per-player
// movement + weapon fire, projectile flight, hit detection, damage, round
// state machine. Pure given (state, inputs, dt, rngState).
//
// Authority on the Bun server. Replayed on the client for prediction.

import {
  getChaosProfile,
  type ChaosModifierId,
  type ChaosProfile,
} from "./data/chaosModifiers.js";
import {
  stepPlayer,
  freshPlayerMovementMemory,
  mirrorMovementMemoryOntoEntity,
  JETPACK_MAX_FUEL,
  KILL_PLANE_MARGIN_PX,
  DASH_RECOVERY_MS,
  PLAYER_BODY_WIDTH,
  PLAYER_BODY_HEIGHT,
  playerHitboxAABB,
  type PlayerMovementMemory,
} from "./player.js";
import { buildFireEntity, stepDestructibles } from "./destructible.js";
import { stepFirePatches } from "./fire.js";
import { stepSuddenDeathStorm } from "./suddenDeath.js";
import { clearExpiredBuffs, stepPickups } from "./pickup.js";
import { stepLaunchPads } from "./launchPad.js";
import {
  STOLEN_FANGS_MAX_CHARGES,
  STOLEN_FANGS_CHARGE_EXPIRY_MS,
  EMISSION_CHARGE_MAX,
  EMISSION_FILL_PER_DAMAGE_DEALT,
  EMISSION_FILL_PER_DAMAGE_TAKEN,
  ABILITY_STEP_RANGE_PX,
  ABILITY_COUNTER_RETURN_CAP,
  RESPAWN_DELAY_MS,
  GEO_FACET_BREAK_AMP_MULTIPLIER,
  GEO_FACET_BREAK_RANGE_PX,
  GEO_FACET_BREAK_CONE_RADIANS,
  GEO_PRISM_FAN_COUNT,
  GEO_PRISM_FAN_CONE_RADIANS,
  GEO_PRISM_FAN_DAMAGE_MULTIPLIER,
  GEO_LATTICE_COUNT,
  GEO_LATTICE_DAMAGE_MULTIPLIER,
  GEO_LATTICE_RANGE_PX,
  GEO_RETURN_GLASS_SHIELD_REFUND,
  GEO_SLIP_NODE_RANGE_PX,
  GEO_RECOIL_STEP_HOP_SPEED,
  RESONANCE_WINDOW_MS,
  RESONANCE_CD_REFUND_FRACTION,
} from "./constants.js";
import { stepProjectile, spawnProjectile, makeHitSweepScratch, fillHitSweepScratch, type HitSweepScratch } from "./projectile.js";
import {
  resolveEmission,
  EMISSION_BURN_CAP_MS,
  EMISSION_FREEZE_CAP_MS,
  EMISSION_WARD_DAMAGE_MULT,
  EMISSION_STRIDE_SURGE_MS,
} from "./data/emission.js";
import { CowRecord } from "./cowRecord.js";
import { nextFloat } from "./rng.js";
import { lutAtan2, lutCos, lutSin } from "./trig.js";
import {
  despawnSatellitesForDeadOwners,
  spawnMissingSatellites,
  stepSatellites,
} from "./satellite.js";
import { stepWeapon, resolvePlayerBuild } from "./weapon.js";
import { stepRound, FIRST_BLOOD_SPEED_MULTIPLIER } from "./round.js";
import { resolveModeConfig } from "./data/modeConfig.js";
import {
  tickShield,
  tryDeflectDamage,
  tryStartParry,
  SHIELD_MAX_CHARGE_DEFAULT,
  SHIELD_RECHARGE_PER_SECOND,
  PARRY_COOLDOWN_MS_DEFAULT,
  SHIELD_AIM_ARC_RADIANS,
} from "./combat.js";
import {
  buildStaticCache,
  platformToAABB,
  centerToAABB,
  aabbOverlap,
  type StaticCollisionCache,
} from "./collision.js";
import {
  EntityId,
  PlayerId,
  Tick,
  InputSeq,
} from "./types.js";
import { MAX_ABILITY_SLOTS, classIdForArchetype } from "./data/cardTypes.js";
import { RoundOrchestrator } from "./RoundOrchestrator.js";
import { wasmHost } from "./wasm/wasmHost.js";
import { writeFireConfigsForState } from "./wasm/writeFireConfigs.js";
import { convertWasmEventsToTs } from "./wasm/convertWasmEvents.js";
import type {
  FireEntity,
  InputBitfield,
  InputFrame,
  MapDefinition,
  PlayerEntity,
  PlayerSpawnInfo,
  ProjectileEntity,
  SatelliteEntity,
  SimEvent,
  StepResult,
  Vec2,
  WorldMode,
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

const FireBit = 1 << 6;
/** InputBit.Ability — the Emission cast (full charge) with legacy-parry
 *  fall-through below full (see the cast branch in stepWithRuntime). */
const AbilityBit = 1 << 7;
/** InputBit.Jump — read here only for the ninja wall-kick energy-grant
 *  detection (NINJA MELEE section); movement itself reads it inside
 *  stepPlayer via player.ts's own private `Bit.Jump`. */
const JumpBit = 1 << 4;

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
  /**
   * `'combat'` (default) or `'hangout'` (graceful-gliding-flame plan A1).
   * Host/client-local — deliberately NOT part of `WorldState`, so it needs
   * no wire-protocol/delta-snapshot change. See `stepWithRuntime` for the
   * gating this drives.
   */
  mode: WorldMode;
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
  /** Reused hit-sweep scratch for the projectile pass (see projectile.ts
   *  HitSweepScratch) — kills the per-projectile candidate-AABB allocation
   *  storm under heavy load. */
  scratchHitSweep: HitSweepScratch;
  /** Projectiles parried this tick → the player who parried them (so a
   *  reflective parry can hand the shard back with reversed velocity). */
  scratchDeflectedProjectiles: Map<EntityId, PlayerId>;
  /** Y of the ceiling's underside (bottom edge of the top wall), or null if the
   *  map has no ceiling. Players are clamped below this each tick so a fast
   *  wall-jump into the wall/ceiling corner can't tunnel them ONTO the roof. */
  ceilingClampY: number | null;
  /** Ninja melee swing FSM + dash-through/energy-grant debounce, per player.
   *  Host-only "off-wire truth" — same split as `movement`
   *  (PlayerMovementMemory): swing timing never touches WorldState, its
   *  wire-visible CONSEQUENCES (health/energy/events) are what reconcile.
   *  Only ninjas ever get an entry; other classes never touch this map. */
  melee: Map<PlayerId, NinjaMeleeMemory>;
};

/** 0 = idle/ready, 1 = windup (readable tell), 2 = active (hit-checked
 *  every tick), 3 = recovery (endlag — no re-swing). See the NINJA MELEE
 *  FSM comment above the SLASH_* constants. */
export type NinjaSlashPhase = 0 | 1 | 2 | 3;

/** Per-player ninja melee memory — the swing FSM's off-wire source of
 *  truth, plus dash-through per-burst debounce. Never wire-encoded (same
 *  reasoning as PlayerMovementMemory's dash counters): it's a deterministic
 *  function of replayed inputs, so client prediction and server authority
 *  agree without needing to sync the counters themselves — only the
 *  gameplay-visible consequences (health/energy/wave projectiles/events)
 *  are wire state and get corrected by ordinary reconciliation. */
export type NinjaMeleeMemory = {
  phase: NinjaSlashPhase;
  /** ms remaining in the current phase; irrelevant when phase === 0. */
  phaseMs: number;
  /** Swing direction captured at windup start (unit vector) — reused by
   *  both the arc hit-check and the wave's launch angle, so a swing you
   *  started facing one way doesn't "steer" mid-animation. */
  aimX: number;
  aimY: number;
  /** Victim ids already hit by the CURRENT swing's active window — the arc
   *  is hit-checked every tick while active (a target drifting in mid-
   *  window still gets hit), but each victim only takes the hit once. */
  hitThisSwing: Set<PlayerId>;
  /** Victim ids already dash-through-tagged during the CURRENT dash burst
   *  — cleared on the burst's rising edge so a body-cross fires once per
   *  dash per victim, not once per tick of overlap. */
  dashThroughTagged: Set<PlayerId>;
  /** Last tick's dashActiveMs > 0, to detect the dash burst's rising edge
   *  (for clearing dashThroughTagged) without reading movement memory's
   *  ms-precision timer directly. */
  wasDashing: boolean;
};

export function freshNinjaMeleeMemory(): NinjaMeleeMemory {
  return {
    phase: 0,
    phaseMs: 0,
    aimX: 1,
    aimY: 0,
    hitThisSwing: new Set(),
    dashThroughTagged: new Set(),
    wasDashing: false,
  };
}

/** Half the standing player body height (bodyHeight 56 / 2). Used for the
 *  ceiling clamp; crouching is shorter so clamping to the standing half is a
 *  safe over-estimate. */
const PLAYER_HALF_HEIGHT = 28;

// ── DASH BASH (the offensive half of the shield-dash) ─────────────────
// A dashing player is a moving shield (see the block in combat.tryDeflect
// Damage). Ram an enemy inside the shield's frontal arc and you BASH them:
// damage + a hard knockback along the lunge, and your own dash STOPS on
// impact — a lance charge, so exactly one bash per dash (no per-tick
// multi-hit). Contact radius is body-to-body plus a small reach.
const BASH_RANGE = 46; // px, centre-to-centre contact
const BASH_DAMAGE = 34; // a committed melee hit; bounded by dash cooldown + charges
const BASH_KNOCKBACK = 660; // px/s shove along the lunge direction
const BASH_KNOCK_UP = 240; // px/s upward pop so the victim is launched, not just slid
const BASH_ATTACKER_STOP = 0.22; // attacker keeps this fraction of velocity on impact

// ── NINJA MELEE (2026-07-18) — the dual-blade slash + wave-off-swing verb ──
// docs/classes-goal.md ninja chassis: "a melee arc that emits a short-range
// WAVE projectile off the swing... wave is aftermath of contact, not a free
// cast: spawns from a swing that had commit; short range; inherits swing
// direction." docs/character-sheets-v1.md tactile ability contract: "commit
// frames you can feel... contact first... energy from contact."
//
// FSM per ninja player (host-only, WorldRuntime.melee — see
// NinjaMeleeMemory below, same off-wire-truth/wire-mirror split as dash's
// PlayerMovementMemory): idle(0) --Fire rising edge--> windup(1)
// --SLASH_WINDUP_MS--> active(2) --SLASH_ACTIVE_MS, arc hit-checked every
// tick--> recovery(3) [wave spawns on this transition] --SLASH_RECOVERY_MS
// --> idle(0). Re-trigger only accepted from idle — "gate re-swinging
// during recovery" (task doctrine) is satisfied by construction (any Fire
// press while phase != 0 is simply not read as a new swing).
//
// Gated on classId === "ninja" (classIdForArchetype(player.characterId))
// EVERYWHERE below — zero cost, zero behavior change for the other three
// chassis (see ninjaMeleeGating.test.ts).

/** Melee arc reach (px, centre-to-centre). BASH_RANGE (46) is point-blank
 *  lance contact; a dual-blade sweep reaches further — ~1.7×, still
 *  unambiguously melee (compare WAVE_RANGE 260 / Echo Bolt 340). */
const SLASH_RANGE = 78;
/** Full cone width in front of the swing's captured aim direction (±50°).
 *  Wider than PARRY_ARC_RADIANS (60°, a flick) — a sword swing has to be
 *  more forgiving than a timed parry read — but narrower than the shield's
 *  120° wall, since this is a directional attack, not an omnidirectional
 *  guard. 100° = (5π)/9. */
const SLASH_ARC_RADIANS = (5 * Math.PI) / 9;
/** A landed arc hit. Lower than BASH_DAMAGE (34) because the swing cadence
 *  (~2.3/s, see the commit-frame constants below) is far higher than a
 *  dash-bash's (~0.33/s, gated by DASH_COOLDOWN_MS=3000) — per-hit damage is
 *  tuned down so sustained arc DPS (~51) lands in the same neighbourhood as
 *  bash's burst, not multiplies it. */
const SLASH_DAMAGE = 22;
/** Gentle shove + pop on a landed arc hit — "hit-stop + scrape... victim
 *  micro-knock" (character-sheets-v1.md), NOT a heavy bash-style launch. */
const SLASH_KNOCKBACK = 260;
const SLASH_KNOCK_UP = 60;

// Commit-frame structure (ms). "Commit frames you can feel" / "no free
// cast" — recovery IS the re-swing gate; there is no additional ability-
// style cooldown layered on top (this is the always-on chassis verb, not a
// card-gated active). Total cycle 430ms (~2.3 swings/sec cap) sits close to
// dash's own ~410ms burst+recovery rhythm (DASH_DURATION_MS 210 +
// DASH_RECOVERY_MS 200) — the whole kit reads at one cadence.
const SLASH_WINDUP_MS = 120; // the readable tell before the arc goes live
const SLASH_ACTIVE_MS = 90; // hit-checked every tick while true
const SLASH_RECOVERY_MS = 220; // endlag; whiffing costs

// Wave-off-swing (spawned via the existing spawnProjectile machinery so
// element/impact card modifiers compose onto it for free later — no
// bespoke per-category shape, per the emission-engine doctrine). Fires at
// the active→recovery transition REGARDLESS of whether the arc landed a
// hit (see the FSM comment above / the ninja-verb report for the doc-
// ambiguity resolution: "spawns from a swing that had commit" reads as
// swing-commit-gated, not hit-confirm-gated).
const WAVE_RANGE = 260; // px — short enough to read as "still in melee"
const WAVE_SPEED = 780; // px/s
const WAVE_LIFETIME_MS = Math.round((WAVE_RANGE / WAVE_SPEED) * 1000);
const WAVE_DAMAGE = 10; // lighter than the arc — the wave is the aftermath
const WAVE_RADIUS = 10; // a wide blade-wave, not a thin shard (default 7)

// Ninja class resource ("energy, fast regen, melee hits restore" — MANA
// section, classes-goal.md). v1 is pure plumbing: nothing SPENDS energy
// yet (no abilities/cards wired this pass — see report's fast-follow
// scope), only the regen sources the task calls out are implemented.
const NINJA_ENERGY_MAX = 100; // matches Deep Well's implied base (100→125)
/** Deliberately modest — "Energy from contact... never stood in stealth
 *  regen... passive regen while disengaged as the main loop" is an explicit
 *  FAIL STATE in the tactile contract table, so the passive trickle stays a
 *  minor top-up, not the primary loop. */
const NINJA_ENERGY_PASSIVE_REGEN_PER_SEC = 6;
const NINJA_ENERGY_ON_MELEE_HIT = 10;
/** Matches Slipstream's (fast-follow card) documented dash-through grant —
 *  adopted as the CHASSIS BASELINE rather than inventing a separate smaller
 *  number, since it's the only concrete figure either doc gives. Slipstream
 *  fast-follow work should confirm whether the card is meant to be additive
 *  on top of this or just adds the Read tag to what's already baseline. */
const NINJA_ENERGY_ON_DASH_THROUGH = 15;
/** Matches Slipstream's documented wall-kick grant — same baseline-adoption
 *  reasoning as dash-through above. */
const NINJA_ENERGY_ON_WALL_KICK = 12;

/**
 * Melee arc hit test — more rigorous than DASH BASH's plain centre-point
 * distance+angle check (canon: "arc hit detection vs player AABBs"), but
 * short of a full cone-vs-rectangle intersection: sample the victim's real
 * crouch-aware hitbox (playerHitboxAABB) at its 4 corners + centre, and hit
 * if ANY sampled point is within `range` of the origin AND within `halfArc`
 * of `aimAngle`. Cheap (5 point tests), deterministic, and meaningfully
 * more forgiving/accurate for a wide body than a single centre check —
 * a victim whose corner just pokes into the cone is a fair hit.
 */
function isBodyInMeleeArc(
  originX: number,
  originY: number,
  aimAngle: number,
  halfArc: number,
  range: number,
  victim: Pick<PlayerEntity, "x" | "y" | "crouching">,
): boolean {
  const box = playerHitboxAABB(victim);
  const points: Array<[number, number]> = [
    [victim.x, victim.y],
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ];
  for (const [px, py] of points) {
    const dx = px - originX;
    const dy = py - originY;
    const dist = Math.hypot(dx, dy);
    if (dist > range || dist < 1e-3) continue;
    let da = Math.atan2(dy, dx) - aimAngle;
    da = Math.atan2(Math.sin(da), Math.cos(da)); // normalize to [-π, π]
    if (Math.abs(da) <= halfArc) return true;
  }
  return false;
}

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

export function createRuntime(map: MapDefinition, mode: WorldMode = "combat"): WorldRuntime {
  const runtime: WorldRuntime = {
    prevKeys: new Map(),
    movement: new Map(),
    melee: new Map(),
    nextEntityId: 1,
    map,
    mode,
    // Always build a cache, even for stub maps. An empty cache (no
    // platforms) is fine — the swept resolve gracefully reports "no hit"
    // and the player falls into the void. The previous `undefined`
    // fallback drove a separate brute-force collision path that didn't
    // support one-way platforms, so we collapse to one path here (H2).
    collisionCache: buildStaticCache(
      map.platforms,
      Math.max(1, map.size.x),
      Math.max(1, map.size.y),
      // True slopes ride the collision cache into stepPlayer (both the TS
      // native pass and the wasm step_player backend, which re-packs the
      // cache — including slopes — per call). Prediction gets them for
      // free: clientLoop builds its runtime via this same createRuntime.
      map.slopes ?? [],
    ),
    scratchSortedProjectileIds: [],
    scratchHitSweep: makeHitSweepScratch(),
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
  // Launch pads — static map geometry, same host-set pattern as the arena
  // bounds (module-level in world.zig, zero WorldState bytes). Always
  // called (empty array clears the previous match's pads).
  wasmHost.setLaunchPads(map.launchPads ?? []);
  // True slopes — same module-level host-set pattern (player.zig). Always
  // called (empty array clears the previous match's slopes). Feeds the
  // step_world path; the step_player backend re-writes slopes per call
  // from the collision cache regardless.
  wasmHost.setSlopes(map.slopes ?? []);
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
    // Hangout mode (graceful-gliding-flame plan A1): players should be
    // moving from tick 0, not frozen through a combat countdown that never
    // resolves (stepWithRuntime never runs the round machine in hangout
    // mode — see the `hangoutMode` branch there). Purely additive: omitted
    // / `"combat"` keeps today's `countdown` start unchanged.
    mode: WorldMode = "combat",
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
        // Hangout mode starts already `"fighting"` — the round machine
        // never steps in this mode (stepWithRuntime's hangoutMode branch),
        // so there's no countdown/drafting phase to transition out of.
        phase: mode === "hangout" ? "fighting" : "countdown",
        countdownRemainingMs: mode === "hangout" ? 0 : 3000,
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
    runtime.nextEntityId = nextEntityIdSeed(state);
    return stepWithRuntime(state, runtime, inputsByPlayer, dtMs);
  }
}

/** Next entity id allocator seed from current world contents. */
export function nextEntityIdSeed(state: WorldState): number {
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
  const events: SimEvent[] = [];
  // Hangout mode (graceful-gliding-flame plan A1): pinned "fighting" so
  // stepPlayer runs every tick regardless of round.phase — World.create
  // already starts hangout matches at "fighting" and the round-step branch
  // below never transitions away from it, but this OR keeps movement alive
  // even if something upstream ever left round.phase stale for this mode.
  const hangoutMode = runtime.mode === "hangout";
  const fightingPhase = hangoutMode || state.round.phase === "fighting";
  // Drafting phase = rogue-lite card pick interlude between rounds. Players
  // freeze, projectiles stop integrating (so a shard still in flight as the
  // round ended doesn't drift across the picker UI), and pickup logic is
  // already gated on fightingPhase. Round timer keeps ticking via stepRound.
  const draftingPhase = state.round.phase === "drafting";
  const allocId = (): EntityId => {
    const id = EntityId(runtime.nextEntityId);
    runtime.nextEntityId += 1;
    return id;
  };

  // Resolve chaos profile once per tick. The id list is stable across the
  // match so the lookup itself is cheap; the multiplicative reduction over
  // active modifiers happens here.
  const chaosProfile: ChaosProfile = getChaosProfile(
    state.chaosModifierIds as ChaosModifierId[] | undefined,
  );

  // `slow-motion` chaos compresses real dt before any sim integration runs.
  // Movement, projectile flight, fire-rate cooldown decrement, and the round
  // timer all use the same scaled dt so the whole match observably runs at
  // half tempo. Effective dt is what we feed downstream.
  const effDtMs = dtMs * chaosProfile.timeScale;

  // Single rng cursor threaded through all sim stages this tick. We seed it
  // from the world state so determinism is preserved across replays.
  let runtimeRngState = state.rngState;

  // 1. Players: movement + weapon fire (only during fighting phase; other
  //    phases freeze input but still advance the round timer).
  const players: WorldState["players"] = {};
  // Copy-on-write so a fighting tick with no new shots costs zero
  // allocations on the projectiles record. See client/src/sim/cowRecord.ts.
  const projectilesCow = new CowRecord<EntityId, ProjectileEntity>(state.projectiles);
  // Mutable copy of satellites — fire-on-first-shot may add new entries; the
  // satellite step later this tick rotates and ticks them. Not CoW-wrapped
  // because stepSatellites returns a freshly-allocated record at line ~513
  // anyway, so a CoW would save nothing.
  let nextSatellites: WorldState["satellites"] = { ...(state.satellites ?? {}) };

  // NINJA MELEE trigger capture (see the "1z2. NINJA MELEE" section below,
  // right after DASH BASH): the Fire rising-edge has to be read HERE, in
  // the same loop that still has the pre-overwrite `prevKeys` in scope —
  // by loop 2 `runtime.prevKeys` already holds THIS tick's value. The FSM
  // itself (phase countdown/transitions/hit-check) runs entirely in loop 2
  // since it needs every player's finalized post-movement position; this
  // map only carries "did a ninja just press Fire this tick, and what was
  // their aim" across that gap. Cleared implicitly each tick (fresh Map).
  const ninjaSlashEdges = new Map<PlayerId, { aimX: number; aimY: number }>();

  for (const [pid_, entity] of Object.entries(state.players)) {
    const pid = pid_ as PlayerId;
    const input = inputsByPlayer[pid] ?? null;
    const prevKeys = runtime.prevKeys.get(pid) ?? 0;
    const currKeys = input ? input.keys : 0;
    const aimX = input?.aimX ?? entity.aimX;
    const aimY = input?.aimY ?? entity.aimY;
    const classId = classIdForArchetype(entity.characterId);

    let mem = runtime.movement.get(pid);
    if (!mem) {
      mem = freshPlayerMovementMemory();
      runtime.movement.set(pid, mem);
    }

    // Resolve the card build once — drives movement (speed/gravity), shield
    // stats (charge/recharge), the mirror/aim shield, and parry cooldown.
    const build = resolvePlayerBuild(entity);

    // Movement (only when alive and fighting). Dead players freeze in place.
    let nextEntity = entity;
    if (entity.alive && fightingPhase) {
      // Slow-field debuff: while slowedUntilTick is in the future, dampen
      // the player's movement by their slowMultiplier.
      const slowActive =
        entity.slowedUntilTick !== undefined &&
        entity.slowedUntilTick > state.tick;
      const slowMul = slowActive ? entity.slowMultiplier ?? 1 : 1;
      // Ice-element freeze stacks multiplicatively with slow-field. Both
      // expire by tick comparison; `freezeMultiplier` is set at hit time.
      const freezeActive =
        entity.freezeUntilTick !== undefined &&
        entity.freezeUntilTick > state.tick;
      const freezeMul = freezeActive ? entity.freezeMultiplier ?? 1 : 1;
      // First-blood wager: whoever claimed it this round moves faster for
      // the rest of it. Reads the PRE-tick round state — if this tick is the
      // one that awards it (see the hit-confirmed drain below), the boost
      // takes effect starting next tick, which is imperceptible.
      const firstBloodMul = state.round.firstBloodPlayerId === pid ? FIRST_BLOOD_SPEED_MULTIPLIER : 1;
      // Card augments: move-speed + gravity (glide/heavy) ride the existing
      // step multipliers, so they cross into the Zig player step for free.
      const speedMul = slowMul * freezeMul * firstBloodMul * build.moveSpeedMultiplier;
      // Captured BEFORE stepPlayer mutates movement memory — the ninja
      // wall-kick energy grant (below) needs the PRE-step wall-contact
      // state to detect "a wall-jump just happened", the same signal
      // player.ts's own (Zig-mirrored) wall-jump branch reads internally.
      // Deliberately backend-agnostic: this reads stepPlayer's INPUT and
      // OUTPUT only, never its internals, so it works identically whether
      // stepPlayer dispatches to the TS-native path or the wasm physics
      // backend (which defaults on for live matches) — a callback hook
      // into stepPlayerNative would silently never fire under wasm.
      const wallDirBeforeStep = mem.touchingWallDir;
      const groundedBeforeStep = mem.groundedLastFrame;
      const moveResult = stepPlayer(
        entity,
        prevKeys,
        currKeys,
        aimX,
        aimY,
        mem,
        runtime.map.platforms,
        effDtMs,
        {
          speedMultiplier: speedMul,
          gravityMultiplier: chaosProfile.gravityMultiplier * build.gravityMultiplier,
          jumpMultiplier: build.jumpMultiplier,
          wallJumpMultiplier: build.wallJumpMultiplier,
          wallSlideMultiplier: build.wallSlideMultiplier,
          airJumps: build.airJumps,
          dashCharges: build.dashCharges,
          dashCooldownMultiplier: build.dashCooldownMultiplier,
          collisionCache: runtime.collisionCache,
        },
      );
      nextEntity = moveResult.player;
      runtime.movement.set(pid, moveResult.memory);
      // Mirror grounded/touchingWallDir/dashing onto the entity for the
      // render layer — wire-encoded (snapshotDelta P_HI.grounded/
      // touchingWallDir/dashing) and consumed by ProceduralPlayerRig's pose.
      nextEntity = mirrorMovementMemoryOntoEntity(
        nextEntity,
        moveResult.memory,
        build.dashCharges,
        build.dashCooldownMultiplier,
      );

      // Ninja wall-kick energy grant ("wall-kick restore energy" —
      // character-sheets-v1.md tactile contract table). Heuristic, not a
      // hook into player.ts's own wall-jump branch (see the comment above
      // wallDirBeforeStep): a Jump rising-edge while airborne and touching
      // a wall last tick. Known v1 approximation — doesn't exclude the
      // rare case where the press diverts to a double-jump instead (facing
      // away from the wall with an air-jump charge available); flagged in
      // the ninja-verb report, not gated further to keep this TS-only and
      // Zig-parity-free.
      if (classId === "ninja") {
        const jumpEdge = (currKeys & JumpBit) !== 0 && (prevKeys & JumpBit) === 0;
        if (jumpEdge && wallDirBeforeStep !== 0 && !groundedBeforeStep) {
          nextEntity = {
            ...nextEntity,
            energy: Math.min(
              NINJA_ENERGY_MAX,
              (nextEntity.energy ?? 0) + NINJA_ENERGY_ON_WALL_KICK,
            ),
          };
        }
      }
    }

    // Fire (only when alive and fighting). Hangout mode: single choke
    // point that no-ops stepWeapon entirely — no cards are ever granted
    // there either (no drafting phase), so this plus the round-step skip
    // below is sufficient to keep 7 of the 8 damage sites in this file
    // (bash, burn, projectile hit, chain-lightning, destructible splash,
    // fire-patch, storm) unreachable without touching them individually.
    // The 8th (void kill-plane) is handled separately as a respawn-in-place
    // safety net further down.
    // Firing is LIVE in hangout mode as of the venue lobby's target dummies
    // (venue-sprint2-goal S2.C) — player immunity is enforced at the damage
    // sites instead: projectiles get zero player candidates (hit sweep),
    // dash-bash/destructible-splash/fire-patch player damage are gated, and
    // the storm was already hangout-gated. Destructibles remain hittable.
    //
    // Ninja: Fire is the SAME "primary attack" input as every other class,
    // but the chassis verb is a melee arc, not stepWeapon's ranged shot —
    // this branch captures the rising edge for loop 2's FSM instead of
    // ever calling stepWeapon. Zero behavior change for non-ninja classes
    // (they take the untouched branch below exactly as before).
    if (classId === "ninja" && nextEntity.alive && fightingPhase) {
      const slashEdge = (currKeys & FireBit) !== 0 && (prevKeys & FireBit) === 0;
      if (slashEdge) {
        ninjaSlashEdges.set(pid, { aimX, aimY });
      }
      // Passive energy regen ("fast regen" — classes-goal.md MANA section).
      // Deliberately the only source that ISN'T contact-gated; kept small
      // (see NINJA_ENERGY_PASSIVE_REGEN_PER_SEC) so it stays a top-up, not
      // the loop (character-sheets-v1.md's explicit fail-state warning).
      nextEntity = {
        ...nextEntity,
        energy: Math.min(
          NINJA_ENERGY_MAX,
          (nextEntity.energy ?? 0) + NINJA_ENERGY_PASSIVE_REGEN_PER_SEC * (effDtMs / 1000),
        ),
      };
    } else if (nextEntity.alive && fightingPhase) {
      const fireResult = stepWeapon(
        nextEntity,
        (currKeys & FireBit) !== 0,
        { x: aimX, y: aimY },
        effDtMs,
        allocId,
        { chaos: chaosProfile, rngState: runtimeRngState, currentTick: state.tick },
      );
      runtimeRngState = fireResult.rngState;
      nextEntity = fireResult.player;
      if (fireResult.fired) {
        // Veil of Nought breaks on firing (six-axes doctrine: veiling is a
        // window, never a state — shooting while unmade re-makes you).
        if (
          nextEntity.veilUntilTick !== undefined &&
          nextEntity.veilUntilTick > state.tick
        ) {
          nextEntity = { ...nextEntity, veilUntilTick: undefined };
        }
        events.push({
          t: "shot-fired",
          playerId: pid,
          x: nextEntity.x,
          y: nextEntity.y,
          hand: fireResult.throwHand,
        });
        for (const p of fireResult.projectiles) {
          projectilesCow.set(p.id, p);
        }
        // First-fire activation for orbiting satellites: spawn the missing
        // companions for this player. Existing satellites stay where they are.
        if (fireResult.desiredSatelliteCount > 0) {
          const owned: SatelliteEntity[] = [];
          for (const sat of Object.values(nextSatellites)) {
            if (sat.ownerId === pid) owned.push(sat);
          }
          if (owned.length < fireResult.desiredSatelliteCount) {
            const newSats = spawnMissingSatellites(
              pid,
              fireResult.desiredSatelliteCount,
              owned,
              allocId,
            );
            for (const sat of newSats) {
              nextSatellites[sat.id] = sat;
            }
          }
        }
      }
    }

    // Emission cast (Emission Engine P1 — docs/emission-engine-goal.md).
    // The Ability rising edge attempts the cast FIRST: at full charge it
    // fires (radial volley composed from the hand via resolveEmission,
    // charge consumed to 0, edge consumed — no parry this press). Below
    // full charge the edge falls through to the legacy tryStartParry so
    // bot defensive behavior (worldBots presses Ability vs projectile
    // threats) is untouched. Humans stay unable to reach the parry per
    // CLAUDE.md because the client only SENDS the Ability bit at full
    // predicted charge (see the scenes' input assembly) — the sim itself
    // stays identity-blind. Hangout: charge never fills there (no combat
    // events), but the guard is explicit per doctrine, not emergent.
    let castConsumedAbilityEdge = false;
    const abilityEdge =
      (currKeys & AbilityBit) !== 0 && (prevKeys & AbilityBit) === 0;
    if (
      abilityEdge &&
      nextEntity.alive &&
      fightingPhase &&
      !hangoutMode &&
      nextEntity.abilityCharge >= EMISSION_CHARGE_MAX
    ) {
      const emission = resolveEmission(build);
      for (let i = 0; i < emission.volleyCount; i++) {
        // Deterministic radial fan; lut trig per sim determinism rules.
        const angle = (i / emission.volleyCount) * 2 * Math.PI;
        const shard = spawnProjectile(allocId(), {
          ownerId: pid,
          origin: { x: nextEntity.x, y: nextEntity.y - 30 },
          aimAngle: angle,
          speed: emission.speed,
          damage: emission.damagePerShard,
          lifetimeMs: emission.lifetimeMs,
          radius: emission.radiusPx,
          shape: emission.shape,
          pathing: emission.pathing,
          element: emission.element,
        });
        shard.bouncesRemaining = emission.bounces;
        shard.impact = emission.impact;
        shard.impactRadiusPx = emission.impactRadiusPx;
        shard.homingStrength = emission.homingStrength;
        shard.rangePx = emission.rangePx;
        shard.statusScale = emission.statusScale;
        // Six Axes shard extras (docs/six-axes-goal.md Layer 1) — set only
        // when the hand charges the axis, absent otherwise (statusScale's
        // additive contract). Consumed at the hit site / projectile step.
        if (emission.drain.leechFraction > 0) {
          shard.leechFraction = emission.drain.leechFraction;
        }
        if (emission.technique.executeBelowFrac > 0) {
          shard.executeBelowFrac = emission.technique.executeBelowFrac;
        }
        if (emission.mystery.wrapShots) {
          shard.wrapShots = true;
        }
        projectilesCow.set(shard.id, shard);
      }
      nextEntity = { ...nextEntity, abilityCharge: 0 };
      // Ward axis: the cast leaves a shell on the vessel — incoming damage
      // is halved at the projectile-mitigation site while it lives (order:
      // parry > shell > shield).
      if (emission.ward.fieldMs > 0) {
        const shellTicks = Math.ceil(emission.ward.fieldMs / Math.max(1, dtMs));
        nextEntity = {
          ...nextEntity,
          wardShellUntilTick: (state.tick + 1 + shellTicks) as Tick,
        };
      }
      // Stride axis: the cast refunds spent air movement — the exact reset
      // landing performs (player.ts), written into the same host-side
      // memory the next player step reads. No new ABI: the wasm player
      // step already receives these counters every tick.
      if (emission.stride.dashReset) {
        const mem = runtime.movement.get(pid);
        if (mem) {
          mem.airJumpsUsed = 0;
          mem.dashUsedInAir = 0;
        }
      }
      // E-coupling cast effects (doctrine #7): Shadow Step held → the cast
      // grants a brief speed surge (existing buff tick); Veil held → a
      // short self-veil on release (mystery.markMs carries the duration).
      const heldStepCard = build.actives.some((a) => a.kind === "shadow-step");
      if (heldStepCard) {
        const surgeTicks = Math.ceil(EMISSION_STRIDE_SURGE_MS / Math.max(1, dtMs));
        nextEntity = {
          ...nextEntity,
          speedBoostUntilTick: (state.tick + 1 + surgeTicks) as Tick,
        };
      }
      if (emission.mystery.markMs > 0) {
        const veilTicks = Math.ceil(emission.mystery.markMs / Math.max(1, dtMs));
        nextEntity = {
          ...nextEntity,
          veilUntilTick: (state.tick + 1 + veilTicks) as Tick,
        };
      }
      castConsumedAbilityEdge = true;
      events.push({
        t: "emission-cast",
        playerId: pid,
        x: nextEntity.x,
        y: nextEntity.y,
        element: emission.element,
        volleyCount: emission.volleyCount,
      });
    }

    // Drafted actives (six-axes-goal.md Layer 2): input bits 10..12 press
    // action-bar slots 1..3 in pick order (docs/classes-goal.md "Rotation
    // system" — rack is exactly 3 slots, bit 13 / a 4th slot is unused).
    // Rising-edge + alive + fighting + !hangout + cooldown expired →
    // activate. Effects are ordinary buff ticks / entities; the cooldown
    // lives on the entity (hash-mixed, delta-synced) so prediction and
    // authority agree.
    for (let slot = 0; slot < build.actives.length && slot < MAX_ABILITY_SLOTS; slot++) {
      const slotBit = 1 << (10 + slot);
      const slotEdge =
        (currKeys & slotBit) !== 0 && (prevKeys & slotBit) === 0;
      if (!slotEdge) continue;
      if (!nextEntity.alive || !fightingPhase || hangoutMode) continue;
      const active = build.actives[slot]!;
      const cdUntil =
        slot === 0
          ? nextEntity.slot1CooldownUntilTick
          : slot === 1
            ? nextEntity.slot2CooldownUntilTick
            : slot === 2
              ? nextEntity.slot3CooldownUntilTick
              : nextEntity.slot4CooldownUntilTick;
      if (cdUntil !== undefined && cdUntil > state.tick) continue;

      let activated = false;
      switch (active.kind) {
        case "crimson-tithe": {
          // 3s window: fired shots carry leechFraction (weapon.ts stamps
          // it at spawn — the SAME machinery as a Drain-hand Emission).
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            titheUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "shadow-step": {
          // Blink toward aim: farthest collision-free landing within range,
          // sampled backward from the maximum in fixed steps (deterministic,
          // no RNG). Passing THROUGH walls is the fantasy ("the path
          // between"); landing inside one is the only forbidden outcome. A
          // fully-blocked blink does nothing and must not burn its cooldown
          // (legibility law: a press that does nothing is a dead press).
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const dLen = Math.sqrt(dx0 * dx0 + dy0 * dy0);
          const dirX = dLen > 0.001 ? dx0 / dLen : 1;
          const dirY = dLen > 0.001 ? dy0 / dLen : 0;
          for (let d = ABILITY_STEP_RANGE_PX; d >= 24; d -= 12) {
            const cx = nextEntity.x + dirX * d;
            const cy = nextEntity.y + dirY * d;
            if (
              cx < PLAYER_BODY_WIDTH / 2 ||
              cx > runtime.map.size.x - PLAYER_BODY_WIDTH / 2 ||
              cy < PLAYER_BODY_HEIGHT / 2 ||
              cy > runtime.map.size.y - PLAYER_BODY_HEIGHT / 2
            ) {
              continue;
            }
            const box = centerToAABB(cx, cy, PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT);
            let blocked = false;
            for (const plat of runtime.map.platforms) {
              if (aabbOverlap(box, platformToAABB(plat))) {
                blocked = true;
                break;
              }
            }
            if (!blocked) {
              nextEntity = { ...nextEntity, x: cx, y: cy };
              activated = true;
              break;
            }
          }
          break;
        }
        case "veil-of-nought": {
          // Unmade: homing + satellites cannot target this player while the
          // window lives; firing ends it early (see the post-fire clear).
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            veilUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "severing-answer": {
          // Counter-stance: the next hit taken in the window is negated and
          // returned, capped (consumed at the hit site — mitigation order
          // parry > counter > ward shell > shield).
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            counterUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "shelter-seal": {
          // v1 = self-bulwark (six-axes risk-register fallback, recorded):
          // the caster gains the Phase-1 ward shell for the window — halved
          // damage, WARD chip, sapphire rings, all existing machinery. The
          // PLACED ward-field entity is the recorded upgrade, gated on
          // playtest demand (it needs a new entity kind + wire surface).
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            wardShellUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        // ── Geometrician catalog v1 (docs/class-ability-catalogs-v1.md) ────
        // classId-gated to wizard at the offer roll (round.ts). Every case
        // below reuses six-axes substrate as hard as possible; doc-fidelity
        // gaps are recorded in the comment + cards.ts description, never
        // silent (constants.ts GEO_* header note).
        case "sunlance": {
          // v1 = a burst window, not the doc's true charge-hold: fired shots
          // deal GEO_SUNLANCE_DAMAGE_MULTIPLIER while live (weapon.ts stamps
          // it — the exact Crimson Tithe pattern).
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            sunlanceUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "facet-break": {
          // Mark lives on the CASTER (facetTargetId/facetMarkUntilTick),
          // never the victim — a cross-player write here would be lost the
          // moment that victim's own turn in THIS per-player loop runs
          // (players[pid] = nextEntity only commits at the end of each
          // iteration, and victims processed later this tick haven't run
          // yet). state.players is the stable pre-tick read source for the
          // scan, matching every other read of "other players" this tick.
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const aimAngle = lutAtan2(dy0, dx0);
          let bestId: PlayerId | null = null;
          let bestDist = Infinity;
          for (const [otherId, other] of Object.entries(state.players)) {
            if ((otherId as PlayerId) === pid || !other.alive) continue;
            const ddx = other.x - nextEntity.x;
            const ddy = other.y - nextEntity.y;
            const dist = Math.hypot(ddx, ddy);
            if (dist > GEO_FACET_BREAK_RANGE_PX || dist < 1e-3) continue;
            let da = lutAtan2(ddy, ddx) - aimAngle;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            if (Math.abs(da) > GEO_FACET_BREAK_CONE_RADIANS / 2) continue;
            if (dist < bestDist) {
              bestDist = dist;
              bestId = otherId as PlayerId;
            }
          }
          if (bestId !== null) {
            const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
            nextEntity = {
              ...nextEntity,
              facetTargetId: bestId,
              facetMarkUntilTick: (state.tick + 1 + durTicks) as Tick,
            };
            activated = true;
          }
          // No target in the cone: a press that does nothing is a dead press
          // (legibility law — shadow-step's "fully-blocked blink" precedent)
          // — no cooldown burn, checked via `activated` below.
          break;
        }
        case "prism-fan": {
          // Instant cone burst — the emission cast's radial-fan shape, just
          // aimed at the cursor instead of 360°. Reuses the resolved build's
          // own projectile identity so the burst always matches the current
          // loadout (element, shape, speed).
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const baseAngle = lutAtan2(dy0, dx0);
          for (let i = 0; i < GEO_PRISM_FAN_COUNT; i++) {
            // GEO_PRISM_FAN_COUNT is a fixed constant > 1 (see constants.ts);
            // no single-shot special case needed, unlike weapon.ts's
            // variable projectileCount.
            const offset =
              -GEO_PRISM_FAN_CONE_RADIANS / 2 +
              (GEO_PRISM_FAN_CONE_RADIANS * i) / (GEO_PRISM_FAN_COUNT - 1);
            const shard = spawnProjectile(allocId(), {
              ownerId: pid,
              origin: { x: nextEntity.x, y: nextEntity.y - 20 },
              aimAngle: baseAngle + offset,
              speed: build.projectileSpeed * build.projectile.speedMultiplier,
              damage: build.damage * GEO_PRISM_FAN_DAMAGE_MULTIPLIER,
              lifetimeMs: Math.max(50, build.projectileLifetimeSeconds * 1000),
              radius: Math.max(2, 7 * build.projectile.sizeMultiplier),
              shape: build.projectile.shape,
              pathing: "straight",
              element: build.projectile.element,
            });
            projectilesCow.set(shard.id, shard);
          }
          activated = true;
          break;
        }
        case "lattice": {
          // v1 = an instant 360° nova, not the doc's persisting damaging
          // plane (recorded upgrade — needs a new entity kind + wire
          // surface, same shape of deferral as Shelter Seal's placed-ward
          // fallback above). Self-centered, short range, so it reads as
          // distinct from Prism Fan's aimed cone.
          for (let i = 0; i < GEO_LATTICE_COUNT; i++) {
            const angle = (i / GEO_LATTICE_COUNT) * 2 * Math.PI;
            const shard = spawnProjectile(allocId(), {
              ownerId: pid,
              origin: { x: nextEntity.x, y: nextEntity.y - 20 },
              aimAngle: angle,
              speed: build.projectileSpeed * build.projectile.speedMultiplier * 0.7,
              damage: build.damage * GEO_LATTICE_DAMAGE_MULTIPLIER,
              lifetimeMs: Math.max(
                50,
                (GEO_LATTICE_RANGE_PX /
                  Math.max(1, build.projectileSpeed * build.projectile.speedMultiplier * 0.7)) *
                  1000,
              ),
              radius: Math.max(2, 7 * build.projectile.sizeMultiplier),
              shape: build.projectile.shape,
              pathing: "straight",
              element: build.projectile.element,
            });
            projectilesCow.set(shard.id, shard);
          }
          activated = true;
          break;
        }
        case "return-glass": {
          // v1 = an instant self-shield-charge tick, not gated behind a live
          // parry (recorded upgrade: hooking the parry-deflected event site
          // is a deeper change than this pass's risk budget — see
          // constants.ts GEO_* header). Capped at the build's own max charge
          // so this never exceeds what a full shield bar would hold.
          const maxCharge = SHIELD_MAX_CHARGE_DEFAULT * build.shieldChargeMultiplier;
          nextEntity = {
            ...nextEntity,
            shieldCharge: Math.min(
              maxCharge,
              (nextEntity.shieldCharge ?? 0) + GEO_RETURN_GLASS_SHIELD_REFUND,
            ),
          };
          activated = true;
          break;
        }
        case "hard-aperture": {
          // v1 reuses the exact ward-shell mechanic Shelter Seal/the Ward
          // axis already ship (×0.5 incoming damage while live) — a shorter
          // window, a different cooldown/cost shape on the catalog. The
          // doc's "breaks if you fire" + "move slow while aiming" nuances
          // are a deferred v2 (would need a live continuous-input read this
          // press-based activation doesn't have).
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            wardShellUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "overclock": {
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            overclockUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "measure": {
          // v1 = banks one guaranteed free shot (ammo+1, capped at magazine
          // size) — the closest existing analog to "refunds mana" (no mana
          // resource exists yet, classes-goal.md future work). The doc's
          // aim-assist "true line" VFX is a render-only follow-up; the
          // generic ability-activated event already gives spectators a read.
          nextEntity = {
            ...nextEntity,
            ammo: Math.min(build.magazineSize, nextEntity.ammo + 1),
          };
          activated = true;
          break;
        }
        case "slip-node": {
          // Same farthest-collision-free-landing search as shadow-step
          // (kept as its own small loop rather than a shared helper, so
          // tuning one never silently retunes the other), with its own
          // range/cooldown. The doc's "leaves a fading node enemies can
          // read" is satisfied today by the generic ability-activated event
          // (carries x/y) — a bespoke lingering marker entity is a v2.
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const dLen = Math.sqrt(dx0 * dx0 + dy0 * dy0);
          const dirX = dLen > 0.001 ? dx0 / dLen : 1;
          const dirY = dLen > 0.001 ? dy0 / dLen : 0;
          for (let d = GEO_SLIP_NODE_RANGE_PX; d >= 24; d -= 12) {
            const cx = nextEntity.x + dirX * d;
            const cy = nextEntity.y + dirY * d;
            if (
              cx < PLAYER_BODY_WIDTH / 2 ||
              cx > runtime.map.size.x - PLAYER_BODY_WIDTH / 2 ||
              cy < PLAYER_BODY_HEIGHT / 2 ||
              cy > runtime.map.size.y - PLAYER_BODY_HEIGHT / 2
            ) {
              continue;
            }
            const box = centerToAABB(cx, cy, PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT);
            let blocked = false;
            for (const plat of runtime.map.platforms) {
              if (aabbOverlap(box, platformToAABB(plat))) {
                blocked = true;
                break;
              }
            }
            if (!blocked) {
              nextEntity = { ...nextEntity, x: cx, y: cy };
              activated = true;
              break;
            }
          }
          break;
        }
        case "recoil-step": {
          // Instant hop opposite the aim direction. The doc's "next shot
          // gets knock-self reduction" nuance is a deferred v2 (would need
          // its own weapon.ts window field — left out to keep this pass's
          // new-field count lean).
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const hopAngle = lutAtan2(dy0, dx0) + Math.PI;
          nextEntity = {
            ...nextEntity,
            vx: nextEntity.vx + lutCos(hopAngle) * GEO_RECOIL_STEP_HOP_SPEED,
            vy: nextEntity.vy + lutSin(hopAngle) * GEO_RECOIL_STEP_HOP_SPEED * 0.6,
          };
          activated = true;
          break;
        }
      }
      if (!activated) continue;

      // Resonance (class-overhaul-workboard.md chunk 0.1, docs/classes-
      // goal.md "Rotation system" — "chain unlike abilities for a bonus").
      // Class-agnostic by construction: this reads/writes generic
      // `active.kind`/resonance* fields, never branches on classId or a
      // specific kind. A DIFFERENT kind cast while the previous cast's
      // window is still open (resonanceUntilTick > tick) consumes it for
      // the v1 bonus (RESONANCE_CD_REFUND_FRACTION off THIS cast's own
      // cooldown, see constants.ts for why this shape was picked over an
      // empowered-effect or emission-rider shape). The SAME kind cast
      // twice never resonates — resonanceSourceKind === active.kind fails
      // the inequality, which is the entire enforcement of "chain UNLIKE
      // abilities" (no separate same-ability guard needed).
      const resonated =
        nextEntity.resonanceUntilTick !== undefined &&
        nextEntity.resonanceUntilTick > state.tick &&
        nextEntity.resonanceSourceKind !== undefined &&
        nextEntity.resonanceSourceKind !== active.kind;
      const priorResonanceSourceKind = nextEntity.resonanceSourceKind;

      const cdTicks = Math.ceil(active.cooldownMs / Math.max(1, dtMs));
      const effectiveCdTicks = resonated
        ? Math.max(0, Math.round(cdTicks * (1 - RESONANCE_CD_REFUND_FRACTION)))
        : cdTicks;
      const cdTick = (state.tick + 1 + effectiveCdTicks) as Tick;
      const resonanceWindowTicks = Math.ceil(RESONANCE_WINDOW_MS / Math.max(1, dtMs));
      nextEntity = {
        ...nextEntity,
        // Every activation (resonated or not) opens/refreshes ITS OWN
        // window, naming itself as the new source — the next different
        // cast chains off THIS one, not off whatever opened the window
        // that just got consumed.
        resonanceUntilTick: (state.tick + 1 + resonanceWindowTicks) as Tick,
        resonanceSourceKind: active.kind,
      };
      nextEntity =
        slot === 0
          ? { ...nextEntity, slot1CooldownUntilTick: cdTick }
          : slot === 1
            ? { ...nextEntity, slot2CooldownUntilTick: cdTick }
            : slot === 2
              ? { ...nextEntity, slot3CooldownUntilTick: cdTick }
              : { ...nextEntity, slot4CooldownUntilTick: cdTick };
      events.push({
        t: "ability-activated",
        playerId: pid,
        slot,
        kind: active.kind,
        x: nextEntity.x,
        y: nextEntity.y,
      });
      if (resonated && priorResonanceSourceKind !== undefined) {
        events.push({
          t: "resonance-triggered",
          playerId: pid,
          sourceKind: priorResonanceSourceKind,
          kind: active.kind,
          x: nextEntity.x,
          y: nextEntity.y,
        });
      }
    }

    // Parry + shield. Both run regardless of round phase so the shield can
    // recharge between rounds; tryStartParry is gated on alive internally.
    // Parry trigger is rising-edge from prevKeys → currKeys (InputBit.Ability)
    // — skipped when the Emission cast consumed this press (above).
    if (!castConsumedAbilityEdge) {
      const parryResult = tryStartParry(nextEntity, currKeys, prevKeys, state.tick, {
        dtMs,
        cooldownMs: PARRY_COOLDOWN_MS_DEFAULT * build.parryCooldownMultiplier,
      });
      nextEntity = parryResult.player;
    }
    // Shield stats scale with the build: bigger bar (charge), faster refill.
    nextEntity = tickShield(nextEntity, currKeys, {
      dtMs,
      maxCharge: SHIELD_MAX_CHARGE_DEFAULT * build.shieldChargeMultiplier,
      rechargePerSecond: SHIELD_RECHARGE_PER_SECOND * build.shieldRechargeMultiplier,
    });

    if (input) {
      nextEntity = { ...nextEntity, lastProcessedInputSeq: input.seq };
      runtime.prevKeys.set(pid, currKeys);
    }

    players[pid] = nextEntity;
  }

  // Perf hoist: id-sorted player list, computed ONCE per tick and shared by
  // every pass that needs deterministic player iteration (bash, per-
  // projectile hit sweeps, AOE, homing, chain-lightning). The key SET is
  // stable for the rest of the tick — passes mutate player VALUES, never
  // add/remove ids — so this is byte-identical to each pass re-sorting.
  const sortedPlayerIdsForTick = (Object.keys(players) as PlayerId[]).sort();

  // 1z. DASH BASH — the offensive half of the shield-dash. Positions,
  //     velocity, and `dashing` are all current here (post-movement). For each
  //     player mid-dash, ram the first enemy inside the shield's frontal arc:
  //     damage (through the same shield/parry mitigation as a projectile, so
  //     two shields clashing cancels) + a hard knockback along the lunge, and
  //     the attacker's dash STOPS on impact (one bash per dash). Iterated over
  //     sorted ids for determinism (client + server agree).
  //     Hangout carve-out (venue-sprint2-goal S2.C): players are IMMUNE in
  //     hangout mode — firing is live for the lobby's target dummies, but no
  //     player-vs-player damage path may run.
  //     Ninja EXCLUDED (2026-07-18): a ninja's dash-collision is its own
  //     distinct signature mechanic — dash-through, a light body-cross that
  //     tags + feeds energy (docs/classes-goal.md: "not a fog"), NOT the
  //     heavy ram/knockback this block deals. Without this exclusion,
  //     DASH BASH's point-blank BASH_RANGE (46px) always fires FIRST and
  //     ends the dash (aMem.dashActiveMs=0) before the NINJA MELEE section
  //     below ever observes `attacker.dashing === true` — body-cross AABB
  //     overlap only happens well inside BASH_RANGE (~26px, bodyWidth), so
  //     the race was unconditional, not an edge case. Other classes keep
  //     today's unchanged behavior.
  if (fightingPhase && !hangoutMode) {
    const bashTick = Tick(state.tick + 1);
    const bashIds = sortedPlayerIdsForTick;
    for (const aid of bashIds) {
      const attacker = players[aid]!;
      if (!attacker.alive || attacker.dashing !== true) continue;
      if (classIdForArchetype(attacker.characterId) === "ninja") continue;
      const speed = Math.hypot(attacker.vx, attacker.vy);
      if (speed < 1) continue;
      const ux = attacker.vx / speed;
      const uy = attacker.vy / speed;
      const dashAngle = Math.atan2(attacker.vy, attacker.vx);
      for (const vid of bashIds) {
        if (vid === aid) continue;
        const victim = players[vid]!;
        if (!victim.alive) continue;
        const dx = victim.x - attacker.x;
        const dy = victim.y - attacker.y;
        const dist = Math.hypot(dx, dy);
        if (dist > BASH_RANGE || dist < 1e-3) continue;
        // Within the shield's frontal arc of the lunge direction?
        let da = Math.atan2(dy, dx) - dashAngle;
        da = Math.atan2(Math.sin(da), Math.cos(da)); // normalize to [-π, π]
        if (Math.abs(da) > SHIELD_AIM_ARC_RADIANS / 2) continue;

        // Bash lands. Run it through the SAME mitigation a projectile hit
        // uses (null projectile → parry/directional checks fall through to
        // an omnidirectional shield block): a shielded target clashes shields
        // and takes no damage, but everyone still gets shoved.
        const victimBuild = resolvePlayerBuild(victim);
        const mit = tryDeflectDamage(victim, null, BASH_DAMAGE, bashTick, {
          mirrorShield: victimBuild.mirrorShield,
          directionalShield: victimBuild.directionalShield,
          parryCoverMultiplier: victimBuild.parryCoverMultiplier,
        });
        // Ninja evasion (dash i-frames): "wasn't there" — no damage, no
        // knockback, no event. The bash still costs the ATTACKER their
        // dash (below); only the victim-side effects are suppressed.
        let post = mit.evaded
          ? mit.player
          : {
              ...mit.player,
              vx: ux * BASH_KNOCKBACK,
              vy: uy * BASH_KNOCKBACK - BASH_KNOCK_UP,
            };
        const blocked = mit.shielded || mit.deflected;
        if (mit.evaded) {
          // no-op: victim phased through, nothing to apply or announce.
        } else if (!blocked) {
          const newHealth = Math.max(0, post.health - mit.damage);
          const wasAlive = post.alive;
          post = { ...post, health: newHealth, alive: newHealth > 0 };
          events.push({
            t: "hit-confirmed",
            victimId: vid,
            damage: mit.damage,
            sourceProjectileId: null,
            attackerId: aid,
          });
          if (wasAlive && newHealth === 0) {
            events.push({ t: "player-killed", victimId: vid, killerId: aid, cause: "bash" });
          }
        } else {
          // The CLANG: a blocked bash is a shield-on-shield clash — the
          // victim's guard caught the lance. Without an event the renderer
          // gets a 660px/s collision with zero feedback. parry-deflected is
          // the exact semantic (a directional guard turned an attack) and
          // already drives the parry flash + sound.
          events.push({ t: "parry-deflected", playerId: vid, projectileId: null });
          if (mit.shielded && mit.shieldPopped) {
            events.push({
              t: "shield-popped",
              playerId: vid,
              remainingCharge: post.shieldCharge ?? 0,
            });
          }
        }
        players[vid] = post;

        // The lance stops: end the attacker's dash and bleed most of its
        // speed (the impact). dashActiveMs=0 also drops the shield block.
        // A landed bash pays the same recovery endlag as a whiffed slide —
        // set it directly since stepPlayer's own transition detector only
        // sees timers it decayed itself.
        const aMem = runtime.movement.get(aid);
        if (aMem) {
          aMem.dashActiveMs = 0;
          aMem.dashRecoveryMs = DASH_RECOVERY_MS;
        }
        const stopped = {
          ...attacker,
          vx: attacker.vx * BASH_ATTACKER_STOP,
          vy: attacker.vy * BASH_ATTACKER_STOP,
        };
        // dashCharges/dashCooldownMultiplier omitted here (defaults to
        // "no dash") — this is the post-bash attacker-stop path, not the
        // main per-player step above, and doesn't have the attacker's own
        // resolved build in scope. Worst case is a single-tick dashReadyFrac
        // flicker to hidden; the main loop's own mirror call recomputes it
        // correctly on the very next tick.
        players[aid] = aMem ? mirrorMovementMemoryOntoEntity(stopped, aMem) : stopped;
        break; // one bash per dash
      }
    }
  }

  // 1z2. NINJA MELEE — the dual-blade slash + wave-off-swing verb, and
  //      dash-through body-cross. Runs right after DASH BASH so it shares
  //      the same finalized post-movement positions/`dashing` state and the
  //      same sorted-id determinism. Gated on classId === "ninja" at the
  //      very top of the per-attacker loop — zero cost, zero behavior
  //      change for the other three chassis (see ninjaMeleeGating.test.ts).
  //      Hangout carve-out identical to DASH BASH's: no player-vs-player
  //      damage path runs there, but the FSM itself (phase/energy) still
  //      advances so a ninja's swing doesn't get stuck mid-animation when
  //      a match transitions into hangout.
  if (fightingPhase) {
    const meleeTick = Tick(state.tick + 1);
    const meleeIds = sortedPlayerIdsForTick;
    for (const aid of meleeIds) {
      const attacker = players[aid]!;
      if (classIdForArchetype(attacker.characterId) !== "ninja") continue;
      if (!attacker.alive) continue;

      let mem = runtime.melee.get(aid);
      if (!mem) {
        mem = freshNinjaMeleeMemory();
        runtime.melee.set(aid, mem);
      }

      // ---- Dash-through body-cross (independent of the swing FSM) ----
      // "Dash-through is a body-cross (hitbox intersection), not a fog."
      // v1 scope: detect + energy grant only — the Read tag / +20% melee
      // bonus that CONSUMES this event is Slipstream (a card, fast-follow).
      const dashingNow = attacker.dashing === true;
      if (dashingNow && !mem.wasDashing) {
        mem.dashThroughTagged.clear(); // new dash burst — fresh tags
      }
      if (dashingNow && !hangoutMode) {
        const attackerAABB = playerHitboxAABB(attacker);
        for (const vid of meleeIds) {
          if (vid === aid) continue;
          const victim = players[vid]!;
          if (!victim.alive || mem.dashThroughTagged.has(vid)) continue;
          if (!aabbOverlap(attackerAABB, playerHitboxAABB(victim))) continue;
          mem.dashThroughTagged.add(vid);
          players[aid] = {
            ...players[aid]!,
            energy: Math.min(
              NINJA_ENERGY_MAX,
              (players[aid]!.energy ?? 0) + NINJA_ENERGY_ON_DASH_THROUGH,
            ),
          };
          events.push({ t: "dash-through", attackerId: aid, victimId: vid });
        }
      }
      mem.wasDashing = dashingNow;

      // ---- Swing FSM ----
      const wasActive = mem.phase === 2;
      let waveShouldSpawn = false;
      if (mem.phase === 0) {
        const edge = ninjaSlashEdges.get(aid);
        if (edge) {
          const len = Math.hypot(edge.aimX - attacker.x, edge.aimY - attacker.y);
          mem.phase = 1;
          mem.phaseMs = SLASH_WINDUP_MS;
          // aimX/aimY on the input are an absolute cursor point, not a unit
          // vector — capture the normalized swing DIRECTION from attacker
          // toward that point (falls back to facing +X if the cursor is
          // exactly on the player, e.g. a controller with no stick push).
          mem.aimX = len > 1e-3 ? (edge.aimX - attacker.x) / len : 1;
          mem.aimY = len > 1e-3 ? (edge.aimY - attacker.y) / len : 0;
          mem.hitThisSwing.clear();
          events.push({ t: "slash-started", playerId: aid, x: attacker.x, y: attacker.y });
        }
      } else {
        mem.phaseMs -= effDtMs;
        if (mem.phaseMs <= 0) {
          if (mem.phase === 1) {
            mem.phase = 2;
            mem.phaseMs = SLASH_ACTIVE_MS;
          } else if (mem.phase === 2) {
            mem.phase = 3;
            mem.phaseMs = SLASH_RECOVERY_MS;
            waveShouldSpawn = true;
          } else if (mem.phase === 3) {
            mem.phase = 0;
            mem.phaseMs = 0;
          }
        }
      }
      const isActiveNow = mem.phase === 2;

      // ---- Arc hit-check (every active tick, all victims in the cone —
      //      not "first hit only" like bash) ----
      if ((wasActive || isActiveNow) && !hangoutMode) {
        const aimAngle = Math.atan2(mem.aimY, mem.aimX);
        for (const vid of meleeIds) {
          if (vid === aid) continue;
          const victim = players[vid]!;
          if (!victim.alive || mem.hitThisSwing.has(vid)) continue;
          if (!isBodyInMeleeArc(attacker.x, attacker.y, aimAngle, SLASH_ARC_RADIANS / 2, SLASH_RANGE, victim)) {
            continue;
          }
          mem.hitThisSwing.add(vid);

          const victimBuild = resolvePlayerBuild(victim);
          const mit = tryDeflectDamage(victim, null, SLASH_DAMAGE, meleeTick, {
            mirrorShield: victimBuild.mirrorShield,
            directionalShield: victimBuild.directionalShield,
            parryCoverMultiplier: victimBuild.parryCoverMultiplier,
          });
          let post = mit.evaded
            ? mit.player
            : {
                ...mit.player,
                vx: mem.aimX * SLASH_KNOCKBACK,
                vy: mem.aimY * SLASH_KNOCKBACK - SLASH_KNOCK_UP,
              };
          const blocked = mit.shielded || mit.deflected;
          if (mit.evaded) {
            // no-op: victim phased through.
          } else if (!blocked) {
            const newHealth = Math.max(0, post.health - mit.damage);
            const wasAlive = post.alive;
            post = { ...post, health: newHealth, alive: newHealth > 0 };
            events.push({ t: "slash-hit", attackerId: aid, victimId: vid, damage: mit.damage });
            events.push({
              t: "hit-confirmed",
              victimId: vid,
              damage: mit.damage,
              sourceProjectileId: null,
              attackerId: aid,
            });
            if (wasAlive && newHealth === 0) {
              events.push({ t: "player-killed", victimId: vid, killerId: aid, cause: "bash" });
            }
            // Energy from contact — the attacker's own landed hit restores
            // the rack ("aggression feeds the rack").
            players[aid] = {
              ...players[aid]!,
              energy: Math.min(
                NINJA_ENERGY_MAX,
                (players[aid]!.energy ?? 0) + NINJA_ENERGY_ON_MELEE_HIT,
              ),
            };
          } else {
            events.push({ t: "parry-deflected", playerId: vid, projectileId: null });
            if (mit.shielded && mit.shieldPopped) {
              events.push({
                t: "shield-popped",
                playerId: vid,
                remainingCharge: post.shieldCharge ?? 0,
              });
            }
          }
          players[vid] = post;
        }
      }

      // ---- Wave-off-swing ----
      // "Wave is aftermath of contact, not a free cast: spawns from a swing
      // that had commit." Fires at the active→recovery transition
      // REGARDLESS of whether the arc landed a hit — the aftermath is the
      // swing's own contact with the air, not contact with a body (see the
      // ninja-verb report for the full doc-ambiguity resolution). Reuses
      // the ordinary projectile machinery so element/impact card modifiers
      // compose onto it for free later (fast-follow) — no bespoke shape.
      if (waveShouldSpawn) {
        const liveAttacker = players[aid]!;
        const wave = spawnProjectile(allocId(), {
          ownerId: aid,
          origin: { x: liveAttacker.x, y: liveAttacker.y - 20 },
          aimAngle: Math.atan2(mem.aimY, mem.aimX),
          speed: WAVE_SPEED,
          damage: WAVE_DAMAGE,
          lifetimeMs: WAVE_LIFETIME_MS,
          radius: WAVE_RADIUS,
          element: "crystal",
        });
        wave.rangePx = WAVE_RANGE;
        projectilesCow.set(wave.id, wave);
        events.push({ t: "wave-spawned", playerId: aid, projectileId: wave.id, x: wave.x, y: wave.y });
      }
    }
  }

  // 1a0. Ceiling clamp. A powerful wall-jump into the wall/ceiling corner can
  //      tunnel a body ONTO the roof (bots climbing the outer walls escaped the
  //      arena this way). Clamp any player whose head has pushed above the
  //      ceiling back under it and kill their upward velocity. Deterministic
  //      (client + server both run this) and TS-only — no Zig step change.
  if (runtime.ceilingClampY !== null) {
    const minCenterY = runtime.ceilingClampY + PLAYER_HALF_HEIGHT;
    for (const pidStr of Object.keys(players)) {
      const pid = pidStr as PlayerId;
      const p = players[pid]!;
      if (p.y < minCenterY) {
        players[pid] = { ...p, y: minCenterY, vy: Math.max(p.vy, 0) };
      }
    }
  }

  // 1a. Void-plane kill check. Open silhouettes (segmented floors, no
  //     full box walls) let players fall between islands or walk off the
  //     map AABB — kill on Y *or* X past the margin so nobody floats
  //     forever in the void. Pure sim; server + client agree per tick.
  if (runtime.map.size.y > 0 || runtime.map.size.x > 0) {
    const killY = runtime.map.size.y + KILL_PLANE_MARGIN_PX;
    const killMinX = -KILL_PLANE_MARGIN_PX;
    const killMaxX = runtime.map.size.x + KILL_PLANE_MARGIN_PX;
    for (const pidStr of Object.keys(players)) {
      const pid = pidStr as PlayerId;
      const p = players[pid]!;
      if (!p.alive) continue;
      const fellDown = runtime.map.size.y > 0 && p.y > killY;
      const fellSide =
        runtime.map.size.x > 0 && (p.x < killMinX || p.x > killMaxX);
      if (!fellDown && !fellSide) continue;
      if (hangoutMode) {
        // No combat/death concept in hangout — the void plane is a generic
        // safety net (plan A1), so a fall is a silent respawn-in-place
        // rather than a kill. `assignSpawnPoints` with a single id is
        // deterministic (always the map's first spawn point — no
        // "already placed" competitors to spread away from).
        const spawnAssignment = assignSpawnPoints(runtime.map, [pid as string]);
        const respawn = spawnAssignment.get(pid as string) ?? { x: p.x, y: p.y };
        players[pid] = { ...p, x: respawn.x, y: respawn.y, vx: 0, vy: 0 };
        continue;
      }
      events.push({
        t: "hit-confirmed",
        victimId: pid,
        damage: p.health,
        sourceProjectileId: null,
        attackerId: null,
      });
      events.push({
        t: "player-killed",
        victimId: pid,
        killerId: null,
        cause: "void",
      });
      players[pid] = {
        ...p,
        health: 0,
        alive: false,
      };
    }
  }

  // 1b. Element status effects: burn DoT + freeze expiry. Runs before the
  //     projectile pass so a fatal burn tick lands before any new hits this
  //     tick. Burn applies `burnDps` damage once per second of sim time
  //     (rate-limited via `burnTickLastApplied`). Tick-quantized via STEP_MS;
  //     no wall-clock. Frozen-state expiry is handled here too so renderers
  //     see a clean field flip after the freeze window passes.
  const ONE_SECOND_TICKS = Math.max(1, Math.round(1000 / Math.max(1, effDtMs)));
  for (const pidStr of Object.keys(players)) {
    const pid = pidStr as PlayerId;
    const p = players[pid]!;
    if (!p.alive) continue;
    let next = p;
    // Burn DoT.
    if (
      next.burnUntilTick !== undefined &&
      next.burnUntilTick > state.tick &&
      next.burnDps !== undefined &&
      next.burnDps > 0
    ) {
      const last = next.burnTickLastApplied ?? -ONE_SECOND_TICKS;
      if (state.tick - last >= ONE_SECOND_TICKS) {
        const dmg = next.burnDps;
        const newHealth = Math.max(0, next.health - dmg);
        const wasAlive = next.alive;
        next = {
          ...next,
          health: newHealth,
          alive: newHealth > 0,
          burnTickLastApplied: state.tick,
        };
        events.push({
          t: "hit-confirmed",
          victimId: pid,
          damage: dmg,
          sourceProjectileId: null,
          attackerId: null,
        });
        if (wasAlive && newHealth === 0) {
          events.push({
            t: "player-killed",
            victimId: pid,
            killerId: null,
            cause: "burn",
          });
        }
      }
    } else if (
      next.burnUntilTick !== undefined &&
      next.burnUntilTick <= state.tick
    ) {
      next = {
        ...next,
        burnUntilTick: undefined,
        burnDps: undefined,
        burnTickLastApplied: undefined,
      };
    }
    // Freeze expiry.
    if (
      next.freezeUntilTick !== undefined &&
      next.freezeUntilTick <= state.tick
    ) {
      next = {
        ...next,
        freezeUntilTick: undefined,
        freezeMultiplier: undefined,
      };
    }
    if (next !== p) players[pid] = next;
  }

  // 2. Satellites: rotate around their owners, fire projectiles when their
  //    cooldown expires (only during fighting phase). Their fired projectiles
  //    drop straight into nextProjectiles so the projectile pass below sweeps
  //    them this same tick.
  const satStep = stepSatellites(
    nextSatellites,
    players,
    state.round.phase,
    effDtMs,
    allocId,
    state.tick,
  );
  nextSatellites = satStep.satellites;
  for (const p of satStep.projectiles) {
    projectilesCow.set(p.id, p);
  }

  // 3. Projectiles: motion + pathing + impact + split-on-expire. All hits
  //    (direct + AOE) emit `hit-confirmed`; we apply the damage once per
  //    event into `players`. Children spawned by split get fresh ids from
  //    the runtime allocator and join the world next tick.
  //
  //    During the drafting phase we skip the loop entirely: projectiles
  //    keep their state but don't move or hit, mirroring the player freeze.
  const projectilesView = projectilesCow.view();
  const remainingProjectiles: WorldState["projectiles"] = draftingPhase
    ? { ...projectilesView }
    : {};
  // Reuse per-runtime scratch buffer — see WorldRuntime.scratchSortedProjectileIds.
  const sortedProjectileIds = runtime.scratchSortedProjectileIds;
  sortedProjectileIds.length = 0;
  if (!draftingPhase) {
    for (const id in projectilesView) {
      sortedProjectileIds.push(EntityId(Number(id)));
    }
    sortedProjectileIds.sort((a, b) => a - b);
  }

  const nextTick = Tick(state.tick + 1);
  let rngState = state.rngState;
  // First-blood wager: the first projectile hit this tick with a resolvable,
  // non-self attacker claims it, but only if nobody has claimed it yet this
  // round. Threaded into the stepRound() call below so RoundState picks it
  // up starting next tick (see round.ts's `next` scaffold).
  let firstBloodAwardThisTick: PlayerId | null = null;
  // Projectile ids that were parry-deflected this tick — they get dropped
  // from `remainingProjectiles` even if their hit-resolution path would have
  // kept them alive (e.g. pierce-chain). Reuses runtime scratch.
  const deflectedProjectileIds = runtime.scratchDeflectedProjectiles;
  deflectedProjectileIds.clear();

  // Perf hoist (bench: dominant per-tick allocator at real projectile
  // counts): ONE context object reused across the projectile loop (only
  // rngState changes between iterations), sharing the tick's sorted ids
  // and the prebuilt hit-sweep AABBs (positions are stable for the whole
  // pass — movement and bash already ran; aliveness is re-read live).
  // Hangout carve-out (S2.C): projectiles get ZERO player hit candidates —
  // they pass straight through avatars (ghosts) and only ever connect with
  // destructibles/platforms. The empty candidate list makes every
  // projectile-vs-player damage path structurally unreachable in the lobby.
  const projectilePlayerIds = hangoutMode ? [] : sortedPlayerIdsForTick;
  if (runtime.scratchHitSweep) {
    fillHitSweepScratch(runtime.scratchHitSweep, players, projectilePlayerIds);
  }
  const projCtx = {
    platforms: runtime.map.platforms,
    players,
    dtMs: effDtMs,
    tick: nextTick,
    rngState,
    collisionCache: runtime.collisionCache,
    sortedPlayerIds: projectilePlayerIds,
    hitScratch: runtime.scratchHitSweep,
  };

  for (const id of sortedProjectileIds) {
    const proj = projectilesView[id]!;
    projCtx.rngState = rngState;
    const result = stepProjectile(proj, projCtx);
    rngState = result.rngState;

    // Mystery axis (six-axes-goal.md Layer 1): wrap-flagged shards cross
    // the map rect and reappear on the opposite edge instead of flying off
    // it. Position-only fold — velocity, lifetime, and range accounting
    // untouched; interior statics still block/bounce normally.
    if (result.projectile && proj.wrapShots) {
      const mapW = runtime.map.size.x;
      const mapH = runtime.map.size.y;
      let wx = result.projectile.x;
      let wy = result.projectile.y;
      if (mapW > 0) {
        if (wx < 0) wx += mapW;
        else if (wx > mapW) wx -= mapW;
      }
      if (mapH > 0) {
        if (wy < 0) wy += mapH;
        else if (wy > mapH) wy -= mapH;
      }
      if (wx !== result.projectile.x || wy !== result.projectile.y) {
        result.projectile = { ...result.projectile, x: wx, y: wy };
      }
    }

    // Drain events: damage on hit-confirmed, slow on player-slowed.
    for (const ev of result.events) {
      if (ev.t === "hit-confirmed" && players[ev.victimId]) {
        const victim = players[ev.victimId]!;
        // Apply chaos damage multiplier here so every projectile source
        // (player weapons, satellites, future hazards) is scaled uniformly.
        // We mutate the event's `damage` so SFX / network consumers see the
        // post-chaos number too.
        const scaledDamage = ev.damage * chaosProfile.damageMultiplier;
        ev.damage = scaledDamage;
        // Belt-and-braces for the hangout player-immunity carve-out: the
        // empty candidate list above already makes this unreachable, but a
        // future projectile source that bypasses the hit sweep must not
        // quietly reopen player damage in the lobby.
        if (victim.alive && !hangoutMode) {
          // Ward shell (six-axes-goal.md Layer 1): a post-cast shell halves
          // incoming damage BEFORE the shield absorbs it. Order is
          // parry > shell > shield — parry zeroes regardless, so applying
          // the shell to the pre-mitigation number here is order-exact.
          // Scope: the projectile path (direct + AOE) — bash/DoT keep their
          // own sites untouched in Layer 1.
          // Severing Answer (six-axes Layer 2): counter-stance consumes the
          // hit — negated, and the raw (post-chaos, pre-shell) damage is
          // returned to the attacker, capped. Order: parry > counter >
          // shell > shield — a live parry wins the frame, so the stance
          // only answers when no parry is up.
          const parryLive =
            victim.parryActiveUntilTick !== undefined &&
            victim.parryActiveUntilTick > nextTick;
          const counterLive =
            victim.counterUntilTick !== undefined &&
            victim.counterUntilTick > nextTick;
          if (counterLive && !parryLive) {
            players[ev.victimId] = { ...victim, counterUntilTick: undefined };
            const counterTarget =
              proj.ownerId !== null && proj.ownerId !== ev.victimId
                ? players[proj.ownerId]
                : undefined;
            if (counterTarget && counterTarget.alive) {
              const returned = Math.min(ABILITY_COUNTER_RETURN_CAP, scaledDamage);
              const tHealth = Math.max(0, counterTarget.health - returned);
              players[proj.ownerId!] = {
                ...counterTarget,
                health: tHealth,
                alive: tHealth > 0,
              };
              if (tHealth === 0) {
                events.push({
                  t: "player-killed",
                  victimId: proj.ownerId!,
                  killerId: ev.victimId,
                  cause: "projectile",
                });
              }
              // The returned damage is a real hit: it flows through
              // hit-confirmed so charge fill / kill feed / audio all read
              // it with zero bespoke plumbing.
              events.push({
                t: "hit-confirmed",
                victimId: proj.ownerId!,
                damage: returned,
                sourceProjectileId: null,
                attackerId: ev.victimId,
              });
            }
            // The answered read: the parry-deflect flash at the stancer.
            events.push({
              t: "parry-deflected",
              playerId: ev.victimId,
              projectileId: ev.sourceProjectileId,
            });
            continue; // original hit suppressed entirely
          }
          const wardActive =
            victim.wardShellUntilTick !== undefined &&
            victim.wardShellUntilTick > nextTick;
          const intoMitigation = wardActive
            ? scaledDamage * EMISSION_WARD_DAMAGE_MULT
            : scaledDamage;
          ev.damage = intoMitigation;
          // Run parry/shield mitigation BEFORE applying damage. Pass the live
          // projectile so the parry arc check has direction info; falls back to
          // null when the source projectile already despawned this tick.
          const sourceProj = ev.sourceProjectileId !== null
            ? remainingProjectiles[ev.sourceProjectileId] ?? proj
            : null;
          const victimBuild = resolvePlayerBuild(victim);
          const mitigation = tryDeflectDamage(
            victim,
            sourceProj,
            intoMitigation,
            nextTick,
            {
              mirrorShield: victimBuild.mirrorShield,
              directionalShield: victimBuild.directionalShield,
              parryCoverMultiplier: victimBuild.parryCoverMultiplier,
              voidPiercing: proj.element === "void",
            },
          );
          let postPlayer = mitigation.player;
          if (mitigation.evaded) {
            // Ninja dash i-frames: "wasn't there" — zero damage, no event,
            // no reflect (evasion is not a counter). The projectile is
            // still consumed by this hit resolution (v1 simplification —
            // it doesn't visually pass through the dodging body).
            players[ev.victimId] = postPlayer;
            continue;
          }
          if (mitigation.deflected) {
            // Parry: zero damage; tell the caller (and downstream listeners)
            // by emitting a parry-deflected event. Damage event is suppressed.
            events.push({
              t: "parry-deflected",
              playerId: ev.victimId,
              projectileId: ev.sourceProjectileId,
            });
            if (ev.sourceProjectileId !== null) {
              deflectedProjectileIds.set(ev.sourceProjectileId, ev.victimId);
            }
            players[ev.victimId] = postPlayer;
            continue;
          }
          if (mitigation.shielded) {
            // Mirror shield: bounce the blocked shard back at the attacker,
            // reusing the parry-reflect path (reverse velocity + reassign owner
            // at the projectile-drop site) and the same deflect event/VFX.
            if (mitigation.shieldReflected && ev.sourceProjectileId !== null) {
              deflectedProjectileIds.set(ev.sourceProjectileId, ev.victimId);
              events.push({
                t: "parry-deflected",
                playerId: ev.victimId,
                projectileId: ev.sourceProjectileId,
              });
            }
            // Shield popped or absorbed — emit shield-popped only when the
            // charge fully drained; partial absorbs stay silent for the
            // protocol audience (clients can derive "shield hit" from charge
            // delta in the snapshot if they want a sound cue).
            if (mitigation.shieldPopped) {
              events.push({
                t: "shield-popped",
                playerId: ev.victimId,
                remainingCharge: postPlayer.shieldCharge ?? 0,
              });
            }
            // Stolen Fangs: any absorbed hit banks a lock charge (cap 2),
            // refreshing the expiry window. weapon.ts spends charges on the
            // player's next fired shot(s), turning them homing.
            if (victimBuild.stolenFangs) {
              const expiryTicks = Math.ceil(STOLEN_FANGS_CHARGE_EXPIRY_MS / effDtMs);
              const bankedCharges = Math.min(
                STOLEN_FANGS_MAX_CHARGES,
                (postPlayer.pendingLockCharges ?? 0) + 1,
              );
              postPlayer = {
                ...postPlayer,
                pendingLockCharges: bankedCharges,
                pendingLockExpiresAtTick: (nextTick + expiryTicks) as Tick,
              };
            }
            players[ev.victimId] = postPlayer;
            // Shielded → final damage is 0; don't push the original
            // hit-confirmed (it's already in result.events; suppress here).
            continue;
          }
          let finalDamage = mitigation.damage;
          const element = proj.element;
          // Radiant: 1.4x to a target already affected by any status effect.
          if (element === "radiant") {
            const hasStatus =
              (postPlayer.burnUntilTick !== undefined &&
                postPlayer.burnUntilTick > nextTick) ||
              (postPlayer.freezeUntilTick !== undefined &&
                postPlayer.freezeUntilTick > nextTick) ||
              (postPlayer.slowedUntilTick !== undefined &&
                postPlayer.slowedUntilTick > nextTick) ||
              (postPlayer.vulnerabilityUntilTick !== undefined &&
                postPlayer.vulnerabilityUntilTick > nextTick);
            if (hasStatus) finalDamage *= 1.4;
          }
          // Facet Break (Geometrician catalog v1, single role): a hit from
          // the marking player on their still-marked target is amplified.
          // Additive/composable, same post-mitigation site as the Radiant
          // status-amp just above — default-inert (facetTargetId is
          // undefined on every hand that never drafted the card, so this is
          // a true no-op for every existing test/build).
          const attackerEntity = proj.ownerId !== null ? players[proj.ownerId] : undefined;
          if (
            attackerEntity?.facetTargetId === ev.victimId &&
            attackerEntity.facetMarkUntilTick !== undefined &&
            attackerEntity.facetMarkUntilTick > nextTick
          ) {
            finalDamage *= GEO_FACET_BREAK_AMP_MULTIPLIER;
          }
          // Void's HELD-SHIELD pierce already happened above (voidPiercing
          // short-circuits tryDeflectDamage's shield step entirely — a void
          // hit that reaches here either had no shield in the way or already
          // passed through one untouched). This is a SEPARATE, still-open
          // hook: 50% armor pierce. No armor stat exists yet.
          if (element === "void") {
            // TODO: when `armor` is added to PlayerEntity, multiply
            // finalDamage by 1 / (1 - 0.5 * armor). For now: no-op.
          }
          // Technique axis (six-axes-goal.md Layer 1): an execute-flagged
          // shard finishes a player already below the threshold fraction of
          // spawn health (100, rosterOps.ts) — never from above it, so the
          // no-100-0 law holds by construction.
          const executeFrac = proj.executeBelowFrac ?? 0;
          if (
            executeFrac > 0 &&
            postPlayer.health > 0 &&
            postPlayer.health < executeFrac * 100
          ) {
            finalDamage = Math.max(finalDamage, postPlayer.health);
          }
          ev.damage = finalDamage;
          // First-blood wager: this is a real, non-self, attacker-attributed
          // hit landing during the fighting phase — claim it if nobody has
          // this round yet. `firstBloodAwardThisTick` also guards against a
          // second projectile awarding it again later in this same tick.
          if (
            fightingPhase &&
            state.round.firstBloodPlayerId === undefined &&
            firstBloodAwardThisTick === null &&
            proj.ownerId !== null &&
            proj.ownerId !== ev.victimId
          ) {
            firstBloodAwardThisTick = proj.ownerId;
          }
          const newHealth = Math.max(0, postPlayer.health - finalDamage);
          const wasAlive_main = postPlayer.alive;
          let nextVictim = {
            ...postPlayer,
            health: newHealth,
            alive: newHealth > 0,
          };
          if (wasAlive_main && newHealth === 0) {
            events.push({
              t: "player-killed",
              victimId: ev.victimId,
              killerId: proj.ownerId,
              cause: "projectile",
            });
          }
          // Fire: 3-second burn DoT at damage * 0.4 per second. Tick-quantized.
          // Emission cast shards carry statusScale ×2, hard-capped per status
          // (docs/emission-engine-goal.md) — burn's cap equals its base 3s,
          // so the cast's fire identity reads through impact size + coverage
          // rather than a longer burn; freeze genuinely doubles (≤2s).
          const statusScale = proj.statusScale ?? 1;
          if (element === "fire") {
            const burnMs = Math.min(3 * 1000 * statusScale, EMISSION_BURN_CAP_MS);
            const burnTicks = Math.ceil(burnMs / Math.max(1, effDtMs));
            nextVictim = {
              ...nextVictim,
              burnUntilTick: (nextTick + burnTicks) as Tick,
              burnDps: finalDamage * 0.4,
              burnTickLastApplied: nextTick,
            };
          }
          // Ice: 1-second freeze at 0.5x movement (Emission-scaled, capped).
          if (element === "ice") {
            const freezeMs = Math.min(1 * 1000 * statusScale, EMISSION_FREEZE_CAP_MS);
            const freezeTicks = Math.ceil(freezeMs / Math.max(1, effDtMs));
            nextVictim = {
              ...nextVictim,
              freezeUntilTick: (nextTick + freezeTicks) as Tick,
              freezeMultiplier: 0.5,
            };
          }
          players[ev.victimId] = nextVictim;

          // Drain axis (six-axes-goal.md Layer 1): a leech-flagged shard
          // heals its caster a fraction of the post-mitigation damage that
          // actually landed — the SAME number the charge fill reads (one
          // damage model). Self-damage never leeches; the heal is monotone
          // and capped at spawn health (never reduces, so a boss-mode body
          // above 100 is safe). Chain-lightning secondaries deliberately
          // excluded — the chain is a derived hit, not the shard.
          const leechFrac = proj.leechFraction ?? 0;
          if (
            leechFrac > 0 &&
            proj.ownerId !== null &&
            proj.ownerId !== ev.victimId
          ) {
            const leechCaster = players[proj.ownerId];
            if (leechCaster && leechCaster.alive) {
              const healed = Math.min(
                Math.max(100, leechCaster.health),
                leechCaster.health + finalDamage * leechFrac,
              );
              if (healed > leechCaster.health) {
                events.push({
                  t: "emission-leech",
                  casterId: proj.ownerId,
                  victimId: ev.victimId,
                  amount: healed - leechCaster.health,
                  fromX: nextVictim.x,
                  fromY: nextVictim.y,
                  toX: leechCaster.x,
                  toY: leechCaster.y,
                });
                players[proj.ownerId] = { ...leechCaster, health: healed };
              }
            }
          }

          // Lightning: chain half damage to the nearest OTHER alive player
          // within radius. Depth 1 only (no recursion). Bypasses parry/shield
          // for simplicity — the chain is a derived secondary hit.
          if (element === "lightning") {
            const CHAIN_RADIUS = 220;
            const chainDmg = finalDamage * 0.5;
            let bestId: PlayerId | null = null;
            let bestD2 = CHAIN_RADIUS * CHAIN_RADIUS;
            // Iterate sorted ids for determinism.
            const ids = sortedPlayerIdsForTick;
            for (const oid of ids) {
              if (oid === ev.victimId) continue;
              if (proj.ownerId !== null && oid === proj.ownerId) continue;
              const other = players[oid]!;
              if (!other.alive) continue;
              const dx = other.x - nextVictim.x;
              const dy = other.y - nextVictim.y;
              const d2 = dx * dx + dy * dy;
              if (d2 <= bestD2) {
                bestD2 = d2;
                bestId = oid;
              }
            }
            if (bestId !== null) {
              const target = players[bestId]!;
              const tHealth = Math.max(0, target.health - chainDmg);
              const wasAlive_chain = target.alive;
              players[bestId] = {
                ...target,
                health: tHealth,
                alive: tHealth > 0,
              };
              if (wasAlive_chain && tHealth === 0) {
                events.push({
                  t: "player-killed",
                  victimId: bestId,
                  killerId: proj.ownerId,
                  cause: "chain-lightning",
                });
              }
              events.push({
                t: "hit-confirmed",
                victimId: bestId,
                damage: chainDmg,
                sourceProjectileId: ev.sourceProjectileId,
                attackerId: proj.ownerId,
              });
              // Emit chain-hit so clients can render the lightning bolt arc.
              // Positions come from player entities at hit-time — deterministic.
              events.push({
                t: "chain-hit",
                victimId: ev.victimId,
                chainTargetId: bestId,
                fromX: nextVictim.x,
                fromY: nextVictim.y,
                toX: target.x,
                toY: target.y,
                damage: chainDmg,
              });
            }
          }
        }
      } else if (ev.t === "player-slowed" && players[ev.victimId]) {
        const victim = players[ev.victimId]!;
        const ticksDuration = Math.ceil(ev.durationMs / effDtMs);
        const until = Tick(nextTick + ticksDuration);
        // Stack policy: keep whichever ends later, take the lower (more
        // punishing) multiplier.
        const prevUntil = victim.slowedUntilTick ?? Tick(0);
        const prevMul = victim.slowMultiplier ?? 1;
        players[ev.victimId] = {
          ...victim,
          slowedUntilTick: Tick(Math.max(prevUntil, until)),
          slowMultiplier: Math.min(prevMul, ev.multiplier),
        };
      }
      events.push(ev);
    }

    // Insert any split children (assign ids here, in entity-id order).
    for (const child of result.spawned) {
      const childId = EntityId(runtime.nextEntityId);
      runtime.nextEntityId += 1;
      remainingProjectiles[childId] = { ...child.spec, id: childId };
    }

    // REFLECT (parry OR mirror-shield) — MUST run BEFORE the expiry check: a
    // single-hit shard EXPIRES on the very hit that triggered the deflect, so
    // `result.projectile` is already null. We reflect the PRE-step projectile
    // (`proj`) instead: send it back the way it came, now OWNED by the deflector
    // so it can strike the original attacker, spawned at the deflector's body so
    // it visibly bounces off. Travel/age reset so it doesn't instantly expire; a
    // small speed boost reads as a deliberate return ("No, you.").
    const parrier = deflectedProjectileIds.get(id);
    if (parrier !== undefined) {
      const deflector = players[parrier];
      const rx = deflector ? deflector.x : proj.x;
      const ry = deflector ? deflector.y : proj.y;
      remainingProjectiles[id] = {
        ...proj,
        x: rx,
        y: ry,
        vx: -proj.vx * 1.15,
        vy: -proj.vy * 1.15,
        ownerId: parrier,
        ageMs: 0,
        traveledPx: 0,
        originX: rx,
        originY: ry,
        returning: undefined,
      };
      continue;
    }

    if (result.expired || result.projectile === null) {
      continue;
    }
    remainingProjectiles[id] = result.projectile;
  }

  // Slow-debuff cleanup: clear expired slows so movement returns to normal.
  for (const pid_ of Object.keys(players)) {
    const pid = pid_ as PlayerId;
    const p = players[pid]!;
    if (p.slowedUntilTick !== undefined && p.slowedUntilTick <= nextTick) {
      players[pid] = {
        ...p,
        slowedUntilTick: undefined,
        slowMultiplier: undefined,
      };
    }
  }

  // 3b. Destructibles: any surviving projectile that overlaps a destructible
  //     applies damage and despawns. Broken explosive boxes deal AOE; broken
  //     flammable boxes hit by a fire-element shard seed a fire patch. AOE
  //     and direct hit-confirmed events are drained into players here.
  let nextDestructibles: WorldState["destructibles"] = state.destructibles;
  let nextFirePatches: WorldState["firePatches"] = { ...state.firePatches };
  let projectilesAfterDestructibles = remainingProjectiles;

  if (Object.keys(state.destructibles).length > 0 || Object.keys(remainingProjectiles).length > 0) {
    const destResult = stepDestructibles(
      state.destructibles,
      remainingProjectiles,
      players,
      effDtMs,
      nextTick,
    );
    nextDestructibles = destResult.destructibles;
    projectilesAfterDestructibles = destResult.projectiles;
    for (const ev of destResult.events) {
      // Hangout player immunity (S2.C): dummies break, blasts never hurt.
      if (ev.t === "hit-confirmed" && players[ev.victimId] && !hangoutMode) {
        const victim = players[ev.victimId]!;
        if (victim.alive) {
          const scaledDamage = ev.damage * chaosProfile.damageMultiplier;
          ev.damage = scaledDamage;
          const newHealth = Math.max(0, victim.health - scaledDamage);
          players[ev.victimId] = {
            ...victim,
            health: newHealth,
            alive: newHealth > 0,
          };
          if (newHealth === 0) {
            events.push({
              t: "player-killed",
              victimId: ev.victimId,
              // The blast IS attributed: destructible.ts stamps the
              // triggering projectile's owner as `attackerId` on the
              // hit-confirmed (barrels exclude their owner from the AOE, so
              // this is never a self-kill). Was hardcoded null — the killer
              // got no credit (kill feed, camera kick, round kill tally).
              killerId: ev.attackerId ?? null,
              cause: "explosion",
            });
          }
        }
      }
      events.push(ev);
    }
    for (const spec of destResult.spawnedFire) {
      const fid = EntityId(runtime.nextEntityId);
      runtime.nextEntityId += 1;
      nextFirePatches[fid] = buildFireEntity(fid, spec);
    }
  }

  // 3c. Fire patches: tick lifetime, apply DoT to alive non-owner players
  //     they overlap. Despawn when remaining hits 0.
  if (Object.keys(nextFirePatches).length > 0) {
    const fireResult = stepFirePatches(nextFirePatches, players, effDtMs);
    nextFirePatches = fireResult.firePatches;
    for (const ev of fireResult.events) {
      // Hangout player immunity (S2.C) — same carve-out as blasts above.
      if (ev.t === "hit-confirmed" && players[ev.victimId] && !hangoutMode) {
        const victim = players[ev.victimId]!;
        if (victim.alive) {
          const scaledDamage = ev.damage * chaosProfile.damageMultiplier;
          ev.damage = scaledDamage;
          const newHealth = Math.max(0, victim.health - scaledDamage);
          players[ev.victimId] = {
            ...victim,
            health: newHealth,
            alive: newHealth > 0,
          };
          if (newHealth === 0) {
            events.push({
              t: "player-killed",
              victimId: ev.victimId,
              // Fire patches carry their igniter: fire.ts stamps
              // `patch.ownerId` as `attackerId` on the hit-confirmed
              // (patches never damage their owner, so never a self-kill).
              // Was hardcoded null — destructible.ts even documents that
              // patches "inherit the originating shooter as ownerId for
              // kill credit", and this site dropped that credit.
              killerId: ev.attackerId ?? null,
              cause: "fire",
            });
          }
        }
      }
      events.push(ev);
    }
  }

  // 3d. Shrink-zone storm: full sudden death (round.suddenDeathActive, see
  //     round.ts's countdown→fighting transition) OR the gentler soft
  //     endgame zone that's active in the final 15s of EVERY round
  //     (anti-timeout-camping — stepSuddenDeathStorm branches internally,
  //     mutually exclusive, sudden death wins). Called unconditionally so
  //     the soft zone's own gating actually gets a chance to run. Same
  //     direct-damage drain shape as fire patches above — environmental
  //     DoT, no parry/shield mitigation. Uses `state.round`, not
  //     `roundStateForStep` (not computed yet at this point in the tick) —
  //     one-tick lag on a shrink that unfolds over seconds is imperceptible.
  //     Hangout: skipped entirely — its trigger math reads
  //     countdownRemainingMs as time-left-in-round, and hangout pins that
  //     to 0 (no round machine), which reads as "final seconds" and turns
  //     the soft endgame zone on permanently at full strength.
  if (!hangoutMode) {
    const stormResult = stepSuddenDeathStorm(players, state.round, runtime.map.size, effDtMs);
    for (const ev of stormResult.events) {
      if (ev.t === "hit-confirmed" && players[ev.victimId]) {
        const victim = players[ev.victimId]!;
        if (victim.alive) {
          const scaledDamage = ev.damage * chaosProfile.damageMultiplier;
          ev.damage = scaledDamage;
          const newHealth = Math.max(0, victim.health - scaledDamage);
          players[ev.victimId] = {
            ...victim,
            health: newHealth,
            alive: newHealth > 0,
          };
          if (newHealth === 0) {
            events.push({
              t: "player-killed",
              victimId: ev.victimId,
              killerId: null,
              cause: "storm",
            });
          }
        }
      }
      events.push(ev);
    }
  }

  // 4. Pickups: pickup-vs-player overlap, instant effects + buff timers,
  //    plus respawn scheduling. Runs only during fighting phase — countdown
  //    / round-over freeze pickup activity. Card-cache offers and other
  //    buff events emerge from here.
  let nextPickups: WorldState["pickups"] = state.pickups;
  if (fightingPhase) {
    const pickupResult = stepPickups({
      pickups: state.pickups,
      players,
      tick: nextTick,
      dtMs: effDtMs,
      rngState,
    });
    nextPickups = pickupResult.pickups;
    rngState = pickupResult.rngState;
    for (const [pid_, patched] of Object.entries(pickupResult.players)) {
      players[pid_ as PlayerId] = patched;
    }
    for (const ev of pickupResult.events) {
      events.push(ev);
    }
  }

  // 4a. Launch pads: STATIC map geometry (runtime.map.launchPads — never in
  //     WorldState, both sides derive them from mapId like platforms). Player
  //     overlaps a pad → velocity impulse from OUTSIDE stepPlayer, additive
  //     only (see sim/launchPad.ts for the formula + the stateless retrigger
  //     gate). TICK-ORDER POSITION: after movement, mirroring the pickup
  //     section — the boosted velocity integrates on the NEXT tick's
  //     stepPlayer, never mid-tick. Zig mirror: sim/src/world.zig §8c (which
  //     sits directly after ITS player-physics pass — Zig's pickup pass runs
  //     pre-movement, a pre-existing quarantined divergence, so "directly
  //     post-movement" is the invariant both engines share). Runs in hangout
  //     too (fightingPhase is pinned true there) — pads are a movement toy,
  //     no damage path.
  if (fightingPhase) {
    const launchPadDefs = runtime.map.launchPads;
    if (launchPadDefs !== undefined && launchPadDefs.length > 0) {
      const padResult = stepLaunchPads({ pads: launchPadDefs, players });
      for (const [pid_, patched] of Object.entries(padResult.players)) {
        const pid = pid_ as PlayerId;
        players[pid] = patched;
        // A pad launch is NOT a jump — mark the variable-jump-height cut as
        // consumed so stepPlayer doesn't halve the rising velocity next tick
        // (it fires on any vy<0 with jump released). Same outside-the-step
        // memory poke the dash uses for its upward lunge (player.ts) and the
        // bash uses to end a dash (§1z above). Zig mirror: world.zig §8c
        // sets player_movement[i].jump_cut_applied the same way.
        const mem = runtime.movement.get(pid);
        if (mem) mem.jumpCutApplied = true;
      }
      for (const ev of padResult.events) {
        events.push(ev);
      }
    }
  }

  // 4b. Fire-hazard chaos modifier: every `intervalMs` of in-sim time, drop a
  //     fresh fire patch at a random arena location. Position rolls use the
  //     seeded RNG so replays land patches at the same spots. Only fires
  //     during the fighting phase.
  let nextFireHazardTimerMs: number | undefined = state.fireHazardTimerMs;
  if (chaosProfile.fireHazardActive && fightingPhase) {
    const interval = chaosProfile.fireHazardIntervalMs ?? 2400;
    const accum = (state.fireHazardTimerMs ?? 0) + effDtMs;
    if (accum >= interval) {
      const mapSize = runtime.map.size;
      const [r1, fx] = nextFloat(rngState);
      rngState = r1;
      const [r2, fy] = nextFloat(rngState);
      rngState = r2;
      const [r3, fr] = nextFloat(rngState);
      rngState = r3;
      const x = 80 + fx * Math.max(1, mapSize.x - 160);
      const y = 160 + fy * Math.max(1, mapSize.y - 250);
      const radius = 36 + fr * 26;
      const fireId = allocId();
      const patch: FireEntity = {
        id: fireId,
        x,
        y,
        radius,
        remainingMs: 3000,
        ownerId: PlayerId("__chaos__"),
        damagePerSecond: 13,
      };
      nextFirePatches[fireId] = patch;
      nextFireHazardTimerMs = accum - interval;
    } else {
      nextFireHazardTimerMs = accum;
    }
  } else if (chaosProfile.fireHazardActive) {
    nextFireHazardTimerMs = state.fireHazardTimerMs ?? 0;
  } else {
    nextFireHazardTimerMs = undefined;
  }

  // 4b. Emission charge fill (Emission Engine P0 — docs/emission-engine-goal.md).
  // ONE site by doctrine: every damage source this tick (projectile, chain,
  // bash, satellite, destructible blast, fire patch, storm) has already
  // drained its FINAL post-mitigation, post-chaos damage into `events` as
  // hit-confirmed — parried/shielded hits are suppressed before the push,
  // so this pass never credits refused damage. Attacker credit requires a
  // non-self attackerId; the victim always credits the taken side (the
  // killing blow included — participation is participation, and charge
  // persists through death by doctrine). Hangout emits no combat events,
  // but the guard keeps a future lobby damage source from quietly charging
  // meters. Charge mutates ONLY here, at cast, and at match creation —
  // any other writer is a bug (goal-doc invariant).
  if (!hangoutMode) {
    for (const ev of events) {
      if (ev.t !== "hit-confirmed" || ev.damage <= 0) continue;
      const victim = players[ev.victimId];
      if (victim) {
        players[ev.victimId] = {
          ...victim,
          abilityCharge: Math.min(
            EMISSION_CHARGE_MAX,
            victim.abilityCharge + ev.damage * EMISSION_FILL_PER_DAMAGE_TAKEN,
          ),
        };
      }
      const attackerId = ev.attackerId ?? null;
      if (attackerId !== null && attackerId !== ev.victimId) {
        const attacker = players[attackerId];
        if (attacker) {
          players[attackerId] = {
            ...attacker,
            abilityCharge: Math.min(
              EMISSION_CHARGE_MAX,
              attacker.abilityCharge + ev.damage * EMISSION_FILL_PER_DAMAGE_DEALT,
            ),
          };
        }
      }
    }
  }

  // Buff cleanup: revert expired pickup-buff fields to undefined so renderers
  // and combat code see "no buff" cleanly.
  let cleanedPlayers = clearExpiredBuffs(players, nextTick);

  // After projectile / destructible / fire resolution, players whose hp hit 0
  // are now `alive: false`. Drop their satellites in the same tick (no zombie
  // companions).
  let finalSatellites = despawnSatellitesForDeadOwners(nextSatellites, cleanedPlayers);

  // First-blood wager: fold this tick's award (if any) into the round-state
  // input BEFORE stepping the round machine, so round.ts's `next` scaffold
  // (which carries `firstBloodPlayerId` forward untouched) persists it from
  // here on. Also emit the informational event now that we know the tick's
  // final verdict.
  let roundStateForStep = state.round;
  if (firstBloodAwardThisTick !== null && state.round.firstBloodPlayerId === undefined) {
    roundStateForStep = { ...state.round, firstBloodPlayerId: firstBloodAwardThisTick };
    events.push({ t: "first-blood", playerId: firstBloodAwardThisTick });
  }

  // Per-round kill tally: fold this tick's qualifying player-killed events
  // into the round-state input BEFORE stepping the round machine, so a
  // buzzer-beater kill counts in this very tick's timeout resolution
  // (decideRoundWinner's most-kills rule). A kill = killerId non-null and
  // not the victim — void/storm/unattributed-burn deaths and self-kills
  // credit nobody. Single deterministic increment point: `events` is the
  // tick's full accumulated stream in sim order, and pure counting is
  // order-independent anyway. round.ts's `next` scaffold carries the tally
  // forward; the countdown→fighting transition resets it (same lifecycle
  // as firstBloodPlayerId).
  if (!hangoutMode) {
    let tally: Record<PlayerId, number> | null = null;
    for (const ev of events) {
      if (ev.t !== "player-killed") continue;
      if (ev.killerId === null || ev.killerId === ev.victimId) continue;
      tally ??= { ...(roundStateForStep.roundKills ?? {}) };
      tally[ev.killerId] = (tally[ev.killerId] ?? 0) + 1;
    }
    if (tally !== null) {
      roundStateForStep = { ...roundStateForStep, roundKills: tally };
    }
  }

  // 5. Round state machine. Delegate to the orchestrator when present;
  //    fall back to the inline stepRound call for tests that don't wire
  //    up a runtime orchestrator.
  const targetScore = resolveModeConfig(state.chaosModifierIds).targetScore;
  let roundResult;
  if (hangoutMode) {
    // Hangout mode never steps the round machine at all — no
    // countdown/round-over/drafting transitions, ever (plan A1). Pass the
    // (already-"fighting") round state straight through unchanged: no
    // events, no score/rng mutation, no player patches (so no cards are
    // ever granted). This is the single early-return the plan calls for —
    // round.ts itself is untouched.
    roundResult = { state: roundStateForStep, events: [], matchComplete: false };
  } else if (runtime.orchestrator) {
    // Sync the orchestrator from the world state before stepping, so any
    // external mutations (server card picks) are reflected. Sync with the
    // FOLDED round state (`roundStateForStep`) — plain `state.round` would
    // silently drop this tick's first-blood award and kill-tally increments
    // on the orchestrator path.
    runtime.orchestrator.syncFromWorld({ ...state, round: roundStateForStep });
    roundResult = runtime.orchestrator.step(cleanedPlayers, nextTick, rngState, effDtMs, targetScore);
  } else {
    roundResult = stepRound({
      state: roundStateForStep,
      players: cleanedPlayers,
      dtMs: effDtMs,
      targetScore,
      tick: nextTick,
      rngState,
    });
  }
  events.push(...roundResult.events);
  if (roundResult.rngState !== undefined) {
    rngState = roundResult.rngState;
  }

  // Fold draft-auto-pick patches into the player map. Only the `cards`
  // field is touched; everything else stays as cleanedPlayers had it.
  let patchedPlayers = cleanedPlayers;
  if (roundResult.playerPatches) {
    patchedPlayers = { ...cleanedPlayers };
    for (const [pid_, patch] of Object.entries(roundResult.playerPatches)) {
      const pid = pid_ as PlayerId;
      const existing = patchedPlayers[pid];
      if (!existing) continue;
      patchedPlayers[pid] = { ...existing, cards: patch.cards };
    }
  }

  // On round end, players need to respawn for the next round (if not match-over).
  // Note: with the drafting phase wired in, the `round-over → countdown`
  // transition only happens in legacy callers (no tick/rngState passed).
  // The normal path is `round-over → drafting → countdown`, and we still
  // want the respawn-on-countdown-entry trigger to fire there.
  let respawnedPlayers = patchedPlayers;
  if (roundResult.state.phase === "countdown" && state.round.phase !== "countdown") {
    respawnedPlayers = respawnAll(patchedPlayers, runtime.map);
    // Round transition wipes all satellites — players reactivate them by
    // firing again in the next round.
    finalSatellites = {};
    // Reset the fire-hazard accumulator on round transitions so each round
    // starts on a clean cadence.
    if (chaosProfile.fireHazardActive) {
      nextFireHazardTimerMs = 0;
    }
  }

  // Mid-round fast respawn (Jake ruled "A", 2026-07-17, reverting the
  // venue-era bench-until-bell): a death stamps `respawnAtTick`
  // (RESPAWN_DELAY_MS out); when it comes due during the FIGHTING phase the
  // player re-forms at a spawn seal. Never in sudden death — last one
  // standing is the money moment (design-pillars) — and never in hangout
  // (players are damage-immune there). Arena ADMISSION stays boundary-only:
  // venue-goal pillar 3 governs joiners, not the fallen. One stamp site
  // catches every death cause (projectile, chain, burn, storm, bash,
  // kill-plane) by diffing alive across the tick.
  if (!hangoutMode) {
    const roundNow = roundResult.state;
    let mutated: WorldState["players"] | null = null;
    const idsNow = Object.keys(respawnedPlayers).sort();
    for (const pid_ of idsNow) {
      const pid = pid_ as PlayerId;
      const p = respawnedPlayers[pid]!;
      const wasAlive = state.players[pid]?.alive ?? false;
      if (wasAlive && !p.alive && p.respawnAtTick === undefined) {
        const delayTicks = Math.ceil(RESPAWN_DELAY_MS / Math.max(1, effDtMs));
        mutated = mutated ?? { ...respawnedPlayers };
        mutated[pid] = { ...p, respawnAtTick: (nextTick + delayTicks) as Tick };
        continue;
      }
      if (
        !p.alive &&
        p.respawnAtTick !== undefined &&
        nextTick >= p.respawnAtTick &&
        roundNow.phase === "fighting" &&
        roundNow.suddenDeathActive !== true
      ) {
        const spawn =
          assignSpawnPoints(runtime.map, idsNow).get(pid as string) ?? { x: 0, y: 0 };
        mutated = mutated ?? { ...respawnedPlayers };
        mutated[pid] = respawnPlayerAt(p, spawn);
      }
    }
    if (mutated) respawnedPlayers = mutated;
  }

  const result: StepResult = {
    state: {
      ...state,
      tick: nextTick,
      rngState,
      players: respawnedPlayers,
      projectiles: projectilesAfterDestructibles,
      destructibles: nextDestructibles,
      firePatches: nextFirePatches,
      pickups: nextPickups,
      satellites: finalSatellites,
      round: roundResult.state,
      // chaosModifierIds are immutable across the match; pass through.
      chaosModifierIds: state.chaosModifierIds,
      fireHazardTimerMs: nextFireHazardTimerMs,
    },
    events,
    matchComplete: roundResult.matchComplete,
  };

  // J1-actual (Phase J1, opt-in via ?wasm-world=2): return the
  // wasm orchestrator's result instead of TS. Default off so
  // most visitors stay on the proven TS path; opt-in lets us
  // playtest the wasm orchestrator end-to-end in production.
  const wasmActual = maybeWasmActual(state, dtMs, inputsByPlayer, runtime);
  if (wasmActual) return wasmActual;

  // J1-monitor (opt-in via ?wasm-world-monitor=1): shadow-run
  // wasm + log divergence; doesn't change behavior.
  maybeWasmMonitor(state, dtMs, result);

  return result;
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
  // TS orchestrator is the DEFAULT prediction path again (2026-07-06
  // revert). Several real bugs were found and fixed downstream of the
  // 2026-07-05 Zig-default flip (WorldRuntime persistence, a matchHost
  // liveness backstop, a reconcile-path runtime wipe, a projectile
  // spawn-inside-geometry grace) — but live play over the actual funnel
  // (not this session's near-zero-latency localhost tests) kept surfacing
  // further, worse symptoms under Zig-as-authority: wrong-feeling movement,
  // shots not registering, general "unplayable" reports that didn't
  // reproduce for TS. Direct user call: TS was good, Zig isn't ready to be
  // the default yet. Zig orchestrator is opt-in via ?wasm-world=2 while that
  // work continues — do not flip this back without real, extensive human
  // playtesting (this session's automated Playwright checks repeatedly
  // passed while the live build was still broken).
  if (mode !== "2") return null;
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

let monitorActive = false;
function maybeWasmMonitor(
  inputState: WorldState,
  dtMs: number,
  tsResult: StepResult,
): void {
  // Browser-only: server runs sim with the SAME World.ts but
  // never visits a URL, so this short-circuits there.
  const w = (globalThis as { location?: { search: string } }).location;
  if (!w) return;
  let enabled = false;
  try {
    enabled =
      new URLSearchParams(w.search).get("wasm-world-monitor") === "1";
  } catch {
    return;
  }
  if (!enabled) return;
  if (monitorActive) return; // re-entry guard
  monitorActive = true;
  void (async () => {
    try {
      const mod = await import("./wasm/worldWasmBackend.js");
      if (!mod.isWasmWorldReady()) return;
      const wasmNext = mod.applyWasmWorldStepSync(inputState, dtMs);
      const tsState = tsResult.state;
      const drift = {
        tick: wasmNext.tick !== tsState.tick,
        roundPhase: wasmNext.round.phase !== tsState.round.phase,
        countdownMs:
          Math.abs(
            wasmNext.round.countdownRemainingMs -
              tsState.round.countdownRemainingMs,
          ) > 0.5,
        playerCount:
          Object.keys(wasmNext.players).length !==
          Object.keys(tsState.players).length,
      };
      if (
        drift.tick ||
        drift.roundPhase ||
        drift.countdownMs ||
        drift.playerCount
      ) {
        console.warn("[wasm-world-monitor] divergence", drift, {
          tick_ts: tsState.tick,
          tick_wasm: wasmNext.tick,
        });
      }
    } catch (err) {
      console.warn("[wasm-world-monitor] failed", err);
    } finally {
      monitorActive = false;
    }
  })();
}

/** The one respawn reset — shared by the round-boundary respawnAll and the
 *  mid-round fast respawn so the two paths can never drift. Slot cooldowns
 *  and abilityCharge deliberately persist (same law as round carry-over). */
function respawnPlayerAt(
  player: PlayerEntity,
  spawn: { x: number; y: number },
): PlayerEntity {
  return {
    ...player,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    health: 100,
    alive: true,
    crouching: false,
    shieldActive: false,
    fireCooldownMs: 0,
    jetpackFuel: JETPACK_MAX_FUEL,
    // Clear parry timers on respawn (mirrors MatchScene's
    // clearTemporaryCombatEffects). Shield charge resets to full.
    parryActiveUntilTick: undefined,
    parryCooldownUntilTick: undefined,
    parryFacing: undefined,
    shieldCharge: player.shieldMaxCharge ?? 100,
    // Element status effects clear on respawn.
    burnUntilTick: undefined,
    burnDps: undefined,
    burnTickLastApplied: undefined,
    freezeUntilTick: undefined,
    freezeMultiplier: undefined,
    // The pending mid-round respawn is consumed by re-forming.
    respawnAtTick: undefined,
  };
}

function respawnAll(
  players: WorldState["players"],
  map: MapDefinition,
): WorldState["players"] {
  const out: WorldState["players"] = {};
  const ids = Object.keys(players).sort();
  const spawnAssignment = assignSpawnPoints(map, ids);
  for (const pid_ of ids) {
    const pid = pid_ as PlayerId;
    const spawn = spawnAssignment.get(pid as string) ?? { x: 0, y: 0 };
    out[pid] = respawnPlayerAt(players[pid]!, spawn);
  }
  return out;
}
