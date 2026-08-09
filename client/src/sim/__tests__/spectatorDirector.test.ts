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

describe("idle dwell cap (footage S2)", () => {
  // docs/clip-sheets/study-2026-08-05-jul31-replay.md, HIGH: "every S1 statue
  // run is also a director choice — the auto-camera framed the idle bot alone
  // for the full run each time" (6-8 s). pairScore weights speed, but
  // closeness (x1.6) plus low HP can clear the duel threshold with ZERO
  // movement, and the single-survivor branch frames a player regardless of
  // motion, so nothing capped how long stillness could hold the camera.

  test("the camera does not hold a motionless subject past ~1.5 s", () => {
    const state = bareState({ p1: player("p1", 400, 500) });
    let d = createDirectorState();
    d = advance(d, state, [], 200); // >3 s of a perfectly still lone player
    // It must have let go of the subject — either a wide shot, or nothing
    // held as focus. Before the cap this stayed a duel on p1 forever.
    const releasedFocus = d.focusA === null;
    expect(releasedFocus || d.mode === "overview").toBe(true);
  });

  test("it cuts to whoever is moving, and never stares longer than the cap", () => {
    // A still pair that still scores as a "duel" (close + both hurt) plus one
    // player sprinting elsewhere. This is the filmed situation: the camera
    // preferred the motionless pair because pairScore weights closeness
    // (x1.6) and low HP over speed.
    const state = bareState({
      still_a: player("still_a", 400, 500, { health: 30 }),
      still_b: player("still_b", 460, 500, { health: 30 }),
      runner: player("runner", 1800, 500, { vx: 320, vy: 0 }),
    });
    let d = createDirectorState();
    let framesOnRunner = 0;
    let stillStreak = 0;
    let worstStillStreak = 0;
    for (let i = 0; i < 600; i++) {
      d = advance(d, state, [], 1);
      if (d.focusA === "runner") {
        framesOnRunner += 1;
        stillStreak = 0;
      } else {
        stillStreak += 1;
        worstStillStreak = Math.max(worstStillStreak, stillStreak);
      }
    }
    // The camera must spend real time on the action…
    expect(framesOnRunner).toBeGreaterThan(120); // >2 s of 10 s
    // …and must never hold the motionless pair for anything like the 6-8 s
    // that was filmed. The cap is 1.5 s; allow the dwell that follows a cut
    // plus a frame of slack.
    expect(worstStillStreak).toBeLessThan(Math.round(3.4 * 60));

    // NOT yet solved, and deliberately not asserted: full action-weighted
    // SCORING, so a sprinting player simply outranks a motionless pair
    // instead of having to wait for the cap. That is a pairScore rebalance
    // with feel consequences (docs/clip-sheets S2 called for "action-weighted
    // scoring AND a dwell cap"); this test pins the cap half.
  });

  test("a moving subject is never cut away from", () => {
    // The cap must not become a metronome: genuine action holds the camera.
    const state = bareState({
      a: player("a", 400, 500, { vx: 240 }),
      b: player("b", 520, 500, { vx: -210 }),
    });
    let d = createDirectorState();
    d = advance(d, state, [], 300);
    expect(d.mode).toBe("duel");
    expect(d.idleTicks).toBe(0);
  });
});
