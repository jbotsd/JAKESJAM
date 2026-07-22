// Pure roster operations on WorldState — the SINGLE implementation of
// mid-match join and leave, used by BOTH the live host (matchHost) and the
// replay re-sim (tools/resimReplay.ts, and the headless renderer after it).
//
// Why this must be shared: replays record roster events as {atTick, join
// spawn | leave playerId}. Reconstructing the match requires applying the
// EXACT state surgery the live host performed — a re-implementation would
// drift (spawn-point selection especially: it's deterministic GIVEN STATE,
// so both sides must run the same code against the same state).
//
// Extracted verbatim from matchHost.addPlayer / evictExpiredDisconnects
// (2026-07-10); behavior-identical, only the host bookkeeping (playerInfo,
// input queues, baseline rings) stays in matchHost.

import { InputSeq, type MapDefinition, type PlayerId, type PlayerSpawnInfo, type PlayerEntity, type WorldState } from "./types";
import { transferAuthority } from "./authority";
import { maxHealthForPlayer } from "./weapon";

/**
 * Insert a mid-match joiner into the world. Spawn point = the map spawn
 * FARTHEST from living players (not a fixed index) — avoids dropping a
 * joiner into a firefight. Deterministic given state.
 */
export function applyMidMatchJoin(
  state: WorldState,
  map: MapDefinition,
  spawn: PlayerSpawnInfo,
): WorldState {
  const occupied = Object.values(state.players)
    .filter((p) => p.alive)
    .map((p) => ({ x: p.x, y: p.y }));
  const candidates =
    map.spawns.length > 0 ? map.spawns : [{ x: map.size.x / 2, y: map.size.y / 2 }];
  let spawnPoint = candidates[0] ?? { x: 0, y: 0 };
  let bestMinDist = -1;
  for (const c of candidates) {
    let minD = Infinity;
    for (const o of occupied) minD = Math.min(minD, Math.hypot(c.x - o.x, c.y - o.y));
    if (occupied.length === 0) {
      spawnPoint = c;
      break;
    }
    if (minD > bestMinDist) {
      bestMinDist = minD;
      spawnPoint = c;
    }
  }
  // Built as a local first (rather than health-first-then-patched-inline)
  // so maxHealthForPlayer can read the entity's own characterId + starter
  // cards for its maxHealthAdd bonus (2026-07-22 bug fix — this used to
  // hardcode a flat 100, so a mid-match Kindled joiner, the live path
  // play.elyad.io's persistent world actually uses, never got their real
  // 125).
  const entity: PlayerEntity = {
    id: spawn.playerId,
    characterId: spawn.characterId,
    x: spawnPoint.x,
    y: spawnPoint.y,
    vx: 0,
    vy: 0,
    aimX: spawnPoint.x + 160,
    aimY: spawnPoint.y,
    health: 0, // placeholder — set for real below, once cards[] is in place
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: spawn.weaponId,
    // Starter cards ride the spawn (S2.E) — the lobby draft pick lands
    // here, on the shared live/replay code path.
    cards: spawn.cards ? [...spawn.cards] : [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    // Duos-queue team identity (class-overhaul-workboard.md chunk 1.1) —
    // mirrors World.create's treatment so a mid-match joiner (e.g. a
    // duo partner reconnecting) gets the same teamId their spawn info
    // carries. Omitted key when absent, same optional-spread convention
    // used throughout PlayerEntity.
    ...(spawn.teamId ? { teamId: spawn.teamId } : {}),
  };
  entity.health = maxHealthForPlayer(entity);
  return {
    ...state,
    players: {
      ...state.players,
      [spawn.playerId]: entity,
    },
    round: {
      ...state.round,
      scores: {
        ...state.round.scores,
        [spawn.playerId]: 0,
      },
    },
  } as WorldState;
}

/**
 * Remove a departed player from the world: entity + score + drafting
 * bookkeeping, then rewrite entities they owned to world-owned via
 * transferAuthority (stale ownerId references must not linger).
 */
export function applyRosterLeave(state: WorldState, playerId: string): WorldState {
  const nextPlayers = { ...state.players };
  delete nextPlayers[playerId as keyof typeof nextPlayers];
  const nextScores = { ...state.round.scores };
  delete nextScores[playerId as keyof typeof nextScores];
  const nextDraftingOffers = state.round.draftingOffers
    ? { ...state.round.draftingOffers }
    : undefined;
  if (nextDraftingOffers) delete nextDraftingOffers[playerId as keyof typeof nextDraftingOffers];
  const nextDraftingPicked = state.round.draftingPicked
    ? { ...state.round.draftingPicked }
    : undefined;
  if (nextDraftingPicked) delete nextDraftingPicked[playerId as keyof typeof nextDraftingPicked];
  const stateAfterEviction = {
    ...state,
    players: nextPlayers,
    round: {
      ...state.round,
      scores: nextScores,
      draftingOffers: nextDraftingOffers,
      draftingPicked: nextDraftingPicked,
    },
  } as WorldState;
  return transferAuthority(stateAfterEviction, playerId as PlayerId, null);
}
