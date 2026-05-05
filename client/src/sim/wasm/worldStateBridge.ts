// Phase G2 — TS ↔ wasm WorldState bridge.
//
// This module is the byte-level codec for the WorldState extern
// struct laid down in sim/src/world_state.zig (G1a-G1c). One side
// is the canonical TS shape from client/src/sim/types.ts; the
// other is the byte-stable wire format that step_world (Phase I)
// will mutate in place.
//
// Round-trip property: pack(state) followed by unpack(bytes)
// reproduces an EQUIVALENT TS state. Equivalent (not identical)
// because the TS form has Records keyed by branded ids while the
// wasm form has fixed-size arrays + counts; we sort entity ids
// during pack so unpack ordering is deterministic.
//
// Strings: PlayerIds and weapon ids are encoded as fixed-size
// u8 buffers + length prefix. Card ids are NOT yet packed (the
// `cards: string[]` field is encoded as count-only for the
// G1b struct; cards will land in a follow-on cut once we have
// the data side ported).
//
// Enums: TS uses string literals ('balanced', 'fighting',
// 'straight'); the wire uses u8 tags. The encode/decode tables
// below are the single source of truth for the mapping.

import {
  EntityId,
  PlayerId,
  Tick,
  InputSeq,
  type CharacterArchetype,
  type DestructibleEntity,
  type DestructibleKind,
  type ElementType,
  type FireEntity,
  type PickupEntity,
  type PickupKind,
  type PlayerEntity,
  type ProjectileEntity,
  type ProjectileImpact,
  type ProjectilePathing,
  type ProjectileShape,
  type RoundPhase,
  type RoundState,
  type SatelliteEntity,
  type WorldState,
} from "../types.js";

// -----------------------------------------------------------------
// Layout constants — must match sim/src/world_state.zig.

const HEADER_SIZE = 48;
const PLAYER_ENTITY_SIZE = 288;
const PROJECTILE_ENTITY_SIZE = 216;
const SATELLITE_ENTITY_SIZE = 96;
const DESTRUCTIBLE_ENTITY_SIZE = 64;
const FIRE_ENTITY_SIZE = 88;
const PICKUP_ENTITY_SIZE = 64;

const MAX_PLAYERS = 16;
const MAX_PROJECTILES = 256;
const MAX_SATELLITES = 32;
const MAX_DESTRUCTIBLES = 64;
const MAX_FIRE = 32;
const MAX_PICKUPS = 32;

const PLAYER_ID_BYTES = 32;
const WEAPON_ID_BYTES = 24;

// PER-ARRAY preamble: u32 count + 4-byte align-to-8 pad.
const ARRAY_PREAMBLE = 8;

export const WORLD_STATE_TOTAL_SIZE =
  HEADER_SIZE +
  ARRAY_PREAMBLE +
  MAX_PLAYERS * PLAYER_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_PROJECTILES * PROJECTILE_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_SATELLITES * SATELLITE_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_DESTRUCTIBLES * DESTRUCTIBLE_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_FIRE * FIRE_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_PICKUPS * PICKUP_ENTITY_SIZE;

// -----------------------------------------------------------------
// Enum tables. Order MUST match the enum(u8) declarations in
// world_state.zig.

const CHARACTER_ARCHETYPES = [
  "balanced",
  "heavy",
  "sprinter",
  "shielded",
] as const;

const ROUND_PHASES = [
  "countdown",
  "fighting",
  "round-over",
  "drafting",
] as const;

const PROJECTILE_PATHINGS = [
  "straight",
  "gravity",
  "bounce",
  "boomerang",
  "homing",
  "anti-homing",
  "float",
  "accelerate",
] as const;

const ELEMENT_TYPES = [
  "crystal",
  "neutral",
  "fire",
  "ice",
  "lightning",
  "void",
  "radiant",
  "electric",
  "toxic",
  "sticky",
  "explosive",
] as const;

const PROJECTILE_IMPACTS = [
  "none",
  "explosive",
  "sticky",
  "pierce-chain",
  "slow-field",
] as const;

const PROJECTILE_SHAPES = [
  "circle",
  "triangle",
  "square",
  "hexagon",
  "orb",
  "x",
  "bar",
] as const;

const DESTRUCTIBLE_KINDS = ["barrel", "box", "mine", "cube"] as const;

const PICKUP_KINDS = [
  "health-shard",
  "shield-cell",
  "overcharge-core",
  "damage-amp",
  "speed-boost",
  "melee-mode",
  "slow-trap",
  "vulnerability-trap",
  "block-jammer",
  "boss-core",
  "card-cache",
] as const;

/**
 * Order MUST match `CHAOS_MODIFIER_IDS` in
 * `client/src/sim/data/chaosModifiers.ts` AND the
 * `ChaosModifierId` enum in `sim/src/data/chaos.zig`. Bit N
 * corresponds to array index N.
 */
const CHAOS_MASK_ORDER = [
  "low-gravity",
  "slow-motion",
  "golden-gun",
  "slappers-only",
  "fire-hazard",
  "random-shapes",
  "max-recoil",
] as const;

function encodeChaosMask(ids: readonly string[] | undefined): number {
  if (!ids || ids.length === 0) return 0;
  let mask = 0;
  for (const id of ids) {
    const idx = (CHAOS_MASK_ORDER as readonly string[]).indexOf(id);
    if (idx >= 0) mask |= 1 << idx;
  }
  return mask >>> 0;
}

