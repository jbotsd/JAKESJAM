// Perf audit N5 (2026-07-18) regression test.
//
// postMatchResult() used to unconditionally pay a full replay-serialize +
// disk-persist + Convex round-trip on every match completion, even for a
// bot-only WorldHost cycle with zero humans ever connected — no highlight
// clips, no player-facing summary, nothing worth the cost. Fixed by tracking
// `hadHumanPlayer` (sticky for the match's life) and short-circuiting
// postMatchResult entirely when it's false.
import { describe, test, expect, spyOn } from "bun:test";
import { MatchHost } from "../matchHost.ts";
import type { PlayerSpawnInfo } from "@sim/types.ts";
import { PlayerId } from "@sim/types.ts";

function botSpawn(id: string): PlayerSpawnInfo {
  return { playerId: PlayerId(`bot_${id}`), characterId: "balanced", weaponId: "starter-pistol", color: "#ff0000", name: id };
}

function humanSpawn(id: string): PlayerSpawnInfo {
  return { playerId: PlayerId(id), characterId: "balanced", weaponId: "starter-pistol", color: "#00ff00", name: id };
}

type HostInternals = {
  hadHumanPlayer: boolean;
  addPlayer(spawn: PlayerSpawnInfo): void;
  postMatchResult(): Promise<void>;
  replayRecorder: { serialize(): Uint8Array };
};

describe("MatchHost bot-only match persist gate (perf audit N5)", () => {
  test("a match with only bot spawns never had a human", () => {
    const host = new MatchHost("test-bots-only", [botSpawn("a"), botSpawn("b")], []);
    const internals = host as unknown as HostInternals;
    expect(internals.hadHumanPlayer).toBe(false);
  });

  test("a match with a human spawn is flagged immediately", () => {
    const host = new MatchHost("test-with-human", [humanSpawn("h1"), botSpawn("a")], []);
    const internals = host as unknown as HostInternals;
    expect(internals.hadHumanPlayer).toBe(true);
  });

  test("a human joining mid-match (addPlayer) flips the flag, and it stays flipped", () => {
    const host = new MatchHost("test-midjoin", [botSpawn("a")], []);
    const internals = host as unknown as HostInternals;
    expect(internals.hadHumanPlayer).toBe(false);
    internals.addPlayer(humanSpawn("h1"));
    expect(internals.hadHumanPlayer).toBe(true);
  });

  test("bot-only match: postMatchResult skips replay serialize entirely", async () => {
    const host = new MatchHost("test-bots-skip", [botSpawn("a"), botSpawn("b")], []);
    const internals = host as unknown as HostInternals;
    const serializeSpy = spyOn(internals.replayRecorder, "serialize");
    await internals.postMatchResult();
    expect(serializeSpy.mock.calls.length).toBe(0);
    serializeSpy.mockRestore();
  });

  test("a match that ever had a human: postMatchResult still attempts replay serialize", async () => {
    const host = new MatchHost("test-human-persists", [humanSpawn("h1")], []);
    const internals = host as unknown as HostInternals;
    const serializeSpy = spyOn(internals.replayRecorder, "serialize");
    await internals.postMatchResult();
    expect(serializeSpy.mock.calls.length).toBeGreaterThan(0);
    serializeSpy.mockRestore();
  });
});
