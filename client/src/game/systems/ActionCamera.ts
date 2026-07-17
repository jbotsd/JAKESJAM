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
import { SecondOrderDynamics1D, SecondOrderDynamics2D } from "./secondOrderDynamics.js";

/** Per-frame inputs the camera frames around. `extra` are opponents the
 *  frame should envelope when in range. `yBias` shifts centre down (portrait).
 *  `hype` (0-1, default 0) is the CameraHype accumulator — sustained "circle
 *  the mouse" dance / action over ~20s; drives the orbital "pop and lock"
 *  camera motion at the top end (see ORBIT_* below). Absent/0 = completely
 *  inert, so scenes that don't wire it up (Tutorial, practice) are unaffected.
 *  `peak`/`beatPulse` drive the beat-cut cinematic (see BEAT_CUT_* below) —
 *  `peak` is CameraHype.isPeak()'s hysteresis-gated flag (gates the whole
 *  effect), `beatPulse` is the live music transient (SonicField.beat via
 *  getMusicLevel()) the cut timing is detected from. Both absent = inert. */
export interface CameraFocus {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  extra?: ReadonlyArray<{ x: number; y: number }>;
  yBias?: number;
  hype?: number;
  peak?: boolean;
  beatPulse?: number;
}

/**
 * ActionCamera — smooth hand-driven follow.
 *
 * Pipeline (each step is continuous — no hard snaps mid-fight):
 *  1. Sticky envelope subjects (hysteresis) so nearest-foe thrash can't yank frame
 *  2. EMA on subject positions (physics jitter ≠ camera jitter)
 *  3. Soft centroid + soft envelope pull (not hard min/max clamp)
 *  4. EMA on the framing target itself
 *  5. Look-ahead (eased; reduced under envelope tension)
 *  6. Deadzone only when solo; multi-subject disables it (deadzone+constraint = stutter)
 *  7. Second-order spring follow on centre (position AND velocity — see
 *     secondOrderDynamics.ts; replaces plain exponential decay so a fast
 *     target can be correctly led, not just chased)
 *  8. Trauma shake additive
 *  9. Zoom pull-out via the same second-order spring, deadband, asymmetric
 *     tuning (faster out, slower in) via live setParams — not two different
 *     smoothing models, one model retuned per direction
 */
export class ActionCamera {
  private readonly cam: Phaser.Cameras.Scene2D.Camera;

