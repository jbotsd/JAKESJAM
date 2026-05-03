/**
 * Delta snapshot codec: encode the diff between two WorldStates and apply it
 * back. Wire-only concern — the pure sim package never imports this module.
 *
 * FIELD_BITS — bitmask index per entity type
 * ─────────────────────────────────────────
 * PlayerEntity (27 bits used):
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
 *  (bits 31 and above use BigInt or a second mask — not needed at current scale)
 *  ammo (bit index 31 — kept < 32 for safe JS bitwise)
 *  abilityCharge → included in every delta unconditionally (cheap, changes frequently)
 *  lastProcessedInputSeq → included unconditionally
 *  vulnerabilityUntilTick, blockJammerUntilTick, bossModeUntilTick → optional tail
 *
 * NOTE: For simplicity, since PlayerEntity has ~30 optional/frequent fields,
 * we use a two-number bitmask pair (lo: bits 0-30, hi: bits 0-7) rather than
 * cramming into one JS bitwise int (which is 32-bit signed). This gives us
 * 38 addressable bits without BigInt.
 *
 * ProjectileEntity (18 bits):
 *   0  x                    9  bouncesRemaining
 *   1  y                   10  pierceRemaining
 *   2  vx                  11  impact
 *   3  vy                  12  impactRadiusPx
 *   4  lifetimeMs          13  splitCount
 *   5  ageMs               14  slowMultiplier
 *   6  traveledPx          15  homingStrength
 *   7  returning           16  accelerationMultiplier
 *   8  stickyFuseMs        17  gravityScale
 *  (ownerId, shape, radius, damage, pathing, element, rangePx, originX, originY
 *   are static after creation — sent only in `added`, not in updates)
 *
 * DestructibleEntity:
 *   0  health  (only mutable field; x/y/width/height/explosive/flammable are static)
 *
 * FireEntity:
 *   0  remainingMs  (x, y, radius, ownerId, damagePerSecond are static)
 *
 * PickupEntity:
 *   0  active
 *   1  respawnAtTick
 *
 * SatelliteEntity:
 *   0  angle
 *   1  fireCooldownMs
 *   2  lifetimeMs
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
// Single source of truth lives in client/src/sim/snapshotDeltaBits.ts so
// client and server can never drift. Do not redeclare locally.
import {
  P_LO,
  P_HI,
  PROJ,
  DESTR,
  FIRE,
  PICKUP,
  SAT,
} from "../sim/snapshotDeltaBits.js";

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

/** Length-then-element compare; cheaper than `a.join() !== b.join()` because
 *  it skips two intermediate string allocations per call. */
