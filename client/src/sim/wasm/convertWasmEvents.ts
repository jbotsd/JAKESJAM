// Phase 98 — extracted from World.ts (was ~90 lines inside the
// 1371-line file). Pure translation: numeric wasm event kind +
// payload slots → discriminated TS `SimEvent`.
//
// Kept separate so wasmStepStrategy.ts + the World.ts
// `maybeWasmActual` shim can both call it without pulling in the
// full World module (which imports the entire TS sim).

import {
  EntityId,
  PlayerId,
  type SimEvent,
  type WorldState,
} from "../types.js";

export type WasmEvent = {
  kind: number;
  playerIdxA: number;
  playerIdxB: number;
  entityId: number;
  scalar: number;
  x: number;
  y: number;
};

/**
 * Translate wasm-emitted SimEvents into the TS SimEvent shape.
 * Player indices in wasm are positions in the sorted-id players
 * array; we resolve them back to PlayerId by sorting state.players
 * keys the same way packPlayer does.
 */
export function convertWasmEventsToTs(
  wasmEvents: ReadonlyArray<WasmEvent>,
  state: WorldState,
): SimEvent[] {
  const out: SimEvent[] = [];
  // Sort player ids deterministically so player_idx maps to playerId
  // the same way wasm packs them (Object.keys.sort()).
  const playerIds = Object.keys(state.players).sort();
  const pidByIdx = (idx: number): PlayerId | null =>
    idx >= 0 && idx < playerIds.length
      ? PlayerId(playerIds[idx]!)
      : null;
  for (const e of wasmEvents) {
    const victim = pidByIdx(e.playerIdxA);
    switch (e.kind) {
      case 1: // shot_fired
        if (victim)
          out.push({ t: "shot-fired", playerId: victim, x: e.x, y: e.y });
        break;
      case 2: // hit_confirmed
        if (victim)
          out.push({
            t: "hit-confirmed",
            victimId: victim,
            damage: e.scalar,
            sourceProjectileId: null,
          });
        break;
      case 3: // destructible_broken
        out.push({
          t: "destructible-broken",
          entityId: EntityId(e.entityId),
          x: e.x,
          y: e.y,
        });
        break;
      case 4: // pickup_taken
        if (victim)
          out.push({
            t: "pickup-taken",
            entityId: EntityId(e.entityId),
            playerId: victim,
          });
        break;
      case 5: // round_end — winner_idx in playerIdxA
        out.push({ t: "round-end", winnerId: victim });
        break;
      case 6: // player_killed
        if (victim)
          out.push({
            t: "player-killed",
            victimId: victim,
            killerId: null,
            cause: "projectile",
          });
        break;
      case 7: // parry_deflected
        if (victim)
          out.push({
            t: "parry-deflected",
            playerId: victim,
            projectileId: null,
          });
        break;
      case 8: // shield_popped
        if (victim)
          out.push({
            t: "shield-popped",
            playerId: victim,
            remainingCharge: 0,
          });
        break;
      // 9 explosion / 10 fire_hit have no direct TS SimEvent kind;
      // skip for now (UI hooks already react to hit-confirmed +
      // destructible-broken).
    }
  }
  return out;
}
