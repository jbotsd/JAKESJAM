//! Phase G1b — WorldState extern struct + entity extern structs.
//!
//! This file is the byte-stable cross-host contract for the FULL
//! sim state. The TS World currently owns the canonical
//! `WorldState` shape (client/src/sim/types.ts ~line 376); this
//! Zig mirror is what `step_world` (Phase I) will mutate in place.
//!
//! Layout discipline:
//!   1. `extern struct` — Zig guarantees no implicit reordering;
//!      tail/inter-field padding is what we must pin.
//!   2. f64 fields up front for natural 8-byte alignment, smaller
//!      fields tail-packed, explicit pad bytes where needed.
//!   3. Strings are fixed-size byte buffers + length prefix. Cards
//!      and weapons are ID byte buffers; the TS↔wasm bridge
//!      (Phase G2) maps them to the canonical TS strings.
//!   4. Optional/additive TS fields become `flags` bitfields + raw
//!      values. Absent in TS == flag bit 0 in Zig.
//!   5. `_reserved` tail bytes give us room to grow without
//!      breaking the byte contract — until we hit zero, future
//!      additions land here.
//!
//! Comptime size assertions enforce the layout TODAY so any
//! regression in a downstream cut fails at compile time, not at
//! the next snapshot codec mismatch.

const std = @import("std");

pub const MAX_PLAYERS: usize = 16;
pub const MAX_STATICS: usize = 256;
pub const MAX_EVENTS_PER_TICK: usize = 64;
pub const MAX_PROJECTILES: usize = 256;
pub const MAX_SATELLITES: usize = 32;
pub const MAX_DESTRUCTIBLES: usize = 64;
pub const MAX_FIRE: usize = 32;
pub const MAX_PICKUPS: usize = 32;
/// Paper Double decoys (2026-07-20 gap-closure pass item 3 — Interstice/
/// ninja catalog v1, docs/card-pool-v2.md "Paper Double"; PaperDoubleEntity
/// at client/src/sim/types.ts). Sized the same as MAX_PLAYERS: the card's
/// own cooldown (9s, NINJA_PAPER_DOUBLE_CD_MS) exceeds its max lifetime
/// (2.5s, NINJA_PAPER_DOUBLE_LIFETIME_MS) by a wide margin, so no single
/// player can ever have more than one live decoy — one slot per player is
/// already generous headroom, matching MAX_SATELLITES/MAX_FIRE's own
/// "generous, not exact" sizing convention in this file.
pub const MAX_PAPER_DOUBLES: usize = MAX_PLAYERS;

/// Deferred-write instant-AOE cast queue bound (2026-07-20 gap-closure
/// pass — port of the PATTERN behind World.ts's `pendingInstantAoe`
/// array, World.ts:1609). Sized generously rather than exactly, matching
/// this file's own MAX_SATELLITES/MAX_FIRE convention: the 5 real push
/// sites this queue exists for (wall-bloom, shock-ring, prism-fan,
/// flock-pulse, shard-ring) are each gated on a DISTINCT per-player
/// trigger (a wall-kick edge, a landing edge, an ability-cast edge) that
/// can fire at most once per player per tick per trigger, and
/// MAX_PLAYERS=16 bounds the roster — so even the pathological case of
/// every player queuing from two independent triggers in the same tick
/// (e.g. a wall-kick AND an ability cast landing on the same tick) tops
/// out at 2 × MAX_PLAYERS = 32. See `PendingInstantAoe`'s own doc comment
/// for why the type lives here but the QUEUE STORAGE (this bound sizes)
/// lives on `WorldState` rather than as function-local scratch.
pub const MAX_PENDING_INSTANT_AOE: usize = 32;

pub const PLAYER_ID_BYTES: usize = 32;
pub const WEAPON_ID_BYTES: usize = 24;
pub const CARD_ID_BYTES: usize = 24;
pub const MAX_PLAYER_CARDS: usize = 8;
/// Duos-queue team id (class-overhaul-workboard.md chunk 1.1). Generated
/// ids look like `duo-3` / `bot-duo-7` (server/src/venueHost.ts,
/// worldHost.ts) — well under 24 bytes; sized the same as WEAPON_ID_BYTES,
/// the codebase's existing "medium generated id" bucket.
pub const TEAM_ID_BYTES: usize = 24;

/// Round phase tag — mirrors `RoundState.phase` in
/// `client/src/sim/types.ts`. Wire as a single byte.
pub const RoundPhase = enum(u8) {
    countdown = 0,
    fighting = 1,
    round_over = 2,
    drafting = 3,
};

/// Character archetype — mirrors `CharacterArchetype` in TS.
pub const CharacterArchetype = enum(u8) {
    balanced = 0,
    heavy = 1,
    sprinter = 2,
    shielded = 3,
};

/// Projectile pathing tag — 8 variants per `ProjectilePathing`.
pub const ProjectilePathing = enum(u8) {
    straight = 0,
    gravity = 1,
    bounce = 2,
    boomerang = 3,
    homing = 4,
    anti_homing = 5,
    float = 6,
    accelerate = 7,
};

/// Element tag — mirrors `ElementType` in TS.
pub const ElementType = enum(u8) {
    crystal = 0,
    neutral = 1,
    fire = 2,
    ice = 3,
    lightning = 4,
    void_ = 5,
    radiant = 6,
    electric = 7,
    toxic = 8,
    sticky = 9,
    explosive = 10,
};

/// Impact behaviour tag — mirrors `ProjectileImpact` in TS.
pub const ProjectileImpact = enum(u8) {
    none = 0,
    explosive = 1,
    sticky = 2,
    pierce_chain = 3,
    slow_field = 4,
};

/// Projectile shape tag — mirrors `ProjectileShape` in TS.
pub const ProjectileShape = enum(u8) {
    circle = 0,
    triangle = 1,
    square = 2,
    hexagon = 3,
    orb = 4,
    x = 5,
    bar = 6,
};

pub const DestructibleKind = enum(u8) {
    barrel = 0,
    box = 1,
    mine = 2,
    cube = 3,
};

pub const PickupKind = enum(u8) {
    health_shard = 0,
    shield_cell = 1,
    overcharge_core = 2,
    damage_amp = 3,
    speed_boost = 4,
    melee_mode = 5,
    slow_trap = 6,
    vulnerability_trap = 7,
    block_jammer = 8,
    boss_core = 9,
    card_cache = 10,
};

// -----------------------------------------------------------------
// Bit flags. Booleans are packed into u32 fields where they cluster
// so the boundary stays compact. Extending requires only flipping
// an unused bit, never bumping the struct size.

