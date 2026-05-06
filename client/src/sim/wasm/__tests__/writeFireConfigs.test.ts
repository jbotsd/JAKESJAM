// Phase 97 contract tests — writeFireConfigsForState's
// per-player cache invalidation. Mocks wasmHost.writeFireConfigs
// to capture what would be sent to wasm memory.

import { describe, expect, test, beforeEach, mock } from "bun:test";
import {
  writeFireConfigsForState,
  __clearFireConfigCacheForTests,
} from "../writeFireConfigs";
import { wasmHost, type ResolvedFireConfigBytes } from "../wasmHost";
import {
  EntityId,
  PlayerId,
  Tick,
  type WorldState,
} from "../../types";

type FakePlayer = {
  id: PlayerId;
  weaponId: string;
  cards: string[];
};

function fakePlayer(
  pid: string,
  cards: string[],
  weaponId: string = "starter-pistol",
): FakePlayer {
  return {
    id: PlayerId(pid),
    weaponId,
    cards,
  };
}
void EntityId;

function fakeState(
  playersIn: Record<string, FakePlayer>,
): WorldState {
  return {
    tick: Tick(0),
    rngState: 0,
    players: playersIn as unknown as WorldState["players"],
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

describe("writeFireConfigsForState", () => {
  let captured: Array<Array<ResolvedFireConfigBytes | null>>;

  beforeEach(() => {
    __clearFireConfigCacheForTests();
    captured = [];
    wasmHost.writeFireConfigs = mock(
      (configs: ReadonlyArray<ResolvedFireConfigBytes | null>) => {
        captured.push([...configs]);
      },
    );
  });

  test("empty state → empty configs array", () => {
    writeFireConfigsForState(fakeState({}));
    expect(captured.length).toBe(1);
    expect(captured[0]!.length).toBe(0);
  });

  test("one player → one config; bytes have valid shape", () => {
    writeFireConfigsForState(
      fakeState({ p1: fakePlayer("p1", []) }),
    );
    expect(captured.length).toBe(1);
    expect(captured[0]!.length).toBe(1);
    const cfg = captured[0]![0];
    expect(cfg).not.toBeNull();
    expect(typeof cfg!.damage).toBe("number");
    expect(typeof cfg!.fireRate).toBe("number");
    expect(cfg!.projectileCount).toBeGreaterThanOrEqual(1);
  });

  test("two players → two configs in sorted-id order", () => {
    writeFireConfigsForState(
      fakeState({
        p2: fakePlayer("p2", []),
        p1: fakePlayer("p1", []),
      }),
    );
    // packPlayer order is sorted ids; coordinator should match.
    expect(captured[0]!.length).toBe(2);
  });

  test("call twice with same state → cache hit (same bytes ref)", () => {
    const s = fakeState({ p1: fakePlayer("p1", []) });
    writeFireConfigsForState(s);
    writeFireConfigsForState(s);
    expect(captured.length).toBe(2);
    // Same bytes object ref on both calls (cache hit means we
    // returned the cached entry without re-resolving).
    expect(captured[0]![0]).toBe(captured[1]![0]);
  });

  test("change cards → cache miss (new bytes ref, different damage)", () => {
    writeFireConfigsForState(
      fakeState({ p1: fakePlayer("p1", []) }),
    );
    writeFireConfigsForState(
      fakeState({ p1: fakePlayer("p1", ["any-non-existent-card"]) }),
    );
    expect(captured[0]![0]).not.toBe(captured[1]![0]);
  });

  test("clear cache via __clearFireConfigCacheForTests", () => {
    const s = fakeState({ p1: fakePlayer("p1", []) });
    writeFireConfigsForState(s);
    __clearFireConfigCacheForTests();
    writeFireConfigsForState(s);
    // Cache cleared → re-resolve produces a new bytes object.
    expect(captured[0]![0]).not.toBe(captured[1]![0]);
  });
});
