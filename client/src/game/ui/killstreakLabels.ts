// Kill-streak callout ladder (clip-goal CL.F) — one source of truth for
// the escalation vocabulary, extracted from OnlineMatchScene so the order
// is test-pinned: a bigger label must never be followed by a smaller one
// within a streak (the studied footage read TRIPLE→MULTI as a downgrade
// until the countdown-timer explained it; the ladder itself must stay
// provably monotone).

export const KILLSTREAK_LABELS = ["KILL", "DOUBLE KILL", "TRIPLE KILL", "MULTI KILL"] as const;

/** Label for the Nth kill of a streak (1-based). Clamps at the top. */
export function killstreakLabel(streak: number): string {
  return KILLSTREAK_LABELS[Math.min(Math.max(1, streak) - 1, KILLSTREAK_LABELS.length - 1)]!;
}

/** Ladder rank of a label (0-based; -1 for unknown). */
export function killstreakRank(label: string): number {
  return KILLSTREAK_LABELS.indexOf(label as (typeof KILLSTREAK_LABELS)[number]);
}
