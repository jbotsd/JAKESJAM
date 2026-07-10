import Phaser from "phaser";
import {
  ENVELOPE_MARGIN_FRAC,
  expSmoothPoint,
  fitEnvelope,
  smoothZoomGoal,
  stickyEnvelopeSubjects,
  weightedCentroid,
  zoomToFit,
  type Point2,
} from "./actionCameraMath.js";

/** Per-frame inputs the camera frames around. `extra` are opponents the
 *  frame should envelope when in range. `yBias` shifts centre down (portrait). */
export interface CameraFocus {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  extra?: ReadonlyArray<{ x: number; y: number }>;
  yBias?: number;
}

/**
 * ActionCamera — smooth hand-driven follow.
 *
 * Pipeline (each step is continuous / exp-smoothed — no hard snaps mid-fight):
 *  1. Sticky envelope subjects (hysteresis) so nearest-foe thrash can't yank frame
 *  2. EMA on subject positions (physics jitter ≠ camera jitter)
 *  3. Soft centroid + soft envelope pull (not hard min/max clamp)
 *  4. EMA on the framing target itself
 *  5. Look-ahead (eased; reduced under envelope tension)
 *  6. Deadzone only when solo; multi-subject disables it (deadzone+constraint = stutter)
 *  7. Exp follow on centre
 *  8. Trauma shake additive
 *  9. Zoom pull-out with deadband + slower ease-in than ease-out
 */
export class ActionCamera {
  private readonly cam: Phaser.Cameras.Scene2D.Camera;

  private cx = 0;
  private cy = 0;
  private leadX = 0;
  private leadY = 0;
  private trauma = 0;
  private shakeTime = 0;
  private ready = false;
  private baseZoom = 1;
  private envelopeZoom = 1;
  private punchActive = false;

  /** Sticky subject slots (world positions, smoothed). */
  private stickySubjects: Point2[] = [];
  private smoothedSubjects: Point2[] = [];
  /** Smoothed framing target — kills hard-envelope edge chatter. */
  private targetX = 0;
  private targetY = 0;
  private targetReady = false;

  // --- tuning: snappier follow (was 5.2/7.2/5.8) — τ≈1/k was ~190ms of
  // camera lag making local motion feel floaty even when prediction was tight.
  // Raised k keeps envelope smoothing but cuts perceived lag ~40%.
  private static readonly FOLLOW_K = 8.5;
  private static readonly TARGET_K = 11;
  private static readonly SUBJECT_K = 9;
  private static readonly LEAD_K = 3.2;
  private static readonly LEAD_FRAC = 0.12;
  private static readonly VLEAD_SCALE = 0.33;
  private static readonly AIM_LEAD_FRAC = 0.06;
  private static readonly LEAD_SATURATE_SPEED = 570;
  private static readonly DEADZONE_FRAC = 0.04;
  private static readonly TRAUMA_DECAY = 1.8;
  private static readonly MAX_SHAKE_PX = 18;
  private static readonly SNAP_DIST = 1150;
  private static readonly ZOOM_OUT_K = 3.5;
  private static readonly ZOOM_IN_K = 1.8;
  /** How much of the soft-envelope correction we take (mid: full↔0.45). */
  private static readonly ENVELOPE_BLEND = 0.72;

  constructor(cam: Phaser.Cameras.Scene2D.Camera) {
    this.cam = cam;
    this.baseZoom = cam.zoom;
    this.envelopeZoom = cam.zoom;
  }

  setBaseZoom(zoom: number): void {
    this.baseZoom = zoom;
    if (!this.punchActive) {
      // Don't instantly jump envelopeZoom up with base; ease next frames.
      if (this.envelopeZoom > zoom) this.envelopeZoom = zoom;
      this.cam.setZoom(this.envelopeZoom);
    }
  }

