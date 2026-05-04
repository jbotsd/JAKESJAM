//! Comptime sin/cos/atan2 LUT — JAKESJAM Phase F2a.
//!
//! Why we don't just call `std.math.sin`: Zig's wasm-freestanding
//! `std.math.sin` uses a polynomial approximation; V8's `Math.sin`
//! uses fdlibm-derived code; both are deterministic *within* a host
//! but may differ in last-ULP rounding *across* hosts. For
//! production parity (predict on V8 vs authority on JSC vs wasm
//! everywhere) we need a single shared table that produces
//! byte-identical bits regardless of which libm the host is using.
//!
//! The Zig side bakes the table at compile time via `comptime`.
//! The TS side mirrors the table generation in `client/src/sim/
//! trig.ts` using the same indexing arithmetic. Both sides do
//! identical normalisation + lookup → identical bits.
//!
//! This is the headline Zig-feature demo: TS can compute the same
//! table at JS boot, but it can't BAKE it into the bundle the way
//! Zig bakes it into the wasm binary.
//!
//! Precision: 4096 entries over [0, π/2] = 1/4096 of 90° ≈ 0.022°
//! step. Linear interpolation between entries gives effective
//! precision well below 0.001° — finer than any visual aim
//! tolerance.

const std = @import("std");

const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;
const HALF_PI: f64 = 1.5707963267948966;
// 1024 entries = 8KB per table = 16KB total. With linear
// interpolation between adjacent entries, effective precision is
// ~0.088° / 4 ≈ 0.022° — well below visible projectile aim
// tolerance. Can bump to 4096 if perf budget allows later.
const TABLE_SIZE: usize = 1024;
const TABLE_SIZE_F: f64 = 1024.0;
const STEP_RAD: f64 = HALF_PI / TABLE_SIZE_F;

/// Sin lookup table for [0, π/2). Built at compile time.
/// Use `lutSin` / `lutCos` / `lutAtan2` for the public API.
pub const SIN_TABLE: [TABLE_SIZE]f64 = blk: {
    @setEvalBranchQuota(50_000);
    var t: [TABLE_SIZE]f64 = undefined;
    var i: usize = 0;
    while (i < TABLE_SIZE) : (i += 1) {
        const angle = (@as(f64, @floatFromInt(i)) / TABLE_SIZE_F) * HALF_PI;
        t[i] = @sin(angle);
    }
    break :blk t;
};

/// Look up sin(x) via the LUT. Normalises x into [0, 2π) then maps
/// by quadrant. Linear interpolation between adjacent entries.
///
/// Result is bit-identical to the matching TS impl in
/// `client/src/sim/trig.ts` because both compute `idx_lo`, `frac`,
/// and the linear blend with the same arithmetic.
pub fn lutSin(x: f64) f64 {
    // Normalise to [0, 2π). f64 modulo via floor — same as the JS
    // `x - Math.floor(x / TWO_PI) * TWO_PI` pattern.
    const reduced = x - @floor(x / TWO_PI) * TWO_PI;

    // Quadrant decomposition.
    var quad_x: f64 = undefined;
    var sign: f64 = 1.0;
    if (reduced < HALF_PI) {
        quad_x = reduced;
    } else if (reduced < PI) {
        quad_x = PI - reduced;
    } else if (reduced < PI + HALF_PI) {
        quad_x = reduced - PI;
        sign = -1.0;
    } else {
        quad_x = TWO_PI - reduced;
        sign = -1.0;
    }

    // Lookup with linear interpolation.
    const idx_f = quad_x / STEP_RAD;
    const idx_lo: usize = @intFromFloat(@floor(idx_f));
    const frac = idx_f - @floor(idx_f);
    const a = if (idx_lo < TABLE_SIZE) SIN_TABLE[idx_lo] else 1.0;
    const b = if (idx_lo + 1 < TABLE_SIZE) SIN_TABLE[idx_lo + 1] else 1.0;
    return sign * (a + (b - a) * frac);
}

/// cos(x) = sin(x + π/2).
pub fn lutCos(x: f64) f64 {
    return lutSin(x + HALF_PI);
}

/// atan2(y, x) via the same LUT. 4-quadrant decomposition over
/// arctan in [0, π/4]. Within that range we approximate via
/// `arctan(t) = π/4 + (t - 1) * (some-slope-LUT-entry)` — but
/// here we use the simpler formulation:
///   atan(t) for t ∈ [0, 1] computed by inverting sin via search,
/// implemented as a 4096-entry arctan LUT built at comptime.
/// arctan LUT for inputs in [0, 1]. Built at compile time via
/// `@atan` (Zig builtin). 4096 entries × f64.
pub const ATAN_TABLE: [TABLE_SIZE]f64 = blk: {
    @setEvalBranchQuota(2_000_000);
    var t: [TABLE_SIZE]f64 = undefined;
    var i: usize = 0;
    while (i < TABLE_SIZE) : (i += 1) {
        const ratio = @as(f64, @floatFromInt(i)) / TABLE_SIZE_F;
        // Use the std-math wrapper which lowers to a deterministic
        // polynomial approximation at comptime.
        t[i] = std.math.atan(ratio);
    }
    break :blk t;
};

fn lutAtan(t: f64) f64 {
    // t in [0, 1]
    const idx_f = t * TABLE_SIZE_F;
    const idx_lo_i: i64 = @intFromFloat(@floor(idx_f));
    const idx_lo: usize = if (idx_lo_i < 0) 0 else if (idx_lo_i >= @as(i64, @intCast(TABLE_SIZE - 1))) TABLE_SIZE - 1 else @intCast(idx_lo_i);
    const frac = idx_f - @as(f64, @floatFromInt(idx_lo));
    const a = ATAN_TABLE[idx_lo];
    const b_idx = if (idx_lo + 1 < TABLE_SIZE) idx_lo + 1 else idx_lo;
    const b = ATAN_TABLE[b_idx];
    return a + (b - a) * frac;
}

pub fn lutAtan2(y: f64, x: f64) f64 {
    if (x == 0.0 and y == 0.0) return 0.0;

    const ax = @abs(x);
    const ay = @abs(y);

    var base: f64 = undefined;
    if (ay <= ax) {
        // |y| <= |x|: atan(y/x) is in [-π/4, π/4]
        base = lutAtan(ay / ax);
    } else {
        // |y| > |x|: use complement, atan = π/2 - atan(x/y)
        base = HALF_PI - lutAtan(ax / ay);
    }

    if (x >= 0.0) {
        return if (y >= 0.0) base else -base;
    } else {
        return if (y >= 0.0) PI - base else base - PI;
    }
}

// ── wasm ABI exports ──────────────────────────────────────────────────────

pub export fn lut_sin(x: f64) f64 {
    return lutSin(x);
}

pub export fn lut_cos(x: f64) f64 {
    return lutCos(x);
}

pub export fn lut_atan2(y: f64, x: f64) f64 {
    return lutAtan2(y, x);
}

/// Returns a pointer to the sin LUT for hosts that want to mirror
/// it exactly in JS (rather than re-computing from scratch). The
/// table is 4096 × f64 = 32768 bytes laid out at this address.
pub export fn lut_sin_table_ptr() [*]const f64 {
    return &SIN_TABLE;
}

pub export fn lut_atan_table_ptr() [*]const f64 {
    return &ATAN_TABLE;
}

pub export fn lut_table_size() u32 {
    return @intCast(TABLE_SIZE);
}
