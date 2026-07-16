// VenueHost regression tests (venue-goal.md Pillar 1).
//
// The venue is a composer: an always-on walkable lobby (MatchHost
// mode:"hangout", id "lobby") + the existing WorldHost arena, with no
// simulation of its own. The contracts pinned here:
//   1. Summary shape — lobby presence + arena with the shared nextBellMs.
//   2. The lobby NEVER recycles: arena cycle-end rebuilds must leave the
//      lobby host object identity and its connected players untouched.
//   3. Lobby attach/detach: presence counts connected humans honestly and
//      detach-to-empty does NOT dispose the host (front room stays lit).

import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import { VenueHost, VENUE_LOBBY_MATCH_ID } from "../venueHost.ts";
import { WorldHost } from "../worldHost.ts";
import type { MatchSocketData } from "../matchHost.ts";
import { DRAFT_WINDOW_MS, ROUND_OVER_HOLD_MS } from "@sim/round.ts";

function makeFakeWs(playerId: string, name?: string): ServerWebSocket<MatchSocketData> {
  return {
    data: { matchId: VENUE_LOBBY_MATCH_ID, playerId, name, authedAt: Date.now() },
    send: () => 1,
    close: () => {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<MatchSocketData>;
}

type LobbyInternals = { stop(): void; state: { players: Record<string, unknown> } };

function makeVenue(bots = 0): { venue: VenueHost; arena: WorldHost } {
  const arena = new WorldHost({ mapId: "vessel-nexus", bots });
  const venue = new VenueHost({ arena });
  // Kill the lobby's real tick interval so tests stay deterministic/clean
  // (same internals pattern as matchHostLiveness.test.ts).
  (venue.lobbyHostForTest() as unknown as LobbyInternals).stop();
  return { venue, arena };
}

describe("VenueHost summary (Pillar 1.1)", () => {
  test("shape: lobby presence + arena with nextBellMs from the shared bell math", () => {
    const { venue } = makeVenue(2); // bots eager-boot the arena
    const s = venue.summary();
    expect(s.lobby.present).toBe(0);
    expect(s.arena).not.toBeNull();
    expect(typeof s.arena!.nextBellMs).toBe("number");
    expect(s.arena!.humans).toBe(0);
    expect(s.arena!.bots).toBe(2);
    // Bell math matches the phase (fresh world boots into countdown → 0;
    // any other phase must equal the shared @sim/round.ts sum).
    const a = s.arena!;
    const expected =
      a.phase === "countdown"
        ? 0
        : a.phase === "drafting"
          ? a.countdownRemainingMs
          : a.phase === "round-over"
            ? a.countdownRemainingMs + DRAFT_WINDOW_MS
            : a.countdownRemainingMs + ROUND_OVER_HOLD_MS + DRAFT_WINDOW_MS;
    expect(a.nextBellMs).toBe(Math.round(expected));
    venue.dispose();
  });

  test("unbooted arena (no bots, nobody ever connected) → arena: null, lobby still present", () => {
    const { venue } = makeVenue(0);
    const s = venue.summary();
    expect(s.arena).toBeNull();
    expect(s.lobby.present).toBe(0);
    venue.dispose();
  });
});

describe("VenueHost lobby lifecycle (Pillar 1.2)", () => {
  test("lobby host survives an arena recycle with identity and players intact", () => {
    const { venue, arena } = makeVenue(2);
    const before = venue.lobbyHostForTest();
    venue.attachLobby(makeFakeWs("p_standing", "JAKE"));
    // Force the arena's cycle-end rebuild directly (the timer path is the
    // same method — scheduleRecycle just defers it).
    (arena as unknown as { recycle(): void }).recycle();
    const after = venue.lobbyHostForTest();
    expect(after).toBe(before); // same object — never rebuilt
    expect(after.hasPlayer("p_standing" as never)).toBe(true);
    expect(venue.summary().lobby.present).toBe(1);
    venue.dispose();
  });

  test("detach to empty does NOT dispose the lobby (front room stays lit)", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_1", "A");
    venue.attachLobby(ws);
    expect(venue.summary().lobby.present).toBe(1);
    venue.detachLobby(ws);
    expect(venue.summary().lobby.present).toBe(0);
    // Host object still alive and attachable — a new visitor walks right in.
    const again = makeFakeWs("p_2", "B");
    venue.attachLobby(again);
    expect(venue.summary().lobby.present).toBe(1);
    venue.dispose();
  });

  test("two connected clients see each other in the lobby world (mutual presence)", () => {
    // Pillar 1.4, state level: the scene-level (Phaser) connect test lands
    // with Pillar 2's VenueLobbyScene work — here we pin the server truth
    // it will render: both players exist in the same lobby sim state.
    const { venue } = makeVenue(0);
    venue.attachLobby(makeFakeWs("p_a", "AVA"));
    venue.attachLobby(makeFakeWs("p_b", "BEA"));
    const lobby = venue.lobbyHostForTest() as unknown as LobbyInternals;
    const ids = Object.keys(lobby.state.players).sort();
    expect(ids).toEqual(["p_a", "p_b"]);
    expect(venue.summary().lobby.present).toBe(2);
    venue.dispose();
  });

  test("attach spawns the chosen name; re-attach of a known player doesn't double-add", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_named", "VERA");
    venue.attachLobby(ws);
    venue.attachLobby(makeFakeWs("p_named", "VERA"));
    const lobby = venue.lobbyHostForTest() as unknown as LobbyInternals;
    const ids = Object.keys(lobby.state.players);
    expect(ids.filter((id) => id === "p_named").length).toBe(1);
    venue.dispose();
  });
});
