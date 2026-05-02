/**
 * Authority transfer utilities. Pure functions — no side effects, no I/O.
 *
 * Extracted from MatchHost so the eviction path is testable without standing
 * up a full match: import `transferAuthority` directly in tests.
 */

import { EntityId } from "@sim/types.ts";
import type { PlayerId, WorldState } from "@sim/types.ts";

/**
 * Rewrite ownership of every entity currently owned by `oldOwner` to
 * `newOwner` (null = world-owned, hits everyone). Pure — returns a new state.
 *
 * Walks `state.projectiles`, `state.firePatches`, and `state.satellites`.
 * For each entity where `ownerId === oldOwner`, produces a copy with
 * `ownerId: newOwner`. Returns a new WorldState with patched sub-maps;
 * unaffected entities and all other state fields are shared by reference.
 */
export function transferAuthority(
  state: WorldState,
  oldOwner: PlayerId,
  newOwner: PlayerId | null,
): WorldState {
  let projectilesChanged = false;
  const nextProjectiles = { ...state.projectiles };
  for (const [keyStr, proj] of Object.entries(state.projectiles)) {
    if (proj.ownerId === oldOwner) {
      nextProjectiles[EntityId(Number(keyStr))] = { ...proj, ownerId: newOwner };
      projectilesChanged = true;
    }
  }

  let firePatchesChanged = false;
  const nextFirePatches = { ...state.firePatches };
  for (const [keyStr, patch] of Object.entries(state.firePatches)) {
    if (patch.ownerId === oldOwner) {
      nextFirePatches[EntityId(Number(keyStr))] = { ...patch, ownerId: newOwner };
      firePatchesChanged = true;
    }
  }

  let satellitesChanged = false;
  const nextSatellites = { ...state.satellites };
  for (const [keyStr, sat] of Object.entries(state.satellites)) {
    if (sat.ownerId === oldOwner) {
      nextSatellites[EntityId(Number(keyStr))] = { ...sat, ownerId: newOwner };
      satellitesChanged = true;
    }
  }

  if (!projectilesChanged && !firePatchesChanged && !satellitesChanged) {
    return state;
  }

  return {
    ...state,
    projectiles: projectilesChanged ? nextProjectiles : state.projectiles,
    firePatches: firePatchesChanged ? nextFirePatches : state.firePatches,
    satellites: satellitesChanged ? nextSatellites : state.satellites,
  };
}
