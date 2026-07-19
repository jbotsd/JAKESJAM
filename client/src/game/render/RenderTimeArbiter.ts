/** Render-only time-scale arbitration. The simulation, network, scene clock,
 * and input feed are never touched; only Phaser's tween presentation clock is
 * composed. The smallest requested scale wins until that source expires. */
export type RenderTimeHost = {
  tweens: { timeScale: number };
  time: { now: number };
};

type Hold = { scale: number; untilMs: number };

export class RenderTimeArbiter {
  private readonly host: RenderTimeHost;
  private readonly holds = new Map<string, Hold>();
  private lastAppliedScale = 1;

  constructor(host: RenderTimeHost) {
    this.host = host;
  }

  hold(source: string, scale: number, durationMs: number): void {
    const boundedScale = Math.max(0, Math.min(1, scale));
    const untilMs = this.host.time.now + Math.max(0, durationMs);
    const current = this.holds.get(source);
    // A weaker/reused request cannot shorten an already active source hold.
    this.holds.set(source, {
      scale: current ? Math.min(current.scale, boundedScale) : boundedScale,
      untilMs: current ? Math.max(current.untilMs, untilMs) : untilMs,
    });
    this.apply();
  }

  release(source: string): void {
    this.holds.delete(source);
    this.apply();
  }

  update(): void {
    for (const [source, hold] of this.holds) {
      if (this.host.time.now >= hold.untilMs) this.holds.delete(source);
    }
    this.apply();
  }

  clear(): void {
    this.holds.clear();
    this.apply();
  }

  isHeld(source: string): boolean {
    return this.holds.has(source);
  }

  private apply(): void {
    let scale = 1;
    for (const hold of this.holds.values()) scale = Math.min(scale, hold.scale);
    // Once arbitration has cleanly returned to 1 it stops writing, preserving
    // ownership by unrelated presentation systems during migration.
    if (scale === 1 && this.lastAppliedScale === 1) return;
    this.host.tweens.timeScale = scale;
    this.lastAppliedScale = scale;
  }
}
