// Pure projectile physics.
//
// Implements the full pathing + impact set the offline ProjectileSystem ships:
//   pathings: straight, gravity, float, accelerate, boomerang, homing,
//             anti-homing, bounce
//   impacts:  none, explosive (AOE), sticky (linger + delayed burst),
//             pierce-chain (decrement pierce, keep going), slow-field
//   on-expire: spawn `splitCount` child shards in a fan
//
// Authority lives wherever this runs. On the Bun server the sim is the source
// of truth. On the client during prediction this is replayed locally and
// reconciled against the server snapshot.
//
// Hard rules: no Math.random (rng threaded through), no wall-clock reads,
// no Phaser, no DOM. Iterate entities in EntityId order at the caller.

import {
  circleOverlapsAABB,
  circleHitsAnyCached,
  circleBounceCached,
  platformToAABB,
  sweepAABB,
  aabbOverlap,
  type StaticCollisionCache,
} from "./collision.js";
import { nextFloat } from "./rng.js";
import { lutAtan2, lutCos, lutSin } from "./trig.js";
import { PlayerId } from "./types.js";
import type {
  EntityId,
  PlatformDefinition,
  PlayerEntity,
  ProjectileEntity,
  ProjectileImpact,
  SimEvent,
  Tick,
  Vec2,
} from "./types.js";

const PLAYER_RADIUS = 18;
const GRAVITY_PATHING_ACCEL_DEFAULT = 1450;
const HOMING_TURN_RATE_DEFAULT = 4; // rad/s — capped per offline reference
const BOOMERANG_TURN_RATE = 8.4;
const BOOMERANG_RANGE_FRACTION = 0.55;
const BOOMERANG_RETURN_RADIUS = 16; // ~ proj.radius + 8 in offline
const STICKY_FUSE_MS = 720;
const SLOW_FIELD_DURATION_MS = 1500;
const FLOAT_OSC_LATERAL = 22;
const FLOAT_OSC_FORWARD = 11;
const FLOAT_OSC_LATERAL_HZ = 9;
const FLOAT_OSC_FORWARD_HZ = 5;
const SPLIT_SPREAD = Math.PI * 0.95;
const SPLIT_DAMAGE_SCALE = 0.42;
const SPLIT_LIFETIME_SCALE = 0.42;
const SPLIT_RANGE_SCALE = 0.32;
const SPLIT_MAX = 8;

export type StepProjectileResult = {
  /** Next-tick projectile state. null when the shard expired this tick. */
  projectile: ProjectileEntity | null;
  events: SimEvent[];
  /** True when the projectile expired this tick (lifetime, terrain, hit). */
  expired: boolean;
  /**
   * Children spawned from a split-on-expire / split-on-impact. Caller assigns
   * fresh entity ids before inserting into the world.
   */
  spawned: SpawnedChild[];
  /** Updated RNG cursor (caller threads through WorldState.rngState). */
  rngState: number;
};

export type SpawnedChild = {
  /** Fully populated except `id`, which the caller assigns. */
  spec: Omit<ProjectileEntity, "id">;
};

export type StepProjectileContext = {
  platforms: readonly PlatformDefinition[];
  players: Record<PlayerId, PlayerEntity>;
  dtMs: number;
  /** Current world tick — used to stamp slowedUntilTick on victims. */
  tick: Tick;
  rngState: number;
  /** Pre-built collision cache. When provided, uses spatial-grid-accelerated
   *  overlap tests instead of brute-force iteration over all platforms. */
  collisionCache?: StaticCollisionCache;
};

