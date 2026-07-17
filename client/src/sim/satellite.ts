// Orbiting satellites — auto-firing companions granted by the
// `orbitingSatellites` weapon-card modifier. Each satellite circles its owner
// at a fixed radius and periodically fires a small projectile at the nearest
// non-owner alive player. Pure: depends only on world snapshot + dt.
//
// Position is derived each tick from `owner.x + cos(angle) * orbitRadius`
// (and the same for y) — we never store position on the entity, so a clean
// world snapshot is reproducible from owner position + angle alone.
//
// Authority lives wherever this runs. On the Bun server the sim is the source
// of truth; on the client during prediction this is replayed locally.

import { spawnProjectile, type ProjectileSpawnParams } from "./projectile.js";
import { lutAtan2, lutCos, lutSin } from "./trig.js";
import { EntityId, PlayerId } from "./types.js";
import type {
  PlayerEntity,
  ProjectileEntity,
  RoundPhase,
  SatelliteEntity,
} from "./types.js";

/** Radius (px) at which satellites orbit their owner. */
export const ORBIT_RADIUS_PX = 80;

/** Angular speed (rad/s) — ~120 deg/sec. Positive = counter-clockwise. */
export const ORBIT_RAD_PER_SEC = Math.PI / 1.5;

/** Time between satellite shots (ms). Slower than the player's main weapon. */
export const SATELLITE_FIRE_COOLDOWN_MS = 600;

/** Damage per satellite shot (independent of build damage — tuned by feel). */
export const SATELLITE_DAMAGE = 4;

/** Speed (px/s) of satellite-fired projectiles. */
export const SATELLITE_PROJECTILE_SPEED = 540;

/** Lifetime (ms) of satellite-fired projectiles. */
export const SATELLITE_PROJECTILE_LIFETIME_MS = 700;

/** Radius (px) of satellite-fired projectiles. */
export const SATELLITE_PROJECTILE_RADIUS = 4;

export type StepSatellitesResult = {
  /** Surviving satellites keyed by id. Fully replaces `state.satellites`. */
  satellites: Record<EntityId, SatelliteEntity>;
  /** New projectiles fired by satellites this tick. */
  projectiles: ProjectileEntity[];
};

/**
 * Advance every satellite by one tick: rotate around its owner, tick its fire
 * cooldown, fire a projectile when ready (and round phase permits), and tick
 * its lifetime down. Despawns when lifetime expires or owner is dead/missing.
 *
 * Iteration order is sorted by EntityId ascending to keep behavior
 * deterministic across runtimes.
 */
export type StepSatellitesFn = (
  satellites: Record<EntityId, SatelliteEntity>,
  players: Record<PlayerId, PlayerEntity>,
  roundPhase: RoundPhase,
  dtMs: number,
  nextEntityId: () => EntityId,
  /** Current world tick — veil-window checks (six-axes Layer 2). Optional/
   *  additive: omitted means "no veil awareness" (legacy callers). */
  tick?: number,
) => StepSatellitesResult;

let stepSatellitesBackend: StepSatellitesFn | null = null;

/**
 * Swap the stepSatellites impl. Pass `null` to revert. NOOP today;
 * future wasm-backed routing would use `satellite_tick` for the
 * per-satellite kinematic step and keep the iteration + projectile
 * spawn in TS. Mirrors the other set<X>Backend patterns.
 */
export function setStepSatellitesBackend(fn: StepSatellitesFn | null): void {
  stepSatellitesBackend = fn;
}

export function stepSatellites(
  satellites: Record<EntityId, SatelliteEntity>,
  players: Record<PlayerId, PlayerEntity>,
  roundPhase: RoundPhase,
  dtMs: number,
  nextEntityId: () => EntityId,
  tick?: number,
): StepSatellitesResult {
  if (stepSatellitesBackend !== null) {
    return stepSatellitesBackend(satellites, players, roundPhase, dtMs, nextEntityId, tick);
  }
  return stepSatellitesNative(satellites, players, roundPhase, dtMs, nextEntityId, tick);
}

