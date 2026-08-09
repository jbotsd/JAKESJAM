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
    /// Screen pixels per world unit.
    scale: f32 = 1,
    off_x: f32 = 0,
    off_y: f32 = 0,
    speed: u32 = 1,
    frames_drawn: u64 = 0,
    closed: bool = false,

    /// Follow the action instead of fitting the whole arena.
    ///
    /// vessel-nexus is 3000 world units wide; fitted to 1280 px that is
    /// 0.43 px per unit, which renders a player as a 7px dot and makes a
    /// replay unreadable. The camera tracks the centroid of living
    /// players — not a single player, because a replay has no "you".
    follow: bool = true,
    /// Zoom used when following. 1 px per world unit reads well at 1280x720.
    follow_scale: f32 = 1,
    /// Smoothed camera centre in world units. Smoothed because a centroid
    /// jumps hard when someone dies or respawns, and a hard cut mid-fight
    /// looks like a rendering bug rather than a camera.
    cam_x: f64 = 0,
    cam_y: f64 = 0,
    cam_ready: bool = false,
    /// Arena extent, for clamping the camera inside the world.
    world_w: f64 = 1280,
    world_h: f64 = 720,

    /// Re-aim the camera at the living centroid. Called once per DRAWN
    /// frame, not per tick, so smoothing is in frames and stays stable
    /// when --speed skips ticks.
    fn track(self: *RenderCtx, state: *const WorldState) void {
        if (!self.follow) return;
        var sx: f64 = 0;
        var sy: f64 = 0;
        var n: f64 = 0;
        var i: u32 = 0;
        while (i < state.player_count) : (i += 1) {
            if (!state.players[i].flags.alive) continue;
            sx += state.players[i].x;
            sy += state.players[i].y;
            n += 1;
        }
        // Everyone dead (between rounds) — hold the last framing rather
        // than snapping to the origin, which would read as a glitch.
        if (n == 0) return;
        const tx = sx / n;
        const ty = sy / n;
        if (!self.cam_ready) {
            self.cam_x = tx;
            self.cam_y = ty;
            self.cam_ready = true;
        } else {
            const k = 0.12; // ~8 frames to close most of the gap
            self.cam_x += (tx - self.cam_x) * k;
            self.cam_y += (ty - self.cam_y) * k;
        }

        // Clamp so the camera never shows outside the arena; a viewer
        // staring at void cannot tell "empty region" from "broken map".
        const half_w = @as(f64, WIN_W) / 2 / self.follow_scale;
        const half_h = @as(f64, WIN_H) / 2 / self.follow_scale;
        if (self.world_w > half_w * 2) {
            self.cam_x = @min(@max(self.cam_x, half_w), self.world_w - half_w);
        } else {
            self.cam_x = self.world_w / 2;
        }
        if (self.world_h > half_h * 2) {
            self.cam_y = @min(@max(self.cam_y, half_h), self.world_h - half_h);
        } else {
            self.cam_y = self.world_h / 2;
        }

        self.scale = self.follow_scale;
        self.off_x = @as(f32, WIN_W) / 2 - @as(f32, @floatCast(self.cam_x)) * self.scale;
        self.off_y = @as(f32, WIN_H) / 2 - @as(f32, @floatCast(self.cam_y)) * self.scale;
    }

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
    ctx.track(state);

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

/// Snapshot of just what the renderer interpolates. Copying the whole
/// WorldState per tick would be 128 KB of memcpy at 60 Hz for no reason —
/// only positions move between frames.
const Lerpable = struct {
    x: [16]f64 = @splat(0),
    y: [16]f64 = @splat(0),
    alive: [16]bool = @splat(false),
    n: u32 = 0,

    fn capture(state: *const WorldState) Lerpable {
        var l = Lerpable{ .n = @min(state.player_count, 16) };
        var i: u32 = 0;
        while (i < l.n) : (i += 1) {
            l.x[i] = state.players[i].x;
            l.y[i] = state.players[i].y;
            l.alive[i] = state.players[i].flags.alive;
        }
        return l;
    }
};

