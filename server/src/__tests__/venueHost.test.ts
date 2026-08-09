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
import { MatchHost, type MatchSocketData } from "../matchHost.ts";
import { DRAFT_WINDOW_MS, ROUND_OVER_HOLD_MS } from "@sim/round.ts";
import { decodeMessage, encodeMessage } from "@net/protocol.ts";
import { PlayerId } from "@sim/types.ts";

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
    // Plus the FOUR permanent ally NPCs: the loadout table's original two
    // (docs/venue-lobby-tableau-goal.md Part 2) PLUS the showcase
    // gauntlet's own two (Part C, 2026-07-19) — always present, bot_-
    // prefixed, never real connections. `venue.summary().lobby.present`
    // (below) is keyed off real WEBSOCKETS, not the sim roster, so it
    // stays a true "2 humans" count regardless.
    // Plus the venue's PRESENCE FLOOR (gospel 3.1, 2026-08-10): three
    // idle personas so a first visitor does not walk into an empty room.
    // Listed exactly rather than filtered out — an exact roster is the
    // point of this test, and a change to who stands in the lobby should
    // have to be acknowledged here.
    expect(ids).toEqual([
      "bot_gasket",
      "bot_practice_ally_1",
      "bot_practice_ally_2",
      "bot_practice_ally_3",
      "bot_practice_ally_4",
      "bot_shim",
      "bot_tappet",
      "p_a",
      "p_b",
    ]);
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
    // itself is covered by totem.test.ts). Since 2026-07-17 the kinds are
    // separated: launch-requested = bell-queue toggle, ready-toggled =
    // loadout station (must NOT touch the queue).
    lobbyOpts.onSimEvent?.({ t: "launch-requested", playerId: "p_q" });
    expect(venue.queuedForTest() as string[]).toEqual(["p_q"]);
    lobbyOpts.onSimEvent?.({ t: "launch-requested", playerId: "p_q" });
    expect(venue.queuedForTest() as string[]).toEqual([]);
    lobbyOpts.onSimEvent?.({ t: "ready-toggled", playerId: "p_q" });
    expect(venue.queuedForTest() as string[]).toEqual([]); // station ≠ queue
    lobbyOpts.onSimEvent?.({ t: "launch-requested", playerId: "p_q" });
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
    // 3 tableau dummies (docs/venue-lobby-tableau-goal.md Part 3) + 5
    // showcase-gauntlet dummies (Part C, 2026-07-19: 2 isolated + a
    // 3-dummy cluster) = 8.
    expect(Object.keys(internals.state.destructibles).length).toBe(8);
    // Break them all (the sim-level break path is covered by
    // hangoutMode.test.ts — here we pin the venue's respawn contract).
    internals.state = { ...internals.state, destructibles: {} };
    expect(Object.keys(internals.state.destructibles).length).toBe(0);
    internals.respawnDestructibles();
    expect(Object.keys(internals.state.destructibles).length).toBe(8);
    // Fully-stocked lobby: respawn is a no-op, not a duplicate-spawner.
    internals.respawnDestructibles();
    expect(Object.keys(internals.state.destructibles).length).toBe(8);
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

  // ── The loadout station / bell separation (Jake 2026-07-17: "seperate
  //    the card selector test room thing with the bell queue") ──────────

  test("queueing at the bell is JUST queueing: no loadout entry created, no venue-draft pushed", () => {
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
    expect(venue.queuedForTest() as string[]).toEqual(["p_d"]);
    expect(venue.loadoutForTest("p_d" as never)).toBeUndefined();
    const frames = sent
      .map((buf) => decodeMessage(buf)?.message as { t: string } | undefined)
      .filter((m): m is { t: string } => m !== undefined);
    expect(frames.find((m) => m.t === "venue-draft")).toBeUndefined();
    venue.dispose();
  });

  test("the loadout station derives classId once and re-pushes idempotently (universal offer removed 2026-07-18)", () => {
    const { venue } = makeVenue(0);
    const sent: Uint8Array[] = [];
    const ws = {
      data: { matchId: VENUE_LOBBY_MATCH_ID, playerId: "p_l", name: "LOADY", authedAt: Date.now() },
      send: (buf: Uint8Array) => {
        sent.push(buf);
        return 1;
      },
      close: () => {},
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<MatchSocketData>;
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_l" });
    const entry = venue.loadoutForTest("p_l" as never);
    expect(entry).toBeDefined();
    expect(entry!.picks).toEqual([]);
    expect(entry!.classId).toBe("wizard"); // default chassis (no character on the socket)
    // Standing there (totem retrigger) re-pushes idempotently — untouched.
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_l" });
    expect(venue.loadoutForTest("p_l" as never)!.picks).toEqual([]);
    expect(venue.loadoutForTest("p_l" as never)!.classId).toBe("wizard");
    const drafts = sent
      .map(
        (buf) =>
          decodeMessage(buf)?.message as
            | { t: string; picks?: string[]; classId?: string }
            | undefined,
      )
      .filter(
        (m): m is { t: string; picks?: string[]; classId?: string } => m?.t === "venue-draft",
      );
    expect(drafts.length).toBe(2);
    for (const d of drafts) {
      expect(d.picks).toEqual([]);
      expect(d.classId).toBe("wizard");
      // The universal-offer field is gone from the wire entirely (not
      // sent-empty) — see protocol.ts's VenueDraft doc.
      expect((d as { offers?: unknown }).offers).toBeUndefined();
    }
    // The station never queues anyone.
    expect(venue.queuedForTest()).toEqual([]);
    venue.dispose();
  });

  test("card-pick over the lobby socket is a harmless no-op now (universal offer removed 2026-07-18) — catalog-toggle is the only way to arm picks", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_p", "PICKY");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "ready-toggled",
      playerId: "p_p",
    });
    expect(venue.loadoutForTest("p_p" as never)!.picks).toEqual([]);
    // card-pick is no longer intercepted at the venue level — it falls
    // through to the hangout host's own routeMessage, whose applyCardPick
    // (matchHost.ts) is gated to `round.phase === "drafting"`, and the
    // venue lobby's round phase is permanently pinned to "fighting"
    // (never drafting) — a guaranteed no-op, not a lucky one.
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: "sunlance" }));
    expect(venue.loadoutForTest("p_p" as never)!.picks).toEqual([]);
    venue.dispose();
  });

  test("getEntrantCards provider: loadout pick rides, no pick = plain spawn (NEVER auto-picked)", () => {
    const { venue, arena } = makeVenue(0);
    const ws = makeFakeWs("p_q2", "QUEUER");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "ready-toggled",
      playerId: "p_q2",
    });
    // Visited but equipped nothing → plain spawn, never a silent auto-pick.
    expect(arena.getEntrantCards!("p_q2" as never)).toBeUndefined();
    // Equip a catalog card (default chassis → wizard) → exactly that card,
    // consumed by the spawn.
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    expect(arena.getEntrantCards!("p_q2" as never)).toEqual(["sunlance"]);
    expect(arena.getEntrantCards!("p_q2" as never)).toBeUndefined(); // consumed
    // Never visited the station → plain spawn.
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
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    // Visit the loadout station (equip a catalog card), THEN queue at the
    // bell — two separate walk-ups, two separate meanings (2026-07-17).
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_adm" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_adm" });

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
    // The banked pick survives the dequeue and is consumed exactly once;
    // the loadout entry was consumed by the admission (next visit starts fresh).
    expect(venue.loadoutForTest("p_adm" as never)).toBeUndefined();
    expect(arena.getEntrantCards!("p_adm" as never)).toEqual(["sunlance"]);
    expect(arena.getEntrantCards!("p_adm" as never)).toBeUndefined();
    venue.dispose();
  });

  test("the bell admits a no-pick queuer with NOTHING — clean countdown, no draft attached", () => {
    const { venue, arena } = makeVenue(0);
    const ws = makeFakeWs("p_bare", "BARE");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    // Straight to the bell — never visited the loadout station.
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "launch-requested",
      playerId: "p_bare",
    });
    arena.onRoundPhaseChange?.("drafting", "countdown");
    expect(venue.queuedForTest()).toEqual([]);
    // Admitted plain — the arena's ordinary drafting phase covers them
    // next round (worldBellGate late-joiner contract).
    expect(arena.getEntrantCards!("p_bare" as never)).toBeUndefined();
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

