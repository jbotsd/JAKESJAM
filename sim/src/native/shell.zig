//! gospel N1.2 — the native shell skeleton.
//!
//! Promoted from the N1.1 spike, which met every item on its bar
//! (`docs/n1-spike-result.md`). ADR-0008 is CONFIRMED: raylib, with SDL3
//! as the named fallback behind its existing switch triggers.
//!
//! WHAT A SHELL IS ALLOWED TO BE (L9, and the reason this file is thin):
//! the shell owns pixels, sound, and the OS. It owns NO behaviour. Every
//! question of "what happens" belongs to the core — that is what makes
//! the port passport meaningful, because a native run and a wasm run
//! step the SAME code and can therefore be compared hash-for-hash. A
//! shell that starts deciding things is a second implementation wearing
//! a renderer's clothes, and the passport stops being evidence.
//!
//! Concretely, this file may:
//!   - open a window, pump events, present frames
//!   - translate OS input into the sim's input bitfield + a WORLD-SPACE
//!     aim point (see `aim_dialect.zig` — the shell does the screen→world
//!     conversion, the dialect does the rest)
//!   - call `step_world` on a fixed timestep
//!   - draw whatever the resulting state says
//!   - decode and play audio assets
//!
//! It may NOT: resolve hits, decide rounds, spawn entities, or hold any
//! state the sim does not already hold. If something here needs a memory
//! that survives a tick, that is a signal the thing belongs in the core.

const std = @import("std");

/// Fixed timestep, matching the browser client and the server
/// (`STEP_MS` in `@sim/index.ts`). Not a tuning knob: the sim is
/// deterministic at this step and only at this step, so a shell that
/// picked its own would diverge from every recorded replay.
pub const STEP_MS: f64 = 1000.0 / 60.0;

/// What the shell hands the core each tick.
///
/// Deliberately the same shape the wire already carries (`keys` bitfield
/// + world-space aim) rather than something shell-flavoured: the native
/// client will eventually send exactly this to the same server the
/// browser talks to, and a second input vocabulary would be a translation
/// layer that can drift.
pub const FrameInput = struct {
    keys: u32 = 0,
    aim_x: f64 = 0,
    aim_y: f64 = 0,
    dt_ms: f64 = STEP_MS,
};

/// Accumulator for the fixed-timestep loop.
///
/// Split out and testable on purpose: "how many sim steps does this
/// wall-clock delta owe?" is the one piece of the frame loop that is pure
/// arithmetic, and it is also the piece that quietly ruins determinism
/// when it is wrong. A spiral-of-death guard belongs here, not in the
/// render code.
pub const StepClock = struct {
    /// Unconsumed wall-clock time, in ms.
    accumulator: f64 = 0,
    /// Hard ceiling on steps produced from one frame. Without it, a
    /// stalled frame (alt-tab, GC pause, a laptop lid) hands the loop a
    /// huge delta, which produces hundreds of steps, which takes longer
    /// than a frame, which grows the next delta — the classic spiral. Ten
    /// is ~166 ms of catch-up; beyond that, dropping time is the correct
    /// and honest behaviour.
    max_steps_per_frame: u32 = 10,
    /// Steps discarded to the ceiling. Surfaced rather than swallowed:
    /// silently dropping sim time is exactly the kind of thing that shows
    /// up later as "the native build feels different".
    dropped_steps: u64 = 0,

    /// Feed a wall-clock delta; returns how many fixed steps to run now.
    pub fn stepsFor(self: *StepClock, delta_ms: f64) u32 {
        // Negative or NaN deltas are a clock going backwards (suspend,
        // NTP step). Treat as zero rather than propagating garbage.
        if (!(delta_ms > 0)) return 0;
        self.accumulator += delta_ms;
        var steps: u32 = 0;
        while (self.accumulator >= STEP_MS) : (self.accumulator -= STEP_MS) {
            steps += 1;
            if (steps >= self.max_steps_per_frame) {
                const owed = @floor(self.accumulator / STEP_MS);
                if (owed > 0) {
                    self.dropped_steps += @intFromFloat(owed);
                    self.accumulator -= owed * STEP_MS;
                }
                break;
            }
        }
        return steps;
    }

    /// Fraction of a step already accumulated — for render interpolation
    /// so a 144 Hz display does not show 60 Hz stutter.
    pub fn alpha(self: *const StepClock) f64 {
        return self.accumulator / STEP_MS;
    }
};

test "StepClock: a 16.67ms frame owes exactly one step" {
    var c = StepClock{};
    try std.testing.expectEqual(@as(u32, 1), c.stepsFor(STEP_MS));
    try std.testing.expectEqual(@as(u64, 0), c.dropped_steps);
}

