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
    }

    try stderr(USAGE);
    return 2;
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
