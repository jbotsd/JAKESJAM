import type {
  EntityId,
  InputFrame,
  MapDefinition,
  PlayerId,
  PlayerSpawnInfo,
  StepResult,
  WorldState,
} from './types.js';

export class World {
  static create(map: MapDefinition, players: PlayerSpawnInfo[], rngSeed: number): WorldState {
    let nextEntityId: EntityId = 1;
    const playerEntities: WorldState['players'] = {};
    const scores: WorldState['round']['scores'] = {};

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

    const destructibles: WorldState['destructibles'] = {};
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

    const pickups: WorldState['pickups'] = {};
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
        phase: 'countdown',
        countdownRemainingMs: 3000,
        scores,
        roundIndex: 0,
        winnerPlayerId: null,
      },
    };
  }

  static step(
    state: WorldState,
    _inputsByPlayer: Record<PlayerId, InputFrame | null>,
    _dtMs: number,
  ): StepResult {
    return {
      state,
      events: [],
    };
  }
}
