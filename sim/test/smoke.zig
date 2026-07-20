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

// ── cards_gen CardMeta plumbing (foundational data-model pass) ───────────
// Spot-checks that gen_card_data.ts's codegen genuinely carries classId/
// unique/maxStacks/rarity/active through from cards.ts into Zig-readable
// CardMeta — the structural blocker the draft/offer-roll and ability-cast
// resolution phases (both explicitly OUT of scope here) need to exist
// before either can move forward. These assert against the exact live
// cards.ts values (see the task's own investigation), not placeholders —
// re-check against cards.ts if any of these specific cards' data changes.

test "cards_gen: total card count is 104 — every card gets an entry now, not just ones with a modifier" {
    try std.testing.expectEqual(@as(usize, 104), root.cards_gen.cards.len);
}

test "cards_gen: universal weapon-stat card (raycast-prism) has no class gate and no active" {
    const meta = root.cards_gen.cardMeta("raycast-prism").?;
    try std.testing.expectEqual(@as(?root.cards_gen.ClassId, null), meta.class_id);
    try std.testing.expectEqual(true, meta.unique);
    try std.testing.expectEqual(@as(u8, 0), meta.max_stacks); // no explicit cap
    try std.testing.expectEqual(root.cards_gen.Rarity.rare, meta.rarity);
    try std.testing.expectEqual(@as(?root.cards_gen.CardActive, null), meta.active);
    // A pure weapon-stat card still resolves a real (non-default) CardMod.
    const mod = root.cards_gen.cardMod("raycast-prism").?;
    try std.testing.expect(mod.damage_mul != 1.0);
}

test "cards_gen: maxStacks card (shard-bloom) carries its real cap and is NOT flagged unique" {
    const meta = root.cards_gen.cardMeta("shard-bloom").?;
    try std.testing.expectEqual(false, meta.unique);
    try std.testing.expectEqual(@as(u8, 2), meta.max_stacks);
    try std.testing.expectEqual(root.cards_gen.Rarity.rare, meta.rarity);
}

test "cards_gen: class-blind ability card (crimson-tithe) has active but no class gate, and its CardMod is the all-defaults no-op" {
    const meta = root.cards_gen.cardMeta("crimson-tithe").?;
    try std.testing.expectEqual(@as(?root.cards_gen.ClassId, null), meta.class_id);
    try std.testing.expectEqual(true, meta.unique);
    try std.testing.expectEqual(root.cards_gen.Rarity.rare, meta.rarity);
    const active = meta.active.?;
    try std.testing.expectEqual(root.cards_gen.AbilityKind.crimson_tithe, active.kind);
    try std.testing.expectEqual(@as(f64, 14000.0), active.cooldown_ms);
    try std.testing.expectEqual(@as(?f64, 3000.0), active.duration_ms);

    // Pure-ability cards carry no modifier in cards.ts — applyCard's own
    // `if (!modifier) return;` early return means this must resolve to
    // CardMod's zero-value default, matching that no-op exactly (mirrors
    // weaponBuild.ts's applyCard, not a fabricated Zig-side rule).
    const mod = root.cards_gen.cardMod("crimson-tithe").?;
    try std.testing.expectEqual(root.cards_gen.CardMod{}, mod);
}

