const std = @import("std");
const root = @import("sim_root");

test "step increments the counter byte" {
    root.reset();
    const ptr = root.alloc_state();
    const size = root.state_size();
    root.step(ptr, size, ptr, 0, 16);
    root.step(ptr, size, ptr, 0, 16);
    root.step(ptr, size, ptr, 0, 16);
    try std.testing.expectEqual(@as(u32, 3), root.current_tick());

    const counter: *u32 = @ptrCast(@alignCast(ptr));
    try std.testing.expectEqual(@as(u32, 3), counter.*);
}

test "state_size is non-zero" {
    try std.testing.expect(root.state_size() > 0);
}

test "reset zeroes the counter" {
    const ptr = root.alloc_state();
    const size = root.state_size();
    root.step(ptr, size, ptr, 0, 16);
    root.reset();
    try std.testing.expectEqual(@as(u32, 0), root.current_tick());
}

test "rng nextU32 is deterministic given same seed" {
    var a: u32 = 1234567;
    var b: u32 = 1234567;
    for (0..100) |_| {
        a = root.rng.nextU32(a);
        b = root.rng.nextU32(b);
        try std.testing.expectEqual(a, b);
    }
}

test "rng nextU32 self-consistency over 1000 steps" {
    // Same seed must produce same final state regardless of how many
    // intermediate states we observe.
    var quiet: u32 = 42;
    for (0..1000) |_| quiet = root.rng.nextU32(quiet);

    var observed: u32 = 42;
    for (0..1000) |i| {
        observed = root.rng.nextU32(observed);
        if (i == 999) {
            try std.testing.expectEqual(quiet, observed);
        }
    }
}

test "rng nextU32 from seed 0 is non-zero" {
    // Catches the "RNG didn't actually run" class of bug.
    try std.testing.expect(root.rng.nextU32(0) != 0);
}

// ── map_gen (docs/map-design.md laws, ported from mapGen.test.ts) ────────

test "map_gen: same seed twice -> identical geometry" {
    const seeds = [_]u32{ 0, 1, 7, 1234, 999999 };
    for (seeds) |seed| {
        const a = root.map_gen.generateArena(seed);
        const b = root.map_gen.generateArena(seed);
        try std.testing.expectEqual(a.platform_count, b.platform_count);
        var i: usize = 0;
        while (i < a.platform_count) : (i += 1) {
            try std.testing.expectEqual(a.platforms[i].cx, b.platforms[i].cx);
            try std.testing.expectEqual(a.platforms[i].cy, b.platforms[i].cy);
            try std.testing.expectEqual(a.platforms[i].w, b.platforms[i].w);
            try std.testing.expectEqual(a.platforms[i].h, b.platforms[i].h);
            try std.testing.expectEqual(a.platforms[i].kind, b.platforms[i].kind);
        }
        try std.testing.expectEqual(a.spawn_count, b.spawn_count);
        var j: usize = 0;
        while (j < a.spawn_count) : (j += 1) {
            try std.testing.expectEqual(a.spawns[j].x, b.spawns[j].x);
            try std.testing.expectEqual(a.spawns[j].y, b.spawns[j].y);
        }
    }
}

test "map_gen: 60 seeds all pass the route-graph validator" {
    var seed: u32 = 0;
    while (seed < 60) : (seed += 1) {
        const cand = root.map_gen.generateArena(seed);
        const v = root.map_gen.validate(&cand);
        try std.testing.expect(v.ok);
    }
}

