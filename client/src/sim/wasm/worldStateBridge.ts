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
  type MeleeSwingMemory,
  type PlayerDraftMemory,
  type PlayerMovementMemory,
  type RoundPhase,
  type RoundState,
  type SatelliteEntity,
  type WorldState,
} from "../types.js";

// -----------------------------------------------------------------
// Layout constants — must match sim/src/world_state.zig.

// 48 → 56 (2026-07-20, Phase 2, docs/zig-step-world-parity-goal.md —
// draft/offer-roll system): +4 content bytes for
// WorldStateHeader.round_winner_idx (i32), rounded up to 56 by the
// trailing f64 (countdown_remaining_ms)'s own 8-byte alignment need — see
// world_state.zig's WorldStateHeader comptime assert.
export const HEADER_SIZE = 56;
// 288 → 296 (2026-07-18): +8 bytes for PlayerEntity.energy (ninja class
// resource) plus the 4-byte alignment pad Zig inserts before an f64 that
// follows a run of u32 tail fields. See world_state.zig's comptime assert
// and packPlayer/unpackPlayer's trailing energy read/write below.
// Exported (2026-07-18): several wasm ABI tests hand-computed buffer
// offsets by hardcoding `16 * 288` instead of importing this — exactly the
// "duplicated magic number" drift this file's own doctrine warns about
// elsewhere. Exporting it (and MAX_PLAYERS below) lets those tests derive
// the offset instead of re-hardcoding it, so the next struct-size change
// can't silently desync them again.
// 296 → 328 (2026-07-18, class-overhaul-workboard.md chunk 1.1): +25
// content bytes for PlayerEntity.teamId (team_id_len + team_id_bytes[24],
// appended after energy — no alignment pad needed, u8 fields don't require
// 8-byte alignment), rounded up to 328 by the struct's own trailing
// alignment padding (7 implicit bytes). See world_state.zig's comptime
// assert and packPlayer/unpackPlayer's trailing teamId read/write below.
// 328 → 336 (2026-07-18, class-overhaul-workboard.md chunk 2.3): +8 bytes
// for PlayerEntity.kindling (paladin class resource, f64) — reclaims the 7
// bytes of trailing padding above as real 8-byte alignment space for the
// new field rather than adding a fresh pad on top of a pad. See
// world_state.zig's comptime assert and packPlayer/unpackPlayer's trailing
// kindling read/write below.
// 336 → 360 (2026-07-18, class-overhaul-workboard.md chunk 3.1): +24 bytes
// for PlayerEntity.regen_until_tick/haste_until_tick (u32 x2, offsets
// [336,344)) + regen_hps/haste_multiplier (f64 x2, offsets [344,360)) — no
// alignment padding needed anywhere (336 and 344 are both already aligned
// for what follows). See world_state.zig's comptime assert and
// packPlayer/unpackPlayer's trailing regen/haste read/write below.
// 360 → 368 (2026-07-18, class-overhaul-workboard.md chunk 3.2): +8 bytes
// for PlayerEntity.devotion (f64, offset [360,368)) — 360 already 8-byte-
// aligned, no padding. See world_state.zig's comptime assert and
// packPlayer/unpackPlayer's trailing devotion read/write below.
// 368 → 384 (2026-07-18, class-overhaul-workboard.md chunk 3.3): +16 bytes
// for PlayerEntity.syz_ward_absorb_until_tick (u32, offset [368,372)) +
// syz_ward_absorb_remaining (f64, offset [376,384)) — 4 bytes of implicit
// alignment padding between the two (372 → 376). See world_state.zig's
// comptime assert and packPlayer/unpackPlayer's trailing Ward read/write
// below.
// 384 → 392 → 504 → 512 (2026-07-20, gap-closure + Phase 1 ability-cast
// dispatch + AOE-queue window passes, docs/zig-step-world-parity-goal.md):
// +8 for channel_hold_ms, +112 for the ability-slot cooldown/status window
// fields (slot_cooldown_until_tick[3], undercut/edge-storm/seal/second-wind/
// judgment/read-mark windows + judgment/read target ids), +8 for the
// AOE-queue window fields — see world_state.zig's PlayerEntity comptime
// assert for the full byte-by-byte accounting. The TS bridge doesn't pack/
// unpack these tail fields yet (packPlayer/unpackPlayer still stop at byte
// 384 — host-only state for now), but PLAYER_ENTITY_SIZE MUST reflect the
// true Zig stride or every downstream array (projectiles, satellites, ...)
// mis-aligns.
// 512 → 520 (Phase 5, docs/zig-step-world-parity-goal.md wire-contract
// cleanup): +4 content bytes for ward_shell_until_tick (u32) + 4 bytes of
// implicit tail padding (516 isn't 8-aligned) — see world_state.zig's
// PlayerEntity comptime assert. UNLIKE the 384→512 tail above (genuinely
// TS-only ability/window state, per six-axes-goal.md's "Zig line"),
// wardShellUntilTick IS wire-relevant on the TS side today (hash-mixed,
// hash.ts:127; delta-bit-tracked, snapshotDeltaBits.ts:64) — packPlayer/
// unpackPlayer crossing it is a real, scoped follow-up (not done by this
// cut), same "size correct now, field-level pack/unpack later" split every
// prior growth in this history used.
// 520 → 608 (Phase 4b+4c, docs/zig-step-world-parity-goal.md): +80 for
// Facet Break/Focus Hex's mark-tick + target-id fields (Phase 4b, see
// world_state.zig's own 528→608 comptime-assert accounting for the exact
// byte layout); Phase 4c (Slip Node/Plant Charge/Bulwark Step/Drift Step)
// added NO new PlayerEntity fields (instant resolves writing only
// pre-existing x/y/shield_charge), so no further growth from that pass.
// Both Phase 4 sub-agents were correctly scoped to sim/ only and flagged
// this exact staleness as a KNOWN GAP in their own commit messages — this
// closes it. Same "TS bridge doesn't pack/unpack these tail fields yet,
// but the SIZE must reflect the true Zig stride or every downstream array
// mis-aligns" contract as every prior growth in this history.
// 608 → 616 (Phase 4a follow-up, docs/zig-step-world-parity-goal.md — Kindled
// Resolve consumption pass): +4 content bytes for kindled_resolve_until_tick
// (u32); 608 was already 8-aligned so no leading pad, and being the sole
// trailing field leaves no further implicit pad needed at 616 either (a
// multiple of 8). Sub-agent scoped to sim/ only, per the now-established
// pattern — this closes the resulting TS-side staleness immediately rather
// than letting it sit as a known gap again.
// 616 → 624 (Phase 4 new-substrate pass, docs/zig-step-world-parity-goal.md
// — Ghost Guard/Bleed Tithe/Razor Route): ghost_guard_charge_until_tick
// reclaimed existing padding (net zero); razor_route_until_tick added +8
// real growth. Sub-agent scoped to sim/ only, per the now-established
// pattern — closing the resulting TS-side staleness immediately again.
// 624 → 624 (Track Z0b Item A, fast-respawn): respawn_at_tick (u32)
// reclaimed the razor-route cut's tail padding at offset 620 — net zero.
// UNLIKE the Zig-only tail fields above, this one IS packed/unpacked
// (packPlayer/unpackPlayer's skip-236-then-u32 tail — the full-sync path
// repacks every tick, so an unbridged respawn stamp would be wiped).
// 624 → 632 (Track Z0b Item B, muzzle-geometry port of 888345c):
// throw_hand_parity (u8) at offset 624 + 7 bytes explicit tail pad — the
// orphan branch's cut stole a then-free _reserved byte (size unchanged
// there), but that landing zone was consumed long ago (round_kills), so
// this port grows the struct instead. Packed/unpacked like
// respawn_at_tick (TS's weapon.ts toggles the SAME field on the
// TS-authoritative path — both sides must share one parity bit).
// 632 → 632 (Track Z0c Item A, Recoil Step deferral close-out):
// recoil_step_until_tick (u32) reclaimed the last 4 bytes of the muzzle
// port's explicit tail pad ([628, 632); _pad_throw_hand [7]u8 → [3]u8) —
// net zero. Packed/unpacked like respawn_at_tick (the window must survive
// the full-sync repack, and TS's ability cast opens the same window on the
// TS-authoritative path).
// 632 → 656 (Track Z1a item 3, ally substrate): rally_light_until_tick
// (632) + aegis_share_until_tick (636) + debt_until_tick (640) + 4-byte
// explicit pad + debt_amount f64 (648). All four packed/unpacked like
// respawn_at_tick — an unbridged window/debt would be wiped by the
// next full-sync repack and the four ally-targeted abilities could
// never hold state across ticks under live wasm authority.
// 656 → 656 (Track Z1b, no growth): the [384, 620) ability-window tail —
// every "TS bridge doesn't pack/unpack these tail fields yet" deferral in
// the history notes above — is now packed AND unpacked field-by-field
// (see packPlayer's tail-span comment). The wipe-on-repack consequence
// those notes deferred ("host-only state for now") had become the live
// bug multiSeedDivergence's Z1a header records as finding (a): every
// Phase-4 ability window was one-tick-only under full-sync wasm.
export const PLAYER_ENTITY_SIZE = 656;
const PROJECTILE_ENTITY_SIZE = 216;
const SATELLITE_ENTITY_SIZE = 96;
const DESTRUCTIBLE_ENTITY_SIZE = 64;
const FIRE_ENTITY_SIZE = 88;
const PICKUP_ENTITY_SIZE = 64;
// Paper Double decoys (2026-07-20 gap-closure pass item 3) — parallel to
// world_state.zig's PaperDoubleEntity/MAX_PAPER_DOUBLES. Not yet
// spawned/packed by the TS bridge; sized so downstream arrays stay aligned.
const PAPER_DOUBLE_ENTITY_SIZE = 96;
const MAX_PAPER_DOUBLES = 16;
// Must match sim/src/world_state.zig PlayerMovementMemory @sizeOf. Grew 24→40
// with the deep-movement augment memory (dash timers + counters), then 40→48
// with dash_recovery_ms (slide endlag). BRIDGED as of Track Z0e — the
// pack/unpack pair below reads and writes the array's contents (see
// packMovementMemory/unpackMovementMemory for the field offsets), so this
// stride is now both the skip distance AND the per-slot layout size.
export const PLAYER_MOVEMENT_MEMORY_SIZE = 48;
// Melee swing FSM memory (2026-07-20 base-melee-mechanic gap-closure pass)
// — parallel to players[], host-only/off-wire like PlayerMovementMemory.
// Must match world_state.zig's MeleeSwingMemory @sizeOf. BRIDGED as of
// Track Z1a (Z0e's sibling fix — see packMeleeSwingMemory below): the
// pack/unpack pair reads and writes the slots, so this stride is both the
// skip distance AND the per-slot layout size.
// 32 → 56 (2026-07-24, melee input buffer — slash-feel-ledger R1 row 1):
// +3 f64s (buffered_ms/buffered_aim_x/buffered_aim_y) inserted after
// aim_y; the mask/phase/dash tail shifts from offset 24 to 48 intact.
// 56 → 64 (2026-07-24, shield-bash chain): chain_index u8 reclaims the
// pad byte at offset 51; chain_gap_ms f64 appends at offset 56.
export const MELEE_SWING_MEMORY_SIZE = 64;
// I-final — ResolvedFireConfig parallel array (per-player fire
// build resolved by the host from createWeaponBuild). 14 × f64 +
// 4 × u32 + 4 × u8(enum) + 1 × u8(valid) + 3 × u8(pad) = 136.
export const RESOLVED_FIRE_CONFIG_SIZE = 248; // +14 augment fields (movement/shield/parry) +dash_cooldown_mul +recoil_impulse (Z0c Item A)
// Ability-slot equipment / card hand / per-round draft bookkeeping (Phase 2,
// docs/zig-step-world-parity-goal.md — draft/offer-roll system). Parallel to
// players[], host-only/off-wire like the rows above. Must match
// world_state.zig's EquippedActives/PlayerCardIds/PlayerDraftState @sizeOf.
const EQUIPPED_ACTIVES_SIZE = 3; // MAX_ABILITY_SLOTS
const PLAYER_CARD_IDS_SIZE = 8; // MAX_PLAYER_CARDS
// BRIDGED as of Track Z2 (the drafting bridge): packed from
// `WorldState.draftMemory` and unpacked back, so mid-draft offers/picks
// survive the hosts' every-tick repack — before this, the wasm-side
// drafting phase forgot every rolled offer and every landed pick one
// tick after it happened (same wipe-on-repack class as Z0e/Z1a/Z1b).
// Unlike equipped actives / card ids just above (build-resolved,
// host-re-delivered after every pack — see resolve_player_loadout),
// draft state is GENUINE per-round sim state with no TS mirror to
// re-derive from, so it gets the movementMemory-style carrier treatment.
export const PLAYER_DRAFT_STATE_SIZE = 4; // DRAFT_OFFER_COUNT + 1
export const DRAFT_OFFER_COUNT = 3;
// Deferred-write instant-AOE cast queue (2026-07-20 gap-closure pass) — must
// match world_state.zig's PendingInstantAoe/MAX_PENDING_INSTANT_AOE.
const PENDING_INSTANT_AOE_SIZE = 80;
const MAX_PENDING_INSTANT_AOE = 32;

