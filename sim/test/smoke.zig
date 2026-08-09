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

// ── Hitscan decoy/destructible candidates (Track Z5 item 3, follow-up
//    pass, finish-line-goal.md) — `resolveHitscanFire`'s ray sweep now
//    treats Paper Double decoys and destructibles as full candidate-kind
//    pools alongside players (world.zig's "Hitscan resolution" section
//    header documents the complete per-sub-item STATUS list). No JS/TS
//    cross-engine lockstep coverage exists for the decoy half specifically
//    — `worldStateBridge.ts`'s `packWorldState`/`unpackWorldState` don't
//    pack/unpack Paper Doubles at all yet (a separate, pre-existing,
//    already-documented bridge gap — see that file's own
//    `PAPER_DOUBLE_ENTITY_SIZE` doc comment: "Not yet spawned/packed by
//    the TS bridge"), so a decoy seeded JS-side would never actually reach
//    wasm memory for a `hitscanZ5ScopeCutsParity.test.ts`-style lockstep
//    run. These tests drive `stepWorld` natively instead, hand-seeding
//    `state.paper_doubles`/`state.destructibles` directly — the same
//    "bypass the unrelated bridge gap, prove the Zig-internal behavior"
//    precedent the Paper Double section above already established for
//    the real-projectile x decoy loop.
//
//    Geometry note: every test below fires along a near-perfectly
//    horizontal ray by aiming `aim_y = shooter.y - 66` (canceling
//    weapon.zig's own MUZZLE_ANCHOR_UP (60) + the first shot's fixed
//    MUZZLE_HAND_SPREAD (6) — `throw_hand_parity` starts at 0, so the
//    FIRST shot always takes `hand = (0 ^ 1) & 1 == 1`, i.e. `side =
//    -1.0`, a fixed, deterministic combination for a single-shot test)
//    with a distant `aim_x`, so every target placed at that same
//    `y = shooter.y - 66` sits (near-)exactly on the ray regardless of x
//    — avoids hand-deriving the muzzle's exact sub-pixel position per
//    test. `playerMuzzlePosition` itself uses exact sqrt/division (no
//    LUT); only the final fire-angle recompute feeds `trig.lutCos`/
//    `lutSin` (1024-entry LUT, "effective precision well below 0.001°"
//    per its own doc comment) — negligible sub-pixel drift over the
//    travel distances these tests use, well inside every target's own
//    hitbox margin. ─────────────────────────────────────────────────────

fn hitscanFireConfig(range_px: f64, pierce_count: u32) root.world_state.ResolvedFireConfig {
    return .{
        .damage = 20,
        .fire_rate = 4,
        .projectile_speed = 1,
        .projectile_lifetime_seconds = 1,
        .spread_radians = 0,
        .range_px = range_px,
        .homing_strength = 0,
        .acceleration_multiplier = 0,
        .gravity_scale = 0,
        .slow_multiplier = 1,
        .impact_radius_px = 0,
        .size_multiplier = 1,
        .speed_multiplier = 1,
        .lifetime_multiplier = 1,
        .projectile_count = 1,
        .bounces = 0,
        .pierce_count = pierce_count,
        .split_count = 0,
        .shape = .circle,
        .element = .neutral,
        .pathing = .straight,
        .impact = .none,
        .valid = 1,
        .delivery = 1, // raycast/hitscan — world_state.zig ResolvedFireConfig.delivery doc comment
    };
}

const RAY_Y: f64 = -66.0; // shooter.y (0) - MUZZLE_ANCHOR_UP (60) - MUZZLE_HAND_SPREAD (6)

fn setupHitscanShooter(state: *root.world_state.WorldState, idx: usize, id: []const u8, range_px: f64, pierce_count: u32) void {
    state.players[idx].flags.alive = true;
    state.players[idx].health = 100;
    state.players[idx].x = 0;
    state.players[idx].y = 0;
    state.players[idx].aim_x = 100_000; // far off-axis point, only its DIRECTION matters
    state.players[idx].aim_y = RAY_Y;
    state.players[idx].current_keys = FIRE_BIT;
    setPlayerId(&state.players[idx], id);
    state.player_fire_config[idx] = hitscanFireConfig(range_px, pierce_count);
}

test "hitscan decoy candidates: a raycast shot damages a non-owner live decoy directly, raw damage only (no headshot/chaos/amp mitigation)" {
    var state = freshFightingState();
    state.player_count = 1;
    setupHitscanShooter(&state, 0, "shooter", 500, 0);

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 200,
        .y = RAY_Y,
        .vx = 0,
        .vy = 0,
        .health = 50,
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = 0, // unowned — a valid candidate for anyone's shot
    };

    _ = root.world.stepWorld(&state, 16.0);

    // 50 - 20 (raw base_damage — no headshot/chaos/shooter-amp; those only
    // apply to the player mitigation chain, `applyHitscanHitOnPlayer`,
    // matching World.ts's `pendingPaperDoubleDamage` push using raw
    // `pellet.damage`) == 30.
    try std.testing.expectApproxEqAbs(@as(f64, 30.0), state.paper_doubles[0].health, 1e-9);
    try std.testing.expectEqual(@as(u32, 1), state.paper_double_count); // still alive, not compacted
}

test "hitscan decoy candidates: owner-exclusion — the shooter's own decoy is never a candidate for their own shot" {
    var state = freshFightingState();
    state.player_count = 1;
    setupHitscanShooter(&state, 0, "shooter", 500, 0);

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 200,
        .y = RAY_Y,
        .vx = 0,
        .vy = 0,
        .health = 50,
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = state.players[0].id_len,
        .owner_id_bytes = state.players[0].id_bytes,
    };

    _ = root.world.stepWorld(&state, 16.0);

    // Untouched — same "a caster's own shot never pops their own decoy"
    // precedent section 4's real-projectile x decoy loop already
    // established (the owner-exclusion projectile test above).
    try std.testing.expectApproxEqAbs(@as(f64, 50.0), state.paper_doubles[0].health, 1e-9);
}

test "hitscan decoy candidates: killing a decoy via hitscan triggers the SAME death-burst the pre-existing generic Paper Double death/expiry burst scan already fires for a projectile kill or lifetime expiry — no extra plumbing needed at the hitscan hit site" {
    var state = freshFightingState();
    state.player_count = 3; // 0 = shooter, 1 = decoy's owner (the caster), 2 = bystander in burst range
    setupHitscanShooter(&state, 0, "shooter", 500, 0);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 1000; // far away — irrelevant to the geometry, just needs a roster slot
    state.players[1].y = 1000;
    setPlayerId(&state.players[1], "caster");

    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = 200; // same x as the decoy
    state.players[2].y = 0; // 66px off the ray's own y — well clear of a direct hit
    setPlayerId(&state.players[2], "bystander");

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 200,
        .y = RAY_Y,
        .vx = 0,
        .vy = 0,
        .health = 15, // dies from the 20-damage hit
        .remaining_ms = 2500,
        .id = 7,
        .owner_id_len = state.players[1].id_len,
        .owner_id_bytes = state.players[1].id_bytes,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 0), state.paper_double_count); // died + compacted this tick
    // Burst: NINJA_PAPER_DOUBLE_BURST_RADIUS_PX=90 (bystander is
    // sqrt(0^2+66^2)=66px away, inside), NINJA_PAPER_DOUBLE_BURST_DAMAGE=10.
    try std.testing.expectApproxEqAbs(@as(f64, 90.0), state.players[2].health, 1e-9);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health); // caster excluded from own burst
    try std.testing.expectEqual(@as(f64, 100.0), state.players[0].health); // shooter untouched
}

test "hitscan pierce: a pierce budget lets the ray continue past a popped decoy to also hit a player standing behind it" {
    var state = freshFightingState();
    state.player_count = 2; // 0 = shooter, 1 = victim behind the decoy
    setupHitscanShooter(&state, 0, "shooter", 500, 1); // pierce_count=1

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 350;
    state.players[1].y = RAY_Y; // dead body-centre — no headshot
    setPlayerId(&state.players[1], "victim");

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 200,
        .y = RAY_Y,
        .vx = 0,
        .vy = 0,
        .health = 10, // dies from the 20-damage hit (clamped to 0)
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = 0,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.paper_doubles[0].health, 1e-9);
    // Plain unbuffed hit: 100 - 20 == 80 — proves the pierced ray reached
    // past the popped decoy and still landed on the player behind it.
    try std.testing.expectApproxEqAbs(@as(f64, 80.0), state.players[1].health, 1e-9);
}

test "hitscan destructible candidates: a raycast shot damages a live destructible directly, raw damage only" {
    var state = freshFightingState();
    state.player_count = 1;
    setupHitscanShooter(&state, 0, "shooter", 500, 0);

    state.destructible_count = 1;
    state.destructibles[0] = .{
        .x = 200,
        .y = RAY_Y,
        .width = 32,
        .height = 64,
        .health = 50,
        .id = 101,
        .flags = 0, // non-explosive, non-flammable — isolates this from any chain question
        .kind = .box,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectApproxEqAbs(@as(f64, 30.0), state.destructibles[0].health, 1e-9); // 50 - 20
    try std.testing.expectEqual(@as(u32, 1), state.destructible_count); // still alive
    var saw_broken = false;
    var ei: u32 = 0;
    while (ei < state.event_count) : (ei += 1) {
        if (state.events[ei].kind == @intFromEnum(root.world_state.SimEventKind.destructible_broken)) saw_broken = true;
    }
    try std.testing.expect(!saw_broken);
}

test "hitscan destructible candidates: breaking a destructible via hitscan emits destructible_broken, with NO exploding-barrel chain-AOE (that chain is a real-projectile-only path in TS too, never wired to the direct-damage funnel non-projectile sources use)" {
    var state = freshFightingState();
    state.player_count = 2; // 0 = shooter, 1 = bystander well within EXPLOSION_RADIUS
    setupHitscanShooter(&state, 0, "shooter", 500, 0);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 210; // 10px from the destructible centre — inside EXPLOSION_RADIUS (80)
    state.players[1].y = RAY_Y;
    setPlayerId(&state.players[1], "bystander");

    state.destructible_count = 1;
    state.destructibles[0] = .{
        .x = 200,
        .y = RAY_Y,
        .width = 32,
        .height = 64,
        .health = 15, // dies from the 20-damage hit
        .id = 101,
        .flags = 1, // explosive barrel — proves the chain STILL doesn't fire via this path
        .kind = .barrel,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.destructibles[0].health, 1e-9);
    var saw_broken = false;
    var ei: u32 = 0;
    while (ei < state.event_count) : (ei += 1) {
        if (state.events[ei].kind == @intFromEnum(root.world_state.SimEventKind.destructible_broken) and
            state.events[ei].entity_id == 101)
        {
            saw_broken = true;
        }
    }
    try std.testing.expect(saw_broken);
    // No chain-AOE leaked in from the hitscan direct-damage path — matches
    // World.ts's own `pendingHangoutDestructibleDamage` apply site
    // (World.ts:6926-6952), which every non-projectile damage source
    // (melee included) funnels through and which never triggers the
    // exploding-barrel reaction; only `stepDestructibles`' own projectile-
    // collision loop does (mirrored at world.zig section 4's `dest_ptr.
    // flags & 1` branch) — a real-projectile-only path, untouched by this
    // pass.
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);
}

test "hitscan pierce: a pierce budget lets the ray continue past a broken destructible to also hit a player standing behind it" {
    var state = freshFightingState();
    state.player_count = 2; // 0 = shooter, 1 = victim behind the destructible
    setupHitscanShooter(&state, 0, "shooter", 500, 1); // pierce_count=1

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 350;
    state.players[1].y = RAY_Y; // dead body-centre — no headshot
    setPlayerId(&state.players[1], "victim");

    state.destructible_count = 1;
    state.destructibles[0] = .{
        .x = 200,
        .y = RAY_Y,
        .width = 32,
        .height = 64,
        .health = 10, // dies from the 20-damage hit (clamped to 0)
        .id = 101,
        .flags = 0,
        .kind = .box,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.destructibles[0].health, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 80.0), state.players[1].health, 1e-9); // 100 - 20
}

test "hitscan candidate priority: the nearer candidate wins regardless of kind — a destructible closer than a decoy is hit first, the farther decoy stays untouched" {
    var state = freshFightingState();
    state.player_count = 1;
    setupHitscanShooter(&state, 0, "shooter", 500, 0); // pierce_count=0 — single hit only

    state.destructible_count = 1;
    state.destructibles[0] = .{
        .x = 150, // nearer to the shooter than the decoy below
        .y = RAY_Y,
        .width = 32,
        .height = 64,
        .health = 50,
        .id = 101,
        .flags = 0,
        .kind = .box,
    };

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 250, // farther — should never be reached with pierce_count=0
        .y = RAY_Y,
        .vx = 0,
        .vy = 0,
        .health = 50,
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = 0,
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectApproxEqAbs(@as(f64, 30.0), state.destructibles[0].health, 1e-9); // hit
    try std.testing.expectApproxEqAbs(@as(f64, 50.0), state.paper_doubles[0].health, 1e-9); // untouched
}

test "hitscan impact-AOE routing + decoy candidates: an explosive-impact shot still applies its own direct point damage to a decoy at the blast centre, additive to the splash (World.ts:3172-3204's 'an explosive shot must still be able to pop a dummy/decoy directly')" {
    var state = freshFightingState();
    state.player_count = 1;
    setupHitscanShooter(&state, 0, "shooter", 500, 0);
    state.player_fire_config[0].impact = .explosive;
    state.player_fire_config[0].impact_radius_px = 64;

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 200,
        .y = RAY_Y,
        .vx = 0,
        .vy = 0,
        .health = 50,
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = 0,
    };

    _ = root.world.stepWorld(&state, 16.0);

    // Same raw-base_damage rule as the plain pierce-loop path above — the
    // explosive-impact branch's own direct-hit write uses the identical
    // `base_damage`, not a splash-scaled amount.
    try std.testing.expectApproxEqAbs(@as(f64, 30.0), state.paper_doubles[0].health, 1e-9);
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count); // drained same tick (6b)
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

    // Tick 1: Fire rising edge -> windup starts (phaseMs = SLASH_WINDUP_MS).
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);

    // Tick 2: dt = SLASH_WINDUP_MS exactly closes windup -> active starts
    // this same tick (phaseMs = SLASH_ACTIVE_MS, elapsed = 0) — too early
    // for contact.
    _ = root.world.stepWorld(&state, root.world.SLASH_WINDUP_MS);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);

    // Tick 3: dt = SLASH_CONTACT_DELAY_MS — elapsed hits exactly that, the
    // contact gate opens, arc hit-check resolves this tick.
    _ = root.world.stepWorld(&state, root.world.SLASH_CONTACT_DELAY_MS);
    try std.testing.expectEqual(@as(f64, 100.0 - root.world.SLASH_DAMAGE), state.players[1].health);
    // Tolerance is looser than the other float checks in this file: the
    // swing direction is captured from `attacker.aimX - attacker.x` at the
    // START of windup (tick 1), AFTER that same tick's physics pass has
    // already nudged the attacker's y down a hair under gravity — a real,
    // tiny, expected deviation from a perfect (1, 0) unit vector, not a
    // bug in the melee code itself.
    try std.testing.expect(@abs(state.players[1].vx - root.world.SLASH_KNOCKBACK) < 0.01); // aimX(~1) * SLASH_KNOCKBACK
    try std.testing.expect(@abs(state.players[1].vy - (-root.world.SLASH_KNOCK_UP)) < 0.01); // aimY(~0)*KB - SLASH_KNOCK_UP

    // Tick 4: still inside the active window and still contact-gated — but
    // the victim is already in hitThisSwing, so no second hit lands.
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(f64, 100.0 - root.world.SLASH_DAMAGE), state.players[1].health);
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
    _ = root.world.stepWorld(&state, root.world.SLASH_WINDUP_MS); // active starts, elapsed = 0

    // dt = one short of SLASH_CONTACT_DELAY_MS — active, in the cone, but
    // still pre-contact: must not damage.
    _ = root.world.stepWorld(&state, root.world.SLASH_CONTACT_DELAY_MS - 1.0);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);

    // One more ms crosses the gate exactly — now it connects.
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(f64, 100.0 - root.world.SLASH_DAMAGE), state.players[1].health);
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
    try std.testing.expectEqual(root.world.SLASH_WINDUP_MS, state.melee_swing[0].phase_ms);

    state.players[0].current_keys = 0; // release
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(root.world.SLASH_WINDUP_MS - 1.0, state.melee_swing[0].phase_ms);

    // Rising edge again, mid-windup: must NOT reset phase_ms back to the
    // full windup value — only an idle-phase rising edge starts a fresh
    // swing.
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(root.world_state.MeleeSwingPhase.windup, state.melee_swing[0].phase);
    try std.testing.expectEqual(root.world.SLASH_WINDUP_MS - 2.0, state.melee_swing[0].phase_ms);
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
    _ = root.world.stepWorld(&state, root.world.SLASH_WINDUP_MS); // active starts

    // Contact tick.
    _ = root.world.stepWorld(&state, root.world.SLASH_CONTACT_DELAY_MS);

    // Fully blocked: zero damage, still alive.
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health);
    // Knockback still lands even though the hit was shield-blocked (TS:
    // `post` gets the knockback velocity unconditionally unless evaded).
    // Tolerance loosened same as the hit test above — the captured swing
    // direction picks up a hair of gravity drift from windup's own tick.
    try std.testing.expect(@abs(state.players[1].vx - root.world.SLASH_KNOCKBACK) < 0.01);
    try std.testing.expect(@abs(state.players[1].vy - (-root.world.SLASH_KNOCK_UP)) < 0.01);

    // Charge drained by tickShield's OWN hold-drain across all 3 ticks this
    // test held Shield (dt = 1 + SLASH_WINDUP_MS + SLASH_CONTACT_DELAY_MS
    // total — section 6 runs every tick regardless of swing phase) plus
    // the melee hit's own SHIELD_HIT_DRAIN_MULTIPLIER-scaled drain on the
    // contact tick — same accounting shape as the instant-AOE shield test
    // above, just summed over more ticks since this test's swing takes 3
    // to reach contact.
    const total_dt = 1.0 + root.world.SLASH_WINDUP_MS + root.world.SLASH_CONTACT_DELAY_MS;
    const tick_shield_drain = root.combat.shieldDrain(root.combat.SHIELD_DRAIN_PER_SECOND, total_dt);
    const hit_drain = root.world.SLASH_DAMAGE * root.combat.SHIELD_HIT_DRAIN_MULTIPLIER;
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
    _ = root.world.stepWorld(&state, root.world.SLASH_WINDUP_MS); // active starts
    _ = root.world.stepWorld(&state, root.world.SLASH_CONTACT_DELAY_MS); // contact tick

    // Full, unmitigated damage — the parry never even gets checked.
    try std.testing.expectEqual(@as(f64, 100.0 - root.world.SLASH_DAMAGE), state.players[1].health);
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
    try std.testing.expectEqual(@as(f64, 62.0), state.players[1].health); // 100 - EDGE_DAMAGE(38)
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

test "ability dispatch: Undercut (Ninja) — cast opens the window and sets cooldown; a landed slash against a victim at/under the execute threshold still lands the ordinary lethal hit (the execute clamp IS load-bearing here: base SLASH_DAMAGE 14 < threshold 15, so the clamp is what actually pushes this to a kill)" {
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

    // Execute clamp: max(SLASH_DAMAGE(14), victim.health(15)) == 15 — the
    // formula is bit-exact with World.ts's own `Math.max`; a plain unclamped
    // slash (14) would only leave the victim at 1 health, so the clamp is
    // what actually produces the kill here (0 health, not alive).
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
    // Suppress the base starter-pistol auto-fire (weapon.zig's
    // weaponTickFire: fires on ANY tick FIRE_BIT is held once cooldown
    // hits 0, independent of class/melee — every player falls back to it
    // when player_fire_config[i].valid is unset, which it is here). The
    // sibling "melee: ninja slash hits" test never notices this because it
    // never calls setPlayerId — both players default to empty id_bytes, so
    // the pistol shard's owner-skip check (id_len==0 == id_len==0, vacuous
    // std.mem.eql on two empty slices) silently treats the victim as the
    // shooter and skips it. This test DOES set real ids (needed for the
    // mark-matching check below), which un-hides that same pistol shot —
    // it lands its own 12.0 dmg mid-test, well before the amp assertion.
    // Pinning the cooldown keeps this test isolated to melee, same as the
    // sibling test achieves by accident.
    state.players[0].fire_cooldown_ms = 999.0;

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
    _ = root.world.stepWorld(&state, root.world.SLASH_WINDUP_MS); // active starts
    _ = root.world.stepWorld(&state, root.world.SLASH_CONTACT_DELAY_MS); // contact tick

    // Proves the amp actually applied (a plain unamplified hit would leave
    // 100 - SLASH_DAMAGE, the base melee test's own number).
    const expected_amped = 100.0 - (root.world.SLASH_DAMAGE * root.world.NINJA_READ_MARK_AMP_MULTIPLIER);
    try std.testing.expect(@abs(state.players[1].health - expected_amped) < 1e-9);
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

    // 100 - (38 * 1.3) == 50.6 — a plain unamplified Edge hit would leave
    // 62.0 (the base melee test's own number, EDGE_DAMAGE=38), proving the
    // amp landed.
    try std.testing.expect(@abs(state.players[1].health - 50.6) < 1e-9);
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

    // First victim (index 1, scanned first): amplified 38 * 1.45 = 55.1,
    // plus the stagger status.
    try std.testing.expect(@abs(state.players[1].health - 44.9) < 1e-9);
    try std.testing.expect(state.players[1].flags.has_slow);
    try std.testing.expect(state.players[1].slowed_until_tick > state.header.tick);
    try std.testing.expect(@abs(state.players[1].slow_multiplier - 0.25) < 1e-9);

    // Second victim: seal already consumed — ordinary damage, no stagger.
    try std.testing.expectEqual(@as(f64, 62.0), state.players[2].health);
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
        // Exactly ONE live wave per cycle: the previous cycle's wave is
        // genuinely dead by now (WAVE_LIFETIME_MS=333 / WAVE_RANGE=260 —
        // ~432ms and ~337px of stepping separate the spawns; TS kills it
        // the same way). The original `cycle + 1` accumulation was an
        // artifact of the pre-Track-E1 lifetime-expiry zombie: a shard
        // whose residual lifetime dropped <= dt froze forever (pre-step
        // short-circuited, lifetime stayed > 0, compaction never removed
        // it) — the count grew only because corpses never left the array.
        try std.testing.expectEqual(@as(u32, 1), countWaveProjectiles(&state));
        try std.testing.expectEqual(@as(u32, 2 - cycle), state.players[0].edge_storm_charges_remaining);
        state.players[0].current_keys = 0;
        _ = root.world.stepWorld(&state, 220.0); // recovery -> idle
    }
    // Window closed early once charges hit 0 (not left to time out).
    try std.testing.expectEqual(@as(u32, 0), state.players[0].edge_storm_until_tick);

    // Sanity-check the surviving (third-cycle) wave's stats (bit-exact,
    // not just "a projectile exists"): damage = WAVE_DAMAGE(10) *
    // multiplier(2.2) = 22; radius 10; straight/crystal, no homing/
    // gravity/bounce/pierce. Earlier cycles' waves are genuinely dead by
    // now (see the per-cycle count comment above).
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
    // Zero waves live: the third cycle's wave expired mid-swing (211ms of
    // stepping pushed it past WAVE_LIFETIME_MS/WAVE_RANGE) and — the
    // actual assertion — no 4th wave spawned to replace it. (Was `3`
    // before Track E1 for the same zombie-corpse reason as the per-cycle
    // count above.)
    try std.testing.expectEqual(@as(u32, 0), countWaveProjectiles(&state));
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

