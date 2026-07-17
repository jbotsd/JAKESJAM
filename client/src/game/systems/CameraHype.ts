// CameraHype — a slow ~20s "has the player sustained real action long enough
// to earn the peak cinematic camera treatment" accumulator. Distinct from:
//   - ProceduralPlayerRig's danceEnergy/danceRaise ("is the player doing the
//     circle-the-mouse gesture right now" — ~4.2s build, rig-local)
//   - ActionIntensity ("how much is happening this instant" — ~4s full decay)
// This is the slower integrator layered ON TOP of either/both, driven by
// whichever 0-1 "sustained action" signal the caller feeds it. Reaching 1.0
// takes real sustained commitment (~20s), not a single big moment — that's
// the point: this gates the RARE peak visual treatment, not routine juice.
//
// Hysteresis on the peak flag (enter at 1.0, exit only once hype drops below
// EXIT_THRESHOLD) so it doesn't flicker in and out right at the boundary —
// the same "enter tight, exit loose" shape actionCameraMath.ts's
// ENVELOPE_RANGE/ENVELOPE_RANGE_EXIT already uses for the identical reason.
export class CameraHype {
  private value = 0;
  private peakActive = false;

  private static readonly BUILD_MS = 20_000;
  /** Faster release than build — stopping should feel like stopping, not
   *  linger as long as 20s of commitment took to earn. */
  private static readonly RELEASE_MS = 3_000;
  /** Below this drive level, treat it as "not really sustaining it". */
  private static readonly SUSTAIN_GATE = 0.5;
  private static readonly EXIT_THRESHOLD = 0.55;

  /** Advance by deltaMs, driven by a 0-1 "how much sustained action right
   *  now" signal (e.g. the local player rig's dance energy, or combat
   *  intensity, or the max of both). */
  update(deltaMs: number, drive: number): void {
    if (deltaMs <= 0) return;
    const sustaining = drive >= CameraHype.SUSTAIN_GATE;
    const rate = sustaining ? 1 / CameraHype.BUILD_MS : -1 / CameraHype.RELEASE_MS;
    this.value = Math.min(1, Math.max(0, this.value + rate * deltaMs));
    if (this.value >= 1) this.peakActive = true;
    else if (this.value < CameraHype.EXIT_THRESHOLD) this.peakActive = false;
  }

  get(): number {
    return this.value;
  }

  isPeak(): boolean {
    return this.peakActive;
  }

  /** Full reset — a round transition shouldn't carry hype from the last one. */
  reset(): void {
    this.value = 0;
    this.peakActive = false;
  }
}