test "cards_gen: one classId-gated ability card per class resolves the correct class_id/active identity" {
    const Case = struct {
        id: []const u8,
        class_id: root.cards_gen.ClassId,
        rarity: root.cards_gen.Rarity,
        kind: root.cards_gen.AbilityKind,
        cooldown_ms: f64,
        duration_ms: ?f64,
    };
    const cases = [_]Case{
        .{ .id = "sunlance", .class_id = .wizard, .rarity = .rare, .kind = .sunlance, .cooldown_ms = 7000.0, .duration_ms = 700.0 },
        .{ .id = "bastion-pulse", .class_id = .paladin, .rarity = .uncommon, .kind = .bastion_pulse, .cooldown_ms = 8000.0, .duration_ms = null },
        .{ .id = "bleed-tithe", .class_id = .priest, .rarity = .uncommon, .kind = .bleed_tithe, .cooldown_ms = 6000.0, .duration_ms = null },
        .{ .id = "undercut", .class_id = .ninja, .rarity = .rare, .kind = .undercut, .cooldown_ms = 8000.0, .duration_ms = 4000.0 },
    };
    for (cases) |c| {
        const meta = root.cards_gen.cardMeta(c.id).?;
        try std.testing.expectEqual(@as(?root.cards_gen.ClassId, c.class_id), meta.class_id);
        try std.testing.expectEqual(true, meta.unique);
        try std.testing.expectEqual(c.rarity, meta.rarity);
        const active = meta.active.?;
        try std.testing.expectEqual(c.kind, active.kind);
        try std.testing.expectEqual(c.cooldown_ms, active.cooldown_ms);
        try std.testing.expectEqual(c.duration_ms, active.duration_ms);
        // Every classId-gated catalog ability card carries no modifier either.
        try std.testing.expectEqual(root.cards_gen.CardMod{}, root.cards_gen.cardMod(c.id).?);
    }
}

test "cards_gen: AbilityKind has exactly 45 members (5 class-blind six-axes + 10 per each of 4 catalogs)" {
    const info = @typeInfo(root.cards_gen.AbilityKind);
    try std.testing.expectEqual(@as(usize, 45), info.@"enum".fields.len);
}

test "cards_gen: cardMeta/cardMod return null for an unknown card id" {
    try std.testing.expectEqual(@as(?root.cards_gen.CardMeta, null), root.cards_gen.cardMeta("not-a-real-card"));
    try std.testing.expectEqual(@as(?root.cards_gen.CardMod, null), root.cards_gen.cardMod("not-a-real-card"));
}

// ── Ability-cast dispatch (Phase 1, docs/zig-step-world-parity-goal.md) ──
// Cooldown gating + empty-slot-inert are the two named load-bearing
// properties; the 6 wired abilities (Undercut/Read Mark/Second Wind/Edge
// Storm — Ninja; Judgment Line/Unbroken Seal — Paladin) each get their own
// cast-time + consumption-time proof, mirroring the rigor of the base
// melee tests above (arc/range gates, timing gates, single-use windows).

const SLOT1_BIT: u32 = 1 << 10;
const SLOT2_BIT: u32 = 1 << 11;

fn setPlayerId(p: *root.world_state.PlayerEntity, id: []const u8) void {
    p.id_len = @intCast(id.len);
    @memcpy(p.id_bytes[0..id.len], id);
}

/// Stores `kind` into `slot` for `player_idx` — see
/// `world_state.EquippedActives.slot_kind`'s own doc comment for why the
/// raw storage is `AbilityKind + 1`, not the bare enum value.
fn equipSlot(state: *root.world_state.WorldState, player_idx: usize, slot: usize, kind: root.cards_gen.AbilityKind) void {
    state.player_equipped_actives[player_idx].slot_kind[slot] = @intFromEnum(kind) + 1;
}