// ── AOE-queue abilities (this pass, docs/zig-step-world-parity-goal.md
//    Phase 1's 2nd unblock) — Wall Bloom, Shock Ring, Prism Fan, Flock
//    Pulse, Shard Ring push onto the `PendingInstantAoe` queue from commit
//    4340859; Paper Double's cast spawns a `PaperDoubleEntity` and its
//    death/expiry burst pushes onto that same queue via section 6y's new
//    detection pass. ──────────────────────────────────────────────────────

test "ability dispatch: Prism Fan (Wizard) — instant cone AOE straight from the cast, build-scaled damage (not a flat constant), hits inside the cone and misses outside it at the same range" {
    var state = freshFightingState();
    state.player_count = 3; // 0 = wizard caster, 1 = in the cone, 2 = same range but outside it
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced; // wizard
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[0].aim_x = 100; // aim straight along +x
    state.players[0].aim_y = 0;
    state.player_fire_config[0] = .{ .damage = 20, .fire_rate = 4, .projectile_speed = 1, .projectile_lifetime_seconds = 1, .spread_radians = 0, .range_px = 1, .homing_strength = 0, .acceleration_multiplier = 0, .gravity_scale = 0, .slow_multiplier = 1, .impact_radius_px = 0, .size_multiplier = 1, .speed_multiplier = 1, .lifetime_multiplier = 1, .projectile_count = 1, .bounces = 0, .pierce_count = 0, .split_count = 0, .shape = .circle, .element = .neutral, .pathing = .straight, .impact = .none, .valid = 1 };
    equipSlot(&state, 0, 0, .prism_fan);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 100; // dead ahead, well inside GEO_PRISM_FAN_CONE_RADIANS
    state.players[1].y = 0;

    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = 0; // same 100px range, 90 degrees off-axis: outside the cone
    state.players[2].y = 100;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    // build.damage (20) * GEO_PRISM_FAN_DAMAGE_MULTIPLIER (0.5) = 10.
    try std.testing.expectEqual(@as(f64, 90.0), state.players[1].health); // in the cone
    try std.testing.expectEqual(@as(f64, 100.0), state.players[2].health); // in radius, outside the cone
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count); // drained
}

test "ability dispatch: Shard Ring (Ninja) — instant self-centered radius AOE, flat NINJA_SHARD_RING_DAMAGE (not build-scaled), hits inside the radius and misses outside it" {
    var state = freshFightingState();
    state.player_count = 3; // 0 = ninja caster, 1 = in radius, 2 = out of radius
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    // Deliberately no player_fire_config seeded (stays zeroed/invalid) —
    // proves this ability's damage is NOT read from build.damage at all.
    equipSlot(&state, 0, 0, .shard_ring);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 100; // within NINJA_SHARD_RING_RADIUS_PX (150)
    state.players[1].y = 0;

    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = 400; // well outside
    state.players[2].y = 0;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 86.0), state.players[1].health); // 100 - 14
    try std.testing.expectEqual(@as(f64, 100.0), state.players[2].health);
}

test "ability dispatch: Flock Pulse (Priest) — instant self-centered radius AOE + slow, resolves to SYZ_FLOCK_PULSE_BASE_DAMAGE only (ally/enemy source-count scaling correctly deferred, Phase 3 substrate), never build-scaled" {
    var state = freshFightingState();
    state.player_count = 2; // 0 = priest caster, 1 = victim in radius
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded; // priest
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    equipSlot(&state, 0, 0, .flock_pulse);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 50; // within SYZ_FLOCK_PULSE_RADIUS_PX (170)
    state.players[1].y = 0;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    // SYZ_FLOCK_PULSE_BASE_DAMAGE (8) only — no ally/enemy source ever
    // populated on Zig's PlayerEntity today, so sourceCount is honestly 0,
    // matching what TS itself would compute for a solo caster with zero
    // live buffs (not an invented substitute).
    try std.testing.expectEqual(@as(f64, 92.0), state.players[1].health); // 100 - 8
    try std.testing.expect(state.players[1].flags.has_slow);
    try std.testing.expect(@abs(state.players[1].slow_multiplier - 0.8) < 1e-9);
    try std.testing.expect(state.players[1].slowed_until_tick > state.header.tick);
}

test "ability dispatch: Wall Bloom (Ninja) — cast opens the window and sets cooldown" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    equipSlot(&state, 0, 0, .wall_bloom); // duration 9000ms, cooldown 7000ms

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1000.0); // tick=1
    try std.testing.expectEqual(@as(u32, 10), state.players[0].wall_bloom_until_tick); // 1+9
    try std.testing.expectEqual(@as(u32, 8), state.players[0].slot_cooldown_until_tick[0]); // 1+7
}

test "ability dispatch: Wall Bloom (Ninja) — a wall-kick (Jump rising edge while airborne + touching a wall LAST tick) while the window is LIVE consumes it and pushes a wall-contact AOE burst; window is cleared" {
    var state = freshFightingState();
    state.player_count = 2; // 0 = ninja, 1 = victim near the wall-contact point
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].x = 300;
    state.players[0].y = 300;
    state.players[0].wall_bloom_until_tick = 100; // live, far beyond this test's tick=1
    state.player_movement[0].touching_wall_dir = 1; // touching a wall to the right, LAST tick
    state.player_movement[0].grounded_last_frame = 0; // airborne LAST tick

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    // Wall-contact point ~= caster.x + 19 (PLAYER_BODY_WIDTH/2 + 6); a
    // generous placement well within NINJA_WALL_BLOOM_RADIUS_PX (110) of
    // wherever the caster's own tiny single-tick physics drift lands.
    state.players[1].x = 320;
    state.players[1].y = 300;

    const jump_bit: u32 = 1 << 4;
    state.players[0].current_keys = jump_bit; // rising edge (prev_keys starts 0)
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 90.0), state.players[1].health); // 100 - NINJA_WALL_BLOOM_DAMAGE(10)
    try std.testing.expectEqual(@as(u32, 0), state.players[0].wall_bloom_until_tick); // cleared, single-use
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count); // drained
}

test "ability dispatch: Wall Bloom (Ninja) — a wall-kick with an EXPIRED window pushes NO AOE and does not touch the (already-lapsed) window value — negative case, both cast AND trigger are required" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].x = 300;
    state.players[0].y = 300;
    state.players[0].wall_bloom_until_tick = 1; // expires exactly AT tick 1 (gate is `> tick`, 1 > 1 is false)
    state.player_movement[0].touching_wall_dir = 1;
    state.player_movement[0].grounded_last_frame = 0;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 320;
    state.players[1].y = 300;

    const jump_bit: u32 = 1 << 4;
    state.players[0].current_keys = jump_bit;
    _ = root.world.stepWorld(&state, 16.0); // tick becomes 1

    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health); // untouched — no burst
    try std.testing.expectEqual(@as(u32, 1), state.players[0].wall_bloom_until_tick); // unchanged — never live, never consumed
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count);
}

test "ability dispatch: Shock Ring (Paladin) — cast opens the window, hops (vy = -KIN_SHOCK_RING_HOP_VY), and sets cooldown" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy;
    state.players[0].health = 100;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    equipSlot(&state, 0, 0, .shock_ring); // duration 1500ms, cooldown 9000ms

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1000.0); // tick=1
    try std.testing.expectEqual(@as(u32, 3), state.players[0].shock_ring_armed_until_tick); // 1+ceil(1500/1000)
    try std.testing.expectEqual(@as(u32, 10), state.players[0].slot_cooldown_until_tick[0]); // 1+9
    try std.testing.expect(@abs(state.players[0].vy - (-420.0)) < 1e-9);
}

test "ability dispatch: Shock Ring (Paladin) — landing (airborne LAST tick, grounded THIS tick, real floor collision) while the window is LIVE consumes it and pushes a slam AOE at the landing spot; window is cleared" {
    var state = freshFightingState();
    state.player_count = 2; // 0 = paladin falling onto a floor, 1 = victim near the landing spot
    state.static_count = 1;
    state.statics[0] = .{ .x = 0, .y = 600, .w = 1280, .h = 40 }; // floor surface at y=600
    state.one_way[0] = 0;

    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy;
    state.players[0].health = 100;
    state.players[0].x = 300;
    state.players[0].y = 600 - 28 - 40; // 40px above standing height
    state.players[0].vy = 600; // falling fast enough to cross the gap in one tick
    state.player_movement[0].grounded_last_frame = 0; // airborne LAST tick
    state.players[0].shock_ring_armed_until_tick = 100; // live, far beyond this test's tick=1

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 320; // within KIN_SHOCK_RING_RADIUS_PX (170) of the landing spot
    state.players[1].y = 572;

    _ = root.world.stepWorld(&state, 100.0); // tick=1: falls, lands, slams

    try std.testing.expect(state.players[0].flags.grounded); // really landed (physics-driven, not asserted)
    try std.testing.expectEqual(@as(f64, 82.0), state.players[1].health); // 100 - KIN_SHOCK_RING_DAMAGE(18)
    try std.testing.expectEqual(@as(u32, 0), state.players[0].shock_ring_armed_until_tick); // cleared, single-use
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count);
}

test "ability dispatch: Shock Ring (Paladin) — a real landing with an EXPIRED window pushes NO AOE and does not touch the (already-lapsed) window value — negative case, both cast AND trigger are required" {
    var state = freshFightingState();
    state.player_count = 2;
    state.static_count = 1;
    state.statics[0] = .{ .x = 0, .y = 600, .w = 1280, .h = 40 };
    state.one_way[0] = 0;

    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy;
    state.players[0].health = 100;
    state.players[0].x = 300;
    state.players[0].y = 600 - 28 - 40;
    state.players[0].vy = 600;
    state.player_movement[0].grounded_last_frame = 0;
    state.players[0].shock_ring_armed_until_tick = 1; // expires exactly AT tick 1

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 320;
    state.players[1].y = 572;

    _ = root.world.stepWorld(&state, 100.0); // tick=1: falls, lands — but window is not live

    try std.testing.expect(state.players[0].flags.grounded); // landing itself still genuinely happens
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health); // untouched — no burst
    try std.testing.expectEqual(@as(u32, 1), state.players[0].shock_ring_armed_until_tick); // unchanged
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count);
}

test "ability dispatch: Paper Double (Ninja) cast — a running caster spawns a decoy sprinting the CURRENT horizontal-velocity direction (not the aim direction)" {
    var state = freshFightingState();
    // 2 players, not 1: with only 1 the round ends in a KO on tick 1
    // (round.detectRoundWinner's alive_count==1 branch), flipping
    // round_phase off .fighting and making stepAbilityDispatch's own
    // phase gate a no-op — same bystander precedent the cooldown-gating
    // test above uses.
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].x = 111;
    state.players[0].y = 222;
    state.players[0].vx = -400; // running left, well above the stationary threshold (5px/s)
    state.players[0].aim_x = 500; // aim points RIGHT — must NOT be used while running
    state.players[0].aim_y = 222;
    setPlayerId(&state.players[0], "caster-1");
    equipSlot(&state, 0, 0, .paper_double);
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 1), state.paper_double_count);
    const pd = state.paper_doubles[0];
    try std.testing.expect(@abs(pd.vx - (-362.0)) < 1e-6);
    try std.testing.expectEqual(@as(f64, 0.0), pd.vy); // horizontal-only direction
    try std.testing.expectEqual(@as(f64, 20.0), pd.health); // NINJA_PAPER_DOUBLE_MAX_HEALTH
    // NINJA_PAPER_DOUBLE_LIFETIME_MS (2500) minus this SAME tick's 16ms
    // lifetime drain: since the Z0c Item B reorder, section 2b's decoy
    // step runs AFTER the 6z cast within one tick — the exact cadence TS
    // has (pendingPaperDoubleSpawns merges into paperDoublesForStep
    // BEFORE stepPaperDoubles runs, World.ts:6547-6551).
    try std.testing.expectEqual(@as(f64, 2484.0), pd.remaining_ms);
    try std.testing.expectEqual(@as(u8, 8), pd.owner_id_len);
    try std.testing.expectEqualSlices(u8, "caster-1", pd.owner_id_bytes[0..8]);
}

test "ability dispatch: Paper Double (Ninja) cast — a horizontally-stationary caster falls back to the aim direction" {
    var state = freshFightingState();
    // Same "2 players, not 1" bystander reasoning as the test above.
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[0].vx = 0; // below the stationary threshold
    state.players[0].aim_x = 0;
    state.players[0].aim_y = -100; // aiming straight up
    setPlayerId(&state.players[0], "caster-2");
    equipSlot(&state, 0, 0, .paper_double);
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 1), state.paper_double_count);
    const pd = state.paper_doubles[0];
    try std.testing.expect(@abs(pd.vx - 0.0) < 1e-6); // dirX = 0 (aim is pure vertical)
    try std.testing.expect(@abs(pd.vy - (-362.0)) < 1e-6); // dirY = -1 (aim up)
}

test "ability dispatch: Paper Double burst — a decoy that dies (health <= 0) THIS tick pushes a PendingInstantAoe entry that genuinely reaches the SAME tick's AOE resolver, strictly AFTER section 6 (a shield raised THIS tick still blocks it) — the ordering property, same rigor as commit 4340859's own 'resolved strictly AFTER' test" {
    var state = freshFightingState();
    state.player_count = 2; // 0 = decoy's owner, 1 = victim who raises shield THIS tick
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    setPlayerId(&state.players[0], "owner-1");

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 20; // within NINJA_PAPER_DOUBLE_BURST_RADIUS_PX (90) of the decoy
    state.players[1].y = 0;
    state.players[1].flags.shield_active = false; // NOT active before this tick
    state.players[1].flags.has_shield_charge = true;
    state.players[1].shield_charge = 80;
    state.players[1].current_keys = SHIELD_BIT; // victim raises it THIS same tick

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 0,
        .y = 0,
        .vx = 0,
        .vy = 0,
        .health = 0, // already dead entering this tick's section "2b"/4
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = 7,
        .owner_id_bytes = blk: {
            var b: [root.world_state.PLAYER_ID_BYTES]u8 = @splat(0);
            @memcpy(b[0..7], "owner-1");
            break :blk b;
        },
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 0), state.paper_double_count); // compacted away this same tick
    try std.testing.expect(state.players[1].flags.shield_active); // proof #1: shield really did activate THIS tick
    try std.testing.expectEqual(@as(f64, 100.0), state.players[1].health); // proof #2: burst saw the up-to-date shield, fully blocked
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count);
}

test "ability dispatch: Paper Double burst — a decoy that EXPIRES (remaining_ms <= 0) THIS tick also bursts, landing NINJA_PAPER_DOUBLE_BURST_DAMAGE on an unshielded victim in range" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    setPlayerId(&state.players[0], "owner-2");

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 30; // within NINJA_PAPER_DOUBLE_BURST_RADIUS_PX (90)
    state.players[1].y = 0;

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 0,
        .y = 0,
        .vx = 0,
        .vy = 0,
        .health = 20,
        .remaining_ms = 10, // expires this tick (dt=16ms > 10ms remaining)
        .id = 1,
        .owner_id_len = 7,
        .owner_id_bytes = blk: {
            var b: [root.world_state.PLAYER_ID_BYTES]u8 = @splat(0);
            @memcpy(b[0..7], "owner-2");
            break :blk b;
        },
    };

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 0), state.paper_double_count);
    try std.testing.expectEqual(@as(f64, 90.0), state.players[1].health); // 100 - NINJA_PAPER_DOUBLE_BURST_DAMAGE(10)
}

test "ability dispatch: Paper Double burst — a decoy whose owner no longer exists in the roster bursts into NOTHING (matches resolveInstantAoeCasts's own `if (!caster) continue`), no crash" {
    var state = freshFightingState();
    state.player_count = 1; // no player has id "ghost-owner"
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    state.players[0].x = 10;
    state.players[0].y = 0;

    state.paper_double_count = 1;
    state.paper_doubles[0] = .{
        .x = 0,
        .y = 0,
        .vx = 0,
        .vy = 0,
        .health = 0,
        .remaining_ms = 2500,
        .id = 1,
        .owner_id_len = 11,
        .owner_id_bytes = blk: {
            var b: [root.world_state.PLAYER_ID_BYTES]u8 = @splat(0);
            @memcpy(b[0..11], "ghost-owner");
            break :blk b;
        },
    };

    _ = root.world.stepWorld(&state, 16.0); // must not crash

    try std.testing.expectEqual(@as(u32, 0), state.paper_double_count); // still compacted away
    try std.testing.expectEqual(@as(f64, 100.0), state.players[0].health); // no burst — no valid caster
    try std.testing.expectEqual(@as(u32, 0), state.pending_instant_aoe_count);
}

// ── Phase 4a: self-only window buffs (docs/zig-step-world-parity-goal.md
//    "4a. Self-only window buffs") — Sunlance/Overclock/Measure (window
//    fields, consumed at world.zig's weapon-fire composition chain) and
//    Return Glass/Bastion Pulse (instant shield-charge ticks, no window
//    field at all). Same "cast, assert field set, then step through to the
//    consumption site and assert the OUTCOME differs" rigor as the Phase 1
//    tests above. All 5 use a 1.0ms tick (Undercut's own precedent) so
//    duration/cooldown resolve to generous tick counts.
//
// Ordering note load-bearing to every window test below: section 6 (shield/
// parry/weapon-fire, world.zig) runs BEFORE section 6z (ability dispatch)
// every tick — see sunlance_until_tick's own doc comment (world_state.zig)
// — so a cast on tick N cannot buff a shot fired on that SAME tick N; the
// buff is only observable starting tick N+1. Every test below casts on one
// tick (Fire NOT held) then fires on the NEXT tick, matching that real
// ordering rather than fighting it.

test "ability dispatch: Sunlance (Wizard) — window amplifies the fired shot's damage by GEO_SUNLANCE_DAMAGE_MULTIPLIER (1.6x) starting the tick AFTER cast" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced; // wizard
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000; // far away, never interacts
    equipSlot(&state, 0, 0, .sunlance); // duration 700ms, cooldown 7000ms

    // Tick 1: cast only (Fire NOT held) — no fire this tick to contaminate
    // the "buffed vs base" comparison.
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expect(state.players[0].sunlance_until_tick > state.header.tick);
    try std.testing.expectEqual(@as(u32, 0), state.projectile_count);

    // Tick 2: hold Fire only — window is live, base starter pistol
    // (damage 12.0, weapons.zig STARTER_PISTOL) fires buffed.
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    try std.testing.expectApproxEqAbs(@as(f64, 12.0 * 1.6), state.projectiles[0].damage, 1e-9);
}

test "ability dispatch: Overclock (Wizard) — window raises the fired shot's effective fire rate by GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER (1.35x), observed via the post-fire cooldown" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    // Deliberately NOT .balanced (wizard): character_id == .balanced also
    // gates the Geometrician basic-fire ramping channel
    // (`is_wizard_channel`, world.zig's weapon-fire section), which would
    // accrue `channel_hold_ms` the instant Fire is held on tick 2 below and
    // silently contaminate the precise cooldown assertion with a SECOND
    // fire-rate multiplier this test isn't trying to isolate — same
    // "pin what's not being tested" discipline as the Read Mark test's own
    // fire_cooldown_ms pin. The ability-cast dispatch switch itself doesn't
    // gate on classId (only the draft/offer roll does, TS-side), so the
    // choice of character here has zero effect on Overclock's own mechanic.
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    equipSlot(&state, 0, 0, .overclock); // duration 3000ms, cooldown 10000ms

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 1: cast only
    try std.testing.expect(state.players[0].overclock_until_tick > state.header.tick);

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 2: buffed fire
    // Starter pistol fire_rate = 4.0 shots/sec -> base cooldown 250ms;
    // Overclock raises the effective rate to 4.0*1.35 -> cooldown
    // 1000/(4*1.35) ≈ 185.185ms (weapon.zig's cooldownFromFireRate).
    try std.testing.expectApproxEqAbs(@as(f64, 1000.0 / (4.0 * 1.35)), state.players[0].fire_cooldown_ms, 1e-6);
}

