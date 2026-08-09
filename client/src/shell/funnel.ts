// The funnel instrument — gospel Track P1.
//
// Every numeric gate in the north star is currently "unmeasured":
// conversion-to-play, URL→first-shot, first kill, play-again. Doors work has
// been aimed by reading code and watching footage, which is how S1/S2 were
// found — but "did that change the funnel" is unanswerable without this.
//
// Design rules, each one a mistake this kind of instrument usually makes:
//
//  1. ONCE per session, ever. A milestone that can fire twice turns a funnel
//     into a popularity contest between event handlers.
//  2. MONOTONIC. Milestones are ordered; a later one implies the earlier
//     ones, and an out-of-order arrival back-fills rather than being dropped
//     (a first_kill with no first_shot recorded is a reporting bug, not a
//     player who killed without shooting).
//  3. Elapsed ms from PAGE LOAD, not wall-clock. The gates are all "how long
//     until", so the number the report wants is already in the event.
//  4. Fire-and-forget. This rides the existing batched, capped telemetry
//     queue; instrumentation must never be able to block or break play.
//  5. NO identity, ever. Session-scoped counters only — the same discipline
//     docs/TELEMETRY.md sets for the error path (the remote IP never enters
//     it either).

import { record } from "../telemetry";

/**
 * The funnel, in order. `played_again` is the retention gate: a SECOND
 * match start in one session, which is the cheapest honest proxy for
 * "chose again" until Pillar 5's ceremony exists to ask properly.
 */
export const FUNNEL_STEPS = [
  "page_load",
  "playable",
  "first_input",
  "first_shot",
  "first_kill",
  "first_death",
  "round_end_seen",
  "played_again",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

const reached = new Set<FunnelStep>();
let originMs = 0;

/** Wrong-input count in the first 30 s — the confusion signal. A visitor
 *  mashing keys that do nothing is a legibility bug we cannot otherwise
 *  see (Doors Phase 3's onboarding is aimed at exactly this). */
const WRONG_INPUT_WINDOW_MS = 30_000;
let wrongInputs = 0;
let wrongInputsReported = false;

export function initFunnel(now: number = performance.now()): void {
  reached.clear();
  originMs = now;
  wrongInputs = 0;
  wrongInputsReported = false;
}

function elapsed(now: number): number {
  return Math.max(0, Math.round(now - originMs));
}

/**
 * Mark a milestone. Idempotent per session, and back-fills any earlier step
 * that has not fired (rule 2) so the report never has to guess whether a
 * gap is a real drop-off or a missing call site.
 */
export function funnel(step: FunnelStep, now: number = performance.now()): void {
  if (reached.has(step)) return;
  const index = FUNNEL_STEPS.indexOf(step);
  if (index < 0) return;

  for (let i = 0; i <= index; i++) {
    const s = FUNNEL_STEPS[i]!;
    if (reached.has(s)) continue;
    reached.add(s);
    record({
      kind: "funnel",
      sig: `funnel:${s}`,
      message: s,
      data: {
        step: s,
        stepIndex: i,
        ms: elapsed(now),
        // True when this step was inferred from a later one rather than
        // reported by its own call site — a wiring gap, visible in the data
        // instead of silently flattering the funnel.
        backfilled: s !== step,
      },
    });
  }
}

/** Has this session reached `step`? Exported for tests and for call sites
 *  that want to avoid recomputing work for an already-counted milestone. */
export function funnelReached(step: FunnelStep): boolean {
  return reached.has(step);
}

/**
 * An input that did nothing (a key with no binding) during the opening
 * window. Counted locally and reported ONCE at the window's end, so a
 * key-mashing visitor costs one event rather than fifty.
 */
export function noteWrongInput(now: number = performance.now()): void {
  if (wrongInputsReported) return;
  if (elapsed(now) > WRONG_INPUT_WINDOW_MS) {
    flushWrongInputs(now);
    return;
  }
  wrongInputs += 1;
}

/** Send the wrong-input tally if the window has closed. Safe to call often. */
export function flushWrongInputs(now: number = performance.now()): void {
  if (wrongInputsReported) return;
  if (elapsed(now) <= WRONG_INPUT_WINDOW_MS) return;
  wrongInputsReported = true;
  if (wrongInputs === 0) return;
  record({
    kind: "funnel",
    sig: "funnel:wrong_inputs",
    message: "wrong_inputs",
    data: { count: wrongInputs, windowMs: WRONG_INPUT_WINDOW_MS },
  });
}

/** Test seam: the raw set of reached steps. */
export function __funnelStateForTests(): {
  reached: FunnelStep[];
  wrongInputs: number;
} {
  return { reached: [...reached], wrongInputs };
}
