// Single source of truth for the snapshot-delta bitmask layout.
// Both client/src/net/snapshotDelta.ts and server/src/snapshotDelta.ts MUST
// import from here so wire-format changes are made in exactly one place.
//
// History: bug N1 (a server-only bitmask leak that didn't exist on the client)
// existed because the two encoders carried independent copies of these consts.
// Centralising the layout closes the divergence-is-undetectable hole.
//
// Layout convention:
//   P_LO — PlayerEntity bits 0..30 (kept < 32 for safe JS bitwise int)
//   P_HI — PlayerEntity bits 0..3  (overflow bucket; cram into a second mask
//          rather than using BigInt)
//   PROJ, DESTR, FIRE, PICKUP, SAT — per entity-type bitmasks
//
// Adding a field: append a new bit; never re-number existing bits or you'll
// break replay/baseline compatibility on connected clients.

export const P_LO = {
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

export const P_HI = {
  ammo: 1 << 0,
  vulnerabilityUntilTick: 1 << 1,
  blockJammerUntilTick: 1 << 2,
  bossModeUntilTick: 1 << 3,
  grounded: 1 << 4,
  // One bit each, same "did this field change" convention as every other
  // P_LO/P_HI entry — the actual value (including 0/-1/+1) always rides in
  // the patch object, never in the bit pattern itself.
  touchingWallDir: 1 << 5,
  dashing: 1 << 6,
} as const;

export const PROJ = {
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

export const DESTR = {
  health: 1 << 0,
} as const;

export const FIRE = {
  remainingMs: 1 << 0,
} as const;

export const PICKUP = {
  active: 1 << 0,
  respawnAtTick: 1 << 1,
} as const;

export const SAT = {
  angle: 1 << 0,
  fireCooldownMs: 1 << 1,
  lifetimeMs: 1 << 2,
} as const;
