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
import { stepPlayer, freshPlayerMovementMemory, type PlayerMovementMemory } from "./player.js";
import { stepProjectile } from "./projectile.js";
import { nextFloat } from "./rng.js";
import {
  despawnSatellitesForDeadOwners,
  spawnMissingSatellites,
  stepSatellites,
} from "./satellite.js";
import { stepWeapon } from "./weapon.js";
import { stepRound, TARGET_SCORE_DEFAULT } from "./round.js";
import type {
  EntityId,
  FireEntity,
  InputBitfield,
  InputFrame,
  MapDefinition,
  PlayerId,
  PlayerSpawnInfo,
  SatelliteEntity,
  SimEvent,
  StepResult,
  WorldState,
} from "./types.js";

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
};

export function createRuntime(map: MapDefinition): WorldRuntime {
  return {
    prevKeys: new Map(),
    movement: new Map(),
    nextEntityId: 1,
    map,
  };
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
    let nextEntityId: EntityId = 1;
    const playerEntities: WorldState["players"] = {};
    const scores: WorldState["round"]["scores"] = {};

    for (const [index, spawn] of players.entries()) {
      const spawnPoint = map.spawns[index % Math.max(1, map.spawns.length)] ?? { x: 0, y: 0 };
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
        lastProcessedInputSeq: 0,
      };
      scores[spawn.playerId] = 0;
    }

    const destructibles: WorldState["destructibles"] = {};
    for (const object of map.destructibles ?? []) {
      const id = nextEntityId;
      nextEntityId += 1;
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
      nextEntityId += 1;
      pickups[id] = {
        id,
        kind: pickup.kind,
        x: pickup.position.x,
        y: pickup.position.y,
        radius: pickup.radius,
        amount: pickup.amount,
        active: true,
        respawnAtTick: 0,
      };
    }

    const chaos: string[] | undefined =
      chaosModifierIds && chaosModifierIds.length > 0
        ? [...chaosModifierIds]
        : undefined;
    const chaosProfile = getChaosProfile(chaos as ChaosModifierId[] | undefined);

    return {
      tick: 0,
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
  const allocId = (): EntityId => {
    const id = runtime.nextEntityId;
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
  let nextProjectiles: WorldState["projectiles"] = { ...state.projectiles };
  // Mutable copy of satellites — fire-on-first-shot may add new entries; the
  // satellite step later this tick rotates and ticks them.
  let nextSatellites: WorldState["satellites"] = { ...(state.satellites ?? {}) };

  for (const [pid, entity] of Object.entries(state.players)) {
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

    // Movement (only when alive and fighting). Dead players freeze in place.
    let nextEntity = entity;
    if (entity.alive && fightingPhase) {
      // Slow-field debuff: while slowedUntilTick is in the future, dampen
      // the player's movement by their slowMultiplier.
      const slowActive =
        entity.slowedUntilTick !== undefined &&
        entity.slowedUntilTick > state.tick;
      const speedMul = slowActive ? entity.slowMultiplier ?? 1 : 1;
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
          gravityMultiplier: chaosProfile.gravityMultiplier,
        },
      );
      nextEntity = moveResult.player;
      runtime.movement.set(pid, moveResult.memory);
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
        events.push({ t: "shot-fired", playerId: pid, x: nextEntity.x, y: nextEntity.y });
        for (const p of fireResult.projectiles) {
          nextProjectiles[p.id] = p;
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

    if (input) {
      nextEntity = { ...nextEntity, lastProcessedInputSeq: input.seq };
      runtime.prevKeys.set(pid, currKeys);
    }

    players[pid] = nextEntity;
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
    nextProjectiles[p.id] = p;
  }

  // 3. Projectiles: motion + pathing + impact + split-on-expire. All hits
  //    (direct + AOE) emit `hit-confirmed`; we apply the damage once per
  //    event into `players`. Children spawned by split get fresh ids from
  //    the runtime allocator and join the world next tick.
  const remainingProjectiles: WorldState["projectiles"] = {};
  const sortedProjectileIds = Object.keys(nextProjectiles)
    .map((id) => Number(id))
    .sort((a, b) => a - b);

  const nextTick = state.tick + 1;
  let rngState = runtimeRngState;

  for (const id of sortedProjectileIds) {
    const proj = nextProjectiles[id]!;
    const result = stepProjectile(proj, {
      platforms: runtime.map.platforms,
      players,
      dtMs: effDtMs,
      tick: nextTick,
      rngState,
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
          const newHealth = Math.max(0, victim.health - scaledDamage);
          players[ev.victimId] = {
            ...victim,
            health: newHealth,
            alive: newHealth > 0,
          };
        }
      } else if (ev.t === "player-slowed" && players[ev.victimId]) {
        const victim = players[ev.victimId]!;
        const ticksDuration = Math.ceil(ev.durationMs / effDtMs);
        const until = nextTick + ticksDuration;
        // Stack policy: keep whichever ends later, take the lower (more
        // punishing) multiplier.
        const prevUntil = victim.slowedUntilTick ?? 0;
        const prevMul = victim.slowMultiplier ?? 1;
        players[ev.victimId] = {
          ...victim,
          slowedUntilTick: Math.max(prevUntil, until),
          slowMultiplier: Math.min(prevMul, ev.multiplier),
        };
      }
      events.push(ev);
    }

    // Insert any split children (assign ids here, in entity-id order).
    for (const child of result.spawned) {
      const childId = runtime.nextEntityId;
      runtime.nextEntityId += 1;
      remainingProjectiles[childId] = { ...child.spec, id: childId };
    }

    if (result.expired || result.projectile === null) {
      continue;
    }
    remainingProjectiles[id] = result.projectile;
  }

  // Slow-debuff cleanup: clear expired slows so movement returns to normal.
  for (const pid of Object.keys(players)) {
    const p = players[pid]!;
    if (p.slowedUntilTick !== undefined && p.slowedUntilTick <= nextTick) {
      players[pid] = {
        ...p,
        slowedUntilTick: undefined,
        slowMultiplier: undefined,
      };
    }
  }

  // After projectile resolution, players whose hp hit 0 are now `alive: false`.
  // Drop their satellites in the same tick (no zombie companions).
  let finalSatellites = despawnSatellitesForDeadOwners(nextSatellites, players);

  // 4. Fire-hazard chaos: every `intervalMs` of in-sim time, drop a fresh fire
  //    patch at a random arena location. Position rolls use the seeded RNG so
  //    replays land patches at the same spots. We only spawn during the
  //    fighting phase to avoid littering the countdown.
  let nextFirePatches: WorldState["firePatches"] = state.firePatches;
  let nextFireHazardTimerMs: number | undefined = state.fireHazardTimerMs;
  if (chaosProfile.fireHazardActive && fightingPhase) {
    const interval = chaosProfile.fireHazardIntervalMs ?? 2400;
    const accum = (state.fireHazardTimerMs ?? 0) + effDtMs;
    if (accum >= interval) {
      const mapSize = runtime.map.size;
      // Sample x and y independently; clamp inside the arena with a small
      // edge margin so patches don't sit half-off the floor.
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
        ownerId: "__chaos__",
        damagePerSecond: 13,
      };
      nextFirePatches = { ...state.firePatches, [fireId]: patch };
      nextFireHazardTimerMs = accum - interval;
    } else {
      nextFireHazardTimerMs = accum;
    }
  } else if (chaosProfile.fireHazardActive) {
    // Keep the field present (initialised to 0) so snapshot diffs stay
    // stable when we leave/re-enter the fighting phase.
    nextFireHazardTimerMs = state.fireHazardTimerMs ?? 0;
  } else {
    nextFireHazardTimerMs = undefined;
  }

  // 5. Round state machine.
  const roundResult = stepRound({
    state: state.round,
    players,
    dtMs: effDtMs,
    targetScore: TARGET_SCORE_DEFAULT,
  });
  events.push(...roundResult.events);

  // On round end, players need to respawn for the next round (if not match-over).
  let respawnedPlayers = players;
  if (roundResult.state.phase === "countdown" && state.round.phase !== "countdown") {
    respawnedPlayers = respawnAll(players, runtime.map);
    // Round transition wipes all satellites — players reactivate them by
    // firing again in the next round.
    finalSatellites = {};
    // Reset the fire-hazard accumulator on round transitions so each round
    // starts on a clean cadence.
    if (chaosProfile.fireHazardActive) {
      nextFireHazardTimerMs = 0;
    }
  }

  return {
    state: {
      ...state,
      tick: nextTick,
      rngState,
      players: respawnedPlayers,
      projectiles: remainingProjectiles,
      firePatches: nextFirePatches,
      satellites: finalSatellites,
      round: roundResult.state,
      // chaosModifierIds are immutable across the match; pass through.
      chaosModifierIds: state.chaosModifierIds,
      fireHazardTimerMs: nextFireHazardTimerMs,
    },
    events,
    matchComplete: roundResult.matchComplete,
  };
}

function respawnAll(
  players: WorldState["players"],
  map: MapDefinition,
): WorldState["players"] {
  const out: WorldState["players"] = {};
  const ids = Object.keys(players).sort();
  for (const [index, pid] of ids.entries()) {
    const spawn = map.spawns[index % Math.max(1, map.spawns.length)] ?? { x: 0, y: 0 };
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
    };
  }
  return out;
}
