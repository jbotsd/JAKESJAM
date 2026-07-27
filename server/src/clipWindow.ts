// Clip trim discipline (clip-goal CL.C) — pure window math, no I/O.
//
// A highlight window is computed FROM the kill cluster, not from fixed
// offsets: the studied baseline led with ~4s of the star standing around
// (fixed 9s pre-roll) and ended on a full-screen "ROUND 1 — TO BOT·GIZMO"
// banner crediting somebody else. The rules:
//
//   IN   = first kill of the cluster − PRE_TICKS  (~1.5s of approach)
//   OUT  = last kill of the cluster + POST_TICKS  (~2s of aftermath)
//   CAP  = MAX_TICKS, anchored at the END (a long cluster keeps its
//          biggest beat — the last kill — and sheds lead-up, never tail)
//   LAW  = the window NEVER contains a round-over edge whose winner is
//          not the star. A foreign round banner inside the window shrinks
//          it; the star's OWN victory banner is allowed to ride (that IS
//          the beat). A fighting-start edge before the first kill clamps
//          the lead-in so no stale between-round chrome leaks in.

/** `victimId` (clip-goal STUDY 3, D1/CL.E) — the render-side highlight
 *  camera used to GUESS the engaged victim by proximity ("nearest living
 *  opponent") because this type never carried the real one. That guess
 *  fails whenever the true victim is far from the star on screen (routine
 *  for a ranged hitscan kill) — live verification found exactly this: a
 *  human-credited kill on a bot standing off-screen, the camera locked on
 *  the star alone the whole clip. Recording the real victim here lets the
 *  camera frame the ACTUAL combatant instead of a guess. */
export type KillMoment = { tick: number; killerId: string; victimId: string };

export type RoundMark =
  | { tick: number; kind: "round-over"; winnerId: string | null }
  | { tick: number; kind: "fighting" };

export type ClipWindow = {
  fromTick: number;
  ticks: number;
  followId: string;
  /** Cluster kill ticks relative to fromTick — probes + the lower-third
   *  (CL.D) both key off these. */
  killTicks: number[];
  /** Parallel to killTicks (same order/length) — each kill's real victim,
   *  so the render-side camera never has to guess (STUDY 3 D1/CL.E). */
  killVictims: string[];
};

export const CLIP_PRE_TICKS = 90; // 1.5s approach
export const CLIP_POST_TICKS = 120; // 2s aftermath
export const CLIP_MAX_TICKS = 720; // 12s ceiling
/** Margin before a foreign round-over edge — the banner must not even
 *  flash on the final frames. */
const ROUND_OVER_MARGIN_TICKS = 6;

export function computeClipWindows(
  kills: readonly KillMoment[],
  roundMarks: readonly RoundMark[],
  opts: { maxWindows?: number; totalTicks?: number } = {},
): ClipWindow[] {
  const maxWindows = opts.maxWindows ?? 3;
  if (kills.length === 0) return [];

  // Cluster kills by proximity (any killers — a trade sequence is one
  // story); the LAST kill's killer is the star (the biggest moment ends
  // the cluster, same selection the old queue used).
  const sorted = [...kills].sort((a, b) => a.tick - b.tick);
  const clusters: KillMoment[][] = [];
  for (const k of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && k.tick - current[current.length - 1]!.tick <= CLIP_MAX_TICKS) {
      current.push(k);
    } else {
      clusters.push([k]);
    }
  }

  const windows: ClipWindow[] = [];
  for (const cluster of clusters.slice(0, maxWindows)) {
    const first = cluster[0]!.tick;
    const last = cluster[cluster.length - 1]!.tick;
    const followId = cluster[cluster.length - 1]!.killerId;

    let from = first - CLIP_PRE_TICKS;
    let to = last + CLIP_POST_TICKS;

    // Foreign round-over inside the window: shrink. Star's own: allowed.
    for (const mark of roundMarks) {
      if (mark.kind !== "round-over") continue;
      if (mark.tick < from || mark.tick > to) continue;
      if (mark.winnerId === followId) continue;
      if (mark.tick > last) {
        to = Math.min(to, mark.tick - ROUND_OVER_MARGIN_TICKS);
      } else if (mark.tick < first) {
        // Between-rounds chrome before the cluster: start at the next
        // fighting edge instead (or just past the mark when none known).
        const nextFighting = roundMarks.find(
          (m) => m.kind === "fighting" && m.tick > mark.tick && m.tick <= first,
        );
        from = Math.max(from, nextFighting ? nextFighting.tick : mark.tick + 1);
      }
      // A foreign round-over BETWEEN first and last kill can't happen —
      // kills only land in fighting, so the cluster's own span is clean.
    }

    // Lead-in never starts before the fight the first kill belongs to.
    const lastFightingBeforeFirst = [...roundMarks]
      .filter((m) => m.kind === "fighting" && m.tick <= first)
      .sort((a, b) => b.tick - a.tick)[0];
    if (lastFightingBeforeFirst) {
      from = Math.max(from, lastFightingBeforeFirst.tick);
    }

    from = Math.max(0, from);
    if (opts.totalTicks !== undefined) to = Math.min(to, opts.totalTicks);
    // Length cap, END-anchored: shed lead-up, keep the biggest beat.
    if (to - from > CLIP_MAX_TICKS) from = to - CLIP_MAX_TICKS;
    // An honest window CONTAINS its final kill's impact — if the clamps
    // cut past it (foreign banner immediately on the kill, replay ends
    // early), render nothing rather than a kill-less "highlight".
    if (to <= last || to <= from) continue;

    // Re-anchor the lead-in to whichever kill actually SURVIVES as the
    // first visible one (clip-goal STUDY 3, CL.C regression, 2026-07-27):
    // the END-anchored cap above can shed the cluster's true first kill
    // from a long/spread cluster, leaving a LATER kill as the window's
    // effective first beat — but `from` was still computed relative to the
    // (now-shed) original first kill, so the surviving first kill could
    // land hundreds of ticks into the window with nothing happening before
    // it (`0e21238e`: ~6.8s of dead lead-in instead of ~1.5s). Tighten
    // `from` FORWARD (never backward — this only shrinks the window,
    // never re-admits an excluded round-over) so the ~1.5s approach law
    // holds against the kill the viewer will actually see first.
    const firstSurviving = cluster.find((k) => k.tick >= from && k.tick < to);
    if (firstSurviving) {
      const reanchored = firstSurviving.tick - CLIP_PRE_TICKS;
      if (reanchored > from) from = Math.min(reanchored, to - 1);
    }

    windows.push({
      fromTick: from,
      ticks: to - from,
      followId,
      // Only kills inside the window — the end-anchored cap can shed a
      // long cluster's early kills along with the lead-up.
      killTicks: cluster
        .filter((k) => k.tick >= from && k.tick < to)
        .map((k) => k.tick - from),
      killVictims: cluster
        .filter((k) => k.tick >= from && k.tick < to)
        .map((k) => k.victimId),
    });
  }
  return windows;
}
