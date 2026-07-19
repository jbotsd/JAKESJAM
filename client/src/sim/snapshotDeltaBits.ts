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
  /** Six Axes Ward shell (sim-read damage gate, docs/six-axes-goal.md). */
  wardShellUntilTick: 1 << 7,
  /** Drafted actives (six-axes Layer 2): per-slot cooldowns + effect windows. */
  slot1CooldownUntilTick: 1 << 8,
  slot2CooldownUntilTick: 1 << 9,
  slot3CooldownUntilTick: 1 << 10,
  slot4CooldownUntilTick: 1 << 11,
  titheUntilTick: 1 << 12,
  veilUntilTick: 1 << 13,
  counterUntilTick: 1 << 14,
  /** Mid-round respawn timer (fast-respawn ruling, 2026-07-17). */
  respawnAtTick: 1 << 15,
  /** Geometrician catalog v1 (docs/class-ability-catalogs-v1.md, wizard-
   *  only). Bits 16..19 — well within the safe 31-bit JS bitwise range, no
   *  protocol/wire-width change (bitsHi is a plain `number`, not a packed
   *  byte). */
  sunlanceUntilTick: 1 << 16,
  facetTargetId: 1 << 17,
  facetMarkUntilTick: 1 << 18,
  overclockUntilTick: 1 << 19,
  /** Resonance (class-overhaul-workboard.md chunk 0.1, docs/classes-goal.md
   *  "Rotation system") — window + source kind stamped by every ability
   *  activation, six-axes and Geometrician-catalog kinds alike. */
  resonanceUntilTick: 1 << 20,
  resonanceSourceKind: 1 << 21,
  /** Kindred catalog v1 (docs/class-ability-catalogs-v1.md, paladin-only —
   *  class-overhaul-workboard.md chunk 2.6). Bits 22..25 — same "plain
   *  number, no protocol change" headroom as the Geometrician block above. */
  judgmentTargetId: 1 << 22,
  judgmentMarkUntilTick: 1 << 23,
  sealUntilTick: 1 << 24,
  aegisShareUntilTick: 1 << 25,
  /** Syzygist status substrate extension (class-overhaul-workboard.md
   *  chunk 3.1) — regen (heal-over-time) and haste (move/fire-rate) windows,
   *  the first BUFF fields a DIFFERENT player's cast can write onto this
   *  entity. Bits 26..29 — same "plain number, no protocol change" headroom
   *  as the Geometrician/Kindred blocks above. */
  regenUntilTick: 1 << 26,
  regenHps: 1 << 27,
  hasteUntilTick: 1 << 28,
  hasteMultiplier: 1 << 29,
  /** Syzygist Ward (class-overhaul-workboard.md chunk 3.3) — the LAST free
   *  bit in this 32-bit mask (bit 31 would go negative in JS's signed
   *  32-bit bitwise ops, per this file's own header note: "kept < 32 for
   *  safe JS bitwise int"). A deliberate budget-driven consolidation: THREE
   *  fields (`wardAbsorbUntilTick`, `wardAbsorbRemaining`,
   *  `wardAbsorbSourceId`) share this ONE bit rather than each getting its
   *  own — they're always written together by `applyWardToAlly` (or the
   *  self-cast catalog cases), so a change to any one of them always rides
   *  the same patch as the other two; unlike `facetTargetId`/
   *  `judgmentTargetId`, which each got a dedicated bit earlier in this
   *  file when budget allowed, this is the honest "we ran out of headroom"
   *  call, not a stylistic inconsistency. */
  wardAbsorb: 1 << 30,
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

/**
 * Paper Double (Interstice catalog v1 — types.ts's `PaperDoubleEntity`).
 * Unlike its self-only ability-window PlayerEntity siblings, a decoy is a
 * cross-visible world entity an enemy needs to SEE to shoot — same category
 * as FireEntity/SatelliteEntity above, so it gets its own dedicated
 * collection-delta bitmask rather than riding PlayerEntity's own P_HI
 * (which had no free bits left anyway — see that mask's own "LAST free bit"
 * comment). `id`/`ownerId` are static after creation (sent once, in
 * `added`, never in `updated` — same convention every other entity type's
 * immutable fields already follow); `x`/`y`/`health`/`remainingMs` change
 * every tick the decoy is alive. `vx`/`vy` are fixed for the decoy's whole
 * life (set once at cast) — also static, not tracked here.
 */
export const PAPER_DOUBLE = {
  x: 1 << 0,
  y: 1 << 1,
  health: 1 << 2,
  remainingMs: 1 << 3,
} as const;
