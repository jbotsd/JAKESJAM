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
import { crystalRoundsCards } from "@sim/data/cards.ts";
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

  // ── The loadout station / bell separation (Jake 2026-07-17: "seperate
  //    the card selector test room thing with the bell queue") ──────────

  test("queueing at the bell is JUST queueing: no offer rolled, no venue-draft pushed", () => {
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

  test("the loadout station rolls a 3-card offer once and re-pushes it idempotently (S2.E)", () => {
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
    expect(entry!.offers.length).toBe(3);
    expect(new Set(entry!.offers).size).toBe(3); // distinct
    expect(entry!.picks).toEqual([]);
    // Standing there (totem retrigger) re-pushes the SAME offer, no re-roll.
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_l" });
    expect(venue.loadoutForTest("p_l" as never)!.offers).toEqual(entry!.offers);
    const drafts = sent
      .map((buf) => decodeMessage(buf)?.message as { t: string; offers?: string[] } | undefined)
      .filter((m): m is { t: string; offers?: string[] } => m?.t === "venue-draft");
    expect(drafts.length).toBe(2);
    expect(drafts[0]!.offers).toEqual(entry!.offers);
    expect(drafts[1]!.offers).toEqual(entry!.offers);
    // The station never queues anyone.
    expect(venue.queuedForTest()).toEqual([]);
    venue.dispose();
  });

  test("card-pick over the lobby socket lands on the loadout entry; bad ids ignored (S2.E)", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_p", "PICKY");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "ready-toggled",
      playerId: "p_p",
    });
    const entry = venue.loadoutForTest("p_p" as never)!;
    const chosen = entry.offers[1]!;
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: "not-offered" }));
    expect(venue.loadoutForTest("p_p" as never)!.picks).toEqual([]);
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: chosen }));
    expect(venue.loadoutForTest("p_p" as never)!.picks).toEqual([chosen]);
    // A stale id from the FIRST offer (already superseded by the reroll
    // below) is ignored — picks does not grow.
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: "not-offered" }));
    expect(venue.loadoutForTest("p_p" as never)!.picks).toEqual([chosen]);
    venue.dispose();
  });

  test("multi-pick (chunk 1.3): each valid pick fills the NEXT rack slot and rerolls the offer for the one after it, capped at the rack size", () => {
    const { venue } = makeVenue(0);
    const ws = makeFakeWs("p_rack", "RACKER");
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "ready-toggled",
      playerId: "p_rack",
    });
    // Slot 1.
    const firstOffers = venue.loadoutForTest("p_rack" as never)!.offers;
    expect(firstOffers.length).toBe(3);
    const first = firstOffers[0]!;
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: first }));
    expect(venue.loadoutForTest("p_rack" as never)!.picks).toEqual([first]);
    // A fresh offer landed for slot 2 WITHOUT another totem touch — the
    // pick handler rerolls immediately (docs/classes-goal.md "Loadout
    // station owns the 3 slots": one continuous visit can fill the rack).
    const secondOffers = venue.loadoutForTest("p_rack" as never)!.offers;
    expect(secondOffers.length).toBeGreaterThan(0);

    // Slot 2.
    const second = secondOffers[0]!;
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: second }));
    expect(venue.loadoutForTest("p_rack" as never)!.picks).toEqual([first, second]);

    // Slot 3 — the rack's last slot (MAX_ABILITY_SLOTS = 3).
    const thirdOffers = venue.loadoutForTest("p_rack" as never)!.offers;
    const third = thirdOffers[0]!;
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: third }));
    expect(venue.loadoutForTest("p_rack" as never)!.picks).toEqual([first, second, third]);

    // Rack full — no further offer, no further picks accepted.
    expect(venue.loadoutForTest("p_rack" as never)!.offers).toEqual([]);
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: first }));
    expect(venue.loadoutForTest("p_rack" as never)!.picks).toEqual([first, second, third]);

    // A fresh totem touch (re-entering the zone) re-pushes the completed
    // rack's [] offer idempotently — it does not reopen a 4th slot.
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "ready-toggled",
      playerId: "p_rack",
    });
    expect(venue.loadoutForTest("p_rack" as never)!.offers).toEqual([]);
    venue.dispose();
  });

  test("multi-pick stays classId-gated across every reroll, not just the first offer (docs/class-ability-catalogs-v1.md)", () => {
    const { venue } = makeVenue(0);
    // sprinter → ninja (cardTypes.ts's ARCHETYPE_CLASS_ID) — a ninja must
    // never see a wizard-exclusive Geometrician catalog card (e.g.
    // "sunlance"), at slot 1 OR at any rerolled later slot.
    const ws = {
      data: {
        matchId: VENUE_LOBBY_MATCH_ID,
        playerId: "p_ninja",
        name: "NINJA",
        authedAt: Date.now(),
        character: "sprinter",
      },
      send: () => 1,
      close: () => {},
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<MatchSocketData>;
    venue.attachLobby(ws);
    type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };
    (venue.lobbyHostForTest() as unknown as SimEventSink).onSimEvent?.({
      t: "ready-toggled",
      playerId: "p_ninja",
    });
    const wizardOnlyIds = new Set(
      crystalRoundsCards.filter((c) => c.classId === "wizard").map((c) => c.id),
    );
    const assertNoWizardCards = () => {
      const offers = venue.loadoutForTest("p_ninja" as never)!.offers;
      for (const id of offers) expect(wizardOnlyIds.has(id)).toBe(false);
    };
    assertNoWizardCards(); // slot 1's initial offer
    for (let i = 0; i < 3; i += 1) {
      const offers = venue.loadoutForTest("p_ninja" as never)!.offers;
      if (offers.length === 0) break; // rack filled before exhausting the loop
      venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: offers[0]! }));
      assertNoWizardCards(); // every rerolled offer after that pick
    }
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
    const entry = venue.loadoutForTest("p_q2" as never)!;
    // Offer rolled but NOT picked → plain spawn, never a silent leftmost.
    expect(arena.getEntrantCards!("p_q2" as never)).toBeUndefined();
    // Picked → exactly the pick, consumed by the spawn. Snapshot the card
    // BEFORE routing: the pick handler re-rolls `entry.offers` for the next
    // rack slot (rotation system, venueHost card-pick handler), so reading
    // `entry.offers[2]` after the pick would see the fresh roll, not the pick.
    const picked = entry.offers[2]!;
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: picked }));
    expect(arena.getEntrantCards!("p_q2" as never)).toEqual([picked]);
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
    // Visit the loadout station (pick a card), THEN queue at the bell —
    // two separate walk-ups, two separate meanings (2026-07-17).
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_adm" });
    const offers = venue.loadoutForTest("p_adm" as never)!.offers;
    venue.routeLobby(ws, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: offers[1]! }));
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
    // the loadout entry was consumed by the admission (next visit re-rolls).
    expect(venue.loadoutForTest("p_adm" as never)).toBeUndefined();
    expect(arena.getEntrantCards!("p_adm" as never)).toEqual([offers[1]!]);
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
    const offers = venue.loadoutForTest("p_dc1" as never)!.offers;
    venue.routeLobby(wsA, encodeMessage({ t: "card-pick", roundIndex: 0, cardId: offers[0]! }));
    venue.routeLobby(wsA, encodeMessage({ t: "duo-toggle" }));
    venue.routeLobby(wsB, encodeMessage({ t: "duo-toggle" }));
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_dc1" });
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_dc2" });
    arena.onRoundPhaseChange?.("drafting", "countdown");
    expect(arena.getEntrantCards!("p_dc1" as never)).toEqual([offers[0]!]);
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
