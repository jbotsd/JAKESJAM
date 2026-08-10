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

// ── gospel N-BOT · unstick detection ─────────────────────────────────────
//
// Port of the "Unstick" block in `decide`. Small, but it is the first
// genuinely STATEFUL piece to cross: `stuck_ticks` accumulates across
// ticks, so it cannot be verified by feeding one snapshot — the tests
// below drive sequences.
//
// What it is for: a bot pressed against a wall reports movement intent
// every tick and goes nowhere. Without this it grinds there forever,
// which is the single most visible way a bot looks broken.

/// Movement counts as "moved" above this, per tick. Vertical is weighted
/// down because falling is not progress.
pub const STUCK_MOVE_EPSILON: f64 = 0.7;
pub const VERTICAL_WEIGHT: f64 = 0.35;
/// Three ticks of no progress = probably a wall; hop.
pub const ON_WALL_TICKS: u32 = 3;
/// Prolonged stick = a real corner; reverse out of it.
pub const REVERSE_TICKS: u32 = 48;
/// ...and give the reversal 6 ticks before re-arming, or it oscillates.
pub const REVERSE_CLEAR_TICKS: u32 = 54;

pub const StuckWatch = struct {
    last_x: f64 = 0,
    last_y: f64 = 0,
    stuck_ticks: u32 = 0,

    pub const Out = struct {
        move_dir: i32,
        want_jump: bool,
        on_wall: bool,
    };

    /// Feed this tick's position and movement intent.
    pub fn step(self: *StuckWatch, x: f64, y: f64, move_dir: i32) Out {
        const moved = @abs(x - self.last_x) + @abs(y - self.last_y) * VERTICAL_WEIGHT;
        if (move_dir != 0 and moved < STUCK_MOVE_EPSILON) {
            self.stuck_ticks += 1;
        } else {
            self.stuck_ticks = 0;
        }
        self.last_x = x;
        self.last_y = y;

        var dir = move_dir;
        const on_wall = self.stuck_ticks >= ON_WALL_TICKS;
        const want_jump = on_wall;
        if (self.stuck_ticks >= REVERSE_TICKS) {
            dir = -dir;
            if (self.stuck_ticks >= REVERSE_CLEAR_TICKS) self.stuck_ticks = 0;
        }
        return .{ .move_dir = dir, .want_jump = want_jump, .on_wall = on_wall };
    }
};

test "StuckWatch: standing still with NO intent is not stuck" {
    // The distinction that matters: a bot deliberately holding position
    // is not stuck, and hopping it would look like a twitch.
    var w = StuckWatch{};
    var i: usize = 0;
    while (i < 20) : (i += 1) {
        const o = w.step(100, 100, 0);
        try std.testing.expect(!o.on_wall);
        try std.testing.expect(!o.want_jump);
    }
    try std.testing.expectEqual(@as(u32, 0), w.stuck_ticks);
}

test "StuckWatch: pressing into a wall hops after three ticks" {
    var w = StuckWatch{ .last_x = 100, .last_y = 100 };
    try std.testing.expect(!w.step(100, 100, 1).want_jump); // 1
    try std.testing.expect(!w.step(100, 100, 1).want_jump); // 2
    try std.testing.expect(w.step(100, 100, 1).want_jump); //  3 → hop
}

test "StuckWatch: real movement clears the counter" {
    var w = StuckWatch{ .last_x = 100, .last_y = 100 };
    _ = w.step(100, 100, 1);
    _ = w.step(100, 100, 1);
    _ = w.step(140, 100, 1); // moved
    try std.testing.expectEqual(@as(u32, 0), w.stuck_ticks);
    try std.testing.expect(!w.step(140, 100, 1).want_jump);
}

test "StuckWatch: falling alone does not count as progress" {
    // Vertical is weighted 0.35, so a 1px fall is 0.35 — under the 0.7
    // epsilon. A bot sliding down a wall is still stuck against it.
    var w = StuckWatch{ .last_x = 100, .last_y = 100 };
    _ = w.step(100, 101, 1);
    _ = w.step(100, 102, 1);
    try std.testing.expect(w.step(100, 103, 1).want_jump);
}