test "ability dispatch: cooldown gating — a re-press mid-cooldown is a no-op (no re-cast, no cooldown reset), and a press after the cooldown expires DOES re-cast" {
    var state = freshFightingState();
    // 2 players, not 1: with only 1 the round ends in a KO on tick 1
    // (round.detectRoundWinner's alive_count==1 branch), flipping
    // round_phase off .fighting and making stepAbilityDispatch's own
    // phase gate a no-op for the rest of the test — same bystander
    // precedent the pre-existing "melee: re-trigger" test above uses.
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja
    state.players[0].health = 100;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000; // far away, never interacts
    equipSlot(&state, 0, 0, .undercut); // duration 4000ms, cooldown 8000ms

    // Tick 1 (dt=1000ms -> 1 tick = 1000ms, so duration/cooldown resolve to
    // small tick counts: duration 4000ms/1000 = 4 ticks, cooldown 8000ms/1000
    // = 8 ticks — deliberately coarse dt so the whole cooldown window fits
    // in a handful of stepWorld calls instead of thousands).
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1000.0); // tick=1: rising edge, casts
    try std.testing.expectEqual(@as(u32, 5), state.players[0].undercut_until_tick); // 1+4
    try std.testing.expectEqual(@as(u32, 9), state.players[0].slot_cooldown_until_tick[0]); // 1+8

    // Tick 2: release.
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1000.0); // tick=2

    // Tick 3: re-press — genuine rising edge, but slot_cooldown_until_tick
    // (9) > tick (3), so this MUST be a no-op: no re-cast, no reset.
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1000.0); // tick=3
    try std.testing.expectEqual(@as(u32, 5), state.players[0].undercut_until_tick); // unchanged
    try std.testing.expectEqual(@as(u32, 9), state.players[0].slot_cooldown_until_tick[0]); // unchanged

    // Ticks 4-8: release and hold released until the cooldown (tick 9) has
    // fully elapsed (gate is `cd_until > tick`, so tick 9 itself is no
    // longer gated: 9 > 9 is false).
    state.players[0].current_keys = 0;
    var t: u32 = 0;
    while (t < 5) : (t += 1) {
        _ = root.world.stepWorld(&state, 1000.0); // ticks 4..8
    }
    try std.testing.expectEqual(@as(u32, 8), state.header.tick);

    // Tick 9: re-press — cooldown has fully elapsed, this MUST re-cast.
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1000.0); // tick=9
    try std.testing.expectEqual(@as(u32, 9), state.header.tick);
    try std.testing.expectEqual(@as(u32, 13), state.players[0].undercut_until_tick); // 9+4
    try std.testing.expectEqual(@as(u32, 17), state.players[0].slot_cooldown_until_tick[0]); // 9+8
}

test "ability dispatch: an empty slot (ABILITY_KIND_NONE, the zero-init default) is provably inert under repeated rising-edge presses on all 3 slots — no crash, no cooldown-set, no window-set" {
    var state = freshFightingState();
    // 2 players — same "avoid an instant KO ending the round" reasoning as
    // the cooldown-gating test above.
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    // Deliberately NOT calling equipSlot — every slot stays at the
    // zero-init default (ABILITY_KIND_NONE == 0), the exact state
    // `reset()`/every test's `freshFightingState()` produces for every
    // real player until something explicitly equips a card. This is the
    // load-bearing case: ABILITY_KIND_NONE was picked specifically so THIS
    // is the natural rest state, not an edge case a caller has to
    // remember to set up (see ABILITY_KIND_NONE's own doc comment).

    const ALL_SLOTS_BIT = SLOT1_BIT | SLOT2_BIT | (1 << 12);
    var i: u32 = 0;
    while (i < 6) : (i += 1) {
        // Alternate press/release every tick so every press is a genuine
        // rising edge, not a held key.
        state.players[0].current_keys = if (i % 2 == 0) ALL_SLOTS_BIT else 0;
        _ = root.world.stepWorld(&state, 1000.0);
    }

    // No crash getting here is itself part of the proof. Assert zero
    // state change on every field an active dispatch could have touched.
    try std.testing.expectEqual([3]u32{ 0, 0, 0 }, state.players[0].slot_cooldown_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].undercut_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].edge_storm_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].edge_storm_charges_remaining);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].seal_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].second_wind_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].judgment_mark_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].read_mark_until_tick);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[0].health);
}

test "ability dispatch: Undercut (Ninja) — cast opens the window and sets cooldown; a landed slash against a victim at/under the execute threshold still lands the ordinary lethal hit (the execute clamp is exercised, not skipped, even though it's numerically redundant against the base 22 slash vs. threshold 15 — see this pass's own report)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    equipSlot(&state, 0, 0, .undercut);

    state.players[1].flags.alive = true;
    state.players[1].health = 15; // at the execute threshold exactly
    state.players[1].x = 50;
    state.players[1].y = 0;

    // Cast Undercut (slot bit) and start the slash swing (Fire bit) on the
    // SAME tick — dispatch (section 6z) runs before melee (section 6a), so
    // the window is already live by the time this tick's swing FSM starts.
    state.players[0].current_keys = SLOT1_BIT | FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 1: cast + windup starts
    try std.testing.expect(state.players[0].undercut_until_tick > state.header.tick);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);

    state.players[0].current_keys = FIRE_BIT; // hold fire, ability bit released (no re-cast attempted)
    _ = root.world.stepWorld(&state, 120.0); // active starts
    _ = root.world.stepWorld(&state, 44.0); // contact tick — hit resolves

    // Execute clamp: max(SLASH_DAMAGE(22), victim.health(15)) == 22 — the
    // formula is bit-exact with World.ts's own `Math.max`, and produces a
    // guaranteed kill either way at this threshold (0 health, not alive).
    try std.testing.expectEqual(@as(f64, 0.0), state.players[1].health);
    try std.testing.expectEqual(false, state.players[1].flags.alive);
}