function stepSatellitesNative(
  satellites: Record<EntityId, SatelliteEntity>,
  players: Record<PlayerId, PlayerEntity>,
  roundPhase: RoundPhase,
  dtMs: number,
  nextEntityId: () => EntityId,
  tick?: number,
): StepSatellitesResult {
  const dtSec = dtMs / 1000;
  const next: Record<EntityId, SatelliteEntity> = {};
  const projectiles: ProjectileEntity[] = [];

  const ids: EntityId[] = Object.keys(satellites)
    .map((id) => EntityId(Number(id)))
    .sort((a, b) => a - b);

  for (const id of ids) {
    const sat = satellites[id]!;
    // Despawn world-owned (orphaned) satellites immediately — no owner to orbit.
    if (sat.ownerId === null) continue;
    const owner = players[sat.ownerId];

    // Despawn satellites whose owner is gone or dead.
    if (!owner || !owner.alive) {
      continue;
    }

    // Lifetime tick. Infinity stays Infinity (Infinity - dtMs === Infinity).
    const remainingLifetime = sat.lifetimeMs - dtMs;
    if (remainingLifetime <= 0) {
      continue;
    }

    // Advance orbit angle.
    const angle = sat.angle + ORBIT_RAD_PER_SEC * dtSec;

    // Tick fire cooldown.
    let fireCooldownMs = Math.max(0, sat.fireCooldownMs - dtMs);

    // Try to fire.
    if (fireCooldownMs <= 0 && roundPhase === "fighting") {
      const target = nearestEnemy(owner, players, tick);
      if (target) {
        const sx = owner.x + lutCos(angle) * sat.orbitRadius;
        const sy = owner.y + lutSin(angle) * sat.orbitRadius;
        const aimAngle = lutAtan2(target.y - sy, target.x - sx);
        const params: ProjectileSpawnParams = {
          ownerId: sat.ownerId,
          origin: { x: sx, y: sy },
          aimAngle,
          speed: SATELLITE_PROJECTILE_SPEED,
          damage: SATELLITE_DAMAGE,
          lifetimeMs: SATELLITE_PROJECTILE_LIFETIME_MS,
          radius: SATELLITE_PROJECTILE_RADIUS,
          shape: "orb",
          pathing: "straight",
          element: "crystal",
        };
        projectiles.push(spawnProjectile(nextEntityId(), params));
        fireCooldownMs = SATELLITE_FIRE_COOLDOWN_MS;
      }
    }

    next[id] = {
      id: sat.id,
      ownerId: sat.ownerId,
      angle,
      orbitRadius: sat.orbitRadius,
      fireCooldownMs,
      lifetimeMs: remainingLifetime,
    };
  }

  return { satellites: next, projectiles };
}

/**
 * Produce the satellite entities a player should have given the resolved build
 * count and the satellites they currently own. Spawns the missing ones at
 * evenly-spaced angles offset from the existing set so the orbit stays
 * symmetrical. Returns an empty array when no spawns are needed.
 *
 * `existingForOwner` MUST contain only satellites belonging to `ownerId`.
 */
export function spawnMissingSatellites(
  ownerId: PlayerId,
  desiredCount: number,
  existingForOwner: SatelliteEntity[],
  nextEntityId: () => EntityId,
): SatelliteEntity[] {
  const have = existingForOwner.length;
  const missing = desiredCount - have;
  if (missing <= 0) return [];

  const total = desiredCount;
  // Place new satellites at the unused slots in an evenly-spaced ring. The
  // simple choice — fill slots [have .. desiredCount) — keeps existing
  // satellites where they are and slots the new ones into the gaps.
  const out: SatelliteEntity[] = [];
  for (let i = have; i < total; i += 1) {
    const angle = (Math.PI * 2 * i) / total;
    out.push({
      id: nextEntityId(),
      ownerId,
      angle,
      orbitRadius: ORBIT_RADIUS_PX,
      // Stagger initial cooldowns so satellites don't fire all at once on
      // their first shot. Spread across [0, SATELLITE_FIRE_COOLDOWN_MS).
      fireCooldownMs: total > 0 ? (SATELLITE_FIRE_COOLDOWN_MS * i) / total : 0,
      lifetimeMs: Infinity,
    });
  }
  return out;
}

/**
 * Drop every satellite whose owner is in the given dead-player set. Used when
 * a round ends or a player dies — their companions vanish too.
 */
export function despawnSatellitesForDeadOwners(
  satellites: Record<EntityId, SatelliteEntity>,
  players: Record<PlayerId, PlayerEntity>,
): Record<EntityId, SatelliteEntity> {
  const out: Record<EntityId, SatelliteEntity> = {};
  for (const [idStr, sat] of Object.entries(satellites)) {
    if (sat.ownerId === null) continue; // orphaned — drop immediately
    const owner = players[sat.ownerId];
    if (owner && owner.alive) {
      out[EntityId(Number(idStr))] = sat;
    }
  }
  return out;
}

/**
 * Pick the alive non-owner player whose body center is closest to the source
 * position. Returns null if none exist. Iteration order is sorted by player id
 * for tie-stability across runtimes.
 */
function nearestEnemy(
  owner: PlayerEntity,
  players: Record<PlayerId, PlayerEntity>,
  tick?: number,
): PlayerEntity | null {
  let best: PlayerEntity | null = null;
  let bestDist2 = Infinity;
  const ids = Object.keys(players).sort();
  for (const pid_ of ids) {
    const pid = pid_ as PlayerId;
    if (pid === owner.id) continue;
    const p = players[pid]!;
    if (!p.alive) continue;
    // Veil of Nought (six-axes Layer 2): bound aeons cannot see the unmade.
    if (tick !== undefined && p.veilUntilTick !== undefined && p.veilUntilTick > tick) {
      continue;
    }
    const dx = p.x - owner.x;
    const dy = p.y - owner.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = p;
    }
  }
  return best;
}
