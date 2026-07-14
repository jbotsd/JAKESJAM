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
//
// Rubber-band safety net (Jake, 2026-07-14: "we should never fall off camera
// in showcase... zooming out is fine for dramatic narrative effect but...
// there are some clear issues"): unlike ActionCamera, whose update() ends
// with a hard "the local player never leaves the screen" clamp (step 7.5),
// every beat here is a raw Phaser tween toward an author-chosen target —
// nothing stops a subject from drifting out of frame if a pan/zoom target
// was authored slightly off, or a subject moves somewhere the beat didn't
// anticipate. clampToKeepVisible() is a lightweight per-frame safety pass
// TutorialScene calls unconditionally whenever this director owns the
// camera (see cameraOwner in TutorialScene.ts): it does NOT override the
// beat's intended pan/zoom (dramatic pull-outs stay exactly as authored) —
// it only nudges the center, eased rather than snapped so the correction
// itself never reads as a cut, if a tracked subject is about to cross the
// safe margin. Only as a last resort (subjects too far apart for the
// CURRENT zoom to ever fit both, regardless of center) does it gently push
// zoom OUT — never in, so it can loosen a shot but never fights an
// intentional close-up.

export type CameraEase = "Sine.easeInOut" | "Sine.easeIn" | "Sine.easeOut" | "Linear";

type Point2 = { x: number; y: number };

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

  /** Margin as a fraction of the half-viewport — matches the spirit of
   *  ActionCamera's own SAFE_MARGIN_FRAC (never literally shared: that
   *  constant is private, and the two systems' framing philosophies differ
   *  enough — combat envelope vs. authored beats — that keeping this as its
   *  own tunable is more honest than a fake shared source of truth). */
  private static readonly SAFETY_MARGIN_FRAC = 0.1;
  /** Correction speed — high enough that a subject never visibly sits
   *  outside the margin for more than a couple frames, low enough that the
   *  nudge itself reads as a rubber band, not a snap-cut. */
  private static readonly CORRECTION_K = 9.0;
  /** Ceiling on how far the safety net may push zoom OUT beyond whatever
   *  the beat authored — a last resort for "subjects too spread out for
   *  this shot," not a general-purpose auto-frame system. */
  private static readonly MAX_SAFETY_ZOOM_OUT = 1.6;

  /**
   * Per-frame rubber-band pass — call unconditionally every frame this
   * director owns the camera (see class docblock). `subjects` should be
   * whatever's narratively load-bearing right now (typically hero + the
   * active opponent/boss, when alive); pass an empty array to no-op.
   */
  clampToKeepVisible(subjects: readonly Point2[], deltaMs: number): void {
    if (subjects.length === 0) return;
    const dt = Math.min(deltaMs, 40) / 1000;
    const baseZoom = Math.max(0.01, this.cam.zoom);
    const margin = CinematicCameraDirector.SAFETY_MARGIN_FRAC;

    // Does EVERY subject fit inside the frame at all, even with a perfectly
    // centered shot? If not, no center-nudge alone can satisfy the
    // guarantee — widen zoom (bounded) until the full spread fits, then
    // frame on the subjects' own midpoint.
    let minX = subjects[0]!.x, maxX = subjects[0]!.x;
    let minY = subjects[0]!.y, maxY = subjects[0]!.y;
    for (const s of subjects) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.y > maxY) maxY = s.y;
    }
    const spreadHalfW = (maxX - minX) / 2;
    const spreadHalfH = (maxY - minY) / 2;
    const neededHalfW = spreadHalfW / (1 - margin);
    const neededHalfH = spreadHalfH / (1 - margin);
    const zoomFitW = neededHalfW > 0 ? this.cam.width / 2 / neededHalfW : baseZoom;
    const zoomFitH = neededHalfH > 0 ? this.cam.height / 2 / neededHalfH : baseZoom;
    const requiredZoom = Math.min(baseZoom, zoomFitW, zoomFitH);
    const minAllowedZoom = baseZoom / CinematicCameraDirector.MAX_SAFETY_ZOOM_OUT;
    const effZoom = Math.max(minAllowedZoom, requiredZoom);
    if (effZoom < baseZoom - 0.001) {
      const a = 1 - Math.exp(-CinematicCameraDirector.CORRECTION_K * dt);
      this.cam.setZoom(baseZoom + (effZoom - baseZoom) * a);
    }

    // Center-nudge: intersect every subject's own "keep me safely inside
    // the frame" center range. When the zoom widen above already covers
    // the full spread, this intersection is guaranteed non-empty (modulo
    // the exponential zoom easing not having fully caught up yet, in which
    // case we just clamp to whatever range IS currently feasible).
    const z = Math.max(0.01, this.cam.zoom);
    const hw = (this.cam.width / 2 / z) * (1 - margin);
    const hh = (this.cam.height / 2 / z) * (1 - margin);
    let minCx = -Infinity, maxCx = Infinity, minCy = -Infinity, maxCy = Infinity;
    for (const s of subjects) {
      minCx = Math.max(minCx, s.x - hw);
      maxCx = Math.min(maxCx, s.x + hw);
      minCy = Math.max(minCy, s.y - hh);
      maxCy = Math.min(maxCy, s.y + hh);
    }
    // Feasible-range collapse (zoom easing lagging the widen above, or an
    // authored shot that's simply too tight this frame): fall back to the
    // subjects' own midpoint rather than leaving an unsatisfiable range
    // unresolved.
    const targetCx = minCx <= maxCx
      ? Math.min(maxCx, Math.max(minCx, this.cam.midPoint.x))
      : (minX + maxX) / 2;
    const targetCy = minCy <= maxCy
      ? Math.min(maxCy, Math.max(minCy, this.cam.midPoint.y))
      : (minY + maxY) / 2;
    if (targetCx !== this.cam.midPoint.x || targetCy !== this.cam.midPoint.y) {
      const a = 1 - Math.exp(-CinematicCameraDirector.CORRECTION_K * dt);
      const nx = this.cam.midPoint.x + (targetCx - this.cam.midPoint.x) * a;
      const ny = this.cam.midPoint.y + (targetCy - this.cam.midPoint.y) * a;
      this.cam.centerOn(nx, ny);
    }
  }
}
