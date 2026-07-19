// Card / weapon definition types now live in client/src/sim/data/cardTypes.ts
// (so server authority + client prediction share one source of truth). They
// are re-exported here to keep existing client imports stable.
import type {
  CardId as SimCardId,
  ClassId,
  WeaponId as SimWeaponId,
} from "../../sim/data/cardTypes";

export type {
  CardDefinition,
  CardId,
  CardVisualDefinition,
  ClassId,
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

/**
 * Class-era display layer (docs/classes-goal.md, P1). The four archetypes
 * EVOLVE into class chassis — Balanced→wizard, Sprinter→ninja,
 * Heavy→paladin, Shielded→priest — but the sim-visible `CharacterId`s stay
 * the original archetype ids (wire/replay compat; see
 * net/playerCharacter.ts). `classId` is dev-id vocabulary (code/docs/sigil
 * lookup) — the LOCKED player-facing persona name (Geometrician/Interstice/
 * Kindled/Syzygist, docs/classes-goal.md § Naming) lives on
 * `CharacterDefinition.name`, never here.
 *
 * UPDATE 2026-07-17 (class-expression infra): `ClassId` is no longer
 * "zero sim meaning" — it's re-exported above from
 * `sim/data/cardTypes.ts`, the new canonical definition, because
 * `CardDefinition.classModifiers` and `createWeaponBuild`'s resolution now
 * key on it for real (see `classIdForArchetype` + `effectiveCardModifier`).
 * Single-sourced there so the display layer and the sim layer can never
 * drift onto two different unions.
 */

export type CharacterDefinition = {
  id: CharacterId;
  /** Player-facing display name — the LOCKED persona ("Geometrician",
   *  "Interstice", "Kindled", "Syzygist"; docs/classes-goal.md § Naming,
   *  2026-07-17), never the old archetype word and never the bare dev-id
   *  class word (that's `classId` below). */
  name: string;
  /** Display-layer class id (P1: labels/sigils only, zero sim meaning). */
  classId: ClassId;
  /**
   * One-line chassis summary for selection surfaces. Must describe what is
   * TRUE TODAY (stats — the proto-chassis), never future verbs: no "sword
   * and board" until the kit actually ships (classes-goal.md staging).
   */
  kitSummary: string;
  /** True until the class's full kit phase ships — selection surfaces show
   *  a quiet "full kit coming" note, nothing more (P1 honesty rule). */
  kitComing?: boolean;
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
