//! gospel N1.1 — the raylib confirmation spike.
//!
//! ADR-0008 picked raylib over SDL3 on the argument that it covers
//! 2D + text + audio-decode in one dependency, and that L9 plus the N0
//! hash passport make the shell provably swap-able if that turns out
//! wrong. A decision made on reading is not a decision made on evidence,
//! so this is the evidence: the smallest program that exercises every
//! capability the real shell will depend on, on THIS box.
//!
//! The bar, straight from the row:
//!   - open a window
//!   - 500 moving additive-blended shapes at 60 Hz, frame p99 printed
//!   - HUD text from a TTF
//!   - one canonical meme SFX decoded from file
//!   - mouse + one gamepad
//!
//! Built via `@cImport` on `raylib.h` — no third-party bindings, per the
//! row. raylib is vendored and built INSIDE the repo (sim/vendor/, git-
//! ignored) rather than installed system-wide: this box is a daily driver
//! whose nvidia stack moves on every -Syu, and a spike is not a reason to
//! touch it (L2, L13).
//!
//! Run headless-safe: pass `--frames N` to exit after N frames so it can
//! run unattended, and `--no-audio` where no device exists. Everything it
//! measures goes to stdout as plain text — a spike whose result you have
//! to watch is a spike you cannot put in a log.

const std = @import("std");

const c = @cImport({
    @cInclude("raylib.h");
});

const SHAPES = 500;