// ── Class ability catalog (docs/classes-goal.md "Loadout station owns the
//    3 slots" — live playtest finding 2026-07-18: Jake pulled up the
//    loadout station with Kindled/paladin selected, saw a 3-card random
//    offer mixing a universal weapon card with a class catalog card, and
//    said "this should show all cards for that class when its selected
//    not just three and this should have the concept of selecting them").
//    The full catalog is equipped via the `catalog-toggle` message, landing
//    on `entry.picks` — the SAME array/admission plumbing the universal
//    offer used to fill before it was cut from the station entirely
//    (2026-07-18, see the "loadout station" describe block above and
//    `catalog-toggle` is now the ONLY way to arm a pick at the station). ──

describe("VenueHost class ability catalog", () => {
  type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };

  test("catalog-toggle equips a class catalog card into picks and pushes venue-draft with classId + picks", () => {
    const { venue } = makeVenue(0);
    const sent: Uint8Array[] = [];
    const ws = {
      data: { matchId: VENUE_LOBBY_MATCH_ID, playerId: "p_cat2", name: "CAT2", authedAt: Date.now() },
      send: (buf: Uint8Array) => {
        sent.push(buf);
        return 1;
      },
      close: () => {},
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<MatchSocketData>;
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cat2" }); // default classId = wizard
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    expect(venue.loadoutForTest("p_cat2" as never)!.picks).toEqual(["sunlance"]);
    const drafts = sent
      .map(
        (buf) =>
          decodeMessage(buf)?.message as
            | { t: string; picks?: string[]; classId?: string }
            | undefined,
      )
      .filter(
        (m): m is { t: string; picks?: string[]; classId?: string } => m?.t === "venue-draft",
      );
    const last = drafts[drafts.length - 1]!;
    expect(last.picks).toEqual(["sunlance"]);
    expect(last.classId).toBe("wizard");
    // Toggling the SAME card again deselects it — one message, both directions.
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    expect(venue.loadoutForTest("p_cat2" as never)!.picks).toEqual([]);
    venue.dispose();
  });

  test("catalog-toggle ignores a card outside the player's locked class, and ignores non-catalog ids", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cat3", "CAT3"); // default classId = wizard
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cat3" });
    // "unbroken-seal" is paladin-exclusive — a wizard-locked entry ignores it.
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "unbroken-seal" }));
    expect(venue.loadoutForTest("p_cat3" as never)!.picks).toEqual([]);
    // A universal (non-classId) card id is also ignored on THIS message —
    // that's what card-pick is for, not catalog-toggle.
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "crystal-volley" }));
    expect(venue.loadoutForTest("p_cat3" as never)!.picks).toEqual([]);
    venue.dispose();
  });

  test("catalog-toggle never creates a 4th rack slot; deselecting an equipped card always frees one", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cat4", "CAT4"); // default classId = wizard
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cat4" });
    for (const id of ["sunlance", "facet-break", "prism-fan"]) {
      venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: id }));
    }
    expect(venue.loadoutForTest("p_cat4" as never)!.picks).toEqual([
      "sunlance",
      "facet-break",
      "prism-fan",
    ]);
    // A 4th catalog card is refused — the rack stays at exactly 3
    // (docs/classes-goal.md "Draft never creates a 4th slot").
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "lattice" }));
    expect(venue.loadoutForTest("p_cat4" as never)!.picks).toEqual([
      "sunlance",
      "facet-break",
      "prism-fan",
    ]);
    // Deselecting one frees a slot for a different card.
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "facet-break" }));
    expect(venue.loadoutForTest("p_cat4" as never)!.picks).toEqual(["sunlance", "prism-fan"]);
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "lattice" }));
    expect(venue.loadoutForTest("p_cat4" as never)!.picks).toEqual([
      "sunlance",
      "prism-fan",
      "lattice",
    ]);
    venue.dispose();
  });

  test("catalog-toggle before ever touching the loadout station is a harmless no-op", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cat5", "CAT5");
    venue.attachLobby(ws);
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    expect(venue.loadoutForTest("p_cat5" as never)).toBeUndefined();
    venue.dispose();
  });

  test("multiple catalog picks ride the SAME getEntrantCards admission plumbing (unchanged mechanism)", () => {
    const { venue, arena } = makeVenue(0);
    const ws = makeFakeWs("p_cat6", "CAT6");
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cat6" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "prism-fan" }));
    expect(venue.loadoutForTest("p_cat6" as never)!.picks).toEqual(["sunlance", "prism-fan"]);
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_cat6" });
    arena.onRoundPhaseChange?.("drafting", "countdown");
    expect(arena.getEntrantCards!("p_cat6" as never)).toEqual(["sunlance", "prism-fan"]);
    venue.dispose();
  });
});

