// Pure Phaser-free planner for on-target MARK-WINDOW reads (Track L,
// docs/legibility-audit.md): WHO currently wears a hostile mark, so the
// marked BODY itself carries a world-space read for the whole window —
// not just the caster-side nameplate chip. Covers the three catalog mark
// pairs that had no on-target presence read:
//
//   facet    — Geometrician Facet Break (facetTargetId/facetMarkUntilTick)
//   judgment — Kindled Judgment Line   (judgmentTargetId/judgmentMarkUntilTick)
//   read     — Interstice Read Mark    (readTargetId/readMarkUntilTick —
//              note Razor Route's silent dash-cross tag writes the SAME
//              fields, so its tag becomes visible at tag time for free)
//
// Focus Hex is deliberately absent: its window already has the full
// priest→victim tether read (entanglementPlan.ts + ConstructVfxController).
//
// StatusVfxController consumes the plan and owns the painting — the same
// planner/painter split veilReadPlan.ts / entanglementPlan.ts established,
// so bun:test covers the decision logic headlessly (never import Phaser in
// a bun test). Doctrine #10 (six-axes-goal.md): a WATCHING enemy must be
// able to see that a fighter is marked for amplified punishment — fairness
// demands the mark reads at ITS site (the marked body), because that is
// where the amp will land.
//
// The marks live on the HOLDER's entity (attacker-side fields), so the
// planner inverts them onto targets. Expiry needs no frame-diff memo —
// the window simply stops planning, and `intensity` eases to 0 over the
// final MARK_FADE_MS so the end never pops (the fade IS the expiry tell,
// same contract as veilReadPlan's shroud intensity).

import { STEP_MS } from "../../sim/constants.js";
import type { PlayerId, Vec2, WorldState } from "../../sim";

/** The fade window doubles as the "mark is about to lapse" tell. */
const MARK_FADE_MS = 300;

export type MarkKind = "facet" | "judgment" | "read";

export type MarkRead = {
  /** The MARKED player — the read is drawn at their body. */
  targetId: string;
  kind: MarkKind;
  pos: Vec2;
  /** 1 for most of the window, easing to 0 over the final MARK_FADE_MS. */
  intensity: number;
  /** 0-based per-target index so stacked marks offset instead of
   *  overdrawing (a body can wear facet + judgment + read at once). */
  stackIndex: number;
};

export function planMarkReads(
  state: WorldState,
  getPosition: (id: PlayerId) => Vec2 | undefined,
): MarkRead[] {
  const reads: MarkRead[] = [];
  const stackCount = new Map<string, number>();
  // Holder iteration is id-sorted so stackIndex assignment is deterministic
  // regardless of players-record insertion order (same discipline as the
  // sim's own sortedPlayerIds passes).
  for (const holderId of Object.keys(state.players).sort()) {
    const holder = state.players[holderId as PlayerId]!;
    // A dead hunter's mark cannot be consumed, so it plans nothing (the
    // fields can survive on the corpse until respawn scrubs them).
    if (!holder.alive) continue;
    const candidates: ReadonlyArray<{
      kind: MarkKind;
      targetId: string | undefined;
      until: number | undefined;
    }> = [
      { kind: "facet", targetId: holder.facetTargetId, until: holder.facetMarkUntilTick },
      { kind: "judgment", targetId: holder.judgmentTargetId, until: holder.judgmentMarkUntilTick },
      { kind: "read", targetId: holder.readTargetId, until: holder.readMarkUntilTick },
    ];
    for (const c of candidates) {
      if (c.targetId === undefined || c.until === undefined) continue;
      if (c.until <= state.tick) continue; // stale window — sim leaves it
      if (c.targetId === holderId) continue; // defensive: never self-mark
      const target = state.players[c.targetId as PlayerId];
      if (!target || !target.alive) continue;
      const pos = getPosition(c.targetId as PlayerId);
      if (!pos) continue;
      const remainingMs = (c.until - state.tick) * STEP_MS;
      const stackIndex = stackCount.get(c.targetId) ?? 0;
      stackCount.set(c.targetId, stackIndex + 1);
      reads.push({
        targetId: c.targetId,
        kind: c.kind,
        pos,
        intensity: Math.min(1, remainingMs / MARK_FADE_MS),
        stackIndex,
      });
    }
  }
  return reads;
}
