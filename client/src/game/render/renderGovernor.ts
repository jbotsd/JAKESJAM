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
import { getQualityProfile, forceRigDowngrade, isRigDowngraded } from "./qualityProfile.js";
import { getRenderScale, setRenderScaleRuntime } from "./renderResolution.js";
import { crumb, record } from "../../telemetry.js";

const CHECK_INTERVAL_MS = 2_000;
const DOWN_FACTOR = 1.35;
const UP_FACTOR = 0.85;
const DOWN_STREAK = 3; // 3 consecutive bad checks (~6s) before stepping
const UP_HOLD_MS = 30_000;
const UP_LOCKOUT_AFTER_DOWN_MS = 60_000;
/** Weak-GPU tiers may trade far more resolution before motion: VideoCore
 *  at 0.5 floor still ran out of fill on a real Pi 5 (2026-07-10). */
const FLOOR = 0.5;
const FLOOR_POTATO = 0.35;

export class RenderGovernor {
  private readonly game: Phaser.Game;
  /** Scale the session STARTED at — the governor never climbs above it. */
  private readonly ceilingScale: number;
  private readonly targetDtMs: number;
  private nextCheckAtMs = 0;
  private badStreak = 0;
  private goodSinceMs: number | null = null;
  private lastDownAtMs = 0;

  private readonly floor: number;
  /** Futility detection: dt before the last down-step, and how many
   *  consecutive steps produced no measurable improvement. */
  private dtBeforeStep = 0;
  private futileSteps = 0;
  private frozenUntilMs = 0;

  constructor(game: Phaser.Game) {
    this.game = game;
    this.ceilingScale = getRenderScale();
    const profile = getQualityProfile();
    this.floor = profile.tier === "potato" ? FLOOR_POTATO : FLOOR;
    this.targetDtMs = profile.fpsLimit > 0 ? 1000 / profile.fpsLimit : 1000 / 60;
  }

  /** Call once per frame with the render-loop dt EMA (NetStats.frameDtEmaMs). */
  update(nowMs: number, frameDtEmaMs: number): void {
    if (frameDtEmaMs <= 0 || nowMs < this.nextCheckAtMs) return;
    this.nextCheckAtMs = nowMs + CHECK_INTERVAL_MS;
    const rs = getRenderScale();

    if (frameDtEmaMs > this.targetDtMs * DOWN_FACTOR) {
      this.goodSinceMs = null;
      this.badStreak += 1;
      // FUTILITY DETECTION (2026-07-11, from Jake's 4080 console log): the
      // governor walked 1.5→0.5 while dt sat at 24-37ms the whole way —
      // when frame time is presentation- or CPU-bound, dropping resolution
      // only blurs the game. If a down-step didn't improve dt ≥8%, count it
      // futile; two futile steps → restore one step and FREEZE stepping.
      if (this.dtBeforeStep > 0) {
        const improved = frameDtEmaMs < this.dtBeforeStep * 0.92;
        if (improved) {
          this.futileSteps = 0;
        } else {
          this.futileSteps += 1;
        }
        this.dtBeforeStep = 0;
        if (this.futileSteps >= 2) {
          const restored = Math.min(this.ceilingScale, rs + 0.25);
          setRenderScaleRuntime(this.game, restored);
          this.frozenUntilMs = nowMs + 120_000;
          this.futileSteps = 0;
          console.log(
            `[governor] resolution-insensitive (dt ${frameDtEmaMs.toFixed(1)}ms regardless) — restoring rs→${getRenderScale().toFixed(2)}, stepping frozen 120s`,
          );
          crumb("perf", `governor futile — not fill-bound, rs→${getRenderScale().toFixed(2)} frozen`);
          // 2026-07-13: futility here specifically means CPU-bound, not
          // fill-bound (see qualityProfile.ts's forceRigDowngrade docblock
          // for the full chain — this was previously a diagnosis with no
          // lever). The single biggest known CPU cost above "potato" tier
          // is ProceduralPlayerRig's full per-frame vector redraw; drop to
          // the baked (textured-quad) twin for the rest of this session.
          // Takes effect on the next rig construction (respawn/match
          // start), not instantly mid-frame — that's an acceptable soft
          // transition, not a correctness requirement.
          const rigWasDowngraded = isRigDowngraded();
          if (!rigWasDowngraded) forceRigDowngrade();
          record({
            kind: "perf",
            sig: "governor-futile",
            message: `resolution-insensitive frame time (dt ${frameDtEmaMs.toFixed(1)}ms)`,
            data: { dt: Math.round(frameDtEmaMs * 10) / 10, rs: getRenderScale(), rigDowngraded: !rigWasDowngraded },
          });
          return;
        }
      }
      if (nowMs < this.frozenUntilMs) return;
      if (this.badStreak >= DOWN_STREAK && rs > this.floor) {
        // Bigger steps from high (DPR-crisp) ceilings — walking 2.0→0.8
        // in 0.1 hops would take a minute of visible jank.
        const step = rs > 1.2 ? 0.25 : 0.1;
        this.dtBeforeStep = frameDtEmaMs;
        setRenderScaleRuntime(this.game, Math.max(this.floor, rs - step));
        this.badStreak = 0;
        this.lastDownAtMs = nowMs;
        console.log(`[governor] frame dt ${frameDtEmaMs.toFixed(1)}ms — renderScale → ${getRenderScale().toFixed(2)}`);
        crumb("perf", `governor down dt=${frameDtEmaMs.toFixed(1)}ms rs→${getRenderScale().toFixed(2)}`);
        if (getRenderScale() <= this.floor + 0.001) {
          record({
            kind: "perf",
            sig: "governor-floor",
            message: `governor hit floor ${this.floor} (dt ${frameDtEmaMs.toFixed(1)}ms)`,
            data: { dt: Math.round(frameDtEmaMs * 10) / 10, floor: this.floor },
          });
        }
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
