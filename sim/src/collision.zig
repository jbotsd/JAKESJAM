//! Swept-AABB collision kernel — bit-exact port of
//! `client/src/sim/collision.ts`.
//!
//! This is the marquee determinism module: every host running the
//! same wasm bytecode here produces byte-identical hit times across
//! V8 (browsers), JSC (Bun), Hermes, etc. — per the wasm spec's
//! IEEE 754 reproducibility guarantee. That's what kills the
//! "barely detects standing" reconcile churn (ADR-0006).
//!
//! Phase B3 scope (shipped): sweepAgainstOne, sweepAABB, resolveMove
//! (multi-pass slide solver). Pending: spatial-grid broadphase,
//! one-way-platform short-circuit, post-resolve drift probe, circle
//! primitives. None affect determinism — they're perf + edge cases.

const std = @import("std");

pub const AABB = extern struct {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
};

pub const SweepHit = extern struct {
    t: f64,
    nx: f64,
    ny: f64,
    index: i32,
    /// Match Zig alignment: padded to 8-byte boundary.
    _pad: i32 = 0,
};

/// Returns whether the mover hit the target during the (dx, dy) step.
/// On hit, populates `out_*` (t, nx, ny). Pure; no allocation.
pub fn sweepAgainstOne(
    mover: AABB,
    dx: f64,
    dy: f64,
    target: AABB,
    out_t: *f64,
    out_nx: *f64,
    out_ny: *f64,
) bool {
    var x_entry: f64 = undefined;
    var x_exit: f64 = undefined;

    if (dx > 0.0) {
        x_entry = (target.x - (mover.x + mover.w)) / dx;
        x_exit = (target.x + target.w - mover.x) / dx;
    } else if (dx < 0.0) {
        x_entry = (target.x + target.w - mover.x) / dx;
        x_exit = (target.x - (mover.x + mover.w)) / dx;
    } else {
        if (mover.x + mover.w <= target.x or mover.x >= target.x + target.w) {
            return false;
        }
        x_entry = -std.math.inf(f64);
        x_exit = std.math.inf(f64);
    }

    var y_entry: f64 = undefined;
    var y_exit: f64 = undefined;

    if (dy > 0.0) {
        y_entry = (target.y - (mover.y + mover.h)) / dy;
        y_exit = (target.y + target.h - mover.y) / dy;
    } else if (dy < 0.0) {
        y_entry = (target.y + target.h - mover.y) / dy;
        y_exit = (target.y - (mover.y + mover.h)) / dy;
    } else {
        if (mover.y + mover.h <= target.y or mover.y >= target.y + target.h) {
            return false;
        }
        y_entry = -std.math.inf(f64);
        y_exit = std.math.inf(f64);
    }

    const entry = @max(x_entry, y_entry);
    const exit = @min(x_exit, y_exit);

    if (entry > exit or entry < 0.0 or entry > 1.0) {
        return false;
    }

    var nx: f64 = 0.0;
    var ny: f64 = 0.0;
    if (x_entry > y_entry) {
        nx = if (dx < 0.0) 1.0 else -1.0;
    } else {
        ny = if (dy < 0.0) 1.0 else -1.0;
    }

    out_t.* = entry;
    out_nx.* = nx;
    out_ny.* = ny;
    return true;
}

/// Sweep `mover` along `(vx*dt, vy*dt)` against an array of `statics`.
/// Returns the earliest hit (`t` in [0, 1]) or `hit = false`.
pub fn sweepAABB(
    mover: AABB,
    vx: f64,
    vy: f64,
    dt: f64,
    statics: []const AABB,
    out: *SweepHit,
) bool {
    const dx = vx * dt;
    const dy = vy * dt;
    var found = false;
    var best_t: f64 = std.math.inf(f64);
    var best_nx: f64 = 0.0;
    var best_ny: f64 = 0.0;
    var best_index: i32 = -1;

    var i: usize = 0;
    while (i < statics.len) : (i += 1) {
        var t: f64 = 0.0;
        var nx: f64 = 0.0;
        var ny: f64 = 0.0;
        if (sweepAgainstOne(mover, dx, dy, statics[i], &t, &nx, &ny)) {
            if (!found or t < best_t) {
                found = true;
                best_t = t;
                best_nx = nx;
                best_ny = ny;
                best_index = @intCast(i);
            }
        }
    }

    if (found) {
        out.* = .{
            .t = best_t,
            .nx = best_nx,
            .ny = best_ny,
            .index = best_index,
        };
    }
    return found;
}

