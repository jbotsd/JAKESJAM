// Local-player render smoothing.
//
// After a reconcile rewinds + replays, the freshly predicted local-player
// position can differ from the position the user was just looking at by a
// few pixels (float drift). Snapping the rendered character to the new
// position on every snapshot tick is visible and ugly. Instead we set an
// initial "render offset" equal to (oldRendered - newPredicted), then
// linearly decay it to zero over `windowMs`.
//
// Sim correctness is unchanged — only the rendered position is smoothed.
// Big deltas (teleport, respawn, forced sync) skip smoothing and snap.
//
// Extracted from clientLoop.ts during Phase E3.

export type SmoothingOptions = {
  /** Window over which the residual offset decays to zero, in ms. */
  windowMs: number;
  /** Distance (px) above which we snap instead of smoothing — teleport / respawn / forced sync. */
  snapThresholdPx: number;
  /** Maximum correction (px) applied in any single render frame. Clamps overshoot when the renderer stalls. */
  maxCorrectionPxPerFrame: number;
};

export const DEFAULT_SMOOTHING: SmoothingOptions = {
  windowMs: 100,
  snapThresholdPx: 30,
  maxCorrectionPxPerFrame: 8,
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
   * getRenderState. Linear over windowMs, with a per-frame max-correction
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

    const windowMs = Math.max(1, this.opts.windowMs);
    const fraction = Math.min(1, elapsed / windowMs);
    let stepX = this.offsetX * fraction;
    let stepY = this.offsetY * fraction;

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