function decodeChaosMask(mask: number): string[] {
  if (mask === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < CHAOS_MASK_ORDER.length; i++) {
    if ((mask & (1 << i)) !== 0) out.push(CHAOS_MASK_ORDER[i]!);
  }
  return out;
}

function encEnum<T extends string>(
  table: readonly T[],
  value: T,
): number {
  const idx = table.indexOf(value);
  if (idx < 0) {
    throw new Error(`enum encode: unknown value "${value}"`);
  }
  return idx;
}

function decEnum<T extends string>(
  table: readonly T[],
  byte: number,
): T {
  const v = table[byte];
  if (v === undefined) {
    throw new Error(`enum decode: byte ${byte} out of range`);
  }
  return v;
}

// -----------------------------------------------------------------
// String <-> bytes helpers. Use ASCII-only encoding — every id in
// the codebase is ASCII so we avoid the encoding overhead.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

function writeString(
  view: DataView,
  offset: number,
  capacity: number,
  s: string,
): number {
  const bytes = textEncoder.encode(s);
  if (bytes.length > capacity) {
    throw new Error(
      `string length ${bytes.length} > capacity ${capacity} for "${s}"`,
    );
  }
  for (let i = 0; i < bytes.length; i++) {
    view.setUint8(offset + i, bytes[i]!);
  }
  for (let i = bytes.length; i < capacity; i++) {
    view.setUint8(offset + i, 0);
  }
  return bytes.length;
}

function readString(
  view: DataView,
  offset: number,
  length: number,
): string {
  const buf = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  return textDecoder.decode(buf);
}

// -----------------------------------------------------------------
// PlayerEntity codec.

const PLAYER_FLAG_BITS = {
  alive: 0,
  shieldActive: 1,
  crouching: 2,
  grounded: 3,
  hasSlow: 4,
  hasBurn: 5,
  hasFreeze: 6,
  hasShieldCharge: 7,
  hasParryActive: 8,
  hasParryCooldown: 9,
  hasOvercharge: 10,
  hasDamageAmp: 11,
  hasSpeedBoost: 12,
  hasMeleeMode: 13,
  hasSlowDebuff: 14,
  hasVulnerability: 15,
  hasBlockJammer: 16,
  hasBossMode: 17,
  hasJetpackFuel: 18,
  hasParryFacing: 19,
} as const;

function bit(flags: number, b: number): boolean {
  return ((flags >>> b) & 1) !== 0;
}

function set(flags: number, b: number, v: boolean | undefined): number {
  return v ? flags | (1 << b) : flags & ~(1 << b);
}

function packPlayer(view: DataView, offset: number, p: PlayerEntity): void {
  // f64 block — 17 fields, offsets 0..136
  let off = offset;
  const f = (v: number) => {
    view.setFloat64(off, v, true);
    off += 8;
  };
  f(p.x);
  f(p.y);
  f(p.vx);
  f(p.vy);
  f(p.aimX);
  f(p.aimY);
  f(p.health);
  f(p.fireCooldownMs);
  f(p.ammo);
  f(p.abilityCharge);
  f(p.jetpackFuel ?? 0);
  f(p.shieldCharge ?? 0);
  f(p.shieldMaxCharge ?? 0);
  f(p.parryFacing ?? 0);
  f(p.burnDps ?? 0);
  f(p.slowMultiplier ?? 0);
  f(p.freezeMultiplier ?? 0);

  // u32 block — 15 fields, 60 bytes
  const u = (v: number) => {
    view.setUint32(off, v >>> 0, true);
    off += 4;
  };
  u(p.slowedUntilTick ?? 0);
  u(p.burnUntilTick ?? 0);
  u(p.burnTickLastApplied ?? 0);
  u(p.freezeUntilTick ?? 0);
  u(p.parryActiveUntilTick ?? 0);
  u(p.parryCooldownUntilTick ?? 0);
  u(p.overchargeUntilTick ?? 0);
  u(p.damageAmpUntilTick ?? 0);
  u(p.speedBoostUntilTick ?? 0);
  u(p.meleeModeUntilTick ?? 0);
  u(p.slowDebuffUntilTick ?? 0);
  u(p.vulnerabilityUntilTick ?? 0);
  u(p.blockJammerUntilTick ?? 0);
  u(p.bossModeUntilTick ?? 0);
  u(p.lastProcessedInputSeq);

  // flags u32
  let flags = 0;
  flags = set(flags, PLAYER_FLAG_BITS.alive, p.alive);
  flags = set(flags, PLAYER_FLAG_BITS.shieldActive, p.shieldActive);
  flags = set(flags, PLAYER_FLAG_BITS.crouching, p.crouching);
  flags = set(flags, PLAYER_FLAG_BITS.grounded, p.grounded);
  flags = set(flags, PLAYER_FLAG_BITS.hasSlow, p.slowedUntilTick != null);
  flags = set(flags, PLAYER_FLAG_BITS.hasBurn, p.burnUntilTick != null);
  flags = set(flags, PLAYER_FLAG_BITS.hasFreeze, p.freezeUntilTick != null);
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasShieldCharge,
    p.shieldCharge != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasParryActive,
    p.parryActiveUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasParryCooldown,
    p.parryCooldownUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasOvercharge,
    p.overchargeUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasDamageAmp,
    p.damageAmpUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasSpeedBoost,
    p.speedBoostUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasMeleeMode,
    p.meleeModeUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasSlowDebuff,
    p.slowDebuffUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasVulnerability,
    p.vulnerabilityUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasBlockJammer,
    p.blockJammerUntilTick != null,
  );
  flags = set(
    flags,
    PLAYER_FLAG_BITS.hasBossMode,
    p.bossModeUntilTick != null,
  );
  flags = set(flags, PLAYER_FLAG_BITS.hasJetpackFuel, p.jetpackFuel != null);
  flags = set(flags, PLAYER_FLAG_BITS.hasParryFacing, p.parryFacing != null);
  view.setUint32(off, flags >>> 0, true);
  off += 4;

  view.setUint8(off, encEnum(CHARACTER_ARCHETYPES, p.characterId));
  off += 1;
  view.setUint8(off, p.cards.length & 0xff);
  off += 1;
  view.setUint8(off, 0);
  off += 1;
  view.setUint8(off, 0);
  off += 1;

  const idLen = textEncoder.encode(p.id).length;
  const wpnLen = textEncoder.encode(p.weaponId).length;
  view.setUint8(off, idLen & 0xff);
  off += 1;
  view.setUint8(off, wpnLen & 0xff);
  off += 1;
  for (let i = 0; i < 6; i++) {
    view.setUint8(off + i, 0);
  }
  off += 6;

  writeString(view, off, PLAYER_ID_BYTES, p.id);
  off += PLAYER_ID_BYTES;
  writeString(view, off, WEAPON_ID_BYTES, p.weaponId);
  off += WEAPON_ID_BYTES;

  // current_keys + prev_keys (Phase I4). Always zero here; the
  // caller patches the bytes between pack and step_world.
  view.setUint32(off, 0, true);
  off += 4;
  view.setUint32(off, 0, true);
  off += 4;

  // score (Phase I5) — encoded from state.round.scores[p.id].
  view.setUint32(off, 0, true); // populated by patcher per pack-callsite
  off += 4;

  // _reserved 4 bytes — leave zero.
}