pub const PlayerFlags = packed struct(u32) {
    alive: bool,
    shield_active: bool,
    crouching: bool,
    grounded: bool,
    has_slow: bool,
    has_burn: bool,
    has_freeze: bool,
    has_shield_charge: bool,
    has_parry_active: bool,
    has_parry_cooldown: bool,
    has_overcharge: bool,
    has_damage_amp: bool,
    has_speed_boost: bool,
    has_melee_mode: bool,
    has_slow_debuff: bool,
    has_vulnerability: bool,
    has_block_jammer: bool,
    has_boss_mode: bool,
    has_jetpack_fuel: bool,
    has_parry_facing: bool,
    /// Duos-queue team identity (class-overhaul-workboard.md chunk 1.1).
    /// Gates team_id_len/team_id_bytes below — absent (bit 0) is an
    /// ordinary FFA combatant.
    has_team_id: bool,
    /// Syzygist status substrate extension (class-overhaul-workboard.md
    /// chunk 3.1) — gates regen_until_tick/regen_hps below. Same "unset vs
    /// tick 0" explicit-flag convention as has_burn/has_freeze (these are
    /// window-tick fields, not always-valid resources like energy/kindling,
    /// which need no flag).
    has_regen: bool,
    /// Gates haste_until_tick/haste_multiplier below. Same convention as
    /// has_regen immediately above.
    has_haste: bool,
    /// Syzygist Ward (class-overhaul-workboard.md chunk 3.3) — gates
    /// syz_ward_absorb_until_tick/syz_ward_absorb_remaining below. Same
    /// "unset vs tick 0" explicit-flag convention as has_regen/has_haste
    /// (an optional WINDOW field, not an always-valid resource like
    /// devotion, which needs no flag).
    has_syz_ward: bool,
    _reserved: u8 = 0,
};

pub const ProjectileFlags = packed struct(u32) {
    has_owner: bool,
    has_impact: bool,
    has_split: bool,
    has_slow: bool,
    has_homing: bool,
    has_acceleration: bool,
    has_gravity_scale: bool,
    has_range: bool,
    has_age: bool,
    has_traveled: bool,
    has_origin: bool,
    returning: bool,
    has_sticky_fuse: bool,
    has_impact_radius: bool,
    /// 2026-07-20 gap-closure pass (client/src/sim/types.ts:1004/1013/1014) —
    /// gate bits for the 3 new optional numeric fields below, same
    /// "unset vs 0" ambiguity every other `has_*` bit on this struct
    /// resolves. Given default values (`= false`) so the two existing
    /// ProjectileEntity struct-literal sites in world.zig (weapon-fire spawn
    /// + emission-cast spawn), which explicitly enumerate every flag field,
    /// keep compiling unchanged — neither spawn site produces these extras
    /// yet (that's a separate, later fire-path port).
    has_status_scale: bool = false,
    has_leech_fraction: bool = false,
    has_execute_below_frac: bool = false,
    /// Pure identity/behavior flags (types.ts:1015/1031/1057/1069) — each
    /// IS its own value, no separate has_* gate, same shape as `returning`
    /// above. Defaulted `= false` for the same "existing spawn sites don't
    /// need editing" reason as the has_* trio above.
    wrap_shots: bool = false,
    enemy_only: bool = false,
    tendril: bool = false,
    ninja_wave: bool = false,
    _reserved: u11 = 0,
};

// -----------------------------------------------------------------
// Entity extern structs. Each starts with the largest fields (f64)
// for natural alignment; smaller fields trail.

