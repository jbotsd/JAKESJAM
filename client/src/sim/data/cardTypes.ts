// Card / weapon definition types. Pure data, runtime-agnostic. Imported by
// both client (UI + offline match) and server (authoritative weapon stats).
//
// These types were originally in client/src/game/types/game.ts. They live in
// sim/ now so that both prediction (client) and authority (server) resolve
// the exact same weapon build from a player's card hand.

import type {
  ElementType,
  ProjectilePathing,
  ProjectileShape,
} from "../types.js";

export type CardId = string;
export type WeaponId = string;

export type WeaponDelivery = "projectile" | "raycast" | "continuous-beam" | "area-pulse";

export type ImpactBehavior =
  | "none"
  | "explosive"
  | "sticky"
  | "pierce-chain"
  | "slow-field";

export type WeaponBucket =
  | "delivery"
  | "shape"
  | "trajectory"
  | "quantity"
  | "impact"
  | "element"
  | "utility"
  | "ability";

export type ProjectileModifier = {
  shape: ProjectileShape;
  count: number;
  rangePx: number;
  speedMultiplier: number;
  sizeMultiplier: number;
  recoilMultiplier: number;
  pathing: ProjectilePathing;
  element: ElementType;
  impact: ImpactBehavior;
  lifetimeMultiplier: number;
  gravityScale: number;
  homingStrength: number;
  accelerationMultiplier: number;
  bounces: number;
  impactRadiusPx: number;
  pierceCount: number;
  splitCount: number;
  slowMultiplier: number;
};

export type WeaponDefinition = {
  id: WeaponId;
  name: string;
  weaponClass: "baseline" | "beam" | "pulse" | "satellite";
  delivery: WeaponDelivery;
  damage: number;
  fireRate: number;
  magazineSize: number;
  reloadSeconds: number;
  projectileSpeed: number;
  projectileLifetimeSeconds: number;
  spreadRadians: number;
  recoilImpulse: number;
  knockbackImpulse: number;
  projectile: ProjectileModifier;
};

export type WeaponCardModifier = {
  delivery?: WeaponDelivery;
  projectile?: Partial<ProjectileModifier>;
  projectileCountAdd?: number;
  projectileBounceAdd?: number;
  projectileSplitAdd?: number;
  projectileHomingStrengthAdd?: number;
  spreadRadiansAdd?: number;
  damageMultiplier?: number;
  fireRateMultiplier?: number;
  projectileSpeedMultiplier?: number;
  reloadMultiplier?: number;
  magazineSizeAdd?: number;
  spreadRadians?: number;
  recoilMultiplier?: number;
  knockbackMultiplier?: number;
  ammoRegenPerSecond?: number;
  overchargeMultiplier?: number;
  orbitingSatellites?: number;
  mirrorShield?: boolean;
  maxHealthAdd?: number;
  moveSpeedMultiplier?: number;
  parryCoverMultiplier?: number;
  parryCooldownMultiplier?: number;
  // ── Movement augments (ride the existing speed/gravity step params) ──────
  /** <1 = floatier (glide), >1 = heavier/snappier fall. Multiplies gravity. */
  gravityMultiplier?: number;
  // ── Deep movement augments (cross the wasm boundary via PlayerStep) ──────
  /** Scales the ground/coyote jump launch velocity. */
  jumpMultiplier?: number;
  /** Scales the wall-jump launch velocity. */
  wallJumpMultiplier?: number;
  /** Scales the wall-slide cap (<1 = grippier/slower slide, >1 = looser). */
  wallSlideMultiplier?: number;
  /** Extra mid-air jumps granted (1 = double jump, 2 = triple, …). Additive. */
  airJumpsAdd?: number;
  /** Dash charges granted: enables the Dash input and this many AIR dashes
   *  before landing (ground dash is always available on cooldown). Additive. */
  dashChargesAdd?: number;
  /** Scales the dash-bash slide's cooldown (<1 = sooner). Floor-clamped in
   *  weaponBuild.ts and stepPlayer so the recovery-endlag window can never be
   *  squeezed out by stacking — Quick Parry (repurposed from the now-dead
   *  timed-parry cooldown onto this). */
  dashCooldownMultiplier?: number;
  // ── Shield augments ──────────────────────────────────────────────────────
  /** Scales the shield's max charge (bigger bar = longer block). */
  shieldChargeMultiplier?: number;
  /** Scales how fast the shield recharges when not held. */
  shieldRechargeMultiplier?: number;
  /** Aim shield: the held shield only blocks hits arriving within the AIM arc
   *  (must face the threat) — in exchange for a stronger benefit on the card. */
  directionalShield?: boolean;
  /** Stolen Fangs: absorbing ANY shielded hit banks a lock charge (cap 2,
   *  expires after a few seconds unspent). The next fired shot(s) consume a
   *  charge and become homing at reduced damage. See sim/World.ts and
   *  sim/weapon.ts for the grant/consume logic. */
  stolenFangs?: boolean;
};

