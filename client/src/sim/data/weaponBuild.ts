// Pure card -> weapon-build resolver. Composes a base WeaponDefinition with a
// hand of CardDefinitions into a ResolvedWeaponBuild. Behavior matches the
// original client/src/game/systems/WeaponSystem.ts implementation byte for
// byte; lives in sim/ so server authority + client prediction agree.

import type {
  CardDefinition,
  ClassId,
  ProjectileModifier,
  ResolvedWeaponBuild,
  WeaponBucket,
  WeaponCardModifier,
  WeaponDefinition,
  WeaponDelivery,
} from "./cardTypes.js";
import { MAX_ABILITY_SLOTS } from "./cardTypes.js";

/**
 * The class-expression hook (docs/classes-goal.md C3, card-pool-v2.md).
 * Returns the modifier a card resolves to FOR THIS CLASS: the class's
 * override when the card has authored one, else the class-blind base
 * `modifier` — the fallback is total and silent-by-design, never a
 * placeholder and never another class's reading (task requirement: a
 * Ninja must never end up with a Wizard-flavored effect). Omitting
 * `classId` entirely reproduces today's class-blind resolution exactly —
 * every existing call site (Zig parity tests, bots, tutorial) that never
 * passes a class continues to resolve `modifier` unchanged.
 */
