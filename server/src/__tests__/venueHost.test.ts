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
import { decodeMessage, encodeMessage } from "@net/protocol.ts";

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

  test("totem events toggle the bell queue; disconnect dequeues (S2.B)", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_q", "QUE");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    const lobbyOpts = venue.lobbyHostForTest() as unknown as SimEventSink;
    // Drive the same hook stepTotems fires through (the totem overlap
    // itself is covered by totem.test.ts) — both event kinds mean "toggle".
    lobbyOpts.onSimEvent?.({ t: "launch-requested", playerId: "p_q" });
    expect(venue.queuedForTest() as string[]).toEqual(["p_q"]);
    lobbyOpts.onSimEvent?.({ t: "launch-requested", playerId: "p_q" });
    expect(venue.queuedForTest() as string[]).toEqual([]);
    lobbyOpts.onSimEvent?.({ t: "ready-toggled", playerId: "p_q" });
    expect(venue.queuedForTest() as string[]).toEqual(["p_q"]);
    venue.detachLobby(ws);
    expect(venue.queuedForTest() as string[]).toEqual([]); // no ghost entrants at the drain
    venue.dispose();
  });

  test("status frames push to lobby sockets with the bell countdown and queue (S2.B)", () => {
    const { venue } = makeVenue(2); // bots boot the arena so a frame exists
    const sent: Uint8Array[] = [];
    const ws = {
      data: { matchId: VENUE_LOBBY_MATCH_ID, playerId: "p_f", name: "FEED", authedAt: Date.now() },
      send: (buf: Uint8Array) => {
        sent.push(buf);
        return 1;
      },
      close: () => {},
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<MatchSocketData>;
    venue.attachLobby(ws);
    type Broadcaster = { broadcastStatus(): void };
    (venue as unknown as Broadcaster).broadcastStatus();
    // attachClient sends a hello frame first — find the venue-status among
    // everything the socket received.
    const frames = sent
      .map((buf) => decodeMessage(buf)?.message as { t: string } | undefined)
      .filter((m): m is { t: string } => m !== undefined);
    const frame = frames.find((m) => m.t === "venue-status") as
      | {
          t: string;
          arenaPhase: string;
          nextBellMs: number;
          humans: number;
          bots: number;
          queued: string[];
        }
      | undefined;
    expect(frame).toBeDefined();
    if (!frame) throw new Error("unreachable");
    expect(typeof frame.nextBellMs).toBe("number");
    expect(frame.bots).toBe(2);
    expect(frame.humans).toBe(0);
    expect(frame.queued).toEqual([]);
    venue.dispose();
  });

  test("lobby map carries practice dummies; respawnDestructibles restores them (S2.C)", () => {
    const { venue } = makeVenue(0);
    const lobby = venue.lobbyHostForTest();
    type DestructibleInternals = {
      state: { destructibles: Record<string, unknown> };
      respawnDestructibles(): void;
    };
    const internals = lobby as unknown as DestructibleInternals;
    expect(Object.keys(internals.state.destructibles).length).toBe(3);
    // Break them all (the sim-level break path is covered by
    // hangoutMode.test.ts — here we pin the venue's respawn contract).
    internals.state = { ...internals.state, destructibles: {} };
    expect(Object.keys(internals.state.destructibles).length).toBe(0);
    internals.respawnDestructibles();
    expect(Object.keys(internals.state.destructibles).length).toBe(3);
    // Fully-stocked lobby: respawn is a no-op, not a duplicate-spawner.
    internals.respawnDestructibles();
    expect(Object.keys(internals.state.destructibles).length).toBe(3);
    venue.dispose();
  });

  test("callsign gate: a nameless client cannot queue; a named one can (S2.C.3)", () => {
    const { venue } = makeVenue(0);
    const nameless = makeFakeWs("p_anon"); // no name rides the socket
    const named = makeFakeWs("p_vera", "VERA");
    venue.attachLobby(nameless);
    venue.attachLobby(named);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    const lobbyOpts = venue.lobbyHostForTest() as unknown as SimEventSink;
    lobbyOpts.onSimEvent?.({ t: "launch-requested", playerId: "p_anon" });
    expect(venue.queuedForTest() as string[]).toEqual([]); // refused
    lobbyOpts.onSimEvent?.({ t: "launch-requested", playerId: "p_vera" });
    expect(venue.queuedForTest() as string[]).toEqual(["p_vera"]);
    venue.dispose();
  });

  test("machine-name spawns are unreachable: nameless attach spawns as RECRUIT (S2.C.3)", () => {
    const { venue } = makeVenue(0);
    venue.attachLobby(makeFakeWs("p_opaque_id_123"));
    // Names live on the roster (playerInfo → hello frames), not in sim state.
    const lobby = venue.lobbyHostForTest() as unknown as {
      playerInfo: Map<string, { name: string }>;
    };
    const me = lobby.playerInfo.get("p_opaque_id_123")!;
    expect(me.name).toBe("RECRUIT");
    expect(me.name).not.toBe("p_opaque_id_123");
    venue.dispose();
  });

  test("queueing rolls a 3-card starter offer and pushes venue-draft (S2.E)", () => {
    const { venue } = makeVenue(0);
    const sent: Uint8Array[] = [];
    const ws = {
      data: { matchId: VENUE_LOBBY_MATCH_ID, playerId: "p_d", name: "DRAFTY", authedAt: Date.now() },
      send: (buf: Uint8Array) => {
        sent.push(buf);
        return 1;
      },
      close: () => {},
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<MatchSocketData>;
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "launch-requested",
      playerId: "p_d",
    });
    const entry = venue.queueEntryForTest("p_d" as never);
    expect(entry).toBeDefined();
    expect(entry!.offers.length).toBe(3);
    expect(new Set(entry!.offers).size).toBe(3); // distinct
    expect(entry!.pick).toBeNull();
    const frames = sent
      .map((buf) => decodeMessage(buf)?.message as { t: string; offers?: string[] } | undefined)
      .filter((m): m is { t: string; offers?: string[] } => m !== undefined);
    const draft = frames.find((m) => m.t === "venue-draft");
    expect(draft).toBeDefined();
    expect(draft!.offers).toEqual(entry!.offers);
    venue.dispose();
  });

  test("card-pick over the lobby socket lands on the queue entry; bad ids ignored (S2.E)", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_p", "PICKY");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "launch-requested",
      playerId: "p_p",
    });
    const entry = venue.queueEntryForTest("p_p" as never)!;
    const chosen = entry.offers[1]!;
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: "not-offered" }));
    expect(venue.queueEntryForTest("p_p" as never)!.pick).toBeNull();
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: chosen }));
    expect(venue.queueEntryForTest("p_p" as never)!.pick).toBe(chosen);
    venue.dispose();
  });

  test("getEntrantCards provider: pick wins, leftmost auto-pick otherwise, non-queued plain (S2.E)", () => {
    const { venue, arena } = makeVenue(0);
    const ws = makeFakeWs("p_q2", "QUEUER");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "launch-requested",
      playerId: "p_q2",
    });
    const entry = venue.queueEntryForTest("p_q2" as never)!;
    // No pick yet → leftmost auto-pick.
    expect(arena.getEntrantCards!("p_q2" as never)).toEqual([entry.offers[0]!]);
    // Picked → exactly the pick.
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: entry.offers[2]! }));
    expect(arena.getEntrantCards!("p_q2" as never)).toEqual([entry.offers[2]!]);
    // Never queued → plain spawn.
    expect(arena.getEntrantCards!("p_stranger" as never)).toBeUndefined();
    venue.dispose();
  });

  test("the bell admits the whole queue: venue-admitted pushed, picks banked, queue cleared (S2.F)", () => {
    const { venue, arena } = makeVenue(0);
    const sent: Uint8Array[] = [];
    const ws = {
      data: { matchId: VENUE_LOBBY_MATCH_ID, playerId: "p_adm", name: "ADMIT", authedAt: Date.now() },
      send: (buf: Uint8Array) => {
        sent.push(buf);
        return 1;
      },
      close: () => {},
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<MatchSocketData>;
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "launch-requested",
      playerId: "p_adm",
    });
    const offers = venue.queueEntryForTest("p_adm" as never)!.offers;
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: offers[1]! }));

    // The arena's phase edge into countdown IS the bell (the same hook the
    // live tick fires) — drive it directly.
    arena.onRoundPhaseChange?.("drafting", "countdown");

    // Queue emptied; the admitted frame reached the lobby socket.
    expect(venue.queuedForTest()).toEqual([]);
    const frames = sent
      .map((buf) => decodeMessage(buf)?.message as { t: string; arenaWsPath?: string } | undefined)
      .filter((m): m is { t: string; arenaWsPath?: string } => m !== undefined);
    const admitted = frames.find((m) => m.t === "venue-admitted");
    expect(admitted).toBeDefined();
    expect(admitted!.arenaWsPath).toBe("/ws/world");
    // The banked pick survives the dequeue and is consumed exactly once.
    expect(arena.getEntrantCards!("p_adm" as never)).toEqual([offers[1]!]);
    expect(arena.getEntrantCards!("p_adm" as never)).toBeUndefined();
    venue.dispose();
  });

  test("no double-presence accounting: admission dequeues even with the lobby socket still open (S2.F)", () => {
    const { venue, arena } = makeVenue(0);
    const ws = makeFakeWs("p_dp", "DOUBLE");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "launch-requested",
      playerId: "p_dp",
    });
    expect(venue.queuedForTest() as string[]).toEqual(["p_dp"]);
    arena.onRoundPhaseChange?.("drafting", "countdown");
    // Still standing in the lobby (socket open) but no longer queued —
    // the venue-status `queued` list and `present` count stay honest
    // through the handoff window.
    expect(venue.queuedForTest()).toEqual([]);
    expect(venue.summary().lobby.present).toBe(1);
    venue.detachLobby(ws);
    expect(venue.summary().lobby.present).toBe(0);
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
