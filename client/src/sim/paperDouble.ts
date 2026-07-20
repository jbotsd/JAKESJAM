// Paper Double decoys (Interstice catalog v1, docs/card-pool-v2.md "Paper
// Double" — the ninja's tenth ability). Pure step, same overall shape as
// destructible.ts (a world entity that both moves/expires on its own clock
// AND collides with projectiles) — see types.ts's `PaperDoubleEntity` for
// the full design rationale and v1 simplifications (straight-line kinematic
// mover, no platform collision/gravity).
//
// Hard rules: no Phaser, no DOM, no wall-clock reads, no Math.random. Iterate
// decoys + projectiles in EntityId order for cross-runtime determinism —
// same discipline destructible.ts/fire.ts/satellite.ts already establish.

import { circleOverlapsAABB, centerToAABB, sweepAABB, type AABB } from "./collision.js";
import { PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT } from "./player.js";
import { NINJA_PAPER_DOUBLE_SPEED } from "./constants.js";
import { EntityId, PlayerId } from "./types.js";
import type { PaperDoubleEntity, ProjectileEntity } from "./types.js";

/**
 * Build a freshly-cast decoy at the caster's current position, running in a
 * straight line along `(dirX, dirY)` (expected pre-normalized — callers pass
 * a unit vector) at the fixed `NINJA_PAPER_DOUBLE_SPEED`. See World.ts's
 * `"paper-double"` case for how the direction itself is derived (current
 * velocity, falling back to aim direction when near-stationary).
 */
export function buildPaperDoubleEntity(
  id: EntityId,
  ownerId: PlayerId,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  health: number,
  lifetimeMs: number,
): PaperDoubleEntity {
  return {
    id,
    ownerId,
    x,
    y,
    vx: dirX * NINJA_PAPER_DOUBLE_SPEED,
    vy: dirY * NINJA_PAPER_DOUBLE_SPEED,
    health,
    remainingMs: lifetimeMs,
  };
}

/**
 * AABB for a decoy's body — the SAME box a real player uses
 * (PLAYER_BODY_WIDTH × PLAYER_BODY_HEIGHT, centered on x/y, never the
 * crouch-shortened variant since a decoy never crouches) — matches the
 * card's own "same mass silhouette" visual-read text. Mirrors
 * `destructible.ts`'s `destructibleAABB` shape exactly.
 */
export function paperDoubleAABB(pd: Pick<PaperDoubleEntity, "x" | "y">): AABB {
  return centerToAABB(pd.x, pd.y, PLAYER_BODY_WIDTH, PLAYER_BODY_HEIGHT);
}

/** A decoy's death (damage-depleted or expired) contributes exactly one of
 *  these — the caller (World.ts) feeds them into the SAME `PendingInstantAoe`
 *  mitigation-chain resolution every other aoe-role catalog ability already
 *  uses (Shard Ring/Wall Bloom/etc — see that type's own doc comment), just
 *  via a second, later-in-the-tick call (this module's own bursts are
 *  discovered too late in tick order to land in the SAME pendingInstantAoe
 *  batch section 1y already drained earlier this tick). */
export type PaperDoubleBurstSpec = {
  casterId: PlayerId;
  x: number;
  y: number;
};

export type StepPaperDoublesResult = {
  /** Surviving decoys keyed by id (replaces the input record). */
  paperDoubles: Record<EntityId, PaperDoubleEntity>;
  /** Surviving projectiles (those that hit a decoy are removed, same "one
   *  projectile, one impact" contract as destructible.ts). */
  projectiles: Record<EntityId, ProjectileEntity>;
  /** One entry per decoy that died THIS tick (projectile-killed or expired
   *  — melee-killed decoys are handled by the caller BEFORE this function
   *  runs, since melee damage is pre-applied to the input record exactly
   *  like `pendingHangoutDestructibleDamage` pre-applies to
   *  `destructiblesForStep` in World.ts; a decoy already dead from melee
   *  never reaches this function at all, so this array only ever contains
   *  the two death paths this function itself resolves). */
  bursts: PaperDoubleBurstSpec[];
};

/**
 * Advance every decoy one tick: straight-line movement (no collision/
 * gravity — see types.ts's `PaperDoubleEntity` header), projectile overlap
 * (apply projectile damage + despawn the projectile, mirroring
 * `destructible.ts`'s own projectile loop exactly, including the owner-
 * exclusion `fire.ts` establishes — a caster's own shot never pops their own
 * decoy), and lifetime countdown. A decoy that reaches 0 health OR 0
 * remaining lifetime this tick despawns and contributes a burst spec.
 */