test "ability dispatch: Measure (Wizard) — window forces fired-shot spread to exactly 0 AND amplifies damage by GEO_MEASURE_DAMAGE_MULTIPLIER (1.3x); ranked BELOW Sunlance in the damage-priority chain when both are somehow live" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    // Force a resolved 2-shot spread build — a 1-shot build's offset is
    // always 0 regardless of spread (proj_count <= 1 branch), so the
    // spread-zero effect needs a real multi-shot fan to be observable at
    // all, same "can't tell the difference" caveat weapon.ts's own
    // multi-shot fan comment notes.
    state.player_fire_config[0] = .{ .damage = 10, .fire_rate = 4, .projectile_speed = 1, .projectile_lifetime_seconds = 1, .spread_radians = 0.5, .range_px = 1, .homing_strength = 0, .acceleration_multiplier = 0, .gravity_scale = 0, .slow_multiplier = 1, .impact_radius_px = 0, .size_multiplier = 1, .speed_multiplier = 1, .lifetime_multiplier = 1, .projectile_count = 2, .bounces = 0, .pierce_count = 0, .split_count = 0, .shape = .circle, .element = .neutral, .pathing = .straight, .impact = .none, .valid = 1 };
    equipSlot(&state, 0, 0, .measure); // duration 700ms, cooldown 9000ms

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 1: cast only
    try std.testing.expect(state.players[0].measure_until_tick > state.header.tick);

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 2: buffed fire
    try std.testing.expectEqual(@as(u32, 2), state.projectile_count);
    // Damage amp: 10.0 * GEO_MEASURE_DAMAGE_MULTIPLIER (1.3), not Sunlance's
    // 1.6 (not equipped here, so no priority conflict to resolve).
    try std.testing.expectApproxEqAbs(@as(f64, 10.0 * 1.3), state.projectiles[0].damage, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 10.0 * 1.3), state.projectiles[1].damage, 1e-9);
    // Spread-zero: both shots of the 2-shot fan land at THE SAME angle
    // (offset 0 either side) instead of the build's real 0.5rad spread —
    // proven via identical velocity vectors, not just "didn't crash".
    try std.testing.expectApproxEqAbs(state.projectiles[0].vx, state.projectiles[1].vx, 1e-9);
    try std.testing.expectApproxEqAbs(state.projectiles[0].vy, state.projectiles[1].vy, 1e-9);
}

test "ability dispatch: Return Glass (Wizard) — instant self shield-charge tick (+GEO_RETURN_GLASS_SHIELD_REFUND, 22.0), capped at the resolved max charge" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced;
    state.players[0].health = 100;
    state.players[0].flags.has_shield_charge = true;
    state.players[0].shield_charge = 0;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    equipSlot(&state, 0, 0, .return_glass); // cooldown 10000ms, no duration

    // Tick 1: cast. tickShield (section 6) recharges the tracked 0 charge
    // by a small amount BEFORE dispatch (section 6z) adds the refund —
    // computed via the same combat.shieldDrain helper world.zig itself
    // calls, not a hardcoded magic number, so this stays robust to a
    // future SHIELD_RECHARGE_PER_SECOND tuning change.
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    const recharge_tick1 = root.combat.shieldDrain(root.combat.SHIELD_RECHARGE_PER_SECOND, 1.0);
    try std.testing.expectApproxEqAbs(recharge_tick1 + 22.0, state.players[0].shield_charge, 1e-9);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);

    // Second cast near max charge proves the CAP, not just the add — bypass
    // the real cooldown (directly clear it) to isolate the cap behavior,
    // same "directly clear cooldown to isolate one property" convention
    // Wall Bloom/Shock Ring's own negative-case tests already use.
    state.players[0].shield_charge = 90.0;
    state.players[0].slot_cooldown_until_tick[0] = 0;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0); // release — new rising edge available
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // recast — 90 + recharge*2 + 22 well over 100
    try std.testing.expectEqual(@as(f64, 100.0), state.players[0].shield_charge);
}

test "ability dispatch: Bastion Pulse (Paladin) — instant self shield-charge tick (+KIN_BASTION_PULSE_SHIELD_REFUND, 22.0), doubled when Ward (Shield input) is actively held at cast time" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy; // paladin
    state.players[0].health = 100;
    state.players[0].flags.has_shield_charge = true;
    state.players[0].shield_charge = 0;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    equipSlot(&state, 0, 0, .bastion_pulse); // cooldown 8000ms, no duration

    // Tick 1: cast WITHOUT Ward held — single refund.
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    const recharge_tick1 = root.combat.shieldDrain(root.combat.SHIELD_RECHARGE_PER_SECOND, 1.0);
    try std.testing.expectApproxEqAbs(recharge_tick1 + 22.0, state.players[0].shield_charge, 1e-9);

    // Reset for a second cast, bypassing the real cooldown (same isolation
    // convention as Return Glass's own cap test above). Charge is left at
    // 10.0 (not 0) so THIS tick's shield-drain (Ward held, real drain
    // applies) can't zero it back out before shield_active gets checked.
    state.players[0].shield_charge = 10.0;
    state.players[0].slot_cooldown_until_tick[0] = 0;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0); // release — new rising edge available; also recharges
    const recharge_release_tick = root.combat.shieldDrain(root.combat.SHIELD_RECHARGE_PER_SECOND, 1.0);

    // Tick 3: hold Ward (Shield input) + the ability slot on the SAME
    // tick — tickShield (section 6) runs before dispatch (section 6z)
    // every tick, so shield_active already reflects THIS tick's held
    // input by the time Bastion Pulse reads it (mirrors World.ts's
    // identical same-tick ordering, `nextEntity.shieldActive`).
    state.players[0].current_keys = SLOT1_BIT | SHIELD_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    const drained_tick3 = root.combat.shieldDrain(root.combat.SHIELD_DRAIN_PER_SECOND, 1.0);
    const charge_before_tick3 = 10.0 + recharge_release_tick;
    const expected = @min(100.0, (charge_before_tick3 - drained_tick3) + 22.0 * 2.0);
    try std.testing.expectApproxEqAbs(expected, state.players[0].shield_charge, 1e-9);
    try std.testing.expect(state.players[0].flags.shield_active); // Ward was genuinely held+charged
}

test "ability dispatch: Facet Break (Wizard) — marks the nearest foe in the aim cone; a candidate outside the cone is ignored and burns no cooldown; the NEXT landed RANGED hit (a plain starter-pistol shot, not an ability projectile) against the marked victim is amplified" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced; // wizard
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    setPlayerId(&state.players[0], "attacker");
    equipSlot(&state, 0, 0, .facet_break); // range 900px, cone 60deg, duration 4000ms

    // Off-axis (90 degrees), well outside GEO_FACET_BREAK_CONE_RADIANS (60
    // deg total, 30 deg half-width) — must NOT be marked.
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 0;
    state.players[1].y = 50;
    setPlayerId(&state.players[1], "victim");

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 1: dead press, off-cone
    try std.testing.expectEqual(@as(u32, 0), state.players[0].facet_mark_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]);

    // Move the victim dead ahead (close range — this test drives a REAL
    // pistol shot across REAL travel ticks, unlike the melee-hook ability
    // tests, so keeping the distance small avoids needing a long, fragile
    // travel loop) and re-press.
    state.players[1].x = 15;
    state.players[1].y = 0;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0); // release (so the next press is a rising edge)
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 3: cast — marks "victim"
    try std.testing.expect(state.players[0].facet_mark_until_tick > state.header.tick);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
    try std.testing.expectEqualSlices(u8, "victim", state.players[0].facet_target_id_bytes[0..state.players[0].facet_target_id_len]);

    // Tick 4: fire ONE shot (mark opened tick 3, read tick 4 — the
    // established one-tick lag every window-buff composition site in this
    // file already has, same as Sunlance's own test). fire_cooldown_ms
    // starts 0 (zeroed state), so this fires immediately, spawning at the
    // offset alternating-hand MUZZLE (Track Z0b Item B, ≈ (29.7, -49.2)
    // for this geometry) — the victim at (15,0) sits clear of that spawn
    // point AND of its first tick of travel (Z0c Item B: a fired shard
    // now integrates + hit-checks on its SPAWN tick, TS's own cadence),
    // so the shot is still live and mid-flight here. The mark's amp is
    // NOT baked into the projectile's own damage field (unlike Sunlance/
    // Measure): it's applied at the HIT-CONFIRM site, keyed to the
    // victim's id, so the spawned shot's damage is the plain base 12.0.
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    try std.testing.expectApproxEqAbs(@as(f64, 12.0), state.projectiles[0].damage, 1e-9);

    // Tick 5: release Fire (so cooldown ticking down doesn't spawn a
    // SECOND shot this same call — a fresh spawn wouldn't have traveled
    // yet, contaminating the single-shot damage assertion below) and park
    // the marked victim directly ON the live shard so this tick's hit
    // pass resolves it (the mark is id-keyed — moving the victim changes
    // nothing else; geometry-proof against future muzzle tweaks).
    state.players[1].x = state.projectiles[0].x;
    state.players[1].y = state.projectiles[0].y;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0);
    // 100 - (12.0 * 1.25) == 85.0 — a plain unamplified pistol hit would
    // leave 88.0, proving the mark's amp landed on the marked victim.
    try std.testing.expectApproxEqAbs(@as(f64, 85.0), state.players[1].health, 1e-9);
}

test "ability dispatch: Facet Break (Wizard) — no enemy in the aim cone: a dead press, no mark, no cooldown burn" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000; // far outside GEO_FACET_BREAK_RANGE_PX (900)
    equipSlot(&state, 0, 0, .facet_break);

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].facet_mark_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]);
}

test "ability dispatch: Focus Hex (Priest) — marks the NEAREST enemy within range (ignoring one out of range, omnidirectional — no cone), and the NEXT landed RANGED hit against that exact target is amplified" {
    var state = freshFightingState();
    state.player_count = 3;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded; // priest
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    setPlayerId(&state.players[0], "attacker");
    equipSlot(&state, 0, 0, .focus_hex); // range 420px (SYZ_ENEMY_SEARCH_RANGE_PX), duration 4000ms

    // Nearest — close range, dead ahead, inside SYZ_ENEMY_SEARCH_RANGE_PX.
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 15;
    state.players[1].y = 0;
    setPlayerId(&state.players[1], "nearest");

    // Farther, OUTSIDE SYZ_ENEMY_SEARCH_RANGE_PX (420) — a distractor to
    // prove "nearest in range," not "first," is selected, and that an
    // out-of-range candidate is correctly excluded (omnidirectional: this
    // one sits directly BEHIND the caster, angle irrelevant since Focus
    // Hex has no cone, only range).
    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = -500;
    state.players[2].y = 0;
    setPlayerId(&state.players[2], "too-far");

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 1: cast — marks "nearest"
    try std.testing.expect(state.players[0].focus_hex_mark_until_tick > state.header.tick);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
    try std.testing.expectEqualSlices(u8, "nearest", state.players[0].focus_hex_target_id_bytes[0..state.players[0].focus_hex_target_id_len]);

    // Tick 2: fire — one-tick lag (mark opened tick 1, read tick 2). The
    // "nearest" victim at (15,0) sits clear of the offset-muzzle spawn
    // point and its first tick of travel (Z0c Item B: fired shards now
    // integrate + hit-check on their spawn tick, TS's cadence), so the
    // shot is still live and mid-flight at the asserts below.
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    try std.testing.expectApproxEqAbs(@as(f64, 12.0), state.projectiles[0].damage, 1e-9); // unamplified at spawn — amp is hit-site-only

    // Tick 3: release Fire and park the marked victim directly ON the
    // live shard so this tick's hit pass resolves it (see the Facet Break
    // test's matching comment).
    state.players[1].x = state.projectiles[0].x;
    state.players[1].y = state.projectiles[0].y;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0);
    // 100 - (12.0 * 1.28) == 84.64 — a plain unamplified pistol hit would
    // leave 88.0, proving the mark's amp landed on the marked victim only
    // ("too-far" never entered the shard's path at all).
    try std.testing.expectApproxEqAbs(@as(f64, 84.64), state.players[1].health, 1e-9);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[2].health);
}

test "ability dispatch: Focus Hex (Priest) — no enemy within range: a dead press, no mark, no cooldown burn" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded; // priest
    state.players[0].health = 100;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000; // far outside SYZ_ENEMY_SEARCH_RANGE_PX (420)
    equipSlot(&state, 0, 0, .focus_hex);

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].focus_hex_mark_until_tick);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]);
}

// ── Phase 4a follow-up (this pass, docs/zig-step-world-parity-goal.md —
//    closing Hard Aperture/Self-Lattice's original deferrals): both cast
//    a ward-shaped defense window on the CASTER; both are proven here by
//    showing a landed hit against the warded player deals LESS damage than
//    an identical unwarded hit would, not just that the cast writes a
//    field (the exact bar the parent task set).
test "ability dispatch: Hard Aperture (Wizard) — cast opens ward_shell_until_tick; the NEXT landed ranged hit against the warded player is halved by EMISSION_WARD_DAMAGE_MULT" {
    var state = freshFightingState();
    state.player_count = 2;
    // Player 0 = the warded Wizard (victim). Player 1 = the shooter.
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced; // wizard
    state.players[0].health = 100;
    // Away from the shooter's muzzle + first-tick shard path (Z0c Item B:
    // fired shards now integrate + hit-check on their spawn tick, TS's
    // cadence) — the victim snaps onto the live shard just before the hit
    // tick below. Hard Aperture's cast is self-targeted, so the warded
    // victim's position is free.
    state.players[0].x = 300;
    state.players[0].y = 0;
    setPlayerId(&state.players[0], "victim");
    equipSlot(&state, 0, 0, .hard_aperture); // duration 600ms, cooldown 9000ms

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 0;
    state.players[1].y = 0;
    state.players[1].aim_x = 100;
    state.players[1].aim_y = 0;
    setPlayerId(&state.players[1], "shooter"); // distinct non-empty ids — an empty-vs-empty id
    // match would wrongly skip the victim as "the projectile's own owner"
    // in section 4's owner-skip check (the same hazard Facet Break/Read
    // Mark's own test comments already document).

    // Tick 1: cast only — no fire this tick.
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expect(state.players[0].ward_shell_until_tick > state.header.tick);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);

    // Tick 2: release the ability press, shooter fires a plain starter
    // pistol shot (damage 12.0, weapons.zig STARTER_PISTOL) — spawns
    // un-amplified (the ward multiplier is a HIT-SITE mitigation, not baked
    // into the projectile's own damage field, same shape Facet Break/Focus
    // Hex's own tests already establish for their amp multipliers).
    state.players[0].current_keys = 0;
    state.players[1].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    try std.testing.expectApproxEqAbs(@as(f64, 12.0), state.projectiles[0].damage, 1e-9);

    // Tick 3: release Fire and park the warded victim directly ON the
    // live shard so this tick's hit pass resolves it (same snap-onto-the-
    // shard shape Facet Break/Focus Hex's own tests use). 100 - (12.0 *
    // 0.5) == 94.0 — a plain unwarded pistol hit would leave 88.0,
    // proving the ward halved this landed hit.
    state.players[0].x = state.projectiles[0].x;
    state.players[0].y = state.projectiles[0].y;
    state.players[1].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectApproxEqAbs(@as(f64, 94.0), state.players[0].health, 1e-9);
}

test "ability dispatch: Self-Lattice (Priest) — cast opens a flat absorb pool; a landed Ninja Slash against the warded Priest is FULLY absorbed (11 < pool 20), leaving the pool partially drained and still live" {
    var state = freshFightingState();
    state.player_count = 2;
    // Player 0 = the Ninja attacker (melee). Player 1 = the warded Priest.
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;

    state.players[1].flags.alive = true;
    state.players[1].character_id = .shielded; // priest
    state.players[1].health = 100;
    state.players[1].x = 40; // inside SLASH_RANGE (78px)
    state.players[1].y = 0;
    equipSlot(&state, 1, 0, .self_lattice); // SYZ_SELF_LATTICE_ABSORB = 20, no duration field (fixed 360-tick window)

    // Tick 1: Priest casts Self-Lattice AND the Ninja's Fire rising edge
    // starts the slash windup, same tick (independent players, no
    // interaction hazard — mirrors the Undercut test's own "cast + windup
    // start on the same tick" pattern).
    state.players[1].current_keys = SLOT1_BIT;
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expect(state.players[1].syz_ward_absorb_until_tick > state.header.tick);
    try std.testing.expectApproxEqAbs(@as(f64, 20.0), state.players[1].syz_ward_absorb_remaining, 1e-9);

    // Ticks 2-3: drive the swing FSM through windup -> active -> contact,
    // bit-exact tick sizes copied from the Undercut test above (120ms then
    // 44ms — windup(60) overflows into a fresh active(45) with 0ms elapsed,
    // then 44ms into active clears the 22ms contact-delay gate).
    state.players[1].current_keys = 0;
    _ = root.world.stepWorld(&state, 120.0); // windup -> active (0ms elapsed)
    _ = root.world.stepWorld(&state, 44.0); // contact tick — arc hit resolves

    // SLASH_DAMAGE (14.0) is fully covered by the 20.0 pool: victim takes
    // ZERO damage (unlike the generic shield step, which would have
    // suppressed the whole hit-confirmed event too — Syzygist Ward still
    // lands a real, just-zeroed, hit).
    try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.players[1].health, 1e-9);
    // Pool genuinely drained by the absorbed amount (14), not just a
    // boolean flag — proves the depletion math, not merely "blocked".
    try std.testing.expectApproxEqAbs(@as(f64, 6.0), state.players[1].syz_ward_absorb_remaining, 1e-9);
    // Still live (6 > 0) — the window was NOT cleared by a partial absorb.
    try std.testing.expect(state.players[1].syz_ward_absorb_until_tick > state.header.tick);
}

test "ability dispatch: Self-Lattice (Priest) — a ranged hit that fully drains the pool takes only the OVERFLOW as real damage, and clears the window (not just a partial drain)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    setPlayerId(&state.players[0], "shooter");

    state.players[1].flags.alive = true;
    state.players[1].character_id = .shielded; // priest
    state.players[1].health = 100;
    // Away from the shooter's muzzle + first-tick shard path (Z0c Item B:
    // fired shards now integrate + hit-check on their spawn tick) — the
    // victim snaps onto the live shard just before the hit tick below.
    state.players[1].x = 300;
    state.players[1].y = 0;
    setPlayerId(&state.players[1], "victim"); // distinct ids — see Hard
    // Aperture's own test comment for why (owner-skip hazard).
    // Bypass the cast (already proven above) to focus purely on the
    // depletion-to-zero READ-site behavior: a small remaining pool (5),
    // smaller than the incoming pistol shot (12.0).
    state.players[1].syz_ward_absorb_until_tick = 100_000;
    state.players[1].syz_ward_absorb_remaining = 5.0;

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    state.players[1].x = state.projectiles[0].x;
    state.players[1].y = state.projectiles[0].y;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0);

    // 100 - (12.0 - 5.0) == 93.0 — only the 7.0 overflow past the drained
    // pool lands as real damage.
    try std.testing.expectApproxEqAbs(@as(f64, 93.0), state.players[1].health, 1e-9);
    // Pool fully drained and the window cleared (matches trySyzygistWard's
    // own `broke` branch, which unsets all three fields).
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.players[1].syz_ward_absorb_remaining, 1e-9);
    try std.testing.expectEqual(@as(u32, 0), state.players[1].syz_ward_absorb_until_tick);
}

test "ability dispatch: Self-Lattice (Priest) — mutually exclusive with the generic shield: a live absorb pool consumes the hit even while shieldActive+charge are ALSO true, and the shield charge is left completely untouched" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    setPlayerId(&state.players[0], "shooter");

    state.players[1].flags.alive = true;
    state.players[1].character_id = .shielded;
    state.players[1].health = 100;
    // Track Z0b Item B: parked on the shooter's offset-muzzle spawn point
    // — see the Facet Break test's matching comment.
    state.players[1].x = 30;
    state.players[1].y = -49;
    setPlayerId(&state.players[1], "victim");
    state.players[1].syz_ward_absorb_until_tick = 100_000;
    state.players[1].syz_ward_absorb_remaining = 20.0;
    state.players[1].flags.shield_active = true;
    state.players[1].flags.has_shield_charge = true;
    state.players[1].shield_charge = 50.0;
    // Hold Shield the whole time so section 6's tickShield (which runs
    // every tick regardless of this test's own hit-resolution assertions)
    // keeps `shield_active` genuinely live rather than tickShield itself
    // flipping it off for lack of held input — the scenario under test is
    // "both mitigations are ACTUALLY live at hit-resolution time", not
    // just "both fields happened to be true before tick 1".
    state.players[1].current_keys = SHIELD_BIT;

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0);

    // Syzygist Ward alone consumed the hit (100 - (12 - 20 clamped to 0) ==
    // 100, fully absorbed) — the generic shield branch never ran. Its
    // charge only moved by the ORDINARY held-shield drain tickShield
    // applies every tick regardless (SHIELD_DRAIN_PER_SECOND=35.0 × 2ms
    // held == 0.07), never the much larger hit-absorb drain
    // (SHIELD_HIT_DRAIN_MULTIPLIER × final_dmg) the generic shield step
    // would have applied had it run.
    try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.players[1].health, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 49.93), state.players[1].shield_charge, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 8.0), state.players[1].syz_ward_absorb_remaining, 1e-9);
}

