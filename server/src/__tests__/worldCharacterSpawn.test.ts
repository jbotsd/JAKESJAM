// Class era P1 (docs/classes-goal.md): the chassis pick rides SocketData
// (upgrade-sanitized `character`, same side-channel as `name`) into every
// spawn path. Contracts pinned here:
//   1. WorldHost.attach (fresh host boot) spawns with the picked chassis.
//   2. A recycle re-spawns every socket with its chassis intact (the same
//      "chosen names ride the socket data" rule, extended).
//   3. Absent character (old client) spawns the default chassis.
//   4. VenueHost.attachLobby honors the pick too (the venue vessel wears
//      the class body in the antechamber).

import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import { WorldHost } from "../worldHost.ts";
import { VenueHost, VENUE_LOBBY_MATCH_ID } from "../venueHost.ts";
import type { MatchHost, MatchSocketData } from "../matchHost.ts";
import type { WorldState } from "@sim/types.ts";

type HostInternals = {
  state: WorldState;
  stop(): void;
};

function fakeWs(
  playerId: string,
  name?: string,
  character?: string,
  matchId = "world",
): ServerWebSocket<MatchSocketData> {
  const ws = {
    readyState: 1,
    data: { matchId, playerId, name, character, authedAt: Date.now() },
    send: () => 1,
    close() {
      (ws as { readyState: number }).readyState = 3;
    },
    getBufferedAmount: () => 0,
  };
  return ws as unknown as ServerWebSocket<MatchSocketData>;
}

function hostInternals(wh: WorldHost): HostInternals {
  const host = (wh as unknown as { host: MatchHost | null }).host;
  expect(host).not.toBeNull();
  const hi = host as unknown as HostInternals;
  hi.stop();
  return hi;
}

describe("chassis pick rides the world spawn (classes-goal P1)", () => {
  test("attach with character spawns that archetype", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 60_000 });
    wh.attach(fakeWs("p_ninja", "SHADOW", "sprinter"));
    const hi = hostInternals(wh);
    expect(hi.state.players["p_ninja" as never]?.characterId).toBe("sprinter");
  });

  test("attach without character (old client) spawns the default", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 60_000 });
    wh.attach(fakeWs("p_plain", "PLAIN"));
    const hi = hostInternals(wh);
    expect(hi.state.players["p_plain" as never]?.characterId).toBe("balanced");
  });

  test("recycle re-spawns sockets with their chassis intact", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 60_000 });
    wh.attach(fakeWs("p_pal", "BULWARK", "heavy"));
    hostInternals(wh); // stop the boot host's loop
    (wh as unknown as { recycle(): void }).recycle();
    const hi = hostInternals(wh);
    expect(hi.state.players["p_pal" as never]?.characterId).toBe("heavy");
  });

  test("venue lobby attach honors the pick (antechamber wears the body)", () => {
    const arena = new WorldHost({ mapId: "vessel-nexus" });
    const venue = new VenueHost({ arena });
    const lobby = venue.lobbyHostForTest() as unknown as HostInternals;
    lobby.stop();
    venue.attachLobby(fakeWs("p_priest", "VESPER", "shielded", VENUE_LOBBY_MATCH_ID));
    expect(lobby.state.players["p_priest" as never]?.characterId).toBe("shielded");
    venue.dispose();
  });
});