export function stepProjectile(
  proj: ProjectileEntity,
  ctx: StepProjectileContext,
): StepProjectileResult {
  const { platforms, players, dtMs, tick } = ctx;
  let rngState = ctx.rngState;
  const dtSec = dtMs / 1000;
  const events: SimEvent[] = [];
  const spawned: SpawnedChild[] = [];

  // Sticky linger: a projectile that has stuck doesn't move; it ticks down a
  // fuse and then disappears. The damage was already applied on the contact
  // tick (matches offline ProjectileSystem: sticky pushes a hit before going
  // into linger state). The fuse-end optionally spawns split children.
  if (proj.stickyFuseMs !== undefined && proj.stickyFuseMs > 0) {
    const fuse = proj.stickyFuseMs - dtMs;
    if (fuse > 0) {
      return {
        projectile: { ...proj, stickyFuseMs: fuse, ageMs: (proj.ageMs ?? 0) + dtMs },
        events,
        expired: false,
        spawned,
        rngState,
      };
    }
    if ((proj.splitCount ?? 0) > 0) {
      const splitOut = spawnSplit(proj, rngState);
      rngState = splitOut.rngState;
      spawned.push(...splitOut.spawned);
    }
    return { projectile: null, events, expired: true, spawned, rngState };
  }

  // Lifetime expiry: even before motion, a projectile whose lifetime has
  // run out this tick should expire (with split, if configured).
  const remaining = proj.lifetimeMs - dtMs;
  if (remaining <= 0) {
    if ((proj.splitCount ?? 0) > 0) {
      const splitOut = spawnSplit(proj, rngState);
      rngState = splitOut.rngState;
      spawned.push(...splitOut.spawned);
    }
    return { projectile: null, events, expired: true, spawned, rngState };
  }

  const nextAgeMs = (proj.ageMs ?? 0) + dtMs;
  const originX = proj.originX ?? proj.x;
  const originY = proj.originY ?? proj.y;

  // 1. Pathing — adjust velocity for this step.
  let vx = proj.vx;
  let vy = proj.vy;
  let returning = proj.returning ?? false;

  switch (proj.pathing) {
    case "gravity": {
      const g = proj.gravityScale && proj.gravityScale > 0
        ? proj.gravityScale
        : GRAVITY_PATHING_ACCEL_DEFAULT;
      vy += g * dtSec;
      break;
    }
    case "float": {
      // Sinusoidal lateral drift + small vertical lift. Phase keyed off the
      // entity id keeps a fan of floaters out of phase with each other,
      // matching the offline behavior.
      const ageSec = nextAgeMs / 1000;
      vy += lutSin(ageSec * FLOAT_OSC_LATERAL_HZ + proj.id) *
        FLOAT_OSC_LATERAL * dtSec;
      vx += lutCos(ageSec * FLOAT_OSC_FORWARD_HZ + proj.id) *
        FLOAT_OSC_FORWARD * dtSec;
      break;
    }
    case "accelerate": {
      const k = proj.accelerationMultiplier ?? 0;
      const factor = 1 + k * dtSec;
      vx *= factor;
      vy *= factor;
      break;
    }
    case "boomerang": {
      const traveled = proj.traveledPx ?? 0;
      const range = proj.rangePx ?? 0;
      if (!returning && range > 0 && traveled > range * BOOMERANG_RANGE_FRACTION) {
        returning = true;
      }
      if (returning) {
        const turn = rotateVelocityToward(vx, vy, proj.x, proj.y, originX, originY,
          BOOMERANG_TURN_RATE, dtSec);
        vx = turn.vx;
        vy = turn.vy;
      }
      break;
    }
    case "homing":
    case "anti-homing": {
      const target = closestNonOwnerPlayer(proj.x, proj.y, proj.ownerId, players);
      if (target) {
        const tx = proj.pathing === "anti-homing"
          ? proj.x * 2 - target.x
          : target.x;
        const ty = proj.pathing === "anti-homing"
          ? proj.y * 2 - target.y
          : target.y;
        const turnRate = proj.homingStrength && proj.homingStrength > 0
          ? proj.homingStrength
          : HOMING_TURN_RATE_DEFAULT;
        const turn = rotateVelocityToward(vx, vy, proj.x, proj.y, tx, ty,
          turnRate, dtSec);
        vx = turn.vx;
        vy = turn.vy;
      }
      break;
    }
    // straight, bounce — no per-tick velocity change.
    default:
      break;
  }

  // 2. Integrate. Track previous position for traveled-distance accounting.
  const prevX = proj.x;
  const prevY = proj.y;
  const x = prevX + vx * dtSec;
  const y = prevY + vy * dtSec;
  // Math.sqrt(dx² + dy²) instead of Math.hypot — V8's hypot uses
  // overflow-safe scaling that produces ULP-different bits than the
  // simple formula. In our velocity domain there's no overflow, so
  // matching Zig's `@sqrt` keeps cross-host parity. ADR-0006.
  const stepDist = Math.sqrt((x - prevX) * (x - prevX) + (y - prevY) * (y - prevY));
  const traveledPx = (proj.traveledPx ?? 0) + stepDist;

  // 3. Player collision — swept hit detection: sweep the projectile AABB
  //    along its prev→current trajectory against each alive non-owner player
  //    AABB. Earliest t wins. Prevents the tunneling failure mode where a
  //    fast projectile crosses a player's body in a single tick — the prior
  //    end-position-AABB check missed those hits entirely.
  //    Iterate players in deterministic order so the picked target is stable
  //    when two are equidistant.
  let hitPid: PlayerId | null = null;
  const playerIds = Object.keys(players).sort();
  const candidatePids: PlayerId[] = [];
  const candidateAABBs: { x: number; y: number; w: number; h: number }[] = [];
  for (const pid_ of playerIds) {
    const pid = pid_ as PlayerId;
    if (proj.ownerId !== null && pid === proj.ownerId) continue;
    const player = players[pid]!;
    if (!player.alive) continue;
    candidatePids.push(pid);
    candidateAABBs.push({
      x: player.x - PLAYER_RADIUS,
      y: player.y - PLAYER_RADIUS,
      w: PLAYER_RADIUS * 2,
      h: PLAYER_RADIUS * 2,
    });
  }
  if (candidateAABBs.length > 0) {
    const projAABBPrev = {
      x: prevX - proj.radius,
      y: prevY - proj.radius,
      w: proj.radius * 2,
      h: proj.radius * 2,
    };
    const projAABBNow = {
      x: x - proj.radius,
      y: y - proj.radius,
      w: proj.radius * 2,
      h: proj.radius * 2,
    };
    // Pass 1 — already-overlapping case (projectile spawned inside target,
    // or end-position overlaps). The original behavior we must preserve.
    for (let i = 0; i < candidateAABBs.length; i++) {
      const c = candidateAABBs[i]!;
      if (aabbOverlap(projAABBPrev, c) || aabbOverlap(projAABBNow, c)) {
        hitPid = candidatePids[i]!;
        break;
      }
    }
    // Pass 2 — swept hit (catches tunneling: AABBs don't overlap at endpoints
    // but the projectile crosses the target between prev and now).
    if (hitPid === null) {
      const sweptHit = sweepAABB(projAABBPrev, vx, vy, dtSec, candidateAABBs);
      if (sweptHit !== null) {
        hitPid = candidatePids[sweptHit.index]!;
      }
    }
  }

  if (hitPid !== null) {
    const impact: ProjectileImpact = proj.impact ?? "none";

    // Sticky: deal contact damage, then freeze + linger for the fuse window
    // (matches offline ProjectileSystem). Splits happen at fuse-end.
    if (impact === "sticky") {
      events.push({
        t: "hit-confirmed",
        victimId: hitPid,
        damage: proj.damage,
        sourceProjectileId: proj.id,
      });
      const stuck: ProjectileEntity = {
        ...proj,
        x,
        y,
        vx: 0,
        vy: 0,
        ageMs: nextAgeMs,
        traveledPx,
        originX,
        originY,
        returning,
        stickyFuseMs: STICKY_FUSE_MS,
        lifetimeMs: Math.max(remaining, STICKY_FUSE_MS + dtMs),
      };
      return { projectile: stuck, events, expired: false, spawned, rngState };
    }

    // Apply primary hit damage + side effects (explosive AOE, slow).
    events.push(...applyHitOn(proj, hitPid, x, y, players, tick));

    // Pierce-chain: decrement and survive (don't expire). All other impacts
    // expire on the first hit (with optional split spawn).
    if (impact === "pierce-chain" && proj.pierceRemaining > 0) {
      const next: ProjectileEntity = {
        ...proj,
        x,
        y,
        vx,
        vy,
        ageMs: nextAgeMs,
        traveledPx,
        originX,
        originY,
        returning,
        pierceRemaining: proj.pierceRemaining - 1,
        lifetimeMs: remaining,
      };
      return { projectile: next, events, expired: false, spawned, rngState };
    }

    if ((proj.splitCount ?? 0) > 0) {
      const splitProj: ProjectileEntity = {
        ...proj,
        x,
        y,
        vx,
        vy,
        originX,
        originY,
      };
      const splitOut = spawnSplit(splitProj, rngState);
      rngState = splitOut.rngState;
      spawned.push(...splitOut.spawned);
    }

    return { projectile: null, events, expired: true, spawned, rngState };
  }

  // 4. Platform collision — bounce or expire. Uses spatial grid when cache is
  //    available, falls back to brute-force for backward compat.
  if (ctx.collisionCache) {
    // Fast path: spatial-grid-accelerated collision
    if (proj.pathing === "bounce" && proj.bouncesRemaining > 0) {
      const bounce = circleBounceCached(x, y, prevX, prevY, proj.radius, vx, vy, ctx.collisionCache);
      if (bounce) {
        let bvx = vx;
        let bvy = vy;
        if (bounce.reflectX) bvx = -vx;
        if (bounce.reflectY) bvy = -vy;

        const nudge = Math.max(1, proj.radius * 0.5);
        const len = Math.sqrt(bvx * bvx + bvy * bvy) || 1;
        const bx = prevX + (bvx / len) * nudge;
        const by = prevY + (bvy / len) * nudge;

        const next: ProjectileEntity = {
          ...proj,
          x: bx,
          y: by,
          vx: bvx,
          vy: bvy,
          ageMs: nextAgeMs,
          traveledPx,
          originX,
          originY,
          returning,
          bouncesRemaining: proj.bouncesRemaining - 1,
          lifetimeMs: remaining,
        };
        return { projectile: next, events, expired: false, spawned, rngState };
      }
    } else {
      const hitIdx = circleHitsAnyCached(x, y, proj.radius, ctx.collisionCache);
      if (hitIdx >= 0) {
        const impact: ProjectileImpact = proj.impact ?? "none";
        if (impact === "explosive") {
          events.push(...detonateAt(proj, x, y, players, tick));
        }
        if ((proj.splitCount ?? 0) > 0) {
          const splitProj: ProjectileEntity = {
            ...proj,
            x, y, vx, vy, originX, originY,
          };
          const splitOut = spawnSplit(splitProj, rngState);
          rngState = splitOut.rngState;
          spawned.push(...splitOut.spawned);
        }
        return { projectile: null, events, expired: true, spawned, rngState };
      }
    }
  } else {
    // Legacy brute-force path
    for (let i = 0; i < platforms.length; i += 1) {
      const platform = platforms[i]!;
      const aabb = platformToAABB(platform);
      if (!circleOverlapsAABB(x, y, proj.radius, aabb)) continue;

      if (proj.pathing === "bounce" && proj.bouncesRemaining > 0) {
        const left = aabb.x - proj.radius;
        const right = aabb.x + aabb.w + proj.radius;
        const top = aabb.y - proj.radius;
        const bottom = aabb.y + aabb.h + proj.radius;

        let reflectX = false;
        let reflectY = false;
        if (prevX <= left || prevX >= right) {
          reflectX = true;
        } else if (prevY <= top || prevY >= bottom) {
          reflectY = true;
        } else {
          const dxr = Math.min(Math.abs(x - left), Math.abs(x - right));
          const dyr = Math.min(Math.abs(y - top), Math.abs(y - bottom));
          if (dxr < dyr) reflectX = true;
          else reflectY = true;
        }

        let bvx = vx;
        let bvy = vy;
        if (reflectX) bvx = -vx;
        if (reflectY) bvy = -vy;

        const nudge = Math.max(1, proj.radius * 0.5);
        const len = Math.sqrt(bvx * bvx + bvy * bvy) || 1;
        const bx = prevX + (bvx / len) * nudge;
        const by = prevY + (bvy / len) * nudge;

        const next: ProjectileEntity = {
          ...proj,
          x: bx,
          y: by,
          vx: bvx,
          vy: bvy,
          ageMs: nextAgeMs,
          traveledPx,
          originX,
          originY,
          returning,
          bouncesRemaining: proj.bouncesRemaining - 1,
          lifetimeMs: remaining,
        };
        return { projectile: next, events, expired: false, spawned, rngState };
      }

      const impact: ProjectileImpact = proj.impact ?? "none";
      if (impact === "explosive") {
        events.push(...detonateAt(proj, x, y, players, tick));
      }
      if ((proj.splitCount ?? 0) > 0) {
        const splitProj: ProjectileEntity = {
          ...proj,
          x, y, vx, vy, originX, originY,
        };
        const splitOut = spawnSplit(splitProj, rngState);
        rngState = splitOut.rngState;
        spawned.push(...splitOut.spawned);
      }
      return { projectile: null, events, expired: true, spawned, rngState };
    }
  }

  // 5. Boomerang return-home check — once curling back, expire when we get
  //    near the origin (the owner catches the shard). Range expiry from the
  //    offline path (`traveledPx >= rangePx`) does NOT apply to boomerangs;
  //    the lifetime cap and the home-return are the only stops.
  if (proj.pathing === "boomerang" && returning) {
    const dx = x - originX;
    const dy = y - originY;
    if (dx * dx + dy * dy < (BOOMERANG_RETURN_RADIUS + proj.radius) ** 2) {
      if ((proj.splitCount ?? 0) > 0) {
        const splitProj: ProjectileEntity = {
          ...proj,
          x,
          y,
          vx,
          vy,
          originX,
          originY,
        };
        const splitOut = spawnSplit(splitProj, rngState);
        rngState = splitOut.rngState;
        spawned.push(...splitOut.spawned);
      }
      return { projectile: null, events, expired: true, spawned, rngState };
    }
  }

  // 6. Range cap — projectiles with a finite rangePx expire when traveled
  //    exceeds it. Boomerangs are exempt (handled above). Skipped when
  //    rangePx is 0/undefined.
  if (
    proj.pathing !== "boomerang" &&
    proj.rangePx !== undefined &&
    proj.rangePx > 0 &&
    traveledPx >= proj.rangePx
  ) {
    if ((proj.splitCount ?? 0) > 0) {
      const splitProj: ProjectileEntity = {
        ...proj,
        x,
        y,
        vx,
        vy,
        originX,
        originY,
      };
      const splitOut = spawnSplit(splitProj, rngState);
      rngState = splitOut.rngState;
      spawned.push(...splitOut.spawned);
    }
    return { projectile: null, events, expired: true, spawned, rngState };
  }

  return {
    projectile: {
      ...proj,
      x,
      y,
      vx,
      vy,
      lifetimeMs: remaining,
      ageMs: nextAgeMs,
      traveledPx,
      originX,
      originY,
      returning,
    },
    events,
    expired: false,
    spawned,
    rngState,
  };
}

