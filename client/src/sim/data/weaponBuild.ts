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

/**
 * Compute the neutral time-to-kill (seconds) for a base weapon definition.
 * Assumes a 100 HP target (PLAYER_BASE_HP) with no shields, no cards.
 * Per combat-balance-ttk/SKILL.md: target band is 1.8s – 3.5s.
 *
 * Formula: HP / (damage × shots_per_second)
 * The fireRate field is shots-per-second.
 */
export function neutralTTK(weapon: { damage: number; fireRate: number }): number {
  const PLAYER_BASE_HP = 100;
  if (weapon.fireRate <= 0 || weapon.damage <= 0) return Infinity;
  return PLAYER_BASE_HP / (weapon.damage * weapon.fireRate);
}

/**
 * TTK for a fully resolved build. Accounts for the resolved DPS of the build
 * which may include card-multiplied damage + fire rate.
 */
export function neutralTTKBuild(build: ResolvedWeaponBuild): number {
  return neutralTTK({ damage: build.damage, fireRate: build.fireRate });
}

/**
 * Pellet-aware TTK used by the stack floor (multi-shot spreads miss).
 * Matches the efficiency model inside clampBuild.
 */
export function effectiveTTKBuild(build: ResolvedWeaponBuild): number {
  const pelletEff = 0.62 + 0.38 / Math.max(1, build.projectile.count);
  const dps = build.damage * build.fireRate * build.projectile.count * pelletEff;
  if (dps <= 0) return Infinity;
  return 100 / dps;
}

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
    gravityMultiplier: 1,
    shieldChargeMultiplier: 1,
    shieldRechargeMultiplier: 1,
    directionalShield: false,
    stolenFangs: false,
    jumpMultiplier: 1,
    wallJumpMultiplier: 1,
    wallSlideMultiplier: 1,
    airJumps: 0,
    dashCharges: 0,
    dashCooldownMultiplier: 1,
    cards: [],
    occupiedBuckets: [],
  };

  const bucketOwners = new Set<WeaponBucket>();
  /** How many times each card id has already been applied (maxStacks / unique). */
  const appliedCounts = new Map<string, number>();

  for (const card of cards) {
    if (!card.modifier) {
      continue;
    }

    const already = appliedCounts.get(card.id) ?? 0;
    if (card.unique && already >= 1) continue;
    if (card.maxStacks !== undefined && already >= card.maxStacks) continue;
    appliedCounts.set(card.id, already + 1);

    const buckets = card.buckets ?? [];
    for (const bucket of buckets) {
      bucketOwners.add(bucket);
    }

    applyCard(build, card);
    build.cards.push(card);
  }

  build.occupiedBuckets = [...bucketOwners];
  // Delivery cards reshape projectile identity so rare delivery picks FEEL
  // different even though the sim still spawns projectiles (hitscan math is
  // approximated by hyper-speed / beam-tick rates — see weapon.ts).
  applyDeliveryFeel(build);
  clampBuild(build);
  // Continuous-beam identity needs high tick rate; if TTK clamp lowered
  // fireRate, restore the floor and pay with damage so feel stays a "beam".
  if (build.delivery === "continuous-beam" && build.fireRate < 8) {
    const ratio = 8 / Math.max(0.35, build.fireRate);
    build.fireRate = 8;
    build.damage = roundTo(build.damage / ratio, 2);
  }

  return build;
}

/**
 * Map delivery bucket to projectile parameters that read as that identity
 * on both authority and prediction (no separate hitscan step required).
 */