// ── Kindled Resolve (Paladin, Phase 4a follow-up, docs/zig-step-world-
//    parity-goal.md) — consumption side. The CAST itself is no longer a
//    no-op (Track Z5 item 1, 2026-07-26 — see the `.kindled_resolve`
//    switch arm's own comment for the fix + the tick-base finding it
//    caught); its own dedicated cross-engine parity coverage lives in
//    client/src/sim/wasm/__tests__/kindledResolveCastParity.test.ts (a
//    real TS/Zig wasm lockstep, pressing the actual ability slot — this
//    native smoke.zig file has no wasm/TS side to lockstep against).
//    Every test below still sets `kindled_resolve_until_tick` directly
//    rather than going through a cast — a deliberate isolation choice
//    (focus purely on proving the READ sites, matching the same "bypass
//    the cast, focus on the read site" precedent the Self-Lattice
//    depletion test above already established), not a reflection of the
//    cast being unreachable any more.
test "Kindled Resolve: melee damage amp is CLASS-BLIND — a Ninja Slash from an attacker holding the window is amplified too, matching World.ts's own class-blind composition site" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[0].kindled_resolve_until_tick = 100_000;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 40;
    state.players[1].y = 0;

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // windup start
    _ = root.world.stepWorld(&state, 120.0); // active starts
    _ = root.world.stepWorld(&state, 44.0); // contact tick — hit resolves

    // SLASH_DAMAGE (14.0) * KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER (1.1) ==
    // 15.4 — a plain unbuffed slash would leave 86.0.
    try std.testing.expectApproxEqAbs(@as(f64, 84.6), state.players[1].health, 1e-9);
}

test "Kindled Resolve: melee stagger-resist softens an Unbroken-Seal-triggered stagger toward 1 when the VICTIM (not the attacker) holds the window, without changing the landed damage" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy; // paladin
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    equipSlot(&state, 0, 0, .unbroken_seal);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 40;
    state.players[1].y = 0;
    state.players[1].kindled_resolve_until_tick = 100_000;

    state.players[0].current_keys = SLOT1_BIT | FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // cast Seal + windup start
    try std.testing.expect(state.players[0].seal_until_tick > state.header.tick);

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 200.0); // active starts
    _ = root.world.stepWorld(&state, 100.0); // contact tick — hit resolves

    // Damage UNCHANGED from the plain Unbroken Seal test above (38 * 1.45
    // == 55.1, attacker has no Kindled Resolve of their own here) — proves
    // stagger-resist doesn't leak into the damage multiplier.
    try std.testing.expect(@abs(state.players[1].health - 44.9) < 1e-9);
    try std.testing.expect(state.players[1].flags.has_slow);
    // Resisted: 0.25 + (1 - 0.25) * 0.5 == 0.625 — a plain unresisted Seal
    // stagger would leave 0.25 (the Unbroken Seal test above proves that
    // baseline).
    try std.testing.expect(@abs(state.players[1].slow_multiplier - 0.625) < 1e-9);
}

test "Kindled Resolve: ranged (projectile) damage amp — a plain starter-pistol shot from a shooter holding the window lands amplified" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    state.players[0].kindled_resolve_until_tick = 100_000;
    setPlayerId(&state.players[0], "shooter");

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    // Away from the shooter's muzzle + first-tick shard path (Z0c Item B:
    // fired shards now integrate + hit-check on their spawn tick) — the
    // victim snaps onto the live shard just before the hit tick below.
    state.players[1].x = 300;
    state.players[1].y = 0;
    setPlayerId(&state.players[1], "victim");

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    state.players[1].x = state.projectiles[0].x;
    state.players[1].y = state.projectiles[0].y;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0);

    // 100 - (12.0 * 1.1) == 86.8 — a plain unbuffed pistol hit would leave
    // 88.0.
    try std.testing.expectApproxEqAbs(@as(f64, 86.8), state.players[1].health, 1e-9);
}

test "Kindled Resolve: instant-AOE (Flock Pulse) — caster-side damage amp AND victim-side stagger-resist both apply in the SAME cast, proving both resolveInstantAoeCasts consumption sites independently" {
    var state = freshFightingState();
    state.player_count = 2; // 0 = priest caster, 1 = victim in radius
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded; // priest
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    state.players[0].kindled_resolve_until_tick = 100_000; // caster's OWN window
    equipSlot(&state, 0, 0, .flock_pulse);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 50; // within SYZ_FLOCK_PULSE_RADIUS_PX (170)
    state.players[1].y = 0;
    state.players[1].kindled_resolve_until_tick = 100_000; // victim's OWN window

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    // Damage: SYZ_FLOCK_PULSE_BASE_DAMAGE (8) * 1.1 == 8.8 — the plain
    // Flock Pulse test above proves the unbuffed baseline (8.0/92.0).
    try std.testing.expectApproxEqAbs(@as(f64, 91.2), state.players[1].health, 1e-9);
    try std.testing.expect(state.players[1].flags.has_slow);
    // Stagger-resist: SYZ_FLOCK_PULSE_SLOW_MULTIPLIER (0.8) resisted
    // toward 1 by 0.5 == 0.8 + (1 - 0.8) * 0.5 == 0.9 — softer (less
    // slowing) than the plain 0.8 baseline.
    try std.testing.expect(@abs(state.players[1].slow_multiplier - 0.9) < 1e-9);
}

// ── Phase 4c: movement (docs/zig-step-world-parity-goal.md "4c. Movement")
// — the shared findCollisionFreeLanding substrate (world.zig) backing Slip
// Node/Plant Charge/Drift Step, plus Bulwark Step's own held-input variant.
// Every test below stands the caster on a floor static (grounded, vy=0, no
// horizontal input beyond the ability slot bit) so section 8's physics
// pass — which always runs BEFORE this dispatch switch each tick — leaves
// x/y untouched going into the cast: with no L/R held and vx starting at
// 0, `approach(0, 0, GROUND_FRICTION * dt)` is a no-op, so the position
// this switch reads is bit-exact, and every landing-point assertion below
// can be exact equality rather than an epsilon. Bulwark Step's own tests
// are the one exception (see their own comments for why).
const RIGHT_BIT: u32 = 1 << 1;

fn standOnFloor(state: *root.world_state.WorldState, player_idx: usize, x: f64) void {
    state.static_count = 1;
    state.statics[0] = .{ .x = 0, .y = 600, .w = 1280, .h = 40 }; // floor surface at y=600
    state.one_way[0] = 0;
    state.players[player_idx].x = x;
    state.players[player_idx].y = 572; // 600 - PLAYER_BODY_HEIGHT/2 (28) — standing height
    state.players[player_idx].vy = 0;
    state.player_movement[player_idx].grounded_last_frame = 1;
}

test "ability dispatch: Slip Node (Geometrician) — open path: blinks the caster the FULL GEO_SLIP_NODE_RANGE_PX (280) along aim direction, sets cooldown" {
    var state = freshFightingState();
    state.player_count = 2; // 1 = bystander, keeps round_phase == fighting past tick 1
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced;
    state.players[0].health = 100;
    standOnFloor(&state, 0, 300);
    state.players[0].aim_x = 300 + 280; // straight +x, exactly the full range
    state.players[0].aim_y = 572;
    equipSlot(&state, 0, 0, .slip_node);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    state.players[1].y = 572;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 580.0), state.players[0].x); // 300 + 280
    try std.testing.expectEqual(@as(f64, 572.0), state.players[0].y); // unchanged (horizontal aim)
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Slip Node (Geometrician) — a wall blocks the FAR half of the range: lands at the farthest point still clear of it (148px), not the max range and not the near fallback" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced;
    state.players[0].health = 100;
    standOnFloor(&state, 0, 300);
    // Wall covers x[470,700] — overlaps every candidate box with cx > 457
    // (box half-width 13), i.e. every d >= 160 in the search's 12px-step
    // ladder (280,268,...,172,160 all blocked; 148 is the first clear).
    // Starts well clear of the caster's own resting box (x[287,313]) so
    // the pre-cast standing position is never itself inside solid geometry.
    state.static_count = 2;
    state.statics[1] = .{ .x = 470, .y = 500, .w = 230, .h = 150 };
    state.one_way[1] = 0;
    state.players[0].aim_x = 300 + 280;
    state.players[0].aim_y = 572;
    equipSlot(&state, 0, 0, .slip_node);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    state.players[1].y = 572;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 448.0), state.players[0].x); // 300 + 148
    try std.testing.expectEqual(@as(f64, 572.0), state.players[0].y);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Slip Node (Geometrician) — a wall blocks the ENTIRE range: dead press, caster doesn't move, no cooldown burn" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced;
    state.players[0].health = 100;
    standOnFloor(&state, 0, 300);
    // Wall covers x[314,714] — clear of the caster's own resting box
    // (x[287,313]) but overlaps every candidate from d=24 (cx=324) through
    // d=280 (cx=580), so the WHOLE search range is blocked.
    state.static_count = 2;
    state.statics[1] = .{ .x = 314, .y = 500, .w = 400, .h = 150 };
    state.one_way[1] = 0;
    state.players[0].aim_x = 300 + 280;
    state.players[0].aim_y = 572;
    equipSlot(&state, 0, 0, .slip_node);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    state.players[1].y = 572;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 300.0), state.players[0].x); // unmoved
    try std.testing.expectEqual(@as(f64, 572.0), state.players[0].y);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]); // dead press, no burn
}

test "ability dispatch: Plant Charge (Paladin) — open path: blinks KIN_PLANT_CHARGE_RANGE_PX (190) along aim and refunds shield charge, capped at the resolved max (100)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy;
    state.players[0].health = 100;
    state.players[0].shield_charge = 95; // + refund (12) would overshoot 100 uncapped
    standOnFloor(&state, 0, 300);
    state.players[0].aim_x = 300 + 190;
    state.players[0].aim_y = 572;
    equipSlot(&state, 0, 0, .plant_charge);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    state.players[1].y = 572;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 490.0), state.players[0].x); // 300 + 190
    try std.testing.expectEqual(@as(f64, 572.0), state.players[0].y);
    try std.testing.expectEqual(@as(f64, 100.0), state.players[0].shield_charge); // 95 + 12, capped
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Drift Step (Syzygist) — open path: blinks SYZ_DRIFT_STEP_RANGE_PX (210) along aim — the ONE catalog movement ability that's player-aimed rather than low-aim auto-target" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded; // priest
    state.players[0].health = 100;
    standOnFloor(&state, 0, 300);
    state.players[0].aim_x = 300 + 210;
    state.players[0].aim_y = 572;
    equipSlot(&state, 0, 0, .drift_step);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    state.players[1].y = 572;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(f64, 510.0), state.players[0].x); // 300 + 210
    try std.testing.expectEqual(@as(f64, 572.0), state.players[0].y);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Bulwark Step (Paladin) — held Right input drives the reposition, NOT aim (aim points hard -x, caster still moves +x)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy;
    state.players[0].health = 100;
    standOnFloor(&state, 0, 300);
    state.players[0].aim_x = 300 - 500; // hard -x — must be ignored
    state.players[0].aim_y = 572;
    equipSlot(&state, 0, 0, .bulwark_step);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    state.players[1].y = 572;

    // Right held alongside the ability slot bit — same tick, same input
    // read this switch's own case reads (`attacker.current_keys`).
    state.players[0].current_keys = SLOT1_BIT | RIGHT_BIT;
    _ = root.world.stepWorld(&state, 16.0);

    // Epsilon (not exact) unlike the aim-directed abilities above: holding
    // Right also feeds section 8's own ground-acceleration branch THIS
    // SAME tick, before dispatch reads back attacker.x as its blink
    // origin — a few sub-pixel px of physics-driven drift on top of the
    // exact +110 search delta is expected and harmless (this test's own
    // load-bearing property is direction-source + magnitude, not
    // sub-pixel physics purity, which the aim-directed tests above already
    // cover with exact assertions in a zero-input-drift setup).
    try std.testing.expect(@abs(state.players[0].x - 410.0) < 5.0); // ~300 + 110
    try std.testing.expectEqual(@as(f64, 572.0), state.players[0].y); // horizontal-only, never touched
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Bulwark Step (Paladin) — no movement key held: falls back to the caster's current horizontal velocity SIGN (moving left -> steps further left)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy;
    state.players[0].health = 100;
    standOnFloor(&state, 0, 300);
    state.players[0].vx = -200; // already moving left; no L/R held this tick
    state.players[0].aim_x = 300 + 500; // aim points +x — must ALSO be ignored (never aim-directed)
    state.players[0].aim_y = 572;
    equipSlot(&state, 0, 0, .bulwark_step);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;
    state.players[1].y = 572;

    state.players[0].current_keys = SLOT1_BIT; // neither LEFT_BIT nor RIGHT_BIT held
    _ = root.world.stepWorld(&state, 16.0);

    // Epsilon for the same ground-friction-drift reason as the held-input
    // test above (vx=-200 is deliberately large so friction can't flip its
    // sign in one tick — see world.zig's own bulwark_step case comment).
    try std.testing.expect(@abs(state.players[0].x - 190.0) < 5.0); // ~300 - 110
    try std.testing.expectEqual(@as(f64, 572.0), state.players[0].y);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

// ── Phase 4e: structurally distinct abilities (docs/zig-step-world-parity-
//    goal.md "4e. Structurally distinct, port individually") — Sunspike/
//    Needle/Severance/Contagion/Lattice. Bleed Tithe has no test here: it
//    stays an explicit no-op (see its own comment at the switch arm) —
//    same "no test for a deferred no-op" convention every earlier
//    sub-group's own deferrals (Hard Aperture/Recoil Step/Kindled
//    Resolve/Ghost Guard/Self-Lattice/Razor Route) already established.

test "ability dispatch: Sunspike (Paladin/Kindled) — player-AIMED shard (the caster's own cursor, NOT auto-targeted), full damage/speed, no target-existence gate" {
    var state = freshFightingState();
    // 2 = a bystander keeps round_phase == fighting past tick 1 — a
    // single-alive-player match KOs immediately (see the Slip Node test's
    // own comment for this exact precedent), which would otherwise mask
    // the dispatch switch never running at all.
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .heavy; // paladin/kindled
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    equipSlot(&state, 0, 0, .sunspike);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);

    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    try std.testing.expectApproxEqAbs(@as(f64, 40.0), state.projectiles[0].damage, 1e-9); // KIN_SUNSPIKE_DAMAGE
    const speed = @sqrt(state.projectiles[0].vx * state.projectiles[0].vx +
        state.projectiles[0].vy * state.projectiles[0].vy);
    // Epsilon loosened past the LUT-trig quantization floor (lutCos/lutSin
    // are separate lookup tables — cos^2+sin^2 isn't guaranteed exactly 1
    // the way real trig would be, same tiny-magnitude-drift class every
    // other LUT-derived assertion in this file already tolerates).
    try std.testing.expectApproxEqAbs(@as(f64, 1500.0), speed, 1e-3); // KIN_SUNSPIKE_SPEED
    try std.testing.expect(state.projectiles[0].vx > 0); // aimed at (100,0): straight +x
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Needle (Ninja) — auto-targeted self-lunge toward the nearest enemy (clamped short of contact) plus a fixed-'crystal'-element shard aimed the SAME direction" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    equipSlot(&state, 0, 0, .needle); // range 300px, lunge 130px, damage 36, speed 1400

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 100; // dist 100 -> lunge = min(130, 100-20) = 80
    state.players[1].y = 0;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);

    // Epsilon (not exact equality) on both axes: section 8's physics pass
    // runs BEFORE this dispatch switch every tick and applies a tiny
    // one-tick gravity nudge to y regardless of grounded state (no floor
    // static in this test), which in turn perturbs the lunge direction by
    // a proportionally tiny amount — same "epsilon for one-tick drift"
    // reasoning the Bulwark Step tests above already use, just from
    // gravity instead of ground friction.
    try std.testing.expectApproxEqAbs(@as(f64, 80.0), state.players[0].x, 1e-2);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.players[0].y, 1e-2);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    try std.testing.expectApproxEqAbs(@as(f64, 36.0), state.projectiles[0].damage, 1e-9); // NINJA_NEEDLE_DAMAGE
    try std.testing.expectEqual(root.world_state.ElementType.crystal, state.projectiles[0].element);
    const speed = @sqrt(state.projectiles[0].vx * state.projectiles[0].vx +
        state.projectiles[0].vy * state.projectiles[0].vy);
    try std.testing.expectApproxEqAbs(@as(f64, 1400.0), speed, 1e-6); // NINJA_NEEDLE_SPEED
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Needle (Ninja) — no enemy within range: a dead press, no lunge, no shard, no cooldown burn" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    equipSlot(&state, 0, 0, .needle);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000; // far outside NINJA_NEEDLE_RANGE_PX (300)

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);

    try std.testing.expectEqual(@as(f64, 0.0), state.players[0].x);
    try std.testing.expectEqual(@as(u32, 0), state.projectile_count);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]);
}

test "ability dispatch: Severance (Priest/Syzygist) — targets the nearest ALREADY-cursed enemy, skipping a CLOSER non-cursed candidate entirely (curse gate, not distance alone)" {
    var state = freshFightingState();
    state.player_count = 3;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded; // priest/syzygist
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    equipSlot(&state, 0, 0, .severance); // range 420px (SYZ_ENEMY_SEARCH_RANGE_PX)

    // Closer, but NOT cursed — must be ignored entirely (proves the curse
    // gate wins over raw distance).
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 30;
    state.players[1].y = 0;

    // Farther, but frozen (one of the 3 OR'd curse fields) — off-axis (+y,
    // not +x) so the shard's own velocity direction proves WHICH target
    // got picked.
    state.players[2].flags.alive = true;
    state.players[2].health = 100;
    state.players[2].x = 0;
    state.players[2].y = 200;
    state.players[2].flags.has_freeze = true;
    state.players[2].freeze_until_tick = 999_999;

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);

    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    try std.testing.expectApproxEqAbs(@as(f64, 34.0), state.projectiles[0].damage, 1e-9); // SYZ_SEVERANCE_DAMAGE
    // Aimed at (0,200), NOT (30,0): vx ~ 0, vy > 0.
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.projectiles[0].vx, 1e-6);
    try std.testing.expect(state.projectiles[0].vy > 0);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Severance (Priest/Syzygist) — no cursed enemy in range: a dead press, no shard, no cooldown burn" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded;
    state.players[0].health = 100;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 50; // in range, but not cursed at all
    equipSlot(&state, 0, 0, .severance);

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);

    try std.testing.expectEqual(@as(u32, 0), state.projectile_count);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]);
}

test "ability dispatch: Contagion (Priest/Syzygist) — an already-burning OTHER player within radius has their burn copied onto the nearest NON-burning OTHER player near them (cross-player write, resolved inline, no deferred queue)" {
    var state = freshFightingState();
    state.player_count = 3;
    state.players[0].flags.alive = true; // caster
    state.players[0].character_id = .shielded;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    equipSlot(&state, 0, 0, .contagion); // radius 260 / jump radius 220

    state.players[1].flags.alive = true; // source: already burning, in radius of caster
    state.players[1].health = 100;
    state.players[1].x = 100;
    state.players[1].y = 0;
    state.players[1].flags.has_burn = true;
    state.players[1].burn_until_tick = 999_999;
    state.players[1].burn_dps = 7.0;

    state.players[2].flags.alive = true; // jump target: NOT burning, in jump-radius of SOURCE
    state.players[2].health = 100;
    state.players[2].x = 100;
    state.players[2].y = 50; // dist to source (100,0) = 50, well inside 220

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);

    try std.testing.expect(state.players[2].flags.has_burn);
    try std.testing.expectEqual(@as(u32, 999_999), state.players[2].burn_until_tick);
    try std.testing.expectApproxEqAbs(@as(f64, 7.0), state.players[2].burn_dps, 1e-9);
    try std.testing.expectEqual(state.header.tick, state.players[2].burn_tick_last_applied);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);
}

test "ability dispatch: Contagion (Priest/Syzygist) — no burning enemy in radius: a dead press, no write, no cooldown burn" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded;
    state.players[0].health = 100;
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 100; // in radius, but not burning
    equipSlot(&state, 0, 0, .contagion);

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);

    try std.testing.expect(!state.players[1].flags.has_burn);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]);
}

test "ability dispatch: Lattice (Geometrician) — cast spawns a real, self-owned, owner-immune lingering damage zone (state.fires) which then damages a non-owner victim standing in it on a LATER tick via the EXISTING fire-patch tick — not a new primitive" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced; // wizard/geometrician
    state.players[0].health = 100;
    state.players[0].x = 100;
    state.players[0].y = 100;
    setPlayerId(&state.players[0], "caster");
    equipSlot(&state, 0, 0, .lattice); // radius 150, duration 2200ms, 11 dps

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 110;
    state.players[1].y = 100;
    setPlayerId(&state.players[1], "victim");

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // tick 1: cast — since the Z0c Item B reorder the fire-patch tick runs AFTER the 6z cast within this same tick (TS's own cadence: pendingZoneSpawns merges into nextFirePatches before stepFirePatches, World.ts:6398/6457), so the fresh zone drains 1ms and deals its first 0.011 damage immediately.

    try std.testing.expectEqual(@as(u32, 1), state.fire_count);
    try std.testing.expectEqual(@as(f64, 100.0), state.fires[0].x);
    // Epsilon: section 8's physics pass applies a tiny one-tick gravity
    // nudge to y before this dispatch switch runs (no floor static in
    // this test) — same "epsilon for one-tick drift" reasoning the Needle
    // test above uses.
    try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.fires[0].y, 1e-2);
    try std.testing.expectApproxEqAbs(@as(f64, 150.0), state.fires[0].radius, 1e-9);
    // GEO_LATTICE_ZONE_DURATION_MS (2200) minus this same tick's 1ms drain
    // (see the cast comment above).
    try std.testing.expectApproxEqAbs(@as(f64, 2199.0), state.fires[0].remaining_ms, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 11.0), state.fires[0].damage_per_second, 1e-9);
    try std.testing.expectEqual(@as(u32, 1), state.fires[0].has_owner);
    try std.testing.expectEqualSlices(u8, "caster", state.fires[0].owner_id_bytes[0..state.fires[0].owner_id_len]);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);

    // Tick 2 (one 16ms frame — small on purpose: no floor static in this
    // test, so a large dt would free-fall the players a huge distance
    // under unconstrained gravity before the fire-patch tick even runs
    // this same tick): the EXISTING fire-patch tick (section 2, runs
    // every tick regardless of this ability) applies real, proportional
    // DPS (`damage_per_second * (dt/1000)`, no 1s-cadence gate unlike burn
    // DoT) to the non-owner victim standing in the zone. The owner, ALSO
    // standing inside their own zone's radius, stays untouched — the
    // load-bearing property this test proves: this is a real, already-
    // simulated entity (owner-immune, DPS-ticking, lifetime-draining),
    // not an inert marker.
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 16.0);
    try std.testing.expectApproxEqAbs(@as(f64, 99.813), state.players[1].health, 1e-6); // 100 - 11.0*(0.001+0.016)s — cast tick's 1ms + this tick's 16ms
    try std.testing.expectEqual(@as(f64, 100.0), state.players[0].health);
}