export function stepPaperDoubles(
  paperDoubles: Record<EntityId, PaperDoubleEntity>,
  projectiles: Record<EntityId, ProjectileEntity>,
  dtMs: number,
): StepPaperDoublesResult {
  const dtSec = dtMs / 1000;
  const bursts: PaperDoubleBurstSpec[] = [];
  const removedProjectileIds = new Set<EntityId>();

  // Working copies, keyed + iterated in EntityId order (determinism).
  const live: Record<EntityId, PaperDoubleEntity> = {};
  const ids: EntityId[] = Object.keys(paperDoubles)
    .map((id) => EntityId(Number(id)))
    .sort((a, b) => a - b);
  for (const id of ids) live[id] = paperDoubles[id]!;

  const projectileIds: EntityId[] = Object.keys(projectiles)
    .map((id) => EntityId(Number(id)))
    .sort((a, b) => a - b);

  for (const id of ids) {
    let pd = live[id]!;

    // Projectile overlap — same "one projectile, one impact" shape as
    // destructible.ts: the first decoy a given projectile overlaps (in
    // EntityId order) consumes it, then that projectile stops checking
    // further decoys.
    //
    // SWEPT (2026-07-20, Jake: "redesign the way it travels to feel more
    // shot like... SO its TIGHT and registers ALWAYS"). The real
    // player-hit path (projectile.ts's stepProjectileNative) already sweeps
    // prev->now against player AABBs specifically to prevent a fast
    // projectile tunneling through a body in one tick — decoys never got
    // that upgrade and used a single end-of-tick point check, which is
    // exactly what a faster wizard bolt exposed (confirmed via direct
    // trace: a decoy at an identical position took the hit at 650px/s and
    // took zero damage at 700+, a discrete-sampling miss, not a gradual
    // risk). `prevX/prevY` aren't stored on ProjectileEntity, so they're
    // reconstructed from the projectile's OWN velocity (exact for the
    // "straight" pathing every basic shot uses; a very close approximation
    // for curved pathings, still far better than no sweep at all) rather
    // than threading a new persisted field through stepProjectileNative's
    // many branch/return sites — the same call-site-local technique, just
    // applied here instead of there.
    for (const projId of projectileIds) {
      if (removedProjectileIds.has(projId)) continue;
      const proj = projectiles[projId]!;
      // Owner exclusion — a caster's own shot never pops their own decoy
      // (fire.ts's owner-exclusion precedent, applied here for the same
      // "can't hurt your own tools" reason).
      if (proj.ownerId !== null && proj.ownerId === pd.ownerId) continue;
      const targetAABB = paperDoubleAABB(pd);
      const overlapsNow = circleOverlapsAABB(proj.x, proj.y, proj.radius, targetAABB);
      let hit = overlapsNow;
      if (!hit) {
        const prevX = proj.x - proj.vx * dtSec;
        const prevY = proj.y - proj.vy * dtSec;
        const moverPrev: AABB = {
          x: prevX - proj.radius,
          y: prevY - proj.radius,
          w: proj.radius * 2,
          h: proj.radius * 2,
        };
        hit = sweepAABB(moverPrev, proj.vx, proj.vy, dtSec, [targetAABB]) !== null;
      }
      if (!hit) continue;

      pd = { ...pd, health: Math.max(0, pd.health - proj.damage) };
      removedProjectileIds.add(projId);
      break;
    }

    if (pd.health <= 0) {
      bursts.push({ casterId: pd.ownerId, x: pd.x, y: pd.y });
      // `live` was pre-seeded with every id (including this one) before
      // this loop started — `continue` alone would leave the STALE
      // pre-tick entry sitting there, not actually remove it. Must
      // explicitly delete.
      delete live[id];
      continue; // despawned
    }

    // Straight-line movement + lifetime countdown.
    const remainingMs = pd.remainingMs - dtMs;
    if (remainingMs <= 0) {
      bursts.push({ casterId: pd.ownerId, x: pd.x, y: pd.y });
      delete live[id]; // same pre-seeded-entry hazard as above
      continue; // expired
    }

    live[id] = {
      ...pd,
      x: pd.x + pd.vx * dtSec,
      y: pd.y + pd.vy * dtSec,
      remainingMs,
    };
  }

  const survivingProjectiles: Record<EntityId, ProjectileEntity> = {};
  for (const [idStr, proj] of Object.entries(projectiles)) {
    const projId = EntityId(Number(idStr));
    if (!removedProjectileIds.has(projId)) survivingProjectiles[projId] = proj;
  }

  return { paperDoubles: live, projectiles: survivingProjectiles, bursts };
}