function unpackPlayer(view: DataView, offset: number): PlayerEntity {
  let off = offset;
  const f = () => {
    const v = view.getFloat64(off, true);
    off += 8;
    return v;
  };
  const x = f();
  const y = f();
  const vx = f();
  const vy = f();
  const aimX = f();
  const aimY = f();
  const health = f();
  const fireCooldownMs = f();
  const ammo = f();
  const abilityCharge = f();
  const jetpackFuelRaw = f();
  const shieldChargeRaw = f();
  const shieldMaxChargeRaw = f();
  const parryFacingRaw = f();
  const burnDpsRaw = f();
  const slowMultiplierRaw = f();
  const freezeMultiplierRaw = f();

  const u = () => {
    const v = view.getUint32(off, true);
    off += 4;
    return v;
  };
  const slowedRaw = u();
  const burnUntilRaw = u();
  const burnTickLastRaw = u();
  const freezeUntilRaw = u();
  const parryActiveRaw = u();
  const parryCooldownRaw = u();
  const overchargeRaw = u();
  const damageAmpRaw = u();
  const speedBoostRaw = u();
  const meleeModeRaw = u();
  const slowDebuffRaw = u();
  const vulnRaw = u();
  const blockJammerRaw = u();
  const bossModeRaw = u();
  const lastProcessedInputSeq = u();

  const flags = view.getUint32(off, true);
  off += 4;
  const characterId = decEnum(
    CHARACTER_ARCHETYPES,
    view.getUint8(off),
  ) as CharacterArchetype;
  off += 1;
  const cardCount = view.getUint8(off);
  off += 1;
  off += 2; // pad

  const idLen = view.getUint8(off);
  off += 1;
  const wpnLen = view.getUint8(off);
  off += 1;
  off += 6; // pad

  const id = readString(view, off, idLen);
  off += PLAYER_ID_BYTES;
  const weaponId = readString(view, off, wpnLen);
  off += WEAPON_ID_BYTES;

  // current_keys + prev_keys + score + _reserved (Phase I4 + I5)
  // — skipped on unpack since the TS-side PlayerEntity doesn't
  // carry these fields directly. Score round-trips via
  // state.round.scores keyed by player id; orchestrator writes
  // back through the J0 shim if needed.
  off += 4 + 4 + 4 + 4;

  const out: PlayerEntity = {
    id: PlayerId(id),
    characterId,
    x,
    y,
    vx,
    vy,
    aimX,
    aimY,
    health,
    shieldActive: bit(flags, PLAYER_FLAG_BITS.shieldActive),
    crouching: bit(flags, PLAYER_FLAG_BITS.crouching),
    alive: bit(flags, PLAYER_FLAG_BITS.alive),
    weaponId,
    cards: new Array(cardCount).fill(""),
    fireCooldownMs,
    ammo,
    abilityCharge,
    lastProcessedInputSeq: InputSeq(lastProcessedInputSeq),
  };
  if (bit(flags, PLAYER_FLAG_BITS.grounded)) out.grounded = true;
  if (bit(flags, PLAYER_FLAG_BITS.hasSlow)) {
    out.slowedUntilTick = Tick(slowedRaw);
    out.slowMultiplier = slowMultiplierRaw;
  }
  if (bit(flags, PLAYER_FLAG_BITS.hasBurn)) {
    out.burnUntilTick = Tick(burnUntilRaw);
    out.burnDps = burnDpsRaw;
    out.burnTickLastApplied = Tick(burnTickLastRaw);
  }
  if (bit(flags, PLAYER_FLAG_BITS.hasFreeze)) {
    out.freezeUntilTick = Tick(freezeUntilRaw);
    out.freezeMultiplier = freezeMultiplierRaw;
  }
  if (bit(flags, PLAYER_FLAG_BITS.hasJetpackFuel)) out.jetpackFuel = jetpackFuelRaw;
  if (bit(flags, PLAYER_FLAG_BITS.hasShieldCharge)) {
    out.shieldCharge = shieldChargeRaw;
    out.shieldMaxCharge = shieldMaxChargeRaw;
  }
  if (bit(flags, PLAYER_FLAG_BITS.hasParryActive))
    out.parryActiveUntilTick = Tick(parryActiveRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasParryCooldown))
    out.parryCooldownUntilTick = Tick(parryCooldownRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasParryFacing))
    out.parryFacing = parryFacingRaw;
  if (bit(flags, PLAYER_FLAG_BITS.hasOvercharge))
    out.overchargeUntilTick = Tick(overchargeRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasDamageAmp))
    out.damageAmpUntilTick = Tick(damageAmpRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasSpeedBoost))
    out.speedBoostUntilTick = Tick(speedBoostRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasMeleeMode))
    out.meleeModeUntilTick = Tick(meleeModeRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasSlowDebuff))
    out.slowDebuffUntilTick = Tick(slowDebuffRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasVulnerability))
    out.vulnerabilityUntilTick = Tick(vulnRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasBlockJammer))
    out.blockJammerUntilTick = Tick(blockJammerRaw);
  if (bit(flags, PLAYER_FLAG_BITS.hasBossMode))
    out.bossModeUntilTick = Tick(bossModeRaw);
  return out;
}

