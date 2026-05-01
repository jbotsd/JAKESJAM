// Weapon firing — fire-rate gating, recoil, projectile spawn. Resolves the
// player's card hand into a ResolvedWeaponBuild and uses build stats (damage,
// rate, speed, lifetime, spread, recoil, multi-shot count, projectile shape /
// pathing / element) instead of hardcoded constants. Pure: depends only on
// the player snapshot, the input bit, the aim, and dt.

import { crystalRoundsCards } from "./data/cards.js";
import {
  NEUTRAL_CHAOS_PROFILE,
  projectileShapes,
  type ChaosProfile,
} from "./data/chaosModifiers.js";
import type {
  CardDefinition,
  ResolvedWeaponBuild,
} from "./data/cardTypes.js";
import { starterWeapon } from "./data/weapons.js";
import { createWeaponBuild, findCardsById } from "./data/weaponBuild.js";
import { spawnProjectile, type ProjectileSpawnParams } from "./projectile.js";
import { nextInt } from "./rng.js";
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
  /**
   * Updated rng cursor. Only advanced when `random-shapes` chaos rolled a
   * shape (or another future chaos hook draws). Caller threads back into
   * `WorldState.rngState`.
   */
  rngState: number;
};

export type StepWeaponOptions = {
  chaos?: ChaosProfile;
  /** Initial RNG cursor for any chaos-driven random draws this tick. */
  rngState?: number;
};

/**
 * Try to fire the player's weapon this tick. Returns the new player state
 * (cooldown ticked, recoil applied if fired) and any projectiles to insert
 * into the world.
 *
 * `fireRequested` should be the value of the Fire input bit on this tick.
 * `nextEntityId` is a callback that returns the next free entity id; the world
 * is responsible for keeping its own id counter consistent.
 *
 * Chaos profile (when supplied) scales damage/firerate/recoil multiplicatively
 * over the resolved build, and gates projectile spawn for `slappers-only`.
 * `random-shapes` rerolls each spawned shard's shape from the projectileShapes
 * table using the seeded RNG.
 */
export function stepWeapon(
  player: PlayerEntity,
  fireRequested: boolean,
  aim: Vec2,
  dtMs: number,
  nextEntityId: () => EntityId,
  options: StepWeaponOptions = {},
): FireResult {
  const chaos = options.chaos ?? NEUTRAL_CHAOS_PROFILE;
  let rngState = options.rngState ?? 0;
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
      rngState,
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
  // Damage is left at the build value here; the chaos damageMultiplier is
  // applied post-hit in World.stepWithRuntime so satellites and any other
  // projectile sources get the same scaling without each spawn site reading
  // chaos directly.
  const damage = build.damage;
  // Per-shot offset: spread the count evenly across [-totalSpread/2, +totalSpread/2].
  // Single-shot shots ignore spread entirely (consistent with the offline path).
  const projectiles: ProjectileEntity[] = [];
  // `slappers-only` skips projectile spawn entirely; cooldown/recoil still
  // apply so the shooter feels the kick (matches the chaos modifier intent).
  if (!chaos.disableProjectiles) {
    for (let i = 0; i < projectileCount; i += 1) {
      const offset =
        projectileCount === 1
          ? 0
          : -totalSpread / 2 + (totalSpread * i) / (projectileCount - 1);
      const angle = baseAngle + offset;
      let shape: ProjectileEntity["shape"] = simShape(build.projectile.shape);
      if (chaos.randomShapes) {
        const [nextRng, idx] = nextInt(rngState, 0, projectileShapes.length);
        rngState = nextRng;
        shape = projectileShapes[idx]!;
      }
      const params: ProjectileSpawnParams = {
        ownerId: next.id,
        origin: muzzle,
        aimAngle: angle,
        speed,
        damage,
        lifetimeMs,
        radius,
        shape,
        pathing: build.projectile.pathing,
        element: build.projectile.element,
      };
      const projectile = spawnProjectile(nextEntityId(), params);
      projectile.bouncesRemaining = build.projectile.bounces;
      projectile.pierceRemaining = build.projectile.pierceCount;
      // Populate the additive pathing/impact extras the sim's stepProjectile
      // reads. These are optional on the contract but always set here so the
      // wire-protocol path can rely on them.
      projectile.impact = build.projectile.impact;
      projectile.impactRadiusPx = build.projectile.impactRadiusPx;
      projectile.splitCount = build.projectile.splitCount;
      projectile.slowMultiplier = build.projectile.slowMultiplier;
      projectile.homingStrength = build.projectile.homingStrength;
      projectile.accelerationMultiplier = build.projectile.accelerationMultiplier;
      projectile.gravityScale = build.projectile.gravityScale;
      projectile.rangePx = build.projectile.rangePx;
      projectiles.push(projectile);
    }
  }

  // Apply recoil — push the player opposite to the aim direction, scaled by
  // the build's recoil, the projectile recoil multiplier, and chaos recoil.
  const recoil =
    build.recoilImpulse *
    build.projectile.recoilMultiplier *
    chaos.recoilMultiplier;
  next.vx -= Math.cos(baseAngle) * recoil;
  next.vy -= Math.sin(baseAngle) * recoil * 0.45;

  // Cooldown derived from build.fireRate (shots per second), scaled by the
  // chaos fire-rate multiplier (golden-gun slows it, future buffs raise it).
  const fireRate = Math.max(
    MIN_FIRE_RATE,
    build.fireRate * chaos.fireRateMultiplier,
  );
  next.fireCooldownMs = 1000 / fireRate;
  next.ammo = Math.max(0, next.ammo - 1);

  return {
    player: next,
    projectiles,
    fired: true,
    desiredSatelliteCount: Math.max(0, build.orbitingSatellites | 0),
    rngState,
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
