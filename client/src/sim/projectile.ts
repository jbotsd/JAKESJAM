// Pure projectile physics. First cut handles straight-line motion + gravity
// pathing + lifetime + platform collision + player overlap. Bounce, boomerang,
// homing, anti-homing, split, sticky, pierce-chain, and impact-radius are
// follow-up — Dev A pulls those across as cards land.
//
// Authority lives wherever this runs. On the Bun server the sim is the source
// of truth. On the client during prediction this is replayed locally and
// reconciled against the server snapshot.

import { aabbOverlap, circleOverlapsAABB, type AABB } from "./collision.js";
import type {
  EntityId,
  PlatformDefinition,
  PlayerEntity,
  PlayerId,
  ProjectileEntity,
  SimEvent,
  Vec2,
} from "./types.js";

const PLAYER_RADIUS = 18;
const GRAVITY_PATHING_ACCEL = 1450;

export type StepProjectileResult = {
  projectile: ProjectileEntity | null;
  events: SimEvent[];
  /** True when the projectile expired this tick (lifetime, terrain, hit). */
  expired: boolean;
};

export function stepProjectile(
  proj: ProjectileEntity,
  platforms: readonly PlatformDefinition[],
  players: Record<PlayerId, PlayerEntity>,
  dtMs: number,
): StepProjectileResult {
  const dtSec = dtMs / 1000;
  const remaining = proj.lifetimeMs - dtMs;
  if (remaining <= 0) {
    return { projectile: null, events: [], expired: true };
  }

  let vx = proj.vx;
  let vy = proj.vy;

  if (proj.pathing === "gravity") {
    vy += GRAVITY_PATHING_ACCEL * dtSec;
  }

  const x = proj.x + vx * dtSec;
  const y = proj.y + vy * dtSec;

  // Platform collision: projectile dies on contact (no bounce in first cut).
  for (const platform of platforms) {
    if (circleOverlapsAABB(x, y, proj.radius, platformToAABB(platform))) {
      return { projectile: null, events: [], expired: true };
    }
  }

  // Player overlap: damage + die.
  for (const [pid, player] of Object.entries(players)) {
    if (pid === proj.ownerId) continue;
    if (!player.alive) continue;
    if (
      aabbOverlap(
        { x: x - proj.radius, y: y - proj.radius, w: proj.radius * 2, h: proj.radius * 2 },
        { x: player.x - PLAYER_RADIUS, y: player.y - PLAYER_RADIUS, w: PLAYER_RADIUS * 2, h: PLAYER_RADIUS * 2 },
      )
    ) {
      return {
        projectile: null,
        events: [
          {
            t: "hit-confirmed",
            victimId: pid,
            damage: proj.damage,
            sourceProjectileId: proj.id,
          },
        ],
        expired: true,
      };
    }
  }

  return {
    projectile: { ...proj, x, y, vx, vy, lifetimeMs: remaining },
    events: [],
    expired: false,
  };
}

export type ProjectileSpawnParams = {
  ownerId: PlayerId;
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
    vx: Math.cos(params.aimAngle) * params.speed,
    vy: Math.sin(params.aimAngle) * params.speed,
    shape: params.shape ?? "circle",
    radius: params.radius ?? 7,
    damage: params.damage,
    lifetimeMs: params.lifetimeMs,
    pathing: params.pathing ?? "straight",
    element: params.element ?? "crystal",
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
}

function platformToAABB(p: PlatformDefinition): AABB {
  return {
    x: p.position.x - p.size.x / 2,
    y: p.position.y - p.size.y / 2,
    w: p.size.x,
    h: p.size.y,
  };
}
