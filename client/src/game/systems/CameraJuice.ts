import Phaser from "phaser";
import type { ActionIntensity } from "./ActionIntensity.js";

// CameraJuice — small reusable camera-feel helpers, factored out of
// OnlineMatchScene's original combat-only safeShake/killCinematic so
// Practice (which had ZERO camera reaction to landing/wall-jump/dash) and
// the online path can share one implementation instead of two drifting
// copies.
//
// Takes the scene's ActionIntensity (optional — Practice has one, but any
// future caller that doesn't care about intensity can omit it) and bumps it
// automatically whenever a shake/punch ACTUALLY fires. This means every
// existing combat shake call site (shot-fired, hit-confirmed, kill,
// sudden-death, kill-streak...) feeds intensity for free just by routing
// through here — no need to hunt down and edit each one individually.
export class CameraJuice {
  private readonly cam: Phaser.Cameras.Scene2D.Camera;
  private readonly intensity?: ActionIntensity;

  constructor(cam: Phaser.Cameras.Scene2D.Camera, intensity?: ActionIntensity) {
    this.cam = cam;
    this.intensity = intensity;
  }

  /**
   * Shake, but never stacks a smaller request on top of a bigger one already
   * running — repeated small triggers (e.g. a fast string of landings)
   * shouldn't compound into nausea. Ported from OnlineMatchScene's
   * safeShake; `shakeEffect._amplitude` is a private Phaser field, cast
   * defensively so a future Phaser version simply falls back to
   * always-shake rather than throwing.
   */
  safeShake(durationMs: number, intensity: number): void {
    const effect = this.cam.shakeEffect as unknown as {
      isRunning?: boolean;
      _amplitude?: number;
    };
    const currentAmplitude = effect._amplitude ?? 0;
    if (effect.isRunning && intensity <= currentAmplitude) return;
    this.cam.shake(durationMs, intensity);
    // Shake intensities in practice range roughly 0.0015 (a shot fired) to
    // 0.016 (a big destructible break) — scale that into a reasonable
    // action-intensity bump rather than passing the raw shake number
    // through (they're unrelated units).
    this.intensity?.bump(Phaser.Math.Clamp(intensity * 12, 0.03, 0.35));
  }

  /**
   * A quick zoom punch — out then back to base — same pattern
   * OnlineMatchScene's killCinematic already proved out for the kill flash.
   * `scaleDelta` is added to the camera's CURRENT zoom (so it composes
   * fine with whatever base zoom a scene is already using).
   */
  punchZoom(scaleDelta: number, outMs = 70, backMs = 160): void {
    const base = this.cam.zoom;
    this.cam.zoomTo(base + scaleDelta, outMs, "Quad.easeOut", true, (_, progress) => {
      if (progress === 1) {
        this.cam.zoomTo(base, backMs, "Quad.easeIn", true);
      }
    });
    this.intensity?.bump(Phaser.Math.Clamp(Math.abs(scaleDelta) * 3, 0.05, 0.3));
  }
}
