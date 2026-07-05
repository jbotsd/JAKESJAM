//! JAKESJAM-specific data — deterministic arena generator.
//!
//! Zig-native replacement for `client/src/sim/data/mapGen.ts`'s
//! generator + route-graph validator. Lives in `sim/src/data/` per the
//! package-boundary discipline (game-specific level design, not
//! game-agnostic core sim) — see `sim/README.md`.
//!
//! Every arena is built from tall SOLID columns (a structure taller than
//! the one-way cap is solid 4-way — a grabbable wall) arranged so that:
//!   - columns sit within SHAFT_MAX of the outer wall or a sibling column,
//!     forming climbable shafts,
//!   - perches sit at shaft tops (reachable by wall-jumping the shaft),
//!   - thin one-way ledges give lateral hop routes,
//!   - >=2 low ledges are a plain jump off the floor (routes up),
//! checked by a route-graph validator that models BOTH jump edges AND
//! shaft/wall-jump reachability BEFORE the arena is allowed to exist.
//!
//! Deterministic: `world_state_generate_arena(seed)` writes byte-identical
//! statics/spawns on every host running this wasm binary (client + server),
//! per the wasm spec's IEEE 754 reproducibility guarantee. No wall-clock,
//! no allocator, no host RNG — the seeded `rng.zig` cursor is the only
//! source of randomness.
//!
//! This is a fresh, independent generator (not required to reproduce the
//! retired TS generator's seed->geometry mapping bit-for-bit) — it only
//! has to be internally deterministic and satisfy its own validator laws,
//! which is exactly what the TS generator's own contract was.

const std = @import("std");
const rng = @import("../rng.zig");
const collision = @import("../collision.zig");
const world_state = @import("../world_state.zig");

// ── Arena frame constants ──────────────────────────────────────────────
const ARENA_W: f64 = 1760;
const ARENA_H: f64 = 820;
const WALL: f64 = 32;
const FLOOR_H: f64 = 32;
const PLAT_H: f64 = 18; // thin one-way ledge thickness (<= 24 -> pass-through)
const FLOOR_TOP: f64 = ARENA_H - FLOOR_H; // 788 -- feet rest here

// ── Movement-derived law constants (docs/map-design.md) ────────────────
pub const MAX_STEP_RISE: f64 = 129;
pub const MAX_GAP_FALLING: f64 = 300;
pub const MAX_SIGHTLINE: f64 = 560;
pub const DENSITY_MIN: f64 = 0.08;
pub const DENSITY_MAX: f64 = 0.19;
pub const MIN_SPAWN_DIST: f64 = 360;

// ── Wall-movement law constants (docs/character-controller-overhaul.md) ─
pub const GRAB_MIN_H: f64 = 25;
pub const SHAFT_MAX: f64 = 230;
pub const WALL_JUMP_UP: f64 = 178;
pub const GRAB_REACH_SIDE: f64 = 200;
/** A `structure` platform taller than this is one-way (mirrors
 *  ONE_WAY_MAX_HEIGHT_PX in collision.ts). */
const ONE_WAY_MAX_HEIGHT: f64 = 24;

const JUMP_V0: f64 = 635;
const JUMP_GRAV: f64 = 1450;
const RUN_SPEED: f64 = 330;

/// Max horizontal gap a jump can cross while RISING to a platform `rise`
/// px above. Returns -1 when `rise` is above the jump apex (unreachable).
fn maxGapForRise(rise: f64) f64 {
    if (rise <= 0) return MAX_GAP_FALLING;
    const disc = JUMP_V0 * JUMP_V0 - 2 * JUMP_GRAV * rise;
    if (disc < 0) return -1;
    const t = (JUMP_V0 - @sqrt(disc)) / JUMP_GRAV;
    return RUN_SPEED * t;
}

// Ledge bands (feet land on top). Floor 788 -> 680 -> 572 -> 464 -> 356 ->
// 248 -> 140. Six bands available; each candidate uses a random 4-6 of
// them for layout variety.
const BANDS = [_]f64{ 680, 572, 464, 356, 248, 140 };
const BAND_COUNTS = [_]u32{ 4, 5, 6 };
const SIDE_TOWER_TOPS = [_]f64{ 356, 248 };
const CENTER_TOWER_TOPS = [_]f64{ 464, 356 };
const COVER_TOP: f64 = 640;