export type ProjectileSpawnParams = {
  ownerId: PlayerId | null;
  origin: Vec2;
  aimAngle: number;
  speed: number;
  damage: number;
  lifetimeMs: number;
  radius?: number;
  shape?: ProjectileEntity["shape"];
  pathing?: ProjectileEntity["pathing"];
  element?: string;
};

export function spawnProjectile(
  id: EntityId,
  params: ProjectileSpawnParams,
): ProjectileEntity {
  return {
    id,
    ownerId: params.ownerId,
    x: params.origin.x,
    y: params.origin.y,
    vx: lutCos(params.aimAngle) * params.speed,
    vy: lutSin(params.aimAngle) * params.speed,
    shape: params.shape ?? "circle",
    radius: params.radius ?? 7,
    damage: params.damage,
    lifetimeMs: params.lifetimeMs,
    pathing: params.pathing ?? "straight",
    element: params.element ?? "crystal",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ageMs: 0,
    traveledPx: 0,
    originX: params.origin.x,
    originY: params.origin.y,
    returning: false,
  };
}

// ----- helpers ---------------------------------------------------------------

/**
 * Damage application + side-effects for a single victim. Splits explosive
 * damage out into a radius (offline `impactAt` + slow-field stamps the
 * victim with `slowedUntilTick`).
 */
