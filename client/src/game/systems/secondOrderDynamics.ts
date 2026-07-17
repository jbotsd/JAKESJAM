// Second-order dynamics — the mental-model replacement for ad-hoc exponential
// smoothing (`value += (target-value) * (1-e^(-k*dt))`, used throughout
// actionCameraMath.ts). Exponential smoothing can only decay monotonically
// toward a target: no velocity, no overshoot, no ability to lead a moving
// target. A real spring-damper models position AND velocity, so it can
// anticipate a moving target (correct "lock on" behavior) and produce genuine
// punch/overshoot character instead of hand-tuned duration constants.
//
// This is t3ssel8r's stable semi-implicit-Euler formulation ("Giving
// Personality to Procedural Animations using Math") of the same damped-spring
// model Ryan Juckett's "Damped Springs" describes for third-person camera
// follow (avoid discontinuities, never snap to a new velocity, frame-rate
// independent — https://www.ryanjuckett.com/damped-springs/). Widely ported;
// this file doesn't invent the math, just applies it.
//
// Parameters:
//   f — natural frequency (Hz). Higher = snappier response to a moving target.
//   z — damping ratio. 0 = undamped oscillation, 1 = critically damped
//       (fastest settle, no overshoot), >1 = overdamped (sluggish).
//   r — initial response / overshoot dial. 0 behaves like exponential
//       smoothing (no overshoot — a drop-in replacement when that's all you
//       want). >0 gives anticipatory overshoot (the "punch" feel a TikTok
//       zoom-in has). <0 eases in gently, then snaps at the end.

export class SecondOrderDynamics1D {
  private k1: number;
  private k2: number;
  private k3: number;
  private xPrev: number;
  private y: number;
  private yd: number;

  constructor(f: number, z: number, r: number, x0: number) {
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / ((2 * Math.PI * f) * (2 * Math.PI * f));
    this.k3 = (r * z) / (2 * Math.PI * f);
    this.xPrev = x0;
    this.y = x0;
    this.yd = 0;
  }

  /** Retune the spring constants in place — position AND velocity carry over
   *  continuously, so this is safe to call every frame (e.g. a directionally
   *  asymmetric spring: faster f zooming out, slower f zooming in) without
   *  the discontinuity swapping to a whole new instance would cause. */
  setParams(f: number, z: number, r: number): void {
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / ((2 * Math.PI * f) * (2 * Math.PI * f));
    this.k3 = (r * z) / (2 * Math.PI * f);
  }

  /** Snap to a new value with zero velocity (a real teleport/respawn — not a
   *  case to be sprung toward). */
  reset(x0: number): void {
    this.xPrev = x0;
    this.y = x0;
    this.yd = 0;
  }

  /** Hard-correct the displayed value (e.g. a "never leave the screen" clamp)
   *  WITHOUT zeroing velocity, unlike reset(). The spring's momentum carries
   *  through the correction instead of the next frame re-discovering a
   *  "lag" against last frame's clamped output and springing to close a gap
   *  that was never real motion. */
  correctValue(x: number): void {
    this.y = x;
  }

  get value(): number {
    return this.y;
  }

  get velocity(): number {
    return this.yd;
  }

  /** Advance by dt seconds toward target x. Pass xd (the target's own
   *  velocity) when it's known analytically (e.g. a tracked point that has a
   *  real world-space velocity) for correct lead; otherwise it's estimated
   *  via backward difference, which is exact for a target that's itself
   *  moving at constant velocity and a reasonable approximation otherwise. */
  update(dt: number, x: number, xd?: number): number {
    if (dt <= 0) return this.y;
    const xVel = xd ?? (x - this.xPrev) / dt;
    this.xPrev = x;
    // Stability clamp: an implicit-Euler step of this system can diverge if
    // dt is large relative to k1/k2 (a frame-time spike, exactly the kind of
    // moment this whole investigation started with). Clamping k2 upward
    // trades a touch of extra damping for guaranteed stability rather than
    // sub-stepping — a slightly softer response under a frame spike beats a
    // NaN camera.
    const k2Stable = Math.max(this.k2, (dt * dt) / 2 + (dt * this.k1) / 2, dt * this.k1);
    this.y = this.y + dt * this.yd;
    this.yd = this.yd + (dt * (x + this.k3 * xVel - this.y - this.k1 * this.yd)) / k2Stable;
    return this.y;
  }
}

/** 2D convenience wrapper — two independent 1D systems sharing f/z/r. Point
 *  tracking (camera position, lock-on target) is the common case. */
export class SecondOrderDynamics2D {
  private readonly dx: SecondOrderDynamics1D;
  private readonly dy: SecondOrderDynamics1D;

  constructor(f: number, z: number, r: number, x0: number, y0: number) {
    this.dx = new SecondOrderDynamics1D(f, z, r, x0);
    this.dy = new SecondOrderDynamics1D(f, z, r, y0);
  }

  reset(x0: number, y0: number): void {
    this.dx.reset(x0);
    this.dy.reset(y0);
  }

  /** See SecondOrderDynamics1D.correctValue — hard-corrects position on both
   *  axes while preserving velocity (a screen-edge clamp, not a teleport). */
  correctValue(x0: number, y0: number): void {
    this.dx.correctValue(x0);
    this.dy.correctValue(y0);
  }

  /** See SecondOrderDynamics1D.setParams — retunes both axes in place. */
  setParams(f: number, z: number, r: number): void {
    this.dx.setParams(f, z, r);
    this.dy.setParams(f, z, r);
  }

  get x(): number {
    return this.dx.value;
  }

  get y(): number {
    return this.dy.value;
  }

  update(dt: number, x: number, y: number, xd?: number, yd?: number): { x: number; y: number } {
    return { x: this.dx.update(dt, x, xd), y: this.dy.update(dt, y, yd) };
  }
}
