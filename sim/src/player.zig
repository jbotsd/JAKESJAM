//! Player movement step — bit-exact port of
//! `client/src/sim/player.ts` `stepPlayer`. Run/jump/gravity/
//! friction/coyote/buffer/cut/fastFall/crouch + jetpack +
//! sub-stepped collision resolve.
//!
//! Phase B4 of the Zig→WASM migration (ADR-0006). See
//! `docs/zig-wasm-migration.md`.

const std = @import("std");
const collision = @import("collision.zig");

// ── Constants (mirror player.ts `M`) ──────────────────────────────────────
const MAX_GROUND_SPEED: f64 = 330.0;
const GROUND_ACCELERATION: f64 = 2700.0;
const AIR_ACCELERATION: f64 = 2050.0;
const GROUND_FRICTION: f64 = 3600.0;
const GRAVITY: f64 = 1450.0;
const FAST_FALL_GRAVITY: f64 = 2150.0;
const JUMP_VELOCITY: f64 = -635.0;
const JUMP_CUT_MULTIPLIER: f64 = 0.48;
const COYOTE_MS: f64 = 110.0;
const JUMP_BUFFER_MS: f64 = 110.0;
const MAX_FALL_SPEED: f64 = 900.0;
const CROUCH_SPEED_FACTOR: f64 = 0.42;
const BODY_WIDTH: f64 = 26.0;
const BODY_HEIGHT: f64 = 56.0;
const CROUCH_HEIGHT: f64 = 38.0;

const JETPACK_MAX_FUEL: f64 = 125.0;
const JETPACK_THRUST: f64 = 1480.0;
const JETPACK_FUEL_DRAIN_PER_SECOND: f64 = 32.0;
const JETPACK_GROUND_RECHARGE_PER_SECOND: f64 = 64.0;
const JETPACK_AIR_RECHARGE_PER_SECOND: f64 = 10.0;
const JETPACK_MIN_UPWARD_VELOCITY: f64 = -640.0;

// MIN_PLATFORM_H_PX from constants.ts (sub-step displacement clamp).
// Must match `client/src/sim/constants.ts` exactly — different values
// produce different sub_step counts, which diverge the integration.
const MIN_PLATFORM_H_PX: f64 = 12.0;

const Bit = struct {
    const left: u32 = 1 << 0;
    const right: u32 = 1 << 1;
    // up/down for fast-fall classification
    const down: u32 = 1 << 3;
    const jump: u32 = 1 << 4;
    const crouch: u32 = 1 << 5;
};

/// Combined PlayerEntity (subset touched by stepPlayer) + PlayerMovementMemory
/// in one extern struct for ABI simplicity. Caller mutates this in place.
///
/// Field order matches the wasm host packer in
/// `client/src/sim/wasm/runtime.ts` and the parity test —
/// changing it = wire-format change, bump anything that pins layout.
pub const PlayerStep = extern struct {
    // PlayerEntity-derived
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    aim_x: f64,
    aim_y: f64,
    jetpack_fuel: f64,
    crouching: i32, // 1 = crouching, 0 = upright
    _pad0: i32 = 0,

    // PlayerMovementMemory
    coyote_ms: f64,
    jump_buffer_ms: f64,
    jump_cut_applied: i32, // 1 = applied
    jump_released_since_jump: i32,
    grounded_last_frame: i32,
    jetpack_active: i32,
};

inline fn approach(value: f64, target: f64, amount: f64) f64 {
    if (value < target) return @min(value + amount, target);
    if (value > target) return @max(value - amount, target);
    return value;
}

inline fn clamp(value: f64, lo: f64, hi: f64) f64 {
    return @min(hi, @max(lo, value));
}

inline fn boolFromInt(v: i32) bool {
    return v != 0;
}

inline fn intFromBool(b: bool) i32 {
    return if (b) 1 else 0;
}