// -----------------------------------------------------------------
// ProjectileEntity codec.

const PROJ_FLAG_BITS = {
  hasOwner: 0,
  hasImpact: 1,
  hasSplit: 2,
  hasSlow: 3,
  hasHoming: 4,
  hasAcceleration: 5,
  hasGravityScale: 6,
  hasRange: 7,
  hasAge: 8,
  hasTraveled: 9,
  hasOrigin: 10,
  returning: 11,
  hasStickyFuse: 12,
  hasImpactRadius: 13,
} as const;

function packProjectile(
  view: DataView,
  offset: number,
  p: ProjectileEntity,
): void {
  let off = offset;
  const f = (v: number) => {
    view.setFloat64(off, v, true);
    off += 8;
  };
  f(p.x);
  f(p.y);
  f(p.vx);
  f(p.vy);
  f(p.radius);
  f(p.damage);
  f(p.lifetimeMs);
  f(p.ageMs ?? 0);
  f(p.traveledPx ?? 0);
  f(p.originX ?? 0);
  f(p.originY ?? 0);
  f(p.homingStrength ?? 0);
  f(p.accelerationMultiplier ?? 0);
  f(p.gravityScale ?? 0);
  f(p.rangePx ?? 0);
  f(p.slowMultiplier ?? 0);
  f(p.stickyFuseMs ?? 0);
  f(p.impactRadiusPx ?? 0);

  const u = (v: number) => {
    view.setUint32(off, v >>> 0, true);
    off += 4;
  };
  u(p.id);
  u(p.bouncesRemaining);
  u(p.pierceRemaining);
  u(p.splitCount ?? 0);

  let flags = 0;
  flags = set(flags, PROJ_FLAG_BITS.hasOwner, p.ownerId != null);
  flags = set(flags, PROJ_FLAG_BITS.hasImpact, p.impact != null);
  flags = set(flags, PROJ_FLAG_BITS.hasSplit, p.splitCount != null);
  flags = set(flags, PROJ_FLAG_BITS.hasSlow, p.slowMultiplier != null);
  flags = set(flags, PROJ_FLAG_BITS.hasHoming, p.homingStrength != null);
  flags = set(
    flags,
    PROJ_FLAG_BITS.hasAcceleration,
    p.accelerationMultiplier != null,
  );
  flags = set(flags, PROJ_FLAG_BITS.hasGravityScale, p.gravityScale != null);
  flags = set(flags, PROJ_FLAG_BITS.hasRange, p.rangePx != null);
  flags = set(flags, PROJ_FLAG_BITS.hasAge, p.ageMs != null);
  flags = set(flags, PROJ_FLAG_BITS.hasTraveled, p.traveledPx != null);
  flags = set(
    flags,
    PROJ_FLAG_BITS.hasOrigin,
    p.originX != null && p.originY != null,
  );
  flags = set(flags, PROJ_FLAG_BITS.returning, p.returning ?? false);
  flags = set(flags, PROJ_FLAG_BITS.hasStickyFuse, p.stickyFuseMs != null);
  flags = set(
    flags,
    PROJ_FLAG_BITS.hasImpactRadius,
    p.impactRadiusPx != null,
  );
  view.setUint32(off, flags >>> 0, true);
  off += 4;

  view.setUint8(off, encEnum(PROJECTILE_PATHINGS, p.pathing));
  off += 1;
  view.setUint8(off, encEnum(ELEMENT_TYPES, p.element as ElementType));
  off += 1;
  view.setUint8(off, encEnum(PROJECTILE_IMPACTS, p.impact ?? "none"));
  off += 1;
  view.setUint8(off, encEnum(PROJECTILE_SHAPES, p.shape));
  off += 1;

  const ownerLen = p.ownerId
    ? textEncoder.encode(p.ownerId).length
    : 0;
  view.setUint8(off, ownerLen & 0xff);
  off += 1;
  for (let i = 0; i < 3; i++) view.setUint8(off + i, 0);
  off += 3;
  writeString(view, off, PLAYER_ID_BYTES, p.ownerId ?? "");
  off += PLAYER_ID_BYTES;
  // _reserved 12 bytes — leave zero.
}

