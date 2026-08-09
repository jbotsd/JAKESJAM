//! gospel N2.1 — watch an archived replay play back, natively.
//!
//! The acceptance bar, verbatim: "an N0 replay *rendered* — watch an
//! archived match play back windowed with hashes still matching (L9's
//! proof-of-innocence for the shell)."
//!
//! The proof only means something because there is exactly ONE stepper.
//! `jjplay` does not re-implement the replay loop; it calls
//! `stepper.run` — the same function `jjsim` uses headless — and passes a
//! per-tick hook that draws. If the rendered run's final hash matches the
//! headless run's, the shell provably did not touch the simulation. Two
//! separate loops that happened to agree would prove nothing.
//!
//! Baked-tier procedural draws only: rectangles for statics and
//! destructibles, discs for players and projectiles. No art pipeline, no
//! interpolation yet — this is the frame loop and the camera, and the
//! honest scope of that is "you can watch it and recognise the match".
//!
//!   zig build play -- --replay path/to/x.jjr [--speed 4] [--headless-check]

const std = @import("std");
const sim = @import("sim_root");
const jjr = @import("jjr.zig");
const stepper = @import("stepper.zig");
const shell = @import("shell.zig");

const c = @cImport({
    @cInclude("raylib.h");
});

const WorldState = sim.world_state.WorldState;

const WIN_W = 1280;
const WIN_H = 720;

/// Everything the draw hook needs. Passed as an opaque ctx pointer
/// through the stepper, which knows nothing about raylib.
const RenderCtx = struct {
    /// World units per screen pixel, derived from the arena once.
    scale: f32 = 1,
    off_x: f32 = 0,
    off_y: f32 = 0,
    speed: u32 = 1,
    frames_drawn: u64 = 0,
    closed: bool = false,

    fn worldToScreenX(self: *const RenderCtx, x: f64) f32 {
        return @as(f32, @floatCast(x)) * self.scale + self.off_x;
    }
    fn worldToScreenY(self: *const RenderCtx, y: f64) f32 {
        return @as(f32, @floatCast(y)) * self.scale + self.off_y;
    }
};

fn shouldContinue(ctx_opaque: ?*anyopaque) bool {
    const ctx: *RenderCtx = @ptrCast(@alignCast(ctx_opaque.?));
    if (c.WindowShouldClose()) ctx.closed = true;
    return !ctx.closed;
}

