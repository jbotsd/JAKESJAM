// PLACEHOLDER — owned by Dev A (sim/gameplay stream).
// This file is the day-1 contract from docs/dev-stream-sim.md.
// Dev B (netcode) seeded this stub so client/src/net/ and server/ have types
// to compile against. Dev A owns this file going forward — finalize the shapes
// as the sim is extracted from MatchScene/systems. If you change a shape,
// ping Dev B before merging — protocol depends on these types.
//
// Contract section: docs/dev-stream-sim.md → "The Contract".

// ---------------- Identifiers ----------------

export type Tick = number;
export type EntityId = number;
export type PlayerId = string;
export type InputSeq = number;

// ---------------- Inputs ----------------

/**
 * Bitfield layout (LSB → MSB):
 *  0 left, 1 right, 2 up, 3 down, 4 jump,
 *  5 crouch, 6 fire, 7 ability, 8 shield,
 *  9..15 reserved.
 */
export type InputBitfield = number;

export type InputFrame = {
  seq: InputSeq;
  tick: Tick;
  keys: InputBitfield;
  aimX: number;
  aimY: number;
  dtMs: number;
};

// ---------------- World state ----------------

export type CharacterArchetype = 'balanced' | 'heavy' | 'sprinter' | 'shielded';

export type ProjectileShape = 'circle' | 'triangle' | 'square' | 'hexagon' | 'orb';

export type ProjectilePathing =
  | 'straight'
  | 'gravity'
  | 'bounce'
  | 'boomerang'
  | 'homing'
  | 'anti-homing'
  | 'float'
  | 'accelerate';

export type DestructibleKind = 'barrel' | 'box' | 'mine' | 'cube';

export type PickupKind = 'health-shard' | 'shield-cell' | 'overcharge-core';

export type RoundPhase = 'countdown' | 'fighting' | 'round-over';

export type PlayerEntity = {
  id: PlayerId;
  characterId: CharacterArchetype;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  health: number;
  shieldActive: boolean;
  crouching: boolean;
  alive: boolean;
  weaponId: string;
  cards: string[];
  fireCooldownMs: number;
  ammo: number;
  abilityCharge: number;
  lastProcessedInputSeq: InputSeq;
};

export type ProjectileEntity = {
  id: EntityId;
  ownerId: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  shape: ProjectileShape;
  radius: number;
  damage: number;
  lifetimeMs: number;
  pathing: ProjectilePathing;
  element: string;
  bouncesRemaining: number;
  pierceRemaining: number;
};

export type DestructibleEntity = {
  id: EntityId;
  kind: DestructibleKind;
  x: number;
  y: number;
  width: number;
  height: number;
  health: number;
  explosive: boolean;
  flammable: boolean;
};

export type FireEntity = {
  id: EntityId;
  x: number;
  y: number;
  radius: number;
  remainingMs: number;
  ownerId: PlayerId;
  damagePerSecond: number;
};

export type PickupEntity = {
  id: EntityId;
  kind: PickupKind;
  x: number;
  y: number;
  radius: number;
  amount: number;
  active: boolean;
  respawnAtTick: Tick;
};

export type RoundState = {
  phase: RoundPhase;
  countdownRemainingMs: number;
  scores: Record<PlayerId, number>;
  roundIndex: number;
  winnerPlayerId: PlayerId | null;
};

export type WorldState = {
  tick: Tick;
  rngState: number;
  players: Record<PlayerId, PlayerEntity>;
  projectiles: Record<EntityId, ProjectileEntity>;
  destructibles: Record<EntityId, DestructibleEntity>;
  firePatches: Record<EntityId, FireEntity>;
  pickups: Record<EntityId, PickupEntity>;
  round: RoundState;
};

// ---------------- Discrete events ----------------

export type SimEvent =
  | { t: 'shot-fired'; playerId: PlayerId; x: number; y: number }
  | {
      t: 'hit-confirmed';
      victimId: PlayerId;
      damage: number;
      sourceProjectileId: EntityId | null;
    }
  | { t: 'destructible-broken'; entityId: EntityId; x: number; y: number }
  | { t: 'pickup-taken'; entityId: EntityId; playerId: PlayerId }
  | { t: 'round-end'; winnerId: PlayerId | null };

// ---------------- Step result ----------------

export type StepResult = {
  state: WorldState;
  events: SimEvent[];
};

// ---------------- Spawn info / map definitions ----------------
// Map definitions are owned by Dev A. Sim consumes a MapDefinition when
// constructing the initial WorldState. The full shape will firm up as
// extraction lands; for now just declare the placeholder.

export type PlayerSpawnInfo = {
  playerId: PlayerId;
  characterId: CharacterArchetype;
  name: string;
  color: string;
  weaponId: string;
};

export type Vec2 = { x: number; y: number };

export type PlatformDefinition = {
  id: string;
  position: Vec2;
  size: Vec2;
  kind: 'floor' | 'wall' | 'platform';
};

export type MapDefinition = {
  id: string;
  name: string;
  size: Vec2;
  spawns: Vec2[];
  platforms: PlatformDefinition[];
  // Destructibles, pickups: Dev A will pull existing definitions in
  // from client/src/game/data/maps.ts during extraction.
};