function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

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

  if (prev.x !== next.x) { bitsLo |= P_LO.x; patch.x = next.x; }
  if (prev.y !== next.y) { bitsLo |= P_LO.y; patch.y = next.y; }
  if (prev.vx !== next.vx) { bitsLo |= P_LO.vx; patch.vx = next.vx; }
  if (prev.vy !== next.vy) { bitsLo |= P_LO.vy; patch.vy = next.vy; }
  if (prev.aimX !== next.aimX) { bitsLo |= P_LO.aimX; patch.aimX = next.aimX; }
  if (prev.aimY !== next.aimY) { bitsLo |= P_LO.aimY; patch.aimY = next.aimY; }
  if (prev.health !== next.health) { bitsLo |= P_LO.health; patch.health = next.health; }
  if (prev.shieldActive !== next.shieldActive) { bitsLo |= P_LO.shieldActive; patch.shieldActive = next.shieldActive; }
  if (prev.crouching !== next.crouching) { bitsLo |= P_LO.crouching; patch.crouching = next.crouching; }
  if (prev.alive !== next.alive) { bitsLo |= P_LO.alive; patch.alive = next.alive; }
  if (prev.weaponId !== next.weaponId) { bitsLo |= P_LO.weaponId; patch.weaponId = next.weaponId; }

  // Arrays: length + element compare; avoids two string allocations per diff.
  if (!sameStringArray(prev.cards, next.cards)) {
    bitsLo |= P_LO.cards;
    patch.cards = next.cards;
  }

  if (prev.fireCooldownMs !== next.fireCooldownMs) { bitsLo |= P_LO.fireCooldownMs; patch.fireCooldownMs = next.fireCooldownMs; }

  // Optional fields — only emit if the next value differs OR if one side is undefined
  if (prev.slowedUntilTick !== next.slowedUntilTick) { bitsLo |= P_LO.slowedUntilTick; patch.slowedUntilTick = next.slowedUntilTick; }
  if (prev.slowMultiplier !== next.slowMultiplier) { bitsLo |= P_LO.slowMultiplier; patch.slowMultiplier = next.slowMultiplier; }
  if (prev.burnUntilTick !== next.burnUntilTick) { bitsLo |= P_LO.burnUntilTick; patch.burnUntilTick = next.burnUntilTick; }
  if (prev.burnDps !== next.burnDps) { bitsLo |= P_LO.burnDps; patch.burnDps = next.burnDps; }
  if (prev.burnTickLastApplied !== next.burnTickLastApplied) { bitsLo |= P_LO.burnTickLastApplied; patch.burnTickLastApplied = next.burnTickLastApplied; }
  if (prev.freezeUntilTick !== next.freezeUntilTick) { bitsLo |= P_LO.freezeUntilTick; patch.freezeUntilTick = next.freezeUntilTick; }
  if (prev.freezeMultiplier !== next.freezeMultiplier) { bitsLo |= P_LO.freezeMultiplier; patch.freezeMultiplier = next.freezeMultiplier; }
  if (prev.jetpackFuel !== next.jetpackFuel) { bitsLo |= P_LO.jetpackFuel; patch.jetpackFuel = next.jetpackFuel; }
  if (prev.shieldCharge !== next.shieldCharge) { bitsLo |= P_LO.shieldCharge; patch.shieldCharge = next.shieldCharge; }
  if (prev.shieldMaxCharge !== next.shieldMaxCharge) { bitsLo |= P_LO.shieldMaxCharge; patch.shieldMaxCharge = next.shieldMaxCharge; }
  if (prev.parryActiveUntilTick !== next.parryActiveUntilTick) { bitsLo |= P_LO.parryActiveUntilTick; patch.parryActiveUntilTick = next.parryActiveUntilTick; }
  if (prev.parryCooldownUntilTick !== next.parryCooldownUntilTick) { bitsLo |= P_LO.parryCooldownUntilTick; patch.parryCooldownUntilTick = next.parryCooldownUntilTick; }
  if (prev.parryFacing !== next.parryFacing) { bitsLo |= P_LO.parryFacing; patch.parryFacing = next.parryFacing; }
  if (prev.overchargeUntilTick !== next.overchargeUntilTick) { bitsLo |= P_LO.overchargeUntilTick; patch.overchargeUntilTick = next.overchargeUntilTick; }
  if (prev.damageAmpUntilTick !== next.damageAmpUntilTick) { bitsLo |= P_LO.damageAmpUntilTick; patch.damageAmpUntilTick = next.damageAmpUntilTick; }
  if (prev.speedBoostUntilTick !== next.speedBoostUntilTick) { bitsLo |= P_LO.speedBoostUntilTick; patch.speedBoostUntilTick = next.speedBoostUntilTick; }
  if (prev.meleeModeUntilTick !== next.meleeModeUntilTick) { bitsLo |= P_LO.meleeModeUntilTick; patch.meleeModeUntilTick = next.meleeModeUntilTick; }
  if (prev.slowDebuffUntilTick !== next.slowDebuffUntilTick) { bitsLo |= P_LO.slowDebuffUntilTick; patch.slowDebuffUntilTick = next.slowDebuffUntilTick; }

  if (prev.ammo !== next.ammo) { bitsHi |= P_HI.ammo; patch.ammo = next.ammo; }
  if (prev.vulnerabilityUntilTick !== next.vulnerabilityUntilTick) { bitsHi |= P_HI.vulnerabilityUntilTick; patch.vulnerabilityUntilTick = next.vulnerabilityUntilTick; }
  if (prev.blockJammerUntilTick !== next.blockJammerUntilTick) { bitsHi |= P_HI.blockJammerUntilTick; patch.blockJammerUntilTick = next.blockJammerUntilTick; }
  if (prev.bossModeUntilTick !== next.bossModeUntilTick) { bitsHi |= P_HI.bossModeUntilTick; patch.bossModeUntilTick = next.bossModeUntilTick; }

  // Always send abilityCharge and lastProcessedInputSeq (change almost every tick)
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
  // Strip bitmask keys before spreading so they don't pollute the entity.
  // Mirror of client/src/net/snapshotDelta.ts:applyPlayerPatch.
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

  if (prev.x !== next.x) { bits |= PROJ.x; patch.x = next.x; }
  if (prev.y !== next.y) { bits |= PROJ.y; patch.y = next.y; }
  if (prev.vx !== next.vx) { bits |= PROJ.vx; patch.vx = next.vx; }
  if (prev.vy !== next.vy) { bits |= PROJ.vy; patch.vy = next.vy; }
  if (prev.lifetimeMs !== next.lifetimeMs) { bits |= PROJ.lifetimeMs; patch.lifetimeMs = next.lifetimeMs; }
  if (prev.ageMs !== next.ageMs) { bits |= PROJ.ageMs; patch.ageMs = next.ageMs; }
  if (prev.traveledPx !== next.traveledPx) { bits |= PROJ.traveledPx; patch.traveledPx = next.traveledPx; }
  if (prev.returning !== next.returning) { bits |= PROJ.returning; patch.returning = next.returning; }
  if (prev.stickyFuseMs !== next.stickyFuseMs) { bits |= PROJ.stickyFuseMs; patch.stickyFuseMs = next.stickyFuseMs; }
  if (prev.bouncesRemaining !== next.bouncesRemaining) { bits |= PROJ.bouncesRemaining; patch.bouncesRemaining = next.bouncesRemaining; }
  if (prev.pierceRemaining !== next.pierceRemaining) { bits |= PROJ.pierceRemaining; patch.pierceRemaining = next.pierceRemaining; }
  if (prev.impact !== next.impact) { bits |= PROJ.impact; patch.impact = next.impact; }
  if (prev.impactRadiusPx !== next.impactRadiusPx) { bits |= PROJ.impactRadiusPx; patch.impactRadiusPx = next.impactRadiusPx; }
  if (prev.splitCount !== next.splitCount) { bits |= PROJ.splitCount; patch.splitCount = next.splitCount; }
  if (prev.slowMultiplier !== next.slowMultiplier) { bits |= PROJ.slowMultiplier; patch.slowMultiplier = next.slowMultiplier; }
  if (prev.homingStrength !== next.homingStrength) { bits |= PROJ.homingStrength; patch.homingStrength = next.homingStrength; }
  if (prev.accelerationMultiplier !== next.accelerationMultiplier) { bits |= PROJ.accelerationMultiplier; patch.accelerationMultiplier = next.accelerationMultiplier; }
  if (prev.gravityScale !== next.gravityScale) { bits |= PROJ.gravityScale; patch.gravityScale = next.gravityScale; }

  if (bits === 0) return null;
  return { bits, patch };
}

