// ───────────────────────────────────────────────────────────────────────────
// MOTHBALLED — the B3 cutover shipped: `sim/src/world.zig` (step_world) is the
// AUTHORITATIVE orchestrator on both client (default prediction) and server
// (USE_WASM_STEP_WORLD=1). `stepWithRuntime` below is retained ONLY as:
//   1. the emergency TS fallback (?wasm-world=off + server flag unset), and
//   2. the parity REFERENCE the wasm-parity tests diff Zig against.
// DO NOT add gameplay here expecting it to run in production — it won't. New
// sim behaviour lands in `sim/src/*.zig`. If you change this file to keep the
// parity oracle honest, mirror the exact change into world.zig in the same PR.
// Production runs the full TS orchestrator (client prediction + server authority).
// Drafting is native in stepRound; matchHost's overlay applies only on the wasm path.
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
  type PlayerMovementMemory,
} from "./player.js";
import { buildFireEntity, stepDestructibles } from "./destructible.js";
import { stepFirePatches } from "./fire.js";
import { stepSuddenDeathStorm } from "./suddenDeath.js";
import { clearExpiredBuffs, stepPickups } from "./pickup.js";
import {
  STOLEN_FANGS_MAX_CHARGES,
  STOLEN_FANGS_CHARGE_EXPIRY_MS,
} from "./constants.js";
import { stepProjectile } from "./projectile.js";
import { CowRecord } from "./cowRecord.js";
import { nextFloat } from "./rng.js";
import {
  despawnSatellitesForDeadOwners,
  spawnMissingSatellites,
  stepSatellites,
} from "./satellite.js";
import { stepWeapon, resolvePlayerBuild } from "./weapon.js";
import { stepRound, TARGET_SCORE_DEFAULT, FIRST_BLOOD_SPEED_MULTIPLIER } from "./round.js";
import {
  tickShield,
  tryDeflectDamage,
  tryStartParry,
  SHIELD_MAX_CHARGE_DEFAULT,
  SHIELD_RECHARGE_PER_SECOND,
  PARRY_COOLDOWN_MS_DEFAULT,
} from "./combat.js";
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
  FireEntity,
  InputBitfield,
  InputFrame,
  MapDefinition,
  PlayerSpawnInfo,
  ProjectileEntity,
  SatelliteEntity,
  SimEvent,
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

const FireBit = 1 << 6;

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

/** Half the standing player body height (bodyHeight 56 / 2). Used for the
 *  ceiling clamp; crouching is shorter so clamping to the standing half is a
 *  safe over-estimate. */
