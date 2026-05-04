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
