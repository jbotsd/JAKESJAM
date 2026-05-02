/**
 * Delta snapshot codec: encode the diff between two WorldStates and apply it
 * back. Wire-only concern — the pure sim package never imports this module.
 *
 * FIELD_BITS — bitmask index per entity type
 * ─────────────────────────────────────────
 * PlayerEntity lo-word (bits 0–30):
 *   0  x                    14  slowMultiplier
 *   1  y                    15  burnUntilTick
 *   2  vx                   16  burnDps
 *   3  vy                   17  burnTickLastApplied
 *   4  aimX                 18  freezeUntilTick
 *   5  aimY                 19  freezeMultiplier
 *   6  health               20  jetpackFuel
 *   7  shieldActive         21  shieldCharge
 *   8  crouching            22  shieldMaxCharge
 *   9  alive                23  parryActiveUntilTick
 *  10  weaponId             24  parryCooldownUntilTick
 *  11  cards                25  parryFacing
 *  12  fireCooldownMs       26  overchargeUntilTick
 *  13  slowedUntilTick      27  damageAmpUntilTick
 *                           28  speedBoostUntilTick
 *                           29  meleeModeUntilTick
 *                           30  slowDebuffUntilTick
 * PlayerEntity hi-word (bits 0–3):
 *   0  ammo
 *   1  vulnerabilityUntilTick
 *   2  blockJammerUntilTick
 *   3  bossModeUntilTick
 * abilityCharge + lastProcessedInputSeq: always included unconditionally.
 *
 * ProjectileEntity (bits 0–17):
 *   0  x                    9  bouncesRemaining
 *   1  y                   10  pierceRemaining
 *   2  vx                  11  impact
 *   3  vy                  12  impactRadiusPx
 *   4  lifetimeMs          13  splitCount
 *   5  ageMs               14  slowMultiplier
 *   6  traveledPx          15  homingStrength
 *   7  returning           16  accelerationMultiplier
 *   8  stickyFuseMs        17  gravityScale
 *
 * DestructibleEntity: 0=health
 * FireEntity:         0=remainingMs
 * PickupEntity:       0=active, 1=respawnAtTick
 * SatelliteEntity:    0=angle, 1=fireCooldownMs, 2=lifetimeMs
 */

import type {
  DestructibleEntity,
  EntityId,
  FireEntity,
  PickupEntity,
  PlayerEntity,
  PlayerId,
  ProjectileEntity,
  SatelliteEntity,
  WorldState,
} from "../sim/types.js";

// ─── Bit constants ────────────────────────────────────────────────────────────

const P_LO = {
  x: 1 << 0,
  y: 1 << 1,
  vx: 1 << 2,
  vy: 1 << 3,
  aimX: 1 << 4,
  aimY: 1 << 5,
  health: 1 << 6,
  shieldActive: 1 << 7,
  crouching: 1 << 8,
  alive: 1 << 9,
  weaponId: 1 << 10,
  cards: 1 << 11,
  fireCooldownMs: 1 << 12,
  slowedUntilTick: 1 << 13,
  slowMultiplier: 1 << 14,
  burnUntilTick: 1 << 15,
  burnDps: 1 << 16,
  burnTickLastApplied: 1 << 17,
  freezeUntilTick: 1 << 18,
  freezeMultiplier: 1 << 19,
  jetpackFuel: 1 << 20,
  shieldCharge: 1 << 21,
  shieldMaxCharge: 1 << 22,
  parryActiveUntilTick: 1 << 23,
  parryCooldownUntilTick: 1 << 24,
  parryFacing: 1 << 25,
  overchargeUntilTick: 1 << 26,
  damageAmpUntilTick: 1 << 27,
  speedBoostUntilTick: 1 << 28,
  meleeModeUntilTick: 1 << 29,
  slowDebuffUntilTick: 1 << 30,
} as const;

const P_HI = {
  ammo: 1 << 0,
  vulnerabilityUntilTick: 1 << 1,
  blockJammerUntilTick: 1 << 2,
  bossModeUntilTick: 1 << 3,
} as const;