// ── Ghost Guard (Ninja) — previously deferred abilities, real substrate
//    found on re-investigation (docs/zig-step-world-parity-goal.md) ────────

test "ability dispatch: Ghost Guard (Ninja) — melee: an active charge on a MOVING victim evades a landed Ninja Slash entirely (zero damage, no knockback, charge consumed); a SECOND victim in the same arc with a live charge but NOT moving fast enough takes the full hit and keeps its charge (the 'if moving' gate is real, not a blanket skip)" {
    var state = freshFightingState();
    state.player_count = 3;
    // All 3 grounded on the SAME floor (standOnFloor) rather than airborne —
    // deliberately: an airborne "stationary" victim isn't actually
    // velocity-zero in this sim (unconstrained gravity accrues real vy
    // every tick it's falling, which this ability's own hypot(vx,vy) check
    // correctly picks up, same as TS would), so an airborne victim 2 would
    // falsely cross NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD from gravity
    // alone by the contact tick and break the very contrast this test
    // exists to prove. Grounding removes that confound.
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja attacker
    state.players[0].health = 100;
    standOnFloor(&state, 0, 100);
    state.players[0].aim_x = 300; // +x, well past both victims
    state.players[0].aim_y = 572;

    // Victim 1: ninja, charge live, moving fast — evades.
    state.players[1].flags.alive = true;
    state.players[1].character_id = .sprinter;
    state.players[1].health = 100;
    standOnFloor(&state, 1, 120); // dx 20 from attacker

    // Victim 2: ninja, charge ALSO live, but stationary — must take the
    // full unmitigated hit (the gate never triggers for it).
    state.players[2].flags.alive = true;
    state.players[2].character_id = .sprinter;
    state.players[2].health = 100;
    standOnFloor(&state, 2, 115); // dx 15 from attacker

    state.players[1].ghost_guard_charge_until_tick = 100_000;
    state.players[2].ghost_guard_charge_until_tick = 100_000;

    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // windup start
    _ = root.world.stepWorld(&state, 120.0); // active starts
    // Set victim 1's velocity right before the contact tick only — grounded
    // friction (GROUND_FRICTION=3600px/s^2) would otherwise fully zero out
    // anything set earlier across the 121ms of windup/active above; a
    // large value here comfortably survives ONE 44ms tick of friction decay
    // (3600 * 0.044 = 158.4) and still clears the 60px/s threshold.
    state.players[1].vx = 800.0;
    _ = root.world.stepWorld(&state, 44.0); // contact tick — arc hit resolves against both victims

    // Victim 1: evaded — untouched, charge consumed.
    try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.players[1].health, 1e-9);
    try std.testing.expectEqual(@as(u32, 0), state.players[1].ghost_guard_charge_until_tick);

    // Victim 2: NOT moving fast enough — full SLASH_DAMAGE (14.0) lands,
    // charge stays live (the gate never triggered for it).
    try std.testing.expectApproxEqAbs(@as(f64, 86.0), state.players[2].health, 1e-9);
    try std.testing.expectEqual(@as(u32, 100_000), state.players[2].ghost_guard_charge_until_tick);
}

test "ability dispatch: Ghost Guard (Ninja) — ranged: an active charge on a moving ninja victim evades a landed shot entirely (zero damage, projectile consumed same tick), independent of parry/shield state" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja victim
    state.players[0].health = 100;
    // Away from the shooter's muzzle + first-tick shard path (Z0c Item B:
    // fired shards now integrate + hit-check on their spawn tick) — the
    // victim snaps onto the live shard just before the hit tick below.
    // Still "moving" via vx below; 1ms ticks drift it a negligible 0.2px
    // before the hit.
    state.players[0].x = 300;
    state.players[0].y = 0;
    setPlayerId(&state.players[0], "victim");
    state.players[0].ghost_guard_charge_until_tick = 100_000;
    state.players[0].vx = 200.0; // > NINJA_GHOST_GUARD_MOVE_SPEED_THRESHOLD (60)

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 0;
    state.players[1].y = 0;
    state.players[1].aim_x = 100;
    state.players[1].aim_y = 0;
    setPlayerId(&state.players[1], "shooter");

    state.players[1].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0); // shot spawns
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);

    state.players[0].x = state.projectiles[0].x;
    state.players[0].y = state.projectiles[0].y;
    state.players[1].current_keys = 0;
    state.players[0].vx = 200.0; // re-assert so the gate reads "moving" at hit-resolution time
    _ = root.world.stepWorld(&state, 1.0); // victim parked on the shard, hit resolves

    try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.players[0].health, 1e-9); // undamaged — evaded
    try std.testing.expectEqual(@as(u32, 0), state.players[0].ghost_guard_charge_until_tick); // charge consumed
    try std.testing.expectEqual(@as(u32, 0), state.projectile_count); // consumed + compacted same tick
}

test "ability dispatch: Bleed Tithe (Priest/Syzygist) — auto-targeted homing fire shard: a landed hit writes the SAME burn-DoT fields section 8b's tick already reads (new `.fire` on-hit arm), AND heals the caster leech_fraction of the damage that landed (new leech-heal consumption site)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded; // priest/syzygist caster
    state.players[0].health = 50; // below 100 so the leech heal is directly observable, well under the max(100, health) cap
    state.players[0].x = 0;
    state.players[0].y = 0;
    setPlayerId(&state.players[0], "caster");
    equipSlot(&state, 0, 0, .bleed_tithe); // SYZ_ENEMY_SEARCH_RANGE_PX (420) auto-target

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    // In auto-target range (420) but clear of the caster-adjacent shard
    // spawn point and its first tick of travel (Z0c Item B: an ability
    // shard cast in section 6z now integrates + hit-checks the SAME tick,
    // TS's own cadence) — the victim snaps onto the live shard just
    // before the hit tick below.
    state.players[1].x = 200;
    state.players[1].y = 0;
    setPlayerId(&state.players[1], "victim");

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0); // cast: shard spawns

    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    try std.testing.expectApproxEqAbs(@as(f64, 26.0), state.projectiles[0].damage, 1e-9); // SYZ_BLEED_TITHE_DAMAGE
    try std.testing.expectEqual(root.world_state.ElementType.fire, state.projectiles[0].element);
    try std.testing.expectApproxEqAbs(@as(f64, 0.35), state.projectiles[0].leech_fraction, 1e-6); // SYZ_BLEED_TITHE_LEECH_FRACTION
    try std.testing.expect(state.projectiles[0].flags.has_homing);
    try std.testing.expect(state.players[0].slot_cooldown_until_tick[0] > state.header.tick);

    state.players[1].x = state.projectiles[0].x;
    state.players[1].y = state.projectiles[0].y;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0); // victim parked on the shard, hit resolves

    // 100 - 26 == 74.
    try std.testing.expectApproxEqAbs(@as(f64, 74.0), state.players[1].health, 1e-9);
    // Fire on-hit: burn DoT written (this pass's new `.fire` arm).
    try std.testing.expect(state.players[1].flags.has_burn);
    try std.testing.expect(state.players[1].burn_until_tick > state.header.tick);
    try std.testing.expectApproxEqAbs(@as(f64, 10.4), state.players[1].burn_dps, 1e-9); // 26 * 0.4
    // Leech: caster healed 26 * 0.35 == 9.1, well under the max(100, 50)==100
    // cap. Wider tolerance than this file's usual 1e-9: leech_fraction is
    // stored as f32 (ProjectileEntity's own precision tradeoff — see that
    // field's doc comment in world_state.zig), so 0.35 round-trips with
    // ~1e-7 relative error, not bit-exact against an f64 literal.
    try std.testing.expectApproxEqAbs(@as(f64, 59.1), state.players[0].health, 1e-4);
}

test "ability dispatch: Bleed Tithe (Priest/Syzygist) — no enemy within range: a dead press, no shard, no cooldown burn" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .shielded;
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    equipSlot(&state, 0, 0, .bleed_tithe);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5000; // far outside SYZ_ENEMY_SEARCH_RANGE_PX (420)

    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);

    try std.testing.expectEqual(@as(u32, 0), state.projectile_count);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].slot_cooldown_until_tick[0]);
}

test "ability dispatch: Razor Route (Ninja) — cast opens a window; the NEXT dash's body-cross applies the velocity boost AND marks Read on the crossed victim once (per-burst debounce — a second overlapping tick in the SAME burst grants no additional energy)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;
    setPlayerId(&state.players[0], "caster");
    equipSlot(&state, 0, 0, .razor_route);

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5; // overlapping player0's melee hitbox (MELEE_BODY_WIDTH 26) at close range
    state.players[1].y = 0;
    setPlayerId(&state.players[1], "victim");

    // Tick 1: cast — opens the window.
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expect(state.players[0].razor_route_until_tick > state.header.tick);

    // Tick 2: simulate the NEXT dash's rising edge directly — dash_active_ms
    // set on `player_movement` bypasses the real dash-trigger input
    // pipeline (a full input-driven dash needs a resolved fire config with
    // dash_charges > 0, which this test doesn't set up), same "prove the
    // READ site" shape Kindled Resolve's own tests already establish for
    // an unreachable-today cast path. 0 the tick before (freshFightingState
    // zero-inits player_movement), so `was_dashing` reads false this tick
    // — the burst's rising edge.
    state.players[0].current_keys = 0;
    state.players[0].vx = 300.0;
    state.players[0].vy = 0.0;
    state.player_movement[0].dash_active_ms = 100.0;
    _ = root.world.stepWorld(&state, 1.0);

    // Window consumed at burst-start, regardless of whether a body was
    // crossed yet.
    try std.testing.expectEqual(@as(u32, 0), state.players[0].razor_route_until_tick);
    // Velocity boost: vx grew by NINJA_RAZOR_ROUTE_BOOST_SPEED (260) along
    // the dash direction — 300 + 260 == 560 (player.zig's own mid-dash
    // steering is inert here: no aim target set, so aim_len is ~0 and the
    // steering branch's own `aim_len > 1e-3` guard skips it, leaving vx a
    // pure magnitude sum).
    try std.testing.expectApproxEqAbs(@as(f64, 560.0), state.players[0].vx, 1.0);
    // Read mark landed on the crossed victim.
    try std.testing.expectEqualSlices(u8, "victim", state.players[0].read_target_id_bytes[0..state.players[0].read_target_id_len]);
    try std.testing.expect(state.players[0].read_mark_until_tick > state.header.tick);
    // Baseline dash-through energy granted once.
    try std.testing.expectApproxEqAbs(@as(f64, 15.0), state.players[0].energy, 1e-9); // NINJA_ENERGY_ON_DASH_THROUGH

    // Tick 3: still mid-burst (dash_active_ms > 0, no rising edge this
    // time), victim still overlapping — per-burst debounce means NO second
    // energy grant, proving `dash_through_tagged_mask` actually gates
    // re-tagging rather than "grants energy every tick of overlap".
    state.player_movement[0].dash_active_ms = 50.0;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectApproxEqAbs(@as(f64, 15.0), state.players[0].energy, 1e-9); // unchanged
}

test "ability dispatch: Razor Route (Ninja) — dash-through's baseline energy grant + Read mark are DISTINCT: no live razor_route_until_tick window still grants dash-through energy (the generic mechanic) but writes NO Read mark (the empowered byproduct stays correctly gated)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .sprinter; // ninja, no Razor Route cast this time
    state.players[0].health = 100;
    state.players[0].x = 0;
    state.players[0].y = 0;

    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 5; // overlapping
    state.players[1].y = 0;

    state.players[0].vx = 300.0;
    state.player_movement[0].dash_active_ms = 100.0;
    _ = root.world.stepWorld(&state, 1.0); // rising edge, body-cross this same tick

    try std.testing.expectApproxEqAbs(@as(f64, 15.0), state.players[0].energy, 1e-9); // baseline grant still fires
    try std.testing.expectEqual(@as(u8, 0), state.players[0].read_target_id_len); // no mark written
    try std.testing.expectEqual(@as(u32, 0), state.players[0].read_mark_until_tick);
    // No empowered boost either — plain dash speed, no +260 addition.
    try std.testing.expectApproxEqAbs(@as(f64, 300.0), state.players[0].vx, 1.0);
}

// ── Draft/offer-roll system (Phase 2, docs/zig-step-world-parity-goal.md) ─
// Ports client/src/sim/round.ts's enterDrafting + draftWeights.ts. Testing
// strategy per the phase's own brief: the DETERMINISTIC parts (candidate-
// pool filtering, pity floor's forced-guarantee) get direct assertions
// against exact composition; the RANDOM part gets a determinism proof
// (same seed → bit-identical offers), not a distribution check; the full
// phase transition gets an end-to-end hand-fed-picks proof that a pick
// genuinely changes what Phase 1's ability dispatch loop sees equipped.

fn cardIndexById(id: []const u8) u8 {
    for (root.cards_gen.cards, 0..) |c, i| {
        if (std.mem.eql(u8, c.id, id)) return @intCast(i);
    }
    unreachable; // every id used below is a real, live cards.ts id
}

fn containsIndex(pool: []const u8, idx: u8) bool {
    for (pool) |c| {
        if (c == idx) return true;
    }
    return false;
}

test "draft: candidate pool — a unique card already owned is never offered; the same card is offered when not yet owned" {
    var state: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    state.player_count = 1;
    state.players[0].character_id = .balanced; // wizard
    const raycast_idx = cardIndexById("raycast-prism"); // unique, no classId, no active

    var pool: [root.cards_gen.cards.len]u8 = undefined;
    var n = root.draft.buildCandidatePool(&state, 0, &pool);
    try std.testing.expect(containsIndex(pool[0..n], raycast_idx));

    state.players[0].card_count = 1;
    state.player_card_ids[0].indices[0] = raycast_idx;
    n = root.draft.buildCandidatePool(&state, 0, &pool);
    try std.testing.expect(!containsIndex(pool[0..n], raycast_idx));
}

test "draft: candidate pool — a maxStacks card at its cap is never offered; below the cap it still is" {
    var state: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    state.player_count = 1;
    state.players[0].character_id = .balanced;
    const shard_bloom_idx = cardIndexById("shard-bloom"); // maxStacks = 2, not unique

    var pool: [root.cards_gen.cards.len]u8 = undefined;
    state.players[0].card_count = 1;
    state.player_card_ids[0].indices[0] = shard_bloom_idx;
    var n = root.draft.buildCandidatePool(&state, 0, &pool);
    try std.testing.expect(containsIndex(pool[0..n], shard_bloom_idx)); // 1 of 2: still offerable

    state.players[0].card_count = 2;
    state.player_card_ids[0].indices[1] = shard_bloom_idx;
    n = root.draft.buildCandidatePool(&state, 0, &pool);
    try std.testing.expect(!containsIndex(pool[0..n], shard_bloom_idx)); // 2 of 2: at cap, excluded
}

test "draft: candidate pool — ability offers stop once all 3 rack slots are full; passives are unaffected by the cap" {
    var state: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    state.player_count = 1;
    state.players[0].character_id = .balanced;
    const crimson_idx = cardIndexById("crimson-tithe"); // class-blind ability, unique, unowned
    const raycast_idx = cardIndexById("raycast-prism"); // passive, unrelated to the rack

    var pool: [root.cards_gen.cards.len]u8 = undefined;
    // 2 of 3 slots filled: ability cards still offered.
    state.player_equipped_actives[0].slot_kind[0] = @intFromEnum(root.cards_gen.AbilityKind.shadow_step) + 1;
    state.player_equipped_actives[0].slot_kind[1] = @intFromEnum(root.cards_gen.AbilityKind.veil_of_nought) + 1;
    var n = root.draft.buildCandidatePool(&state, 0, &pool);
    try std.testing.expect(containsIndex(pool[0..n], crimson_idx));

    // 3rd slot filled: ability cards no longer offered.
    state.player_equipped_actives[0].slot_kind[2] = @intFromEnum(root.cards_gen.AbilityKind.severing_answer) + 1;
    n = root.draft.buildCandidatePool(&state, 0, &pool);
    try std.testing.expect(!containsIndex(pool[0..n], crimson_idx));
    try std.testing.expect(containsIndex(pool[0..n], raycast_idx)); // passive: untouched by the rack cap
}

test "draft: candidate pool — an off-class ability card is never offered; the matching class sees it" {
    var state: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    state.player_count = 1;
    const sunlance_idx = cardIndexById("sunlance"); // classId = wizard

    var pool: [root.cards_gen.cards.len]u8 = undefined;
    state.players[0].character_id = .sprinter; // -> ninja, off-class
    var n = root.draft.buildCandidatePool(&state, 0, &pool);
    try std.testing.expect(!containsIndex(pool[0..n], sunlance_idx));

    state.players[0].character_id = .balanced; // -> wizard, matching class
    n = root.draft.buildCandidatePool(&state, 0, &pool);
    try std.testing.expect(containsIndex(pool[0..n], sunlance_idx));
}

test "draft: ability pity-floor — a hand holding zero actives is guaranteed at least one ability offer, across several seeds" {
    const seeds = [_]u32{ 1, 42, 999_983, 0xDEADBEEF, 7 };
    for (seeds) |seed| {
        var state: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
        state.player_count = 1;
        state.players[0].character_id = .balanced;
        state.header.rng_state = seed;
        state.header.round_winner_idx = -1;

        root.draft.rollOffersForRound(&state);

        const ds = state.player_draft_state[0];
        var offers_ability = false;
        for (ds.offers) |raw| {
            if (raw == root.world_state.DRAFT_SLOT_NONE) continue;
            const idx = raw - 1;
            if (root.cards_gen.cards[idx].meta.active != null) offers_ability = true;
        }
        try std.testing.expect(offers_ability);
    }
}

test "draft: offer roll is deterministic — same seed + same input state produces bit-identical offers across two separate calls" {
    var state_a: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    state_a.player_count = 3;
    state_a.players[0].character_id = .balanced;
    state_a.players[1].character_id = .heavy;
    state_a.players[2].character_id = .sprinter;
    state_a.header.rng_state = 999_999;
    state_a.header.round_winner_idx = 1; // player 1 = winner; 0 and 2 draft as catch_up

    var state_b = state_a; // WorldState is pure value data (no pointers) — a real deep copy.

    root.draft.rollOffersForRound(&state_a);
    root.draft.rollOffersForRound(&state_b);

    try std.testing.expectEqual(state_a.header.rng_state, state_b.header.rng_state);
    for (0..3) |i| {
        try std.testing.expectEqual(
            state_a.player_draft_state[i].offers,
            state_b.player_draft_state[i].offers,
        );
    }
}

test "draft: full round-over -> drafting -> countdown transition — hand-fed picks genuinely change EquippedActives and the card hand, and all-picked resolves the window EARLY (not just on expiry)" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].character_id = .balanced; // wizard, 0 held actives -> pity floor guarantees an ability at offers[2]
    state.players[1].character_id = .heavy;
    for (0..2) |i| {
        state.players[i].flags.alive = true;
        state.players[i].health = 100;
    }
    state.players[1].health = 40; // player 0 wins the time-out (most health alive)
    state.header.rng_state = 2026;
    state.header.countdown_remaining_ms = 0.0; // already expired — detectRoundWinner reads THIS pre-tick value, not the post-decrement one, so it must already be <=0 for a winner to resolve on the very next stepWorld call

    // Tick 1: fighting -> round_over (time-out win for player 0).
    _ = root.world.stepWorld(&state, 16.0);
    try std.testing.expectEqual(@intFromEnum(root.round.RoundPhase.round_over), state.header.round_phase);
    try std.testing.expectEqual(@as(i32, 0), state.header.round_winner_idx);

    // Advance the round-over hold to 0 in one tick: round_over -> drafting,
    // offers rolled for both players.
    _ = root.world.stepWorld(&state, root.round.ROUND_OVER_HOLD_MS);
    try std.testing.expectEqual(@intFromEnum(root.round.RoundPhase.drafting), state.header.round_phase);

    // Pity floor guarantee (re-proven here through the REAL end-to-end
    // path, not just the isolated unit test above): player 0 holds zero
    // actives, so offers[2] (the last rolled slot) must be an ability card.
    const p0_offers = state.player_draft_state[0].offers;
    const p0_last_idx = p0_offers[2] - 1;
    try std.testing.expect(root.cards_gen.cards[p0_last_idx].meta.active != null);
    const picked_kind = root.cards_gen.cards[p0_last_idx].meta.active.?.kind;

    // Hand-fed picks: player 0 takes the guaranteed ability (slot 2),
    // player 1 takes whatever landed in slot 0.
    try std.testing.expect(root.draft.applyCardPick(&state, 0, 2, false));
    try std.testing.expect(root.draft.applyCardPick(&state, 1, 0, false));

    // Both drafters have now picked — the very NEXT tick (16ms, nowhere
    // near the 8000ms window) must resolve immediately, not wait for
    // expiry. This is the property distinct from auto-pick-on-expiry.
    _ = root.world.stepWorld(&state, 16.0);
    try std.testing.expectEqual(@intFromEnum(root.round.RoundPhase.countdown), state.header.round_phase);

    // The pick genuinely changed what Phase 1's dispatch loop sees
    // equipped: player 0's ability landed in a real EquippedActives slot.
    const expected_raw: u8 = @intFromEnum(picked_kind) + 1;
    var found_in_rack = false;
    for (state.player_equipped_actives[0].slot_kind) |s| {
        if (s == expected_raw) found_in_rack = true;
    }
    try std.testing.expect(found_in_rack);

    // The card hand itself changed too (both the ability pick and the
    // passive pick landed in PlayerCardIds / card_count).
    try std.testing.expectEqual(@as(u8, 1), state.players[0].card_count);
    try std.testing.expectEqual(p0_last_idx, state.player_card_ids[0].indices[0]);
    try std.testing.expectEqual(@as(u8, 1), state.players[1].card_count);

    // Drafting bookkeeping was wiped for the next round.
    try std.testing.expectEqual(root.world_state.DRAFT_SLOT_NONE, state.player_draft_state[0].picked_slot);
}