test "map_gen: 60 seeds have generous well-separated spawns" {
    var seed: u32 = 0;
    while (seed < 60) : (seed += 1) {
        const cand = root.map_gen.generateArena(seed);
        try std.testing.expect(cand.spawn_count >= 4);
        var i: usize = 0;
        while (i < cand.spawn_count) : (i += 1) {
            var j: usize = i + 1;
            while (j < cand.spawn_count) : (j += 1) {
                const a = cand.spawns[i];
                const b = cand.spawns[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                try std.testing.expect(@sqrt(dx * dx + dy * dy) >= root.map_gen.MIN_SPAWN_DIST);
            }
        }
    }
}

test "map_gen: 60 seeds stay within the platform headroom" {
    var seed: u32 = 0;
    while (seed < 60) : (seed += 1) {
        const cand = root.map_gen.generateArena(seed);
        try std.testing.expect(cand.platform_count <= root.map_gen.MAX_GEN_PLATFORMS);
        try std.testing.expect(cand.platform_count > 4); // frame alone is not the whole arena
    }
}

test "map_gen: world_state_generate_arena writes statics and meta" {
    var state: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    var meta: root.map_gen.GeneratedArenaMeta = std.mem.zeroes(root.map_gen.GeneratedArenaMeta);
    const written = root.map_gen.world_state_generate_arena(&state, 42, &meta);
    try std.testing.expect(written > 4);
    try std.testing.expectEqual(written, state.static_count);
    try std.testing.expect(meta.spawn_count >= 4);
    try std.testing.expect(meta.arena_w > 0);
    try std.testing.expect(meta.arena_h > 0);
}

// ── true slopes (player.zig foot-point grounding — 2026-07-17) ───────────

test "slopes: tangent literals carry the pinned f64 bit patterns" {
    // The parity constants are hand-written f64 literals (defined
    // byte-identically in collision.ts — same decimal text, same parse).
    // Pin the exact bit patterns so a typo'd literal can never ship.
    // (A live-sqrt cross-check is deliberately NOT used: 1/@sqrt(x)
    // double-rounds and can land one ulp off the correctly-rounded
    // decimal literal — the LITERAL is the parity contract.)
    try std.testing.expectEqual(
        @as(u64, 0x3FDC9F25C5BFEDD9),
        @as(u64, @bitCast(root.player.INV_SQRT5)),
    );
    try std.testing.expectEqual(
        @as(u64, 0x3FEC9F25C5BFEDD9),
        @as(u64, @bitCast(root.player.TWO_INV_SQRT5)),
    );
    try std.testing.expectEqual(
        @as(u64, 0x3FE6A09E667F3BCD),
        @as(u64, @bitCast(root.player.INV_SQRT2)),
    );
    // Each tangent is unit-length within one ulp of 1.0.
    const l21 = root.player.TWO_INV_SQRT5 * root.player.TWO_INV_SQRT5 +
        root.player.INV_SQRT5 * root.player.INV_SQRT5;
    const l11 = root.player.INV_SQRT2 * root.player.INV_SQRT2 * 2.0;
    try std.testing.expect(@abs(l21 - 1.0) < 1e-15);
    try std.testing.expect(@abs(l11 - 1.0) < 1e-15);
}

test "slopes: run up a 2:1 grounds every tick and converts speed to climb" {
    // Flat floor y=600 (top), a dir=+1 2:1 slope from (400, 600) run 200
    // (crest at x=600, y=500). Run right from the flat: the player must
    // ground onto the slope, climb, and carry tangent velocity (vy < 0)
    // while grounded — magnitude-preserving projection, no jump.
    const statics = [_]root.collision.AABB{
        .{ .x = 0, .y = 600, .w = 1280, .h = 40 },
    };
    const one_way = [_]u8{0};
    root.player.setSlopesForTest(&.{.{
        .span_min_x = 400,
        .span_max_x = 600,
        .base_x = 400,
        .base_y = 600,
        .dy_dx = -0.5,
        .tx = root.player.TWO_INV_SQRT5,
        .ty = -root.player.INV_SQRT5,
    }});
    defer root.player.setSlopesForTest(&.{});

    var s = std.mem.zeroes(root.player.PlayerStep);
    s.x = 200;
    s.y = 600 - 28; // standing on the floor
    s.jump_mul = 1.0;
    s.wall_jump_mul = 1.0;
    s.wall_slide_mul = 1.0;
    s.dash_cooldown_mul = 1.0;
    s.grounded_last_frame = 1;

    const right: u32 = 1 << 1;
    var prev: u32 = 0;
    var t: u32 = 0;
    var climbed = false;
    while (t < 120) : (t += 1) {
        _ = root.player.stepPlayer(&s, prev, right, s.x + 100, s.y, 1.0, 1.0, 1000.0 / 60.0, &statics, &one_way);
        prev = right;
        if (s.x > 420 and s.x < 590) {
            // On the slope span: must be grounded ON the surface (foot within
            // the snap band) with an upward tangent component.
            const foot = s.y + 28.0;
            const sy = 600.0 + (-0.5) * (s.x - 400.0);
            try std.testing.expect(@abs(foot - sy) <= 8.0);
            try std.testing.expect(s.grounded_last_frame == 1);
            if (s.vy < -100.0) climbed = true;
        }
        if (s.x >= 640) break;
    }
    try std.testing.expect(climbed);
    // Crest launch: the tangent velocity carries ballistically past the top.
    try std.testing.expect(s.x >= 600.0);
}

test "slopes: one-way — a jump from below never grounds through the surface" {
    // Floor at y=600; a 1:1 dir=+1 slope hanging overhead: base (300, 480),
    // run 150 (surface 480→330). Player stands UNDER it and jumps straight
    // up through the surface band — must never ground on it while rising.
    const statics = [_]root.collision.AABB{
        .{ .x = 0, .y = 600, .w = 1280, .h = 40 },
    };
    const one_way = [_]u8{0};
    root.player.setSlopesForTest(&.{.{
        .span_min_x = 300,
        .span_max_x = 450,
        .base_x = 300,
        .base_y = 500,
        .dy_dx = -1.0,
        .tx = root.player.INV_SQRT2,
        .ty = -root.player.INV_SQRT2,
    }});
    defer root.player.setSlopesForTest(&.{});

    var s = std.mem.zeroes(root.player.PlayerStep);
    s.x = 320; // surface overhead at y = 500 - 20 = 480 (jump apex ~134 reaches 466)
    s.y = 600 - 28;
    s.jump_mul = 1.0;
    s.wall_jump_mul = 1.0;
    s.wall_slide_mul = 1.0;
    s.dash_cooldown_mul = 1.0;
    s.grounded_last_frame = 1;

    const jump: u32 = 1 << 4;
    var prev: u32 = 0;
    var t: u32 = 0;
    var min_foot: f64 = 1e9;
    while (t < 40) : (t += 1) {
        const keys: u32 = if (t == 0) jump else jump; // held jump
        _ = root.player.stepPlayer(&s, prev, keys, s.x, s.y - 100, 1.0, 1.0, 1000.0 / 60.0, &statics, &one_way);
        prev = keys;
        const foot = s.y + 28.0;
        if (foot < min_foot) min_foot = foot;
        if (s.vy < 0.0) {
            // While RISING the pass must never ground us onto the slope.
            const sy = 500.0 + (-1.0) * (s.x - 300.0);
            if (@abs(foot - sy) <= 8.0) {
                try std.testing.expect(s.grounded_last_frame == 0);
            }
        }
    }
    // Jump apex (~134px) genuinely crossed the overhead surface band (480).
    try std.testing.expect(min_foot < 480.0 - 8.0);
}

// ── Wizard basic-fire ramping channel (2026-07-20 gap-closure pass item 2,
//    parity port of weapon.ts:243-257/330-334, constants.ts's
//    GEO_CHANNEL_RAMP_MS/GEO_CHANNEL_RAMP_FIRE_RATE_MULTIPLIER_MAX) ────────

fn freshFightingState() root.world_state.WorldState {
    var state: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    state.header.round_phase = @intFromEnum(root.round.RoundPhase.fighting);
    // Large window so the round-phase machine never transitions mid-test —
    // isolates the assertions below from round.zig's own timing.
    state.header.countdown_remaining_ms = 90_000.0;
    return state;
}

const FIRE_BIT: u32 = 1 << 6;

test "channel ramp: wizard accrues channel_hold_ms while holding Fire, and it composes into the fire-rate cooldown on the same tick a shot fires" {
    var state = freshFightingState();
    state.player_count = 1;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced; // balanced -> "wizard" (cardTypes.ts ARCHETYPE_CLASS_ID)
    state.players[0].current_keys = FIRE_BIT;
    state.players[0].health = 100;

    // dt == GEO_CHANNEL_RAMP_MS so channel_hold_ms hits the ramp ceiling
    // in a single tick. fire_cooldown_ms starts at 0 (zeroed state), so
    // this SAME tick's weapon_tick_fire_with_keys call fires immediately
    // — reading this tick's just-accrued hold duration, matching
    // weapon.ts's "tracked before the early return" ordering note.
    _ = root.world.stepWorld(&state, 2000.0);

    try std.testing.expectEqual(@as(f64, 2000.0), state.players[0].channel_hold_ms);

    // starter pistol fire_rate (4.0/s) × ramp ceiling (1.6x) = 6.4/s ->
    // cooldown = 1000/6.4 = 156.25ms. (weapon.cooldownFromFireRate's floor
    // arg is 1.0 at this call site, not MIN_FIRE_RATE — pre-existing,
    // unrelated to this pass, not asserted here.)
    const starter_fire_rate = root.weapons.weaponBaseById(.starter_pistol).fire_rate;
    const expected_cd = 1000.0 / (starter_fire_rate * 1.6);
    try std.testing.expect(@abs(state.players[0].fire_cooldown_ms - expected_cd) < 1e-9);

    // Release Fire: channel_hold_ms drops back to 0 on the very next tick.
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 16.0);
    try std.testing.expectEqual(@as(f64, 0.0), state.players[0].channel_hold_ms);
}