const PROJ = {
  x: 1 << 0,
  y: 1 << 1,
  vx: 1 << 2,
  vy: 1 << 3,
  lifetimeMs: 1 << 4,
  ageMs: 1 << 5,
  traveledPx: 1 << 6,
  returning: 1 << 7,
  stickyFuseMs: 1 << 8,
  bouncesRemaining: 1 << 9,
  pierceRemaining: 1 << 10,
  impact: 1 << 11,
  impactRadiusPx: 1 << 12,
  splitCount: 1 << 13,
  slowMultiplier: 1 << 14,
  homingStrength: 1 << 15,
  accelerationMultiplier: 1 << 16,
  gravityScale: 1 << 17,
} as const;

const DESTR = {
  health: 1 << 0,
} as const;

const FIRE = {
  remainingMs: 1 << 0,
} as const;

const PICKUP = {
  active: 1 << 0,
  respawnAtTick: 1 << 1,
} as const;

const SAT = {
  angle: 1 << 0,
  fireCooldownMs: 1 << 1,
  lifetimeMs: 1 << 2,
} as const;

// Silence unused-var warnings for constants only used as documentation
void P_LO; void P_HI; void PROJ; void DESTR; void FIRE; void PICKUP; void SAT;

// ─── Public types ─────────────────────────────────────────────────────────────

/** Per-collection delta. K is the id type (PlayerId | EntityId). */
export type CollectionDelta<K extends string | number, V> = {
  added: Record<K, V>;
  updated: Record<K, EntityUpdate<V>>;
  removed: K[];
};

/** Partial update for a single entity, plus the bitmask(s) that describe which
 *  fields are present. For PlayerEntity we use two masks (lo, hi). */
export type EntityUpdate<V> =
  V extends PlayerEntity
    ? { bitsLo: number; bitsHi: number } & Partial<PlayerEntity>
    : V extends ProjectileEntity
    ? { bits: number } & Partial<ProjectileEntity>
    : V extends DestructibleEntity
    ? { bits: number } & Partial<DestructibleEntity>
    : V extends FireEntity
    ? { bits: number } & Partial<FireEntity>
    : V extends PickupEntity
    ? { bits: number } & Partial<PickupEntity>
    : V extends SatelliteEntity
    ? { bits: number } & Partial<SatelliteEntity>
    : never;

