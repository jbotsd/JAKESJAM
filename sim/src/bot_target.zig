//! gospel N-BOT, second slice — target selection in the core.
//!
//! Port of `worldBots.ts`'s targeting layer: `headingTowardMe`,
//! `nearestFoe` and `inboundThreat`. Like the nav half before it, these
//! are decidable from their arguments, so parity is a direct comparison
//! rather than a lockstep simulation — which is why they go before the
//! mode machine, which is not.
//!
//! `nearestFoe` is the interesting one and the reason this needs a real
//! gate. It maintains FOUR running bests (nearest anything, nearest bot,
//! nearest non-fresh, nearest human) and then picks between them by a
//! preference rule. Every one of those is a strict `<`, so the selection
//! is order-sensitive, and "the bots all pile onto one player" versus
//! "they spread out" is exactly the kind of feel difference that never
//! shows up as an error.
//!
//! NOT ported here: the mode machine (`decide`), which carries per-bot
//! memory across ticks and needs seeded lockstep to verify. That is the
//! rest of N-BOT.

const std = @import("std");
const world_state = @import("world_state.zig");

pub const PREFER_BOT_DIST_FACTOR: f64 = 1.55;
pub const THREAT_RADIUS: f64 = 170;

/// A view of one player, flattened so the caller can supply either the
/// sim's own entities or a test fixture.
pub const Foe = struct {
    x: f64,
    y: f64,
    vx: f64 = 0,
    vy: f64 = 0,
    alive: bool = true,
    is_bot: bool = false,
    /// A human inside the newcomer grace window. Bots prefer anyone else,
    /// so a first-timer is not instantly dogpiled.
    is_fresh_human: bool = false,
};

/// Is `foe` moving toward `me`? Mirrors `headingTowardMe`.
///
/// The `|| 1` guards are transcribed rather than cleaned up: a stationary
/// foe has speed 0, and in the TS that becomes 1, which makes `align` a
/// small number rather than a NaN. Removing them would turn "standing
/// still" into "not a threat, definitely" via NaN comparison instead of
/// "not aligned enough", which is the same answer today and a different
/// one the moment the threshold moves.
pub fn headingTowardMe(me_x: f64, me_y: f64, foe: Foe) bool {
    const dx = me_x - foe.x;
    const dy = me_y - foe.y;
    const hyp = @sqrt(dx * dx + dy * dy);
    const d = if (hyp == 0) 1 else hyp;
    const sp = @sqrt(foe.vx * foe.vx + foe.vy * foe.vy);
    const speed = if (sp == 0) 1 else sp;
    const alignment = (foe.vx * dx + foe.vy * dy) / (speed * d);
    return alignment > 0.5;
}

/// Nearest eligible foe, with the bot-on-bot preference.
///
/// Returns an INDEX into `foes` so the caller keeps its own entity
/// identity; returning a copy would lose the slot the sim needs.
pub fn nearestFoe(me_index: usize, me_x: f64, me_y: f64, foes: []const Foe) ?usize {
    var best: ?usize = null;
    var best_d: f64 = std.math.inf(f64);
    var best_bot: ?usize = null;
    var best_bot_d: f64 = std.math.inf(f64);
    var best_seasoned: ?usize = null;
    var best_seasoned_d: f64 = std.math.inf(f64);
    var best_human: ?usize = null;
    var best_human_d: f64 = std.math.inf(f64);

    for (foes, 0..) |p, i| {
        if (i == me_index or !p.alive) continue;
        const dx = p.x - me_x;
        const dy = p.y - me_y;
        const d = @sqrt(dx * dx + dy * dy);
        if (d < best_d) {
            best_d = d;
            best = i;
        }
        if (p.is_bot and d < best_bot_d) {
            best_bot_d = d;
            best_bot = i;
        }
        if (!p.is_fresh_human and d < best_seasoned_d) {
            best_seasoned_d = d;
            best_seasoned = i;
        }
        if (!p.is_bot and d < best_human_d) {
            best_human_d = d;
            best_human = i;
        }
    }

    // A bot within preferBotDistFactor of the nearest human wins — the
    // gang piles onto each other before onto a person.
    if (best_bot != null and best_human != null) {
        if (best_bot_d <= best_human_d * PREFER_BOT_DIST_FACTOR) return best_bot;
    }
    if (best_bot != null and best_human == null) return best_bot;
    return best_seasoned orelse best;
}

pub const Threat = struct { x: f64, y: f64 };

/// A projectile heading at `me` inside the threat radius. Mirrors
/// `inboundThreat`: first match wins, in iteration order.
pub fn inboundThreat(
    me_x: f64,
    me_y: f64,
    proj_x: []const f64,
    proj_y: []const f64,
    proj_vx: []const f64,
    proj_vy: []const f64,
    owned_by_me: []const bool,
) ?Threat {
    for (proj_x, 0..) |px, i| {
        if (owned_by_me[i]) continue;
        const dx = me_x - px;
        const dy = me_y - proj_y[i];
        const d = @sqrt(dx * dx + dy * dy);
        if (d > THREAT_RADIUS) continue;
        const sp = @sqrt(proj_vx[i] * proj_vx[i] + proj_vy[i] * proj_vy[i]);
        const speed = if (sp == 0) 1 else sp;
        const denom = if (speed * d == 0) 1 else speed * d;
        const alignment = (proj_vx[i] * dx + proj_vy[i] * dy) / denom;
        if (alignment > 0.6) return .{ .x = px, .y = proj_y[i] };
    }
    return null;
}

// ── Parity exports ───────────────────────────────────────────────────────
// Flat arrays in, index out — same shape as bot_nav's, so the TS parity
// test can drive them without knowing Zig struct layout.

var g_foes: [16]Foe = undefined;

pub export fn bot_target_set_foe(
    i: u32,
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    alive: u32,
    is_bot: u32,
    is_fresh: u32,
) void {
    if (i >= g_foes.len) return;
    g_foes[i] = .{
        .x = x,
        .y = y,
        .vx = vx,
        .vy = vy,
        .alive = alive != 0,
        .is_bot = is_bot != 0,
        .is_fresh_human = is_fresh != 0,
    };
}

/// Returns the chosen index, or -1 for none.
pub export fn bot_target_nearest(me_index: u32, me_x: f64, me_y: f64, count: u32) i32 {
    const n = @min(count, @as(u32, @intCast(g_foes.len)));
    const pick = nearestFoe(me_index, me_x, me_y, g_foes[0..n]) orelse return -1;
    return @intCast(pick);
}

pub export fn bot_target_heading_toward(
    me_x: f64,
    me_y: f64,
    fx: f64,
    fy: f64,
    fvx: f64,
    fvy: f64,
) u32 {
    return if (headingTowardMe(me_x, me_y, .{ .x = fx, .y = fy, .vx = fvx, .vy = fvy })) 1 else 0;
}
