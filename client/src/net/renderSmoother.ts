// Local-player render smoothing.
//
// After a reconcile rewinds + replays, the freshly predicted local-player
// position can differ from the position the user was just looking at by a
// few pixels (float drift) or a lot (real correction, e.g. server rejected
// a chaos card pickup the client predicted). Snapping the rendered character
// to the new position on every snapshot tick is visible and ugly. Instead
// we set an initial "render offset" equal to (oldRendered - newPredicted),
// then exponentially decay it toward zero.
//
// The decay rate is BAND-DEPENDENT (Fiedler's pattern from
// gafferongames.com/post/state_synchronization/):
//   - small offsets decay slowly  → don't fight sub-pixel jitter
//   - large offsets decay quickly → visible drift catches up fast
// Single-rate decay either makes small drifts kick the rig (rate too fast)
// OR makes large corrections rubber-band visibly (rate too slow). Bands
// give us both.
//
// Sim correctness is unchanged — only the rendered position is smoothed.
// Big deltas above `snapThresholdPx` (teleport, respawn, forced sync) skip
// smoothing and snap.
//
// See `.claude/skills/prediction-error-smoothing/SKILL.md` for the
// project-agnostic recipe and source citations.

export type SmoothingOptions = {
  /** Offsets ≤ this magnitude (px) use `tauSmallMs`. Drifts that are mostly invisible — keep them invisible. */
  smallBandPx: number;
  /** Offsets > this magnitude (px) use `tauLargeMs`. Anything in between is mid-band. */
  largeBandPx: number;
  /** Time constant for the small band (ms). Larger = slower, smoother. */
  tauSmallMs: number;
  /** Time constant for the mid band (ms). Roughly Source `cl_smoothtime` territory. */
  tauMidMs: number;
  /** Time constant for the large band (ms). Smaller = faster catch-up. */
  tauLargeMs: number;
  /** Distance (px) above which we snap instead of smoothing — teleport / respawn / forced sync. */
  snapThresholdPx: number;
  /** Maximum correction (px) applied in any single render frame. Clamps overshoot when the renderer stalls. */
  maxCorrectionPxPerFrame: number;
};

// Defaults tuned for JAKESJAM's physics scale (BODY_HEIGHT=56px, max jump
// arc ~2x body height). Numbers are derived from Fiedler's 0.95/0.85
// per-frame factors at 60fps converted to time constants:
//   factor = exp(-frameMs / tau)  →  tau = -frameMs / ln(factor)
// Fiedler 0.95 ≈ τ=325ms (we use 150ms — JAKESJAM doesn't need to
// preserve sub-pixel inputs across a third of a second). Fiedler 0.85 ≈
// τ=102ms (we use 40ms — at 60Hz tick a 30px+ delta should resolve in
// under 100ms or it's a perceptible rubber-band).
//
// The previous single-rate (windowMs=200, snap=90) defaults were
// optimised for the worst case (high-RTT jitter) at the cost of mid-air
// feel. With per-band τ the sweet spot for both regimes is the same set
// of constants — no game-state coupling needed.
export const DEFAULT_SMOOTHING: SmoothingOptions = {
  smallBandPx: 6,
  largeBandPx: 30,
  tauSmallMs: 150,
  tauMidMs: 80,
  tauLargeMs: 40,
  snapThresholdPx: 90,
  maxCorrectionPxPerFrame: 16,
};

export type SmootherStats = {
  /** Distance between predicted and previously-rendered position at last reconcile, in px. */
  lastDeltaPx: number;
  /** Whether the last reconcile snapped instead of smoothing. */
  lastSnapped: boolean;
  /** Magnitude of the smoothing offset still in flight, in px. */
  currentOffsetPx: number;
};

export class RenderSmoother {
  private readonly opts: SmoothingOptions;
  private offsetX = 0;
  private offsetY = 0;
  private lastRenderAt = 0;
  private lastDeltaPx = 0;
  private lastSnapped = false;

  constructor(opts: Partial<SmoothingOptions> = {}) {
    this.opts = { ...DEFAULT_SMOOTHING, ...opts };
  }

  /** Current smoothing offset (rendered = predicted + offset). */
  offset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }

  hasOffset(): boolean {
    return this.offsetX !== 0 || this.offsetY !== 0;
  }

  /**
   * Apply a reconcile delta. `prevRenderedX/Y` is what the user was just
   * looking at; `newPredicted` is the freshly replayed position. Sets
   * the offset so that rendered position stays continuous, then it
   * decays via advance().
   */
  applyReconcile(
    prevRenderedX: number | null,
    prevRenderedY: number | null,
    newPredictedX: number,
    newPredictedY: number,
  ): void {
    if (prevRenderedX === null || prevRenderedY === null) {
      this.offsetX = 0;
      this.offsetY = 0;
      this.lastDeltaPx = 0;
      this.lastSnapped = false;
      return;
    }
    const dx = prevRenderedX - newPredictedX;
    const dy = prevRenderedY - newPredictedY;
    const dist = Math.hypot(dx, dy);
    this.lastDeltaPx = dist;
    if (dist > this.opts.snapThresholdPx) {
      // Teleport / respawn / forced sync — snap.
      this.offsetX = 0;
      this.offsetY = 0;
      this.lastSnapped = true;
      return;
    }
    this.offsetX = dx;
    this.offsetY = dy;
    this.lastSnapped = false;
  }

  /**
   * Decay the offset toward zero. Call once per render frame from
   * getRenderState. Exponential per-band, with a per-frame max-correction
   * clamp to prevent visible jumps when the renderer stalls (tab refocus,
   * GC pause).
   */
  advance(now: number): void {
    if (this.offsetX === 0 && this.offsetY === 0) {
      this.lastRenderAt = now;
      return;
    }
    const elapsed = this.lastRenderAt === 0 ? 0 : Math.max(0, now - this.lastRenderAt);
    this.lastRenderAt = now;
    if (elapsed === 0) return;

    // Pick τ from the band the current magnitude falls into. Re-evaluated
    // every frame so a large offset drops into the mid band as it shrinks,
    // then into the small band — fast catch-up early, smooth settle late.
    const mag = Math.hypot(this.offsetX, this.offsetY);
    const tau =
      mag <= this.opts.smallBandPx
        ? this.opts.tauSmallMs
        : mag >= this.opts.largeBandPx
          ? this.opts.tauLargeMs
          : this.opts.tauMidMs;

    // Exponential decay: offset *= exp(-elapsed/τ).
    // step = offset * (1 - exp(-elapsed/τ)) is the amount we "remove" this frame.
    const decayFactor = Math.exp(-elapsed / Math.max(1, tau));
    let stepX = this.offsetX * (1 - decayFactor);
    let stepY = this.offsetY * (1 - decayFactor);

    const stepMag = Math.hypot(stepX, stepY);
    const maxStep = this.opts.maxCorrectionPxPerFrame;
    if (stepMag > maxStep && stepMag > 0) {
      const k = maxStep / stepMag;
      stepX *= k;
      stepY *= k;
    }

    this.offsetX -= stepX;
    this.offsetY -= stepY;

    // Snap to zero once we're inside sub-pixel territory to avoid lingering
    // tiny offsets that pin getRenderState into the slow clone path.
    if (Math.abs(this.offsetX) < 0.05) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.05) this.offsetY = 0;
  }

  stats(): SmootherStats {
    return {
      lastDeltaPx: this.lastDeltaPx,
      lastSnapped: this.lastSnapped,
      currentOffsetPx: Math.hypot(this.offsetX, this.offsetY),
    };
  }
}
