// Destructibles: barrels, boxes, mines, cubes. Pure step that runs after the
// projectile pass. Projectiles that overlap a destructible apply damage and
// despawn (so they don't double-hit a player at the same point); when a
// destructible's health hits 0 it emits `destructible-broken`, optionally
// detonates an AOE explosion (barrel / mine), and optionally seeds a fire
// patch (flammable + fire element).
//
// Hard rules: no Phaser, no DOM, no wall-clock reads, no Math.random. Iterate
// destructibles + projectiles in EntityId order for cross-runtime determinism.

import { circleOverlapsAABB, centerToAABB, sweepAABB, type AABB } from "./collision.js";
import { EntityId, PlayerId } from "./types.js";
import type {
  DestructibleEntity,
  FireEntity,
  PlayerEntity,
  ProjectileEntity,
  SimEvent,
  Tick,
} from "./types.js";

const PLAYER_RADIUS = 18;

/** AOE blast radius applied when an explosive destructible breaks. */
export const EXPLOSION_RADIUS = 80;

/** AOE damage applied to alive non-owner players caught in the blast. */
export const EXPLOSION_DAMAGE = 28;

/** Lifetime of a fire patch spawned from a flammable destructible (ms). */
export const FIRE_PATCH_DEFAULT_LIFETIME_MS = 1800;

/** Radius of a fresh fire patch (px). */
export const FIRE_PATCH_DEFAULT_RADIUS = 36;

/** DoT damage of a fresh fire patch (per second). */
export const FIRE_PATCH_DEFAULT_DPS = 14;

/**
 * Spec for a fire patch the destructible step wants the world to spawn. The
 * caller (World.stepWithRuntime) assigns a fresh entity id from runtime so
 * fire ids stay monotonic with the rest of the entity allocator.
 */
export type SpawnedFireSpec = {
  /** null = world-owned (orphaned); fire patch will affect every player. */
  ownerId: PlayerId | null;
  x: number;
  y: number;
  radius: number;
  lifetimeMs: number;
  damagePerSecond: number;
};

export type StepDestructiblesResult = {
  /** Surviving destructibles keyed by id (replaces state.destructibles). */
  destructibles: Record<EntityId, DestructibleEntity>;
  /** Surviving projectiles (those that hit a destructible are removed). */
  projectiles: Record<EntityId, ProjectileEntity>;
  /** destructible-broken + AOE hit-confirmed events for the world drainer. */
  events: SimEvent[];
  /** Fire patches the world should spawn at the destructible's center. */
  spawnedFire: SpawnedFireSpec[];
};

/**
 * Advance destructibles for one tick. For every alive projectile that overlaps
 * a destructible AABB, apply the projectile's damage and despawn the
 * projectile. When a destructible breaks, queue events + (if explosive) an AOE
 * damage pass against alive non-owner players + (if flammable + fire element)
 * a fire-patch spawn at its center.
 *
 * `tick` is the tick the world is advancing TO this step (i.e. nextTick), kept
 * for parity with the projectile stepper signature even though no current
 * branch uses it. `void tick` keeps the signature stable for future tick-based
 * effects (delayed fuses on mines, etc.).
 */