// ── wasm ABI exports ──────────────────────────────────────────────────────
//
// Two patterns:
//
// 1. `sweep_against_one_flat` — flat scalar in/out for the single-target
//    case. Easy for cross-impl parity tests; no struct ABI to argue with.
//
// 2. `sweep_aabb_many` — takes a pointer to an array of AABBs and a count.
//    Caller writes the array into the wasm memory's state buffer (or any
//    region within wasm memory) and passes the offset. Returns hit info
//    via out pointer.

/// Returns 1 on hit, 0 on miss. On hit, writes `t`, `nx`, `ny` to the
/// caller-provided f64 slots (12 bytes total).
pub export fn sweep_against_one_flat(
    mover_x: f64,
    mover_y: f64,
    mover_w: f64,
    mover_h: f64,
    dx: f64,
    dy: f64,
    target_x: f64,
    target_y: f64,
    target_w: f64,
    target_h: f64,
    out_t: *f64,
    out_nx: *f64,
    out_ny: *f64,
) i32 {
    const mover = AABB{ .x = mover_x, .y = mover_y, .w = mover_w, .h = mover_h };
    const target = AABB{ .x = target_x, .y = target_y, .w = target_w, .h = target_h };
    return if (sweepAgainstOne(mover, dx, dy, target, out_t, out_nx, out_ny)) 1 else 0;
}

/// Sweep against `count` statics laid out contiguously at `statics_ptr` as
/// `extern struct AABB` (32 bytes each). On hit, writes the SweepHit
/// (extern struct, 32 bytes) to `out_hit_ptr` and returns 1. Returns 0 on
/// no hit.
pub export fn sweep_aabb_many(
    mover_x: f64,
    mover_y: f64,
    mover_w: f64,
    mover_h: f64,
    vx: f64,
    vy: f64,
    dt: f64,
    statics_ptr: [*]const AABB,
    statics_count: u32,
    out_hit_ptr: *SweepHit,
) i32 {
    const mover = AABB{ .x = mover_x, .y = mover_y, .w = mover_w, .h = mover_h };
    const statics = statics_ptr[0..statics_count];
    return if (sweepAABB(mover, vx, vy, dt, statics, out_hit_ptr)) 1 else 0;
}

/// Size of the AABB struct in bytes — for TS to allocate the right
/// amount of wasm memory when packing statics arrays.
pub export fn sizeof_aabb() u32 {
    return @sizeOf(AABB);
}

/// Size of the SweepHit struct in bytes.
pub export fn sizeof_sweep_hit() u32 {
    return @sizeOf(SweepHit);
}

// ── resolveMove (uncached path) ───────────────────────────────────────────
//
// Multi-pass slide solver. Bit-exact port of `resolveMove` in
// client/src/sim/collision.ts. Returns final position, post-slide
// velocity, and `groundedThisFrame`.

pub const ResolveMoveOut = extern struct {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    grounded_this_frame: i32, // 1 = grounded, 0 = airborne
    _pad: i32 = 0,
};

pub fn resolveMove(
    mover: AABB,
    vx: f64,
    vy: f64,
    dt: f64,
    statics: []const AABB,
) ResolveMoveOut {
    var cur_x = mover.x;
    var cur_y = mover.y;
    var cur_vx = vx;
    var cur_vy = vy;
    var remaining = dt;
    var grounded = false;

    var pass: u32 = 0;
    while (pass < 3) : (pass += 1) {
        if (remaining <= 0.0) break;
        const cur_mover = AABB{
            .x = cur_x,
            .y = cur_y,
            .w = mover.w,
            .h = mover.h,
        };
        var hit: SweepHit = undefined;
        const had_hit = sweepAABB(cur_mover, cur_vx, cur_vy, remaining, statics, &hit);

        if (!had_hit) {
            cur_x += cur_vx * remaining;
            cur_y += cur_vy * remaining;
            remaining = 0.0;
            break;
        }

        const epsilon: f64 = 1e-4;
        const t_clamped = @max(0.0, hit.t - epsilon);
        cur_x += cur_vx * remaining * t_clamped;
        cur_y += cur_vy * remaining * t_clamped;

        if (hit.nx != 0.0) {
            cur_vx = 0.0;
        }
        if (hit.ny != 0.0) {
            cur_vy = 0.0;
            if (hit.ny < 0.0) {
                grounded = true;
            }
        }

        remaining = remaining * (1.0 - t_clamped);
    }

    return .{
        .x = cur_x,
        .y = cur_y,
        .vx = cur_vx,
        .vy = cur_vy,
        .grounded_this_frame = if (grounded) 1 else 0,
    };
}