// ── Seeded RNG — reuse the sim's established mulberry32-family cursor
//    (rng.zig::nextU32) rather than inventing a second variant. ────────
fn randFloat01(state: *u32) f64 {
    state.* = rng.nextU32(state.*);
    return @as(f64, @floatFromInt(state.*)) / 4294967296.0;
}

fn pickF(state: *u32, arr: []const f64) f64 {
    const idx: usize = @intFromFloat(@floor(randFloat01(state) * @as(f64, @floatFromInt(arr.len))));
    return arr[idx];
}

fn pickU32(state: *u32, arr: []const u32) u32 {
    const idx: usize = @intFromFloat(@floor(randFloat01(state) * @as(f64, @floatFromInt(arr.len))));
    return arr[idx];
}

fn snap8(v: f64) f64 {
    return @floor(v / 8.0 + 0.5) * 8.0;
}

// ── Candidate arena (fixed-capacity, no allocation) ─────────────────────

pub const MAX_GEN_PLATFORMS: usize = 64;
pub const MAX_GEN_SPAWNS: usize = 8;

const PlatKind = enum(u8) { floor, wall, ceiling, structure };

const GenPlatform = struct {
    cx: f64,
    cy: f64,
    w: f64,
    h: f64,
    kind: PlatKind,
};

const Vec2 = struct { x: f64, y: f64 };

const Candidate = struct {
    platform_count: usize = 0,
    platforms: [MAX_GEN_PLATFORMS]GenPlatform = undefined,
    spawn_count: usize = 0,
    spawns: [MAX_GEN_SPAWNS]Vec2 = undefined,
    theme_id: u32 = 0,

    fn addPlatform(self: *Candidate, cx: f64, cy: f64, w: f64, h: f64, kind: PlatKind) void {
        if (self.platform_count >= MAX_GEN_PLATFORMS) return; // generous cap; never hit in practice
        self.platforms[self.platform_count] = .{ .cx = cx, .cy = cy, .w = w, .h = h, .kind = kind };
        self.platform_count += 1;
    }
};

/// Solid grab column from floor up to `top`. Solid 4-way (h > GRAB_MIN_H).
fn addColumn(c: *Candidate, cx: f64, w: f64, top: f64) void {
    const h = FLOOR_TOP - top;
    c.addPlatform(snap8(cx), snap8(top + h / 2), w, snap8(h), .structure);
}

/// Thin one-way ledge (pass-through from below).
fn addLedge(c: *Candidate, cx: f64, w: f64, top: f64) void {
    c.addPlatform(snap8(cx), top + PLAT_H / 2, snap8(w), PLAT_H, .structure);
}

/// A solid grab column embeds a spawning body if placed too close (feet
/// at x, HALF_W = player half-width + clearance margin).
fn floorClear(cand: *const Candidate, x: f64) bool {
    const half_w: f64 = 13 + 18;
    var i: usize = 0;
    while (i < cand.platform_count) : (i += 1) {
        const p = cand.platforms[i];
        if (p.kind != .structure or p.h < GRAB_MIN_H) continue; // ledges don't embed
        const x0 = p.cx - p.w / 2;
        const x1 = p.cx + p.w / 2;
        if (!(x + half_w < x0 or x - half_w > x1)) return false;
    }
    return true;
}

