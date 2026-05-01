// Per-remote-entity ring buffer used to render snapshots ~100ms in the past,
// smoothing across packet jitter. See docs/netcode-architecture.md Gambetta loop.
//
// Keep entries small; we ringbuffer a fixed window and drop anything older than
// the current render time minus INTERP_WINDOW_MS.

const INTERP_WINDOW_MS = 400;

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
   * Sample the buffer at a render time. Returns null if we don't have two
   * samples bracketing the requested time (caller should hold-last or skip).
   */
  sample(renderTimeMs: number): T | null {
    if (this.samples.length === 0) return null;
    if (this.samples.length === 1) return this.samples[0]!.value;

    for (let i = 0; i < this.samples.length - 1; i += 1) {
      const a = this.samples[i]!;
      const b = this.samples[i + 1]!;
      if (renderTimeMs >= a.serverTimeMs && renderTimeMs <= b.serverTimeMs) {
        const span = b.serverTimeMs - a.serverTimeMs;
        const t = span > 0 ? (renderTimeMs - a.serverTimeMs) / span : 0;
        return this.lerp(a.value, b.value, t);
      }
    }

    // Past the last sample — extrapolate-by-hold.
    return this.samples[this.samples.length - 1]!.value;
  }

  clear(): void {
    this.samples.length = 0;
  }
}
