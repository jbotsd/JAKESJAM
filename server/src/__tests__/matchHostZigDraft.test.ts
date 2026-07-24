// Track Z2 item 1 (convergence-goal.md) — the drafting overlay is retired:
// Zig (draft.zig) owns offers/picks/auto-pick timing on the wasm backend,
// and matchHost's foldZigDraft only mirrors presentation + the TS hand.
//
// End-to-end through the private runStep:
//   1. round-over → drafting via the ZIG phase machine (no TS
//      enterDrafting anywhere on this path) — offers surface as card ids
//      on round.draftingOffers, card-offered events flow;
//   2. a queued human pick lands in Zig, comes back as an appliedPick,
//      the card lands in the TS-side hand, draft-resolved(autoPicked:
//      false) is emitted, draftingPicked mirrors;
//   3. window expiry auto-picks the unpicked player (Zig's
//      autoPickStragglers → surviving draft_resolved event → TS hand),
//      the phase lands in countdown, and the drafting bookkeeping is
//      wiped from the wire state.

import { describe, expect, test } from "bun:test";

process.env.USE_WASM_STEP_WORLD = "1";

const { serverWasmHost } = await import("../serverWasmHost.ts");
await serverWasmHost.preload();
const { MatchHost } = await import("../matchHost.ts");

import {
  PlayerId,
  type InputFrame,
  type PlayerSpawnInfo,
  type SimEvent,
  type WorldState,
  type MapDefinition,
} from "@sim/types.ts";
import { KILL_PLANE_MARGIN_PX } from "@sim/player.ts";
import type { WorldRuntime } from "@sim/World.ts";

const A = PlayerId("zig-draft-a");
const B = PlayerId("zig-draft-b");

type HostInternals = {
  map: MapDefinition;
  state: WorldState;
  runtime: WorldRuntime;
  simBackend: "wasm" | "ts";
  applyCardPick(
    playerId: PlayerId,
    message: { t: "card-pick"; roundIndex: number; cardId: string },
  ): void;
  runStep(
    state: WorldState,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
  ): { state: WorldState; events: SimEvent[]; matchComplete: boolean };
};

function makeWasmHost(): HostInternals {
  const spawn = (pid: PlayerId, name: string): PlayerSpawnInfo => ({
    playerId: pid,
    characterId: "balanced",
    weaponId: "starter-pistol",
    color: "#ffffff",
    name,
  });
  const host = new MatchHost("test-zig-draft", [spawn(A, "A"), spawn(B, "B")], []);
  const internals = host as unknown as HostInternals;
  // Belt-and-braces against module-cache ordering in full-suite runs —
  // same rationale as matchHostWasmEvents.test.ts.
  internals.simBackend = "wasm";
  serverWasmHost.setStatics(
    internals.map.platforms.map((p) => ({
      x: p.position.x - p.size.x / 2,
      y: p.position.y - p.size.y / 2,
      w: p.size.x,
      h: p.size.y,
    })),
    internals.map.platforms.map((p) => (p.kind === "platform" ? 1 : 0)),
  );
  serverWasmHost.setArenaBounds(
    internals.runtime.ceilingClampY,
    internals.map.size.y > 0 ? internals.map.size.y + KILL_PLANE_MARGIN_PX : 0,
  );
  serverWasmHost.setArenaSize(internals.map.size.x, internals.map.size.y);
  serverWasmHost.setLaunchPads(internals.map.launchPads ?? []);
  serverWasmHost.setSlopes(internals.map.slopes ?? []);
  serverWasmHost.setSpawnPoints(
    internals.map.spawns.length > 0
      ? internals.map.spawns
      : [{ x: internals.map.size.x / 2, y: internals.map.size.y / 2 }],
  );
  return internals;
}

function stepOnce(internals: HostInternals): SimEvent[] {
  const r = internals.runStep(internals.state, { [A]: null, [B]: null });
  internals.state = r.state;
  return r.events;
}

describe("MatchHost wasm backend — Zig-owned drafting (Track Z2 item 1)", () => {
  test("full draft cycle: Zig offers → queued pick → expiry auto-pick → countdown", () => {
    expect(serverWasmHost.isReady()).toBe(true);
    const internals = makeWasmHost();

    // Park the world at the end of a round A won, with the round-over
    // hold about to expire — the ZIG phase machine takes it from here.
    internals.state = {
      ...internals.state,
      round: {
        ...internals.state.round,
        phase: "round-over",
        countdownRemainingMs: 1,
        winnerPlayerId: A,
        scores: { [A]: 1 },
        roundIndex: 1,
      },
    };

    // 1. Enter drafting via Zig.
    let allEvents: SimEvent[] = [];
    let guard = 0;
    while (internals.state.round.phase !== "drafting") {
      allEvents.push(...stepOnce(internals));
      if (++guard > 10) throw new Error("never entered drafting");
    }
    const offers = internals.state.round.draftingOffers;
    expect(offers).toBeDefined();
    expect((offers?.[A] ?? []).length).toBe(3);
    expect((offers?.[B] ?? []).length).toBe(3);
    expect(allEvents.some((e) => e.t === "card-offered")).toBe(true);
    expect(internals.state.round.draftingPicked ?? {}).toEqual({});

    // 2. A picks the middle offer — validated + queued by applyCardPick,
    // applied inside the NEXT step, folded back into the TS state.
    const picked = offers![A]![1]!;
    internals.applyCardPick(A, {
      t: "card-pick",
      roundIndex: internals.state.round.roundIndex,
      cardId: picked,
    });
    const pickEvents = stepOnce(internals);
    expect(
      pickEvents.some(
        (e) => e.t === "draft-resolved" && e.playerId === A && e.cardId === picked && !e.autoPicked,
      ),
    ).toBe(true);
    expect(internals.state.players[A]!.cards).toContain(picked);
    expect(internals.state.round.draftingPicked?.[A]).toBe(picked);
    // Still drafting — B hasn't picked and the window is young.
    expect(internals.state.round.phase).toBe("drafting");
    // A double-click on a different card is inert (Zig's already-picked
    // gate) — the hand must not grow again.
    internals.applyCardPick(A, {
      t: "card-pick",
      roundIndex: internals.state.round.roundIndex,
      cardId: offers![A]![0]!,
    });
    stepOnce(internals);
    expect(internals.state.players[A]!.cards).toEqual(
      expect.arrayContaining([picked]),
    );
    expect(internals.state.players[A]!.cards.length).toBe(1);

    // 3. Let the window expire — B is auto-picked their FIRST offer by
    // Zig's expiry branch; the event stream carries it into B's TS hand.
    let autoEvent: SimEvent | undefined;
    guard = 0;
    while (internals.state.round.phase === "drafting") {
      const evs = stepOnce(internals);
      autoEvent ??= evs.find(
        (e) => e.t === "draft-resolved" && e.playerId === B && e.autoPicked,
      );
      if (++guard > 600) throw new Error("drafting never expired");
    }
    expect(autoEvent).toBeDefined();
    const bCard: string =
      autoEvent && "cardId" in autoEvent ? (autoEvent.cardId as string) : "";
    expect(bCard).toBe(offers![B]![0]!);
    expect(internals.state.players[B]!.cards).toEqual([bCard]);

    // Landed where TS lands: countdown, next round, bookkeeping wiped.
    expect(internals.state.round.phase as string).toBe("countdown");
    expect(internals.state.round.roundIndex).toBe(2);
    expect(internals.state.round.draftingOffers).toBeUndefined();
    expect(internals.state.round.draftingPicked).toBeUndefined();
    expect(internals.state.round.winnerPlayerId).toBeNull();
  });
});