/// Generate one arena candidate. Mirror-symmetric ~half the time (1v1
/// fairness). Builds side shafts (outer wall + column), an optional
/// central shaft (column pair), perches at shaft tops, lateral ledges,
/// low launch ledges, and floor clutter — all sized to the wall-jump laws.
fn generateCandidate(state: *u32) Candidate {
    var cand = Candidate{};
    const mirrored = randFloat01(state) < 0.5;

    cand.addPlatform(ARENA_W / 2, ARENA_H - FLOOR_H / 2, ARENA_W, FLOOR_H, .floor);
    cand.addPlatform(WALL / 2, ARENA_H / 2, WALL, ARENA_H, .wall);
    cand.addPlatform(ARENA_W - WALL / 2, ARENA_H / 2, WALL, ARENA_H, .wall);
    cand.addPlatform(ARENA_W / 2, WALL / 2, ARENA_W, WALL, .ceiling);

    const colW = snap8(36 + randFloat01(state) * 12); // 36..48 -- thin towers keep it open

    // ── SIDE climb towers: each forms a wall-jump shaft with the outer wall.
    const leftColX = snap8(WALL + colW / 2 + 90 + randFloat01(state) * 64);
    const leftTop = pickF(state, &SIDE_TOWER_TOPS);
    addColumn(&cand, leftColX, colW, leftTop);
    addLedge(&cand, leftColX + colW / 2 + 78, 150, leftTop); // perch beside the tower

    const rightColX = if (mirrored)
        ARENA_W - leftColX
    else
        snap8(ARENA_W - WALL - colW / 2 - 90 - randFloat01(state) * 64);
    const rightTop = if (mirrored) leftTop else pickF(state, &SIDE_TOWER_TOPS);
    addColumn(&cand, rightColX, colW, rightTop);
    addLedge(&cand, rightColX - colW / 2 - 78, 150, rightTop);

    // ── CENTRAL climb tower + perch -- a mid anchor that also breaks the
    //    middle sightline. A bit shorter than the sides.
    const centerX = snap8(ARENA_W / 2 + (if (mirrored) @as(f64, 0) else (randFloat01(state) - 0.5) * 130));
    const cTop = pickF(state, &CENTER_TOWER_TOPS);
    addColumn(&cand, centerX, colW, cTop);
    addLedge(&cand, centerX, 160, cTop); // perch atop

    // ── Short COVER pillars in the wide floor gaps -- sightline + low climb pads.
    const coverLX = snap8((leftColX + centerX) / 2);
    const coverRX = if (mirrored) ARENA_W - coverLX else snap8((rightColX + centerX) / 2);
    addColumn(&cand, coverLX, colW, COVER_TOP);
    addColumn(&cand, coverRX, colW, COVER_TOP);

    // ── LEDGE BANDS: an open jungle-gym. Diagonal staircases climb inward
    //    from each side (the reachability spine), plus scattered lateral
    //    ledges so there's always somewhere to hop. Band COUNT (4-6) is
    //    randomized per candidate for real structural variety.
    const bandCount = pickU32(state, &BAND_COUNTS);
    const stairLX = snap8(230 + randFloat01(state) * 80);
    const step: f64 = 176; // horizontal march per band (crossable while rising)
    var b: u32 = 0;
    while (b < bandCount) : (b += 1) {
        const top = BANDS[b];
        const bf: f64 = @floatFromInt(b);
        const w = snap8(130 + randFloat01(state) * 64);
        addLedge(&cand, snap8(stairLX + bf * step), w, top);
        const rx = if (mirrored)
            ARENA_W - (stairLX + bf * step)
        else
            snap8(ARENA_W - stairLX - bf * step);
        addLedge(&cand, rx, w, top);
        // Middle scatter ledge every band -- more hop targets across the
        // whole climb, not just near the floor.
        const scatterX = snap8(ARENA_W / 2 + (randFloat01(state) - 0.5) * 340);
        addLedge(&cand, scatterX, snap8(120 + randFloat01(state) * 64), top);
        // A second scatter ledge, same height, offset close enough (<=280px,
        // well under MAX_GAP_FALLING) that level-hop reachability passes
        // trivially off the ledge we already know is reached.
        if (randFloat01(state) < 0.5) {
            const sign: f64 = if (randFloat01(state) < 0.5) -1.0 else 1.0;
            const offset = sign * (140 + randFloat01(state) * 120);
            addLedge(&cand, snap8(scatterX + offset), snap8(110 + randFloat01(state) * 54), top);
        }
    }

    // ── LOW CLUTTER: extra one-way ledges hugging the floor (rise 40-110px,
    //    always inside a single plain jump straight off the floor -- the
    //    floor spans the whole arena width so reachability is a trivial
    //    direct hop). Pure platform-count variety.
    const clutterCount: u32 = 2 + @as(u32, @intFromFloat(@floor(randFloat01(state) * 3.0)));
    var clutterXs: [4]f64 = undefined;
    var clutterN: usize = 0;
    var c: u32 = 0;
    while (c < clutterCount) : (c += 1) {
        var cx: f64 = 0;
        var ok = false;
        var tries: u32 = 0;
        while (tries < 8 and !ok) : (tries += 1) {
            cx = snap8(WALL + 140 + randFloat01(state) * (ARENA_W - 2 * WALL - 280));
            ok = floorClear(&cand, cx);
            if (ok) {
                var k: usize = 0;
                while (k < clutterN) : (k += 1) {
                    if (@abs(clutterXs[k] - cx) < 150) {
                        ok = false;
                        break;
                    }
                }
            }
        }
        if (!ok) continue; // couldn't find a clear slot -- skip rather than crowd
        clutterXs[clutterN] = cx;
        clutterN += 1;
        const top = FLOOR_TOP - (40 + randFloat01(state) * 70);
        addLedge(&cand, cx, snap8(90 + randFloat01(state) * 60), top);
    }

    // ── Spawns. CRITICAL: a floor spawn must NOT sit inside a solid column
    //    -- the body would spawn embedded and void-kill in an endless
    //    respawn loop. So floor spawns only land in OPEN lanes; perch tops
    //    are already clear.
    const floorY = FLOOR_TOP - 68;
    var floorPts: [32]Vec2 = undefined;
    var floorN: usize = 0;
    var x: f64 = WALL + 96;
    while (x <= ARENA_W - WALL - 96) : (x += 88) {
        if (floorClear(&cand, x) and floorN < floorPts.len) {
            floorPts[floorN] = .{ .x = snap8(x), .y = floorY };
            floorN += 1;
        }
    }

    const perchPts = [3]Vec2{
        .{ .x = leftColX + colW / 2 + 82, .y = leftTop - 68 },
        .{ .x = rightColX - colW / 2 - 82, .y = rightTop - 68 },
        .{ .x = centerX, .y = cTop - 68 },
    };

    // Order: perches first (arena is short, so perches only clear
    // MIN_SPAWN_DIST from floor points at a different x -- seeding them
    // first lets floor lanes stagger AROUND them), then floor extremes
    // (end-to-end 1v1 open), then middle floor lanes.
    var ordered: [40]Vec2 = undefined;
    var orderedN: usize = 0;
    for (perchPts) |p| {
        ordered[orderedN] = p;
        orderedN += 1;
    }
    if (floorN > 0) {
        ordered[orderedN] = floorPts[0];
        orderedN += 1;
        ordered[orderedN] = floorPts[floorN - 1];
        orderedN += 1;
    }
    var fi: usize = 1;
    while (fi + 1 < floorN) : (fi += 1) {
        ordered[orderedN] = floorPts[fi];
        orderedN += 1;
    }

    const SPAWN_TARGET: usize = 8;
    var i: usize = 0;
    while (i < orderedN and cand.spawn_count < SPAWN_TARGET) : (i += 1) {
        const cp = ordered[i];
        var farEnough = true;
        var j: usize = 0;
        while (j < cand.spawn_count) : (j += 1) {
            const sp = cand.spawns[j];
            const dx = sp.x - cp.x;
            const dy = sp.y - cp.y;
            if (@sqrt(dx * dx + dy * dy) < MIN_SPAWN_DIST) {
                farEnough = false;
                break;
            }
        }
        if (farEnough) {
            cand.spawns[cand.spawn_count] = cp;
            cand.spawn_count += 1;
        }
    }

    // themes: 0=jadeIsles, 1=ivoryClouds, 2=hangingWood (see maps.ts ArenaTheme)
    cand.theme_id = @intFromFloat(@floor(randFloat01(state) * 3.0));

    return cand;
}