test "channel ramp: non-wizard chassis never accrues channel_hold_ms even while holding Fire" {
    var state = freshFightingState();
    state.player_count = 1;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy; // "paladin", not wizard
    state.players[0].current_keys = FIRE_BIT;
    state.players[0].health = 100;

    var t: u32 = 0;
    while (t < 10) : (t += 1) {
        _ = root.world.stepWorld(&state, 200.0);
    }
    try std.testing.expectEqual(@as(f64, 0.0), state.players[0].channel_hold_ms);
}

test "haste_multiplier composes into the fire-rate cooldown (2026-07-20 fix — was already on PlayerEntity but unread at this call site)" {
    var state = freshFightingState();
    state.player_count = 1;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded; // "priest" — not wizard, isolates haste from channel ramp
    state.players[0].current_keys = FIRE_BIT;
    state.players[0].health = 100;
    state.players[0].flags.has_haste = true;
    state.players[0].haste_until_tick = 1000; // far beyond this test's single tick
    state.players[0].haste_multiplier = 2.0;

    _ = root.world.stepWorld(&state, 16.0); // tick becomes 1, well under haste_until_tick

    const starter_fire_rate = root.weapons.weaponBaseById(.starter_pistol).fire_rate;
    const expected_cd = 1000.0 / (starter_fire_rate * 2.0);
    try std.testing.expect(@abs(state.players[0].fire_cooldown_ms - expected_cd) < 1e-9);
}

