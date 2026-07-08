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
// M1 (docs/game-feel-tuning.md): descend 1.5x faster than rise by default.
// Symmetric gravity gave a ~880ms full hop that read as floaty; every
// genre benchmark falls 1.4-2x faster than it rises. Apex height and
// rise time are unchanged; full hop is now ~730ms.
const DESCENT_GRAVITY: f64 = 2175.0;
const FAST_FALL_GRAVITY: f64 = 2800.0;
const JUMP_VELOCITY: f64 = -635.0;
const JUMP_CUT_MULTIPLIER: f64 = 0.48;
const COYOTE_MS: f64 = 110.0;
const JUMP_BUFFER_MS: f64 = 110.0;
const MAX_FALL_SPEED: f64 = 900.0;
const CROUCH_SPEED_FACTOR: f64 = 0.42;
const BODY_WIDTH: f64 = 26.0;
const BODY_HEIGHT: f64 = 56.0;
const CROUCH_HEIGHT: f64 = 38.0;
// Wall movement (SMB / Warframe) — replaces the jetpack. Mirror player.ts M.
const WALL_SLIDE_MAX_FALL: f64 = 175.0;
const WALL_JUMP_VY: f64 = -720.0;
const WALL_JUMP_VX: f64 = 470.0;
// Wall POWER-SLIDE: holding Down at the wall-jump trigger trades height for
// speed. Mirror player.ts M.wallPowerSlideVy/Vx.
const WALL_POWER_SLIDE_VY: f64 = -430.0;
const WALL_POWER_SLIDE_VX: f64 = 690.0;
const WALL_RESTITUTION: f64 = 0.5;
// Deep-movement augment constants (mirror player.ts).
const DASH_SPEED: f64 = 940.0;
const DASH_COOLDOWN_MS: f64 = 520.0;
const DASH_DURATION_MS: f64 = 210.0;
const DASH_RECOVERY_MS: f64 = 200.0;
const DASH_RECOVERY_ACCEL_MULT: f64 = 0.4;

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
    const dash: u32 = 1 << 9;
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
    /// Wall contact from last tick: -1 left, +1 right, 0 none. Mirrors
    /// PlayerMovementMemory.touchingWallDir in player.ts.
    touching_wall_dir: i32,
    // ── Augment INPUTS (f64) — set by the caller from the resolved build. ──
    jump_mul: f64,
    wall_jump_mul: f64,
    wall_slide_mul: f64,
    // ── Augment MEMORY (f64) — persisted across ticks. ──
    dash_cooldown_ms: f64,
    dash_active_ms: f64,
    // ── Augment INPUTS (i32) ──
    air_jumps: i32,
    dash_charges: i32,
    // ── Augment MEMORY (i32) ──
    air_jumps_used: i32,
    dash_used_in_air: i32,
    // ── Augment MEMORY (f64, appended — keep prior offsets stable) ──
    /// Recovery endlag after a dash burst (mirrors mem.dashRecoveryMs).
    dash_recovery_ms: f64,
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
    const dash_pressed = (curr_keys & Bit.dash) != 0 and (prev_keys & Bit.dash) == 0;

    s.aim_x = aim_x;
    s.aim_y = aim_y;

    // Augment timers tick down; grounded resets air-jump / air-dash budgets.
    const was_dash_active = s.dash_active_ms > 0.0;
    s.dash_cooldown_ms = @max(0.0, s.dash_cooldown_ms - dt_ms);
    s.dash_active_ms = @max(0.0, s.dash_active_ms - dt_ms);
    // Burst just ended this tick → open the recovery endlag window.
    if (was_dash_active and s.dash_active_ms <= 0.0) {
        s.dash_recovery_ms = DASH_RECOVERY_MS;
    } else {
        s.dash_recovery_ms = @max(0.0, s.dash_recovery_ms - dt_ms);
    }
    if (boolFromInt(s.grounded_last_frame)) {
        s.air_jumps_used = 0;
        s.dash_used_in_air = 0;
    }

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

    // Horizontal acceleration / friction. During a dash burst friction is
    // suspended and the clamp is raised so the burst carries.
    const dash_active = s.dash_active_ms > 0.0;
    // Recovery endlag: steering is sluggish right after a burst (mirrors
    // player.ts dashRecovering).
    const dash_recovering = !dash_active and s.dash_recovery_ms > 0.0;
    const dir_r: f64 = if (right) 1.0 else 0.0;
    const dir_l: f64 = if (left) 1.0 else 0.0;
    const direction: f64 = dir_r - dir_l;
    if (direction != 0.0) {
        const recovery_mult: f64 = if (dash_recovering) DASH_RECOVERY_ACCEL_MULT else 1.0;
        const accel = (if (boolFromInt(s.grounded_last_frame)) GROUND_ACCELERATION else AIR_ACCELERATION) * speed_mul * recovery_mult;
        s.vx = s.vx + direction * accel * dt_sec;
    } else if (boolFromInt(s.grounded_last_frame) and !dash_active) {
        s.vx = approach(s.vx, 0.0, GROUND_FRICTION * dt_sec);
    }
    const crouch_factor: f64 = if (boolFromInt(s.crouching)) CROUCH_SPEED_FACTOR else 1.0;
    const max_speed = if (dash_active) DASH_SPEED else MAX_GROUND_SPEED * speed_mul * crouch_factor;
    s.vx = clamp(s.vx, -max_speed, max_speed);

    // Jump: WALL-JUMP takes precedence when airborne against a wall; else the
    // normal ground/coyote jump. (Jetpack removed — walls do vertical now.)
    var jumped_this_frame = false;
    const wall_dir_i = s.touching_wall_dir;
    const wall_dir: f64 = @floatFromInt(wall_dir_i);
    // Wall-jump unless pressing AWAY from the wall AND a double-jump charge is
    // available (then the push-off becomes the double-jump). Mirrors player.ts —
    // without the card, wall-jump still fires in every direction.
    const divert_to_double_jump = direction == -wall_dir and s.air_jumps_used < s.air_jumps;
    if (s.jump_buffer_ms > 0.0 and !boolFromInt(s.grounded_last_frame) and wall_dir_i != 0 and !divert_to_double_jump) {
        // Holding Down at the trigger instant swaps in the POWER-SLIDE
        // variant — flatter, faster. Mirrors player.ts.
        if (wants_crouch) {
            s.vy = WALL_POWER_SLIDE_VY * s.wall_jump_mul;
            s.vx = -wall_dir * WALL_POWER_SLIDE_VX;
            // INTEGRATION: the wall power-slide IS an aegis slide — mark it
            // dash-active so it inherits the shield reflect + bash + arc +
            // flat carry via the same `dashing` gate. Mirrors player.ts.
            s.dash_active_ms = DASH_DURATION_MS;
        } else {
            s.vy = WALL_JUMP_VY * s.wall_jump_mul;
            s.vx = -wall_dir * WALL_JUMP_VX;
        }
        s.jump_buffer_ms = 0.0;
        s.jump_released_since_jump = 0;
        s.jump_cut_applied = 0;
        s.touching_wall_dir = 0;
        jumped_this_frame = true;
    } else if (s.jump_buffer_ms > 0.0 and s.coyote_ms > 0.0) {
        s.vy = JUMP_VELOCITY * s.jump_mul;
        s.coyote_ms = 0.0;
        s.jump_buffer_ms = 0.0;
        s.jump_released_since_jump = 0;
        s.jump_cut_applied = 0;
        jumped_this_frame = true;
    } else if (s.jump_buffer_ms > 0.0 and !boolFromInt(s.grounded_last_frame) and s.air_jumps_used < s.air_jumps) {
        // DOUBLE-JUMP (card): mid-air jump; consumes one charge (reset on land).
        s.vy = JUMP_VELOCITY * s.jump_mul;
        s.jump_buffer_ms = 0.0;
        s.jump_released_since_jump = 0;
        s.jump_cut_applied = 0;
        s.air_jumps_used += 1;
        jumped_this_frame = true;
    }

    // Variable jump height: cut upward velocity once jump released.
    if (boolFromInt(s.jump_released_since_jump) and !boolFromInt(s.jump_cut_applied) and s.vy < 0.0) {
        s.vy *= JUMP_CUT_MULTIPLIER;
        s.jump_released_since_jump = 0;
        s.jump_cut_applied = 1;
    }

    // Gravity — SUSPENDED during a dash burst so the aim-directional lunge
    // travels straight in the aimed direction instead of sagging. Mirrors
    // player.ts. `dash_active` reflects a dash from a PRIOR tick; the trigger
    // tick runs gravity here then overwrites vy in the dash block below.
    const gravity_now = (if (s.vy > 0.0)
        (if (fast_fall) FAST_FALL_GRAVITY else DESCENT_GRAVITY)
    else
        GRAVITY) * gravity_mul;
    if (!dash_active) {
        s.vy = @min(MAX_FALL_SPEED, s.vy + gravity_now * dt_sec);
    }

    // Grippy wall-slide / latch (Warframe/SMB): pressing INTO the wall while
    // airborne + descending caps the fall speed.
    const gripping = !boolFromInt(s.grounded_last_frame) and wall_dir_i != 0 and direction == wall_dir;
    if (gripping and s.vy > 0.0) {
        s.vy = @min(s.vy, WALL_SLIDE_MAX_FALL * s.wall_slide_mul);
    }

    // AEGIS DASH (card): aim-directional shielded lunge on the Dash input.
    // Ground dash always on cooldown; air dashes limited to dash_charges.
    // Direction = the AIM vector (8-way, incl. up/diagonal and off walls).
    // Mirrors player.ts byte-for-byte.
    if (dash_pressed and s.dash_charges > 0 and s.dash_cooldown_ms <= 0.0) {
        const can_air = !boolFromInt(s.grounded_last_frame) and s.dash_used_in_air < s.dash_charges;
        if (boolFromInt(s.grounded_last_frame) or can_air) {
            var dx = aim_x - s.x;
            var dy = aim_y - s.y;
            const len = @sqrt(dx * dx + dy * dy);
            if (len < 1e-3) {
                // Degenerate aim (cursor on the player): fall back to facing, flat.
                dx = if (direction != 0.0) direction else 1.0;
                dy = 0.0;
            }
            const inv_len = 1.0 / (if (len < 1e-3) 1.0 else len);
            s.vx = dx * inv_len * DASH_SPEED;
            s.vy = dy * inv_len * DASH_SPEED;
            if (!boolFromInt(s.grounded_last_frame)) {
                s.dash_used_in_air += 1;
            }
            s.dash_cooldown_ms = DASH_COOLDOWN_MS;
            s.dash_active_ms = DASH_DURATION_MS;
            // The lunge's upward component isn't a jump — mark jump-cut
            // consumed so variable-jump-height doesn't halve an up dash.
            s.jump_cut_applied = 1;
        }
    }

    // Jetpack removed. Pin fuel to max for wire/ABI stability.
    s.jetpack_fuel = JETPACK_MAX_FUEL;
    s.jetpack_active = 0;

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
    var wall_contact_this_tick: i32 = 0;

    var i: u32 = 0;
    while (i < sub_steps) : (i += 1) {
        const pre_vx = s.vx;
        const resolved = collision.resolveMoveCached(aabb, s.vx, s.vy, sub_dt, statics, one_way);
        aabb = .{ .x = resolved.x, .y = resolved.y, .w = aabb.w, .h = aabb.h };
        // A horizontal collision zeroes vx — that's a WALL.
        if (pre_vx != 0.0 and resolved.vx == 0.0 and (pre_vx > 1.0 or pre_vx < -1.0)) {
            const hit_dir: i32 = if (pre_vx > 0.0) 1 else -1;
            const hit_dir_f: f64 = @floatFromInt(hit_dir);
            if (direction != hit_dir_f and (pre_vx > 120.0 or pre_vx < -120.0)) {
                // WALL-BANG — hit at speed without gripping → rebound.
                s.vx = -pre_vx * WALL_RESTITUTION;
            } else {
                // Stuck to the wall → eligible to slide / wall-jump next tick.
                s.vx = resolved.vx;
                wall_contact_this_tick = hit_dir;
            }
        } else {
            s.vx = resolved.vx;
        }
        s.vy = resolved.vy;
        if (resolved.grounded_this_frame == 1) grounded_acc = true;
    }
    s.x = aabb.x + BODY_WIDTH / 2.0;
    s.y = aabb.y + body_height / 2.0;
    s.grounded_last_frame = intFromBool(grounded_acc);
    // Wall state for next tick — cleared on the ground (a floor isn't a wall).
    s.touching_wall_dir = if (grounded_acc) 0 else wall_contact_this_tick;

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