/// Mirrors `PlayerEntity` in client/src/sim/types.ts.
/// Sized at exactly PLACEHOLDER_PLAYER_BYTES (= 256) — future
/// growth lands in `_reserved`.
pub const PlayerEntity = extern struct {
    // 8-byte fields (28 × 8 = 224 bytes, but we don't fill all of them yet)
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    aim_x: f64,
    aim_y: f64,
    health: f64,
    fire_cooldown_ms: f64,
    ammo: f64,
    ability_charge: f64,
    jetpack_fuel: f64,
    shield_charge: f64,
    shield_max_charge: f64,
    parry_facing: f64,
    burn_dps: f64,
    slow_multiplier: f64,
    freeze_multiplier: f64,

    // Tick-based optional fields. Stored even when unset; the
    // PlayerFlags bit gates "is this active?".
    slowed_until_tick: u32,
    burn_until_tick: u32,
    burn_tick_last_applied: u32,
    freeze_until_tick: u32,
    parry_active_until_tick: u32,
    parry_cooldown_until_tick: u32,
    overcharge_until_tick: u32,
    damage_amp_until_tick: u32,
    speed_boost_until_tick: u32,
    melee_mode_until_tick: u32,
    slow_debuff_until_tick: u32,
    vulnerability_until_tick: u32,
    block_jammer_until_tick: u32,
    boss_mode_until_tick: u32,
    last_processed_input_seq: u32,

    flags: PlayerFlags,
    character_id: CharacterArchetype,
    card_count: u8,
    _pad0: [2]u8 = .{ 0, 0 },

    id_len: u8,
    weapon_id_len: u8,
    _pad1: [6]u8 = .{ 0, 0, 0, 0, 0, 0 },

    id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),
    weapon_id_bytes: [WEAPON_ID_BYTES]u8 = @splat(0),

    /// Per-tick input bitmask for this player (Phase I4). The
    /// orchestrator writes the captured input bits before calling
    /// `step_world`. `prev_keys` holds the previous-tick mask so
    /// edge-detect operations (e.g. parry-on-rising-edge of the
    /// Ability key) work without a host-side memo.
    current_keys: u32,
    prev_keys: u32,

    /// Round-score counter for this player (Phase I5). Increments
    /// when the orchestrator decides this player won the round.
    /// Bridged from / to TS `state.round.scores[playerId]`.
    score: u32,

    /// Per-round kill tally (2026-07-17, parity with TS
    /// `RoundState.roundKills[playerId]`): kills credited to this
    /// player THIS round — attacker known and not the victim
    /// (void/storm/unattributed-burn deaths credit nobody). Reset
    /// when a round's fighting phase begins; drives the time-out
    /// most-kills resolution (world.zig timeoutWinnerIdx). Landed
    /// in the former `_reserved` bytes — struct size unchanged.
    round_kills: u32 = 0,

    /// Ninja class-resource pool (2026-07-18, docs/classes-goal.md MANA
    /// section: "ninja = energy, fast regen, melee hits restore"). Mutated
    /// ONLY by TS World.ts combat code (melee-hit / dash-through / wall-kick
    /// grants + passive regen) — mirrors how `ability_charge` is a TS-owned
    /// resource that the physics step never touches, just carries through.
    /// f64 after a run of u32 tail fields forces 4 bytes of alignment
    /// padding before it (284 → 288) — struct grows 288 → 296. Non-ninja
    /// players simply never move this field off 0.
    energy: f64 = 0,

    /// Duos-queue team identity (2026-07-18, class-overhaul-workboard.md
    /// chunk 1.1, docs/classes-goal.md "Venue integration"). Mirrors TS
    /// `PlayerEntity.teamId` exactly — length-prefixed fixed buffer, same
    /// pattern as `id_bytes`/`weapon_id_bytes` above. This is
    /// IDENTITY/ROSTER metadata (same category as character_id/weapon_id),
    /// not ability/window state, so it crosses the ABI unlike Resonance
    /// (six-axes-goal.md "Zig line" excludes only ability state) — any
    /// future Zig-side combat code (friendly-fire / ally-targeting) needs
    /// it visible every tick. `PlayerFlags.has_team_id` gates validity;
    /// absent = ordinary FFA combatant, team_id_bytes reads all zero.
    /// u8 fields need no alignment padding after `energy` (f64, 8-aligned);
    /// struct grows 296 → 321 content bytes, then Zig's implicit tail
    /// padding (extern struct alignment = 8, from the f64 fields) rounds
    /// up to 328 — see the comptime assert below and
    /// worldStateBridge.ts's PLAYER_ENTITY_SIZE.
    team_id_len: u8 = 0,
    team_id_bytes: [TEAM_ID_BYTES]u8 = @splat(0),

    /// Paladin/Kindred class-resource pool (2026-07-18, class-overhaul-
    /// workboard.md chunk 2.3, docs/classes-goal.md MANA section:
    /// "Resource: Kindling from blocked damage... Defense IS the engine").
    /// Mutated ONLY by TS `combat.ts`'s Kindled Ward branch of
    /// `tryDeflectDamage` — same TS-owned-resource contract as `energy`
    /// above (physics step never touches it, just carries it through).
    /// Appended after `team_id_bytes`: that field's own doc comment notes
    /// content ends at byte 321 with 7 bytes of IMPLICIT tail padding
    /// (321 → 328) purely because it used to be the last field. Adding
    /// `kindling` (f64, needs 8-byte alignment) reclaims that padding as
    /// real alignment space instead — Zig places it at offset 328 (321
    /// rounds up to 328), occupying [328, 336). 336 is already an 8-byte
    /// multiple, so there's no further tail padding this time: struct size
    /// grows 328 → 336 exactly (+8, not +7-padding-then-+8 — the old
    /// padding IS the new field's alignment gap). See the comptime assert
    /// below and worldStateBridge.ts's PLAYER_ENTITY_SIZE. Non-paladin
    /// players simply never move this field off 0 — same "additive, zero-
    /// cost for other chassis" contract as `energy`.
    kindling: f64 = 0,

    /// Syzygist status substrate extension (2026-07-18, class-overhaul-
    /// workboard.md chunk 3.1, docs/classes-goal.md Priest/Syzygist:
    /// "extends the existing status-effect substrate... add regen,
    /// haste"). Mirrors TS `PlayerEntity.regenUntilTick`/`regenHps`/
    /// `hasteUntilTick`/`hasteMultiplier` exactly. Unlike `burn_until_tick`/
    /// `freeze_until_tick` above, these are TS-owned/TS-applied (World.ts's
    /// per-tick regen block + speedMul chain, weapon.ts's fire-rate
    /// composition — same "carried through, never computed here" contract
    /// as `energy`/`kindling`, NOT the burn/freeze contract): `step_world`
    /// does not read or mutate these fields. They still need
    /// `PlayerFlags.has_regen`/`has_haste` gates (unlike energy/kindling)
    /// because they're optional WINDOW-tick fields, same "unset vs tick 0"
    /// ambiguity every other `*_until_tick` field on this struct resolves
    /// with an explicit flag.
    ///
    /// Layout: two u32 ticks land at [336, 344) — still 4-byte-aligned
    /// after `kindling`'s f64 (336 is already a multiple of 4), so no gap.
    /// The two f64 rate fields that follow need 8-byte alignment; 344 is
    /// already a multiple of 8, so THEY need no gap either — this is the
    /// one field addition this session that requires zero explicit padding
    /// bytes anywhere. Struct size grows 336 → 360 (+24, no padding). See
    /// the comptime assert below and worldStateBridge.ts's
    /// PLAYER_ENTITY_SIZE.
    regen_until_tick: u32 = 0,
    haste_until_tick: u32 = 0,
    /// Heal-per-second while `regen_until_tick` is live (`has_regen`).
    regen_hps: f64 = 0,
    /// Move-speed + fire-rate multiplier while `haste_until_tick` is live
    /// (`has_haste`).
    haste_multiplier: f64 = 0,

    /// Syzygist Devotion (2026-07-18, class-overhaul-workboard.md chunk
    /// 3.2, docs/classes-goal.md MANA section: "priest = devotion,
    /// generated by buff/heal uptime on others"). Mutated ONLY by TS
    /// World.ts's per-tick Devotion-accrual pass — same TS-owned-resource
    /// contract as `energy`/`kindling`: `step_world` never computes it,
    /// just carries it through. No flag needed (always-valid resource, NOT
    /// an optional window field — same "no gate" contract as
    /// `energy`/`kindling`, not `regen_until_tick`'s). Only priest
    /// (classId) chassis ever move this off 0.
    ///
    /// Layout: `haste_multiplier`'s f64 ends at offset 360, already an
    /// 8-byte multiple, so `devotion` (f64) needs no alignment padding —
    /// struct grows 360 → 368. See the comptime assert below and
    /// worldStateBridge.ts's PLAYER_ENTITY_SIZE.
    devotion: f64 = 0,

    /// Syzygist Ward (2026-07-18, class-overhaul-workboard.md chunk 3.3,
    /// docs/classes-goal.md defense-verb section: "priest = wards, small
    /// absorb barriers, castable on ALLIES"). Mirrors TS
    /// `PlayerEntity.wardAbsorbUntilTick`/`wardAbsorbRemaining` exactly —
    /// same TS-owned/TS-applied contract as `regen_until_tick`/
    /// `regen_hps` above (`step_world` does not compute or consume this;
    /// `combat.ts`'s `trySyzygistWard` does). `PlayerFlags.has_syz_ward`
    /// gates validity, same "unset vs tick 0" ambiguity every other
    /// optional `*_until_tick` field on this struct resolves with an
    /// explicit flag. `wardAbsorbSourceId` (TS-only ability-adjacent
    /// bookkeeping, same category as `facetTargetId`) deliberately has NO
    /// Zig mirror — it never crosses the WASM ABI.
    ///
    /// Layout: `devotion`'s f64 ends at offset 368, already 4-byte-aligned
    /// for the u32 tick that follows (no gap); the f64 remaining-pool field
    /// after IT needs 8-byte alignment, so there's a 4-byte implicit pad
    /// between the two (372 → 376) — the SAME "one leftover u32" shape
    /// `team_id_bytes`→`kindling`'s own transition hit, just smaller.
    /// Struct grows 368 → 384 (+4 content bytes for the u32, +4 bytes
    /// implicit alignment pad, +8 content bytes for the f64 = +16 total).
    /// See the comptime assert below and worldStateBridge.ts's
    /// PLAYER_ENTITY_SIZE.
    syz_ward_absorb_until_tick: u32 = 0,
    /// Absorb pool remaining (`has_syz_ward`). Depleted per-hit by
    /// `combat.ts`'s `trySyzygistWard`, mirrored here as a byte-layout
    /// carry-through only.
    syz_ward_absorb_remaining: f64 = 0,

    /// Wizard basic-fire ramping channel (2026-07-20 gap-closure pass,
    /// constants.ts's GEO_CHANNEL_RAMP_MS doc comment, weapon.ts:243-257).
    /// UNLIKE energy/kindling/devotion above (TS-owned, step_world never
    /// touches), this field IS computed by step_world once this cut lands —
    /// accrues by eff_dt every tick the Fire input bit is held AND
    /// `character_id == .balanced` (== `classIdForArchetype(...) ===
    /// "wizard"`, cardTypes.ts's ARCHETYPE_CLASS_ID map) AND the player is
    /// alive, resets to 0 otherwise (see world.zig's per-player combat
    /// loop). No flag needed — same "always-valid resource, no unset
    /// ambiguity" contract as energy/kindling (0 IS the correct rest
    /// state, not a sentinel), not the `has_*`/`*_until_tick` window-field
    /// contract. Non-wizard players simply never move this field off 0.
    ///
    /// Layout: `syz_ward_absorb_remaining`'s f64 ends at offset 384,
    /// already 8-byte-aligned, so this f64 needs no padding — struct
    /// grows 384 → 392. See the comptime assert below and
    /// worldStateBridge.ts's PLAYER_ENTITY_SIZE (NOTE: that TS constant is
    /// NOT updated by this pass — see this field's own callers in world.zig
    /// and the task-level report for why crossing the wasm ABI for this
    /// field is deliberately deferred; it is read/written by step_world
    /// only, never packed/unpacked by worldStateBridge.ts today).
    channel_hold_ms: f64 = 0,
};

