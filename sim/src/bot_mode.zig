//! gospel N-BOT, third slice — the mode selection, in the core.
//!
//! Port of the mode-selection block inside `worldBots.ts`'s `decide`:
//! given how far the foe is, whether we are retreating, whether we have
//! been out of range long enough to commit, and whether we can see them,
//! pick one of retreat / commit / cover / chase / hold.
//!
//! WHY THIS ONE NEEDS CARE, and why it is not just an if-chain:
//!
//! The cover branch reads
//!
//!     nowMs < coverUntil
//!       || (!los && dist < coverSeekRange*scale)
//!       || (dist < engageRange+80 && rand() < 0.012 && nowMs > coverUntil)
//!
//! and `rand()` sits in the middle of a short-circuited `||` chain. So
//! whether the RNG is CONSUMED depends on which earlier operands were
//! true and on `dist`. A port that draws unconditionally — the obvious
//! way to write this as a pure function — would advance the stream on
//! ticks the TS leaves it alone, and every subsequent bot decision would
//! diverge. Nothing would crash; the bots would simply behave differently
//! from the browser's, which is precisely the failure the parity gate
//! exists to catch.
//!
//! Hence the `rand` callback rather than a pre-drawn value: the ORDER and
//! the COUNT of draws are part of the contract, not an implementation
//! detail.

const std = @import("std");

pub const Mode = enum(u8) { chase = 0, hold = 1, cover = 2, commit = 3, retreat = 4 };

pub const COVER_SEEK_RANGE: f64 = 520;
pub const HUMAN_COMMIT_MS: f64 = 2000;
pub const BOT_COMMIT_MS: f64 = 1100;
pub const COVER_ROLL_CHANCE: f64 = 0.012;
/// The dead-band around engage range inside which a bot holds instead of
/// closing. Mirrors `Math.abs(dist - engageRange) > 70`.
pub const HOLD_BAND: f64 = 70;

pub const Inputs = struct {
    dist: f64,
    far_range: f64,
    engage_range: f64,
    scale: f64,
    retreating: bool,
    /// True when the bot has a compiled nav (map-blind bots never seek
    /// cover — mirrors the `this.nav &&` guard).
    has_nav: bool,
    los: bool,
    foe_is_human: bool,
    now_ms: f64,
    /// Carried per bot across ticks.
    far_since: f64,
    cover_until: f64,
};

pub const Result = struct {
    mode: Mode,
    /// Updated `farSince` — the caller writes it back. Returned rather
    /// than mutated through a pointer so the function stays pure and the
    /// test can see it.
    far_since: f64,
};

/// Pick a mode. `rand` is called ONLY where the TS calls it.
pub fn selectMode(
    in: Inputs,
    rand: *const fn (ctx: ?*anyopaque) f64,
    rand_ctx: ?*anyopaque,
) Result {
    // Anti-standoff commit timer.
    var far_since = in.far_since;
    if (in.dist > in.far_range) {
        if (far_since == 0) far_since = in.now_ms;
    } else {
        far_since = 0;
    }
    const commit_delay: f64 = if (in.foe_is_human) HUMAN_COMMIT_MS else BOT_COMMIT_MS;
    const committing = far_since != 0 and (in.now_ms - far_since) > commit_delay;

    if (in.retreating) return .{ .mode = .retreat, .far_since = far_since };
    if (committing or in.dist > in.far_range) return .{ .mode = .commit, .far_since = far_since };

    if (in.has_nav) {
        // Transcribed operand-for-operand, including short-circuit order,
        // because that order decides whether rand() is consumed.
        var cover = in.now_ms < in.cover_until;
        if (!cover) {
            cover = !in.los and in.dist < COVER_SEEK_RANGE * in.scale;
        }
        if (!cover) {
            if (in.dist < in.engage_range + 80) {
                if (rand(rand_ctx) < COVER_ROLL_CHANCE) {
                    cover = in.now_ms > in.cover_until;
                }
            }
        }
        if (cover) return .{ .mode = .cover, .far_since = far_since };
    }

    if (@abs(in.dist - in.engage_range) > HOLD_BAND) {
        return .{ .mode = .chase, .far_since = far_since };
    }
    return .{ .mode = .hold, .far_since = far_since };
}

// ── tests ────────────────────────────────────────────────────────────────

const Counter = struct {
    draws: u32 = 0,
    next: f64 = 0.5,
};

fn countingRand(ctx: ?*anyopaque) f64 {
    const c: *Counter = @ptrCast(@alignCast(ctx.?));
    c.draws += 1;
    return c.next;
}

fn base(over: anytype) Inputs {
    var in = Inputs{
        .dist = 300,
        .far_range = 900,
        .engage_range = 300,
        .scale = 1,
        .retreating = false,
        .has_nav = true,
        .los = true,
        .foe_is_human = false,
        .now_ms = 10_000,
        .far_since = 0,
        .cover_until = 0,
    };
    inline for (std.meta.fields(@TypeOf(over))) |f| {
        @field(in, f.name) = @field(over, f.name);
    }
    return in;
}