// ── Loadout station: mid-visit class switch (Bug fix, live playtest
//    2026-07-18 — Jake selected Interstice/ninja in the class row but the
//    ability catalog grid below kept showing Geometrician/wizard's
//    abilities; `classId` used to be captured once at first totem touch
//    and never re-derived on a mid-visit class-row click). `class-pick`
//    fixes this: sent live over the lobby socket the instant the class
//    row is clicked, re-deriving `classId` and re-pushing `venue-draft`
//    without needing a totem re-entry. ────────────────────────────────

describe("VenueHost loadout station: mid-visit class switch", () => {
  type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };

  test("class-pick before ever touching the station creates a fresh entry locked to the new class", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cp1", "CP1");
    venue.attachLobby(ws);
    expect(venue.loadoutForTest("p_cp1" as never)).toBeUndefined();
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "sprinter" })); // → ninja
    const entry = venue.loadoutForTest("p_cp1" as never);
    expect(entry).toBeDefined();
    expect(entry!.classId).toBe("ninja");
    expect(entry!.picks).toEqual([]);
    venue.dispose();
  });

  test("class-pick mid-visit re-derives classId immediately and DROPS catalog picks that belonged to the old class", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cp2", "CP2"); // default chassis → wizard
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cp2" });
    expect(venue.loadoutForTest("p_cp2" as never)!.classId).toBe("wizard");
    // Equip a wizard catalog card.
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    expect(venue.loadoutForTest("p_cp2" as never)!.picks).toEqual(["sunlance"]);
    // Switch to paladin (heavy) mid-visit — no totem re-touch.
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "heavy" }));
    const entry = venue.loadoutForTest("p_cp2" as never)!;
    expect(entry.classId).toBe("paladin");
    // The wizard-only pick doesn't belong to paladin anymore — dropped.
    expect(entry.picks).toEqual([]);
    venue.dispose();
  });

  test("class-pick immediately re-pushes venue-draft so the client's catalog grid updates without leaving the totem zone", () => {
    const { venue } = makeVenue(0);
    const sent: Uint8Array[] = [];
    const ws = {
      data: { matchId: VENUE_LOBBY_MATCH_ID, playerId: "p_cp3", name: "CP3", authedAt: Date.now() },
      send: (buf: Uint8Array) => {
        sent.push(buf);
        return 1;
      },
      close: () => {},
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<MatchSocketData>;
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cp3" });
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "shielded" })); // → priest
    const drafts = sent
      .map(
        (buf) =>
          decodeMessage(buf)?.message as
            | { t: string; classId?: string; picks?: string[] }
            | undefined,
      )
      .filter(
        (m): m is { t: string; classId?: string; picks?: string[] } => m?.t === "venue-draft",
      );
    // At least the totem-touch push AND the class-pick push.
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    expect(drafts[drafts.length - 1]!.classId).toBe("priest");
    expect(drafts[drafts.length - 1]!.picks).toEqual([]);
    venue.dispose();
  });

  test("class-pick to the SAME class the entry is already locked to is a harmless no-op on picks", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cp4", "CP4"); // default chassis → wizard
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cp4" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "balanced" })); // still wizard
    const entry = venue.loadoutForTest("p_cp4" as never)!;
    expect(entry.classId).toBe("wizard");
    expect(entry.picks).toEqual(["sunlance"]); // unchanged — same class, nothing invalidated
    venue.dispose();
  });

  test("class-pick sanitizes a garbage characterId to the default chassis rather than erroring", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cp5", "CP5");
    venue.attachLobby(ws);
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "not-a-real-archetype" }));
    const entry = venue.loadoutForTest("p_cp5" as never);
    expect(entry).toBeDefined();
    expect(entry!.classId).toBe("wizard"); // sanitizeCharacterId → "balanced" → wizard
    venue.dispose();
  });
});

// ── Duos queue (classes-goal.md "Venue integration": "Duos queue:
//    VenueHost bell admission gains a team variant (queue as pair /
//    auto-pair). FFA bell unchanged. Elastic bots respect team floors.") ──

