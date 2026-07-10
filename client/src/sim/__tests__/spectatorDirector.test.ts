import { describe, expect, test } from "bun:test";
import {
  createDirectorState,
  directorToPose,
  stepSpectatorDirector,
  type DirectorState,
} from "../spectatorDirector.js";
import type { PlayerEntity, PlayerId, SimEvent, WorldState } from "../types.js";
import { Tick } from "../types.js";

function player(
  id: string,
  x: number,
  y: number,
  opts: Partial<PlayerEntity> = {},
): PlayerEntity {
  return {
    id: id as PlayerId,
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: x + 10,
    aimY: y,
    alive: true,
    health: 100,
    ...opts,
  } as PlayerEntity;
}

function bareState(players: Record<string, PlayerEntity>): WorldState {
  return {
    tick: Tick(1),
    rngState: 1,
    players: players as WorldState["players"],
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      roundIndex: 0,
      scores: {},
      targetScore: 5,
      countdownRemainingMs: 0,
      winnerPlayerId: null,
    },
  } as WorldState;
}

function advance(
  dir: DirectorState,
  state: WorldState,
  events: SimEvent[] = [],
  n = 1,
): DirectorState {
  let d = dir;
  for (let i = 0; i < n; i++) {
    d = stepSpectatorDirector(d, state, events, 1 / 60);
  }
  return d;
}

describe("spectatorDirector", () => {
  test("snaps to first alive player on ready", () => {
    const state = bareState({
      p1: player("p1", 400, 500),
    });
    const d = stepSpectatorDirector(createDirectorState(), state, []);
    expect(d.ready).toBe(true);
    expect(d.x).toBeCloseTo(400, 0);
    expect(d.y).toBeCloseTo(500, 0);
    expect(d.mode).toBe("duel");
  });

  test("prefers close duel over overview", () => {
    const state = bareState({
      a: player("a", 1000, 500),
      b: player("b", 1100, 500),
      c: player("c", 2600, 500),
    });
    const d = advance(createDirectorState(), state, [], 5);
    expect(d.mode).toBe("duel");
    expect(d.focusA === "a" || d.focusA === "b").toBe(true);
    expect(d.focusB === "a" || d.focusB === "b").toBe(true);
    expect(Math.abs(d.x - 1050)).toBeLessThan(80);
  });

  test("kill event holds framing near victim", () => {
    const state = bareState({
      a: player("a", 800, 400),
      b: player("b", 900, 400),
    });
    let d = advance(createDirectorState(), state, [], 3);
    const kill: SimEvent = {
      t: "player-killed",
      victimId: "b" as PlayerId,
      killerId: "a" as PlayerId,
      cause: "projectile",
    };
    d = stepSpectatorDirector(d, state, [kill], 1 / 60);
    expect(d.mode).toBe("kill");
    expect(d.killTicks).toBeGreaterThan(0);
    // Mid-point of a/b ≈ 850
    expect(Math.abs(d.x - 850)).toBeLessThan(40);
  });

  test("pose wire quantizes stably", () => {
    const state = bareState({ a: player("a", 1234.567, 678.901) });
    const d = stepSpectatorDirector(createDirectorState(), state, []);
    const pose = directorToPose(d);
    expect(pose.x).toBe(Math.round(d.x * 10) / 10);
    expect(pose.z).toBeGreaterThan(0.5);
    expect(pose.z).toBeLessThan(2);
    expect(["overview", "duel", "kill", "chaos"]).toContain(pose.mode);
  });

  test("overview when fighters are far apart", () => {
    const state = bareState({
      a: player("a", 200, 500),
      b: player("b", 2800, 500),
    });
    const d = advance(createDirectorState(), state, [], 10);
    // Far pair scores 0 → overview or single-style; not a tight duel mid.
    expect(d.mode === "overview" || d.mode === "chaos").toBe(true);
    expect(d.z).toBeLessThan(1.15); // pulled out
  });
});
