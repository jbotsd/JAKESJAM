// Frame-time governor — the runtime half of the quality ladder. The tier
// sets the CEILING; this trades resolution first (the cheapest, most
// reversible lever) when the device can't hold frame time, and climbs back
// only slowly. Thermal throttling on phones looks identical to load spikes
// and gets the same response — and the asymmetric step-up delay prevents
// oscillation as the chassis heats and cools.
//
// Policy (from the scaling research):
//   - target frame dt = 1000/fpsLimit for capped tiers, 16.7ms uncapped
//   - sustained dt > 1.35× target  → renderScale −0.1 (floor 0.5)
//   - sustained dt < 0.85× target for 30s AND below the tier scale
//                                  → renderScale +0.05 (never above tier)
//   - never within 60s of a step-down (thermal hysteresis)

import Phaser from "phaser";
import { getQualityProfile } from "./qualityProfile.js";
import { getRenderScale, setRenderScaleRuntime } from "./renderResolution.js";

const CHECK_INTERVAL_MS = 2_000;
const DOWN_FACTOR = 1.35;
const UP_FACTOR = 0.85;
const DOWN_STREAK = 3; // 3 consecutive bad checks (~6s) before stepping
const UP_HOLD_MS = 30_000;
const UP_LOCKOUT_AFTER_DOWN_MS = 60_000;
const FLOOR = 0.5;

export class RenderGovernor {
  private readonly game: Phaser.Game;
  /** Scale the session STARTED at — the governor never climbs above it. */
  private readonly ceilingScale: number;
  private readonly targetDtMs: number;
  private nextCheckAtMs = 0;
  private badStreak = 0;
  private goodSinceMs: number | null = null;
  private lastDownAtMs = 0;

  constructor(game: Phaser.Game) {
    this.game = game;
    this.ceilingScale = getRenderScale();
    const cap = getQualityProfile().fpsLimit;
    this.targetDtMs = cap > 0 ? 1000 / cap : 1000 / 60;
  }

  /** Call once per frame with the render-loop dt EMA (NetStats.frameDtEmaMs). */
  update(nowMs: number, frameDtEmaMs: number): void {
    if (frameDtEmaMs <= 0 || nowMs < this.nextCheckAtMs) return;
    this.nextCheckAtMs = nowMs + CHECK_INTERVAL_MS;
    const rs = getRenderScale();

    if (frameDtEmaMs > this.targetDtMs * DOWN_FACTOR) {
      this.goodSinceMs = null;
      this.badStreak += 1;
      if (this.badStreak >= DOWN_STREAK && rs > FLOOR) {
        setRenderScaleRuntime(this.game, Math.max(FLOOR, rs - 0.1));
        this.badStreak = 0;
        this.lastDownAtMs = nowMs;
        console.log(`[governor] frame dt ${frameDtEmaMs.toFixed(1)}ms — renderScale → ${getRenderScale().toFixed(2)}`);
      }
      return;
    }

    this.badStreak = 0;
    if (frameDtEmaMs < this.targetDtMs * UP_FACTOR && rs < this.ceilingScale) {
      this.goodSinceMs ??= nowMs;
      const lockedOut = nowMs - this.lastDownAtMs < UP_LOCKOUT_AFTER_DOWN_MS;
      if (!lockedOut && nowMs - this.goodSinceMs >= UP_HOLD_MS) {
        setRenderScaleRuntime(this.game, Math.min(this.ceilingScale, rs + 0.05));
        this.goodSinceMs = nowMs;
        console.log(`[governor] headroom — renderScale → ${getRenderScale().toFixed(2)}`);
      }
    } else {
      this.goodSinceMs = null;
    }
  }
}
