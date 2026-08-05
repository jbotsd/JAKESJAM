// Doors 1.5b — the persistent next-bell countdown's formatting contract.
//
// Locks the three honesty rules the element lives by (phaseCountdown.ts
// doctrine, venue-goal Pillar 0.2):
//   1. Before the first venue-status frame: an honest placeholder, never a
//     fabricated number ("from second zero" means the ELEMENT exists from
//     second zero, not that we invent a time).
//   2. Fighting/round-over values are upper-bound ESTIMATES → "~" prefix,
//     no false precision.
//   3. Drafting is exact (no tilde); countdown reads an exact 0:00 — the
//     bell IS ringing (msUntilNextBell's own "joinable moment" convention).

import { describe, expect, test } from "bun:test";
import { formatBellCountdown } from "../bellCountdown";

describe("formatBellCountdown (Doors 1.5b)", () => {
  test("null (no status frame yet) renders the placeholder", () => {
    expect(formatBellCountdown(null)).toBe("NEXT BELL --:--");
  });

  test("fighting and round-over are approx — tilde, ceil to whole seconds", () => {
    expect(formatBellCountdown(41_000, "fighting")).toBe("NEXT BELL ~0:41");
    expect(formatBellCountdown(40_001, "fighting")).toBe("NEXT BELL ~0:41");
    expect(formatBellCountdown(95_500, "round-over")).toBe("NEXT BELL ~1:36");
  });

  test("drafting is exact — no tilde", () => {
    expect(formatBellCountdown(7_000, "drafting")).toBe("NEXT BELL 0:07");
  });

  test("countdown phase (bell ringing) is exact zero, and negatives clamp", () => {
    expect(formatBellCountdown(0, "countdown")).toBe("NEXT BELL 0:00");
    expect(formatBellCountdown(-250, "countdown")).toBe("NEXT BELL 0:00");
  });

  test("minutes/seconds padding — seconds always two digits", () => {
    expect(formatBellCountdown(60_000, "drafting")).toBe("NEXT BELL 1:00");
    expect(formatBellCountdown(61_000, "fighting")).toBe("NEXT BELL ~1:01");
    expect(formatBellCountdown(600_000, "fighting")).toBe("NEXT BELL ~10:00");
  });
});
