//! gospel N-BOT, first slice — arena navigation in the core.
//!
//! Port of `server/src/botArenaNav.ts` (208 lines), which is the pure half
//! of the bot brain: it compiles a map into cover columns and standable
//! ledges, then answers line-of-sight, cover-flank and hop-target
//! questions. Its own header says "PURE: no Math.random, no Date, no host",
//! which is exactly why it goes first — every function here is decidable
//! from its arguments, so TS-vs-Zig parity is a direct comparison rather
//! than a lockstep simulation.
//!
//! The stateful half (`worldBots.ts`, 765 lines — targeting, mode machine,
//! per-bot memory) is the rest of N-BOT and is NOT here.
//!
//! Numeric parity note: every constant, comparison and score expression
//! below is transcribed in the SAME order as the TS, including the
//! `|| 1` fallbacks and the `Math.sign(...) || 1` idioms, because the
//! scores are compared with strict `<` and reordering float arithmetic
//! would silently change which cover a bot picks.

const std = @import("std");

pub const MAX_COVERS: usize = 64;
pub const MAX_LEDGES: usize = 64;

/// Tall solid — blocks LOS at shoulder height, and is grabbable.
pub const CoverCol = struct {
    x0: f64,
    x1: f64,
    /// Top of solid (world y, down-positive).
    top: f64,
    /// Bottom / base y.
    base: f64,
    cx: f64,
};

pub const Ledge = struct {
    x0: f64,
    x1: f64,
    top: f64,
    cx: f64,
};

pub const ArenaNav = struct {
    width: f64 = 0,
    height: f64 = 0,
    floor_top: f64 = 0,
    covers: [MAX_COVERS]CoverCol = undefined,
    cover_count: usize = 0,
    ledges: [MAX_LEDGES]Ledge = undefined,
    ledge_count: usize = 0,

    pub fn coverSlice(self: *const ArenaNav) []const CoverCol {
        return self.covers[0..self.cover_count];
    }
    pub fn ledgeSlice(self: *const ArenaNav) []const Ledge {
        return self.ledges[0..self.ledge_count];
    }
};

/// Platform kinds, mirroring TS `PlatformDefinition["kind"]`.
pub const PlatformKind = enum(u8) { floor = 0, wall = 1, platform = 2 };

/// A platform as the nav builder needs it — centre + size + kind, plus the
/// one thing the TS reads from the id: whether it is a floor by NAME
/// (`isFloorId`: "floor" or "floor-*"). The caller resolves that, because
/// ids are strings the core does not otherwise carry.
pub const NavPlatform = struct {
    cx: f64,
    cy: f64,
    w: f64,
    h: f64,
    kind: PlatformKind,
    floor_by_id: bool = false,
};

const GRAB_MIN_H: f64 = 25;
const ONE_WAY_MAX: f64 = 24;

/// Build nav from map geometry. Mirrors `buildArenaNav`.
pub fn buildArenaNav(
    platforms: []const NavPlatform,
    map_w: f64,
    map_h: f64,
) ArenaNav {
    var nav = ArenaNav{ .width = map_w, .height = map_h, .floor_top = map_h - 36 };

    for (platforms) |p| {
        const x0 = p.cx - p.w / 2;
        const x1 = p.cx + p.w / 2;
        const top = p.cy - p.h / 2;
        const base = p.cy + p.h / 2;

        if (p.kind == .floor or p.floor_by_id) {
            // Transcribed exactly, including the second clause: the initial
            // floor_top is the sentinel, so the FIRST floor always wins even
            // if it is lower than the sentinel.
            if (top < nav.floor_top or nav.floor_top == map_h - 36) nav.floor_top = top;
            continue;
        }
        // Outer frame walls and thin ceilings are never useful flanks. The
        // TS `continue`s in all three wall branches — the two conditions are
        // documentation of intent, not live filters — so this does too.
        if (p.kind == .wall) continue;
        if (p.kind != .platform) continue;

        if (p.h >= GRAB_MIN_H) {
            if (nav.cover_count < MAX_COVERS) {
                nav.covers[nav.cover_count] = .{ .x0 = x0, .x1 = x1, .top = top, .base = base, .cx = p.cx };
                nav.cover_count += 1;
            }
            continue;
        }
        if (p.h <= ONE_WAY_MAX) {
            if (nav.ledge_count < MAX_LEDGES) {
                nav.ledges[nav.ledge_count] = .{ .x0 = x0, .x1 = x1, .top = top, .cx = p.cx };
                nav.ledge_count += 1;
            }
        }
    }

    // TS sorts covers by cx, and ledges by top then cx. Both are stable
    // sorts in V8 for these sizes; `insertionSort` is stable too, which
    // matters because ties decide which cover a bot flanks to.
    std.sort.insertion(CoverCol, nav.covers[0..nav.cover_count], {}, coverLessThan);
    std.sort.insertion(Ledge, nav.ledges[0..nav.ledge_count], {}, ledgeLessThan);
    return nav;
}

