// Emission resolver — the cast payload, composed from the card hand
// (docs/emission-engine-goal.md). Pure data transform over an already-
// resolved weapon build: the gun is the sentence, the Emission is the same
// sentence shouted. Lives in sim/data beside weaponBuild.ts so server
// authority and client prediction resolve the identical cast from the same
// hand — same discipline as createWeaponBuild (no Phaser, no DOM, compiles
// under Bun).
//
// v1 doctrine (goal doc, locked): ONE emergent cast shape — a radial burst
// of the player's own resolved projectile, amplified, under a hard damage
// budget. Element/impact/status identity carries through the EXISTING hit
// path, so a fire hand casts a burn nova and a bounce hand casts a shrapnel
// cage without one line of per-element sim code. Per-element bespoke shapes
// are FORBIDDEN unless a live playtest demands them in writing.
//
// The Six Axes (Drain/Ward/Stride/Sorcery/Mystery/Technique): membership is
// derived from the resolved build's modifier fields by deriveAxisProfile —
// the ONLY place axis membership is computed (docs/six-axes-goal.md,
// doctrine #1). Axis sections resolve LIVE from the profile (Layer 1); a
// hand with no axis fields gets the inert defaults, so a pure-Sorcery cast
// is exactly the v1 cast (doctrine #3: empty axis = silent, never
// penalized). The sim consumes these sections in World.ts (Phase 1).

import type { AbilityKind, ResolvedWeaponBuild } from "./cardTypes.js";
import type { ElementType, ProjectilePathing, ProjectileShape } from "../types.js";
import type { ImpactBehavior } from "./cardTypes.js";

/** Total damage a full cast can deliver to ONE target if every shard
 *  lands — deliberately below PLAYER_BASE_HP (100): the Emission is a
 *  finisher / zone claim / status bomb, never a full-health delete
 *  (goal-doc doctrine #7). */
export const EMISSION_DAMAGE_BUDGET = 70;
/** Volley geometry bounds — enough shards to read as a NOVA at minimum,
 *  capped so multi-shot hands don't turn the cast into a lag bomb. */
export const EMISSION_VOLLEY_MIN = 6;
export const EMISSION_VOLLEY_MAX = 16;
/** Status amplification at cast: durations double, hard-capped. */
export const EMISSION_STATUS_SCALE = 2;
export const EMISSION_BURN_CAP_MS = 3000;
export const EMISSION_FREEZE_CAP_MS = 2000;
export const EMISSION_SLOW_CAP_MS = 2500;
/** Impact radius amplification (× build, floored) — the cast's hits land
 *  BIG, even on a hand with no impact card. */
export const EMISSION_IMPACT_RADIUS_MULT = 1.6;
export const EMISSION_IMPACT_RADIUS_MIN_PX = 48;
/** Cast shard flight: slightly slower than gunfire (a wave, not a snipe),
 *  short-lived — the Emission claims the space around the vessel, it does
 *  not snipe across the arena. */
export const EMISSION_SPEED_MULT = 0.85;
export const EMISSION_RANGE_PX = 520;
export const EMISSION_LIFETIME_MS = 900;
/** Axis working numbers (six-axes-goal.md starter table — the tune pass
 *  edits these, never the logic). Applied only when the axis is charged. */
export const EMISSION_DRAIN_LEECH_FRACTION = 0.35;
export const EMISSION_WARD_FIELD_MS = 700;
/** Damage taken × this while the post-cast ward shell is live (Phase 1). */
export const EMISSION_WARD_DAMAGE_MULT = 0.5;
export const EMISSION_EXECUTE_BELOW_FRAC = 0.15;
/** E-coupling (six-axes doctrine #7): holding an axis's ABILITY CARD
 *  deepens that axis's section beyond the passive-membership value —
 *  every ability card is also a cast upgrade. */
export const EMISSION_DRAIN_LEECH_FRACTION_DEEP = 0.6; // Crimson Tithe held
export const EMISSION_WARD_FIELD_MS_DEEP = 1200; // Shelter Seal held
export const EMISSION_WARD_STORED_RETURN_FRACTION = 0.25; // Shelter Seal held
export const EMISSION_EXECUTE_BELOW_FRAC_DEEP = 0.22; // Severing Answer held
/** Stride/Mystery couplings are cast-branch effects (World.ts): Shadow
 *  Step held → the cast grants a brief speed surge; Veil held → a short
 *  self-veil on release. */
export const EMISSION_STRIDE_SURGE_MS = 1200;
export const EMISSION_SELF_VEIL_MS = 600;

/** The six-axis readout of a hand (six-axes-goal.md). Sorcery is every
 *  gun's birthright — always true; the other five are earned by carrying
 *  the marking modifier fields. One field never feeds two axes (anti-
 *  pattern 4): homingStrength stays Sorcery's carry, pierce marks
 *  Technique, void marks Mystery — a card CAN light two axes, but only
 *  through two different fields (void-fracture: void + pierce). */
