// TickSlewController — FishNet-style per-client tick slew hints.
//
// The server measures how far ahead (or behind) each client's inputs are
// arriving relative to the current server tick. It targets a lead of
// TARGET_LEAD_TICKS (inputs should arrive 2 ticks before the server needs
// them). A positive computeAdjustMs means the client is running too fast
// (inputs arrive early) → client should slow down. Negative means the client
// is running too slow → client should speed up.
//
// Wire convention: included in snapshots as `tickAdjustMs` (optional, omitted
// when 0). +ve = slow down, -ve = speed up. Capped to ±MAX_SLEW_MS_PER_TICK.

import { STEP_MS } from "@sim/index.ts";
import type { PlayerId, Tick } from "@sim/types.ts";

export type SlewSample = { serverTick: Tick; inputTick: Tick };

/** How many ticks ahead we want inputs to arrive. */
const TARGET_LEAD_TICKS = 2;

/** Rolling window of samples kept per player. */
const WINDOW_SAMPLES = 30;

/** Maximum adjustment magnitude per snapshot, in ms (steady-state). */
const MAX_SLEW_MS_PER_TICK = 1;

/** Recovery mode (2026-07-24, kindled live tape): a client wedged FAR out
 *  of the input window (e.g. the server's own loop fell behind wall-clock
 *  under load and the client raced ahead of TICK_FUTURE_BOUND) needs more
 *  than 1ms/snapshot to ever come home — at 1ms it loses the race against
 *  ongoing drift and stays wedged forever. Past RECOVERY_ERROR_TICKS of
 *  mean error the clamp widens to RECOVERY_MAX_SLEW_MS, which matches the
 *  client's own 1ms-per-tick budget drain cap (~60ms/s) — the fastest the
 *  client can actually apply, so anything larger is wasted. */
const RECOVERY_ERROR_TICKS = 10;
const RECOVERY_MAX_SLEW_MS = 3;

/**
 * Arrival delta within ±DEAD_BAND_TICKS of the target is considered
 * steady-state. No adjustment is emitted.
 */
const DEAD_BAND_TICKS = 0.5;

/** EMA weight for the last-5-results smoother. α = 2/(N+1) with N=5. */
const EMA_ALPHA = 2 / (5 + 1); // ≈ 0.333

interface PlayerSlewState {
  /** Circular buffer of (serverTick - inputTick) values. */
  readonly window: number[];
  /** EMA of raw computeAdjustMs results. Initialized to 0. */
  emaMs: number;
  /** Whether the EMA has been seeded (first sample bypasses EMA to avoid
   *  cold-start dampening). */
  emaSeed: boolean;
}

export class TickSlewController {
  private readonly players = new Map<PlayerId, PlayerSlewState>();

  private getOrCreate(playerId: PlayerId): PlayerSlewState {
    let s = this.players.get(playerId);
    if (!s) {
      s = { window: [], emaMs: 0, emaSeed: false };
      this.players.set(playerId, s);
    }
    return s;
  }

  /**
   * Record a new arrival sample for a player.
   * Call once per input received in `applyInput`.
   */
  recordInput(playerId: PlayerId, sample: SlewSample): void {
    const s = this.getOrCreate(playerId);
    // delta = serverTick - inputTick.
    // When inputs arrive exactly on-time at a lead of TARGET_LEAD_TICKS:
    //   delta === TARGET_LEAD_TICKS (positive: server tick > input tick).
    // "2 ticks ahead" means the input was stamped 2 ticks in the future
    // relative to the server, so delta = serverTick - inputTick = -2 (input tick
    // is AHEAD of server tick by 2). We therefore target delta = -TARGET_LEAD_TICKS.
    const delta = (sample.serverTick as number) - (sample.inputTick as number);
    s.window.push(delta);
    if (s.window.length > WINDOW_SAMPLES) {
      s.window.shift();
    }
  }

  /**
   * Compute the slew hint for the given player.
   *
   * Returns 0 if: no samples yet, or the mean arrival lead is within the
   * dead band of the target. Otherwise returns a signed correction clamped to
   * ±MAX_SLEW_MS_PER_TICK, EMA-smoothed over recent calls.
   *
   * +ve → client should slow down (inputs arriving too early / client running fast).
   * -ve → client should speed up (inputs arriving too late / client running slow).
   */
  computeAdjustMs(playerId: PlayerId): number {
    const s = this.players.get(playerId);
    if (!s || s.window.length === 0) return 0;

    // Mean of the rolling window.
    let sum = 0;
    for (const v of s.window) sum += v;
    const meanDelta = sum / s.window.length;

    // Target: delta should be -TARGET_LEAD_TICKS (client runs 2 ticks ahead).
    // error > 0: client running too fast (inputs arrive early, delta > target).
    // error < 0: client running too slow (inputs arrive late, delta < target).
    const error = meanDelta - (-TARGET_LEAD_TICKS);

    // Dead band: suppress noise inside ±DEAD_BAND_TICKS.
    if (Math.abs(error) <= DEAD_BAND_TICKS) {
      // Still update EMA toward 0 so it doesn't hold stale values.
      s.emaMs = s.emaSeed ? s.emaMs * (1 - EMA_ALPHA) : 0;
      return 0;
    }

    // Convert ticks → ms.
    // error < 0 → delta is below target → client is running TOO FAST (too far ahead)
    //   → we want POSITIVE adjustment (slow down).
    // error > 0 → delta is above target → client is running TOO SLOW (not far enough ahead)
    //   → we want NEGATIVE adjustment (speed up).
    // Therefore negate: rawMs = -error * STEP_MS.
    const rawMs = -error * STEP_MS;

    // Steady-state clamp, widened in recovery mode (see the constant's doc
    // comment) so a far-out-of-window client actually converges.
    const cap = Math.abs(error) > RECOVERY_ERROR_TICKS ? RECOVERY_MAX_SLEW_MS : MAX_SLEW_MS_PER_TICK;

    // Clamp before EMA so extreme outliers don't contaminate the smooth signal.
    const clampedRaw = Math.max(-cap, Math.min(cap, rawMs));

    // EMA smoothing.
    let smoothed: number;
    if (!s.emaSeed) {
      smoothed = clampedRaw;
      s.emaSeed = true;
    } else {
      smoothed = EMA_ALPHA * clampedRaw + (1 - EMA_ALPHA) * s.emaMs;
    }
    s.emaMs = smoothed;

    // Clamp the smoothed result too (EMA can't exceed the raw cap, but be safe).
    return Math.max(-cap, Math.min(cap, smoothed));
  }
}
