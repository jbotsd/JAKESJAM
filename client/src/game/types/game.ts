// Card / weapon definition types now live in client/src/sim/data/cardTypes.ts
// (so server authority + client prediction share one source of truth). They
// are re-exported here to keep existing client imports stable.
import type {
  CardId as SimCardId,
  WeaponId as SimWeaponId,
} from "../../sim/data/cardTypes";

export type {
  CardDefinition,
  CardId,
  CardVisualDefinition,
  ImpactBehavior,
  ProjectileModifier,
  ResolvedWeaponBuild,
  WeaponBucket,
  WeaponCardModifier,
  WeaponDefinition,
  WeaponDelivery,
  WeaponId,
} from "../../sim/data/cardTypes";
export type {
  ElementType,
  ProjectilePathing,
  ProjectileShape,
} from "../../sim";

export type Vec2 = {
  x: number;
  y: number;
};

import type { Id } from "../../../../convex/_generated/dataModel";

export type PlayerId = string;
export type RoomId = Id<"rooms">;
export type MatchId = Id<"matches">;
export type CharacterId = "balanced" | "heavy" | "sprinter" | "shielded";
// Re-exported from the sim canonical source so adding/removing a chaos modifier
// is a one-line change in one file. See client/src/sim/data/chaosModifiers.ts.
export type { ChaosModifierId } from "../../sim/data/chaosModifiers";

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
  weaponId: SimWeaponId;
  cards: SimCardId[];
  alive: boolean;
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

export type DestructibleKind = "barrel" | "box" | "mine" | "cube";
export type PickupKind =
  | "health-shard"
  | "shield-cell"
  | "overcharge-core"
  | "card-cache"
  | "damage-amp"
  | "speed-boost"
  | "melee-mode"
  | "slow-trap"
  | "vulnerability-trap"
  | "block-jammer"
  | "boss-core";

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
