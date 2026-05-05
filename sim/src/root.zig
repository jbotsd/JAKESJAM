//! JAKESJAM deterministic sim — wasm module root.
//! See docs/adr/0006-zig-wasm-sim-substrate.md.
//!
//! Phase A scope: exports exist and round-trip; no real logic.
//! Phase B+ ports collision, player, projectile, etc.

const std = @import("std");
pub const rng = @import("rng.zig");
pub const collision = @import("collision.zig");
pub const player = @import("player.zig");
pub const projectile = @import("projectile.zig");
pub const hash = @import("hash.zig");
pub const trig = @import("trig.zig");
pub const fire = @import("fire.zig");
pub const satellite = @import("satellite.zig");
pub const weapon = @import("weapon.zig");
pub const combat = @import("combat.zig");
pub const destructible = @import("destructible.zig");
pub const spatial = @import("spatial.zig");
pub const world_state = @import("world_state.zig");

// Force wasm linker to include sub-modules' `export fn` symbols.
comptime {
    _ = rng;
    _ = collision;
    _ = player;
    _ = projectile;
    _ = hash;
    _ = trig;
    _ = fire;
    _ = satellite;
    _ = weapon;
    _ = combat;
    _ = destructible;
    _ = spatial;
    _ = world_state;
}

const STATE_SIZE: usize = 64 * 1024;
var state_buffer: [STATE_SIZE]u8 align(8) = @splat(0);

var tick: u32 = 0;

pub export fn alloc_state() [*]u8 {
    return @ptrCast(&state_buffer);
}

pub export fn free_state(ptr: [*]u8) void {
    _ = ptr;
}

pub export fn state_size() usize {
    return STATE_SIZE;
}

pub export fn step(
    state_ptr: [*]u8,
    state_len: usize,
    inputs_ptr: [*]const u8,
    inputs_len: usize,
    dt_ms: u32,
) void {
    _ = inputs_ptr;
    _ = inputs_len;
    _ = dt_ms;
    if (state_len < @sizeOf(u32)) return;
    const counter: *u32 = @ptrCast(@alignCast(state_ptr));
    counter.* +%= 1;
    tick +%= 1;
}

pub export fn current_tick() u32 {
    return tick;
}

pub export fn reset() void {
    @memset(&state_buffer, 0);
    tick = 0;
}