test "draft: auto-pick-on-expiry — an unpicked drafter's FIRST offer is granted once the draft window expires, and the round still resolves" {
    var state = freshFightingState();
    state.player_count = 1;
    state.players[0].character_id = .balanced;
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    state.header.rng_state = 777;
    state.header.countdown_remaining_ms = 0.0;

    _ = root.world.stepWorld(&state, 16.0); // -> round_over
    _ = root.world.stepWorld(&state, root.round.ROUND_OVER_HOLD_MS); // -> drafting, offers rolled

    try std.testing.expectEqual(@intFromEnum(root.round.RoundPhase.drafting), state.header.round_phase);
    const offered_idx = state.player_draft_state[0].offers[0] - 1;
    try std.testing.expectEqual(@as(u8, 0), state.players[0].card_count); // nothing picked yet

    // Let the full window run out without ever calling applyCardPick.
    _ = root.world.stepWorld(&state, root.round.DRAFT_WINDOW_MS);

    try std.testing.expectEqual(@intFromEnum(root.round.RoundPhase.countdown), state.header.round_phase);
    try std.testing.expectEqual(@as(u8, 1), state.players[0].card_count); // auto-picked
    try std.testing.expectEqual(offered_idx, state.player_card_ids[0].indices[0]);

    var saw_auto_pick = false;
    var ei: u32 = 0;
    while (ei < state.event_count) : (ei += 1) {
        if (state.events[ei].kind == @intFromEnum(root.world_state.SimEventKind.draft_resolved) and
            state.events[ei].player_idx_a == 0 and state.events[ei].player_idx_b == 1)
        {
            saw_auto_pick = true;
        }
    }
    try std.testing.expect(saw_auto_pick);
}

// ---------------------------------------------------------------------------
// First-blood wager (Track Z0d — port of World.ts's resolveRangedHit claim +
// round.ts FIRST_BLOOD_SPEED_MULTIPLIER). TS-side integration coverage lives
// in client/src/sim/__tests__/firstBloodSuddenDeath.test.ts; cross-boundary
// agreement in client/src/sim/wasm/__tests__/firstBloodParity.test.ts.

test "first blood: the round's first attacker-attributed projectile hit claims it, emits the event, and a later hit cannot steal it" {
    var state = freshFightingState();
    state.player_count = 2;
    state.players[0].flags.alive = true;
    state.players[0].character_id = .balanced;
    state.players[0].health = 100;
    state.players[0].aim_x = 100;
    state.players[0].aim_y = 0;
    setPlayerId(&state.players[0], "attacker");
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 400; // clear of the muzzle + first travel tick
    state.players[1].y = 0;
    setPlayerId(&state.players[1], "victim");

    // Fire ONE real pistol shot (fire_cooldown_ms starts 0 in a zeroed
    // state, so the press fires immediately).
    state.players[0].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    // Unclaimed while the shot is mid-flight.
    try std.testing.expectEqual(@as(u32, 0), state.header.first_blood_idx_plus1);

    // Park the victim ON the live shard so this tick's hit pass resolves it
    // (same geometry-proof idiom as the Facet Break test above).
    state.players[1].x = state.projectiles[0].x;
    state.players[1].y = state.projectiles[0].y;
    state.players[0].current_keys = 0;
    _ = root.world.stepWorld(&state, 1.0);

    // Claimed by player 0 (plus-one encoding), with the event emitted at
    // the claiming hit.
    try std.testing.expectEqual(@as(u32, 1), state.header.first_blood_idx_plus1);
    var saw_event = false;
    var ei: u32 = 0;
    while (ei < state.event_count) : (ei += 1) {
        if (state.events[ei].kind == @intFromEnum(root.world_state.SimEventKind.first_blood) and
            state.events[ei].player_idx_a == 0)
        {
            saw_event = true;
        }
    }
    try std.testing.expect(saw_event);

    // A later hit by the OTHER player cannot steal the claim, and the
    // event does not re-fire (mirrors TS's "second hit in a later round
    // doesn't re-award" + the already-claimed guard).
    state.players[1].health = 100;
    state.players[1].aim_x = state.players[1].x - 100; // aim back at player 0
    state.players[1].aim_y = 0;
    state.players[1].current_keys = FIRE_BIT;
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expect(state.projectile_count >= 1);
    // Park player 0 on player 1's fresh shard (the newest projectile).
    const newest = state.projectile_count - 1;
    state.players[0].x = state.projectiles[newest].x;
    state.players[0].y = state.projectiles[newest].y;
    state.players[1].current_keys = 0;
    const events_before = blk: {
        var n: u32 = 0;
        var ej: u32 = 0;
        while (ej < state.event_count) : (ej += 1) {
            if (state.events[ej].kind == @intFromEnum(root.world_state.SimEventKind.first_blood)) n += 1;
        }
        break :blk n;
    };
    _ = events_before; // events reset per tick; the guard below re-scans fresh
    _ = root.world.stepWorld(&state, 1.0);
    try std.testing.expectEqual(@as(u32, 1), state.header.first_blood_idx_plus1); // still player 0
    var ei2: u32 = 0;
    while (ei2 < state.event_count) : (ei2 += 1) {
        try std.testing.expect(state.events[ei2].kind != @intFromEnum(root.world_state.SimEventKind.first_blood));
    }
}

test "first blood: the claimant covers ~FIRST_BLOOD_SPEED_MULTIPLIER x the distance of an unboosted twin under identical held-Right input" {
    // Two independent single-player worlds with identical zeroed movement
    // state; world B's sole player holds first blood. One tick of held
    // Right from rest — the same one-tick displacement-ratio assertion
    // TS's firstBloodSuddenDeath.test.ts makes (boostedDx >
    // baselineDx * MULTIPLIER - epsilon).
    var base = freshFightingState();
    base.player_count = 1;
    base.players[0].flags.alive = true;
    base.players[0].health = 100;
    base.players[0].current_keys = RIGHT_BIT;
    setPlayerId(&base.players[0], "p0");

    var boosted = base; // value copy — WorldState is pointer-free
    boosted.header.first_blood_idx_plus1 = 1; // player 0 holds it

    _ = root.world.stepWorld(&base, 16.0);
    _ = root.world.stepWorld(&boosted, 16.0);

    const base_dx = base.players[0].x;
    const boosted_dx = boosted.players[0].x;
    try std.testing.expect(base_dx > 0);
    try std.testing.expect(boosted_dx > base_dx * root.round.FIRST_BLOOD_SPEED_MULTIPLIER - 0.01);
}

test "first blood: clears on the countdown -> fighting transition and at countdown entry (round.ts's exact lifecycle)" {
    // countdown -> fighting: the fresh round starts unclaimed.
    var state: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    state.player_count = 1;
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    state.header.round_phase = @intFromEnum(root.round.RoundPhase.countdown);
    state.header.countdown_remaining_ms = 1.0; // transitions THIS tick
    state.header.first_blood_idx_plus1 = 1; // stale claim from the old round
    _ = root.world.stepWorld(&state, 16.0);
    try std.testing.expectEqual(@intFromEnum(root.round.RoundPhase.fighting), state.header.round_phase);
    try std.testing.expectEqual(@as(u32, 0), state.header.first_blood_idx_plus1);

    // drafting -> countdown (window expiry): the claim must not survive
    // into the next round's countdown either (TS clears at BOTH ->countdown
    // transitions; same belt-and-braces as sudden_death_active).
    var state2: root.world_state.WorldState = std.mem.zeroes(root.world_state.WorldState);
    state2.player_count = 1;
    state2.players[0].flags.alive = true;
    state2.players[0].health = 100;
    state2.header.round_phase = @intFromEnum(root.round.RoundPhase.drafting);
    state2.header.countdown_remaining_ms = 1.0; // window expires THIS tick
    state2.header.first_blood_idx_plus1 = 1;
    _ = root.world.stepWorld(&state2, 16.0);
    try std.testing.expectEqual(@intFromEnum(root.round.RoundPhase.countdown), state2.header.round_phase);
    try std.testing.expectEqual(@as(u32, 0), state2.header.first_blood_idx_plus1);
}

// ── Track Z1a item 3 (convergence-goal.md Z1) — ally substrate + the four
//    ally-targeted abilities (Aegis Share / Rally Light / Borrowed Time /
//    Glass Ward). Behavior ports of the expectations in TS's
//    syzygistBuffs.test.ts / World.ts's own case blocks, exercised through
//    the REAL stepWorld pipeline (equip + slot press), not by calling the
//    private helpers directly — the same rigor shape as the ability-
//    dispatch tests above. All constants asserted are the constants.ts
//    values mirrored into world.zig's Z1a block.

fn setTeamId(p: *root.world_state.PlayerEntity, team: []const u8) void {
    p.flags.has_team_id = true;
    p.team_id_len = @intCast(team.len);
    @memcpy(p.team_id_bytes[0..team.len], team);
}

fn allyTestPlayer(state: *root.world_state.WorldState, idx: usize, id: []const u8, x: f64, health: f64) void {
    state.players[idx].flags.alive = true;
    state.players[idx].health = health;
    state.players[idx].x = x;
    state.players[idx].y = 300;
    setPlayerId(&state.players[idx], id);
}

test "ally substrate: Glass Ward — FFA caster self-fallbacks at reduced absorb; a teamed caster wards the nearest ALLY even with an enemy standing closer (isAlly gate)" {
    // FFA half: no team ids anywhere -> isAlly is unconditionally false ->
    // the enemy 60px away is NOT a candidate -> self fallback at 28.
    var state = freshFightingState();
    state.player_count = 2;
    allyTestPlayer(&state, 0, "p0", 100, 100);
    allyTestPlayer(&state, 1, "p1", 160, 100);
    equipSlot(&state, 0, 0, .glass_ward);
    state.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&state, 1000.0); // tick 1
    try std.testing.expectApproxEqAbs(@as(f64, 28.0), state.players[0].syz_ward_absorb_remaining, 1e-9);
    // header.tick(1) + 1 + SYZ_WARD_DURATION_TICKS_DEFAULT(360) — the
    // ward_shell/self_lattice tick-convention.
    try std.testing.expectEqual(@as(u32, 362), state.players[0].syz_ward_absorb_until_tick);
    // The bridge's unpack gates on this bit — without it the pool would be
    // wiped by the next full-sync repack (the Z0e bug class).
    try std.testing.expect(state.players[0].flags.has_syz_ward);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.players[1].syz_ward_absorb_remaining, 1e-9);

    // Duo half: enemy at 60px, teammate at 200px — the ward must SKIP the
    // nearer enemy and land the full 45 pool on the teammate, with NO self
    // fallback on the caster.
    var duo = freshFightingState();
    duo.player_count = 3;
    allyTestPlayer(&duo, 0, "p0", 100, 100);
    allyTestPlayer(&duo, 1, "p1", 160, 100); // enemy, nearest body
    allyTestPlayer(&duo, 2, "p2", 300, 100); // teammate, farther
    setTeamId(&duo.players[0], "t1");
    setTeamId(&duo.players[2], "t1");
    equipSlot(&duo, 0, 0, .glass_ward);
    duo.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&duo, 1000.0);
    try std.testing.expectApproxEqAbs(@as(f64, 45.0), duo.players[2].syz_ward_absorb_remaining, 1e-9);
    try std.testing.expectEqual(@as(u32, 362), duo.players[2].syz_ward_absorb_until_tick);
    try std.testing.expect(duo.players[2].flags.has_syz_ward);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), duo.players[0].syz_ward_absorb_remaining, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), duo.players[1].syz_ward_absorb_remaining, 1e-9);
}

test "ally substrate: Borrowed Time — nearest INJURED ally is chassis-aware (Kindled at 110/125 IS injured, the 2026-07-22 fix), heal caps at REAL max health, debt stamps delayed; FFA caster self-heals the solo figures" {
    // Duo half: the CLOSER teammate is a heavy at 110 health — under the
    // old flat-100 injury check it would read "full" and the cast would
    // fall through to the farther 60-health teammate; under the ported
    // chassis-aware check it MUST be picked and healed to exactly 125
    // (min(maxHealthForPlayer=125, 110+30=140)).
    var duo = freshFightingState();
    duo.player_count = 4;
    allyTestPlayer(&duo, 0, "p0", 100, 40); // caster
    allyTestPlayer(&duo, 1, "p1", 160, 110); // teammate, heavy, CLOSER
    duo.players[1].character_id = .heavy;
    allyTestPlayer(&duo, 2, "p2", 300, 60); // teammate, injured, farther
    allyTestPlayer(&duo, 3, "p3", 130, 10); // enemy, nearest + most injured — never a candidate
    setTeamId(&duo.players[0], "t1");
    setTeamId(&duo.players[1], "t1");
    setTeamId(&duo.players[2], "t1");
    equipSlot(&duo, 0, 0, .borrowed_time);
    duo.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&duo, 1000.0); // tick 1
    try std.testing.expectApproxEqAbs(@as(f64, 125.0), duo.players[1].health, 1e-9);
    // header.tick(1) + 1 + SYZ_BORROWED_TIME_DEBT_DELAY_TICKS(360).
    try std.testing.expectEqual(@as(u32, 362), duo.players[1].debt_until_tick);
    try std.testing.expectApproxEqAbs(@as(f64, 15.0), duo.players[1].debt_amount, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 60.0), duo.players[2].health, 1e-9); // untouched
    try std.testing.expectApproxEqAbs(@as(f64, 10.0), duo.players[3].health, 1e-9); // untouched
    try std.testing.expectApproxEqAbs(@as(f64, 40.0), duo.players[0].health, 1e-9); // no self heal on the ally branch
    try std.testing.expectEqual(@as(u32, 0), duo.players[0].debt_until_tick);

    // FFA half: no allies exist by definition -> self branch, weaker solo
    // figures (heal 15, drain 8).
    var solo = freshFightingState();
    solo.player_count = 2;
    allyTestPlayer(&solo, 0, "p0", 100, 50);
    allyTestPlayer(&solo, 1, "p1", 160, 60); // injured bystander, NOT an ally
    equipSlot(&solo, 0, 0, .borrowed_time);
    solo.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&solo, 1000.0);
    try std.testing.expectApproxEqAbs(@as(f64, 65.0), solo.players[0].health, 1e-9);
    try std.testing.expectEqual(@as(u32, 362), solo.players[0].debt_until_tick);
    try std.testing.expectApproxEqAbs(@as(f64, 8.0), solo.players[0].debt_amount, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 60.0), solo.players[1].health, 1e-9);
}

test "ally substrate: Borrowed Time debt — drains ONCE at debt_until_tick, floored at 0 health without flipping alive; a corpse only clears the bookkeeping" {
    var state = freshFightingState();
    state.player_count = 4;
    allyTestPlayer(&state, 0, "p0", 100, 20); // ordinary drain: 20 - 8 = 12
    state.players[0].debt_until_tick = 2;
    state.players[0].debt_amount = 8;
    allyTestPlayer(&state, 1, "p1", 300, 3); // floor case: max(0, 3 - 8) = 0, alive stays true (TS parity)
    state.players[1].debt_until_tick = 2;
    state.players[1].debt_amount = 8;
    allyTestPlayer(&state, 2, "p2", 500, 30); // corpse: clears, never drains
    state.players[2].flags.alive = false;
    state.players[2].debt_until_tick = 2;
    state.players[2].debt_amount = 5;
    allyTestPlayer(&state, 3, "p3", 700, 100); // bystander keeps the round running

    _ = root.world.stepWorld(&state, 1000.0); // tick 1: 2 > 1, nothing lands
    try std.testing.expectApproxEqAbs(@as(f64, 20.0), state.players[0].health, 1e-9);
    _ = root.world.stepWorld(&state, 1000.0); // tick 2: debts land + clear
    try std.testing.expectApproxEqAbs(@as(f64, 12.0), state.players[0].health, 1e-9);
    try std.testing.expectEqual(@as(u32, 0), state.players[0].debt_until_tick);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.players[0].debt_amount, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), state.players[1].health, 1e-9);
    try std.testing.expect(state.players[1].flags.alive); // floored, not killed — mirrors TS's max(0,...) with no alive write
    try std.testing.expectApproxEqAbs(@as(f64, 30.0), state.players[2].health, 1e-9); // corpse untouched
    try std.testing.expectEqual(@as(u32, 0), state.players[2].debt_until_tick); // ...but cleared
    const health_after_land = state.players[0].health;
    _ = root.world.stepWorld(&state, 1000.0); // tick 3: nothing re-drains
    try std.testing.expectApproxEqAbs(health_after_land, state.players[0].health, 1e-9);
}

test "ally substrate: Rally Light — cast opens the source window; a TEAMMATE inside the 220px aura deals 1.12x ranged damage while an identical non-teammate shooter does not (section 4 amp, TS :1844 parity)" {
    // Duo half: p0 casts Rally Light (source). p1 (teammate, 100px away,
    // inside the 220px radius, NO window of their own) owns a projectile
    // that hits p2 next tick — the hit must carry the 1.12x ally-aura amp.
    var duo = freshFightingState();
    duo.player_count = 3;
    allyTestPlayer(&duo, 0, "p0", 100, 100); // caster/source
    allyTestPlayer(&duo, 1, "p1", 200, 100); // teammate shooter, in aura
    allyTestPlayer(&duo, 2, "p2", 500, 100); // victim
    setTeamId(&duo.players[0], "t1");
    setTeamId(&duo.players[1], "t1");
    equipSlot(&duo, 0, 0, .rally_light);
    duo.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&duo, 16.0); // tick 1: cast
    // header.tick(1) + ceil(5000ms / 16ms = 312.5 -> 313) = 314. (No extra
    // `+1` — stepAbilityDispatch runs AFTER header.tick's per-step
    // increment, so header.tick is already the post-increment tick; see
    // the tick-base fix comment on the `.rally_light` arm in world.zig.)
    try std.testing.expectEqual(@as(u32, 314), duo.players[0].rally_light_until_tick);
    duo.players[0].current_keys = 0;

    // Inject p1's shard so section 3's motion lands it INSIDE p2's body
    // box this coming tick (section 4's player loop tests the END
    // position): 460 + 3000px/s * 0.016s = 508, inside [485, 515].
    duo.projectile_count = 1;
    duo.projectiles[0] = .{
        .x = 460,
        .y = duo.players[2].y,
        .vx = 3000,
        .vy = 0,
        .radius = 4,
        .damage = 10,
        .lifetime_ms = 1000,
        .age_ms = 0,
        .traveled_px = 0,
        .origin_x = 460,
        .origin_y = duo.players[2].y,
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
        .owner_id_len = duo.players[1].id_len,
        .owner_id_bytes = duo.players[1].id_bytes,
    };
    _ = root.world.stepWorld(&duo, 16.0); // tick 2: hit under the ally aura
    try std.testing.expectApproxEqAbs(@as(f64, 100.0 - 10.0 * 1.12), duo.players[2].health, 1e-9);

    // Control half: identical geometry, identical live window on p0, but
    // NO team ids — the aura never reaches the shooter (self-source only
    // covers p0), so the hit lands unamplified.
    var ffa = freshFightingState();
    ffa.player_count = 3;
    allyTestPlayer(&ffa, 0, "p0", 100, 100);
    allyTestPlayer(&ffa, 1, "p1", 200, 100);
    allyTestPlayer(&ffa, 2, "p2", 500, 100);
    equipSlot(&ffa, 0, 0, .rally_light);
    ffa.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&ffa, 16.0);
    ffa.players[0].current_keys = 0;
    ffa.projectile_count = 1;
    ffa.projectiles[0] = duo.projectiles[0];
    ffa.projectiles[0].x = 460;
    ffa.projectiles[0].y = ffa.players[2].y;
    ffa.projectiles[0].lifetime_ms = 1000;
    ffa.projectiles[0].owner_id_len = ffa.players[1].id_len;
    ffa.projectiles[0].owner_id_bytes = ffa.players[1].id_bytes;
    _ = root.world.stepWorld(&ffa, 16.0);
    try std.testing.expectApproxEqAbs(@as(f64, 90.0), ffa.players[2].health, 1e-9);
}

test "ally substrate: Aegis Share — window stamps; a caster with NO ally inside the widened peel radius gets the flat Kindling tick (capped at 100), one WITH an ally in radius does not" {
    // Solo half (FFA — nobody can be an ally): flat Kindling feed, capped.
    var solo = freshFightingState();
    solo.player_count = 2;
    allyTestPlayer(&solo, 0, "p0", 100, 100);
    allyTestPlayer(&solo, 1, "p1", 150, 100);
    solo.players[0].kindling = 95; // 95 + 12 caps at KINDLING_MAX = 100
    equipSlot(&solo, 0, 0, .aegis_share);
    solo.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&solo, 1000.0); // tick 1
    // header.tick(1) + ceil(3000/1000 = 3) = 4. (No extra `+1` — same
    // tick-base fix as rally_light's own arm, see world.zig.)
    try std.testing.expectEqual(@as(u32, 4), solo.players[0].aegis_share_until_tick);
    try std.testing.expectApproxEqAbs(@as(f64, 100.0), solo.players[0].kindling, 1e-9);

    // Duo half: teammate 200px away — inside the widened radius
    // (WARD_PEEL_RADIUS_PX 160 * KIN_AEGIS_SHARE_RADIUS_MULTIPLIER 1.6 =
    // 256) — so the solo fallback must NOT fire; the window still opens.
    var duo = freshFightingState();
    duo.player_count = 2;
    allyTestPlayer(&duo, 0, "p0", 100, 100);
    allyTestPlayer(&duo, 1, "p1", 300, 100);
    setTeamId(&duo.players[0], "t1");
    setTeamId(&duo.players[1], "t1");
    equipSlot(&duo, 0, 0, .aegis_share);
    duo.players[0].current_keys = SLOT1_BIT;
    _ = root.world.stepWorld(&duo, 1000.0);
    try std.testing.expectEqual(@as(u32, 4), duo.players[0].aegis_share_until_tick);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), duo.players[0].kindling, 1e-9);
}