// ── Validation (the laws) ────────────────────────────────────────────────

const Top = struct { x0: f64, x1: f64, top: f64 };
const Solid = struct { x0: f64, x1: f64, top: f64, cx: f64 };

/// Platform TOPS you can stand on: floor + all structures (excludes the
/// ceiling and the outer side walls). Floor is ALWAYS index 0 -- it's
/// always platforms[0] by construction and is never filtered out.
fn collectTops(cand: *const Candidate, out: *[MAX_GEN_PLATFORMS]Top) usize {
    var n: usize = 0;
    var i: usize = 0;
    while (i < cand.platform_count) : (i += 1) {
        const p = cand.platforms[i];
        if (p.kind == .wall or p.kind == .ceiling) continue;
        out[n] = .{ .x0 = p.cx - p.w / 2, .x1 = p.cx + p.w / 2, .top = p.cy - p.h / 2 };
        n += 1;
    }
    return n;
}

/// SOLID grab walls: the outer side walls (full height) plus any
/// structure tall enough to be solid 4-way (a column).
fn collectGrabWalls(cand: *const Candidate, out: *[MAX_GEN_PLATFORMS]Solid) usize {
    var n: usize = 0;
    var i: usize = 0;
    while (i < cand.platform_count) : (i += 1) {
        const p = cand.platforms[i];
        if (p.kind == .floor or p.kind == .ceiling) continue;
        const isOuterWall = p.kind == .wall;
        const isColumn = p.kind == .structure and p.h >= GRAB_MIN_H;
        if (!isOuterWall and !isColumn) continue;
        out[n] = .{ .x0 = p.cx - p.w / 2, .x1 = p.cx + p.w / 2, .top = p.cy - p.h / 2, .cx = p.cx };
        n += 1;
    }
    return n;
}