test "StepClock: sub-step deltas accumulate instead of vanishing" {
    var c = StepClock{};
    // Three 6ms frames = 18ms = one step owed, 1.33ms carried.
    try std.testing.expectEqual(@as(u32, 0), c.stepsFor(6));
    try std.testing.expectEqual(@as(u32, 0), c.stepsFor(6));
    try std.testing.expectEqual(@as(u32, 1), c.stepsFor(6));
    try std.testing.expect(c.alpha() > 0 and c.alpha() < 1);
}

test "StepClock: a long stall is capped and the loss is COUNTED" {
    var c = StepClock{};
    // Two seconds of stall would be 120 steps; the ceiling is 10.
    const steps = c.stepsFor(2000);
    try std.testing.expectEqual(@as(u32, 10), steps);
    // The point of the test: the other ~110 steps are not silently gone.
    try std.testing.expect(c.dropped_steps > 100);
    // And the accumulator is not left holding a second of debt, or the
    // next frame would spiral again.
    try std.testing.expect(c.accumulator < STEP_MS);
}

test "StepClock: a backwards clock produces no steps and no drops" {
    var c = StepClock{};
    try std.testing.expectEqual(@as(u32, 0), c.stepsFor(-500));
    try std.testing.expectEqual(@as(u32, 0), c.stepsFor(0));
    try std.testing.expectEqual(@as(u64, 0), c.dropped_steps);
}

test "StepClock: steady 60Hz never drops and never drifts" {
    // Vacuity guard for the cap tests above: the ordinary case must be
    // completely quiet, or a cap that fires constantly would look fine.
    var c = StepClock{};
    var total: u32 = 0;
    var i: usize = 0;
    while (i < 600) : (i += 1) total += c.stepsFor(STEP_MS);
    try std.testing.expectEqual(@as(u32, 600), total);
    try std.testing.expectEqual(@as(u64, 0), c.dropped_steps);
}

// ── gospel N2.2 · input dialect (mouse-exact) ────────────────────────────
//
// Mirrors `client/src/net/protocol.ts`'s InputBit exactly. Duplicated as
// constants rather than imported because the sim already hard-codes these
// (weapon.zig's `InputBitFire = 1 << 6`, world.zig's FIRE_BIT) — the wire
// numbering is the contract, and a third opinion about it is the danger.
pub const Bit = struct {
    pub const left: u32 = 1 << 0;
    pub const right: u32 = 1 << 1;
    pub const up: u32 = 1 << 2;
    pub const down: u32 = 1 << 3;
    pub const jump: u32 = 1 << 4;
    pub const crouch: u32 = 1 << 5;
    pub const fire: u32 = 1 << 6;
    pub const ability: u32 = 1 << 7;
    pub const shield: u32 = 1 << 8;
    pub const dash: u32 = 1 << 9;
    pub const slot1: u32 = 1 << 10;
    pub const slot2: u32 = 1 << 11;
    pub const slot3: u32 = 1 << 12;
};

/// Raw device state for one frame, as a shell would poll it.
///
/// A struct rather than direct raylib calls so the MAPPING is testable
/// without a window. The raylib layer's only job is filling this in; every
/// decision about what a key means lives in `mapInput` below, where a test
/// can reach it.
pub const RawInput = struct {
    key_a: bool = false,
    key_d: bool = false,
    key_w: bool = false,
    key_s: bool = false,
    key_space: bool = false,
    key_shift: bool = false,
    key_c: bool = false,
    key_e: bool = false,
    key_1: bool = false,
    key_2: bool = false,
    key_3: bool = false,
    mouse_left: bool = false,
    mouse_right: bool = false,
    /// Already converted to WORLD space by the shell — the sim never sees
    /// screen coordinates (the aim contract, see aim_dialect.zig).
    aim_world_x: f64 = 0,
    aim_world_y: f64 = 0,
    /// True when the local player's emission meter is full. The browser
    /// arms the emission key client-side on exactly this condition; the
    /// native shell must reproduce it or a native player could press E
    /// early and reach a code path a browser player cannot.
    emission_ready: bool = false,
};