export function effectiveCardModifier(
  card: CardDefinition,
  classId?: ClassId,
): WeaponCardModifier | undefined {
  if (classId) {
    const override = card.classModifiers?.[classId];
    if (override) return override;
  }
  return card.modifier;
}

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
  /** Resolving player's class (docs/classes-goal.md dev-id vocabulary).
   *  Omitted = class-blind resolution, byte-identical to pre-class-era
   *  behavior (every card uses its base `modifier`). */
  classId?: ClassId,
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
    leechFraction: 0,
    cards: [],
    occupiedBuckets: [],
    actives: [],
  };

  const bucketOwners = new Set<WeaponBucket>();
  /** How many times each card id has already been applied (maxStacks / unique). */
  const appliedCounts = new Map<string, number>();

  for (const card of cards) {
    const modifier = effectiveCardModifier(card, classId);
    // A card must DO something to enter the hand: a gun modifier, an
    // active, or both (ability cards may carry either combination).
    if (!modifier && !card.active) {
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

    if (modifier) applyCard(build, card, classId, baseWeapon.delivery);
    // Drafted actives fill slots in pick order (six-axes Layer 2). The
    // offer roll stops offering ability cards at MAX_ABILITY_SLOTS, so the
    // length guard here is belt-and-braces, never the enforcement site.
    if (card.active && build.actives.length < MAX_ABILITY_SLOTS) {
      build.actives.push({
        cardId: card.id,
        kind: card.active.kind,
        cooldownMs: card.active.cooldownMs,
        durationMs: card.active.durationMs ?? 0,
        role: card.role,
      });
    }
    build.cards.push(card);
  }

  build.occupiedBuckets = [...bucketOwners];
  // ── THE GEOMETRICIAN RULING (Jake, 2026-07-24 — supersedes 2026-07-22) ──
  // Geometrician (classId "wizard") is ALWAYS raycast/hitscan delivery.
  // Never projectile. Nothing may flip it — no card, no fallback.
  //
  // History (see weapons.ts's ruling comment for the base-weapon half):
  // Jake's 2026-07-22 live-playtest message ("ton of abilities change the
  // hitscan to a projectile — change that") meant the Category-A travel-time
  // fallback — cards whose `delivery: "projectile"` modifier flipped his
  // hitscan into a traveling shot (weaponBuild.test.ts's "travel-time-only
  // cards fall back to delivery: projectile" suite named the pattern) — was
  // the bug. It was misread as "make the base gun a projectile" and
  // weapons.ts grew a `wizardStarterWeapon` with delivery "projectile"
  // (commit dbec211's weapons half). On 2026-07-24 he clarified; the misread
  // is reverted and this line kills the flip mechanism itself, centrally,
  // for every card path at once (top-level modifiers AND classModifiers —
  // seeker-facets' wizard variant carries its own delivery flip, so a
  // per-card fix would always be one authored card away from regressing).
  //
  // JUDGMENT CALL (pinned in geometricianAlwaysRaycast.test.ts):
  // continuous-beam stays legal for wizard — a beam is instant-feel
  // pressure, not a dodgeable traveling projectile; only the travel-time
  // paths die. Everything else ("projectile", and "area-pulse" — a slow
  // traveling pulse, unreachable from the current pool but travel-time by
  // construction — see applyDeliveryFeel) is forced back to "raycast".
  //
  // Placement matters: BEFORE applyDeliveryFeel/clampBuild, so the raycast
  // feel floors (speedMultiplier >= 3.2, rangePx >= 880, thin-beam size
  // floor) apply to the final delivery. Travel-time card MODIFIERS stay
  // applied — the card loop above already folded homing/bounce/gravity/
  // accelerate fields into the build, and they ride it for every consumer
  // that spawns REAL projectiles regardless of the basic gun's delivery:
  // split children at the ray terminal (World.ts's hitscan split), orbiting
  // satellites, and the Emission volley (resolveEmission carries pathing/
  // bounces/homingStrength straight from build.projectile) — so travel-time
  // cards are not dead picks for wizard.
  if (classId === "wizard" && build.delivery !== "continuous-beam") {
    build.delivery = "raycast";
  }
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

export function applyCard(
  build: ResolvedWeaponBuild,
  card: CardDefinition,
  classId?: ClassId,
  /** The base weapon's OWN delivery, before any card touched it this
   *  resolution (`createWeaponBuild` passes `baseWeapon.delivery`; direct
   *  callers that omit it get the pre-hitscan default, `"projectile"`,
   *  unchanged). Needed to tell "still the untouched base default" apart
   *  from "an earlier card already upgraded this" — see the guard below. */
  baseDelivery: WeaponDelivery = "projectile",
) {
  const modifier = effectiveCardModifier(card, classId);
  if (!modifier) {
    return;
  }

  if (modifier.delivery) {
    // Delivery is a rare identity — only upgrade away from the BASE
    // weapon's own delivery. Never stomp an earlier CARD's raycast/beam
    // pick with a later "projectile" card. Cards whose whole mechanic needs
    // real travel time (Crystal Volley's "honest gunplay", Seeker Facets'
    // homing curve, Shard Bloom's split) explicitly carry `delivery:
    // "projectile"` to pull back to a traveling shot, and that must win
    // against the untouched base default, exactly like any other delivery
    // upgrade would. `build.delivery === baseDelivery` means no card has
    // touched it yet this resolution, so this card's choice is free to
    // apply regardless of direction.
    //
    // NOTE — this merge is class-blind by design and STILL flips a raycast
    // base to "projectile" for Ninja (who shares starterWeapon's hitscan).
    // For Geometrician the flip is dead: createWeaponBuild forces a wizard
    // build's final delivery back to "raycast" after the card loop — see
    // THE GEOMETRICIAN RULING comment there (2026-07-24). Neutralizing it
    // here per-card would miss classModifiers-authored flips; the central
    // post-loop enforcement can't.
    if (build.delivery === baseDelivery || modifier.delivery !== "projectile") {
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
  // Tithe: max, not additive — a second lifesteal source shouldn't let the
  // fraction runaway past what any single card intends (same "cap, don't
  // stack unboundedly" posture as maxHealthAdd's clamp below).
  build.leechFraction = Math.max(build.leechFraction, modifier.leechFraction ?? 0);

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
    // Direct override, not multiply — same rationale as rangePx above, and
    // NOT just a style nit: the base weapon's neutral value for this field
    // is 0 (weapons.ts; projectile.ts reads `factor = 1 + k*dtSec`, so k=0
    // means "no acceleration"), but multiplying against a base of 0 can
    // NEVER produce a nonzero result — every card that ever tried to set
    // this field would silently resolve to 0 no matter what value it
    // authored. That's why "accelerate" pathing (fully wired end-to-end:
    // projectile.ts's own case, the Zig `applyAcceleratePathing`/
    // `step_projectile_v2` dispatch, gen_card_data.ts's
    // `proj_acceleration_mul_set`) has never been usable by any card before
    // this pass (falling-star / i-rounds, below) — confirmed by the Zig side
    // itself, which already treats this as a SET (weapon_build.zig:
    // `if (m.proj_acceleration_mul_set) |v| p_accel_mul = v;`), never a
    // multiply. This fix makes TS match the Zig semantics that were already
    // shipped, not a new invention.
    accelerationMultiplier:
      modifier.accelerationMultiplier ?? current.accelerationMultiplier,
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
  // "accelerate" (speed-profile axis, falling-star/i-rounds): ranked
  // alongside bounce, a real trajectory-shaping identity that must survive
  // a later weak/default card, same protection every other exotic pathing
  // already gets — without this it would silently rank as 0 (tied with
  // "straight") and get stomped by literally any other pathing card drafted
  // afterward, or force-reset to "straight" by applyDeliveryFeel's raycast/
  // beam branch (which checks `PATHING_RANK[...] === 0`).
  accelerate: 1,
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
  // Hygiene floor/ceiling for the newly-live accelerate axis (falling-star/
  // i-rounds), matching every other field's exhaustive clamp here — Zig
  // applies no ceiling of its own (raw SET passthrough), so this is a TS-
  // only safety net against a future card authoring an absurd ramp; every
  // card this pass ships is comfortably inside it.
  build.projectile.accelerationMultiplier = roundTo(
    Math.max(-3, Math.min(3, build.projectile.accelerationMultiplier)),
    2,
  );
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
  // Same ceiling the six-axes Crimson Tithe ability window already uses
  // (ABILITY_TITHE_LEECH_FRACTION = 0.5, constants.ts) — a passive can never
  // out-leech the timed ability's own cap.
  build.leechFraction = roundTo(Math.max(0, Math.min(0.5, build.leechFraction)), 3);

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