test "ability dispatch: Read Mark (Ninja) — marks the NEAREST enemy within range (ignoring one out of range), and amplifies only a landed slash against that exact target" {
    var state = freshFightingState();
    state.player_count = 3;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    setPlayerId(&state.players[0], "attacker");
    equipSlot(&state, 0, 0, .read_mark); // range 340px, no cone

    // Nearest — inside Read Mark's range AND inside the slash arc/range
    // (this is the one that actually gets hit).
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 50;
    state.players[1].y = 0;
    setPlayerId(&state.players[1], "nearest");

    // Farther, but still inside Read Mark's 340px range, and OUTSIDE
    // SLASH_RANGE (78) so it can never be hit by the swing itself — purely
    // a distractor to prove "nearest," not "first," is selected.
    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = 300;
    state.players[2].y = 0;
    setPlayerId(&state.players[2], "farther-in-range");

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 1: cast — should mark "nearest"
    try std.testing.expect(state.players[0].read_mark_until_tick > state.header.tick);
    try std.testing.expectEqualSlices(u8, "nearest", state.players[0].read_target_id_bytes[0..state.players[0].read_target_id_len]);

    // Now swing at "nearest" — the amp should land on it.
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // windup starts
    _ = root.world.stepWorld(&state, 120.0); // active starts
    _ = root.world.stepWorld(&state, 44.0); // contact tick

    // 100 - (22 * 1.28) == 71.84 — proves the amp actually applied (a plain
    // unamplified hit would leave 78.0, the base melee test's own number).
    try std.testing.expect(@abs(state.players[1].health - 71.84) < 1e-9);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[2].health); // never in slash range
}

test "ability dispatch: Read Mark (Ninja) — no enemy within range: a dead press, no mark, no cooldown burn" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    equipSlot(&state, 0, 0, .read_mark);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 1000; // well outside NINJA_READ_MARK_RANGE_PX (340)

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].read_mark_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]);
}

test "ability dispatch: Second Wind (Ninja) — window heals + grants bonus energy on the NEXT landed slash hit only; a second victim hit in the SAME swing gets the ordinary (un-bonused) energy grant, proving single-use consumption" {
    var state = freshFightingState();
    state.player_count = 3; // 0 = attacker, 1 & 2 = both in-arc victims
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 50; // below 100 so the heal is visible
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    equipSlot(&state, 0, 0, .second_wind);

    // Both victims dead ahead, within SLASH_RANGE/arc, at slightly
    // different distances so array-index order (1 then 2) matches the
    // arc-scan's own natural iteration order.
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 40;
    state.players[1].y = 0;
    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = 70;
    state.players[2].y = 0;

    state.players[0].current_keys = SLOT1_BIT | FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // cast + windup start
    try std.testing.expect(state.players[0].second_wind_until_tick > state.header.tick);

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 120.0); // active starts
    _ = root.world.stepWorld(&state, 44.0); // contact tick — both victims hit this same tick

    // Heal applied exactly once (12), not twice.
    try std.testing.expectEqual(@as(f64, 62.0), state.players[0].health);
    // Energy: baseline 10 on EVERY landed hit + Second Wind's 30 bonus on
    // ONLY the first-processed hit = 10 + 30 + 10 = 50.
    try std.testing.expectEqual(@as(f64, 50.0), state.players[0].energy);
    // Window consumed after the first qualifying hit.
    try std.testing.expectEqual(@as(u32, 0), state.players[0].second_wind_until_tick);
}

