//! `jjsim` — the native sim CLI. gospel-goal N0.1.
//!
//! The port passport: the same Zig core that runs as wasm, compiled
//! native, reading archived `.jjr` replays. Today it parses and reports
//! (N0.2); the hash stream and the wasm cross-check land on top of it
//! (N0.3/N0.4), and world_init (N0.5) is what lets it re-sim rather than
//! only read.
//!
//! Everything a machine consumes goes to stdout; diagnostics go to stderr.

const std = @import("std");
const jjr = @import("jjr.zig");
const stepper = @import("stepper.zig");
const sim = @import("sim_root");

const USAGE =
    \\jjsim — JAKESJAM native sim harness
    \\
    \\  jjsim version
    \\      Build + core identity.
    \\
    \\  jjsim replay-info <file.jjr>...
    \\      Parse each replay and print a one-line summary.
    \\
    \\  jjsim replay-verify <dir>
    \\      Parse every .jjr in <dir>. Exit non-zero if any fails.
    \\
    \\  jjsim replay-hash <file.jjr> [--init <file>] [--every N] [--max-ticks N]
    \\      Step the replay headless from its packed initial state and print
    \\      a hash of the state buffer every N ticks (default 60). --init
    \\      defaults to <file.jjr>.init.bin (server/tools/dump-replay-init.ts).
    \\      These hashes are the port passport: the same inputs through wasm
    \\      must produce the same stream, bit for bit.
    \\
;

pub fn main() !u8 {
    var gpa_state = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa_state.deinit();
    const gpa = gpa_state.allocator();

    const args = try std.process.argsAlloc(gpa);
    defer std.process.argsFree(gpa, args);

    if (args.len < 2) {
        try stderr(USAGE);
        return 2;
    }

    const cmd = args[1];
    if (std.mem.eql(u8, cmd, "version")) {
        try stdoutPrint("jjsim native — state_size={d} bytes\n", .{sim.state_size()});
        return 0;
    } else if (std.mem.eql(u8, cmd, "replay-info")) {
        if (args.len < 3) {
            try stderr("replay-info needs at least one file\n");
            return 2;
        }
        var failed: u8 = 0;
        for (args[2..]) |path| {
            if (!try reportOne(gpa, path)) failed = 1;
        }
        return failed;
    } else if (std.mem.eql(u8, cmd, "replay-verify")) {
        if (args.len < 3) {
            try stderr("replay-verify needs a directory\n");
            return 2;
        }
        return verifyDir(gpa, args[2]);
    } else if (std.mem.eql(u8, cmd, "replay-hash")) {
        if (args.len < 3) {
            try stderr("replay-hash needs a .jjr file\n");
            return 2;
        }
        return replayHash(gpa, args[2..]);
    }

    try stderr(USAGE);
    return 2;
}

/// `replay-hash <file.jjr> [--init f] [--every n] [--max-ticks n]`
fn replayHash(gpa: std.mem.Allocator, args: [][:0]u8) !u8 {
    const path = args[0];
    var init_path: ?[]const u8 = null;
    var opts: stepper.Options = .{};

    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        const a = args[i];
        if (std.mem.eql(u8, a, "--init") and i + 1 < args.len) {
            i += 1;
            init_path = args[i];
        } else if (std.mem.eql(u8, a, "--every") and i + 1 < args.len) {
            i += 1;
            opts.every = std.fmt.parseInt(u64, args[i], 10) catch 60;
            if (opts.every == 0) opts.every = 60;
        } else if (std.mem.eql(u8, a, "--max-ticks") and i + 1 < args.len) {
            i += 1;
            opts.max_ticks = std.fmt.parseInt(u64, args[i], 10) catch 0;
        } else {
            try stderrPrint("unknown argument: {s}\n", .{a});
            return 2;
        }
    }

    const resolved_init = if (init_path) |p|
        try gpa.dupe(u8, p)
    else
        try std.fmt.allocPrint(gpa, "{s}.init.bin", .{path});
    defer gpa.free(resolved_init);

    const replay_bytes = std.fs.cwd().readFileAlloc(gpa, path, 512 * 1024 * 1024) catch |err| {
        try stderrPrint("cannot read {s}: {s}\n", .{ path, @errorName(err) });
        return 1;
    };
    defer gpa.free(replay_bytes);

    var replay = jjr.parse(gpa, replay_bytes) catch |err| {
        try stderrPrint("cannot parse {s}: {s}\n", .{ path, @errorName(err) });
        return 1;
    };
    defer replay.deinit();

    // A replay recorded across a mid-match backend switch cannot be held to
    // bit-identity by either backend alone — refuse rather than emit hashes
    // that would read as a divergence.
    if (!replay.isSingleBackend()) {
        try stderrPrint(
            "{s}: {d} backend-fallback tick(s) — not a passport fixture\n",
            .{ path, replay.header.backend_fallback_ticks },
        );
        return 1;
    }

    const init_bytes = std.fs.cwd().readFileAlloc(gpa, resolved_init, 8 * 1024 * 1024) catch |err| {
        try stderrPrint(
            "cannot read init state {s}: {s}\n(run: bun server/tools/dump-replay-init.ts {s})\n",
            .{ resolved_init, @errorName(err), path },
        );
        return 1;
    };
    defer gpa.free(init_bytes);

    const state_ptr = sim.alloc_state();
    const state_buf = state_ptr[0..sim.state_size()];

    const result = stepper.run(gpa, state_buf, init_bytes, &replay, opts) catch |err| {
        try stderrPrint("step failed: {s}\n", .{@errorName(err)});
        return 1;
    };
    defer gpa.free(result.samples);

    try stdoutPrint(
        "# {s}\tmap={s}\tseed={d}\tticks={d}\tinputs_applied={d}\n",
        .{ path, replay.header.map_id, replay.header.rng_seed, result.ticks_stepped, result.inputs_applied },
    );
    for (result.samples) |s| {
        try stdoutPrint("{d}\t{x:0>8}\n", .{ s.tick, s.hash });
    }
    try stdoutPrint("final\t{x:0>8}\n", .{result.final_hash});
    return 0;
}