function applyHitOn(
  proj: ProjectileEntity,
  victimId: PlayerId,
  hitX: number,
  hitY: number,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
): SimEvent[] {
  const events: SimEvent[] = [];
  const impact: ProjectileImpact = proj.impact ?? "none";

  if (impact === "explosive") {
    // AOE — damage all alive non-owner players within the radius.
    events.push(...detonateAt(proj, hitX, hitY, players, tick));
    return events;
  }

  // Direct hit on this victim.
  events.push({
    t: "hit-confirmed",
    victimId,
    damage: proj.damage,
    sourceProjectileId: proj.id,
  });

  if (impact === "slow-field") {
    events.push({
      t: "player-slowed",
      victimId,
      multiplier: proj.slowMultiplier ?? 0.6,
      durationMs: SLOW_FIELD_DURATION_MS,
    });
  }

  return events;
}

/**
 * Explosive / fuse-end detonation: damage every alive non-owner player whose
 * body overlaps the impact radius (defaults to a small "splash" if the shard
 * had no configured radius, matching the offline visual radius minimum).
 */
function detonateAt(
  proj: ProjectileEntity,
  detX: number,
  detY: number,
  players: Record<PlayerId, PlayerEntity>,
  tick: Tick,
): SimEvent[] {
  const events: SimEvent[] = [];
  const impact: ProjectileImpact = proj.impact ?? "none";
  const radius = Math.max(
    proj.impactRadiusPx ?? 0,
    impact === "explosive" ? 34 : impact === "sticky" ? 24 : 0,
  );
  if (radius <= 0) {
    // No AOE — caller must have already emitted the direct-hit event.
    return events;
  }

  const playerIds = Object.keys(players).sort();
  for (const pid_ of playerIds) {
    const pid = pid_ as PlayerId;
    if (proj.ownerId !== null && pid === proj.ownerId) continue;
    const p = players[pid]!;
    if (!p.alive) continue;
    const dx = p.x - detX;
    const dy = p.y - detY;
    if (dx * dx + dy * dy <= (radius + PLAYER_RADIUS) ** 2) {
      events.push({
        t: "hit-confirmed",
        victimId: pid,
        damage: proj.damage,
        sourceProjectileId: proj.id,
      });
      if (impact === "slow-field") {
        events.push({
          t: "player-slowed",
          victimId: pid,
          multiplier: proj.slowMultiplier ?? 0.6,
          durationMs: SLOW_FIELD_DURATION_MS,
        });
      }
    }
  }
  // tick is unused here today, but kept for future tick-based effects.
  void tick;
  return events;
}