fn drawTick(state: *const WorldState, tick: u64, ctx_opaque: ?*anyopaque) void {
    const ctx: *RenderCtx = @ptrCast(@alignCast(ctx_opaque.?));

    // Draw one frame per `speed` ticks. A 3600-tick replay at 1:1 is a
    // full minute of watching; being able to skim it matters more than
    // smoothness for a proof-of-innocence run.
    if (ctx.speed > 1 and tick % ctx.speed != 0) return;
    ctx.frames_drawn += 1;

    c.BeginDrawing();
    c.ClearBackground(.{ .r = 8, .g = 10, .b = 18, .a = 255 });

    // Statics — the arena itself.
    var i: u32 = 0;
    while (i < state.static_count) : (i += 1) {
        const a = state.statics[i];
        const one_way = state.one_way[i] == 1;
        c.DrawRectangle(
            @intFromFloat(ctx.worldToScreenX(a.x)),
            @intFromFloat(ctx.worldToScreenY(a.y)),
            @intFromFloat(@as(f32, @floatCast(a.w)) * ctx.scale),
            @intFromFloat(@max(1, @as(f32, @floatCast(a.h)) * ctx.scale)),
            // One-ways drawn lighter: the distinction is load-bearing for
            // reading a replay ("why did they fall through that?").
            if (one_way) c.Color{ .r = 40, .g = 52, .b = 78, .a = 255 } else c.Color{ .r = 28, .g = 36, .b = 56, .a = 255 },
        );
    }

    // Destructibles.
    var d: u32 = 0;
    while (d < state.destructible_count) : (d += 1) {
        const e = state.destructibles[d];
        if (e.health <= 0) continue;
        c.DrawRectangle(
            @intFromFloat(ctx.worldToScreenX(e.x - e.width / 2)),
            @intFromFloat(ctx.worldToScreenY(e.y - e.height / 2)),
            @intFromFloat(@as(f32, @floatCast(e.width)) * ctx.scale),
            @intFromFloat(@as(f32, @floatCast(e.height)) * ctx.scale),
            .{ .r = 200, .g = 110, .b = 130, .a = 255 },
        );
    }

    // Projectiles.
    var p: u32 = 0;
    while (p < state.projectile_count) : (p += 1) {
        const pr = state.projectiles[p];
        c.DrawCircle(
            @intFromFloat(ctx.worldToScreenX(pr.x)),
            @intFromFloat(ctx.worldToScreenY(pr.y)),
            @max(1.5, 4 * ctx.scale),
            .{ .r = 255, .g = 230, .b = 140, .a = 255 },
        );
    }

    // Players. Dead ones are drawn hollow rather than omitted — a rig
    // vanishing and a rig dying look identical otherwise, and telling
    // them apart is most of what you watch a replay for.
    var q: u32 = 0;
    while (q < state.player_count) : (q += 1) {
        const pl = state.players[q];
        const sx = ctx.worldToScreenX(pl.x);
        const sy = ctx.worldToScreenY(pl.y);
        const r = @max(3, 16 * ctx.scale);
        if (pl.flags.alive) {
            c.DrawCircle(@intFromFloat(sx), @intFromFloat(sy), r, .{ .r = 120, .g = 220, .b = 255, .a = 255 });
            // Aim stub — the direction the sim thinks they are facing.
            const ax = ctx.worldToScreenX(pl.aim_x);
            const ay = ctx.worldToScreenY(pl.aim_y);
            const dx = ax - sx;
            const dy = ay - sy;
            const len = @sqrt(dx * dx + dy * dy);
            if (len > 0.001) {
                c.DrawLineV(
                    .{ .x = sx, .y = sy },
                    .{ .x = sx + dx / len * (r * 2), .y = sy + dy / len * (r * 2) },
                    .{ .r = 200, .g = 240, .b = 255, .a = 220 },
                );
            }
        } else {
            c.DrawCircleLines(@intFromFloat(sx), @intFromFloat(sy), r, .{ .r = 90, .g = 100, .b = 120, .a = 255 });
        }
    }

    var buf: [128]u8 = undefined;
    const label = std.fmt.bufPrintZ(
        &buf,
        "tick {d}  players {d}  proj {d}  x{d}",
        .{ tick, state.player_count, state.projectile_count, ctx.speed },
    ) catch "tick ?";
    c.DrawText(label, 16, 16, 20, .{ .r = 210, .g = 225, .b = 245, .a = 255 });

    c.EndDrawing();
}

