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
 *  5 crouch, 6 fire, 7 ability, 8 shield, 9 dash,
 *  10..13 drafted ability slots 1..4 (six-axes-goal.md Layer 2),
 *  14..15 reserved.
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

/**
 * Sim mode, carried on `WorldRuntime` (host/client-local — NOT part of
 * `WorldState`, so it never needs wire-protocol/delta-snapshot changes).
 * `'combat'` is today's only behavior, unchanged. `'hangout'` (party
 * lobby walking space, graceful-gliding-flame plan A1) pins the round
 * machine to a permanent `'fighting'` phase (see `World.ts`'s
 * `stepWithRuntime`), no-ops `stepWeapon`, and treats the void kill-plane
 * as a respawn-in-place safety net instead of a death.
 */
export type WorldMode = 'combat' | 'hangout';

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
   * Ward shell (six-axes-goal.md Layer 1): set at Emission cast when the
   * hand's Ward axis is charged. While `wardShellUntilTick > tick`, incoming
   * damage is multiplied by EMISSION_WARD_DAMAGE_MULT before shield absorb
   * (mitigation order: parry > shell > shield). Additive/optional — older
   * snapshots read "no shell". Hash-mixed (buff-tick precedent).
   */
  wardShellUntilTick?: Tick;
  /**
   * Drafted actives (six-axes-goal.md Layer 2) — per-slot cooldowns + the
   * Crimson Tithe window. All additive/optional (older snapshots read "no
   * cooldown, no window"), all hash-mixed. Slots map to input bits 10..13
   * in pick order; the slot's card lives in the resolved build's `actives`.
   */
  slot1CooldownUntilTick?: Tick;
  slot2CooldownUntilTick?: Tick;
  slot3CooldownUntilTick?: Tick;
  slot4CooldownUntilTick?: Tick;
  /** Crimson Tithe active window: while set and in the future, fired shots
   *  carry leechFraction (weapon.ts stamps it at spawn). */
  titheUntilTick?: Tick;
  /** Veil of Nought window: homing and satellites cannot target this
   *  player; firing ends it early (weapon fire clears it). */
  veilUntilTick?: Tick;
  /** Severing Answer stance: the next hit taken while live is negated and
   *  returned to the attacker (capped) — consumed on use. Mitigation
   *  order: parry > counter > ward shell > shield. */
  counterUntilTick?: Tick;
  /** Mid-round respawn timer: stamped when the player dies during the
   *  fighting phase; the sim respawns them at this tick (RESPAWN_DELAY_MS)
   *  unless sudden death is active (last-one-standing rounds never
   *  respawn). Cleared on respawn / round boundary. Additive/optional. */
  respawnAtTick?: Tick;
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
   * Dash-bash readiness, 0 (just used) .. 1 (ready to fire again), at
   * end-of-tick. Sourced from `PlayerMovementMemory.dashCooldownMs` against
   * the effective (card-scaled) cooldown window in `player.ts`. Render-only
   * signal, same pattern as `dashing`/`touchingWallDir` above. Optional/
   * additive: omitted hides the HUD indicator rather than defaulting to
   * either state.
   */
  dashReadyFrac?: number;
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
  /** Element-status duration multiplier applied at the hit site (Emission
   *  cast shards carry ×2, capped per-status — docs/emission-engine-goal.md).
   *  Absent/1 = ordinary gunfire statuses. Additive optional contract like
   *  every extra above; prediction-only nuance: snapshot-reconciled remote
   *  projectiles may omit it, but status OUTCOMES on players are server-
   *  authoritative fields anyway (burnUntilTick etc.), so the divergence
   *  window is a frame of local cosmetic prediction at most. */
  statusScale?: number;
  /** Six Axes shard extras (docs/six-axes-goal.md Layer 1) — spawn-time
   *  config from the caster's resolved EmissionConfig, same additive /
   *  statusScale contract (absent = ordinary gunfire, no axis expression).
   *  - leechFraction: Drain — post-mitigation damage healed to the owner.
   *  - executeBelowFrac: Technique — a hit on a player below this health
   *    fraction finishes them.
   *  - wrapShots: Mystery — the shard wraps the map rect instead of flying
   *    off it. */
  leechFraction?: number;
  executeBelowFrac?: number;
  wrapShots?: boolean;
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
   * Per-round kill tally (fast-respawn ruling 2026-07-17 follow-up): playerId
   * → kills credited to that player THIS round. A kill = a `player-killed`
   * SimEvent whose `killerId` is non-null and differs from `victimId` —
   * suicides and attacker-less deaths (void plane, storm, unattributed burn)
   * credit nobody. Folded in by World.ts's stepWithRuntime from the tick's
   * events BEFORE stepRound runs; drives `decideRoundWinner`'s timeout /
   * force-resolve rule (most kills wins). Same lifecycle as
   * `firstBloodPlayerId`: reset when a round's fighting phase begins
   * (countdown → fighting) and wiped on every round transition. Optional /
   * additive — older snapshots simply omit it (treated as "no kills yet").
   */
  roundKills?: Record<PlayerId, number>;
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
      /** Player credited with the damage (projectile owner / basher /
       *  burn igniter), or null/absent for environmental sources. Feeds
       *  the death-FX reward shards (damage-proportional). Additive wire
       *  field — old clients ignore it. */
      attackerId?: PlayerId | null;
      /** True when this hit landed in the victim's head zone (see
       *  isHeadshot/playerHitboxAABB, player.ts) — `damage` already has the
       *  slight boon baked in; this is purely for the renderer's distinct
       *  headshot VFX/audio cue. Additive wire field — old clients ignore it. */
      headshot?: boolean;
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
   * Emitted when a player's Emission casts (docs/emission-engine-goal.md —
   * Ability input at full charge; charge consumed to 0 the same tick).
   * Drives the renderer's cast feel (seal-flash, camera punch, SFX);
   * the volley itself is ordinary projectiles already in the snapshot.
   * Additive wire type — old clients ignore unknown event tags.
   */
  | {
      t: 'emission-cast';
      playerId: PlayerId;
      x: number;
      y: number;
      element: ElementType;
      volleyCount: number;
    }
  /**
   * Emitted when a drafted active fires (six-axes Layer 2: input bits
   * 10..13, validated against the slot's cooldown). Drives the router's
   * activation cue + the scene's slot flash; the effect itself is ordinary
   * sim state (buff ticks / entities) already in the snapshot. Additive
   * wire type — old clients ignore unknown event tags.
   */
  | {
      t: 'ability-activated';
      playerId: PlayerId;
      slot: number;
      kind: string;
      x: number;
      y: number;
    }
  /**
   * Emitted when a Drain-axis Emission shard heals its caster at the hit
   * site (six-axes-goal.md Layer 1: leech reads the SAME post-mitigation
   * applied damage the charge fill reads). Drives the crimson-thread read —
   * the heal itself is already in the snapshot's health. Additive wire type.
   * fromX/fromY = victim (thread source), toX/toY = caster at heal time.
   */
  | {
      t: 'emission-leech';
      casterId: PlayerId;
      victimId: PlayerId;
      amount: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
    }
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
    }
  /**
   * Hangout mode only (graceful-gliding-flame plan A3): a player overlapped
   * the Ready totem. Server-only reaction — `matchHost.ts`'s hangout host
   * flips the room's `LobbyPlayer.ready` boolean directly; the client only
   * needs this for a local flash/SFX cue.
   */
  | { t: 'ready-toggled'; playerId: PlayerId }
  /**
   * Hangout mode only: a player overlapped the Launch totem. Server-only
   * reaction — triggers the existing `startPrivateMatch` handoff when the
   * gating (host + all-ready) is satisfied; a no-op event otherwise.
   */
  | { t: 'launch-requested'; playerId: PlayerId }
  /**
   * A launch pad fired (map-static geometry, `sim/launchPad.ts`): the
   * player overlapped the pad and passed the stateless retrigger gate, so
   * the impulse was applied this tick. Drives client SFX/VFX only — the
   * velocity change itself is ordinary player state already in the
   * snapshot. `entityId` is the pad's INDEX in `map.launchPads` (pads are
   * static map data, not WorldState entities, so the index is the stable
   * cross-host identifier). Additive wire type — old clients ignore
   * unknown event tags (same precedent as `emission-cast`).
   */
  | { t: 'launch-pad-fired'; entityId: EntityId; playerId: PlayerId };

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

