// LagCompensator — owns the "rewind opponents for the shooter" technique.
//
// Depth: the position-history ring, the tick-interpolation query, the rewind
// plan construction, and the post-step unshift are all behind a small seam.
// MatchHost delegates the entire lag-comp concern here; the tick loop calls
// three methods (recordTick, buildRewindPlan, unshiftAfterStep) and gets
// back a typed plan it can pass straight to stepWithRuntime.
//
// Standard "rewind opponents" technique: when the server processes a fire
// input generated at client tick T, the shooter saw opponents where the
// server had them at T (accounting for one-way latency and the interpolation
// buffer). We rewind every OTHER player to their tick-T position for the
// spawn frame so the shot lands where the shooter aimed. The shooter's own
// position is NOT rewound — they fire from where they are now, which is what
// their predicted client also did.
//
// Anti-cheat clamp: anything more than ~250 ms of lookback is suspect so we
// hard-cap. 250 ms / 16.67 ms/tick ≈ 15 ticks.

import { STEP_MS } from "@sim/index.ts";
import type { InputFrame, PlayerId, Tick, WorldState } from "@sim/types.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const LAG_COMP_MAX_MS = 250;
export const LAG_COMP_MAX_TICKS = Math.ceil(LAG_COMP_MAX_MS / STEP_MS);
// Two ticks of headroom past the cap so interpolation between adjacent
// samples never falls off the end.
const POSITION_HISTORY_CAPACITY = 32;

/** Bit index of the fire key in the packed input bitmask. */
const FIRE_BIT = 1 << 6;

// ─── Types ───────────────────────────────────────────────────────────────────

type PositionSample = {
  tick: Tick;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
};

export type RewindPlan = {
  /** The firing player whose lookback drove the rewind. Their position is
   *  not shifted; only opponents'. */
  shooter: PlayerId;
  /** Lookback in ticks (already clamped to LAG_COMP_MAX_TICKS). */
  lookbackTicks: number;
  /** Lookback in ms (lookbackTicks * STEP_MS). */
  lookbackMs: number;
  /** The historical tick we rewound opponents to. */
  targetTick: Tick;
  /** Per-opponent (dx, dy) shift from real -> rewound, used to invert
   *  the swap on the post-step state. */
  shifts: Map<PlayerId, { dx: number; dy: number }>;
  /** All players who fired this tick, with their individual lookbacks.
   *  Used only for diagnostic logging. */
  shooters: Array<{ playerId: PlayerId; lookbackTicks: number; lookbackMs: number }>;
  /** State copy with opponent positions pre-shifted, ready for stepWithRuntime. */
  stateForStep: WorldState;
};

// ─── LagCompensator ──────────────────────────────────────────────────────────

export class LagCompensator {
  /** Rolling per-player position history. Ordered oldest → newest,
   *  capped at POSITION_HISTORY_CAPACITY. */
  private readonly playerPositionHistory = new Map<PlayerId, PositionSample[]>();

  /**
   * Record position samples for every player in `state` after a tick
   * completes. Must be called AFTER state is committed so samples reflect
   * the position visible to clients in the next snapshot.
   */
  recordTick(state: WorldState): void {
    const tick = state.tick;
    for (const [pidStr, entity] of Object.entries(state.players)) {
      const pid = pidStr as PlayerId;
      let history = this.playerPositionHistory.get(pid);
      if (!history) {
        history = [];
        this.playerPositionHistory.set(pid, history);
      }
      history.push({
        tick,
        x: entity.x,
        y: entity.y,
        vx: entity.vx,
        vy: entity.vy,
        alive: entity.alive,
      });
      if (history.length > POSITION_HISTORY_CAPACITY) {
        history.splice(0, history.length - POSITION_HISTORY_CAPACITY);
      }
    }
    // Drop history for players that have left the match entirely.
    for (const pid of this.playerPositionHistory.keys()) {
      if (!state.players[pid]) {
        this.playerPositionHistory.delete(pid);
      }
    }
  }