const Shape = struct {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    r: f32,
    color: c.Color,
};

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const alloc = gpa.allocator();

    var frames_limit: u32 = 600; // ~10s at 60Hz
    var want_audio = true;
    // `--uncapped` removes SetTargetFPS. It matters: WITH the cap, raylib
    // sleeps to hit 60 Hz, so frame p99 comes back as exactly 16.67 ms and
    // reports the CAP rather than the capability. That is a meter telling
    // you what you asked for instead of what is true — the run that
    // establishes headroom is the uncapped one.
    var uncapped = false;
    var args = try std.process.argsWithAllocator(alloc);
    defer args.deinit();
    _ = args.next();
    while (args.next()) |a| {
        if (std.mem.eql(u8, a, "--frames")) {
            if (args.next()) |v| frames_limit = std.fmt.parseInt(u32, v, 10) catch frames_limit;
        } else if (std.mem.eql(u8, a, "--no-audio")) {
            want_audio = false;
        } else if (std.mem.eql(u8, a, "--uncapped")) {
            uncapped = true;
        }
    }

    // ── capability 1: open a window ──────────────────────────────────────
    c.SetTraceLogLevel(c.LOG_WARNING);
    c.InitWindow(1280, 720, "JAKESJAM · N1.1 raylib spike");
    if (!c.IsWindowReady()) {
        std.debug.print("SPIKE FAIL: window did not open\n", .{});
        return error.WindowFailed;
    }
    defer c.CloseWindow();
    if (!uncapped) c.SetTargetFPS(60);
    std.debug.print("window: OK  ({d}x{d})\n", .{ c.GetScreenWidth(), c.GetScreenHeight() });
    std.debug.print("gl: {s}\n", .{"OpenGL 3.3 (raylib PLATFORM_DESKTOP default)"});

    // ── capability 4: decode a canonical SFX from file ───────────────────
    // NEVER synthesized — standing rule. If no asset is present the spike
    // reports that as unproven rather than inventing a tone and calling
    // the capability confirmed.
    var audio_result: []const u8 = "SKIPPED (--no-audio)";
    var sound: c.Sound = undefined;
    var have_sound = false;
    if (want_audio) {
        c.InitAudioDevice();
        if (!c.IsAudioDeviceReady()) {
            audio_result = "UNPROVEN: no audio device on this box";
        } else {
            // The real canonical meme SFX in this repo. Never synthesized
            // (standing rule) — if this file is missing the spike says
            // UNPROVEN rather than generating a tone and claiming audio.
            const candidates = [_][*:0]const u8{
                "assets/sfx-memes/bruh.wav",
                "assets/sfx-memes/trombone.wav",
            };
            for (candidates) |path| {
                if (c.FileExists(path)) {
                    sound = c.LoadSound(path);
                    if (c.IsSoundValid(sound)) {
                        have_sound = true;
                        audio_result = "OK: decoded a canonical SFX from file";
                        break;
                    }
                }
            }
            if (!have_sound) audio_result = "UNPROVEN: no canonical SFX file found to decode";
        }
    }
    defer if (have_sound) c.UnloadSound(sound);
    defer if (want_audio and c.IsAudioDeviceReady()) c.CloseAudioDevice();

    // ── capability 3: HUD text from a TTF ────────────────────────────────
    var font = c.GetFontDefault();
    var font_result: []const u8 = "FALLBACK: raylib default bitmap font (no TTF found)";
    // The repo's own webfonts are .woff2, which raylib cannot load — a
    // real finding for the shell: the native build will need TTF/OTF
    // copies of the brand faces, or a woff2 decoder. System TTF here so
    // the CAPABILITY is proven while that asset gap stays visible.
    const font_candidates = [_][*:0]const u8{
        "/usr/share/fonts/Adwaita/AdwaitaMono-Regular.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/usr/share/fonts/noto/NotoSans-Regular.ttf",
    };
    for (font_candidates) |path| {
        if (c.FileExists(path)) {
            const f = c.LoadFontEx(path, 24, null, 0);
            if (c.IsFontValid(f)) {
                font = f;
                font_result = "OK: HUD text rendered from a TTF";
                break;
            }
        }
    }

    // ── capability 2: 500 additive-blended moving shapes ─────────────────
    var rng = std.Random.DefaultPrng.init(0x1A2B3C4D);
    const rand = rng.random();
    var shapes: [SHAPES]Shape = undefined;
    for (&shapes) |*s| {
        s.* = .{
            .x = rand.float(f32) * 1280,
            .y = rand.float(f32) * 720,
            .vx = (rand.float(f32) - 0.5) * 240,
            .vy = (rand.float(f32) - 0.5) * 240,
            .r = 6 + rand.float(f32) * 18,
            .color = .{
                .r = @intFromFloat(60 + rand.float(f32) * 195),
                .g = @intFromFloat(60 + rand.float(f32) * 195),
                .b = 255,
                .a = 90,
            },
        };
    }

    var frame_ms = try alloc.alloc(f64, frames_limit);
    defer alloc.free(frame_ms);

    var gamepad_seen = false;
    var mouse_seen = false;
    var frame: u32 = 0;
    while (frame < frames_limit and !c.WindowShouldClose()) : (frame += 1) {
        const dt = c.GetFrameTime();

        for (&shapes) |*s| {
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            if (s.x < 0 or s.x > 1280) s.vx = -s.vx;
            if (s.y < 0 or s.y > 720) s.vy = -s.vy;
        }

        // ── capability 5: mouse + gamepad ────────────────────────────────
        // An unattended run has nobody moving a mouse, so "did the cursor
        // move" can never pass and would sit at UNPROVEN forever. Drive it
        // instead: set a position, read it back, and require the round
        // trip. That proves the input subsystem is wired, which is what a
        // spike needs to know; it does NOT claim a human moved anything.
        if (frame == 10) {
            c.SetMousePosition(321, 123);
        } else if (frame == 12) {
            const mp = c.GetMousePosition();
            mouse_seen = @abs(mp.x - 321) < 2 and @abs(mp.y - 123) < 2;
        }
        if (c.IsGamepadAvailable(0)) gamepad_seen = true;

        c.BeginDrawing();
        c.ClearBackground(c.Color{ .r = 8, .g = 10, .b = 18, .a = 255 });
        c.BeginBlendMode(c.BLEND_ADDITIVE);
        for (shapes) |s| c.DrawCircleV(.{ .x = s.x, .y = s.y }, s.r, s.color);
        c.EndBlendMode();
        c.DrawTextEx(
            font,
            "JAKESJAM · additive load · HUD from TTF",
            .{ .x = 24, .y = 24 },
            24,
            1,
            c.Color{ .r = 220, .g = 230, .b = 255, .a = 255 },
        );
        c.EndDrawing();

        frame_ms[frame] = @as(f64, @floatCast(dt)) * 1000.0;
    }

    // ── the measurement ──────────────────────────────────────────────────
    // Frame 0 carries window-creation cost and is excluded; including it
    // would put a one-off ~100ms into a p99 over 600 samples and make a
    // healthy run look like a failure.
    const samples = frame_ms[1..frame];
    std.mem.sort(f64, samples, {}, std.sort.asc(f64));
    const p50 = samples[samples.len / 2];
    const p99 = samples[(samples.len * 99) / 100];
    const worst = samples[samples.len - 1];

    std.debug.print(
        \\
        \\── N1.1 raylib spike ────────────────────────────────
        \\shapes      : {d} additive-blended, moving
        \\frames      : {d} measured
        \\frame p50   : {d:.2} ms
        \\frame p99   : {d:.2} ms   (60 Hz budget = 16.67 ms)
        \\frame worst : {d:.2} ms
        \\mode        : {s}
        \\text        : {s}
        \\audio       : {s}
        \\mouse       : {s}
        \\gamepad     : {s}
        \\
    , .{
        SHAPES,
        samples.len,
        p50,
        p99,
        worst,
        if (uncapped) "UNCAPPED (measures capability)" else "SetTargetFPS(60) (measures the cap)",
        font_result,
        audio_result,
        if (mouse_seen) "OK: set/get position round-trips (no human involved)" else "FAIL: mouse position did not round-trip",
        if (gamepad_seen) "OK: gamepad 0 present" else "UNPROVEN: no gamepad connected",
    });

    const held = p99 <= 16.67;
    if (uncapped) {
        std.debug.print("VERDICT: 500 additive shapes render at p99 {d:.2} ms — {s} 60 Hz headroom\n", .{
            p99,
            if (held) "HAS" else "LACKS",
        });
    } else {
        // Deliberately does NOT say "held": a capped run cannot show
        // headroom, only that nothing stalled below the cap.
        std.debug.print("VERDICT: kept pace with the 60 Hz cap (run --uncapped for headroom)\n", .{});
    }
}