// ── Paper Double (2026-07-20 gap-closure pass item 3, parity port of
//    client/src/sim/paperDouble.ts) ─────────────────────────────────────

test "paper double: straight-line movement + lifetime countdown, compacted once remaining_ms expires" {
    var state = freshFightingState();
    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 0,
        .y = 0,
        .vx = 100, // px/s
        .vy = 0,
        .health = 20,
        .remaining_ms = 250,
        .id = 1,
        .owner_id_len = 0,
    };

    _ = root.world.stepWorld(&state, 100.0);
    try std.testing.expectEqual(@as(u32, 1), state.paper_double_count);
    try std.testing.expect(@abs(state.paper_doubles[0].x - 10.0) < 1e-9);
    try std.testing.expect(@abs(state.paper_doubles[0].remaining_ms - 150.0) < 1e-9);

    _ = root.world.stepWorld(&state, 100.0);
    try std.testing.expectEqual(@as(u32, 1), state.paper_double_count);
    try std.testing.expect(@abs(state.paper_doubles[0].x - 20.0) < 1e-9);
    try std.testing.expect(@abs(state.paper_doubles[0].remaining_ms - 50.0) < 1e-9);

    // This tick's tick-down takes remaining_ms to -50 (50 - 100); the
    // end-of-tick compaction pass removes it (remaining_ms > 0 fails).
    _ = root.world.stepWorld(&state, 100.0);
    try std.testing.expectEqual(@as(u32, 0), state.paper_double_count);
}

test "paper double: SWEPT collision catches a fast projectile that tunnels past in one tick (2026-07-20 regression guard — point-in-time missed this exact shape)" {
    var state = freshFightingState();
    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 500,
        .y = 300,
        .vx = 0,
        .vy = 0,
        .health = 20,
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = 0,
    };
    // Decoy body AABB (PAPER_DOUBLE_BODY_HALF_W=13, _HALF_H=28): x in
    // [487, 513], y in [272, 328].
    const target_aabb: root.collision.AABB = .{ .x = 487, .y = 272, .w = 26, .h = 56 };

    state.projectile_count = 1;
    // Section 3 (projectile pre-step/motion) runs BEFORE section 4's
    // collision loop and already advances .straight pathing by vx*dt_sec
    // — so the position that section 4 actually sees is this tick's END
    // position, not the value written here. Start at 472 (clear of the
    // decoy's left edge-radius at 483) so that after section 3 moves it
    // by 3000px/s * 0.016s = 48px it lands at 520 (clear of the right
    // edge+radius at 517) — a single-tick pass straight through the box
    // with NEITHER the start nor the end position inside it. Section 4's
    // decoy loop reconstructs the pre-motion position as
    // `current_x - vx*dt_sec` = 520 - 48 = 472, matching this start value
    // exactly (single straight-line integration, no terrain deflection).
    state.projectiles[0] = .{
        .x = 472,
        .y = 300,
        .vx = 3000, // px/s
        .vy = 0,
        .radius = 4,
        .damage = 15,
        .lifetime_ms = 1000,
        .age_ms = 0,
        .traveled_px = 0,
        .origin_x = 472,
        .origin_y = 300,
        .homing_strength = 0,
        .acceleration_multiplier = 0,
        .gravity_scale = 0,
        .range_px = 0,
        .slow_multiplier = 1.0,
        .sticky_fuse_ms = 0,
        .impact_radius_px = 0,
        .id = 9,
        .bounces_remaining = 0,
        .pierce_remaining = 0,
        .split_count = 0,
        .flags = .{
            .has_owner = false,
            .has_impact = false,
            .has_split = false,
            .has_slow = false,
            .has_homing = false,
            .has_acceleration = false,
            .has_gravity_scale = false,
            .has_range = false,
            .has_age = false,
            .has_traveled = false,
            .has_origin = false,
            .returning = false,
            .has_sticky_fuse = false,
            .has_impact_radius = false,
        },
        .pathing = .straight,
        .element = .neutral,
        .impact = .none,
        .shape = .circle,
        .owner_id_len = 0,
    };

    // Concretely prove a point-in-time check at EITHER endpoint alone
    // would have missed this hit (the exact tunneling shape paperDouble.ts
    // was fixed for on 2026-07-20) — the regression this test guards.
    try std.testing.expect(!root.collision.circleOverlapsAABB(520, 300, 4, target_aabb));
    try std.testing.expect(!root.collision.circleOverlapsAABB(472, 300, 4, target_aabb));

    _ = root.world.stepWorld(&state, 16.0);

    // The swept check in section 4's decoy sub-loop caught it anyway.
    try std.testing.expect(@abs(state.paper_doubles[0].health - 5.0) < 1e-9); // 20 - 15
    try std.testing.expectEqual(@as(u32, 0), state.projectile_count); // consumed + compacted
}