export const MAX_PLAYERS = 16;
const MAX_STATICS = 256;
const AABB_SIZE = 32;
const MAX_PROJECTILES = 256;
const MAX_SATELLITES = 32;
const MAX_DESTRUCTIBLES = 64;
const MAX_FIRE = 32;
const MAX_PICKUPS = 32;

const PLAYER_ID_BYTES = 32;
const WEAPON_ID_BYTES = 24;
// Duos-queue team id (class-overhaul-workboard.md chunk 1.1) — same "medium
// generated id" bucket as WEAPON_ID_BYTES. Must match
// world_state.zig's TEAM_ID_BYTES.
const TEAM_ID_BYTES = 24;

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
  MAX_PICKUPS * PICKUP_ENTITY_SIZE +
  // Paper Double decoys (2026-07-20 gap-closure pass item 3): 4 count + 4
  // pad + N×PaperDoubleEntity.
  ARRAY_PREAMBLE +
  MAX_PAPER_DOUBLES * PAPER_DOUBLE_ENTITY_SIZE +
  // I14 — PlayerMovementMemory parallel array (no preamble; sized
  // by MAX_PLAYERS, indexed parallel to the players array).
  MAX_PLAYERS * PLAYER_MOVEMENT_MEMORY_SIZE +
  // Melee swing FSM memory (2026-07-20 base-melee-mechanic gap-closure
  // pass) — no preamble, parallel to players[].
  MAX_PLAYERS * MELEE_SWING_MEMORY_SIZE +
  // I-final — player_fire_config parallel array (no preamble;
  // host writes per tick from createWeaponBuild).
  MAX_PLAYERS * RESOLVED_FIRE_CONFIG_SIZE +
  // Phase 2 (docs/zig-step-world-parity-goal.md — draft/offer-roll system)
  // — equipped actives / card hand / per-round draft state, all parallel
  // to players[], no preambles.
  MAX_PLAYERS * EQUIPPED_ACTIVES_SIZE +
  MAX_PLAYERS * PLAYER_CARD_IDS_SIZE +
  MAX_PLAYERS * PLAYER_DRAFT_STATE_SIZE +
  // I15 — static AABB cache: 4 count + 4 pad + N×AABB +
  // N×u8 one_way + 4 tail pad.
  ARRAY_PREAMBLE +
  MAX_STATICS * AABB_SIZE +
  MAX_STATICS +
  4 +
  // Deferred-write instant-AOE cast queue (2026-07-20 gap-closure pass):
  // 4 count + 4 explicit pad + 4 IMPLICIT Zig alignment pad (statics
  // section above leaves this field at a non-8-aligned offset, and
  // PendingInstantAoe has f64 fields → needs 8-byte alignment for its
  // array) + N×PendingInstantAoe. This is the SAME "extra 4 bytes" the
  // events buffer below used to need before this section existed between
  // statics and events — the alignment requirement moved, the byte
  // didn't disappear. Verified empirically against the live wasm
  // sizeof_world_state() + a raw-memory event_count probe (2026-07-20).
  12 +
  MAX_PENDING_INSTANT_AOE * PENDING_INSTANT_AOE_SIZE +
  // I18 — events buffer: 4 count + 4 pad. No further implicit alignment
  // pad needed here anymore — the pending-AOE section above now absorbs
  // it, and this field's offset comes out 8-aligned on its own. + N×SimEvent.
  ARRAY_PREAMBLE +
  64 * 40;

// Byte offset of `player_movement[0]` within the packed WorldState
// (Track Z0e). Bridged (packed AND unpacked) since Z0e: the full-sync
// hosts overwrite the whole wasm-side WorldState buffer with
// packWorldState's output every tick, and before this array was bridged
// that pack left it ZERO-FILLED — Zig's stepPlayer ran every tick with
// grounded_last_frame=false and blank coyote/jump-buffer/air-jump/dash
// memory (air-acceleration on the ground, no ground friction, ground
// jumps impossible). Must equal wasm's `offset_player_movement()` export
// — movementMemoryBridge.test.ts asserts the two derivations agree.
export const PLAYER_MOVEMENT_OFFSET =
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
  MAX_PICKUPS * PICKUP_ENTITY_SIZE +
  ARRAY_PREAMBLE +
  MAX_PAPER_DOUBLES * PAPER_DOUBLE_ENTITY_SIZE;

/** Pack one PlayerMovementMemory into its 48-byte slot. Field offsets
 *  follow world_state.zig's PlayerMovementMemory extern struct exactly:
 *  five f64s (coyote, buffer, dash cooldown/active/recovery), then four
 *  u8 flags, then three i8 counters, then one pad byte. */
function packMovementMemory(
  view: DataView,
  offset: number,
  m: PlayerMovementMemory,
): void {
  view.setFloat64(offset + 0, m.coyoteMs, true);
  view.setFloat64(offset + 8, m.jumpBufferMs, true);
  view.setFloat64(offset + 16, m.dashCooldownMs, true);
  view.setFloat64(offset + 24, m.dashActiveMs, true);
  view.setFloat64(offset + 32, m.dashRecoveryMs, true);
  view.setUint8(offset + 40, m.jumpCutApplied ? 1 : 0);
  view.setUint8(offset + 41, m.jumpReleasedSinceJump ? 1 : 0);
  view.setUint8(offset + 42, m.groundedLastFrame ? 1 : 0);
  view.setUint8(offset + 43, m.jetpackActive ? 1 : 0);
  view.setInt8(offset + 44, m.touchingWallDir);
  view.setInt8(offset + 45, m.airJumpsUsed);
  view.setInt8(offset + 46, m.dashUsedInAir);
  // offset + 47: _pad — left zero (buf starts zero-filled).
}

function unpackMovementMemory(
  view: DataView,
  offset: number,
): PlayerMovementMemory {
  return {
    coyoteMs: view.getFloat64(offset + 0, true),
    jumpBufferMs: view.getFloat64(offset + 8, true),
    dashCooldownMs: view.getFloat64(offset + 16, true),
    dashActiveMs: view.getFloat64(offset + 24, true),
    dashRecoveryMs: view.getFloat64(offset + 32, true),
    jumpCutApplied: view.getUint8(offset + 40) !== 0,
    jumpReleasedSinceJump: view.getUint8(offset + 41) !== 0,
    groundedLastFrame: view.getUint8(offset + 42) !== 0,
    jetpackActive: view.getUint8(offset + 43) !== 0,
    touchingWallDir: view.getInt8(offset + 44),
    airJumpsUsed: view.getInt8(offset + 45),
    dashUsedInAir: view.getInt8(offset + 46),
  };
}