  /**
   * Inspect this tick's pending inputs. If any player is firing AND their
   * input.tick is older than the current server tick, build a rewind plan:
   *  - `stateForStep`: a copy of `state` with each opponent swapped to their
   *    historical position at the chosen lookback tick.
   *  - `shifts`: per-opponent (dx, dy) so we can invert the swap on the
   *    resulting state after stepWithRuntime returns.
   *
   * Multi-shooter ticks pick the largest lookback (the player most affected
   * by latency wins; in a duel the other player IS the shooter so this
   * collapses to "the only firing player's lookback"). For >2 player matches
   * with simultaneous fire we accept the approximation rather than running
   * the step N times.
   *
   * Returns null when no rewind is needed (no fire inputs, or lookback = 0).
   */
  buildRewindPlan(
    state: WorldState,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
  ): RewindPlan | null {
    const serverTick = state.tick;
    let bestShooter: PlayerId | null = null;
    let bestLookback = 0;
    const shooters: Array<{ playerId: PlayerId; lookbackTicks: number; lookbackMs: number }> = [];

    for (const [pidStr, input] of Object.entries(inputsByPlayer)) {
      if (!input) continue;
      if ((input.keys & FIRE_BIT) === 0) continue;
      const pid = pidStr as PlayerId;
      const rawDelta = serverTick - input.tick;
      const lookbackTicks = Math.max(0, Math.min(LAG_COMP_MAX_TICKS, rawDelta));
      shooters.push({ playerId: pid, lookbackTicks, lookbackMs: lookbackTicks * STEP_MS });
      if (lookbackTicks > bestLookback) {
        bestLookback = lookbackTicks;
        bestShooter = pid;
      }
    }

    if (bestShooter === null || bestLookback === 0) return null;

    const targetTick = (serverTick - bestLookback) as Tick;
    const shifts = new Map<PlayerId, { dx: number; dy: number }>();
    const rewoundPlayers: WorldState["players"] = { ...state.players };

    for (const [pidStr, entity] of Object.entries(state.players)) {
      const pid = pidStr as PlayerId;
      if (pid === bestShooter) continue;
      const sample = this.getPlayerAtTick(pid, targetTick);
      if (!sample) continue;
      const dx = sample.x - entity.x;
      const dy = sample.y - entity.y;
      if (dx === 0 && dy === 0) continue;
      shifts.set(pid, { dx, dy });
      rewoundPlayers[pid] = { ...entity, x: sample.x, y: sample.y };
    }

    if (shifts.size === 0) return null;

    return {
      shooter: bestShooter,
      lookbackTicks: bestLookback,
      lookbackMs: bestLookback * STEP_MS,
      targetTick,
      shifts,
      shooters,
      stateForStep: { ...state, players: rewoundPlayers },
    };
  }

  /**
   * Invert the rewind plan's shift on the post-step state. The sim's
   * movement integration started each opponent from the rewound position,
   * so its output position is `(rewound + delta)`; we want `(real + delta)`.
   * Subtracting the original shift vector restores that. Health, cooldowns,
   * and lastProcessedInputSeq are untouched.
   */
  unshiftAfterStep(state: WorldState, plan: RewindPlan): WorldState {
    const players: WorldState["players"] = { ...state.players };
    for (const [pid, shift] of plan.shifts) {
      const entity = players[pid];
      if (!entity) continue;
      players[pid] = { ...entity, x: entity.x - shift.dx, y: entity.y - shift.dy };
    }
    return { ...state, players };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Returns the player's position at the given tick by linear interpolation
   * between the two surrounding history samples. Falls back to clamping at
   * the oldest/newest sample if `tick` lies outside the buffered range.
   * Returns null if there is no history (e.g. just-joined player).
   */
  private getPlayerAtTick(playerId: PlayerId, tick: Tick): PositionSample | null {
    const history = this.playerPositionHistory.get(playerId);
    if (!history || history.length === 0) return null;
    const first = history[0]!;
    const last = history[history.length - 1]!;
    if (tick <= first.tick) return first;
    if (tick >= last.tick) return last;
    for (let i = history.length - 1; i > 0; i -= 1) {
      const hi = history[i]!;
      const lo = history[i - 1]!;
      if (tick >= lo.tick && tick <= hi.tick) {
        const span = hi.tick - lo.tick;
        // Zero-span (two samples recorded at the same tick during a hiccup):
        // clamp t to 0 so we sit on `lo` deterministically. Returning `hi` here
        // can produce position discontinuities under lag-compensated rewind.
        const t = span > 0 ? (tick - lo.tick) / span : 0;
        return {
          tick,
          x: lo.x + (hi.x - lo.x) * t,
          y: lo.y + (hi.y - lo.y) * t,
          vx: lo.vx + (hi.vx - lo.vx) * t,
          vy: lo.vy + (hi.vy - lo.vy) * t,
          alive: lo.alive,
        };
      }
    }
    return last;
  }
}