export function stepDestructibles(
  destructibles: Record<EntityId, DestructibleEntity>,
  projectiles: Record<EntityId, ProjectileEntity>,
  players: Record<PlayerId, PlayerEntity>,
  dtMs: number,
  tick: Tick,
): StepDestructiblesResult {
  const events: SimEvent[] = [];
  const spawnedFire: SpawnedFireSpec[] = [];

  // Working copies — we mutate health/alive locally then build the final maps.
  const liveDestructibles: Record<EntityId, DestructibleEntity> = {};
  for (const [id, d] of Object.entries(destructibles)) {
    liveDestructibles[EntityId(Number(id))] = { ...d };
  }
  const removedProjectileIds = new Set<EntityId>();

  // Iterate projectiles in entity-id order so two runtimes processing the
  // same snapshot resolve overlaps in the same sequence.
  const projectileIds: EntityId[] = Object.keys(projectiles)
    .map((id) => EntityId(Number(id)))
    .sort((a, b) => a - b);
  const destructibleIds: EntityId[] = Object.keys(liveDestructibles)
    .map((id) => EntityId(Number(id)))
    .sort((a, b) => a - b);

  const dtSec = dtMs / 1000;
  for (const pid of projectileIds) {
    const proj = projectiles[pid]!;
    // Sticky / lingering projectiles don't damage destructibles again — the
    // contact tick is what counts. They get filtered out the same way as
    // any other projectile that doesn't overlap; nothing extra needed.
    for (const did of destructibleIds) {
      const d = liveDestructibles[did];
      if (!d || d.health <= 0) continue;
      const aabb = destructibleAABB(d);
      // SWEPT (2026-07-20) — same fix + rationale as paperDouble.ts's
      // decoy check: a fast projectile's end-of-tick point can skip clean
      // over a stationary target between samples. prevX/prevY reconstructed
      // from the projectile's own velocity (exact for straight pathing).
      const overlapsNow = circleOverlapsAABB(proj.x, proj.y, proj.radius, aabb);
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
        hit = sweepAABB(moverPrev, proj.vx, proj.vy, dtSec, [aabb]) !== null;
      }
      if (!hit) continue;

      // Apply damage + despawn the projectile.
      d.health = Math.max(0, d.health - proj.damage);
      removedProjectileIds.add(pid);

      // Per-hit damage-number signal (2026-07-19, venue-lobby ability
      // showcase) — fires on EVERY hit, fatal or not, alongside (not
      // instead of) `destructible-broken` below on a killing blow.
      events.push({
        t: "destructible-hit",
        entityId: d.id,
        damage: proj.damage,
        x: d.x,
        y: d.y,
      });

      if (d.health <= 0) {
        events.push({
          t: "destructible-broken",
          entityId: d.id,
          x: d.x,
          y: d.y,
        });

        const isFireElement = proj.element === "fire";

        // Explosive destructibles (barrel / mine) detonate, dealing AOE to
        // alive non-owner players within radius. Source projectile id is
        // null because the damage isn't directly attributable to one shard.
        if (d.explosive && (d.kind === "barrel" || d.kind === "mine")) {
          for (const victim of alivePlayersInRadius(
            players,
            d.x,
            d.y,
            EXPLOSION_RADIUS,
            proj.ownerId,
          )) {
            events.push({
              t: "hit-confirmed",
              victimId: victim,
              damage: EXPLOSION_DAMAGE,
              sourceProjectileId: null,
              attackerId: proj.ownerId,
            });
          }
        }

        // Flammable destructibles seed a fire patch when broken by fire (a
        // fire-element direct shot, or a fire-element explosion that
        // chained from another barrel). Fire patches inherit the originating
        // shooter as ownerId for kill credit.
        if (d.flammable && isFireElement) {
          spawnedFire.push({
            ownerId: proj.ownerId,
            x: d.x,
            y: d.y,
            radius: FIRE_PATCH_DEFAULT_RADIUS,
            lifetimeMs: FIRE_PATCH_DEFAULT_LIFETIME_MS,
            damagePerSecond: FIRE_PATCH_DEFAULT_DPS,
          });
        }

        // Mark for removal: a broken destructible disappears from the world.
        delete liveDestructibles[did];
      }

      // One projectile, one impact: don't keep checking other destructibles.
      break;
    }
  }

  // Build the surviving projectile map.
  const survivingProjectiles: Record<EntityId, ProjectileEntity> = {};
  for (const [id, proj] of Object.entries(projectiles)) {
    const idn = EntityId(Number(id));
    if (!removedProjectileIds.has(idn)) {
      survivingProjectiles[idn] = proj;
    }
  }

  // Build the surviving destructibles map (already pruned via delete above).
  const survivingDestructibles: Record<EntityId, DestructibleEntity> = {};
  for (const [id, d] of Object.entries(liveDestructibles)) {
    survivingDestructibles[EntityId(Number(id))] = d;
  }

  void tick;

  return {
    destructibles: survivingDestructibles,
    projectiles: survivingProjectiles,
    events,
    spawnedFire,
  };
}

/**
 * Build an AABB centered on the destructible. Destructibles store (x, y) as
 * the center of their footprint, matching how MatchScene previously laid them
 * out and how `boxworks.ts` describes them.
 */
export function destructibleAABB(d: DestructibleEntity): AABB {
  return centerToAABB(d.x, d.y, d.width, d.height);
}

/**
 * Helper: ids of alive non-owner players whose body overlaps the blast
 * radius. Iterates ids in sorted order so two runtimes generate the same
 * event order for the same world snapshot.
 */
function alivePlayersInRadius(
  players: Record<PlayerId, PlayerEntity>,
  cx: number,
  cy: number,
  radius: number,
  ownerId: PlayerId | null,
): PlayerId[] {
  const out: PlayerId[] = [];
  const ids = Object.keys(players).sort();
  for (const pid_ of ids) {
    const pid = pid_ as PlayerId;
    if (ownerId !== null && pid === ownerId) continue;
    const p = players[pid]!;
    if (!p.alive) continue;
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (dx * dx + dy * dy <= (radius + PLAYER_RADIUS) ** 2) {
      out.push(pid);
    }
  }
  return out;
}

/**
 * Convenience constructor for FireEntity used by World.stepWithRuntime when
 * draining `spawnedFire` from this step.
 */
export function buildFireEntity(id: EntityId, spec: SpawnedFireSpec): FireEntity {
  return {
    id,
    ownerId: spec.ownerId,
    x: spec.x,
    y: spec.y,
    radius: spec.radius,
    remainingMs: spec.lifetimeMs,
    damagePerSecond: spec.damagePerSecond,
  };
}