export type AxisProfile = {
  drain: boolean;
  ward: boolean;
  stride: boolean;
  sorcery: true;
  mystery: boolean;
  technique: boolean;
};

const profileCache = new WeakMap<ResolvedWeaponBuild, AxisProfile>();

/** Ability cards charge their axis through `active.kind` (six-axes Layer 2,
 *  doctrine #7: every ability card also deepens its axis in the caster's
 *  Emission). Partial, not exhaustive: the Geometrician catalog v1
 *  (docs/class-ability-catalogs-v1.md, `classId: "wizard"` ability cards —
 *  sunlance/facet-break/prism-fan/lattice/return-glass/hard-aperture/
 *  overclock/measure/slip-node/recoil-step) is a DIFFERENT layer per
 *  docs/classes-goal.md's catalog-vs-cards distinction — catalog buttons,
 *  not six-axes spec cards — and deliberately light no axis here. Still
 *  ONE derivation (doctrine #1): every kind not listed reads as "no axis
 *  coupling", never a silent default to one. */
const ACTIVE_KIND_AXIS: Partial<
  Record<AbilityKind, "drain" | "ward" | "stride" | "mystery" | "technique">
> = {
  "crimson-tithe": "drain",
  "shelter-seal": "ward",
  "shadow-step": "stride",
  "veil-of-nought": "mystery",
  "severing-answer": "technique",
};

/** THE axis-membership derivation — the only place in the codebase allowed
 *  to answer "which axes does this hand hold" (doctrine #1).
 *
 *  Drain/Ward/Stride scan the HAND's card modifiers rather than the
 *  resolved scalars, because `resolvePlayerBuild` grants birthright/innate
 *  kit that must never light an axis: the ground dash floors `dashCharges`
 *  at 1 for EVERYONE (weapon.ts), and the Shielded character carries
 *  `directionalShield` innately. Axes are earned by PICKS (acceptance A1 —
 *  "a non-Sorcery pick changes the cast"); character kit stays the parent
 *  doc's deferred cast-frame lean. Mystery/Technique read resolved
 *  projectile fields — element rank-merge and pierce max-merge both have
 *  clean zero baselines on every resolution path. Penalty riders (e.g.
 *  crystal-plating's 0.98 move speed) stay silent via the strict >1 / >0
 *  comparisons. */
export function deriveAxisProfile(build: ResolvedWeaponBuild): AxisProfile {
  const cached = profileCache.get(build);
  if (cached) return cached;
  let drain = false;
  let ward = false;
  let stride = false;
  let mysteryFromActive = false;
  let techniqueFromActive = false;
  for (const card of build.cards) {
    if (card.active) {
      const axis = ACTIVE_KIND_AXIS[card.active.kind];
      if (axis === "drain") drain = true;
      else if (axis === "ward") ward = true;
      else if (axis === "stride") stride = true;
      else if (axis === "mystery") mysteryFromActive = true;
      else if (axis === "technique") techniqueFromActive = true;
    }
    const m = card.modifier;
    if (!m) continue;
    if (m.stolenFangs) drain = true;
    if (
      m.mirrorShield ||
      m.directionalShield ||
      (m.shieldChargeMultiplier ?? 1) > 1 ||
      (m.shieldRechargeMultiplier ?? 1) > 1
    ) {
      ward = true;
    }
    if (
      (m.dashChargesAdd ?? 0) > 0 ||
      (m.airJumpsAdd ?? 0) > 0 ||
      (m.moveSpeedMultiplier ?? 1) > 1 ||
      (m.jumpMultiplier ?? 1) > 1
    ) {
      stride = true;
    }
  }
  const profile: AxisProfile = {
    drain,
    ward,
    stride,
    sorcery: true,
    mystery: mysteryFromActive || build.projectile.element === "void",
    technique: techniqueFromActive || build.projectile.pierceCount > 0,
  };
  profileCache.set(build, profile);
  return profile;
}

export type EmissionConfig = {
  // ── Sorcery axis (v1 core — all live) ──────────────────────────────────
  volleyCount: number;
  damagePerShard: number;
  speed: number;
  lifetimeMs: number;
  rangePx: number;
  radiusPx: number;
  shape: ProjectileShape;
  pathing: ProjectilePathing;
  element: ElementType;
  impact: ImpactBehavior;
  impactRadiusPx: number;
  /** Carried straight from the hand — a bounce hand casts a caroming CAGE,
   *  a seeker hand casts a homing storm. The identity multiplier of the
   *  whole feature. */
  bounces: number;
  homingStrength: number;
  /** Multiplier applied to element status durations at the hit site. */
  statusScale: number;
  // ── Axis sections (LIVE, resolved from deriveAxisProfile; inert defaults
  //    for uncharged axes — six-axes-goal.md Layer 1). Fields still at their
  //    inert value on every hand (storedReturnFraction, castAtDashEnd,
  //    markMs, counterWindowMs) are reserved for the ability cards /
  //    character cast frames (Layer 2+). ──────────────────────────────────
  drain: { leechFraction: number };
  ward: { storedReturnFraction: number; fieldMs: number };
  stride: { castAtDashEnd: boolean; dashReset: boolean };
  mystery: { denyAscension: boolean; wrapShots: boolean; markMs: number };
  technique: { executeBelowFrac: number; counterWindowMs: number };
};