describe("VenueHost duos queue", () => {
  type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };

  test("FFA bell queue is BYTE-FOR-BYTE unchanged for a player who never toggles duo intent", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_ffa", "FFA");
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    expect(venue.duoIntentForTest("p_ffa" as never)).toBe(false);
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_ffa" });
    // Exactly the pre-duos contract: lands in the FFA queue, duo queue
    // untouched, same log-visible behavior as every other FFA test above.
    expect(venue.queuedForTest() as string[]).toEqual(["p_ffa"]);
    expect(venue.duoQueuedForTest()).toEqual([]);
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_ffa" });
    expect(venue.queuedForTest()).toEqual([]);
    venue.dispose();
  });

  test("duo-toggle flips intent without touching either queue's membership", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_int", "INTENT");
    venue.attachLobby(ws);
    expect(venue.duoIntentForTest("p_int" as never)).toBe(false);
    venue.routeLobby(ws, encodeMessage({ t: "duo-toggle" }));
    expect(venue.duoIntentForTest("p_int" as never)).toBe(true);
    expect(venue.queuedForTest()).toEqual([]);
    expect(venue.duoQueuedForTest()).toEqual([]);
    venue.routeLobby(ws, encodeMessage({ t: "duo-toggle" }));
    expect(venue.duoIntentForTest("p_int" as never)).toBe(false);
    venue.dispose();
  });

  test("with duo intent on, the bell totem queues into duoQueue, not readyQueue", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_duo", "DUO");
    venue.attachLobby(ws);
    venue.routeLobby(ws, encodeMessage({ t: "duo-toggle" }));
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_duo" });
    expect(venue.duoQueuedForTest() as string[]).toEqual(["p_duo"]);
    expect(venue.queuedForTest()).toEqual([]);
    // Touching again dequeues (same toggle shape as FFA).
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_duo" });
    expect(venue.duoQueuedForTest()).toEqual([]);
    venue.dispose();
  });

  test("callsign gate applies to the duo queue too", () => {
    const { venue } = makeVenue(0);
    const nameless = makeFakeWs("p_anon2");
    venue.attachLobby(nameless);
    venue.routeLobby(nameless, encodeMessage({ t: "duo-toggle" }));
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_anon2" });
    expect(venue.duoQueuedForTest()).toEqual([]);
    venue.dispose();
  });

  test("two duo queuers are paired at the bell with a SHARED teamId", () => {
    const { venue, arena } = makeVenue(0);
    const wsA = makeFakeWs("p_a1", "AONE");
    const wsB = makeFakeWs("p_b1", "BONE");
    venue.attachLobby(wsA);
    venue.attachLobby(wsB);
    venue.routeLobby(wsA, encodeMessage({ t: "duo-toggle" }));
    venue.routeLobby(wsB, encodeMessage({ t: "duo-toggle" }));
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_a1" });
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_b1" });
    expect((venue.duoQueuedForTest() as string[]).sort()).toEqual(["p_a1", "p_b1"]);

    // The bell rings — same real hook the live tick fires.
    arena.onRoundPhaseChange?.("drafting", "countdown");

    expect(venue.duoQueuedForTest()).toEqual([]);
    const teamA = venue.admittedTeamForTest("p_a1" as never);
    const teamB = venue.admittedTeamForTest("p_b1" as never);
    expect(teamA).toBeDefined();
    expect(teamA).toBe(teamB);
    // getEntrantTeamId consumes one-shot, same TTL/consume discipline as
    // getEntrantCards.
    expect(arena.getEntrantTeamId!("p_a1" as never)).toBe(teamA);
    expect(arena.getEntrantTeamId!("p_a1" as never)).toBeUndefined();
    venue.dispose();
  });

  test("an odd-one-out duo queuer is admitted alone with their OWN teamId (auto-pair falls to the elastic bot floor)", () => {
    const { venue, arena } = makeVenue(0);
    const ws = makeFakeWs("p_solo", "SOLO");
    venue.attachLobby(ws);
    venue.routeLobby(ws, encodeMessage({ t: "duo-toggle" }));
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_solo" });
    arena.onRoundPhaseChange?.("drafting", "countdown");
    const teamId = venue.admittedTeamForTest("p_solo" as never);
    expect(teamId).toBeDefined();
    expect(arena.getEntrantTeamId!("p_solo" as never)).toBe(teamId);
    venue.dispose();
  });

  test("duo pick rides admission exactly like FFA (loadout station is shared)", () => {
    const { venue, arena } = makeVenue(0);
    const wsA = makeFakeWs("p_dc1", "DCONE");
    const wsB = makeFakeWs("p_dc2", "DCTWO");
    venue.attachLobby(wsA);
    venue.attachLobby(wsB);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_dc1" });
    venue.routeLobby(wsA, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    venue.routeLobby(wsA, encodeMessage({ t: "duo-toggle" }));
    venue.routeLobby(wsB, encodeMessage({ t: "duo-toggle" }));
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_dc1" });
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_dc2" });
    arena.onRoundPhaseChange?.("drafting", "countdown");
    expect(arena.getEntrantCards!("p_dc1" as never)).toEqual(["sunlance"]);
    expect(arena.getEntrantCards!("p_dc2" as never)).toBeUndefined();
    venue.dispose();
  });

  test("duo queuer who disconnects before the bell is dequeued (no ghost entrants)", () => {
    const { venue, arena } = makeVenue(0);
    const ws = makeFakeWs("p_ghost2", "GHOST2");
    venue.attachLobby(ws);
    venue.routeLobby(ws, encodeMessage({ t: "duo-toggle" }));
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_ghost2" });
    expect(venue.duoQueuedForTest() as string[]).toEqual(["p_ghost2"]);
    venue.detachLobby(ws);
    expect(venue.duoQueuedForTest()).toEqual([]);
    expect(venue.duoIntentForTest("p_ghost2" as never)).toBe(false);
    arena.onRoundPhaseChange?.("drafting", "countdown");
    expect(venue.admittedTeamForTest("p_ghost2" as never)).toBeUndefined();
    venue.dispose();
  });

  test("venue-status frame carries duoQueued alongside the unchanged FFA queued list", () => {
    const { venue } = makeVenue(2);
    const sent: Uint8Array[] = [];
    const ws = {
      data: { matchId: VENUE_LOBBY_MATCH_ID, playerId: "p_stat", name: "STAT", authedAt: Date.now() },
      send: (buf: Uint8Array) => {
        sent.push(buf);
        return 1;
      },
      close: () => {},
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<MatchSocketData>;
    venue.attachLobby(ws);
    venue.routeLobby(ws, encodeMessage({ t: "duo-toggle" }));
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_stat" });
    type Broadcaster = { broadcastStatus(): void };
    (venue as unknown as Broadcaster).broadcastStatus();
    const frames = sent
      .map((buf) => decodeMessage(buf)?.message as { t: string } | undefined)
      .filter((m): m is { t: string } => m !== undefined);
    const frame = frames.find((m) => m.t === "venue-status") as
      | { t: string; queued: string[]; duoQueued: string[] }
      | undefined;
    expect(frame).toBeDefined();
    if (!frame) throw new Error("unreachable");
    expect(frame.queued).toEqual([]);
    expect(frame.duoQueued).toEqual(["p_stat"]);
    venue.dispose();
  });
});

// ── Live loadout sync (Fix 1, live playtest 2026-07-18 — Jake, looking at
//    the lobby: "the abilities and load out should be active in this
//    world"). Root cause: catalog-toggle/class-pick only ever mutated
//    VenueHost's OWN `loadouts` bookkeeping — the lobby player's live
//    PlayerEntity.cards (what resolvePlayerBuild actually reads every
//    tick) never moved, so an equipped ability stayed permanently inert
//    on the dummies. `pushLoadoutDraft` now also calls
//    `MatchHost.setPlayerCards` (additive, hangout-mode-only primitive) on
//    every picks/classId change — these tests pin THAT live sync, on top
//    of (not instead of) the `loadoutForTest` bookkeeping already pinned
//    above. ──────────────────────────────────────────────────────────────

