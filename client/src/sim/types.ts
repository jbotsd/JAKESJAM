// Day 1 sim contract. This file is imported by client prediction code and the
// authoritative Bun server, so changes here are protocol-sensitive.

declare const __brand: unique symbol;
export type EntityId = number & { readonly [__brand]: "EntityId" };
export type PlayerId = string & { readonly [__brand]: "PlayerId" };
export type Tick = number & { readonly [__brand]: "Tick" };
export type InputSeq = number & { readonly [__brand]: "InputSeq" };

/** Brand a number as a non-negative integer ID. Throws on NaN/Infinity/
 *  negatives/non-integers — those have always been bugs in this codebase
 *  (a corrupted spatial-grid key, an off-by-one tick, a parsed garbage
 *  ack). The throw makes them loud at the trust boundary. */
export const EntityId = (n: number): EntityId => {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`EntityId: expected non-negative integer, got ${n}`);
  }
  return n as EntityId;
};
export const PlayerId = (s: string): PlayerId => {
  if (typeof s !== "string" || s.length === 0 || s.length > 64) {
    throw new Error(`PlayerId: expected non-empty string ≤64 chars, got ${JSON.stringify(s)}`);
  }
  return s as PlayerId;
};
export const Tick = (n: number): Tick => {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Tick: expected non-negative integer, got ${n}`);
  }
  return n as Tick;
};
export const InputSeq = (n: number): InputSeq => {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`InputSeq: expected non-negative integer, got ${n}`);
  }
  return n as InputSeq;
};

/** Typed iteration helpers — see .claude/skills/ts-pocock/SKILL.md §1.
 *  Use these instead of `Object.keys(...) as PlayerId[]`. */
export function playerIdsOf<T>(record: Record<PlayerId, T>): PlayerId[] {
  return (Object.keys(record) as PlayerId[]).sort();
}
export function entityIdsOf<T>(record: Record<EntityId, T>): EntityId[] {
  // Object.keys returns string[]; entity ids are stored as numeric strings,
  // so we coerce back through the EntityId constructor. Sorted numerically
  // for cross-host iteration parity (see game-sim-determinism §4).
  const out: EntityId[] = [];
  for (const k in record) out.push(EntityId(+k));
  return out.sort((a, b) => a - b);
}

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

// 'electric' and 'toxic' were declared here with NO sim handler anywhere
// (World.ts's element switch has no branch for either) — a ghost a future
// card could accidentally reference and silently do nothing. Removed from
// the card-authoring-facing union so that mistake can't happen. The
// numeric wire slots (Zig ElementType enum, wasm index tables) are left
// untouched — no card can ever emit them now, so they're simply unused,
// not a renumbering hazard.
export type ElementType =
  | 'crystal'
  | 'neutral'
  | 'fire'
  | 'ice'
  | 'lightning'
  | 'void'
  | 'radiant'
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

/**
 * Pickup kinds known to the sim. The original three (health-shard, shield-cell,
 * overcharge-core) shipped first; the remaining members were added when the
 * full Boxworks pickup set was ported into the sim. Additive: existing
 * snapshots / older code that only reads the first three remain compatible.
 */
export type PickupKind =
  | 'health-shard'
  | 'shield-cell'
  | 'overcharge-core'
  | 'damage-amp'
  | 'speed-boost'
  | 'melee-mode'
  | 'slow-trap'
  | 'vulnerability-trap'
  | 'block-jammer'
  | 'boss-core'
  | 'card-cache';

/**
 * Round-state phases. Additive: the `'drafting'` phase was added on top of the
 * original three (countdown / fighting / round-over). Older snapshot consumers
 * that don't know about `'drafting'` simply read it as "no fighting" — input is
 * frozen, projectiles paused, players standing still while they pick a card.
 */
export type RoundPhase = 'countdown' | 'fighting' | 'round-over' | 'drafting';

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
   * Element status effects (Crystal Rounds card system). Same additive /
   * optional contract as the slow-field debuff above — older snapshots that
   * omit these read as "no element status active".
   *
   * - `burnUntilTick` / `burnDps` / `burnTickLastApplied`: fire-element DoT.
   *   Burn applies `burnDps` damage every 1 second (in sim ticks) until
   *   `burnUntilTick`. `burnTickLastApplied` is the last tick the DoT was
   *   credited on so the per-tick pass can rate-limit to once per second.
   * - `freezeUntilTick` / `freezeMultiplier`: ice-element movement freeze.
   *   Composes alongside `slowMultiplier` at the movement site.
   */
  burnUntilTick?: Tick;
  burnDps?: number;
  burnTickLastApplied?: Tick;
  freezeUntilTick?: Tick;
  freezeMultiplier?: number;
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
   * shieldCharge is also used by the shield-cell pickup as a numeric resource.
   */
  shieldCharge?: number;
  shieldMaxCharge?: number;
  /** Tick (inclusive) at which the parry window expires. */
  parryActiveUntilTick?: Tick;
  /** Tick (inclusive) before which a fresh parry can't start. */
  parryCooldownUntilTick?: Tick;
  /** Aim direction (radians) captured the moment parry started. */
  parryFacing?: number;
  /**
   * Pickup-driven buffs / debuffs. All fields are additive and optional. When
   * the field is unset or its tick is `<= state.tick`, the buff is inactive.
   *
   * - overchargeUntilTick: damage + fire-rate buff (mirrors `overchargeMs`).
   * - damageAmpUntilTick: extra damage multiplier (mirrors `damageAmpMs`).
   * - speedBoostUntilTick: movement speed buff (mirrors `speedBoostMs`).
   * - meleeModeUntilTick: forces close-range / melee fire pattern.
   * - slowDebuffUntilTick: applied to OTHER players when this player picks up
   *   a slow-trap (the trap-victim debuff timer).
   * - vulnerabilityUntilTick: takes increased damage.
   * - blockJammerUntilTick: disables shield + parry while active.
   * - bossModeUntilTick: boss-mode buff (bigger / slower / more health / more
   *   damage). Picker-only.
   */
  overchargeUntilTick?: Tick;
  damageAmpUntilTick?: Tick;
  speedBoostUntilTick?: Tick;
  meleeModeUntilTick?: Tick;
  slowDebuffUntilTick?: Tick;
  vulnerabilityUntilTick?: Tick;
  blockJammerUntilTick?: Tick;
  bossModeUntilTick?: Tick;
  /**
   * Stolen Fangs (legendary defense card): banked lock charges from
   * absorbing a shielded hit. The next fired shot(s) consume one charge and
   * become homing at reduced damage (see sim/weapon.ts). Cap 2; expires
   * unspent at `pendingLockExpiresAtTick`. See sim/World.ts's shielded-hit
   * branch for where charges are granted.
   */
  pendingLockCharges?: number;
  pendingLockExpiresAtTick?: Tick;
  /**
   * True when the player's foot was touching a static at end-of-tick.
   * Sourced from `PlayerMovementMemory.groundedLastFrame` after the
   * collision resolve in `World.ts`. Render-only signal — sim correctness
   * code uses the host-only movement memory directly. Wire-encoded on the
   * snapshot so remote-rig render can suppress the walk-step foot lift
   * when the player is actually airborne. Optional/additive: older
   * snapshots omitting the field read as "unknown / treat as not grounded".
   */
  grounded?: boolean;
  /**
   * -1/0/+1: which side (if any) the player is currently touching/gripping
   * a wall on, at end-of-tick. Sourced from
   * `PlayerMovementMemory.touchingWallDir` in `World.ts`, same render-only
   * pattern as `grounded` above — sim correctness code uses the host-only
   * movement memory directly. Wire-encoded so remote rigs can render the
   * wall-slide/wall-jump pose. Optional/additive: omitted reads as 0 (not
   * touching a wall).
   */
  touchingWallDir?: number;
  /**
   * True while a dash is active, at end-of-tick. Sourced from
   * `PlayerMovementMemory.dashActiveMs > 0` in `World.ts`. Render-only
   * signal, same pattern as `grounded`/`touchingWallDir`. Optional/additive:
   * omitted reads as false.
   */
  dashing?: boolean;
  /**
   * Alternating throwing-hand parity (0 = lead, 1 = back) for the last shot.
   * Toggled per fire in stepWeapon so the muzzle + shot-fired event pick the
   * hand that matches the rig's alternating throw. Runtime-only cosmetic
   * field; not wire-encoded (the authoritative hand reaches remote clients
   * via the shot-fired event, and predicted-local parity self-corrects).
   */
  throwHandParity?: number;
};

export type ProjectileEntity = {
  id: EntityId;
  /** null = world-owned (orphaned); hits/affects every player. */
  ownerId: PlayerId | null;
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
  /** null = world-owned (orphaned); hits/affects every player. */
  ownerId: PlayerId | null;
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
  /**
   * Optional buff duration (ms) carried from the source `PickupDefinition`.
   * Used by buff-style pickups (overcharge-core, damage-amp, speed-boost,
   * melee-mode, slow-trap, vulnerability-trap, block-jammer, boss-core).
   * Absent for instant pickups (health-shard, card-cache).
   */
  durationMs?: number;
  /**
   * Optional respawn time (ms) carried from the source `PickupDefinition` so
   * the pickup stepper can deterministically schedule respawns without the
   * map being passed in. Falls back to a default in `pickup.ts` when absent.
   */
  respawnMs?: number;
};

/**
 * Auto-firing companion that orbits its owner. Position is derived each tick
 * from owner.x/owner.y + (cos(angle), sin(angle)) * orbitRadius — the entity
 * stores only the orbit angle so a fresh angle deterministically reproduces
 * the position. Spawned by the `orbitingSatellites` weapon-card modifier.
 */
export type SatelliteEntity = {
  id: EntityId;
  /** null = world-owned (orphaned); hits/affects every player. */
  ownerId: PlayerId | null;
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
  /**
   * Drafting phase bookkeeping. All optional / additive — older snapshots that
   * pre-date the rogue-lite draft phase simply omit them and the round state
   * machine treats that as "no draft in progress". See `sim/round.ts` for the
   * lifecycle: offers are rolled on `round-over → drafting`, picks land via
   * `applyCardPick` on the server, and drafting auto-resolves at expiry.
   *
   * - `draftingExpiresAtTick`: tick at which any unresolved offers auto-pick
   *   the leftmost candidate.
   * - `draftingPicked`: playerId → cardId for those who already picked this
   *   round. The round advances to countdown when all alive players have
   *   entries here OR the expiry tick is reached.
   * - `draftingOffers`: playerId → array of DRAFT_OFFER_COUNT cardIds offered
   *   to that player this round.
   */
  draftingExpiresAtTick?: Tick;
  draftingPicked?: Record<PlayerId, string>;
  draftingOffers?: Record<PlayerId, string[]>;
  /**
   * First-blood wager (design pillars doc, "distinctive features"): the
   * first player to land a hit on another player this round gets a temp
   * speed boost for the rest of the round (see FIRST_BLOOD_SPEED_MULTIPLIER
   * in World.ts). `undefined` = not yet claimed this round. Reset on every
   * round transition (round.ts).
   */
  firstBloodPlayerId?: PlayerId;
  /**
   * Sudden-death shrinking arena (design pillars doc): set true when this
   * round begins with every scored player tied at `targetScore - 1` — a
   * true decider round. While true, `World.ts`'s sudden-death storm zone
   * (see `suddenDeath.ts`) damages players outside a safe radius that
   * shrinks from 1.0x to 0.6x of the arena over the round timer. Reset on
   * every round transition.
   */
  suddenDeathActive?: boolean;
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
  /**
   * Active chaos modifier ids for this match. Resolved per-tick via
   * `getChaosProfile(...)` in `sim/data/chaosModifiers.ts`. Optional and
   * additive — older snapshots that omit it are treated as "no modifiers".
   * Stable per match: set once at `World.create` time and not mutated by
   * `step` (round transitions don't touch it either).
   */
  chaosModifierIds?: string[];
  /**
   * Internal accumulator the World uses to throttle fire-hazard patch spawns
   * while the `fire-hazard` modifier is active. Reset to 0 on round transitions
   * so each round starts clean. Absent when no fire hazard is active.
   */
  fireHazardTimerMs?: number;
};

export type SimEvent =
  | { t: 'shot-fired'; playerId: PlayerId; x: number; y: number; hand?: 0 | 1 }
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
    }
  | {
      /**
       * Emitted exactly once when a player's `alive` flag transitions from
       * true to false. Distinct from `hit-confirmed` so the renderer can
       * drive the kill stack (hit-stop 80ms, kill shake, particle burst,
       * flash, killer camera kick) without polling `state.players[id].alive`.
       * `killerId` is the playerId whose projectile/effect caused the kill,
       * or null for environmental causes (void plane, fire patch DoT).
       */
      t: 'player-killed';
      victimId: PlayerId;
      killerId: PlayerId | null;
      cause: 'projectile' | 'void' | 'burn' | 'fire' | 'explosion' | 'chain-lightning' | 'storm' | 'bash';
    }
  /**
   * Emitted exactly once per round when the first hit-confirmed of the
   * round lands with a resolvable attacker (see World.ts's per-projectile
   * hit-resolution loop). `playerId` is the attacker, not the victim —
   * matches how `player-killed.killerId` is named from the actor's side.
   */
  | { t: 'first-blood'; playerId: PlayerId }
  /**
   * Emitted exactly once when a round enters sudden death (every scored
   * player tied at `targetScore - 1`). Purely informational — the actual
   * shrinking-storm damage is carried by ordinary `hit-confirmed` events
   * with `sourceProjectileId: null` and `player-killed.cause === 'storm'`.
   */
  | { t: 'sudden-death-started' }
  /**
   * Emitted when a player collects a `card-cache` pickup. The sim pre-rolls
   * the offered card ids deterministically (seeded RNG). The client overlay
   * consumes this event to show the draft UI; the actual card commit happens
   * via a separate input path (out of sim scope for this pass).
   */
  | { t: 'card-offered'; playerId: PlayerId; cardIds: string[] }
  /**
   * Emitted exactly once per (round, player) when their draft pick is recorded
   * by `stepRound`. `autoPicked` is true when the player did not commit a card
   * before `draftingExpiresAtTick` and the leftmost offer was selected on
   * their behalf, false when the pick arrived via a normal `card-pick` input.
   */
  | {
      t: 'draft-resolved';
      playerId: PlayerId;
      cardId: string;
      autoPicked: boolean;
    }
  /**
   * Emitted when a lightning-element projectile chains damage to a secondary
   * target. Carries world-space positions for the primary hit and chain target
   * so clients can draw a bolt arc without needing to look up player positions.
   * Deterministic: positions come from the player entities at hit-time.
   */
  | {
      t: 'chain-hit';
      victimId: PlayerId;
      chainTargetId: PlayerId;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      damage: number;
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
  /** Arena theme key from `ARENA_THEMES`. Defaults to "jadeIsles" when omitted. */
  arenaTheme?: "jadeIsles" | "ivoryClouds" | "hangingWood";
};
