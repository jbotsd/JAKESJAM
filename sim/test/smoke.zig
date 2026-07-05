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
