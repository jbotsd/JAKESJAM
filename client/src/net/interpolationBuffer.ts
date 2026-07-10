// Per-remote-entity ring buffer used to render snapshots ~100ms in the past,
// smoothing across packet jitter. See docs/netcode-architecture.md Gambetta loop.
//
// Keep entries small; we ringbuffer a fixed window and drop anything older than
// the current render time minus INTERP_WINDOW_MS.

const INTERP_WINDOW_MS = 400;

/** How far past the newest sample we velocity-extrapolate before holding.
 *  Covers a main-thread stall or one lost snapshot with continued motion
 *  instead of freeze-then-leap; long outages still clamp (no runaway). */
const EXTRAP_MAX_MS = 120;

export type Sample<T> = {
  serverTimeMs: number;
  value: T;
};

export class InterpolationBuffer<T> {
  private samples: Sample<T>[] = [];
  private readonly lerp: (a: T, b: T, t: number) => T;

  constructor(lerp: (a: T, b: T, t: number) => T) {
    this.lerp = lerp;
  }

  push(serverTimeMs: number, value: T): void {
    this.samples.push({ serverTimeMs, value });
    const cutoff = serverTimeMs - INTERP_WINDOW_MS;
    while (this.samples.length > 2 && this.samples[0]!.serverTimeMs < cutoff) {
      this.samples.shift();
    }
  }

  /**
   * Sample the buffer at a render time. Returns null when empty.
   * Before the oldest sample: return the oldest (NOT the newest — returning
   * the newest right after a buffer rebuild showed an undelayed position,
   * then snapped back once the bracket filled in).
   * Past the newest sample: velocity-extrapolate from the last two samples
   * for up to EXTRAP_MAX_MS, then hold. Freeze-then-leap under main-thread
   * stalls was the visible "popping" on remote bodies.
   */
  sample(renderTimeMs: number): T | null {
    if (this.samples.length === 0) return null;
    if (this.samples.length === 1) return this.samples[0]!.value;

    const first = this.samples[0]!;
    if (renderTimeMs <= first.serverTimeMs) return first.value;

    for (let i = 0; i < this.samples.length - 1; i += 1) {
      const a = this.samples[i]!;
      const b = this.samples[i + 1]!;
      if (renderTimeMs >= a.serverTimeMs && renderTimeMs <= b.serverTimeMs) {
        const span = b.serverTimeMs - a.serverTimeMs;
        const t = span > 0 ? (renderTimeMs - a.serverTimeMs) / span : 0;
        return this.lerp(a.value, b.value, t);
      }
    }

    // Past the newest sample — extrapolate along the last segment (t > 1),
    // capped so a long outage holds instead of sliding off into space.
    const a = this.samples[this.samples.length - 2]!;
    const b = this.samples[this.samples.length - 1]!;
    const span = b.serverTimeMs - a.serverTimeMs;
    if (span <= 0) return b.value;
    const cappedTimeMs = Math.min(renderTimeMs, b.serverTimeMs + EXTRAP_MAX_MS);
    const t = (cappedTimeMs - a.serverTimeMs) / span;
    return this.lerp(a.value, b.value, t);
  }

  clear(): void {
    this.samples.length = 0;
  }
}