function applyDeliveryFeel(build: ResolvedWeaponBuild): void {
  if (build.delivery === "raycast") {
    // Instant-feel line: hyper-fast shard, long range. Preserve orthogonal
    // pathing (homing/bounce) if a trajectory card already set it.
    build.projectile.count = Math.max(1, build.projectile.count);
    if ((PATHING_RANK[build.projectile.pathing] ?? 0) === 0) {
      build.projectile.pathing = "straight";
    }
    build.projectile.speedMultiplier = Math.max(build.projectile.speedMultiplier, 3.2);
    build.projectile.lifetimeMultiplier = Math.min(build.projectile.lifetimeMultiplier, 0.35);
    build.projectile.rangePx = Math.max(build.projectile.rangePx, 880);
    if (build.projectile.gravityScale === 0 || build.projectile.pathing === "straight") {
      build.projectile.gravityScale = 0;
    }
    // Thin the beam slightly without erasing size-grow cards (floor only).
    build.projectile.sizeMultiplier = Math.max(0.55, build.projectile.sizeMultiplier);
  } else if (build.delivery === "continuous-beam") {
    if ((PATHING_RANK[build.projectile.pathing] ?? 0) === 0) {
      build.projectile.pathing = "straight";
    }
    // Cap size upward for beam readability, but never erase below grow stacks.
    build.projectile.sizeMultiplier = Math.min(
      Math.max(build.projectile.sizeMultiplier, 0.55),
      Math.max(0.7, build.projectile.sizeMultiplier),
    );
    build.projectile.lifetimeMultiplier = Math.min(build.projectile.lifetimeMultiplier, 0.55);
    build.projectile.rangePx = Math.max(build.projectile.rangePx, 720);
    build.projectile.gravityScale = 0;
    build.fireRate = Math.max(build.fireRate, 8);
  } else if (build.delivery === "area-pulse") {
    build.projectile.impact = preferImpact(build.projectile.impact, "explosive");
    build.projectile.impactRadiusPx = Math.max(build.projectile.impactRadiusPx, 72);
    // Slow the pulse slightly without erasing speed-grow cards.
    build.projectile.speedMultiplier = Math.max(0.5, build.projectile.speedMultiplier);
    build.projectile.sizeMultiplier = Math.max(build.projectile.sizeMultiplier, 1.25);
  }
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
    // Delivery is a rare identity — only upgrade from baseline projectile.
    // Never stomp raycast/beam with a later "projectile" card.
    if (build.delivery === "projectile" || modifier.delivery !== "projectile") {
      build.delivery = modifier.delivery;
    }
  }

  build.damage *= modifier.damageMultiplier ?? 1;
  // Rate/speed: compose in factor-space so up+down cards don't fully cancel.
  if (modifier.fireRateMultiplier !== undefined && modifier.fireRateMultiplier !== 1) {
    const factor = build.fireRate; // absolute; treat as "current scale from 1 unit"
    // Rebase: apply orthogonal mult against unit then re-scale from previous.
    const nextFactor = orthogonalScale(1, modifier.fireRateMultiplier);
    // When nextFactor is pure mult, this equals *= mult. When we later track
    // a running factor, orthogonality kicks in via projectile scales first.
    build.fireRate = factor * nextFactor;
  }
  if (
    modifier.projectileSpeedMultiplier !== undefined &&
    modifier.projectileSpeedMultiplier !== 1
  ) {
    build.projectileSpeed *= orthogonalScale(1, modifier.projectileSpeedMultiplier);
  }
  build.reloadSeconds *= modifier.reloadMultiplier ?? 1;
  build.recoilImpulse *= modifier.recoilMultiplier ?? 1;
  build.knockbackImpulse *= modifier.knockbackMultiplier ?? 1;
  build.magazineSize += modifier.magazineSizeAdd ?? 0;
  build.ammoRegenPerSecond += modifier.ammoRegenPerSecond ?? 0;
  build.maxHealthAdd += modifier.maxHealthAdd ?? 0;
  if (modifier.moveSpeedMultiplier !== undefined && modifier.moveSpeedMultiplier !== 1) {
    build.moveSpeedMultiplier = orthogonalScale(
      build.moveSpeedMultiplier,
      modifier.moveSpeedMultiplier,
    );
  }
  build.parryCoverMultiplier *= modifier.parryCoverMultiplier ?? 1;
  build.parryCooldownMultiplier *= modifier.parryCooldownMultiplier ?? 1;
  if (modifier.gravityMultiplier !== undefined && modifier.gravityMultiplier !== 1) {
    build.gravityMultiplier = orthogonalScale(
      build.gravityMultiplier,
      modifier.gravityMultiplier,
    );
  }
  build.shieldChargeMultiplier *= modifier.shieldChargeMultiplier ?? 1;
  build.shieldRechargeMultiplier *= modifier.shieldRechargeMultiplier ?? 1;
  build.directionalShield ||= modifier.directionalShield ?? false;
  build.stolenFangs ||= modifier.stolenFangs ?? false;
  build.jumpMultiplier *= modifier.jumpMultiplier ?? 1;
  build.wallJumpMultiplier *= modifier.wallJumpMultiplier ?? 1;
  build.wallSlideMultiplier *= modifier.wallSlideMultiplier ?? 1;
  build.airJumps += modifier.airJumpsAdd ?? 0;
  build.dashCharges += modifier.dashChargesAdd ?? 0;
  build.dashCooldownMultiplier *= modifier.dashCooldownMultiplier ?? 1;
  build.overchargeMultiplier = Math.max(
    build.overchargeMultiplier,
    modifier.overchargeMultiplier ?? 1,
  );
  build.orbitingSatellites += modifier.orbitingSatellites ?? 0;
  build.mirrorShield ||= modifier.mirrorShield ?? false;

  // Spread: never shrink a prior wide fan with a later absolute set.
  if (modifier.spreadRadians !== undefined) {
    build.spreadRadians = Math.max(build.spreadRadians, modifier.spreadRadians);
  }
  build.spreadRadians += modifier.spreadRadiansAdd ?? 0;

  if (modifier.projectile) {
    build.projectile = mergeProjectileModifier(build.projectile, modifier.projectile);
  }
  build.projectile.count += modifier.projectileCountAdd ?? 0;
  build.projectile.bounces += modifier.projectileBounceAdd ?? 0;
  build.projectile.splitCount += modifier.projectileSplitAdd ?? 0;
  build.projectile.homingStrength += modifier.projectileHomingStrengthAdd ?? 0;

  // Every card must leave a readable in-world signature.
  ensureVisibleCardSignature(build, card, modifier);
}

