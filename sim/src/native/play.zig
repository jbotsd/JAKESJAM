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
const assetpack = @import("pack.zig");

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
    sfx: Sfx = .{},

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

/// gospel N2.5 first slice — canonical SFX, played from the pack.
///
/// Loaded from `assets.jjpk` via `LoadWaveFromMemory`, so the binary never
/// touches the filesystem for audio at runtime and never synthesizes a
/// substitute (standing rule: meme SFX are canonical recordings or they
/// are absent). Absent is a reported state, not a silent fallback.
const Sfx = struct {
    death: ?c.Sound = null,
    ready: bool = false,
    played: u64 = 0,
    /// Diagnostic: ticks in which at least one player was dead.
    dead_ticks: u64 = 0,
    min_alive: u32 = 999,
    /// Edge detection lives in shell.DeathWatch — testable without a
    /// window, which the inline version here was not.
    watch: shell.DeathWatch = .{},

    fn load(self: *Sfx, pack_bytes: []const u8) void {
        const p = assetpack.Pack.open(pack_bytes) catch return;
        // Verify before trusting: a half-copied pack should fail loudly
        // here, not as a burst of noise later.
        p.verifyAll() catch {
            std.debug.print("audio: pack failed hash verification — not loading\n", .{});
            return;
        };
        const e = (p.get("sfx/damnson.wav") catch return) orelse return;
        const wave = c.LoadWaveFromMemory(".wav", e.bytes.ptr, @intCast(e.bytes.len));
        if (!c.IsWaveValid(wave)) return;
        defer c.UnloadWave(wave);
        const snd = c.LoadSoundFromWave(wave);
        if (!c.IsSoundValid(snd)) return;
        self.death = snd;
        self.ready = true;
    }

    /// Fire on alive→dead transitions in this frame's state.
    fn noteDeaths(self: *Sfx, state: *const WorldState) void {
        const alive_now = aliveCount(state);
        if (alive_now < self.min_alive) self.min_alive = alive_now;
        if (alive_now < state.player_count) self.dead_ticks += 1;

        var flags: [shell.MAX_WATCHED]bool = @splat(false);
        const n = @min(state.player_count, shell.MAX_WATCHED);
        var i: u32 = 0;
        while (i < n) : (i += 1) flags[i] = state.players[i].flags.alive;

        const died = self.watch.note(flags[0..n]);
        if (died > 0) {
            if (self.death) |snd| {
                c.PlaySound(snd);
                self.played += died;
            }
        }
    }
};

fn aliveCount(state: *const WorldState) u32 {
    var n: u32 = 0;
    var i: u32 = 0;
    while (i < state.player_count) : (i += 1) {
        if (state.players[i].flags.alive) n += 1;
    }
    return n;
}

