// The admission race (open-doors 1.3 / gospel Track D, Doors Phase 1).
//
// The bug being pinned: a venue player who rang the bell got admitted
// (venue-admitted) and then had to complete a FRESH TCP+WS handshake to
// /ws/world inside the ~3 s countdown window (COUNTDOWN_MS). On a cold
// cache / slow phone the connect lost the race, the arena parked them as a
// spectator-pending entrant, and they watched the entire round they were
// admitted to — then got told "ELIMINATED" without ever spawning (1.4).
//
// The fix, two halves, both server-authoritative here:
//   1. ADMISSION TICKETS (VenueHost.admittedEntrants, 30 s TTL like the
//      banked cards): a socket that arrives AFTER the countdown already
//      ended still inserts immediately — the admission outranks the gate.
//   2. PRE-OPEN HOLD (WorldHost.holdEntrant): the client may open the
//      arena socket while still QUEUED (spectator-grade). The venue truth
//      keeps it parked through bell drains AND recycles until the bell
//      actually admits its player — a warm connection is not a queue
//      commitment. At the bell the held socket upgrades to a combatant at
//      the countdown edge itself: zero handshakes inside the window.
//
// Acceptance (open-doors 1.3, verbatim): "an admitted player is ALWAYS
// inserted at the bell they were admitted for, on a cold cache, on a
// phone."
//
// Harness: the REAL phase-edge path (MatchHost tick → buildHost's
// onRoundPhaseChange closure → venue tap THEN pending drain), same
// internals pattern as worldBellGate.test.ts + venueHost.test.ts.

import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import { VenueHost, VENUE_LOBBY_MATCH_ID } from "../venueHost.ts";
import { WorldHost } from "../worldHost.ts";
import type { MatchHost, MatchSocketData } from "../matchHost.ts";
import { encodeMessage } from "@net/protocol.ts";
import { PlayerId, type RoundState, type WorldState } from "@sim/types.ts";

type HostInternals = {
  state: WorldState;
  stop(): void;
  tick(): void;
};

type WorldInternals = {
  host: MatchHost | null;
  pendingEntrants: Map<string, string | undefined>;
};

type SimEventSink = { onSimEvent?: (e: { t: string; playerId: string }) => void };