// Byte offset of `melee_swing[0]` within the packed WorldState (Track
// Z1a). Bridged for the same reason player_movement was in Z0e: the
// full-sync hosts repack the whole buffer every tick, and an unbridged
// slot means Zig's swing FSM resets to idle before every step — a windup
// can never mature, so ninja/paladin melee can never land under live
// wasm authority. Must equal wasm's `offset_melee_swing()` export —
// meleeSwingMemoryBridge.test.ts asserts the two derivations agree.
export const MELEE_SWING_OFFSET =
  PLAYER_MOVEMENT_OFFSET + MAX_PLAYERS * PLAYER_MOVEMENT_MEMORY_SIZE;

// Byte offset of `player_draft_state[0]` within the packed WorldState
// (Track Z2 — the drafting bridge). Bridged for the same reason as
// player_movement/melee_swing: the full-sync hosts repack the whole
// buffer every tick, and an unbridged slot means every rolled offer and
// every landed pick is wiped one tick later — the wasm drafting phase
// could never hold a draft open. Must equal wasm's
// `offset_player_draft_state()` export — draftOfferParity.test.ts
// asserts the two derivations agree. (The equipped-actives and card-ids
// arrays between melee_swing and this one stay unbridged: they are
// build-resolved data the host re-delivers after every pack via
// resolve_player_loadout.)
export const PLAYER_DRAFT_STATE_OFFSET =
  MELEE_SWING_OFFSET +
  MAX_PLAYERS * MELEE_SWING_MEMORY_SIZE +
  MAX_PLAYERS * RESOLVED_FIRE_CONFIG_SIZE +
  MAX_PLAYERS * EQUIPPED_ACTIVES_SIZE +
  MAX_PLAYERS * PLAYER_CARD_IDS_SIZE;

/** Pack one MeleeSwingMemory into its 64-byte slot. Field offsets follow
 *  world_state.zig's MeleeSwingMemory extern struct exactly: six f64s
 *  (phase_ms, aim_x, aim_y, buffered_ms, buffered_aim_x, buffered_aim_y),
 *  u16 hit mask, u8 phase enum, u8 bash chain index, u16 dash-through
 *  mask, two bool bytes, then the f64 chain-gap clock. */
function packMeleeSwingMemory(
  view: DataView,
  offset: number,
  m: MeleeSwingMemory,
): void {
  view.setFloat64(offset + 0, m.phaseMs, true);
  view.setFloat64(offset + 8, m.aimX, true);
  view.setFloat64(offset + 16, m.aimY, true);
  view.setFloat64(offset + 24, m.bufferedMs, true);
  view.setFloat64(offset + 32, m.bufferedAimX, true);
  view.setFloat64(offset + 40, m.bufferedAimY, true);
  view.setUint16(offset + 48, m.hitThisSwingMask, true);
  view.setUint8(offset + 50, m.phase);
  view.setUint8(offset + 51, m.chainIndex);
  view.setUint16(offset + 52, m.dashThroughTaggedMask, true);
  view.setUint8(offset + 54, m.wasDashing ? 1 : 0);
  view.setUint8(offset + 55, m.razorRouteActiveDash ? 1 : 0);
  view.setFloat64(offset + 56, m.chainGapMs, true);
}

function unpackMeleeSwingMemory(
  view: DataView,
  offset: number,
): MeleeSwingMemory {
  return {
    phaseMs: view.getFloat64(offset + 0, true),
    aimX: view.getFloat64(offset + 8, true),
    aimY: view.getFloat64(offset + 16, true),
    bufferedMs: view.getFloat64(offset + 24, true),
    bufferedAimX: view.getFloat64(offset + 32, true),
    bufferedAimY: view.getFloat64(offset + 40, true),
    hitThisSwingMask: view.getUint16(offset + 48, true),
    phase: (view.getUint8(offset + 50) & 3) as MeleeSwingMemory["phase"],
    chainIndex: view.getUint8(offset + 51),
    dashThroughTaggedMask: view.getUint16(offset + 52, true),
    wasDashing: view.getUint8(offset + 54) !== 0,
    razorRouteActiveDash: view.getUint8(offset + 55) !== 0,
    chainGapMs: view.getFloat64(offset + 56, true),
  };
}

/** The bytes a NEW player's slot gets when `state.meleeSwingMemory` has
 *  no entry for them — the exact mirror of world_state.zig's
 *  MeleeSwingMemory field defaults (`.{}`): idle FSM with aim_x=1. A
 *  zero-filled slot (the pre-Z1a status quo) differs in aim_x — a zero
 *  aim vector would feed atan2(0,0) into the first swing's arc check if
 *  any stale active window survived — so the default is written
 *  explicitly, same discipline as FRESH_MOVEMENT_MEMORY below. */
const FRESH_MELEE_SWING_MEMORY: MeleeSwingMemory = {
  phaseMs: 0,
  aimX: 1,
  aimY: 0,
  bufferedMs: 0,
  bufferedAimX: 0,
  bufferedAimY: 0,
  hitThisSwingMask: 0,
  phase: 0,
  chainIndex: 0,
  dashThroughTaggedMask: 0,
  wasDashing: false,
  razorRouteActiveDash: false,
  chainGapMs: 0,
};

/** The bytes a NEW player's slot gets when `state.movementMemory` has no
 *  entry for them — the exact mirror of player.ts's
 *  `freshPlayerMovementMemory()` (which the TS runtime lazily seeds for
 *  an unseen player): all zeros EXCEPT jumpReleasedSinceJump=true. A
 *  zero-filled slot (the pre-Z0e status quo) differs in that one byte —
 *  fresh-TS applies the jump-cut to an already-rising player, zeroed
 *  does not — so the fresh default is written explicitly. */
const FRESH_MOVEMENT_MEMORY: PlayerMovementMemory = {
  coyoteMs: 0,
  jumpBufferMs: 0,
  jumpCutApplied: false,
  jumpReleasedSinceJump: true,
  groundedLastFrame: false,
  jetpackActive: false,
  touchingWallDir: 0,
  airJumpsUsed: 0,
  dashCooldownMs: 0,
  dashUsedInAir: 0,
  dashActiveMs: 0,
  dashRecoveryMs: 0,
};

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
  // Truncate at the byte cap rather than throw. UUIDs in
  // production are 41 chars (UUID + `_4hmm` suffix) — well
  // beyond the 32-byte field. Truncation preserves enough prefix
  // for ≤16 players to remain unique in their first 32 chars,
  // which is all the wasm side uses these for (owner-match
  // comparisons during damage/event attribution).
  const writeLen = Math.min(bytes.length, capacity);
  for (let i = 0; i < writeLen; i++) {
    view.setUint8(offset + i, bytes[i]!);
  }
  for (let i = writeLen; i < capacity; i++) {
    view.setUint8(offset + i, 0);
  }
  return writeLen;
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
  // Duos-queue team identity (class-overhaul-workboard.md chunk 1.1) —
  // mirrors world_state.zig's PlayerFlags.has_team_id (bit 20).
  hasTeamId: 20,
  // Syzygist status substrate extension (class-overhaul-workboard.md chunk
  // 3.1) — mirrors world_state.zig's PlayerFlags.has_regen/has_haste
  // (bits 21-22).
  hasRegen: 21,
  hasHaste: 22,
  // Syzygist Ward (class-overhaul-workboard.md chunk 3.3) — mirrors
  // world_state.zig's PlayerFlags.has_syz_ward (bit 23). Devotion needs no
  // flag (always-valid resource, same "no gate" contract as energy/
  // kindling below).
  hasSyzWard: 23,
} as const;

function bit(flags: number, b: number): boolean {
  return ((flags >>> b) & 1) !== 0;
}

function set(flags: number, b: number, v: boolean | undefined): number {
  return v ? flags | (1 << b) : flags & ~(1 << b);
}