fn gapBetween(a_x0: f64, a_x1: f64, b_x0: f64, b_x1: f64) f64 {
    if (b_x0 > a_x1) return b_x0 - a_x1;
    if (a_x0 > b_x1) return a_x0 - b_x1;
    return 0;
}

/// Route-graph reachability: seed with the floor + everything reachable
/// by climbing a shaft, then BFS out over jump-sized edges. Returns the
/// count of tops that remain unreachable (0 == fully connected).
fn unreachableCount(cand: *const Candidate) usize {
    var topsBuf: [MAX_GEN_PLATFORMS]Top = undefined;
    const n = collectTops(cand, &topsBuf);
    if (n == 0) return 1; // no floor -- shouldn't happen

    var wallsBuf: [MAX_GEN_PLATFORMS]Solid = undefined;
    const wn = collectGrabWalls(cand, &wallsBuf);

    var reached: [MAX_GEN_PLATFORMS]bool = [_]bool{false} ** MAX_GEN_PLATFORMS;
    reached[0] = true; // floor -- always platforms[0], always tops[0]

    // Shaft reachability: two grab walls facing within SHAFT_MAX form a
    // climbable shaft; a final wall-jump hop reaches WALL_JUMP_UP above
    // the shorter wall's top and GRAB_REACH_SIDE to the side.
    var i: usize = 0;
    while (i < wn) : (i += 1) {
        var j: usize = i + 1;
        while (j < wn) : (j += 1) {
            const a = wallsBuf[i];
            const wb = wallsBuf[j];
            const gap = gapBetween(a.x0, a.x1, wb.x0, wb.x1);
            if (gap <= 0 or gap > SHAFT_MAX) continue;
            const yClimb = @max(a.top, wb.top);
            const reachTop = yClimb - WALL_JUMP_UP;
            const xLo = @min(a.x0, wb.x0) - GRAB_REACH_SIDE;
            const xHi = @max(a.x1, wb.x1) + GRAB_REACH_SIDE;
            var k: usize = 1; // skip floor (index 0)
            while (k < n) : (k += 1) {
                const cx = (topsBuf[k].x0 + topsBuf[k].x1) / 2;
                if (cx >= xLo and cx <= xHi and topsBuf[k].top >= reachTop and topsBuf[k].top <= FLOOR_TOP) {
                    reached[k] = true;
                }
            }
        }
    }

    // BFS growth over jump edges.
    var grew = true;
    while (grew) {
        grew = false;
        var from: usize = 0;
        while (from < n) : (from += 1) {
            if (!reached[from]) continue;
            var to: usize = 0;
            while (to < n) : (to += 1) {
                if (reached[to]) continue;
                const rise = topsBuf[from].top - topsBuf[to].top; // positive = going UP
                const gap = gapBetween(topsBuf[from].x0, topsBuf[from].x1, topsBuf[to].x0, topsBuf[to].x1);
                const ok = if (rise > 0)
                    rise <= MAX_STEP_RISE and gap <= maxGapForRise(rise)
                else
                    gap <= MAX_GAP_FALLING;
                if (ok) {
                    reached[to] = true;
                    grew = true;
                }
            }
        }
    }

    var unreached: usize = 0;
    var t: usize = 0;
    while (t < n) : (t += 1) {
        if (!reached[t]) unreached += 1;
    }
    return unreached;
}