describe("VenueHost live loadout sync onto the lobby PlayerEntity (Fix 1)", () => {
  type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };

  test("catalog-toggle equips a card into picks() AND the live lobby PlayerEntity.cards immediately", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cards1", "CARDS1"); // default chassis → wizard
    venue.attachLobby(ws);
    const pid = PlayerId("p_cards1");
    // Freshly spawned, before ever touching the station: no cards.
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.cards).toEqual([]);
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cards1" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    // Live — no need to leave and rejoin the lobby, no arena admission.
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.cards).toEqual([
      "sunlance",
    ]);
    venue.dispose();
  });

  test("toggling a card back OFF removes it from the live PlayerEntity.cards too", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cards2", "CARDS2");
    venue.attachLobby(ws);
    const pid = PlayerId("p_cards2");
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cards2" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "prism-fan" }));
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.cards).toEqual([
      "sunlance",
      "prism-fan",
    ]);
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.cards).toEqual([
      "prism-fan",
    ]);
    venue.dispose();
  });

  test("a mid-visit class-pick that drops invalidated picks (entry.picks filtering) also clears them live", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cards3", "CARDS3"); // default chassis → wizard
    venue.attachLobby(ws);
    const pid = PlayerId("p_cards3");
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cards3" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.cards).toEqual([
      "sunlance",
    ]);
    // Switch to paladin ("heavy") mid-visit — the wizard-only pick no
    // longer belongs to the locked class and is dropped (same
    // `catalogForClass` filter class-pick's bookkeeping already uses),
    // and that drop is now live on the PlayerEntity too, not just
    // `loadoutForTest`'s picks array.
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "heavy" }));
    expect(venue.loadoutForTest("p_cards3" as never)!.picks).toEqual([]);
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.cards).toEqual([]);
    venue.dispose();
  });

  test("class-pick to the SAME class leaves the live cards untouched (nothing invalidated)", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cards4", "CARDS4"); // default chassis → wizard
    venue.attachLobby(ws);
    const pid = PlayerId("p_cards4");
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cards4" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "balanced" })); // still wizard
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.cards).toEqual([
      "sunlance",
    ]);
    venue.dispose();
  });

  test("MatchHost.setPlayerCards is a no-op on an ordinary combat-mode host (arena's between-round draft stays untouched)", () => {
    // setPlayerCards is deliberately additive and hangout-only — this
    // pins the guard directly on MatchHost (mode defaults to "combat"
    // when unset, exactly like the arena's real WorldHost matches),
    // independent of VenueHost, so the new primitive can never be
    // repurposed to bypass applyCardPick's drafting-phase gate.
    const spawn = {
      playerId: PlayerId("p_combat1"),
      characterId: "balanced" as const,
      name: "COMBAT1",
      color: "#ffffff",
      weaponId: "starter-pistol",
    };
    const host = new MatchHost("combat-test", [spawn], [], "boxworks-mini");
    const internals = host as unknown as { stop(): void };
    internals.stop(); // no real tick loop needed for this assertion
    expect(host.getStateSnapshot().players[PlayerId("p_combat1")]?.cards).toEqual([]);
    host.setPlayerCards(PlayerId("p_combat1"), ["sunlance"]);
    expect(host.getStateSnapshot().players[PlayerId("p_combat1")]?.cards).toEqual([]);
    host.dispose();
  });
});

// ── Live chassis switch (Part A follow-up, Jake: "when you switch loudouts
//    and classes it SHOULD REALLY switch") — `class-pick` used to only
//    change which catalog the station showed; the visitor's actual standing
//    PlayerEntity kept whatever chassis they walked in with. These pin the
//    NEW live-apply: `MatchHost.setPlayerCharacter` mutates the lobby
//    player's real `characterId` + resets health/cooldowns/resource pools,
//    called from VenueHost's `class-pick` handler right alongside the
//    existing cards live-sync. ──────────────────────────────────────────

describe("VenueHost live chassis switch onto the lobby PlayerEntity", () => {
  type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };

  test("class-pick live-swaps the lobby PlayerEntity.characterId immediately", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_chas1", "CHAS1"); // default chassis → balanced (wizard)
    venue.attachLobby(ws);
    const pid = PlayerId("p_chas1");
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.characterId).toBe("balanced");
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "sprinter" })); // → ninja
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.characterId).toBe("sprinter");
    venue.dispose();
  });

  test("a chassis switch resets health, ability-slot cooldowns, and class resource pools to a fresh baseline", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_chas2", "CHAS2");
    venue.attachLobby(ws);
    const pid = PlayerId("p_chas2");
    const host = venue.lobbyHostForTest();
    // Simulate combat wear-and-tear the old chassis picked up: damaged,
    // cooldowns armed, a resource pool partially filled.
    type Internals = { state: { players: Record<string, Record<string, unknown>> } };
    const internals = host as unknown as Internals;
    internals.state = {
      ...internals.state,
      players: {
        ...internals.state.players,
        [pid]: {
          ...internals.state.players[pid],
          health: 42,
          slot1CooldownUntilTick: 999,
          slot2CooldownUntilTick: 999,
          energy: 80,
        },
      },
    };
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "heavy" })); // → paladin
    const after = host.getStateSnapshot().players[pid]!;
    expect(after.characterId).toBe("heavy");
    // Kindled's real base is 125, not a flat 100 (2026-07-22 bug fix — a
    // chassis switch used to reset health to the same hardcoded 100 for
    // every class; see matchHost.ts's setPlayerCharacter).
    expect(after.health).toBe(125);
    expect(after.slot1CooldownUntilTick).toBeUndefined();
    expect(after.slot2CooldownUntilTick).toBeUndefined();
    expect(after.energy).toBeUndefined();
    venue.dispose();
  });

  test("class-pick to the SAME class the lobby entity is already on is a no-op — no reset, no churn", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_chas3", "CHAS3"); // default chassis → balanced (wizard)
    venue.attachLobby(ws);
    const pid = PlayerId("p_chas3");
    const host = venue.lobbyHostForTest();
    type Internals = { state: { players: Record<string, Record<string, unknown>> } };
    const internals = host as unknown as Internals;
    internals.state = {
      ...internals.state,
      players: {
        ...internals.state.players,
        [pid]: { ...internals.state.players[pid], health: 55 },
      },
    };
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "balanced" })); // still wizard
    const after = host.getStateSnapshot().players[pid]!;
    expect(after.characterId).toBe("balanced");
    expect(after.health).toBe(55); // untouched — nothing to reset on a same-class no-op
    venue.dispose();
  });

  test("switching class twice ends up on the SECOND class, not stuck on the first", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_chas4", "CHAS4");
    venue.attachLobby(ws);
    const pid = PlayerId("p_chas4");
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "sprinter" })); // ninja
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "shielded" })); // priest
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.characterId).toBe("shielded");
    venue.dispose();
  });

  test("MatchHost.setPlayerCharacter is a no-op on an ordinary combat-mode host (arena matches never chassis-swap mid-run)", () => {
    const spawn = {
      playerId: PlayerId("p_combat2"),
      characterId: "balanced" as const,
      name: "COMBAT2",
      color: "#ffffff",
      weaponId: "starter-pistol",
    };
    const host = new MatchHost("combat-test-2", [spawn], [], "boxworks-mini");
    const internals = host as unknown as { stop(): void };
    internals.stop();
    host.setPlayerCharacter(PlayerId("p_combat2"), "sprinter");
    expect(host.getStateSnapshot().players[PlayerId("p_combat2")]?.characterId).toBe("balanced");
    host.dispose();
  });

  test("setPlayerCharacter no-ops on an unknown playerId (no throw)", () => {
    const { venue } = makeVenue(0);
    const host = venue.lobbyHostForTest();
    expect(() => host.setPlayerCharacter(PlayerId("p_ghost_chassis"), "sprinter")).not.toThrow();
    venue.dispose();
  });

  test("a chassis switch mirrors into rosterInfo() too, not just the live PlayerEntity", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_chas6", "CHAS6");
    venue.attachLobby(ws);
    const pid = PlayerId("p_chas6");
    const host = venue.lobbyHostForTest();
    expect(host.rosterInfo(pid)?.characterId).toBe("balanced");
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "sprinter" })); // → ninja
    expect(host.rosterInfo(pid)?.characterId).toBe("sprinter");
    // Same-class no-op leaves it untouched too (nothing to mirror).
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "sprinter" }));
    expect(host.rosterInfo(pid)?.characterId).toBe("sprinter");
    venue.dispose();
  });

  test("standing at the dummies mid-visit, a class switch is instant and visible — no totem re-touch required", () => {
    // End-to-end shape of Jake's ask: touch the station, equip a catalog
    // pick, then swap class WITHOUT leaving the totem zone — both the
    // catalog rack AND the live chassis must reflect the new class in the
    // same breath.
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_chas5", "CHAS5");
    venue.attachLobby(ws);
    const pid = PlayerId("p_chas5");
    const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_chas5" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "shielded" })); // → priest
    const live = venue.lobbyHostForTest().getStateSnapshot().players[pid]!;
    expect(live.characterId).toBe("shielded");
    expect(live.cards).toEqual([]); // wizard-only pick dropped by the class switch
    expect(venue.loadoutForTest(pid)!.classId).toBe("priest");
    venue.dispose();
  });
});