function unpackProjectile(
  view: DataView,
  offset: number,
): ProjectileEntity {
  let off = offset;
  const f = () => {
    const v = view.getFloat64(off, true);
    off += 8;
    return v;
  };
  const x = f();
  const y = f();
  const vx = f();
  const vy = f();
  const radius = f();
  const damage = f();
  const lifetimeMs = f();
  const ageMsRaw = f();
  const traveledPxRaw = f();
  const originXRaw = f();
  const originYRaw = f();
  const homingStrengthRaw = f();
  const accelerationMultiplierRaw = f();
  const gravityScaleRaw = f();
  const rangePxRaw = f();
  const slowMultiplierRaw = f();
  const stickyFuseMsRaw = f();
  const impactRadiusPxRaw = f();

  const u = () => {
    const v = view.getUint32(off, true);
    off += 4;
    return v;
  };
  const id = u();
  const bouncesRemaining = u();
  const pierceRemaining = u();
  const splitCountRaw = u();
  const flags = view.getUint32(off, true);
  off += 4;

  const pathing = decEnum(
    PROJECTILE_PATHINGS,
    view.getUint8(off),
  ) as ProjectilePathing;
  off += 1;
  const element = decEnum(ELEMENT_TYPES, view.getUint8(off)) as ElementType;
  off += 1;
  const impactTag = decEnum(
    PROJECTILE_IMPACTS,
    view.getUint8(off),
  ) as ProjectileImpact;
  off += 1;
  const shape = decEnum(
    PROJECTILE_SHAPES,
    view.getUint8(off),
  ) as ProjectileShape;
  off += 1;

  const ownerLen = view.getUint8(off);
  off += 1;
  off += 3;
  const ownerId = bit(flags, PROJ_FLAG_BITS.hasOwner)
    ? PlayerId(readString(view, off, ownerLen))
    : null;
  off += PLAYER_ID_BYTES;

  const out: ProjectileEntity = {
    id: EntityId(id),
    ownerId,
    x,
    y,
    vx,
    vy,
    shape,
    radius,
    damage,
    lifetimeMs,
    pathing,
    element,
    bouncesRemaining,
    pierceRemaining,
  };
  if (bit(flags, PROJ_FLAG_BITS.hasImpact)) out.impact = impactTag;
  if (bit(flags, PROJ_FLAG_BITS.hasImpactRadius))
    out.impactRadiusPx = impactRadiusPxRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasSplit)) out.splitCount = splitCountRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasSlow))
    out.slowMultiplier = slowMultiplierRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasHoming))
    out.homingStrength = homingStrengthRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasAcceleration))
    out.accelerationMultiplier = accelerationMultiplierRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasGravityScale))
    out.gravityScale = gravityScaleRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasRange)) out.rangePx = rangePxRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasAge)) out.ageMs = ageMsRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasTraveled))
    out.traveledPx = traveledPxRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasOrigin)) {
    out.originX = originXRaw;
    out.originY = originYRaw;
  }
  if (bit(flags, PROJ_FLAG_BITS.returning)) out.returning = true;
  if (bit(flags, PROJ_FLAG_BITS.hasStickyFuse))
    out.stickyFuseMs = stickyFuseMsRaw;
  return out;
}

// -----------------------------------------------------------------
// SatelliteEntity codec.

function packSatellite(
  view: DataView,
  offset: number,
  s: SatelliteEntity,
): void {
  let off = offset;
  view.setFloat64(off, s.angle, true);
  off += 8;
  view.setFloat64(off, s.orbitRadius, true);
  off += 8;
  view.setFloat64(off, s.fireCooldownMs, true);
  off += 8;
  view.setFloat64(off, s.lifetimeMs, true);
  off += 8;
  view.setUint32(off, s.id, true);
  off += 4;
  view.setUint32(off, s.ownerId != null ? 1 : 0, true);
  off += 4;
  const ownerLen = s.ownerId ? textEncoder.encode(s.ownerId).length : 0;
  view.setUint8(off, ownerLen & 0xff);
  off += 1;
  for (let i = 0; i < 7; i++) view.setUint8(off + i, 0);
  off += 7;
  writeString(view, off, PLAYER_ID_BYTES, s.ownerId ?? "");
}