/// Mirrors `ProjectileEntity`.
pub const ProjectileEntity = extern struct {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    radius: f64,
    damage: f64,
    lifetime_ms: f64,
    age_ms: f64,
    traveled_px: f64,
    origin_x: f64,
    origin_y: f64,
    homing_strength: f64,
    acceleration_multiplier: f64,
    gravity_scale: f64,
    range_px: f64,
    slow_multiplier: f64,
    sticky_fuse_ms: f64,
    impact_radius_px: f64,

    id: u32,
    bounces_remaining: u32,
    pierce_remaining: u32,
    split_count: u32,

    flags: ProjectileFlags,
    pathing: ProjectilePathing,
    element: ElementType,
    impact: ProjectileImpact,
    shape: ProjectileShape,

    owner_id_len: u8,
    _pad0: [3]u8 = .{ 0, 0, 0 },

    owner_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),

    /// 2026-07-20 gap-closure pass — the 3 remaining ProjectileEntity fields
    /// from client/src/sim/types.ts (statusScale:1004, leechFraction:1013,
    /// executeBelowFrac:1014), gated by has_status_scale/has_leech_fraction/
    /// has_execute_below_frac above (types.ts's wrapShots/enemyOnly/tendril/
    /// ninjaWave are plain booleans, already fully represented by
    /// ProjectileFlags's own new bits — no numeric storage needed for
    /// those 4). owner_id_bytes ends at offset 204 (172 + 32), a multiple
    /// of 4, so three f32 fields (4-byte aligned, no f64 alignment demand)
    /// slot in with zero padding: 204 → 216 exactly — the struct's
    /// documented 216-byte size is UNCHANGED. f32 (not f64) is the only
    /// choice that fits: the tail this replaces was `_reserved: [12]u8`
    /// (12 bytes) and 3×f64 needs 24; 3×f32 needs exactly 12. This is also
    /// not merely a size-saving preference — worldStateBridge.ts's
    /// `PROJECTILE_ENTITY_SIZE = 216` constant (client/src/sim/wasm/
    /// worldStateBridge.ts) is a TS file outside this pass's touch scope,
    /// so growing this struct at all was not an available option here
    /// without also editing that file. Precision tradeoff: these three
    /// TS `number` fields (status multipliers / health fractions, never
    /// raw pixel/velocity magnitudes) round-trip through f32 with ~7
    /// significant decimal digits — ample for values like "×2 status
    /// duration" or "0.15 leech fraction" or "0.2 execute threshold".
    /// _reserved is now fully consumed — any FUTURE ProjectileEntity
    /// addition needs its own struct-growth cut (see PlayerEntity's own
    /// growth-history comments below the comptime asserts for the pattern
    /// this file already follows for that).
    ///
    /// NOT YET BRIDGED: packProjectile/unpackProjectile in
    /// worldStateBridge.ts still only walk the pre-existing 18 f64 + 14
    /// flag fields (that file is off-limits to this Zig-only pass per the
    /// task's hard safety rules) — these 7 new fields exist and are usable
    /// by step_world's own internal logic but do not yet cross the TS<->
    /// wasm boundary. A follow-up TS-side cut must extend both codec
    /// functions (mirroring exactly how homingStrength/accelerationMultiplier
    /// are packed/unpacked today) before any TS-authored spawn (e.g. a
    /// future Priest tendril or Crimson Tithe cast routed through step_world)
    /// can actually populate them.
    status_scale: f32 = 0,
    leech_fraction: f32 = 0,
    execute_below_frac: f32 = 0,
};

/// Mirrors `SatelliteEntity`.
pub const SatelliteEntity = extern struct {
    angle: f64,
    orbit_radius: f64,
    fire_cooldown_ms: f64,
    lifetime_ms: f64,

    id: u32,
    has_owner: u32, // 0/1; padded to keep 8-byte alignment

    owner_id_len: u8,
    _pad0: [7]u8 = .{ 0, 0, 0, 0, 0, 0, 0 },

    owner_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),

    _reserved: [16]u8 = @splat(0),
};

/// Mirrors `DestructibleEntity`.
pub const DestructibleEntity = extern struct {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    health: f64,

    id: u32,
    flags: u32, // bit0=explosive, bit1=flammable
    kind: DestructibleKind,
    _pad0: [7]u8 = .{ 0, 0, 0, 0, 0, 0, 0 },

    _reserved: [8]u8 = @splat(0),
};

/// Mirrors `FireEntity`.
pub const FireEntity = extern struct {
    x: f64,
    y: f64,
    radius: f64,
    remaining_ms: f64,
    damage_per_second: f64,

    id: u32,
    has_owner: u32,
    owner_id_len: u8,
    _pad0: [7]u8 = .{ 0, 0, 0, 0, 0, 0, 0 },
    owner_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),
};

/// Mirrors `PaperDoubleEntity` (2026-07-20 gap-closure pass item 3 —
/// client/src/sim/types.ts:1197-1221, client/src/sim/paperDouble.ts). A
/// straight-line kinematic mover (no platform collision/gravity, per
/// types.ts's own header comment) that both self-expires on a clock AND
/// collides with projectiles — same overall shape as `DestructibleEntity`
/// above, cloned field-for-field with that struct's layout discipline
/// (f64s first, id, then a length-prefixed owner id buffer padded to an
/// 8-byte boundary, `_reserved` tail for future growth room). Unlike
/// `FireEntity`'s `has_owner` (world-owned fire patches exist), a decoy
/// ALWAYS has a living owner (types.ts: "never null") — no has_owner flag
/// needed.
///
/// Deliberately has NO wasm-ABI crossing today: types.ts's own header
/// comment is explicit that `PaperDoubleEntity` does NOT cross the WASM
/// ABI (six-axes-goal.md "Zig line" — TS-only combat/ability state, not
/// identity/roster/resource state). This mirror exists purely for
/// step_world's OWN internal use (movement/expiry/collision/compaction),
/// ready for a later phase's ability-cast system to spawn into — see this
/// pass's own report for what's deliberately NOT wired yet (spawn-on-cast).
pub const PaperDoubleEntity = extern struct {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    health: f64,
    remaining_ms: f64,

    id: u32,
    owner_id_len: u8,
    _pad0: [3]u8 = .{ 0, 0, 0 },

    owner_id_bytes: [PLAYER_ID_BYTES]u8 = @splat(0),

    _reserved: [8]u8 = @splat(0),
};

