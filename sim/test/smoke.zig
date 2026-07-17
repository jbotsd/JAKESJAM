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