// ─── Destructible diff ────────────────────────────────────────────────────────

function diffDestructible(
  prev: DestructibleEntity,
  next: DestructibleEntity,
): { bits: number; patch: Partial<DestructibleEntity> } | null {
  if (prev.health === next.health) return null;
  return { bits: DESTR.health, patch: { health: next.health } };
}

// ─── Fire diff ────────────────────────────────────────────────────────────────

function diffFire(
  prev: FireEntity,
  next: FireEntity,
): { bits: number; patch: Partial<FireEntity> } | null {
  if (prev.remainingMs === next.remainingMs) return null;
  return { bits: FIRE.remainingMs, patch: { remainingMs: next.remainingMs } };
}

// ─── Pickup diff ──────────────────────────────────────────────────────────────

function diffPickup(
  prev: PickupEntity,
  next: PickupEntity,
): { bits: number; patch: Partial<PickupEntity> } | null {
  let bits = 0;
  const patch: Partial<PickupEntity> = {};
  if (prev.active !== next.active) { bits |= PICKUP.active; patch.active = next.active; }
  if (prev.respawnAtTick !== next.respawnAtTick) { bits |= PICKUP.respawnAtTick; patch.respawnAtTick = next.respawnAtTick; }
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
  if (prev.angle !== next.angle) { bits |= SAT.angle; patch.angle = next.angle; }
  if (prev.fireCooldownMs !== next.fireCooldownMs) { bits |= SAT.fireCooldownMs; patch.fireCooldownMs = next.fireCooldownMs; }
  if (prev.lifetimeMs !== next.lifetimeMs) { bits |= SAT.lifetimeMs; patch.lifetimeMs = next.lifetimeMs; }
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

  // Apply additions
  for (const [k, v] of Object.entries(delta.added) as [K, V][]) {
    out[k] = v;
  }

  // Apply updates
  for (const [k, upd] of Object.entries(delta.updated) as [K, EntityUpdate<V>][]) {
    const existing = out[k];
    if (existing !== undefined) {
      out[k] = applyUpdate(existing, upd);
    }
  }

  // Apply removals
  for (const k of delta.removed) {
    delete out[k];
  }

  return out;
}
