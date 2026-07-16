// Player record (splash stats strip — replaced the world status badge).
// Contracts: guarded load (garbage/missing storage → zeros), monotone
// counters, best-streak is a high-water mark, statLines is display-stable.

import { describe, test, expect, beforeEach } from "bun:test";
import {
  loadPlayerStats,
  recordKill,
  recordDeath,
  recordStreak,
  recordMatch,
  statLines,
} from "../playerStats.js";

// bun:test provides a happy-dom-less environment — shim localStorage.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => store.clear());

describe("playerStats", () => {
  test("fresh storage → all zeros", () => {
    expect(loadPlayerStats()).toEqual({
      kills: 0,
      deaths: 0,
      bestStreak: 0,
      matches: 0,
      matchWins: 0,
    });
  });

  test("garbage storage → zeros, never throws", () => {
    store.set("jakesjam.playerStats", "{not json");
    expect(loadPlayerStats().kills).toBe(0);
    store.set("jakesjam.playerStats", '{"kills":"NaN-ish"}');
    expect(loadPlayerStats().kills).toBe(0);
  });

  test("kills/deaths/matches accumulate; wins only on won matches", () => {
    recordKill();
    recordKill();
    recordDeath();
    recordMatch(true);
    recordMatch(false);
    const s = loadPlayerStats();
    expect(s.kills).toBe(2);
    expect(s.deaths).toBe(1);
    expect(s.matches).toBe(2);
    expect(s.matchWins).toBe(1);
  });

  test("bestStreak is a high-water mark", () => {
    recordStreak(3);
    recordStreak(2);
    expect(loadPlayerStats().bestStreak).toBe(3);
    recordStreak(5);
    expect(loadPlayerStats().bestStreak).toBe(5);
  });

  test("statLines: five display rows in stable order", () => {
    recordKill();
    const lines = statLines(loadPlayerStats());
    expect(lines.map((l) => l.label)).toEqual([
      "KILLS",
      "DEATHS",
      "BEST STREAK",
      "MATCHES",
      "WINS",
    ]);
    expect(lines[0]!.value).toBe("1");
  });
});
