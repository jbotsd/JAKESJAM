// The bell gate (venue-sprint2-goal S2.D): a NEW player only enters the
// always-on world at a round boundary.
//
// Contracts pinned here:
//   1. Attach during fighting/round-over/drafting → spectator-pending:
//      hello + snapshots flow, but NO entity until the next countdown edge.
//   2. Attach during countdown inserts immediately (countdown IS the edge).
//   3. Insertion happens exactly at the phase edge INTO countdown, via the
//      real onRoundPhaseChange hook (not a timer, not a poll).
//   4. Structurally, the ONLY addPlayer call site in worldHost.ts lives
//      inside the countdown-entry drain (source-scan test).
//   5. A pending spectator who disconnects before the bell is dequeued.
//   6. Reconnect within grace bypasses the gate (entity continuity).

import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import { WorldHost } from "../worldHost.ts";
import type { MatchHost, MatchSocketData } from "../matchHost.ts";
import type { RoundState, WorldState } from "@sim/types.ts";

type HostInternals = {
  state: WorldState;
  stop(): void;
  tick(): void;
};

type WorldInternals = {
  host: MatchHost | null;
  pendingEntrants: Map<string, string | undefined>;
};

function fakeWs(playerId: string, name?: string): ServerWebSocket<MatchSocketData> & { sent: number } {
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

/** Boot a world with one seeded player, tick loop stopped for determinism. */
function makeWorld(): {
  wh: WorldHost;
  wi: WorldInternals;
  hi: HostInternals;
  seed: ReturnType<typeof fakeWs>;
} {
  const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 60_000 });
  const seed = fakeWs("p_seed", "SEED");
  wh.attach(seed); // boots the host → countdown → seed drains in immediately
  const wi = wh as unknown as WorldInternals;
  const hi = wi.host as unknown as HostInternals;
  hi.stop();
  return { wh, wi, hi, seed };
}

/** Surgically pin the live round phase (same internals pattern as the venue
 *  and liveness suites — the tick loop is stopped, ticks are hand-driven). */
function setPhase(hi: HostInternals, round: Partial<RoundState>): void {
  hi.state = {
    ...hi.state,
    round: { ...hi.state.round, ...round } as RoundState,
  };
}

