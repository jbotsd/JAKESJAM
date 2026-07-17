// Fire patches: timed AoE DoT zones, typically spawned by a flammable
// destructible breaking under fire-element damage. Pure step that runs after
// the destructible pass each tick.
//
// Hard rules: no Phaser, no DOM, no wall-clock reads, no Math.random. Iterate
// patches in EntityId order for cross-runtime determinism.

import { aabbOverlap, type AABB } from "./collision.js";
import { playerHitboxAABB } from "./player.js";
import { EntityId, PlayerId } from "./types.js";
import type {
  FireEntity,
  PlayerEntity,
  SimEvent,
} from "./types.js";

export type StepFirePatchesResult = {
  /** Surviving fire patches (replaces state.firePatches). */
  firePatches: Record<EntityId, FireEntity>;
  /** hit-confirmed events for the world to drain into player health. */
  events: SimEvent[];
};

/**
 * Tick every fire patch:
 *   - Decrement `remainingMs`. <=0 → despawn.
 *   - For every alive non-owner player whose body AABB overlaps the patch
 *     circle (treated as its bounding AABB for cheap broad-phase), apply
 *     `damagePerSecond * dtSec` damage and emit a hit-confirmed event.
 *
 * The owner is excluded so a player can't burn themselves with a barrel they
 * popped — matches the offline MatchScene behavior, where firePatches don't
 * damage their owner.
 */
export function stepFirePatches(
  firePatches: Record<EntityId, FireEntity>,
  players: Record<PlayerId, PlayerEntity>,
  dtMs: number,
): StepFirePatchesResult {
  const events: SimEvent[] = [];
  const next: Record<EntityId, FireEntity> = {};

  const dtSec = dtMs / 1000;

  const ids: EntityId[] = Object.keys(firePatches)
    .map((id) => EntityId(Number(id)))
    .sort((a, b) => a - b);

  for (const id of ids) {
    const patch = firePatches[id]!;
    const remainingMs = patch.remainingMs - dtMs;
    if (remainingMs <= 0) {
      // Burnt out — drop it.
      continue;
    }

    // AABB for the circle (bounding box). aabbOverlap is the cheapest broad
    // phase the sim ships, and we don't need true circle vs AABB precision
    // for a DoT trigger at this scale.
    const patchAABB: AABB = {
      x: patch.x - patch.radius,
      y: patch.y - patch.radius,
      w: patch.radius * 2,
      h: patch.radius * 2,
    };

    const playerIds = Object.keys(players).sort();
    for (const pid_ of playerIds) {
      const pid = pid_ as PlayerId;
      if (patch.ownerId !== null && pid === patch.ownerId) continue;
      const p = players[pid]!;
      if (!p.alive) continue;
      // Real body box (see player.ts's playerHitboxAABB doc) — was a
      // 36×36 square 20px shorter than the standing body, so a fire patch
      // only reaching a standing player's feet/lower legs could miss
      // entirely despite the player visibly standing in the flames.
      const playerAABB: AABB = playerHitboxAABB(p);
      if (!aabbOverlap(patchAABB, playerAABB)) continue;
      events.push({
        t: "hit-confirmed",
        victimId: pid,
        damage: patch.damagePerSecond * dtSec,
        sourceProjectileId: null,
        attackerId: patch.ownerId ?? null,
      });
    }

    next[id] = { ...patch, remainingMs };
  }

  return { firePatches: next, events };
}