/**
 * True if the card already changed something the player can see in the arena.
 */
function cardHasVisibleSignature(modifier: NonNullable<CardDefinition["modifier"]>): boolean {
  const p = modifier.projectile;
  if (modifier.delivery) return true;
  if (modifier.orbitingSatellites) return true;
  if (modifier.mirrorShield || modifier.directionalShield || modifier.stolenFangs) return true;
  if (modifier.projectileCountAdd || modifier.projectileBounceAdd) return true;
  if (modifier.projectileSplitAdd || modifier.projectileHomingStrengthAdd) return true;
  if (modifier.airJumpsAdd || modifier.dashChargesAdd) return true;
  if (modifier.gravityMultiplier !== undefined && modifier.gravityMultiplier !== 1) return true;
  if (modifier.jumpMultiplier !== undefined && modifier.jumpMultiplier !== 1) return true;
  if (modifier.wallJumpMultiplier !== undefined && modifier.wallJumpMultiplier !== 1) return true;
  if (modifier.wallSlideMultiplier !== undefined && modifier.wallSlideMultiplier !== 1) return true;
  if (modifier.moveSpeedMultiplier !== undefined && modifier.moveSpeedMultiplier !== 1) return true;
  if (modifier.parryCoverMultiplier !== undefined && modifier.parryCoverMultiplier !== 1) return true;
  if (modifier.maxHealthAdd) return true;
  if (p?.shape || p?.pathing || p?.element || p?.impact) return true;
  if (p?.bounces || p?.count || p?.splitCount || p?.pierceCount) return true;
  if (p?.sizeMultiplier !== undefined && p.sizeMultiplier !== 1) return true;
  if (p?.gravityScale !== undefined && p.gravityScale !== 1) return true;
  if (p?.lifetimeMultiplier !== undefined && p.lifetimeMultiplier !== 1) return true;
  if (p?.speedMultiplier !== undefined && p.speedMultiplier !== 1) return true;
  if (modifier.projectileSpeedMultiplier !== undefined && modifier.projectileSpeedMultiplier !== 1) {
    return true;
  }
  return false;
}

function ensureVisibleCardSignature(
  build: ResolvedWeaponBuild,
  card: CardDefinition,
  modifier: NonNullable<CardDefinition["modifier"]>,
): void {
  if (cardHasVisibleSignature(modifier)) return;

  const icon = card.visual?.iconShape;
  if (icon) {
    build.projectile.shape = icon;
  }
  if (card.category === "defense" || card.category === "utility") {
    if (build.projectile.element === "neutral") {
      build.projectile.element = "crystal";
    }
    build.projectile.sizeMultiplier *= 1.08;
  } else if (modifier.fireRateMultiplier && modifier.fireRateMultiplier > 1) {
    build.projectile.sizeMultiplier *= 0.9;
    build.projectile.speedMultiplier *= 1.05;
  } else if (modifier.fireRateMultiplier && modifier.fireRateMultiplier < 1) {
    build.projectile.sizeMultiplier *= 1.12;
  } else {
    build.projectile.sizeMultiplier *= 1.06;
  }
}

