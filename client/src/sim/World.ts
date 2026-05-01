// Real World implementation. Replaces the no-op stub. Orchestrates per-player
// movement + weapon fire, projectile flight, hit detection, damage, round
// state machine. Pure given (state, inputs, dt, rngState).
//
// Authority on the Bun server. Replayed on the client for prediction.

import {
  stepPlayer,
  freshPlayerMovementMemory,
  JETPACK_MAX_FUEL,
  type PlayerMovementMemory,
} from "./player.js";
import { stepProjectile } from "./projectile.js";
import {
  despawnSatellitesForDeadOwners,
  spawnMissingSatellites,
  stepSatellites,
} from "./satellite.js";
import { stepWeapon } from "./weapon.js";
import { stepRound, TARGET_SCORE_DEFAULT } from "./round.js";
import type {
  EntityId,
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
  static create(map: MapDefinition, players: PlayerSpawnInfo[], rngSeed: number): WorldState {
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
        jetpackFuel: JETPACK_MAX_FUEL,
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
        dtMs,
        { speedMultiplier: speedMul },
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
        dtMs,
        allocId,
      );
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
    dtMs,
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
  let rngState = state.rngState;

  for (const id of sortedProjectileIds) {
    const proj = nextProjectiles[id]!;
    const result = stepProjectile(proj, {
      platforms: runtime.map.platforms,
      players,
      dtMs,
      tick: nextTick,
      rngState,
    });
    rngState = result.rngState;

    // Drain events: damage on hit-confirmed, slow on player-slowed.
    for (const ev of result.events) {
      if (ev.t === "hit-confirmed" && players[ev.victimId]) {
        const victim = players[ev.victimId]!;
        if (victim.alive) {
          const newHealth = Math.max(0, victim.health - ev.damage);
          players[ev.victimId] = {
            ...victim,
            health: newHealth,
            alive: newHealth > 0,
          };
        }
      } else if (ev.t === "player-slowed" && players[ev.victimId]) {
        const victim = players[ev.victimId]!;
        const ticksDuration = Math.ceil(ev.durationMs / dtMs);
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

  // 4. Round state machine.
  const roundResult = stepRound({
    state: state.round,
    players,
    dtMs,
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
  }

  return {
    state: {
      ...state,
      tick: nextTick,
      rngState,
      players: respawnedPlayers,
      projectiles: remainingProjectiles,
      satellites: finalSatellites,
      round: roundResult.state,
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
      jetpackFuel: JETPACK_MAX_FUEL,
    };
  }
  return out;
}
