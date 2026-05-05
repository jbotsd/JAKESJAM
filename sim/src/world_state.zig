//! Phase G1a — WorldState extern struct skeleton.
//!
//! This file is the byte-stable cross-host contract for the FULL
//! sim state. The TS World currently owns the canonical
//! `WorldState` shape (client/src/sim/types.ts ~line 376); this
//! Zig mirror is what `step_world` (Phase I) will mutate in place.
//!
//! Discipline:
//!   1. `extern struct` with explicit padding — the Zig spec
//!      guarantees no implicit reordering, but alignment-driven
//!      tail padding still happens. We pin it.
//!   2. Fixed-size arrays + counts replace `Record<Id, Entity>`.
//!      Iteration becomes `for (state.projectiles[0..state.projectile_count])`.
//!      Free-list management moves into Zig (next_entity_id).
//!   3. Comptime size assertions in `_test_size_assertions` enforce
//!      that the layout is what we PROMISED downstream — see
//!      docs/zig-wasm-exports.md.
//!
//! G1a scaffold scope: header fields + count slots + placeholder
//! arrays of `[N]u8` so the layout is observable but the entity
//! structs themselves arrive in G1b. Pure-additive — no callers
//! yet, no exports referenced from other modules.

const std = @import("std");

pub const MAX_PLAYERS: usize = 16;
pub const MAX_PROJECTILES: usize = 256;
pub const MAX_SATELLITES: usize = 32;
pub const MAX_DESTRUCTIBLES: usize = 64;
pub const MAX_FIRE: usize = 32;
pub const MAX_PICKUPS: usize = 32;

// Placeholder entity sizes. G1b replaces these with real extern
// structs whose size is asserted against the corresponding TS
// type's `sizeof_*` export (already shipping for several modules).
pub const PLACEHOLDER_PLAYER_BYTES: usize = 256;
pub const PLACEHOLDER_PROJECTILE_BYTES: usize = 128;
pub const PLACEHOLDER_SATELLITE_BYTES: usize = 96;
pub const PLACEHOLDER_DESTRUCTIBLE_BYTES: usize = 64;
pub const PLACEHOLDER_FIRE_BYTES: usize = 64;
pub const PLACEHOLDER_PICKUP_BYTES: usize = 64;

/// Round phase tag — mirrors `RoundState.phase` in
/// `client/src/sim/types.ts`. Encoded as a single byte at the
/// boundary; the TS side maps to the union string literals.
///   0 = lobby, 1 = countdown, 2 = fighting, 3 = ending,
///   4 = drafting
pub const RoundPhase = enum(u8) {
    lobby = 0,
    countdown = 1,
    fighting = 2,
    ending = 3,
    drafting = 4,
};

/// Header — small fields packed up front so the host can read
/// `tick` / `rng_state` without dereferencing a full WorldState.
/// Aligns to 8 bytes for the f64 fields that follow in G1c.
pub const WorldStateHeader = extern struct {
    tick: u32,
    rng_state: u32,
    round_phase: u8,
    _pad0: [3]u8 = .{ 0, 0, 0 },
    next_entity_id: u32,
    map_id: u32,
    chaos_profile_id: u32,
    fire_hazard_timer_ms: u32,
};

/// G1a skeleton. The placeholder array bytes will become typed
/// `[N]PlayerEntity` etc. in G1b. The COUNT fields are already
/// real and will be untouched in G1b, so external readers that
/// learn how to iterate `players[0..player_count]` won't need to
/// be re-taught.
pub const WorldState = extern struct {
    header: WorldStateHeader,

    player_count: u32,
    _pad_after_player_count: [4]u8 = .{ 0, 0, 0, 0 },
    players: [MAX_PLAYERS * PLACEHOLDER_PLAYER_BYTES]u8 = @splat(0),

    projectile_count: u32,
    _pad_after_projectile_count: [4]u8 = .{ 0, 0, 0, 0 },
    projectiles: [MAX_PROJECTILES * PLACEHOLDER_PROJECTILE_BYTES]u8 = @splat(0),

    satellite_count: u32,
    _pad_after_satellite_count: [4]u8 = .{ 0, 0, 0, 0 },
    satellites: [MAX_SATELLITES * PLACEHOLDER_SATELLITE_BYTES]u8 = @splat(0),

    destructible_count: u32,
    _pad_after_destructible_count: [4]u8 = .{ 0, 0, 0, 0 },
    destructibles: [MAX_DESTRUCTIBLES * PLACEHOLDER_DESTRUCTIBLE_BYTES]u8 = @splat(0),

    fire_count: u32,
    _pad_after_fire_count: [4]u8 = .{ 0, 0, 0, 0 },
    fires: [MAX_FIRE * PLACEHOLDER_FIRE_BYTES]u8 = @splat(0),

    pickup_count: u32,
    _pad_after_pickup_count: [4]u8 = .{ 0, 0, 0, 0 },
    pickups: [MAX_PICKUPS * PLACEHOLDER_PICKUP_BYTES]u8 = @splat(0),
};

// -----------------------------------------------------------------
// Comptime size assertions. These pin the layout TODAY so G1b/G1c
// regressions are loud at compile time, not at the next snapshot
// codec mismatch.

comptime {
    // Header is 28 bytes of fields; tail-pads to 32 because the
    // outer struct's u32 counts force 4-byte alignment. Make this
    // explicit so a future field addition doesn't silently bump it.
    std.debug.assert(@sizeOf(WorldStateHeader) == 28);

    // Total size — used by the host to allocate the wasm-side
    // buffer. Must match `sizeof_world_state` export landed in G1c.
    const expected_size: usize =
        @sizeOf(WorldStateHeader) +
        // Each entity-array preamble is 8 bytes (count u32 + 4-byte
        // pad to align the byte array to 8).
        (MAX_PLAYERS * PLACEHOLDER_PLAYER_BYTES + 8) +
        (MAX_PROJECTILES * PLACEHOLDER_PROJECTILE_BYTES + 8) +
        (MAX_SATELLITES * PLACEHOLDER_SATELLITE_BYTES + 8) +
        (MAX_DESTRUCTIBLES * PLACEHOLDER_DESTRUCTIBLE_BYTES + 8) +
        (MAX_FIRE * PLACEHOLDER_FIRE_BYTES + 8) +
        (MAX_PICKUPS * PLACEHOLDER_PICKUP_BYTES + 8);
    std.debug.assert(@sizeOf(WorldState) == expected_size);
}

// -----------------------------------------------------------------
// G1c will move these into wasm exports. For G1a they're internal
// helpers so the assertions above can compile.

pub fn worldStateSize() usize {
    return @sizeOf(WorldState);
}

pub fn worldStateHeaderSize() usize {
    return @sizeOf(WorldStateHeader);
}