function unpackSatellite(view: DataView, offset: number): SatelliteEntity {
  let off = offset;
  const angle = view.getFloat64(off, true);
  off += 8;
  const orbitRadius = view.getFloat64(off, true);
  off += 8;
  const fireCooldownMs = view.getFloat64(off, true);
  off += 8;
  const lifetimeMs = view.getFloat64(off, true);
  off += 8;
  const id = view.getUint32(off, true);
  off += 4;
  const hasOwner = view.getUint32(off, true);
  off += 4;
  const ownerLen = view.getUint8(off);
  off += 1;
  off += 7;
  const ownerId = hasOwner ? PlayerId(readString(view, off, ownerLen)) : null;
  return {
    id: EntityId(id),
    ownerId,
    angle,
    orbitRadius,
    fireCooldownMs,
    lifetimeMs,
  };
}

// -----------------------------------------------------------------
// DestructibleEntity codec.

function packDestructible(
  view: DataView,
  offset: number,
  d: DestructibleEntity,
): void {
  let off = offset;
  view.setFloat64(off, d.x, true);
  off += 8;
  view.setFloat64(off, d.y, true);
  off += 8;
  view.setFloat64(off, d.width, true);
  off += 8;
  view.setFloat64(off, d.height, true);
  off += 8;
  view.setFloat64(off, d.health, true);
  off += 8;
  view.setUint32(off, d.id, true);
  off += 4;
  let f = 0;
  if (d.explosive) f |= 1;
  if (d.flammable) f |= 2;
  view.setUint32(off, f, true);
  off += 4;
  view.setUint8(off, encEnum(DESTRUCTIBLE_KINDS, d.kind));
}

function unpackDestructible(
  view: DataView,
  offset: number,
): DestructibleEntity {
  let off = offset;
  const x = view.getFloat64(off, true);
  off += 8;
  const y = view.getFloat64(off, true);
  off += 8;
  const width = view.getFloat64(off, true);
  off += 8;
  const height = view.getFloat64(off, true);
  off += 8;
  const health = view.getFloat64(off, true);
  off += 8;
  const id = view.getUint32(off, true);
  off += 4;
  const flags = view.getUint32(off, true);
  off += 4;
  const kind = decEnum(
    DESTRUCTIBLE_KINDS,
    view.getUint8(off),
  ) as DestructibleKind;
  return {
    id: EntityId(id),
    kind,
    x,
    y,
    width,
    height,
    health,
    explosive: (flags & 1) !== 0,
    flammable: (flags & 2) !== 0,
  };
}

// -----------------------------------------------------------------
// FireEntity codec.

function packFire(view: DataView, offset: number, f: FireEntity): void {
  let off = offset;
  view.setFloat64(off, f.x, true);
  off += 8;
  view.setFloat64(off, f.y, true);
  off += 8;
  view.setFloat64(off, f.radius, true);
  off += 8;
  view.setFloat64(off, f.remainingMs, true);
  off += 8;
  view.setFloat64(off, f.damagePerSecond, true);
  off += 8;
  view.setUint32(off, f.id, true);
  off += 4;
  view.setUint32(off, f.ownerId != null ? 1 : 0, true);
  off += 4;
  const ownerLen = f.ownerId ? textEncoder.encode(f.ownerId).length : 0;
  view.setUint8(off, ownerLen & 0xff);
  off += 1;
  for (let i = 0; i < 7; i++) view.setUint8(off + i, 0);
  off += 7;
  writeString(view, off, PLAYER_ID_BYTES, f.ownerId ?? "");
}

function unpackFire(view: DataView, offset: number): FireEntity {
  let off = offset;
  const x = view.getFloat64(off, true);
  off += 8;
  const y = view.getFloat64(off, true);
  off += 8;
  const radius = view.getFloat64(off, true);
  off += 8;
  const remainingMs = view.getFloat64(off, true);
  off += 8;
  const damagePerSecond = view.getFloat64(off, true);
  off += 8;
  const id = view.getUint32(off, true);
  off += 4;
  const hasOwner = view.getUint32(off, true);
  off += 4;
  const ownerLen = view.getUint8(off);
  off += 1;
  off += 7;
  const ownerId = hasOwner ? PlayerId(readString(view, off, ownerLen)) : null;
  return {
    id: EntityId(id),
    x,
    y,
    radius,
    remainingMs,
    ownerId,
    damagePerSecond,
  };
}

// -----------------------------------------------------------------
// PickupEntity codec.

function packPickup(view: DataView, offset: number, p: PickupEntity): void {
  let off = offset;
  view.setFloat64(off, p.x, true);
  off += 8;
  view.setFloat64(off, p.y, true);
  off += 8;
  view.setFloat64(off, p.radius, true);
  off += 8;
  view.setFloat64(off, p.amount, true);
  off += 8;
  view.setFloat64(off, p.durationMs ?? 0, true);
  off += 8;
  view.setFloat64(off, p.respawnMs ?? 0, true);
  off += 8;
  view.setUint32(off, p.id, true);
  off += 4;
  view.setUint32(off, p.respawnAtTick, true);
  off += 4;
  let f = 0;
  if (p.active) f |= 1;
  if (p.durationMs != null) f |= 2;
  if (p.respawnMs != null) f |= 4;
  view.setUint32(off, f, true);
  off += 4;
  view.setUint8(off, encEnum(PICKUP_KINDS, p.kind));
}