test "paper double: owner-exclusion — a caster's own projectile never damages their own decoy" {
    var state = freshFightingState();
    var owner_bytes: [root.world_state.PLAYER_ID_BYTES]u8 = @splat(0);
    owner_bytes[0] = 'p';
    owner_bytes[1] = '1';

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 500,
        .y = 300,
        .vx = 0,
        .vy = 0,
        .health = 20,
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = 2,
        .owner_id_bytes = owner_bytes,
    };

    state.projectile_count = 1;
    state.projectiles[0] = .{
        .x = 500, // dead center overlap — would hit if not for owner exclusion
        .y = 300,
        .vx = 0,
        .vy = 0,
        .radius = 4,
        .damage = 15,
        .lifetime_ms = 1000,
        .age_ms = 0,
        .traveled_px = 0,
        .origin_x = 500,
        .origin_y = 300,
        .homing_strength = 0,
        .acceleration_multiplier = 0,
        .gravity_scale = 0,
        .range_px = 0,
        .slow_multiplier = 1.0,
        .sticky_fuse_ms = 0,
        .impact_radius_px = 0,
        .id = 9,
        .bounces_remaining = 0,
        .pierce_remaining = 0,
        .split_count = 0,
        .flags = .{
            .has_owner = true,
            .has_impact = false,
            .has_split = false,
            .has_slow = false,
            .has_homing = false,
            .has_acceleration = false,
            .has_gravity_scale = false,
            .has_range = false,
            .has_age = false,
            .has_traveled = false,
            .has_origin = false,
            .returning = false,
            .has_sticky_fuse = false,
            .has_impact_radius = false,
        },
        .pathing = .straight,
        .element = .neutral,
        .impact = .none,
        .shape = .circle,
        .owner_id_len = 2,
        .owner_id_bytes = owner_bytes,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 20.0), state.paper_doubles[0].health);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
}

// ── Deferred-write instant-AOE primitive (2026-07-20 gap-closure pass,
//    port of the PATTERN behind World.ts's pendingInstantAoe queue /
//    resolveInstantAoeCasts — see world_state.zig's PendingInstantAoe doc
//    comment and world.zig's resolveInstantAoeCasts doc comment for the
//    full design rationale). No ability-cast system exists to push into
//    this queue yet, so every test here hand-seeds
//    `state.pending_instant_aoe`/`pending_instant_aoe_count` directly
//    before calling `stepWorld`, the same way the Paper Double tests
//    above hand-seed `state.paper_doubles`/`paper_double_count`. ─────────

const SHIELD_BIT: u32 = 1 << 8; // mirrors combat.zig's private InputBit.shield

test "instant AOE: radius gate — hits a victim inside the radius, ignores one outside it, never touches the caster" {
    var state = freshFightingState();
    state.player_count = 3; // 0 = caster, 1 = in range, 2 = out of range
    for (0..3) |i| {
        state.players[i].flags.alive = true;
        state.players[i].health = 100;
    }
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[1].x = 40; // within radius 50
    state.players[1].y = 0;
    state.players[2].x = 200; // well outside radius 50
    state.players[2].y = 0;

    state.pending_instant_aoe_count = 1;
    state.pending_instant_aoe[0] = .{
        .caster_idx = 0,
        .x = 0,
        .y = 0,
        .radius = 50,
        .damage = 15,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 100.0), state.players[0].health); // caster untouched
    try std.testing.expectEqual(@as(f64, 85.0), state.players[1].health); // 100 - 15
    try std.testing.expectEqual(@as(f64, 100.0), state.players[2].health); // out of radius
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count); // drained
}

test "instant AOE: cone gate — a Prism-Fan-style cone hits a victim inside the arc and ignores one outside it at the same range" {
    var state = freshFightingState();
    state.player_count = 3; // 0 = caster, 1 = inside the cone, 2 = same distance but outside it
    for (0..3) |i| {
        state.players[i].flags.alive = true;
        state.players[i].health = 100;
    }
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[1].x = 100; // straight along aim_angle = 0
    state.players[1].y = 0;
    state.players[2].x = 0; // 90 degrees off-axis, same 100px range
    state.players[2].y = 100;

    state.pending_instant_aoe_count = 1;
    state.pending_instant_aoe[0] = .{
        .caster_idx = 0,
        .x = 0,
        .y = 0,
        .radius = 150,
        .damage = 20,
        .aim_angle = 0,
        .cone_radians = std.math.pi / 3.0, // +-30 degrees full width
        .has_cone = 1,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 80.0), state.players[1].health); // in the cone
    try std.testing.expectEqual(@as(f64, 100.0), state.players[2].health); // in radius, outside the cone
}