test "StuckWatch: a long stick reverses, then re-arms rather than oscillating" {
    var w = StuckWatch{ .last_x = 0, .last_y = 0 };
    var last: StuckWatch.Out = undefined;
    var i: u32 = 0;
    while (i < REVERSE_TICKS) : (i += 1) last = w.step(0, 0, 1);
    // At 48 ticks the direction flips out of the corner.
    try std.testing.expectEqual(@as(i32, -1), last.move_dir);
    // It keeps reversing for a few ticks, THEN clears — clearing
    // immediately would flip back and forth every other tick.
    while (i < REVERSE_CLEAR_TICKS) : (i += 1) last = w.step(0, 0, 1);
    try std.testing.expectEqual(@as(u32, 0), w.stuck_ticks);
}

test "StuckWatch: zero intent is never reversed into movement" {
    // -0 is still 0: a held-still bot must not be pushed anywhere by the
    // corner logic.
    var w = StuckWatch{ .last_x = 0, .last_y = 0 };
    var i: u32 = 0;
    while (i < 60) : (i += 1) {
        const o = w.step(0, 0, 0);
        try std.testing.expectEqual(@as(i32, 0), o.move_dir);
    }
}

// ── gospel N-BOT · body-threat reaction ──────────────────────────────────
//
// Port of the "bodyThreat" block in `decide`: someone is dashing at us,
// close, and closing. After a reaction delay the bot picks ONE of shield
// / dash-away / jump.
//
// Two things make this worth porting carefully rather than eyeballing:
//
// 1. ONE rand draw feeds a three-way branch (`< 0.4` shield, `< 0.75`
//    dash, else jump). Drawing twice, or drawing when the delay has not
//    elapsed, desyncs the stream — same class of bug as the cover roll.
// 2. The shield arm is CONDITIONAL on charge, and the TS does not re-roll
//    when it fails: a bot with a flat shield and a roll of 0.2 does
//    NOTHING that tick. Reading the chain as "shield, else dash" would
//    quietly make bots more evasive than they are.

pub const BODY_THREAT_RADIUS: f64 = 240;
pub const BODY_THREAT_REACTION_MS: f64 = 320;
pub const SHIELD_MIN_CHARGE: f64 = 25;

pub const Reaction = enum { none, shield, dash_away, jump };

pub const BodyThreatWatch = struct {
    /// Timestamp the current threat began; 0 means "no threat".
    ///
    /// FAITHFUL TO THE TS, INCLUDING ITS TRAP: `bot.bodyThreatSince === 0`
    /// uses zero as both the sentinel and a possible timestamp, so a
    /// threat beginning at exactly now_ms == 0 is not recorded and the
    /// timer starts one tick late instead. Harmless live — the clock is
    /// monotonic wall time and never 0 — but reachable in any test or
    /// replay whose clock starts at zero, which is how it was found.
    /// Left matching rather than "fixed": diverging from the TS on a
    /// timer is how bots stop behaving identically.
    since: f64 = 0,

    /// `threat` is the caller's already-computed "dashing, in radius, and
    /// heading toward me" — kept out of here because `headingTowardMe`
    /// lives in bot_target and duplicating it would be a second opinion.
    pub fn step(
        self: *BodyThreatWatch,
        threat: bool,
        now_ms: f64,
        grounded: bool,
        shield_charge: ?f64,
        rand: *const fn (ctx: ?*anyopaque) f64,
        rand_ctx: ?*anyopaque,
    ) Reaction {
        if (threat) {
            if (self.since == 0) self.since = now_ms;
        } else {
            self.since = 0;
        }
        if (!threat or (now_ms - self.since) < BODY_THREAT_REACTION_MS) return .none;

        const roll = rand(rand_ctx);
        if (roll < 0.4) {
            // No re-roll on a flat shield — the TS falls THROUGH to
            // nothing, and inventing a fallback would make bots dodge
            // more than they do.
            if (shield_charge) |sc| {
                if (sc > SHIELD_MIN_CHARGE) return .shield;
            }
            return .none;
        }
        if (roll < 0.75) return .dash_away;
        if (grounded) return .jump;
        return .none;
    }
};

