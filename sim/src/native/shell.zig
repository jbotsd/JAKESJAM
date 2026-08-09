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
