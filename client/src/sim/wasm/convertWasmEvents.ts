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
// weapon.js (NOT World.js — the module-weight concern in the header is
// about World) for the emission-cast element resolution; identity-cached,
// so per-event cost is a WeakMap hit.
import { resolvePlayerBuild } from "../weapon.js";

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
      case 6: // player_killed — killer_idx (or -1) in playerIdxB
        if (victim)
          out.push({
            t: "player-killed",
            victimId: victim,
            // Kill attribution (2026-07-17): world.zig now stamps the
            // attacker index into player_idx_b where the damage source
            // knows its owner (projectile / chain / blast / fire patch);
            // -1 (→ null) for attacker-less deaths (void, burn).
            killerId: pidByIdx(e.playerIdxB),
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
      case 11: // launch_pad_fired — entity_id = pad index in map.launchPads
        if (victim)
          out.push({
            t: "launch-pad-fired",
            entityId: EntityId(e.entityId),
            playerId: victim,
          });
        break;
      case 12: // emission_cast — scalar = volley count; element resolved
        // from the caster's build TS-side (not carried in the wasm event).
        if (victim) {
          const caster = state.players[victim];
          out.push({
            t: "emission-cast",
            playerId: victim,
            x: e.x,
            y: e.y,
            element: caster
              ? resolvePlayerBuild(caster).projectile.element
              : "crystal",
            volleyCount: Math.max(0, Math.round(e.scalar)),
          });
        }
        break;
    }
  }
  return out;
}