/// Wasm export. `statics_ptr` points to `count` extern struct AABB entries
/// in wasm memory. Result written to `out_ptr` as ResolveMoveOut.
pub export fn resolve_move(
    mover_x: f64,
    mover_y: f64,
    mover_w: f64,
    mover_h: f64,
    vx: f64,
    vy: f64,
    dt: f64,
    statics_ptr: [*]const AABB,
    statics_count: u32,
    out_ptr: *ResolveMoveOut,
) void {
    const mover = AABB{ .x = mover_x, .y = mover_y, .w = mover_w, .h = mover_h };
    const statics = statics_ptr[0..statics_count];
    out_ptr.* = resolveMove(mover, vx, vy, dt, statics);
}

pub export fn sizeof_resolve_move_out() u32 {
    return @sizeOf(ResolveMoveOut);
}

// ── one-way platforms + drift probe + snap ────────────────────────────────
//
// Bit-exact port of `sweepAABBCached` + `resolveMoveCached` from
// `client/src/sim/collision.ts`. Spatial-grid broadphase is omitted
// here (still TS-side); this layer takes a flat `[]AABB` plus a
// parallel `[]u8` one-way mask and iterates all statics. With ~80
// platforms that's still well under a microsecond at 60Hz.
//
// The +2 px slack constants are PROTECTIVE, not slop:
//   - drift up to +2 px past platform-top accumulates from float
//     wrap during gravity integration
//   - the swept loop's epsilon=1e-4 + cumulative integration error
//     can put a "grounded" mover's bottom 0..2 px into the
//     platform's interior
//   - tightening these reintroduces fall-through-terrain (see git
//     blame H1 for the regression)
//
// The post-resolve probe + snap is what made the bug actually die:
// we widen the mover by 2 px below, query overlap, and on a hit
// we snap the foot back to platform-top + zero downward vy.

const ONE_WAY_DRIFT_SLACK_PX: f64 = 2.0;
const PROBE_HEIGHT_BELOW_PX: f64 = 2.0;

inline fn aabbOverlap(a: AABB, b: AABB) bool {
    return (a.x < b.x + b.w) and
        (a.x + a.w > b.x) and
        (a.y < b.y + b.h) and
        (a.y + a.h > b.y);
}

/// One-way-aware swept AABB. `one_way` is a parallel `[]u8` mask
/// (1 = platform is one-way, 0 = solid). All other inputs match
/// `sweepAABB`.
///
/// One-way logic: only block downward-into-top hits, AND only when
/// the mover's bottom edge sat at or above platform-top before this
/// frame (within the +2 px protective slack).
pub fn sweepAABBCached(
    mover: AABB,
    vx: f64,
    vy: f64,
    dt: f64,
    statics: []const AABB,
    one_way: []const u8,
    out: *SweepHit,
) bool {
    const dx = vx * dt;
    const dy = vy * dt;
    var found = false;
    var best_t: f64 = std.math.inf(f64);
    var best_nx: f64 = 0.0;
    var best_ny: f64 = 0.0;
    var best_index: i32 = -1;

    var i: usize = 0;
    while (i < statics.len) : (i += 1) {
        const s = statics[i];
        var t: f64 = 0.0;
        var nx: f64 = 0.0;
        var ny: f64 = 0.0;
        if (!sweepAgainstOne(mover, dx, dy, s, &t, &nx, &ny)) continue;

        // One-way platform short-circuit
        if (i < one_way.len and one_way[i] != 0) {
            // Only block downward-into-top hits
            if (ny >= 0.0) continue;
            // Mover bottom must be at or above platform-top at start
            // of frame, with +2 px protective slack for float drift.
            const mover_bottom = mover.y + mover.h;
            const platform_top = s.y;
            if (mover_bottom > platform_top + ONE_WAY_DRIFT_SLACK_PX) continue;
        }

        if (!found or t < best_t) {
            found = true;
            best_t = t;
            best_nx = nx;
            best_ny = ny;
            best_index = @intCast(i);
        }
    }

    if (found) {
        out.* = .{
            .t = best_t,
            .nx = best_nx,
            .ny = best_ny,
            .index = best_index,
        };
    }
    return found;
}