function packPlayer(
  view: DataView,
  offset: number,
  p: PlayerEntity,
  roundKills: number,
): void {
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
  flags = set(flags, PLAYER_FLAG_BITS.hasTeamId, p.teamId != null);
  flags = set(flags, PLAYER_FLAG_BITS.hasRegen, p.regenUntilTick != null);
  flags = set(flags, PLAYER_FLAG_BITS.hasHaste, p.hasteUntilTick != null);
  flags = set(flags, PLAYER_FLAG_BITS.hasSyzWard, p.wardAbsorbUntilTick != null);
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

  const idLen = Math.min(textEncoder.encode(p.id).length, PLAYER_ID_BYTES);
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
  // Written as 0 here and populated by a patcher per pack-callsite:
  // writeScoresIntoMemory in worldWasmBackend.ts (client) and
  // serverWasmHost.ts (server). Track Z0a NOTE: that patcher did NOT
  // exist until the 02b74f5 port — every pack silently wiped every
  // player's score each tick, permanently breaking match-end detection
  // and the sudden-death trigger on the wasm path. If you add a new
  // pack→step_world call site, it MUST call the patcher too.
  view.setUint32(off, 0, true);
  off += 4;

  // round_kills — per-round kill tally, mirrored from
  // state.round.roundKills[p.id] (packWorldState passes it in). Landed in
  // the former 4-byte _reserved tail (struct size was unchanged for THIS
  // field — energy below is what grew it 288 → 296). Matches world_state.zig
  // PlayerEntity.round_kills.
  view.setUint32(off, roundKills >>> 0, true);
  off += 4;

  // energy (2026-07-18, docs/classes-goal.md MANA section) — ninja class
  // resource, TS-owned like abilityCharge (physics step never touches it).
  // Zig's extern struct inserts 4 bytes of alignment padding here because
  // an f64 field follows a run of u32 fields at a non-8-aligned offset
  // (284 → 288); write that pad explicitly so the byte layout matches
  // world_state.zig's PlayerEntity.energy exactly. PLAYER_ENTITY_SIZE grew
  // 288 → 296 for this field (see comment on the constant).
  view.setUint32(off, 0, true); // alignment pad
  off += 4;
  view.setFloat64(off, p.energy ?? 0, true);
  off += 8;

  // teamId (2026-07-18, class-overhaul-workboard.md chunk 1.1) — duos-queue
  // team identity, identity/roster metadata (crosses the ABI, unlike
  // ability/window state — see PlayerEntity.teamId's doc comment in
  // types.ts). No alignment pad needed: u8 fields don't require 8-byte
  // alignment, so team_id_len sits directly after energy's f64. Mirrors
  // world_state.zig's PlayerEntity.team_id_len/team_id_bytes exactly.
  const teamIdLen = p.teamId
    ? Math.min(textEncoder.encode(p.teamId).length, TEAM_ID_BYTES)
    : 0;
  view.setUint8(off, teamIdLen & 0xff);
  off += 1;
  writeString(view, off, TEAM_ID_BYTES, p.teamId ?? "");
  off += TEAM_ID_BYTES;

  // kindling (2026-07-18, class-overhaul-workboard.md chunk 2.3) — paladin
  // class resource, TS-owned like energy/abilityCharge. team_id_bytes ends
  // at relative offset 321; an f64 needs 8-byte alignment, so Zig inserts a
  // 7-byte pad here (this WAS team_id_bytes's own trailing pad before
  // kindling existed — see world_state.zig's PlayerEntity.kindling doc
  // comment for the full "reclaimed padding" accounting). Write it
  // explicitly (zeros — pure alignment filler, never read) so the byte
  // layout matches exactly.
  for (let i = 0; i < 7; i++) view.setUint8(off + i, 0);
  off += 7;
  view.setFloat64(off, p.kindling ?? 0, true);
  off += 8;

  // Syzygist status substrate extension (2026-07-18, class-overhaul-
  // workboard.md chunk 3.1) — regen/haste windows, TS-owned/TS-applied
  // like energy/kindling (no alignment pad needed: kindling's f64 ends at
  // an 8-aligned offset, and two u32s followed by two f64s need no gap
  // from there either — see world_state.zig's PlayerEntity.regen_until_tick
  // doc comment for the exact accounting). Gated by the flags bits set
  // just above (hasRegen/hasHaste), same "unset vs tick 0" convention as
  // hasBurn/hasFreeze.
  view.setUint32(off, p.regenUntilTick ?? 0, true);
  off += 4;
  view.setUint32(off, p.hasteUntilTick ?? 0, true);
  off += 4;
  view.setFloat64(off, p.regenHps ?? 0, true);
  off += 8;
  view.setFloat64(off, p.hasteMultiplier ?? 0, true);
  off += 8;

  // Syzygist Devotion (2026-07-18, class-overhaul-workboard.md chunk 3.2)
  // — TS-owned resource, same "no alignment pad needed, no flag" contract
  // as energy/kindling: haste_multiplier's f64 ends at an 8-aligned
  // offset, so devotion needs no gap.
  view.setFloat64(off, p.devotion ?? 0, true);
  off += 8;

  // Syzygist Ward (2026-07-18, class-overhaul-workboard.md chunk 3.3) —
  // TS-owned/TS-applied window, same contract as regen/haste above. No
  // alignment pad before the u32 (devotion's f64 ends 4-aligned already);
  // a 4-byte pad IS needed before the trailing f64 (a lone u32 precedes
  // it) — write it explicitly, matching world_state.zig's
  // syz_ward_absorb_until_tick doc comment exactly.
  view.setUint32(off, p.wardAbsorbUntilTick ?? 0, true);
  off += 4;
  view.setUint32(off, 0, true); // alignment pad
  off += 4;
  view.setFloat64(off, p.wardAbsorbRemaining ?? 0, true);
  off += 8;

  // Ability-window tail span (world_state.zig channel_hold_ms →
  // razor_route_until_tick, relative offsets [384, 620)) — BRIDGED as of
  // Track Z1b. This used to be an `off += 236` skip ("step_world-internal
  // ability windows; the fresh pack buffer leaves them zero"), which
  // combined with the full-sync hosts' every-tick repack to WIPE every
  // Phase-4 ability window one tick after it opened — sunlance/overclock/
  // measure, facet/focus/judgment/read marks, kindled resolve, ghost
  // guard, razor route, seal, second wind, edge storm, wall bloom, shock
  // ring, ward shell, slot cooldowns, the wizard fire channel — the exact
  // wipe-on-repack bug class Z0e (movement memory) and Z1a (melee swing)
  // already closed for their families. CHOICE (over an off-wire opaque
  // carrier like movementMemory): field-level pack/unpack from the TS
  // PlayerEntity mirrors, because — unlike movement/melee memory, which
  // has no TS-entity mirror — every field in this span has an
  // identically-named optional field on the TS PlayerEntity (types.ts),
  // maintained by the TS-authoritative path. Field-level bridging keeps
  // ONE source of truth, works for windows opened on EITHER side, and is
  // the same precedent respawn_at_tick/recoil_step/the ally tail set.
  // Every offset below is pinned by a comptime @offsetOf assert in
  // world_state.zig next to the PLAYER_ENTITY_SIZE assert.
  view.setFloat64(off, p.channelHoldMs ?? 0, true); // 384
  off += 8;
  view.setUint32(off, p.slot1CooldownUntilTick ?? 0, true); // 392
  off += 4;
  view.setUint32(off, p.slot2CooldownUntilTick ?? 0, true);
  off += 4;
  view.setUint32(off, p.slot3CooldownUntilTick ?? 0, true);
  off += 4;
  view.setUint32(off, p.undercutUntilTick ?? 0, true); // 404
  off += 4;
  view.setUint32(off, p.edgeStormUntilTick ?? 0, true); // 408
  off += 4;
  view.setUint32(off, p.edgeStormChargesRemaining ?? 0, true); // 412
  off += 4;
  view.setUint32(off, p.sealUntilTick ?? 0, true); // 416
  off += 4;
  view.setUint32(off, p.secondWindUntilTick ?? 0, true); // 420
  off += 4;
  view.setUint32(off, p.judgmentMarkUntilTick ?? 0, true); // 424
  off += 4;
  view.setUint32(off, p.readMarkUntilTick ?? 0, true); // 428
  off += 4;
  // Mark target ids — length-prefixed fixed buffers, same convention as
  // the entity id/weapon id fields above (and Zig's own *_target_id_len
  // zero-length "no mark" sentinel).
  const judgmentIdLen = p.judgmentTargetId
    ? Math.min(textEncoder.encode(p.judgmentTargetId).length, PLAYER_ID_BYTES)
    : 0;
  view.setUint8(off, judgmentIdLen & 0xff); // 432
  off += 1;
  for (let i = 0; i < 3; i++) view.setUint8(off + i, 0); // _pad_judgment
  off += 3;
  writeString(view, off, PLAYER_ID_BYTES, p.judgmentTargetId ?? ""); // 436
  off += PLAYER_ID_BYTES;
  const readIdLen = p.readTargetId
    ? Math.min(textEncoder.encode(p.readTargetId).length, PLAYER_ID_BYTES)
    : 0;
  view.setUint8(off, readIdLen & 0xff); // 468
  off += 1;
  for (let i = 0; i < 3; i++) view.setUint8(off + i, 0); // _pad_read
  off += 3;
  writeString(view, off, PLAYER_ID_BYTES, p.readTargetId ?? ""); // 472
  off += PLAYER_ID_BYTES;
  view.setUint32(off, p.wallBloomUntilTick ?? 0, true); // 504
  off += 4;
  view.setUint32(off, p.shockRingArmedUntilTick ?? 0, true); // 508
  off += 4;
  view.setUint32(off, p.wardShellUntilTick ?? 0, true); // 512
  off += 4;
  view.setUint32(off, p.sunlanceUntilTick ?? 0, true); // 516
  off += 4;
  view.setUint32(off, p.overclockUntilTick ?? 0, true); // 520
  off += 4;
  view.setUint32(off, p.measureUntilTick ?? 0, true); // 524
  off += 4;
  view.setUint32(off, p.facetMarkUntilTick ?? 0, true); // 528
  off += 4;
  view.setUint32(off, p.focusHexMarkUntilTick ?? 0, true); // 532
  off += 4;
  const facetIdLen = p.facetTargetId
    ? Math.min(textEncoder.encode(p.facetTargetId).length, PLAYER_ID_BYTES)
    : 0;
  view.setUint8(off, facetIdLen & 0xff); // 536
  off += 1;
  for (let i = 0; i < 3; i++) view.setUint8(off + i, 0); // _pad_facet
  off += 3;
  writeString(view, off, PLAYER_ID_BYTES, p.facetTargetId ?? ""); // 540
  off += PLAYER_ID_BYTES;
  const focusHexIdLen = p.focusHexTargetId
    ? Math.min(textEncoder.encode(p.focusHexTargetId).length, PLAYER_ID_BYTES)
    : 0;
  view.setUint8(off, focusHexIdLen & 0xff); // 572
  off += 1;
  for (let i = 0; i < 3; i++) view.setUint8(off + i, 0); // _pad_focus_hex
  off += 3;
  writeString(view, off, PLAYER_ID_BYTES, p.focusHexTargetId ?? ""); // 576
  off += PLAYER_ID_BYTES;
  view.setUint32(off, p.kindledResolveUntilTick ?? 0, true); // 608
  off += 4;
  view.setUint32(off, p.ghostGuardChargeUntilTick ?? 0, true); // 612
  off += 4;
  view.setUint32(off, p.razorRouteUntilTick ?? 0, true); // 616
  off += 4;

  // respawn_at_tick (Track Z0b Item A, fast-respawn ruling 2026-07-17) —
  // the mid-round respawn stamp, parity with world_state.zig's
  // PlayerEntity.respawn_at_tick (which consumed the struct's former tail
  // pad). 0 = no scheduled respawn (a real stamp is always ≥ 1), mirroring
  // TS `undefined` — same sentinel convention as PickupEntity.respawnAtTick.
  // MUST round-trip: the full-sync path repacks every tick, so an
  // unbridged stamp would be wiped before it ever came due.
  view.setUint32(off, p.respawnAtTick ?? 0, true);
  off += 4;

  // throw_hand_parity (Track Z0b Item B, port of 888345c) — alternating-
  // hand shuriken throws, parity with weapon.ts's throwHandParity
  // (toggled once per FIRE EVENT; the muzzle position + fired angle
  // derive from it on both sides). `?? 1` mirrors TS's own unset
  // convention (`(throwHandParity ?? 1) ^ 1` — the first-ever shot
  // toggles to hand 0). 3 explicit pad bytes mirror world_state.zig's
  // `_pad_throw_hand` (625 → 628; shrunk from 7 when Z0c Item A reclaimed
  // the tail for recoil_step_until_tick below).
  view.setUint8(off, (p.throwHandParity ?? 1) & 1);
  off += 1;
  for (let i = 0; i < 3; i++) view.setUint8(off + i, 0);
  off += 3;

  // recoil_step_until_tick (Track Z0c Item A — Recoil Step's rider
  // window, the closed Phase 4a deferral). Bridged for the same reason as
  // respawn_at_tick: the full-sync path repacks every tick, so an
  // unbridged window would be wiped mid-flight. 0 = inactive, mirroring
  // TS `undefined`.
  view.setUint32(off, p.recoilStepUntilTick ?? 0, true);
  off += 4;

  // Ally-substrate tail (Track Z1a item 3): Rally Light / Aegis Share
  // windows + Borrowed Time's pending debt. Bridged like respawn_at_tick
  // (the full-sync path repacks every tick; TS's own casts open the same
  // windows on the TS-authoritative path). 0 = inactive/no-debt sentinel
  // for all three ticks, mirroring TS `undefined`.
  view.setUint32(off, p.rallyLightUntilTick ?? 0, true);
  off += 4;
  view.setUint32(off, p.aegisShareUntilTick ?? 0, true);
  off += 4;
  view.setUint32(off, p.debtUntilTick ?? 0, true);
  off += 4;
  view.setUint32(off, 0, true); // _pad_debt — f64 alignment
  off += 4;
  view.setFloat64(off, p.debtAmount ?? 0, true);
  off += 8;
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

  // current_keys + prev_keys + score + round_kills (Phase I4 + I5,
  // kill tally 2026-07-17) — skipped on unpack since the TS-side
  // PlayerEntity doesn't carry these fields directly. Score and
  // round_kills round-trip via state.round.scores / .roundKills keyed
  // by player id (extracted separately in unpackWorldState).
  off += 4 + 4 + 4 + 4;

  // energy (ninja class resource) — 4 bytes alignment pad then the f64,
  // mirroring the pack-side layout above and world_state.zig's
  // PlayerEntity.energy (appended after round_kills).
  off += 4; // alignment pad
  const energy = view.getFloat64(off, true);
  off += 8;

  // teamId (2026-07-18, class-overhaul-workboard.md chunk 1.1) — no
  // alignment pad needed (u8 fields don't require 8-byte alignment),
  // mirrors the pack-side layout and world_state.zig's
  // PlayerEntity.team_id_len/team_id_bytes (appended after energy).
  const teamIdLen = view.getUint8(off);
  off += 1;
  const teamId = readString(view, off, teamIdLen);
  off += TEAM_ID_BYTES;

  // kindling (2026-07-18, class-overhaul-workboard.md chunk 2.3) — paladin
  // class resource, TS-owned like energy. 7-byte alignment pad (team_id_bytes
  // ends at relative offset 321, the f64 needs offset 328 — see
  // world_state.zig's PlayerEntity.kindling doc comment) then the f64,
  // mirroring the pack-side layout above exactly. Always round-tripped
  // (no PlayerFlags gate bit), same "TS-owned resource, unconditionally
  // carried" precedent as energy just above.
  off += 7; // alignment pad
  const kindling = view.getFloat64(off, true);
  off += 8;

  // Syzygist status substrate extension (2026-07-18, class-overhaul-
  // workboard.md chunk 3.1) — no alignment pad needed (kindling's f64 ends
  // 8-aligned; the two u32s + two f64s that follow need no gap from
  // there — see world_state.zig's PlayerEntity.regen_until_tick doc
  // comment), mirrors the pack-side layout above exactly. Gated by
  // hasRegen/hasHaste below (unlike energy/kindling), same "unset vs tick
  // 0" convention as hasBurn/hasFreeze.
  const regenUntilRaw = view.getUint32(off, true);
  off += 4;
  const hasteUntilRaw = view.getUint32(off, true);
  off += 4;
  const regenHpsRaw = view.getFloat64(off, true);
  off += 8;
  const hasteMultiplierRaw = view.getFloat64(off, true);
  off += 8;

  // Syzygist Devotion (2026-07-18, class-overhaul-workboard.md chunk 3.2)
  // — no alignment pad needed (hasteMultiplier's f64 ends 8-aligned),
  // always round-tripped (no flag gate), same precedent as energy/kindling.
  const devotion = view.getFloat64(off, true);
  off += 8;

  // Syzygist Ward (2026-07-18, class-overhaul-workboard.md chunk 3.3) —
  // mirrors the pack-side layout exactly: u32 tick, 4-byte alignment pad,
  // then the f64 pool. Gated by hasSyzWard below.
  const syzWardUntilRaw = view.getUint32(off, true);
  off += 4;
  off += 4; // alignment pad
  const syzWardRemainingRaw = view.getFloat64(off, true);
  off += 8;

  // Ability-window tail span [384, 620) — BRIDGED as of Track Z1b, see
  // packPlayer's matching comment for the full rationale (field-level
  // mirror over an opaque carrier). Reads mirror the pack writes exactly;
  // sentinel decode (0/zero-length → undefined) happens below with the
  // other window fields.
  const channelHoldMsRaw = view.getFloat64(off, true); // 384
  off += 8;
  const slot1CooldownRaw = view.getUint32(off, true); // 392
  off += 4;
  const slot2CooldownRaw = view.getUint32(off, true);
  off += 4;
  const slot3CooldownRaw = view.getUint32(off, true);
  off += 4;
  const undercutUntilRaw = view.getUint32(off, true); // 404
  off += 4;
  const edgeStormUntilRaw = view.getUint32(off, true); // 408
  off += 4;
  const edgeStormChargesRaw = view.getUint32(off, true); // 412
  off += 4;
  const sealUntilRaw = view.getUint32(off, true); // 416
  off += 4;
  const secondWindUntilRaw = view.getUint32(off, true); // 420
  off += 4;
  const judgmentMarkUntilRaw = view.getUint32(off, true); // 424
  off += 4;
  const readMarkUntilRaw = view.getUint32(off, true); // 428
  off += 4;
  const judgmentIdLenRaw = view.getUint8(off); // 432
  off += 4; // len + _pad_judgment
  const judgmentTargetIdRaw = readString(view, off, judgmentIdLenRaw); // 436
  off += PLAYER_ID_BYTES;
  const readIdLenRaw = view.getUint8(off); // 468
  off += 4; // len + _pad_read
  const readTargetIdRaw = readString(view, off, readIdLenRaw); // 472
  off += PLAYER_ID_BYTES;
  const wallBloomUntilRaw = view.getUint32(off, true); // 504
  off += 4;
  const shockRingArmedUntilRaw = view.getUint32(off, true); // 508
  off += 4;
  const wardShellUntilRaw = view.getUint32(off, true); // 512
  off += 4;
  const sunlanceUntilRaw = view.getUint32(off, true); // 516
  off += 4;
  const overclockUntilRaw = view.getUint32(off, true); // 520
  off += 4;
  const measureUntilRaw = view.getUint32(off, true); // 524
  off += 4;
  const facetMarkUntilRaw = view.getUint32(off, true); // 528
  off += 4;
  const focusHexMarkUntilRaw = view.getUint32(off, true); // 532
  off += 4;
  const facetIdLenRaw = view.getUint8(off); // 536
  off += 4; // len + _pad_facet
  const facetTargetIdRaw = readString(view, off, facetIdLenRaw); // 540
  off += PLAYER_ID_BYTES;
  const focusHexIdLenRaw = view.getUint8(off); // 572
  off += 4; // len + _pad_focus_hex
  const focusHexTargetIdRaw = readString(view, off, focusHexIdLenRaw); // 576
  off += PLAYER_ID_BYTES;
  const kindledResolveUntilRaw = view.getUint32(off, true); // 608
  off += 4;
  const ghostGuardChargeUntilRaw = view.getUint32(off, true); // 612
  off += 4;
  const razorRouteUntilRaw = view.getUint32(off, true); // 616
  off += 4;
  // respawn_at_tick + throw_hand_parity + recoil_step_until_tick — see
  // packPlayer's matching comments (Track Z0b Items A + B, Z0c Item A).
  const respawnAtTickRaw = view.getUint32(off, true);
  off += 4;
  const throwHandParityRaw = view.getUint8(off) & 1;
  off += 1;
  off += 3; // _pad_throw_hand
  const recoilStepUntilTickRaw = view.getUint32(off, true);
  off += 4;
  // Ally-substrate tail (Track Z1a item 3) — see packPlayer's matching
  // comment.
  const rallyLightUntilTickRaw = view.getUint32(off, true);
  off += 4;
  const aegisShareUntilTickRaw = view.getUint32(off, true);
  off += 4;
  const debtUntilTickRaw = view.getUint32(off, true);
  off += 4;
  off += 4; // _pad_debt
  const debtAmountRaw = view.getFloat64(off, true);
  off += 8;

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
    energy,
    kindling,
    devotion,
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
  if (bit(flags, PLAYER_FLAG_BITS.hasTeamId)) out.teamId = teamId;
  if (bit(flags, PLAYER_FLAG_BITS.hasRegen)) {
    out.regenUntilTick = Tick(regenUntilRaw);
    out.regenHps = regenHpsRaw;
  }
  if (bit(flags, PLAYER_FLAG_BITS.hasHaste)) {
    out.hasteUntilTick = Tick(hasteUntilRaw);
    out.hasteMultiplier = hasteMultiplierRaw;
  }
  if (bit(flags, PLAYER_FLAG_BITS.hasSyzWard)) {
    out.wardAbsorbUntilTick = Tick(syzWardUntilRaw);
    out.wardAbsorbRemaining = syzWardRemainingRaw;
  }
  // 0 = no scheduled respawn (see packPlayer's respawn_at_tick comment) —
  // decoded back to `undefined`, TS's own rest state for the field.
  if (respawnAtTickRaw > 0) out.respawnAtTick = Tick(respawnAtTickRaw);
  // 0 = no live Recoil Step window (Z0c Item A), same sentinel → undefined
  // decode as respawnAtTick above.
  if (recoilStepUntilTickRaw > 0)
    out.recoilStepUntilTick = Tick(recoilStepUntilTickRaw);
  // Always-carried (unlike the sentinel above): 0 and 1 are both real
  // hands, and TS's `?? 1` unset convention was already normalized at
  // pack time — see packPlayer's throw_hand_parity comment.
  out.throwHandParity = throwHandParityRaw;
  // Ally-substrate tail (Track Z1a item 3) — same 0-sentinel → undefined
  // decode as respawnAtTick/recoilStepUntilTick above. debtAmount only
  // exists alongside a live debtUntilTick (TS clears both together).
  if (rallyLightUntilTickRaw > 0)
    out.rallyLightUntilTick = Tick(rallyLightUntilTickRaw);
  if (aegisShareUntilTickRaw > 0)
    out.aegisShareUntilTick = Tick(aegisShareUntilTickRaw);
  if (debtUntilTickRaw > 0) {
    out.debtUntilTick = Tick(debtUntilTickRaw);
    out.debtAmount = debtAmountRaw;
  }
  // Ability-window tail (Track Z1b) — same 0-sentinel → undefined decode
  // convention as respawnAtTick/recoilStepUntilTick above (every consumer
  // on both sides gates with a strict `> tick` check, so 0 and undefined
  // are semantically identical; decoding to undefined matches TS's own
  // rest state and keeps identity-merge churn minimal). Mark target ids
  // use the zero-length "no mark" sentinel, mirroring Zig's own
  // `*_target_id_len == 0` convention.
  if (channelHoldMsRaw !== 0) out.channelHoldMs = channelHoldMsRaw;
  if (slot1CooldownRaw > 0) out.slot1CooldownUntilTick = Tick(slot1CooldownRaw);
  if (slot2CooldownRaw > 0) out.slot2CooldownUntilTick = Tick(slot2CooldownRaw);
  if (slot3CooldownRaw > 0) out.slot3CooldownUntilTick = Tick(slot3CooldownRaw);
  if (undercutUntilRaw > 0) out.undercutUntilTick = Tick(undercutUntilRaw);
  if (edgeStormUntilRaw > 0) out.edgeStormUntilTick = Tick(edgeStormUntilRaw);
  if (edgeStormChargesRaw > 0) out.edgeStormChargesRemaining = edgeStormChargesRaw;
  if (sealUntilRaw > 0) out.sealUntilTick = Tick(sealUntilRaw);
  if (secondWindUntilRaw > 0) out.secondWindUntilTick = Tick(secondWindUntilRaw);
  if (judgmentMarkUntilRaw > 0)
    out.judgmentMarkUntilTick = Tick(judgmentMarkUntilRaw);
  if (judgmentIdLenRaw > 0) out.judgmentTargetId = PlayerId(judgmentTargetIdRaw);
  if (readMarkUntilRaw > 0) out.readMarkUntilTick = Tick(readMarkUntilRaw);
  if (readIdLenRaw > 0) out.readTargetId = PlayerId(readTargetIdRaw);
  if (wallBloomUntilRaw > 0) out.wallBloomUntilTick = Tick(wallBloomUntilRaw);
  if (shockRingArmedUntilRaw > 0)
    out.shockRingArmedUntilTick = Tick(shockRingArmedUntilRaw);
  if (wardShellUntilRaw > 0) out.wardShellUntilTick = Tick(wardShellUntilRaw);
  if (sunlanceUntilRaw > 0) out.sunlanceUntilTick = Tick(sunlanceUntilRaw);
  if (overclockUntilRaw > 0) out.overclockUntilTick = Tick(overclockUntilRaw);
  if (measureUntilRaw > 0) out.measureUntilTick = Tick(measureUntilRaw);
  if (facetMarkUntilRaw > 0) out.facetMarkUntilTick = Tick(facetMarkUntilRaw);
  if (facetIdLenRaw > 0) out.facetTargetId = PlayerId(facetTargetIdRaw);
  if (focusHexMarkUntilRaw > 0)
    out.focusHexMarkUntilTick = Tick(focusHexMarkUntilRaw);
  if (focusHexIdLenRaw > 0) out.focusHexTargetId = PlayerId(focusHexTargetIdRaw);
  if (kindledResolveUntilRaw > 0)
    out.kindledResolveUntilTick = Tick(kindledResolveUntilRaw);
  if (ghostGuardChargeUntilRaw > 0)
    out.ghostGuardChargeUntilTick = Tick(ghostGuardChargeUntilRaw);
  if (razorRouteUntilRaw > 0) out.razorRouteUntilTick = Tick(razorRouteUntilRaw);
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
  // 2026-07-20 gap-closure pass — bits 14-20 mirror world_state.zig's
  // ProjectileFlags packed struct exactly (declaration order = bit order,
  // LSB first): has_status_scale/has_leech_fraction/has_execute_below_frac
  // gate the 3 new f32 fields below; wrap_shots/enemy_only/tendril/
  // ninja_wave are pure-identity value flags (no separate has_* gate,
  // same shape as `returning` above). Zig's `ninja_wave` bit is the
  // pre-rename name for what TS now calls `ninjaBladeShard` (types.ts,
  // 2026-07-20 rename once a second ability needed the identical
  // treatment) — same bit, same semantics, name drift is cosmetic.
  hasStatusScale: 14,
  hasLeechFraction: 15,
  hasExecuteBelowFrac: 16,
  wrapShots: 17,
  enemyOnly: 18,
  tendril: 19,
  ninjaBladeShard: 20,
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
  flags = set(flags, PROJ_FLAG_BITS.hasStatusScale, p.statusScale != null);
  flags = set(
    flags,
    PROJ_FLAG_BITS.hasLeechFraction,
    p.leechFraction != null,
  );
  flags = set(
    flags,
    PROJ_FLAG_BITS.hasExecuteBelowFrac,
    p.executeBelowFrac != null,
  );
  flags = set(flags, PROJ_FLAG_BITS.wrapShots, p.wrapShots ?? false);
  flags = set(flags, PROJ_FLAG_BITS.enemyOnly, p.enemyOnly ?? false);
  flags = set(flags, PROJ_FLAG_BITS.tendril, p.tendril ?? false);
  flags = set(
    flags,
    PROJ_FLAG_BITS.ninjaBladeShard,
    p.ninjaBladeShard ?? false,
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
    ? Math.min(textEncoder.encode(p.ownerId).length, PLAYER_ID_BYTES)
    : 0;
  view.setUint8(off, ownerLen & 0xff);
  off += 1;
  for (let i = 0; i < 3; i++) view.setUint8(off + i, 0);
  off += 3;
  writeString(view, off, PLAYER_ID_BYTES, p.ownerId ?? "");
  off += PLAYER_ID_BYTES;

  // 2026-07-20 gap-closure pass — the 3 f32 tail fields world_state.zig
  // added in the same offset-204→216 span (Phase 0's `_reserved: [12]u8`
  // consumed exactly here; see ProjectileEntity's Zig-side comment).
  view.setFloat32(off, p.statusScale ?? 0, true);
  off += 4;
  view.setFloat32(off, p.leechFraction ?? 0, true);
  off += 4;
  view.setFloat32(off, p.executeBelowFrac ?? 0, true);
  off += 4;
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

  // 2026-07-20 gap-closure pass — mirrors packProjectile's tail write above.
  const statusScaleRaw = view.getFloat32(off, true);
  off += 4;
  const leechFractionRaw = view.getFloat32(off, true);
  off += 4;
  const executeBelowFracRaw = view.getFloat32(off, true);
  off += 4;

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
  if (bit(flags, PROJ_FLAG_BITS.hasStatusScale))
    out.statusScale = statusScaleRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasLeechFraction))
    out.leechFraction = leechFractionRaw;
  if (bit(flags, PROJ_FLAG_BITS.hasExecuteBelowFrac))
    out.executeBelowFrac = executeBelowFracRaw;
  if (bit(flags, PROJ_FLAG_BITS.wrapShots)) out.wrapShots = true;
  if (bit(flags, PROJ_FLAG_BITS.enemyOnly)) out.enemyOnly = true;
  if (bit(flags, PROJ_FLAG_BITS.tendril)) out.tendril = true;
  if (bit(flags, PROJ_FLAG_BITS.ninjaBladeShard)) out.ninjaBladeShard = true;
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
  const ownerLen = s.ownerId
    ? Math.min(textEncoder.encode(s.ownerId).length, PLAYER_ID_BYTES)
    : 0;
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
  const ownerLen = f.ownerId
    ? Math.min(textEncoder.encode(f.ownerId).length, PLAYER_ID_BYTES)
    : 0;
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
  // sudden_death_active (Track Z0a port of orphaned-branch commit 02b74f5)
  // — steals one of the 3 header pad bytes rather than growing
  // WORLD_STATE_TOTAL_SIZE. Parity with World.ts's round.suddenDeathActive
  // (true sudden death: a game-point tie shrinks the WHOLE round). Packed
  // from TS state so the Zig orchestrator sees the current flag; world.zig
  // re-decides it at the countdown → fighting transition.
  view.setUint8(off, state.round.suddenDeathActive ? 1 : 0);
  off += 1;
  off += 2;
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
  // target_score (I9). Default 0 = no match-end detection. Re-applied
  // after every pack by writeTargetScoreIntoMemory (client
  // worldWasmBackend.ts / server serverWasmHost.ts) — a one-off
  // world_state_set_target_score call would be wiped by the very next
  // pack (same bug class as player scores above; Track Z0a / 02b74f5).
  view.setUint32(off, 0, true);
  off += 4;
  // match_winner_idx (I9). -1 = no winner; orchestrator writes
  // back. Encode -1 as 0xFFFFFFFF.
  view.setInt32(off, -1, true);
  off += 4;
  // round_winner_idx (2026-07-20, Phase 2; BRIDGED as of Track Z2) —
  // Zig's round machine writes this at the fighting → round_over
  // transition and draft.zig's offer roll reads it ROUND_OVER_HOLD_MS
  // later for catch-up/winner role weighting. This used to hardcode -1,
  // which wiped the winner on the very next repack (header edition of
  // the scores/target_score bug class — every hosted draft rolled
  // all-standard weights, and the round-over winner display read null on
  // the wasm path). Encoded from state.round.winnerPlayerId by the same
  // sorted-keys convention as first_blood below; -1 = draw/none.
  const roundWinnerIdx =
    state.round.winnerPlayerId != null
      ? Object.keys(state.players).sort().indexOf(state.round.winnerPlayerId)
      : -1;
  view.setInt32(off, roundWinnerIdx, true);
  off += 4;
  // first_blood_idx_plus1 (Track Z0d) — reclaims what used to be the
  // alignment pad before countdown_remaining_ms (HEADER_SIZE unchanged).
  // 0 = unclaimed, N = sorted-player-index N-1 holds first blood (see
  // world_state.zig's plus-one-encoding doc comment). MUST round-trip the
  // real value: pack runs every tick, so a hardcoded 0 here would wipe
  // Zig's award one tick after it happens — the exact bug class
  // writeScoresIntoMemory's history documents (scores/target_score).
  // Sorted-keys order matches unpackWorldState/convertWasmEventsToTs's
  // own `Object.keys(players).sort()` convention.
  const firstBloodIdx =
    state.round.firstBloodPlayerId !== undefined
      ? Object.keys(state.players)
          .sort()
          .indexOf(state.round.firstBloodPlayerId)
      : -1;
  view.setUint32(off, firstBloodIdx >= 0 ? firstBloodIdx + 1 : 0, true);
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
    packPlayer(
      view,
      playersStart + i * PLAYER_ENTITY_SIZE,
      players[i]!,
      state.round.roundKills?.[players[i]!.id] ?? 0,
    );
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

  // player_movement parallel array (Track Z0e) — packed by SORTED player
  // order (the same `players` array the entity loop above wrote, so slot
  // N's movement memory always sits under players[N] even when the
  // roster changed since last tick). Before Z0e this region was left
  // zero-filled and the full-sync hosts' every-tick repack therefore
  // WIPED Zig's movement memory every single tick — the dominant
  // movement-fork term in the multiSeedDivergence sweep and a real
  // live-mode bug for both wasm hosts (see WorldState.movementMemory's
  // doc comment in types.ts). Missing entries (fresh match, new joiner,
  // TS-authored states that never ran through unpack) get the
  // freshPlayerMovementMemory() equivalent — the same default the TS
  // runtime lazily seeds for an unseen player.
  for (let i = 0; i < players.length; i++) {
    const mem =
      state.movementMemory?.[players[i]!.id] ?? FRESH_MOVEMENT_MEMORY;
    packMovementMemory(
      view,
      PLAYER_MOVEMENT_OFFSET + i * PLAYER_MOVEMENT_MEMORY_SIZE,
      mem,
    );
  }

  // melee_swing parallel array (Track Z1a) — same sorted-slot contract as
  // the player_movement loop directly above. Before Z1a this region was
  // left zero-filled, so the hosts' every-tick repack reset every swing
  // FSM to idle before every step — melee windup could never mature into
  // an active window on the wasm path (see WorldState.meleeSwingMemory's
  // doc comment in types.ts). Missing entries get the fresh idle FSM
  // (aim_x=1 — world_state.zig's own field defaults, not raw zeros).
  for (let i = 0; i < players.length; i++) {
    const mem =
      state.meleeSwingMemory?.[players[i]!.id] ?? FRESH_MELEE_SWING_MEMORY;
    packMeleeSwingMemory(
      view,
      MELEE_SWING_OFFSET + i * MELEE_SWING_MEMORY_SIZE,
      mem,
    );
  }

  // player_draft_state parallel array (Track Z2 — the drafting bridge):
  // same sorted-slot contract as the two loops directly above. Before
  // this, the region was left zero-filled and the hosts' every-tick
  // repack wiped every rolled offer and landed pick — the wasm drafting
  // phase could never hold a draft open. Missing entries stay zero
  // (nothing rolled / nothing picked — Zig's own `.{}` default; the
  // fresh buffer is already zero-filled so no explicit write is needed).
  for (let i = 0; i < players.length; i++) {
    const d = state.draftMemory?.[players[i]!.id];
    if (!d) continue;
    const base = PLAYER_DRAFT_STATE_OFFSET + i * PLAYER_DRAFT_STATE_SIZE;
    for (let s = 0; s < DRAFT_OFFER_COUNT; s++) {
      view.setUint8(base + s, (d.offers[s] ?? 0) & 0xff);
    }
    view.setUint8(base + DRAFT_OFFER_COUNT, d.pickedSlot & 0xff);
  }

  return buf;
}

