export type Vec2 = {
  x: number;
  y: number;
};

export type PlayerId = string;
export type RoomId = string;
export type MatchId = string;
export type CardId = string;
export type WeaponId = string;
export type CharacterId = "balanced" | "heavy" | "sprinter" | "shielded";
export type ChaosModifierId =
  | "low-gravity"
  | "slow-motion"
  | "golden-gun"
  | "slappers-only"
  | "fire-hazard"
  | "random-shapes"
  | "max-recoil";

export type ProjectileShape = "circle" | "triangle" | "square" | "hexagon" | "orb";
export type WeaponDelivery = "projectile" | "raycast" | "continuous-beam" | "area-pulse";
export type ProjectilePathing =
  | "straight"
  | "gravity"
  | "bounce"
  | "boomerang"
  | "homing"
  | "anti-homing"
  | "float"
  | "accelerate";
export type ElementType =
  | "crystal"
  | "neutral"
  | "fire"
  | "ice"
  | "lightning"
  | "void"
  | "radiant"
  | "electric"
  | "toxic"
  | "sticky"
  | "explosive";
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

export type AbilityType = "shield" | "blink" | "brace" | "deflect";

export type PlayerState = {
  id: PlayerId;
  name: string;
  color: string;
  characterId: CharacterId;
  position: Vec2;
  velocity: Vec2;
  aimAngle: number;
  health: number;
  maxHealth: number;
  sizeScale: number;
  abilityCharge: number;
  weaponId: WeaponId;
  cards: CardId[];
  alive: boolean;
};

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
};

export type CardVisualDefinition = {
  iconShape: ProjectileShape;
  glowColor: string;
  particleColor: string;
};

export type CharacterDefinition = {
  id: CharacterId;
  name: string;
  maxHealth: number;
  moveSpeedMultiplier: number;
  sizeScale: number;
  recoilControlMultiplier: number;
  abilityType: AbilityType;
  weakness: string;
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
  visual?: CardVisualDefinition;
  unique?: boolean;
  maxStacks?: number;
};

export type DestructibleKind = "barrel" | "box" | "mine" | "cube";
export type PickupKind = "health-shard" | "shield-cell" | "overcharge-core" | "card-cache";

export type DestructibleDefinition = {
  id: string;
  kind: DestructibleKind;
  health: number;
  position: Vec2;
  size: Vec2;
  explosive: boolean;
  flammable: boolean;
};

export type PickupDefinition = {
  id: string;
  kind: PickupKind;
  position: Vec2;
  radius: number;
  amount: number;
  respawnMs: number;
  durationMs?: number;
};

export type PlatformDefinition = {
  id: string;
  position: Vec2;
  size: Vec2;
  kind: "floor" | "wall" | "platform";
};

export type MapDefinition = {
  id: string;
  name: string;
  size: Vec2;
  spawns: Vec2[];
  platforms: PlatformDefinition[];
  destructibles: DestructibleDefinition[];
  pickups: PickupDefinition[];
};

export type PlayerInputFrame = {
  sequence: number;
  playerId: PlayerId;
  movement: {
    left: boolean;
    right: boolean;
    jump: boolean;
    down: boolean;
  };
  aimAngle: number;
  fire: boolean;
  ability: boolean;
  clientTime: number;
};

export type AuthoritativePlayerSnapshot = {
  playerId: PlayerId;
  position: Vec2;
  velocity: Vec2;
  health: number;
  lastProcessedInputSequence: number;
  serverTime: number;
};