/// Pure stepPlayer. Mutates `s` in place; returns whether the player
/// jumped this frame.
pub fn stepPlayer(
    s: *PlayerStep,
    prev_keys: u32,
    curr_keys: u32,
    aim_x: f64,
    aim_y: f64,
    speed_mul: f64,
    gravity_mul: f64,
    dt_ms: f64,
    statics: []const collision.AABB,
    one_way: []const u8,
) bool {
    const dt_sec = dt_ms / 1000.0;

    const left = (curr_keys & Bit.left) != 0;
    const right = (curr_keys & Bit.right) != 0;
    const jump_held = (curr_keys & Bit.jump) != 0;
    const jump_pressed = jump_held and (prev_keys & Bit.jump) == 0;
    const jump_released = !jump_held and (prev_keys & Bit.jump) != 0;
    const wants_crouch = (curr_keys & Bit.crouch) != 0;
    const fast_fall = (curr_keys & Bit.down) != 0;

    s.aim_x = aim_x;
    s.aim_y = aim_y;

    // Coyote time + jump buffer.
    if (boolFromInt(s.grounded_last_frame)) {
        s.coyote_ms = COYOTE_MS;
    } else {
        s.coyote_ms = @max(0.0, s.coyote_ms - dt_ms);
    }
    if (jump_pressed) {
        s.jump_buffer_ms = JUMP_BUFFER_MS;
    } else {
        s.jump_buffer_ms = @max(0.0, s.jump_buffer_ms - dt_ms);
    }
    if (jump_released) {
        s.jump_released_since_jump = 1;
    }

    s.crouching = intFromBool(wants_crouch and boolFromInt(s.grounded_last_frame));

    // Horizontal acceleration / friction.
    const dir_r: f64 = if (right) 1.0 else 0.0;
    const dir_l: f64 = if (left) 1.0 else 0.0;
    const direction: f64 = dir_r - dir_l;
    if (direction != 0.0) {
        const accel = (if (boolFromInt(s.grounded_last_frame)) GROUND_ACCELERATION else AIR_ACCELERATION) * speed_mul;
        s.vx = s.vx + direction * accel * dt_sec;
    } else if (boolFromInt(s.grounded_last_frame)) {
        s.vx = approach(s.vx, 0.0, GROUND_FRICTION * dt_sec);
    }
    const crouch_factor: f64 = if (boolFromInt(s.crouching)) CROUCH_SPEED_FACTOR else 1.0;
    const max_speed = MAX_GROUND_SPEED * speed_mul * crouch_factor;
    s.vx = clamp(s.vx, -max_speed, max_speed);

    // Jump (with coyote + buffer).
    var jumped_this_frame = false;
    if (s.jump_buffer_ms > 0.0 and s.coyote_ms > 0.0) {
        s.vy = JUMP_VELOCITY;
        s.coyote_ms = 0.0;
        s.jump_buffer_ms = 0.0;
        s.jump_released_since_jump = 0;
        s.jump_cut_applied = 0;
        jumped_this_frame = true;
    }

    // Variable jump height: cut upward velocity once jump released.
    if (boolFromInt(s.jump_released_since_jump) and !boolFromInt(s.jump_cut_applied) and s.vy < 0.0) {
        s.vy *= JUMP_CUT_MULTIPLIER;
        s.jump_released_since_jump = 0;
        s.jump_cut_applied = 1;
    }

    // Gravity.
    const gravity_now = (if (fast_fall and s.vy > 0.0) FAST_FALL_GRAVITY else GRAVITY) * gravity_mul;
    s.vy = @min(MAX_FALL_SPEED, s.vy + gravity_now * dt_sec);

    // Jetpack.
    const fuel_start = s.jetpack_fuel;
    const jetpack_held = jump_held and !boolFromInt(s.grounded_last_frame);
    const jetpack_active = jetpack_held and fuel_start > 0.0 and !boolFromInt(s.grounded_last_frame);
    var next_fuel = fuel_start;
    if (jetpack_active) {
        s.vy -= JETPACK_THRUST * dt_sec;
        s.vy = @max(JETPACK_MIN_UPWARD_VELOCITY, s.vy);
        next_fuel = fuel_start - JETPACK_FUEL_DRAIN_PER_SECOND * dt_sec;
    } else {
        const recharge_rate = if (boolFromInt(s.grounded_last_frame))
            JETPACK_GROUND_RECHARGE_PER_SECOND
        else
            JETPACK_AIR_RECHARGE_PER_SECOND;
        next_fuel = fuel_start + recharge_rate * dt_sec;
    }
    next_fuel = clamp(next_fuel, 0.0, JETPACK_MAX_FUEL);
    s.jetpack_fuel = next_fuel;
    s.jetpack_active = intFromBool(jetpack_active);

    // Movement resolution against platforms — sub-stepped.
    const body_height: f64 = if (boolFromInt(s.crouching)) CROUCH_HEIGHT else BODY_HEIGHT;
    var aabb = collision.AABB{
        .x = s.x - BODY_WIDTH / 2.0,
        .y = s.y - body_height / 2.0,
        .w = BODY_WIDTH,
        .h = body_height,
    };

    const max_step_disp = MIN_PLATFORM_H_PX * 0.6;
    const total_disp = @sqrt(s.vx * s.vx + s.vy * s.vy) * dt_sec;
    var sub_steps: u32 = 1;
    if (max_step_disp > 0.0) {
        const ceil_val = @ceil(total_disp / max_step_disp);
        const ceil_int: i64 = @intFromFloat(ceil_val);
        if (ceil_int > 1) {
            sub_steps = @intCast(ceil_int);
        }
    }
    const sub_dt = dt_sec / @as(f64, @floatFromInt(sub_steps));
    var grounded_acc = false;

    var i: u32 = 0;
    while (i < sub_steps) : (i += 1) {
        const resolved = collision.resolveMoveCached(aabb, s.vx, s.vy, sub_dt, statics, one_way);
        aabb = .{ .x = resolved.x, .y = resolved.y, .w = aabb.w, .h = aabb.h };
        s.vx = resolved.vx;
        s.vy = resolved.vy;
        if (resolved.grounded_this_frame == 1) grounded_acc = true;
    }
    s.x = aabb.x + BODY_WIDTH / 2.0;
    s.y = aabb.y + body_height / 2.0;
    s.grounded_last_frame = intFromBool(grounded_acc);

    return jumped_this_frame;
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

/// Returns 1 if the player jumped this frame, 0 otherwise.
pub export fn step_player(
    state_ptr: *PlayerStep,
    prev_keys: u32,
    curr_keys: u32,
    aim_x: f64,
    aim_y: f64,
    speed_mul: f64,
    gravity_mul: f64,
    dt_ms: f64,
    statics_ptr: [*]const collision.AABB,
    statics_count: u32,
    one_way_ptr: [*]const u8,
    one_way_count: u32,
) i32 {
    const statics = statics_ptr[0..statics_count];
    const one_way = one_way_ptr[0..one_way_count];
    const jumped = stepPlayer(
        state_ptr,
        prev_keys,
        curr_keys,
        aim_x,
        aim_y,
        speed_mul,
        gravity_mul,
        dt_ms,
        statics,
        one_way,
    );
    return if (jumped) 1 else 0;
}

pub export fn sizeof_player_step() u32 {
    return @sizeOf(PlayerStep);
}