function unpackPickup(view: DataView, offset: number): PickupEntity {
  let off = offset;
  const x = view.getFloat64(off, true);
  off += 8;
  const y = view.getFloat64(off, true);
  off += 8;
  const radius = view.getFloat64(off, true);
  off += 8;
  const amount = view.getFloat64(off, true);
  off += 8;
  const durationMsRaw = view.getFloat64(off, true);
  off += 8;
  const respawnMsRaw = view.getFloat64(off, true);
  off += 8;
  const id = view.getUint32(off, true);
  off += 4;
  const respawnAtTick = view.getUint32(off, true);
  off += 4;
  const flags = view.getUint32(off, true);
  off += 4;
  const kind = decEnum(PICKUP_KINDS, view.getUint8(off)) as PickupKind;
  const out: PickupEntity = {
    id: EntityId(id),
    kind,
    x,
    y,
    radius,
    amount,
    active: (flags & 1) !== 0,
    respawnAtTick: Tick(respawnAtTick),
  };
  if ((flags & 2) !== 0) out.durationMs = durationMsRaw;
  if ((flags & 4) !== 0) out.respawnMs = respawnMsRaw;
  return out;
}

// -----------------------------------------------------------------
// World-level pack / unpack.

export function packWorldState(state: WorldState): Uint8Array {
  const buf = new Uint8Array(WORLD_STATE_TOTAL_SIZE);
  const view = new DataView(buf.buffer);
  let off = 0;

  // Header — 40 bytes (I2 added round_index + countdown_remaining_ms)
  view.setUint32(off, state.tick, true);
  off += 4;
  view.setUint32(off, state.rngState >>> 0, true);
  off += 4;
  view.setUint8(off, encEnum(ROUND_PHASES, state.round.phase));
  off += 1;
  off += 3;
  // next_entity_id + map_id stay placeholders until the
  // data-table-driven orchestrator owns them.
  view.setUint32(off, 0, true);
  off += 4;
  view.setUint32(off, 0, true);
  off += 4;
  // chaos_mask — encode chaosModifierIds[] into the bitmask the
  // wasm `chaos_profile_from_mask` resolver expects (Phase I3).
  view.setUint32(off, encodeChaosMask(state.chaosModifierIds), true);
  off += 4;
  view.setUint32(off, state.fireHazardTimerMs ?? 0, true);
  off += 4;
  view.setUint32(off, state.round.roundIndex >>> 0, true);
  off += 4;
  // target_score (I9). Default 0 = no match-end detection.
  view.setUint32(off, 0, true);
  off += 4;
  // match_winner_idx (I9). -1 = no winner; orchestrator writes
  // back. Encode -1 as 0xFFFFFFFF.
  view.setInt32(off, -1, true);
  off += 4;
  view.setFloat64(off, state.round.countdownRemainingMs, true);
  off += 8;

  // Players
  const players = Object.values(state.players).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  view.setUint32(off, players.length, true);
  off += 4;
  off += 4;
  const playersStart = off;
  for (let i = 0; i < players.length; i++) {
    packPlayer(view, playersStart + i * PLAYER_ENTITY_SIZE, players[i]!);
  }
  off = playersStart + MAX_PLAYERS * PLAYER_ENTITY_SIZE;

  // Projectiles
  const projectiles = Object.values(state.projectiles).sort(
    (a, b) => a.id - b.id,
  );
  view.setUint32(off, projectiles.length, true);
  off += 4;
  off += 4;
  const projStart = off;
  for (let i = 0; i < projectiles.length; i++) {
    packProjectile(
      view,
      projStart + i * PROJECTILE_ENTITY_SIZE,
      projectiles[i]!,
    );
  }
  off = projStart + MAX_PROJECTILES * PROJECTILE_ENTITY_SIZE;

  // Satellites
  const satellites = Object.values(state.satellites).sort(
    (a, b) => a.id - b.id,
  );
  view.setUint32(off, satellites.length, true);
  off += 4;
  off += 4;
  const satStart = off;
  for (let i = 0; i < satellites.length; i++) {
    packSatellite(view, satStart + i * SATELLITE_ENTITY_SIZE, satellites[i]!);
  }
  off = satStart + MAX_SATELLITES * SATELLITE_ENTITY_SIZE;

  // Destructibles
  const destructibles = Object.values(state.destructibles).sort(
    (a, b) => a.id - b.id,
  );
  view.setUint32(off, destructibles.length, true);
  off += 4;
  off += 4;
  const destStart = off;
  for (let i = 0; i < destructibles.length; i++) {
    packDestructible(
      view,
      destStart + i * DESTRUCTIBLE_ENTITY_SIZE,
      destructibles[i]!,
    );
  }
  off = destStart + MAX_DESTRUCTIBLES * DESTRUCTIBLE_ENTITY_SIZE;

  // Fire patches
  const fires = Object.values(state.firePatches).sort((a, b) => a.id - b.id);
  view.setUint32(off, fires.length, true);
  off += 4;
  off += 4;
  const fireStart = off;
  for (let i = 0; i < fires.length; i++) {
    packFire(view, fireStart + i * FIRE_ENTITY_SIZE, fires[i]!);
  }
  off = fireStart + MAX_FIRE * FIRE_ENTITY_SIZE;

  // Pickups
  const pickups = Object.values(state.pickups).sort((a, b) => a.id - b.id);
  view.setUint32(off, pickups.length, true);
  off += 4;
  off += 4;
  const pickupStart = off;
  for (let i = 0; i < pickups.length; i++) {
    packPickup(view, pickupStart + i * PICKUP_ENTITY_SIZE, pickups[i]!);
  }

  return buf;
}

