// gospel 3.1 — a bot the arena displaces stands in the VENUE instead of
// evaporating.
//
// The old behaviour was explicit about itself ("displaced bots simply sit
// out — no lobby idling this sprint"), and its cost is a first impression:
// the antechamber empties out exactly when humans start arriving, so the
// room looks deadest at the moment it should look busiest.
//
// These drive the REAL VenueHost handlers against a REAL lobby roster. An
// earlier draft of this file tested a local re-implementation of the cap /
// dedupe / recall rules, which would have passed just as happily with the
// production handler deleted — the exact shape of vacuous test this repo
// keeps getting bitten by.

import { describe, expect, test } from "bun:test";
import { VenueHost } from "../venueHost.ts";
import { WorldHost } from "../worldHost.ts";
import { PlayerId } from "@sim/types.ts";

type LobbyInternals = {
  stop(): void;
  hasPlayer(id: PlayerId): boolean;
  getStateSnapshot(): { players: Record<string, { characterId: string }> };
};

function makeVenue(): { venue: VenueHost; arena: WorldHost; lobby: LobbyInternals } {
  const arena = new WorldHost({ mapId: "vessel-nexus", bots: 2, resultsHoldMs: 60_000 });
  const venue = new VenueHost({ arena });
  // Stop the timers; these tests drive the hooks directly.
  (arena as unknown as { host: { stop(): void } }).host?.stop?.();
  const lobby = venue.lobbyHostForTest() as unknown as LobbyInternals;
  lobby.stop();
  return { venue, arena, lobby };
}

const idsIn = (lobby: LobbyInternals): string[] =>
  Object.keys(lobby.getStateSnapshot().players).sort();

describe("3.1 — displaced arena bots idle in the venue", () => {
  test("a displaced bot appears in the lobby roster", () => {
    const { arena, lobby } = makeVenue();
    const before = idsIn(lobby);
    expect(before).not.toContain("bot_spark");

    arena.onBotDisplaced!(PlayerId("bot_spark"), "SPARK", "heavy");

    const after = idsIn(lobby);
    expect(after).toContain("bot_spark");
    // Identity survives the hop — the venue renders the persona's chassis,
    // so a bot that arrived as a generic default would be visibly wrong.
    expect(lobby.getStateSnapshot().players["bot_spark"]!.characterId).toBe("heavy");
  });

  test("a recalled bot is removed again", () => {
    const { arena, lobby } = makeVenue();
    arena.onBotDisplaced!(PlayerId("bot_spark"), "SPARK", "balanced");
    expect(idsIn(lobby)).toContain("bot_spark");

    arena.onBotRecalled!(PlayerId("bot_spark"));
    // The same persona standing in both rooms reads as a duplicate, not
    // as presence.
    expect(idsIn(lobby)).not.toContain("bot_spark");
  });

  test("recalling a bot the venue never took leaves the ally NPCs alone", () => {
    // Ally NPCs are `bot_`-prefixed too. A recall that removed by prefix
    // rather than by membership would evict a lobby ally that had nothing
    // to do with the arena.
    const { arena, lobby } = makeVenue();
    const allies = idsIn(lobby).filter((id) => id.startsWith("bot_"));
    expect(allies.length).toBeGreaterThan(0); // vacuity: there ARE allies

    arena.onBotRecalled!(PlayerId(allies[0]!));
    expect(idsIn(lobby)).toEqual(expect.arrayContaining(allies));
  });

  test("the idle population is capped", () => {
    const { arena, lobby } = makeVenue();
    const before = idsIn(lobby).length;
    for (const n of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) {
      arena.onBotDisplaced!(PlayerId(`bot_${n}`), n.toUpperCase(), "balanced");
    }
    // Six is the arena's own bot cap, so the antechamber can never hold
    // more personas than the fight it feeds.
    expect(idsIn(lobby).length).toBe(before + 6);
  });

  test("the same bot displaced twice does not double-add", () => {
    const { arena, lobby } = makeVenue();
    const before = idsIn(lobby).length;
    arena.onBotDisplaced!(PlayerId("bot_spark"), "SPARK", "balanced");
    arena.onBotDisplaced!(PlayerId("bot_spark"), "SPARK", "balanced");
    expect(idsIn(lobby).length).toBe(before + 1);
  });

  test("an arena with no venue attached still runs (the hook is optional)", () => {
    // worldHost must not depend on the venue: it runs standalone in
    // single-match servers and in most of this suite. If the hooks were
    // mandatory, that arrangement would crash at the first bell.
    const solo = new WorldHost({ mapId: "vessel-nexus", bots: 2, resultsHoldMs: 60_000 });
    expect(solo.onBotDisplaced).toBeUndefined();
    expect(solo.onBotRecalled).toBeUndefined();
    (solo as unknown as { host: { stop(): void } }).host?.stop?.();
  });
});