/// Deferred-write instant-AOE cast (2026-07-20 gap-closure pass) — port of
/// the PATTERN (not yet any of the abilities) behind World.ts's
/// `PendingInstantAoe` type (World.ts:1589-1608) + `pendingInstantAoe`
/// queue (World.ts:1609) + `resolveInstantAoeCasts` (World.ts:3675-3821).
/// TS's own header comment on this type (World.ts:1580-1588) names the
/// exact hazard it exists to avoid: writing damage into ANOTHER player's
/// entity while still mid-way through the per-player loop risks that
/// write being silently clobbered once that OTHER player's own turn runs
/// later in the same tick. Queuing here and resolving in one dedicated
/// pass strictly AFTER every player's per-tick turn has finished (world.zig
/// section "6b", after section 6's per-player loop, before section 9's
/// end-of-tick compaction) is the fix — same category as the swing-phase/
/// melee-memory structs already in this file (PlayerMovementMemory below):
/// a non-wire-contract, host-only intermediate type that never crosses the
/// wasm ABI (no push-site/ability-cast system exists in Zig yet — see this
/// pass's own report for what's deliberately NOT wired).
///
/// Field set mirrors TS's `PendingInstantAoe` exactly (verified against
/// the type + all 5 real `pendingInstantAoe.push(...)` call sites —
/// wall-bloom, shock-ring, prism-fan, flock-pulse, shard-ring — grepped
/// directly, not guessed): `kind` (TS: string, "carried through only for
/// future debugging/telemetry, never branched on in the resolution pass"
/// per its own doc comment) is DELIBERATELY omitted here — a purely
/// cosmetic field with zero behavioral effect in TS, and no Zig-side
/// debugging harness consumes it yet. `element` is ALSO absent — checked
/// directly: none of the 5 push sites set one, and the TS type has no such
/// field at all, so a Zig element field would be inventing surface TS
/// doesn't have.
///
/// `caster_idx` is a plain array INDEX into `WorldState.players`, not a
/// copy of `PLAYER_ID_BYTES` (contrast `ProjectileEntity.owner_id_bytes`,
/// which DOES need a byte-stable id because a projectile can outlive many
/// ticks and the roster is only guaranteed stable within one). A pending
/// cast is pushed and resolved within the SAME `stepWorld` call, and
/// `WorldState.player_count`/index assignment never changes mid-tick
/// (joins/leaves are host-side, applied between ticks) — so the index is
/// always valid at resolve time, and skips a 32-byte copy × 32 queue slots
/// for no benefit.
///
/// Cone fields (`aim_angle`/`cone_radians`) mirror TS's optional
/// `aimAngle?`/`coneRadians?` pair (Prism Fan only, "both present or both
/// absent" per TS's own comment) via `has_cone` — same "unset vs 0"
/// explicit-flag convention `PlayerFlags` uses throughout this file, since
/// 0 is a valid cone angle. Same shape for `slow_multiplier`/
/// `slow_duration_ms` (`has_slow`; Flock Pulse) and `fooled_duration_ms`
/// (`has_fooled`; Paper Double's burst, TS: `fooledDurationMs?`).
///
/// STORAGE NOTE: unlike `PlayerMovementMemory`/`ResolvedFireConfig` (both
/// WorldState fields precisely because they must SURVIVE across ticks —
/// movement memory carries coyote-time state tick-to-tick, fire config is
/// host-patched once and read many times), this queue's CONTENTS are
/// meaningless before this tick's section 6 runs and drained back to empty
/// by the end of this same tick's section 6b. Even so, the array is still a
/// `WorldState` field (not stepWorld-local stack scratch): `world.zig`'s
/// tests construct a `WorldState` directly and hand-push entries onto it
/// BEFORE calling `stepWorld` (the exact `state.paper_doubles[0] = .{...}`
/// precedent test/smoke.zig already uses for Paper Double) — a
/// function-local array has no seam a test running through the real
/// `stepWorld` entry point could reach. `resolveInstantAoeCasts` resets
/// `pending_instant_aoe_count` to 0 once it has drained the queue every
/// tick, so stale entries never survive past the tick that queued them.
pub const PendingInstantAoe = extern struct {
    x: f64,
    y: f64,
    radius: f64,
    damage: f64,
    aim_angle: f64 = 0,
    cone_radians: f64 = 0,
    slow_multiplier: f64 = 0,
    slow_duration_ms: f64 = 0,
    fooled_duration_ms: f64 = 0,

    /// Index into `WorldState.players` at push time (see doc comment
    /// above for why an index, not an id-byte copy, is safe here).
    caster_idx: u32,
    has_cone: u8 = 0,
    has_slow: u8 = 0,
    /// Stored for forward-compat (Paper Double's burst — a SECOND, later
    /// batch through this same resolver, per this pass's own report) but
    /// NOT applied by `resolveInstantAoeCasts` yet: it would write to a
    /// `fooled_until_tick` field that does not exist on `PlayerEntity`
    /// today (Paper Double's burst debuff is TS-only ability state, same
    /// "additive growth cut needed first" contract as `channel_hold_ms`'s
    /// own doc comment above). A future PlayerEntity growth pass adds the
    /// field + flag; this queue entry already carries the value so that
    /// pass only has to touch the resolver, not every push site again.
    has_fooled: u8 = 0,
    _pad: u8 = 0,
};

/// Per-player movement memory — the host-only fields that the
/// player.zig stepPlayer kernel needs to thread across ticks
/// (coyote time, jump buffer, jump-cut flag, grounded-last-frame,
/// jetpack active). Indexed parallel to `WorldState.players`.
pub const PlayerMovementMemory = extern struct {
    coyote_ms: f64,
    jump_buffer_ms: f64,
    // Deep-movement augment memory (double-jump + dash). f64s first for align.
    dash_cooldown_ms: f64 = 0,
    dash_active_ms: f64 = 0,
    dash_recovery_ms: f64 = 0,
    jump_cut_applied: u8,
    jump_released_since_jump: u8,
    grounded_last_frame: u8,
    jetpack_active: u8,
    /// Wall contact from last tick: -1 left, +1 right, 0 none (SMB wall movement).
    touching_wall_dir: i8 = 0,
    air_jumps_used: i8 = 0,
    dash_used_in_air: i8 = 0,
    _pad: [1]u8 = .{0},
};

/// Swing phase tag for `MeleeSwingMemory.phase` — mirrors the shape of TS's
/// `NinjaSlashPhase`/`PaladinEdgePhase` (both `0 | 1 | 2 | 3` unions,
/// World.ts:357-360/431-435): idle(0, ready) -> windup(1, readable tell)
/// -> active(2, contact-delay-gated hit-check window) -> recovery(3,
/// endlag, no re-swing) -> idle(0).
pub const MeleeSwingPhase = enum(u8) {
    idle = 0,
    windup = 1,
    active = 2,
    recovery = 3,
};