test "ability dispatch: Judgment Line (Paladin) — marks the nearest foe in the aim cone and amplifies the NEXT landed Kindled Edge hit against it; a candidate outside the cone is ignored and burns no cooldown" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy; // paladin
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;

    // Off-axis (90 degrees), well outside KIN_JUDGMENT_CONE_RADIANS (60 deg
    // total, 30 deg half-width) — must NOT be marked.
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 0;
    state.players[1].y = 50;

    equipSlot(&state, 0, 0, .judgment_line);
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].judgment_mark_until_tick); // no target: dead press
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]); // no cooldown burn

    // Move the victim dead ahead, in range and in cone, and re-press —
    // this time it should mark.
    state.players[1].x = 80; // within EDGE_RANGE (84) and KIN_JUDGMENT_RANGE_PX (420)
    state.players[1].y = 0;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0); // release (so the next press is a rising edge)
    state.players[0].current_keys = SLOT1_BIT | FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // cast (marks) + windup start, same tick
    try std.testing.expect(state.players[0].judgment_mark_until_tick > state.header.tick);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 200.0); // active starts (EDGE_WINDUP_MS)
    _ = root.world.stepWorld(&state, 100.0); // contact tick (EDGE_CONTACT_DELAY_MS)

    // 100 - (32 * 1.3) == 58.4 — a plain unamplified Edge hit would leave
    // 68.0 (the base melee test's own number), proving the amp landed.
    try std.testing.expect(@abs(state.players[1].health - 58.4) < 1e-9);
}

test "ability dispatch: Unbroken Seal (Paladin) — single-use window amplifies + staggers the FIRST landed Kindled Edge hit only; a second victim in the same swing takes ordinary damage with no stagger" {
    var state = freshFightingState();
    state.player_count = 3;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    equipSlot(&state, 0, 0, .unbroken_seal);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 40;
    state.players[1].y = 0;
    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = 75;
    state.players[2].y = 0;

    state.players[0].current_keys = SLOT1_BIT | FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // cast + windup start
    try std.testing.expect(state.players[0].seal_until_tick > state.header.tick);

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 200.0); // active starts
    _ = root.world.stepWorld(&state, 100.0); // contact tick — both victims hit

    // First victim (index 1, scanned first): amplified 32 * 1.45 = 46.4,
    // plus the stagger status.
    try std.testing.expect(@abs(state.players[1].health - 53.6) < 1e-9);
    try std.testing.expect(state.players[1].flags.has_slow);
    try std.testing.expect(state.players[1].slowed_until_tick > state.header.tick);
    try std.testing.expect(@abs(state.players[1].slow_multiplier - 0.25) < 1e-9);

    // Second victim: seal already consumed — ordinary damage, no stagger.
    try std.testing.expectEqual(@as(f64, 68.0), state.players[2].health);
    try std.testing.expectEqual(false, state.players[2].flags.has_slow);

    // Window cleared.
    try std.testing.expectEqual(@as(u32, 0), state.players[0].seal_until_tick);
}

/// Counts projectiles matching the wave's own distinguishing stats
/// (radius 10, damage ~22 — see WAVE_RADIUS/WAVE_DAMAGE*multiplier in
/// world.zig). Needed because holding the Fire input bit (this test's own
/// swing driver) ALSO satisfies a real, PRE-EXISTING, unrelated gap this
/// pass found but does not fix (out of scope — see the task's own "don't
/// touch anything outside sim/'s ability-dispatch surface" boundary):
/// `weapon.weaponTickFire`/section 6's basic weapon-fire path has no
/// classId branch suppressing the ordinary starter-pistol shot for a
/// ninja the way World.ts's own fire block does ("the ninja melee slash
/// does NOT get a new input bit — it reuses Fire... World.ts branches on
/// classId at the stepWeapon call site: ninja chassis route the Fire
/// rising-edge into the slash FSM INSTEAD OF stepWeapon" — protocol.ts's
/// own comment). Zig has no such branch yet, so holding Fire as a ninja
/// spawns an ordinary pistol shot (damage 12, radius ~7) ALONGSIDE the
/// slash — a real gap, flagged here rather than silently worked around,
/// but genuinely out of THIS phase's scope (Phase 1 is ability-cast
/// dispatch, not a weapon-fire/melee-input-routing fix).
fn countWaveProjectiles(state: *const root.world_state.WorldState) u32 {
    var n: u32 = 0;
    for (state.projectiles[0..state.projectile_count]) |p| {
        if (@abs(p.radius - 10.0) < 1e-9) n += 1;
    }
    return n;
}