/// ONE world-draw, used by both modes.
///
/// Smooth mode used to carry its own cut-down copy (statics and players
/// only). Two draw paths is how a viewer ends up showing different worlds
/// depending on a flag — the destructibles were already missing — so there
/// is now one, and `lerp` is the only difference between the callers.
///
/// `lerp` supplies interpolated player positions when the frame-driven
/// loop has them; null means draw the state as-is.
fn drawWorld(state: *const WorldState, ctx: *RenderCtx, lerp: ?struct { prev: *const Lerpable, curr: *const Lerpable, a: f32 }) void {
    c.ClearBackground(.{ .r = 8, .g = 10, .b = 18, .a = 255 });

    var i: u32 = 0;
    while (i < state.static_count) : (i += 1) {
        const a = state.statics[i];
        const one_way = state.one_way[i] == 1;
        c.DrawRectangle(
            @intFromFloat(ctx.worldToScreenX(a.x)),
            @intFromFloat(ctx.worldToScreenY(a.y)),
            @intFromFloat(@as(f32, @floatCast(a.w)) * ctx.scale),
            @intFromFloat(@max(1, @as(f32, @floatCast(a.h)) * ctx.scale)),
            if (one_way) c.Color{ .r = 40, .g = 52, .b = 78, .a = 255 } else c.Color{ .r = 28, .g = 36, .b = 56, .a = 255 },
        );
    }

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

    var pi: u32 = 0;
    while (pi < state.projectile_count) : (pi += 1) {
        const pr = state.projectiles[pi];
        c.DrawCircle(
            @intFromFloat(ctx.worldToScreenX(pr.x)),
            @intFromFloat(ctx.worldToScreenY(pr.y)),
            @max(1.5, 4 * ctx.scale),
            .{ .r = 255, .g = 230, .b = 140, .a = 255 },
        );
    }

    // Fire patches — a replay that omits them shows players dying to
    // nothing. Real radius, not a fixed dot: the patch's SIZE is why
    // someone walked around it or didn't.
    //
    // Satellites orbit their owner: the entity stores angle +
    // orbit_radius, never a world position, so the position has to be
    // derived. Owner resolution goes through the SAME stepper.findSlot
    // the replay path uses — a second id-matching rule would put a
    // satellite on the wrong player exactly when it matters (a recycled
    // slot, a mid-match joiner). An unowned or unresolvable satellite is
    // skipped rather than drawn at the origin.
    var sa: u32 = 0;
    while (sa < state.satellite_count) : (sa += 1) {
        const st = state.satellites[sa];
        if (st.has_owner == 0 or st.owner_id_len == 0) continue;
        const owner_id = st.owner_id_bytes[0..st.owner_id_len];
        const slot = stepper.findSlot(state, state.player_count, owner_id) orelse continue;
        const ow = state.players[slot];
        const wx = ow.x + @cos(st.angle) * st.orbit_radius;
        const wy = ow.y + @sin(st.angle) * st.orbit_radius;
        c.DrawCircleLines(
            @intFromFloat(ctx.worldToScreenX(wx)),
            @intFromFloat(ctx.worldToScreenY(wy)),
            @max(2, 7 * ctx.scale),
            .{ .r = 180, .g = 255, .b = 220, .a = 220 },
        );
    }

    var fi: u32 = 0;
    while (fi < state.fire_count) : (fi += 1) {
        const f = state.fires[fi];
        c.DrawCircle(
            @intFromFloat(ctx.worldToScreenX(f.x)),
            @intFromFloat(ctx.worldToScreenY(f.y)),
            @max(2, @as(f32, @floatCast(f.radius)) * ctx.scale),
            .{ .r = 255, .g = 140, .b = 60, .a = 110 },
        );
    }

    var q: u32 = 0;
    while (q < state.player_count) : (q += 1) {
        const pl = state.players[q];
        var wx = pl.x;
        var wy = pl.y;
        if (lerp) |l| {
            if (q < l.curr.n) {
                wx = l.prev.x[q] + (l.curr.x[q] - l.prev.x[q]) * l.a;
                wy = l.prev.y[q] + (l.curr.y[q] - l.prev.y[q]) * l.a;
            }
        }
        const sx = ctx.worldToScreenX(wx);
        const sy = ctx.worldToScreenY(wy);
        const r = @max(3, 16 * ctx.scale);
        if (pl.flags.alive) {
            c.DrawCircle(@intFromFloat(sx), @intFromFloat(sy), r, .{ .r = 120, .g = 220, .b = 255, .a = 255 });
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

        if (pl.id_len > 0) {
            var name_buf: [40]u8 = undefined;
            const raw_id = pl.id_bytes[0..@min(pl.id_len, 24)];
            const is_bot = std.mem.startsWith(u8, raw_id, "bot_");
            const shown = if (is_bot) raw_id[4..] else raw_id;
            const label = std.fmt.bufPrintZ(&name_buf, "{s}{s}", .{
                if (is_bot) "BOT " else "",
                shown,
            }) catch continue;
            const tw = c.MeasureText(label, 12);
            c.DrawText(
                label,
                @as(i32, @intFromFloat(sx)) - @divTrunc(tw, 2),
                @as(i32, @intFromFloat(sy - r)) - 16,
                12,
                if (is_bot)
                    c.Color{ .r = 200, .g = 121, .b = 255, .a = 235 }
                else
                    c.Color{ .r = 210, .g = 230, .b = 250, .a = 235 },
            );
            // Health pip. Without it you can see someone die but never see
            // them LOSING, which is the part of a replay worth watching.
            // Width is fixed in SCREEN space so it stays readable at any
            // camera zoom.
            if (pl.flags.alive) {
                const bw: f32 = 34;
                const frac: f32 = @floatCast(@min(1.0, @max(0.0, pl.health / 100.0)));
                const bx = @as(i32, @intFromFloat(sx - bw / 2));
                const by = @as(i32, @intFromFloat(sy - r)) - 4;
                c.DrawRectangle(bx, by, @intFromFloat(bw), 3, .{ .r = 30, .g = 36, .b = 48, .a = 220 });
                c.DrawRectangle(bx, by, @intFromFloat(bw * frac), 3, .{ .r = 120, .g = 230, .b = 150, .a = 240 });
            }
        }
    }
}

fn drawTick(state: *const WorldState, tick: u64, ctx_opaque: ?*anyopaque) void {
    const ctx: *RenderCtx = @ptrCast(@alignCast(ctx_opaque.?));

    // Draw one frame per `speed` ticks. A 3600-tick replay at 1:1 is a
    // full minute of watching; being able to skim it matters more than
    // smoothness for a proof-of-innocence run.
    // Deaths are sampled EVERY TICK, before the --speed gate. Sampling
    // them per drawn frame missed almost everything: at --speed 60 a
    // death-and-respawn inside a 60-tick window is invisible, and the cue
    // counter read 0 over a 30k-tick match that plainly had deaths in it.
    // The counter was measuring the render rate, not the match.
    ctx.sfx.noteDeaths(state);

    if (ctx.speed > 1 and tick % ctx.speed != 0) return;
    ctx.frames_drawn += 1;
    ctx.track(state);

    c.BeginDrawing();
    drawWorld(state, ctx, null);
    var buf: [128]u8 = undefined;
    const label = std.fmt.bufPrintZ(
        &buf,
        "tick {d}  round {d}  alive {d}/{d}  proj {d}  x{d}",
        .{ tick, state.header.round_index, aliveCount(state), state.player_count, state.projectile_count, ctx.speed },
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
    var latency = InputLatency{};
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

        // Poll AFTER stepping so the reading is "time until the next step
        // consumes this", which is the number a player feels.
        const raw = pollRaw(ctx, false);
        const frame_input = shell.mapInput(raw);
        _ = frame_input;
        latency.note((shell.STEP_MS - clock.accumulator) * 1000.0);

        const a = @as(f32, @floatCast(clock.alpha()));
        ctx.frames_drawn += 1;
        ctx.track(state);

        c.BeginDrawing();
        // Same draw path as the proof mode — the ONLY difference is the
        // interpolation source. Smooth mode previously had its own
        // cut-down copy that omitted destructibles and projectiles.
        drawWorld(state, ctx, .{ .prev = &prev, .curr = &curr, .a = a });
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
    std.debug.print("input->sim latency: mean {d:.0} us, worst {d:.0} us over {d} frames (one step = {d:.0} us)\n", .{
        latency.meanUs(),
        latency.worst_us,
        latency.samples,
        shell.STEP_MS * 1000.0,
    });
}

/// Poll raylib into the shell's device-state struct. The ONLY job here is
/// reading devices — every decision about what a key means lives in
/// `shell.mapInput`, which is pure and tested. Screen→world for the mouse
/// happens here too, because that conversion is the shell's job and
/// nobody else's (the aim contract; venue 2.5 cost a night to an e2e that
/// assumed otherwise).
fn pollRaw(ctx: *const RenderCtx, emission_ready: bool) shell.RawInput {
    const mp = c.GetMousePosition();
    return .{
        .key_a = c.IsKeyDown(c.KEY_A),
        .key_d = c.IsKeyDown(c.KEY_D),
        .key_w = c.IsKeyDown(c.KEY_W),
        .key_s = c.IsKeyDown(c.KEY_S),
        .key_space = c.IsKeyDown(c.KEY_SPACE),
        .key_shift = c.IsKeyDown(c.KEY_LEFT_SHIFT) or c.IsKeyDown(c.KEY_RIGHT_SHIFT),
        .key_c = c.IsKeyDown(c.KEY_C),
        .key_e = c.IsKeyDown(c.KEY_E),
        .key_1 = c.IsKeyDown(c.KEY_ONE),
        .key_2 = c.IsKeyDown(c.KEY_TWO),
        .key_3 = c.IsKeyDown(c.KEY_THREE),
        .mouse_left = c.IsMouseButtonDown(c.MOUSE_BUTTON_LEFT),
        .mouse_right = c.IsMouseButtonDown(c.MOUSE_BUTTON_RIGHT),
        .aim_world_x = (@as(f64, @floatCast(mp.x)) - ctx.off_x) / ctx.scale,
        .aim_world_y = (@as(f64, @floatCast(mp.y)) - ctx.off_y) / ctx.scale,
        .emission_ready = emission_ready,
    };
}

/// gospel N2.2 asks for input→sim latency "measured, not asserted".
///
/// The honest measurement for a fixed-tick loop is: at the instant the
/// frame polls, how long until the step that consumes it? That is the
/// accumulator's remaining debt, and it is bounded by one step by
/// construction. Reported as observed microseconds rather than claimed.
const InputLatency = struct {
    samples: u64 = 0,
    total_us: f64 = 0,
    worst_us: f64 = 0,

    fn note(self: *InputLatency, us: f64) void {
        self.samples += 1;
        self.total_us += us;
        if (us > self.worst_us) self.worst_us = us;
    }
    fn meanUs(self: *const InputLatency) f64 {
        return if (self.samples == 0) 0 else self.total_us / @as(f64, @floatFromInt(self.samples));
    }
};

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

    c.InitAudioDevice();
    defer if (c.IsAudioDeviceReady()) c.CloseAudioDevice();

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

    // Load SFX from the pack. Reported either way: a viewer that is
    // silently silent is indistinguishable from one whose audio is
    // broken, and this repo has spent enough time on meters that cannot
    // tell those apart.
    const pack_bytes = std.fs.cwd().readFileAlloc(gpa, "sim/assets.jjpk", 64 * 1024 * 1024) catch null;
    defer if (pack_bytes) |pb| gpa.free(pb);
    if (pack_bytes) |pb| ctx.sfx.load(pb);
    std.debug.print("audio: {s}\n", .{
        if (ctx.sfx.ready)
            "sfx/damnson.wav loaded from assets.jjpk"
        else if (pack_bytes == null)
            "NO PACK — run `bun run pack:assets` (silent, not broken)"
        else
            "pack present but sfx did not load (silent)",
    });
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

    std.debug.print("rendered : {d} ticks, final hash {x:0>8}  ({d} frames drawn, {d} death cues; min alive {d}, {d} ticks with a body down)\n", .{
        rendered.ticks_stepped,
        rendered.final_hash,
        ctx.frames_drawn,
        ctx.sfx.played,
        ctx.sfx.min_alive,
        ctx.sfx.dead_ticks,
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