/**
 * Spawn N child projectiles fanning from the parent's death point. Inherits
 * shape/element/pathing reduced toward "straight" so children don't infinitely
 * cascade. Speed is downscaled, damage halved per the offline tuning.
 *
 * Spread variance is drawn from rng so identical-tick splits across the wire
 * stay in lockstep when seeds match. Returns a new rng cursor and the list of
 * specs (ids assigned by caller).
 */
function spawnSplit(
  parent: ProjectileEntity,
  rngState: number,
): { spawned: SpawnedChild[]; rngState: number } {
  const splitCount = Math.min(parent.splitCount ?? 0, SPLIT_MAX);
  if (splitCount <= 0) {
    return { spawned: [], rngState };
  }

  const speed = Math.sqrt(parent.vx * parent.vx + parent.vy * parent.vy);
  const baseAngle = speed > 0 ? lutAtan2(parent.vy, parent.vx) : 0;
  const spread = SPLIT_SPREAD;

  const spawned: SpawnedChild[] = [];
  let r = rngState;

  for (let i = 0; i < splitCount; i += 1) {
    const t = splitCount === 1 ? 0.5 : i / (splitCount - 1);
    // Even fan plus a small per-shard rng jitter so identical-angle children
    // don't perfectly overlap each other.
    const [r2, jitter] = nextFloat(r);
    r = r2;
    const angle = baseAngle - spread / 2 + spread * t + (jitter - 0.5) * 0.06;
    const childSpeed = Math.max(180, speed * 0.82);
    const radius = Math.max(2, parent.radius * 0.78);

    spawned.push({
      spec: {
        ownerId: parent.ownerId,
        x: parent.x,
        y: parent.y,
        vx: lutCos(angle) * childSpeed,
        vy: lutSin(angle) * childSpeed,
        shape: parent.shape,
        radius,
        damage: parent.damage * SPLIT_DAMAGE_SCALE,
        // Children get a fraction of the parent's remaining lifetime so they
        // can't carry the original full lifetime indefinitely.
        lifetimeMs: Math.max(280, parent.lifetimeMs * SPLIT_LIFETIME_SCALE),
        // Children always go straight; cascading homing/boomerang/bounce gets
        // weird fast and matches the offline behavior. Sticky parents pass on
        // sticky to children to keep that card's identity, otherwise none.
        pathing: "straight",
        element: parent.element,
        bouncesRemaining: 0,
        pierceRemaining: 0,
        impact: parent.impact === "sticky" ? "sticky" : "none",
        impactRadiusPx: (parent.impactRadiusPx ?? 0) * 0.45,
        splitCount: 0, // no infinite cascade
        slowMultiplier: parent.slowMultiplier,
        homingStrength: 0,
        accelerationMultiplier: 0,
        gravityScale: 0,
        rangePx: parent.rangePx !== undefined ? parent.rangePx * SPLIT_RANGE_SCALE : undefined,
        ageMs: 0,
        traveledPx: 0,
        originX: parent.x,
        originY: parent.y,
        returning: false,
      },
    });
  }

  return { spawned, rngState: r };
}

