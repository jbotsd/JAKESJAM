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
  | "utility";

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
  category: "weapon" | "projectile" | "movement" | "defense" | "utility" | "tradeoff";
  rarity: "common" | "uncommon" | "rare" | "legendary" | "cursed";
  description: string;
  flavorText?: string;
  buckets?: WeaponBucket[];
  essenceCost?: number;
  modifier?: WeaponCardModifier;
  
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
  cards: CardDefinition[];
  occupiedBuckets: WeaponBucket[];
};
