// Weapon firing — fire-rate gating, recoil, projectile spawn. Resolves the
// player's card hand into a ResolvedWeaponBuild and uses build stats (damage,
// rate, speed, lifetime, spread, recoil, multi-shot count, projectile shape /
// pathing / element) instead of hardcoded constants. Pure: depends only on
// the player snapshot, the input bit, the aim, and dt.

import { crystalRoundsCards } from "./data/cards.js";
import type {
  CardDefinition,
  ResolvedWeaponBuild,
} from "./data/cardTypes.js";
import { starterWeapon } from "./data/weapons.js";
import { createWeaponBuild, findCardsById } from "./data/weaponBuild.js";
import { spawnProjectile, type ProjectileSpawnParams } from "./projectile.js";
import type { EntityId, PlayerEntity, ProjectileEntity, Vec2 } from "./types.js";

/** Default fire cadence floor when fireRate is zero or missing. */
const MIN_FIRE_RATE = 0.35;

/**
 * Cached resolved build per player. Avoids re-resolving the card hand every
 * tick. Keyed by `${weaponId}|${cardsKey}` so the cache invalidates whenever
 * the weapon or hand changes. The sim caller is single-threaded and the cache
 * lives in module scope for simplicity; this is an internal optimization with
 * no observable effect on output (resolution is deterministic).
 */
const buildCache = new Map<string, ResolvedWeaponBuild>();

function buildKey(player: PlayerEntity): string {
  return `${player.weaponId}|${player.cards.join(",")}`;
}

function resolvePlayerBuild(player: PlayerEntity): ResolvedWeaponBuild {
  const key = buildKey(player);
  const cached = buildCache.get(key);
  if (cached) return cached;
  // For now the only weapon is starter-pistol. When more weapons exist this
  // will look up the WeaponDefinition by player.weaponId.
  const cards: CardDefinition[] = findCardsById(crystalRoundsCards, player.cards);
  const build = createWeaponBuild(starterWeapon, cards);
  buildCache.set(key, build);
  return build;
}

export type FireResult = {
  player: PlayerEntity;
  projectiles: ProjectileEntity[];
  fired: boolean;
  /**
   * Number of orbiting satellites this player's resolved build expects.
   * The World tick uses this on `fired === true` to spawn any missing
   * satellites (first-fire activation). Always >= 0.
   */
  desiredSatelliteCount: number;
};

/**
 * Try to fire the player's weapon this tick. Returns the new player state
 * (cooldown ticked, recoil applied if fired) and any projectiles to insert
 * into the world.
 *
 * `fireRequested` should be the value of the Fire input bit on this tick.
 * `nextEntityId` is a callback that returns the next free entity id; the world
 * is responsible for keeping its own id counter consistent.
 */
export function stepWeapon(
  player: PlayerEntity,
  fireRequested: boolean,
  aim: Vec2,
  dtMs: number,
  nextEntityId: () => EntityId,
): FireResult {
  const next: PlayerEntity = {
    ...player,
    fireCooldownMs: Math.max(0, player.fireCooldownMs - dtMs),
  };

  if (!fireRequested || !next.alive || next.fireCooldownMs > 0) {
    const idleBuild = resolvePlayerBuild(next);
    return {
      player: next,
      projectiles: [],
      fired: false,
      desiredSatelliteCount: Math.max(0, idleBuild.orbitingSatellites | 0),
    };
  }

  const build = resolvePlayerBuild(next);

  // Beam / pulse / area deliveries are not modeled in the sim yet; fall
  // through to projectile semantics so the cooldown still advances and the
  // shot still registers visually. Future card pass will model raycast hit
  // resolution and continuous beam ticks.
  const muzzle: Vec2 = playerMuzzlePosition(next, aim);
  const baseAngle = Math.atan2(aim.y - muzzle.y, aim.x - muzzle.x);

  const speed = build.projectileSpeed * build.projectile.speedMultiplier;
  const lifetimeMs = Math.max(50, build.projectileLifetimeSeconds * 1000 * build.projectile.lifetimeMultiplier);
  const radius = Math.max(2, 7 * build.projectile.sizeMultiplier);
  const projectileCount = Math.max(1, build.projectile.count | 0);
  const totalSpread = build.spreadRadians;
  // Per-shot offset: spread the count evenly across [-totalSpread/2, +totalSpread/2].
  // Single-shot shots ignore spread entirely (consistent with the offline path).
  const projectiles: ProjectileEntity[] = [];
  for (let i = 0; i < projectileCount; i += 1) {
    const offset =
      projectileCount === 1
        ? 0
        : -totalSpread / 2 + (totalSpread * i) / (projectileCount - 1);
    const angle = baseAngle + offset;
    const params: ProjectileSpawnParams = {
      ownerId: next.id,
      origin: muzzle,
      aimAngle: angle,
      speed,
      damage: build.damage,
      lifetimeMs,
      radius,
      shape: simShape(build.projectile.shape),
      pathing: build.projectile.pathing,
      element: build.projectile.element,
    };
    const projectile = spawnProjectile(nextEntityId(), params);
    projectile.bouncesRemaining = build.projectile.bounces;
    projectile.pierceRemaining = build.projectile.pierceCount;
    projectiles.push(projectile);
  }

  // Apply recoil — push the player opposite to the aim direction, scaled by
  // the build's recoil and the projectile recoil multiplier.
  const recoil = build.recoilImpulse * build.projectile.recoilMultiplier;
  next.vx -= Math.cos(baseAngle) * recoil;
  next.vy -= Math.sin(baseAngle) * recoil * 0.45;

  // Cooldown derived from build.fireRate (shots per second).
  const fireRate = Math.max(MIN_FIRE_RATE, build.fireRate);
  next.fireCooldownMs = 1000 / fireRate;
  next.ammo = Math.max(0, next.ammo - 1);

  return {
    player: next,
    projectiles,
    fired: true,
    desiredSatelliteCount: Math.max(0, build.orbitingSatellites | 0),
  };
}

/**
 * Where the projectile spawns from on the player rig. Approximate match to the
 * existing MatchScene muzzle math, kept simple here since the sim doesn't know
 * about visual rig pose (crouching offset etc. — close enough for hitscan).
 */
function playerMuzzlePosition(player: PlayerEntity, aim: Vec2): Vec2 {
  const reach = 22;
  const dx = aim.x - player.x;
  const dy = aim.y - player.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: player.x + (dx / len) * reach,
    y: player.y + (dy / len) * reach,
  };
}

/**
 * The sim's ProjectileEntity now accepts the wider card-data shape union, so
 * this is currently a 1:1 pass-through. Kept as a function to centralize the
 * mapping if the sim ever needs to collapse novel shapes back to a smaller set
 * for the wire protocol.
 */
function simShape(shape: ResolvedWeaponBuild["projectile"]["shape"]): ProjectileEntity["shape"] {
  return shape;
}