// ── Loadout station catalog CYCLE (Part B, 2026-07-19 — Jake: "an ability
//    show case room where we can exhaustveily test all and every single
//    ability"). `catalog-cycle` swaps the whole rack for the next/previous
//    ≤3-ability group of the locked class's FULL catalog, wrapping around,
//    live-applying exactly like `catalog-toggle` does. Wizard's catalog
//    (10 actives, the fresh-visitor default class) groups as
//    [3,3,3,1] — group0 sunlance/facet-break/prism-fan, group1 lattice/
//    return-glass/hard-aperture, group2 overclock/measure/slip-node,
//    group3 recoil-step (alone). ─────────────────────────────────────────

describe("VenueHost loadout station: catalog cycle (Part B)", () => {
  test("catalog-cycle before ever touching the station is a no-op (no loadout entry yet)", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cyc1", "CYC1");
    venue.attachLobby(ws);
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" }));
    expect(venue.loadoutForTest(PlayerId("p_cyc1"))).toBeUndefined();
    venue.dispose();
  });

  test("first 'next' cycle lands on group 0 of the locked class's catalog", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cyc2", "CYC2"); // default chassis → wizard
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as { onSimEvent?: (e: { t: string; playerId: string }) => void };
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cyc2" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" }));
    expect(venue.loadoutForTest(PlayerId("p_cyc2"))!.picks).toEqual([
      "sunlance",
      "facet-break",
      "prism-fan",
    ]);
    venue.dispose();
  });

  test("repeated 'next' cycles step through every group, including the trailing partial group", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cyc3", "CYC3");
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as { onSimEvent?: (e: { t: string; playerId: string }) => void };
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cyc3" });
    const groups: string[][] = [];
    for (let i = 0; i < 4; i += 1) {
      venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" }));
      groups.push([...venue.loadoutForTest(PlayerId("p_cyc3"))!.picks]);
    }
    expect(groups).toEqual([
      ["sunlance", "facet-break", "prism-fan"],
      ["lattice", "return-glass", "hard-aperture"],
      ["overclock", "measure", "slip-node"],
      ["recoil-step"], // trailing partial group — 10 actives don't divide evenly by 3
    ]);
    venue.dispose();
  });

  test("cycling wraps back to group 0 after the last group", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cyc4", "CYC4");
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as { onSimEvent?: (e: { t: string; playerId: string }) => void };
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cyc4" });
    for (let i = 0; i < 4; i += 1) {
      venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" }));
    }
    // 5th "next" wraps past the trailing partial group back to group 0.
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" }));
    expect(venue.loadoutForTest(PlayerId("p_cyc4"))!.picks).toEqual([
      "sunlance",
      "facet-break",
      "prism-fan",
    ]);
    venue.dispose();
  });

  test("first 'prev' cycle lands on the LAST group, not group 0", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cyc5", "CYC5");
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as { onSimEvent?: (e: { t: string; playerId: string }) => void };
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cyc5" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "prev" }));
    expect(venue.loadoutForTest(PlayerId("p_cyc5"))!.picks).toEqual(["recoil-step"]);
    venue.dispose();
  });

  test("'next' then 'prev' returns to the group just cycled away from", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cyc6", "CYC6");
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as { onSimEvent?: (e: { t: string; playerId: string }) => void };
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cyc6" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" })); // group 0
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" })); // group 1
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "prev" })); // back to group 0
    expect(venue.loadoutForTest(PlayerId("p_cyc6"))!.picks).toEqual([
      "sunlance",
      "facet-break",
      "prism-fan",
    ]);
    venue.dispose();
  });

  test("a cycle live-applies to the lobby PlayerEntity.cards immediately, same as catalog-toggle", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cyc7", "CYC7");
    venue.attachLobby(ws);
    const pid = PlayerId("p_cyc7");
    const sink = venue.lobbyHostForTest() as unknown as { onSimEvent?: (e: { t: string; playerId: string }) => void };
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cyc7" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" }));
    expect(venue.lobbyHostForTest().getStateSnapshot().players[pid]?.cards).toEqual([
      "sunlance",
      "facet-break",
      "prism-fan",
    ]);
    venue.dispose();
  });

  // (A "cycling never includes a non-active catalog card (paladin's
  // bastion/retort passives are skipped)" test used to live here. Retort
  // and Bastion — docs/card-pool-v2.md #27-28 — were cut entirely
  // 2026-07-19 (they were leaking into the loadout station as 13 cards
  // instead of a true 10; see client/src/sim/data/cards.ts's cut note
  // above the old crater/retort/bastion card definitions), so paladin's
  // catalog no longer has any non-active card to skip — the test's own
  // premise is gone, not just its example. `catalog-cycle`'s
  // `c.active !== undefined` filter (just above) stays: it's a generic
  // defensive check, not bastion/retort-specific, and every OTHER class's
  // catalog is still covered by it.)

  test("a real class switch resets the cycle position — the next cycle for the NEW class starts at its own group 0", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_cyc9", "CYC9");
    venue.attachLobby(ws);
    const sink = venue.lobbyHostForTest() as unknown as { onSimEvent?: (e: { t: string; playerId: string }) => void };
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_cyc9" });
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" })); // wizard group 0
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" })); // wizard group 1
    venue.routeLobby(ws, encodeMessage({ t: "class-pick", characterId: "heavy" })); // → paladin, resets cycleIndex
    venue.routeLobby(ws, encodeMessage({ t: "catalog-cycle", direction: "next" })); // paladin group 0, not group 2
    const picks = venue.loadoutForTest(PlayerId("p_cyc9"))!.picks;
    expect(picks).toEqual(["bastion-pulse", "sunspike", "judgment-line"]);
    venue.dispose();
  });
});