const PLAYER_HALF_HEIGHT = 28;

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
  const fightingPhase = state.round.phase === "fighting";
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

  for (const [pid_, entity] of Object.entries(state.players)) {
    const pid = pid_ as PlayerId;
    const input = inputsByPlayer[pid] ?? null;
    const prevKeys = runtime.prevKeys.get(pid) ?? 0;
    const currKeys = input ? input.keys : 0;
    const aimX = input?.aimX ?? entity.aimX;
    const aimY = input?.aimY ?? entity.aimY;

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
          collisionCache: runtime.collisionCache,
        },
      );
      nextEntity = moveResult.player;
      runtime.movement.set(pid, moveResult.memory);
      // Mirror grounded/touchingWallDir/dashing onto the entity for the
      // render layer — wire-encoded (snapshotDelta P_HI.grounded/
      // touchingWallDir/dashing) and consumed by ProceduralPlayerRig's pose.
      nextEntity = mirrorMovementMemoryOntoEntity(nextEntity, moveResult.memory);
    }

    // Fire (only when alive and fighting).
    if (nextEntity.alive && fightingPhase) {
      const fireResult = stepWeapon(
        nextEntity,
        (currKeys & FireBit) !== 0,
        { x: aimX, y: aimY },
        effDtMs,
        allocId,
        { chaos: chaosProfile, rngState: runtimeRngState },
      );
      runtimeRngState = fireResult.rngState;
      nextEntity = fireResult.player;
      if (fireResult.fired) {
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

    // Parry + shield. Both run regardless of round phase so the shield can
    // recharge between rounds; tryStartParry is gated on alive internally.
    // Parry trigger is rising-edge from prevKeys → currKeys (InputBit.Ability).
    {
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

  // 1a. Void-plane kill check. Any alive player whose `y` exceeds the map's
  //     bottom edge by `KILL_PLANE_MARGIN_PX` is force-killed. Catches the
  //     fall-through-floor / off-map edge case so the player drops into the
  //     existing death → respawn → next-round flow instead of floating
  //     forever in the void with no death event. Runs before status effects
  //     so a void-killed player won't take a burn tick on the way down.
  //
  //     Pure sim mutation: server + client see the same kill at the same tick.
  //     We emit a hit-confirmed with damage = remaining health and a null
  //     source projectile so the client SFX/HUD pipeline treats it like any
  //     other death. Round logic at the end of the tick will see alive: false
  //     and resolve last-alive accordingly.
  if (runtime.map.size.y > 0) {
    const killY = runtime.map.size.y + KILL_PLANE_MARGIN_PX;
    for (const pidStr of Object.keys(players)) {
      const pid = pidStr as PlayerId;
      const p = players[pid]!;
      if (!p.alive) continue;
      if (p.y <= killY) continue;
      events.push({
        t: "hit-confirmed",
        victimId: pid,
        damage: p.health,
        sourceProjectileId: null,
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

  for (const id of sortedProjectileIds) {
    const proj = projectilesView[id]!;
    const result = stepProjectile(proj, {
      platforms: runtime.map.platforms,
      players,
      dtMs: effDtMs,
      tick: nextTick,
      rngState,
      collisionCache: runtime.collisionCache,
    });
    rngState = result.rngState;

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
        if (victim.alive) {
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
            scaledDamage,
            nextTick,
            {
              mirrorShield: victimBuild.mirrorShield,
              directionalShield: victimBuild.directionalShield,
              parryCoverMultiplier: victimBuild.parryCoverMultiplier,
            },
          );
          let postPlayer = mitigation.player;
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
          // Void: 50% armor pierce hook. No armor stat exists yet — leave
          // a no-op branch here so the wiring is in place when armor lands.
          if (element === "void") {
            // TODO: when `armor` is added to PlayerEntity, multiply
            // finalDamage by 1 / (1 - 0.5 * armor). For now: no-op.
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
          if (element === "fire") {
            const burnTicks = Math.ceil((3 * 1000) / Math.max(1, effDtMs));
            nextVictim = {
              ...nextVictim,
              burnUntilTick: (nextTick + burnTicks) as Tick,
              burnDps: finalDamage * 0.4,
              burnTickLastApplied: nextTick,
            };
          }
          // Ice: 1-second freeze at 0.5x movement.
          if (element === "ice") {
            const freezeTicks = Math.ceil((1 * 1000) / Math.max(1, effDtMs));
            nextVictim = {
              ...nextVictim,
              freezeUntilTick: (nextTick + freezeTicks) as Tick,
              freezeMultiplier: 0.5,
            };
          }
          players[ev.victimId] = nextVictim;

          // Lightning: chain half damage to the nearest OTHER alive player
          // within radius. Depth 1 only (no recursion). Bypasses parry/shield
          // for simplicity — the chain is a derived secondary hit.
          if (element === "lightning") {
            const CHAIN_RADIUS = 220;
            const chainDmg = finalDamage * 0.5;
            let bestId: PlayerId | null = null;
            let bestD2 = CHAIN_RADIUS * CHAIN_RADIUS;
            // Iterate sorted ids for determinism.
            const ids = (Object.keys(players) as PlayerId[]).sort();
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
              cause: "fire",
            });
          }
        }
      }
      events.push(ev);
    }
  }

  // 3d. Sudden-death storm: only active once round.suddenDeathActive is set
  //     (see round.ts's countdown→fighting transition). Same direct-damage
  //     drain shape as fire patches above — environmental DoT, no parry/
  //     shield mitigation. Uses `state.round`, not `roundStateForStep` (not
  //     computed yet at this point in the tick) — one-tick lag on a shrink
  //     that unfolds over 90s is imperceptible.
  if (state.round.suddenDeathActive) {
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

  // 5. Round state machine. Delegate to the orchestrator when present;
  //    fall back to the inline stepRound call for tests that don't wire
  //    up a runtime orchestrator.
  let roundResult;
  if (runtime.orchestrator) {
    // Sync the orchestrator from the world state before stepping, so any
    // external mutations (server card picks) are reflected.
    runtime.orchestrator.syncFromWorld(state);
    roundResult = runtime.orchestrator.step(cleanedPlayers, nextTick, rngState, effDtMs);
  } else {
    roundResult = stepRound({
      state: roundStateForStep,
      players: cleanedPlayers,
      dtMs: effDtMs,
      targetScore: TARGET_SCORE_DEFAULT,
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

function respawnAll(
  players: WorldState["players"],
  map: MapDefinition,
): WorldState["players"] {
  const out: WorldState["players"] = {};
  const ids = Object.keys(players).sort();
  const spawnAssignment = assignSpawnPoints(map, ids);
  for (const [index, pid_] of ids.entries()) {
    void index;
    const pid = pid_ as PlayerId;
    const spawn = spawnAssignment.get(pid as string) ?? { x: 0, y: 0 };
    const player = players[pid]!;
    out[pid] = {
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
      // Clear parry timers on round transition (mirrors MatchScene's
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
    };
  }
  return out;
}