function rotateVelocityToward(
  vx: number,
  vy: number,
  px: number,
  py: number,
  targetX: number,
  targetY: number,
  turnRate: number,
  dtSec: number,
): { vx: number; vy: number } {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed <= 0) return { vx, vy };
  const current = lutAtan2(vy, vx);
  const desired = lutAtan2(targetY - py, targetX - px);
  const next = rotateAngleToward(current, desired, turnRate * dtSec);
  return { vx: lutCos(next) * speed, vy: lutSin(next) * speed };
}

function rotateAngleToward(current: number, target: number, maxStep: number): number {
  const difference = wrapAngle(target - current);
  if (Math.abs(difference) <= maxStep) return target;
  return current + Math.sign(difference) * maxStep;
}

function wrapAngle(angle: number): number {
  // Wrap to [-PI, PI). Phaser.Math.Angle.Wrap equivalent without the import.
  const TWO_PI = Math.PI * 2;
  let a = angle;
  while (a < -Math.PI) a += TWO_PI;
  while (a >= Math.PI) a -= TWO_PI;
  return a;
}

function closestNonOwnerPlayer(
  fromX: number,
  fromY: number,
  ownerId: PlayerId | null,
  players: Record<PlayerId, PlayerEntity>,
): { x: number; y: number } | null {
  // Iterate in id-sorted order for deterministic tiebreaks.
  const ids = Object.keys(players).sort();
  let best: PlayerEntity | null = null;
  let bestSq = Number.POSITIVE_INFINITY;
  for (const id_ of ids) {
    const id = id_ as PlayerId;
    if (ownerId !== null && id === ownerId) continue;
    const p = players[id]!;
    if (!p.alive) continue;
    const dx = p.x - fromX;
    const dy = p.y - fromY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestSq) {
      best = p;
      bestSq = d2;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}