/// SMOOTH MODE — the frame-driven loop the real shell will use.
///
/// This is the other half of "fixed-tick sim decoupled from render": the
/// FRAME owns the clock (shell.StepClock), pulls however many fixed sim
/// steps the elapsed time owes, and draws once at a lerp between the last
/// two sim states. On a 144 Hz display that is 144 smooth frames over 60
/// sim ticks; the tick-locked path above would show 60.
///
/// It is deliberately NOT the hash-proof path, and says so at runtime.
/// The proof needs exactly one stepper shared with jjsim; this loop steps
/// the sim itself, so a matching hash here would be two implementations
/// agreeing rather than one being observed. Keeping them separate is the
/// point — if a future change makes the proof run through this loop, the
/// proof quietly stops meaning anything.
fn runSmooth(
    gpa: std.mem.Allocator,
    state_buf: []u8,
    init_bytes: []const u8,
    replay: *const jjr.Replay,
    ctx: *RenderCtx,
) !void {
    _ = gpa;
    @memcpy(state_buf[0..@sizeOf(WorldState)], init_bytes);
    const state: *WorldState = @ptrCast(@alignCast(state_buf.ptr));

    var clock = shell.StepClock{};
    var prev = Lerpable.capture(state);
    var curr = prev;
    var tick: u64 = 0;
    var cursor: usize = 0;
    const total = replay.header.total_ticks;

    std.debug.print("smooth mode: frame-driven, interpolated — NOT the hash proof\n", .{});

    while (!c.WindowShouldClose() and tick < total) {
        const owed = clock.stepsFor(@as(f64, @floatCast(c.GetFrameTime())) * 1000.0 * @as(f64, @floatFromInt(ctx.speed)));
        var s: u32 = 0;
        while (s < owed and tick < total) : (s += 1) {
            tick += 1;
            var q: usize = 0;
            while (q < state.player_count) : (q += 1) {
                state.players[q].current_keys = 0;
            }
            // Same slot matching the passport uses — shared helper, not a
            // second guess at which player an input belongs to.
            while (cursor < replay.inputs.len and replay.inputs[cursor].at_tick < tick) cursor += 1;
            while (cursor < replay.inputs.len and replay.inputs[cursor].at_tick == tick) {
                const in = replay.inputs[cursor];
                if (stepper.findSlot(state, state.player_count, in.player_id)) |slot| {
                    const pl = &state.players[slot];
                    pl.aim_x = in.aim_x;
                    pl.aim_y = in.aim_y;
                    pl.current_keys = @truncate(in.keys);
                }
                cursor += 1;
            }
            prev = curr;
            _ = sim.world.step_world(state, shell.STEP_MS);
            curr = Lerpable.capture(state);
        }

        const a = @as(f32, @floatCast(clock.alpha()));
        ctx.frames_drawn += 1;
        ctx.track(state);

        c.BeginDrawing();
        c.ClearBackground(.{ .r = 8, .g = 10, .b = 18, .a = 255 });
        var i: u32 = 0;
        while (i < state.static_count) : (i += 1) {
            const st = state.statics[i];
            c.DrawRectangle(
                @intFromFloat(ctx.worldToScreenX(st.x)),
                @intFromFloat(ctx.worldToScreenY(st.y)),
                @intFromFloat(@as(f32, @floatCast(st.w)) * ctx.scale),
                @intFromFloat(@max(1, @as(f32, @floatCast(st.h)) * ctx.scale)),
                .{ .r = 28, .g = 36, .b = 56, .a = 255 },
            );
        }
        var q: u32 = 0;
        while (q < curr.n) : (q += 1) {
            if (!curr.alive[q]) continue;
            // The interpolation itself: draw BETWEEN the last two sim
            // states rather than at the newest one.
            const lx = prev.x[q] + (curr.x[q] - prev.x[q]) * a;
            const ly = prev.y[q] + (curr.y[q] - prev.y[q]) * a;
            c.DrawCircle(
                @intFromFloat(ctx.worldToScreenX(lx)),
                @intFromFloat(ctx.worldToScreenY(ly)),
                @max(3, 16 * ctx.scale),
                .{ .r = 120, .g = 220, .b = 255, .a = 255 },
            );
        }
        var buf: [128]u8 = undefined;
        const label = std.fmt.bufPrintZ(&buf, "tick {d}  alpha {d:.2}  SMOOTH (not the proof)", .{ tick, a }) catch "?";
        c.DrawText(label, 16, 16, 20, .{ .r = 210, .g = 225, .b = 245, .a = 255 });
        c.EndDrawing();
    }

    std.debug.print("smooth: {d} ticks, {d} frames drawn, {d} steps dropped to the spiral cap\n", .{
        tick,
        ctx.frames_drawn,
        clock.dropped_steps,
    });
}

pub fn main() !void {
    var gpa_state = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa_state.deinit();
    const gpa = gpa_state.allocator();

    var replay_path: ?[]const u8 = null;
    var speed: u32 = 1;
    var headless_check = false;
    var fit_arena = false;
    var smooth = false;

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
        } else if (std.mem.eql(u8, a, "--fit")) {
            fit_arena = true;
        } else if (std.mem.eql(u8, a, "--smooth")) {
            smooth = true;
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
    var ctx = RenderCtx{ .speed = @max(1, speed), .follow = !fit_arena };
    ctx.world_w = max_x;
    ctx.world_h = max_y;
    // --fit keeps the old whole-arena framing; useful for checking map
    // geometry, useless for watching a fight.
    ctx.scale = @min(
        @as(f32, WIN_W) / @as(f32, @floatCast(max_x)),
        @as(f32, WIN_H) / @as(f32, @floatCast(max_y)),
    );
    ctx.off_x = 0;
    ctx.off_y = 0;

    if (smooth) {
        try runSmooth(gpa, state_buf, init_bytes, &replay, &ctx);
        return;
    }

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