/**
 * Deep orthogonal merge — stacking cards from different axes must NEVER
 * erase or reverse each other:
 *   - Categorical (shape / pathing / element / impact): prefer, never clobber
 *     a stronger identity with a weaker one (neutral never overwrites).
 *   - Counts / bounces / pierce / split / radius: max or additive (not last-write).
 *   - Scale mults (size / speed / lifetime / recoil): multiplicative, but
 *     opposing directions on the SAME axis use `orthogonalScale` so grow+shrink
 *     don't cancel to ~1 (e.g. Heavy Coolant + Needle both remain readable).
 */
export function mergeProjectileModifier(
  current: ProjectileModifier,
  modifier: Partial<ProjectileModifier>,
): ProjectileModifier {
  return {
    shape: preferShape(current.shape, modifier.shape),
    count:
      modifier.count !== undefined
        ? Math.max(current.count, modifier.count)
        : current.count,
    // Direct override, not Math.max: a card explicitly setting rangePx may
    // legitimately mean a REDUCTION (shard-bloom: "Close-range shard burst
    // ... weak at range"), not just a floor. Math.max silently discarded
    // every range nerf a card ever tried to apply — a real live-balance
    // bug, not just a Zig-parity artifact (confirmed: only 3 cards ever set
    // rangePx; the other two are increases either way, so this is a no-op
    // change for them and only fixes shard-bloom's actually-broken intent).
    rangePx: modifier.rangePx ?? current.rangePx,
    speedMultiplier: orthogonalScale(
      current.speedMultiplier,
      modifier.speedMultiplier ?? 1,
    ),
    sizeMultiplier: orthogonalScale(
      current.sizeMultiplier,
      modifier.sizeMultiplier ?? 1,
    ),
    recoilMultiplier: current.recoilMultiplier * (modifier.recoilMultiplier ?? 1),
    pathing: preferPathing(current.pathing, modifier.pathing),
    element: preferElement(current.element, modifier.element),
    impact: preferImpact(current.impact, modifier.impact),
    lifetimeMultiplier: orthogonalScale(
      current.lifetimeMultiplier,
      modifier.lifetimeMultiplier ?? 1,
    ),
    gravityScale:
      modifier.gravityScale !== undefined
        ? // Gravity lob + float: keep the more extreme |g| away from 0 when both set
          Math.abs(modifier.gravityScale) >= Math.abs(current.gravityScale)
            ? modifier.gravityScale
            : current.gravityScale
        : current.gravityScale,
    homingStrength: Math.max(
      current.homingStrength,
      modifier.homingStrength ?? 0,
    ),
    accelerationMultiplier:
      current.accelerationMultiplier * (modifier.accelerationMultiplier ?? 1),
    bounces:
      modifier.bounces !== undefined
        ? Math.max(current.bounces, modifier.bounces)
        : current.bounces,
    impactRadiusPx: Math.max(
      current.impactRadiusPx,
      modifier.impactRadiusPx ?? 0,
    ),
    pierceCount:
      modifier.pierceCount !== undefined
        ? Math.max(current.pierceCount, modifier.pierceCount)
        : current.pierceCount,
    splitCount:
      modifier.splitCount !== undefined
        ? Math.max(current.splitCount, modifier.splitCount)
        : current.splitCount,
    // Slow: lower multiplier = stronger slow — keep the stronger (smaller) one.
    slowMultiplier: Math.min(
      current.slowMultiplier,
      modifier.slowMultiplier ?? current.slowMultiplier,
    ),
  };
}

/**
 * Compose two scale factors on the same axis without canceling identities.
 * Same-direction (both grow or both shrink): multiply as usual.
 * Mixed (one grow, one shrink): keep both as partial — geometric blend so
 * neither card's gift disappears (Heavy 1.22 + Needle 0.86 → still >1 and
 * still "big-ish + fast-ish" rather than ~1.05 mush).
 */
