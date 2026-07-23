//! Phase H7 — round state machine. Pure tick-driven phase
//! transitions, mirroring the structural skeleton of
//! `client/src/sim/round.ts` `stepRound`.
//!
//! Scope: countdown → fighting (on countdown=0, time-limit set),
//! fighting → round-over (on time=0, winner decided externally),
//! round-over → drafting (on hold=0, DRAFT_WINDOW_MS window opens),
//! drafting → countdown (on all-resolved OR window=0, round_index
//! incremented).
//!
//! UPDATED (Phase 2, docs/zig-step-world-parity-goal.md — draft/offer-roll
//! system): round-over used to fall straight back to countdown (this
//! module's own former doc comment: "Drafting transitions land in a
//! follow-on cut... For now we fall straight back to countdown — same as
//! the legacy TS path"). That path is GONE — round-over now always routes
//! through drafting, matching TS's `stepRound`'s real (non-fallback)
//! behavior: the "no tick/rngState supplied" legacy fallback round.ts
//! itself still carries exists ONLY for TS's pure-unit-test callers, which
//! has no Zig analog (`step_world` always has a tick + rng cursor) — see
//! `round.ts`'s own `RoundStepInput.tick`/`.rngState` doc comments for that
//! TS-side nuance, which does not apply here.
//!
//! Still true: the orchestrator (Phase I, world.zig's `stepWorld`) wraps
//! this with score keeping + winner detection + drafting orchestration
//! (offer rolling, pick application — see `draft.zig`). This module owns
//! ONLY the phase + countdown_remaining_ms transitions — it is
//! DELIBERATELY kept free of any card-data/RNG dependency, exactly like
//! `winner_decided` already keeps it free of player-roster knowledge for
//! the fighting → round-over transition: `drafting_all_resolved` (new
//! parameter below) is the identical shape for the drafting → countdown
//! transition — an externally-computed fact, not a capability this module
//! gains.

const std = @import("std");
const world_state = @import("world_state.zig");

pub const COUNTDOWN_MS: f64 = 3000.0;
pub const ROUND_TIME_LIMIT_MS: f64 = 90_000.0;
pub const ROUND_OVER_HOLD_MS: f64 = 2500.0;
/// Mirrors round.ts's `DRAFT_WINDOW_MS` exactly (Jake, 2026-07-17: "why
/// does it need to be so long" — trimmed from an original 15s to 8s so one
/// AFK human doesn't tax the whole arena that long per round; the auto-pick-
/// on-expiry path is what keeps AFKs from wedging the round forever either
/// way).
pub const DRAFT_WINDOW_MS: f64 = 8000.0;

// Shrink-zone storm constants (Track Z0b Item C — port of orphaned-branch
// commit 9aeabaa) — parity with client/src/sim/round.ts's exports of the
// same names (re-verified against current main 2026-07-23: values
// unchanged since the branch spec).
pub const SUDDEN_DEATH_SCALE_START: f64 = 1.0;
pub const SUDDEN_DEATH_SCALE_END: f64 = 0.6;
pub const SUDDEN_DEATH_STORM_DPS: f64 = 8.0;
pub const ENDGAME_ZONE_TRIGGER_MS: f64 = 15_000.0;
pub const ENDGAME_ZONE_SCALE_END: f64 = 0.75;

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
///   `drafting_all_resolved` — true if the orchestrator has already
///                      determined every drafter has picked (or had
///                      nothing to pick) this tick (`draft.zig`'s
///                      `allDraftersResolved`) — same "externally-decided
///                      fact, not locally computed" shape `winner_decided`
///                      already establishes for the fighting phase. Only
///                      consulted while `current_phase == drafting`;
///                      ignored otherwise (mirrors `winner_decided` only
///                      mattering during `fighting`).
///
/// Returns the new phase + new countdown_remaining_ms. Pure
/// function — the orchestrator writes the values back into
/// WorldState.header.round_phase + tracking elsewhere.
pub fn roundStepPhase(
    current_phase: u8,
    countdown_remaining_ms: f64,
    dt_ms: f64,
    winner_decided: bool,
    drafting_all_resolved: bool,
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
                // Always routes through drafting now (Phase 2) — the
                // orchestrator rolls DRAFT_OFFER_COUNT offers per player
                // on this exact transition (world.zig's own
                // "transitioned==1 and new_phase==drafting" block).
                return .{
                    .new_phase = @intFromEnum(RoundPhase.drafting),
                    .transitioned = 1,
                    .new_countdown_remaining_ms = DRAFT_WINDOW_MS,
                };
            }
            return .{
                .new_phase = current_phase,
                .transitioned = 0,
                .new_countdown_remaining_ms = next_remaining,
            };
        },
        @intFromEnum(RoundPhase.drafting) => {
            // Resolution criteria (either, mirrors round.ts's own
            // "either" comment on stepRound's drafting case exactly):
            //   1. every drafter has picked (drafting_all_resolved, an
            //      externally-computed fact — see this fn's own doc
            //      comment), or
            //   2. the draft window expired (next_remaining <= 0.0) —
            //      the orchestrator auto-picks stragglers' first offer
            //      (world.zig's own countdown-arrival block).
            if (drafting_all_resolved or next_remaining <= 0.0) {
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
        else => return .{
            .new_phase = current_phase,
            .transitioned = 0,
            .new_countdown_remaining_ms = next_remaining,
        },
    }
}

/// KEPT AT THE OLD 5-ARG SHAPE (phase, remaining_ms, dt_ms, winner_decided,
/// out_ptr) — investigated before extending it: `client/src/sim/wasm/
/// __tests__/roundPhaseParity.test.ts` calls this export positionally with
/// exactly 5 args ahead of `out_ptr`; adding a 6th parameter would shift
/// that test's `OUT_PTR` argument into the new slot and leave `out_ptr`
/// itself `undefined` (→ wasm writes land at address 0, not `OUT_PTR`),
/// breaking every test in that file, not just the round_over one — a
/// wasm-ABI-arity footgun this project's own JS↔wasm calling convention
/// has no arity-checking against. `drafting_all_resolved` is hardcoded
/// `false` through this thin export — a real, deliberate limitation: a
/// drafting phase driven ONLY through this specific export can resolve by
/// window-expiry but never early-resolve. `world.zig`'s native
/// orchestrator (the actual `step_world` path this whole goal is about)
/// calls the UNDERLYING `roundStepPhase` directly with the real computed
/// value — this export is a thin, narrower-scoped parity-test surface, not
/// the real call site. NOTE: this also means round_over now transitions to
/// `drafting` (not `countdown`) through this export too, same as the real
/// path — `roundPhaseParity.test.ts`'s own "round_over→countdown when hold
/// finishes" test is now asserting SUPERSEDED behavior (per this whole
/// phase's actual purpose) and needs a TS-side follow-up update; flagged
/// here rather than silently left for someone to discover as a mystery
/// failure.
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
        false,
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

pub export fn round_draft_window_ms() f64 {
    return DRAFT_WINDOW_MS;
}

pub export fn sizeof_round_phase_step_result() u32 {
    return @sizeOf(PhaseStepResult);
}