fn verifyDir(gpa: std.mem.Allocator, dir_path: []const u8) !u8 {
    var dir = std.fs.cwd().openDir(dir_path, .{ .iterate = true }) catch |err| {
        try stderrPrint("cannot open {s}: {s}\n", .{ dir_path, @errorName(err) });
        return 2;
    };
    defer dir.close();

    var total: usize = 0;
    var bad: usize = 0;
    var it = dir.iterate();
    while (try it.next()) |entry| {
        if (entry.kind != .file) continue;
        if (!std.mem.endsWith(u8, entry.name, ".jjr")) continue;
        total += 1;
        const full = try std.fs.path.join(gpa, &.{ dir_path, entry.name });
        defer gpa.free(full);
        if (!try reportOne(gpa, full)) bad += 1;
    }
    try stdoutPrint("verified {d} replay(s), {d} failed\n", .{ total, bad });
    return if (bad == 0) 0 else 1;
}

/// Returns true when the file parsed cleanly.
fn reportOne(gpa: std.mem.Allocator, path: []const u8) !bool {
    const bytes = std.fs.cwd().readFileAlloc(gpa, path, 512 * 1024 * 1024) catch |err| {
        try stdoutPrint("{s}\tREAD-ERROR\t{s}\n", .{ path, @errorName(err) });
        return false;
    };
    defer gpa.free(bytes);

    var replay = jjr.parse(gpa, bytes) catch |err| {
        try stdoutPrint("{s}\tPARSE-ERROR\t{s}\n", .{ path, @errorName(err) });
        return false;
    };
    defer replay.deinit();

    const h = replay.header;
    try stdoutPrint(
        "{s}\tOK\tmap={s}\tseed={d}\tticks={d}\tplayers={d}\tinputs={d}\troster={d}\tbackend={s}\tfallback={d}\n",
        .{
            path,
            h.map_id,
            h.rng_seed,
            h.total_ticks,
            h.players.len,
            replay.inputs.len,
            replay.roster_events.len,
            @tagName(h.sim_backend),
            h.backend_fallback_ticks,
        },
    );
    // A replay recorded across a mid-match backend switch cannot be held to
    // bit-identity by either backend alone — flag it now so N0.4 excludes
    // it deliberately rather than reporting a divergence that isn't one.
    if (!replay.isSingleBackend()) {
        try stderrPrint(
            "warn: {s} recorded {d} backend-fallback tick(s) — not usable as a passport fixture\n",
            .{ path, h.backend_fallback_ticks },
        );
    }
    return true;
}

fn stdoutPrint(comptime fmt: []const u8, args: anytype) !void {
    var buf: [4096]u8 = undefined;
    const s = try std.fmt.bufPrint(&buf, fmt, args);
    _ = try std.fs.File.stdout().write(s);
}

fn stderr(s: []const u8) !void {
    _ = try std.fs.File.stderr().write(s);
}

fn stderrPrint(comptime fmt: []const u8, args: anytype) !void {
    var buf: [4096]u8 = undefined;
    const s = try std.fmt.bufPrint(&buf, fmt, args);
    _ = try std.fs.File.stderr().write(s);
}