/// Multi-pass slide solver with post-resolve drift probe + snap.
/// Returns final position, post-slide velocity, grounded flag.
///
/// The post-resolve probe is the bug fix: a player whose foot has
/// drifted past platform-top by 0..2 px (from float wrap or a
/// missed swept-loop hit) gets snapped back to platform-top with
/// vy zeroed. Without this, gravity keeps adding to vy each tick
/// while grounded stays false → "falls through terrain".
pub fn resolveMoveCached(
    mover: AABB,
    vx: f64,
    vy: f64,
    dt: f64,
    statics: []const AABB,
    one_way: []const u8,
) ResolveMoveOut {
    var cur_x = mover.x;
    var cur_y = mover.y;
    var cur_vx = vx;
    var cur_vy = vy;
    var remaining = dt;
    var grounded = false;

    var pass: u32 = 0;
    while (pass < 3) : (pass += 1) {
        if (remaining <= 0.0) break;
        const cur_mover = AABB{
            .x = cur_x,
            .y = cur_y,
            .w = mover.w,
            .h = mover.h,
        };
        var hit: SweepHit = undefined;
        const had_hit = sweepAABBCached(cur_mover, cur_vx, cur_vy, remaining, statics, one_way, &hit);

        if (!had_hit) {
            cur_x += cur_vx * remaining;
            cur_y += cur_vy * remaining;
            remaining = 0.0;
            break;
        }

        const epsilon: f64 = 1e-4;
        const t_clamped = @max(0.0, hit.t - epsilon);
        cur_x += cur_vx * remaining * t_clamped;
        cur_y += cur_vy * remaining * t_clamped;

        if (hit.nx != 0.0) {
            cur_vx = 0.0;
        }
        if (hit.ny != 0.0) {
            cur_vy = 0.0;
            if (hit.ny < 0.0) {
                grounded = true;
            }
        }

        remaining = remaining * (1.0 - t_clamped);
    }

    // Post-resolve drift probe + snap
    if (!grounded) {
        const probe = AABB{
            .x = cur_x,
            .y = cur_y,
            .w = mover.w,
            .h = mover.h + PROBE_HEIGHT_BELOW_PX,
        };
        var best_platform_top: f64 = std.math.inf(f64);
        var i: usize = 0;
        while (i < statics.len) : (i += 1) {
            const s = statics[i];
            if (!aabbOverlap(probe, s)) continue;

            // For one-way platforms: mover must have been at or above
            // platform-top going into this tick, +2 px slack.
            if (i < one_way.len and one_way[i] != 0) {
                const mover_bottom_before = mover.y + mover.h;
                const platform_top = s.y;
                if (mover_bottom_before > platform_top + ONE_WAY_DRIFT_SLACK_PX) continue;
            }

            grounded = true;
            if (s.y < best_platform_top) best_platform_top = s.y;
        }

        if (grounded and best_platform_top < std.math.inf(f64)) {
            cur_y = best_platform_top - mover.h;
            if (cur_vy > 0.0) cur_vy = 0.0;
        }
    }

    return .{
        .x = cur_x,
        .y = cur_y,
        .vx = cur_vx,
        .vy = cur_vy,
        .grounded_this_frame = if (grounded) 1 else 0,
    };
}

/// Wasm export for sweepAABBCached. Same calling convention as
/// `sweep_aabb_many` but with an additional `one_way_ptr: [*]const u8`
/// parallel mask.
pub export fn sweep_aabb_cached(
    mover_x: f64,
    mover_y: f64,
    mover_w: f64,
    mover_h: f64,
    vx: f64,
    vy: f64,
    dt: f64,
    statics_ptr: [*]const AABB,
    statics_count: u32,
    one_way_ptr: [*]const u8,
    one_way_count: u32,
    out_hit_ptr: *SweepHit,
) i32 {
    const mover = AABB{ .x = mover_x, .y = mover_y, .w = mover_w, .h = mover_h };
    const statics = statics_ptr[0..statics_count];
    const one_way = one_way_ptr[0..one_way_count];
    return if (sweepAABBCached(mover, vx, vy, dt, statics, one_way, out_hit_ptr)) 1 else 0;
}

// ── Circle vs AABB (projectile collision) ─────────────────────────────────

