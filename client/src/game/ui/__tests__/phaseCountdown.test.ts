// venue-goal.md Pillar 0.2 — the death overlay's big number must be honest
// in every phase. The old code showed the raw phase clock labeled
// "respawning": die 5s into a round and it said 85, then silently re-meant
// draft-time and round-over-time as phases rolled underneath it.
// deathWaitCountdown answers ONE question ("when do I fight again?") as an
// upper-bound estimate that only ever jumps down.

import { describe, expect, test } from "bun:test";
import { deathWaitCountdown } from "../phaseCountdown.js";
import { DRAFT_WINDOW_MS, ROUND_OVER_HOLD_MS } from "../../../sim/round.js";

describe("deathWaitCountdown — all four phases", () => {
  test("fighting: remaining + round-over hold + draft window, marked approx", () => {
    const t = deathWaitCountdown("fighting", 85_000);
    expect(t.label).toBe("NEXT BELL");
    expect(t.approx).toBe(true);
    expect(t.seconds).toBe(Math.ceil((85_000 + ROUND_OVER_HOLD_MS + DRAFT_WINDOW_MS) / 1000));
  });

  test("round-over: remaining + draft window, marked approx", () => {
    const t = deathWaitCountdown("round-over", 2_500);
    expect(t.label).toBe("NEXT BELL");
    expect(t.approx).toBe(true);
    expect(t.seconds).toBe(Math.ceil((2_500 + DRAFT_WINDOW_MS) / 1000));
  });

  test("drafting: exact — respawn IS the end of drafting", () => {
    const t = deathWaitCountdown("drafting", 15_000);
    expect(t.label).toBe("NEXT BELL");
    expect(t.approx).toBe(false);
    expect(t.seconds).toBe(15);
  });

  test("countdown: defensive branch — respawn already happened at entry", () => {
    const t = deathWaitCountdown("countdown", 3_000);
    expect(t.label).toBe("RESPAWNING");
    expect(t.approx).toBe(false);
    expect(t.seconds).toBe(3);
  });

  test("the estimate is monotone across the natural phase sequence — the number never jumps UP", () => {
    // Walk the real sequence a dead player sits through: end of fighting →
    // round-over(2.5s) → drafting(15s) → bell. At each phase boundary the
    // new phase's fresh estimate must not exceed the old phase's estimate
    // at its final tick.
    const endOfFighting = deathWaitCountdown("fighting", 0);
    const startOfRoundOver = deathWaitCountdown("round-over", ROUND_OVER_HOLD_MS);
    expect(startOfRoundOver.seconds).toBeLessThanOrEqual(endOfFighting.seconds);

    const endOfRoundOver = deathWaitCountdown("round-over", 0);
    const startOfDrafting = deathWaitCountdown("drafting", DRAFT_WINDOW_MS);
    expect(startOfDrafting.seconds).toBeLessThanOrEqual(endOfRoundOver.seconds);
  });

  test("negative remaining clamps to 0, never renders a negative number", () => {
    expect(deathWaitCountdown("drafting", -500).seconds).toBe(0);
  });
});