test "instant AOE: shield fully blocks the hit — drains by damage times SHIELD_HIT_DRAIN_MULTIPLIER on top of this tick's own tickShield drain, pops only when emptied, no status applied either way" {
    var state = freshFightingState();
    state.player_count = 3; // 0 = caster, 1 = ample charge, 2 = nearly-empty charge
    for (0..3) |i| {
        state.players[i].flags.alive = true;
        state.players[i].health = 100;
    }
    state.players[1].x = 10;
    state.players[1].y = 0;
    state.players[1].flags.shield_active = true;
    state.players[1].flags.has_shield_charge = true;
    state.players[1].shield_charge = 50;
    state.players[1].current_keys = SHIELD_BIT; // held THIS tick, or tickShield forces shield_active false

    state.players[2].x = -10;
    state.players[2].y = 0;
    state.players[2].flags.shield_active = true;
    state.players[2].flags.has_shield_charge = true;
    state.players[2].shield_charge = 1;
    state.players[2].current_keys = SHIELD_BIT;

    // radius=15 (not 50) is deliberate: it keeps each cast's blast from
    // ALSO reaching the OTHER victim 20px away — each cast must hit only
    // its own intended target, or the second cast processed would find
    // the first victim's shield already popped by the first cast's own
    // blast and the test would stop isolating one drain path from the
    // other.
    state.pending_instant_aoe_count = 2;
    state.pending_instant_aoe[0] = .{ .caster_idx = 0, .x = 10, .y = 0, .radius = 15, .damage = 10 };
    state.pending_instant_aoe[1] = .{ .caster_idx = 0, .x = -10, .y = 0, .radius = 15, .damage = 10 };

    _ = root.world.stepWorld(&state, 16.0);

    // Both victims took zero damage from the cast — full block either way.
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[2].health);

    const tick_shield_drain = root.combat.shieldDrain(root.combat.SHIELD_DRAIN_PER_SECOND, 16.0);
    const hit_drain = 10.0 * root.combat.SHIELD_HIT_DRAIN_MULTIPLIER;

    // Ample charge survives BOTH drains (this tick's own tickShield hold-
    // drain, then the AOE's on-hit drain) and stays active.
    const expected1 = 50.0 - tick_shield_drain - hit_drain;
    try std.testing.expect(@abs(state.players[1].shield_charge - expected1) < 1e-9);
    try std.testing.expect(state.players[1].flags.shield_active);

    // Near-empty charge is emptied by the combined drain, pops, and the
    // popped bar carries no overflow into health (full block regardless).
    try std.testing.expectEqual(@as(f64, 0.0), state.players[2].shield_charge);
    try std.testing.expect(!state.players[2].flags.shield_active);

    var saw_pop_for_2 = false;
    var ei: u32 = 0;
    while (ei < state.event_count) : (ei += 1) {
        if (state.events[ei].kind == @intFromEnum(root.world_state.SimEventKind.shield_popped) and
            state.events[ei].player_idx_a == 2)
        {
            saw_pop_for_2 = true;
        }
    }
    try std.testing.expect(saw_pop_for_2);
}

test "instant AOE: resolved strictly AFTER section 6 — a shield activated THIS tick by holding the Shield input still blocks a cast queued for the same tick" {
    // This is the single most important property of the whole primitive:
    // World.ts's own header comment on PendingInstantAoe names the exact
    // hazard the queue+post-loop-resolve pattern exists to avoid — a
    // cross-player write landing before the target's own per-tick state
    // (here: this-tick shield activation via combat.tickShield, which
    // only runs inside section 6) is final. Player B never had an active
    // shield BEFORE this tick (shield_active starts false below) — it
    // only becomes active THIS tick because B holds the Shield input and
    // has charge, which section 6's tickShield resolves. If
    // resolveInstantAoeCasts ran anywhere before section 6 (or wasn't
    // sequenced after it), it would see B's STALE pre-tick shield_active
    // = false and the cast would land as full unmitigated damage. Placed
    // correctly (world.zig section "6b", strictly after section 6), B's
    // shield is already active by the time the cast resolves, so it
    // blocks — this test fails loudly if that ordering ever regresses.
    var state = freshFightingState();
    state.player_count = 2; // 0 = caster A, 1 = victim B
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 20;
    state.players[1].y = 0;
    state.players[1].flags.shield_active = false; // NOT active before this tick
    state.players[1].flags.has_shield_charge = true;
    state.players[1].shield_charge = 80; // ample charge, just not raised yet
    state.players[1].current_keys = SHIELD_BIT; // B raises it THIS tick

    // Cast "queued during A's own section-6 turn" (stand-in for the real
    // push site a later phase adds) — targets B, who in real per-player-
    // loop order may have already had ITS OWN turn run earlier in the
    // very same tick section 6 iterates.
    state.pending_instant_aoe_count = 1;
    state.pending_instant_aoe[0] = .{ .caster_idx = 0, .x = 20, .y = 0, .radius = 50, .damage = 25 };

    _ = root.world.stepWorld(&state, 16.0);

    // Proof #1: B's shield really did activate THIS tick (section 6 ran).
    try std.testing.expect(state.players[1].flags.shield_active);
    // Proof #2: the AOE saw that up-to-date shield state, not a stale
    // pre-tick snapshot — full block, zero damage.
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);
}