  /** Camera centre — was two plain numbers eased by exponential decay;
   *  now a second-order spring so it can lead a moving focus point instead
   *  of only ever lagging behind it (see secondOrderDynamics.ts). */
  private readonly position: SecondOrderDynamics2D;
  private leadX = 0;
  private leadY = 0;
  private trauma = 0;
  private shakeTime = 0;
  /** Orbit clock for the hype-driven "pop and lock" camera motion — a
   *  continuous phase accumulator (not reset by hype dropping to 0) so the
   *  orbit always resumes smoothly from wherever it was, the same reason
   *  shakeTime never resets either. */
  private orbitTime = 0;
  private ready = false;
  private baseZoom = 1;
  /** Envelope zoom — was a plain number eased by asymmetric exponential
   *  decay (ZOOM_OUT_K/ZOOM_IN_K); now one second-order spring retuned per
   *  direction each frame via setParams (position/velocity carry through
   *  the retune, so no discontinuity — see setParams' doc). r stays 0 here
   *  (no overshoot on ordinary envelope framing); the dedicated punch-zoom
   *  path is a separate spring that DOES use r>0 for real punch character. */
  private readonly zoom: SecondOrderDynamics1D;
  /** Punch-zoom offset spring — ADDITIVE on top of this.zoom.value, not a
   *  replacement. r>0 gives genuine overshoot/punch character (see
   *  secondOrderDynamics.ts) instead of Phaser's own zoomTo ease curves,
   *  so the zoom punch and the lock-on position bias below share one
   *  consistent spring model rather than two unrelated tween systems. */
  private readonly punchZoomOffset: SecondOrderDynamics1D;
  private punchZoomGoal = 0;
  /** Lock-on position bias — additive world-space offset pulling the frame
   *  toward a specific point of impact (e.g. the victim on a kill) for the
   *  punch's duration, then releasing back to 0 so ordinary envelope framing
   *  resumes. World-space delta, not an absolute point, so it composes with
   *  whatever the envelope/lead pipeline already wants. */
  private readonly punchLockOffset: SecondOrderDynamics2D;
  private punchLockGoalX = 0;
  private punchLockGoalY = 0;
  /** Side-swipe (whip pan) offset — additive world-space bias, same shape
   *  as punchLockOffset but independent of it (a swipe doesn't imply a zoom
   *  punch, and vice versa). A real Phaser tween (cam.pan/zoomTo) would
   *  fight this class's own per-frame centerOn() call every frame — see
   *  sideSwipe()'s docstring — so this is a spring, not a tween, even
   *  though the caller-facing feel is "fast tween". */
  private readonly swipeOffset: SecondOrderDynamics2D;
  private swipeGoalX = 0;
  private swipeGoalY = 0;
  /** Beat-cut cinematic (peak-hype only) — Jake, 2026-07-15: "those cameras
   *  ... every beat for 8 beats in 16 should be camera cuts, each one a beat
   *  long." Deliberately NOT a spring: a real edit cut holds a composition
   *  perfectly still, then jumps — easing it would just be a fast swipe with
   *  extra steps. `beatCutOffsetX/Y`/`beatCutZoomMul` are held constant
   *  between beat detections and applied as a raw additive/multiplicative
   *  layer on top of the ordinary (still-running) camera pipeline, so the
   *  instant the cut run ends the underlying smooth camera is revealed
   *  exactly where it already was — no snap-back needed. */
  private beatCutArmed = true;
  private beatCutBeatIndex = 0;
  private beatCutActive = false;
  private beatCutOffsetX = 0;
  private beatCutOffsetY = 0;
  private beatCutZoomMul = 1;
  private wasPeak = false;
  /** AI-lock super zoom (peak-hype only) — Jake, 2026-07-15: "don't roll the
   *  camera, come up with a new one, do that AI-assisted super zoom lock-on
   *  too... like the tiktok thing." Replaces the roll as the peak identity:
   *  a real spring (not a hard cut, unlike beat-cut above) so it reads as a
   *  camera "acquiring and holding" a subject rather than an edit — but with
   *  real overshoot (AI_LOCK_R/AI_ZOOM_R) for the snap-into-lock punch that
   *  trend is known for, not a smooth documentary pan. Re-derives its target
   *  every frame (not captured once like punchZoom's lock-on) because this
   *  is a SUSTAINED tracking shot, not a one-off reaction to a single event. */
  private readonly aiLockOffset: SecondOrderDynamics2D;
  private readonly aiZoomMul: SecondOrderDynamics1D;
  /** True for a brief hold after a super-close-up trigger (peak entry, and
   *  once per 16-beat cycle — see triggerSuperCloseUp()) — Jake, 2026-07-15:
   *  "don't be afraid to do one or two super close ups." Distinct from the
   *  sustained AI_ZOOM_BOOST lock level so most of a peak run reads as a
   *  controlled tracking shot with occasional, deliberate punches to
   *  genuinely tight framing, not a permanently maxed-out zoom. */
  private aiSuperZoomActive = false;

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
  //
  // FOLLOW_K/ZOOM_OUT_K/ZOOM_IN_K below are kept as the ORIGINAL exponential
  // rate constants for reference (this is the tuning history — halving one
  // meant doubling the felt lag, a fact worth keeping legible) and converted
  // to second-order frequency (f = k / 2π) at point of use: an exponential
  // decay's time-to-63% is τ=1/k, and a critically-damped (z=1) second-order
  // system's analogous characteristic time is 1/(2πf) — matching f=k/2π
  // keeps the SAME settle pace while gaining velocity-aware following (can
  // lead a moving target) and overshoot as a real dial (r) instead of no
  // capability at all.
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
  /** Hype-driven orbit ("pop and lock" camera motion, TikTok/HUMBLE.-style
   *  reference): radius and revolution speed both scale with hype (0-1),
   *  gently near 0 (hype^2 keeps low hype essentially inert rather than a
   *  constant idle wobble) up to a real, deliberate circular sweep at peak.
   *  Flattened on Y (ORBIT_Y_SCALE) matching the shake offset's own
   *  convention — this is a 2D side-view arena, not a top-down one. */
  private static readonly ORBIT_MAX_PX = 46;
  private static readonly ORBIT_MAX_REVS_PER_SEC = 0.35;
  private static readonly ORBIT_Y_SCALE = 0.55;
  /** AI-lock super zoom — the TikTok "auto zoom" trend: a snappy push-in
   *  that visibly SNAPS onto the subject (real overshoot, r>0) rather than
   *  a smooth documentary pan, then holds tight while the subject moves.
   *  AI_ZOOM_BOOST is the extra zoom multiplier on top of ordinary envelope
   *  framing at full lock (e.g. 0.24 = 24% tighter). No opponent in range
   *  (solo/practice) locks onto the local player's own position instead —
   *  see the lockTargetX/Y comment in update() for why NOT the aim point. */
  private static readonly AI_LOCK_F = 2.4;
  private static readonly AI_LOCK_Z = 0.72;
  private static readonly AI_LOCK_R = 1.6;
  private static readonly AI_ZOOM_F = 1.7;
  private static readonly AI_ZOOM_Z = 0.7;
  private static readonly AI_ZOOM_R = 1.5;
  private static readonly AI_ZOOM_BOOST = 0.24;
  /** Occasional super-close-up punch on top of the sustained lock — a much
   *  bigger, brief push (nearly 2x) rather than the constant moderate
   *  AI_ZOOM_BOOST, so it reads as a deliberate "punch in" moment. */
  private static readonly AI_SUPER_ZOOM_BOOST = 0.95;
  private static readonly AI_SUPER_ZOOM_HOLD_MS = 550;
  /** Beat-cut detector hysteresis on focus.beatPulse (SonicField.beat, a
   *  0-1 bass-transient spike) — rise/fall gap so one physical hit can't
   *  double-count as two beats while it's decaying. Same shape as
   *  CameraHype's SUSTAIN_GATE/EXIT_THRESHOLD for the identical reason. */
  private static readonly BEAT_CUT_RISE = 0.55;
  private static readonly BEAT_CUT_FALL = 0.25;
  /** Four tasteful, modest compositions cycled through during the "on" 8
   *  beats — genuinely different framings (not random) so cuts read as
   *  deliberate edit choices. Small enough to stay inside the on-screen
   *  guarantee margin even though applied after that clamp (same tier as
   *  the orbit/shake offsets already are). */
  private static readonly BEAT_CUT_PRESETS: ReadonlyArray<{
    dx: number;
    dy: number;
    zoom: number;
  }> = [
    { dx: 0, dy: 0, zoom: 1.14 },
    { dx: 46, dy: -18, zoom: 1.08 },
    { dx: -46, dy: -18, zoom: 1.08 },
    { dx: 0, dy: 22, zoom: 1.2 },
  ];
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
  /** Critically damped (no overshoot) — matches the old exponential decay's
   *  character for ordinary framing. The dedicated punch-zoom spring uses
   *  its own z/r for real punch/overshoot; this one stays "invisible." */
  private static readonly POSITION_F = ActionCamera.FOLLOW_K / (2 * Math.PI);
  private static readonly ZOOM_OUT_F = ActionCamera.ZOOM_OUT_K / (2 * Math.PI);
  private static readonly ZOOM_IN_F = ActionCamera.ZOOM_IN_K / (2 * Math.PI);
  private static readonly NO_OVERSHOOT_Z = 1;
  private static readonly NO_OVERSHOOT_R = 0;
  /** Punch-zoom/lock-on character — real overshoot (r>0), matching the
   *  TikTok "punch zoom" reference: fast push-in, brief overshoot past the
   *  landing value, settles clean. f is high (snappy) since a punch that
   *  took as long as ordinary envelope framing wouldn't read as a punch. */
  private static readonly PUNCH_F = 9;
  private static readonly PUNCH_Z = 0.62;
  private static readonly PUNCH_R = 2.2;
  /** Side-swipe character — snappier out AND back than a punch (Jake,
   *  2026-07-15: "make it instantly near instant back to gameplay"). Higher
   *  f than PUNCH_F for a genuinely fast whip; z<1 with a smaller r still
   *  gives it a bit of whip-overshoot without lingering. */
  private static readonly SWIPE_OUT_F = 14;
  private static readonly SWIPE_BACK_F = 40;
  private static readonly SWIPE_Z = 0.75;
  private static readonly SWIPE_R = 1.4;