/**
 * The vessel's 5 independently-recolorable channels (Vessel Creator design,
 * docs/vessel-creator-design.md §3/§6.1) — mirrors
 * ProceduralPlayerRigOptions' accentColor/visorColor/palmColor/jointColor/
 * auraColor exactly, but as wire-safe hex strings rather than Phaser's
 * numeric color. All optional and additive: an absent field (or an absent
 * `cosmetics` object entirely) renders identically to today, since the rig
 * itself already defaults every channel to accentColor when unset.
 */
export type VesselCosmetics = {
  accentColor?: string;
  visorColor?: string;
  palmColor?: string;
  jointColor?: string;
  auraColor?: string;
};

export type PlayerSpawnInfo = {
  playerId: PlayerId;
  characterId: CharacterArchetype;
  name: string;
  color: string;
  weaponId: string;
  cosmetics?: VesselCosmetics;
  /** Starter cards applied at insertion (venue-sprint2-goal S2.E — the
   *  lobby draft pick rides admission). Omitted = plain spawn. Replay-safe:
   *  the recorder serializes the whole spawn, so re-sims apply the same
   *  cards at the same join tick. */
  cards?: string[];
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

/**
 * Launch pad — STATIC map geometry (like platforms/pickups definitions).
 * A player overlapping the pad's AABB gets a velocity impulse along
 * `impulse` (see `sim/launchPad.ts` for the exact formula: additive along
 * the pad direction with a cap, approach speed preserved — the "hitting a
 * ramp at speed" feel).
 *
 * DELIBERATELY NOT part of `WorldState`: pads carry zero dynamic state.
 * The retrigger condition is STATELESS (derived from the player's current
 * velocity relative to the pad direction — see `launchPad.ts`), so pads
 * never ride the snapshot, never touch `worldStateBridge.ts`'s extern
 * layout, and imply no wire/protocol change. Both sides derive them from
 * the mapId, exactly like platforms.
 */
export type LaunchPadDefinition = {
  id: string;
  /** Center of the pad AABB (world px). */
  position: Vec2;
  /** Full width/height of the pad AABB (world px). */
  size: Vec2;
  /** Velocity impulse (px/s) applied along this vector's direction. */
  impulse: Vec2;
};

/**
 * True slope — STATIC angled ground (docs/map-design.md "Diagonals & sky":
 * the deliberately-deferred piece, greenlit 2026-07-17). Only TWO blessed
 * grades exist, each in two directions — a fixed grammar like the fixed
 * tier heights, never arbitrary angles:
 *
 *   grade "2:1" — run:rise 2:1 (rise = run / 2, ≈26.565°)
 *   grade "1:1" — run:rise 1:1 (rise = run,     45°)
 *
 * `base` is the BOTTOM corner of the walkable surface; the surface ascends
 * from it in direction `dir` over horizontal extent `run` (rise derives
 * from the grade). The derived surface line (y-down coordinates):
 *
 *   dir = +1 (ascends left→right):  x ∈ [base.x, base.x + run]
 *   dir = −1 (ascends right→left):  x ∈ [base.x − run, base.x]
 *   surfaceY(x) = base.y + dyDx · (x − base.x),  dyDx = −grade_t · dir
 *   (grade_t = 0.5 for "2:1", 1.0 for "1:1" — both exact in binary)
 *
 * ONE-WAY, walkable side up only — no slope ceilings/undersides. Collision
 * is a foot-point grounding pass inside `stepPlayer` (player.ts /
 * sim/src/player.zig), NOT an AABB shape: see SLOPE_* in collision.ts.
 *
 * DELIBERATELY NOT part of `WorldState` (launch-pad precedent): slopes are
 * pure static geometry with zero dynamic state, so they never ride the
 * snapshot, never touch worldStateBridge's extern layout, and imply no
 * wire/protocol change. Both sides derive them from the mapId, exactly
 * like platforms. They reach wasm via `world_state_set_slopes` (the
 * launch-pad module-level pattern).
 */
export type SlopeDefinition = {
  id: string;
  /** Bottom corner of the walkable surface (world px). */
  base: Vec2;
  /** Horizontal extent of the surface (px, > 0). Rise = run · grade_t. */
  run: number;
  /** Blessed grade — "2:1" (≈26.565°) or "1:1" (45°). Nothing else. */
  grade: '2:1' | '1:1';
  /** Ascent direction: +1 = ascends left-to-right, −1 = right-to-left. */
  dir: 1 | -1;
};

export type MapDefinition = {
  id: string;
  name: string;
  size: Vec2;
  spawns: Vec2[];
  platforms: PlatformDefinition[];
  destructibles?: DestructibleDefinition[];
  pickups?: PickupDefinition[];
  /**
   * Launch pads (optional / additive — maps without pads behave exactly
   * as before). Static geometry, never in `WorldState`; stepped by
   * `World.stepWithRuntime` §4a via `sim/launchPad.ts`.
   */
  launchPads?: LaunchPadDefinition[];
  /**
   * True slopes (optional / additive — maps without slopes step
   * byte-identically to before: the slope pass AND the slope-aware
   * sub-step guard are both gated on `slopes.length > 0`). Static
   * geometry, never in `WorldState`; resolved inside `stepPlayer` via
   * the collision cache (`buildStaticCache`'s `slopes` argument).
   */
  slopes?: SlopeDefinition[];
  /** Arena theme key from `ARENA_THEMES`. Defaults to voidVessel when omitted. */
  arenaTheme?:
    | "voidVessel"
    | "crystalDock"
    | "autogenesHull"
    | "jadeIsles"
    | "ivoryClouds"
    | "hangingWood";
};
