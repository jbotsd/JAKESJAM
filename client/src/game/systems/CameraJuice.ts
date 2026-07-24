import Phaser from "phaser";
import type { ActionIntensity } from "./ActionIntensity.js";
import type { ActionCamera } from "./ActionCamera.js";

// CameraJuice — thin adapter so the many existing call sites (SimEventRouter
// combat shakes, both scenes' movement juice) don't each need to know about
// the ActionCamera's trauma model. Maps the old `safeShake(durationMs,
// intensity)` shape onto ActionCamera.addTrauma, and optionally bumps the
// shared ActionIntensity so every impact that shakes also feeds the
// music/environment reaction for free.
//
// Zoom-punch delegates straight through but should ONLY be used for RARE
// events (a kill): a punch on a frequent movement action pulses the whole
// frame and reads as instability (see ActionCamera). Wall-jump/dash use
// addTrauma instead.
export class CameraJuice {
  private readonly cam: ActionCamera;
  private readonly intensity?: ActionIntensity;

  constructor(cam: ActionCamera, intensity?: ActionIntensity) {
    this.cam = cam;
    this.intensity = intensity;
  }

  /**
   * Legacy shake entry point. `intensity` is the old Phaser cam.shake
   * amplitude (fraction of viewport, ~0.0015–0.018 across the codebase),
   * mapped onto additive trauma. Duration is ignored — trauma decays on its
   * own curve now.
   */
  safeShake(_durationMs: number, intensity: number): void {
    // ~0.012 (a kill) → ~0.66 trauma; ~0.008 (a hit) → ~0.44; floor keeps a
    // tiny shot-shake perceptible without dominating.
    this.cam.addTrauma(Math.min(0.85, Math.max(0.03, intensity * 55)));
    this.intensity?.bump(Phaser.Math.Clamp(intensity * 12, 0.03, 0.35));
  }

  /**
   * Directional camera kick (slash-feel-ledger R1 row 9): a world-space
   * impulse ALONG the hit vector (rides ActionCamera.sideSwipe — fast
   * out, faster back, spring not tween) plus a small trauma bump as the
   * NOISE layer. Directional-first: the first displaced frame moves with
   * the hit, the random shake only textures it. No roll — Jake's standing
   * "don't roll the camera" direction.
   */
  directionalKick(
    dirX: number,
    dirY: number,
    kickPx: number,
    durMs: number,
    noisePx: number,
  ): void {
    const len = Math.hypot(dirX, dirY) || 1;
    this.cam.sideSwipe(
      (dirX / len) * kickPx,
      (dirY / len) * kickPx,
      durMs * 0.35,
      durMs * 0.65,
    );
    this.cam.addTrauma(Math.min(0.6, noisePx * 0.09));
    this.intensity?.bump(Phaser.Math.Clamp(noisePx * 0.04, 0.03, 0.3));
  }

  /** Direct trauma add for movement feedback that isn't shaped like a shake. */
  addTrauma(amount: number): void {
    this.cam.addTrauma(amount);
    this.intensity?.bump(Phaser.Math.Clamp(amount * 0.5, 0.03, 0.35));
  }

  /** RARE zoom-punch only (a kill). Never for frequent movement. `lockOnX/Y`,
   *  when given, is the actual point of impact (the victim, not necessarily
   *  the local player) — the frame briefly biases toward it instead of only
   *  ever punching in on wherever the camera already happened to be centred. */
  punchZoom(scaleDelta: number, outMs = 70, backMs = 200, lockOnX?: number, lockOnY?: number): void {
    this.cam.punchZoom(scaleDelta, outMs, backMs, lockOnX, lockOnY);
    this.intensity?.bump(Phaser.Math.Clamp(Math.abs(scaleDelta) * 3, 0.05, 0.3));
  }
}