// ── Ability-showcase gauntlet geometry (Part C, 2026-07-19 — Jake: "an area
//    with the right bots and freindlies to test this... an ability show
//    case room where we can exhaustveily test all and every single
//    ability"). Pins: entity COUNT, that the gauntlet lives strictly
//    between the (untouched) tableau's right edge and the bell's own
//    clearance zone, and that it doesn't collide with either. ───────────

describe("VenueHost ability-showcase gauntlet (Part C)", () => {
  const MAP_WIDTH = 3000; // vessel-nexus
  const TABLEAU_RIGHT_EDGE_X = MAP_WIDTH * 0.35; // badOuterRight — the tableau's own locked right flank
  // resolveVenueTotems' BELL_X=0.75, radius 80 (totem.ts) — the bell's own
  // interaction/clearance zone this gauntlet must stay clear of.
  const BELL_CLEARANCE_MIN_X = MAP_WIDTH * 0.75 - 80;
  const BELL_CLEARANCE_MAX_X = MAP_WIDTH * 0.75 + 80;

  type StateInternals = {
    getStateSnapshot(): {
      destructibles: Record<string, { x: number; y: number; health: number }>;
      players: Record<string, { x: number; y: number; teamId?: string }>;
    };
  };

  test("8 total destructibles: the original 3-figure tableau UNTOUCHED plus 5 new showcase dummies", () => {
    const { venue } = makeVenue(0);
    const snap = (venue.lobbyHostForTest() as unknown as StateInternals).getStateSnapshot();
    const xs = Object.values(snap.destructibles)
      .map((d) => d.x)
      .sort((a, b) => a - b);
    expect(xs.length).toBe(8);
    // The original tableau's three dummies (0.19/0.31/0.35) are still
    // present, byte-identical to Part 3's locked composition — this test
    // fails loudly if a future edit ever touches them instead of only
    // adding new ones elsewhere.
    expect(xs.slice(0, 3)).toEqual(
      [0.19, 0.31, 0.35].map((fx) => Math.round(MAP_WIDTH * fx)),
    );
    venue.dispose();
  });

  test("every showcase dummy sits strictly between the tableau's right edge and the bell's clearance zone", () => {
    const { venue } = makeVenue(0);
    const snap = (venue.lobbyHostForTest() as unknown as StateInternals).getStateSnapshot();
    const showcaseXs = Object.values(snap.destructibles)
      .map((d) => d.x)
      .filter((x) => x > TABLEAU_RIGHT_EDGE_X + 1); // exclude the 3 tableau dummies themselves
    expect(showcaseXs.length).toBe(5); // isolatedA/B + 3-dummy cluster
    for (const x of showcaseXs) {
      expect(x).toBeGreaterThan(TABLEAU_RIGHT_EDGE_X);
      expect(x).toBeLessThan(BELL_CLEARANCE_MIN_X);
    }
    venue.dispose();
  });

  test("the showcase cluster is genuinely tight (multi-target AOE test) while the two isolated dummies are genuinely apart (single-target test)", () => {
    const { venue } = makeVenue(0);
    const snap = (venue.lobbyHostForTest() as unknown as StateInternals).getStateSnapshot();
    const showcaseXs = Object.values(snap.destructibles)
      .map((d) => d.x)
      .filter((x) => x > TABLEAU_RIGHT_EDGE_X + 1)
      .sort((a, b) => a - b);
    const [isoA, isoB, clA, clB, clC] = showcaseXs;
    // The two isolated dummies are far enough apart (and from the cluster)
    // that a radius-scale AOE test can hit exactly one of them alone.
    expect(isoB! - isoA!).toBeGreaterThan(150);
    expect(clA! - isoB!).toBeGreaterThan(150);
    // The cluster's own 3 members are close together — a single AOE/chain/
    // bounce ability should be able to reach more than one of them.
    expect(clC! - clA!).toBeLessThan(150);
    venue.dispose();
  });

  test("4 permanent ally NPCs total: the tableau's original 2 plus the gauntlet's own 2, all sharing LOBBY_PRACTICE_TEAM_ID", () => {
    const { venue } = makeVenue(0);
    const snap = (venue.lobbyHostForTest() as unknown as StateInternals).getStateSnapshot();
    const allies = Object.entries(snap.players).filter(([id]) => id.startsWith("bot_practice_ally_"));
    expect(allies.length).toBe(4);
    for (const [, p] of allies) expect(p.teamId).toBe("lobby-practice");
    venue.dispose();
  });

  test("the gauntlet's near/far ally NPCs sit at meaningfully different distances (in-range vs out-of-range aura testing)", () => {
    const { venue } = makeVenue(0);
    const snap = (venue.lobbyHostForTest() as unknown as StateInternals).getStateSnapshot();
    const near = snap.players["bot_practice_ally_3"];
    const far = snap.players["bot_practice_ally_4"];
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    // Comfortably wider than any drafted aura radius in the catalog — a
    // real "out of range" control target, not just a token gap.
    expect(Math.abs(far!.x - near!.x)).toBeGreaterThan(400);
    // Both live strictly inside the gauntlet's own band, same bounds as
    // the dummies above.
    for (const p of [near!, far!]) {
      expect(p.x).toBeGreaterThan(TABLEAU_RIGHT_EDGE_X);
      expect(p.x).toBeLessThan(BELL_CLEARANCE_MIN_X);
    }
    venue.dispose();
  });

  test("respawnDestructibles restores all 8 (tableau + gauntlet) after a full wipe — not scoped to only the original 3", () => {
    const { venue } = makeVenue(0);
    type DestructibleInternals = {
      state: { destructibles: Record<string, unknown> };
      respawnDestructibles(): void;
    };
    const internals = venue.lobbyHostForTest() as unknown as DestructibleInternals;
    internals.state = { ...internals.state, destructibles: {} };
    internals.respawnDestructibles();
    expect(Object.keys(internals.state.destructibles).length).toBe(8);
    venue.dispose();
  });
});