/// Map device state to the sim's input frame. Pure.
///
/// The control truth (CLAUDE.md, and the Controls reference in Settings):
///   WASD move · SPACE/W jump · MOUSE aim+fire · SHIFT hold shield
///   RIGHT-CLICK or C aegis power-slide · E emission at a full meter
///   1-3 drafted abilities
///
/// Note on slot count: the goal row says "1-4 drafted actives", but the
/// rack is locked at THREE (MAX_ABILITY_SLOTS, sim/src/world_state.zig)
/// and the shipped Controls copy says 1-3. Three is implemented; the row
/// is stale.
pub fn mapInput(raw: RawInput) FrameInput {
    var keys: u32 = 0;
    if (raw.key_a) keys |= Bit.left;
    if (raw.key_d) keys |= Bit.right;
    // W is both "up" and a jump alias, matching the browser. Up drives
    // aim-relative movement intent; jump is the actual verb.
    if (raw.key_w) keys |= Bit.up | Bit.jump;
    if (raw.key_space) keys |= Bit.jump;
    if (raw.key_s) keys |= Bit.down | Bit.crouch;
    if (raw.mouse_left) keys |= Bit.fire;
    if (raw.key_shift) keys |= Bit.shield;
    if (raw.mouse_right or raw.key_c) keys |= Bit.dash;
    // THE ARM GATE. E does nothing unless the meter is full — reproduced
    // here because the browser gates it client-side, and a native shell
    // that sent the bit early would hand native players a state browser
    // players can never reach. Server-validated too, but "the other
    // client can't even ask" is the property being preserved.
    if (raw.key_e and raw.emission_ready) keys |= Bit.ability;
    if (raw.key_1) keys |= Bit.slot1;
    if (raw.key_2) keys |= Bit.slot2;
    if (raw.key_3) keys |= Bit.slot3;

    return .{
        .keys = keys,
        .aim_x = raw.aim_world_x,
        .aim_y = raw.aim_world_y,
        .dt_ms = STEP_MS,
    };
}

test "mapInput: movement and jump aliases" {
    try std.testing.expectEqual(Bit.left, mapInput(.{ .key_a = true }).keys);
    try std.testing.expectEqual(Bit.right, mapInput(.{ .key_d = true }).keys);
    try std.testing.expectEqual(Bit.jump, mapInput(.{ .key_space = true }).keys);
    // W is up AND jump, same as the browser.
    try std.testing.expectEqual(Bit.up | Bit.jump, mapInput(.{ .key_w = true }).keys);
    try std.testing.expectEqual(Bit.down | Bit.crouch, mapInput(.{ .key_s = true }).keys);
}

test "mapInput: fire, shield, and both slide bindings" {
    try std.testing.expectEqual(Bit.fire, mapInput(.{ .mouse_left = true }).keys);
    try std.testing.expectEqual(Bit.shield, mapInput(.{ .key_shift = true }).keys);
    // Right-click and C are the SAME verb; either alone must produce it,
    // and both together must not produce it twice or cancel.
    try std.testing.expectEqual(Bit.dash, mapInput(.{ .mouse_right = true }).keys);
    try std.testing.expectEqual(Bit.dash, mapInput(.{ .key_c = true }).keys);
    try std.testing.expectEqual(Bit.dash, mapInput(.{ .mouse_right = true, .key_c = true }).keys);
}

test "mapInput: the emission ARM GATE — E is inert on an empty meter" {
    // The property: a native player must not be able to ask for something
    // a browser player cannot. The browser arms E client-side on a full
    // meter; without this the native shell would send the bit early.
    try std.testing.expectEqual(@as(u32, 0), mapInput(.{ .key_e = true }).keys);
    try std.testing.expectEqual(
        Bit.ability,
        mapInput(.{ .key_e = true, .emission_ready = true }).keys,
    );
    // Vacuity guard: a full meter with the key UP is still nothing, so the
    // test above is about the key and not just the flag.
    try std.testing.expectEqual(@as(u32, 0), mapInput(.{ .emission_ready = true }).keys);
}

test "mapInput: ability slots are 1-3, and there is no slot 4" {
    try std.testing.expectEqual(Bit.slot1, mapInput(.{ .key_1 = true }).keys);
    try std.testing.expectEqual(Bit.slot2, mapInput(.{ .key_2 = true }).keys);
    try std.testing.expectEqual(Bit.slot3, mapInput(.{ .key_3 = true }).keys);
    // Nothing maps to 1 << 13. The rack is locked at MAX_ABILITY_SLOTS=3;
    // the goal row's "1-4" is stale and this pins which one is right.
    const all = mapInput(.{ .key_1 = true, .key_2 = true, .key_3 = true }).keys;
    try std.testing.expectEqual(@as(u32, 0), all & (@as(u32, 1) << 13));
}

test "mapInput: aim passes through in WORLD space, untouched" {
    // The aim contract: the shell has already converted; the dialect must
    // not "helpfully" transform it. Mouse is exact — see aim_dialect.zig.
    const f = mapInput(.{ .aim_world_x = 1234.5, .aim_world_y = -67.25 });
    try std.testing.expectEqual(@as(f64, 1234.5), f.aim_x);
    try std.testing.expectEqual(@as(f64, -67.25), f.aim_y);
}

