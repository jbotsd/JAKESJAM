// Doors 2.3 — what the cycle-end strip is allowed to say.
//
// The rules here are the kind that rot silently: nothing crashes when an
// "achievement" system starts congratulating people for showing up, it
// just quietly becomes noise they scroll past. These pin the two that
// matter — say nothing when nothing happened, and always have something
// for a player who lost.

import { describe, expect, test } from "bun:test";
import { cycleNotables } from "../personalBest.ts";

const base = {
  won: false,
  beatStreak: false,
  streak: 0,
  firstEver: false,
  firstWin: false,
};

describe("Doors 2.3 — cycle notables", () => {
  test("an unremarkable cycle says NOTHING", () => {
    // The most important case. A strip that fires every time is a strip
    // nobody reads, and then the one that mattered goes unread too.
    expect(cycleNotables(base)).toEqual([]);
  });

  test("a personal best is offered to someone who LOST — the whole point", () => {
    const out = cycleNotables({ ...base, won: false, beatStreak: true, streak: 5 });
    expect(out).toHaveLength(1);
    expect(out[0]!.kicker).toBe("NEW BEST STREAK");
    expect(out[0]!.line).toContain("5");
  });

  test("the first win outranks a plain win, and never says both", () => {
    const first = cycleNotables({ ...base, won: true, firstWin: true });
    expect(first.map((n) => n.kicker)).toEqual(["FIRST WIN"]);

    const later = cycleNotables({ ...base, won: true });
    expect(later.map((n) => n.kicker)).toEqual(["WIN"]);
  });

  test("a win AND a record show both, win first", () => {
    const out = cycleNotables({ ...base, won: true, beatStreak: true, streak: 3 });
    expect(out.map((n) => n.kicker)).toEqual(["WIN", "NEW BEST STREAK"]);
  });

  test("a first cycle is only mentioned when nothing better fired", () => {
    expect(cycleNotables({ ...base, firstEver: true }).map((n) => n.kicker)).toEqual([
      "FIRST CYCLE",
    ]);
    // First match that was also a first win: say the win, not both.
    expect(
      cycleNotables({ ...base, firstEver: true, won: true, firstWin: true }).map((n) => n.kicker),
    ).toEqual(["FIRST WIN"]);
  });
});