/// Per-player melee swing FSM memory (2026-07-20, base-melee-mechanic
/// gap-closure pass) — Ninja Slash + Paladin Kindled Edge share ONE slot
/// per player (unlike TS's two separate `melee`/`paladinMelee` Maps,
/// World.ts:343-354): a given player is exactly one chassis at a time
/// (`character_id` is singular), so a combined struct is sufficient and
/// simpler than mirroring TS's two-Map split, which exists there mainly
/// because Ninja's memory carries extra dash-through/wave bookkeeping this
/// port deliberately does NOT carry (see world.zig's melee step section
/// doc comment for the full "what's not ported" list) — with those fields
/// gone, nothing left to distinguish the two shapes.
///
/// Host-only, off-wire — same split as `PlayerMovementMemory` immediately
/// below: swing timing never touches WorldState's wire-visible fields
/// directly, only its CONSEQUENCES (health/velocity/events) do, and
/// player.zig's own dash-timer memory is this file's existing precedent
/// for "per-player scratch that's a deterministic function of replayed
/// inputs, so it never needs to cross the wasm ABI to stay in sync between
/// prediction and authority." Indexed parallel to `WorldState.players`,
/// same convention as `player_movement`.
pub const MeleeSwingMemory = extern struct {
    /// ms remaining in the current phase; 0/irrelevant when phase == .idle.
    phase_ms: f64 = 0,
    /// Swing direction captured at windup start (unit vector, attacker's
    /// position toward their aim cursor at that instant) — reused by the
    /// arc hit-check for the WHOLE swing so a target drifting mid-swing
    /// doesn't "steer" the blade. Mirrors NinjaMeleeMemory.aimX/aimY /
    /// PaladinMeleeMemory.aimX/aimY (World.ts:373-377/451-454).
    aim_x: f64 = 1,
    aim_y: f64 = 0,
    /// Victim bitmask already hit by the CURRENT swing's active window —
    /// one bit per player index (MAX_PLAYERS=16 fits a u16 exactly).
    /// Mirrors NinjaMeleeMemory.hitThisSwing / PaladinMeleeMemory.
    /// hitThisSwing (`Set<PlayerId>` in TS) — a bitmask is the natural
    /// extern-struct-safe equivalent for a fixed MAX_PLAYERS roster.
    hit_this_swing_mask: u16 = 0,
    phase: MeleeSwingPhase = .idle,
    _pad: u8 = 0,
};

/// Resolved per-player fire config — what `step_world` reads
/// when spawning projectiles instead of the global weapon_base.
/// Host-side TS computes this from `createWeaponBuild` (cards
/// applied) once per tick + patches it into wasm memory.
///
/// Without this, every player fires the bare starter pistol
/// regardless of their card hand → multi-shot doesn't work,
/// damage cards do nothing, build variety is invisible.
pub const ResolvedFireConfig = extern struct {
    damage: f64,
    fire_rate: f64, // shots/sec
    projectile_speed: f64,
    projectile_lifetime_seconds: f64,
    spread_radians: f64,
    range_px: f64,
    homing_strength: f64,
    acceleration_multiplier: f64,
    gravity_scale: f64,
    slow_multiplier: f64,
    impact_radius_px: f64,
    size_multiplier: f64,
    speed_multiplier: f64,
    lifetime_multiplier: f64,
    projectile_count: u32,
    bounces: u32,
    pierce_count: u32,
    split_count: u32,
    shape: ProjectileShape,
    element: ElementType,
    pathing: ProjectilePathing,
    impact: ProjectileImpact,
    /// 1 = config valid + use this; 0 = fall back to starter
    /// pistol base from data/weapons.zig.
    valid: u8,
    _pad: [3]u8 = .{ 0, 0, 0 },
    // ── Card augments (offset 136+). Mirrors ResolvedFireConfigBytes in
    //    client/src/sim/wasm/wasmHost.ts — the host resolves the build TS-side
    //    and writes these so the Zig orchestrator applies the SAME movement /
    //    shield / parry augments as the TS orchestrator (parity for cutover).
    move_speed_mul: f64 = 1,
    gravity_mul: f64 = 1,
    jump_mul: f64 = 1,
    wall_jump_mul: f64 = 1,
    wall_slide_mul: f64 = 1,
    shield_charge_mul: f64 = 1,
    shield_recharge_mul: f64 = 1,
    parry_cover_mul: f64 = 1,
    parry_cooldown_mul: f64 = 1,
    max_health_add: f64 = 0,
    air_jumps: u32 = 0,
    dash_charges: u32 = 0,
    mirror_shield: u8 = 0,
    directional_shield: u8 = 0,
    _pad2: [6]u8 = .{ 0, 0, 0, 0, 0, 0 },
    // Appended — keeps every offset above stable (I25: repurposed Quick Parry
    // from the dead timed-parry cooldown onto the dash-bash slide's cooldown).
    dash_cooldown_mul: f64 = 1,
};

/// SimEvent kind tag (Phase I18). Mirrors the discriminated
/// `SimEvent` union in client/src/sim/types.ts but flat: each
/// event carries an i32 tag + 4 generic numeric payload slots
/// (player_idx_a, player_idx_b, entity_id, scalar) which the
/// caller decodes per kind.
pub const SimEventKind = enum(u32) {
    none = 0,
    shot_fired = 1,
    hit_confirmed = 2,
    destructible_broken = 3,
    pickup_taken = 4,
    round_end = 5,
    player_killed = 6,
    parry_deflected = 7,
    shield_popped = 8,
    explosion = 9,
    fire_hit = 10,
    /// Launch pad fired (world.zig §8c / TS launchPad.ts). Additive tag —
    /// player_idx_a = launched player, entity_id = pad INDEX in the host's
    /// pad array (pads are static map data, not WorldState entities).
    launch_pad_fired = 11,
    /// Emission cast (world.zig §6 cast branch / TS World.ts cast —
    /// docs/emission-engine-goal.md). player_idx_a = caster, scalar =
    /// volley count, x/y = cast origin. Element is NOT carried — the TS
    /// event converter resolves it from the caster's build.
    emission_cast = 12,
};

pub const SimEvent = extern struct {
    kind: u32,
    player_idx_a: i32,
    player_idx_b: i32,
    entity_id: u32,
    scalar: f64,
    x: f64,
    y: f64,
};

/// Mirrors `PickupEntity`.
pub const PickupEntity = extern struct {
    x: f64,
    y: f64,
    radius: f64,
    amount: f64,
    duration_ms: f64,
    respawn_ms: f64,

    id: u32,
    respawn_at_tick: u32,
    flags: u32, // bit0=active, bit1=has_duration, bit2=has_respawn
    kind: PickupKind,
    _pad0: [3]u8 = .{ 0, 0, 0 },
};

// -----------------------------------------------------------------
// Sanity: each entity comes out at the size we promised in G1a so
// the WorldState total stays fixed.

pub const PLAYER_ENTITY_BYTES: usize = @sizeOf(PlayerEntity);
pub const PROJECTILE_ENTITY_BYTES: usize = @sizeOf(ProjectileEntity);
pub const SATELLITE_ENTITY_BYTES: usize = @sizeOf(SatelliteEntity);
pub const DESTRUCTIBLE_ENTITY_BYTES: usize = @sizeOf(DestructibleEntity);
pub const FIRE_ENTITY_BYTES: usize = @sizeOf(FireEntity);
pub const PICKUP_ENTITY_BYTES: usize = @sizeOf(PickupEntity);
pub const PAPER_DOUBLE_ENTITY_BYTES: usize = @sizeOf(PaperDoubleEntity);
pub const PENDING_INSTANT_AOE_BYTES: usize = @sizeOf(PendingInstantAoe);