// ── MELEE — Ninja Slash + Paladin Kindled Edge (2026-07-20 base-melee-
//    mechanic gap-closure pass, parity port of World.ts's "1z2. NINJA
//    MELEE"/"1z3. PALADIN MELEE" sections) ─────────────────────────────────
//
// Tick-math note: every test below drives dt in exact-boundary steps so
// the swing phase machine lands EXACTLY on a phase transition or the
// contact-delay gate on a known tick, rather than approximating with many
// small dt steps. Attacker and victim both start at vy=0 with no
// horizontal input, so gravity (identical dt/grav_mul for every player,
// IEEE754-deterministic) moves them down in perfect lockstep tick over
// tick — their RELATIVE position (all the arc/range check reads) never
// drifts, so no static floor is needed to hold them in place.

test "melee: ninja slash hits an in-arc in-range victim for SLASH_DAMAGE with knockback, and does not double-hit the same victim later in the same active window" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[0].aim_x = 100; // aims straight along +X
    state.players[0].aim_y = 0;
    state.players[0].current_keys = FIRE_BIT;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 50; // within SLASH_RANGE (78), dead ahead (angle 0)
    state.players[1].y = 0;

    // Tick 1: Fire rising edge -> windup starts (phaseMs = 120).
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);

    // Tick 2: dt = 120 exactly closes windup -> active starts this same
    // tick (phaseMs = 90, elapsed = 0) — too early for contact.
    _ = root.world.stepWorld(&state, 120.0);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);

    // Tick 3: dt = 44 (== SLASH_CONTACT_DELAY_MS) — elapsed hits exactly
    // 44, the contact gate opens, arc hit-check resolves this tick.
    _ = root.world.stepWorld(&state, 44.0);
    try std.testing.expectEqual(@as(f64, 78.0), state.players[1].health); // 100 - 22
    // Tolerance is looser than the other float checks in this file: the
    // swing direction is captured from `attacker.aimX - attacker.x` at the
    // START of windup (tick 1), AFTER that same tick's physics pass has
    // already nudged the attacker's y down a hair under gravity — a real,
    // tiny, expected deviation from a perfect (1, 0) unit vector, not a
    // bug in the melee code itself.
    try std.testing.expect(@abs(state.players[1].vx - 260.0) < 0.01); // aimX(~1) * SLASH_KNOCKBACK
    try std.testing.expect(@abs(state.players[1].vy - (-60.0)) < 0.01); // aimY(~0)*KB - SLASH_KNOCK_UP

    // Tick 4: still inside the active window (46ms of phaseMs left) and
    // still contact-gated — but the victim is already in hitThisSwing, so
    // no second hit lands.
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(f64, 78.0), state.players[1].health);
}

test "melee: arc gate — a victim outside the cone at the same range is missed; range gate — a victim dead-ahead but beyond SLASH_RANGE is missed" {
    var state = freshFightingState();
    state.player_count = 3; // 0 = attacker, 1 = miss (off-axis), 2 = miss (too far)
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[0].current_keys = FIRE_BIT;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 0; // 90 degrees off-axis, well outside the +-50 deg cone
    state.players[1].y = 50; // same 50px distance as the in-arc victim in the hit test

    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = 90; // dead ahead but beyond SLASH_RANGE (78)
    state.players[2].y = 0;

    _ = root.world.stepWorld(&state, 1.0); // windup starts
    _ = root.world.stepWorld(&state, 120.0); // active starts
    _ = root.world.stepWorld(&state, 44.0); // contact gate opens, hit-check runs

    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health); // off-axis miss
    try std.testing.expectEqual(@as(f64, 100.0), state.players[2].health); // out-of-range miss
}

test "melee: contact-delay gate — no damage while active but before SLASH_CONTACT_DELAY_MS has elapsed, even though the arc geometry already overlaps" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[0].current_keys = FIRE_BIT;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 50;
    state.players[1].y = 0;

    _ = root.world.stepWorld(&state, 1.0); // windup starts
    _ = root.world.stepWorld(&state, 120.0); // active starts, elapsed = 0

    // dt = 43 (one short of SLASH_CONTACT_DELAY_MS = 44) — active, in the
    // cone, but still pre-contact: must not damage.
    _ = root.world.stepWorld(&state, 43.0);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);

    // One more ms crosses the 44ms gate exactly — now it connects.
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(f64, 78.0), state.players[1].health);
}

test "melee: re-trigger is only accepted from idle — releasing and re-pressing Fire mid-windup does not restart the swing timer" {
    var state = freshFightingState();
    // 2 players, not 1: round.detectRoundWinner declares an instant KO win
    // (alive_count == 1) and flips round_phase off .fighting, which would
    // gate off section 6a entirely before this test gets to observe the
    // FSM at all — an artifact of the round-end rule, not the swing FSM
    // under test, so a harmless bystander keeps the round alive throughout.
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 1000; // far away — never enters the swing's arc/range

    state.players[0].current_keys = FIRE_BIT; // tick 1: rising edge
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(root.world_state.MeleeSwingPhase.windup, state.melee_swing[0].phase);
    try std.testing.expectEqual(@as(f64, 120.0), state.melee_swing[0].phase_ms);

    state.players[0].current_keys = 0; // release
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(f64, 119.0), state.melee_swing[0].phase_ms);

    // Rising edge again, mid-windup: must NOT reset phase_ms back to 120 —
    // only an idle-phase rising edge starts a fresh swing.
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(root.world_state.MeleeSwingPhase.windup, state.melee_swing[0].phase);
    try std.testing.expectEqual(@as(f64, 118.0), state.melee_swing[0].phase_ms);
}

