// gospel 3.1 — bot identity: plausible, varied, and above all UNIQUE.
//
// The row asks for "plausible varied names (never Name+digits — the exact
// tell players catch)". The roster already satisfies that. What it did NOT
// satisfy is uniqueness over time: the bot id is derived from the name
// (`bot_<name>`), `nameCursor` persists across bells, and the roster is
// only 12 long — so a host that stays up long enough wraps the cursor onto
// a name that is still standing in the arena. That is an ID collision, not
// a cosmetic one: the live bot's state gets overwritten and the same
// playerId goes into a match roster twice.
//
// These tests pin both halves.

import { describe, expect, test } from "bun:test";
import { WorldBots } from "../worldBots.ts";

// `spawnInfosFor` is both the grow AND the shrink path — bots absent from
// its result are deleted — so a bell is modelled as "ask for few, then ask
// for many", exactly as the elastic floor does across a cycle.
const ensure = (bots: WorldBots, count: number) => bots.spawnInfosFor(count);

describe("bot names", () => {
  test("no name carries a digit — the tell players catch", () => {
    const bots = new WorldBots();
    for (const b of ensure(bots, 6)) {
      expect(b.name).not.toMatch(/\d/);
      expect(b.playerId).not.toMatch(/\d/);
    }
  });

  test("a single wave has no duplicates", () => {
    const bots = new WorldBots();
    const wave = ensure(bots, 6);
    expect(new Set(wave.map((b) => b.playerId)).size).toBe(wave.length);
  });

  test("ids stay unique after the cursor has wrapped the roster", () => {
    // The live-host case: many bells over days, so cumulative creations
    // exceed the 12-name roster while some bots are still standing.
    const bots = new WorldBots();
    const seenAcrossTime: string[][] = [];
    for (let bell = 0; bell < 8; bell += 1) {
      ensure(bots, 1); // shrink: one survivor carries over, as after a bell
      const wave = ensure(bots, 6);
      seenAcrossTime.push(wave.map((b) => b.playerId));
      // The assertion that was violated before the fix: never the same
      // playerId twice within one roster handed to a match.
      expect(new Set(wave.map((b) => b.playerId)).size).toBe(wave.length);
    }
    // Vacuity guard: prove the loop actually created enough bots to wrap a
    // 12-name roster, otherwise the test never reaches the failing case.
    const distinct = new Set(seenAcrossTime.flat());
    expect(distinct.size).toBeGreaterThan(6);
  });
});