/// Header — packed up front so the host can cheaply read tick /
/// rng_state without dereferencing a full WorldState.
/// 40 bytes after I2 added countdown_remaining_ms (f64). Layout
/// is u32×7 + u8×8 (round_phase + 3 pad + 4 trail pad) + f64.
/// Order is u32s first, then alignment fix-up, then the f64 to
/// keep natural 8-byte alignment without internal padding.
pub const WorldStateHeader = extern struct {
    tick: u32,
    rng_state: u32,
    round_phase: u8,
    _pad0: [3]u8 = .{ 0, 0, 0 },
    next_entity_id: u32,
    map_id: u32,
    /// Bitmask of active chaos modifier ids (Phase I3). Bit N
    /// corresponds to `data/chaos.zig::ChaosModifierId` value N.
    /// Resolves into a `ChaosProfile` each tick via
    /// `chaosProfileFromMask`.
    chaos_mask: u32,
    fire_hazard_timer_ms: u32,
    round_index: u32,
    /// Round wins required to win the match (Phase I9). 0 disables
    /// match-end detection (orchestrator stays in fighting/round-
    /// over loop forever).
    target_score: u32,
    /// Match winner index (Phase I9). -1 = no match winner yet,
    /// ≥ 0 = player array index that hit target_score.
    match_winner_idx: i32,
    countdown_remaining_ms: f64,
};

pub const WorldState = extern struct {
    header: WorldStateHeader,

    player_count: u32,
    _pad_after_player_count: [4]u8 = .{ 0, 0, 0, 0 },
    players: [MAX_PLAYERS]PlayerEntity,

    projectile_count: u32,
    _pad_after_projectile_count: [4]u8 = .{ 0, 0, 0, 0 },
    projectiles: [MAX_PROJECTILES]ProjectileEntity,

    satellite_count: u32,
    _pad_after_satellite_count: [4]u8 = .{ 0, 0, 0, 0 },
    satellites: [MAX_SATELLITES]SatelliteEntity,

    destructible_count: u32,
    _pad_after_destructible_count: [4]u8 = .{ 0, 0, 0, 0 },
    destructibles: [MAX_DESTRUCTIBLES]DestructibleEntity,

    fire_count: u32,
    _pad_after_fire_count: [4]u8 = .{ 0, 0, 0, 0 },
    fires: [MAX_FIRE]FireEntity,

    pickup_count: u32,
    _pad_after_pickup_count: [4]u8 = .{ 0, 0, 0, 0 },
    pickups: [MAX_PICKUPS]PickupEntity,

    /// Paper Double decoys (2026-07-20 gap-closure pass item 3). Not yet
    /// spawned by anything (no Zig ability-cast system exists — see
    /// PaperDoubleEntity's own doc comment) but fully stepped/collided/
    /// compacted by stepWorld every tick, ready for a later phase's
    /// spawn-on-cast hook.
    paper_double_count: u32,
    _pad_after_paper_double_count: [4]u8 = .{ 0, 0, 0, 0 },
    paper_doubles: [MAX_PAPER_DOUBLES]PaperDoubleEntity,

    /// Parallel to `players[]` — index N is movement memory for
    /// players[N]. Used by player.stepPlayer (Phase I14+).
    player_movement: [MAX_PLAYERS]PlayerMovementMemory,

    /// Parallel to `players[]` — index N is melee swing FSM memory for
    /// players[N] (2026-07-20 base-melee-mechanic gap-closure pass). Used
    /// by world.zig's melee step section; see `MeleeSwingMemory`'s own doc
    /// comment for the host-only/off-wire contract.
    melee_swing: [MAX_PLAYERS]MeleeSwingMemory,

    /// Parallel to `players[]` — resolved fire config from
    /// applied cards. Host writes this each tick from
    /// `createWeaponBuild`. Without `valid=1`, step_world
    /// falls back to the starter pistol base.
    player_fire_config: [MAX_PLAYERS]ResolvedFireConfig,

    /// Static-AABB cache (I15). Caller bakes the map's platforms
    /// into this array before the first step_world call; static
    /// across the match. Used by player.stepPlayer +
    /// projectile.stepV2 for terrain collision.
    static_count: u32,
    _pad_after_static_count: [4]u8 = .{ 0, 0, 0, 0 },
    statics: [MAX_STATICS]@import("collision.zig").AABB,
    /// Parallel to `statics[]` — 1 if the corresponding AABB is a
    /// one-way platform (player can jump up through it; projectiles
    /// pass freely from below).
    one_way: [MAX_STATICS]u8,
    _pad_after_one_way: [4]u8 = .{ 0, 0, 0, 0 },

    /// Deferred-write instant-AOE cast queue (2026-07-20 gap-closure pass —
    /// see `PendingInstantAoe`'s own doc comment for the full "why a
    /// WorldState field, not stepWorld-local scratch" reasoning). Per-tick
    /// like `events` immediately below — world.zig's new "6b" section
    /// resolves whatever is queued here (nothing, today — no ability-cast
    /// system pushes into it yet) and resets the count back to 0 before
    /// section 9's end-of-tick compaction runs, every tick.
    pending_instant_aoe_count: u32,
    _pad_after_pending_instant_aoe_count: [4]u8 = .{ 0, 0, 0, 0 },
    pending_instant_aoe: [MAX_PENDING_INSTANT_AOE]PendingInstantAoe,

    /// Per-tick events buffer (I18). step_world resets event_count
    /// to 0 at the start of every tick and pushes events as it
    /// runs. The host drains this by reading
    /// events[0..event_count] after each step_world call.
    event_count: u32,
    _pad_after_event_count: [4]u8 = .{ 0, 0, 0, 0 },
    events: [MAX_EVENTS_PER_TICK]SimEvent,
};

// -----------------------------------------------------------------
// Comptime size assertions. Keep them tight — every change here
// goes through a deliberate cut so callers stay in sync.

