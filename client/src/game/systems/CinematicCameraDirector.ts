// Scripted camera driver for the Pretennoia tutorial's non-interactive beats.
// Wraps the SAME real Phaser.Cameras.Scene2D.Camera object ActionCamera
// wraps (TutorialScene hands both classes the same `this.cameras.main`) —
// ActionCamera only ever moves the camera when its own update() is called,
// so during a scripted beat the scene simply stops calling that and drives
// the camera through this class instead via Phaser's own pan/zoomTo/fade/
// flash/shake. See TutorialScene.ts for the ownership handoff boundary.
//
// Handoff INTO combat (director → action) must always call
// ActionCamera.snap() explicitly rather than relying on its own distance-
// based auto-snap heuristic (SNAP_DIST) — that heuristic would
// non-deterministically choose glide-vs-cut depending on how close this
// director's last framing happened to leave the camera, which reads as a
// bug the first time it picks the wrong one. Handoff OUT of combat needs no
// snap: a panTo() call here naturally continues from wherever ActionCamera
// left cam.scrollX/Y.

export type CameraEase = "Sine.easeInOut" | "Sine.easeIn" | "Sine.easeOut" | "Linear";

export class CinematicCameraDirector {
  private readonly cam: Phaser.Cameras.Scene2D.Camera;
  // Vertical-follow state for scripted-but-tracking beats (the wall-jump
  // shaft climb) — a real gap found 2026-07-13: the shaft's reveal pan was
  // the ONLY camera movement for the entire ~37s Three Forms zone; once it
  // finished, "director" ownership just sat static at that one framing for
  // the whole climb (no handoff to ActionCamera ever fires there — see
  // tutorial-song.ts). Player feedback: "we like cinematical follow them
  // up." This is a lighter-weight, deliberately-damped follow (not
  // ActionCamera's snappy multi-subject combat envelope) — smooth, centered
  // on a fixed X (the shaft's own centerline, not the player's, so
  // side-to-side wall-jump bouncing doesn't read as camera shake), tracking
  // only the player's rising Y.
  private followX = 0;
  private followY = 0;
  private followReady = false;

  constructor(cam: Phaser.Cameras.Scene2D.Camera) {
    this.cam = cam;
  }

  /** Call once when a follow beat begins (e.g. right as the reveal pan
   *  finishes) so the first tracked frame doesn't jump from wherever the
   *  camera was left. */
  beginFollow(x: number, y: number): void {
    this.followX = x;
    this.followY = y;
    this.followReady = true;
  }

  endFollow(): void {
    this.followReady = false;
  }

  /** Exponential-smoothed centerOn, called every frame of a follow beat.
   *  `k` is the smoothing rate (higher = snappier, lower = more lag/
   *  "cinematic weight") — same shape ActionCamera already uses for its
   *  own subject smoothing, just applied directly to the camera's own
   *  center instead of a tracked subject. */
  updateFollow(targetX: number, targetY: number, deltaMs: number, k = 2.0): void {
    if (!this.followReady) {
      this.beginFollow(targetX, targetY);
    }
    const dt = Math.min(deltaMs, 40) / 1000;
    const a = 1 - Math.exp(-k * dt);
    this.followX += (targetX - this.followX) * a;
    this.followY += (targetY - this.followY) * a;
    this.cam.centerOn(this.followX, this.followY);
  }

  snap(x: number, y: number, zoom?: number): void {
    this.cam.centerOn(x, y);
    if (zoom !== undefined) this.cam.setZoom(zoom);
  }

  panTo(x: number, y: number, ms: number, ease: CameraEase = "Sine.easeInOut", zoom?: number): Promise<void> {
    if (zoom !== undefined) void this.zoomTo(zoom, ms, ease);
    return new Promise((resolve) => {
      this.cam.pan(x, y, ms, ease, false, (_cam, progress) => {
        if (progress >= 1) resolve();
      });
    });
  }

  zoomTo(zoom: number, ms: number, ease: CameraEase = "Sine.easeInOut"): Promise<void> {
    return new Promise((resolve) => {
      this.cam.zoomTo(zoom, ms, ease, false, (_cam, progress) => {
        if (progress >= 1) resolve();
      });
    });
  }

  fadeOut(ms: number, rgb: [number, number, number] = [3, 4, 8]): Promise<void> {
    return new Promise((resolve) => {
      const cb: Phaser.Types.Cameras.Scene2D.CameraFadeCallback = (_cam, progress) => {
        if (progress >= 1) resolve();
      };
      this.cam.fadeOut(ms, rgb[0], rgb[1], rgb[2], cb);
    });
  }

  fadeIn(ms: number, rgb: [number, number, number] = [3, 4, 8]): Promise<void> {
    return new Promise((resolve) => {
      const cb: Phaser.Types.Cameras.Scene2D.CameraFadeCallback = (_cam, progress) => {
        if (progress >= 1) resolve();
      };
      this.cam.fadeIn(ms, rgb[0], rgb[1], rgb[2], cb);
    });
  }

  /** A hard, bright hit — used for the 0:32 drop and the outro burst. */
  flash(ms: number, rgb: [number, number, number] = [255, 236, 170]): void {
    this.cam.flash(ms, rgb[0], rgb[1], rgb[2]);
  }

  /** Native Phaser shake — independent of ActionCamera's own trauma-based
   *  shake, so this director stays fully self-sufficient while it owns the
   *  camera (ActionCamera's trauma decay only applies inside its own
   *  update(), which isn't being called during a scripted beat). */
  shake(ms: number, intensity: number): void {
    this.cam.shake(ms, intensity);
  }
}
