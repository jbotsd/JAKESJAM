// "TTK should feel locked to the music, not just whenever the sim resolves
// it." The sim's actual damage resolution stays instant and authoritative
// (correctness, no shared-code risk to combat.ts) — this only quantizes
// the RENDER-FACING reveal: a health bar drop holds until the next real
// onset in TUTORIAL_SONG_ONSETS instead of updating the instant a hit
// lands. A max-wait window keeps it from ever feeling laggy during a
// sparse stretch of the track — if no onset is close enough, it just
// reveals immediately rather than making the player wait on a hit they
// clearly landed.

import { TUTORIAL_SONG_ONSETS } from "../../sim/data/tutorial-song-onsets.js";

export class TutorialBeatQuantizer {
  private readonly onsets: readonly number[];
  private readonly maxWaitSec: number;

  constructor(onsets: readonly number[] = TUTORIAL_SONG_ONSETS, maxWaitSec = 0.22) {
    this.onsets = onsets;
    this.maxWaitSec = maxWaitSec;
  }

  /** Given the song-time a hit was detected, return the song-time its
   *  render-facing reveal should happen at: the next onset if it's close
   *  enough, otherwise immediately. */
  resolveAt(detectedAtSec: number): number {
    const onsets = this.onsets;
    let lo = 0;
    let hi = onsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (onsets[mid]! < detectedAtSec) lo = mid + 1;
      else hi = mid;
    }
    const next = onsets[lo];
    if (next === undefined) return detectedAtSec;
    return next - detectedAtSec <= this.maxWaitSec ? next : detectedAtSec;
  }
}
