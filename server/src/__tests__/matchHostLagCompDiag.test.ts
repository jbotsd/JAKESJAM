// Perf audit N1 (2026-07-18) regression test.
//
// logLagCompOutcomeChange ran an UNCONDITIONAL second full stepWithRuntime +
// a runtime clone on every tick with any rewind, purely to console.log a
// diagnostic comparison — roughly doubling authoritative sim cost during
// combat. Fixed by gating it behind config.lagCompDiag (default off).
//
// While wiring the gate, the original diff coupled the diagnostic flag to
// the SAME `if` that runs `unshiftAfterStep` — the real, authoritative
// rewind-undo, not a diagnostic. That would have silently broken lag
// compensation for every match whenever the (default-off) diag flag was
// off. This test's primary job is proving that regression can't recur:
// the authoritative unshift must always run when a rewind plan exists,
// independent of the diagnostic flag.
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { MatchHost } from "../matchHost.ts";
import { LagCompensator } from "@sim/LagCompensator.ts";
import { config } from "../config.ts";
import { PlayerId, type PlayerSpawnInfo, type WorldState } from "@sim/types.ts";

const A = PlayerId("a");
const B = PlayerId("b");
const FIRE_BIT = 64;

type HostInternals = {
  applyInput(playerId: PlayerId, input: { seq: number; tick: number; keys: number; aimX: number; aimY: number; dt: number }): void;
  tick(): void;
  state: WorldState;
};

function makeHost(): HostInternals {
  const spawnA: PlayerSpawnInfo = {
    playerId: A,
    characterId: "balanced",
    weaponId: "starter-pistol",
    color: "#ff0000",
    name: "A",
  };
  const spawnB: PlayerSpawnInfo = {
    playerId: B,
    characterId: "balanced",
    weaponId: "starter-pistol",
    color: "#0000ff",
    name: "B",
  };
  const host = new MatchHost("test-lagcomp-diag", [spawnA, spawnB], []);
  const internals = host as unknown as HostInternals;
  // Never attached: no setInterval loop was ever started (only attachClient
  // starts it), so driving ticks directly is deterministic with no cleanup
  // needed.
  return internals;
}

/**
 * Drive N ticks with B's x position nudged before each one, so the recorded
 * position-history samples genuinely differ tick-to-tick. buildRewindPlan
 * treats a zero (dx, dy) shift as "nothing to rewind" and returns null — a
 * B pinned at one constant position for the whole setup (as a real player
 * standing still on a platform would be) can never produce a plan.
 */
function primeHistoryWithMovingTarget(internals: HostInternals, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    internals.state = {
      ...internals.state,
      players: {
        ...internals.state.players,
        [A]: { ...internals.state.players[A]!, x: 100, y: 200, vx: 0, vy: 0 },
        [B]: { ...internals.state.players[B]!, x: 500 - i * 10, y: 200, vx: 0, vy: 0 },
      },
    } as WorldState;
    internals.tick();
  }
}

describe("MatchHost lag-comp diagnostic gating (perf audit N1)", () => {
  const originalDiag = config.lagCompDiag;
  afterEach(() => {
    (config as { lagCompDiag: boolean }).lagCompDiag = originalDiag;
  });

  test("default (lagCompDiag off): outcome-diagnostic does not run, but the authoritative unshift still does", () => {
    (config as { lagCompDiag: boolean }).lagCompDiag = false;
    const internals = makeHost();

    const unshiftSpy = spyOn(LagCompensator.prototype, "unshiftAfterStep");
    const logSpy = spyOn(MatchHost.prototype as unknown as Record<string, () => void>, "logLagCompOutcomeChange");
    try {
      // Build position history so buildRewindPlan has samples to rewind from.
      primeHistoryWithMovingTarget(internals, 10);
      const serverTick = internals.state.tick as unknown as number;

      internals.applyInput(A, {
        seq: 1,
        tick: serverTick - 3,
        keys: FIRE_BIT,
        aimX: 500,
        aimY: 200,
        dt: 16.67,
      });
      internals.tick();

      expect(unshiftSpy.mock.calls.length).toBeGreaterThan(0);
      expect(logSpy.mock.calls.length).toBe(0);
    } finally {
      unshiftSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test("lagCompDiag on: outcome-diagnostic runs alongside the authoritative unshift", () => {
    (config as { lagCompDiag: boolean }).lagCompDiag = true;
    const internals = makeHost();

    const unshiftSpy = spyOn(LagCompensator.prototype, "unshiftAfterStep");
    const logSpy = spyOn(MatchHost.prototype as unknown as Record<string, () => void>, "logLagCompOutcomeChange");
    try {
      primeHistoryWithMovingTarget(internals, 10);
      const serverTick = internals.state.tick as unknown as number;

      internals.applyInput(A, {
        seq: 1,
        tick: serverTick - 3,
        keys: FIRE_BIT,
        aimX: 500,
        aimY: 200,
        dt: 16.67,
      });
      internals.tick();

      expect(unshiftSpy.mock.calls.length).toBeGreaterThan(0);
      expect(logSpy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      unshiftSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
