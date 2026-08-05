// Track E1d (gospel-goal.md E1 — "hangout flag in `step_world`"): the
// hangout hard-pin to TS in matchHost's backend pick is LIFTED.
//
// WHAT THIS PINS: (1) serverWasmHost surfaces the new capability
// (supportsHangoutFlag) and threads `opts.hangoutMode` into
// world_state_set_hangout_mode before every step; (2) a `mode:"hangout"`
// MatchHost stepping on the WASM backend gets the lobby's no-PvP
// semantics — a hitscan ray aimed dead at another player deals ZERO
// damage and the round clock never moves — while the IDENTICAL combat
// host setup lands the hit (vacuity guard: the scenario genuinely
// reaches the damage path through the wasm step, so the hangout zero is
// the flag working, not a miss); (3) matchHost's per-step config re-sync
// (wasmConfigOwner) pushes THIS host's map into the shared singleton —
// these tests deliberately do NOT hand-push statics/bounds the way the
// older wasm tests do, so a regression in the re-sync fails them.

import { describe, expect, test, spyOn } from "bun:test";

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
import { InputSeq, Tick } from "@sim/types.ts";
import type { WorldRuntime } from "@sim/World.ts";

const A = PlayerId("hangout-wasm-a");
const B = PlayerId("hangout-wasm-b");
const FIRE_BIT = 1 << 6;

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

// Open arena, no terrain between the duellists — isolates the ray from
// map geometry. (No floor either: one tick of fall is ~0.4px, well inside
// the victim's ±28px body box.)
const openMap: MapDefinition = {
  id: "hangout-wasm-test-arena",
  name: "Hangout Wasm Test Arena",
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
    characterId: "balanced", // wizard — ALWAYS raycast (THE GEOMETRICIAN RULING)
    weaponId: "starter-pistol",
    color: "#ffffff",
    name,
  };
}

function makeHost(matchId: string, mode: "combat" | "hangout"): HostInternals {
  const host = new MatchHost(
    matchId,
    [spawn(A, "A"), spawn(B, "B")],
    [],
    openMap,
    mode === "hangout" ? { mode } : undefined,
  );
  const internals = host as unknown as HostInternals;
  // Module-cache ordering guard (same shape as matchHostWasmEvents.test.ts):
  // if another test file imported matchHost.ts before our env write, the
  // module-level USE_WASM_STEP_WORLD gate read false and the constructor
  // picked "ts". Force the wasm backend; the per-step config re-sync
  // (wasmConfigOwner — the thing test 2/3 exercise) handles the rest.
  internals.simBackend = "wasm";
  // Deterministic duel geometry regardless of the map's spawn assignment.
  internals.state = {
    ...internals.state,
    round: {
      ...internals.state.round,
      phase: "fighting",
      countdownRemainingMs: 90_000,
    },
    players: {
      ...internals.state.players,
      [A]: { ...internals.state.players[A]!, x: 400, y: 300, vx: 0, vy: 0 },
      [B]: { ...internals.state.players[B]!, x: 600, y: 300, vx: 0, vy: 0 },
    },
  };
  return internals;
}

/** One tick: A fires dead at B's centre. Returns the stepped result and
 *  whether the wasm branch silently fell back to TS. */
function fireAtB(internals: HostInternals): {
  result: ReturnType<HostInternals["runStep"]>;
  fellBack: boolean;
} {
  const warnSpy = spyOn(console, "warn");
  const inputs: Record<PlayerId, InputFrame | null> = {
    [A]: {
      seq: InputSeq(1),
      tick: Tick(1),
      keys: FIRE_BIT,
      aimX: 600,
      aimY: 300,
      dtMs: 1000 / 60,
    },
    [B]: null,
  };
  const result = internals.runStep(internals.state, inputs);
  const fellBack = warnSpy.mock.calls.some((args) =>
    String(args[0]).includes("wasm step threw"),
  );
  warnSpy.mockRestore();
  return { result, fellBack };
}

describe("MatchHost hangout on the wasm backend — the TS pin is lifted (Track E1d)", () => {
  test("the loaded sim.wasm supports the hangout flag (supportsHangoutFlag)", () => {
    expect(serverWasmHost.isReady()).toBe(true);
    expect(serverWasmHost.supportsHangoutFlag()).toBe(true);
  });

  test("combat control (vacuity guard): the identical wasm-stepped ray lands — victim damaged, round clock moves", () => {
    const internals = makeHost("test-hangout-wasm-combat", "combat");
    const { result, fellBack } = fireAtB(internals);
    expect(fellBack).toBe(false);
    expect(result.state.players[B]!.health).toBeLessThan(100);
    expect(result.state.round.countdownRemainingMs).toBeLessThan(90_000);
  });

  test("hangout host: PvP immune + round frozen through the wasm step (config re-synced per step, no hand-pushed statics)", () => {
    // Interleave: step a COMBAT host first so the singleton's config slot
    // belongs to another match — the hangout step below must re-occupy it
    // via the wasmConfigOwner re-sync, exactly the live lobby/arena
    // interleaving shape.
    const combat = makeHost("test-hangout-wasm-interleave", "combat");
    expect(fireAtB(combat).fellBack).toBe(false);

    const internals = makeHost("test-hangout-wasm-lobby", "hangout");
    const { result, fellBack } = fireAtB(internals);
    expect(fellBack).toBe(false);
    // (1) PvP immunity at the wasm damage surface: the same ray that
    //     lands in the combat control deals nothing here.
    expect(result.state.players[B]!.health).toBe(100);
    expect(result.state.players[B]!.alive).toBe(true);
    // (2) round machine frozen: the lobby clock never moves, phase pinned.
    expect(result.state.round.phase).toBe("fighting");
    expect(result.state.round.countdownRemainingMs).toBe(90_000);
    // The shot itself stays LIVE in the lobby (practice firing is a venue
    // feature, not collateral) — the wasm event stream still surfaces it.
    expect(result.events.map((e) => e.t)).toContain("shot-fired");
  });
});