/// Returns true if a circle at (cx, cy) with `radius` overlaps the AABB.
/// Distance check uses the closest-point algorithm — accurate at corners
/// (a naïve "circle bounding box vs aabb" returns false positives).
pub fn circleOverlapsAABB(cx: f64, cy: f64, radius: f64, b: AABB) bool {
    const closest_x = @max(b.x, @min(cx, b.x + b.w));
    const closest_y = @max(b.y, @min(cy, b.y + b.h));
    const dx = cx - closest_x;
    const dy = cy - closest_y;
    return dx * dx + dy * dy <= radius * radius;
}

/// Find the first AABB index that overlaps the circle, or -1.
pub fn circleHitsAny(cx: f64, cy: f64, radius: f64, statics: []const AABB) i32 {
    var i: usize = 0;
    while (i < statics.len) : (i += 1) {
        if (circleOverlapsAABB(cx, cy, radius, statics[i])) {
            return @intCast(i);
        }
    }
    return -1;
}

pub const CircleBounce = extern struct {
    index: i32,
    reflect_x: i32, // 1 = reflect, 0 = no
    reflect_y: i32,
    _pad: i32 = 0,
};

/// Find the first AABB the circle overlaps and decide which axis to
/// reflect on. Caller supplies prev (cx, cy) for direction-of-entry.
/// Returns `index = -1` if no hit.
pub fn circleBounce(
    cx: f64,
    cy: f64,
    prev_x: f64,
    prev_y: f64,
    radius: f64,
    statics: []const AABB,
    out: *CircleBounce,
) bool {
    var i: usize = 0;
    while (i < statics.len) : (i += 1) {
        const aabb = statics[i];
        if (!circleOverlapsAABB(cx, cy, radius, aabb)) continue;

        const left = aabb.x - radius;
        const right = aabb.x + aabb.w + radius;
        const top = aabb.y - radius;
        const bottom = aabb.y + aabb.h + radius;

        var reflect_x = false;
        var reflect_y = false;
        if (prev_x <= left or prev_x >= right) {
            reflect_x = true;
        } else if (prev_y <= top or prev_y >= bottom) {
            reflect_y = true;
        } else {
            const dx_edge = @min(@abs(cx - left), @abs(cx - right));
            const dy_edge = @min(@abs(cy - top), @abs(cy - bottom));
            if (dx_edge < dy_edge) reflect_x = true else reflect_y = true;
        }

        out.* = .{
            .index = @intCast(i),
            .reflect_x = if (reflect_x) 1 else 0,
            .reflect_y = if (reflect_y) 1 else 0,
        };
        return true;
    }
    return false;
}

pub export fn circle_overlaps_aabb(
    cx: f64,
    cy: f64,
    radius: f64,
    bx: f64,
    by: f64,
    bw: f64,
    bh: f64,
) i32 {
    const aabb = AABB{ .x = bx, .y = by, .w = bw, .h = bh };
    return if (circleOverlapsAABB(cx, cy, radius, aabb)) 1 else 0;
}

pub export fn circle_hits_any(
    cx: f64,
    cy: f64,
    radius: f64,
    statics_ptr: [*]const AABB,
    statics_count: u32,
) i32 {
    return circleHitsAny(cx, cy, radius, statics_ptr[0..statics_count]);
}

pub export fn circle_bounce(
    cx: f64,
    cy: f64,
    prev_x: f64,
    prev_y: f64,
    radius: f64,
    statics_ptr: [*]const AABB,
    statics_count: u32,
    out_ptr: *CircleBounce,
) i32 {
    return if (circleBounce(cx, cy, prev_x, prev_y, radius, statics_ptr[0..statics_count], out_ptr)) 1 else 0;
}

pub export fn sizeof_circle_bounce() u32 {
    return @sizeOf(CircleBounce);
}

/// Wasm export for resolveMoveCached. Same calling convention as
/// `resolve_move` plus the one-way mask.
pub export fn resolve_move_cached(
    mover_x: f64,
    mover_y: f64,
    mover_w: f64,
    mover_h: f64,
    vx: f64,
    vy: f64,
    dt: f64,
    statics_ptr: [*]const AABB,
    statics_count: u32,
    one_way_ptr: [*]const u8,
    one_way_count: u32,
    out_ptr: *ResolveMoveOut,
) void {
    const mover = AABB{ .x = mover_x, .y = mover_y, .w = mover_w, .h = mover_h };
    const statics = statics_ptr[0..statics_count];
    const one_way = one_way_ptr[0..one_way_count];
    out_ptr.* = resolveMoveCached(mover, vx, vy, dt, statics, one_way);
}
