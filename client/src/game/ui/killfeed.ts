// gospel 4.6 — the live killfeed.
//
// Pure model, no Phaser: the scene owns pixels, this owns "what should be
// on screen right now". Kept separate because the interesting parts are
// all decisions — what an unattributed death reads as, how many lines fit,
// when a line ages out — and none of them need a renderer to test.
//
// Deliberately NOT sim state: a killfeed is a presentation view over
// `player-killed` SimEvents, which the sim already emits. Nothing here
// feeds back into the world, so it stays client-side (L1 puts BEHAVIOUR in
// the core; this changes nothing about what happens, only what you see).

/** How long a line stays up. Long enough to read after looking back at the
 *  screen, short enough that a busy fight does not become a wall. */
export const KILLFEED_TTL_MS = 5_000;

/** Hard cap on visible lines. A 6-player FFA can produce a burst of kills
 *  in one tick; without a cap the feed would cover the arena it is
 *  reporting on. Oldest fall off first. */
export const KILLFEED_MAX_LINES = 4;

export type KillfeedEntry = {
  /** Display name of the killer, or null for an unattributed death. */
  killer: string | null;
  victim: string;
  /** Execute-axis finish — the renderer tints these. */
  execute: boolean;
  /** True when the local player did the killing (rendered emphasised). */
  byLocal: boolean;
  /** True when the local player died (rendered emphasised, differently). */
  ofLocal: boolean;
  atMs: number;
};

export type KillEventLike = {
  victimId: string;
  killerId: string | null;
  execute?: boolean;
};

/**
 * Rolling killfeed. Time is passed in rather than read from a clock so the
 * tests are not timing-dependent and a replay can drive it off sim time.
 */
export class Killfeed {
  private entries: KillfeedEntry[] = [];
  private readonly nameOf: (id: string) => string;
  private readonly localId: string | null;

  /**
   * Plain field assignment rather than TS parameter properties — this repo
   * builds with `erasableSyntaxOnly`, which rejects them.
   *
   * @param nameOf   resolves a playerId to a display name
   * @param localId  the viewer, for emphasis; null when spectating
   */
  constructor(nameOf: (id: string) => string, localId: string | null) {
    this.nameOf = nameOf;
    this.localId = localId;
  }

  push(event: KillEventLike, nowMs: number): void {
    // A death with no killer is real and worth showing (void plane, storm,
    // burn) — it just has no killer half. Suicides are attributed deaths
    // where killer === victim; showing "X killed X" reads as a bug, so they
    // collapse to the same unattributed form.
    const selfOrNone =
      event.killerId === null || event.killerId === event.victimId;

    this.entries.push({
      killer: selfOrNone ? null : this.nameOf(event.killerId as string),
      victim: this.nameOf(event.victimId),
      execute: event.execute === true,
      byLocal:
        !selfOrNone &&
        this.localId !== null &&
        event.killerId === this.localId,
      ofLocal: this.localId !== null && event.victimId === this.localId,
      atMs: nowMs,
    });

    // Trim here as well as in visible(): an idle tab can accumulate
    // unboundedly between renders, and this list is also read by the clip
    // pipeline, which does not call visible() every frame.
    if (this.entries.length > KILLFEED_MAX_LINES * 4) {
      this.entries = this.entries.slice(-KILLFEED_MAX_LINES * 4);
    }
  }

  /** Newest LAST — the feed reads top-to-bottom, oldest at the top. */
  visible(nowMs: number): KillfeedEntry[] {
    const alive = this.entries.filter((e) => nowMs - e.atMs < KILLFEED_TTL_MS);
    // Drop the aged-out ones for good; visible() is called every frame, so
    // this doubles as the sweep.
    this.entries = alive;
    return alive.slice(-KILLFEED_MAX_LINES);
  }

  /** Round/cycle boundaries clear the feed — a stale line from the previous
   *  round on a fresh arena is actively misleading. */
  clear(): void {
    this.entries = [];
  }
}

/** One line of text, so the renderer and any text-only surface (ops,
 *  clip captions) cannot drift apart on wording. */
export function killfeedLineText(e: KillfeedEntry): string {
  const verb = e.execute ? "executed" : "eliminated";
  return e.killer === null ? `${e.victim} was eliminated` : `${e.killer} ${verb} ${e.victim}`;
}