export function orthogonalScale(current: number, incoming: number): number {
  if (incoming === 1) return current;
  if (current === 1) return incoming;
  const curGrow = current >= 1;
  const inGrow = incoming >= 1;
  if (curGrow === inGrow) {
    return current * incoming;
  }
  // Mixed: product would cancel. Keep the stronger deviation fully and the
  // weaker at half log-weight so both cards still read.
  const a = Math.log(Math.max(1e-6, current));
  const b = Math.log(Math.max(1e-6, incoming));
  // Weight the larger |log| at 1.0 and the smaller at 0.55 (never zero).
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  const wA = absA >= absB ? 1 : 0.55;
  const wB = absB > absA ? 1 : 0.55;
  return Math.exp(a * wA + b * wB);
}

/** Default starter shapes — safe to overwrite. */
const WEAK_SHAPES = new Set(["circle", "hexagon"]);

function preferShape(
  current: ProjectileModifier["shape"],
  incoming: ProjectileModifier["shape"] | undefined,
): ProjectileModifier["shape"] {
  if (!incoming) return current;
  if (WEAK_SHAPES.has(current) && !WEAK_SHAPES.has(incoming)) return incoming;
  if (WEAK_SHAPES.has(incoming) && !WEAK_SHAPES.has(current)) return current;
  // Both distinctive (triangle vs square): keep current so first identity wins
  // unless current is still weak.
  if (current === incoming) return current;
  if (WEAK_SHAPES.has(current)) return incoming;
  return current;
}

const PATHING_RANK: Record<string, number> = {
  straight: 0,
  bounce: 1,
  boomerang: 2,
  gravity: 3,
  float: 4,
  homing: 5,
};

function preferPathing(
  current: ProjectileModifier["pathing"],
  incoming: ProjectileModifier["pathing"] | undefined,
): ProjectileModifier["pathing"] {
  if (!incoming) return current;
  const cr = PATHING_RANK[current] ?? 0;
  const ir = PATHING_RANK[incoming] ?? 0;
  return ir >= cr ? incoming : current;
}

const ELEMENT_RANK: Record<string, number> = {
  neutral: 0,
  crystal: 1,
  sticky: 2,
  explosive: 2,
  fire: 3,
  ice: 3,
  lightning: 3,
  void: 4,
  radiant: 4,
};

function preferElement(
  current: ProjectileModifier["element"],
  incoming: ProjectileModifier["element"] | undefined,
): ProjectileModifier["element"] {
  if (!incoming) return current;
  if (incoming === "neutral") return current;
  if (current === "neutral") return incoming;
  const cr = ELEMENT_RANK[current] ?? 0;
  const ir = ELEMENT_RANK[incoming] ?? 0;
  // Equal rank (fire vs ice): keep current — both are real elements; first wins.
  return ir > cr ? incoming : current;
}

const IMPACT_RANK: Record<string, number> = {
  none: 0,
  "slow-field": 1,
  sticky: 2,
  "pierce-chain": 3,
  explosive: 4,
};

function preferImpact(
  current: ProjectileModifier["impact"],
  incoming: ProjectileModifier["impact"] | undefined,
): ProjectileModifier["impact"] {
  if (!incoming) return current;
  const cr = IMPACT_RANK[current] ?? 0;
  const ir = IMPACT_RANK[incoming] ?? 0;
  return ir >= cr ? incoming : current;
}

/**
 * Hard stack caps so multi-card builds stay in the combat-balance TTK band
 * (~1.55–4.0s effective). Multi-projectile applies a soft efficiency factor
 * so shotgun stacks don't break the floor.
 */
export const TTK_FLOOR_S = 1.55;
export const TTK_CEILING_S = 4.0;
const PLAYER_BASE_HP = 100;

