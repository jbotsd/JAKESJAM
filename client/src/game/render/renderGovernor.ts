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
import { getQualityProfile, forceRigDowngrade, isRigDowngraded, type QualityTier } from "./qualityProfile.js";
import { getRenderScale, setRenderScaleRuntime } from "./renderResolution.js";
import { crumb, record } from "../../telemetry.js";

const CHECK_INTERVAL_MS = 2_000;
const DOWN_FACTOR = 1.35;
const UP_FACTOR = 0.85;
const DOWN_STREAK = 3; // 3 consecutive bad checks (~6s) before stepping
/**
 * Ultra-tier (detected discrete GPU — RTX/Radeon RX etc.) gets a longer
 * streak requirement before EVER touching resolution — a SECOND, PROACTIVE
 * fix on top of the futility-detection safety net below. That net already
 * proved (2026-07-11, Jake's 4080) that on this hardware class, elevated dt
 * is never fill-bound, only CPU/presentation-bound, so dropping resolution
 * doesn't help.
 *
 * (2026-07-27 lag/perf audit item 2 — "verify and retune the trigger")
 * Retuned 3→2 here. The 2026-07-11 evidence cuts BOTH ways on the old 3x:
 * a longer fuse gives brief hitches (GC, network snapshot processing,
 * clip-encoder work) more room to pass on their own, but the SAME evidence
 * also proves the resolution-scaling lever itself is futile on this exact
 * hardware class — so every extra second spent waiting to try it is a
 * second NOT spent reaching the lever that actually works
 * (forceRigDowngrade, one futile step later). A false-positive trigger's
 * blast radius is small and self-correcting either way (one renderScale
 * step, auto-reverted at the very next 2s check once futility is detected)
 * — so shortening the fuse trades a marginally-more-likely brief visible
 * blur for materially faster recovery on the ACTUAL bottleneck. Old total
 * time-to-rig-downgrade on sustained bad dt: ~20s (9 checks × 2s + 1 more
 * to detect futility). New: ~14s (6 checks × 2s + 1 more). Non-ultra tiers
 * (phone/standard/potato, genuinely fill-bound cases where stepping DOES
 * help) are untouched — this tightening is scoped to the one tier the real
 * evidence is actually about. See `deriveGovernorTiming` (exported for
 * `renderGovernorTiming.test.ts`) for the numbers this derives.
 */
const ULTRA_DOWN_STREAK_MULT = 2;
const UP_HOLD_MS = 30_000;
const UP_LOCKOUT_AFTER_DOWN_MS = 60_000;
/** Weak-GPU tiers may trade far more resolution before motion: VideoCore
 *  at 0.5 floor still ran out of fill on a real Pi 5 (2026-07-10). */
const FLOOR = 0.5;
const FLOOR_POTATO = 0.35;

/** Everything the constructor derives from tier alone, pulled out as a pure
 *  function so it's testable without booting a real Phaser.Game (see
 *  `renderGovernorTiming.test.ts`) — this pass's item 2 tunes exactly these
 *  numbers for ultra, so a direct assertion on them is the honest test,
 *  not a re-implementation of the constructor's logic in the test file. */
export type GovernorTiming = {
  downStreakNeeded: number;
  /** Ultra tier self-corrects after 1 futile step instead of 2 — if the
   *  fuse above still wasn't enough to avoid a bad down-step, don't make
   *  it wait through a second one before reverting. */
  futileStepsToRestore: number;
  floor: number;
  targetDtMs: number;
  /** Wall-clock ms from the first sustained-bad check to `forceRigDowngrade`
   *  firing, under dt that never improves. Each of the `futileStepsToRestore`
   *  down-steps needs a fresh `downStreakNeeded`-check wait (badStreak resets
   *  to 0 after every step), plus one final check to detect the LAST step
   *  was futile — i.e. `downStreakNeeded * futileStepsToRestore + 1` checks
   *  total. Verified against the real class in
   *  `renderGovernorTiming.test.ts`'s behavior test, not just asserted here.
   *  Derived, not independently tuned — the number this pass's retune is
   *  actually about. */
  worstCaseMsToRigDowngrade: number;
};

export function deriveGovernorTiming(tier: QualityTier, fpsLimit: number): GovernorTiming {
  const isUltra = tier === "ultra";
  const downStreakNeeded = isUltra ? DOWN_STREAK * ULTRA_DOWN_STREAK_MULT : DOWN_STREAK;
  const futileStepsToRestore = isUltra ? 1 : 2;
  return {
    downStreakNeeded,
    futileStepsToRestore,
    floor: tier === "potato" ? FLOOR_POTATO : FLOOR,
    targetDtMs: fpsLimit > 0 ? 1000 / fpsLimit : 1000 / 60,
    worstCaseMsToRigDowngrade:
      (downStreakNeeded * futileStepsToRestore + 1) * CHECK_INTERVAL_MS,
  };
}

// ── Global attachment (2026-07-31) ──────────────────────────────────────
// The governor originally lived inside OnlineMatchScene.update(), so the
// quality ladder could only ever react mid-match — the hangout venue,
// menus, tutorial and replay all rendered ungoverned (the "old laptop is
// slideshow-slow in the lobby and nothing downgrades" report). Frame time
// is a property of the game, not of one scene: attach once at boot,
// measure the real rAF cadence at POST_STEP, and every scene is covered
// with one shared instance (two instances would double-step the ladder).

const GLOBAL_EMA_ALPHA = 0.1;
let globalGovernor: RenderGovernor | null = null;

export function attachGlobalRenderGovernor(game: Phaser.Game): RenderGovernor {
  if (globalGovernor) return globalGovernor;
  const governor = new RenderGovernor(game);
  globalGovernor = governor;
  let lastTs = 0;
  let ema = 0;
  // Literal event key, NOT Phaser.Core.Events.POST_STEP: everything else in
  // this file uses Phaser in type position only, so Bun's transpiler elides
  // the phaser import under `bun test` — a value reference here would pull
  // Phaser's real module init (window-dependent device detection) into the
  // DOM-less test process and abort the whole test file.
  game.events.on("poststep", () => {
    const now = performance.now();
    const dt = lastTs > 0 ? now - lastTs : 0;
    lastTs = now;
    // Hidden-tab rAF gaps / debugger pauses are not frame time — one
    // multi-second delta would poison the EMA into an instant down-step.
    if (dt <= 0 || dt > 500) return;
    ema = ema === 0 ? dt : ema + (dt - ema) * GLOBAL_EMA_ALPHA;
    governor.update(now, ema);
  });
  return governor;
}

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
  private readonly downStreakNeeded: number;
  /** Ultra tier self-corrects after 1 futile step instead of 2 — if the
   *  much longer fuse above still wasn't enough to avoid a bad down-step,
   *  don't make it wait through a second one before reverting. */
  private readonly futileStepsToRestore: number;
  /** Futility detection: dt before the last down-step, and how many
   *  consecutive steps produced no measurable improvement. */
  private dtBeforeStep = 0;
  private futileSteps = 0;
  private frozenUntilMs = 0;

  constructor(game: Phaser.Game) {
    this.game = game;
    this.ceilingScale = getRenderScale();
    const profile = getQualityProfile();
    const timing = deriveGovernorTiming(profile.tier, profile.fpsLimit);
    this.floor = timing.floor;
    this.targetDtMs = timing.targetDtMs;
    this.downStreakNeeded = timing.downStreakNeeded;
    this.futileStepsToRestore = timing.futileStepsToRestore;
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
        if (this.futileSteps >= this.futileStepsToRestore) {
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
      if (this.badStreak >= this.downStreakNeeded && rs > this.floor) {
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
