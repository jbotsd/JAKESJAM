//! Phase H7 — round state machine. Pure tick-driven phase
//! transitions, mirroring the structural skeleton of
//! `client/src/sim/round.ts` `stepRound`.
//!
//! Scope: countdown → fighting (on countdown=0, time-limit set),
//! fighting → round-over (on time=0, winner decided externally),
//! round-over → countdown (on hold=0, round_index incremented).
//! Drafting transitions land in a follow-on cut — they require
//! per-player offer arrays which are tied to the card data tables
//! (Phase H7b after the data port).
//!
//! The orchestrator (Phase I) wraps this with score keeping +
//! winner detection + drafting orchestration. This module owns
//! ONLY the phase + countdown_remaining_ms transitions.

const std = @import("std");
const world_state = @import("world_state.zig");

pub const COUNTDOWN_MS: f64 = 3000.0;
pub const ROUND_TIME_LIMIT_MS: f64 = 90_000.0;
pub const ROUND_OVER_HOLD_MS: f64 = 2500.0;

pub const RoundPhase = world_state.RoundPhase;

/// Per-tick result of `roundStepPhase`. Tells the orchestrator
/// whether the phase changed this tick and what the new phase is.
pub const PhaseStepResult = extern struct {
    new_phase: u8, // RoundPhase enum tag
    transitioned: u8, // 1 if phase changed this tick
    _pad: [2]u8 = .{ 0, 0 },
    new_countdown_remaining_ms: f64,
};

/// Tick a round phase forward. The orchestrator passes:
///   `current_phase` — RoundPhase tag (0=countdown, 1=fighting, 2=round_over, 3=drafting)
///   `countdown_remaining_ms` — ms left in the current phase's window
///   `dt_ms` — tick step
///   `winner_decided` — true if the orchestrator already decided
///                      a winner this tick (skips fighting → round-over
///                      time-out path; orchestrator drives the
///                      transition itself with its own winner)
///
/// Returns the new phase + new countdown_remaining_ms. Pure
/// function — the orchestrator writes the values back into
/// WorldState.header.round_phase + tracking elsewhere.
pub fn roundStepPhase(
    current_phase: u8,
    countdown_remaining_ms: f64,
    dt_ms: f64,
    winner_decided: bool,
) PhaseStepResult {
    const next_remaining_raw = countdown_remaining_ms - dt_ms;
    const next_remaining: f64 = if (next_remaining_raw < 0.0) 0.0 else next_remaining_raw;

    switch (current_phase) {
        @intFromEnum(RoundPhase.countdown) => {
            if (next_remaining <= 0.0) {
                return .{
                    .new_phase = @intFromEnum(RoundPhase.fighting),
                    .transitioned = 1,
                    .new_countdown_remaining_ms = ROUND_TIME_LIMIT_MS,
                };
            }
            return .{
                .new_phase = current_phase,
                .transitioned = 0,
                .new_countdown_remaining_ms = next_remaining,
            };
        },
        @intFromEnum(RoundPhase.fighting) => {
            // The orchestrator's winner-decided path takes precedence
            // over the time-out path so a knockout in the same tick as
            // a timeout still records the winner.
            if (winner_decided or next_remaining <= 0.0) {
                return .{
                    .new_phase = @intFromEnum(RoundPhase.round_over),
                    .transitioned = 1,
                    .new_countdown_remaining_ms = ROUND_OVER_HOLD_MS,
                };
            }
            return .{
                .new_phase = current_phase,
                .transitioned = 0,
                .new_countdown_remaining_ms = next_remaining,
            };
        },
        @intFromEnum(RoundPhase.round_over) => {
            if (next_remaining <= 0.0) {
                // The orchestrator will set up offers + decide
                // whether to roll into drafting (when the data tables
                // ship in H7b). For now we fall straight back to
                // countdown — same as the legacy TS path.
                return .{
                    .new_phase = @intFromEnum(RoundPhase.countdown),
                    .transitioned = 1,
                    .new_countdown_remaining_ms = COUNTDOWN_MS,
                };
            }
            return .{
                .new_phase = current_phase,
                .transitioned = 0,
                .new_countdown_remaining_ms = next_remaining,
            };
        },
        @intFromEnum(RoundPhase.drafting) => {
            // Drafting is a "we wait" state — orchestrator drives the
            // exit when all offers are picked (or expiry hits).
            return .{
                .new_phase = current_phase,
                .transitioned = 0,
                .new_countdown_remaining_ms = next_remaining,
            };
        },
        else => return .{
            .new_phase = current_phase,
            .transitioned = 0,
            .new_countdown_remaining_ms = next_remaining,
        },
    }
}

pub export fn round_step_phase(
    current_phase: u8,
    countdown_remaining_ms: f64,
    dt_ms: f64,
    winner_decided: u32,
    out_ptr: *PhaseStepResult,
) void {
    out_ptr.* = roundStepPhase(
        current_phase,
        countdown_remaining_ms,
        dt_ms,
        winner_decided != 0,
    );
}

pub export fn round_countdown_ms() f64 {
    return COUNTDOWN_MS;
}

pub export fn round_time_limit_ms() f64 {
    return ROUND_TIME_LIMIT_MS;
}

pub export fn round_over_hold_ms() f64 {
    return ROUND_OVER_HOLD_MS;
}

pub export fn sizeof_round_phase_step_result() u32 {
    return @sizeOf(PhaseStepResult);
}