export function clampBuild(build: ResolvedWeaponBuild) {
  build.damage = roundTo(build.damage, 2);
  build.fireRate = roundTo(Math.max(0.35, Math.min(12, build.fireRate)), 2);
  build.magazineSize = Math.max(1, Math.round(build.magazineSize));
  build.reloadSeconds = roundTo(Math.max(0.15, build.reloadSeconds), 2);
  build.projectileSpeed = roundTo(Math.max(80, build.projectileSpeed), 2);
  build.projectileLifetimeSeconds = roundTo(Math.max(0.1, build.projectileLifetimeSeconds), 2);
  build.spreadRadians = Math.max(0, build.spreadRadians);
  build.recoilImpulse = roundTo(Math.max(0, build.recoilImpulse), 2);
  build.knockbackImpulse = roundTo(Math.max(0, build.knockbackImpulse), 2);
  build.maxHealthAdd = Math.max(0, Math.round(build.maxHealthAdd));
  build.moveSpeedMultiplier = roundTo(Math.max(0.45, Math.min(1.55, build.moveSpeedMultiplier)), 2);
  build.parryCoverMultiplier = roundTo(Math.max(0.45, build.parryCoverMultiplier), 2);
  build.parryCooldownMultiplier = roundTo(Math.max(0.28, build.parryCooldownMultiplier), 2);
  // Data-hygiene floor only — the GAMEPLAY-SAFE floor (cooldown can never
  // shrink below burst+recovery, so stacking can't erode the punish window)
  // is enforced where the ms math actually lives: player.ts / player.zig.
  build.dashCooldownMultiplier = roundTo(Math.max(0.5, build.dashCooldownMultiplier), 2);
  build.projectile.count = Math.max(1, Math.min(8, Math.round(build.projectile.count)));
  build.projectile.rangePx = Math.max(48, build.projectile.rangePx);
  build.projectile.sizeMultiplier = Math.max(0.35, Math.min(2.4, build.projectile.sizeMultiplier));
  build.projectile.speedMultiplier = Math.max(0.15, Math.min(4.5, build.projectile.speedMultiplier));
  build.projectile.lifetimeMultiplier = Math.max(0.1, build.projectile.lifetimeMultiplier);
  build.projectile.bounces = Math.max(0, Math.min(12, Math.round(build.projectile.bounces)));
  build.projectile.homingStrength = roundTo(Math.max(0, Math.min(2.5, build.projectile.homingStrength)), 2);
  build.projectile.impactRadiusPx = Math.max(0, Math.min(160, build.projectile.impactRadiusPx));
  build.projectile.pierceCount = Math.max(0, Math.min(6, Math.round(build.projectile.pierceCount)));
  build.projectile.splitCount = Math.max(0, Math.min(6, Math.round(build.projectile.splitCount)));
  build.projectile.slowMultiplier = Math.max(0.1, Math.min(1, build.projectile.slowMultiplier));
  build.jumpMultiplier = roundTo(Math.max(0.7, Math.min(1.6, build.jumpMultiplier)), 2);
  build.wallJumpMultiplier = roundTo(Math.max(0.7, Math.min(1.6, build.wallJumpMultiplier)), 2);
  build.wallSlideMultiplier = roundTo(Math.max(0.25, Math.min(1.4, build.wallSlideMultiplier)), 2);
  build.airJumps = Math.max(0, Math.min(4, Math.round(build.airJumps)));
  build.dashCharges = Math.max(0, Math.min(4, Math.round(build.dashCharges)));
  build.shieldChargeMultiplier = roundTo(Math.max(0.5, Math.min(3.0, build.shieldChargeMultiplier)), 2);
  build.shieldRechargeMultiplier = roundTo(Math.max(0.5, Math.min(3.0, build.shieldRechargeMultiplier)), 2);
  build.gravityMultiplier = roundTo(Math.max(0.45, Math.min(1.8, build.gravityMultiplier)), 2);

  // Effective DPS with multi-pellet efficiency <1 (not all pellets hit).
  // Slight margin under the public floor so rounding cannot re-breach ~1.55s.
  const floorTarget = TTK_FLOOR_S + 0.03;
  const pelletEff = 0.62 + 0.38 / Math.max(1, build.projectile.count);
  let dps = build.damage * build.fireRate * build.projectile.count * pelletEff;
  const maxDps = PLAYER_BASE_HP / floorTarget;
  const minDps = PLAYER_BASE_HP / TTK_CEILING_S;
  if (dps > maxDps && dps > 0) {
    const s = Math.sqrt(maxDps / dps);
    build.damage = roundTo(build.damage * s, 2);
    build.fireRate = roundTo(Math.max(0.35, build.fireRate * s), 2);
  } else if (dps < minDps && dps > 0 && build.projectile.count <= 2) {
    // Only boost sparse single-shot builds that fell under the ceiling
    // (shotguns already trade range/spread for volume).
    const s = Math.sqrt(minDps / dps);
    build.damage = roundTo(build.damage * Math.min(1.35, s), 2);
  }
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
