// gospel E2-b: the venue lobby's round machine runs under wasm authority
// LIVE, while every isolated test says it is frozen.
//
// The difference between the passing tests and the live server is that
// live, the lobby is NOT the only host. A real process runs the always-on
// venue lobby (mode "hangout") AND the arena world (mode "combat") through
// ONE serverWasmHost singleton, whose hangout flag is a wasm GLOBAL
// (world.zig's g_hangout_mode) set per step. matchHostHangoutWasm.test.ts
// steps a hangout host on its own, so it can never observe one host's
// setting leaking into the other's step.
//
// This file reproduces the live shape: two hosts, alternating steps,
// sharing the singleton. The assertion is the one E2-b is about — a
// hangout host's round machine must stay frozen no matter what stepped
// before it.

import { describe, expect, test } from "bun:test";

process.env.USE_WASM_STEP_WORLD = "1";

const { serverWasmHost } = await import("../serverWasmHost.ts");
await serverWasmHost.preload();
const { MatchHost } = await import("../matchHost.ts");

import {
  PlayerId,
  type InputFrame,
  type MapDefinition,
  type PlayerSpawnInfo,
  type SimEvent,
  type WorldState,
} from "@sim/types.ts";
import type { WorldRuntime } from "@sim/World.ts";

const A = PlayerId("interleave-a");
const B = PlayerId("interleave-b");

type HostInternals = {
  map: MapDefinition;
  state: WorldState;
  runtime: WorldRuntime;
  simBackend: "wasm" | "ts";
  runStep(
    state: WorldState,
    inputsByPlayer: Record<PlayerId, InputFrame | null>,
  ): { state: WorldState; events: SimEvent[]; matchComplete: boolean };
};

const openMap: MapDefinition = {
  id: "interleave-test-arena",
  name: "Interleave Test Arena",
  size: { x: 2000, y: 2000 },
  spawns: [
    { x: 400, y: 300 },
    { x: 600, y: 300 },
  ],
  platforms: [],
};

function spawn(pid: PlayerId, name: string): PlayerSpawnInfo {
  return {
    playerId: pid,
    characterId: "balanced",
    weaponId: "starter-pistol",
    color: "#ffffff",
    name,
  };
}

function makeHost(
  matchId: string,
  mode: "combat" | "hangout",
  players: PlayerSpawnInfo[] = [spawn(A, "A"), spawn(B, "B")],
): HostInternals {
  const host = new MatchHost(
    matchId,
    players,
    [],
    openMap,
    mode === "hangout" ? { mode } : undefined,
  );
  const internals = host as unknown as HostInternals;
  // Same module-cache ordering guard as matchHostHangoutWasm.test.ts.
  internals.simBackend = "wasm";
  internals.state = {
    ...internals.state,
    round: { ...internals.state.round, phase: "fighting", countdownRemainingMs: 90_000 },
  };
  return internals;
}

/** The REAL venue lobby, unlike every existing test, is constructed with
 *  an EMPTY player list — venueHost's buildLobby() passes []. An empty
 *  round has no combatants, which a combat-mode round machine can resolve
 *  as "over" immediately; hangout mode is what is supposed to stop that
 *  machine from ever running. So zero players is the condition under
 *  which the freeze actually matters, and no test covered it. */
function makeEmptyHangoutHost(matchId: string): HostInternals {
  return makeHost(matchId, "hangout", []);
}

const idle: Record<PlayerId, InputFrame | null> = { [A]: null, [B]: null };

describe("E2-b — a hangout host's round stays frozen while a combat host shares the wasm singleton", () => {
  test("alternating steps: hangout clock frozen, combat clock moves", () => {
    const combat = makeHost("interleave-combat", "combat");
    const hangout = makeHost("interleave-hangout", "hangout");

    const hangoutStart = hangout.state.round.countdownRemainingMs;
    const combatStart = combat.state.round.countdownRemainingMs;

    // Alternate the way the real server does — arena, lobby, arena, lobby.
    for (let i = 0; i < 120; i += 1) {
      combat.state = combat.runStep(combat.state, idle).state;
      hangout.state = hangout.runStep(hangout.state, idle).state;
    }

    // Vacuity guard FIRST: if the combat clock did not move, the loop did
    // not really step anything and the hangout assertion below would pass
    // on nothing.
    expect(combat.state.round.countdownRemainingMs).toBeLessThan(combatStart);

    // The E2-b assertion.
    expect(hangout.state.round.phase).toBe("fighting");
    expect(hangout.state.round.countdownRemainingMs).toBe(hangoutStart);
  });

  test("an EMPTY hangout host (the real lobby's shape) never leaves 'fighting'", () => {
    const lobby = makeEmptyHangoutHost("interleave-empty-lobby");
    expect(lobby.state.round.phase).toBe("fighting");
    for (let i = 0; i < 240; i += 1) {
      lobby.state = lobby.runStep(lobby.state, {}).state;
    }
    expect(lobby.state.round.phase).toBe("fighting");
  });

  test("reverse order (hangout first) is equally frozen", () => {
    // Order matters if the leak is "whoever stepped last wins": stepping
    // the hangout host FIRST each iteration would hide that direction.
    const combat = makeHost("interleave-combat-2", "combat");
    const hangout = makeHost("interleave-hangout-2", "hangout");
    const hangoutStart = hangout.state.round.countdownRemainingMs;

    for (let i = 0; i < 120; i += 1) {
      hangout.state = hangout.runStep(hangout.state, idle).state;
      combat.state = combat.runStep(combat.state, idle).state;
    }

    expect(hangout.state.round.phase).toBe("fighting");
    expect(hangout.state.round.countdownRemainingMs).toBe(hangoutStart);
  });
});