// ── Split-spawn orchestrator (Track E item E1 — gospel-goal.md; the last
//    Z5 scope-cut). world.zig's sections 3/4 now queue every TS-mirrored
//    projectile death and the "4s" pass materialises the child fan via
//    `projectileSplitVelocities` (bit-exact vs TS `spawnSplit`) with
//    spawnSplit's exact field inheritance (projectile.ts:922-955). These
//    tests drive `stepWorld` natively, hand-seeding `state.projectiles` —
//    same "prove the Zig-internal behavior directly" precedent as the
//    hitscan decoy/destructible section above. ──────────────────────────

/// Bystander far from every scenario's geometry — keeps the round machine
/// out of the zero-roster short-circuit without interacting.
fn splitTestBystander(state: *root.world_state.WorldState, idx: usize) void {
    state.players[idx].flags.alive = true;
    state.players[idx].health = 100;
    state.players[idx].x = 50_000;
    state.players[idx].y = 50_000;
    setPlayerId(&state.players[idx], "bystander");
}

/// The shared parent literal: straight shard, split_count=2, damage 30,
/// radius 6, range 400. Individual tests override what they need.
fn splitParentLiteral() root.world_state.ProjectileEntity {
    var p = std.mem.zeroes(root.world_state.ProjectileEntity);
    p.x = 500;
    p.y = 300;
    p.vx = 600;
    p.vy = 0;
    p.radius = 6;
    p.damage = 30;
    p.lifetime_ms = 1000;
    p.age_ms = 100; // past the first-tick muzzle-overlap exemption
    p.traveled_px = 0;
    p.origin_x = 500;
    p.origin_y = 300;
    p.range_px = 400;
    p.slow_multiplier = 1;
    p.id = 900;
    p.split_count = 2;
    p.flags = .{
        .has_owner = false,
        .has_impact = true,
        .has_split = true,
        .has_slow = false,
        .has_homing = false,
        .has_acceleration = false,
        .has_gravity_scale = false,
        .has_range = true,
        .has_age = true,
        .has_traveled = true,
        .has_origin = true,
        .returning = false,
        .has_sticky_fuse = false,
        .has_impact_radius = false,
    };
    p.pathing = .straight;
    p.element = .neutral;
    p.impact = .none;
    p.shape = .circle;
    return p;
}

test "split-spawn: lifetime expiry — a split_count=2 shard whose residual lifetime <= dt dies PRE-motion and fans exactly 2 children with spawnSplit's field inheritance, threading header.rng_state one draw per child" {
    var state = freshFightingState();
    state.player_count = 1;
    splitTestBystander(&state, 0);
    state.header.rng_state = 12345;
    state.header.next_entity_id = 40;

    state.projectile_count = 1;
    state.projectiles[0] = splitParentLiteral();
    state.projectiles[0].lifetime_ms = 10.0; // <= dt -> .lifetime_expired

    // Independently compute the expected fan from the same parent
    // snapshot + rng cursor the orchestrator must use.
    const parent_snapshot = state.projectiles[0];
    var expected_fan: [root.projectile.SPLIT_MAX]root.projectile.SplitVelocity = undefined;
    const expected = root.projectile.projectileSplitVelocities(&parent_snapshot, 12345, expected_fan[0..]);
    try std.testing.expectEqual(@as(u32, 2), expected.count);

    _ = root.world.stepWorld(&state, 16.0);

    // Parent genuinely died + compacted (pre-E1 it froze as a zombie —
    // .lifetime_expired was unhandled); exactly the 2 children remain.
    try std.testing.expectEqual(@as(u32, 2), state.projectile_count);
    try std.testing.expectEqual(expected.rng_state, state.header.rng_state);
    try std.testing.expectEqual(@as(u32, 42), state.header.next_entity_id);
    var ci: u32 = 0;
    while (ci < 2) : (ci += 1) {
        const child = &state.projectiles[ci];
        try std.testing.expectEqual(expected_fan[ci].vx, child.vx);
        try std.testing.expectEqual(expected_fan[ci].vy, child.vy);
        // Death was PRE-motion: children spawn at the parent's frozen
        // position, which is also their origin.
        try std.testing.expectEqual(@as(f64, 500.0), child.x);
        try std.testing.expectEqual(@as(f64, 300.0), child.y);
        try std.testing.expectEqual(@as(f64, 500.0), child.origin_x);
        try std.testing.expectEqual(@as(f64, 300.0), child.origin_y);
        // spawnSplit inheritance (projectile.ts:922-955).
        try std.testing.expectEqual(@as(f64, 30.0 * 0.42), child.damage);
        try std.testing.expectEqual(@as(f64, 6.0 * 0.78), child.radius);
        try std.testing.expectEqual(@as(f64, 280.0), child.lifetime_ms); // max(280, 10*0.42)
        try std.testing.expectEqual(@as(f64, 400.0 * 0.32), child.range_px);
        try std.testing.expectEqual(@as(u32, 0), child.split_count); // no cascade
        try std.testing.expectEqual(@as(u32, 0), child.pierce_remaining);
        try std.testing.expectEqual(@as(u32, 0), child.bounces_remaining);
        try std.testing.expectEqual(root.world_state.ProjectilePathing.straight, child.pathing);
        try std.testing.expectEqual(root.world_state.ProjectileImpact.none, child.impact);
        try std.testing.expectEqual(@as(f64, 0.0), child.age_ms);
        try std.testing.expectEqual(@as(f64, 0.0), child.traveled_px);
        try std.testing.expectEqual(false, child.flags.has_split);
        try std.testing.expectEqual(@as(u32, 40 + ci), child.id);
    }
}

test "split-spawn: no-split control — an identical shard with split_count=0 dies leaving NOTHING, no rng draw, no id burn" {
    var state = freshFightingState();
    state.player_count = 1;
    splitTestBystander(&state, 0);
    state.header.rng_state = 12345;
    state.header.next_entity_id = 40;

    state.projectile_count = 1;
    state.projectiles[0] = splitParentLiteral();
    state.projectiles[0].lifetime_ms = 10.0;
    state.projectiles[0].split_count = 0;
    state.projectiles[0].flags.has_split = false;

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 0), state.projectile_count);
    try std.testing.expectEqual(@as(u32, 12345), state.header.rng_state);
    try std.testing.expectEqual(@as(u32, 40), state.header.next_entity_id);
}

test "split-spawn: player-hit consumption — the fan spawns at the POST-motion contact position and the child lifetime scales from the parent's PRE-decrement lifetime (max(280, 1000*0.42) = 420, not 413.28)" {
    var state = freshFightingState();
    state.player_count = 2;
    splitTestBystander(&state, 0);
    state.players[1].flags.alive = true;
    state.players[1].health = 100;
    state.players[1].x = 600;
    state.players[1].y = 300; // shard arrives dead body-centre -> no headshot
    setPlayerId(&state.players[1], "victim");
    state.header.rng_state = 777;
    state.header.next_entity_id = 10;

    state.projectile_count = 1;
    state.projectiles[0] = splitParentLiteral();
    state.projectiles[0].x = 580; // 580 + 600*0.016 = 589.6; victim box left edge 585
    state.projectiles[0].origin_x = 580;

    const parent_snapshot = state.projectiles[0]; // straight: velocity unchanged by motion
    var expected_fan: [root.projectile.SPLIT_MAX]root.projectile.SplitVelocity = undefined;
    const expected = root.projectile.projectileSplitVelocities(&parent_snapshot, 777, expected_fan[0..]);

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectApproxEqAbs(@as(f64, 70.0), state.players[1].health, 1e-9);
    try std.testing.expectEqual(@as(u32, 2), state.projectile_count);
    try std.testing.expectEqual(expected.rng_state, state.header.rng_state);
    var ci: u32 = 0;
    while (ci < 2) : (ci += 1) {
        const child = &state.projectiles[ci];
        try std.testing.expectEqual(expected_fan[ci].vx, child.vx);
        try std.testing.expectEqual(expected_fan[ci].vy, child.vy);
        // POST-motion contact position (TS's split parent carries the
        // integrated x/y at the hit, projectile.ts:513-522).
        try std.testing.expectEqual(@as(f64, 580.0 + 600.0 * 0.016), child.x);
        try std.testing.expectEqual(@as(f64, 300.0), child.y);
        // PRE-decrement lifetime restore (queueSplitDeath's lifetime_pre):
        // 1000 * 0.42 = 420 exactly; the post-decrement value would give
        // (1000 - 16) * 0.42 = 413.28.
        try std.testing.expectEqual(@as(f64, 420.0), child.lifetime_ms);
    }
}

test "split-spawn: terrain impact — a shard flying into a static wall dies at its integrated position and fans children there" {
    var state = freshFightingState();
    state.player_count = 1;
    splitTestBystander(&state, 0);
    state.header.rng_state = 999;
    state.header.next_entity_id = 1;

    state.static_count = 1;
    state.statics[0] = .{ .x = 585, .y = 200, .w = 40, .h = 200 };

    state.projectile_count = 1;
    state.projectiles[0] = splitParentLiteral();
    state.projectiles[0].x = 580; // integrates to 589.6, radius 6 overlaps the wall at 585
    state.projectiles[0].origin_x = 580;

    const parent_snapshot = state.projectiles[0];
    var expected_fan: [root.projectile.SPLIT_MAX]root.projectile.SplitVelocity = undefined;
    const expected = root.projectile.projectileSplitVelocities(&parent_snapshot, 999, expected_fan[0..]);

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 2), state.projectile_count);
    try std.testing.expectEqual(expected.rng_state, state.header.rng_state);
    try std.testing.expectEqual(expected_fan[0].vx, state.projectiles[0].vx);
    try std.testing.expectEqual(expected_fan[1].vx, state.projectiles[1].vx);
    try std.testing.expectEqual(@as(f64, 580.0 + 600.0 * 0.016), state.projectiles[0].x);
}

test "split-spawn: sticky fuse-end — a stuck (vx=vy=0) shard whose fuse runs out fans split_count=3 children on the zero-velocity floor-speed fan (child speed 180)" {
    var state = freshFightingState();
    state.player_count = 1;
    splitTestBystander(&state, 0);
    state.header.rng_state = 4242;
    state.header.next_entity_id = 1;

    state.projectile_count = 1;
    state.projectiles[0] = splitParentLiteral();
    state.projectiles[0].vx = 0;
    state.projectiles[0].vy = 0;
    state.projectiles[0].impact = .sticky;
    state.projectiles[0].split_count = 3;
    state.projectiles[0].flags.has_sticky_fuse = true;
    state.projectiles[0].sticky_fuse_ms = 10.0; // <= dt -> .sticky_expired

    const parent_snapshot = state.projectiles[0];
    var expected_fan: [root.projectile.SPLIT_MAX]root.projectile.SplitVelocity = undefined;
    const expected = root.projectile.projectileSplitVelocities(&parent_snapshot, 4242, expected_fan[0..]);
    try std.testing.expectEqual(@as(u32, 3), expected.count);

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 3), state.projectile_count);
    try std.testing.expectEqual(expected.rng_state, state.header.rng_state);
    var ci: u32 = 0;
    while (ci < 3) : (ci += 1) {
        const child = &state.projectiles[ci];
        try std.testing.expectEqual(expected_fan[ci].vx, child.vx);
        try std.testing.expectEqual(expected_fan[ci].vy, child.vy);
        // Zero-velocity parent -> child speed is the 180 floor (within
        // the 1024-entry trig LUT's quantization — lutCos/lutSin aren't
        // an exactly-unit pair; the fan bit-equality above is the real
        // proof, this is a readability check on the magnitude).
        try std.testing.expectApproxEqAbs(@as(f64, 180.0), @sqrt(child.vx * child.vx + child.vy * child.vy), 1e-4);
        // Sticky parents pass sticky on to children (projectile.ts:942)…
        try std.testing.expectEqual(root.world_state.ProjectileImpact.sticky, child.impact);
        // …but the fuse itself is NOT armed until the child sticks.
        try std.testing.expectEqual(false, child.flags.has_sticky_fuse);
    }
}

test "split-spawn: range cap — the (new, TS projectile.ts:700) range-cap death both kills the shard and fans children; a no-split shard at range just dies" {
    var state = freshFightingState();
    state.player_count = 1;
    splitTestBystander(&state, 0);
    state.header.rng_state = 31337;
    state.header.next_entity_id = 1;

    state.projectile_count = 1;
    state.projectiles[0] = splitParentLiteral();
    state.projectiles[0].range_px = 50;
    state.projectiles[0].traveled_px = 45; // + 9.6 this tick -> 54.6 >= 50

    const parent_snapshot = state.projectiles[0];
    var expected_fan: [root.projectile.SPLIT_MAX]root.projectile.SplitVelocity = undefined;
    const expected = root.projectile.projectileSplitVelocities(&parent_snapshot, 31337, expected_fan[0..]);

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 2), state.projectile_count);
    try std.testing.expectEqual(expected.rng_state, state.header.rng_state);
    try std.testing.expectEqual(expected_fan[0].vx, state.projectiles[0].vx);
    // Children inherit the scaled range: 50 * 0.32 = 16.
    try std.testing.expectEqual(@as(f64, 16.0), state.projectiles[0].range_px);

    // Control: same geometry, no split -> the shard dies alone.
    var state2 = freshFightingState();
    state2.player_count = 1;
    splitTestBystander(&state2, 0);
    state2.header.rng_state = 31337;
    state2.projectile_count = 1;
    state2.projectiles[0] = splitParentLiteral();
    state2.projectiles[0].range_px = 50;
    state2.projectiles[0].traveled_px = 45;
    state2.projectiles[0].split_count = 0;
    state2.projectiles[0].flags.has_split = false;
    _ = root.world.stepWorld(&state2, 16.0);
    try std.testing.expectEqual(@as(u32, 0), state2.projectile_count);
    try std.testing.expectEqual(@as(u32, 31337), state2.header.rng_state);
}

test "split-spawn: boomerang home-return — a returning boomerang crossing its origin catch radius (16 + radius) dies and fans children (the other new TS site, projectile.ts:673)" {
    var state = freshFightingState();
    state.player_count = 1;
    splitTestBystander(&state, 0);
    state.header.rng_state = 606;
    state.header.next_entity_id = 1;

    state.projectile_count = 1;
    state.projectiles[0] = splitParentLiteral();
    state.projectiles[0].pathing = .boomerang;
    state.projectiles[0].flags.returning = true;
    // Aligned dead-on at the origin ahead (+x): rotate-toward is a no-op,
    // and the integrated position lands 0.4px short of the origin — well
    // inside the 16 + 6 catch radius.
    state.projectiles[0].x = 495;
    state.projectiles[0].origin_x = 505;
    state.projectiles[0].origin_y = 300;
    state.projectiles[0].range_px = 10_000; // stay clear of the range cap
    state.projectiles[0].traveled_px = 9_000; // returning already latched

    _ = root.world.stepWorld(&state, 16.0);

    // Parent died at the catch, 2 children remain (both straight —
    // children never inherit boomerang pathing).
    try std.testing.expectEqual(@as(u32, 2), state.projectile_count);
    try std.testing.expect(state.header.rng_state != 606);
    try std.testing.expectEqual(root.world_state.ProjectilePathing.straight, state.projectiles[0].pathing);
    try std.testing.expectEqual(root.world_state.ProjectilePathing.straight, state.projectiles[1].pathing);
}

// ── classModifiers codegen port (Track E1 — gospel-goal.md) ──────────────
// gen_card_data.ts now emits cardTypes.ts's `classModifiers` as per-class
// CardMod literals (CardEntry.class_mods, wholesale-replace semantics via
// effectiveCardMod), the class-gated starter bases (class_bases —
// weapons.ts baseWeaponForClass), and `leech_fraction` as a first-class
// CardMod field. These pins guard the generated data model itself; the
// byte-level TS parity lives in classModifierGapFieldsParity.test.ts /
// weaponBuildParity.test.ts's full class walks.

fn cardEntryById(id: []const u8) ?*const root.cards_gen.CardEntry {
    for (&root.cards_gen.cards) |*c| {
        if (std.mem.eql(u8, c.id, id)) return c;
    }
    return null;
}

test "cards_gen: exactly 9 cards carry class_mods (the classModifiers set)" {
    var n: usize = 0;
    for (root.cards_gen.cards) |c| {
        const cm = c.class_mods;
        if (cm.wizard != null or cm.ninja != null or cm.paladin != null or cm.priest != null) n += 1;
    }
    try std.testing.expectEqual(@as(usize, 9), n);
}

test "cards_gen: effectiveCardMod — authored override replaces wholesale, absent class falls back, null class is class-blind" {
    const entry = cardEntryById("cluster-bomb").?;
    // Paladin authored: 2-split, bigger chips.
    const pal = root.cards_gen.effectiveCardMod(entry, .paladin);
    try std.testing.expectEqual(@as(f64, 2), pal.proj_split_add);
    try std.testing.expectEqual(@as(f64, 1.35), pal.proj_size_mul);
    // Ninja unauthored: the class-blind modifier, byte-for-byte.
    const nin = root.cards_gen.effectiveCardMod(entry, .ninja);
    try std.testing.expectEqual(entry.mod, nin);
    try std.testing.expectEqual(@as(f64, 6), nin.proj_split_add);
    // Class-blind (null): also the base modifier.
    try std.testing.expectEqual(entry.mod, root.cards_gen.effectiveCardMod(entry, null));
}

test "cards_gen: class_bases — wizard/ninja share starter_base; paladin/priest carry their authored starter stats" {
    try std.testing.expectEqual(@as(?root.cards_gen.BaseWeapon, null), root.cards_gen.class_bases[0]); // wizard
    try std.testing.expectEqual(@as(?root.cards_gen.BaseWeapon, null), root.cards_gen.class_bases[1]); // ninja
    const pal = root.cards_gen.class_bases[2].?;
    try std.testing.expectEqual(@as(u8, 0), pal.delivery); // explicit projectile override
    try std.testing.expectEqual(@as(f64, 15), pal.damage);
    try std.testing.expectEqual(@as(f64, 3), pal.fire_rate);
    try std.testing.expectEqual(@as(f64, 1.15), pal.p_size_mul);
    const pri = root.cards_gen.class_bases[3].?;
    try std.testing.expectEqual(@as(u8, 0), pri.delivery);
    try std.testing.expectEqual(@as(f64, 2.5), pri.damage); // SYZ_TENDRIL_DAMAGE
    try std.testing.expectEqual(@as(f64, 3), pri.p_count); // SYZ_TENDRIL_COUNT
    try std.testing.expectEqual(@as(u8, 4), pri.p_pathing); // homing
    try std.testing.expectEqual(@as(u8, 2), pri.p_element); // fire
    // Fallbacks resolve the shared starter (raycast since true-hitscan).
    try std.testing.expectEqual(root.cards_gen.starter_base, root.cards_gen.baseWeaponForClass(null));
    try std.testing.expectEqual(root.cards_gen.starter_base, root.cards_gen.baseWeaponForClass(.ninja));
    try std.testing.expectEqual(@as(u8, 1), root.cards_gen.starter_base.delivery);
}

test "weapon_build: stolen-fangs' Priest-only leech resolves in-sim (patchLeechFraction stopgap retired)" {
    const hand = [_][]const u8{"stolen-fangs"};
    const pri = root.weapon_build.resolveBuild(&hand, .priest);
    try std.testing.expectApproxEqAbs(@as(f32, 0.08), pri.leech_fraction, 1e-6);
    const nin = root.weapon_build.resolveBuild(&hand, .ninja);
    try std.testing.expectEqual(@as(f32, 0), nin.leech_fraction);
}

test "weapon_build: cluster-bomb resolves per class — paladin 2-split on the heavy base, ninja class-blind 6-split" {
    const hand = [_][]const u8{"cluster-bomb"};
    const pal = root.weapon_build.resolveBuild(&hand, .paladin);
    try std.testing.expectEqual(@as(u32, 2), pal.split_count);
    // paladinStarterWeapon fire_rate 3 x the card's 0.72 = 2.16 (round2).
    try std.testing.expectApproxEqAbs(@as(f64, 2.16), pal.fire_rate, 1e-9);
    const nin = root.weapon_build.resolveBuild(&hand, .ninja);
    try std.testing.expectEqual(@as(u32, 6), nin.split_count);
}

// ── Hangout flag (Track E1d — gospel-goal.md "hangout flag in `step_world`",
//    lifting the hosts' TS-only pin; docs/venue-goal.md's no-PvP lobby).
//    Each test drives the COMBAT control first (proves the behavior is
//    reachable — vacuity guard), then the identical scenario under
//    world_state_set_hangout_mode(1). The flag is a module-level step
//    input, so every test defers a reset to 0. ───────────────────────────

test "hangout: real projectiles ghost through players — zero damage, shard keeps flying; identical combat scenario lands the hit (vacuity guard)" {
    defer root.world.world_state_set_hangout_mode(0);

    // Combat control: the shard consumes on the victim's body.
    {
        root.world.world_state_set_hangout_mode(0);
        var state = freshFightingState();
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 600;
        state.players[0].y = 300; // dead body-centre -> no headshot band question
        setPlayerId(&state.players[0], "victim");
        state.projectile_count = 1;
        state.projectiles[0] = splitParentLiteral();
        state.projectiles[0].split_count = 0;
        state.projectiles[0].flags.has_split = false;
        state.projectiles[0].x = 580; // 580 + 600*0.016 = 589.6; victim box left edge 585
        state.projectiles[0].origin_x = 580;
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expectApproxEqAbs(@as(f64, 70.0), state.players[0].health, 1e-9);
        try std.testing.expectEqual(@as(u32, 0), state.projectile_count); // consumed
    }

    // Hangout: same shard, same victim — ghosts straight through
    // (World.ts:6770's empty projectilePlayerIds mirror).
    {
        root.world.world_state_set_hangout_mode(1);
        var state = freshFightingState();
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 600;
        state.players[0].y = 300;
        setPlayerId(&state.players[0], "victim");
        state.projectile_count = 1;
        state.projectiles[0] = splitParentLiteral();
        state.projectiles[0].split_count = 0;
        state.projectiles[0].flags.has_split = false;
        state.projectiles[0].x = 580;
        state.projectiles[0].origin_x = 580;
        // 4 ticks: 580 -> ~618.4, all the way THROUGH the body (right edge
        // 615) and out the far side, never connecting.
        var t: u32 = 0;
        while (t < 4) : (t += 1) _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.players[0].health, 1e-9);
        try std.testing.expectEqual(@as(u32, 1), state.projectile_count); // still flying
        try std.testing.expect(state.projectiles[0].x > 615.0); // genuinely passed through
    }
}

