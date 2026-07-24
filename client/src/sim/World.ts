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
  isHeadshot,
  HEADSHOT_DAMAGE_MULTIPLIER,
  type PlayerMovementMemory,
} from "./player.js";
import { buildFireEntity, destructibleAABB, stepDestructibles } from "./destructible.js";
import { stepFirePatches } from "./fire.js";
import { buildPaperDoubleEntity, paperDoubleAABB, stepPaperDoubles } from "./paperDouble.js";
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
  GEO_PRISM_FAN_CONE_RADIANS,
  GEO_PRISM_FAN_DAMAGE_MULTIPLIER,
  GEO_PRISM_FAN_RANGE_PX,
  GEO_LATTICE_ZONE_RADIUS_PX,
  GEO_LATTICE_ZONE_DURATION_MS,
  GEO_LATTICE_ZONE_DPS,
  GEO_RETURN_GLASS_SHIELD_REFUND,
  GEO_SLIP_NODE_RANGE_PX,
  GEO_RECOIL_STEP_HOP_SPEED,
  RESONANCE_WINDOW_MS,
  RESONANCE_CD_REFUND_FRACTION,
  KIN_BASTION_PULSE_SHIELD_REFUND,
  KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER,
  KIN_SUNSPIKE_DAMAGE,
  KIN_SUNSPIKE_RANGE_PX,
  KIN_SUNSPIKE_SPEED,
  KIN_JUDGMENT_AMP_MULTIPLIER,
  KIN_JUDGMENT_RANGE_PX,
  KIN_JUDGMENT_CONE_RADIANS,
  KIN_SEAL_DAMAGE_MULTIPLIER,
  KIN_SEAL_STAGGER_MS,
  KIN_SEAL_STAGGER_MULTIPLIER,
  KIN_AEGIS_SHARE_RADIUS_MULTIPLIER,
  KIN_AEGIS_SHARE_SOLO_KINDLING_FEED,
  KIN_PLANT_CHARGE_RANGE_PX,
  KIN_PLANT_CHARGE_SHIELD_REFUND,
  KIN_SHOCK_RING_HOP_VY,
  KIN_SHOCK_RING_ARM_WINDOW_MS,
  KIN_SHOCK_RING_DAMAGE,
  KIN_SHOCK_RING_RADIUS_PX,
  KIN_RALLY_LIGHT_RADIUS_PX,
  KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER,
  KIN_RALLY_LIGHT_MOVE_MULTIPLIER,
  KIN_KINDLED_RESOLVE_KINDLING_COST,
  KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER,
  KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION,
  KIN_BULWARK_STEP_RANGE_PX,
  KIN_STOMP_JUMP_DAMAGE,
  KIN_STOMP_JUMP_RADIUS_PX,
  SYZ_REGEN_HPS_DEFAULT,
  SYZ_REGEN_DURATION_TICKS_DEFAULT,
  SYZ_HASTE_MULTIPLIER_DEFAULT,
  SYZ_HASTE_DURATION_TICKS_DEFAULT,
  SYZ_DEVOTION_MAX,
  SYZ_DEVOTION_PER_BUFFED_ALLY_PER_SEC,
  SYZ_DEVOTION_PER_CURSED_ENEMY_PER_SEC,
  SYZ_DEVOTION_MAX_COUNTED_SOURCES,
  SYZ_SNOWBALL_BRAKE_PER_KILL_LEAD,
  SYZ_SNOWBALL_BRAKE_FLOOR,
  SYZ_WARD_DURATION_TICKS_DEFAULT,
  SYZ_WARD_ABSORB_DEFAULT,
  SYZ_SELF_LATTICE_ABSORB,
  SYZ_GLASS_WARD_ALLY_ABSORB,
  SYZ_GLASS_WARD_SELF_FALLBACK_ABSORB,
  SYZ_ALLY_SEARCH_RANGE_PX,
  SYZ_ENEMY_SEARCH_RANGE_PX,
  SYZ_BLEED_TITHE_DAMAGE,
  SYZ_BLEED_TITHE_LEECH_FRACTION,
  SYZ_BLEED_TITHE_SPEED,
  SYZ_BLEED_TITHE_HOMING_STRENGTH,
  SYZ_SEVERANCE_DAMAGE,
  SYZ_SEVERANCE_SPEED,
  SYZ_BORROWED_TIME_HEAL_ALLY,
  SYZ_BORROWED_TIME_DRAIN_ALLY,
  SYZ_BORROWED_TIME_HEAL_SELF,
  SYZ_BORROWED_TIME_DRAIN_SELF,
  SYZ_BORROWED_TIME_DEBT_DELAY_TICKS,
  SYZ_FOCUS_HEX_AMP_MULTIPLIER,
  SYZ_CONTAGION_RADIUS_PX,
  SYZ_CONTAGION_JUMP_RADIUS_PX,
  SYZ_FLOCK_PULSE_BASE_DAMAGE,
  SYZ_FLOCK_PULSE_PER_SOURCE_DAMAGE,
  SYZ_FLOCK_PULSE_RADIUS_PX,
  SYZ_FLOCK_PULSE_SLOW_MULTIPLIER,
  SYZ_FLOCK_PULSE_SLOW_DURATION_MS,
  SYZ_HASTE_GIFT_SELF_MULTIPLIER,
  SYZ_DRIFT_STEP_RANGE_PX,
  NINJA_UNDERCUT_HEALTH_THRESHOLD,
  NINJA_EDGE_STORM_CHARGES,
  NINJA_EDGE_STORM_WAVE_DAMAGE_MULTIPLIER,
  NINJA_NEEDLE_RANGE_PX,
  NINJA_NEEDLE_LUNGE_PX,
  NINJA_NEEDLE_DAMAGE,
  NINJA_NEEDLE_SPEED,
  NINJA_READ_MARK_RANGE_PX,
  NINJA_READ_MARK_AMP_MULTIPLIER,
  NINJA_RAZOR_ROUTE_READ_MARK_MS,
  NINJA_SHARD_RING_RADIUS_PX,
  NINJA_SHARD_RING_DAMAGE,
  NINJA_WALL_BLOOM_RADIUS_PX,
  NINJA_WALL_BLOOM_DAMAGE,
  NINJA_SECOND_WIND_HEAL,
  NINJA_SECOND_WIND_ENERGY,
  NINJA_RAZOR_ROUTE_BOOST_SPEED,
  NINJA_PAPER_DOUBLE_MAX_HEALTH,
  NINJA_PAPER_DOUBLE_LIFETIME_MS,
  NINJA_PAPER_DOUBLE_BURST_RADIUS_PX,
  NINJA_PAPER_DOUBLE_BURST_DAMAGE,
  NINJA_PAPER_DOUBLE_STATIONARY_SPEED_PX,
  NINJA_PAPER_DOUBLE_SWAP_MAX_DISPLACEMENT_PX,
  NINJA_FOOLED_DURATION_MS,
  NINJA_FOOLED_DAMAGE_MULTIPLIER,
} from "./constants.js";
import { stepProjectile, spawnProjectile, spawnSplit, makeHitSweepScratch, fillHitSweepScratch, type HitSweepScratch } from "./projectile.js";
import { SLOW_FIELD_DURATION_MS } from "./projectile.js";
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
import { stepWeapon, resolvePlayerBuild, maxHealthForPlayer } from "./weapon.js";
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
  isAllyBodyInWardCone,
  computeTeamPeelMitigation,
  WARD_PEEL_RADIUS_PX,
  KINDLING_MAX,
} from "./combat.js";
import { isAlly } from "./team.js";
import {
  buildStaticCache,
  platformToAABB,
  centerToAABB,
  aabbOverlap,
  sweepAABB,
  sweepAABBCached,
  type AABB,
  type StaticCollisionCache,
} from "./collision.js";
import {
  EntityId,
  PlayerId,
  Tick,
  InputSeq,
} from "./types.js";
import { MAX_ABILITY_SLOTS, classIdForArchetype, baseMaxHealthForArchetype } from "./data/cardTypes.js";
import { RoundOrchestrator } from "./RoundOrchestrator.js";
import { wasmHost } from "./wasm/wasmHost.js";
import { writeFireConfigsForState } from "./wasm/writeFireConfigs.js";
import { convertWasmEventsToTs } from "./wasm/convertWasmEvents.js";
import type {
  FireEntity,
  InputBitfield,
  InputFrame,
  MapDefinition,
  PaperDoubleEntity,
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
/** InputBit.Left/Right — read here only for Bulwark Step's facing-
 *  direction derivation (Kindled coverage-floor fast-follow, docs/axiom-
 *  deviations-audit.md, 2026-07-18); movement itself reads the same bits
 *  inside stepPlayer via player.ts's own private `Bit.Left`/`Bit.Right`,
 *  same "read here only for X" precedent as JumpBit above. */
const LeftBit = 1 << 0;
const RightBit = 1 << 1;
/** InputBit.Shield — read here only for the R1 row-16 ward-raise cancel
 *  edge (PALADIN MELEE section, 2026-07-24 wave 2); the shield mechanic
 *  itself reads the same bit inside combat.ts's own private `Bit.Shield`,
 *  same "read here only for X" precedent as JumpBit above. */
const ShieldBit = 1 << 8;

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
  /** Paladin Kindled Edge swing FSM, per player (class-overhaul-workboard.md
   *  chunk 2.1). Deliberately a SEPARATE map/type from `melee` above rather
   *  than a shared generic one — see the "PALADIN MELEE" section's header
   *  comment for the thin-vs-fork judgment call. Same host-only off-wire-
   *  truth contract as `melee`/`movement`. Only paladins ever get an entry. */
  paladinMelee: Map<PlayerId, PaladinMeleeMemory>;
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
  /** Destructible ids already hit by the CURRENT swing (venue-lobby-
   *  tableau fast-follow, 2026-07-18 — hangout-mode-only: real matches
   *  never populate this, since player-vs-player damage covers everything
   *  there). Same "once per swing" contract as `hitThisSwing`, separate
   *  Set because destructible ids and PlayerIds aren't the same brand. */
  hitDestructiblesThisSwing: Set<string>;
  /** Paper Double ids already hit by the CURRENT swing — same "once per
   *  swing" contract as hitThisSwing/hitDestructiblesThisSwing, separate Set
   *  for the same reason (a decoy's EntityId shares its number-space with
   *  destructibles/projectiles/etc but the Sets themselves stay
   *  semantically distinct rather than piggybacking on
   *  hitDestructiblesThisSwing's name). Live in both hangout AND real
   *  fights — unlike hitDestructiblesThisSwing, which is a hangout-only
   *  practice-dummy concern, a decoy is a real combat entity. */
  hitPaperDoublesThisSwing: Set<string>;
  /** Victim ids already dash-through-tagged during the CURRENT dash burst
   *  — cleared on the burst's rising edge so a body-cross fires once per
   *  dash per victim, not once per tick of overlap. */
  dashThroughTagged: Set<PlayerId>;
  /** Last tick's dashActiveMs > 0, to detect the dash burst's rising edge
   *  (for clearing dashThroughTagged) without reading movement memory's
   *  ms-precision timer directly. */
  wasDashing: boolean;
  /** Melee input buffer (slash-feel-ledger R1 row 1, 2026-07-24): ms
   *  remaining in the buffered-press window. A Fire press while the FSM is
   *  mid-swing (windup/active/recovery) is QUEUED here for MELEE_BUFFER_MS
   *  instead of being eaten, and fires at phase 0 — the same tick recovery
   *  expires, so mashing never loses a swing and a queued re-swing has no
   *  dead tick ("smooth on retrig", Jake's hard constraint). 0 = nothing
   *  queued. Latest press wins (a second press mid-swing re-arms the
   *  window and overwrites the stored aim). */
  bufferedMs: number;
  /** Cursor point (absolute, same shape as the input edge's aimX/aimY)
   *  captured at the buffered press tick — the queued swing fires toward
   *  where the player AIMED WHEN THEY PRESSED, resolved against the
   *  attacker's position at fire time. */
  bufferedAimX: number;
  bufferedAimY: number;
  /** Razor Route (Interstice catalog v1, movement role): true for the
   *  duration of the CURRENT dash burst if `razorRouteUntilTick` was live
   *  the moment this burst started (the velocity boost + "marks Read on
   *  cross" both key off this, not off `razorRouteUntilTick` itself, which
   *  is cleared at dash-start — see World.ts's dash-through section). Reset
   *  false the moment the burst ends OR the first victim is Read-tagged
   *  ("one body, one lie" — one mark per empowered dash). Host-only, same
   *  off-wire contract as `wasDashing`/`dashThroughTagged`. */
  razorRouteActiveDash: boolean;
};

export function freshNinjaMeleeMemory(): NinjaMeleeMemory {
  return {
    phase: 0,
    phaseMs: 0,
    aimX: 1,
    aimY: 0,
    hitThisSwing: new Set(),
    hitDestructiblesThisSwing: new Set(),
    hitPaperDoublesThisSwing: new Set(),
    dashThroughTagged: new Set(),
    wasDashing: false,
    razorRouteActiveDash: false,
    bufferedMs: 0,
    bufferedAimX: 0,
    bufferedAimY: 0,
  };
}

/** 0 = idle/ready, 1 = windup, 2 = active (hit-checked every tick), 3 =
 *  recovery (endlag). Same 4-phase shape as `NinjaSlashPhase` — the FSM
 *  SHAPE is shared conceptually (both are "commit frames you can feel"
 *  swing verbs), but see "PALADIN MELEE" below for why the TYPE isn't. */
export type PaladinEdgePhase = 0 | 1 | 2 | 3;

/**
 * Per-player Kindled Edge memory — Paladin's melee swing FSM, off-wire
 * source of truth (class-overhaul-workboard.md chunk 2.1). Trimmed relative
 * to `NinjaMeleeMemory`: no `dashThroughTagged`/`wasDashing` (Paladin has no
 * dash-i-frame-evasion verb — that's ninja's defense identity, not
 * Kindled's; Kindled's defense verb is Kindled Ward, an entirely separate
 * held-input mechanic in combat.ts, not part of this FSM at all), and no
 * wave-spawn bookkeeping (Kindled Edge doesn't emit an aftermath projectile
 * — "tighter arc, harder hit" is the whole verb, no ranged rider).
 */
export type PaladinMeleeMemory = {
  phase: PaladinEdgePhase;
  /** ms remaining in the current phase; irrelevant when phase === 0. */
  phaseMs: number;
  /** Swing direction captured at windup start (unit vector) — same
   *  "doesn't steer mid-swing" reasoning as NinjaMeleeMemory.aimX/aimY. */
  aimX: number;
  aimY: number;
  /** Victim ids already hit by the CURRENT swing's active window — same
   *  "hit-checked every tick, once per victim per swing" contract as
   *  NinjaMeleeMemory.hitThisSwing. */
  hitThisSwing: Set<PlayerId>;
  /** Destructible ids already hit by the CURRENT swing — same hangout-
   *  mode-only contract as NinjaMeleeMemory.hitDestructiblesThisSwing. */
  hitDestructiblesThisSwing: Set<string>;
  /** Paper Double ids already hit by the CURRENT swing — same contract as
   *  NinjaMeleeMemory.hitPaperDoublesThisSwing (live in both hangout and
   *  real fights, unlike hitDestructiblesThisSwing). Paladin melee can pop
   *  a NINJA's decoy just as readily as the ninja's own blade can — no
   *  classId gate, matching how any class's projectiles already can. */
  hitPaperDoublesThisSwing: Set<string>;
  /** Melee input buffer — same contract as NinjaMeleeMemory.bufferedMs
   *  (R1 row 1 is BOTH classes, one 100ms window). */
  bufferedMs: number;
  /** Same contract as NinjaMeleeMemory.bufferedAimX/bufferedAimY. */
  bufferedAimX: number;
  bufferedAimY: number;
  /** SHIELD BASH chain position (2026-07-24, ledger design-decision
   *  block): 0/1 = blade swings, 2 = the NEXT swing is the BASH. Advances
   *  per STARTED swing (whiffs count — cadence is rhythm, not
   *  hit-confirm) at the recovery→idle transition; resets to 0 after
   *  KIN_BASH_CHAIN_GAP_MS of idle or on death. Kindled-only — ninja's
   *  memory has no chain. */
  chainIndex: number;
  /** ms spent idle since the last swing's recovery ended — the chain-
   *  reset clock. Only meaningful while phase === 0. */
  chainGapMs: number;
  /** Last tick's `dashActiveMs > 0` — the dash burst's rising edge, for
   *  the R1 row-16 cancel window (2026-07-24 wave 2). NOT the ninja's
   *  dash-through debounce (Paladin still has no dash-through verb —
   *  the trimming note in this type's header stands); this field only
   *  answers "did a dash START this tick" for the recovery cancel. */
  wasDashing: boolean;
};