pub fn main() !void {
    var gpa_state = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa_state.deinit();
    const gpa = gpa_state.allocator();

    var replay_path: ?[]const u8 = null;
    var speed: u32 = 1;
    var headless_check = false;

    var args = try std.process.argsWithAllocator(gpa);
    defer args.deinit();
    _ = args.next();
    while (args.next()) |a| {
        if (std.mem.eql(u8, a, "--replay")) {
            if (args.next()) |v| replay_path = try gpa.dupe(u8, v);
        } else if (std.mem.eql(u8, a, "--speed")) {
            if (args.next()) |v| speed = std.fmt.parseInt(u32, v, 10) catch 1;
        } else if (std.mem.eql(u8, a, "--headless-check")) {
            headless_check = true;
        }
    }
    defer if (replay_path) |rp| gpa.free(rp);

    const path = replay_path orelse {
        std.debug.print("usage: jjplay --replay <file.jjr> [--speed N] [--headless-check]\n", .{});
        return error.NoReplay;
    };

    const bytes = try std.fs.cwd().readFileAlloc(gpa, path, 64 * 1024 * 1024);
    defer gpa.free(bytes);
    var replay = try jjr.parse(gpa, bytes);
    defer replay.deinit();

    // Same sidecar convention as jjsim (`<replay>.init.bin`, written by
    // `bun server/tools/dump-replay-init.ts`). Deliberately identical
    // rather than a second scheme: the whole point of this binary is that
    // it feeds the SAME stepper the same inputs.
    const init_path = try std.fmt.allocPrint(gpa, "{s}.init.bin", .{path});
    defer gpa.free(init_path);
    const init_bytes = std.fs.cwd().readFileAlloc(gpa, init_path, 8 * 1024 * 1024) catch |err| {
        std.debug.print(
            "cannot read init state {s}: {s}\n(run: bun server/tools/dump-replay-init.ts {s})\n",
            .{ init_path, @errorName(err), path },
        );
        return err;
    };
    defer gpa.free(init_bytes);

    const state_ptr = sim.alloc_state();
    const state_buf = state_ptr[0..sim.state_size()];

    // ── the run that must be matched ─────────────────────────────────────
    // Headless first, same stepper, no hook. This is the number the
    // rendered run has to reproduce.
    const headless = try stepper.run(gpa, state_buf, init_bytes, &replay, .{ .every = 0 });
    std.debug.print("headless : {d} ticks, final hash {x:0>8}\n", .{ headless.ticks_stepped, headless.final_hash });
    gpa.free(headless.samples);

    if (headless_check) return;

    // ── the same run, rendered ───────────────────────────────────────────
    c.SetTraceLogLevel(c.LOG_WARNING);
    c.InitWindow(WIN_W, WIN_H, "JAKESJAM · native replay");
    defer c.CloseWindow();
    c.SetTargetFPS(60);

    // Fit the arena. Statics are already in the state, so the camera is
    // derived from the world rather than configured.
    const state: *WorldState = @ptrCast(@alignCast(state_buf.ptr));
    @memcpy(state_buf[0..@sizeOf(WorldState)], init_bytes);
    var max_x: f64 = 1280;
    var max_y: f64 = 720;
    var si: u32 = 0;
    while (si < state.static_count) : (si += 1) {
        max_x = @max(max_x, state.statics[si].x + state.statics[si].w);
        max_y = @max(max_y, state.statics[si].y + state.statics[si].h);
    }
    var ctx = RenderCtx{ .speed = @max(1, speed) };
    ctx.scale = @min(
        @as(f32, WIN_W) / @as(f32, @floatCast(max_x)),
        @as(f32, WIN_H) / @as(f32, @floatCast(max_y)),
    );
    ctx.off_x = 0;
    ctx.off_y = 0;

    const rendered = try stepper.run(gpa, state_buf, init_bytes, &replay, .{
        .every = 0,
        .on_tick = drawTick,
        .on_tick_ctx = &ctx,
        .should_continue = shouldContinue,
    });
    defer gpa.free(rendered.samples);

    std.debug.print("rendered : {d} ticks, final hash {x:0>8}  ({d} frames drawn)\n", .{
        rendered.ticks_stepped,
        rendered.final_hash,
        ctx.frames_drawn,
    });

    // ── the verdict ──────────────────────────────────────────────────────
    if (ctx.closed and rendered.ticks_stepped < headless.ticks_stepped) {
        // Closing the window early is not a failure, but it is also NOT a
        // pass — a partial run cannot match a full one, and reporting it
        // as agreement would be the exact sort of flattering meter this
        // project keeps having to dig out.
        std.debug.print("INCONCLUSIVE: window closed at tick {d} of {d}\n", .{
            rendered.ticks_stepped,
            headless.ticks_stepped,
        });
        return;
    }
    if (rendered.final_hash == headless.final_hash) {
        std.debug.print("MATCH: rendering did not touch the simulation (L9)\n", .{});
    } else {
        std.debug.print("DIVERGED: headless {x:0>8} != rendered {x:0>8} — the shell changed the sim\n", .{
            headless.final_hash,
            rendered.final_hash,
        });
        return error.ShellChangedSim;
    }
}
