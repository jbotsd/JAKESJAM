// The beat-sync core for the Pretennoia tutorial scene. Deliberately does NOT
// compute a BPM grid — the track is a half-time DnB piece with asymmetric,
// continuously-re-edited breakbeats that never settle into a fixed loop, so a
// computed grid would be actively wrong. Instead: a flat, hand-authored table
// of absolute song-timestamps (tutorial-song.ts), fired against
// `audio.currentTime` sampled FRESH every frame — never accumulated from
// Phaser's deltaMs, which drifts permanently after a single dropped/late
// frame. Fresh sampling self-corrects every frame at the cost of only the
// browser's own currentTime jitter (a few ms — imperceptible against this
// track's beat interval).
//
// Governing rule for every consumer: cinematic beats (camera hits, light
// bursts) fire on the SONG's clock regardless of what the player is doing at
// that instant. The environment sells the sync; it is never a gate on the
// player's precise timing. See tutorial-song.ts's header for why.

export type SongCue = {
  id: string;
  atSec: number;
  kind: string;
  data?: unknown;
};

export class SongDirector {
  private readonly cues: readonly SongCue[];
  private firedCount = 0;

  constructor(cues: readonly SongCue[]) {
    // Sorted defensively — authoring tutorial-song.ts out of order is an easy
    // mistake and this class's whole contract depends on ascending atSec.
    this.cues = [...cues].sort((a, b) => a.atSec - b.atSec);
  }

  /**
   * Call every frame with `audio.currentTime` (or any monotonically
   * increasing song-time value). Returns every cue that newly crossed its
   * `atSec` threshold since the last call, in order, AS A BATCH — a single
   * laggy frame (tab backgrounded, GC pause) can legitimately cross more than
   * one cue boundary, and every one of them still needs to fire exactly once,
   * just all in the same frame rather than being silently dropped.
   */
  update(currentTimeSec: number): SongCue[] {
    const fired: SongCue[] = [];
    while (this.firedCount < this.cues.length && this.cues[this.firedCount]!.atSec <= currentTimeSec) {
      fired.push(this.cues[this.firedCount]!);
      this.firedCount += 1;
    }
    return fired;
  }

  /**
   * Dev-only: jump the cursor for scrubbing (the `?tutorial-scrub=1` tool).
   * Explicitly does NOT replay skipped cues — jumping straight to 109s resets
   * the fired-index to whatever that implies, it doesn't replay the 8 cues
   * between 0-109s. Scene code that needs "catch the world up to this point"
   * behavior (e.g. snapping the camera to the right framing) should do so
   * explicitly in its own scrub handler, not rely on seek() to replay cues.
   */
  seek(toSec: number): void {
    let idx = 0;
    while (idx < this.cues.length && this.cues[idx]!.atSec <= toSec) idx += 1;
    this.firedCount = idx;
  }

  /** True once every cue has fired. */
  get done(): boolean {
    return this.firedCount >= this.cues.length;
  }
}