export type WasmSimEvent = {
  kind: number;
  playerIdxA: number;
  playerIdxB: number;
  entityId: number;
  scalar: number;
  x: number;
  y: number;
};

export const SIM_EVENT_KIND = {
  none: 0,
  shotFired: 1,
  hitConfirmed: 2,
  destructibleBroken: 3,
  pickupTaken: 4,
  roundEnd: 5,
  playerKilled: 6,
  parryDeflected: 7,
  shieldPopped: 8,
  explosion: 9,
  fireHit: 10,
  // 11-15 (launch_pad_fired … dash_through) exist Zig-side but are decoded
  // by convertWasmEvents' numeric cases directly; add here as tests need
  // them (this const is test-facing, not a decode table).
  firstBlood: 16,
} as const;

export type UnpackedWorldState = {
  tick: Tick;
  rngState: number;
  round: Pick<
    RoundState,
    | "phase"
    | "countdownRemainingMs"
    | "roundIndex"
    | "suddenDeathActive"
    | "firstBloodPlayerId"
    | "winnerPlayerId"
  >;
  scores: Record<string, number>;
  /** Per-round kill tally (PlayerEntity.round_kills), keyed by player id.
   *  Only players with a non-zero tally get an entry — mirrors `scores`. */
  roundKills: Record<string, number>;
  targetScore: number;
  matchWinnerIdx: number; // -1 = no winner
  chaosModifierIds?: string[];
  fireHazardTimerMs?: number;
  events: WasmSimEvent[];
  players: Record<PlayerId, PlayerEntity>;
  projectiles: Record<EntityId, ProjectileEntity>;
  satellites: Record<EntityId, SatelliteEntity>;
  destructibles: Record<EntityId, DestructibleEntity>;
  firePatches: Record<EntityId, FireEntity>;
  pickups: Record<EntityId, PickupEntity>;
  /** Zig's post-step `player_movement` parallel array, re-keyed by player
   *  id (Track Z0e). The hosts' mergeUnpacked carries this onto the
   *  returned WorldState so the NEXT tick's packWorldState can write it
   *  back — the round-trip that lets movement memory survive the
   *  every-tick full-sync repack. */
  movementMemory: Record<PlayerId, PlayerMovementMemory>;
  /** Zig's post-step `melee_swing` parallel array, re-keyed by player id
   *  (Track Z1a) — same round-trip contract as movementMemory, so the
   *  swing FSM survives the every-tick full-sync repack. */
  meleeSwingMemory: Record<PlayerId, MeleeSwingMemory>;
  /** Zig's post-step `player_draft_state` parallel array, re-keyed by
   *  player id (Track Z2 — the drafting bridge) — same round-trip
   *  contract as the two above, so mid-draft offers/picks survive the
   *  every-tick full-sync repack. Raw +1 encodings (see
   *  WorldState.draftMemory's doc comment in types.ts). */
  draftMemory: Record<PlayerId, PlayerDraftMemory>;
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
  // sudden_death_active — see packWorldState's matching write. `undefined`
  // (not `false`) when unset, mirroring TS round.ts's optional-field
  // convention (`next.suddenDeathActive = undefined` on countdown entry).
  const suddenDeathActive = view.getUint8(off) !== 0 ? true : undefined;
  off += 1;
  off += 2;
  off += 4 + 4; // next_entity_id, map_id (placeholders)
  const chaosMask = view.getUint32(off, true);
  off += 4;
  const chaosModifierIds = decodeChaosMask(chaosMask);
  const fireHazardTimerMs = view.getUint32(off, true);
  off += 4;
  const roundIndex = view.getUint32(off, true);
  off += 4;
  // target_score (I9), match_winner_idx (I9)
  const targetScore = view.getUint32(off, true);
  off += 4;
  const matchWinnerIdx = view.getInt32(off, true);
  off += 4;
  // round_winner_idx (BRIDGED as of Track Z2 — see packWorldState's
  // matching write): raw sorted-player index held here; resolved to a
  // PlayerId after the players section below is unpacked, same
  // convention as first_blood_idx_plus1 directly below.
  const roundWinnerIdxRaw = view.getInt32(off, true);
  off += 4;
  // first_blood_idx_plus1 (Track Z0d) — raw index held here; resolved to
  // a PlayerId after the players section below is unpacked (sorted-keys
  // order, same convention as the score-extraction loop at the bottom).
  const firstBloodIdxPlus1 = view.getUint32(off, true);
  off += 4;
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
  // Slot-order id list (Track Z0e): index N here is the id packPlayer
  // wrote into entity slot N — the movement-memory section below re-keys
  // the `player_movement` parallel array by these EXACT slot ids rather
  // than re-deriving a sort (pack uses localeCompare, the score loop
  // uses default sort; reading the slots directly can't drift from
  // either).
  const playerIdBySlot: PlayerId[] = [];
  for (let i = 0; i < playerCount; i++) {
    const e = unpackPlayer(view, playersStart + i * PLAYER_ENTITY_SIZE);
    players[e.id] = e;
    playerIdBySlot.push(e.id);
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
  off = pickupStart + MAX_PICKUPS * PICKUP_ENTITY_SIZE;

  // Paper Double decoys (2026-07-20 gap-closure pass item 3) — 4 count + 4
  // pad + N×PaperDoubleEntity. Skipped (host doesn't consume yet; nothing
  // spawns these).
  off += 8 + MAX_PAPER_DOUBLES * PAPER_DOUBLE_ENTITY_SIZE;

  // I14 player_movement parallel array — 16 × 48 bytes. BRIDGED as of
  // Track Z0e (was skipped, which combined with the hosts' every-tick
  // full-buffer repack to zero Zig's movement memory every tick): read
  // back per live slot, keyed by that slot's player id, so
  // packWorldState can re-seat it under the same player next tick even
  // if the roster (and thus sorted slot order) changed in between.
  const movementMemory: Record<PlayerId, PlayerMovementMemory> =
    {} as Record<PlayerId, PlayerMovementMemory>;
  for (let i = 0; i < playerIdBySlot.length; i++) {
    movementMemory[playerIdBySlot[i]!] = unpackMovementMemory(
      view,
      off + i * PLAYER_MOVEMENT_MEMORY_SIZE,
    );
  }
  off += MAX_PLAYERS * PLAYER_MOVEMENT_MEMORY_SIZE;

  // Melee swing FSM memory — 16 × 32 bytes. BRIDGED as of Track Z1a
  // (was skipped, which combined with the hosts' every-tick full-buffer
  // repack to reset every swing FSM to idle every tick — Z0e's sibling
  // bug): read back per live slot, keyed by that slot's player id, same
  // contract as the player_movement section directly above.
  const meleeSwingMemory: Record<PlayerId, MeleeSwingMemory> =
    {} as Record<PlayerId, MeleeSwingMemory>;
  for (let i = 0; i < playerIdBySlot.length; i++) {
    meleeSwingMemory[playerIdBySlot[i]!] = unpackMeleeSwingMemory(
      view,
      off + i * MELEE_SWING_MEMORY_SIZE,
    );
  }
  off += MAX_PLAYERS * MELEE_SWING_MEMORY_SIZE;

  // I-final player_fire_config parallel array — 16 × 240 bytes.
  // Host-writable; no read-back needed (sim writes nothing here).
  off += MAX_PLAYERS * RESOLVED_FIRE_CONFIG_SIZE;

  // Equipped actives / card hand — skipped: build-resolved data the host
  // re-delivers after every pack (resolve_player_loadout, Track Z1b); no
  // TS consumer reads them back through this bridge.
  off += MAX_PLAYERS * EQUIPPED_ACTIVES_SIZE;
  off += MAX_PLAYERS * PLAYER_CARD_IDS_SIZE;
  // player_draft_state — BRIDGED as of Track Z2 (the drafting bridge):
  // read back per live slot, keyed by that slot's player id, same
  // contract as the player_movement/melee_swing sections above. Raw +1
  // encodings preserved (carrier, not presentation).
  const draftMemory: Record<PlayerId, PlayerDraftMemory> = {} as Record<
    PlayerId,
    PlayerDraftMemory
  >;
  for (let i = 0; i < playerIdBySlot.length; i++) {
    const base = off + i * PLAYER_DRAFT_STATE_SIZE;
    const offers: number[] = [];
    for (let s = 0; s < DRAFT_OFFER_COUNT; s++) {
      offers.push(view.getUint8(base + s));
    }
    draftMemory[playerIdBySlot[i]!] = {
      offers,
      pickedSlot: view.getUint8(base + DRAFT_OFFER_COUNT),
    };
  }
  off += MAX_PLAYERS * PLAYER_DRAFT_STATE_SIZE;

  // I15 static cache: 4 count + 4 pad + N×AABB + N×u8 + 4 tail.
  off += 8 + MAX_STATICS * AABB_SIZE + MAX_STATICS + 4;

  // Deferred-write instant-AOE cast queue (2026-07-20 gap-closure pass) —
  // 4 count + 4 explicit pad + 4 implicit Zig alignment pad (see
  // WORLD_STATE_TOTAL_SIZE's comment on this section for the full
  // accounting) + N×PendingInstantAoe. Skipped (nothing pushes into it
  // yet — see world_state.zig's PendingInstantAoe doc comment).
  off += 12 + MAX_PENDING_INSTANT_AOE * PENDING_INSTANT_AOE_SIZE;

  // I18 events buffer: 4 count + 4 pad + N×SimEvent (40B each,
  // 8-aligned). 2026-07-20: the extra implicit alignment pad this
  // section used to need moved to the new pending-instant-AOE section
  // immediately above (that field's own offset is what's non-8-aligned
  // now) — event_count's offset comes out 8-aligned on its own since
  // the gap-closure pass's additions. See WORLD_STATE_TOTAL_SIZE's
  // comment on the pending-AOE section for the full accounting.
  const eventCount = view.getUint32(off, true);
  off += 8;
  const events: WasmSimEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    const e: WasmSimEvent = {
      kind: view.getUint32(off, true),
      playerIdxA: view.getInt32(off + 4, true),
      playerIdxB: view.getInt32(off + 8, true),
      entityId: view.getUint32(off + 12, true),
      scalar: view.getFloat64(off + 16, true),
      x: view.getFloat64(off + 24, true),
      y: view.getFloat64(off + 32, true),
    };
    events.push(e);
    off += 40;
  }

  // I24 — extract the per-player score field into a separate
  // record so the J0 shim can mirror it into state.round.scores.
  // Same treatment for round_kills (kill tally 2026-07-17) →
  // state.round.roundKills.
  const scores: Record<string, number> = {};
  const roundKills: Record<string, number> = {};
  let pi = 0;
  for (const pid of Object.keys(players).sort()) {
    // PlayerEntity score is at offset 276 from the player's start;
    // round_kills directly after at 280 (former _reserved bytes).
    const playerStart = playersStart + pi * PLAYER_ENTITY_SIZE;
    const score = view.getUint32(playerStart + 276, true);
    if (score > 0) scores[pid] = score;
    const kills = view.getUint32(playerStart + 280, true);
    if (kills > 0) roundKills[pid] = kills;
    pi++;
  }

  // first_blood_idx_plus1 → PlayerId (Track Z0d): resolved against the
  // SAME sorted-keys order the pack side used to encode it (and the score
  // loop above reads). `undefined` (not null) when unclaimed — mirrors
  // round.ts's optional-field convention, same as suddenDeathActive.
  const sortedIds = Object.keys(players).sort();
  const firstBloodPlayerId =
    firstBloodIdxPlus1 > 0 && firstBloodIdxPlus1 <= sortedIds.length
      ? PlayerId(sortedIds[firstBloodIdxPlus1 - 1]!)
      : undefined;
  // round_winner_idx → PlayerId (Track Z2): same sorted-keys resolution
  // as first_blood above. `null` (not undefined) when -1 — mirrors TS
  // RoundState.winnerPlayerId's own `PlayerId | null` shape.
  const winnerPlayerId =
    roundWinnerIdxRaw >= 0 && roundWinnerIdxRaw < sortedIds.length
      ? PlayerId(sortedIds[roundWinnerIdxRaw]!)
      : null;

  const out: UnpackedWorldState = {
    tick,
    rngState,
    round: {
      phase,
      countdownRemainingMs,
      roundIndex,
      suddenDeathActive,
      firstBloodPlayerId,
      winnerPlayerId,
    },
    scores,
    roundKills,
    targetScore,
    matchWinnerIdx,
    players,
    projectiles,
    satellites,
    destructibles,
    firePatches,
    pickups,
    events,
    movementMemory,
    meleeSwingMemory,
    draftMemory,
  };
  if (chaosModifierIds.length > 0) out.chaosModifierIds = chaosModifierIds;
  if (fireHazardTimerMs !== 0) out.fireHazardTimerMs = fireHazardTimerMs;
  return out;
}