describe("world bell gate (S2.D)", () => {
  for (const phase of ["fighting", "round-over", "drafting"] as const) {
    test(`attach during ${phase} → spectator-pending: hello + snapshots, NO entity`, () => {
      const { wh, wi, hi } = makeWorld();
      setPhase(hi, {
        phase,
        countdownRemainingMs: 60_000,
        // drafting with offers present does NOT auto-resolve — keeps the
        // phase parked while we assert the pending state.
        ...(phase === "drafting"
          ? { draftingOffers: { p_seed: ["quick-parry", "quick-parry", "quick-parry"] } }
          : {}),
      } as Partial<RoundState>);
      const joiner = fakeWs("p_new", "NEWBIE");
      wh.attach(joiner);
      // Attached: hello flowed.
      expect(joiner.sent).toBeGreaterThan(0);
      // Gated: no entity, parked pending.
      expect(wi.host!.hasPlayer("p_new" as never)).toBe(false);
      expect(hi.state.players["p_new" as never]).toBeUndefined();
      expect(wi.pendingEntrants.has("p_new")).toBe(true);
      // Snapshots keep flowing to the spectator while the fight runs.
      const before = joiner.sent;
      for (let i = 0; i < 12; i += 1) hi.tick();
      expect(joiner.sent).toBeGreaterThan(before);
      // Still no entity after ticking — nothing drifts them in mid-phase.
      expect(wi.host!.hasPlayer("p_new" as never)).toBe(false);
    });
  }

  test("insertion happens exactly at the drafting→countdown edge (real hook path)", () => {
    const { wh, wi, hi } = makeWorld();
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    const joiner = fakeWs("p_new", "NEWBIE");
    wh.attach(joiner);
    expect(wi.host!.hasPlayer("p_new" as never)).toBe(false);
    // Ring the bell: empty-offers drafting resolves to countdown on the
    // next tick, firing onRoundPhaseChange(drafting → countdown).
    setPhase(hi, { phase: "drafting", countdownRemainingMs: 0, draftingOffers: {} });
    hi.tick();
    expect(hi.state.round.phase).toBe("countdown");
    expect(wi.host!.hasPlayer("p_new" as never)).toBe(true);
    expect(wi.pendingEntrants.size).toBe(0);
  });

  test("attach during countdown inserts immediately", () => {
    const { wh, wi, hi } = makeWorld();
    expect(hi.state.round.phase).toBe("countdown"); // fresh world
    const joiner = fakeWs("p_now", "EAGER");
    wh.attach(joiner);
    expect(wi.host!.hasPlayer("p_now" as never)).toBe(true);
    expect(wi.pendingEntrants.size).toBe(0);
  });

  test("pending disconnect before the bell → cleanly dequeued (no ghost entrants)", () => {
    const { wh, wi, hi } = makeWorld();
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    const joiner = fakeWs("p_ghost", "GHOST");
    wh.attach(joiner);
    expect(wi.pendingEntrants.has("p_ghost")).toBe(true);
    joiner.close();
    wh.detach(joiner);
    expect(wi.pendingEntrants.has("p_ghost")).toBe(false);
    // The bell rings — the departed player must NOT spawn.
    setPhase(hi, { phase: "drafting", countdownRemainingMs: 0, draftingOffers: {} });
    hi.tick();
    expect(hi.state.round.phase).toBe("countdown");
    expect(wi.host!.hasPlayer("p_ghost" as never)).toBe(false);
  });

  test("reconnect within grace bypasses the gate: entity continuous, no re-queue", () => {
    const { wh, wi, hi, seed } = makeWorld();
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    // Drop mid-fight — the entity survives RECONNECT_GRACE_MS.
    wh.detach(seed);
    expect(wi.host!.hasPlayer("p_seed" as never)).toBe(true); // grace window
    // Reconnect (new socket, same player) while still fighting.
    const back = fakeWs("p_seed", "SEED");
    wh.attach(back);
    expect(wi.host!.hasPlayer("p_seed" as never)).toBe(true); // continuous
    expect(wi.pendingEntrants.has("p_seed")).toBe(false); // never gated
  });

  test("structural: every addPlayer call in worldHost.ts lives on the bell edge (S2.D.4)", async () => {
    const src = await Bun.file(new URL("../worldHost.ts", import.meta.url).pathname).text();
    const calls = src.match(/\.addPlayer\(/g) ?? [];
    // Exactly two insertion sites: human entrants (drainPendingEntrants)
    // and elastic bots (adjustElasticBots) — both run ONLY from the
    // countdown-entry edge. attach() must never insert directly.
    expect(calls.length).toBe(2);
    const bellEdgeStart = src.indexOf("private drainPendingEntrants");
    const bellEdgeEnd = src.indexOf("private scheduleRecycle");
    expect(bellEdgeStart).toBeGreaterThan(-1);
    const bellEdgeRegion = src.slice(bellEdgeStart, bellEdgeEnd);
    expect((bellEdgeRegion.match(/\.addPlayer\(/g) ?? []).length).toBe(2);
  });
});

describe("starter cards ride admission (S2.E)", () => {
  test("getEntrantCards provider → spawned entity carries exactly the picked card", () => {
    const { wh, wi, hi } = makeWorld();
    wh.getEntrantCards = (pid) => ((pid as string) === "p_carded" ? ["quick-parry"] : undefined);
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    const carded = fakeWs("p_carded", "CARDED");
    const plain = fakeWs("p_plain", "PLAIN");
    wh.attach(carded);
    wh.attach(plain);
    // The bell rings.
    setPhase(hi, { phase: "drafting", countdownRemainingMs: 0, draftingOffers: {} });
    hi.tick();
    expect(hi.state.round.phase).toBe("countdown");
    expect(hi.state.players["p_carded" as never]!.cards).toEqual(["quick-parry"]);
    expect(hi.state.players["p_plain" as never]!.cards).toEqual([]);
  });

  test("gate-admitted players participate in the NEXT drafting offer roll (S2.E.2)", () => {
    const { wh, wi, hi } = makeWorld();
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    const joiner = fakeWs("p_late", "LATE");
    wh.attach(joiner);
    setPhase(hi, { phase: "drafting", countdownRemainingMs: 0, draftingOffers: {} });
    hi.tick(); // admitted at countdown
    expect(wi.host!.hasPlayer("p_late" as never)).toBe(true);
    // Next round ends → drafting entry rolls offers for EVERY roster seat,
    // the late joiner included (universal draft) — never a naked veteran gap.
    setPhase(hi, { phase: "round-over", countdownRemainingMs: 1 });
    hi.tick();
    hi.tick();
    expect(hi.state.round.phase).toBe("drafting");
    expect(hi.state.round.draftingOffers?.["p_late" as never]).toBeDefined();
    expect(hi.state.round.draftingOffers!["p_late" as never]!.length).toBeGreaterThan(0);
  });
});

describe("elastic bots (S2.E.3)", () => {
  function botCountIn(hi: HostInternals): number {
    return Object.keys(hi.state.players).filter((id) => id.startsWith("bot_")).length;
  }

  test("bot deltas land exclusively on bell edges across joins", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 60_000, botFloor: 4 });
    const wi = wh as unknown as WorldInternals;
    // Eager boot (floor active, 0 humans) → 4 bots immediately.
    const hi = wi.host as unknown as HostInternals;
    hi.stop();
    expect(botCountIn(hi)).toBe(4);

    // Human joins during countdown → same-edge adjustment to 3 bots.
    wh.attach(fakeWs("h1", "H1"));
    expect(hi.state.round.phase).toBe("countdown");
    expect(botCountIn(hi)).toBe(3);

    // Mid-fight: three more humans arrive — NO bot change until the bell.
    setPhase(hi, { phase: "fighting", countdownRemainingMs: 60_000 });
    wh.attach(fakeWs("h2", "H2"));
    wh.attach(fakeWs("h3", "H3"));
    wh.attach(fakeWs("h4", "H4"));
    for (let i = 0; i < 20; i += 1) {
      hi.tick();
      expect(botCountIn(hi)).toBe(3); // frozen through the fight
    }

    // Bell: 4 humans fighting → bots drop to 0, humans all inserted.
    setPhase(hi, { phase: "drafting", countdownRemainingMs: 0, draftingOffers: {} });
    hi.tick();
    expect(hi.state.round.phase).toBe("countdown");
    expect(botCountIn(hi)).toBe(0);
    expect(Object.keys(hi.state.players).filter((id) => !id.startsWith("bot_")).length).toBe(4);
  });

  test("constructor clamps the floor at the existing cap of 6", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 60_000, botFloor: 9 });
    const wi = wh as unknown as WorldInternals;
    const hi = wi.host as unknown as HostInternals;
    hi.stop();
    expect(botCountIn(hi)).toBe(6);
  });

  test("botFloor 0 (default) keeps the legacy fixed-bot behavior", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini", resultsHoldMs: 60_000, bots: 2 });
    const wi = wh as unknown as WorldInternals;
    const hi = wi.host as unknown as HostInternals;
    hi.stop();
    expect(botCountIn(hi)).toBe(2);
    // A bell edge does NOT reshape the roster when elasticity is off.
    wh.attach(fakeWs("h1", "H1"));
    setPhase(hi, { phase: "drafting", countdownRemainingMs: 0, draftingOffers: {} });
    hi.tick();
    expect(botCountIn(hi)).toBe(2);
  });
});
