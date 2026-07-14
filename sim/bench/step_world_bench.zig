//! Native (non-wasm) benchmark for step_world. 2026-07-14 — added because
//! the existing tools/wasm-bench.ts numbers (docs/zig-wasm-perf-baseline.md)
//! only ever measured trig/RNG/collision/stepPlayer kernels through the
//! JS<->wasm boundary, conflating "is Zig fast" with "is the wasm call
//! overhead fast." This runs step_world directly, natively, at
//! -Doptimize=ReleaseFast, with zero JS/wasm involvement — the honest
//! upper-bound number for what the orchestrator itself costs.
//!
//! Run: `zig build bench` from sim/ (see build.zig's "bench" step).

const std = @import("std");
const sim = @import("sim_root");

const PLAYER_COUNT = 8; // full-lobby FFA, matches the game's max realistic load
const WARMUP_TICKS = 200;
const BENCH_TICKS = 20_000;
const DT_MS: f64 = 1000.0 / 60.0;

fn makeBenchState() sim.world_state.WorldState {
    var state = std.mem.zeroes(sim.world_state.WorldState);
    state.header.round_phase = 1; // RoundPhase.fighting
    state.header.countdown_remaining_ms = 90_000.0;
    state.header.target_score = 0; // never ends the match mid-bench
    state.header.match_winner_idx = -1;
    state.header.rng_state = 0xC0FFEE;
    state.player_count = PLAYER_COUNT;

    var i: u32 = 0;
    while (i < PLAYER_COUNT) : (i += 1) {
        var p = &state.players[i];
        // Spread players around a rough circle so movement + combat +
        // projectile-vs-player checks all have real work to do, not just
        // early-exit on "too far to matter" paths.
        const angle = @as(f64, @floatFromInt(i)) *
            (2.0 * std.math.pi / @as(f64, PLAYER_COUNT));
        p.x = 800.0 + @cos(angle) * 500.0;
        p.y = 450.0 + @sin(angle) * 300.0;
        p.aim_x = 800.0;
        p.aim_y = 450.0;
        p.health = 100.0;
        p.flags.alive = true;
        // Alternate held-fire so weapon fire + projectile spawn/motion/
        // impact all run every tick, not just movement.
        p.current_keys = if (i % 2 == 0) (1 << 6) else 0; // InputBitFire
        p.prev_keys = 0;
        const id_str = std.fmt.bufPrint(p.id_bytes[0..], "bench_p{d}", .{i}) catch unreachable;
        p.id_len = @intCast(id_str.len);
    }
    return state;
}

pub fn main() !void {
    var stdout_buf: [4096]u8 = undefined;
    var stdout_writer = std.fs.File.stdout().writer(&stdout_buf);
    const out = &stdout_writer.interface;

    var state = makeBenchState();

    // Warmup — let any first-call lazy init (if ever added) settle, and
    // give the branch predictor/cache a representative working set before
    // the timed region starts.
    var w: u32 = 0;
    while (w < WARMUP_TICKS) : (w += 1) {
        _ = sim.world.stepWorld(&state, DT_MS);
    }

    var timer = try std.time.Timer.start();
    var t: u32 = 0;
    while (t < BENCH_TICKS) : (t += 1) {
        _ = sim.world.stepWorld(&state, DT_MS);
    }
    const elapsed_ns = timer.read();

    const ns_per_tick = @as(f64, @floatFromInt(elapsed_ns)) / @as(f64, BENCH_TICKS);
    const ticks_per_sec = 1_000_000_000.0 / ns_per_tick;
    const realtime_multiple = ticks_per_sec / 60.0; // 60Hz is the game's real tick rate

    try out.print(
        "step_world native bench — {d} players, {d} ticks (after {d} warmup)\n",
        .{ PLAYER_COUNT, BENCH_TICKS, WARMUP_TICKS },
    );
    try out.print("  total: {d:.2}ms\n", .{@as(f64, @floatFromInt(elapsed_ns)) / 1_000_000.0});
    try out.print("  ns/tick: {d:.1}\n", .{ns_per_tick});
    try out.print("  ticks/sec (single-threaded): {d:.0}\n", .{ticks_per_sec});
    try out.print("  = {d:.1}x realtime headroom at 60Hz authoritative tick rate\n", .{realtime_multiple});
    // Sink so the compiler can't prove the loop's output is unobserved and
    // dead-code-eliminate the whole thing.
    try out.print("  (sink, ignore: player[0] final health={d:.2})\n", .{state.players[0].health});
    try out.flush();
}
