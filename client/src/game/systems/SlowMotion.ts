// SlowMotion — a brief "bullet time" dip for a big moment (a kill, a peak
// dance-mode beat), RENDER-ONLY: scales scene.tweens.timeScale, the same
// mechanism SimEventRouter's existing hit-stop already uses ("freeze render
// tweens... sim keeps ticking"). Never touches scene.time.timeScale or
// anything the sim/network clock depends on — this game is client-predicted,
// server-authoritative, and slowing the actual sim clock independent of the
// server would desync prediction.
//
// Two ways out, whichever comes first:
//   1. A max hold duration (in case nothing else cancels it).
//   2. The player pressing ANY meaningful gameplay key (Jake, 2026-07-15:
//      slow-mo is a passive flourish, never allowed to feel like it's
//      taking control away — the instant a real input arrives, cut back to
//      full speed immediately, not eased, not on the trailing edge of a
//      timer).
// Both exits are a hard, instant snap to timeScale=1 — never an eased
// ramp-back, matching the existing hit-stop's own instant-recovery shape.
export class SlowMotion {
  private readonly scene: Phaser.Scene;
  private active = false;
  private deadlineMs = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Enter slow motion right now. `scale` is the render timeScale (e.g. 0.35
   *  for a strong bullet-time dip); `maxHoldMs` is the hard ceiling if no
   *  input cancels it first. */
  trigger(scale: number, maxHoldMs: number): void {
    this.active = true;
    this.deadlineMs = this.scene.time.now + maxHoldMs;
    this.scene.tweens.timeScale = scale;
  }

  /** Call once per frame with the current input bitfield (0 = nothing
   *  pressed). Ends the dip instantly on either exit condition. */
  update(currentKeys: number): void {
    if (!this.active) return;
    const inputArrived = currentKeys !== 0;
    const timedOut = this.scene.time.now >= this.deadlineMs;
    if (inputArrived || timedOut) {
      this.scene.tweens.timeScale = 1;
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  /** Force an immediate end (e.g. round transition) — same instant-snap
   *  shape as the input/timeout exits, not a fade. */
  cancel(): void {
    if (!this.active) return;
    this.scene.tweens.timeScale = 1;
    this.active = false;
  }
}
