//! Headless replay stepper — gospel N0.3.
//!
//! Loads a packed initial `WorldState` (see server/tools/dump-replay-init.ts),
//! replays a `.jjr`'s input stream through the SAME `step_world` the wasm
//! path calls, and emits a hash of the state buffer every N ticks. Those
//! hashes are the port passport: run the identical inputs through wasm, and
//! the streams must match bit-for-bit (L10).
//!
//! The hash is over the RAW PACKED BUFFER rather than a semantic per-entity
//! digest, deliberately. Both sides share one 99,200-byte layout, so bytes
//! are the strongest available claim and need no second implementation to
//! drift from the first.
//!
//! Two contract details this must honour exactly, both read off the live
//! host rather than guessed (`serverWasmHost.step` +
//! `matchHost.runStep`):
//!
//!  1. SLOT ORDER comes from the buffer, not from sorting ids here. TS packs
//!     players by `id.localeCompare`, which Zig has no equivalent of, and
//!     re-deriving an order is exactly how the boundary grew two of them
//!     (fixed 2026-08-09 in 9199f84). Each `PlayerEntity` carries its own
//!     `id_bytes`, so the packed buffer states its own order.
//!  2. EVERY TICK ZEROES ALL KEYS. On the live path `packWorldState` writes
//!     `current_keys`/`prev_keys` as 0 for every player and the host patches
//!     only those with a frame this tick. Native never re-packs, so the
//!     zeroing has to be explicit or last tick's input would persist for a
//!     player who sent nothing — a divergence introduced by the harness
//!     rather than found by it.

const std = @import("std");
const sim = @import("sim_root");
const jjr = @import("jjr.zig");

const world_state = sim.world_state;
const WorldState = world_state.WorldState;

pub const Error = error{
    InitSizeMismatch,
    StateTooSmall,
    OutOfMemory,
};

pub const HashSample = struct {
    tick: u64,
    hash: u32,
};

/// FNV1a-32 over a byte span, using the sim's own primitives so the mixing
/// constants cannot drift from the rest of the codebase.
pub fn hashBytes(bytes: []const u8) u32 {
    var h: u32 = sim.hash.FNV1A_BASIS;
    for (bytes) |b| h = sim.hash.fnv1aMix(h, b);
    return h;
}

/// Read the id a slot actually holds. Empty when the slot is unused.
fn slotId(state: *const WorldState, slot: usize) []const u8 {
    const p = &state.players[slot];
    const len = @min(@as(usize, p.id_len), p.id_bytes.len);
    return p.id_bytes[0..len];
}

pub const Options = struct {
    /// Emit a hash every this many ticks (and always at the final tick).
    every: u64 = 60,
    /// Stop after this many ticks; 0 = the replay's own totalTicks.
    max_ticks: u64 = 0,
    /// Fixed timestep. The live host steps STEP_MS; anything else is a
    /// different simulation, not a faster one.
    dt_ms: f64 = 1000.0 / 60.0,
};

pub const Result = struct {
    ticks_stepped: u64,
    inputs_applied: u64,
    /// Hash of the final state buffer — the single number two backends must
    /// agree on if nothing else is compared.
    final_hash: u32,
    samples: []HashSample,
};

/// Step `replay` from `init_bytes`. `state_buf` is the live state buffer
/// (from `alloc_state`), which this overwrites.
pub fn run(
    gpa: std.mem.Allocator,
    state_buf: []u8,
    init_bytes: []const u8,
    replay: *const jjr.Replay,
    opts: Options,
) Error!Result {
    const packed_size = @sizeOf(WorldState);
    if (init_bytes.len != packed_size) return Error.InitSizeMismatch;
    if (state_buf.len < packed_size) return Error.StateTooSmall;

    @memcpy(state_buf[0..packed_size], init_bytes);
    const state: *WorldState = @ptrCast(@alignCast(state_buf.ptr));

    // Slot order, straight from the buffer (contract note 1).
    const player_count = @min(@as(usize, state.player_count), state.players.len);
    var last_keys = try gpa.alloc(u32, player_count);
    defer gpa.free(last_keys);
    @memset(last_keys, 0);

    var samples: std.ArrayList(HashSample) = .empty;
    defer samples.deinit(gpa);

    const total = if (opts.max_ticks > 0)
        opts.max_ticks
    else
        replay.header.total_ticks;

    var cursor: usize = 0;
    var inputs_applied: u64 = 0;
    var tick: u64 = 1;
    while (tick <= total) : (tick += 1) {
        // Contract note 2 — clear every live player's input for this tick.
        var s: usize = 0;
        while (s < player_count) : (s += 1) {
            state.players[s].current_keys = 0;
            state.players[s].prev_keys = 0;
        }

        // Apply every frame stamped at this tick. The recorder appends in
        // server-tick order, so a forward cursor is sufficient; frames for
        // earlier ticks (should not exist) are skipped rather than
        // misapplied.
        while (cursor < replay.inputs.len and replay.inputs[cursor].at_tick < tick) {
            cursor += 1;
        }
        while (cursor < replay.inputs.len and replay.inputs[cursor].at_tick == tick) {
            const in = replay.inputs[cursor];
            if (findSlot(state, player_count, in.player_id)) |slot| {
                const p = &state.players[slot];
                p.aim_x = in.aim_x;
                p.aim_y = in.aim_y;
                p.current_keys = @truncate(in.keys);
                p.prev_keys = last_keys[slot];
                last_keys[slot] = @truncate(in.keys);
                inputs_applied += 1;
            }
            cursor += 1;
        }

        const rc = sim.world.step_world(state, opts.dt_ms);
        if (rc != 0) {
            // Surface it as data, not a crash: a nonzero rc mid-replay is
            // itself a finding worth reporting with the tick attached.
            break;
        }

        if (tick % opts.every == 0 or tick == total) {
            try samples.append(gpa, .{
                .tick = tick,
                .hash = hashBytes(state_buf[0..packed_size]),
            });
        }
    }

    return .{
        .ticks_stepped = tick - 1,
        .inputs_applied = inputs_applied,
        .final_hash = hashBytes(state_buf[0..packed_size]),
        .samples = try samples.toOwnedSlice(gpa),
    };
}

fn findSlot(
    state: *const WorldState,
    player_count: usize,
    id: []const u8,
) ?usize {
    var i: usize = 0;
    while (i < player_count) : (i += 1) {
        if (std.mem.eql(u8, slotId(state, i), id)) return i;
    }
    return null;
}

// ── tests ────────────────────────────────────────────────────────────────

test "hashBytes matches the sim's own FNV1a chain" {
    // Not a golden value — a consistency check that this uses the sim's
    // primitives rather than a private copy.
    var expected: u32 = sim.hash.FNV1A_BASIS;
    for ("abc") |b| expected = sim.hash.fnv1aMix(expected, b);
    try std.testing.expectEqual(expected, hashBytes("abc"));
}

test "hashBytes is order-sensitive" {
    try std.testing.expect(hashBytes("ab") != hashBytes("ba"));
}
