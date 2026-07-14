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
import { isPortraitMobile } from "../input/mobile.js";

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
  /** On-screen guarantee margins (fraction of half-view kept clear between
   *  the player and the screen edge). */
  private static readonly SAFE_MARGIN_FRAC = 0.16;
  /** Portrait phones: the bottom control band owns the lower screen — keep
   *  the player well above it (fraction of half-view as bottom margin). */
  private static readonly SAFE_BOTTOM_PORTRAIT_FRAC = 0.7;
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
    // No instant cam.setZoom() here — update()'s per-frame envelopeZoom
    // easing (same ZOOM_OUT_K/ZOOM_IN_K path the envelope-fit zoom already
    // uses) carries the camera to the new base smoothly. This used to
    // hard-snap envelopeZoom and apply it same-frame whenever the new zoom
    // was smaller, which fires on every renderGovernor-triggered resize
    // (frame-time pressure → renderScale steps down → applyMobileCamera
    // recomputes zoom → this ran mid-match with zero tween) — precisely
    // when the game was already stuttering, the camera would also lock to
    // a different resolution with no easing. See renderGovernor.ts.
    this.baseZoom = zoom;
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
    // Telemetry 2026-07-12 (sigs qobqem/5jtz75, builds OghnpP0u/DeF5OTQp):
    // snap() called from resetPlayer() during scene create() can land
    // before Phaser's Camera has finished its own first internal update —
    // centerOn → centerOnX → clampX then dereferences a null bounds/target
    // Phaser hasn't initialized yet. Rare boot-order race, not a hot path,
    // so a defensive try/catch is the right tool: it can't mask a REAL bug
    // (any subsequent per-frame camera update self-corrects the position).
    try {
      this.cam.centerOn(x, y);
    } catch {
      // Fall back to setting scroll directly — this doesn't touch whatever
      // internal state clampX choked on, so it can't hit the same null.
      this.cam.scrollX = x - this.cam.width / 2;
      this.cam.scrollY = y - this.cam.height / 2;
    }
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
      // Nothing on screen yet (first frame of the match) — the only
      // legitimate hard cut left. Every other position change, however
      // large, flows through the normal continuous-follow pipeline below
      // (converges in ~150-250ms at FOLLOW_K) rather than a snap.
      //
      // Jake, 2026-07-15: a prior version hard-cut (or fade-hid) the camera
      // whenever the local player moved further than SNAP_DIST in one tick
      // — which fired on nearly every respawn, since assignSpawnPoints
      // deliberately max-spreads spawn points across the whole map (to kill
      // spawn-camping) and every live map (1280-2600px wide) routinely
      // exceeds that in a single tick. Both the bare hard-cut ("swap to a
      // different camera") and a fade-covered version of it ("the cut is
      // likely worse") read as a disruptive event on a frame that's
      // supposed to be an ordinary respawn. Letting the existing eased
      // follow (this.cx/cy lerp toward the target) handle it instead means
      // there's no special-cased transition to notice at all — just a fast
      // continuous re-frame, the same mechanism already used for normal
      // play.
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

    // 7.5 HARD GUARANTEE: the local player NEVER leaves the screen.
    // Envelope pull toward a distant duel partner, look-ahead, EMA lag and
    // trauma shake are all suggestions — this clamp is the authority.
    // Asymmetric on portrait mobile: the bottom control band owns the lower
    // ~35% of the screen, so the player is kept in the touch-visible zone.
    {
      const zNow = Math.max(0.01, this.punchActive ? this.cam.zoom : this.envelopeZoom);
      const hw = this.cam.width / 2 / zNow;
      const hh = this.cam.height / 2 / zNow;
      const portrait = isPortraitMobile();
      const mx = hw * ActionCamera.SAFE_MARGIN_FRAC;
      const mTop = hh * ActionCamera.SAFE_MARGIN_FRAC;
      const mBottom = hh * (portrait ? ActionCamera.SAFE_BOTTOM_PORTRAIT_FRAC : ActionCamera.SAFE_MARGIN_FRAC);
      // Feasible center range keeping self inside [edge+margin] on each axis.
      const minCx = self.x - hw + mx;
      const maxCx = self.x + hw - mx;
      const minCy = self.y - hh + mBottom;
      const maxCy = self.y + hh - mTop;
      this.cx = Math.min(maxCx, Math.max(minCx, this.cx));
      this.cy = Math.min(maxCy, Math.max(minCy, this.cy));
    }

    // 8. Trauma shake (additive) — kept inside the same guarantee: the
    // shake amplitude is small, but clamping the FINAL center means even a
    // max-trauma frame can't push the player out.
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