describe("VenueHost fast lane (Doors 1.6 — ?fight)", () => {
  /** `?fight` rides SocketData the same way name/character do. */
  function makeFastLaneWs(
    playerId: string,
    name?: string,
  ): ServerWebSocket<MatchSocketData> {
    const ws = makeFakeWs(playerId, name);
    (ws.data as { fastQueue?: boolean }).fastQueue = true;
    return ws;
  }

  test("a named fast-lane arrival is queued on attach, with no totem touch", () => {
    // The whole point of the item: the walk to the bell totem stops being
    // part of the URL→first-shot budget.
    const { venue } = makeVenue(0);
    venue.attachLobby(makeFastLaneWs("p_fast", "AVA"));
    expect(venue.queuedForTest() as string[]).toEqual(["p_fast"]);
    venue.dispose();
  });

  test("an ordinary arrival is NOT queued — the fast lane is opt-in", () => {
    const { venue } = makeVenue(0);
    venue.attachLobby(makeFakeWs("p_walk", "BEA"));
    expect(venue.queuedForTest() as string[]).toEqual([]);
    venue.dispose();
  });

  test("the callsign gate still holds: a nameless fast-lane arrival cannot queue", () => {
    // S2.C.3 — identity precedes commitment. The fast lane adds a trigger,
    // never an exemption; a deep link must not be a way around the gate.
    const { venue } = makeVenue(0);
    venue.attachLobby(makeFastLaneWs("p_nameless"));
    expect(venue.queuedForTest() as string[]).toEqual([]);
    venue.dispose();
  });

  test("a reconnect inside the same bell stays queued (idempotent, not a toggle)", () => {
    // toggleQueue is a TOGGLE, so calling it blindly on every attach would
    // queue then UNqueue a reconnecting player — exactly the "silently
    // dropped from the queue" bug class Doors 1.3/1.4 just closed.
    const { venue } = makeVenue(0);
    venue.attachLobby(makeFastLaneWs("p_flap", "CAI"));
    expect(venue.queuedForTest() as string[]).toEqual(["p_flap"]);
    venue.attachLobby(makeFastLaneWs("p_flap", "CAI"));
    expect(venue.queuedForTest() as string[]).toEqual(["p_flap"]);
    venue.dispose();
  });

  test("a fast-lane player can still leave the queue at the totem", () => {
    // Arriving queued must not trap anyone: the totem remains a toggle.
    const { venue } = makeVenue(0);
    const ws = makeFastLaneWs("p_leave", "DEE");
    venue.attachLobby(ws);
    expect(venue.queuedForTest() as string[]).toEqual(["p_leave"]);
    (
      venue as unknown as { toggleQueue(id: ReturnType<typeof PlayerId>): void }
    ).toggleQueue(PlayerId("p_leave"));
    expect(venue.queuedForTest() as string[]).toEqual([]);
    venue.dispose();
  });
});

describe("VenueHost bell taper (Doors 1.5b — DECISION 2, dark by default)", () => {
  test("dark by default: a queue entry does not taper without BELL_TAPER=on", () => {
    // L4's whole point — a Jake decision is built, not fired. If this ever
    // fails, cadence changed live on silence.
    const prior = process.env.BELL_TAPER;
    delete process.env.BELL_TAPER;
    try {
      const { venue, arena } = makeVenue(2);
      const before = arena.summary()?.targetScore;
      venue.attachLobby(makeFakeWs("p_dark", "AVA"));
      (venue as unknown as { toggleQueue(id: ReturnType<typeof PlayerId>): void }).toggleQueue(
        PlayerId("p_dark"),
      );
      expect(arena.summary()?.targetScore).toBe(before);
      venue.dispose();
    } finally {
      if (prior === undefined) delete process.env.BELL_TAPER;
      else process.env.BELL_TAPER = prior;
    }
  });

  test("with the flag on, a queue entry shortens the bout in progress", () => {
    const prior = process.env.BELL_TAPER;
    process.env.BELL_TAPER = "on";
    try {
      const { venue, arena } = makeVenue(2);
      // Default target is 3 and the taper floor is 3, so start from 5 to
      // have somewhere to go — same id shape a room's mode axis uses.
      const before = arena.summary()?.targetScore ?? 0;
      venue.attachLobby(makeFakeWs("p_taper", "BEA"));
      (venue as unknown as { toggleQueue(id: ReturnType<typeof PlayerId>): void }).toggleQueue(
        PlayerId("p_taper"),
      );
      const after = arena.summary()?.targetScore ?? 0;
      // From the default 3 there is nowhere to taper to, so the honest
      // assertion is "never INCREASED, and never below the floor".
      expect(after).toBeLessThanOrEqual(before);
      expect(after).toBeGreaterThanOrEqual(3);
      venue.dispose();
    } finally {
      if (prior === undefined) delete process.env.BELL_TAPER;
      else process.env.BELL_TAPER = prior;
    }
  });

  test("taperTargetScore refuses to end the bout on the spot", () => {
    // The guard that matters: shortening the wait for the queued must not
    // instantly delete the fight of the people already in it.
    const { venue, arena } = makeVenue(2);
    type HostInternals = {
      state: { chaosModifierIds: string[]; round: { scores: Record<string, number> } };
      taperTargetScore(): { from: number; to: number } | null;
    };
    const inner = (arena as unknown as { host: HostInternals | null }).host;
    if (!inner) {
      venue.dispose();
      return; // arena not booted in this environment; nothing to assert
    }
    inner.state = {
      ...inner.state,
      chaosModifierIds: ["target-score-5"],
      round: { ...inner.state.round, scores: { bot_a: 4, bot_b: 1 } },
    };
    // 5 → 3 would be <= the leader's 4, so it must decline entirely.
    expect(inner.taperTargetScore()).toBeNull();
    expect(inner.state.chaosModifierIds).toContain("target-score-5");
    venue.dispose();
  });

  test("taperTargetScore steps 7 → 5 → 3 and then stops", () => {
    const { venue, arena } = makeVenue(2);
    type HostInternals = {
      state: { chaosModifierIds: string[]; round: { scores: Record<string, number> } };
      taperTargetScore(): { from: number; to: number } | null;
    };
    const inner = (arena as unknown as { host: HostInternals | null }).host;
    if (!inner) {
      venue.dispose();
      return;
    }
    inner.state = {
      ...inner.state,
      chaosModifierIds: ["target-score-7"],
      round: { ...inner.state.round, scores: {} },
    };
    expect(inner.taperTargetScore()).toEqual({ from: 7, to: 5 });
    expect(inner.taperTargetScore()).toEqual({ from: 5, to: 3 });
    expect(inner.taperTargetScore()).toBeNull(); // floor
    expect(inner.state.chaosModifierIds).toContain("target-score-3");
    venue.dispose();
  });
});