  constructor(cam: Phaser.Cameras.Scene2D.Camera) {
    this.cam = cam;
    this.baseZoom = cam.zoom;
    this.position = new SecondOrderDynamics2D(
      ActionCamera.POSITION_F,
      ActionCamera.NO_OVERSHOOT_Z,
      ActionCamera.NO_OVERSHOOT_R,
      0,
      0,
    );
    this.zoom = new SecondOrderDynamics1D(
      ActionCamera.ZOOM_OUT_F,
      ActionCamera.NO_OVERSHOOT_Z,
      ActionCamera.NO_OVERSHOOT_R,
      cam.zoom,
    );
    this.punchZoomOffset = new SecondOrderDynamics1D(
      ActionCamera.PUNCH_F,
      ActionCamera.PUNCH_Z,
      ActionCamera.PUNCH_R,
      0,
    );
    this.punchLockOffset = new SecondOrderDynamics2D(
      ActionCamera.PUNCH_F,
      ActionCamera.PUNCH_Z,
      ActionCamera.PUNCH_R,
      0,
      0,
    );
    this.swipeOffset = new SecondOrderDynamics2D(
      ActionCamera.SWIPE_OUT_F,
      ActionCamera.SWIPE_Z,
      ActionCamera.SWIPE_R,
      0,
      0,
    );
    this.aiLockOffset = new SecondOrderDynamics2D(
      ActionCamera.AI_LOCK_F,
      ActionCamera.AI_LOCK_Z,
      ActionCamera.AI_LOCK_R,
      0,
      0,
    );
    this.aiZoomMul = new SecondOrderDynamics1D(
      ActionCamera.AI_ZOOM_F,
      ActionCamera.AI_ZOOM_Z,
      ActionCamera.AI_ZOOM_R,
      1,
    );
  }