fn coverLessThan(_: void, a: CoverCol, b: CoverCol) bool {
    return a.cx < b.cx;
}

fn ledgeLessThan(_: void, a: Ledge, b: Ledge) bool {
    if (a.top != b.top) return a.top < b.top;
    return a.cx < b.cx;
}

/// Shoulder-height band for LOS.
pub fn shoulderY(body_y: f64) f64 {
    return body_y - 28;
}

/// Segment LOS at approximate shoulder height. Mirrors `hasLineOfSight`.
pub fn hasLineOfSight(nav: *const ArenaNav, ax: f64, ay: f64, bx: f64, by: f64) bool {
    if (nav.cover_count == 0) return true;
    const x_lo = @min(ax, bx);
    const x_hi = @max(ax, bx);
    if (x_hi - x_lo < 8) return true;
    const y_a = shoulderY(ay);
    const y_b = shoulderY(by);

    for (nav.coverSlice()) |c| {
        if (c.x1 <= x_lo or c.x0 >= x_hi) continue;
        // `bx - ax || 1` in TS: a zero denominator falls back to 1. Reached
        // only when the span check above passed on a <8px span, which it
        // cannot — kept anyway so the two implementations read identically.
        const denom = if (bx - ax == 0) 1 else bx - ax;
        const t = (c.cx - ax) / denom;
        if (t <= 0.02 or t >= 0.98) continue;
        const y_at = y_a + (y_b - y_a) * t;
        if (y_at >= c.top - 4 and y_at <= c.base + 4) return false;
    }
    return true;
}

pub const CoverFlank = struct { x: f64, y: f64, cover_cx: f64 };

/// Best cover flank near `me` that breaks LOS to `foe`.
pub fn nearestCoverFlank(
    nav: *const ArenaNav,
    me_x: f64,
    me_y: f64,
    foe_x: f64,
    max_dist: f64,
) ?CoverFlank {
    var best: ?CoverFlank = null;
    var best_score: f64 = 0;
    for (nav.coverSlice()) |c| {
        if (c.top > me_y + 40) continue;
        if (c.base < me_y - 200) continue;
        const d = @abs(c.cx - me_x);
        if (d > max_dist or d < 20) continue;
        const foe_on_right = foe_x >= c.cx;
        const stand_x = if (foe_on_right) c.x0 - 36 else c.x1 + 36;
        const breaks = !hasLineOfSight(nav, stand_x, me_y, foe_x, me_y);
        const score = (if (breaks) @as(f64, 0) else @as(f64, 200)) + d;
        // Strict `<`, matching TS: the FIRST cover at a tied score wins,
        // which is why the sort order above is load-bearing.
        if (best == null or score < best_score) {
            best = .{ .x = stand_x, .y = me_y, .cover_cx = c.cx };
            best_score = score;
        }
    }
    return best;
}

/// When the foe is above us, pick a nearby ledge top to hop toward.
pub fn hopTargetToward(
    nav: *const ArenaNav,
    me_x: f64,
    me_top: f64,
    foe_x: f64,
    foe_y: f64,
    max_rise: f64,
    max_gap: f64,
) ?Ledge {
    if (foe_y >= me_top - 40) return null;
    var best: ?Ledge = null;
    var best_score: f64 = std.math.inf(f64);
    for (nav.ledgeSlice()) |l| {
        const rise = me_top - l.top;
        if (rise <= 8 or rise > max_rise) continue;
        const gap = @abs(l.cx - me_x) - (l.x1 - l.x0) / 2;
        if (gap > max_gap) continue;
        if (l.top < foe_y - 80) continue;
        // `Math.sign(x) || 1` — sign(0) is 0 in JS, and `|| 1` turns that
        // into 1, so a bot standing exactly under the foe still counts as
        // "toward". Dropping the fallback would flip `align` on that edge.
        const toward_foe: f64 = if (foe_x - me_x < 0) -1 else 1;
        const toward_ledge: f64 = if (l.cx - me_x < 0) -1 else 1;
        const alignment: f64 = if (toward_foe == toward_ledge) 0 else 80;
        const score = rise + @abs(l.cx - me_x) * 0.5 + alignment + @abs(l.top - foe_y) * 0.3;
        if (score < best_score) {
            best_score = score;
            best = l;
        }
    }
    return best;
}

