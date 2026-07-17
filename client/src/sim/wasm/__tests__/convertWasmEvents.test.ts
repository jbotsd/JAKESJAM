// Phase 98 contract tests — convertWasmEventsToTs.
// Pure translation: numeric event kind + payload slots →
// discriminated TS SimEvent. Tests every kind tag + the
// player-index → PlayerId resolution.

import { describe, expect, test } from "bun:test";
import {
  convertWasmEventsToTs,
  type WasmEvent,
} from "../convertWasmEvents";
import { PlayerId, Tick, type WorldState } from "../../types";

function fakeState(playerIds: string[]): WorldState {
  // We only need state.players' keys for the player-index sort.
  const players: Record<string, unknown> = {};
  for (const pid of playerIds) {
    players[pid] = { id: PlayerId(pid) };
  }
  return {
    tick: Tick(0),
    rngState: 0,
    players: players as unknown as WorldState["players"],
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 0,
      winnerPlayerId: null,
    },
  } as WorldState;
}

function ev(partial: Partial<WasmEvent>): WasmEvent {
  return {
    kind: 0,
    playerIdxA: 0,
    playerIdxB: 0,
    entityId: 0,
    scalar: 0,
    x: 0,
    y: 0,
    ...partial,
  };
}

describe("convertWasmEventsToTs", () => {
  test("empty list → empty result", () => {
    expect(convertWasmEventsToTs([], fakeState(["a"]))).toEqual([]);
  });

  test("kind=1 shot_fired with valid playerIdx → shot-fired event", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 1, playerIdxA: 0, x: 100, y: 200 })],
      fakeState(["alpha", "bravo"]),
    );
    expect(out.length).toBe(1);
    expect(out[0]).toEqual({
      t: "shot-fired",
      playerId: PlayerId("alpha"),
      x: 100,
      y: 200,
    });
  });

  test("kind=1 with out-of-range playerIdx → skipped", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 1, playerIdxA: 99 })],
      fakeState(["alpha"]),
    );
    expect(out).toEqual([]);
  });

  test("kind=2 hit_confirmed includes scalar as damage", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 2, playerIdxA: 1, scalar: 25 })],
      fakeState(["alpha", "bravo"]),
    );
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      t: "hit-confirmed",
      victimId: PlayerId("bravo"),
      damage: 25,
    });
  });

  test("kind=3 destructible_broken does NOT need a player idx", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 3, entityId: 42, x: 50, y: 60 })],
      fakeState([]),
    );
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      t: "destructible-broken",
      x: 50,
      y: 60,
    });
  });

  test("kind=4 pickup_taken needs player idx", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 4, playerIdxA: 0, entityId: 7 })],
      fakeState(["alpha"]),
    );
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ t: "pickup-taken" });
  });

  test("kind=5 round_end has winnerId from playerIdxA", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 5, playerIdxA: 1 })],
      fakeState(["alpha", "bravo"]),
    );
    expect(out.length).toBe(1);
    expect(out[0]).toEqual({
      t: "round-end",
      winnerId: PlayerId("bravo"),
    });
  });

  test("kind=5 round_end with -1 (no winner) → winnerId null", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 5, playerIdxA: -1 })],
      fakeState(["alpha"]),
    );
    expect(out[0]).toEqual({ t: "round-end", winnerId: null });
  });

  test("kind=6 player_killed → killerId resolved from playerIdxB (kill attribution 2026-07-17)", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 6, playerIdxA: 0, playerIdxB: 1 })],
      fakeState(["alpha", "bravo"]),
    );
    expect(out[0]).toMatchObject({
      t: "player-killed",
      victimId: PlayerId("alpha"),
      killerId: PlayerId("bravo"),
    });
  });

  test("kind=6 player_killed with playerIdxB=-1 (attacker-less death) → killerId null", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 6, playerIdxA: 0, playerIdxB: -1 })],
      fakeState(["alpha"]),
    );
    expect(out[0]).toMatchObject({
      t: "player-killed",
      killerId: null,
    });
  });

  test("kind=7 parry_deflected", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 7, playerIdxA: 0 })],
      fakeState(["alpha"]),
    );
    expect(out[0]).toMatchObject({ t: "parry-deflected" });
  });

  test("kind=8 shield_popped", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 8, playerIdxA: 0 })],
      fakeState(["alpha"]),
    );
    expect(out[0]).toMatchObject({ t: "shield-popped" });
  });

  test("unknown kind (e.g. 9 explosion / 10 fire_hit) is skipped silently", () => {
    const out = convertWasmEventsToTs(
      [ev({ kind: 9 }), ev({ kind: 10 }), ev({ kind: 99 })],
      fakeState(["alpha"]),
    );
    expect(out).toEqual([]);
  });

  test("player ids sorted alphabetically (matches packPlayer)", () => {
    // wasm wrote idxA=0 — after sorting ["zulu","alpha"] becomes
    // ["alpha","zulu"], so idx=0 should resolve to "alpha".
    const out = convertWasmEventsToTs(
      [ev({ kind: 1, playerIdxA: 0 })],
      fakeState(["zulu", "alpha"]),
    );
    expect(out[0]).toMatchObject({
      t: "shot-fired",
      playerId: PlayerId("alpha"),
    });
  });

  test("multi-event batch preserves order", () => {
    const out = convertWasmEventsToTs(
      [
        ev({ kind: 1, playerIdxA: 0 }),
        ev({ kind: 6, playerIdxA: 0 }),
        ev({ kind: 5, playerIdxA: 0 }),
      ],
      fakeState(["alpha"]),
    );
    expect(out.map((e) => e.t)).toEqual([
      "shot-fired",
      "player-killed",
      "round-end",
    ]);
  });
});