  setBaseZoom(zoom: number): void {
    // No instant cam.setZoom() here — update()'s per-frame zoom spring
    // (this.zoom, same second-order path the envelope-fit zoom already
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
    this.position.reset(x, y);
    this.leadX = 0;
    this.leadY = 0;
    this.ready = true;
    this.targetX = x;
    this.targetY = y;
    this.targetReady = true;
    this.stickySubjects = [];
    this.smoothedSubjects = [];
    this.zoom.reset(this.baseZoom);
    // A teleport (respawn/round start) mid-punch should just cancel the
    // punch rather than let a stale lock-on offset aim at wherever the old
    // victim was relative to the NEW position.
    this.punchZoomOffset.reset(0);
    this.punchZoomGoal = 0;
    this.punchLockOffset.reset(0, 0);
    this.punchLockGoalX = 0;
    this.punchLockGoalY = 0;
    this.swipeOffset.reset(0, 0);
    this.swipeGoalX = 0;
    this.swipeGoalY = 0;
    // A respawn/round-start shouldn't hand off a mid-cut or mid-lock world
    // to the new spawn point — all of it resets clean along with everything
    // else on a real teleport.
    this.beatCutArmed = true;
    this.beatCutBeatIndex = 0;
    this.beatCutActive = false;
    this.beatCutOffsetX = 0;
    this.beatCutOffsetY = 0;
    this.beatCutZoomMul = 1;
    this.aiLockOffset.reset(0, 0);
    this.aiZoomMul.reset(1);
    this.aiSuperZoomActive = false;
    this.wasPeak = false;
    this.cam.setRotation(0);
    this.cam.setZoom(this.baseZoom);
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

  /**
   * RARE zoom-punch only (a kill) — never for frequent movement (see
   * CameraJuice). `lockOnX/Y`, when given, is the actual point of impact
   * (e.g. the victim's position, not the local player's own centroid) —
   * the frame briefly biases toward it, TikTok-punch-zoom style: fast
   * push-in with real overshoot (see PUNCH_F/Z/R), landing clean, then
   * releasing back to ordinary envelope framing. Previously this only
   * tweened zoom via Phaser's own zoomTo and never touched framing at all,
   * so a kill anywhere off-centre still zoomed in on empty space near the
   * local player rather than the actual moment.
   *
   * Both offsets are ADDITIVE springs blended into the ordinary pipeline in
   * update() — not a second competing system fighting Phaser's cam.zoom
   * directly the way the old zoomTo-tween version did.
   */
  punchZoom(scaleDelta: number, outMs = 70, backMs = 200, lockOnX?: number, lockOnY?: number): void {
    // Snappier out, gentler settle-back — matches the old outMs<backMs
    // asymmetry (70ms out, 200ms back) as a frequency ratio instead of two
    // separate Phaser tween durations.
    const outF = ActionCamera.PUNCH_F * (200 / Math.max(1, outMs));
    const inF = ActionCamera.PUNCH_F * (200 / Math.max(1, backMs));
    this.punchZoomOffset.setParams(outF, ActionCamera.PUNCH_Z, ActionCamera.PUNCH_R);
    this.punchZoomGoal = scaleDelta;
    if (lockOnX !== undefined && lockOnY !== undefined) {
      // Jake, 2026-07-15 (live playtest, ~12-19s): "camera pops in and out"
      // during a fast run of kills. Root cause was a `.reset(0, 0)` here —
      // a hard teleport that zeroed BOTH position and velocity every single
      // punchZoom call, even when the previous punch's offset hadn't
      // settled yet. Back-to-back kills snapped the framing to dead-center
      // and relaunched from scratch each time, reading as a jarring pop.
      // setParams() below already retargets this spring continuously
      // without a discontinuity (see its own doc comment) — no reset needed,
      // the spring just carries its current position/velocity toward the
      // new lock goal.
      this.punchLockOffset.setParams(outF, ActionCamera.PUNCH_Z, ActionCamera.PUNCH_R);
      // World-space delta toward the impact point, computed once at
      // trigger time — the punch is brief enough (a few hundred ms) that
      // re-deriving it every frame against a drifting envelope target would
      // add complexity for no visible benefit.
      this.punchLockGoalX = lockOnX - this.position.x;
      this.punchLockGoalY = lockOnY - this.position.y;
    } else {
      this.punchLockGoalX = 0;
      this.punchLockGoalY = 0;
    }
    this.cam.scene.time.delayedCall(outMs, () => {
      this.punchZoomOffset.setParams(inF, ActionCamera.PUNCH_Z, ActionCamera.NO_OVERSHOOT_R);
      this.punchLockOffset.setParams(inF, ActionCamera.PUNCH_Z, ActionCamera.NO_OVERSHOOT_R);
      this.punchZoomGoal = 0;
      this.punchLockGoalX = 0;
      this.punchLockGoalY = 0;
    });
  }

  /**
   * Side-swipe (whip pan) — a fast lateral whip of the frame in a screen
   * direction, settling back immediately. TikTok whip-pan reference: fast
   * whip, brief overshoot, clean land. `dxWorld/dyWorld` is the whip's
   * world-space displacement (e.g. ±halfViewWidth in the swipe direction),
   * NOT an absolute point — same "additive spring, not a raw tween" reason
   * punchZoom's lock-on works this way: a real Phaser cam.pan() tween would
   * get overwritten every frame by this class's own centerOn() call in
   * update(), same conflict the old zoomTo-tween punch used to have with
   * the envelope zoom (see setBaseZoom's history). Snappier back than out
   * by default (backMs < outMs) — a swipe should return control fast.
   */
  sideSwipe(dxWorld: number, dyWorld: number, outMs = 90, backMs = 60): void {
    const outF = ActionCamera.SWIPE_OUT_F * (90 / Math.max(1, outMs));
    const backF = ActionCamera.SWIPE_BACK_F * (60 / Math.max(1, backMs));
    this.swipeOffset.setParams(outF, ActionCamera.SWIPE_Z, ActionCamera.SWIPE_R);
    this.swipeGoalX = dxWorld;
    this.swipeGoalY = dyWorld;
    this.cam.scene.time.delayedCall(outMs, () => {
      this.swipeOffset.setParams(backF, ActionCamera.SWIPE_Z, ActionCamera.NO_OVERSHOOT_R);
      this.swipeGoalX = 0;
      this.swipeGoalY = 0;
    });
  }

  /** Bump the AI-lock zoom to a genuinely tight super-close-up for a brief
   *  hold, then relax back to the ordinary sustained lock level (see
   *  aiSuperZoomActive's doc). Called from update() at peak entry and once
   *  per 16-beat cycle — not caller-facing, peak-hype-only. */
  private triggerSuperCloseUp(): void {
    this.aiSuperZoomActive = true;
    this.cam.scene.time.delayedCall(ActionCamera.AI_SUPER_ZOOM_HOLD_MS, () => {
      this.aiSuperZoomActive = false;
    });
  }

  /** Test-only: the beat-cut cinematic's own state, isolated from the
   *  AI-lock zoom that's ALSO active throughout peak (see update()'s step
   *  10) — black-box cam state (scrollX/zoom) alone can no longer
   *  distinguish "cutting" from "just locked-on" the way it could when
   *  beat-cut was the only peak effect, so tests that need beat-cut's exact
   *  hold-then-jump behavior read it directly here instead. */
  debugBeatCutState(): {
    active: boolean;
    offsetX: number;
    offsetY: number;
    zoomMul: number;
  } {
    return {
      active: this.beatCutActive,
      offsetX: this.beatCutOffsetX,
      offsetY: this.beatCutOffsetY,
      zoomMul: this.beatCutZoomMul,
    };
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
      // follow (this.position spring toward the target) handle it instead means
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
    const z = Math.max(0.01, this.zoom.value);
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
    goalZoom = smoothZoomGoal(this.zoom.value, goalZoom, this.baseZoom);
    const zoomingOut = goalZoom < this.zoom.value - 0.001;
    // Same spring, retuned per direction each frame (position/velocity carry
    // through — see setParams) rather than two different smoothing models.
    this.zoom.setParams(
      zoomingOut ? ActionCamera.ZOOM_OUT_F : ActionCamera.ZOOM_IN_F,
      ActionCamera.NO_OVERSHOOT_Z,
      ActionCamera.NO_OVERSHOOT_R,
    );
    this.zoom.update(dt, goalZoom);
    // Punch-zoom offset — additive on top of the envelope zoom, one unified
    // per-frame write instead of a second system (Phaser's own zoomTo tween,
    // previously) fighting over cam.zoom. Runs unconditionally: its goal
    // sits at 0 and the spring naturally rests there when no punch is in
    // flight, so there's no flag needed to gate it.
    this.punchZoomOffset.update(dt, this.punchZoomGoal);
    // Quantize the base envelope zoom to avoid subpixel drift feeding back
    // into its own spring state; the punch offset rides on top of that
    // quantized base for the actual write.
    const zq = Math.round(this.zoom.value * 1000) / 1000;
    this.zoom.correctValue(zq);
    const appliedZoom = Math.round((zq + this.punchZoomOffset.value) * 1000) / 1000;
    if (Math.abs(appliedZoom - this.cam.zoom) > 0.0005) this.cam.setZoom(appliedZoom);

    // 5. Look-ahead — mid: quieter in fights, not muted.
    const halfWLead = this.cam.width / 2 / Math.max(0.01, this.zoom.value);
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

    // Punch lock-on offset — additive world-space bias toward an actual
    // point of impact (see punchZoom's lockOnX/Y). Same "runs every frame,
    // goal rests at 0 when idle" shape as the zoom offset above.
    this.punchLockOffset.update(dt, this.punchLockGoalX, this.punchLockGoalY);
    // Side-swipe offset is updated here but applied POST-position-spring
    // (see step 8.5 below), deliberately NOT blended into tx/ty like the
    // punch lock-on above: feeding it pre-spring means its recovery speed
    // is bottlenecked by this.position's own (much slower, intentionally-so
    // for ordinary framing) settle rate — exactly the "near instant back to
    // gameplay" ask failing in practice even with a fast swipeOffset spring.
    // Applied after, its own spring's settle time is the only thing gating
    // how fast it returns.
    this.swipeOffset.update(dt, this.swipeGoalX, this.swipeGoalY);

    // Soft re-fit after lead when the fight is stretching the frame.
    let tx = this.targetX + this.leadX + this.punchLockOffset.x;
    let ty = this.targetY + this.leadY + this.punchLockOffset.y;
    if (subjects.length > 0 && env.tension > 0.15) {
      const halfW2 = this.cam.width / 2 / Math.max(0.01, this.zoom.value);
      const halfH2 = this.cam.height / 2 / Math.max(0.01, this.zoom.value);
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
    const effTx = this.position.x + ActionCamera.deadzoned(tx - this.position.x, dz);
    const effTy = this.position.y + ActionCamera.deadzoned(ty - this.position.y, dz);
    // 7. Second-order spring follow — was plain exponential decay; the spring
    // carries real velocity, so it correctly LEADS a target that's itself
    // moving (envelope target drifting with a fleeing duel partner) instead
    // of only ever lagging behind it.
    this.position.update(dt, effTx, effTy);

    // 7.5 HARD GUARANTEE: the local player NEVER leaves the screen.
    // Envelope pull toward a distant duel partner, look-ahead, punch lock-on,
    // spring lag, and trauma shake are all suggestions — this clamp is the
    // authority (a lock-on toward a distant victim gets dampened rather than
    // ever pushing the local player off-screen). Asymmetric on portrait
    // mobile: the bottom control band owns the lower ~35% of the screen, so
    // the player is kept in the touch-visible zone.
    {
      // cam.zoom is always kept in sync (envelope + punch offset, unified
      // one write above) — no more branching on whether a separate tween
      // system might be driving it instead.
      const zNow = Math.max(0.01, this.cam.zoom);
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
      const clampedCx = Math.min(maxCx, Math.max(minCx, this.position.x));
      const clampedCy = Math.min(maxCy, Math.max(minCy, this.position.y));
      // correctValue, not reset: preserves the spring's velocity so next
      // frame doesn't mistake the clamp for a fresh lag to close.
      this.position.correctValue(clampedCx, clampedCy);
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

    // 9. Hype orbit ("pop and lock") — additive, same guarantee-clamped
    // centre as everything else. hype^2 keeps low/no hype inert (no idle
    // wobble) and only becomes a real deliberate sweep near peak; revolution
    // speed also climbs with hype so the peak state doesn't just get a wider
    // circle, it gets a livelier one.
    // Plain Math.min/max, not Phaser.Math.Clamp — the latter's import chain
    // pulls in Phaser's device-detection module (assumes a browser `window`
    // global), which breaks headless unit tests the instant update() runs.
    const hype = Math.min(1, Math.max(0, focus.hype ?? 0));
    const hypeShaped = hype * hype;
    this.orbitTime += dt * (0.15 + hypeShaped * ActionCamera.ORBIT_MAX_REVS_PER_SEC);
    const orbitR = ActionCamera.ORBIT_MAX_PX * hypeShaped;
    const orbitAngle = this.orbitTime * 2 * Math.PI;
    const orbitX = Math.cos(orbitAngle) * orbitR;
    const orbitY = Math.sin(orbitAngle) * orbitR * ActionCamera.ORBIT_Y_SCALE;

    // 9.5 Beat-cut cinematic — a strict 8-beats-on / 8-beats-off, 16-beat
    // cycle where "on" beats are genuine hard EDIT CUTS, not sprung motion:
    // each held for exactly one detected beat (until the next rising edge),
    // then jump to the next preset. Jake, 2026-07-15: "those cameras... every
    // beat for 8 beats in 16 should be camera cuts, each one a beat long."
    // Peak entry resets the cycle to beat 0 so the cut run always lands
    // right at the drop, never mid-pattern. Orbit is suppressed while
    // actively cutting (a held composition shouldn't visibly drift under
    // the cut), but its phase clock keeps ticking so it resumes exactly
    // where it would have been the instant the cut run ends — same
    // "underlying pipeline never stops, only the additive layer changes"
    // shape as everything else in this method.
    const peak = focus.peak ?? false;
    if (peak && !this.wasPeak) {
      this.beatCutBeatIndex = 0;
      this.beatCutArmed = true;
      // Peak entry is also the first of the "one or two super close ups"
      // (see triggerSuperCloseUp) — land it right at the drop, same moment
      // the beat-cut cycle resets.
      this.triggerSuperCloseUp();
    }
    if (!peak) {
      this.beatCutActive = false;
      this.beatCutOffsetX = 0;
      this.beatCutOffsetY = 0;
      this.beatCutZoomMul = 1;
    } else {
      const beatPulse = Math.min(1, Math.max(0, focus.beatPulse ?? 0));
      if (this.beatCutArmed && beatPulse >= ActionCamera.BEAT_CUT_RISE) {
        this.beatCutArmed = false;
        this.beatCutActive = this.beatCutBeatIndex < 8;
        // Second close-up: the moment the cut run ends each cycle (cuts
        // stop, camera punches in tight and holds) — a deliberate "and now
        // hold" beat rather than a random mid-cut interruption.
        if (this.beatCutBeatIndex === 8) this.triggerSuperCloseUp();
        if (this.beatCutActive) {
          const preset =
            ActionCamera.BEAT_CUT_PRESETS[
              this.beatCutBeatIndex % ActionCamera.BEAT_CUT_PRESETS.length
            ]!;
          this.beatCutOffsetX = preset.dx;
          this.beatCutOffsetY = preset.dy;
          this.beatCutZoomMul = preset.zoom;
        } else {
          this.beatCutOffsetX = 0;
          this.beatCutOffsetY = 0;
          this.beatCutZoomMul = 1;
        }
        this.beatCutBeatIndex = (this.beatCutBeatIndex + 1) % 16;
      } else if (!this.beatCutArmed && beatPulse <= ActionCamera.BEAT_CUT_FALL) {
        this.beatCutArmed = true;
      }
    }
    this.wasPeak = peak;

    // 10. AI-lock super zoom — Jake, 2026-07-15: "don't roll the camera,
    // come up with a new one, do that AI-assisted super zoom lock-on too...
    // like the tiktok thing." Replaces the roll as the peak identity: a
    // sustained tracking push-in (real spring, real overshoot for the
    // snap-into-lock character) toward the nearest live opponent, or — solo
    // practice/no opponent in range — the LOCAL PLAYER'S OWN POSITION.
    // Jake, 2026-07-15 (live playtest, "unshippably nauseating"): the first
    // version locked onto a point projected out along the aim direction
    // instead — with no opponent to anchor it, ordinary mouse aiming while
    // standing still whipped a tight, zoomed-in frame around unpredictably
    // (aim direction changes far faster and more erratically than the
    // player actually moves). "i didnt mean zoom in on the mouse i mean the
    // character" — locking onto the character's own (slower, spring-damped)
    // position instead gives a genuinely stable tight shot. Re-derives its
    // target every frame (unlike punchZoom's one-shot capture) because this
    // is meant to keep tracking a moving subject for the whole peak, not
    // react to a single instant.
    let lockTargetX: number;
    let lockTargetY: number;
    if (extras.length > 0) {
      lockTargetX = extras[0]!.x;
      lockTargetY = extras[0]!.y;
    } else {
      lockTargetX = focus.x;
      lockTargetY = focus.y;
    }
    const aiGoalX = peak ? lockTargetX - this.position.x : 0;
    const aiGoalY = peak ? lockTargetY - this.position.y : 0;
    this.aiLockOffset.update(dt, aiGoalX, aiGoalY);
    const zoomGoal = !peak
      ? 1
      : this.aiSuperZoomActive
        ? 1 + ActionCamera.AI_SUPER_ZOOM_BOOST
        : 1 + ActionCamera.AI_ZOOM_BOOST;
    this.aiZoomMul.update(dt, zoomGoal);
    // How "locked in" the shot currently is (0-1), derived from the zoom
    // spring's own progress toward its sustained goal rather than a
    // separate activation spring — orbit fades out as the lock zoom
    // deepens so a circular sweep never fights a shot that's meant to hold
    // still on a subject.
    const lockBlend = Math.min(
      1,
      Math.max(0, (this.aiZoomMul.value - 1) / ActionCamera.AI_ZOOM_BOOST),
    );
    const combinedZoomMul = this.beatCutZoomMul * this.aiZoomMul.value;
    if (Math.abs(combinedZoomMul - 1) > 0.0005) {
      this.cam.setZoom(Math.round(this.cam.zoom * combinedZoomMul * 1000) / 1000);
    }
    const orbitXEff = this.beatCutActive ? 0 : orbitX * (1 - lockBlend);
    const orbitYEff = this.beatCutActive ? 0 : orbitY * (1 - lockBlend);

    // Side-swipe — applied POST the on-screen-guarantee clamp, same as
    // shake/orbit above, deliberately: a whip pan sweeping past/away from
    // the subject for a beat is the actual point of the effect (real
    // camera whip-pans do the same), and its OWN fast spring is what makes
    // "near instant back to gameplay" true rather than being bottlenecked
    // by this.position's slower follow rate (see swipeOffset.update above).
    this.cam.centerOn(
      this.position.x + ox + orbitXEff + this.swipeOffset.x + this.beatCutOffsetX + this.aiLockOffset.x,
      this.position.y + oy + orbitYEff + this.swipeOffset.y + this.beatCutOffsetY + this.aiLockOffset.y,
    );
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
