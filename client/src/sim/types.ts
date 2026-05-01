// Day 1 sim contract. This file is imported by client prediction code and the
// authoritative Bun server, so changes here are protocol-sensitive.

export type Tick = number;
export type EntityId = number;
export type PlayerId = string;
export type InputSeq = number;

/**
 * Bitfield layout, least significant bit first:
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

export type CharacterArchetype = 'balanced' | 'heavy' | 'sprinter' | 'shielded';

export type ProjectileShape =
  | 'circle'
  | 'triangle'
  | 'square'
  | 'hexagon'
  | 'orb'
  | 'x'
  | 'bar';

export type ProjectilePathing =
  | 'straight'
  | 'gravity'
  | 'bounce'
  | 'boomerang'
  | 'homing'
  | 'anti-homing'
  | 'float'
  | 'accelerate';

export type ElementType =
  | 'crystal'
  | 'neutral'
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'void'
  | 'radiant'
  | 'electric'
  | 'toxic'
  | 'sticky'
  | 'explosive';

/**
 * Mirror of `ImpactBehavior` from `data/cardTypes.ts` — duplicated here to keep
 * the entity type self-contained (sim/types.ts must not import from data/).
 */
export type ProjectileImpact =
  | 'none'
  | 'explosive'
  | 'sticky'
  | 'pierce-chain'
  | 'slow-field';

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
  /**
   * Slow-field debuff. When set and `slowedUntilTick > state.tick`, the
   * player's movement should multiply by `slowMultiplier`. Additive contract
   * change — server and client both read these the same way; older snapshots
   * that omit the fields just see "no slow active".
   */
  slowedUntilTick?: Tick;
  slowMultiplier?: number;
  /**
   * Jetpack fuel reservoir. Range [0, JETPACK_MAX_FUEL]; defaults to MAX
   * when absent (older snapshots) and is reset to MAX on respawn. Drains
   * while the jetpack is active and recharges otherwise. See `sim/player.ts`.
   */
  jetpackFuel?: number;
  /**
   * Parry + shield state. All optional / additive — older snapshots that omit
   * these read as "no parry active, no shield charge". See sim/combat.ts for
   * the timing/drain constants and the helpers that mutate these fields.
   */
  shieldCharge?: number;
  shieldMaxCharge?: number;
  /** Tick (inclusive) at which the parry window expires. */
  parryActiveUntilTick?: Tick;
  /** Tick (inclusive) before which a fresh parry can't start. */
  parryCooldownUntilTick?: Tick;
  /** Aim direction (radians) captured the moment parry started. */
  parryFacing?: number;
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
  /**
   * Optional pathing / impact extras. All fields are additive and default
   * to "no effect" when absent so older snapshots stay compatible. Populated
   * by `weapon.stepWeapon` from the resolved card build.
   */
  impact?: ProjectileImpact;
  impactRadiusPx?: number;
  splitCount?: number;
  slowMultiplier?: number;
  homingStrength?: number;
  accelerationMultiplier?: number;
  gravityScale?: number;
  rangePx?: number;
  /** Tracking state set/maintained by the projectile stepper. */
  ageMs?: number;
  traveledPx?: number;
  originX?: number;
  originY?: number;
  /** Boomerang-only: true once the shard has begun curving home. */
  returning?: boolean;
  /** Sticky-only: ms remaining before the stuck shard detonates. */
  stickyFuseMs?: number;
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

/**
 * Auto-firing companion that orbits its owner. Position is derived each tick
 * from owner.x/owner.y + (cos(angle), sin(angle)) * orbitRadius — the entity
 * stores only the orbit angle so a fresh angle deterministically reproduces
 * the position. Spawned by the `orbitingSatellites` weapon-card modifier.
 */
export type SatelliteEntity = {
  id: EntityId;
  ownerId: PlayerId;
  /** Current orbit angle in radians; advanced each tick. */
  angle: number;
  /** Radius (px) the satellite orbits at, around owner.x/owner.y. */
  orbitRadius: number;
  /** Time until the satellite can fire again (ms). */
  fireCooldownMs: number;
  /** Remaining lifetime (ms). Use Infinity for permanent companions. */
  lifetimeMs: number;
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
  satellites: Record<EntityId, SatelliteEntity>;
  round: RoundState;
};

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
  | { t: 'round-end'; winnerId: PlayerId | null }
  | {
      t: 'player-slowed';
      victimId: PlayerId;
      multiplier: number;
      durationMs: number;
    }
  | {
      t: 'parry-deflected';
      playerId: PlayerId;
      projectileId: EntityId | null;
    }
  | {
      t: 'shield-popped';
      playerId: PlayerId;
      remainingCharge: number;
    };

export type StepResult = {
  state: WorldState;
  events: SimEvent[];
  /**
   * True on the tick the match was decided (a player reached the target
   * score). The Bun server uses this to post the final result to Convex
   * exactly once. See `server/src/matchHost.ts` and `sim/round.ts`.
   */
  matchComplete: boolean;
};

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

export type MapDefinition = {
  id: string;
  name: string;
  size: Vec2;
  spawns: Vec2[];
  platforms: PlatformDefinition[];
  destructibles?: DestructibleDefinition[];
  pickups?: PickupDefinition[];
};