/// Distinct routes UP from the floor: a plain jump onto a ledge, OR a
/// shaft you can climb. Both count -- the wall kit is a first-class route.
fn routesUpCount(cand: *const Candidate) u32 {
    var topsBuf: [MAX_GEN_PLATFORMS]Top = undefined;
    const n = collectTops(cand, &topsBuf);
    const floorTop = topsBuf[0].top;
    var jumpRoutes: u32 = 0;
    var i: usize = 1; // skip floor itself
    while (i < n) : (i += 1) {
        const rise = floorTop - topsBuf[i].top;
        if (rise > 0 and rise <= MAX_STEP_RISE) jumpRoutes += 1;
    }

    var wallsBuf: [MAX_GEN_PLATFORMS]Solid = undefined;
    const wn = collectGrabWalls(cand, &wallsBuf);
    var shaftRoutes: u32 = 0;
    var a: usize = 0;
    while (a < wn) : (a += 1) {
        var b: usize = a + 1;
        while (b < wn) : (b += 1) {
            const gap = gapBetween(wallsBuf[a].x0, wallsBuf[a].x1, wallsBuf[b].x0, wallsBuf[b].x1);
            if (gap > 0 and gap <= SHAFT_MAX) shaftRoutes += 1;
        }
    }
    return jumpRoutes + shaftRoutes;
}

/// Longest unbroken sightline in the floor lane, broken by structures
/// intersecting shoulder height.
fn worstSightline(cand: *const Candidate) f64 {
    const bandY = FLOOR_TOP - 28;
    var blockers: [MAX_GEN_PLATFORMS]struct { x0: f64, x1: f64 } = undefined;
    var bn: usize = 0;
    var i: usize = 0;
    while (i < cand.platform_count) : (i += 1) {
        const p = cand.platforms[i];
        if (p.kind != .structure) continue;
        const y0 = p.cy - p.h / 2;
        const y1 = p.cy + p.h / 2;
        if (bandY >= y0 and bandY <= y1) {
            blockers[bn] = .{ .x0 = p.cx - p.w / 2, .x1 = p.cx + p.w / 2 };
            bn += 1;
        }
    }
    // Insertion sort by x0 -- bn is small (<= MAX_GEN_PLATFORMS).
    var s: usize = 1;
    while (s < bn) : (s += 1) {
        const key = blockers[s];
        var k: usize = s;
        while (k > 0 and blockers[k - 1].x0 > key.x0) : (k -= 1) {
            blockers[k] = blockers[k - 1];
        }
        blockers[k] = key;
    }
    var worst: f64 = 0;
    var cursor: f64 = WALL;
    var j: usize = 0;
    while (j < bn) : (j += 1) {
        worst = @max(worst, blockers[j].x0 - cursor);
        cursor = @max(cursor, blockers[j].x1);
    }
    return @max(worst, ARENA_W - WALL - cursor);
}

fn density(cand: *const Candidate) f64 {
    var area: f64 = 0;
    var i: usize = 0;
    while (i < cand.platform_count) : (i += 1) {
        const p = cand.platforms[i];
        if (p.kind == .structure) area += p.w * p.h;
    }
    const playable = (ARENA_W - 2 * WALL) * (ARENA_H - FLOOR_H - WALL);
    return area / playable;
}

/// Half the player body (26w x 56h) + a small margin -- a spawn this close
/// to a solid column embeds the body and the resolver ejects it out of
/// the map.
const SPAWN_HALF_W: f64 = 13 + 6;
const SPAWN_HALF_H: f64 = 28 + 6;

fn spawnsValid(cand: *const Candidate) bool {
    var topsBuf: [MAX_GEN_PLATFORMS]Top = undefined;
    const n = collectTops(cand, &topsBuf);
    var wallsBuf: [MAX_GEN_PLATFORMS]Solid = undefined;
    const wn = collectGrabWalls(cand, &wallsBuf);

    var i: usize = 0;
    while (i < cand.spawn_count) : (i += 1) {
        const s = cand.spawns[i];
        var under = false;
        var t: usize = 0;
        while (t < n) : (t += 1) {
            const tp = topsBuf[t];
            if (s.x >= tp.x0 - 8 and s.x <= tp.x1 + 8 and tp.top >= s.y and tp.top - s.y < 200) {
                under = true;
                break;
            }
        }
        if (!under) return false;

        // No spawn embedded in a solid COLUMN (the outer frame walls are
        // excluded -- only interior columns can embed a body).
        var w: usize = 0;
        while (w < wn) : (w += 1) {
            const wl = wallsBuf[w];
            if (!(wl.cx > WALL and wl.cx < ARENA_W - WALL)) continue;
            const overlapsX = s.x + SPAWN_HALF_W > wl.x0 and s.x - SPAWN_HALF_W < wl.x1;
            const overlapsY = s.y > wl.top and s.y - 2 * SPAWN_HALF_H < FLOOR_TOP;
            if (overlapsX and overlapsY) return false;
        }

        var j: usize = i + 1;
        while (j < cand.spawn_count) : (j += 1) {
            const o = cand.spawns[j];
            const dx = s.x - o.x;
            const dy = s.y - o.y;
            if (@sqrt(dx * dx + dy * dy) < MIN_SPAWN_DIST) return false;
        }
    }
    // The stated law is >=4 well-separated spawns -- match it in the
    // gate, not only in the generation heuristics.
    return cand.spawn_count >= 4;
}