export type DeltaPayload = {
  /** Scalar fields we always send in full (cheap and mutate every tick). */
  tick: number;
  rngState: number;
  round: WorldState["round"];
  chaosModifierIds?: string[];
  fireHazardTimerMs?: number;
  players: CollectionDelta<PlayerId, PlayerEntity>;
  projectiles: CollectionDelta<EntityId, ProjectileEntity>;
  destructibles: CollectionDelta<EntityId, DestructibleEntity>;
  firePatches: CollectionDelta<EntityId, FireEntity>;
  pickups: CollectionDelta<EntityId, PickupEntity>;
  satellites: CollectionDelta<EntityId, SatelliteEntity>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyDelta<K extends string | number, V>(): CollectionDelta<K, V> {
  return { added: {} as Record<K, V>, updated: {} as Record<K, EntityUpdate<V>>, removed: [] };
}

// ─── Player diff ──────────────────────────────────────────────────────────────

function diffPlayer(
  prev: PlayerEntity,
  next: PlayerEntity,
): { bitsLo: number; bitsHi: number; patch: Partial<PlayerEntity> } | null {
  let bitsLo = 0;
  let bitsHi = 0;
  const patch: Partial<PlayerEntity> = {};

  if (prev.x !== next.x) { bitsLo |= 1 << 0; patch.x = next.x; }
  if (prev.y !== next.y) { bitsLo |= 1 << 1; patch.y = next.y; }
  if (prev.vx !== next.vx) { bitsLo |= 1 << 2; patch.vx = next.vx; }
  if (prev.vy !== next.vy) { bitsLo |= 1 << 3; patch.vy = next.vy; }
  if (prev.aimX !== next.aimX) { bitsLo |= 1 << 4; patch.aimX = next.aimX; }
  if (prev.aimY !== next.aimY) { bitsLo |= 1 << 5; patch.aimY = next.aimY; }
  if (prev.health !== next.health) { bitsLo |= 1 << 6; patch.health = next.health; }
  if (prev.shieldActive !== next.shieldActive) { bitsLo |= 1 << 7; patch.shieldActive = next.shieldActive; }
  if (prev.crouching !== next.crouching) { bitsLo |= 1 << 8; patch.crouching = next.crouching; }
  if (prev.alive !== next.alive) { bitsLo |= 1 << 9; patch.alive = next.alive; }
  if (prev.weaponId !== next.weaponId) { bitsLo |= 1 << 10; patch.weaponId = next.weaponId; }
  if (prev.cards.join(",") !== next.cards.join(",")) { bitsLo |= 1 << 11; patch.cards = next.cards; }
  if (prev.fireCooldownMs !== next.fireCooldownMs) { bitsLo |= 1 << 12; patch.fireCooldownMs = next.fireCooldownMs; }
  if (prev.slowedUntilTick !== next.slowedUntilTick) { bitsLo |= 1 << 13; patch.slowedUntilTick = next.slowedUntilTick; }
  if (prev.slowMultiplier !== next.slowMultiplier) { bitsLo |= 1 << 14; patch.slowMultiplier = next.slowMultiplier; }
  if (prev.burnUntilTick !== next.burnUntilTick) { bitsLo |= 1 << 15; patch.burnUntilTick = next.burnUntilTick; }
  if (prev.burnDps !== next.burnDps) { bitsLo |= 1 << 16; patch.burnDps = next.burnDps; }
  if (prev.burnTickLastApplied !== next.burnTickLastApplied) { bitsLo |= 1 << 17; patch.burnTickLastApplied = next.burnTickLastApplied; }
  if (prev.freezeUntilTick !== next.freezeUntilTick) { bitsLo |= 1 << 18; patch.freezeUntilTick = next.freezeUntilTick; }
  if (prev.freezeMultiplier !== next.freezeMultiplier) { bitsLo |= 1 << 19; patch.freezeMultiplier = next.freezeMultiplier; }
  if (prev.jetpackFuel !== next.jetpackFuel) { bitsLo |= 1 << 20; patch.jetpackFuel = next.jetpackFuel; }
  if (prev.shieldCharge !== next.shieldCharge) { bitsLo |= 1 << 21; patch.shieldCharge = next.shieldCharge; }
  if (prev.shieldMaxCharge !== next.shieldMaxCharge) { bitsLo |= 1 << 22; patch.shieldMaxCharge = next.shieldMaxCharge; }
  if (prev.parryActiveUntilTick !== next.parryActiveUntilTick) { bitsLo |= 1 << 23; patch.parryActiveUntilTick = next.parryActiveUntilTick; }
  if (prev.parryCooldownUntilTick !== next.parryCooldownUntilTick) { bitsLo |= 1 << 24; patch.parryCooldownUntilTick = next.parryCooldownUntilTick; }
  if (prev.parryFacing !== next.parryFacing) { bitsLo |= 1 << 25; patch.parryFacing = next.parryFacing; }
  if (prev.overchargeUntilTick !== next.overchargeUntilTick) { bitsLo |= 1 << 26; patch.overchargeUntilTick = next.overchargeUntilTick; }
  if (prev.damageAmpUntilTick !== next.damageAmpUntilTick) { bitsLo |= 1 << 27; patch.damageAmpUntilTick = next.damageAmpUntilTick; }
  if (prev.speedBoostUntilTick !== next.speedBoostUntilTick) { bitsLo |= 1 << 28; patch.speedBoostUntilTick = next.speedBoostUntilTick; }
  if (prev.meleeModeUntilTick !== next.meleeModeUntilTick) { bitsLo |= 1 << 29; patch.meleeModeUntilTick = next.meleeModeUntilTick; }
  if (prev.slowDebuffUntilTick !== next.slowDebuffUntilTick) { bitsLo |= 1 << 30; patch.slowDebuffUntilTick = next.slowDebuffUntilTick; }

  if (prev.ammo !== next.ammo) { bitsHi |= 1 << 0; patch.ammo = next.ammo; }
  if (prev.vulnerabilityUntilTick !== next.vulnerabilityUntilTick) { bitsHi |= 1 << 1; patch.vulnerabilityUntilTick = next.vulnerabilityUntilTick; }
  if (prev.blockJammerUntilTick !== next.blockJammerUntilTick) { bitsHi |= 1 << 2; patch.blockJammerUntilTick = next.blockJammerUntilTick; }
  if (prev.bossModeUntilTick !== next.bossModeUntilTick) { bitsHi |= 1 << 3; patch.bossModeUntilTick = next.bossModeUntilTick; }

  // Always send abilityCharge and lastProcessedInputSeq
  patch.abilityCharge = next.abilityCharge;
  patch.lastProcessedInputSeq = next.lastProcessedInputSeq;

  if (bitsLo === 0 && bitsHi === 0 &&
      prev.abilityCharge === next.abilityCharge &&
      prev.lastProcessedInputSeq === next.lastProcessedInputSeq) {
    return null;
  }
  return { bitsLo, bitsHi, patch };
}

function applyPlayerPatch(base: PlayerEntity, update: EntityUpdate<PlayerEntity>): PlayerEntity {
  const u = update as { bitsLo: number; bitsHi: number } & Partial<PlayerEntity>;
  // Spread the patch fields, strip the bitmask keys
  const { bitsLo: _lo, bitsHi: _hi, ...fields } = u;
  return { ...base, ...fields };
}

// ─── Projectile diff ──────────────────────────────────────────────────────────

function diffProjectile(
  prev: ProjectileEntity,
  next: ProjectileEntity,
): { bits: number; patch: Partial<ProjectileEntity> } | null {
  let bits = 0;
  const patch: Partial<ProjectileEntity> = {};

  if (prev.x !== next.x) { bits |= 1 << 0; patch.x = next.x; }
  if (prev.y !== next.y) { bits |= 1 << 1; patch.y = next.y; }
  if (prev.vx !== next.vx) { bits |= 1 << 2; patch.vx = next.vx; }
  if (prev.vy !== next.vy) { bits |= 1 << 3; patch.vy = next.vy; }
  if (prev.lifetimeMs !== next.lifetimeMs) { bits |= 1 << 4; patch.lifetimeMs = next.lifetimeMs; }
  if (prev.ageMs !== next.ageMs) { bits |= 1 << 5; patch.ageMs = next.ageMs; }
  if (prev.traveledPx !== next.traveledPx) { bits |= 1 << 6; patch.traveledPx = next.traveledPx; }
  if (prev.returning !== next.returning) { bits |= 1 << 7; patch.returning = next.returning; }
  if (prev.stickyFuseMs !== next.stickyFuseMs) { bits |= 1 << 8; patch.stickyFuseMs = next.stickyFuseMs; }
  if (prev.bouncesRemaining !== next.bouncesRemaining) { bits |= 1 << 9; patch.bouncesRemaining = next.bouncesRemaining; }
  if (prev.pierceRemaining !== next.pierceRemaining) { bits |= 1 << 10; patch.pierceRemaining = next.pierceRemaining; }
  if (prev.impact !== next.impact) { bits |= 1 << 11; patch.impact = next.impact; }
  if (prev.impactRadiusPx !== next.impactRadiusPx) { bits |= 1 << 12; patch.impactRadiusPx = next.impactRadiusPx; }
  if (prev.splitCount !== next.splitCount) { bits |= 1 << 13; patch.splitCount = next.splitCount; }
  if (prev.slowMultiplier !== next.slowMultiplier) { bits |= 1 << 14; patch.slowMultiplier = next.slowMultiplier; }
  if (prev.homingStrength !== next.homingStrength) { bits |= 1 << 15; patch.homingStrength = next.homingStrength; }
  if (prev.accelerationMultiplier !== next.accelerationMultiplier) { bits |= 1 << 16; patch.accelerationMultiplier = next.accelerationMultiplier; }
  if (prev.gravityScale !== next.gravityScale) { bits |= 1 << 17; patch.gravityScale = next.gravityScale; }

  if (bits === 0) return null;
  return { bits, patch };
}

// ─── Destructible diff ────────────────────────────────────────────────────────

function diffDestructible(
  prev: DestructibleEntity,
  next: DestructibleEntity,
): { bits: number; patch: Partial<DestructibleEntity> } | null {
  if (prev.health === next.health) return null;
  return { bits: 1 << 0, patch: { health: next.health } };
}

// ─── Fire diff ────────────────────────────────────────────────────────────────

function diffFire(
  prev: FireEntity,
  next: FireEntity,
): { bits: number; patch: Partial<FireEntity> } | null {
  if (prev.remainingMs === next.remainingMs) return null;
  return { bits: 1 << 0, patch: { remainingMs: next.remainingMs } };
}

// ─── Pickup diff ──────────────────────────────────────────────────────────────

function diffPickup(
  prev: PickupEntity,
  next: PickupEntity,
): { bits: number; patch: Partial<PickupEntity> } | null {
  let bits = 0;
  const patch: Partial<PickupEntity> = {};
  if (prev.active !== next.active) { bits |= 1 << 0; patch.active = next.active; }
  if (prev.respawnAtTick !== next.respawnAtTick) { bits |= 1 << 1; patch.respawnAtTick = next.respawnAtTick; }
  if (bits === 0) return null;
  return { bits, patch };
}

// ─── Satellite diff ───────────────────────────────────────────────────────────

function diffSatellite(
  prev: SatelliteEntity,
  next: SatelliteEntity,
): { bits: number; patch: Partial<SatelliteEntity> } | null {
  let bits = 0;
  const patch: Partial<SatelliteEntity> = {};
  if (prev.angle !== next.angle) { bits |= 1 << 0; patch.angle = next.angle; }
  if (prev.fireCooldownMs !== next.fireCooldownMs) { bits |= 1 << 1; patch.fireCooldownMs = next.fireCooldownMs; }
  if (prev.lifetimeMs !== next.lifetimeMs) { bits |= 1 << 2; patch.lifetimeMs = next.lifetimeMs; }
  if (bits === 0) return null;
  return { bits, patch };
}

// ─── Generic collection diffing ───────────────────────────────────────────────

function diffCollection<K extends string | number, V>(
  prev: Record<K, V>,
  next: Record<K, V>,
  // Differs return a flat record of changed fields plus the bitmask(s),
  // not a nested { patch } shape — see e.g. diffPlayer/diffProjectile.
  // Cast to EntityUpdate<V> at the assignment site below.
  differ: (p: V, n: V) => Record<string, unknown> | null,
): CollectionDelta<K, V> {
  const delta = emptyDelta<K, V>();

  const prevKeys = new Set(Object.keys(prev) as K[]);
  const nextKeys = new Set(Object.keys(next) as K[]);

  for (const k of nextKeys) {
    if (!prevKeys.has(k)) {
      (delta.added as Record<K, V>)[k] = next[k]!;
    } else {
      const result = differ(prev[k]!, next[k]!);
      if (result !== null) {
        (delta.updated as Record<K, EntityUpdate<V>>)[k] = result as EntityUpdate<V>;
      }
    }
  }

  for (const k of prevKeys) {
    if (!nextKeys.has(k)) {
      delta.removed.push(k);
    }
  }

  return delta;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encode the diff between `prev` and `next` WorldStates into a DeltaPayload.
 * `round`, `tick`, `rngState`, and `chaosModifierIds` are always full-copied
 * (they're small). Entity collections emit only changed/added/removed entries.
 */
export function encodeDelta(prev: WorldState, next: WorldState): DeltaPayload {
  return {
    tick: next.tick,
    rngState: next.rngState,
    round: next.round,
    chaosModifierIds: next.chaosModifierIds,
    fireHazardTimerMs: next.fireHazardTimerMs,
    players: diffCollection(prev.players, next.players, (p, n) => {
      const result = diffPlayer(p, n);
      if (!result) return null;
      return { bitsLo: result.bitsLo, bitsHi: result.bitsHi, ...result.patch };
    }) as CollectionDelta<PlayerId, PlayerEntity>,
    projectiles: diffCollection(prev.projectiles, next.projectiles, (p, n) => {
      const result = diffProjectile(p, n);
      if (!result) return null;
      return { bits: result.bits, ...result.patch };
    }) as CollectionDelta<EntityId, ProjectileEntity>,
    destructibles: diffCollection(prev.destructibles, next.destructibles, (p, n) => {
      const result = diffDestructible(p, n);
      if (!result) return null;
      return { bits: result.bits, ...result.patch };
    }) as CollectionDelta<EntityId, DestructibleEntity>,
    firePatches: diffCollection(prev.firePatches, next.firePatches, (p, n) => {
      const result = diffFire(p, n);
      if (!result) return null;
      return { bits: result.bits, ...result.patch };
    }) as CollectionDelta<EntityId, FireEntity>,
    pickups: diffCollection(prev.pickups, next.pickups, (p, n) => {
      const result = diffPickup(p, n);
      if (!result) return null;
      return { bits: result.bits, ...result.patch };
    }) as CollectionDelta<EntityId, PickupEntity>,
    satellites: diffCollection(prev.satellites, next.satellites, (p, n) => {
      const result = diffSatellite(p, n);
      if (!result) return null;
      return { bits: result.bits, ...result.patch };
    }) as CollectionDelta<EntityId, SatelliteEntity>,
  };
}

/**
 * Reconstruct the full WorldState by applying `delta` onto `baseline`.
 * Returns a new WorldState; `baseline` is not mutated.
 */
export function applyDelta(baseline: WorldState, delta: DeltaPayload): WorldState {
  return {
    tick: delta.tick as WorldState["tick"],
    rngState: delta.rngState,
    round: delta.round,
    chaosModifierIds: delta.chaosModifierIds,
    fireHazardTimerMs: delta.fireHazardTimerMs,
    players: applyCollectionDelta(baseline.players, delta.players, applyPlayerPatch),
    projectiles: applyCollectionDelta(
      baseline.projectiles,
      delta.projectiles,
      (base, upd) => ({ ...base, ...(upd as Partial<ProjectileEntity>) }),
    ),
    destructibles: applyCollectionDelta(
      baseline.destructibles,
      delta.destructibles,
      (base, upd) => ({ ...base, ...(upd as Partial<DestructibleEntity>) }),
    ),
    firePatches: applyCollectionDelta(
      baseline.firePatches,
      delta.firePatches,
      (base, upd) => ({ ...base, ...(upd as Partial<FireEntity>) }),
    ),
    pickups: applyCollectionDelta(
      baseline.pickups,
      delta.pickups,
      (base, upd) => ({ ...base, ...(upd as Partial<PickupEntity>) }),
    ),
    satellites: applyCollectionDelta(
      baseline.satellites,
      delta.satellites,
      (base, upd) => ({ ...base, ...(upd as Partial<SatelliteEntity>) }),
    ),
  };
}

function applyCollectionDelta<K extends string | number, V>(
  base: Record<K, V>,
  delta: CollectionDelta<K, V>,
  applyUpdate: (base: V, update: EntityUpdate<V>) => V,
): Record<K, V> {
  const out: Record<K, V> = { ...base };

  for (const [k, v] of Object.entries(delta.added) as [K, V][]) {
    out[k] = v;
  }

  for (const [k, upd] of Object.entries(delta.updated) as [K, EntityUpdate<V>][]) {
    const existing = out[k];
    if (existing !== undefined) {
      out[k] = applyUpdate(existing, upd);
    }
  }

  for (const k of delta.removed) {
    delete out[k];
  }

  return out;
}