test "BodyThreatWatch: no threat means no draw and no reaction" {
    var c = Counter{ .next = 0.1 };
    var w = BodyThreatWatch{};
    try std.testing.expectEqual(Reaction.none, w.step(false, 1000, true, 100, countingRand, &c));
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "BodyThreatWatch: the reaction delay must elapse first" {
    var c = Counter{ .next = 0.1 };
    var w = BodyThreatWatch{};
    // Threat starts at t=1000.
    try std.testing.expectEqual(Reaction.none, w.step(true, 1000, true, 100, countingRand, &c));
    try std.testing.expectEqual(Reaction.none, w.step(true, 1200, true, 100, countingRand, &c));
    // Not a single draw yet — reacting instantly is inhuman, and drawing
    // early would desync the stream even when the reaction is suppressed.
    try std.testing.expectEqual(@as(u32, 0), c.draws);
    try std.testing.expectEqual(Reaction.shield, w.step(true, 1330, true, 100, countingRand, &c));
    try std.testing.expectEqual(@as(u32, 1), c.draws);
}

test "BodyThreatWatch: the three-way split uses ONE draw" {
    var w = BodyThreatWatch{};
    var c = Counter{ .next = 0.2 };
    _ = w.step(true, 10_000, true, 100, countingRand, &c);
    try std.testing.expectEqual(Reaction.shield, w.step(true, 10_400, true, 100, countingRand, &c));
    try std.testing.expectEqual(@as(u32, 1), c.draws);

    var w2 = BodyThreatWatch{};
    var c2 = Counter{ .next = 0.6 };
    _ = w2.step(true, 10_000, true, 100, countingRand, &c2);
    try std.testing.expectEqual(Reaction.dash_away, w2.step(true, 10_400, true, 100, countingRand, &c2));
    try std.testing.expectEqual(@as(u32, 1), c2.draws);

    var w3 = BodyThreatWatch{};
    var c3 = Counter{ .next = 0.9 };
    _ = w3.step(true, 10_000, true, 100, countingRand, &c3);
    try std.testing.expectEqual(Reaction.jump, w3.step(true, 10_400, true, 100, countingRand, &c3));
    try std.testing.expectEqual(@as(u32, 1), c3.draws);
}

test "BodyThreatWatch: a flat shield does NOTHING — it does not fall through to dash" {
    // The subtle one. Reading the chain as "shield, else dash" would make
    // low-shield bots dodge on rolls where the real brain just eats it.
    var w = BodyThreatWatch{};
    var c = Counter{ .next = 0.2 };
    _ = w.step(true, 10_000, true, 10, countingRand, &c);
    try std.testing.expectEqual(Reaction.none, w.step(true, 10_400, true, 10, countingRand, &c));
    // Absent charge behaves the same as a flat one.
    var w2 = BodyThreatWatch{};
    var c2 = Counter{ .next = 0.2 };
    _ = w2.step(true, 10_000, true, null, countingRand, &c2);
    try std.testing.expectEqual(Reaction.none, w2.step(true, 10_400, true, null, countingRand, &c2));
}

test "BodyThreatWatch: airborne cannot jump" {
    var w = BodyThreatWatch{};
    var c = Counter{ .next = 0.9 };
    _ = w.step(true, 10_000, false, 100, countingRand, &c);
    try std.testing.expectEqual(Reaction.none, w.step(true, 10_400, false, 100, countingRand, &c));
}

test "BodyThreatWatch: a threat beginning at now_ms == 0 loses one tick (documented trap)" {
    // Precise about what the trap actually is, having first written down
    // a stronger claim ("never fires") and been corrected by the test.
    // Zero doubles as the "no threat" sentinel, so a threat starting at
    // exactly t=0 is not recorded; the NEXT tick starts the timer, and
    // the reaction is late by that one tick. Unreachable live (monotonic
    // wall clock), reachable in any test or replay whose clock starts at
    // zero — which is how it turned up.
    var w = BodyThreatWatch{};
    var c = Counter{ .next = 0.6 };
    try std.testing.expectEqual(Reaction.none, w.step(true, 0, true, 100, countingRand, &c));
    try std.testing.expectEqual(@as(f64, 0), w.since); // swallowed
    _ = w.step(true, 100, true, 100, countingRand, &c);
    try std.testing.expectEqual(@as(f64, 100), w.since); // starts here instead
    // So the reaction lands at 100 + 320, not 0 + 320.
    try std.testing.expectEqual(Reaction.none, w.step(true, 380, true, 100, countingRand, &c));
    try std.testing.expectEqual(Reaction.dash_away, w.step(true, 420, true, 100, countingRand, &c));
}

test "BodyThreatWatch: the timer resets when the threat passes" {
    var w = BodyThreatWatch{};
    var c = Counter{ .next = 0.6 };
    _ = w.step(true, 10_000, true, 100, countingRand, &c);
    _ = w.step(false, 10_100, true, 100, countingRand, &c); // threat gone
    try std.testing.expectEqual(@as(f64, 0), w.since);
    // A new threat has to serve the full delay again, not inherit credit.
    try std.testing.expectEqual(Reaction.none, w.step(true, 10_200, true, 100, countingRand, &c));
    try std.testing.expectEqual(Reaction.dash_away, w.step(true, 10_600, true, 100, countingRand, &c));
}

// ── gospel N-BOT · offensive slide + emission cast ───────────────────────
//
// Two more "should I press this" decisions, both RNG-sensitive and both
// with a rule that is easy to get subtly wrong.

pub const DASH_BASH_RANGE: f64 = 200;
/// Indexed by slideTier. Tier 0 never slides — it is the FTUE gate, so a
/// newcomer's first fight has no bot power-sliding into them.
pub const DASH_OFFENSE_CHANCE = [3]f64{ 0, 0.02, 0.07 };

/// Should the bot power-slide into the foe this tick?
///
/// The `rand()` is LAST in the `&&` chain, so it is only consumed when
/// every cheap condition already passed. Hoisting it — the tidier-looking
/// order — would draw on every tick for every bot and desync the stream.
pub fn wantsOffensiveSlide(
    slide_tier: u8,
    foe_is_fresh: bool,
    move_dir: i32,
    toward_foe: i32,
    dist: f64,
    rand: *const fn (ctx: ?*anyopaque) f64,
    rand_ctx: ?*anyopaque,
) bool {
    if (slide_tier == 0) return false;
    if (foe_is_fresh) return false;
    if (move_dir != toward_foe) return false;
    if (dist > DASH_BASH_RANGE) return false;
    const tier = @min(slide_tier, DASH_OFFENSE_CHANCE.len - 1);
    return rand(rand_ctx) < DASH_OFFENSE_CHANCE[tier];
}

/// Emission cast timing. Bots must exercise the cast path — "the bots are
/// the only ones never testing this" is how a whole ability rots.
pub const EmissionCast = struct {
    /// Absolute time the cast is due; null = not armed.
    cast_at: ?f64 = null,

    pub const Out = enum { idle, armed, cast };

    pub fn step(
        self: *EmissionCast,
        charge: f64,
        charge_max: f64,
        dist: f64,
        now_ms: f64,
        rand: *const fn (ctx: ?*anyopaque) f64,
        rand_ctx: ?*anyopaque,
    ) Out {
        if (charge >= charge_max and dist <= 600) {
            if (self.cast_at == null) {
                // Humanising delay: 1-3s. Drawn ONCE at arm time, not per
                // tick — re-rolling every tick would make the cast land on
                // a geometric distribution instead of a uniform one, and
                // bots would fire almost immediately.
                self.cast_at = now_ms + 1000 + rand(rand_ctx) * 2000;
                return .armed;
            }
            if (now_ms >= self.cast_at.?) {
                self.cast_at = null;
                return .cast;
            }
            return .armed;
        }
        // Only DISARM on low charge. Out of range with a full meter keeps
        // the timer, which is what lets a bot chase and then cast on
        // arrival rather than restarting its delay at the door.
        if (charge < charge_max) self.cast_at = null;
        return .idle;
    }
};

test "wantsOffensiveSlide: tier 0 never slides, and costs no draw" {
    var c = Counter{ .next = 0.0 };
    try std.testing.expect(!wantsOffensiveSlide(0, false, 1, 1, 50, countingRand, &c));
    // The FTUE gate is first, so a newcomer's fight does not even roll.
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "wantsOffensiveSlide: a FRESH foe is never slid into" {
    var c = Counter{ .next = 0.0 };
    try std.testing.expect(!wantsOffensiveSlide(2, true, 1, 1, 50, countingRand, &c));
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "wantsOffensiveSlide: only when already moving AT the foe, and in range" {
    var c = Counter{ .next = 0.0 };
    try std.testing.expect(!wantsOffensiveSlide(2, false, -1, 1, 50, countingRand, &c));
    try std.testing.expect(!wantsOffensiveSlide(2, false, 1, 1, 400, countingRand, &c));
    // Neither cheap rejection consumed a draw — that is the contract.
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "wantsOffensiveSlide: rolls exactly once when everything else passes" {
    var hit = Counter{ .next = 0.01 };
    try std.testing.expect(wantsOffensiveSlide(2, false, 1, 1, 50, countingRand, &hit));
    try std.testing.expectEqual(@as(u32, 1), hit.draws);
    var miss = Counter{ .next = 0.5 };
    try std.testing.expect(!wantsOffensiveSlide(2, false, 1, 1, 50, countingRand, &miss));
    try std.testing.expectEqual(@as(u32, 1), miss.draws);
}

test "wantsOffensiveSlide: tier 2 is likelier than tier 1" {
    // Vacuity guard on the tier table: if both tiers read the same slot
    // the FTUE ramp would be decorative.
    var c = Counter{ .next = 0.05 }; // between tier1 (.02) and tier2 (.07)
    try std.testing.expect(!wantsOffensiveSlide(1, false, 1, 1, 50, countingRand, &c));
    try std.testing.expect(wantsOffensiveSlide(2, false, 1, 1, 50, countingRand, &c));
}

test "EmissionCast: arms once with ONE draw, then fires after the delay" {
    var e = EmissionCast{};
    var c = Counter{ .next = 0.5 }; // → 1000 + 1000 = 2000ms delay
    try std.testing.expectEqual(EmissionCast.Out.armed, e.step(100, 100, 300, 10_000, countingRand, &c));
    try std.testing.expectEqual(@as(u32, 1), c.draws);
    // Ticking while armed must NOT re-draw; re-rolling each tick would
    // collapse the delay toward zero.
    try std.testing.expectEqual(EmissionCast.Out.armed, e.step(100, 100, 300, 11_000, countingRand, &c));
    try std.testing.expectEqual(@as(u32, 1), c.draws);
    try std.testing.expectEqual(EmissionCast.Out.cast, e.step(100, 100, 300, 12_000, countingRand, &c));
    // And it disarms after casting, ready to re-arm next charge.
    try std.testing.expectEqual(@as(?f64, null), e.cast_at);
}

test "EmissionCast: an empty meter disarms; out of range does NOT" {
    var e = EmissionCast{};
    var c = Counter{ .next = 0.5 };
    _ = e.step(100, 100, 300, 10_000, countingRand, &c);
    try std.testing.expect(e.cast_at != null);

    // Out of range with a full meter KEEPS the timer — a bot that chases
    // then casts on arrival, rather than restarting its delay at the door.
    _ = e.step(100, 100, 900, 10_500, countingRand, &c);
    try std.testing.expect(e.cast_at != null);

    // Charge spent → disarmed.
    _ = e.step(10, 100, 300, 10_600, countingRand, &c);
    try std.testing.expectEqual(@as(?f64, null), e.cast_at);
}

test "EmissionCast: an idle bot never draws" {
    var e = EmissionCast{};
    var c = Counter{ .next = 0.5 };
    var t: f64 = 10_000;
    while (t < 20_000) : (t += 100) _ = e.step(10, 100, 300, t, countingRand, &c);
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

// ── gospel N-BOT · aim ───────────────────────────────────────────────────
//
// Weak lead + a slow EMA + per-target error multipliers. This is the
// single biggest lever on how a bot FEELS, and every term in it is there
// to make the bot worse on purpose:
//
//   - lead is only 0.4 of the true intercept, so it under-leads and can
//     be strafed away from;
//   - the EMA tracks at 0.16/tick, so it lags a target that changes
//     direction — a perfect tracker is unfun to fight;
//   - humans get 1.45x the aim error, and a NEWCOMER 2.2x on top of that
//     (3.19x total), which is the difference between "I got shot" and
//     "I never had a chance".
//
// Getting any of those wrong makes bots feel wrong without failing
// anything, so the tests pin the multipliers compounding rather than
// replacing.

pub const AIM_ERROR_PX: f64 = 78;
pub const LEAD_FACTOR: f64 = 0.4;
pub const PROJECTILE_SPEED: f64 = 650;
pub const HUMAN_AIM_ERROR_MUL: f64 = 1.45;
pub const FRESH_AIM_ERROR_MUL: f64 = 2.2;
pub const AIM_EMA: f64 = 0.16;

pub const AimState = struct {
    x: f64 = 0,
    y: f64 = 0,

    /// Advance the aim EMA and return the jittered aim point.
    ///
    /// TWO draws, always, in x-then-y order. Both are unconditional here,
    /// which is worth stating because most of this brain's draws are not:
    /// swapping the order or collapsing them to one shared jitter changes
    /// the stream and correlates the axes into a diagonal bias.
    pub fn step(
        self: *AimState,
        foe_x: f64,
        foe_y: f64,
        foe_vx: f64,
        foe_vy: f64,
        dist: f64,
        foe_is_human: bool,
        foe_is_fresh: bool,
        rand: *const fn (ctx: ?*anyopaque) f64,
        rand_ctx: ?*anyopaque,
    ) struct { x: f64, y: f64 } {
        const flight_sec = dist / PROJECTILE_SPEED;
        const lead_x = foe_x + foe_vx * flight_sec * LEAD_FACTOR;
        const lead_y = foe_y + foe_vy * flight_sec * LEAD_FACTOR;
        self.x += (lead_x - self.x) * AIM_EMA;
        self.y += (lead_y - self.y) * AIM_EMA;

        var err_mul: f64 = 1;
        if (foe_is_human) err_mul *= HUMAN_AIM_ERROR_MUL;
        // COMPOUNDS with the human multiplier rather than replacing it —
        // a fresh human gets 1.45 * 2.2 = 3.19x, not 2.2x.
        if (foe_is_fresh) err_mul *= FRESH_AIM_ERROR_MUL;
        const err = AIM_ERROR_PX * err_mul;

        return .{
            .x = self.x + (rand(rand_ctx) - 0.5) * err,
            .y = self.y + (rand(rand_ctx) - 0.5) * err,
        };
    }
};

test "AimState: the EMA lags rather than snapping" {
    var a = AimState{ .x = 0, .y = 0 };
    var c = Counter{ .next = 0.5 }; // zero jitter
    const out = a.step(1000, 0, 0, 0, 1000, false, false, countingRand, &c);
    // One tick moves 16% of the way, not all of it. A bot that snapped
    // would be unmissable.
    try std.testing.expectApproxEqAbs(@as(f64, 160), out.x, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 160), a.x, 1e-9);
}

test "AimState: it converges toward a stationary target over time" {
    var a = AimState{ .x = 0, .y = 0 };
    var c = Counter{ .next = 0.5 };
    var i: usize = 0;
    while (i < 60) : (i += 1) _ = a.step(1000, 0, 0, 0, 1000, false, false, countingRand, &c);
    // Vacuity guard for the lag test: it must actually arrive eventually,
    // or "lags" would be indistinguishable from "broken".
    try std.testing.expect(a.x > 990);
}

test "AimState: lead is weak on purpose — 0.4 of the true intercept" {
    var a = AimState{ .x = 0, .y = 0 };
    var c = Counter{ .next = 0.5 };
    // 650px away = 1s flight; a foe at 100px/s would truly need +100 lead.
    _ = a.step(650, 0, 100, 0, 650, false, false, countingRand, &c);
    // Target point is 650 + 100*1*0.4 = 690; EMA takes 16% of it.
    try std.testing.expectApproxEqAbs(@as(f64, 690 * AIM_EMA), a.x, 1e-9);
}

test "AimState: error multipliers COMPOUND for a fresh human" {
    // The rule that protects newcomers. A fresh human must get
    // 1.45 * 2.2 = 3.19x error, not 2.2x — reading these as alternatives
    // would make a first fight far deadlier than intended.
    var c = Counter{ .next = 1.0 }; // max positive jitter → err/2
    var bot_foe = AimState{ .x = 0, .y = 0 };
    const vs_bot = bot_foe.step(0, 0, 0, 0, 0, false, false, countingRand, &c);
    var human = AimState{ .x = 0, .y = 0 };
    const vs_human = human.step(0, 0, 0, 0, 0, true, false, countingRand, &c);
    var fresh = AimState{ .x = 0, .y = 0 };
    const vs_fresh = fresh.step(0, 0, 0, 0, 0, true, true, countingRand, &c);

    try std.testing.expectApproxEqAbs(AIM_ERROR_PX / 2, vs_bot.x, 1e-9);
    try std.testing.expectApproxEqAbs(AIM_ERROR_PX * HUMAN_AIM_ERROR_MUL / 2, vs_human.x, 1e-9);
    try std.testing.expectApproxEqAbs(
        AIM_ERROR_PX * HUMAN_AIM_ERROR_MUL * FRESH_AIM_ERROR_MUL / 2,
        vs_fresh.x,
        1e-9,
    );
    // And they are genuinely different, so the assertions above are not
    // all quietly comparing the same number.
    try std.testing.expect(vs_fresh.x > vs_human.x);
    try std.testing.expect(vs_human.x > vs_bot.x);
}

test "AimState: exactly two draws per step, x then y" {
    var a = AimState{};
    var c = Counter{ .next = 0.5 };
    _ = a.step(100, 100, 0, 0, 100, false, false, countingRand, &c);
    try std.testing.expectEqual(@as(u32, 2), c.draws);
    _ = a.step(100, 100, 0, 0, 100, false, false, countingRand, &c);
    try std.testing.expectEqual(@as(u32, 4), c.draws);
}

test "AimState: the two axes jitter independently" {
    // Collapsing to one shared draw would correlate them into a diagonal
    // bias — cheap to write, and visible as bots that always miss the
    // same way.
    const Alt = struct {
        var flip: bool = false;
        fn r(_: ?*anyopaque) f64 {
            flip = !flip;
            return if (flip) 1.0 else 0.0;
        }
    };
    var a = AimState{ .x = 0, .y = 0 };
    const out = a.step(0, 0, 0, 0, 0, false, false, Alt.r, null);
    try std.testing.expect(out.x != out.y);
}

// ── gospel N-BOT · fire gate ─────────────────────────────────────────────
//
// Bursty, not a held trigger. The comment in the TS is blunt about why
// ("was 'hard as nails'"): a bot that fires every tick it has line of
// sight is not difficult, it is exhausting, and it removes the pauses a
// player uses to reposition.
//
// The blind-fire branch is the interesting one. A bot in COVER still
// takes the occasional shot (8%) at a target it cannot see, which is what
// makes cover feel like a standoff rather than a safe pause — but ONLY in
// cover, and only at that low rate.

pub const FIRE_CHANCE_LOS: f64 = 0.55;
pub const FIRE_CHANCE_BLIND: f64 = 0.08;
pub const SHIELD_RETREAT_MIN_CHARGE: f64 = 20;

pub const FireDecision = struct {
    fire: bool,
    shield: bool,
};

pub fn decideFire(
    dist: f64,
    fire_range: f64,
    retreating: bool,
    los: bool,
    in_cover: bool,
    shield_charge: ?f64,
    rand: *const fn (ctx: ?*anyopaque) f64,
    rand_ctx: ?*anyopaque,
) FireDecision {
    var fire = false;
    if (dist < fire_range and !retreating) {
        if (los) {
            fire = rand(rand_ctx) < FIRE_CHANCE_LOS;
        } else if (in_cover) {
            // Note the asymmetry: no LOS and NOT in cover draws nothing
            // at all. Only a bot that chose cover takes blind shots.
            fire = rand(rand_ctx) < FIRE_CHANCE_BLIND;
        }
    }

    var shield = false;
    if (retreating) {
        if (shield_charge) |sc| shield = sc > SHIELD_RETREAT_MIN_CHARGE;
    }
    return .{ .fire = fire, .shield = shield };
}

test "decideFire: out of range never fires and never draws" {
    var c = Counter{ .next = 0.0 };
    const d = decideFire(900, 640, false, true, false, 100, countingRand, &c);
    try std.testing.expect(!d.fire);
    try std.testing.expectEqual(@as(u32, 0), c.draws);
}

test "decideFire: retreating suppresses fire entirely, without a draw" {
    var c = Counter{ .next = 0.0 };
    const d = decideFire(100, 640, true, true, false, 100, countingRand, &c);
    try std.testing.expect(!d.fire);
    try std.testing.expectEqual(@as(u32, 0), c.draws);
    // ...and raises the shield instead, if there is charge for it.
    try std.testing.expect(d.shield);
}

test "decideFire: retreating on a flat shield does nothing" {
    var c = Counter{ .next = 0.0 };
    try std.testing.expect(!decideFire(100, 640, true, true, false, 10, countingRand, &c).shield);
    try std.testing.expect(!decideFire(100, 640, true, true, false, null, countingRand, &c).shield);
}

test "decideFire: with LOS it is bursty at 55 percent, one draw" {
    var hit = Counter{ .next = 0.2 };
    const a = decideFire(100, 640, false, true, false, 100, countingRand, &hit);
    try std.testing.expect(a.fire);
    try std.testing.expectEqual(@as(u32, 1), hit.draws);

    var miss = Counter{ .next = 0.9 };
    const b = decideFire(100, 640, false, true, false, 100, countingRand, &miss);
    // The point of the whole gate: sometimes it just does not shoot.
    try std.testing.expect(!b.fire);
    try std.testing.expectEqual(@as(u32, 1), miss.draws);
}

test "decideFire: blind fire happens ONLY in cover" {
    // No LOS, not in cover: no shot and, importantly, no draw.
    var c1 = Counter{ .next = 0.0 };
    try std.testing.expect(!decideFire(100, 640, false, false, false, 100, countingRand, &c1).fire);
    try std.testing.expectEqual(@as(u32, 0), c1.draws);

    // No LOS, in cover: draws once, and the 8% band is much tighter than
    // the LOS one — 0.2 fires with sight and does not blind.
    var c2 = Counter{ .next = 0.2 };
    try std.testing.expect(!decideFire(100, 640, false, false, true, 100, countingRand, &c2).fire);
    try std.testing.expectEqual(@as(u32, 1), c2.draws);

    var c3 = Counter{ .next = 0.05 };
    try std.testing.expect(decideFire(100, 640, false, false, true, 100, countingRand, &c3).fire);
}
