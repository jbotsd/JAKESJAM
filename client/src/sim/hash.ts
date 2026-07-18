// FNV1a-32 hashing for per-entity snapshot reconciliation.
//
// The hash gives the reconcile loop a cheap way to skip replaying entities
// whose predicted state already matches the incoming authoritative snapshot.
// Correctness is maintained by a FULL_RECONCILE_INTERVAL_MS safety sweep in
// clientLoop.ts — any false-positive collision is corrected within 5 seconds.
//
// All functions are pure and allocation-free (operate on numbers only).

import { STEP_MS } from './constants.js';
import { EntityId, PlayerId } from './types.js';
import type { PlayerEntity, ProjectileEntity, WorldState } from './types.js';

// ---------------------------------------------------------------------------
// FNV1a-32 primitives
// ---------------------------------------------------------------------------

const FNV1A_PRIME_32 = 0x01000193;
const FNV1A_BASIS_32 = 0x811c9dc5;

/**
 * Mix one byte into a running FNV1a-32 hash.
 * Kept to 32-bit unsigned arithmetic throughout.
 */
function fnv1aMix(hash: number, byte: number): number {
  return (Math.imul(hash ^ (byte & 0xff), FNV1A_PRIME_32) ^ (FNV1A_BASIS_32 >>> 16)) >>> 0;
}

/**
 * Mix a 32-bit integer (all four bytes, little-endian) into the hash.
 * Using a fixed byte order makes the result platform-independent.
 */
function mixU32(hash: number, v: number): number {
  const n = v >>> 0; // coerce to uint32
  hash = fnv1aMix(hash, n & 0xff);
  hash = fnv1aMix(hash, (n >>> 8) & 0xff);
  hash = fnv1aMix(hash, (n >>> 16) & 0xff);
  hash = fnv1aMix(hash, (n >>> 24) & 0xff);
  return hash;
}

/**
 * Quantise a floating-point number to a fixed grid before hashing.
 * `grid` must be a positive number (e.g. 0.01 for centimetre precision).
 * Returns a signed 32-bit integer safe for mixU32.
 */
function quantise(value: number, grid: number): number {
  return Math.round(value / grid) | 0;
}

/**
 * Quantise to the nearest STEP_MS multiple (approx 16.67 ms → integer).
 */
function quantiseMs(value: number): number {
  return Math.round(value / STEP_MS) | 0;
}

// ---------------------------------------------------------------------------
// Per-entity hash functions
// ---------------------------------------------------------------------------

/**
 * FNV1a-32 hash of a PlayerEntity's simulation-relevant fields.
 * Field inclusion and quantisation grid are fixed; changes here will break
 * determinism for any snapshot that was hashed under the old encoding.
 *
 * Fields mixed (in this order):
 *   x (0.01), y (0.01), vx (0.01), vy (0.01),
 *   health (int), alive (0/1),
 *   cards.length,
 *   fireCooldownMs (STEP_MS grid),
 *   abilityCharge (int), energy (int, ninja class resource),
 *   overchargeUntilTick (int), damageAmpUntilTick (int),
 *   speedBoostUntilTick (int), meleeModeUntilTick (int),
 *   slowDebuffUntilTick (int), vulnerabilityUntilTick (int),
 *   blockJammerUntilTick (int), bossModeUntilTick (int),
 *   wardShellUntilTick (int), slot1..4CooldownUntilTick (int),
 *   titheUntilTick (int), veilUntilTick (int), counterUntilTick (int),
 *   respawnAtTick (int), sunlanceUntilTick (int), facetMarkUntilTick (int),
 *   overclockUntilTick (int), resonanceUntilTick (int), grounded (0/1).
 *
 * Fields deliberately skipped: aimX/aimY (presentation only, changes every
 * frame without gameplay consequence), lastProcessedInputSeq (reconcile
 * bookkeeping on server side, not local prediction state),
 * shieldActive / crouching (derived from input each tick — fast-path collision
 * unchanged by their omission since any divergence in those booleans always
 * accompanies a position/velocity divergence within one step).
 */