comptime {
    std.debug.assert(@sizeOf(WorldStateHeader) == 48);

    // Each entity is 8-byte-aligned and tail-packed with explicit
    // _reserved bytes. These numbers are the wire contract — change
    // them only in a protocol-version bump.
    // 296 → 328 (2026-07-18, class-overhaul-workboard.md chunk 1.1): +25
    // content bytes (team_id_len + team_id_bytes[24]) rounded up to the
    // next 8-byte multiple by the struct's own alignment (7 bytes implicit
    // tail padding). See PlayerEntity.team_id_bytes's doc comment.
    // 328 → 336 (2026-07-18, class-overhaul-workboard.md chunk 2.3): +8
    // bytes for PlayerEntity.kindling (f64) — reclaims the 7 bytes of
    // tail padding above as real alignment space rather than adding a
    // fresh 8-byte-aligned pad on top. See PlayerEntity.kindling's doc
    // comment.
    // 336 → 360 (2026-07-18, class-overhaul-workboard.md chunk 3.1): +24
    // bytes for PlayerEntity.regen_until_tick/haste_until_tick (u32 ×2) +
    // regen_hps/haste_multiplier (f64 ×2) — no padding needed anywhere
    // (336 and 344 are both already aligned for what follows them). See
    // PlayerEntity.regen_until_tick's doc comment.
    // 360 → 368 (2026-07-18, class-overhaul-workboard.md chunk 3.2): +8
    // bytes for PlayerEntity.devotion (f64) — 360 already 8-byte-aligned,
    // no padding. See PlayerEntity.devotion's doc comment.
    // 368 → 384 (2026-07-18, class-overhaul-workboard.md chunk 3.3): +16
    // bytes for PlayerEntity.syz_ward_absorb_until_tick (u32) +
    // syz_ward_absorb_remaining (f64) — 4 bytes of implicit alignment
    // padding between the two (372 → 376) since a lone u32 precedes an f64.
    // See PlayerEntity.syz_ward_absorb_until_tick's doc comment.
    // 384 → 392 (2026-07-20, gap-closure pass item 2, weapon.ts:243-257 /
    // constants.ts GEO_CHANNEL_RAMP_MS): +8 bytes for
    // PlayerEntity.channel_hold_ms (f64) — 384 already 8-byte-aligned, no
    // padding. See PlayerEntity.channel_hold_ms's doc comment. KNOWN GAP:
    // worldStateBridge.ts's PLAYER_ENTITY_SIZE constant is still 384 as of
    // this cut (TS files are out of scope for this Zig-only pass) — a
    // follow-up TS cut MUST bump it to 392 and extend pack/unpackPlayer
    // before step_world's wasm export path can be exercised through that
    // bridge with this field populated. Zig-internal tests (this file's
    // comptime assert + world.zig's own native calls) are unaffected since
    // they read @sizeOf(PlayerEntity) directly, never the stale TS literal.
    std.debug.assert(@sizeOf(PlayerEntity) == 392);
    // ProjectileEntity: SIZE UNCHANGED at 216 despite 3 new numeric fields
    // (2026-07-20 gap-closure pass item 1) — status_scale/leech_fraction/
    // execute_below_frac (f32 ×3 = 12 bytes) exactly fill what used to be
    // `_reserved: [12]u8`. See ProjectileEntity.status_scale's doc comment
    // for the full byte-math + the f32-vs-f64 tradeoff. worldStateBridge.ts's
    // PROJECTILE_ENTITY_SIZE (216) stays correct as-is; only its
    // packProjectile/unpackProjectile codec bodies are stale (don't yet
    // read/write these 3 fields or the 7 new ProjectileFlags bits) — same
    // "TS follow-up needed, out of scope here" note as PlayerEntity above.
    std.debug.assert(@sizeOf(ProjectileEntity) == 216);
    std.debug.assert(@sizeOf(SatelliteEntity) == 96);
    std.debug.assert(@sizeOf(DestructibleEntity) == 64);
    std.debug.assert(@sizeOf(FireEntity) == 88);
    std.debug.assert(@sizeOf(PickupEntity) == 64);
    // PaperDoubleEntity (2026-07-20 gap-closure pass item 3): 6×f64 (48) +
    // id u32 (4) + owner_id_len u8 (1) + 3 bytes pad to the next 8-byte
    // boundary (56) + owner_id_bytes[32] (88) + _reserved[8] (96) — 96 is
    // already 8-byte-aligned, no further tail padding. See
    // PaperDoubleEntity's own doc comment for the DestructibleEntity-
    // pattern rationale.
    std.debug.assert(@sizeOf(PaperDoubleEntity) == 96);
    // PendingInstantAoe (2026-07-20 gap-closure pass — deferred-write AOE
    // primitive): 9×f64 (72) + caster_idx u32 (4) + 3×u8 flags + 1×u8 pad
    // (4) = 80, already 8-byte-aligned, no tail padding. Doesn't cross the
    // wasm ABI (see its own doc comment) so this assert is pure internal
    // regression-catching, same role PlayerMovementMemory's assert plays.
    std.debug.assert(@sizeOf(PendingInstantAoe) == 80);
    std.debug.assert(@sizeOf(PlayerMovementMemory) == 48);
    // MeleeSwingMemory (2026-07-20 base-melee-mechanic gap-closure pass):
    // 3×f64 (24) + hit_this_swing_mask u16 (2) + phase u8 (1) + _pad u8 (1)
    // = 28 content bytes; extern struct alignment is 8 (from the f64
    // fields), so the total rounds up to 32 (4 bytes implicit tail
    // padding). Doesn't cross the wasm ABI (host-only, see its own doc
    // comment) so this assert is pure internal regression-catching, same
    // role PlayerMovementMemory's assert plays.
    std.debug.assert(@sizeOf(MeleeSwingMemory) == 32);
    std.debug.assert(@sizeOf(SimEvent) == 40);
    std.debug.assert(@sizeOf(ResolvedFireConfig) == 240);
}

// -----------------------------------------------------------------
// Wasm exports — let the host (TS bridge) pre-allocate the right
// amount of memory and assert at runtime that its struct mirror
// matches what Zig built. The doc-sync gate
// (`exportsDocSync.test.ts`) keeps `docs/zig-wasm-exports.md` in
// step with these.

pub export fn sizeof_world_state() u32 {
    return @intCast(@sizeOf(WorldState));
}

pub export fn sizeof_world_state_header() u32 {
    return @intCast(@sizeOf(WorldStateHeader));
}

pub export fn sizeof_player_entity() u32 {
    return @intCast(@sizeOf(PlayerEntity));
}

pub export fn sizeof_projectile_entity() u32 {
    return @intCast(@sizeOf(ProjectileEntity));
}

pub export fn sizeof_satellite_entity() u32 {
    return @intCast(@sizeOf(SatelliteEntity));
}

pub export fn sizeof_destructible_entity() u32 {
    return @intCast(@sizeOf(DestructibleEntity));
}

pub export fn sizeof_fire_entity() u32 {
    return @intCast(@sizeOf(FireEntity));
}

pub export fn sizeof_pickup_entity() u32 {
    return @intCast(@sizeOf(PickupEntity));
}

pub export fn sizeof_player_movement_memory() u32 {
    return @intCast(@sizeOf(PlayerMovementMemory));
}

pub export fn sizeof_resolved_fire_config() u32 {
    return @intCast(@sizeOf(ResolvedFireConfig));
}

/// Byte offset of `player_fire_config[0]` from the start of
/// `WorldState`. Host writes resolved fire configs directly into
/// wasm memory at this offset before each step_world call.
pub export fn offset_player_fire_config() u32 {
    return @intCast(@offsetOf(WorldState, "player_fire_config"));
}

pub export fn world_state_max_players() u32 {
    return @intCast(MAX_PLAYERS);
}

pub export fn world_state_max_projectiles() u32 {
    return @intCast(MAX_PROJECTILES);
}

pub export fn world_state_max_satellites() u32 {
    return @intCast(MAX_SATELLITES);
}

pub export fn world_state_max_destructibles() u32 {
    return @intCast(MAX_DESTRUCTIBLES);
}

pub export fn world_state_max_fire() u32 {
    return @intCast(MAX_FIRE);
}

pub export fn world_state_max_pickups() u32 {
    return @intCast(MAX_PICKUPS);
}

pub export fn world_state_max_statics() u32 {
    return @intCast(MAX_STATICS);
}

pub export fn world_state_max_events_per_tick() u32 {
    return @intCast(MAX_EVENTS_PER_TICK);
}

pub export fn sizeof_sim_event() u32 {
    return @intCast(@sizeOf(SimEvent));
}