/// Horizontal run intent toward a world X.
pub fn dirTowardX(from_x: f64, to_x: f64, deadzone: f64) i32 {
    const d = to_x - from_x;
    if (@abs(d) <= deadzone) return 0;
    return if (d < 0) -1 else 1;
}

/// Mega-dock scale factor from map width (1 at ~1280, ~2.3 at 3000).
pub fn megaScale(nav: ?*const ArenaNav) f64 {
    const n = nav orelse return 1;
    return @min(2.4, @max(1, n.width / 1280));
}

// ── Parity exports ───────────────────────────────────────────────────────
//
// Same shape as map_gen.zig's `gen_arena_geometry`: flat f64 in, flat f64
// out, so the TS parity test can drive these without struct offsets.

var g_nav: ArenaNav = .{};

/// Build the module-level nav from a flat platform array:
/// 5 f64 per platform — [cx, cy, w, h, kind_and_floor_flag] where the last
/// is `kind + (floor_by_id ? 8 : 0)`. Returns cover_count * 1000 +
/// ledge_count so a caller can check both with one number.
pub export fn bot_nav_build(platforms_ptr: [*]const f64, count: u32, map_w: f64, map_h: f64) u32 {
    var buf: [MAX_COVERS + MAX_LEDGES]NavPlatform = undefined;
    const n = @min(count, @as(u32, @intCast(buf.len)));
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        const raw = platforms_ptr[i * 5 + 4];
        const k: u8 = @intFromFloat(@mod(raw, 8));
        buf[i] = .{
            .cx = platforms_ptr[i * 5 + 0],
            .cy = platforms_ptr[i * 5 + 1],
            .w = platforms_ptr[i * 5 + 2],
            .h = platforms_ptr[i * 5 + 3],
            .kind = @enumFromInt(if (k <= 2) k else 2),
            .floor_by_id = raw >= 8,
        };
    }
    g_nav = buildArenaNav(buf[0..n], map_w, map_h);
    return @as(u32, @intCast(g_nav.cover_count)) * 1000 + @as(u32, @intCast(g_nav.ledge_count));
}

pub export fn bot_nav_floor_top() f64 {
    return g_nav.floor_top;
}

pub export fn bot_nav_has_los(ax: f64, ay: f64, bx: f64, by: f64) u32 {
    return if (hasLineOfSight(&g_nav, ax, ay, bx, by)) 1 else 0;
}

/// Writes [found, x, y, cover_cx] into `out`.
pub export fn bot_nav_cover_flank(me_x: f64, me_y: f64, foe_x: f64, max_dist: f64, out: [*]f64) void {
    if (nearestCoverFlank(&g_nav, me_x, me_y, foe_x, max_dist)) |f| {
        out[0] = 1;
        out[1] = f.x;
        out[2] = f.y;
        out[3] = f.cover_cx;
    } else {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
    }
}

/// Writes [found, cx, top, x0, x1] into `out`.
pub export fn bot_nav_hop_target(
    me_x: f64,
    me_top: f64,
    foe_x: f64,
    foe_y: f64,
    max_rise: f64,
    max_gap: f64,
    out: [*]f64,
) void {
    if (hopTargetToward(&g_nav, me_x, me_top, foe_x, foe_y, max_rise, max_gap)) |l| {
        out[0] = 1;
        out[1] = l.cx;
        out[2] = l.top;
        out[3] = l.x0;
        out[4] = l.x1;
    } else {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[4] = 0;
    }
}

pub export fn bot_nav_mega_scale() f64 {
    return megaScale(&g_nav);
}

pub export fn bot_nav_dir_toward_x(from_x: f64, to_x: f64, deadzone: f64) i32 {
    return dirTowardX(from_x, to_x, deadzone);
}