  snap(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    this.leadX = 0;
    this.leadY = 0;
    this.ready = true;
    this.targetX = x;
    this.targetY = y;
    this.targetReady = true;
    this.stickySubjects = [];
    this.smoothedSubjects = [];
    this.envelopeZoom = this.baseZoom;
    if (!this.punchActive) this.cam.setZoom(this.baseZoom);
    this.cam.centerOn(x, y);
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  punchZoom(scaleDelta: number, outMs = 70, backMs = 200): void {
    const returnTo = this.envelopeZoom;
    this.punchActive = true;
    this.cam.zoomTo(returnTo + scaleDelta, outMs, "Quad.easeOut", true, (_, progress) => {
      if (progress === 1) {
        this.cam.scene.time.delayedCall(0, () => {
          this.cam.zoomTo(returnTo, backMs, "Quad.easeIn", true, (__, p2) => {
            if (p2 === 1) this.punchActive = false;
          });
        });
      }
    });
  }

  update(deltaMs: number, focus: CameraFocus): void {
    const dt = Math.min(deltaMs, 40) / 1000; // clamp harder — tab spikes used to lurch
    const self: Point2 = { x: focus.x, y: focus.y };
    const extras = focus.extra ?? [];
    const yBias = focus.yBias ?? 0;

    if (!this.ready) {
      this.snap(self.x, self.y + yBias);
      return;
    }
    if (Math.hypot(self.x - this.cx, self.y - this.cy) > ActionCamera.SNAP_DIST) {
      this.snap(self.x, self.y + yBias);
      return;
    }

    // 1–2. Sticky subjects + EMA positions (stable fight pair).
    this.stickySubjects = stickyEnvelopeSubjects(self, extras, this.stickySubjects);
    while (this.smoothedSubjects.length < this.stickySubjects.length) {
      const s = this.stickySubjects[this.smoothedSubjects.length]!;
      this.smoothedSubjects.push({ x: s.x, y: s.y });
    }
    this.smoothedSubjects.length = this.stickySubjects.length;
    for (let i = 0; i < this.stickySubjects.length; i++) {
      this.smoothedSubjects[i] = expSmoothPoint(
        this.smoothedSubjects[i]!,
        this.stickySubjects[i]!,
        ActionCamera.SUBJECT_K,
        dt,
      );
    }
    const subjects = this.smoothedSubjects;

    // View at current envelope zoom (matches what player sees).
    const z = Math.max(0.01, this.envelopeZoom);
    const halfW = this.cam.width / 2 / z;
    const halfH = this.cam.height / 2 / z;

    // 3. Soft centroid + *partial* envelope pull (full pull was too sensitive).
    const soft = weightedCentroid(self, subjects.length ? subjects : extras);
    soft.y += yBias;
    const env = fitEnvelope(soft, self, subjects, halfW, halfH, ENVELOPE_MARGIN_FRAC);
    const desiredX = soft.x + (env.x - soft.x) * ActionCamera.ENVELOPE_BLEND;
    const desiredY = soft.y + (env.y - soft.y) * ActionCamera.ENVELOPE_BLEND;

    // 4. EMA the framing target (kills clamp chatter).
    if (!this.targetReady) {
      this.targetX = desiredX;
      this.targetY = desiredY;
      this.targetReady = true;
    } else {
      const t = expSmoothPoint(
        { x: this.targetX, y: this.targetY },
        { x: desiredX, y: desiredY },
        ActionCamera.TARGET_K,
        dt,
      );
      this.targetX = t.x;
      this.targetY = t.y;
    }

    // Zoom: compute need at base zoom, deadband, asymmetric ease.
    const baseHalfW = this.cam.width / 2 / Math.max(0.01, this.baseZoom);
    const baseHalfH = this.cam.height / 2 / Math.max(0.01, this.baseZoom);
    const envBase = fitEnvelope(soft, self, subjects, baseHalfW, baseHalfH, ENVELOPE_MARGIN_FRAC);
    let goalZoom = zoomToFit(
      this.cam.width,
      this.cam.height,
      envBase.neededHalfW,
      envBase.neededHalfH,
      this.baseZoom,
    );
    goalZoom = smoothZoomGoal(this.envelopeZoom, goalZoom, this.baseZoom);
    const zoomK =
      goalZoom < this.envelopeZoom - 0.001
        ? ActionCamera.ZOOM_OUT_K
        : ActionCamera.ZOOM_IN_K;
    this.envelopeZoom += (goalZoom - this.envelopeZoom) * (1 - Math.exp(-zoomK * dt));
    if (!this.punchActive) {
      // Quantize to 0.001 to avoid subpixel zoom fighting GPU scroll.
      const zq = Math.round(this.envelopeZoom * 1000) / 1000;
      if (Math.abs(zq - this.cam.zoom) > 0.0005) this.cam.setZoom(zq);
      this.envelopeZoom = zq;
    }

    // 5. Look-ahead — mid: quieter in fights, not muted.
    const halfWLead = this.cam.width / 2 / Math.max(0.01, this.envelopeZoom);
    const leadScale = subjects.length > 0 ? 0.34 * (1 - 0.5 * env.tension) : 0.92;
    const speed = Math.hypot(focus.vx, focus.vy) || 1;
    const speedFrac = Math.min(1, speed / ActionCamera.LEAD_SATURATE_SPEED);
    const moveLeadX =
      (focus.vx / speed) * speedFrac * halfWLead * ActionCamera.LEAD_FRAC * leadScale;
    const moveLeadY =
      (focus.vy / speed) *
      speedFrac *
      halfWLead *
      ActionCamera.LEAD_FRAC *
      ActionCamera.VLEAD_SCALE *
      leadScale;
    const aimDx = focus.aimX - focus.x;
    const aimDy = focus.aimY - focus.y;
    const aimLen = Math.hypot(aimDx, aimDy) || 1;
    const aimLeadX =
      (aimDx / aimLen) * halfWLead * ActionCamera.AIM_LEAD_FRAC * leadScale;
    const aimLeadY =
      (aimDy / aimLen) *
      halfWLead *
      ActionCamera.AIM_LEAD_FRAC *
      ActionCamera.VLEAD_SCALE *
      leadScale;
    const leadA = 1 - Math.exp(-ActionCamera.LEAD_K * dt);
    this.leadX += (moveLeadX + aimLeadX - this.leadX) * leadA;
    this.leadY += (moveLeadY + aimLeadY - this.leadY) * leadA;

    // Soft re-fit after lead when the fight is stretching the frame.
    let tx = this.targetX + this.leadX;
    let ty = this.targetY + this.leadY;
    if (subjects.length > 0 && env.tension > 0.15) {
      const halfW2 = this.cam.width / 2 / Math.max(0.01, this.envelopeZoom);
      const halfH2 = this.cam.height / 2 / Math.max(0.01, this.envelopeZoom);
      const led = fitEnvelope(
        { x: tx, y: ty },
        self,
        subjects,
        halfW2,
        halfH2,
        ENVELOPE_MARGIN_FRAC,
      );
      const blend = 0.38 + 0.3 * led.tension;
      tx = tx + (led.x - tx) * blend;
      ty = ty + (led.y - ty) * blend;
    }

    // Deadzone always (mid slack) — kills micro stick-slip without feeling floaty.
    const dz = this.cam.width * ActionCamera.DEADZONE_FRAC;
    const effTx = this.cx + ActionCamera.deadzoned(tx - this.cx, dz);
    const effTy = this.cy + ActionCamera.deadzoned(ty - this.cy, dz);
    const followK = ActionCamera.FOLLOW_K;
    const f = 1 - Math.exp(-followK * dt);
    this.cx += (effTx - this.cx) * f;
    this.cy += (effTy - this.cy) * f;

    // 8. Trauma shake (additive).
    this.trauma = Math.max(0, this.trauma - ActionCamera.TRAUMA_DECAY * dt);
    this.shakeTime += dt;
    const shake = this.trauma * this.trauma;
    const amp = ActionCamera.MAX_SHAKE_PX * shake;
    const ox = amp * ActionCamera.smoothNoise(this.shakeTime, 0);
    const oy = amp * ActionCamera.smoothNoise(this.shakeTime, 100);

    this.cam.centerOn(this.cx + ox, this.cy + oy);
  }

  private static deadzoned(delta: number, dz: number): number {
    const a = Math.abs(delta);
    return a <= dz ? 0 : Math.sign(delta) * (a - dz);
  }

  private static smoothNoise(t: number, seed: number): number {
    return (
      Math.sin(t * 13.7 + seed) * 0.6 +
      Math.sin(t * 29.3 + seed * 2.1) * 0.4
    );
  }
}
