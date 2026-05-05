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
pub const MAX_PROJECTILES: usize = 256;
pub const MAX_SATELLITES: usize = 32;
pub const MAX_DESTRUCTIBLES: usize = 64;
pub const MAX_FIRE: usize = 32;
pub const MAX_PICKUPS: usize = 32;

pub const PLAYER_ID_BYTES: usize = 32;
pub const WEAPON_ID_BYTES: usize = 24;
pub const CARD_ID_BYTES: usize = 24;
pub const MAX_PLAYER_CARDS: usize = 8;

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
    _reserved: u12 = 0,
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
    _reserved: u18 = 0,
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

    // Future field landing zone. Today it's all zeros on the wire.
    _reserved: [4]u8 = @splat(0),
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

    _reserved: [12]u8 = @splat(0),
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
};

// -----------------------------------------------------------------
// Comptime size assertions. Keep them tight — every change here
// goes through a deliberate cut so callers stay in sync.

comptime {
    std.debug.assert(@sizeOf(WorldStateHeader) == 48);

    // Each entity is 8-byte-aligned and tail-packed with explicit
    // _reserved bytes. These numbers are the wire contract — change
    // them only in a protocol-version bump.
    std.debug.assert(@sizeOf(PlayerEntity) == 288);
    std.debug.assert(@sizeOf(ProjectileEntity) == 216);
    std.debug.assert(@sizeOf(SatelliteEntity) == 96);
    std.debug.assert(@sizeOf(DestructibleEntity) == 64);
    std.debug.assert(@sizeOf(FireEntity) == 88);
    std.debug.assert(@sizeOf(PickupEntity) == 64);
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