export function hashPlayerEntity(p: PlayerEntity): number {
  let h = FNV1A_BASIS_32;

  h = mixU32(h, quantise(p.x, 0.01));
  h = mixU32(h, quantise(p.y, 0.01));
  h = mixU32(h, quantise(p.vx, 0.01));
  h = mixU32(h, quantise(p.vy, 0.01));
  h = mixU32(h, Math.round(p.health) | 0);
  h = mixU32(h, p.alive ? 1 : 0);
  h = mixU32(h, p.cards.length | 0);
  h = mixU32(h, quantiseMs(p.fireCooldownMs));
  h = mixU32(h, Math.round(p.abilityCharge) | 0);
  h = mixU32(h, Math.round(p.energy ?? 0) | 0);

  // Optional tick-based buffs — treat absent as 0 (no buff active).
  h = mixU32(h, (p.overchargeUntilTick ?? 0) | 0);
  h = mixU32(h, (p.damageAmpUntilTick ?? 0) | 0);
  h = mixU32(h, (p.speedBoostUntilTick ?? 0) | 0);
  h = mixU32(h, (p.meleeModeUntilTick ?? 0) | 0);
  h = mixU32(h, (p.slowDebuffUntilTick ?? 0) | 0);
  h = mixU32(h, (p.vulnerabilityUntilTick ?? 0) | 0);
  h = mixU32(h, (p.blockJammerUntilTick ?? 0) | 0);
  h = mixU32(h, (p.bossModeUntilTick ?? 0) | 0);
  // Ward shell (six-axes Layer 1) — sim-read damage gate, same absent-as-0
  // treatment as the buff ticks above.
  h = mixU32(h, (p.wardShellUntilTick ?? 0) | 0);
  // Drafted actives (six-axes Layer 2): slot cooldowns + Tithe window.
  h = mixU32(h, (p.slot1CooldownUntilTick ?? 0) | 0);
  h = mixU32(h, (p.slot2CooldownUntilTick ?? 0) | 0);
  h = mixU32(h, (p.slot3CooldownUntilTick ?? 0) | 0);
  h = mixU32(h, (p.slot4CooldownUntilTick ?? 0) | 0);
  h = mixU32(h, (p.titheUntilTick ?? 0) | 0);
  h = mixU32(h, (p.veilUntilTick ?? 0) | 0);
  h = mixU32(h, (p.counterUntilTick ?? 0) | 0);
  h = mixU32(h, (p.respawnAtTick ?? 0) | 0);
  // Geometrician catalog v1 (docs/class-ability-catalogs-v1.md). Same
  // absent-as-0 treatment; facetTargetId (a PlayerId string) is deliberately
  // NOT mixed — its practical divergence is fully captured by
  // facetMarkUntilTick (set once, deterministically, at the same cast tick
  // on both client-predicted and server-authoritative paths), matching the
  // file's existing precedent of not hashing id-typed fields (weaponId,
  // characterId) that are set once rather than diverging per-tick.
  h = mixU32(h, (p.sunlanceUntilTick ?? 0) | 0);
  h = mixU32(h, (p.facetMarkUntilTick ?? 0) | 0);
  h = mixU32(h, (p.overclockUntilTick ?? 0) | 0);
  // Resonance (class-overhaul-workboard.md chunk 0.1). Same absent-as-0
  // treatment; resonanceSourceKind (a string) is deliberately NOT mixed,
  // same precedent as facetTargetId above — it's set deterministically off
  // the same input edge that already drives resonanceUntilTick, so any
  // divergence in "which kind resonated" would necessarily accompany a
  // divergence in resonanceUntilTick itself (or an earlier hashed field).
  h = mixU32(h, (p.resonanceUntilTick ?? 0) | 0);
  // Render-only flag, but per-entity reconcile uses this hash to detect
  // divergence; without grounded mixed in, a remote rig that just landed
  // would NOT trigger reconcile and would keep its stale grounded=false
  // until something else on the entity changed.
  h = mixU32(h, p.grounded ? 1 : 0);

  return h;
}

/**
 * FNV1a-32 hash of a ProjectileEntity's simulation-relevant fields.
 *
 * Fields mixed (in this order):
 *   x (0.01), y (0.01), vx (0.01), vy (0.01),
 *   bouncesRemaining (int), pierceRemaining (int),
 *   ageMs (STEP_MS grid, 0 if absent).
 *
 * Fields deliberately skipped: stickyFuseMs / returning (internal lifecycle
 * state that diverges only when the outer positional fields also diverge —
 * captured there instead). splitCount / homingStrength / etc. are spawn-time
 * config constants that cannot diverge between client and server if the
 * projectile was spawned from the same input.
 */
export function hashProjectileEntity(p: ProjectileEntity): number {
  let h = FNV1A_BASIS_32;

  h = mixU32(h, quantise(p.x, 0.01));
  h = mixU32(h, quantise(p.y, 0.01));
  h = mixU32(h, quantise(p.vx, 0.01));
  h = mixU32(h, quantise(p.vy, 0.01));
  h = mixU32(h, p.bouncesRemaining | 0);
  h = mixU32(h, p.pierceRemaining | 0);
  h = mixU32(h, quantiseMs(p.ageMs ?? 0));

  return h;
}

// ---------------------------------------------------------------------------
// World-level hash table
// ---------------------------------------------------------------------------

export type WorldHashLite = {
  players: Record<PlayerId, number>;
  projectiles: Record<EntityId, number>;
};

/**
 * Hash every player and projectile in a WorldState.
 * Returned records use the same branded id types as the original maps.
 * Allocation cost: two plain objects + one number entry per entity.
 */
export function hashWorldStateLite(s: WorldState): WorldHashLite {
  const players = {} as Record<PlayerId, number>;
  const projectiles = {} as Record<EntityId, number>;

  for (const pidStr in s.players) {
    const pid = PlayerId(pidStr);
    const p = s.players[pid];
    if (p !== undefined) players[pid] = hashPlayerEntity(p);
  }

  for (const eidStr in s.projectiles) {
    const eid = EntityId(+eidStr);
    const pr = s.projectiles[eid];
    if (pr !== undefined) projectiles[eid] = hashProjectileEntity(pr);
  }

  return { players, projectiles };
}