const Validation = struct {
    ok: bool,
    unreachable_count: usize,
    routes_up: u32,
    sightline: f64,
    density: f64,
    spawns_ok: bool,
};

fn validate(cand: *const Candidate) Validation {
    const unreached = unreachableCount(cand);
    const routes = routesUpCount(cand);
    const sight = worstSightline(cand);
    const dens = density(cand);
    const spawnsOk = spawnsValid(cand);
    return .{
        .ok = unreached == 0 and routes >= 2 and sight <= MAX_SIGHTLINE and
            dens >= DENSITY_MIN and dens <= DENSITY_MAX and spawnsOk,
        .unreachable_count = unreached,
        .routes_up = routes,
        .sightline = sight,
        .density = dens,
        .spawns_ok = spawnsOk,
    };
}

// ── Public entry ─────────────────────────────────────────────────────────

const MAX_ATTEMPTS: u32 = 60;
const FALLBACK_ATTEMPTS: u32 = 256;

/// Deterministically produce a VALID arena for a seed. Invalid candidates
/// advance the attempt counter (seeded), so (seed -> arena) is a pure
/// function -- identical on every host running this wasm binary.
pub fn generateArena(seed: u32) Candidate {
    var attempt: u32 = 0;
    while (attempt < MAX_ATTEMPTS) : (attempt += 1) {
        const prod: u64 = @as(u64, attempt) *% 0x9e3779b9;
        var state: u32 = seed ^ @as(u32, @truncate(prod));
        const cand = generateCandidate(&state);
        if (validate(&cand).ok) return cand;
    }
    // Statistically unreachable (every real seed validates well within
    // MAX_ATTEMPTS). But NEVER ship an unvalidated arena -- a future
    // constant change could make some fixed fallback invalid too. Scan a
    // deterministic fallback ladder and return the first that validates.
    var f: u32 = 0;
    while (f < FALLBACK_ATTEMPTS) : (f += 1) {
        const prod: u64 = @as(u64, f) *% 0x9e3779b9;
        var state: u32 = 0xfa11bacc +% @as(u32, @truncate(prod));
        const cand = generateCandidate(&state);
        if (validate(&cand).ok) return cand;
    }
    // Truly unreachable -- if even 256 fallback seeds fail, the laws are
    // self-contradictory (a build bug). Trap loudly rather than ship junk.
    @panic("map_gen: no valid arena found -- validator laws are unsatisfiable");
}

/// Host-visible arena metadata that doesn't fit `WorldState.statics[]`:
/// spawn points, arena size, and the cosmetic theme pick. Layout is
/// `extern struct` -- the wasm boundary contract, same discipline as
/// `WorldState` itself.
pub const GeneratedArenaMeta = extern struct {
    spawn_count: u32,
    theme_id: u32,
    arena_w: f64,
    arena_h: f64,
    spawn_x: [MAX_GEN_SPAWNS]f64,
    spawn_y: [MAX_GEN_SPAWNS]f64,
};

comptime {
    if (@sizeOf(GeneratedArenaMeta) > 256) {
        @compileError("GeneratedArenaMeta grew unexpectedly large");
    }
}

