// Pure card -> weapon-build resolver. Composes a base WeaponDefinition with a
// hand of CardDefinitions into a ResolvedWeaponBuild. Behavior matches the
// original client/src/game/systems/WeaponSystem.ts implementation byte for
// byte; lives in sim/ so server authority + client prediction agree.

import type {
  CardDefinition,
  ProjectileModifier,
  ResolvedWeaponBuild,
  WeaponBucket,
  WeaponDefinition,
} from "./cardTypes.js";

export function createWeaponBuild(
  baseWeapon: WeaponDefinition,
  cards: CardDefinition[],
): ResolvedWeaponBuild {
  const build: ResolvedWeaponBuild = {
    id: baseWeapon.id,
    name: baseWeapon.name,
    delivery: baseWeapon.delivery,
    damage: baseWeapon.damage,
    fireRate: baseWeapon.fireRate,
    magazineSize: baseWeapon.magazineSize,
    reloadSeconds: baseWeapon.reloadSeconds,
    projectileSpeed: baseWeapon.projectileSpeed,
    projectileLifetimeSeconds: baseWeapon.projectileLifetimeSeconds,
    spreadRadians: baseWeapon.spreadRadians,
    recoilImpulse: baseWeapon.recoilImpulse,
    knockbackImpulse: baseWeapon.knockbackImpulse,
    projectile: { ...baseWeapon.projectile },
    ammoRegenPerSecond: 0,
    overchargeMultiplier: 1,
    orbitingSatellites: 0,
    mirrorShield: false,
    maxHealthAdd: 0,
    moveSpeedMultiplier: 1,
    parryCoverMultiplier: 1,
    parryCooldownMultiplier: 1,
    cards: [],
    occupiedBuckets: [],
  };

  const bucketOwners = new Set<WeaponBucket>();

  for (const card of cards) {
    if (!card.modifier) {
      continue;
    }

    const buckets = card.buckets ?? [];
    for (const bucket of buckets) {
      bucketOwners.add(bucket);
    }

    applyCard(build, card);
    build.cards.push(card);
  }

  build.occupiedBuckets = [...bucketOwners];
  clampBuild(build);

  return build;
}

export function findCardsById(
  cards: CardDefinition[],
  ids: string[],
): CardDefinition[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return ids.flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}

export function applyCard(build: ResolvedWeaponBuild, card: CardDefinition) {
  const modifier = card.modifier;
  if (!modifier) {
    return;
  }

  if (modifier.delivery) {
    build.delivery = modifier.delivery;
  }

  build.damage *= modifier.damageMultiplier ?? 1;
  build.fireRate *= modifier.fireRateMultiplier ?? 1;
  build.projectileSpeed *= modifier.projectileSpeedMultiplier ?? 1;
  build.reloadSeconds *= modifier.reloadMultiplier ?? 1;
  build.recoilImpulse *= modifier.recoilMultiplier ?? 1;
  build.knockbackImpulse *= modifier.knockbackMultiplier ?? 1;
  build.magazineSize += modifier.magazineSizeAdd ?? 0;
  build.ammoRegenPerSecond += modifier.ammoRegenPerSecond ?? 0;
  build.maxHealthAdd += modifier.maxHealthAdd ?? 0;
  build.moveSpeedMultiplier *= modifier.moveSpeedMultiplier ?? 1;
  build.parryCoverMultiplier *= modifier.parryCoverMultiplier ?? 1;
  build.parryCooldownMultiplier *= modifier.parryCooldownMultiplier ?? 1;
  build.overchargeMultiplier = Math.max(
    build.overchargeMultiplier,
    modifier.overchargeMultiplier ?? 1,
  );
  build.orbitingSatellites += modifier.orbitingSatellites ?? 0;
  build.mirrorShield ||= modifier.mirrorShield ?? false;

  if (modifier.spreadRadians !== undefined) {
    build.spreadRadians = modifier.spreadRadians;
  }
  build.spreadRadians += modifier.spreadRadiansAdd ?? 0;

  if (modifier.projectile) {
    build.projectile = mergeProjectileModifier(build.projectile, modifier.projectile);
  }
  build.projectile.count += modifier.projectileCountAdd ?? 0;
  build.projectile.bounces += modifier.projectileBounceAdd ?? 0;
  build.projectile.splitCount += modifier.projectileSplitAdd ?? 0;
  build.projectile.homingStrength += modifier.projectileHomingStrengthAdd ?? 0;
}

export function mergeProjectileModifier(
  current: ProjectileModifier,
  modifier: Partial<ProjectileModifier>,
): ProjectileModifier {
  return {
    ...current,
    ...modifier,
    speedMultiplier: current.speedMultiplier * (modifier.speedMultiplier ?? 1),
    sizeMultiplier: current.sizeMultiplier * (modifier.sizeMultiplier ?? 1),
    recoilMultiplier: current.recoilMultiplier * (modifier.recoilMultiplier ?? 1),
    lifetimeMultiplier: current.lifetimeMultiplier * (modifier.lifetimeMultiplier ?? 1),
  };
}

export function clampBuild(build: ResolvedWeaponBuild) {
  build.damage = roundTo(build.damage, 2);
  build.fireRate = roundTo(Math.max(0.35, build.fireRate), 2);
  build.magazineSize = Math.max(1, Math.round(build.magazineSize));
  build.reloadSeconds = roundTo(Math.max(0.15, build.reloadSeconds), 2);
  build.projectileSpeed = roundTo(Math.max(80, build.projectileSpeed), 2);
  build.projectileLifetimeSeconds = roundTo(Math.max(0.1, build.projectileLifetimeSeconds), 2);
  build.spreadRadians = Math.max(0, build.spreadRadians);
  build.recoilImpulse = roundTo(Math.max(0, build.recoilImpulse), 2);
  build.knockbackImpulse = roundTo(Math.max(0, build.knockbackImpulse), 2);
  build.maxHealthAdd = Math.max(0, Math.round(build.maxHealthAdd));
  build.moveSpeedMultiplier = roundTo(Math.max(0.45, build.moveSpeedMultiplier), 2);
  build.parryCoverMultiplier = roundTo(Math.max(0.45, build.parryCoverMultiplier), 2);
  build.parryCooldownMultiplier = roundTo(Math.max(0.28, build.parryCooldownMultiplier), 2);
  build.projectile.count = Math.max(1, Math.round(build.projectile.count));
  build.projectile.rangePx = Math.max(48, build.projectile.rangePx);
  build.projectile.sizeMultiplier = Math.max(0.35, build.projectile.sizeMultiplier);
  build.projectile.speedMultiplier = Math.max(0.15, build.projectile.speedMultiplier);
  build.projectile.lifetimeMultiplier = Math.max(0.1, build.projectile.lifetimeMultiplier);
  build.projectile.bounces = Math.max(0, Math.round(build.projectile.bounces));
  build.projectile.homingStrength = roundTo(Math.max(0, build.projectile.homingStrength), 2);
  build.projectile.impactRadiusPx = Math.max(0, build.projectile.impactRadiusPx);
  build.projectile.pierceCount = Math.max(0, Math.round(build.projectile.pierceCount));
  build.projectile.splitCount = Math.max(0, Math.round(build.projectile.splitCount));
  build.projectile.slowMultiplier = Math.max(0.1, Math.min(1, build.projectile.slowMultiplier));
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
