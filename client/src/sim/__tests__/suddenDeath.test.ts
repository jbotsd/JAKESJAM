// computeStormZone: the single source of truth shared by damage
// (stepSuddenDeathStorm) and the render boundary (renderContract.
// produceStormZone) — the ring drawn must be exactly the ring that hurts.

import { describe, expect, test } from "bun:test";
import { computeStormZone, stepSuddenDeathStorm } from "../suddenDeath.js";
import { PlayerId } from "../types.js";
import type { PlayerEntity, RoundState } from "../types.js";

function baseRound(overrides: Partial<RoundState> = {}): RoundState {
  return {
    phase: "fighting",
    countdownRemainingMs: 90_000,
    roundIndex: 0,
    scores: {},
    suddenDeathActive: undefined,
    ...overrides,
  } as RoundState;
}

const MAP_SIZE = { x: 2000, y: 1000 };

function player(x: number, y: number, alive = true): PlayerEntity {
  return { id: PlayerId("p1"), x, y, health: 100, alive } as PlayerEntity;
}

describe("computeStormZone", () => {
  test("no-op outside fighting phase", () => {
    expect(computeStormZone(baseRound({ phase: "round-over" }), MAP_SIZE)).toBeNull();
  });

  test("no-op mid-round when neither endgame nor sudden death applies", () => {
    expect(computeStormZone(baseRound({ countdownRemainingMs: 50_000 }), MAP_SIZE)).toBeNull();
  });

  test("endgame zone activates in the final 15s of every round, kind=endgame", () => {
    const zone = computeStormZone(baseRound({ countdownRemainingMs: 10_000 }), MAP_SIZE);
    expect(zone).not.toBeNull();
    expect(zone!.kind).toBe("endgame");
    expect(zone!.scale).toBeLessThan(1.0);
    expect(zone!.scale).toBeGreaterThanOrEqual(0.75);
    expect(zone!.centerX).toBe(MAP_SIZE.x / 2);
    expect(zone!.centerY).toBe(MAP_SIZE.y / 2);
  });

  test("full sudden death overrides endgame zone and shrinks harder", () => {
    const zone = computeStormZone(
      baseRound({ countdownRemainingMs: 10_000, suddenDeathActive: true }),
      MAP_SIZE,
    );
    expect(zone).not.toBeNull();
    expect(zone!.kind).toBe("sudden-death");
    // Same elapsed time, harder end scale (0.6) than endgame's (0.75).
    expect(zone!.scale).toBeLessThan(0.75);
  });

  test("radius shrinks monotonically as the round progresses", () => {
    const early = computeStormZone(baseRound({ countdownRemainingMs: 89_000, suddenDeathActive: true }), MAP_SIZE)!;
    const late = computeStormZone(baseRound({ countdownRemainingMs: 1_000, suddenDeathActive: true }), MAP_SIZE)!;
    expect(late.radius).toBeLessThan(early.radius);
  });

  test("radius covers every corner at scale=1 (round start)", () => {
    const zone = computeStormZone(baseRound({ countdownRemainingMs: 89_999, suddenDeathActive: true }), MAP_SIZE)!;
    const cornerDist = Math.hypot(MAP_SIZE.x / 2, MAP_SIZE.y / 2);
    expect(zone.radius).toBeGreaterThanOrEqual(cornerDist * 0.999);
  });
});

describe("stepSuddenDeathStorm ↔ computeStormZone parity", () => {
  test("a player just inside the computed radius takes no damage; just outside does", () => {
    const round = baseRound({ countdownRemainingMs: 10_000, suddenDeathActive: true });
    const zone = computeStormZone(round, MAP_SIZE)!;

    const inside = player(zone.centerX + zone.radius - 5, zone.centerY);
    const outside = player(zone.centerX + zone.radius + 5, zone.centerY);

    const rIn = stepSuddenDeathStorm({ [inside.id]: inside }, round, MAP_SIZE, 16.7);
    expect(rIn.events.length).toBe(0);

    const rOut = stepSuddenDeathStorm({ [outside.id]: outside }, round, MAP_SIZE, 16.7);
    expect(rOut.events.length).toBe(1);
    expect(rOut.events[0]).toMatchObject({ t: "hit-confirmed", victimId: outside.id });
  });

  test("dead players never take storm damage", () => {
    const round = baseRound({ countdownRemainingMs: 5_000, suddenDeathActive: true });
    const zone = computeStormZone(round, MAP_SIZE)!;
    const corpse = player(zone.centerX + zone.radius + 500, zone.centerY, false);
    const r = stepSuddenDeathStorm({ [corpse.id]: corpse }, round, MAP_SIZE, 16.7);
    expect(r.events.length).toBe(0);
  });
});