test "hangout: hitscan ghosts players but still breaks practice dummies; identical combat ray hits the player and never reaches the dummy (vacuity guard)" {
    defer root.world.world_state_set_hangout_mode(0);

    // Combat control: the ray stops on the player (pierce 0), dummy behind
    // is untouched.
    {
        root.world.world_state_set_hangout_mode(0);
        var state = freshFightingState();
        state.player_count = 2;
        setupHitscanShooter(&state, 0, "shooter", 500, 0);
        state.players[1].flags.alive = true;
        state.players[1].health = 100;
        state.players[1].x = 300;
        state.players[1].y = RAY_Y; // body centre dead on the ray
        setPlayerId(&state.players[1], "victim");
        state.destructible_count = 1;
        state.destructibles[0] = .{
            .x = 400,
            .y = RAY_Y,
            .width = 32,
            .height = 64,
            .health = 50,
            .id = 101,
            .flags = 0,
            .kind = .box,
        };
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(state.players[1].health < 100.0);
        try std.testing.expectApproxEqAbs(@as(f64, 50.0), state.destructibles[0].health, 1e-9);
    }

    // Hangout: EMPTY player candidate pool (World.ts:3113 mirror) — the ray
    // ghosts the same victim and connects with the dummy behind them.
    {
        root.world.world_state_set_hangout_mode(1);
        var state = freshFightingState();
        state.player_count = 2;
        setupHitscanShooter(&state, 0, "shooter", 500, 0);
        state.players[1].flags.alive = true;
        state.players[1].health = 100;
        state.players[1].x = 300;
        state.players[1].y = RAY_Y;
        setPlayerId(&state.players[1], "victim");
        state.destructible_count = 1;
        state.destructibles[0] = .{
            .x = 400,
            .y = RAY_Y,
            .width = 32,
            .height = 64,
            .health = 50,
            .id = 101,
            .flags = 0,
            .kind = .box,
        };
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.players[1].health, 1e-9);
        try std.testing.expectApproxEqAbs(@as(f64, 30.0), state.destructibles[0].health, 1e-9); // raw base 20, dummies still break
    }
}

test "hangout: round machine frozen — countdown never decrements, a stale non-fighting phase neither transitions nor freezes movement (the is_fighting OR-pin); combat control decrements (vacuity guard)" {
    defer root.world.world_state_set_hangout_mode(0);

    // Combat control: roundStepPhase decrements the fighting countdown.
    {
        root.world.world_state_set_hangout_mode(0);
        var state = freshFightingState();
        state.player_count = 2;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        setPlayerId(&state.players[0], "a");
        state.players[1].flags.alive = true;
        state.players[1].health = 100;
        state.players[1].x = 500;
        setPlayerId(&state.players[1], "b");
        _ = root.world.stepWorld(&state, 2000.0);
        try std.testing.expectApproxEqAbs(@as(f64, 88_000.0), state.header.countdown_remaining_ms, 1e-9);
    }

    // Hangout: the whole section-1 machine is skipped (World.ts:7407
    // passthrough) — clock frozen, no events, rng untouched.
    {
        root.world.world_state_set_hangout_mode(1);
        var state = freshFightingState();
        state.player_count = 2;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        setPlayerId(&state.players[0], "a");
        state.players[1].flags.alive = true;
        state.players[1].health = 100;
        state.players[1].x = 500;
        setPlayerId(&state.players[1], "b");
        state.header.rng_state = 4242;
        _ = root.world.stepWorld(&state, 2000.0);
        try std.testing.expectApproxEqAbs(@as(f64, 90_000.0), state.header.countdown_remaining_ms, 1e-9);
        try std.testing.expectEqual(@as(u8, @intFromEnum(root.round.RoundPhase.fighting)), state.header.round_phase);
        try std.testing.expectEqual(@as(u32, 4242), state.header.rng_state);
        try std.testing.expectEqual(@as(u32, 0), state.event_count);
    }

    // Hangout + a STALE non-fighting phase cell: movement stays live (the
    // World.ts:2510 fightingPhase OR-pin) and the frozen machine never
    // "fixes" the phase either.
    {
        root.world.world_state_set_hangout_mode(1);
        var state = freshFightingState();
        state.header.round_phase = @intFromEnum(root.round.RoundPhase.countdown);
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 100;
        state.players[0].y = 0;
        state.players[0].current_keys = 1 << 1; // Right held
        setPlayerId(&state.players[0], "walker");
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(state.players[0].x > 100.0); // moved despite phase
        try std.testing.expectEqual(@as(u8, @intFromEnum(root.round.RoundPhase.countdown)), state.header.round_phase);
    }
}

test "hangout: a void-plane fall is a SILENT respawn at the map's first spawn point — no death, no events; combat control kills (vacuity guard)" {
    defer root.world.world_state_set_hangout_mode(0);
    defer root.world.world_state_set_arena_bounds(0, 0, 0);
    defer {
        const none = [_]f64{};
        _ = root.world.world_state_set_spawn_points(&none, 0);
    }

    root.world.world_state_set_arena_bounds(0, 0, 1000);
    const spawn_flat = [_]f64{ 111.0, 222.0 };
    _ = root.world.world_state_set_spawn_points(&spawn_flat, 1);

    // Combat control: force-kill + hit_confirmed + player_killed.
    {
        root.world.world_state_set_hangout_mode(0);
        var state = freshFightingState();
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 300;
        state.players[0].y = 2000; // past the 1000 kill plane
        setPlayerId(&state.players[0], "faller");
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(!state.players[0].flags.alive);
        var saw_kill = false;
        var ei: u32 = 0;
        while (ei < state.event_count) : (ei += 1) {
            if (state.events[ei].kind == @intFromEnum(root.world_state.SimEventKind.player_killed)) saw_kill = true;
        }
        try std.testing.expect(saw_kill);
    }

    // Hangout: World.ts:6397 mirror — alive, teleported to spawns[0],
    // velocity zeroed, zero events.
    {
        root.world.world_state_set_hangout_mode(1);
        var state = freshFightingState();
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 300;
        state.players[0].y = 2000;
        state.players[0].vx = 50;
        state.players[0].vy = 900;
        setPlayerId(&state.players[0], "faller");
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(state.players[0].flags.alive);
        try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.players[0].health, 1e-9);
        try std.testing.expectApproxEqAbs(@as(f64, 111.0), state.players[0].x, 1e-9);
        try std.testing.expectApproxEqAbs(@as(f64, 222.0), state.players[0].y, 1e-9);
        try std.testing.expectEqual(@as(f64, 0.0), state.players[0].vx);
        try std.testing.expectEqual(@as(f64, 0.0), state.players[0].vy);
        try std.testing.expectEqual(@as(u32, 0), state.event_count);
    }
}

test "hangout: the shrink-zone storm never ticks — the pinned round clock would otherwise read as 'final seconds' forever; combat control burns (vacuity guard)" {
    defer root.world.world_state_set_hangout_mode(0);
    defer root.world.world_state_set_arena_size(0, 0);

    root.world.world_state_set_arena_size(4000, 4000);

    // Combat control: countdown 100ms -> deep in the soft endgame zone; a
    // corner player sits outside the safe radius and takes storm DoT.
    {
        root.world.world_state_set_hangout_mode(0);
        var state = freshFightingState();
        state.header.countdown_remaining_ms = 100.0;
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 100;
        state.players[0].y = 100;
        setPlayerId(&state.players[0], "corner");
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(state.players[0].health < 100.0);
    }

    // Hangout: identical corner player, storm skipped entirely
    // (World.ts:7167 mirror).
    {
        root.world.world_state_set_hangout_mode(1);
        var state = freshFightingState();
        state.header.countdown_remaining_ms = 100.0;
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 100;
        state.players[0].y = 100;
        setPlayerId(&state.players[0], "corner");
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expectApproxEqAbs(@as(f64, 100.0), state.players[0].health, 1e-9);
    }
}

// ── Homing (Track E1 residual, fixed 2026-08-09) ─────────────────────────
//
// stepWorld handed projectile.stepV2 empty player arrays, so under wasm
// authority a homing shot could never acquire a target and flew dead
// straight. These pin the fix, and each carries a vacuity guard so a
// future regression that simply stops running the branch fails loudly
// instead of passing by doing nothing.

/// A live homing shard travelling +x at (500,300), no owner.
fn homingShardLiteral() root.world_state.ProjectileEntity {
    var p = std.mem.zeroes(root.world_state.ProjectileEntity);
    p.x = 500;
    p.y = 300;
    p.vx = 600;
    p.vy = 0;
    p.radius = 6;
    p.damage = 1; // keep the target alive so the turn is what is measured
    p.lifetime_ms = 5000;
    p.age_ms = 100; // past the first-tick muzzle-overlap exemption
    p.origin_x = 500;
    p.origin_y = 300;
    p.slow_multiplier = 1;
    p.id = 901;
    p.pathing = .homing;
    // Set fields on the already-zeroed flags rather than writing a full
    // struct literal: ProjectileFlags grows, and an exhaustive literal
    // here would break every time someone adds a flag that has nothing to
    // do with homing.
    p.flags.has_age = true;
    p.flags.has_origin = true;
    p.flags.has_homing = false; // false = default turn rate
    return p;
}

test "homing: a shard turns toward the only living player (the E1 gap: empty player arrays meant it never turned)" {
    var state = freshFightingState();
    state.player_count = 1;
    state.players[0].flags.alive = true;
    state.players[0].health = 100;
    // Well below and ahead: a straight shot would keep vy == 0 exactly.
    state.players[0].x = 900;
    state.players[0].y = 900;
    setPlayerId(&state.players[0], "prey");
    state.projectile_count = 1;
    state.projectiles[0] = homingShardLiteral();

    _ = root.world.stepWorld(&state, 16.0);

    try std.testing.expectEqual(@as(u32, 1), state.projectile_count);
    // Turned DOWNWARD (toward +y) — the whole bug was vy staying 0.
    try std.testing.expect(state.projectiles[0].vy > 0.0);
    // Speed is conserved: rotateVelocityToward rotates, never accelerates.
    // Tolerance is LUT-sized, not float-sized — the rotation goes through
    // lutCos/lutSin (the shared table that makes trig bit-identical across
    // hosts, ADR-0006), so a pure rotation lands ~1e-4 off the input speed
    // by construction. Measured 599.99986 for 600. Asserting 1e-6 here
    // would be asserting that the determinism mechanism does not exist.
    const p0 = state.projectiles[0];
    const speed = @sqrt(p0.vx * p0.vx + p0.vy * p0.vy);
    try std.testing.expectApproxEqAbs(@as(f64, 600.0), speed, 0.01);
}

test "homing: a DEAD player is not a target — the shard flies straight (vacuity guard: the same shard turns for a live one)" {
    // Dead: no turn.
    {
        var state = freshFightingState();
        state.player_count = 1;
        state.players[0].flags.alive = false;
        state.players[0].x = 900;
        state.players[0].y = 900;
        setPlayerId(&state.players[0], "corpse");
        state.projectile_count = 1;
        state.projectiles[0] = homingShardLiteral();
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expectEqual(@as(f64, 0.0), state.projectiles[0].vy);
    }
    // Alive: turns. Without this the test above passes even if homing is
    // ripped out entirely.
    {
        var state = freshFightingState();
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 900;
        state.players[0].y = 900;
        setPlayerId(&state.players[0], "prey");
        state.projectile_count = 1;
        state.projectiles[0] = homingShardLiteral();
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(state.projectiles[0].vy > 0.0);
    }
}

test "homing: the owner is never its own target (vacuity guard: a second, further player IS)" {
    // Owner only: nothing to home at.
    {
        var state = freshFightingState();
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 900;
        state.players[0].y = 900;
        setPlayerId(&state.players[0], "shooter");
        state.projectile_count = 1;
        state.projectiles[0] = homingShardLiteral();
        state.projectiles[0].flags.has_owner = true;
        state.projectiles[0].owner_id_len = 7;
        @memcpy(state.projectiles[0].owner_id_bytes[0..7], "shooter");
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expectEqual(@as(f64, 0.0), state.projectiles[0].vy);
    }
    // Owner + a stranger further away: the stranger is the target, so the
    // exclusion is the owner specifically, not "any player".
    {
        var state = freshFightingState();
        state.player_count = 2;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 900;
        state.players[0].y = 900;
        setPlayerId(&state.players[0], "shooter");
        state.players[1].flags.alive = true;
        state.players[1].health = 100;
        state.players[1].x = 1400;
        state.players[1].y = 1400;
        setPlayerId(&state.players[1], "stranger");
        state.projectile_count = 1;
        state.projectiles[0] = homingShardLiteral();
        state.projectiles[0].flags.has_owner = true;
        state.projectiles[0].owner_id_len = 7;
        @memcpy(state.projectiles[0].owner_id_bytes[0..7], "shooter");
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(state.projectiles[0].vy > 0.0);
    }
}

test "homing: NEAREST wins, and anti-homing steers the opposite way from the same target" {
    // Nearest of two: the near one is ABOVE, the far one BELOW, so the
    // sign of vy says which was chosen.
    {
        var state = freshFightingState();
        state.player_count = 2;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 560;
        state.players[0].y = 100; // near, above
        setPlayerId(&state.players[0], "near");
        state.players[1].flags.alive = true;
        state.players[1].health = 100;
        state.players[1].x = 1500;
        state.players[1].y = 1500; // far, below
        setPlayerId(&state.players[1], "far");
        state.projectile_count = 1;
        state.projectiles[0] = homingShardLiteral();
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(state.projectiles[0].vy < 0.0); // chased the near one, upward
    }
    // anti-homing: same single target, opposite turn.
    {
        var state = freshFightingState();
        state.player_count = 1;
        state.players[0].flags.alive = true;
        state.players[0].health = 100;
        state.players[0].x = 900;
        state.players[0].y = 900; // below
        setPlayerId(&state.players[0], "prey");
        state.projectile_count = 1;
        state.projectiles[0] = homingShardLiteral();
        state.projectiles[0].pathing = .anti_homing;
        _ = root.world.stepWorld(&state, 16.0);
        try std.testing.expect(state.projectiles[0].vy < 0.0); // fled upward
    }
}

test "homing: homing_strength overrides the default turn rate (a stronger shard turns further in one tick)" {
    const turnFor = struct {
        fn run(strength: f64, has_strength: bool) f64 {
            var state = freshFightingState();
            state.player_count = 1;
            state.players[0].flags.alive = true;
            state.players[0].health = 100;
            state.players[0].x = 900;
            state.players[0].y = 900;
            setPlayerId(&state.players[0], "prey");
            state.projectile_count = 1;
            state.projectiles[0] = homingShardLiteral();
            state.projectiles[0].flags.has_homing = has_strength;
            state.projectiles[0].homing_strength = strength;
            _ = root.world.stepWorld(&state, 16.0);
            return state.projectiles[0].vy;
        }
    }.run;

    const default_vy = turnFor(0, false);
    const strong_vy = turnFor(root.projectile.HOMING_TURN_RATE_DEFAULT * 3.0, true);
    try std.testing.expect(default_vy > 0.0);
    try std.testing.expect(strong_vy > default_vy);
}

// ─── N0.5 · native world init ────────────────────────────────────────────
//
// Acceptance for the row is "the harness can CREATE a world natively and
// self-play bots without packed-state input", so these tests build a world
// through the new exports only — no TS, no packed state — and then step it.

test "world_init_roster: builds a steppable roster with no packed state" {
    var state: root.world_state.WorldState = undefined;
    const spawns = [_]f64{ 100, 200, 300, 200, 500, 200 };
    _ = root.world.world_state_set_spawn_points(&spawns, 3);

    const archetypes = [_]u8{ 0, 1, 2, 3 };
    const n = root.world.world_init_roster(&state, &archetypes, 4, 12345);
    try std.testing.expectEqual(@as(u32, 4), n);
    try std.testing.expectEqual(@as(u32, 4), state.player_count);

    // Chassis bases, straight from the row's own parity note.
    try std.testing.expectEqual(@as(f64, 100), state.players[0].health); // balanced
    try std.testing.expectEqual(@as(f64, 125), state.players[1].health); // heavy
    try std.testing.expectEqual(@as(f64, 85), state.players[2].health); // sprinter
    try std.testing.expectEqual(@as(f64, 100), state.players[3].health); // shielded

    // Placed on the map's spawns, wrapping when the roster outruns them.
    try std.testing.expectEqual(@as(f64, 100), state.players[0].x);
    try std.testing.expectEqual(@as(f64, 300), state.players[1].x);
    try std.testing.expectEqual(@as(f64, 500), state.players[2].x);
    try std.testing.expectEqual(@as(f64, 100), state.players[3].x); // wrapped

    for (0..4) |i| {
        try std.testing.expect(state.players[i].flags.alive);
        // Aim must not be (0,0) — that points the whole roster at the
        // arena's top-left corner on frame one.
        try std.testing.expect(state.players[i].aim_x > state.players[i].x);
    }
}

test "world_init_roster: rng seed is never zero (xorshift fixed point)" {
    var state: root.world_state.WorldState = undefined;
    const archetypes = [_]u8{0};
    _ = root.world.world_init_roster(&state, &archetypes, 1, 0);
    // Vacuity guard on the guard: a zero seed would make every subsequent
    // random draw return zero forever, which reads as "deterministic" and
    // is actually "broken".
    try std.testing.expect(state.header.rng_state != 0);
}

test "world_init_player: an out-of-range archetype clamps instead of UB" {
    var state: root.world_state.WorldState = undefined;
    root.world.world_init_player(&state, 0, 200, 0);
    try std.testing.expectEqual(
        root.world_state.CharacterArchetype.balanced,
        state.players[0].character_id,
    );
    try std.testing.expectEqual(@as(f64, 100), state.players[0].health);
}

test "world_init_roster: the built world actually STEPS (the acceptance bar)" {
    var state: root.world_state.WorldState = undefined;
    const spawns = [_]f64{ 100, 0, 400, 0 };
    _ = root.world.world_state_set_spawn_points(&spawns, 2);
    const archetypes = [_]u8{ 0, 1 };
    _ = root.world.world_init_roster(&state, &archetypes, 2, 777);
    state.header.round_phase = @intFromEnum(root.world_state.RoundPhase.fighting);

    const before_y = state.players[0].y;
    var i: usize = 0;
    while (i < 30) : (i += 1) {
        _ = root.world.step_world(&state, 1000.0 / 60.0);
    }
    // Gravity is the cheapest proof the sim genuinely ran on this state
    // rather than the call being a no-op on an unrecognised world.
    try std.testing.expect(state.players[0].y != before_y);
    try std.testing.expectEqual(@as(u32, 30), state.header.tick);
}

// ─── N-MAP · named maps in the core ──────────────────────────────────────

test "named maps: the codegen ran and every map has geometry" {
    // Vacuity guard for the whole lane: if maps_gen.zig were emitted empty
    // (or the codegen silently skipped a file), every assertion below about
    // a SPECIFIC map would still need to fail before anyone noticed.
    try std.testing.expect(root.world.named_map_count() >= 6);
}

test "named maps: loading vessel-nexus fills statics AND spawns" {
    var state: root.world_state.WorldState = undefined;
    state.static_count = 0;
    const id = "vessel-nexus";
    const n = root.world.world_state_load_named_map(&state, id.ptr, id.len);
    try std.testing.expect(n > 0);
    try std.testing.expectEqual(n, state.static_count);

    // Spawns must land in the SAME table world_init_roster reads, or a
    // native world would build its map and then stack every player at the
    // origin.
    const archetypes = [_]u8{ 0, 0 };
    _ = root.world.world_init_roster(&state, &archetypes, 2, 99);
    try std.testing.expect(state.players[0].x != 0 or state.players[0].y != 0);
    try std.testing.expect(
        state.players[0].x != state.players[1].x or state.players[0].y != state.players[1].y,
    );
}

test "named maps: an unknown id loads NOTHING rather than a default map" {
    var state: root.world_state.WorldState = undefined;
    state.static_count = 7;
    const id = "no-such-map";
    try std.testing.expectEqual(
        @as(u32, 0),
        root.world.world_state_load_named_map(&state, id.ptr, id.len),
    );
    // Untouched — substituting geometry would turn a replay desync into a
    // mystery instead of a clean failure.
    try std.testing.expectEqual(@as(u32, 7), state.static_count);
}

test "named maps: one_way is set for thin platforms and clear for floors" {
    var state: root.world_state.WorldState = undefined;
    const id = "skyseam";
    const n = root.world.world_state_load_named_map(&state, id.ptr, id.len);
    try std.testing.expect(n > 0);

    var thin_one_way: u32 = 0;
    var thick_solid: u32 = 0;
    var i: u32 = 0;
    while (i < n) : (i += 1) {
        if (state.one_way[i] == 1) {
            // The rule is `kind == platform && height <= 24`; whatever the
            // kind was, a one-way static must satisfy the height half.
            try std.testing.expect(state.statics[i].h <= 24);
            thin_one_way += 1;
        } else if (state.statics[i].h > 24) {
            thick_solid += 1;
        }
    }
    // Both halves present, so neither branch is vacuous on this map.
    try std.testing.expect(thin_one_way > 0);
    try std.testing.expect(thick_solid > 0);
}
