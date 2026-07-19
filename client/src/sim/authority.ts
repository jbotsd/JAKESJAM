/**
 * Authority transfer utilities. Pure functions — no side effects, no I/O.
 *
 * Extracted from MatchHost so the eviction path is testable without standing
 * up a full match: import `transferAuthority` directly in tests.
 */

import { EntityId } from "./types";
import type { PlayerId, WorldState } from "./types";

/**
 * Rewrite ownership of every entity currently owned by `oldOwner` to
 * `newOwner` (null = world-owned, hits everyone). Pure — returns a new state.
 *
 * Walks `state.projectiles`, `state.firePatches`, `state.satellites`, and
 * `state.paperDoubles`. For each entity where `ownerId === oldOwner`,
 * produces a copy with `ownerId: newOwner` — EXCEPT `paperDoubles`, which
 * (unlike the other three) has no "world-owned" state at all
 * (`PaperDoubleEntity.ownerId` is `PlayerId`, never `PlayerId | null` — see
 * that type's own header comment): a decoy whose owner is fully evicted
 * (`newOwner === null`) is DELETED instead of reassigned, the same "stale
 * ownerId references must not linger" reasoning `rosterOps.ts`'s own
 * `applyRosterLeave` doc comment gives, just resolved by removal rather than
 * reassignment for this one collection since reassigning to `null` isn't a
 * legal value for it. A live-to-live reassignment (`newOwner` a real
 * PlayerId — e.g. a future host-migration path) still rewrites normally.
 * Returns a new WorldState with patched sub-maps; unaffected entities and
 * all other state fields are shared by reference.
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

  let paperDoublesChanged = false;
  const nextPaperDoubles = { ...(state.paperDoubles ?? {}) };
  for (const [keyStr, pd] of Object.entries(state.paperDoubles ?? {})) {
    if (pd.ownerId !== oldOwner) continue;
    paperDoublesChanged = true;
    if (newOwner === null) {
      delete nextPaperDoubles[EntityId(Number(keyStr))];
    } else {
      nextPaperDoubles[EntityId(Number(keyStr))] = { ...pd, ownerId: newOwner };
    }
  }

  if (!projectilesChanged && !firePatchesChanged && !satellitesChanged && !paperDoublesChanged) {
    return state;
  }

  return {
    ...state,
    projectiles: projectilesChanged ? nextProjectiles : state.projectiles,
    firePatches: firePatchesChanged ? nextFirePatches : state.firePatches,
    satellites: satellitesChanged ? nextSatellites : state.satellites,
    paperDoubles: paperDoublesChanged ? nextPaperDoubles : state.paperDoubles,
  };
}