// ── Drafted actives (six-axes-goal.md Layer 2) ─────────────────────────────
// Ability cards ARE actives: drafted through the same round-end picker,
// they land on the action bar in pick order (keys 1-4), cooldown-gated.
// `kind` is a closed union — deriveAxisProfile maps kind → axis (doctrine
// #1: one derivation, no hand-authored axis tags).

/** Hard slot cap: four keys, five axes — the draft chooses identity under
 *  scarcity. Enforced at offer-roll time (round.ts), never by silently
 *  failing a pick. */
export const MAX_ABILITY_SLOTS = 4;

export type AbilityKind =
  | "crimson-tithe"
  | "shelter-seal"
  | "shadow-step"
  | "veil-of-nought"
  | "severing-answer";

export type AbilityActiveSpec = {
  kind: AbilityKind;
  cooldownMs: number;
  /** Effect window; omitted = instant. */
  durationMs?: number;
};

/** One action-bar slot, resolved from the hand in pick order. */
export type ResolvedActive = {
  cardId: CardId;
  kind: AbilityKind;
  cooldownMs: number;
  durationMs: number;
};

// Visual hints used by UI overlays. Pure data, no Phaser refs — shapes /
// colors are interpreted by the renderer.
export type CardVisualDefinition = {
  iconShape: ProjectileShape;
  glowColor: string;
  particleColor: string;
};

export type StatModifier = {
  stat: string;
  value: number;
  multiplier?: boolean;
};

export type CardDefinition = {
  id: CardId;
  name: string;
  category: "weapon" | "projectile" | "movement" | "defense" | "utility" | "tradeoff" | "ability";
  rarity: "common" | "uncommon" | "rare" | "legendary" | "cursed";
  description: string;
  flavorText?: string;
  buckets?: WeaponBucket[];
  essenceCost?: number;
  modifier?: WeaponCardModifier;
  /** Drafted active (six-axes Layer 2). A card may carry both a modifier
   *  AND an active — every ability card also deepens its axis in the
   *  Emission (goal doctrine #7: no active-only cards in spirit; the axis
   *  coupling rides deriveAxisProfile off `active.kind`). */
  active?: AbilityActiveSpec;
  
  // ROUNDS-style: Explicit benefits and penalties for tradeoffs
  benefits?: StatModifier[];
  penalties?: StatModifier[];
  
  visual?: CardVisualDefinition;
  unique?: boolean;
  maxStacks?: number;
};

export type ResolvedWeaponBuild = {
  id: WeaponId;
  name: string;
  delivery: WeaponDelivery;
  damage: number;
  fireRate: number;
  magazineSize: number;
  reloadSeconds: number;
  projectileSpeed: number;
  projectileLifetimeSeconds: number;
  spreadRadians: number;
  recoilImpulse: number;
  knockbackImpulse: number;
  projectile: ProjectileModifier;
  ammoRegenPerSecond: number;
  overchargeMultiplier: number;
  orbitingSatellites: number;
  mirrorShield: boolean;
  maxHealthAdd: number;
  moveSpeedMultiplier: number;
  parryCoverMultiplier: number;
  parryCooldownMultiplier: number;
  gravityMultiplier: number;
  shieldChargeMultiplier: number;
  shieldRechargeMultiplier: number;
  directionalShield: boolean;
  stolenFangs: boolean;
  jumpMultiplier: number;
  wallJumpMultiplier: number;
  wallSlideMultiplier: number;
  airJumps: number;
  dashCharges: number;
  dashCooldownMultiplier: number;
  cards: CardDefinition[];
  occupiedBuckets: WeaponBucket[];
  /** Drafted actives in pick order — action-bar slots 1..N (≤
   *  MAX_ABILITY_SLOTS; the offer roll stops offering ability cards when
   *  the hand holds four). */
  actives: ResolvedActive[];
};