test "melee: shield fully blocks a landed hit — zero damage, charge drains by this tick's hold-drain plus the hit drain, knockback still applies" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[0].current_keys = FIRE_BIT;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 50;
    state.players[1].y = 0;
    state.players[1].flags.shield_active = true;
    state.players[1].flags.has_shield_charge = true;
    state.players[1].shield_charge = 50;
    state.players[1].current_keys = SHIELD_BIT; // held every tick, or tickShield drops shield_active

    _ = root.world.stepWorld(&state, 1.0); // windup starts
    _ = root.world.stepWorld(&state, 120.0); // active starts

    // Contact tick: dt = 44.
    _ = root.world.stepWorld(&state, 44.0);

    // Fully blocked: zero damage, still alive.
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);
    // Knockback still lands even though the hit was shield-blocked (TS:
    // `post` gets the knockback velocity unconditionally unless evaded).
    // Tolerance loosened same as the hit test above — the captured swing
    // direction picks up a hair of gravity drift from windup's own tick.
    try std.testing.expect(@abs(state.players[1].vx - 260.0) < 0.01);
    try std.testing.expect(@abs(state.players[1].vy - (-60.0)) < 0.01);

    // Charge drained by tickShield's OWN hold-drain across all 3 ticks this
    // test held Shield (dt = 1 + 120 + 44 = 165ms total — section 6 runs
    // every tick regardless of swing phase) plus the melee hit's own
    // SHIELD_HIT_DRAIN_MULTIPLIER-scaled drain on the contact tick — same
    // accounting shape as the instant-AOE shield test above, just summed
    // over more ticks since this test's swing takes 3 to reach contact.
    const tick_shield_drain = root.combat.shieldDrain(root.combat.SHIELD_DRAIN_PER_SECOND, 1.0 + 120.0 + 44.0);
    const hit_drain = 22.0 * root.combat.SHIELD_HIT_DRAIN_MULTIPLIER;
    const expected = 50.0 - tick_shield_drain - hit_drain;
    try std.testing.expect(@abs(state.players[1].shield_charge - expected) < 1e-6);
    try std.testing.expect(state.players[1].flags.shield_active); // charge survives, not popped
}

test "melee: an active timed parry does NOT block a melee hit — exact TS parity (tryDeflectDamage's parry branches require projectile !== null; both melee call sites pass null)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[0].current_keys = FIRE_BIT;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 50;
    state.players[1].y = 0;
    // An active parry, facing directly toward the attacker — geometrically
    // this WOULD cover the incoming hit if parry applied to melee at all.
    state.players[1].flags.has_parry_active = true;
    state.players[1].parry_active_until_tick = 100_000;
    state.players[1].flags.has_parry_facing = true;
    state.players[1].parry_facing = std.math.pi; // facing -X, toward the attacker at x=0

    _ = root.world.stepWorld(&state, 1.0); // windup
    _ = root.world.stepWorld(&state, 120.0); // active starts
    _ = root.world.stepWorld(&state, 44.0); // contact tick

    // Full, unmitigated damage — the parry never even gets checked.
    try std.testing.expectEqual(@as(f64, 78.0), state.players[1].health);
}

test "melee: paladin kindled edge lands its own EDGE_DAMAGE/EDGE_RANGE/EDGE_* timing — distinct numbers from ninja slash, not a copy-paste reuse" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy; // paladin
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[0].current_keys = FIRE_BIT;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 80; // within EDGE_RANGE (84) but OUTSIDE SLASH_RANGE (78)
    state.players[1].y = 0;

    _ = root.world.stepWorld(&state, 1.0); // windup starts (EDGE_WINDUP_MS = 200)
    _ = root.world.stepWorld(&state, 200.0); // active starts (EDGE_ACTIVE_MS = 110), elapsed = 0

    // dt = 99 (one short of EDGE_CONTACT_DELAY_MS = 100) — no hit yet.
    _ = root.world.stepWorld(&state, 99.0);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);

    // dt = 1 crosses the 100ms gate exactly.
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(f64, 68.0), state.players[1].health); // 100 - EDGE_DAMAGE(32)
    // Tolerance loosened same as the ninja hit test above (gravity-drift
    // artifact on the captured swing direction, not a bug).
    try std.testing.expect(@abs(state.players[1].vx - 420.0) < 0.01); // EDGE_KNOCKBACK
    try std.testing.expect(@abs(state.players[1].vy - (-110.0)) < 0.01); // -EDGE_KNOCK_UP
}
