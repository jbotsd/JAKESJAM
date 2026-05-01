// PLACEHOLDER — owned by Dev A (sim/gameplay stream).
// Stub so client/src/net/ and server/ can import World and compile.
// Dev A finalizes per docs/dev-stream-sim.md.
//
// This stub returns an empty world and a no-op step. The netcode wiring
// will exercise the call shape; gameplay is no-op until extraction runs.

import type {
  InputFrame,
  MapDefinition,
  PlayerId,
  PlayerSpawnInfo,
  StepResult,
  WorldState,
} from './types.js';

export class World {
  static create(_map: MapDefinition, players: PlayerSpawnInfo[], rngSeed: number): WorldState {
    const playerEntities: WorldState['players'] = {};
    for (const spawn of players) {
      playerEntities[spawn.playerId] = {
        id: spawn.playerId,
        characterId: spawn.characterId,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        aimX: 0,
        aimY: 0,
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
    }

    return {
      tick: 0,
      rngState: rngSeed >>> 0,
      players: playerEntities,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      round: {
        phase: 'countdown',
        countdownRemainingMs: 3000,
        scores: Object.fromEntries(players.map((p) => [p.playerId, 0])),
        roundIndex: 0,
        winnerPlayerId: null,
      },
    };
  }

  static step(
    state: WorldState,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
    _dtMs: number,
  ): StepResult {
    // No-op stub: advance tick, ack any incoming inputs so reconciliation
    // can be exercised end-to-end before the real sim lands.
    const nextPlayers: WorldState['players'] = {};
    for (const [pid, entity] of Object.entries(state.players)) {
      const input = inputsByPlayer[pid];
      nextPlayers[pid] = {
        ...entity,
        lastProcessedInputSeq: input?.seq ?? entity.lastProcessedInputSeq,
      };
    }

    return {
      state: {
        ...state,
        tick: state.tick + 1,
        players: nextPlayers,
      },
      events: [],
    };
  }
}