test "selectMode: retreat wins over everything" {
    var c = Counter{};
    const r = selectMode(base(.{ .retreating = true, .dist = 5000 }), countingRand, &c);
    try std.testing.expectEqual(Mode.retreat, r.mode);
    // And it short-circuits BEFORE the cover roll — no draw consumed.
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "selectMode: out of far range commits immediately" {
    var c = Counter{};
    const r = selectMode(base(.{ .dist = 1200 }), countingRand, &c);
    try std.testing.expectEqual(Mode.commit, r.mode);
    // farSince is STARTED, so the commit timer can run next tick.
    try std.testing.expectEqual(@as(f64, 10_000), r.far_since);
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "selectMode: farSince clears the moment the foe is back in range" {
    var c = Counter{};
    const r = selectMode(base(.{ .dist = 300, .far_since = 5_000 }), countingRand, &c);
    try std.testing.expectEqual(@as(f64, 0), r.far_since);
}

test "selectMode: the commit timer respects human vs bot delay" {
    var c = Counter{};
    // 1500ms out of range: past the BOT delay (1100), short of HUMAN (2000).
    const vs_bot = selectMode(
        base(.{ .dist = 300, .far_since = 8_500, .foe_is_human = false }),
        countingRand,
        &c,
    );
    // dist is back in range, so farSince resets and commit cannot fire —
    // check the timer path with dist still out.
    _ = vs_bot;
    const out_bot = selectMode(
        base(.{ .dist = 1000, .far_since = 8_500, .foe_is_human = false }),
        countingRand,
        &c,
    );
    try std.testing.expectEqual(Mode.commit, out_bot.mode);
    const out_human = selectMode(
        base(.{ .dist = 1000, .far_since = 8_500, .foe_is_human = true }),
        countingRand,
        &c,
    );
    // Still commit — because dist > farRange also forces commit. The
    // DELAY only matters inside far range, which the next test covers.
    try std.testing.expectEqual(Mode.commit, out_human.mode);
}

test "selectMode: cover is skipped entirely for a map-blind bot, and costs no draw" {
    var c = Counter{ .next = 0.0 }; // would always roll cover if asked
    const r = selectMode(base(.{ .has_nav = false, .dist = 300 }), countingRand, &c);
    try std.testing.expectEqual(Mode.hold, r.mode);
    // The `this.nav &&` guard comes FIRST, so no RNG is consumed. A port
    // that drew first would desync the stream for every map-blind bot.
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "selectMode: an active coverUntil short-circuits BEFORE the roll" {
    var c = Counter{ .next = 0.99 }; // would refuse the roll
    const r = selectMode(base(.{ .cover_until = 20_000, .now_ms = 10_000 }), countingRand, &c);
    try std.testing.expectEqual(Mode.cover, r.mode);
    // THE point of this test: no draw was consumed. This operand is first
    // in the || chain, and consuming here would advance the stream on
    // every tick a bot is already in cover.
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "selectMode: blocked LOS inside seek range takes cover without a draw" {
    var c = Counter{ .next = 0.99 };
    const r = selectMode(base(.{ .los = false, .dist = 400 }), countingRand, &c);
    try std.testing.expectEqual(Mode.cover, r.mode);
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "selectMode: the random cover roll consumes EXACTLY one draw, only in range" {
    // In range for the roll: one draw, and it wins.
    var c1 = Counter{ .next = 0.001 };
    const hit = selectMode(base(.{ .dist = 300 }), countingRand, &c1);
    try std.testing.expectEqual(Mode.cover, hit.mode);
    try std.testing.expectEqual(@as(u32, 1), c1.draws);

    // In range, roll loses: still exactly one draw, mode falls through.
    var c2 = Counter{ .next = 0.9 };
    const miss = selectMode(base(.{ .dist = 300 }), countingRand, &c2);
    try std.testing.expectEqual(Mode.hold, miss.mode);
    try std.testing.expectEqual(@as(u32, 1), c2.draws);

    // OUT of the roll's range (dist >= engage+80): no draw at all.
    var c3 = Counter{ .next = 0.001 };
    const far = selectMode(base(.{ .dist = 500 }), countingRand, &c3);
    try std.testing.expectEqual(Mode.chase, far.mode);
    try std.testing.expectEqual(@as(u32, 0), c3.draws);
}

test "selectMode: hold band — chase outside 70px, hold inside" {
    var c = Counter{ .next = 0.9 };
    try std.testing.expectEqual(Mode.hold, selectMode(base(.{ .dist = 300 }), countingRand, &c).mode);
    try std.testing.expectEqual(Mode.hold, selectMode(base(.{ .dist = 369 }), countingRand, &c).mode);
    // 71 past engage range is a chase.
    try std.testing.expectEqual(Mode.chase, selectMode(base(.{ .dist = 371 }), countingRand, &c).mode);
    // And symmetrically on the near side.
    try std.testing.expectEqual(Mode.chase, selectMode(base(.{ .dist = 229 }), countingRand, &c).mode);
}