function makeLobbyWs(playerId: string, name?: string): ServerWebSocket<MatchSocketData> {
  return {
    data: { matchId: VENUE_LOBBY_MATCH_ID, playerId, name, authedAt: Date.now() },
    send: () => 1,
    close: () => {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<MatchSocketData>;
}

function makeArenaWs(
  playerId: string,
  name?: string,
): ServerWebSocket<MatchSocketData> & { sent: number } {
  const ws = {
    sent: 0,
    readyState: 1,
    data: { matchId: "world", playerId, name, authedAt: Date.now() },
    send() {
      ws.sent += 1;
      return 1;
    },
    close() {
      (ws as { readyState: number }).readyState = 3;
    },
    getBufferedAmount: () => 0,
  };
  return ws as unknown as ServerWebSocket<MatchSocketData> & { sent: number };
}

/** Venue + eager-booted arena (fixed bots keep the world alive, elasticity
 *  off so bot counts never distract the assertions), tick loop stopped. */
function makeVenueWorld(): {
  venue: VenueHost;
  arena: WorldHost;
  wi: WorldInternals;
  hi: HostInternals;
  sink: SimEventSink;
} {
  const arena = new WorldHost({ mapId: "vessel-nexus", bots: 2, resultsHoldMs: 60_000 });
  const venue = new VenueHost({ arena });
  const wi = arena as unknown as WorldInternals;
  const hi = wi.host as unknown as HostInternals;
  hi.stop();
  (venue.lobbyHostForTest() as unknown as { stop(): void }).stop();
  const sink = venue.lobbyHostForTest() as unknown as SimEventSink;
  return { venue, arena, wi, hi, sink };
}

/** Surgically pin the live round phase (worldBellGate.test.ts pattern). */
function setPhase(hi: HostInternals, round: Partial<RoundState>): void {
  hi.state = {
    ...hi.state,
    round: { ...hi.state.round, ...round } as RoundState,
  };
}

/** Ring the REAL bell: empty-offers drafting resolves to countdown on the
 *  next tick, firing MatchHost's onRoundPhaseChange → venue admission tap
 *  → pending-entrant drain (the exact production edge). */
function ringBell(hi: HostInternals): void {
  setPhase(hi, { phase: "drafting", countdownRemainingMs: 0, draftingOffers: {} });
  hi.tick();
  expect(hi.state.round.phase).toBe("countdown");
}

describe("the admission race (open-doors 1.3)", () => {
  test("REGRESSION: admitted player whose socket arrives AFTER the countdown ended is inserted immediately — never a spectator for the round they were admitted to", () => {
    const { venue, arena, wi, hi, sink } = makeVenueWorld();
    const lobbyWs = makeLobbyWs("p_slow", "SLOWPOKE");
    venue.attachLobby(lobbyWs);
    // Arm a loadout pick first so the test also proves the banked card
    // survives the race (it used to TTL out while the player spectated).
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_slow" });
    venue.routeLobby(lobbyWs, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_slow" });
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });

    // The bell rings; the venue admits — but the phone is still opening
    // its fresh TCP+WS handshake when the countdown expires.
    ringBell(hi);
    expect(venue.queuedForTest()).toEqual([]);
    expect(venue.admissionForTest("p_slow" as never)).toBe(true);
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });

    // The socket finally lands, mid-fight. Pre-fix: parked as a spectator
    // until the NEXT bell. Post-fix: the admission outranks the gate.
    arena.attach(makeArenaWs("p_slow", "SLOWPOKE"));
    expect(wi.host!.hasPlayer("p_slow" as never)).toBe(true);
    expect(wi.pendingEntrants.has("p_slow")).toBe(false);
    // The loadout pick rode the admission despite the late socket.
    expect(hi.state.players["p_slow" as never]!.cards).toEqual(["sunlance"]);
    venue.dispose();
  });

  test("a NON-admitted attach mid-fight keeps the bell gate (spectator-pending, inserted at the next bell) — legacy contract intact through the venue", () => {
    const { venue, arena, wi, hi } = makeVenueWorld();
    // Direct /ws/world connect: never in the venue lobby, never admitted.
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    arena.attach(makeArenaWs("p_direct", "DIRECT"));
    expect(wi.host!.hasPlayer("p_direct" as never)).toBe(false);
    expect(wi.pendingEntrants.has("p_direct")).toBe(true);
    ringBell(hi);
    expect(wi.host!.hasPlayer("p_direct" as never)).toBe(true);
    venue.dispose();
  });

  test("an admission ticket expires (TTL): a socket arriving past it is parked, not inserted", () => {
    const { venue, arena, wi, hi, sink } = makeVenueWorld();
    const lobbyWs = makeLobbyWs("p_late", "TOOLATE");
    venue.attachLobby(lobbyWs);
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_late" });
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    ringBell(hi);
    expect(venue.admissionForTest("p_late" as never)).toBe(true);
    // Force-expire the ticket (30 s wall-clock in production).
    (venue as unknown as { admittedEntrants: Map<PlayerId, number> }).admittedEntrants.set(
      "p_late" as never,
      Date.now() - 1,
    );
    expect(venue.admissionForTest("p_late" as never)).toBe(false);
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    // They also closed their lobby socket long ago (walked away mid-handoff).
    venue.detachLobby(lobbyWs);
    arena.attach(makeArenaWs("p_late", "TOOLATE"));
    expect(wi.host!.hasPlayer("p_late" as never)).toBe(false);
    expect(wi.pendingEntrants.has("p_late")).toBe(true);
    venue.dispose();
  });
});

