// Real World implementation. Replaces the no-op stub. Orchestrates per-player
// movement + weapon fire, projectile flight, hit detection, damage, round
// state machine. Pure given (state, inputs, dt, rngState).
//
// Authority on the Bun server. Replayed on the client for prediction.

import { stepPlayer, freshPlayerMovementMemory, type PlayerMovementMemory } from "./player.js";
import { stepProjectile } from "./projectile.js";
import { stepWeapon } from "./weapon.js";
import { stepRound, TARGET_SCORE_DEFAULT } from "./round.js";
import type {
  EntityId,
  InputBitfield,
  InputFrame,
  MapDefinition,
  PlayerId,
  PlayerSpawnInfo,
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

  // 1. Players: movement + weapon fire (only during fighting phase; other
  //    phases freeze input but still advance the round timer).
  const players: WorldState["players"] = {};
  let nextProjectiles: WorldState["projectiles"] = { ...state.projectiles };

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
      const moveResult = stepPlayer(
        entity,
        prevKeys,
        currKeys,
        aimX,
        aimY,
        mem,
        runtime.map.platforms,
        dtMs,
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
        () => {
          const id = runtime.nextEntityId;
          runtime.nextEntityId += 1;
          return id;
        },
      );
      nextEntity = fireResult.player;
      if (fireResult.fired) {
        events.push({ t: "shot-fired", playerId: pid, x: nextEntity.x, y: nextEntity.y });
        for (const p of fireResult.projectiles) {
          nextProjectiles[p.id] = p;
        }
      }
    }

    if (input) {
      nextEntity = { ...nextEntity, lastProcessedInputSeq: input.seq };
      runtime.prevKeys.set(pid, currKeys);
    }

    players[pid] = nextEntity;
  }

  // 2. Projectiles: motion + collision against platforms and players.
  const remainingProjectiles: WorldState["projectiles"] = {};
  const sortedProjectileIds = Object.keys(nextProjectiles)
    .map((id) => Number(id))
    .sort((a, b) => a - b);

  for (const id of sortedProjectileIds) {
    const proj = nextProjectiles[id]!;
    const result = stepProjectile(proj, runtime.map.platforms, players, dtMs);
    if (result.expired || result.projectile === null) {
      // Apply hit damage if any.
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
        }
        events.push(ev);
      }
      continue;
    }
    remainingProjectiles[id] = result.projectile;
  }

  // 3. Round state machine.
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
  }

  return {
    state: {
      ...state,
      tick: state.tick + 1,
      players: respawnedPlayers,
      projectiles: remainingProjectiles,
      round: roundResult.state,
    },
    events,
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