export type UnpackedWorldState = {
  tick: Tick;
  rngState: number;
  round: Pick<RoundState, "phase" | "countdownRemainingMs" | "roundIndex">;
  chaosModifierIds?: string[];
  fireHazardTimerMs?: number;
  players: Record<PlayerId, PlayerEntity>;
  projectiles: Record<EntityId, ProjectileEntity>;
  satellites: Record<EntityId, SatelliteEntity>;
  destructibles: Record<EntityId, DestructibleEntity>;
  firePatches: Record<EntityId, FireEntity>;
  pickups: Record<EntityId, PickupEntity>;
};

export function unpackWorldState(buf: Uint8Array): UnpackedWorldState {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  const tick = Tick(view.getUint32(off, true));
  off += 4;
  const rngState = view.getUint32(off, true);
  off += 4;
  const phase = decEnum(ROUND_PHASES, view.getUint8(off)) as RoundPhase;
  off += 1;
  off += 3;
  off += 4 + 4; // next_entity_id, map_id (placeholders)
  const chaosMask = view.getUint32(off, true);
  off += 4;
  const chaosModifierIds = decodeChaosMask(chaosMask);
  const fireHazardTimerMs = view.getUint32(off, true);
  off += 4;
  const roundIndex = view.getUint32(off, true);
  off += 4;
  off += 4 + 4; // target_score + match_winner_idx (I9)
  const countdownRemainingMs = view.getFloat64(off, true);
  off += 8;

  const players: Record<PlayerId, PlayerEntity> = {} as Record<
    PlayerId,
    PlayerEntity
  >;
  const playerCount = view.getUint32(off, true);
  off += 4;
  off += 4;
  const playersStart = off;
  for (let i = 0; i < playerCount; i++) {
    const e = unpackPlayer(view, playersStart + i * PLAYER_ENTITY_SIZE);
    players[e.id] = e;
  }
  off = playersStart + MAX_PLAYERS * PLAYER_ENTITY_SIZE;

  const projectiles: Record<EntityId, ProjectileEntity> = {} as Record<
    EntityId,
    ProjectileEntity
  >;
  const projCount = view.getUint32(off, true);
  off += 4;
  off += 4;
  const projStart = off;
  for (let i = 0; i < projCount; i++) {
    const e = unpackProjectile(
      view,
      projStart + i * PROJECTILE_ENTITY_SIZE,
    );
    projectiles[e.id] = e;
  }
  off = projStart + MAX_PROJECTILES * PROJECTILE_ENTITY_SIZE;

  const satellites: Record<EntityId, SatelliteEntity> = {} as Record<
    EntityId,
    SatelliteEntity
  >;
  const satCount = view.getUint32(off, true);
  off += 4;
  off += 4;
  const satStart = off;
  for (let i = 0; i < satCount; i++) {
    const e = unpackSatellite(view, satStart + i * SATELLITE_ENTITY_SIZE);
    satellites[e.id] = e;
  }
  off = satStart + MAX_SATELLITES * SATELLITE_ENTITY_SIZE;

  const destructibles: Record<EntityId, DestructibleEntity> = {} as Record<
    EntityId,
    DestructibleEntity
  >;
  const destCount = view.getUint32(off, true);
  off += 4;
  off += 4;
  const destStart = off;
  for (let i = 0; i < destCount; i++) {
    const e = unpackDestructible(
      view,
      destStart + i * DESTRUCTIBLE_ENTITY_SIZE,
    );
    destructibles[e.id] = e;
  }
  off = destStart + MAX_DESTRUCTIBLES * DESTRUCTIBLE_ENTITY_SIZE;

  const firePatches: Record<EntityId, FireEntity> = {} as Record<
    EntityId,
    FireEntity
  >;
  const fireCount = view.getUint32(off, true);
  off += 4;
  off += 4;
  const fireStart = off;
  for (let i = 0; i < fireCount; i++) {
    const e = unpackFire(view, fireStart + i * FIRE_ENTITY_SIZE);
    firePatches[e.id] = e;
  }
  off = fireStart + MAX_FIRE * FIRE_ENTITY_SIZE;

  const pickups: Record<EntityId, PickupEntity> = {} as Record<
    EntityId,
    PickupEntity
  >;
  const pickupCount = view.getUint32(off, true);
  off += 4;
  off += 4;
  const pickupStart = off;
  for (let i = 0; i < pickupCount; i++) {
    const e = unpackPickup(view, pickupStart + i * PICKUP_ENTITY_SIZE);
    pickups[e.id] = e;
  }

  const out: UnpackedWorldState = {
    tick,
    rngState,
    round: { phase, countdownRemainingMs, roundIndex },
    players,
    projectiles,
    satellites,
    destructibles,
    firePatches,
    pickups,
  };
  if (chaosModifierIds.length > 0) out.chaosModifierIds = chaosModifierIds;
  if (fireHazardTimerMs !== 0) out.fireHazardTimerMs = fireHazardTimerMs;
  return out;
}