/// Generate a validated arena for `seed`, write its platform AABBs
/// directly into `state_ptr.statics[]` / `.one_way[]` / `.static_count`
/// (the SAME fields `world_state_set_statics` populates -- collision.zig,
/// player.zig, and projectile.zig read them identically either way), and
/// write spawns + arena size + theme into `meta_ptr` for the host to
/// build a renderable/pickable map shape. Hosts call this once per match
/// (after the map loads), exactly like `world_state_set_statics`.
///
/// Returns the platform count actually written (clamped at MAX_STATICS).
pub export fn world_state_generate_arena(
    state_ptr: *world_state.WorldState,
    seed: u32,
    meta_ptr: *GeneratedArenaMeta,
) u32 {
    const cand = generateArena(seed);

    const clampedCount = @min(cand.platform_count, world_state.MAX_STATICS);
    const clamped: u32 = @intCast(clampedCount);
    var i: u32 = 0;
    while (i < clamped) : (i += 1) {
        const p = cand.platforms[i];
        state_ptr.statics[i] = collision.AABB{
            .x = p.cx - p.w / 2,
            .y = p.cy - p.h / 2,
            .w = p.w,
            .h = p.h,
        };
        state_ptr.one_way[i] = if (p.kind == .structure and p.h <= ONE_WAY_MAX_HEIGHT) 1 else 0;
    }
    state_ptr.static_count = clamped;

    meta_ptr.spawn_count = @intCast(cand.spawn_count);
    meta_ptr.theme_id = cand.theme_id;
    meta_ptr.arena_w = ARENA_W;
    meta_ptr.arena_h = ARENA_H;
    var s: usize = 0;
    while (s < cand.spawn_count) : (s += 1) {
        meta_ptr.spawn_x[s] = cand.spawns[s].x;
        meta_ptr.spawn_y[s] = cand.spawns[s].y;
    }

    return clamped;
}

// ── Tests ────────────────────────────────────────────────────────────────

const testing = std.testing;

test "same seed twice -> identical geometry" {
    const seeds = [_]u32{ 0, 1, 7, 1234, 999999 };
    for (seeds) |seed| {
        const a = generateArena(seed);
        const b = generateArena(seed);
        try testing.expectEqual(a.platform_count, b.platform_count);
        var i: usize = 0;
        while (i < a.platform_count) : (i += 1) {
            try testing.expectEqual(a.platforms[i].cx, b.platforms[i].cx);
            try testing.expectEqual(a.platforms[i].cy, b.platforms[i].cy);
            try testing.expectEqual(a.platforms[i].w, b.platforms[i].w);
            try testing.expectEqual(a.platforms[i].h, b.platforms[i].h);
            try testing.expectEqual(a.platforms[i].kind, b.platforms[i].kind);
        }
        try testing.expectEqual(a.spawn_count, b.spawn_count);
        var j: usize = 0;
        while (j < a.spawn_count) : (j += 1) {
            try testing.expectEqual(a.spawns[j].x, b.spawns[j].x);
            try testing.expectEqual(a.spawns[j].y, b.spawns[j].y);
        }
    }
}

test "60 seeds: all valid" {
    var seed: u32 = 0;
    while (seed < 60) : (seed += 1) {
        const cand = generateArena(seed);
        const v = validate(&cand);
        try testing.expect(v.ok);
    }
}

test "60 seeds: generous well-separated spawns" {
    var seed: u32 = 0;
    while (seed < 60) : (seed += 1) {
        const cand = generateArena(seed);
        try testing.expect(cand.spawn_count >= 4);
        var i: usize = 0;
        while (i < cand.spawn_count) : (i += 1) {
            var j: usize = i + 1;
            while (j < cand.spawn_count) : (j += 1) {
                const a = cand.spawns[i];
                const b = cand.spawns[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                try testing.expect(@sqrt(dx * dx + dy * dy) >= MIN_SPAWN_DIST);
            }
        }
    }
}

test "60 seeds: platform count stays within headroom" {
    var seed: u32 = 0;
    while (seed < 60) : (seed += 1) {
        const cand = generateArena(seed);
        try testing.expect(cand.platform_count <= MAX_GEN_PLATFORMS);
        try testing.expect(cand.platform_count > 4); // frame is not the whole arena
    }
}

test "world_state_generate_arena writes statics and meta" {
    var state: world_state.WorldState = std.mem.zeroes(world_state.WorldState);
    var meta: GeneratedArenaMeta = std.mem.zeroes(GeneratedArenaMeta);
    const written = world_state_generate_arena(&state, 42, &meta);
    try testing.expect(written > 4);
    try testing.expectEqual(written, state.static_count);
    try testing.expect(meta.spawn_count >= 4);
    try testing.expectEqual(@as(f64, ARENA_W), meta.arena_w);
    try testing.expectEqual(@as(f64, ARENA_H), meta.arena_h);
}