/** Identity cache keyed the same way weapon.ts caches builds: the resolved
 *  build object is itself cached per cards-array identity, so caching the
 *  emission per BUILD identity gives the same invalidation for free (a
 *  draft pick creates a new array → new build → new emission). */
const emissionCache = new WeakMap<ResolvedWeaponBuild, EmissionConfig>();

export function resolveEmission(build: ResolvedWeaponBuild): EmissionConfig {
  const cached = emissionCache.get(build);
  if (cached) return cached;

  const axes = deriveAxisProfile(build);
  // E-coupling depth: which ability cards the hand holds (doctrine #7 —
  // an ability card deepens its axis's cast expression beyond membership).
  const heldKinds = new Set(build.actives.map((a) => a.kind));

  // Volley: the hand's multi-shot identity, shouted. count×4 inside hard
  // geometry bounds — a single-shot hand still novas (6), a stacked
  // shotgun hand caps at 16.
  const volleyCount = Math.max(
    EMISSION_VOLLEY_MIN,
    Math.min(EMISSION_VOLLEY_MAX, Math.round(build.projectile.count * 4)),
  );

  // Damage: budgeted so a full volley landing on one target stays at
  // EMISSION_DAMAGE_BUDGET regardless of how many shards the hand earned —
  // volume buys COVERAGE (more of the arena claimed), never more single-
  // target damage. Same pellet philosophy as clampBuild's efficiency
  // model, taken to its clean limit. Two decimals like clampBuild.
  const damagePerShard =
    Math.round((EMISSION_DAMAGE_BUDGET / volleyCount) * 100) / 100;

  // Flight: the build's shot, as a wave. Speed carries the hand's speed
  // identity (× the cast damping); range/lifetime are the cast's own —
  // a zone claim around the vessel, not a cross-arena snipe.
  const speed =
    build.projectileSpeed * build.projectile.speedMultiplier * EMISSION_SPEED_MULT;

  const config: EmissionConfig = {
    volleyCount,
    damagePerShard,
    speed,
    lifetimeMs: EMISSION_LIFETIME_MS,
    rangePx: EMISSION_RANGE_PX,
    radiusPx: Math.max(2, 7 * build.projectile.sizeMultiplier),
    shape: build.projectile.shape,
    pathing: build.projectile.pathing,
    element: build.projectile.element,
    impact: build.projectile.impact,
    impactRadiusPx: Math.max(
      EMISSION_IMPACT_RADIUS_MIN_PX,
      build.projectile.impactRadiusPx * EMISSION_IMPACT_RADIUS_MULT,
    ),
    bounces: build.projectile.bounces,
    homingStrength: build.projectile.homingStrength,
    statusScale: EMISSION_STATUS_SCALE,
    // Axis sections — LIVE from the profile (six-axes-goal.md Layer 1).
    // Uncharged axes resolve to the inert defaults, so a pure-Sorcery
    // hand's config is exactly the v1 config (doctrine #3).
    drain: {
      leechFraction: axes.drain
        ? heldKinds.has("crimson-tithe")
          ? EMISSION_DRAIN_LEECH_FRACTION_DEEP
          : EMISSION_DRAIN_LEECH_FRACTION
        : 0,
    },
    ward: {
      // storedReturnFraction stays reserved until the damage-banking
      // mechanic exists (placed-ward upgrade) — a config value nothing
      // consumes would be a lie, not a feature.
      storedReturnFraction: 0,
      fieldMs: axes.ward
        ? heldKinds.has("shelter-seal")
          ? EMISSION_WARD_FIELD_MS_DEEP
          : EMISSION_WARD_FIELD_MS
        : 0,
    },
    stride: {
      castAtDashEnd: false, // reserved: character cast frames (parent doc)
      dashReset: axes.stride,
    },
    mystery: {
      denyAscension: axes.mystery,
      wrapShots: axes.mystery,
      markMs: heldKinds.has("veil-of-nought") ? EMISSION_SELF_VEIL_MS : 0,
    },
    technique: {
      executeBelowFrac: axes.technique
        ? heldKinds.has("severing-answer")
          ? EMISSION_EXECUTE_BELOW_FRAC_DEEP
          : EMISSION_EXECUTE_BELOW_FRAC
        : 0,
      counterWindowMs: 0, // reserved: Severing Answer's ACTIVE (not the cast)
    },
  };

  emissionCache.set(build, config);
  return config;
}