test "ability dispatch: Edge Storm (Ninja) — window banks 3 charges; each full slash swing while the window is live spawns one amplified wave projectile and spends one charge; the window closes early once charges hit 0, and a 4th swing spawns no further wave" {
    var state = freshFightingState();
    // 2 players — bystander avoids an instant KO ending the round (same
    // reasoning as the cooldown-gating test above); no victim interaction
    // needed, only the wave-spawn mechanic is under test.
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    equipSlot(&state, 0, 0, .edge_storm); // duration 6000ms, 3 charges

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 1: cast
    try std.testing.expectEqual(@as(u32, 3), state.players[0].edge_storm_charges_remaining);
    try std.testing.expect(state.players[0].edge_storm_until_tick > state.header.tick);

    var cycle: u32 = 0;
    while (cycle < 3) : (cycle += 1) {
        state.players[0].current_keys = 0;
        _ = root.world.stepWorld(&state, 1.0); // let the ability-slot release register
        state.players[0].current_keys = FIRE_BIT;
        _ = root.world.stepWorld(&state, 1.0); // windup starts (rising edge)
        _ = root.world.stepWorld(&state, 120.0); // active starts
        _ = root.world.stepWorld(&state, 90.0); // active -> recovery: wave spawns HERE
        try std.testing.expectEqual(cycle + 1, countWaveProjectiles(&state));
        try std.testing.expectEqual(@as(u32, 2 - cycle), state.players[0].edge_storm_charges_remaining);
        state.players[0].current_keys = 0;
        _ = root.world.stepWorld(&state, 220.0); // recovery -> idle
    }
    // Window closed early once charges hit 0 (not left to time out).
    try std.testing.expectEqual(@as(u32, 0), state.players[0].edge_storm_until_tick);

    // Sanity-check the FIRST wave's stats (bit-exact, not just "a
    // projectile exists"): damage = WAVE_DAMAGE(10) * multiplier(2.2) =
    // 22; radius 10; straight/crystal, no homing/gravity/bounce/pierce.
    var found_wave: ?root.world_state.ProjectileEntity = null;
    for (state.projectiles[0..state.projectile_count]) |p| {
        if (@abs(p.radius - 10.0) < 1e-9) {
            found_wave = p;
            break;
        }
    }
    const wave = found_wave.?;
    try std.testing.expect(@abs(wave.damage - 22.0) < 1e-9);
    try std.testing.expectEqual(@as(f64, 10.0), wave.radius);
    try std.testing.expectEqual(root.world_state.ProjectilePathing.straight, wave.pathing);
    try std.testing.expectEqual(root.world_state.ElementType.crystal, wave.element);

    // 4th swing: window already closed (edge_storm_until_tick == 0), no
    // charges — must NOT spawn a 4th wave.
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // windup starts
    _ = root.world.stepWorld(&state, 120.0); // active starts
    _ = root.world.stepWorld(&state, 90.0); // active -> recovery, no wave this time
    try std.testing.expectEqual(@as(u32, 3), countWaveProjectiles(&state)); // unchanged from the 3 real waves
}

test "ability dispatch: Edge Storm NOT cast — a slash swing's active->recovery transition spawns NO wave at all (base melee stays melee-only, matching World.ts's own 'without Edge Storm live, the swing is melee-only')" {
    var state = freshFightingState();
    // 2 players — same bystander reasoning as the tests above.
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    // No equipSlot call at all — nothing equipped, Edge Storm never cast.

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // windup starts
    _ = root.world.stepWorld(&state, 120.0); // active starts
    _ = root.world.stepWorld(&state, 90.0); // active -> recovery transition

    // Zero WAVE projectiles specifically — see countWaveProjectiles' own
    // doc comment for why raw `state.projectile_count` isn't the right
    // assertion here (an ordinary pistol shot, a pre-existing unrelated
    // gap, legitimately fires too while Fire is held).
    try std.testing.expectEqual(@as(u32, 0), countWaveProjectiles(&state));
}