export function freshPaladinMeleeMemory(): PaladinMeleeMemory {
  return {
    phase: 0,
    phaseMs: 0,
    aimX: 1,
    aimY: 0,
    hitThisSwing: new Set(),
    hitDestructiblesThisSwing: new Set(),
    hitPaperDoublesThisSwing: new Set(),
    bufferedMs: 0,
    bufferedAimX: 0,
    bufferedAimY: 0,
    chainIndex: 0,
    chainGapMs: 0,
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
// --SLASH_WINDUP_MS--> active(2) --radial contact gate, then arc hit-checked
// every tick for the rest of SLASH_ACTIVE_MS--> recovery(3) [wave spawns on
// this transition] --SLASH_RECOVERY_MS
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
 *  (~4.65/s, see the commit-frame constants below) is far higher than a
 *  dash-bash's (~0.33/s, gated by DASH_COOLDOWN_MS=3000) — per-hit damage is
 *  tuned down so sustained arc DPS (~51) lands in the same neighbourhood as
 *  bash's burst, not multiplies it.
 *  2026-07-20 balance pass ("hits faster, same DPS, make it elegant"): the
 *  whole commit-frame trio below was scaled by a uniform 0.5x alongside
 *  this damage halving (22->11) — same DPS (~51, unchanged, that's the
 *  point), same internal windup:active:recovery shape, just delivered in
 *  half-sized, twice-as-frequent hits. One scale factor, applied to every
 *  timing AND damage number together, so DPS-neutrality falls out of the
 *  arithmetic instead of needing a separate re-tune-and-check pass. The
 *  render-side BLADE_SWING_MS (meleeTiming.ts) and NINJA_PAPER_DOUBLE_MAX_HEALTH
 *  (constants.ts, "pops in exactly one slash") were scaled the same way to
 *  keep the visual and the paper-double invariant in lockstep. */
const SLASH_DAMAGE = 11;
/** Gentle shove + pop on a landed arc hit — "hit-stop + scrape... victim
 *  micro-knock" (character-sheets-v1.md), NOT a heavy bash-style launch. */
const SLASH_KNOCKBACK = 260;
const SLASH_KNOCK_UP = 60;

// Commit-frame structure (ms). "Commit frames you can feel" / "no free
// cast" — recovery IS the re-swing gate; there is no additional ability-
// style cooldown layered on top (this is the always-on chassis verb, not a
// card-gated active). Total cycle 215ms (~4.65 swings/sec cap) — halved
// 2026-07-20 (was 430ms/~2.3/s) alongside SLASH_DAMAGE so DPS holds exactly
// (11 / 0.215s == 22 / 0.430s); no longer tracks dash's ~410ms rhythm,
// that coincidence wasn't load-bearing.
const SLASH_WINDUP_MS = 60; // the readable tell before the arc goes live
const SLASH_ACTIVE_MS = 45; // contact-gated hit checks, then a late-entry tail
const SLASH_RECOVERY_MS = 110; // endlag; whiffing costs

/** Melee input buffer window (ms), BOTH classes — slash-feel-ledger R1 row
 *  1 (SF6 4-8f / Smash Ult 9f / For Honor's universal 100ms). A Fire press
 *  during windup/active/recovery queues in NinjaMeleeMemory.bufferedMs /
 *  PaladinMeleeMemory.bufferedMs and fires at phase 0 instead of being
 *  eaten. 100ms = 6 ticks @60Hz. Mirrored in sim/src/world.zig
 *  (MELEE_BUFFER_MS) — sim behavior, both sides must agree. */
const MELEE_BUFFER_MS = 100;
/** Same fraction of SLASH_ACTIVE_MS as before the 2026-07-20 halving
 * (44/90 ~= 22/45) — the blade still crosses the aim radius at the same
 * relative point in the swing, just sooner in absolute ms. Do not damage
 * during the overhead coil before this gate. */
const SLASH_CONTACT_DELAY_MS = 22;

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

// ── PALADIN MELEE (2026-07-18) — Kindled Edge, class-overhaul-workboard.md
// chunk 2.1. Reuses `isBodyInMeleeArc` (below) VERBATIM — the actual "arc
// hit-detection primitive" the task singles out — with Paladin's own
// numbers (tighter arc, harder hit). The primitive genuinely is thin: same
// function, zero forking, zero paladin-specific branches inside it.
//
// What's NOT shared with ninja's FSM, and why that's a deliberate call and
// not a silent fork: Kindled Edge's per-tick swing STATE (PaladinMeleeMemory
// above) is a parallel structure, not a generalized "MeleeConfig" runner
// shared with `NinjaMeleeMemory`. The two verbs diverge in real behavior,
// not just numbers:
//   - Ninja's slash spawns a WAVE projectile aftermath; Edge does not (no
//     ranged rider — "tighter arc, harder hit" is the whole verb).
//   - Ninja's slash grants ENERGY on a landed hit ("aggression feeds the
//     rack"); Edge grants NOTHING on a landed hit — Kindled's resource
//     (Kindling) comes exclusively from Ward absorbing damage, not from
//     Edge dealing it ("Defense IS the engine", classes-goal.md). Landing
//     a hit and blocking a hit are opposite resource triggers for these
//     two classes, not the same trigger with different numbers.
//   - Ninja's melee section also owns dash-through body-cross detection,
//     entangled with the FSM's `wasDashing` debounce; Paladin has no
//     analogous verb at all.
// A single generalized FSM runner covering both would need 3+ per-class
// behavior hooks (spawnsWave?, grantsEnergyOnHit?, doesDashThrough?) for
// what's actually a small, easy-to-read block of tick logic either way —
// that's speculative generality for exactly two call sites, not a real
// abstraction win. Flagging this explicitly per the task's own instruction
// ("flag that rather than forking silently") rather than silently
// duplicating the FSM shape without comment.
//
// Gated on classId === "paladin" (classIdForArchetype) EVERYWHERE below —
// zero cost, zero behavior change for the other three chassis (see
// paladinMelee.test.ts's classId-gating proof, mirroring
// ninjaMeleeGating.test.ts's pattern).

/** Melee arc reach (px, centre-to-centre). Slightly LONGER than ninja's
 *  SLASH_RANGE (78) — a heavier weapon (docs/character-sheets-v1.md: DI
 *  Crusader heaven-tank read, not dual daggers) plausibly reaches a touch
 *  further even as its arc narrows. Not a huge delta; "tighter arc, harder
 *  hit" is the load-bearing pair of numbers, range is a minor accompanying
 *  bump. First-draft/playtest-pending. */
const EDGE_RANGE = 84;
/** Full cone width in front of the swing's captured aim direction. TIGHTER
 *  than ninja's SLASH_ARC_RADIANS (100° = 5π/9) per the task's explicit
 *  "tighter arc" requirement — 70° = 7π/18, narrower cone consistent with a
 *  heavier, more committed swing (a big weapon reads as more precise/
 *  telegraphed, not more forgiving, versus dual light blades). First-
 *  draft/playtest-pending. */
const EDGE_ARC_RADIANS = (7 * Math.PI) / 18;
/** A landed arc hit. NOTICEABLY more than ninja's SLASH_DAMAGE (22) per the
 *  task's explicit "harder hit" requirement — chosen alongside the commit-
 *  frame constants below so sustained arc DPS (EDGE_DAMAGE / cycle seconds,
 *  see below) lands in the SAME neighbourhood as ninja's own ~51 sustained
 *  slash DPS, not above it: Paladin's tank identity is delivered through
 *  Ward's mitigation (combat.ts WARD_MITIGATION_FRACTION), not through
 *  out-damaging every other chassis on top of also out-tanking them ("higher
 *  effective toughness via mitigation, not raw damage output" — task
 *  doctrine). 32 damage / 0.65s cycle ≈ 49.2 DPS, matching ninja's ~51.
 *  First-draft/playtest-pending. */
const EDGE_DAMAGE = 32;
/** Meaningfully more than ninja's SLASH_KNOCKBACK/SLASH_KNOCK_UP (260/60)
 *  per "harder hit... more knockback than Ninja's slash" — a heavy weapon
 *  shoves harder, short of BASH's full lance-charge launch (660/240, a
 *  wholly different distinct move gated by the 3s dash cooldown). First-
 *  draft/playtest-pending. */
const EDGE_KNOCKBACK = 420;
const EDGE_KNOCK_UP = 110;

// Commit-frame structure (ms). Heavier than ninja's (120/90/220, total 430ms
// ~2.3 swings/sec) on every axis — "heavier weapon read" per the task:
// longer windup (a bigger, more visible tell — fair warning for a harder
// hit), similar active window, and noticeably longer recovery (whiffing a
// big committed swing should cost more than whiffing a quick dagger flick).
// Total cycle 650ms (~1.54 swings/sec cap) — see EDGE_DAMAGE's doc comment
// for how this cadence was chosen alongside the damage number to land Edge's
// sustained DPS in the same neighbourhood as ninja's, not above it. No
// additional ability-style cooldown layered on top — same "recovery IS the
// re-swing gate" contract as ninja's slash (this is the always-on chassis
// verb, not a card-gated active).
const EDGE_WINDUP_MS = 200;
const EDGE_ACTIVE_MS = 110;
const EDGE_RECOVERY_MS = 340;
/** Renderer contact is t=.5364 of its 560ms sentence = 300ms. Relative to
 * the 200ms authoritative windup, the heavy edge meets the aim radius 100ms
 * into active, leaving a short late-contact tail before recovery. */
const EDGE_CONTACT_DELAY_MS = 100;

// ── KINDLED SHIELD BASH (2026-07-24, slash-feel-ledger "THE SHIELD IS IN
// THE CHAIN" + the design-decision block) — every THIRD Edge swing is a
// shield BASH: the chain's blunt punctuation. Fixed cadence
// (swing·swing·BASH) won over contextual/economy-coupled candidates —
// plannable for the attacker, countable for the defender, and it keeps
// Kindling's "Defense IS the engine" economy uncoupled. Payoff is CONTROL,
// not DPS (the banked balance finding: perfectly-played melee loses the
// point-blank DPS trade): damage stays under half an Edge hit, the
// knockback is the biggest in the game, and the victim eats a brief
// stagger that breaks return fire. Same FSM phase timings as Edge
// (windup/active/recovery unchanged — the chain keeps one rhythm), but
// the slab LEADS: earlier contact gate, shorter reach, wider blunt arc.
const SHIELD_BASH_RANGE = 62; // px — shortest melee reach in the game (slab, not blade)
const SHIELD_BASH_ARC_RADIANS = (5 * Math.PI) / 9; // 100° — a wide blunt wall vs Edge's 70° blade
const SHIELD_BASH_DAMAGE = 14; // ≤ half an Edge hit (32) — control verb, not a DPS verb
const SHIELD_BASH_KNOCKBACK = 760; // px/s — biggest in the game, > dash-bash's 660
const SHIELD_BASH_KNOCK_UP = 260; // > dash-bash's 240 pop — launched, not slid
const SHIELD_BASH_CONTACT_DELAY_MS = 60; // slab leads — earlier than Edge's 100ms gate
/** Brief victim stagger on a landed bash — reuses the slowedUntilTick /
 *  slowMultiplier machinery (Unbroken Seal's own stagger substrate), NOT a
 *  new status system. Seal's stronger 900ms/0.25 stagger takes precedence
 *  when both would apply to one hit. */
const SHIELD_BASH_STAGGER_MS = 300;
const SHIELD_BASH_STAGGER_MULTIPLIER = 0.55;
/** Idle gap (ms, after recovery ends) beyond which the bash chain resets
 *  to position 0 — a cold engage always opens with blades; the bash is
 *  earned by sustained commitment. 350ms ≈ the render combo window's
 *  1000ms start-to-start minus the 650ms swing cycle, so the sim chain
 *  and the render's combo read agree on what "still chaining" means. */
const KIN_BASH_CHAIN_GAP_MS = 350;

// ── KINDLED CANCEL WINDOW (2026-07-24 wave 2, slash-feel-ledger R1 row
// 16) — dash/ward may cancel the FINAL 40% of Edge recovery (from 204ms
// of the 340ms in). The cancel is a defensive escape hatch, NOT a combo
// tech: it triggers only on a dash that STARTS or a Ward that RAISES
// (rising edges landing inside the tail — a dash begun earlier, or a
// shield held since before the swing, does not cancel), and a QUEUED
// SWING WINS over a cancel (bufferedMs > 0 suppresses it) — R1 row 1's
// "mashing never eats a swing" is absolute, the bash cadence stays
// countable for the defender, and no dash-cancel cycle-compression DPS
// tech exists by construction. A cancel still advances the chain (the
// swing's beat happened; canceling the tail is not a chain reset).
// Mirrored in sim/src/world.zig (KIN_CANCEL_TAIL_FRACTION) — sim
// behavior, both sides must agree.
const KIN_CANCEL_TAIL_FRACTION = 0.4;

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
  return isAABBInMeleeArc(originX, originY, aimAngle, halfArc, range, victim.x, victim.y, playerHitboxAABB(victim));
}

/**
 * Generalized core of `isBodyInMeleeArc` (perf audit / venue-lobby-tableau
 * fast-follow, 2026-07-18): the player-specific wrapper above computes its
 * own AABB via `playerHitboxAABB` and delegates here, so a destructible
 * (or any other AABB'd entity — `destructibleAABB(d)` returns the same
 * `{x,y,w,h}` shape) can reuse the EXACT same 5-point sample-and-test
 * geometry instead of duplicating it. Same contract: hit if ANY of
 * center + 4 corners lands within `range` of the origin AND within
 * `halfArc` of `aimAngle`.
 */
function isAABBInMeleeArc(
  originX: number,
  originY: number,
  aimAngle: number,
  halfArc: number,
  range: number,
  centerX: number,
  centerY: number,
  box: { x: number; y: number; w: number; h: number },
): boolean {
  const points: Array<[number, number]> = [
    [centerX, centerY],
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

// ── TEAM PEEL (2026-07-18, class-overhaul-workboard.md chunk 2.4) ──────────
// See combat.ts's "TEAM PEEL" header comment for the geometry definition
// (`isAllyBodyInWardCone`: victim's body in the warder's frontal cone AND
// within a "standing next to them" radius) and why it's a DIFFERENT check
// from Ward's own self-cone test (`isSourceInWardCone`), not a trivial
// reuse. This function is the one place that COMBINES that pure geometry
// test with `isAlly` (team.ts) to answer "is there an eligible warding
// ally for this victim right now" — team-membership logic itself stays
// entirely inside `team.ts`'s `isAlly`, never reimplemented here.
/**
 * Scan for the closest OTHER player who is: alive, a paladin, currently
 * holding Kindled Ward (`shieldActive`), an ally of `victim` (`isAlly`,
 * team.ts), and whose Ward shadow (`isAllyBodyInWardCone`) covers
 * `victim`'s current position. Returns `null` when no such warder exists —
 * including, by construction, every solo/FFA victim (`isAlly` is false
 * for any pairing when either side lacks a `teamId`, per team.ts's own
 * doc comment), so this is a true no-op outside team modes.
 *
 * A warder never peels for themselves (self-ward, combat.ts's
 * `isSourceInWardCone`, is the separate existing mechanism for that).
 * Multiple eligible warders (needs 2+ paladins on one team, both holding
 * Ward, both in range) resolve to the CLOSEST one, scanned over
 * `sortedIds` for the same cross-platform (client/server) determinism
 * guarantee every other multi-candidate scan in this file already uses
 * (facet-break's target search is the precedent).
 *
 * Aegis Share (Kindled catalog v1): a candidate warder with a live
 * `aegisShareUntilTick` window gets its peel radius widened by
 * `KIN_AEGIS_SHARE_RADIUS_MULTIPLIER` for this check only — the window
 * lives on the WARDER, not the victim, so it's read directly off the
 * candidate being tested.
 */
function findTeamPeelWarder(
  victim: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  sortedIds: readonly PlayerId[],
  tick: Tick,
): PlayerEntity | null {
  if (victim.teamId === undefined) return null;
  let best: PlayerEntity | null = null;
  let bestDist = Infinity;
  for (const wid of sortedIds) {
    if (wid === victim.id) continue;
    const candidate = players[wid];
    if (!candidate) continue;
    if (!candidate.alive || !candidate.shieldActive) continue;
    if (classIdForArchetype(candidate.characterId) !== "paladin") continue;
    if (!isAlly(candidate, victim)) continue;
    const dx = victim.x - candidate.x;
    const dy = victim.y - candidate.y;
    const dist = Math.hypot(dx, dy);
    const aegisActive =
      candidate.aegisShareUntilTick !== undefined && candidate.aegisShareUntilTick > tick;
    const radiusPx = aegisActive
      ? WARD_PEEL_RADIUS_PX * KIN_AEGIS_SHARE_RADIUS_MULTIPLIER
      : WARD_PEEL_RADIUS_PX;
    if (!isAllyBodyInWardCone(candidate, victim, radiusPx)) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/**
 * Apply team peel to a hit that landed on `victim` for `rawDamage`, IFF an
 * eligible warding ally exists (`findTeamPeelWarder`) — callers are
 * responsible for only invoking this on a hit no OTHER mitigation already
 * fully handled (self-Ward, parry/dash-bash deflect, and the generic
 * shield are all upstream, higher-priority outcomes at every call site
 * below; peel only ever extends Ward's reach to a hit that would
 * otherwise have landed raw on the victim). Mutates `players[warder.id]`
 * in place (grants Kindling — "your block, your Kindling", same contract
 * as self-ward) and returns the mitigated damage + a ready-to-push
 * SimEvent, or `null` when peel doesn't apply (including every non-team
 * hit, by construction — see `findTeamPeelWarder`).
 */
function applyTeamPeel(
  victim: PlayerEntity,
  rawDamage: number,
  players: Record<PlayerId, PlayerEntity>,
  sortedIds: readonly PlayerId[],
  tick: Tick,
): { damage: number; event: SimEvent } | null {
  if (rawDamage <= 0) return null;
  const warder = findTeamPeelWarder(victim, players, sortedIds, tick);
  if (!warder) return null;
  const { mitigatedDamage, damageBlocked, kindlingGranted } =
    computeTeamPeelMitigation(rawDamage);
  const kindling = Math.min(KINDLING_MAX, (warder.kindling ?? 0) + kindlingGranted);
  players[warder.id] = { ...warder, kindling };
  return {
    damage: mitigatedDamage,
    event: {
      t: "team-peel-absorbed",
      victimId: victim.id,
      warderId: warder.id,
      damageBlocked,
      kindlingGranted,
    },
  };
}

// ── RALLY LIGHT (2026-07-18, class-overhaul-workboard.md chunk 2.6 fast-
// follow) ────────────────────────────────────────────────────────────────
// Read-only continuous aura — see constants.ts's KIN_RALLY_LIGHT_* header
// comment for why this needs NO cross-player write (and therefore no
// pendingSyzygistCasts-style deferred queue): every beneficiary only ever
// reads a nearby SOURCE's own `rallyLightUntilTick` field and multiplies
// its OWN speed/damage. Solo/FFA clause: a player always counts as their
// OWN eligible source (self at distance 0), so `isAlly` is only consulted
// for OTHER candidates — closes the axiom-deviations audit's AX.2
// "Rally Light is solo-dead" flag.
//
// Takes a generic `players` record so it works identically from BOTH call
// shapes this file already has: the main per-player loop's stable
// pre-tick `state.players` (movement speed, read during the aura
// BENEFICIARY's own turn) and the post-loop hit-resolution passes' live
// mutable `players` (damage amp, alongside `applyTeamPeel`) — same
// generic-over-the-players-record shape `findTeamPeelWarder`/
// `findNearestAlly` already use.
function hasRallyLightSource(
  beneficiary: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
): boolean {
  if (
    beneficiary.rallyLightUntilTick !== undefined &&
    beneficiary.rallyLightUntilTick > tick
  ) {
    return true;
  }
  for (const other of Object.values(players)) {
    if (other.id === beneficiary.id || !other.alive) continue;
    if (other.rallyLightUntilTick === undefined || other.rallyLightUntilTick <= tick) continue;
    if (!isAlly(other, beneficiary)) continue;
    const dist = Math.hypot(other.x - beneficiary.x, other.y - beneficiary.y);
    if (dist <= KIN_RALLY_LIGHT_RADIUS_PX) return true;
  }
  return false;
}

/** Damage multiplier for a hit dealt BY `attacker` — 1 (no-op) unless a live
 *  Rally Light aura (self or ally) currently covers them. */
function rallyLightDamageMultiplier(
  attacker: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
): number {
  return hasRallyLightSource(attacker, players, tick) ? KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER : 1;
}

// ── KINDLED RESOLVE (Kindled coverage-floor fast-follow, docs/axiom-
// deviations-audit.md "Kindled (paladin) — two structural gaps",
// 2026-07-18) ────────────────────────────────────────────────────────────
// Self-only buff — no aura/ally reach at all (constants.ts's KIN_KINDLED_
// RESOLVE_* header comment has the full "why this differs from Rally
// Light" reasoning). Both helpers are pure no-ops (return the input
// unchanged) for any player without a live window, so they're safe to call
// unconditionally at every site the equivalent Rally Light/stagger-write
// checks already run at — zero behavior change for every non-Paladin (or
// Paladin-without-the-card) player.
/** Damage multiplier for a hit dealt BY `attacker` — 1 (no-op) unless a
 *  live Kindled Resolve window currently covers them. */
function kindledResolveDamageMultiplier(attacker: PlayerEntity, tick: Tick): number {
  return attacker.kindledResolveUntilTick !== undefined && attacker.kindledResolveUntilTick > tick
    ? KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER
    : 1;
}

/** Damage multiplier for a hit landing ON `victim` — 1 (no-op) unless a live
 *  Fooled window (Paper Double's burst debuff, types.ts's `fooledUntilTick`
 *  field comment) currently covers them. Victim-side, unlike every other
 *  small multiplier helper in this file (which read the ATTACKER's own
 *  window) — Fooled is a status any attacker's hit can exploit, not a bond
 *  tied to one specific attacker. */
function fooledDamageMultiplier(victim: PlayerEntity, tick: Tick): number {
  return victim.fooledUntilTick !== undefined && victim.fooledUntilTick > tick
    ? NINJA_FOOLED_DAMAGE_MULTIPLIER
    : 1;
}

/** Softens an incoming stagger/slow `multiplier` toward 1 (less severe)
 *  when `victim` currently holds a live Kindled Resolve window — "resist",
 *  not immune (constants.ts's KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION
 *  doc comment). Returns `multiplier` unchanged for every victim without
 *  the buff. */
function applyKindledResolveStaggerResist(
  victim: PlayerEntity,
  multiplier: number,
  tick: Tick,
): number {
  if (victim.kindledResolveUntilTick === undefined || victim.kindledResolveUntilTick <= tick) {
    return multiplier;
  }
  return multiplier + (1 - multiplier) * KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION;
}

// (BASTION — docs/card-pool-v2.md #28, exclusive: Paladin — used to live
// here as `applyBastionAura`, a passive-aura victim-side mitigation +
// Kindling-feed check called from every hit-resolution site below. Cut
// entirely 2026-07-19 alongside its sibling exclusives Crater/Retort — see
// cards.ts's cut note above the old crater/retort/bastion card
// definitions. Every call site below was removed too, not stubbed.)

// ── SYZYGIST STATUS SUBSTRATE (2026-07-18, class-overhaul-workboard.md
// chunk 3.1: "Status substrate extension (buffs, not just debuffs)") ──────
// Priest/Syzygist needs the OPPOSITE direction from the existing debuff
// substrate (burn/freeze/slow): a caster applying a BUFF to a DIFFERENT
// player's entity, not just their own. Every window-buff field in this
// file up to this chunk (tithe, veil, sunlance, overclock, resonance,
// judgment/seal/aegis) only ever mutates the CASTER's own `nextEntity` —
// nothing before this chunk lets one player's cast modify a different
// player's PlayerEntity for a BUFF (the closest precedent is `applyTeamPeel`
// just above, which mutates `players[warder.id]` — but that's the sim
// GRANTING a resource to a bystander mid-hit-resolution, not a player's
// CAST targeting an ally by choice).
//
// These two functions are the mechanism, not the ability: no Priest card or
// catalog entry calls them yet (that's chunk 3.4 — see
// docs/class-ability-catalogs-v1.md's "Borrowed Time"/"Haste Gift"). They
// exist so the mechanism itself — "can player A's cast legally write a
// buff onto player B's entity, and does the sim then apply it correctly
// over time" — can be proven with a direct unit test
// (`__tests__/syzygistBuffs.test.ts`) against a bare `players` record, the
// same "prove the mechanism, don't author the content" scope this chunk's
// workboard entry describes for the Priest's own solo-floor chunk (0.3).
//
// Both functions:
//   - Are gated on `isAlly(caster, target)` (team.ts) — the ONE sanctioned
//     way to check team membership. In FFA/solo (no `teamId` on either
//     player), `isAlly` is always false, so these calls are unconditional
//     no-ops for every match that doesn't have team identity — exactly
//     mirroring `findTeamPeelWarder`'s "every solo/FFA hit is unaffected by
//     construction" guarantee. Note `isAlly(a, a)` is `true` when `a` has a
//     `teamId` (team.ts's own documented self-ally precedent) — a duos
//     Syzygist CAN self-target through this gate (a real, intended use —
//     "self half if solo" per Haste Gift's catalog entry, docs/class-
//     ability-catalogs-v1.md); a caster with no `teamId` (solo/FFA) cannot
//     buff ANYONE, including themselves, through this mechanism — buffs are
//     teams-native by construction, exactly as docs/classes-goal.md's MANA
//     section states ("priest = devotion, generated by buff/heal uptime on
//     others... teams-native").
//   - Refuse a dead target (a dead ally regenerating/hasting is meaningless
//     — they respawn through a separate code path).
//   - Mutate `players[target.id]` in place and return `true` on success,
//     `false` on a no-op — same boolean-outcome shape as the rest of this
//     file's mid-loop mutators; callers that need "why didn't this apply"
//     detail can re-check `isAlly`/`alive` themselves, same as
//     `applyTeamPeel`'s callers do for its own preconditions.

/**
 * Apply (or refresh) a regen (heal-over-time) window onto `target`, IFF
 * `target` is an ally of `caster` (`isAlly`, team.ts) and alive. Refreshing
 * an already-active window simply overwrites the tick/rate (no stacking —
 * same "last cast wins" convention as every other window-buff field on
 * PlayerEntity). The actual per-tick healing happens in `stepWithRuntime`'s
 * element-status-effects pass (mirrors the burn DoT tick exactly, opposite
 * sign, capped at the target's real max health — `maxHealthForPlayer`) —
 * this function only opens the window.
 */
export function applyRegenToAlly(
  caster: PlayerEntity,
  target: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
  regenHps: number = SYZ_REGEN_HPS_DEFAULT,
  durationTicks: number = SYZ_REGEN_DURATION_TICKS_DEFAULT,
): boolean {
  if (!target.alive) return false;
  if (!isAlly(caster, target)) return false;
  players[target.id] = {
    ...target,
    regenUntilTick: (tick + 1 + durationTicks) as Tick,
    regenHps,
    // Stamped at application, same as the Burn DoT's own apply site
    // (World.ts's fire-element hit branch: `burnTickLastApplied: nextTick`)
    // — the first real heal tick lands a full ONE_SECOND_TICKS after THIS
    // tick, not instantly on the tick the window opens.
    regenTickLastApplied: tick,
    // Devotion attribution (class-overhaul-workboard.md chunk 3.2) — see
    // regenSourceId's doc comment in types.ts.
    regenSourceId: caster.id,
  };
  return true;
}

/**
 * Apply (or refresh) a haste window onto `target`, IFF `target` is an ally
 * of `caster` (`isAlly`, team.ts) and alive. Same refresh-overwrites, no-
 * stacking convention as `applyRegenToAlly`. The move-speed effect is read
 * live off `hasteUntilTick`/`hasteMultiplier` at `stepWithRuntime`'s speedMul
 * composition site (alongside slow/freeze/first-blood); the fire-rate effect
 * is read live in `weapon.ts`'s fire-rate composition (alongside Overclock)
 * — this function only opens the window, it does not itself touch speed or
 * fire rate.
 */
export function applyHasteToAlly(
  caster: PlayerEntity,
  target: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
  hasteMultiplier: number = SYZ_HASTE_MULTIPLIER_DEFAULT,
  durationTicks: number = SYZ_HASTE_DURATION_TICKS_DEFAULT,
): boolean {
  if (!target.alive) return false;
  if (!isAlly(caster, target)) return false;
  players[target.id] = {
    ...target,
    hasteUntilTick: (tick + 1 + durationTicks) as Tick,
    hasteMultiplier,
    // Devotion attribution (class-overhaul-workboard.md chunk 3.2) — see
    // hasteSourceId's doc comment in types.ts.
    hasteSourceId: caster.id,
  };
  return true;
}

/**
 * Apply (or refresh) a Syzygist Ward absorb pool onto `target`, IFF
 * `target` is an ally of `caster` (`isAlly`, team.ts) and alive. Same
 * refresh-overwrites, no-stacking convention as `applyRegenToAlly`/
 * `applyHasteToAlly`, and the SAME "solo/FFA caster with no teamId cannot
 * buff anyone, including themselves" gate. Unlike those two, this opens a
 * flat absorb POOL rather than a rate — the pool itself is consumed by
 * `combat.ts`'s `trySyzygistWard` (called from `tryDeflectDamage`), not by
 * a per-tick World.ts pass.
 */
export function applyWardToAlly(
  caster: PlayerEntity,
  target: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
  absorbAmount: number = SYZ_WARD_ABSORB_DEFAULT,
  durationTicks: number = SYZ_WARD_DURATION_TICKS_DEFAULT,
): boolean {
  if (!target.alive) return false;
  if (!isAlly(caster, target)) return false;
  players[target.id] = {
    ...target,
    wardAbsorbUntilTick: (tick + 1 + durationTicks) as Tick,
    wardAbsorbRemaining: absorbAmount,
    wardAbsorbSourceId: caster.id,
  };
  return true;
}

/**
 * Shared Syzygist snowball brake (2026-07-18, D3 fix — docs/axiom-
 * deviations-audit.md's Syzygist entry, "one shared stopping mechanism...
 * brakes [Devotion accrual and Flock Pulse] at once"). Both callers below
 * (the Devotion-accrual pass and the flock-pulse case block) count the SAME
 * "distinct other player currently carrying this caster's live regen/haste/
 * Ward window" set — this function is the ONE place that set's payoff gets
 * throttled, so both consumers brake identically by construction rather
 * than risking two hand-tuned copies drifting apart.
 *
 * Difference-fed per A3's stated preference ("tie the friction to how far
 * AHEAD the loop's owner is... invisible when you're even, firm when you're
 * snowballing") rather than a flat magnitude cap: reads `roundKills`
 * (types.ts's `RoundState.roundKills` — IN-ROUND kills, reset every round,
 * already folded in by `stepWithRuntime` every tick from that tick's kill
 * events — the exact in-round signal D3 asks for, since the draft's
 * cross-round `scores` catch-up brake is too slow to reach a same-round
 * runaway) — zero new state, reusing a field World.ts already maintains for
 * `decideRoundWinner`'s own timeout rule.
 *
 * `lead` = this caster's roundKills minus the AVERAGE roundKills of every
 * other currently-alive player. Even or behind the field (`lead <= 0`)
 * returns 1 — full strength, brake genuinely invisible, not just small.
 * Each whole kill of lead beyond that costs `SYZ_SNOWBALL_BRAKE_PER_KILL_
 * LEAD`, floored at `SYZ_SNOWBALL_BRAKE_FLOOR` (never fully zeroes the
 * payoff — brake the snowballing portion, don't delete the ability).
 */
function syzygistLeadBrakeMultiplier(
  casterId: PlayerId,
  players: Record<PlayerId, PlayerEntity>,
  roundKills: Record<PlayerId, number> | undefined,
): number {
  if (!roundKills) return 1;
  let othersTotal = 0;
  let othersCount = 0;
  for (const otherId of Object.keys(players)) {
    if ((otherId as PlayerId) === casterId) continue;
    if (!players[otherId as PlayerId]!.alive) continue;
    othersTotal += roundKills[otherId as PlayerId] ?? 0;
    othersCount++;
  }
  if (othersCount === 0) return 1; // last one standing — nobody to be ahead OF
  const ownKills = roundKills[casterId] ?? 0;
  const lead = ownKills - othersTotal / othersCount;
  if (lead <= 0) return 1;
  const mult = 1 - lead * SYZ_SNOWBALL_BRAKE_PER_KILL_LEAD;
  return Math.max(SYZ_SNOWBALL_BRAKE_FLOOR, mult);
}

/**
 * Low-aim auto-target helpers (2026-07-18, class-overhaul-workboard.md
 * chunk 3.4 — Jake's live design direction: "tendrils that ooze out and
 * self guide to its correct destination... less about aiming with the
 * priest"). Both scan `state.players` (the stable pre-tick read every
 * other cross-player scan this tick uses — Facet Break/Judgment Line's own
 * precedent) for the NEAREST valid target within range, no aim-cone check
 * at all (the deliberate difference from those two marks — see
 * SYZ_ALLY_SEARCH_RANGE_PX/SYZ_ENEMY_SEARCH_RANGE_PX's own doc comment for
 * why this session shares ONE helper per polarity instead of N hand-rolled
 * near-duplicate loops). Pure functions — no player-entity mutation.
 */
function findNearestAlly(
  caster: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  rangePx: number,
  options: { requireInjured?: boolean; excludeSelf?: boolean } = {},
): PlayerEntity | null {
  let best: PlayerEntity | null = null;
  let bestDist = Infinity;
  for (const [otherId, other] of Object.entries(players)) {
    if (options.excludeSelf !== false && (otherId as PlayerId) === caster.id) continue;
    if (!other.alive) continue;
    if (!isAlly(caster, other)) continue;
    // 2026-07-22 bug fix: was a flat `>= 100`, so a Kindled ally sitting at
    // e.g. 110/125 (genuinely injured, real room to heal) got wrongly
    // treated as full-health and skipped as a heal target.
    if (options.requireInjured && other.health >= maxHealthForPlayer(other)) continue;
    const dx = other.x - caster.x;
    const dy = other.y - caster.y;
    const dist = Math.hypot(dx, dy);
    if (dist > rangePx) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = other;
    }
  }
  return best;
}

function findNearestEnemy(
  caster: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  rangePx: number,
  options: { requireCursed?: boolean; tick?: Tick } = {},
): PlayerEntity | null {
  let best: PlayerEntity | null = null;
  let bestDist = Infinity;
  for (const [otherId, other] of Object.entries(players)) {
    if ((otherId as PlayerId) === caster.id) continue;
    if (!other.alive) continue;
    if (isAlly(caster, other)) continue;
    if (options.requireCursed) {
      const tick = options.tick ?? 0;
      const cursed =
        (other.burnUntilTick !== undefined && other.burnUntilTick > tick) ||
        (other.freezeUntilTick !== undefined && other.freezeUntilTick > tick) ||
        (other.slowedUntilTick !== undefined && other.slowedUntilTick > tick);
      if (!cursed) continue;
    }
    const dx = other.x - caster.x;
    const dy = other.y - caster.y;
    const dist = Math.hypot(dx, dy);
    if (dist > rangePx) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = other;
    }
  }
  return best;
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
    paladinMelee: new Map(),
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
  // Raw arena size (Track Z0b Item C) — the Zig shrink-zone storm's
  // center/half-diagonal math reads the same map.size this file's own
  // stepSuddenDeathStorm call passes. Fail-closed on the Zig side if
  // never set.
  wasmHost.setArenaSize(map.size.x, map.size.y);
  // Launch pads — static map geometry, same host-set pattern as the arena
  // bounds (module-level in world.zig, zero WorldState bytes). Always
  // called (empty array clears the previous match's pads).
  wasmHost.setLaunchPads(map.launchPads ?? []);
  // True slopes — same module-level host-set pattern (player.zig). Always
  // called (empty array clears the previous match's slopes). Feeds the
  // step_world path; the step_player backend re-writes slopes per call
  // from the collision cache regardless.
  wasmHost.setSlopes(map.slopes ?? []);
  // Spawn points (Track Z0b Item A) — same host-set pattern; the Zig
  // assignSpawnPoints port seats respawns from the same list this file's
  // own assignSpawnPoints reads. The no-spawns fallback is applied HERE
  // (TS's `map.spawns.length > 0 ? map.spawns : [center]`, from
  // assignSpawnPoints itself) because world.zig has no map size to derive
  // the center from.
  wasmHost.setSpawnPoints(
    map.spawns.length > 0
      ? map.spawns
      : [{ x: map.size.x / 2, y: map.size.y / 2 }],
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
        // Class base max health (2026-07-22 bug fix, see
        // baseMaxHealthForArchetype's doc comment) — cards are always empty
        // at this exact construction point (`cards: []` below), so there's
        // no maxHealthAdd bonus to fold in yet.
        health: baseMaxHealthForArchetype(spawn.characterId),
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
        // Duos-queue team identity (class-overhaul-workboard.md chunk 1.1) —
        // mirrors PlayerSpawnInfo.teamId onto the entity once, at
        // construction. Omitted key when absent, same optional-spread
        // convention as every other additive PlayerEntity field.
        ...(spawn.teamId ? { teamId: spawn.teamId } : {}),
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
      paperDoubles: {},
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
  for (const id of Object.keys(state.paperDoubles ?? {})) max = Math.max(max, Number(id));
  return max + 1;
}

/**
 * The minimal projectile-shaped data a ranged hit needs to carry through
 * `resolveRangedHit`'s mitigation chain. A real `ProjectileEntity` (the
 * per-tick projectile-stepping pass) satisfies this directly; a hitscan shot
 * (2026-07-20) constructs an equivalent throwaway object that's never
 * inserted into `state.projectiles` — `x/y/vx/vy` carry the shot's real
 * origin/aim-direction so `tryDeflectDamage`'s parry-arc check still gets
 * real direction info (NOT degraded the way an actual `sourceProjectileId:
 * null` hit like the counter-stance reflect below already is).
 */
type RangedHitSource = Pick<
  ProjectileEntity,
  "id" | "ownerId" | "element" | "x" | "y" | "vx" | "vy" | "damage" | "radius"
> &
  Partial<Pick<ProjectileEntity, "tendril" | "executeBelowFrac" | "statusScale" | "leechFraction">>;

/** Tick-scoped, read-mostly context `resolveRangedHit` needs — everything
 *  the original inline block read from `stepWithRuntime`'s closure, now
 *  threaded explicitly so a hitscan shot (resolved earlier in the SAME tick,
 *  inside the per-player loop, not the later projectile-drain pass) can
 *  supply an equivalent context without depending on that pass's own local
 *  state existing yet. */
type RangedHitContext = {
  chaosProfile: ChaosProfile;
  hangoutMode: boolean;
  fightingPhase: boolean;
  firstBloodAlreadyClaimedThisRound: boolean;
  nextTick: Tick;
  effDtMs: number;
  sortedPlayerIds: readonly PlayerId[];
  firstBloodAwardThisTick: PlayerId | null;
  /** Real projectile ids resolved so far this tick — used only to look up a
   *  fresher copy of the source projectile for the counter-stance/lightning
   *  chain's OWN follow-up hit-confirmed re-entry (see the `sourceProj`
   *  lookup below). A hitscan-only caller can safely pass `{}` — the lookup
   *  misses and falls back to `proj` itself, which already carries the
   *  correct direction info (see `RangedHitSource`'s own doc comment). */
  remainingProjectiles: Readonly<Record<EntityId, ProjectileEntity>>;
  deflectedProjectileIds: Map<EntityId, PlayerId>;
};

type RangedHitResult = {
  /** True if the hit was fully negated (evaded/parried/shielded) — the
   *  caller must NOT push `ev` onto the tick's event list (mirrors the
   *  original inline block's `continue`, which skipped the loop's
   *  unconditional trailing `events.push(ev)`). */
  suppressed: boolean;
  firstBloodAwardThisTick: PlayerId | null;
  /** Set when a mirror shield reflected this hit. The real projectile-array
   *  caller already handles the bounce itself (reverse velocity + reassign
   *  owner at the projectile-drop site — untouched by this extraction); a
   *  hitscan caller has no real entity to reverse, so it reads this back and
   *  immediately resolves ONE more trace from the victim toward the original
   *  attacker instead (see `resolveHitscanShot`'s call site). */
  reflectedVictimId?: PlayerId;
};

/**
 * The full ranged-hit mitigation + damage-application chain: chaos scaling,
 * priest-tendril ally-heal, Ward shell, Severing Answer, `tryDeflectDamage`
 * (dash i-frames / parry / mirror shield), Stolen Fangs, Radiant/Facet
 * Break/Focus Hex amps, Paper Double's Fooled debuff, execute threshold,
 * Rally Light/Kindled Resolve amps, team peel, ward-absorbed events,
 * first-blood wager, HP subtraction + kill detection, fire/ice status,
 * leech, lightning chain.
 *
 * Extracted 2026-07-20 (hitscan) from `stepWithRuntime`'s per-tick
 * projectile-drain loop — a PURE move, zero logic changes (verified via the
 * full test suite pre/post) — so both the projectile-array pass below AND a
 * same-tick hitscan shot resolve through the identical, single copy of this
 * chain rather than risking two implementations drifting apart.
 *
 * Mutates `ev.damage` in place as the chain recomputes it (the caller's
 * already-pushed-or-about-to-push event object is the SAME reference) and
 * mutates `players` directly (assignment by key), exactly as the original
 * inline block did.
 */
function resolveRangedHit(
  ev: Extract<SimEvent, { t: "hit-confirmed" }>,
  proj: RangedHitSource,
  players: Record<PlayerId, PlayerEntity>,
  events: SimEvent[],
  ctx: RangedHitContext,
): RangedHitResult {
  let firstBlood = ctx.firstBloodAwardThisTick;
  const victim = players[ev.victimId]!;
  // Apply chaos damage multiplier here so every projectile source (player
  // weapons, satellites, future hazards) is scaled uniformly. We mutate the
  // event's `damage` so SFX / network consumers see the post-chaos number
  // too.
  const scaledDamage = ev.damage * ctx.chaosProfile.damageMultiplier;
  ev.damage = scaledDamage;
  // Belt-and-braces for the hangout player-immunity carve-out: the empty
  // candidate list upstream already makes this unreachable, but a future
  // ranged source that bypasses the hit sweep must not quietly reopen player
  // damage in the lobby.
  if (!victim.alive || ctx.hangoutMode) {
    return { suppressed: false, firstBloodAwardThisTick: firstBlood };
  }
  // Priest tendril dual-purpose hit (Jake's redirect, 2026-07-19: "pulse
  // attack or healing effects depending" — ally=heal, enemy=curse, the same
  // low-aim auto-target doctrine this class's dedicated abilities already
  // use, applied to basic fire). `proj.tendril` (types.ts) is a pure
  // IDENTITY flag stamped ONLY on a Priest tendril (weapon.ts's
  // isPriestTendril spawn site) — scoping this branch to it, rather than to
  // every generic `element === "fire"` hit below, keeps every other class's
  // fire-element friendly fire (e.g. a duo Wizard stacking Molten Core)
  // completely unaffected, matching this session's "byte-identical for
  // every other class" regression bar. Checked BEFORE parry/counter/shield
  // mitigation — a heal isn't an attack, so it shouldn't be
  // blockable/deflectable the way a hit is, and "no ally present" needs no
  // extra handling: the shard can only ever land on an ENEMY in that case
  // (the dual-target homing rework's own fallback — see constants.ts's
  // SYZ_TENDRIL_* comment), so this check simply falls through to the
  // ordinary damage path below for them.
  const tendrilOwner =
    proj.tendril === true && proj.ownerId !== null ? players[proj.ownerId] : undefined;
  if (tendrilOwner && isAlly(tendrilOwner, victim)) {
    // Heal amount: reuse the tendril's OWN resolved hit magnitude (`ev.damage`
    // — already chaos-scaled, and headshot-boosted if the swept hit happened
    // to land in the head zone) rather than inventing a second hardcoded
    // number. "Same tendril, same magnitude, opposite polarity" is the most
    // defensible v1 read of "pulse a healing effect" — a Priest stacking
    // +damage cards heals allies harder too, which matches intuition rather
    // than fighting it. Clamp mirrors Borrowed Time's own heal clamp exactly
    // (World.ts's "borrowed-time" case, pendingSyzygistCasts loop) — both
    // now cap at the VICTIM's real max health (maxHealthForPlayer,
    // 2026-07-22 bug fix), not a flat 100.
    const healed = Math.min(maxHealthForPlayer(victim), victim.health + ev.damage);
    if (healed > victim.health) {
      players[ev.victimId] = { ...victim, health: healed };
    }
    // No SimEvent pushed for the heal itself: Borrowed Time and health-shard
    // pickups both reach the client purely through the `health` field
    // already present in the snapshot, with no dedicated wire event
    // required for correctness. `hit-confirmed` specifically assumes harm —
    // SimEventRouter.ts unconditionally plays a hit sound, hit-stop freeze,
    // screen shake, damage number, and hit-react animation off it — so
    // routing a heal through that pipeline would misrender as "you got hit
    // for -2.5". A dedicated heal-pulse VFX event is a reasonable future
    // addition but is render-layer work, out of this change's
    // sim-mechanics-only scope; suppressing here also means the original
    // (harmful) `hit-confirmed` for this event is never pushed at all.
    return { suppressed: true, firstBloodAwardThisTick: firstBlood };
  }
  // Ward shell (six-axes-goal.md Layer 1): a post-cast shell halves incoming
  // damage BEFORE the shield absorbs it. Order is parry > shell > shield —
  // parry zeroes regardless, so applying the shell to the pre-mitigation
  // number here is order-exact.
  // Scope: the projectile path (direct + AOE) — bash/DoT keep their own
  // sites untouched in Layer 1.
  // Severing Answer (six-axes Layer 2): counter-stance consumes the hit —
  // negated, and the raw (post-chaos, pre-shell) damage is returned to the
  // attacker, capped. Order: parry > counter > shell > shield — a live parry
  // wins the frame, so the stance only answers when no parry is up.
  const parryLive =
    victim.parryActiveUntilTick !== undefined && victim.parryActiveUntilTick > ctx.nextTick;
  const counterLive =
    victim.counterUntilTick !== undefined && victim.counterUntilTick > ctx.nextTick;
  if (counterLive && !parryLive) {
    players[ev.victimId] = { ...victim, counterUntilTick: undefined };
    const counterTarget =
      proj.ownerId !== null && proj.ownerId !== ev.victimId ? players[proj.ownerId] : undefined;
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
      // The returned damage is a real hit: it flows through hit-confirmed so
      // charge fill / kill feed / audio all read it with zero bespoke
      // plumbing.
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
    return { suppressed: true, firstBloodAwardThisTick: firstBlood }; // original hit suppressed entirely
  }
  const wardActive =
    victim.wardShellUntilTick !== undefined && victim.wardShellUntilTick > ctx.nextTick;
  const intoMitigation = wardActive ? scaledDamage * EMISSION_WARD_DAMAGE_MULT : scaledDamage;
  ev.damage = intoMitigation;
  // Run parry/shield mitigation BEFORE applying damage. Pass the live source
  // (direct reference for a hitscan shot; a fresher copy from
  // `remainingProjectiles` when a real, still-live projectile exists this
  // tick) so the parry arc check has direction info.
  const sourceProj: RangedHitSource | null =
    ev.sourceProjectileId !== null ? ctx.remainingProjectiles[ev.sourceProjectileId] ?? proj : null;
  const victimBuild = resolvePlayerBuild(victim);
  const mitigation = tryDeflectDamage(victim, sourceProj, intoMitigation, ctx.nextTick, {
    mirrorShield: victimBuild.mirrorShield,
    directionalShield: victimBuild.directionalShield,
    parryCoverMultiplier: victimBuild.parryCoverMultiplier,
    voidPiercing: proj.element === "void",
  });
  let postPlayer = mitigation.player;
  if (mitigation.evaded) {
    // Ninja dash i-frames: "wasn't there" — zero damage, no event, no
    // reflect (evasion is not a counter). The projectile is still consumed
    // by this hit resolution (v1 simplification — it doesn't visually pass
    // through the dodging body).
    players[ev.victimId] = postPlayer;
    return { suppressed: true, firstBloodAwardThisTick: firstBlood };
  }
  if (mitigation.deflected) {
    // Parry: zero damage; tell the caller (and downstream listeners) by
    // emitting a parry-deflected event. Damage event is suppressed.
    events.push({
      t: "parry-deflected",
      playerId: ev.victimId,
      projectileId: ev.sourceProjectileId,
    });
    if (ev.sourceProjectileId !== null) {
      ctx.deflectedProjectileIds.set(ev.sourceProjectileId, ev.victimId);
    }
    players[ev.victimId] = postPlayer;
    return { suppressed: true, firstBloodAwardThisTick: firstBlood };
  }
  if (mitigation.shielded) {
    // Mirror shield: bounce the blocked shard back at the attacker, reusing
    // the parry-reflect path (reverse velocity + reassign owner at the
    // projectile-drop site) and the same deflect event/VFX. A hitscan
    // caller has no real projectile to drop/reverse — see `resolveHitscanShot`'s
    // own doc comment for how a hitscan reflection is handled instead (a
    // single immediate re-trace back at the attacker).
    if (mitigation.shieldReflected && ev.sourceProjectileId !== null) {
      ctx.deflectedProjectileIds.set(ev.sourceProjectileId, ev.victimId);
      events.push({
        t: "parry-deflected",
        playerId: ev.victimId,
        projectileId: ev.sourceProjectileId,
      });
    }
    // Shield popped or absorbed — emit shield-popped only when the charge
    // fully drained; partial absorbs stay silent for the protocol audience
    // (clients can derive "shield hit" from charge delta in the snapshot if
    // they want a sound cue).
    if (mitigation.shieldPopped) {
      events.push({
        t: "shield-popped",
        playerId: ev.victimId,
        remainingCharge: postPlayer.shieldCharge ?? 0,
      });
    }
    // Stolen Fangs: any absorbed hit banks a lock charge (cap 2), refreshing
    // the expiry window. weapon.ts spends charges on the player's next fired
    // shot(s), turning them homing.
    if (victimBuild.stolenFangs) {
      const expiryTicks = Math.ceil(STOLEN_FANGS_CHARGE_EXPIRY_MS / ctx.effDtMs);
      const bankedCharges = Math.min(
        STOLEN_FANGS_MAX_CHARGES,
        (postPlayer.pendingLockCharges ?? 0) + 1,
      );
      postPlayer = {
        ...postPlayer,
        pendingLockCharges: bankedCharges,
        pendingLockExpiresAtTick: (ctx.nextTick + expiryTicks) as Tick,
      };
    }
    players[ev.victimId] = postPlayer;
    // Shielded → final damage is 0; don't push the original hit-confirmed
    // (it's already in the caller's own event list; suppress here).
    return {
      suppressed: true,
      firstBloodAwardThisTick: firstBlood,
      reflectedVictimId: mitigation.shieldReflected ? ev.victimId : undefined,
    };
  }
  let finalDamage = mitigation.damage;
  const element = proj.element;
  // Radiant: 1.4x to a target already affected by any status effect.
  if (element === "radiant") {
    const hasStatus =
      (postPlayer.burnUntilTick !== undefined && postPlayer.burnUntilTick > ctx.nextTick) ||
      (postPlayer.freezeUntilTick !== undefined && postPlayer.freezeUntilTick > ctx.nextTick) ||
      (postPlayer.slowedUntilTick !== undefined && postPlayer.slowedUntilTick > ctx.nextTick) ||
      (postPlayer.vulnerabilityUntilTick !== undefined &&
        postPlayer.vulnerabilityUntilTick > ctx.nextTick);
    if (hasStatus) finalDamage *= 1.4;
  }
  // Facet Break (Geometrician catalog v1, single role): a hit from the
  // marking player on their still-marked target is amplified.
  // Additive/composable, same post-mitigation site as the Radiant status-amp
  // just above — default-inert (facetTargetId is undefined on every hand
  // that never drafted the card, so this is a true no-op for every existing
  // test/build).
  const attackerEntity = proj.ownerId !== null ? players[proj.ownerId] : undefined;
  if (
    attackerEntity?.facetTargetId === ev.victimId &&
    attackerEntity.facetMarkUntilTick !== undefined &&
    attackerEntity.facetMarkUntilTick > ctx.nextTick
  ) {
    finalDamage *= GEO_FACET_BREAK_AMP_MULTIPLIER;
  }
  // Focus Hex (Syzygist catalog v1, single role, class-overhaul-workboard.md
  // chunk 3.4): the EXACT same amp shape as Facet Break immediately above,
  // just a different mark field pair and multiplier — mark lives on the
  // CASTER (focusHexTargetId), not the victim, same reasoning.
  if (
    attackerEntity?.focusHexTargetId === ev.victimId &&
    attackerEntity.focusHexMarkUntilTick !== undefined &&
    attackerEntity.focusHexMarkUntilTick > ctx.nextTick
  ) {
    finalDamage *= SYZ_FOCUS_HEX_AMP_MULTIPLIER;
  }
  // Paper Double's Fooled debuff (2026-07-19 fast-follow) — VICTIM-side,
  // unlike Facet Break/Focus Hex immediately above (which read the
  // ATTACKER's own mark); any attacker's shot benefits, not just the
  // Syzygist/Geometrician who caught this player with the burst.
  finalDamage *= fooledDamageMultiplier(postPlayer, ctx.nextTick);
  // Technique axis (six-axes-goal.md Layer 1): an execute-flagged shard
  // finishes a player already below the threshold fraction of their REAL
  // max health (maxHealthForPlayer, 2026-07-22 bug fix — was a flat 100,
  // which let a Kindled at 100/125 falsely read as "below 35%" the moment
  // they dropped under 35, rather than under 35% of 125) — never from
  // above it, so the no-100-0 law holds by construction.
  const executeFrac = proj.executeBelowFrac ?? 0;
  let executedThisHit = false;
  if (executeFrac > 0 && postPlayer.health > 0 && postPlayer.health < executeFrac * maxHealthForPlayer(postPlayer)) {
    finalDamage = Math.max(finalDamage, postPlayer.health);
    // Mark for the kill event below (Track L legibility): the flag only
    // survives onto `player-killed` if the hit really killed — a later
    // team-peel reduction that saves the victim never emits it.
    executedThisHit = true;
  }
  // Rally Light (chunk 2.6 fast-follow) — same attacker-amp shape every
  // other hit-resolution site in this file uses (bash/slash/edge).
  if (attackerEntity) {
    finalDamage *= rallyLightDamageMultiplier(attackerEntity, players, ctx.nextTick);
    finalDamage *= kindledResolveDamageMultiplier(attackerEntity, ctx.nextTick);
  }
  // Team peel (class-overhaul-workboard.md chunk 2.4) — same gate as every
  // other damage-resolution site in this file: only when the victim's OWN
  // Ward didn't already cover this hit (`mitigation.warded` false). `victim`
  // (captured pre-mitigation, above) still carries the id/teamId/position
  // the check needs.
  if (!mitigation.warded) {
    const peel = applyTeamPeel(victim, finalDamage, players, ctx.sortedPlayerIds, ctx.nextTick);
    if (peel) {
      finalDamage = peel.damage;
      events.push(peel.event);
    }
  }
  ev.damage = finalDamage;
  if (mitigation.warded) {
    events.push({
      t: "ward-absorbed",
      playerId: ev.victimId,
      damageBlocked: mitigation.wardDamageBlocked,
      kindlingGranted: mitigation.wardKindlingGranted,
    });
  }
  if (mitigation.syzWarded) {
    events.push({
      t: "syz-ward-absorbed",
      playerId: ev.victimId,
      casterId: victim.wardAbsorbSourceId ?? ev.victimId,
      damageBlocked: mitigation.syzWardDamageBlocked ?? 0,
      wardBroke: mitigation.syzWardBroke ?? false,
    });
  }
  // First-blood wager: this is a real, non-self, attacker-attributed hit
  // landing during the fighting phase — claim it if nobody has this round
  // yet. `firstBlood` also guards against a second projectile awarding it
  // again later in this same tick.
  if (
    ctx.fightingPhase &&
    !ctx.firstBloodAlreadyClaimedThisRound &&
    firstBlood === null &&
    proj.ownerId !== null &&
    proj.ownerId !== ev.victimId
  ) {
    firstBlood = proj.ownerId;
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
      // Technique execute (six-axes Layer 1): additive flag so the death
      // presents its severance mark — "the answer was already written".
      ...(executedThisHit ? { executed: true as const } : {}),
    });
  }
  // Fire: 3-second burn DoT at damage * 0.4 per second. Tick-quantized.
  // Emission cast shards carry statusScale ×2, hard-capped per status
  // (docs/emission-engine-goal.md) — burn's cap equals its base 3s, so the
  // cast's fire identity reads through impact size + coverage rather than a
  // longer burn; freeze genuinely doubles (≤2s).
  const statusScale = proj.statusScale ?? 1;
  if (element === "fire") {
    const burnMs = Math.min(3 * 1000 * statusScale, EMISSION_BURN_CAP_MS);
    const burnTicks = Math.ceil(burnMs / Math.max(1, ctx.effDtMs));
    nextVictim = {
      ...nextVictim,
      burnUntilTick: (ctx.nextTick + burnTicks) as Tick,
      burnDps: finalDamage * 0.4,
      burnTickLastApplied: ctx.nextTick,
      burnSourceId: proj.ownerId ?? undefined,
    };
  }
  // Ice: 1-second freeze at 0.5x movement (Emission-scaled, capped).
  if (element === "ice") {
    const freezeMs = Math.min(1 * 1000 * statusScale, EMISSION_FREEZE_CAP_MS);
    const freezeTicks = Math.ceil(freezeMs / Math.max(1, ctx.effDtMs));
    nextVictim = {
      ...nextVictim,
      freezeUntilTick: (ctx.nextTick + freezeTicks) as Tick,
      freezeMultiplier: 0.5,
    };
  }
  players[ev.victimId] = nextVictim;

  // Drain axis (six-axes-goal.md Layer 1): a leech-flagged shard heals its
  // caster a fraction of the post-mitigation damage that actually landed —
  // the SAME number the charge fill reads (one damage model). Self-damage
  // never leeches; the heal is monotone and capped at the caster's REAL max
  // health (maxHealthForPlayer, 2026-07-22 bug fix — was a flat 100, which
  // silently capped Kindled leech well under their real 125) but never
  // REDUCES a body already above that (bossModeUntilTick's "more health"
  // buff isn't tracked by maxHealthForPlayer, so `Math.max` against current
  // health keeps the original "a boss-mode body above its max is safe"
  // guarantee). Chain-lightning secondaries deliberately excluded — the
  // chain is a derived hit, not the shard.
  const leechFrac = proj.leechFraction ?? 0;
  if (leechFrac > 0 && proj.ownerId !== null && proj.ownerId !== ev.victimId) {
    const leechCaster = players[proj.ownerId];
    if (leechCaster && leechCaster.alive) {
      const healed = Math.min(
        Math.max(maxHealthForPlayer(leechCaster), leechCaster.health),
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

  // Lightning: chain half damage to the nearest OTHER alive player within
  // radius. Depth 1 only (no recursion). Bypasses parry/shield for
  // simplicity — the chain is a derived secondary hit.
  if (element === "lightning") {
    const CHAIN_RADIUS = 220;
    const chainDmg = finalDamage * 0.5;
    let bestId: PlayerId | null = null;
    let bestD2 = CHAIN_RADIUS * CHAIN_RADIUS;
    // Iterate sorted ids for determinism.
    for (const oid of ctx.sortedPlayerIds) {
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
  return { suppressed: false, firstBloodAwardThisTick: firstBlood };
}

export type HitscanTraceResult = {
  hitPlayerId: PlayerId | null;
  hitDecoyId: EntityId | null;
  hitDestructibleId: EntityId | null;
  hitX: number;
  hitY: number;
  /** True when the trace was stopped by terrain before reaching anything
   *  else — every `hit*Id` field is null in that case. */
  blockedByWall: boolean;
};

/**
 * Same-tick, no-`ProjectileEntity` ray-trace (2026-07-20, true hitscan) —
 * sweeps `sweepAABB` against alive non-owner player AABBs, Paper Double
 * decoys, and destructibles, plus `sweepAABBCached` against the map's static
 * collision cache (one-way platforms respected), over the FULL `rangePx` in
 * one shot (both sweep helpers just multiply velocity by a scalar `dt` — no
 * tick-boundedness — so encoding the whole range as a single displacement is
 * exact, not an approximation). Mirrors the same three collision-consumer
 * groups the real traveling-projectile pipeline checks (player-hit inside
 * `stepProjectileNative`, decoy-hit in `paperDouble.ts`, destructible-hit in
 * `destructible.ts`) — a hitscan shot never creates a `ProjectileEntity`, so
 * without this it could never hit a decoy or destructible at all. Hangout
 * mode's player-immunity carve-out is the CALLER's responsibility (pass an
 * empty `sortedPlayerIds` — same convention `projectilePlayerIds` already
 * uses for the real projectile pass).
 *
 * Returns an ORDERED ARRAY of hits (2026-07-20, card-pool raycast pass —
 * pierce support): the ray keeps gathering the next-nearest
 * player/decoy/destructible hit, in distance order, up to `pierceCount + 1`
 * total, same as a real piercing projectile keeps traveling and can strike
 * additional targets on later ticks (`projectile.ts`'s
 * `pierceRemaining`-continue branch) — except a same-tick ray resolves every
 * pierced hit in one pass instead of needing multiple ticks. A wall always
 * hard-stops the ray (piercing never grants wall-penetration, matching the
 * real-projectile precedent: bounce/pierce never lets a shot pass through
 * terrain either) and is always the LAST element when reached. The array is
 * never empty: index 0 is always present (a clean miss returns a
 * single-element array with every `hit*Id` null at the max-range endpoint,
 * exactly like the pre-pierce single-result shape did) — every existing
 * caller that only cares about the first hit can keep reading `[0]`
 * unchanged.
 */
export function resolveHitscanShot(
  originX: number,
  originY: number,
  aimAngle: number,
  rangePx: number,
  ownerId: PlayerId | null,
  players: Record<PlayerId, PlayerEntity>,
  sortedPlayerIds: readonly PlayerId[],
  collisionCache: StaticCollisionCache,
  decoys: WorldState["paperDoubles"] = undefined,
  destructibles: WorldState["destructibles"] = {},
  // Same bullet thickness a traveling projectile from this build would
  // carry (`build.projectile radius`, default 0 for a mathematically true
  // ray). NOT a fast-projectile trick — a literal zero-width ray is
  // actually STRICTER than a traveling projectile's swept circle
  // (`projectile.ts` inflates its own AABB by `proj.radius` on every axis
  // before sweeping), so a shot that would've grazed a target's edge as a
  // projectile silently whiffs as a hitscan trace without this — confirmed
  // via a real 2px near-miss regression (abilitySlots.test.ts's Crimson
  // Tithe leech case). Passing the build's own radius keeps size-modifier
  // cards (circle-rounds etc.) meaningful for a hitscan weapon too.
  radius: number = 0,
  // Pierce budget (2026-07-20) — 0 (default) reproduces the original
  // single-hit behavior exactly (a length-1 result array).
  pierceCount: number = 0,
): HitscanTraceResult[] {
  const dx = Math.cos(aimAngle);
  const dy = Math.sin(aimAngle);
  const vx = dx * rangePx;
  const vy = dy * rangePx;
  const mover: AABB = { x: originX - radius, y: originY - radius, w: radius * 2, h: radius * 2 };

  // Mutable candidate pools — a pierced hit is spliced out of its own pool
  // so the next sweep pass finds the NEXT-nearest one behind it.
  const candidatePids: PlayerId[] = [];
  const candidateAABBs: AABB[] = [];
  for (const pid of sortedPlayerIds) {
    if (ownerId !== null && pid === ownerId) continue;
    const player = players[pid];
    if (!player || !player.alive) continue;
    candidatePids.push(pid);
    candidateAABBs.push(playerHitboxAABB(player));
  }

  const decoyIds: EntityId[] = [];
  const decoyAABBs: AABB[] = [];
  if (decoys) {
    for (const idStr of Object.keys(decoys).sort()) {
      const id = EntityId(Number(idStr));
      const pd = decoys[id]!;
      if (ownerId !== null && pd.ownerId === ownerId) continue;
      decoyIds.push(id);
      decoyAABBs.push(paperDoubleAABB(pd));
    }
  }

  const destructibleIds: EntityId[] = [];
  const destructibleAABBs: AABB[] = [];
  for (const idStr of Object.keys(destructibles).sort()) {
    const id = EntityId(Number(idStr));
    const d = destructibles[id]!;
    if (d.health <= 0) continue;
    destructibleIds.push(id);
    destructibleAABBs.push(destructibleAABB(d));
  }

  // Wall position is fixed for the whole ray — piercing never moves it.
  const wallHit = sweepAABBCached(mover, vx, vy, 1, collisionCache, true);
  const wallT = wallHit ? wallHit.t : 1;

  const results: HitscanTraceResult[] = [];
  const maxHits = pierceCount + 1;
  while (results.length < maxHits) {
    const playerHit = candidateAABBs.length > 0 ? sweepAABB(mover, vx, vy, 1, candidateAABBs) : null;
    const decoyHit = decoyAABBs.length > 0 ? sweepAABB(mover, vx, vy, 1, decoyAABBs) : null;
    const destructibleHit =
      destructibleAABBs.length > 0 ? sweepAABB(mover, vx, vy, 1, destructibleAABBs) : null;

    let bestT = wallT; // the wall is the floor every candidate must beat
    let hitPlayerId: PlayerId | null = null;
    let hitDecoyId: EntityId | null = null;
    let hitDestructibleId: EntityId | null = null;
    let playerHitIdx = -1;
    let decoyHitIdx = -1;
    let destructibleHitIdx = -1;
    if (playerHit && playerHit.t < bestT) {
      bestT = playerHit.t;
      hitPlayerId = candidatePids[playerHit.index]!;
      hitDecoyId = null;
      hitDestructibleId = null;
      playerHitIdx = playerHit.index;
      decoyHitIdx = -1;
      destructibleHitIdx = -1;
    }
    if (decoyHit && decoyHit.t < bestT) {
      bestT = decoyHit.t;
      hitPlayerId = null;
      hitDecoyId = decoyIds[decoyHit.index]!;
      hitDestructibleId = null;
      playerHitIdx = -1;
      decoyHitIdx = decoyHit.index;
      destructibleHitIdx = -1;
    }
    if (destructibleHit && destructibleHit.t < bestT) {
      bestT = destructibleHit.t;
      hitPlayerId = null;
      hitDecoyId = null;
      hitDestructibleId = destructibleIds[destructibleHit.index]!;
      playerHitIdx = -1;
      decoyHitIdx = -1;
      destructibleHitIdx = destructibleHit.index;
    }

    const blockedByWall = hitPlayerId === null && hitDecoyId === null && hitDestructibleId === null && bestT === wallT && wallHit !== null;
    results.push({
      hitPlayerId,
      hitDecoyId,
      hitDestructibleId,
      hitX: originX + vx * bestT,
      hitY: originY + vy * bestT,
      blockedByWall,
    });

    // A wall (or a clean miss at max range) always ends the ray — nothing
    // left to pierce through.
    if (hitPlayerId === null && hitDecoyId === null && hitDestructibleId === null) break;

    // Splice the pierced candidate out of its own pool (and the parallel id
    // array, so indices stay aligned) so the next loop pass's sweep finds
    // whatever's next behind it.
    if (playerHitIdx >= 0) {
      candidatePids.splice(playerHitIdx, 1);
      candidateAABBs.splice(playerHitIdx, 1);
    } else if (decoyHitIdx >= 0) {
      decoyIds.splice(decoyHitIdx, 1);
      decoyAABBs.splice(decoyHitIdx, 1);
    } else if (destructibleHitIdx >= 0) {
      destructibleIds.splice(destructibleHitIdx, 1);
      destructibleAABBs.splice(destructibleHitIdx, 1);
    }
  }
  return results;
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

  // First-blood wager: the first ranged hit this tick with a resolvable,
  // non-self attacker claims it, but only if nobody has claimed it yet this
  // round. Hoisted here (2026-07-20, hitscan) — was previously declared right
  // before the projectile-drain pass (now, further down), but a hitscan shot
  // resolves synchronously inside the EARLIER per-player loop and needs to
  // compete for the same claim; a plain `let` hoist changes nothing about
  // WHEN it's read/written, only makes it available earlier too.
  let firstBloodAwardThisTick: PlayerId | null = null;

  // Hitscan hits awaiting mitigation + damage application (2026-07-20) — the
  // ray-trace itself runs immediately in the per-player loop below (safe,
  // read-only), but resolving the actual hit is deferred here, to right
  // after that loop closes, for the SAME reason `PendingSyzygistCast` (below)
  // defers its own cross-player writes — see the per-player loop's own
  // comment at its hitscan-pellet site for the full hazard explanation.
  const pendingHitscanHits: Array<{
    victimId: PlayerId;
    hitY: number;
    source: RangedHitSource;
    rangePx: number;
  }> = [];

  // Single rng cursor threaded through all sim stages this tick. We seed it
  // from the world state so determinism is preserved across replays.
  let runtimeRngState = state.rngState;

  // 1. Players: movement + weapon fire (only during fighting phase; other
  //    phases freeze input but still advance the round timer).
  const players: WorldState["players"] = {};
  // Copy-on-write so a fighting tick with no new shots costs zero
  // allocations on the projectiles record. See client/src/sim/cowRecord.ts.
  const projectilesCow = new CowRecord<EntityId, ProjectileEntity>(state.projectiles);
  // fire-on-first-shot may add new entries before the satellite step later
  // this tick rotates and ticks them. stepSatellites (satellite.ts) is
  // called UNCONDITIONALLY every tick and always returns a freshly-allocated
  // record — so an eagerly-copied `nextSatellites` is discarded on every
  // single tick regardless of content (perf audit M2, 2026-07-18). Default
  // to the same reference (zero allocation) and copy-on-write only at the
  // rare mutation site that needs to add an entry before stepSatellites runs.
  const baseSatellites: WorldState["satellites"] = state.satellites ?? {};
  let nextSatellites: WorldState["satellites"] = baseSatellites;

  // NINJA MELEE trigger capture (see the "1z2. NINJA MELEE" section below,
  // right after DASH BASH): the Fire rising-edge has to be read HERE, in
  // the same loop that still has the pre-overwrite `prevKeys` in scope —
  // by loop 2 `runtime.prevKeys` already holds THIS tick's value. The FSM
  // itself (phase countdown/transitions/hit-check) runs entirely in loop 2
  // since it needs every player's finalized post-movement position; this
  // map only carries "did a ninja just press Fire this tick, and what was
  // their aim" across that gap. Cleared implicitly each tick (fresh Map).
  const ninjaSlashEdges = new Map<PlayerId, { aimX: number; aimY: number }>();
  /** Same capture contract as `ninjaSlashEdges` above, for Paladin's Kindled
   *  Edge (class-overhaul-workboard.md chunk 2.1) — see the "1z3. PALADIN
   *  MELEE" section below, right after the ninja melee block. */
  const paladinEdgeEdges = new Map<PlayerId, { aimX: number; aimY: number }>();
  /** Shield-key RISING edges for paladins this tick (R1 row 16 ward-raise
   *  cancel, 2026-07-24 wave 2) — same pre-overwrite-prevKeys capture
   *  contract as the two melee-edge maps above. The 1z3 loop combines this
   *  with the post-tickShield `shieldActive` (the ward actually ENGAGED —
   *  a dead-battery shield press must not buy a free cancel). */
  const paladinWardRaiseEdges = new Set<PlayerId>();

  /**
   * Syzygist deferred ally-target casts (class-overhaul-workboard.md chunk
   * 3.4). The main per-player loop below iterates `state.players` (the
   * FROZEN pre-tick snapshot — see `entity` immediately below) and only
   * commits each player's own result at the END of their own iteration
   * (`players[pid] = nextEntity`). A cross-player write into
   * `players[otherId]` made DURING one player's turn is silently LOST the
   * moment that other player's OWN turn runs later this same loop — their
   * `nextEntity` starts from the stale `entity` (not the live `players`
   * record), so their own commit overwrites whatever an earlier caster
   * just wrote. This is the exact hazard Facet Break's own comment
   * documents ("a cross-player write here would be lost the moment that
   * victim's own turn... runs") — this session's regen/haste/Ward
   * mechanism functions (`applyRegenToAlly` etc.) are safe to call BETWEEN
   * ticks (as chunk 3.1's own tests do) but are NOT safe to call directly
   * from inside this loop for a target that hasn't had its turn yet.
   * Borrowed Time / Glass Ward / Haste Gift / Contagion queue their
   * cross-player effect here instead of writing immediately; a dedicated
   * pass right after this loop closes (once EVERY player has committed)
   * applies them safely, using the now-fully-current `players` record —
   * the same "defer cross-player effects to a pass that runs after the
   * loop" shape `applyTeamPeel`'s own hit-resolution-time call already
   * proves out.
   */
  type PendingSyzygistCast =
    | { kind: "haste-gift"; casterId: PlayerId; targetId: PlayerId; multiplier: number; durationTicks: number }
    | { kind: "glass-ward"; casterId: PlayerId; targetId: PlayerId; absorb: number; durationTicks: number }
    | { kind: "borrowed-time"; targetId: PlayerId; heal: number; drain: number; debtDelayTick: Tick }
    | { kind: "contagion"; sourceId: PlayerId; jumpTargetId: PlayerId };
  const pendingSyzygistCasts: PendingSyzygistCast[] = [];

  /**
   * Instant-AoE queue (aoe role rework, 2026-07-18, docs/design-axioms.md
   * A7): every "aoe"-tagged ability in this file used to spawn a fan/ring of
   * discrete ProjectileEntity objects — a burst of bullets, not a real area
   * effect (exactly the "split-spam" pattern A7 already named and fixed
   * once in the universal card-pool rework, just wearing the aoe role tag
   * here instead). Each now queues ONE entry here — an epicenter, a radius
   * (optionally narrowed to a cone), a flat damage, and an optional slow —
   * instead of spawning entities. A dedicated pass right after the main
   * loop closes (same "every player has committed their own turn" timing
   * pendingSyzygistCasts's own doc comment above establishes, and the SAME
   * post-loop site applyTeamPeel already resolves hits at)
   * resolves every entry: a plain center-to-center distance check (no
   * raycast/LOS — the same simplification findNearestEnemy/hasRallyLight
   * Source already uses for every other ability range in this file) against
   * every OTHER player, routed through the exact same tryDeflectDamage +
   * rallyLightDamageMultiplier + applyTeamPeel mitigation chain DASH
   * BASH/NINJA MELEE/PALADIN MELEE use, so shield/parry counterplay and
   * every existing damage-amp/mitigation aura still applies to these hits
   * exactly as it did when they were projectiles. Casting inside THIS loop
   * (queuing here, not writing `players[otherId]` directly) avoids the
   * cross-player-write-mid-loop hazard Facet Break's own comment
   * documents; the entries themselves carry no player-entity references,
   * just plain data, so queuing is safe even for the LANDING-gated casts
   * (Shock Ring) that resolve many ticks after the original press.
   */
  type PendingInstantAoe = {
    /** Ability kind — carried through only for future debugging/telemetry,
     *  never branched on in the resolution pass (every entry is resolved
     *  identically regardless of which ability queued it). */
    kind: string;
    casterId: PlayerId;
    x: number;
    y: number;
    radius: number;
    damage: number;
    /** Cone half-shape (Prism Fan only) — both present or both absent. */
    aimAngle?: number;
    coneRadians?: number;
    slowMultiplier?: number;
    slowDurationMs?: number;
    /** Paper Double's burst debuff (2026-07-19 fast-follow) — set ONLY on
     *  `paper-double-burst` casts. See types.ts's `fooledUntilTick` field
     *  comment for the full mechanic. */
    fooledDurationMs?: number;
  };
  const pendingInstantAoe: PendingInstantAoe[] = [];

  /**
   * Lingering-zone queue (aoe role rework, Tier B — Lattice/Consecrated
   * Field only, the two abilities whose OWN case comments already flagged
   * "not the doc's persisting plane/field" as the real gap). Reuses the
   * EXACT `FireEntity`/`firePatches` primitive fire hazards and broken
   * flammable destructibles already spawn into — no new entity kind, no new
   * Zig ABI surface (FireEntity's shape/wire size is untouched; this only
   * adds more instances of it). Collected here (a plain array, not written
   * into `state.firePatches` directly) for the same reason projectiles get
   * a COW record instead of a direct write — spawning is safe mid-loop
   * (firePatches are WORLD-owned entities, exactly like projectiles, not
   * another player's PlayerEntity), but merging happens once, at the single
   * site below (section 3c) that already owns `nextFirePatches` construction.
   * `stepFirePatches` (fire.ts) is what actually ticks/damages these every
   * tick — pure radius+DPS+duration, no shield/parry mitigation (same
   * "environmental DoT" category fire patches and the sudden-death storm
   * already are), excluding only the exact owner (never allies — matches
   * fire patches' own existing, pre-existing-to-this-pass behavior).
   */
  const pendingZoneSpawns: FireEntity[] = [];

  /**
   * Venue-lobby-tableau fast-follow (2026-07-18): hangout mode's practice
   * dummies (destructibles) previously had NO hit path for ninja/paladin
   * melee arcs or any of the 7 instant-AOE catalog abilities — those blocks
   * only ever checked players, and player-damage is (correctly) suppressed
   * in hangout mode entirely. Accumulated here (one entry per hit, NOT
   * pre-summed — attacker attribution matters for emission-charge crediting
   * below, section 4b) by both the melee arc blocks and the instant-AOE
   * resolution block below, then applied once, as an adjustment to
   * `state.destructibles` right before `stepDestructibles` runs (section
   * 3b) — `stepDestructibles` always returns a fully-fresh destructibles
   * record regardless of what it's handed, so pre-reducing health here is
   * the correct (and only) place damage from these sources can land.
   * Empty (and free) outside hangout mode — nothing pushes into it.
   */
  const pendingHangoutDestructibleDamage: Array<{ destructibleId: string; attackerId: PlayerId; damage: number }> = [];

  /**
   * Paper Double (Interstice catalog v1, movement role) melee damage —
   * mirrors `pendingHangoutDestructibleDamage` immediately above exactly
   * (same "accumulate during the main loop, apply once right before the
   * dedicated step function runs" reasoning — `stepPaperDoubles` always
   * returns a fresh replacement record, same as `stepDestructibles`), but
   * is NOT hangout-only: a decoy is a real combat entity, so both the
   * ninja slash arc AND the paladin edge arc push into this in EVERY
   * fight, not just the practice-dummy lobby. Applied in section "3c2.
   * Paper Doubles" below, right before `stepPaperDoubles` runs.
   */
  const pendingPaperDoubleDamage: Array<{ paperDoubleId: string; attackerId: PlayerId; damage: number }> = [];

  /**
   * Newly-cast Paper Double decoys (populated by the `"paper-double"`
   * ability-switch case below) — a plain array, same "collected here,
   * merged once at the single site that already owns the collection's
   * construction" shape as `pendingZoneSpawns` above, NOT a `CowRecord`:
   * `stepPaperDoubles` reassigns `state.paperDoubles` wholesale every tick
   * it runs (movement/lifetime always advance), the exact "record is
   * reassigned wholesale every tick" case `cowRecord.ts`'s own header
   * comment documents CoW would waste an allocation on (its own
   * `state.satellites` example, same reasoning here).
   */
  const pendingPaperDoubleSpawns: PaperDoubleEntity[] = [];

  /**
   * Hitscan split children (2026-07-20, card-pool raycast pass — Pierce
   * Chain/Cluster Bomb) — same "collected here, merged once" shape as
   * `pendingPaperDoubleSpawns` immediately above, for the same reason:
   * `remainingProjectiles` (the projectile output cow-map) isn't declared
   * until well after the per-player loop closes, so a hitscan pellet
   * resolved DURING that loop can't insert a real child `ProjectileEntity`
   * into it directly. Missing only `id` (assigned at the merge site, right
   * after `remainingProjectiles` is declared, using the same
   * `runtime.nextEntityId` allocator the existing on-death split insertion
   * already uses).
   */
  const pendingHitscanSplitSpawns: Omit<ProjectileEntity, "id">[] = [];

  /**
   * Resonance-gated position swaps (2026-07-19 fast-follow — docs/card-
   * pool-v2.md's "Cast Paper Double INTO a live window: you and the double
   * swap positions at cast instead"). Populated by the `"paper-double"`
   * ability-switch case when it finds BOTH a live resonance window AND a
   * still-live decoy of its own — same deferred-collection shape as
   * `pendingPaperDoubleSpawns` immediately above (a cross-entity write to a
   * `PaperDoubleEntity`, which this per-player loop never otherwise
   * touches, so it can't safely mutate `state.paperDoubles` directly
   * mid-loop). Applied in section "3c2. Paper Doubles" below, BEFORE
   * `stepPaperDoubles` runs, so the decoy's own straight-line movement this
   * tick continues from its NEW (post-swap) position, not its old one. The
   * caster's OWN side of the swap is a self-write (`nextEntity.x/y`) —
   * applied directly in the switch case, no queue needed for that half.
   */
  const pendingPaperDoubleSwaps: Array<{ decoyId: EntityId; x: number; y: number }> = [];

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
      // Syzygist haste (class-overhaul-workboard.md chunk 3.1): while
      // hasteUntilTick is in the future, multiply movement by
      // hasteMultiplier — same tick-gated read as slow/freeze immediately
      // above, just a buff (>1) instead of a debuff (<1). Composes into the
      // SAME speedMul scalar every other multiplier here does, so it
      // crosses into the live wasm `step_player` physics backend for free
      // via the existing `speedMultiplier` option below (no Zig-side
      // movement change needed — see hasteUntilTick's doc comment in
      // types.ts for the full ABI reasoning).
      const hasteActive =
        entity.hasteUntilTick !== undefined &&
        entity.hasteUntilTick > state.tick;
      const hasteMul = hasteActive ? entity.hasteMultiplier ?? 1 : 1;
      // Rally Light (Kindled catalog v1 fast-follow, class-overhaul-
      // workboard.md chunk 2.6): "move tick" for anyone the aura currently
      // covers — READS `state.players` (the stable pre-tick snapshot every
      // other other-player scan this tick uses, e.g. Judgment Line's target
      // search), never writes another player's entity, so it's safe inside
      // this per-player loop (see `hasRallyLightSource`'s own doc comment).
      const rallyMul = hasRallyLightSource(entity, state.players, state.tick)
        ? KIN_RALLY_LIGHT_MOVE_MULTIPLIER
        : 1;
      // Card augments: move-speed + gravity (glide/heavy) ride the existing
      // step multipliers, so they cross into the Zig player step for free.
      const speedMul = slowMul * freezeMul * firstBloodMul * hasteMul * rallyMul * build.moveSpeedMultiplier;
      // Captured BEFORE stepPlayer mutates movement memory — the ninja
      // wall-kick energy grant (below) needs the PRE-step wall-contact
      // state to detect "a wall-jump just happened", the same signal
      // player.ts's own (Zig-mirrored) wall-jump branch reads internally.
      // Deliberately backend-agnostic: this reads stepPlayer's INPUT and
      // OUTPUT only, never its internals, so it works identically whether
      // stepPlayer dispatches to the TS-native path or the wasm physics
      // backend (which defaults on for live matches) — a callback hook
      // into stepPlayerNative would silently never fire under wasm.
      // Shock Ring's landing detection and the Second Wind Paladin
      // stomp-jump (below) reuse this EXACT before/after idiom for
      // groundedLastFrame/airJumpsUsed — same "read INPUT and OUTPUT only"
      // backend-agnostic reasoning.
      const wallDirBeforeStep = mem.touchingWallDir;
      const groundedBeforeStep = mem.groundedLastFrame;
      const airJumpsUsedBeforeStep = mem.airJumpsUsed;
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
          // Wall Bloom (Interstice catalog v1, aoe role): while the window
          // lives, THIS wall-kick also blooms a shard burst at the wall-
          // contact point — single-use, cleared on this wall-kick (not
          // just on timeout).
          const wallBloomLive =
            nextEntity.wallBloomUntilTick !== undefined &&
            nextEntity.wallBloomUntilTick > state.tick;
          nextEntity = {
            ...nextEntity,
            energy: Math.min(
              NINJA_ENERGY_MAX,
              (nextEntity.energy ?? 0) + NINJA_ENERGY_ON_WALL_KICK,
            ),
            wallBloomUntilTick: wallBloomLive ? undefined : nextEntity.wallBloomUntilTick,
          };
          if (wallBloomLive) {
            // Aoe role rework (2026-07-18): was a burst of discrete shard
            // projectiles off the wall; now an instant radius check
            // centered on the wall-contact point (queued for the post-loop
            // resolution pass below — same "everyone in range takes it in
            // one tick" fix as every other aoe-tagged ability this pass).
            const wallX = nextEntity.x + wallDirBeforeStep * (PLAYER_BODY_WIDTH / 2 + 6);
            pendingInstantAoe.push({
              kind: "wall-bloom",
              casterId: pid,
              x: wallX,
              y: nextEntity.y,
              radius: NINJA_WALL_BLOOM_RADIUS_PX,
              damage: NINJA_WALL_BLOOM_DAMAGE,
            });
          }
        }
      }

      // Paladin landing/air-jump hooks (class-overhaul-workboard.md chunk
      // 2.6 fast-follow): Shock Ring resolves on landing, Second
      // Wind's Paladin expression resolves on the AIR JUMP itself. Same
      // before/after `stepPlayer` idiom the ninja wall-kick grant above
      // uses — backend-agnostic (works under both the TS-native and wasm
      // physics paths).
      if (classId === "paladin" && !hangoutMode) {
        const groundedAfterStep = moveResult.memory.groundedLastFrame;
        const justLanded = !groundedBeforeStep && groundedAfterStep;
        if (justLanded) {
          // Shock Ring: the hop's arm window is still live → slam. Aoe role
          // rework (2026-07-18): was a ring of discrete shard projectiles;
          // now a single instant radius check queued for the post-loop
          // resolution pass — same damage/radius, no status effect (a plain
          // "space claim" thump).
          if (
            nextEntity.shockRingArmedUntilTick !== undefined &&
            nextEntity.shockRingArmedUntilTick > state.tick
          ) {
            pendingInstantAoe.push({
              kind: "shock-ring",
              casterId: pid,
              x: nextEntity.x,
              y: nextEntity.y,
              radius: KIN_SHOCK_RING_RADIUS_PX,
              damage: KIN_SHOCK_RING_DAMAGE,
            });
            nextEntity = { ...nextEntity, shockRingArmedUntilTick: undefined };
          }
          // (Crater's epicenter-burst + traveling-ring landing resolution —
          // docs/card-pool-v2.md #26 — used to live here, gated on
          // craterArmedUntilTick. Cut entirely 2026-07-19 alongside its
          // sibling exclusives Retort/Bastion; see cards.ts's cut note
          // above the old crater/retort/bastion card definitions.)
        }
        // Second Wind — Paladin expression (docs/card-pool-v2.md "the
        // stomp-jump"): fires on the AIR JUMP itself (the departure), not
        // on landing — "his air jump deals 6 damage in a 70px ring beneath
        // him". Gated on the card actually being equipped, same "read the
        // card id directly" economy Bastion Pulse's self-only shield ticks
        // use.
        if (
          moveResult.memory.airJumpsUsed > airJumpsUsedBeforeStep &&
          nextEntity.cards.includes("double-jump")
        ) {
          const stompCount = 6;
          for (let i = 0; i < stompCount; i++) {
            const angle = (i / stompCount) * 2 * Math.PI;
            const shard = spawnProjectile(allocId(), {
              ownerId: pid,
              origin: { x: nextEntity.x, y: nextEntity.y + 20 },
              aimAngle: angle,
              speed: 220,
              damage: KIN_STOMP_JUMP_DAMAGE / stompCount,
              lifetimeMs: Math.max(50, (KIN_STOMP_JUMP_RADIUS_PX / 220) * 1000),
              radius: 6,
              shape: build.projectile.shape,
              pathing: "straight",
              element: build.projectile.element,
            });
            shard.rangePx = KIN_STOMP_JUMP_RADIUS_PX;
            projectilesCow.set(shard.id, shard);
          }
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
    // Ninja/Paladin: Fire is the SAME "primary attack" input as every other
    // class, but the chassis verb is a melee arc, not stepWeapon's ranged
    // shot — this branch captures the rising edge for loop 2's FSM instead
    // of ever calling stepWeapon. Zero behavior change for the other two
    // classes (wizard/priest still take the untouched branch below exactly
    // as before) — and Paladin joining this branch (2026-07-18, chunk 2.1)
    // is a real, in-scope behavior change for Paladin specifically (it
    // previously fell through to stepWeapon's ranged shot like everyone
    // else; Kindled Edge replaces that, matching how ninja's own melee
    // verb replaced its ranged shot in the prior chunk).
    if ((classId === "ninja" || classId === "paladin") && nextEntity.alive && fightingPhase) {
      const meleeEdge = (currKeys & FireBit) !== 0 && (prevKeys & FireBit) === 0;
      if (meleeEdge) {
        if (classId === "ninja") {
          ninjaSlashEdges.set(pid, { aimX, aimY });
        } else {
          paladinEdgeEdges.set(pid, { aimX, aimY });
        }
      }
      // Ward-raise edge for the row-16 recovery cancel (paladin only) —
      // captured here for the same prevKeys-lifetime reason as the melee
      // edges above; whether the ward actually ENGAGED is judged in 1z3
      // against the post-tickShield shieldActive.
      if (
        classId === "paladin" &&
        (currKeys & ShieldBit) !== 0 &&
        (prevKeys & ShieldBit) === 0
      ) {
        paladinWardRaiseEdges.add(pid);
      }
      // Passive energy regen ("fast regen" — classes-goal.md MANA section)
      // is a NINJA-ONLY resource source. Paladin has no analogous passive
      // trickle here — Kindling comes exclusively from Ward absorbing
      // damage (combat.ts), not from any per-tick regen tied to Fire/Edge.
      if (classId === "ninja") {
        nextEntity = {
          ...nextEntity,
          energy: Math.min(
            NINJA_ENERGY_MAX,
            (nextEntity.energy ?? 0) + NINJA_ENERGY_PASSIVE_REGEN_PER_SEC * (effDtMs / 1000),
          ),
        };
      }
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
        // Hitscan pellets (2026-07-20, true hitscan) — the RAY-TRACE resolves
        // right here (read-only geometry, safe at any point in the tick), but
        // the actual mitigation + damage application (`resolveRangedHit`) is
        // DEFERRED to `pendingHitscanHits`, resolved in one batch right after
        // the main per-player loop closes below. Reason: this loop commits
        // each player's own `nextEntity` into `players` only at the END of
        // THEIR OWN iteration — a player later in iteration order (not yet
        // processed) has no live entry in `players` yet, and if their turn
        // hasn't run, hitting them NOW and writing `players[victimId] = ...`
        // would be silently overwritten the moment their own turn eventually
        // runs and commits a `nextEntity` built from the frozen pre-tick
        // `state.players[victimId]` (unaware of the damage). This is the
        // EXACT hazard `PendingSyzygistCast` (above) already documents and
        // works around for cross-player writes — same fix, same reason.
        // `hitscanHits` (an additive field on the SAME shot-fired event
        // below) still carries each pellet's real endpoint for the tracer
        // visual, since the TRACE itself doesn't need deferring — only the
        // damage write does. The trace's own player candidates are read from
        // `state.players` merged under `players` (`??`) so a not-yet-
        // processed victim is still found (using their pre-tick position —
        // negligible for one tick of movement).
        const hitscanHits: { x: number; y: number; hitPlayerId: PlayerId | null; blockedByWall?: boolean }[] = [];
        if (fireResult.hitscanPellets.length > 0) {
          const hitscanSortedIds = (Object.keys(state.players) as PlayerId[]).sort();
          // Hangout mode: players take ZERO ranged damage there (same carve-
          // out `projectilePlayerIds = hangoutMode ? [] : sortedPlayerIdsForTick`
          // already applies below for real projectiles) — an empty candidate
          // list means `resolveHitscanShot` can never resolve a player hit,
          // while decoys/destructibles (passed unconditionally just below)
          // still can, matching the practice-dummy venue's actual ruleset.
          const hitscanPlayerCandidateIds = hangoutMode ? [] : hitscanSortedIds;
          const playersForTrace: Record<PlayerId, PlayerEntity> = { ...state.players, ...players };
          // Same reasoning as `playersForTrace` above, applied to decoys: a
          // decoy cast THIS SAME TICK by an earlier-processed player lives
          // only in `pendingPaperDoubleSpawns` until `stepPaperDoubles` runs
          // after the whole per-player loop closes — `state.paperDoubles`
          // alone is the stale pre-tick snapshot and would miss it entirely,
          // the one gap a traveling projectile never had (it would simply
          // arrive on some LATER tick, by which point the spawn had already
          // landed in `state.paperDoubles`). A same-tick hitscan trace has no
          // such luxury, so it reads whatever's been committed so far this
          // tick, exactly like the players merge just above.
          const decoysForTrace: WorldState["paperDoubles"] =
            pendingPaperDoubleSpawns.length > 0
              ? {
                  ...(state.paperDoubles ?? {}),
                  ...Object.fromEntries(pendingPaperDoubleSpawns.map((pd) => [pd.id, pd])),
                }
              : state.paperDoubles;
          for (const pellet of fireResult.hitscanPellets) {
            // Pierce (2026-07-20, card-pool raycast pass): `resolveHitscanShot`
            // now returns an ORDERED ARRAY of hits along the ray — length 1
            // for the overwhelming majority of pellets (pierceCount 0, the
            // default), longer only for Pierce Chain/Voltaic Spark/Void
            // Fracture. The tracer visual uses the LAST entry (the ray's
            // true final resting point, whatever pierced through to get
            // there) so a piercing shot's beam visibly reaches past the
            // first body instead of stopping there.
            const traces = resolveHitscanShot(
              pellet.originX,
              pellet.originY,
              pellet.aimAngle,
              pellet.rangePx,
              pellet.ownerId,
              playersForTrace,
              hitscanPlayerCandidateIds,
              runtime.collisionCache,
              decoysForTrace,
              state.destructibles,
              pellet.radius,
              pellet.pierceCount ?? 0,
            );
            const finalTrace = traces[traces.length - 1]!;
            hitscanHits.push({
              x: finalTrace.hitX,
              y: finalTrace.hitY,
              hitPlayerId: finalTrace.hitPlayerId,
              blockedByWall: finalTrace.blockedByWall,
            });
            // Explosive/slow-field (2026-07-20) REPLACES the normal per-hit
            // damage entirely with a radius cast at the ray's terminal point
            // — see the `pendingInstantAoe` push below, mirroring
            // `projectile.ts`'s own real-projectile precedent
            // (`applyHitOn`'s explosive branch routes into `detonateAt`
            // instead of a direct single-target hit). Neither impact type
            // combines with pierceCount in the actual card pool today
            // (Explosive Facet/Cataclysmic Prism/Slow Field/Frost Prism all
            // leave pierceCount at 0), so reading only the final trace here
            // is exactly equivalent to reading the only trace.
            if (pellet.impact === "explosive" || pellet.impact === "slow-field") {
              // A direct hit on a decoy/destructible still takes its own
              // normal damage (an explosive shot must still be able to pop
              // a dummy/decoy directly) — the AOE happens ADDITIONALLY at
              // that same point so nearby real players still catch the
              // splash. A direct PLAYER hit has no separate push at all:
              // the AOE below already covers them (they're at distance ~0
              // from their own hit point).
              if (finalTrace.hitDecoyId !== null) {
                pendingPaperDoubleDamage.push({
                  paperDoubleId: String(finalTrace.hitDecoyId),
                  attackerId: pellet.ownerId,
                  damage: pellet.damage,
                });
              } else if (finalTrace.hitDestructibleId !== null) {
                pendingHangoutDestructibleDamage.push({
                  destructibleId: String(finalTrace.hitDestructibleId),
                  attackerId: pellet.ownerId,
                  damage: pellet.damage,
                });
              }
              pendingInstantAoe.push({
                kind: "hitscan-impact",
                casterId: pellet.ownerId,
                x: finalTrace.hitX,
                y: finalTrace.hitY,
                radius: pellet.impactRadiusPx ?? 0,
                damage: pellet.impact === "explosive" ? pellet.damage : 0,
                slowMultiplier: pellet.impact === "slow-field" ? pellet.slowMultiplier : undefined,
                slowDurationMs: pellet.impact === "slow-field" ? SLOW_FIELD_DURATION_MS : undefined,
              });
              continue;
            }
            for (const trace of traces) {
              // Decoy/destructible hits reuse the SAME pending-array
              // mechanisms melee/edge attacks already push into (see their
              // own doc comments a few hundred lines below) — damage
              // application, break/burst events, and (for decoys) the AOE
              // burst + Fooled debuff via `resolveInstantAoeCasts` all come
              // for free.
              if (trace.hitDecoyId !== null) {
                pendingPaperDoubleDamage.push({
                  paperDoubleId: String(trace.hitDecoyId),
                  attackerId: pellet.ownerId,
                  damage: pellet.damage,
                });
                continue;
              }
              if (trace.hitDestructibleId !== null) {
                pendingHangoutDestructibleDamage.push({
                  destructibleId: String(trace.hitDestructibleId),
                  attackerId: pellet.ownerId,
                  damage: pellet.damage,
                });
                continue;
              }
              if (trace.hitPlayerId === null) continue;
              pendingHitscanHits.push({
                victimId: trace.hitPlayerId,
                hitY: trace.hitY,
                source: {
                  id: allocId(),
                  ownerId: pellet.ownerId,
                  element: pellet.element,
                  x: pellet.originX,
                  y: pellet.originY,
                  vx: Math.cos(pellet.aimAngle),
                  vy: Math.sin(pellet.aimAngle),
                  damage: pellet.damage,
                  tendril: pellet.tendril,
                  leechFraction: pellet.leechFraction,
                  radius: pellet.radius,
                },
                rangePx: pellet.rangePx,
              });
            }
            // Split (2026-07-20) — spawns real child ProjectileEntitys at
            // the ray's terminal point (last pierced hit, wall, or clean-miss
            // endpoint), reusing the exact same spawnSplit fan a real
            // projectile's own on-death split uses. See
            // `pendingHitscanSplitSpawns`'s own declaration for why this
            // can't insert directly into `remainingProjectiles` from here.
            if ((pellet.splitCount ?? 0) > 0) {
              const splitParent: ProjectileEntity = {
                id: allocId(),
                ownerId: pellet.ownerId,
                x: finalTrace.hitX,
                y: finalTrace.hitY,
                vx: Math.cos(pellet.aimAngle),
                vy: Math.sin(pellet.aimAngle),
                shape: "hexagon",
                radius: pellet.radius,
                damage: pellet.damage,
                lifetimeMs: 1000,
                pathing: "straight",
                element: pellet.element,
                bouncesRemaining: 0,
                pierceRemaining: 0,
                splitCount: pellet.splitCount,
              };
              const splitResult = spawnSplit(splitParent, runtimeRngState);
              runtimeRngState = splitResult.rngState;
              pendingHitscanSplitSpawns.push(...splitResult.spawned.map((c) => c.spec));
            }
          }
        }
        events.push({
          t: "shot-fired",
          playerId: pid,
          x: nextEntity.x,
          y: nextEntity.y,
          hand: fireResult.throwHand,
          projectileIds: fireResult.projectiles.map((projectile) => projectile.id),
          hitscanHits: hitscanHits.length > 0 ? hitscanHits : undefined,
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
            if (newSats.length > 0 && nextSatellites === baseSatellites) {
              nextSatellites = { ...nextSatellites };
            }
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
      // step already receives these counters every tick. The refund lives
      // ONLY in this host memory (no snapshot field), so the event below is
      // the sole way a renderer can see it — emitted only when something
      // was actually spent, so the site read marks a real restoration
      // rather than the axis idling (docs/legibility-audit.md, Track L).
      if (emission.stride.dashReset) {
        const mem = runtime.movement.get(pid);
        if (mem) {
          const refunded = mem.airJumpsUsed > 0 || mem.dashUsedInAir > 0;
          mem.airJumpsUsed = 0;
          mem.dashUsedInAir = 0;
          if (refunded) {
            events.push({
              t: "stride-refunded",
              playerId: pid,
              x: nextEntity.x,
              y: nextEntity.y,
            });
          }
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
    // Rising-edge + alive + fighting + cooldown expired → activate. Effects
    // are ordinary buff ticks / entities; the cooldown lives on the entity
    // (hash-mixed, delta-synced) so prediction and authority agree.
    // LIVE in hangout mode (live playtest 2026-07-18, Jake: "the button
    // presses dont fire off the spells") — this used to hard-block every
    // class's abilities in the lobby unconditionally (a leftover from
    // before the lobby had any cards to activate at all). Same "activation
    // is live, PvP damage is blocked at each individual damage site"
    // precedent as the Fire gate above: every ability here either (a)
    // writes only `nextEntity` / spawns a projectile — and hangout's
    // `projectilePlayerIds = []` already makes projectiles pass through
    // other players as ghosts — or (b) is a Syzygist ally-target write via
    // pendingSyzygistCasts, gated on `isAlly`, which is unconditionally
    // false in hangout (lobby `PlayerEntity`s never get a `teamId` —
    // venueHost.ts's `spawnFor` never sets one; only the arena's duo-bell
    // admission does). See the ninja-catalog/Kindled/Syzygist safety audit
    // (chunk: hangout-ability-activation-fix) — no ability here mutates
    // another player's `health` directly.
    for (let slot = 0; slot < build.actives.length && slot < MAX_ABILITY_SLOTS; slot++) {
      const slotBit = 1 << (10 + slot);
      const slotEdge =
        (currKeys & slotBit) !== 0 && (prevKeys & slotBit) === 0;
      if (!slotEdge) continue;
      if (!nextEntity.alive || !fightingPhase) continue;
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
          // Aoe role rework (2026-07-18, docs/design-axioms.md A7): was a
          // fan of discrete shard projectiles (split-spam wearing the aoe
          // tag). Now an instant cone radius-check, queued for the post-loop
          // resolution pass below — everyone standing inside the cone at
          // cast time takes the hit in one tick, no shard travel, no gap
          // between projectile paths a body could stand in without being
          // "hit". Forward-aimed (not 360°) — "still crystal munitions,
          // just more of the angle" — the differentiation from Lattice's
          // self-centered nova below.
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const baseAngle = lutAtan2(dy0, dx0);
          pendingInstantAoe.push({
            kind: "prism-fan",
            casterId: pid,
            x: nextEntity.x,
            y: nextEntity.y,
            radius: GEO_PRISM_FAN_RANGE_PX,
            damage: build.damage * GEO_PRISM_FAN_DAMAGE_MULTIPLIER,
            aimAngle: baseAngle,
            coneRadians: GEO_PRISM_FAN_CONE_RADIANS,
          });
          activated = true;
          break;
        }
        case "lattice": {
          // Aoe role rework (2026-07-18): this ability's OWN v1 comment
          // already flagged the gap — "an instant 360° nova, not the doc's
          // persisting damaging plane". Tier B fix: a genuine lingering
          // zone, built on the SAME `firePatches`/`FireEntity` primitive
          // fire hazards already use (radius + damagePerSecond +
          // remainingMs, ticked every tick by `stepFirePatches` against
          // anyone overlapping) — no new entity kind, no new Zig ABI
          // surface. Pure damage, no status (space denial via damage alone
          // — Consecrated Field was the damage+slow sibling until it was
          // cut 2026-07-19, see docs/class-ability-catalogs-v1.md).
          pendingZoneSpawns.push({
            id: allocId(),
            ownerId: pid,
            x: nextEntity.x,
            y: nextEntity.y,
            radius: GEO_LATTICE_ZONE_RADIUS_PX,
            remainingMs: GEO_LATTICE_ZONE_DURATION_MS,
            damagePerSecond: GEO_LATTICE_ZONE_DPS,
          });
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
          // Reworked 2026-07-19 (docs/axiom-deviations-audit.md D2 — the
          // original +1-ammo v1 was a confirmed dominated filler). Opens a
          // short window (types.ts's measureUntilTick doc comment has the
          // full reasoning); weapon.ts reads it to zero spread + amp damage
          // on shots fired while live.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            measureUntilTick: (state.tick + 1 + durTicks) as Tick,
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
          // Instant hop opposite the aim direction, plus a rider window
          // (reworked 2026-07-19, docs/axiom-deviations-audit.md D2 — the
          // doc's own "next shot gets knock-self reduction" nuance, deferred
          // in v1, now shipped): weapon.ts reads recoilStepUntilTick to
          // reduce self-knockback on shots fired while live. See types.ts's
          // field comment for the full "why this makes Recoil Step
          // orthogonal to Slip Node" reasoning.
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const hopAngle = lutAtan2(dy0, dx0) + Math.PI;
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            vx: nextEntity.vx + lutCos(hopAngle) * GEO_RECOIL_STEP_HOP_SPEED,
            vy: nextEntity.vy + lutSin(hopAngle) * GEO_RECOIL_STEP_HOP_SPEED * 0.6,
            recoilStepUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        // ── Kindled catalog v1 (docs/class-ability-catalogs-v1.md) ─────────
        // classId-gated to paladin at the offer roll (round.ts). Same
        // substrate-reuse discipline as the Geometrician block above — see
        // constants.ts's KIN_* header note for the per-ability reasoning.
        // Every case here only ever writes `nextEntity` (self) or spawns a
        // projectile (`projectilesCow`) — never another player's entity —
        // for the SAME reason Facet Break's own comment gives above: a
        // cross-player write inside this per-player loop would be lost the
        // moment that OTHER player's own turn runs later this tick.
        // Sunspike's actual damage therefore rides the existing
        // projectile-hit-resolution pass (which runs AFTER
        // every player's turn this tick, and is already team-peel-aware —
        // chunk 2.4) rather than hand-rolling a second damage path; Kindled
        // Edge-side consumption for Judgment Line / Unbroken Seal happens
        // at the "1z3. PALADIN MELEE" section below, which also runs after
        // every player's turn.
        case "bastion-pulse": {
          // Instant self-absorb tick, doubled if Ward is actively held at
          // cast time ("stronger if Ward is held", doc) — reuses Return
          // Glass's exact shield-charge-tick shape (constants.ts).
          const maxCharge = SHIELD_MAX_CHARGE_DEFAULT * build.shieldChargeMultiplier;
          const refund = nextEntity.shieldActive
            ? KIN_BASTION_PULSE_SHIELD_REFUND * KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER
            : KIN_BASTION_PULSE_SHIELD_REFUND;
          nextEntity = {
            ...nextEntity,
            shieldCharge: Math.min(maxCharge, (nextEntity.shieldCharge ?? 0) + refund),
          };
          activated = true;
          break;
        }
        case "sunspike": {
          // v1 = a single fast, narrow, short-range shot through the
          // existing projectile system (constants.ts KIN_SUNSPIKE_* header
          // note) — arrives in ≈0.1s, reading as a thrust rather than a
          // lobbed shot. Inherits the resolved build's own element/shape
          // identity, same as Prism Fan/Lattice above, so a fire-handed
          // paladin's Sunspike burns too.
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const aimAngle = lutAtan2(dy0, dx0);
          const shard = spawnProjectile(allocId(), {
            ownerId: pid,
            origin: { x: nextEntity.x, y: nextEntity.y - 20 },
            aimAngle,
            speed: KIN_SUNSPIKE_SPEED,
            damage: KIN_SUNSPIKE_DAMAGE,
            lifetimeMs: Math.max(50, (KIN_SUNSPIKE_RANGE_PX / KIN_SUNSPIKE_SPEED) * 1000),
            radius: Math.max(2, 9 * build.projectile.sizeMultiplier),
            shape: build.projectile.shape,
            pathing: "straight",
            element: build.projectile.element,
          });
          shard.rangePx = KIN_SUNSPIKE_RANGE_PX;
          // Bespoke render identity (2026-07-20) — see types.ts's
          // `kindledThrust` field comment: a solid, symmetric gold spike
          // instead of "whatever your card build's shot looks like."
          // Render-only; `element`/`shape` above stay build-resolved so a
          // fire-handed paladin's Sunspike still burns, unchanged.
          shard.kindledThrust = true;
          projectilesCow.set(shard.id, shard);
          activated = true;
          break;
        }
        case "judgment-line": {
          // Mark lives on the CASTER (judgmentTargetId/judgmentMarkUntilTick),
          // never the victim — the exact Facet Break cross-player write
          // hazard this file's own comment documents above. Scan shape
          // (nearest target within range+cone of the aim) is a verbatim
          // copy of Facet Break's, over `state.players` (the stable
          // pre-tick read every other-player scan this tick uses).
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
            if (dist > KIN_JUDGMENT_RANGE_PX || dist < 1e-3) continue;
            let da = lutAtan2(ddy, ddx) - aimAngle;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            if (Math.abs(da) > KIN_JUDGMENT_CONE_RADIANS / 2) continue;
            if (dist < bestDist) {
              bestDist = dist;
              bestId = otherId as PlayerId;
            }
          }
          if (bestId !== null) {
            const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
            nextEntity = {
              ...nextEntity,
              judgmentTargetId: bestId,
              judgmentMarkUntilTick: (state.tick + 1 + durTicks) as Tick,
            };
            activated = true;
          }
          // No target in the cone: a press that does nothing is a dead
          // press (legibility law — shadow-step/facet-break precedent) —
          // no cooldown burn, checked via `activated` below.
          break;
        }
        case "unbroken-seal": {
          // Window consumed by the NEXT landed Kindled Edge hit (amp +
          // stagger), at the "1z3. PALADIN MELEE" section below — see
          // types.ts's sealUntilTick doc comment.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            sealUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "aegis-share": {
          // Window widening THIS player's team-peel radius for allies
          // (World.ts's findTeamPeelWarder reads aegisShareUntilTick
          // directly off the candidate warder being tested). The window
          // opens unconditionally either way — an ally who wanders into
          // range later during the window still gets peeled for, exactly
          // as before this fast-follow.
          //
          // Solo fallback (docs/axiom-deviations-audit.md "Kindled — two
          // structural gaps", 2026-07-18): unlike Haste Gift/Glass Ward
          // (Syzygist), this ability never targeted an ally at cast time to
          // begin with — it's a passive window a DIFFERENT player's later
          // hit-resolution reads (findTeamPeelWarder), so a solo caster got
          // literally nothing from pressing it. Mirrors the Syzygist shape
          // as closely as this ability's own structure allows: search for
          // an ally inside the SAME radius the window actually widens
          // (WARD_PEEL_RADIUS_PX * KIN_AEGIS_SHARE_RADIUS_MULTIPLIER); none
          // found → grant a flat Kindling tick instead (constants.ts's
          // KIN_AEGIS_SHARE_SOLO_KINDLING_FEED doc comment — "reduced but
          // real"). Purely additive: does not touch the ally branch above.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          const soloAlly = findNearestAlly(
            nextEntity,
            state.players,
            WARD_PEEL_RADIUS_PX * KIN_AEGIS_SHARE_RADIUS_MULTIPLIER,
          );
          nextEntity = {
            ...nextEntity,
            aegisShareUntilTick: (state.tick + 1 + durTicks) as Tick,
            ...(soloAlly === null
              ? {
                  kindling: Math.min(
                    KINDLING_MAX,
                    (nextEntity.kindling ?? 0) + KIN_AEGIS_SHARE_SOLO_KINDLING_FEED,
                  ),
                }
              : {}),
          };
          activated = true;
          break;
        }
        case "plant-charge": {
          // Same farthest-collision-free-landing search as shadow-step/
          // slip-node above, shorter range ("plant-to-plant, not freeflow
          // ninja") — plus a small shield-charge tick for "ends in
          // ward-ready stance" (the doc's exact stance/pose timing is a
          // recorded v1 deferral, same shape as Return Glass's own gap).
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const dLen = Math.sqrt(dx0 * dx0 + dy0 * dy0);
          const dirX = dLen > 0.001 ? dx0 / dLen : 1;
          const dirY = dLen > 0.001 ? dy0 / dLen : 0;
          for (let d = KIN_PLANT_CHARGE_RANGE_PX; d >= 24; d -= 12) {
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
              const maxCharge = SHIELD_MAX_CHARGE_DEFAULT * build.shieldChargeMultiplier;
              nextEntity = {
                ...nextEntity,
                x: cx,
                y: cy,
                shieldCharge: Math.min(
                  maxCharge,
                  (nextEntity.shieldCharge ?? 0) + KIN_PLANT_CHARGE_SHIELD_REFUND,
                ),
              };
              activated = true;
              break;
            }
          }
          break;
        }
        // ── Kindled catalog v1 fast-follow (class-overhaul-workboard.md
        // chunk 2.6, 2026-07-18) — originally Retribution Edge, Shock Ring,
        // Rally Light: the 3 abilities the original pass deferred.
        // Retribution Edge was cut 2026-07-19 (see docs/class-ability-
        // catalogs-v1.md's 12→10 cut note) — it carried an unaddressed
        // self-fueling-loop brake gap (docs/axiom-deviations-audit.md) and
        // was removed rather than fixed; its retributionArmedUntilTick/
        // retributionReadyUntilTick fields and the combat.ts Ward-block
        // hook that opened the second window are gone too. Shock Ring only
        // ever writes `nextEntity` (self) here — the same "never another
        // player's entity inside this per-player loop" discipline the
        // Kindled block above documents. Rally Light writes `nextEntity`
        // too (it just OPENS the aura-source window; every beneficiary
        // reads it later, never a write onto them — see
        // `hasRallyLightSource`'s own doc comment above `applyTeamPeel`).
        case "shock-ring": {
          // A modest upward hop (KIN_SHOCK_RING_HOP_VY, well under a full
          // jump — "keep hop modest, not sky-god") plus an arm window
          // covering the hop's airtime. Landing detection + the actual slam
          // nova happen in the per-player MOVEMENT section above (this
          // switch runs AFTER movement each tick, so "just landed" for THIS
          // press can only be detected on a LATER tick — same "the window
          // persists across ticks until consumed" shape as sealUntilTick/
          // aegisShareUntilTick).
          nextEntity = {
            ...nextEntity,
            vy: -KIN_SHOCK_RING_HOP_VY,
            shockRingArmedUntilTick: (state.tick + 1 + Math.ceil(KIN_SHOCK_RING_ARM_WINDOW_MS / Math.max(1, dtMs))) as Tick,
          };
          activated = true;
          break;
        }
        case "rally-light": {
          // Opens the aura-SOURCE window on the caster — no cross-player
          // write, see `hasRallyLightSource`'s own doc comment (above
          // `applyTeamPeel`) for why this needs no pendingSyzygistCasts-
          // style deferred queue.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            rallyLightUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        // ── Kindled coverage-floor + solo-viability fast-follow (docs/
        // axiom-deviations-audit.md "Kindled (paladin) — two structural
        // gaps", 2026-07-18) — the catalog's 2nd buff and 2nd movement,
        // closing the ≥2-per-role floor. See constants.ts's KIN_KINDLED_
        // RESOLVE_*/KIN_BULWARK_STEP_* header comments for the full design.
        case "kindled-resolve": {
          // Self-only: spends Kindling for a self stagger-resist + small
          // self-damage-amp window (kindledResolveDamageMultiplier/
          // applyKindledResolveStaggerResist above). Insufficient Kindling
          // is a dead press — no cooldown burn, no spend (legibility law,
          // same precedent as Shadow Step's blocked-blink/Judgment Line's
          // no-target case above): `activated` only flips true inside the
          // affordability branch.
          const kindlingNow = nextEntity.kindling ?? 0;
          if (kindlingNow >= KIN_KINDLED_RESOLVE_KINDLING_COST) {
            const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
            nextEntity = {
              ...nextEntity,
              kindling: kindlingNow - KIN_KINDLED_RESOLVE_KINDLING_COST,
              kindledResolveUntilTick: (state.tick + 1 + durTicks) as Tick,
            };
            activated = true;
          }
          break;
        }
        case "bulwark-step": {
          // Same farthest-collision-free-landing search SHAPE as Plant
          // Charge/Shadow Step above, but direction comes from currently-
          // HELD movement input (LeftBit/RightBit), never aim — "board-
          // facing shuffle-reposition" per the audit, the orthogonal-in-
          // KIND differentiation from Plant Charge's aim-directed charge
          // (constants.ts's KIN_BULWARK_STEP_* header comment has the full
          // reasoning). Horizontal-only (cy fixed at the caster's own y —
          // a lateral shuffle, not a leap), so no vertical map-bounds check
          // is needed (y is unchanged, already valid). Falls back to the
          // caster's current horizontal velocity sign, then +X, when
          // neither left nor right is held — same "always resolves a
          // direction, never a dead press for lack of aim" contract Plant
          // Charge's own dx0/dy0 fallback uses just above.
          const leftHeld = (currKeys & LeftBit) !== 0;
          const rightHeld = (currKeys & RightBit) !== 0;
          let stepDirX: number;
          if (rightHeld && !leftHeld) stepDirX = 1;
          else if (leftHeld && !rightHeld) stepDirX = -1;
          else if (Math.abs(nextEntity.vx) > 0.01) stepDirX = Math.sign(nextEntity.vx);
          else stepDirX = 1;
          for (let d = KIN_BULWARK_STEP_RANGE_PX; d >= 24; d -= 12) {
            const cx = nextEntity.x + stepDirX * d;
            const cy = nextEntity.y;
            if (cx < PLAYER_BODY_WIDTH / 2 || cx > runtime.map.size.x - PLAYER_BODY_WIDTH / 2) {
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
              // Deliberately does NOT touch `shieldActive` (and no field
              // here needs to "preserve" it) — World.ts's `tickShield`
              // runs AFTER this whole switch and recomputes shieldActive
              // fresh from held input every tick regardless of what this
              // case does, so Ward already survives every reposition in
              // this file. See constants.ts's KIN_BULWARK_STEP_RANGE_PX
              // doc comment for the full "keeps Ward up" verification.
              nextEntity = { ...nextEntity, x: cx };
              activated = true;
              break;
            }
          }
          break;
        }
        // (Crater's "cast" case — docs/card-pool-v2.md #26, exclusive:
        // Paladin — used to live here: leap + arm window, same shape as
        // Shock Ring above. Cut entirely 2026-07-19 alongside its sibling
        // exclusives Retort/Bastion; see cards.ts's cut note above the old
        // crater/retort/bastion card definitions. "crater" is no longer an
        // AbilityKind, so this switch has no case for it at all now.)
        // ── Syzygist catalog v1 (docs/class-ability-catalogs-v1.md) ────────
        // classId-gated to priest at the offer roll (round.ts). Every case
        // reuses the low-aim auto-target helpers (findNearestAlly/
        // findNearestEnemy, just above applyRegenToAlly) or an existing
        // substrate (spawnProjectile + fire-element burn, leechFraction,
        // applyRegenToAlly/applyHasteToAlly/applyWardToAlly, the Facet-
        // Break-style caster-side mark) — same discipline as the
        // Geometrician/Kindled blocks above. Abilities that write onto an
        // ALLY's entity (Borrowed Time, Haste Gift, Glass Ward, Self-
        // Lattice) call the exported `applyXToAlly` helpers, which write
        // directly into `players[target.id]` — safe from the same cross-
        // player-write-mid-loop hazard Facet Break's own comment documents,
        // because (like `applyTeamPeel`) they mutate the shared `players`
        // record immediately rather than deferring through `nextEntity`.
        case "bleed-tithe": {
          // Curse DoT + lifesteal, auto-targeted at the nearest enemy — a
          // fire-element shard reuses World.ts's OWN existing
          // element==="fire" burn-on-hit branch (below, in the projectile
          // hit-resolution pass) and ProjectileEntity.leechFraction's
          // existing self-heal-on-hit path (Crimson Tithe/Stolen Fangs'
          // own field) for zero new hit-resolution code. Devotion-from-
          // curse-uptime is a recorded v1 deferral — see constants.ts's
          // SYZ_DEVOTION_* header note.
          //
          // Genuine homing (2026-07-18, Jake: "genu[in]e homing" — see
          // SYZ_BLEED_TITHE_HOMING_STRENGTH's own doc comment): `pathing:
          // "homing"` re-targets the nearest enemy EVERY tick via
          // projectile.ts's existing `closestNonOwnerPlayer` machinery (the
          // same one seeker-facets/micro-seekers already use), not just at
          // cast time — the shard genuinely curves to follow if the target
          // moves, matching the card's own "self-guiding" description
          // instead of a one-shot auto-aimed straight line.
          const target = findNearestEnemy(nextEntity, state.players, SYZ_ENEMY_SEARCH_RANGE_PX);
          if (target !== null) {
            const dx0 = target.x - nextEntity.x;
            const dy0 = target.y - nextEntity.y;
            const aimAngle = lutAtan2(dy0, dx0);
            const shard = spawnProjectile(allocId(), {
              ownerId: pid,
              origin: { x: nextEntity.x, y: nextEntity.y - 20 },
              aimAngle,
              speed: SYZ_BLEED_TITHE_SPEED,
              damage: SYZ_BLEED_TITHE_DAMAGE,
              lifetimeMs: 1200,
              radius: 8,
              shape: build.projectile.shape,
              pathing: "homing",
              element: "fire",
            });
            shard.leechFraction = SYZ_BLEED_TITHE_LEECH_FRACTION;
            shard.homingStrength = SYZ_BLEED_TITHE_HOMING_STRENGTH;
            projectilesCow.set(shard.id, shard);
            activated = true;
          }
          break;
        }
        case "severance": {
          // Burst curse detonate on the nearest ALREADY-cursed enemy —
          // "execute-adjacent; take polarity". No cursed target in range =
          // a dead press (legibility law), no cooldown burn.
          const target = findNearestEnemy(nextEntity, state.players, SYZ_ENEMY_SEARCH_RANGE_PX, {
            requireCursed: true,
            tick: state.tick,
          });
          if (target !== null) {
            const dx0 = target.x - nextEntity.x;
            const dy0 = target.y - nextEntity.y;
            const aimAngle = lutAtan2(dy0, dx0);
            const shard = spawnProjectile(allocId(), {
              ownerId: pid,
              origin: { x: nextEntity.x, y: nextEntity.y - 20 },
              aimAngle,
              speed: SYZ_SEVERANCE_SPEED,
              damage: SYZ_SEVERANCE_DAMAGE,
              lifetimeMs: 1000,
              radius: 8,
              shape: build.projectile.shape,
              pathing: "straight",
              element: build.projectile.element,
            });
            projectilesCow.set(shard.id, shard);
            activated = true;
          }
          break;
        }
        case "borrowed-time": {
          // Instant heal to the nearest INJURED ally (auto-target), self
          // if none found; a flat, UNCONDITIONAL drain lands
          // SYZ_BORROWED_TIME_DEBT_DELAY_TICKS later (types.ts's
          // debtUntilTick doc comment — the doc's aggression-gate nuance is
          // a recorded v1 deferral). Self-cast uses the doc's own weaker
          // "solo/self" figures. The ally branch is a CROSS-PLAYER write —
          // deferred to pendingSyzygistCasts (see its own doc comment
          // above) rather than written directly; the self branch mutates
          // only `nextEntity`, so it's safe to apply immediately.
          const ally = findNearestAlly(nextEntity, state.players, SYZ_ALLY_SEARCH_RANGE_PX, {
            requireInjured: true,
          });
          const debtDelayTick = (state.tick + 1 + SYZ_BORROWED_TIME_DEBT_DELAY_TICKS) as Tick;
          if (ally !== null) {
            pendingSyzygistCasts.push({
              kind: "borrowed-time",
              targetId: ally.id,
              heal: SYZ_BORROWED_TIME_HEAL_ALLY,
              drain: SYZ_BORROWED_TIME_DRAIN_ALLY,
              debtDelayTick,
            });
          } else {
            nextEntity = {
              ...nextEntity,
              // 2026-07-22 bug fix: was a flat 100, capped Kindled well under 125.
              health: Math.min(maxHealthForPlayer(nextEntity), nextEntity.health + SYZ_BORROWED_TIME_HEAL_SELF),
              debtUntilTick: debtDelayTick,
              debtAmount: SYZ_BORROWED_TIME_DRAIN_SELF,
            };
          }
          activated = true;
          break;
        }
        case "focus-hex": {
          // Omnidirectional mark on the nearest enemy — no aim cone (the
          // low-aim direction), unlike Facet Break/Judgment Line. Mark
          // lives on the CASTER, same cross-player-write-hazard-avoidance
          // shape those two document; consumed at the projectile hit-
          // resolution site below (SYZ_FOCUS_HEX_AMP_MULTIPLIER).
          const target = findNearestEnemy(nextEntity, state.players, SYZ_ENEMY_SEARCH_RANGE_PX);
          if (target !== null) {
            const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
            nextEntity = {
              ...nextEntity,
              focusHexTargetId: target.id,
              focusHexMarkUntilTick: (state.tick + 1 + durTicks) as Tick,
            };
            activated = true;
          }
          break;
        }
        case "contagion": {
          // Instant pulse: every enemy within SYZ_CONTAGION_RADIUS_PX who
          // is ALREADY burning has that burn copied onto the nearest
          // un-burning enemy within SYZ_CONTAGION_JUMP_RADIUS_PX — reuses
          // the exact burnUntilTick/burnDps fields, one jump per source
          // (constants.ts's SYZ_CONTAGION_* header note). No source found
          // = a dead press, no cooldown burn. Every jump is a CROSS-PLAYER
          // write (source and jump-target are both OTHER players, never
          // the caster) — deferred to pendingSyzygistCasts (see its own
          // doc comment above) instead of written directly here.
          let jumped = false;
          for (const [srcId, source] of Object.entries(state.players)) {
            if (!source.alive) continue;
            if (isAlly(nextEntity, source)) continue;
            if (source.burnUntilTick === undefined || source.burnUntilTick <= state.tick) continue;
            const dSrc = Math.hypot(source.x - nextEntity.x, source.y - nextEntity.y);
            if (dSrc > SYZ_CONTAGION_RADIUS_PX) continue;
            let bestId: PlayerId | null = null;
            let bestDist = Infinity;
            for (const [otherId, other] of Object.entries(state.players)) {
              if (otherId === srcId) continue;
              if (!other.alive) continue;
              if (isAlly(nextEntity, other)) continue;
              if (other.burnUntilTick !== undefined && other.burnUntilTick > state.tick) continue;
              const dist = Math.hypot(other.x - source.x, other.y - source.y);
              if (dist > SYZ_CONTAGION_JUMP_RADIUS_PX) continue;
              if (dist < bestDist) {
                bestDist = dist;
                bestId = otherId as PlayerId;
              }
            }
            if (bestId !== null) {
              pendingSyzygistCasts.push({
                kind: "contagion",
                sourceId: srcId as PlayerId,
                jumpTargetId: bestId,
              });
              jumped = true;
            }
          }
          activated = jumped;
          break;
        }
        case "flock-pulse": {
          // Instant nova (Lattice-style ring), damage scaled by how many
          // OTHER players currently entangle with this caster — the same
          // dedup-by-target-id count Devotion's own accrual pass computes
          // (constants.ts's SYZ_FLOCK_PULSE_* header note). Two independent
          // counts, matching the catalog doc's "Solo: cursed count; team:
          // allies+cursed" (2026-07-19 D3 fast-follow — buffed-ally count
          // alone left this ability doing only its flat base damage for any
          // Syzygist with no ally, i.e. every solo FFA cast).
          let allySourceCount = 0;
          let enemySourceCount = 0;
          for (const [otherId, other] of Object.entries(state.players)) {
            if ((otherId as PlayerId) === pid || !other.alive) continue;
            const carriesRegen =
              other.regenSourceId === pid &&
              other.regenUntilTick !== undefined &&
              other.regenUntilTick > state.tick;
            const carriesHaste =
              other.hasteSourceId === pid &&
              other.hasteUntilTick !== undefined &&
              other.hasteUntilTick > state.tick;
            const carriesWard =
              other.wardAbsorbSourceId === pid &&
              other.wardAbsorbUntilTick !== undefined &&
              other.wardAbsorbUntilTick > state.tick;
            if (carriesRegen || carriesHaste || carriesWard) allySourceCount++;
            const carriesBurn =
              other.burnSourceId === pid &&
              other.burnUntilTick !== undefined &&
              other.burnUntilTick > state.tick;
            if (carriesBurn) enemySourceCount++;
          }
          const sourceCount =
            Math.min(allySourceCount, SYZ_DEVOTION_MAX_COUNTED_SOURCES) +
            Math.min(enemySourceCount, SYZ_DEVOTION_MAX_COUNTED_SOURCES);
          // Aoe role rework (2026-07-18): was a ring of SYZ_FLOCK_PULSE_
          // COUNT discrete shards, the scaled total split evenly across
          // them (so any one target usually only caught one shard's
          // fraction); now an instant radius check — the FULL scaled total
          // lands on every enemy in range in one tick.
          //
          // D3 brake (2026-07-18, docs/axiom-deviations-audit.md — see
          // `syzygistLeadBrakeMultiplier`'s own doc comment above): only the
          // PER-SOURCE bonus is braked by this caster's in-round kill lead,
          // never SYZ_FLOCK_PULSE_BASE_DAMAGE — a snowballing Syzygist's
          // nova still always does SOMETHING, it just stops scaling as hard
          // with ally count the further ahead this round they already are.
          const brake = syzygistLeadBrakeMultiplier(pid, state.players, state.round.roundKills);
          const totalDamage =
            SYZ_FLOCK_PULSE_BASE_DAMAGE + sourceCount * SYZ_FLOCK_PULSE_PER_SOURCE_DAMAGE * brake;
          pendingInstantAoe.push({
            kind: "flock-pulse",
            casterId: pid,
            x: nextEntity.x,
            y: nextEntity.y,
            radius: SYZ_FLOCK_PULSE_RADIUS_PX,
            damage: totalDamage,
            slowMultiplier: SYZ_FLOCK_PULSE_SLOW_MULTIPLIER,
            slowDurationMs: SYZ_FLOCK_PULSE_SLOW_DURATION_MS,
          });
          activated = true;
          break;
        }
        case "self-lattice": {
          // Weak self-ward — "deliberately weaker than ally ward... solo
          // still has a button". Self-cast always succeeds when alive: a
          // teamed caster's isAlly(self, self) is true (applyWardToAlly's
          // own gate), and an FFA/solo caster still needs a real solo
          // floor here — so self-lattice bypasses applyWardToAlly's team
          // gate entirely and writes the caster's own fields directly,
          // exactly like Return Glass/Bastion Pulse's self-only shield-
          // charge ticks above (never routed through an isAlly check).
          nextEntity = {
            ...nextEntity,
            wardAbsorbUntilTick: (state.tick + 1 + SYZ_WARD_DURATION_TICKS_DEFAULT) as Tick,
            wardAbsorbRemaining: SYZ_SELF_LATTICE_ABSORB,
            wardAbsorbSourceId: pid,
          };
          activated = true;
          break;
        }
        case "glass-ward": {
          // Stronger absorb on the nearest ally (auto-target); self at
          // reduced strength if none in range — "teams peak; solo
          // fallback" per the doc. The ally branch is a CROSS-PLAYER write
          // (deferred to pendingSyzygistCasts, see its own doc comment
          // above — applyWardToAlly is only safe to call from the
          // post-loop resolution pass, not from inside this loop for a
          // target that may not have had its own turn yet); the self
          // fallback mutates only `nextEntity`, so it applies immediately.
          const ally = findNearestAlly(nextEntity, state.players, SYZ_ALLY_SEARCH_RANGE_PX);
          if (ally !== null) {
            pendingSyzygistCasts.push({
              kind: "glass-ward",
              casterId: pid,
              targetId: ally.id,
              absorb: SYZ_GLASS_WARD_ALLY_ABSORB,
              durationTicks: SYZ_WARD_DURATION_TICKS_DEFAULT,
            });
          } else {
            nextEntity = {
              ...nextEntity,
              wardAbsorbUntilTick: (state.tick + 1 + SYZ_WARD_DURATION_TICKS_DEFAULT) as Tick,
              wardAbsorbRemaining: SYZ_GLASS_WARD_SELF_FALLBACK_ABSORB,
              wardAbsorbSourceId: pid,
            };
          }
          activated = true;
          break;
        }
        case "haste-gift": {
          // Ally haste (auto-target), half-strength self if solo — "self
          // half if solo" per the doc, literal. Window length reads the
          // card's own `active.durationMs` (5000, cards.ts) rather than
          // SYZ_HASTE_DURATION_TICKS_DEFAULT, matching Aegis Share's own
          // card-owns-its-window precedent. The ally branch is a
          // CROSS-PLAYER write — deferred to pendingSyzygistCasts, same
          // reasoning as Glass Ward immediately above.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          const ally = findNearestAlly(nextEntity, state.players, SYZ_ALLY_SEARCH_RANGE_PX);
          if (ally !== null) {
            pendingSyzygistCasts.push({
              kind: "haste-gift",
              casterId: pid,
              targetId: ally.id,
              multiplier: SYZ_HASTE_MULTIPLIER_DEFAULT,
              durationTicks: durTicks,
            });
          } else {
            nextEntity = {
              ...nextEntity,
              hasteUntilTick: (state.tick + 1 + durTicks) as Tick,
              hasteMultiplier: SYZ_HASTE_GIFT_SELF_MULTIPLIER,
              hasteSourceId: pid,
            };
          }
          activated = true;
          break;
        }
        case "drift-step": {
          // The ONE catalog ability the doc tags "(player aim)" — same
          // farthest-collision-free-landing search as Slip Node/Shadow
          // Step/Plant Charge, aimed by the player like those (NOT an
          // auto-target — deliberate exception, see constants.ts's
          // SYZ_DRIFT_STEP_RANGE_PX header note).
          const dx0 = aimX - nextEntity.x;
          const dy0 = aimY - nextEntity.y;
          const dLen = Math.sqrt(dx0 * dx0 + dy0 * dy0);
          const dirX = dLen > 0.001 ? dx0 / dLen : 1;
          const dirY = dLen > 0.001 ? dy0 / dLen : 0;
          for (let d = SYZ_DRIFT_STEP_RANGE_PX; d >= 24; d -= 12) {
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
        // ── Interstice catalog v1 (docs/class-ability-catalogs-v1.md) ──────
        // classId-gated to ninja at the offer roll (round.ts). Every case
        // below is EITHER a self-only window-buff (Undercut/Edge Storm/Read
        // Mark/Wall Bloom/Ghost Guard/Second Wind/Razor Route — consumed at
        // the NINJA MELEE section's own arc-hit/wave-spawn/wall-kick/
        // dash-through sites below, or — Ghost Guard only —
        // combat.ts's tryDeflectDamage) OR an auto-targeted projectile
        // spawn (Needle/Shard Ring — the SAME findNearestEnemy/
        // spawnProjectile substrate the Geometrician/Syzygist blocks above
        // already reuse). None of the nine writes into another player's
        // entity from inside THIS loop — the pendingSyzygistCasts
        // deferred-write hazard that block's own comment documents doesn't
        // come up here (audited case by case; see the ninja-catalog
        // report).
        case "undercut": {
          // Window — consumed by the NINJA MELEE arc-hit-resolution section
          // below (types.ts's undercutUntilTick doc comment). v1 scope: arc
          // hits only, not the wave — the wave lands via the generic
          // projectile hit-resolution pass, a much larger shared surface
          // touched by every class; extending an execute check there is a
          // recorded v1 deferral, same "don't widen a shared pass for one
          // ability" discipline as Contagion's burn-only scope above.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            undercutUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "edge-storm": {
          // Charge bank — consumed at the wave-spawn site (NINJA MELEE
          // section below) for up to NINJA_EDGE_STORM_CHARGES swings. The
          // doc's "reduced cost" half is N/A in v1 (see this case's
          // constants.ts header note); only "+wave damage" is implemented.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            edgeStormUntilTick: (state.tick + 1 + durTicks) as Tick,
            edgeStormChargesRemaining: NINJA_EDGE_STORM_CHARGES,
          };
          activated = true;
          break;
        }
        case "needle": {
          // Auto-targeted gap-finish: a short self-lunge (flavor: "already
          // closed the distance") plus a fast, short-range, high-damage
          // shard — spawns a real projectile (Sunspike/Bleed Tithe/
          // Severance's own shape) so shield/parry/ward mitigation applies
          // for free via the existing hit-resolution pass, rather than a
          // hand-rolled direct-damage write that would need a cross-player
          // deferred-write queue this chassis's kit otherwise never needs.
          const target = findNearestEnemy(nextEntity, state.players, NINJA_NEEDLE_RANGE_PX);
          if (target !== null) {
            const dx0 = target.x - nextEntity.x;
            const dy0 = target.y - nextEntity.y;
            const dist = Math.hypot(dx0, dy0);
            const dirX = dist > 0.001 ? dx0 / dist : 1;
            const dirY = dist > 0.001 ? dy0 / dist : 0;
            const lunge = Math.min(NINJA_NEEDLE_LUNGE_PX, Math.max(0, dist - 20));
            nextEntity = {
              ...nextEntity,
              x: nextEntity.x + dirX * lunge,
              y: nextEntity.y + dirY * lunge,
            };
            const aimAngle = lutAtan2(dy0, dx0);
            const shard = spawnProjectile(allocId(), {
              ownerId: pid,
              origin: { x: nextEntity.x, y: nextEntity.y - 20 },
              aimAngle,
              speed: NINJA_NEEDLE_SPEED,
              damage: NINJA_NEEDLE_DAMAGE,
              lifetimeMs: Math.max(50, (NINJA_NEEDLE_RANGE_PX / NINJA_NEEDLE_SPEED) * 1000),
              radius: 7,
              shape: build.projectile.shape,
              pathing: "straight",
              element: "crystal",
            });
            shard.rangePx = NINJA_NEEDLE_RANGE_PX;
            // Bespoke render identity (2026-07-20) — same fix as Edge
            // Storm's wave, see types.ts's `ninjaBladeShard` field comment:
            // was riding `element: "crystal"` alone and reading as the
            // Geometrician's own crystal-dart shape. Render-only;
            // `element` above stays "crystal" so damage/impact behavior
            // is unchanged.
            shard.ninjaBladeShard = true;
            projectilesCow.set(shard.id, shard);
            activated = true;
          }
          break;
        }
        case "read-mark": {
          // Omnidirectional auto-target mark, lives on the CASTER
          // (readTargetId/readMarkUntilTick) — same cross-player-write-
          // hazard-avoidance shape Facet Break/Judgment Line/Focus Hex
          // already establish. Consumed by the NEXT landed ninja melee arc
          // hit on that specific target (NINJA MELEE section below); the
          // window itself is NOT consumed on use (a per-target amp while
          // live, same non-consuming-window shape as Undercut above). v1
          // scope: the CAST half only — the doc's "dash-through also tags
          // Read" nuance is a recorded deferral (would thread catalog-
          // ability state into the always-on chassis dash-through
          // detector, a bigger touch surface on already-shipped baseline
          // chassis code than this pass takes on). Razor Route (below)
          // reuses this SAME pair of fields for its own "marks Read on
          // cross" line — the two abilities share one mark slot by design.
          const target = findNearestEnemy(nextEntity, state.players, NINJA_READ_MARK_RANGE_PX);
          if (target !== null) {
            const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
            nextEntity = {
              ...nextEntity,
              readTargetId: target.id,
              readMarkUntilTick: (state.tick + 1 + durTicks) as Tick,
            };
            activated = true;
          }
          break;
        }
        case "shard-ring": {
          // Aoe role rework (2026-07-18): was a full-circle ring of
          // discrete shard projectiles; now an instant radius check queued
          // for the post-loop resolution pass — the blade's aftermath in
          // every direction at once landing in one tick, guaranteed, on
          // everyone in range. Pure damage, no status (a raw punish, not a
          // control tool — the differentiation from Wall Bloom's smaller,
          // cheaper wall-contact burst).
          pendingInstantAoe.push({
            kind: "shard-ring",
            casterId: pid,
            x: nextEntity.x,
            y: nextEntity.y,
            radius: NINJA_SHARD_RING_RADIUS_PX,
            damage: NINJA_SHARD_RING_DAMAGE,
          });
          activated = true;
          break;
        }
        case "wall-bloom": {
          // Window — consumed at the wall-kick energy-grant site (loop 1,
          // right after mirrorMovementMemoryOntoEntity), single-use
          // (cleared on the next wall-kick, not just on timeout).
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            wallBloomUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "ghost-guard": {
          // Banked evasion charge — consumed by combat.ts's
          // tryDeflectDamage (a new branch right after the always-on dash-
          // i-frame check), not by anything in this file. "If moving" is
          // checked there against the player's OWN current velocity at hit
          // time, not at cast time.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            ghostGuardChargeUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "second-wind": {
          // Window — consumed by the NEXT landed ninja melee arc hit
          // (self-heal + energy, NINJA MELEE section below). Self-only
          // write on the attacker's own turn, same safety as Bastion
          // Pulse/Return Glass's self-only shield ticks above.
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            secondWindUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "razor-route": {
          // Window — consumed by the NEXT dash-trigger inside the NINJA
          // MELEE section's own dash-through detection (below): an extra
          // velocity impulse along the dash direction (TS-side, additive
          // on top of whatever the movement backend already computed —
          // the same "post-hoc velocity nudge" shape Recoil Step already
          // proves out) plus a Read mark on the first body crossed.
          // Deliberately does NOT touch player.ts's DASH_SPEED/
          // DASH_DURATION_MS (the Zig-mirrored dash physics itself) —
          // six-axes-goal.md's "Zig line" doctrine keeps ability/window
          // state off that surface. The doc's "through-platforms soft"
          // nuance is a recorded v1 deferral (a collision-layer change on
          // the always-on dash, out of scope here).
          const durTicks = Math.ceil(active.durationMs / Math.max(1, dtMs));
          nextEntity = {
            ...nextEntity,
            razorRouteUntilTick: (state.tick + 1 + durTicks) as Tick,
          };
          activated = true;
          break;
        }
        case "paper-double": {
          // Paper Double (movement, the catalog's 10th ability — previously
          // deferred, see cardTypes.ts's own updated deferral note and
          // types.ts's PaperDoubleEntity header for the full shape). Unlike
          // every case above, this spawns a brand-new WorldState entity
          // instead of writing a window/mark onto `nextEntity` — collected
          // into `pendingPaperDoubleSpawns` (merged into `state.paperDoubles`
          // in section "3c2. Paper Doubles" below), never written directly,
          // matching `pendingZoneSpawns`' own "spawn is safe mid-loop,
          // merging happens once at the single site that owns the
          // collection" reasoning.
          //
          // "Sprinting your last input vector" (v1 reading, PaperDoubleEntity's
          // own header comment): the caster's CURRENT HORIZONTAL velocity
          // direction if they're actually running (|vx| above
          // NINJA_PAPER_DOUBLE_STATIONARY_SPEED_PX), falling back to aim
          // direction for a horizontally-stationary caster. Deliberately
          // HORIZONTAL-ONLY, not the full (vx, vy) vector: `vy` is gravity-
          // driven for most of a player's airtime, not player INPUT — an
          // in-air (even standing-still-on-the-spot) cast would otherwise
          // pick up tens of px/s of pure-gravity fall velocity within a
          // SINGLE tick (well past the stationary threshold) and spawn a
          // decoy diving straight into the floor, nothing like "sprinting".
          // "Input vector" in this 2D platformer is fundamentally
          // horizontal (Left/Right); jump is a discrete action, not a held
          // aim-like direction — a decoy "sprints" along the ground plane,
          // it doesn't dive. A stationary caster falls back to the FULL 2D
          // aim vector instead (any direction, including vertical) — "sprints
          // the way you're looking" is a fine stand-in for "last input" when
          // there IS no horizontal movement input to echo. `aimX`/`aimY`
          // here are the per-player loop's own locals (`input?.aimX ??
          // entity.aimX`, computed once above) — an ABSOLUTE world-space
          // cursor point, NOT a direction vector (same "aimX/aimY on the
          // input are an absolute cursor point, not a unit vector" contract
          // every other aim-consuming case in this switch already follows —
          // Sunlance/Facet Break/Needle/etc all compute `aimX - nextEntity.x`,
          // never read `.aimX` as a direction on its own).
          let dirX: number;
          let dirY: number;
          if (Math.abs(nextEntity.vx) > NINJA_PAPER_DOUBLE_STATIONARY_SPEED_PX) {
            dirX = Math.sign(nextEntity.vx);
            dirY = 0;
          } else {
            const aimDx = aimX - nextEntity.x;
            const aimDy = aimY - nextEntity.y;
            const aimLen = Math.hypot(aimDx, aimDy);
            if (aimLen > 1e-3) {
              dirX = aimDx / aimLen;
              dirY = aimDy / aimLen;
            } else {
              dirX = 1;
              dirY = 0;
            }
          }
          // Resonance-gated swap (2026-07-19 fast-follow — docs/card-pool-
          // v2.md: "Cast Paper Double INTO a live window: you and the
          // double swap positions at cast instead"). Checked here, BEFORE
          // the shared post-switch resonance block below (which computes
          // its own `resonated` from these SAME fields and still applies —
          // the swap replaces the SPAWN, not the generic CD-refund bonus).
          // Same "chains unlike abilities" eligibility every resonance
          // consumer follows: a live window opened by a DIFFERENT kind.
          // Mirrors a live decoy owned by THIS caster — the earliest by
          // EntityId (determinism; in practice at most one can exist, since
          // NINJA_PAPER_DOUBLE_CD_MS (9s) outlasts NINJA_PAPER_DOUBLE_
          // LIFETIME_MS (2.5s), so a second cast's own decoy can't overlap
          // an still-live prior one under normal cooldown play).
          const resonanceLiveForSwap =
            nextEntity.resonanceUntilTick !== undefined &&
            nextEntity.resonanceUntilTick > state.tick &&
            nextEntity.resonanceSourceKind !== undefined &&
            nextEntity.resonanceSourceKind !== "paper-double";
          let ownDecoyId: EntityId | undefined;
          const existingPaperDoubles = state.paperDoubles ?? {};
          if (resonanceLiveForSwap) {
            const decoyIds = Object.keys(existingPaperDoubles)
              .map((idStr) => EntityId(Number(idStr)))
              .sort((a, b) => a - b);
            for (const decoyId of decoyIds) {
              if (existingPaperDoubles[decoyId]!.ownerId === pid) {
                ownDecoyId = decoyId;
                break;
              }
            }
          }
          if (ownDecoyId !== undefined) {
            const decoy = existingPaperDoubles[ownDecoyId]!;
            const dxSwap = decoy.x - nextEntity.x;
            const dySwap = decoy.y - nextEntity.y;
            const swapDist = Math.hypot(dxSwap, dySwap);
            // Bounded exchange, not always a full teleport-to-exact-position
            // — "max displacement ≈ 900px... never a free cross-map blink"
            // (the doc's own appendix explicitly rejected an unbounded
            // universal Blink card; this is the survivor). Within the cap,
            // the swap is exact; beyond it, both sides move only the capped
            // distance along the same line — a partial exchange rather than
            // a full one, never exceeding the documented bound.
            const scale = swapDist > NINJA_PAPER_DOUBLE_SWAP_MAX_DISPLACEMENT_PX && swapDist > 0
              ? NINJA_PAPER_DOUBLE_SWAP_MAX_DISPLACEMENT_PX / swapDist
              : 1;
            const casterOldX = nextEntity.x;
            const casterOldY = nextEntity.y;
            nextEntity = {
              ...nextEntity,
              x: casterOldX + dxSwap * scale,
              y: casterOldY + dySwap * scale,
            };
            pendingPaperDoubleSwaps.push({
              decoyId: ownDecoyId,
              x: decoy.x - dxSwap * scale,
              y: decoy.y - dySwap * scale,
            });
            activated = true;
            break;
          }
          // v1 always SPAWNS when the swap isn't eligible (no live
          // resonance window, or no live decoy of this caster's own to
          // swap with) — the ordinary "sprint a fresh decoy" cast.
          const pd = buildPaperDoubleEntity(
            allocId(),
            pid,
            nextEntity.x,
            nextEntity.y,
            dirX,
            dirY,
            NINJA_PAPER_DOUBLE_MAX_HEALTH,
            NINJA_PAPER_DOUBLE_LIFETIME_MS,
          );
          pendingPaperDoubleSpawns.push(pd);
          // No manual "ability-activated" push here — the generic post-
          // switch block right below (keyed off `active.kind`) already
          // emits it for every case, this one included.
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

  // Resolve deferred Syzygist ally-target casts (class-overhaul-workboard.md
  // chunk 3.4) — NOW safe, since every player above has committed their own
  // turn into `players`. Re-reads caster/target fresh off the now-current
  // `players` record (not the stale per-iteration `entity` the loop above
  // used) so a target who ALSO took damage/healing this same tick from
  // another source is handled correctly. See pendingSyzygistCasts's own
  // doc comment (declared just above the loop) for why this two-phase
  // shape exists at all.
  for (const cast of pendingSyzygistCasts) {
    switch (cast.kind) {
      case "haste-gift": {
        const caster = players[cast.casterId];
        const target = players[cast.targetId];
        if (caster && target) {
          applyHasteToAlly(caster, target, players, state.tick, cast.multiplier, cast.durationTicks);
        }
        break;
      }
      case "glass-ward": {
        const caster = players[cast.casterId];
        const target = players[cast.targetId];
        if (caster && target) {
          applyWardToAlly(caster, target, players, state.tick, cast.absorb, cast.durationTicks);
        }
        break;
      }
      case "borrowed-time": {
        const target = players[cast.targetId];
        if (target && target.alive) {
          players[cast.targetId] = {
            ...target,
            // 2026-07-22 bug fix: was a flat 100, capped Kindled well under 125.
            health: Math.min(maxHealthForPlayer(target), target.health + cast.heal),
            debtUntilTick: cast.debtDelayTick,
            debtAmount: cast.drain,
          };
        }
        break;
      }
      case "contagion": {
        const source = players[cast.sourceId];
        const jumpTarget = players[cast.jumpTargetId];
        // Re-check the source is STILL burning (defensive — another pass
        // this tick could in principle have cleared it; none currently
        // does, but this keeps the write honest rather than trusting a
        // stale read).
        if (
          source &&
          jumpTarget &&
          source.burnUntilTick !== undefined &&
          source.burnUntilTick > state.tick
        ) {
          players[cast.jumpTargetId] = {
            ...jumpTarget,
            burnUntilTick: source.burnUntilTick,
            burnDps: source.burnDps,
            burnTickLastApplied: state.tick,
            // Carries the ORIGINAL curse's attribution forward, not
            // Contagion's own caster — this is a spread of an existing
            // curse (with its existing properties), not a new one authored
            // by whoever cast Contagion. Keeps Devotion/Flock Pulse credit
            // (World.ts's accrual pass, burnSourceId) with whichever
            // Syzygist actually cursed the chain's first target, correct
            // even in a multi-Syzygist match where the spreader and the
            // original curser are different players.
            burnSourceId: source.burnSourceId,
          };
        }
        break;
      }
    }
  }

  // Perf hoist: id-sorted player list, computed ONCE per tick and shared by
  // every pass that needs deterministic player iteration (bash, per-
  // projectile hit sweeps, AOE, homing, chain-lightning). The key SET is
  // stable for the rest of the tick — passes mutate player VALUES, never
  // add/remove ids — so this is byte-identical to each pass re-sorting.
  const sortedPlayerIdsForTick = (Object.keys(players) as PlayerId[]).sort();

  // 1x. HITSCAN HIT RESOLUTION (2026-07-20, true hitscan) — resolves
  //     `pendingHitscanHits`, queued during the per-player loop above by any
  //     raycast-delivery pellet's ray-trace. Deferred to here (same
  //     post-loop timing as DASH BASH/NINJA MELEE/PALADIN MELEE/instant AOE
  //     below) because `players` is now FULLY committed — every player's own
  //     turn has already run, so reading/writing ANY victim (including one
  //     that fires AFTER its own turn in iteration order) is safe. See the
  //     per-player loop's own comment at the hitscan-pellet site for the
  //     full hazard this avoids.
  const hitscanTick = Tick(state.tick + 1);
  for (const pending of pendingHitscanHits) {
    const victim = players[pending.victimId];
    if (!victim || !victim.alive) continue;
    const headshot = isHeadshot(pending.hitY, victim);
    const hitEv: Extract<SimEvent, { t: "hit-confirmed" }> = {
      t: "hit-confirmed",
      victimId: pending.victimId,
      damage: headshot ? pending.source.damage * HEADSHOT_DAMAGE_MULTIPLIER : pending.source.damage,
      sourceProjectileId: pending.source.id,
      attackerId: pending.source.ownerId,
      headshot,
    };
    const rangedCtx: RangedHitContext = {
      chaosProfile,
      hangoutMode,
      fightingPhase,
      firstBloodAlreadyClaimedThisRound: state.round.firstBloodPlayerId !== undefined,
      nextTick: hitscanTick,
      effDtMs,
      sortedPlayerIds: sortedPlayerIdsForTick,
      firstBloodAwardThisTick,
      remainingProjectiles: {},
      deflectedProjectileIds: runtime.scratchDeflectedProjectiles,
    };
    const rangedResult = resolveRangedHit(hitEv, pending.source, players, events, rangedCtx);
    firstBloodAwardThisTick = rangedResult.firstBloodAwardThisTick;
    if (!rangedResult.suppressed) events.push(hitEv);
    // Mirror shield: a real projectile physically reverses and reassigns
    // owner (untouched elsewhere in this file); a hitscan shot has no entity
    // to reverse, so re-resolve ONE more trace from the victim back along
    // the same line toward where it came from — single bounce only, no
    // further reflection. Safe to do inline here (unlike the per-player
    // loop) since every player is already fully committed by this point.
    if (rangedResult.reflectedVictimId !== undefined) {
      const bouncer = players[rangedResult.reflectedVictimId];
      if (bouncer) {
        const backAngle = Math.atan2(pending.source.vy, pending.source.vx) + Math.PI;
        // A single reflected bounce never pierces — [0] is always the only
        // (and final) trace here.
        const bounceTrace = resolveHitscanShot(
          bouncer.x,
          bouncer.y,
          backAngle,
          pending.rangePx,
          rangedResult.reflectedVictimId,
          players,
          sortedPlayerIdsForTick,
          runtime.collisionCache,
          undefined,
          undefined,
          pending.source.radius,
        )[0]!;
        if (bounceTrace.hitPlayerId !== null) {
          const bounceVictim = players[bounceTrace.hitPlayerId];
          if (bounceVictim && bounceVictim.alive) {
            const bounceHeadshot = isHeadshot(bounceTrace.hitY, bounceVictim);
            const bounceEv: Extract<SimEvent, { t: "hit-confirmed" }> = {
              t: "hit-confirmed",
              victimId: bounceTrace.hitPlayerId,
              damage: bounceHeadshot
                ? pending.source.damage * HEADSHOT_DAMAGE_MULTIPLIER
                : pending.source.damage,
              sourceProjectileId: allocId(),
              attackerId: rangedResult.reflectedVictimId,
              headshot: bounceHeadshot,
            };
            const bounceResult = resolveRangedHit(
              bounceEv,
              {
                id: bounceEv.sourceProjectileId!,
                ownerId: rangedResult.reflectedVictimId,
                element: pending.source.element,
                x: bouncer.x,
                y: bouncer.y,
                vx: Math.cos(backAngle),
                vy: Math.sin(backAngle),
                damage: pending.source.damage,
                tendril: pending.source.tendril,
                leechFraction: pending.source.leechFraction,
                radius: pending.source.radius,
              },
              players,
              events,
              { ...rangedCtx, firstBloodAwardThisTick },
            );
            firstBloodAwardThisTick = bounceResult.firstBloodAwardThisTick;
            if (!bounceResult.suppressed) events.push(bounceEv);
          }
        }
      }
    }
  }

  // 1y. INSTANT AOE RESOLUTION (aoe role rework, 2026-07-18) — resolves
  //     `pendingInstantAoe`, queued above by Prism Fan/Lattice's instant
  //     slow/Shock Ring/Flock Pulse/Shard Ring/Wall Bloom (Consecrated
  //     Field's instant slow and Crater's epicenter+ring were also in this
  //     list until they were cut, 2026-07-19). Same post-loop timing and mitigation
  //     chain as DASH BASH/NINJA MELEE/PALADIN MELEE below (tryDeflectDamage
  //     → rallyLightDamageMultiplier → applyTeamPeel),
  //     just a plain center-to-center radius (+ optional cone) check instead
  //     of a frontal-arc/dash-collision shape. A target standing in range
  //     always takes the hit — there is no projectile path to dodge around,
  //     which IS the fix (a real area check, not projectile-vs-player
  //     collision).
  // Extracted so a SECOND, later-in-the-tick batch (Paper Double's decoy
  // bursts — section "3c2" below) can resolve through the identical
  // mitigation chain without duplicating it. Paper Double bursts are
  // discovered too late in tick order (after projectile/lifetime
  // resolution, section 3b/3c) to land in the FIRST call below — this
  // block already ran and drained `pendingInstantAoe` by then, so pushing
  // into that same array from later code would silently lose the entry.
  // Same closure-captured locals every call site already relies on
  // (players/events/sortedPlayerIdsForTick/effDtMs) — a nested function,
  // not a module-level export, since none of this is meaningful outside
  // one tick's `stepWithRuntime` call.
  function resolveInstantAoeCasts(casts: PendingInstantAoe[], aoeTick: Tick): void {
    for (const cast of casts) {
      const caster = players[cast.casterId];
      if (!caster) continue;
      for (const vid of sortedPlayerIdsForTick) {
        if (vid === cast.casterId) continue;
        const victim = players[vid]!;
        if (!victim.alive) continue;
        const dx = victim.x - cast.x;
        const dy = victim.y - cast.y;
        const dist = Math.hypot(dx, dy);
        if (dist > cast.radius) continue;
        if (cast.coneRadians !== undefined && cast.aimAngle !== undefined) {
          let da = Math.atan2(dy, dx) - cast.aimAngle;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) > cast.coneRadians / 2) continue;
        }

        const victimBuild = resolvePlayerBuild(victim);
        // A status-only entry (cast.damage === 0 — Consecrated Field's
        // instant slow was the one live example of this until it was cut
        // 2026-07-19; the defensive handling stays in case a future
        // ability needs it) still needs the REAL mitigation chain
        // evaluated — tryDeflectDamage short-circuits into a no-op
        // passthrough for damage<=0 (skipping shield/parry/ninja-evasion
        // entirely), which would let the slow ignore a raised shield or a
        // dashing ninja's i-frames. Feed it a nominal 1 damage purely so
        // shielded/deflected/evaded resolve correctly, then discard that
        // nominal amount below — only cast.damage (the REAL damage) ever
        // reaches health.
        const nominalDamage = cast.damage > 0 ? cast.damage : 1;
        const mit = tryDeflectDamage(victim, null, nominalDamage, aoeTick, {
          mirrorShield: victimBuild.mirrorShield,
          directionalShield: victimBuild.directionalShield,
          parryCoverMultiplier: victimBuild.parryCoverMultiplier,
          attackerPos: { x: cast.x, y: cast.y },
        });
        const blocked = mit.shielded || mit.deflected;
        let post = mit.player;
        if (mit.evaded || blocked) {
          if (!mit.evaded) {
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
          continue;
        }

        if (cast.damage > 0) {
          const liveCaster = players[cast.casterId]!;
          let finalDamage = mit.damage;
          finalDamage *= rallyLightDamageMultiplier(liveCaster, players, aoeTick);
          finalDamage *= kindledResolveDamageMultiplier(liveCaster, aoeTick);
          finalDamage *= fooledDamageMultiplier(victim, aoeTick);
          if (!mit.warded) {
            const peel = applyTeamPeel(victim, finalDamage, players, sortedPlayerIdsForTick, aoeTick);
            if (peel) {
              finalDamage = peel.damage;
              events.push(peel.event);
            }
          }
          const newHealth = Math.max(0, post.health - finalDamage);
          const wasAlive = post.alive;
          post = { ...post, health: newHealth, alive: newHealth > 0 };
          events.push({
            t: "hit-confirmed",
            victimId: vid,
            damage: finalDamage,
            sourceProjectileId: null,
            attackerId: cast.casterId,
          });
          if (wasAlive && newHealth === 0) {
            events.push({ t: "player-killed", victimId: vid, killerId: cast.casterId, cause: "aoe" });
          }
          if (mit.warded) {
            events.push({
              t: "ward-absorbed",
              playerId: vid,
              damageBlocked: mit.wardDamageBlocked,
              kindlingGranted: mit.wardKindlingGranted,
            });
          }
          if (mit.syzWarded) {
            events.push({
              t: "syz-ward-absorbed",
              playerId: vid,
              casterId: victim.wardAbsorbSourceId ?? vid,
              damageBlocked: mit.syzWardDamageBlocked ?? 0,
              wardBroke: mit.syzWardBroke ?? false,
            });
          }
        }

        // Status (slow/stagger) — applied whenever the hit wasn't evaded or
        // blocked above, regardless of whether real damage also landed
        // (Flock Pulse carries both; Crater used to as well, until it was
        // cut 2026-07-19 — same for Consecrated Field, cut the same week).
        // Same "keep whichever ends later, take the lower (more punishing)
        // multiplier" stacking policy the projectile-sourced player-slowed
        // consumer already uses (below, section 3a).
        if (cast.slowMultiplier !== undefined && cast.slowDurationMs !== undefined) {
          const ticksDuration = Math.ceil(cast.slowDurationMs / effDtMs);
          const until = Tick(aoeTick + ticksDuration);
          const prevUntil = post.slowedUntilTick ?? Tick(0);
          const prevMul = post.slowMultiplier ?? 1;
          // Kindled Resolve (coverage-floor fast-follow): resist BEFORE the
          // stacking comparison, so a resisted stagger competes fairly
          // against any pre-existing slow using its actually-applied
          // strength — a no-op for every victim without the buff.
          const resistedMul = applyKindledResolveStaggerResist(post, cast.slowMultiplier, aoeTick);
          post = {
            ...post,
            slowedUntilTick: Tick(Math.max(prevUntil, until)),
            slowMultiplier: Math.min(prevMul, resistedMul),
          };
          events.push({
            t: "player-slowed",
            victimId: vid,
            multiplier: resistedMul,
            durationMs: cast.slowDurationMs,
          });
        }

        // Fooled (Paper Double's burst debuff, 2026-07-19 fast-follow) —
        // same "applied whenever the hit wasn't evaded/blocked, whether or
        // not real damage also landed" gate as slow/stagger just above (a
        // status-only burst — cast.damage === 0 for paper-double-burst,
        // NINJA_PAPER_DOUBLE_BURST_DAMAGE is actually > 0 today, but this
        // stays gate-correct either way) — same "keep whichever ends later"
        // stacking policy, extend-not-refresh.
        if (cast.fooledDurationMs !== undefined) {
          const ticksDuration = Math.ceil(cast.fooledDurationMs / effDtMs);
          const until = Tick(aoeTick + ticksDuration);
          const prevUntil = post.fooledUntilTick ?? Tick(0);
          post = { ...post, fooledUntilTick: Tick(Math.max(prevUntil, until)) };
        }

        players[vid] = post;
      }
    }
  }

  // First batch: every ability that queues into `pendingInstantAoe` during
  // the main per-player loop above (Prism Fan/Lattice/Shock Ring/
  // Flock Pulse/Shard Ring/Wall Bloom) — all fully known by this point in
  // the tick.
  if (fightingPhase && !hangoutMode) {
    resolveInstantAoeCasts(pendingInstantAoe, Tick(state.tick + 1));
  }

  // 1y2. INSTANT AOE vs. DESTRUCTIBLES (venue-lobby-tableau fast-follow,
  //      2026-07-18) — hangout mode only. The block above resolves
  //      `pendingInstantAoe` against PLAYERS and is itself gated
  //      `!hangoutMode` (player damage is suppressed there); nothing filled
  //      the gap for the practice dummies, so all 7 instant-AOE catalog
  //      abilities (Prism Fan, Lattice, Consecrated Field, Shock Ring,
  //      Flock Pulse, Shard Ring, Wall Bloom) did nothing when tried on
  //      them. Same center-distance (+ optional cone) geometry as the
  //      player check above, reused directly rather than duplicated —
  //      status-only casts (cast.damage === 0 — Consecrated Field's instant
  //      slow was the example until it was cut 2026-07-19) are skipped
  //      here: a destructible doesn't move, so a slow has no destructible-
  //      facing meaning.
  if (fightingPhase && hangoutMode) {
    for (const cast of pendingInstantAoe) {
      if (cast.damage <= 0) continue;
      for (const [did, d] of Object.entries(state.destructibles)) {
        if (d.health <= 0) continue;
        const dx = d.x - cast.x;
        const dy = d.y - cast.y;
        const dist = Math.hypot(dx, dy);
        if (dist > cast.radius) continue;
        if (cast.coneRadians !== undefined && cast.aimAngle !== undefined) {
          let da = Math.atan2(dy, dx) - cast.aimAngle;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) > cast.coneRadians / 2) continue;
        }
        pendingHangoutDestructibleDamage.push({ destructibleId: did, attackerId: cast.casterId, damage: cast.damage });
      }
    }
  }

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
          // Kindled Ward's frontal-cone check needs a source position for
          // this null-projectile hit (combat.ts's DeflectOptions.attackerPos
          // doc comment) — a warding Paladin can block a bash the same way
          // they'd block a projectile or a slash.
          attackerPos: { x: attacker.x, y: attacker.y },
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
          // Team peel (class-overhaul-workboard.md chunk 2.4): the victim's
          // OWN Ward didn't cover this hit (mit.warded is false) — check
          // whether a warding ALLY's shadow does. `victim` (pre-mitigation,
          // still in scope) carries the id/teamId/position the check needs;
          // `players` may already reflect an earlier peel grant to the same
          // warder this tick (findTeamPeelWarder always reads it fresh).
          let bashFinalDamage = mit.damage;
          // Rally Light (chunk 2.6 fast-follow) — attacker-side amp, same
          // read-only aura check at every hit-resolution site.
          bashFinalDamage *= rallyLightDamageMultiplier(players[aid]!, players, bashTick);
          bashFinalDamage *= kindledResolveDamageMultiplier(players[aid]!, bashTick);
          if (!mit.warded) {
            const peel = applyTeamPeel(victim, bashFinalDamage, players, bashIds, bashTick);
            if (peel) {
              bashFinalDamage = peel.damage;
              events.push(peel.event);
            }
          }
          const newHealth = Math.max(0, post.health - bashFinalDamage);
          const wasAlive = post.alive;
          post = { ...post, health: newHealth, alive: newHealth > 0 };
          events.push({
            t: "hit-confirmed",
            victimId: vid,
            damage: bashFinalDamage,
            sourceProjectileId: null,
            attackerId: aid,
          });
          if (wasAlive && newHealth === 0) {
            events.push({ t: "player-killed", victimId: vid, killerId: aid, cause: "bash" });
          }
          if (mit.warded) {
            events.push({
              t: "ward-absorbed",
              playerId: vid,
              damageBlocked: mit.wardDamageBlocked,
              kindlingGranted: mit.wardKindlingGranted,
            });
          }
          if (mit.syzWarded) {
            events.push({
              t: "syz-ward-absorbed",
              playerId: vid,
              casterId: victim.wardAbsorbSourceId ?? vid,
              damageBlocked: mit.syzWardDamageBlocked ?? 0,
              wardBroke: mit.syzWardBroke ?? false,
            });
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
      // v1 scope: detect + energy grant, PLUS Razor Route's own empowered-
      // dash consumption (below) — the general "any dash-through also tags
      // Read" nuance (Read Mark's own doc line) stays a recorded deferral,
      // see that case's own comment in the drafted-actives switch above.
      const dashingNow = attacker.dashing === true;
      if (dashingNow && !mem.wasDashing) {
        mem.dashThroughTagged.clear(); // new dash burst — fresh tags
        // Razor Route (Interstice catalog v1, movement role): empower THIS
        // dash — an extra velocity impulse along the dash direction,
        // additive on top of whatever the movement backend already
        // computed this tick (see World.ts's razor-route case for why this
        // doesn't touch player.ts's own dash physics). Single-use: the
        // window is cleared the moment a dash actually starts, whether or
        // not a body ends up crossed during it; `mem.razorRouteActiveDash`
        // carries the "this burst is empowered" fact forward to the
        // per-victim loop below (and to the Read-mark-on-cross line) since
        // `razorRouteUntilTick` itself is already gone by the time a
        // victim is found.
        const razorRouteLive =
          attacker.razorRouteUntilTick !== undefined &&
          attacker.razorRouteUntilTick > state.tick;
        mem.razorRouteActiveDash = razorRouteLive;
        if (razorRouteLive) {
          const liveAttacker = players[aid]!;
          const dashSpeed = Math.hypot(liveAttacker.vx, liveAttacker.vy);
          if (dashSpeed > 1e-3) {
            players[aid] = {
              ...liveAttacker,
              vx: liveAttacker.vx + (liveAttacker.vx / dashSpeed) * NINJA_RAZOR_ROUTE_BOOST_SPEED,
              vy: liveAttacker.vy + (liveAttacker.vy / dashSpeed) * NINJA_RAZOR_ROUTE_BOOST_SPEED,
              razorRouteUntilTick: undefined,
            };
          } else {
            players[aid] = { ...liveAttacker, razorRouteUntilTick: undefined };
          }
        }
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
          // Razor Route's "marks Read on cross" — one tag per empowered
          // dash ("one body, one lie"), reusing Read Mark's OWN fields
          // (constants.ts's NINJA_RAZOR_ROUTE_READ_MARK_MS header note).
          if (mem.razorRouteActiveDash) {
            const durTicks = Math.ceil(NINJA_RAZOR_ROUTE_READ_MARK_MS / Math.max(1, dtMs));
            players[aid] = {
              ...players[aid]!,
              readTargetId: vid,
              readMarkUntilTick: (state.tick + 1 + durTicks) as Tick,
            };
            mem.razorRouteActiveDash = false;
          }
        }
      }
      mem.wasDashing = dashingNow;

      // ---- Swing FSM (with the R1-row-1 input buffer, 2026-07-24) ----
      const wasActive = mem.phase === 2;
      const activeElapsedBeforeStep = wasActive ? SLASH_ACTIVE_MS - mem.phaseMs : 0;
      let waveShouldSpawn = false;
      const edge = ninjaSlashEdges.get(aid);
      // Age the buffered press BEFORE this tick's capture, so a press
      // stored this very tick keeps its full window and only starts aging
      // next tick. Uses effDtMs (chaos-scaled) like every other FSM timer.
      if (mem.bufferedMs > 0) mem.bufferedMs = Math.max(0, mem.bufferedMs - effDtMs);
      const startSwing = (aimPointX: number, aimPointY: number): void => {
        const len = Math.hypot(aimPointX - attacker.x, aimPointY - attacker.y);
        mem.phase = 1;
        mem.phaseMs = SLASH_WINDUP_MS;
        // aimX/aimY are an absolute cursor point, not a unit vector —
        // capture the normalized swing DIRECTION from attacker toward that
        // point (falls back to facing +X if the cursor is exactly on the
        // player, e.g. a controller with no stick push).
        mem.aimX = len > 1e-3 ? (aimPointX - attacker.x) / len : 1;
        mem.aimY = len > 1e-3 ? (aimPointY - attacker.y) / len : 0;
        mem.hitThisSwing.clear();
        mem.hitDestructiblesThisSwing.clear();
        mem.hitPaperDoublesThisSwing.clear();
        mem.bufferedMs = 0; // one press, one swing — never double-fires
        events.push({ t: "slash-started", playerId: aid, x: attacker.x, y: attacker.y });
      };
      if (mem.phase === 0) {
        if (edge) {
          startSwing(edge.aimX, edge.aimY);
        } else if (mem.bufferedMs > 0) {
          // Defensive: the buffer normally consumes on the recovery→idle
          // transition tick below; this only fires if the FSM somehow sat
          // idle with a live buffer (e.g. memory carried across a phase
          // where the melee step didn't run).
          startSwing(mem.bufferedAimX, mem.bufferedAimY);
        }
      } else {
        if (edge) {
          // Press mid-swing: QUEUE it (latest press wins) instead of
          // eating it — the R1 row 1 buffer.
          mem.bufferedMs = MELEE_BUFFER_MS;
          mem.bufferedAimX = edge.aimX;
          mem.bufferedAimY = edge.aimY;
        }
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
            // Buffered press fires AT phase 0 — the same tick recovery
            // expires, so a queued re-swing has zero dead frames between
            // endlag and the next windup ("smooth on retrig").
            if (mem.bufferedMs > 0) startSwing(mem.bufferedAimX, mem.bufferedAimY);
          }
        }
      }
      const isActiveNow = mem.phase === 2;
      const activeElapsedAfterStep = isActiveNow
        ? SLASH_ACTIVE_MS - mem.phaseMs
        : wasActive
          ? Math.min(SLASH_ACTIVE_MS, activeElapsedBeforeStep + effDtMs)
          : 0;
      const hasReachedSlashContact =
        (wasActive || isActiveNow) && activeElapsedAfterStep >= SLASH_CONTACT_DELAY_MS;

      // ---- Arc hit-check (from the radial intercept onward, all victims
      //      in the cone — not "first hit only" like bash) ----
      if (hasReachedSlashContact && !hangoutMode) {
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
            // Kindled Ward's frontal-cone check needs a source position for
            // this null-projectile hit — a warding Paladin can block a ninja
            // slash the same way they'd block a projectile or a bash.
            attackerPos: { x: attacker.x, y: attacker.y },
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
            // Interstice catalog v1: Read Mark's amp and Undercut's execute
            // both apply to a landed arc hit, ahead of team peel — same
            // "re-read the attacker's LIVE state, not the outer-loop
            // `attacker` const" shape Kindled Edge's own Judgment/Seal
            // consumption uses (a swing that clips two victims in one tick
            // must not double-consume a single-charge window on the first).
            const liveAttackerForMark = players[aid]!;
            let slashFinalDamage = mit.damage;
            slashFinalDamage *= fooledDamageMultiplier(victim, meleeTick);
            if (
              liveAttackerForMark.readTargetId === vid &&
              liveAttackerForMark.readMarkUntilTick !== undefined &&
              liveAttackerForMark.readMarkUntilTick > meleeTick
            ) {
              slashFinalDamage *= NINJA_READ_MARK_AMP_MULTIPLIER;
            }
            // Undercut: a landed arc hit against a target already at or
            // below the execute threshold becomes a guaranteed kill while
            // the window lives — a non-consuming window (see this ability's
            // own case comment above), so no clearing here.
            if (
              liveAttackerForMark.undercutUntilTick !== undefined &&
              liveAttackerForMark.undercutUntilTick > meleeTick &&
              victim.health <= NINJA_UNDERCUT_HEALTH_THRESHOLD
            ) {
              slashFinalDamage = Math.max(slashFinalDamage, victim.health);
            }
            // Rally Light (chunk 2.6 fast-follow) — attacker-amp shape as
            // DASH BASH above.
            slashFinalDamage *= rallyLightDamageMultiplier(liveAttackerForMark, players, meleeTick);
            slashFinalDamage *= kindledResolveDamageMultiplier(liveAttackerForMark, meleeTick);
            // Team peel (class-overhaul-workboard.md chunk 2.4) — same gate
            // as DASH BASH's own peel check above: only when the victim's
            // OWN Ward didn't already cover this hit.
            if (!mit.warded) {
              const peel = applyTeamPeel(victim, slashFinalDamage, players, meleeIds, meleeTick);
              if (peel) {
                slashFinalDamage = peel.damage;
                events.push(peel.event);
              }
            }
            const newHealth = Math.max(0, post.health - slashFinalDamage);
            const wasAlive = post.alive;
            post = { ...post, health: newHealth, alive: newHealth > 0 };
            events.push({
              t: "slash-hit",
              attackerId: aid,
              victimId: vid,
              damage: slashFinalDamage,
              dirX: mem.aimX,
              dirY: mem.aimY,
            });
            events.push({
              t: "hit-confirmed",
              victimId: vid,
              damage: slashFinalDamage,
              sourceProjectileId: null,
              attackerId: aid,
            });
            if (wasAlive && newHealth === 0) {
              events.push({ t: "player-killed", victimId: vid, killerId: aid, cause: "bash" });
            }
            if (mit.warded) {
              events.push({
                t: "ward-absorbed",
                playerId: vid,
                damageBlocked: mit.wardDamageBlocked,
                kindlingGranted: mit.wardKindlingGranted,
              });
            }
            if (mit.syzWarded) {
              events.push({
                t: "syz-ward-absorbed",
                playerId: vid,
                casterId: victim.wardAbsorbSourceId ?? vid,
                damageBlocked: mit.syzWardDamageBlocked ?? 0,
                wardBroke: mit.syzWardBroke ?? false,
              });
            }
            // Energy from contact — the attacker's own landed hit restores
            // the rack ("aggression feeds the rack"). Second Wind
            // (Interstice catalog v1, buff role) piggybacks on this SAME
            // self-write: a landed hit while its window lives also heals +
            // dumps bonus energy, single-use (window cleared on the
            // qualifying hit, not just on timeout).
            const liveAttackerPostHit = players[aid]!;
            const secondWindLive =
              liveAttackerPostHit.secondWindUntilTick !== undefined &&
              liveAttackerPostHit.secondWindUntilTick > meleeTick;
            players[aid] = {
              ...liveAttackerPostHit,
              energy: Math.min(
                NINJA_ENERGY_MAX,
                (liveAttackerPostHit.energy ?? 0) +
                  NINJA_ENERGY_ON_MELEE_HIT +
                  (secondWindLive ? NINJA_SECOND_WIND_ENERGY : 0),
              ),
              // 2026-07-22 bug fix: was a flat 100 — for Interstice (real
              // base 85) this let Second Wind over-heal past their true max;
              // for Kindled it capped well under 125. Same formula fixes both.
              health: secondWindLive
                ? Math.min(maxHealthForPlayer(liveAttackerPostHit), liveAttackerPostHit.health + NINJA_SECOND_WIND_HEAL)
                : liveAttackerPostHit.health,
              secondWindUntilTick: secondWindLive ? undefined : liveAttackerPostHit.secondWindUntilTick,
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

      // ---- Arc hit-check vs. destructibles (venue-lobby-tableau fast-
      //      follow, 2026-07-18) — hangout mode only. Ninja's melee arc
      //      had NO destructible-hit path at all before this: player
      //      damage is (correctly) suppressed in hangout, but nothing
      //      filled the gap for the practice dummies, so Interstice's
      //      entire primary attack did nothing there. Reuses the exact
      //      same 5-point arc-sample geometry (isAABBInMeleeArc) the
      //      player check above uses, just against destructibleAABB(d)
      //      instead of a player hitbox. Damage is accumulated, not
      //      applied directly — see pendingHangoutDestructibleDamage's doc
      //      comment for why (stepDestructibles fully replaces the
      //      destructibles record later this tick regardless).
      if (hasReachedSlashContact && hangoutMode) {
        const aimAngle = Math.atan2(mem.aimY, mem.aimX);
        for (const [did, d] of Object.entries(state.destructibles)) {
          if (d.health <= 0 || mem.hitDestructiblesThisSwing.has(did)) continue;
          if (!isAABBInMeleeArc(attacker.x, attacker.y, aimAngle, SLASH_ARC_RADIANS / 2, SLASH_RANGE, d.x, d.y, destructibleAABB(d))) {
            continue;
          }
          mem.hitDestructiblesThisSwing.add(did);
          pendingHangoutDestructibleDamage.push({ destructibleId: did, attackerId: aid, damage: SLASH_DAMAGE });
        }
      }

      // ---- Arc hit-check vs. Paper Doubles (docs/card-pool-v2.md "Paper
      //      Double") — live in BOTH hangout and real fights (unlike the
      //      destructibles block just above): a decoy is a real combat
      //      entity, not a practice-dummy-only concern. Same 5-point
      //      arc-sample geometry against paperDoubleAABB(pd) instead of a
      //      player hitbox; damage is accumulated into
      //      pendingPaperDoubleDamage (NOT applied directly — see that
      //      array's own doc comment for why, same "the step function
      //      always returns a fresh record" reasoning
      //      pendingHangoutDestructibleDamage gives). The caster's own
      //      decoy is excluded — "can't hurt your own tools" (fire.ts's
      //      owner-exclusion precedent).
      if (hasReachedSlashContact) {
        const aimAngle = Math.atan2(mem.aimY, mem.aimX);
        for (const [pdIdStr, pd] of Object.entries(state.paperDoubles ?? {})) {
          if (pd.ownerId === aid || mem.hitPaperDoublesThisSwing.has(pdIdStr)) continue;
          if (!isAABBInMeleeArc(attacker.x, attacker.y, aimAngle, SLASH_ARC_RADIANS / 2, SLASH_RANGE, pd.x, pd.y, paperDoubleAABB(pd))) {
            continue;
          }
          mem.hitPaperDoublesThisSwing.add(pdIdStr);
          pendingPaperDoubleDamage.push({ paperDoubleId: pdIdStr, attackerId: aid, damage: SLASH_DAMAGE });
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
        // The rogue's mouse is PURE MELEE — a basic slash spawns NO aftermath
        // wave (Jake 2026-07-18: "not projectile at all on rogue for mouse
        // button"). The crystal wave now rides ONLY the Edge Storm ability (a
        // drafted key, not the mouse), where it deals amplified damage and
        // consumes one charge. Without Edge Storm live, the swing is melee-only.
        const edgeStormLive =
          liveAttacker.edgeStormUntilTick !== undefined &&
          liveAttacker.edgeStormUntilTick > meleeTick &&
          (liveAttacker.edgeStormChargesRemaining ?? 0) > 0;
        if (edgeStormLive) {
          const waveDamage = WAVE_DAMAGE * NINJA_EDGE_STORM_WAVE_DAMAGE_MULTIPLIER;
          const wave = spawnProjectile(allocId(), {
            ownerId: aid,
            origin: { x: liveAttacker.x, y: liveAttacker.y - 20 },
            aimAngle: Math.atan2(mem.aimY, mem.aimX),
            speed: WAVE_SPEED,
            damage: waveDamage,
            lifetimeMs: WAVE_LIFETIME_MS,
            radius: WAVE_RADIUS,
            element: "crystal",
          });
          wave.rangePx = WAVE_RANGE;
          // Bespoke render identity (2026-07-20) — see types.ts's
          // `ninjaBladeShard` field comment: opts this shot into a smaller,
          // ninja-themed blade-sliver render instead of the Geometrician's
          // reused crystal-dart shape. Render-only; `element` above stays
          // "crystal" so damage/impact behavior is unchanged.
          wave.ninjaBladeShard = true;
          projectilesCow.set(wave.id, wave);
          events.push({ t: "wave-spawned", playerId: aid, projectileId: wave.id, x: wave.x, y: wave.y });
          const remaining = (liveAttacker.edgeStormChargesRemaining ?? 0) - 1;
          players[aid] = {
            ...players[aid]!,
            edgeStormChargesRemaining: remaining,
            edgeStormUntilTick: remaining > 0 ? liveAttacker.edgeStormUntilTick : undefined,
          };
        }
      }
    }
  }

  // 1z3. PALADIN MELEE — Kindled Edge, the tighter/harder arc swing
  //      (class-overhaul-workboard.md chunk 2.1). Runs right after ninja
  //      melee, sharing its post-movement/sorted-id determinism guarantees.
  //      Gated on classId === "paladin" at the very top of the per-attacker
  //      loop — zero cost, zero behavior change for the other three
  //      chassis (see paladinMelee.test.ts's classId-gating proof). See the
  //      "PALADIN MELEE" header comment above the EDGE_* constants for the
  //      thin-vs-fork judgment call on why this is a parallel FSM rather
  //      than a shared one with ninja's.
  //      Hangout carve-out identical to ninja melee's: no player-vs-player
  //      damage path runs there, but the FSM itself still advances so a
  //      paladin's swing doesn't get stuck mid-animation across a mode
  //      transition.
  if (fightingPhase) {
    const edgeTick = Tick(state.tick + 1);
    const edgeIds = sortedPlayerIdsForTick;
    for (const aid of edgeIds) {
      const attacker = players[aid]!;
      if (classIdForArchetype(attacker.characterId) !== "paladin") continue;
      if (!attacker.alive) {
        // Death resets the bash chain (ledger design-decision block) — a
        // respawn always re-opens with blades. The FSM itself is left
        // alone (it's already the "advance so a swing doesn't get stuck"
        // contract's concern, and a dead paladin's phase can't matter).
        const deadMem = runtime.paladinMelee.get(aid);
        if (deadMem) {
          deadMem.chainIndex = 0;
          deadMem.chainGapMs = 0;
        }
        continue;
      }

      let mem = runtime.paladinMelee.get(aid);
      if (!mem) {
        mem = freshPaladinMeleeMemory();
        runtime.paladinMelee.set(aid, mem);
      }

      // ---- Swing FSM (same 4-phase shape as ninja's, own constants;
      //      same R1-row-1 input buffer, 2026-07-24; PLUS the shield-bash
      //      chain — swing·swing·BASH, ledger design-decision block) ----
      const wasActive = mem.phase === 2;
      const activeElapsedBeforeStep = wasActive ? EDGE_ACTIVE_MS - mem.phaseMs : 0;
      const edge = paladinEdgeEdges.get(aid);
      // Age-before-capture — same ordering contract as ninja's block above.
      if (mem.bufferedMs > 0) mem.bufferedMs = Math.max(0, mem.bufferedMs - effDtMs);
      // Chain-reset clock: idle time accrues; past the gap the chain cools
      // back to blades. Runs BEFORE any swing start this tick, so a press
      // after a long gap opens at chain position 0.
      if (mem.phase === 0) {
        mem.chainGapMs += effDtMs;
        if (mem.chainGapMs > KIN_BASH_CHAIN_GAP_MS) mem.chainIndex = 0;
      }
      const startSwing = (aimPointX: number, aimPointY: number): void => {
        const len = Math.hypot(aimPointX - attacker.x, aimPointY - attacker.y);
        mem.phase = 1;
        mem.phaseMs = EDGE_WINDUP_MS;
        mem.aimX = len > 1e-3 ? (aimPointX - attacker.x) / len : 1;
        mem.aimY = len > 1e-3 ? (aimPointY - attacker.y) / len : 0;
        mem.hitThisSwing.clear();
        mem.hitDestructiblesThisSwing.clear();
        mem.hitPaperDoublesThisSwing.clear();
        mem.bufferedMs = 0;
        // Chain position 2 = the BASH — the verb rides slash-started so
        // the render leads with the slab from the first windup frame.
        if (mem.chainIndex === 2) {
          events.push({ t: "slash-started", playerId: aid, x: attacker.x, y: attacker.y, verb: "bash" });
        } else {
          events.push({ t: "slash-started", playerId: aid, x: attacker.x, y: attacker.y });
        }
      };
      if (mem.phase === 0) {
        if (edge) {
          startSwing(edge.aimX, edge.aimY);
        } else if (mem.bufferedMs > 0) {
          // Defensive idle-consume — see ninja's identical branch comment.
          startSwing(mem.bufferedAimX, mem.bufferedAimY);
        }
      } else {
        if (edge) {
          mem.bufferedMs = MELEE_BUFFER_MS;
          mem.bufferedAimX = edge.aimX;
          mem.bufferedAimY = edge.aimY;
        }
        mem.phaseMs -= effDtMs;
        if (mem.phaseMs <= 0) {
          if (mem.phase === 1) {
            mem.phase = 2;
            mem.phaseMs = EDGE_ACTIVE_MS;
          } else if (mem.phase === 2) {
            mem.phase = 3;
            mem.phaseMs = EDGE_RECOVERY_MS;
          } else if (mem.phase === 3) {
            mem.phase = 0;
            mem.phaseMs = 0;
            // Chain advances per STARTED swing (whiffs count — cadence is
            // rhythm, not hit-confirm), stamped at the swing's end so the
            // position is stable for the whole swing above.
            mem.chainIndex = (mem.chainIndex + 1) % 3;
            mem.chainGapMs = 0;
            // Fires at phase 0, zero dead frames — "smooth on retrig".
            // A buffered retrig starts the NEXT chain position this same
            // tick, so swing·swing·BASH flows without a reset window.
            if (mem.bufferedMs > 0) startSwing(mem.bufferedAimX, mem.bufferedAimY);
          }
        }
      }
      // ---- Cancel window (R1 row 16, 2026-07-24 wave 2): dash/ward may
      //      cancel the FINAL 40% of recovery. Runs AFTER the FSM advance
      //      so a natural recovery→idle transition this tick wins (phase
      //      is already 0 — nothing to cancel, no double chain-advance).
      //      Triggers are RISING edges landing inside the tail (a dash
      //      begun earlier / a shield held through the swing never
      //      cancels), the ward must have actually ENGAGED (shieldActive
      //      is post-tickShield, this-tick-final), and A QUEUED SWING
      //      WINS (bufferedMs > 0 suppresses the cancel — see the
      //      KIN_CANCEL_TAIL_FRACTION doc block for the full precedence
      //      reasoning). The chain still advances: the swing's beat
      //      happened, canceling its tail is not a chain reset. ----
      {
        const mv = runtime.movement.get(aid);
        const dashingNow = (mv?.dashActiveMs ?? 0) > 0;
        const dashStartedThisTick = dashingNow && !mem.wasDashing;
        mem.wasDashing = dashingNow;
        const wardRaisedThisTick =
          paladinWardRaiseEdges.has(aid) && players[aid]!.shieldActive;
        if (
          mem.phase === 3 &&
          mem.phaseMs <= EDGE_RECOVERY_MS * KIN_CANCEL_TAIL_FRACTION &&
          mem.bufferedMs <= 0 &&
          (dashStartedThisTick || wardRaisedThisTick)
        ) {
          mem.phase = 0;
          mem.phaseMs = 0;
          mem.chainIndex = (mem.chainIndex + 1) % 3;
          mem.chainGapMs = 0;
        }
      }
      // Which verb is the CURRENT swing? Stable for the swing's whole
      // lifetime: chainIndex only advances at recovery→idle, and the
      // hit-check gate below can never be reached on that transition tick.
      const swingIsBash = mem.chainIndex === 2;
      const swingRange = swingIsBash ? SHIELD_BASH_RANGE : EDGE_RANGE;
      const swingArc = swingIsBash ? SHIELD_BASH_ARC_RADIANS : EDGE_ARC_RADIANS;
      const swingDamage = swingIsBash ? SHIELD_BASH_DAMAGE : EDGE_DAMAGE;
      const swingContactDelay = swingIsBash ? SHIELD_BASH_CONTACT_DELAY_MS : EDGE_CONTACT_DELAY_MS;
      const isActiveNow = mem.phase === 2;
      const activeElapsedAfterStep = isActiveNow
        ? EDGE_ACTIVE_MS - mem.phaseMs
        : wasActive
          ? Math.min(EDGE_ACTIVE_MS, activeElapsedBeforeStep + effDtMs)
          : 0;
      const hasReachedEdgeContact =
        (wasActive || isActiveNow) && activeElapsedAfterStep >= swingContactDelay;

      // ---- Arc hit-check (from the radial intercept onward, all victims
      //      in the cone) ----
      if (hasReachedEdgeContact && !hangoutMode) {
        const aimAngle = Math.atan2(mem.aimY, mem.aimX);
        for (const vid of edgeIds) {
          if (vid === aid) continue;
          const victim = players[vid]!;
          if (!victim.alive || mem.hitThisSwing.has(vid)) continue;
          if (!isBodyInMeleeArc(attacker.x, attacker.y, aimAngle, swingArc / 2, swingRange, victim)) {
            continue;
          }
          mem.hitThisSwing.add(vid);

          const victimBuild = resolvePlayerBuild(victim);
          const mit = tryDeflectDamage(victim, null, swingDamage, edgeTick, {
            mirrorShield: victimBuild.mirrorShield,
            directionalShield: victimBuild.directionalShield,
            parryCoverMultiplier: victimBuild.parryCoverMultiplier,
            attackerPos: { x: attacker.x, y: attacker.y },
          });
          let post = mit.evaded
            ? mit.player
            : {
                ...mit.player,
                // Bash knockback is the game's biggest (control, not DPS —
                // ledger design-decision block); blade keeps Edge's shove.
                vx: mem.aimX * (swingIsBash ? SHIELD_BASH_KNOCKBACK : EDGE_KNOCKBACK),
                vy:
                  mem.aimY * (swingIsBash ? SHIELD_BASH_KNOCKBACK : EDGE_KNOCKBACK) -
                  (swingIsBash ? SHIELD_BASH_KNOCK_UP : EDGE_KNOCK_UP),
              };
          const blocked = mit.shielded || mit.deflected;
          if (mit.evaded) {
            // no-op: victim phased through (e.g. a dashing ninja's i-frames).
          } else if (!blocked) {
            // Kindled catalog v1 (class-overhaul-workboard.md chunk 2.6):
            // Judgment Line's mark-amp and Unbroken Seal's window-amp both
            // apply to a landed Edge hit, ahead of team peel. Re-read the
            // attacker's LIVE state (not the outer-loop `attacker` const,
            // stale once Seal is consumed below) so a swing that clips two
            // victims in the same tick only consumes Seal on the first.
            const liveAttacker = players[aid]!;
            let edgeDamage = mit.damage;
            edgeDamage *= fooledDamageMultiplier(victim, edgeTick);
            if (
              liveAttacker.judgmentTargetId === vid &&
              liveAttacker.judgmentMarkUntilTick !== undefined &&
              liveAttacker.judgmentMarkUntilTick > edgeTick
            ) {
              edgeDamage *= KIN_JUDGMENT_AMP_MULTIPLIER;
            }
            let staggerVictim = false;
            if (
              liveAttacker.sealUntilTick !== undefined &&
              liveAttacker.sealUntilTick > edgeTick
            ) {
              edgeDamage *= KIN_SEAL_DAMAGE_MULTIPLIER;
              staggerVictim = true;
              // Consumed on this landed hit, not just on timeout — "the
              // NEXT Kindled Edge hit" (class-ability-catalogs-v1.md).
              players[aid] = { ...liveAttacker, sealUntilTick: undefined };
            }
            // (Retribution Edge's block-armed "ready" window amp + Kindling
            // refund used to be consumed here — chunk 2.6 fast-follow.
            // Removed 2026-07-19 along with the ability itself; see
            // docs/class-ability-catalogs-v1.md's cut note. Retort's own
            // bank-spend — docs/card-pool-v2.md #27, "the WHOLE bank as
            // bonus damage AND equal bonus knockback" — used to be
            // consumed right here too; cut the same day alongside its
            // sibling exclusives Crater/Bastion, see cards.ts's cut note
            // above the old crater/retort/bastion card definitions.)
            // Rally Light (chunk 2.6 fast-follow) — attacker-amp shape as
            // DASH BASH/slash above.
            edgeDamage *= rallyLightDamageMultiplier(players[aid]!, players, edgeTick);
            edgeDamage *= kindledResolveDamageMultiplier(players[aid]!, edgeTick);
            // Team peel (chunk 2.4) — same gate as bash/slash above: only
            // when the victim's OWN Ward didn't already cover this hit.
            if (!mit.warded) {
              const peel = applyTeamPeel(victim, edgeDamage, players, edgeIds, edgeTick);
              if (peel) {
                edgeDamage = peel.damage;
                events.push(peel.event);
              }
            }
            const newHealth = Math.max(0, post.health - edgeDamage);
            const wasAlive = post.alive;
            post = { ...post, health: newHealth, alive: newHealth > 0 };
            if (staggerVictim || swingIsBash) {
              // Two stagger sources share the slowedUntilTick machinery
              // (no new status system — ledger design-decision block):
              // Unbroken Seal's 900ms/0.25 and the bash's brief 300ms/
              // 0.55. Seal's stronger one takes precedence when both
              // apply to a single hit.
              const staggerMs = staggerVictim ? KIN_SEAL_STAGGER_MS : SHIELD_BASH_STAGGER_MS;
              const staggerMul = staggerVictim
                ? KIN_SEAL_STAGGER_MULTIPLIER
                : SHIELD_BASH_STAGGER_MULTIPLIER;
              const staggerTicks = Math.ceil(staggerMs / Math.max(1, effDtMs));
              // Kindled Resolve (coverage-floor fast-follow): softens the
              // stagger's SEVERITY toward 1 if the victim currently holds
              // the buff — "resist", not immune (a no-op multiplier change
              // for every victim without it).
              post = {
                ...post,
                slowedUntilTick: (edgeTick + staggerTicks) as Tick,
                slowMultiplier: applyKindledResolveStaggerResist(
                  post,
                  staggerMul,
                  edgeTick,
                ),
              };
            }
            // Reuses "slash-hit"/"slash-started" (not bespoke "edge-hit"
            // events) for BLADE swings — spectator/renderer treatment is
            // identical (a landed melee arc hit), and the hard-reject
            // naming table only constrains DISPLAY-facing text, not this
            // internal wire tag. The BASH is deliberately the opposite
            // call: a distinct "bash-landed" so the blunt slab gets its
            // own contact register (bass THUD vs the blade's shear).
            if (swingIsBash) {
              events.push({
                t: "bash-landed",
                attackerId: aid,
                victimId: vid,
                damage: edgeDamage,
                dirX: mem.aimX,
                dirY: mem.aimY,
              });
            } else {
              events.push({
                t: "slash-hit",
                attackerId: aid,
                victimId: vid,
                damage: edgeDamage,
                dirX: mem.aimX,
                dirY: mem.aimY,
              });
            }
            events.push({
              t: "hit-confirmed",
              victimId: vid,
              damage: edgeDamage,
              sourceProjectileId: null,
              attackerId: aid,
            });
            if (wasAlive && newHealth === 0) {
              events.push({ t: "player-killed", victimId: vid, killerId: aid, cause: "bash" });
            }
            if (mit.warded) {
              events.push({
                t: "ward-absorbed",
                playerId: vid,
                damageBlocked: mit.wardDamageBlocked,
                kindlingGranted: mit.wardKindlingGranted,
              });
            }
            if (mit.syzWarded) {
              events.push({
                t: "syz-ward-absorbed",
                playerId: vid,
                casterId: victim.wardAbsorbSourceId ?? vid,
                damageBlocked: mit.syzWardDamageBlocked ?? 0,
                wardBroke: mit.syzWardBroke ?? false,
              });
            }
            // Deliberately NO resource grant to the attacker here — unlike
            // ninja's energy-from-contact, Kindled Edge does not generate
            // Kindling. Kindling comes exclusively from Ward absorbing
            // damage (combat.ts) — "Defense IS the engine" (classes-goal.md).
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

      // ---- Arc hit-check vs. destructibles (venue-lobby-tableau fast-
      //      follow, 2026-07-18) — hangout mode only, mirrors ninja's own
      //      block above exactly (same reasoning: Kindled Edge had no
      //      destructible-hit path at all, so Kindled's entire primary
      //      attack did nothing to the practice dummies). ----
      if (hasReachedEdgeContact && hangoutMode) {
        const aimAngle = Math.atan2(mem.aimY, mem.aimX);
        for (const [did, d] of Object.entries(state.destructibles)) {
          if (d.health <= 0 || mem.hitDestructiblesThisSwing.has(did)) continue;
          if (!isAABBInMeleeArc(attacker.x, attacker.y, aimAngle, swingArc / 2, swingRange, d.x, d.y, destructibleAABB(d))) {
            continue;
          }
          mem.hitDestructiblesThisSwing.add(did);
          pendingHangoutDestructibleDamage.push({ destructibleId: did, attackerId: aid, damage: swingDamage });
        }
      }

      // ---- Arc hit-check vs. Paper Doubles — live in both hangout and real
      //      fights, mirrors the ninja block above exactly (see that block's
      //      own doc comment). Any class's melee can pop a ninja's decoy —
      //      no classId gate, matching how any class's projectiles already
      //      can via stepPaperDoubles' projectile loop.
      if (hasReachedEdgeContact) {
        const aimAngle = Math.atan2(mem.aimY, mem.aimX);
        for (const [pdIdStr, pd] of Object.entries(state.paperDoubles ?? {})) {
          if (pd.ownerId === aid || mem.hitPaperDoublesThisSwing.has(pdIdStr)) continue;
          if (!isAABBInMeleeArc(attacker.x, attacker.y, aimAngle, swingArc / 2, swingRange, pd.x, pd.y, paperDoubleAABB(pd))) {
            continue;
          }
          mem.hitPaperDoublesThisSwing.add(pdIdStr);
          pendingPaperDoubleDamage.push({ paperDoubleId: pdIdStr, attackerId: aid, damage: swingDamage });
        }
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
    // Regen HoT (class-overhaul-workboard.md chunk 3.1) — the exact mirror
    // of the Burn DoT block above, opposite sign: once per second of sim
    // time (same ONE_SECOND_TICKS rate-limit, via `regenTickLastApplied`),
    // heals `regenHps`, capped at the TARGET's real max health
    // (maxHealthForPlayer, 2026-07-22 bug fix — this regen can land on any
    // class as a Syzygist ally buff, so a flat SYZ_REGEN_HEALTH_CAP=100
    // silently under-capped a Kindled ally) rather than floored at 0. Regen
    // never revives a dead player: the `!p.alive` guard at the
    // top of this loop skips players who were ALREADY dead entering this
    // tick, and the explicit `next.alive` check here additionally covers
    // the same-tick case where the Burn DoT block immediately above just
    // killed this player — `next` reflects that death before regen ever
    // runs, since both blocks share the same `next` accumulator in order.
    if (
      next.alive &&
      next.regenUntilTick !== undefined &&
      next.regenUntilTick > state.tick &&
      next.regenHps !== undefined &&
      next.regenHps > 0
    ) {
      const last = next.regenTickLastApplied ?? -ONE_SECOND_TICKS;
      if (state.tick - last >= ONE_SECOND_TICKS) {
        const heal = next.regenHps;
        const newHealth = Math.min(maxHealthForPlayer(next), next.health + heal);
        next = {
          ...next,
          health: newHealth,
          regenTickLastApplied: state.tick,
        };
      }
    } else if (
      next.regenUntilTick !== undefined &&
      next.regenUntilTick <= state.tick
    ) {
      next = {
        ...next,
        regenUntilTick: undefined,
        regenHps: undefined,
        regenTickLastApplied: undefined,
      };
    }
    // Haste expiry. No per-tick VALUE mutation needed (unlike regen) —
    // hasteMultiplier is read live wherever it composes (speedMul chain
    // below, weapon.ts's fire-rate composition), so this block only clears
    // the window once it lapses, same shape as Freeze expiry above.
    if (
      next.hasteUntilTick !== undefined &&
      next.hasteUntilTick <= state.tick
    ) {
      next = {
        ...next,
        hasteUntilTick: undefined,
        hasteMultiplier: undefined,
      };
    }
    // Syzygist Ward expiry (class-overhaul-workboard.md chunk 3.3): a pool
    // that lapses unspent (never hit KINDLING-style zero via
    // trySyzygistWard's own break-clear, combat.ts) is cleared here on a
    // timer, same shape as every other window-buff expiry in this block.
    if (
      next.wardAbsorbUntilTick !== undefined &&
      next.wardAbsorbUntilTick <= state.tick
    ) {
      next = {
        ...next,
        wardAbsorbUntilTick: undefined,
        wardAbsorbRemaining: undefined,
        wardAbsorbSourceId: undefined,
      };
    }
    // Focus Hex mark expiry (class-overhaul-workboard.md chunk 3.4) — same
    // shape as Facet Break/Judgment Line's own marks (no dedicated expiry
    // block exists for THOSE because the consuming site itself re-checks
    // `...MarkUntilTick > tick` every hit; Focus Hex's amp consumption site
    // does the identical live re-check, so this block is purely cosmetic
    // field hygiene — included for parity/statusChips legibility, not
    // correctness (an expired-but-uncleared mark would already read as
    // inert at the consumption site).
    if (
      next.focusHexMarkUntilTick !== undefined &&
      next.focusHexMarkUntilTick <= state.tick
    ) {
      next = {
        ...next,
        focusHexTargetId: undefined,
        focusHexMarkUntilTick: undefined,
      };
    }
    // Borrowed Time debt resolution (class-overhaul-workboard.md chunk
    // 3.4): the flat, unconditional drain lands here, once, at
    // `debtUntilTick` — floored at 0 health (never lethal by construction,
    // since every Borrowed Time cast heals strictly more than it later
    // drains — see constants.ts's SYZ_BORROWED_TIME_* header note).
    if (
      next.alive &&
      next.debtUntilTick !== undefined &&
      next.debtUntilTick <= state.tick
    ) {
      const drained = Math.max(0, next.health - (next.debtAmount ?? 0));
      next = {
        ...next,
        health: drained,
        debtUntilTick: undefined,
        debtAmount: undefined,
      };
    } else if (
      next.debtUntilTick !== undefined &&
      next.debtUntilTick <= state.tick
    ) {
      // Dead before the debt landed (or already resolved) — just clear the
      // bookkeeping, never apply a drain to a corpse.
      next = { ...next, debtUntilTick: undefined, debtAmount: undefined };
    }
    if (next !== p) players[pid] = next;
  }

  // 1c. Syzygist Devotion accrual (class-overhaul-workboard.md chunk 3.2,
  //     extended 2026-07-19 D3 fast-follow to close "Devotion from enemy
  //     curses"): continuous per-tick income from TWO independent source
  //     counts —
  //       - ally sources: +SYZ_DEVOTION_PER_BUFFED_ALLY_PER_SEC per DISTINCT
  //         other ally currently carrying THIS player's live regen/haste/
  //         Ward window (deduped by target id — an ally holding two of this
  //         caster's buffs at once still counts once). A player with NO
  //         teamId (solo/FFA) can never satisfy `isAlly` for anyone
  //         (team.ts), so this count is always 0 for them — unaffected by
  //         construction, same as before this fast-follow.
  //       - enemy sources: +SYZ_DEVOTION_PER_CURSED_ENEMY_PER_SEC per
  //         DISTINCT enemy currently burning from THIS player's own fire
  //         hit (`burnSourceId`, types.ts) — works identically whether or
  //         not the caster has a teamId, which is what actually closes the
  //         solo floor (a solo Syzygist previously earned literally zero
  //         Devotion; every ability with a Devotion cost was unusable solo).
  //     Both counts are capped independently at SYZ_DEVOTION_MAX_COUNTED_
  //     SOURCES (a duo Syzygist who ALSO curses enemies earns from both at
  //     once — "teams still peak higher" per classes-goal.md, intentional).
  //     Runs AFTER the expiry block above so a window/burn that just lapsed
  //     this tick no longer counts. Two-phase (count-then-write) so no
  //     caster's own devotion write can affect another caster's count
  //     computed from the SAME pre-write `players` snapshot this tick.
  //
  //     D3 brake (2026-07-18, docs/axiom-deviations-audit.md — see
  //     `syzygistLeadBrakeMultiplier`'s own doc comment above for the full
  //     rationale): EACH source count is scaled by this caster's in-round
  //     kill-lead brake BEFORE its own per-second rate is applied, so a
  //     Syzygist already pulling ahead this round earns Devotion slower
  //     from the exact same uptime (ally OR enemy) a leaderless/behind
  //     Syzygist earns at full rate — the brake covers the new enemy source
  //     by construction, exactly as this comment always intended.
  {
    const devotionGain = new Map<PlayerId, number>();
    for (const casterIdStr of Object.keys(players)) {
      const casterId = casterIdStr as PlayerId;
      const caster = players[casterId]!;
      if (!caster.alive) continue;
      let allySourceCount = 0;
      let enemySourceCount = 0;
      for (const otherIdStr of Object.keys(players)) {
        const otherId = otherIdStr as PlayerId;
        if (otherId === casterId) continue;
        const other = players[otherId]!;
        if (!other.alive) continue;
        const carriesRegen =
          other.regenSourceId === casterId &&
          other.regenUntilTick !== undefined &&
          other.regenUntilTick > state.tick;
        const carriesHaste =
          other.hasteSourceId === casterId &&
          other.hasteUntilTick !== undefined &&
          other.hasteUntilTick > state.tick;
        const carriesWard =
          other.wardAbsorbSourceId === casterId &&
          other.wardAbsorbUntilTick !== undefined &&
          other.wardAbsorbUntilTick > state.tick;
        if (carriesRegen || carriesHaste || carriesWard) allySourceCount++;
        const carriesBurn =
          other.burnSourceId === casterId &&
          other.burnUntilTick !== undefined &&
          other.burnUntilTick > state.tick;
        if (carriesBurn) enemySourceCount++;
      }
      if (allySourceCount > 0 || enemySourceCount > 0) {
        const brake = syzygistLeadBrakeMultiplier(casterId, players, state.round.roundKills);
        const rate =
          Math.min(allySourceCount, SYZ_DEVOTION_MAX_COUNTED_SOURCES) *
            SYZ_DEVOTION_PER_BUFFED_ALLY_PER_SEC +
          Math.min(enemySourceCount, SYZ_DEVOTION_MAX_COUNTED_SOURCES) *
            SYZ_DEVOTION_PER_CURSED_ENEMY_PER_SEC;
        devotionGain.set(casterId, rate * brake);
      }
    }
    if (devotionGain.size > 0) {
      const dtSec = effDtMs / 1000;
      for (const [casterId, ratePerSec] of devotionGain) {
        const caster = players[casterId]!;
        const gained = ratePerSec * dtSec;
        players[casterId] = {
          ...caster,
          devotion: Math.min(SYZ_DEVOTION_MAX, (caster.devotion ?? 0) + gained),
        };
      }
    }
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
  // Insert hitscan split children (2026-07-20, card-pool raycast pass) —
  // collected during the per-player loop into `pendingHitscanSplitSpawns`
  // (see that array's own declaration for why), merged in here using the
  // same `runtime.nextEntityId` allocator the existing on-death split
  // insertion uses a few hundred lines below.
  for (const spec of pendingHitscanSplitSpawns) {
    const childId = EntityId(runtime.nextEntityId);
    runtime.nextEntityId += 1;
    remainingProjectiles[childId] = { ...spec, id: childId };
  }
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
  // First-blood wager state: `firstBloodAwardThisTick` is now declared near
  // the top of this function (2026-07-20, hitscan) — see that declaration's
  // own comment. Threaded into the stepRound() call below so RoundState
  // picks it up starting next tick (see round.ts's `next` scaffold).
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
        // Full mitigation + damage-application chain now lives in
        // `resolveRangedHit` (2026-07-20, hitscan extraction — see that
        // function's own doc comment for the complete list of what it does).
        // `suppressed` mirrors this loop's own former `continue` semantics:
        // skip the trailing `events.push(ev)` below for evaded/parried/
        // shielded hits, exactly as the inline version did.
        const rangedResult = resolveRangedHit(ev, proj, players, events, {
          chaosProfile,
          hangoutMode,
          fightingPhase,
          firstBloodAlreadyClaimedThisRound: state.round.firstBloodPlayerId !== undefined,
          nextTick,
          effDtMs,
          sortedPlayerIds: sortedPlayerIdsForTick,
          firstBloodAwardThisTick,
          remainingProjectiles,
          deflectedProjectileIds,
        });
        firstBloodAwardThisTick = rangedResult.firstBloodAwardThisTick;
        if (rangedResult.suppressed) continue;
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
  //
  // Apply melee/AOE hangout-mode damage (accumulated above by ninja/paladin
  // arc checks + instant-AOE resolution) BEFORE stepDestructibles runs —
  // it always returns a brand-new fully-populated record regardless of what
  // it's handed (perf audit M2's same discovery, applied here), so this is
  // the only place this damage can land. A destructible melee/AOE brings to
  // <=0 health is deleted here (matching stepDestructibles's OWN delete-on-
  // break behavior for a projectile kill exactly — never deleting would
  // leave a permanently-dead entry that respawnDestructibles' live-count
  // check would count as "still present," so the dummy would never
  // respawn) and gets its own destructible-broken event (the same
  // explosion sound/shake/blast-tint payoff a projectile kill gets — see
  // SimEventRouter.ts — so a melee/AOE kill on a practice dummy feels the
  // same as any other kill, not a silent disappearance).
  let destructiblesForStep = state.destructibles;
  if (pendingHangoutDestructibleDamage.length > 0) {
    const totalDamageByDestructible = new Map<string, number>();
    for (const hit of pendingHangoutDestructibleDamage) {
      totalDamageByDestructible.set(
        hit.destructibleId,
        (totalDamageByDestructible.get(hit.destructibleId) ?? 0) + hit.damage,
      );
    }
    destructiblesForStep = { ...destructiblesForStep };
    for (const [did, dmg] of totalDamageByDestructible) {
      const d = destructiblesForStep[EntityId(Number(did))];
      if (!d) continue;
      const newHealth = Math.max(0, d.health - dmg);
      // Per-hit damage-number signal (2026-07-19, venue-lobby ability
      // showcase) — same "fires alongside destructible-broken on a kill,
      // not instead of" contract as stepDestructibles' own projectile-hit
      // emission (destructible.ts), so melee-arc/instant-AOE dummy hits
      // get a floating number exactly like projectile hits do.
      events.push({ t: "destructible-hit", entityId: d.id, damage: dmg, x: d.x, y: d.y });
      if (newHealth <= 0) {
        delete destructiblesForStep[EntityId(Number(did))];
        events.push({ t: "destructible-broken", entityId: d.id, x: d.x, y: d.y });
      } else {
        destructiblesForStep[EntityId(Number(did))] = { ...d, health: newHealth };
      }
    }
  }
  // Perf audit M2 (2026-07-18): stepFirePatches/stepDestructibles always
  // return a brand-new fully-populated record — default to the (possibly
  // melee/AOE-adjusted) input reference (no extra allocation) rather than
  // state.destructibles directly, so a hangout-mode kill still lands even
  // in the rare case neither destructibles nor projectiles exist below and
  // stepDestructibles never runs.
  let nextDestructibles: WorldState["destructibles"] = destructiblesForStep;
  let nextFirePatches: WorldState["firePatches"] = state.firePatches;
  // Aoe role rework (2026-07-18): Lattice's lingering zone (Consecrated
  // Field's zone did the same thing until it was cut 2026-07-19), queued
  // into `pendingZoneSpawns` during the main per-player loop above —
  // merged in here, same site + same "included THIS tick, before
  // `stepFirePatches` runs below" timing `destResult.spawnedFire` (flammable
  // destructibles breaking) already uses.
  if (pendingZoneSpawns.length > 0) {
    nextFirePatches = { ...nextFirePatches };
    for (const zone of pendingZoneSpawns) {
      nextFirePatches[zone.id] = zone;
    }
  }
  let projectilesAfterDestructibles = remainingProjectiles;

  if (Object.keys(destructiblesForStep).length > 0 || Object.keys(remainingProjectiles).length > 0) {
    const destResult = stepDestructibles(
      destructiblesForStep,
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
      if (nextFirePatches === state.firePatches) nextFirePatches = { ...nextFirePatches };
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

  // 3c2. Paper Doubles (Interstice catalog v1, movement role — docs/card-
  //      pool-v2.md "Paper Double") — same overall shape as destructibles/
  //      fire patches immediately above. Melee damage accumulated during
  //      the main per-player loop (pendingPaperDoubleDamage) is pre-applied
  //      here first (deleting any decoy it kills, same "the step function
  //      always returns a fresh record" reasoning the destructiblesForStep
  //      block above already establishes) — a melee kill's burst is
  //      collected directly here rather than via `stepPaperDoubles`, since
  //      the decoy never reaches that function at all once melee has
  //      already zeroed its health. Newly-cast decoys
  //      (pendingPaperDoubleSpawns, from the "paper-double" ability-switch
  //      case) are merged in next. `stepPaperDoubles` then advances every
  //      survivor (straight-line movement, lifetime countdown, projectile
  //      collision — mirrors stepDestructibles' own projectile loop)
  //      returning its own burst list (projectile-killed + expired decoys).
  //      Every burst this section discovers — melee, projectile, or expiry
  //      — resolves through `resolveInstantAoeCasts` a SECOND time (see
  //      that function's own header comment for why this can't just push
  //      into the original `pendingInstantAoe` array: section 1y already
  //      drained it earlier this tick). Gated `fightingPhase` only (not
  //      `!hangoutMode` — hangout pins fightingPhase true per WorldMode's
  //      own doc comment, so decoys still move/expire/can-be-meleed there);
  //      the burst RESOLUTION itself is additionally gated `!hangoutMode`,
  //      same "player damage is suppressed in hangout" invariant every
  //      other pendingInstantAoe consumer already respects.
  let nextPaperDoubles: WorldState["paperDoubles"] = state.paperDoubles ?? {};
  if (fightingPhase) {
    let paperDoublesForStep: Record<EntityId, PaperDoubleEntity> = state.paperDoubles ?? {};
    const paperDoubleBursts: PendingInstantAoe[] = [];
    if (pendingPaperDoubleDamage.length > 0) {
      const totalDamageById = new Map<string, number>();
      for (const hit of pendingPaperDoubleDamage) {
        totalDamageById.set(hit.paperDoubleId, (totalDamageById.get(hit.paperDoubleId) ?? 0) + hit.damage);
      }
      paperDoublesForStep = { ...paperDoublesForStep };
      for (const [pdIdStr, dmg] of totalDamageById) {
        const pdId = EntityId(Number(pdIdStr));
        const pd = paperDoublesForStep[pdId];
        if (!pd) continue;
        const newHealth = Math.max(0, pd.health - dmg);
        if (newHealth <= 0) {
          delete paperDoublesForStep[pdId];
          paperDoubleBursts.push({
            kind: "paper-double-burst",
            casterId: pd.ownerId,
            x: pd.x,
            y: pd.y,
            radius: NINJA_PAPER_DOUBLE_BURST_RADIUS_PX,
            damage: NINJA_PAPER_DOUBLE_BURST_DAMAGE,
            fooledDurationMs: NINJA_FOOLED_DURATION_MS,
          });
        } else {
          paperDoublesForStep[pdId] = { ...pd, health: newHealth };
        }
      }
    }
    if (pendingPaperDoubleSpawns.length > 0) {
      paperDoublesForStep = { ...paperDoublesForStep };
      for (const pd of pendingPaperDoubleSpawns) paperDoublesForStep[pd.id] = pd;
    }
    // Resonance-gated position swaps (2026-07-19 fast-follow) — applied
    // BEFORE stepPaperDoubles so the decoy's straight-line movement this
    // tick continues from its new (post-swap) position, not its old one.
    // The caster's own half of the swap already happened as a self-write
    // in the "paper-double" ability-switch case.
    if (pendingPaperDoubleSwaps.length > 0) {
      paperDoublesForStep = { ...paperDoublesForStep };
      for (const swap of pendingPaperDoubleSwaps) {
        const decoy = paperDoublesForStep[swap.decoyId];
        if (!decoy) continue; // despawned by melee damage earlier this same tick
        paperDoublesForStep[swap.decoyId] = { ...decoy, x: swap.x, y: swap.y };
      }
    }
    const pdStep = stepPaperDoubles(paperDoublesForStep, projectilesAfterDestructibles, effDtMs);
    nextPaperDoubles = pdStep.paperDoubles;
    projectilesAfterDestructibles = pdStep.projectiles;
    for (const b of pdStep.bursts) {
      paperDoubleBursts.push({
        kind: "paper-double-burst",
        casterId: b.casterId,
        x: b.x,
        y: b.y,
        radius: NINJA_PAPER_DOUBLE_BURST_RADIUS_PX,
        damage: NINJA_PAPER_DOUBLE_BURST_DAMAGE,
        fooledDurationMs: NINJA_FOOLED_DURATION_MS,
      });
    }
    if (paperDoubleBursts.length > 0 && !hangoutMode) {
      resolveInstantAoeCasts(paperDoubleBursts, nextTick);
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
      // Perf audit M2 guard: nextFirePatches may still be the SAME reference
      // as state.firePatches (no earlier mutation this tick) — never write
      // into that shared prior-tick object in place.
      if (nextFirePatches === state.firePatches) nextFirePatches = { ...nextFirePatches };
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
  // persists through death by doctrine). Hangout emits no player-vs-player
  // combat events (this block stays `!hangoutMode`, a real player never
  // gets `abilityCharge` from another player there), but hangout-mode
  // destructible damage IS a real charge source now — see the dedicated
  // block right below, which is exactly the "future lobby damage source"
  // this guard's comment used to anticipate (venue-lobby-tableau fast-
  // follow, 2026-07-18). Charge mutates ONLY at these two sites, at cast,
  // and at match creation — any other writer is a bug (goal-doc invariant).
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
  } else {
    // Hangout-mode-only counterpart: destructible (practice dummy) damage
    // credits the ATTACKER exactly like the player-damage-dealt half above
    // (same EMISSION_FILL_PER_DAMAGE_DEALT constant) — there's no victim
    // side since destructibles don't have abilityCharge. This is what
    // finally lets Emission (E key) be tested in the venue lobby at all;
    // previously it could never fill there by any means.
    for (const hit of pendingHangoutDestructibleDamage) {
      const attacker = players[hit.attackerId];
      if (!attacker) continue;
      players[hit.attackerId] = {
        ...attacker,
        abilityCharge: Math.min(
          EMISSION_CHARGE_MAX,
          attacker.abilityCharge + hit.damage * EMISSION_FILL_PER_DAMAGE_DEALT,
        ),
      };
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
      paperDoubles: nextPaperDoubles,
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
    // Class base + this player's current maxHealthAdd cards (2026-07-22 bug
    // fix — respawn used to hardcode a flat 100 for everyone, so Kindled
    // never actually came back at their real 125).
    health: maxHealthForPlayer(player),
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