describe("pre-opened arena socket while queued (open-doors 1.3)", () => {
  test("a socket pre-opened while QUEUED parks as a spectator — being warm is not being admitted", () => {
    const { venue, arena, wi, hi, sink } = makeVenueWorld();
    const lobbyWs = makeLobbyWs("p_pre", "PREOPEN");
    venue.attachLobby(lobbyWs);
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_pre" });
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    const arenaWs = makeArenaWs("p_pre", "PREOPEN");
    arena.attach(arenaWs);
    // Attached (hello flowed) but parked: no entity until their bell.
    expect(arenaWs.sent).toBeGreaterThan(0);
    expect(wi.host!.hasPlayer("p_pre" as never)).toBe(false);
    expect(wi.pendingEntrants.has("p_pre")).toBe(true);
    venue.dispose();
  });

  test("the bell upgrades the held socket to a combatant AT the countdown edge — zero handshakes inside the window, banked pick riding", () => {
    const { venue, arena, wi, hi, sink } = makeVenueWorld();
    const lobbyWs = makeLobbyWs("p_pre2", "PREOPEN2");
    venue.attachLobby(lobbyWs);
    sink.onSimEvent?.({ t: "ready-toggled", playerId: "p_pre2" });
    venue.routeLobby(lobbyWs, encodeMessage({ t: "catalog-toggle", cardId: "sunlance" }));
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_pre2" });
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    arena.attach(makeArenaWs("p_pre2", "PREOPEN2"));
    expect(wi.host!.hasPlayer("p_pre2" as never)).toBe(false);

    ringBell(hi);
    // Inserted at the edge itself — the countdown window is irrelevant.
    expect(wi.host!.hasPlayer("p_pre2" as never)).toBe(true);
    expect(wi.pendingEntrants.has("p_pre2")).toBe(false);
    expect(hi.state.players["p_pre2" as never]!.cards).toEqual(["sunlance"]);
    venue.dispose();
  });

  test("stepping OFF the bell before it rings keeps the warm socket OUT — dequeue is honored over connectedness", () => {
    const { venue, arena, wi, hi, sink } = makeVenueWorld();
    const lobbyWs = makeLobbyWs("p_out", "STEPOFF");
    venue.attachLobby(lobbyWs);
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_out" });
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    arena.attach(makeArenaWs("p_out", "STEPOFF"));
    // Change of heart: totem touch dequeues, the pre-open stays warm.
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_out" });
    expect(venue.queuedForTest()).toEqual([]);

    ringBell(hi);
    expect(wi.host!.hasPlayer("p_out" as never)).toBe(false);
    expect(wi.pendingEntrants.has("p_out")).toBe(true); // still just watching
    venue.dispose();
  });

  test("duo pre-open: both partners' held sockets insert at their bell with the SAME teamId (admission runs before the drain)", () => {
    const { venue, arena, wi, hi, sink } = makeVenueWorld();
    const wsA = makeLobbyWs("p_da", "DUOA");
    const wsB = makeLobbyWs("p_db", "DUOB");
    venue.attachLobby(wsA);
    venue.attachLobby(wsB);
    venue.routeLobby(wsA, encodeMessage({ t: "duo-toggle" }));
    venue.routeLobby(wsB, encodeMessage({ t: "duo-toggle" }));
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_da" });
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_db" });
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    arena.attach(makeArenaWs("p_da", "DUOA"));
    arena.attach(makeArenaWs("p_db", "DUOB"));

    ringBell(hi);
    expect(wi.host!.hasPlayer("p_da" as never)).toBe(true);
    expect(wi.host!.hasPlayer("p_db" as never)).toBe(true);
    const teamA = wi.host!.rosterInfo(PlayerId("p_da"))?.teamId;
    const teamB = wi.host!.rosterInfo(PlayerId("p_db"))?.teamId;
    expect(teamA).toBeDefined();
    expect(teamA).toBe(teamB as string);
    venue.dispose();
  });

  test("a held pre-open survives a match-complete RECYCLE as a spectator, then inserts at the new cycle's first bell", () => {
    const { venue, arena, wi, sink } = makeVenueWorld();
    const lobbyWs = makeLobbyWs("p_rec", "RECYCLED");
    venue.attachLobby(lobbyWs);
    sink.onSimEvent?.({ t: "launch-requested", playerId: "p_rec" });
    const oldHi = wi.host as unknown as HostInternals;
    setPhase(oldHi, { phase: "fighting", countdownRemainingMs: 60_000 });
    arena.attach(makeArenaWs("p_rec", "RECYCLED"));
    expect(wi.pendingEntrants.has("p_rec")).toBe(true);

    // Someone hits the target score → the world rolls a fresh cycle.
    (arena as unknown as { recycle(): void }).recycle();
    const hi2 = wi.host as unknown as HostInternals;
    expect(hi2).not.toBe(oldHi);
    hi2.stop();
    // NOT force-spawned into the new cycle; re-parked, still queued.
    expect(wi.host!.hasPlayer("p_rec" as never)).toBe(false);
    expect(wi.pendingEntrants.has("p_rec")).toBe(true);
    expect(venue.queuedForTest() as string[]).toEqual(["p_rec"]);

    // The new cycle's first real bell admits and inserts them.
    setPhase(hi2, { phase: "fighting", countdownRemainingMs: 60_000 });
    ringBell(hi2);
    expect(wi.host!.hasPlayer("p_rec" as never)).toBe(true);
    expect(wi.pendingEntrants.has("p_rec")).toBe(false);
    venue.dispose();
  });
});