test "mapInput: a full hand of inputs composes without collisions" {
    // Vacuity guard for the single-key tests: every bit distinct, nothing
    // masking anything else.
    const f = mapInput(.{
        .key_a = true, .key_space = true, .mouse_left = true,
        .key_shift = true, .key_c = true, .key_e = true,
        .emission_ready = true, .key_2 = true,
    });
    const want = Bit.left | Bit.jump | Bit.fire | Bit.shield | Bit.dash | Bit.ability | Bit.slot2;
    try std.testing.expectEqual(want, f.keys);
    try std.testing.expectEqual(@as(u32, 7), @popCount(f.keys));
}

// ── gospel N2.5 · death detection, testable without a speaker ────────────
//
// Lives here rather than in play.zig because play.zig links raylib and a
// window, so nothing in it can be unit-tested. The CUE (does a sound come
// out) needs a device; the DECISION (did someone just die) does not, and
// conflating them left the logic unverifiable — the first version was
// exercised only by replays that happen to contain no deaths at all.

pub const MAX_WATCHED: usize = 16;

/// Edge-detector over players' alive flags.
///
/// A death is a TRANSITION, not a state. Firing on "is dead" would
/// retrigger every tick a body stays down, which at 60 Hz is a cue per
/// 16 ms for as long as the corpse exists.
pub const DeathWatch = struct {
    was_alive: [MAX_WATCHED]bool = @splat(false),
    /// Set once a slot has been seen alive. Without it, the very first
    /// sample of an already-dead player reads as a death, and a mid-match
    /// joiner's empty slot would fire a cue on arrival.
    seen: [MAX_WATCHED]bool = @splat(false),
    deaths: u64 = 0,

    /// Feed one tick's alive flags; returns how many deaths occurred.
    pub fn note(self: *DeathWatch, alive: []const bool) u32 {
        var fired: u32 = 0;
        for (alive, 0..) |a, i| {
            if (i >= MAX_WATCHED) break;
            if (self.seen[i] and self.was_alive[i] and !a) {
                fired += 1;
                self.deaths += 1;
            }
            if (a) self.seen[i] = true;
            self.was_alive[i] = a;
        }
        return fired;
    }
};

test "DeathWatch: fires once on alive->dead, not every tick after" {
    var w = DeathWatch{};
    try std.testing.expectEqual(@as(u32, 0), w.note(&.{true}));
    try std.testing.expectEqual(@as(u32, 1), w.note(&.{false}));
    // The bug this guards: a corpse lying there is not 60 deaths a second.
    try std.testing.expectEqual(@as(u32, 0), w.note(&.{false}));
    try std.testing.expectEqual(@as(u32, 0), w.note(&.{false}));
    try std.testing.expectEqual(@as(u64, 1), w.deaths);
}

test "DeathWatch: a respawn re-arms the detector" {
    var w = DeathWatch{};
    _ = w.note(&.{true});
    try std.testing.expectEqual(@as(u32, 1), w.note(&.{false}));
    _ = w.note(&.{true}); // respawn
    try std.testing.expectEqual(@as(u32, 1), w.note(&.{false}));
    try std.testing.expectEqual(@as(u64, 2), w.deaths);
}

test "DeathWatch: a slot that starts dead never fires" {
    // A mid-match joiner's empty slot, or a player already down when the
    // viewer attaches. Neither is a death that just happened.
    var w = DeathWatch{};
    try std.testing.expectEqual(@as(u32, 0), w.note(&.{false}));
    try std.testing.expectEqual(@as(u32, 0), w.note(&.{false}));
    try std.testing.expectEqual(@as(u64, 0), w.deaths);
}

test "DeathWatch: independent slots do not bleed into each other" {
    var w = DeathWatch{};
    _ = w.note(&.{ true, true, true });
    // Only the middle one dies.
    try std.testing.expectEqual(@as(u32, 1), w.note(&.{ true, false, true }));
    // And the survivors must not fire on the next tick.
    try std.testing.expectEqual(@as(u32, 0), w.note(&.{ true, false, true }));
    // Vacuity guard: the other two CAN still fire, so the zero above is
    // about the transition and not about them being ignored.
    try std.testing.expectEqual(@as(u32, 2), w.note(&.{ false, false, false }));
}

test "DeathWatch: more players than MAX_WATCHED does not overflow" {
    var w = DeathWatch{};
    var many: [64]bool = @splat(true);
    _ = w.note(&many);
    many[0] = false;
    try std.testing.expectEqual(@as(u32, 1), w.note(&many));
}
