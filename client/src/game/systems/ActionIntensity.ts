// ActionIntensity — one shared 0-1 "how much is happening right now" score,
// fed by whatever a scene considers exciting (landings, wall-jumps, dashes,
// hits, kills, sudden death...) and decaying back toward 0 when nothing is.
//
// Deliberately NOT audio analysis. Reacting to actual frequency/amplitude
// data from the currently-playing track is fussier (autoplay-gated audio
// contexts, browser inconsistency) and syncs to what the *music* happens to
// be doing rather than what's happening on screen — a bass hit during a
// quiet moment would pulse the environment for no gameplay reason. Driving
// everything from gameplay events instead means the environment and music
// only ever ramp up because something worth reacting to actually happened.
//
// Pure render-layer bookkeeping: never read by the sim, never affects
// determinism/parity. Consumed by camera juice, environment reactivity, and
// (via a dispatched window event) the music system in main.ts.
const INTENSITY_EVENT = "jakesjam:intensity";
const DISPATCH_INTERVAL_MS = 150;

export class ActionIntensity {
  private value = 0;
  private msSinceDispatch = 0;
  // Slow enough that sustained action ACCUMULATES toward 1.0 rather than
  // each event's bump decaying away before the next lands — a firefight or
  // a movement flow-chain should build, not flatline near 0.3. A full decay
  // from peak still takes ~4s, so it winds down promptly once things calm.
  private static readonly DECAY_PER_SECOND = 0.25;

  /** Push the score toward 1, never past it. Bigger events pass a bigger amount. */
  bump(amount: number): void {
    this.value = Math.min(1, this.value + amount);
  }

  /** Decay toward 0. Call once per frame with the real frame delta. */
  update(deltaMs: number): void {
    this.value = Math.max(0, this.value - ActionIntensity.DECAY_PER_SECOND * (deltaMs / 1000));
  }

  get(): number {
    return this.value;
  }

  /**
   * Tell main.ts's music system the current score, throttled — every-frame
   * CustomEvent dispatch would be wasteful and main.ts smooths the value
   * anyway, so there's nothing gained from tighter than ~150ms.
   */
  dispatchToMusic(deltaMs: number): void {
    this.msSinceDispatch += deltaMs;
    if (this.msSinceDispatch < DISPATCH_INTERVAL_MS) return;
    this.msSinceDispatch = 0;
    window.dispatchEvent(new CustomEvent(INTENSITY_EVENT, { detail: { intensity: this.value } }));
  }
}
