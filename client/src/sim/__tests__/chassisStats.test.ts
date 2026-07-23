// Chassis truth (docs/cohesion-goal.md Pillar 1): the sim ENFORCES the
// per-class physical stat sheet it used to only display. Before 2026-07-23,
// chassisStatsForArchetype's speed/recoil values never left the display
// layer — every class resolved moveSpeedMultiplier 1 (cards-only) and paid
// identical recoil. These tests pin the table (P1.1), prove the speed fold
// (P1.2), prove recoil control (P1.3), and prove the speed difference is
// real in a stepped world (P1.2's integration row). Hitbox scaling (P1.4)
// is the separate flagged commit and has its own suite when it lands.

import { describe, expect, test } from "bun:test";
import { chassisStatsForArchetype, baseMaxHealthForArchetype } from "../data/cardTypes.js";
import { resolvePlayerBuild, stepWeapon } from "../weapon.js";
import { createRuntime, stepWithRuntime } from "../World.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type CharacterArchetype,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;
const RIGHT_BIT = 1 << 1;

function mkPlayer(
  id: string,
  characterId: CharacterArchetype,
  over: Partial<PlayerEntity> = {},
): PlayerEntity {
  return {
    id: PlayerId(id),
    characterId,
    x: 200,
    y: 400,
    vx: 0,
    vy: 0,
    aimX: 300,
    aimY: 400,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 8,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(0),
    ...over,
  };
}

describe("P1.1 — the chassis stat table (single source of truth)", () => {
  test("all sixteen values pinned", () => {
    expect(chassisStatsForArchetype("balanced")).toEqual({
      maxHealth: 100,
      moveSpeedMultiplier: 1,
      sizeScale: 1,
      recoilControlMultiplier: 1,
    });
    expect(chassisStatsForArchetype("heavy")).toEqual({
      maxHealth: 125,
      moveSpeedMultiplier: 0.88,
      sizeScale: 1.18,
      recoilControlMultiplier: 1.25,
    });
    expect(chassisStatsForArchetype("sprinter")).toEqual({
      maxHealth: 85,
      moveSpeedMultiplier: 1.14,
      sizeScale: 0.92,
      recoilControlMultiplier: 0.9,
    });
    expect(chassisStatsForArchetype("shielded")).toEqual({
      maxHealth: 100,
      moveSpeedMultiplier: 0.96,
      sizeScale: 1.05,
      recoilControlMultiplier: 1,
    });
  });

  test("baseMaxHealthForArchetype is a view over the same table (no second copy)", () => {
    for (const c of ["balanced", "heavy", "sprinter", "shielded"] as CharacterArchetype[]) {
      expect(baseMaxHealthForArchetype(c)).toBe(chassisStatsForArchetype(c).maxHealth);
    }
  });
});

describe("P1.2 — class speed reaches the resolved build", () => {
  test("bare-class builds resolve the class factor, not a flat 1", () => {
    expect(resolvePlayerBuild(mkPlayer("a", "balanced")).moveSpeedMultiplier).toBeCloseTo(1, 5);
    expect(resolvePlayerBuild(mkPlayer("b", "heavy")).moveSpeedMultiplier).toBeCloseTo(0.88, 5);
    expect(resolvePlayerBuild(mkPlayer("c", "sprinter")).moveSpeedMultiplier).toBeCloseTo(1.14, 5);
    expect(resolvePlayerBuild(mkPlayer("d", "shielded")).moveSpeedMultiplier).toBeCloseTo(0.96, 5);
  });

  test("a speed card multiplies ON TOP of the class factor", () => {
    // sprint-coils: moveSpeedMultiplier 1.18 (cards.ts). Cards resolve
    // through orthogonalScale/clamp first; the class factor multiplies the
    // card-resolved value, so the composed sprinter beats both the bare
    // sprinter and a balanced player holding the same card.
    const balancedWithCard = resolvePlayerBuild(mkPlayer("e", "balanced", { cards: ["sprint-coils"] }));
    const sprinterWithCard = resolvePlayerBuild(mkPlayer("f", "sprinter", { cards: ["sprint-coils"] }));
    expect(balancedWithCard.moveSpeedMultiplier).toBeGreaterThan(1);
    expect(sprinterWithCard.moveSpeedMultiplier).toBeCloseTo(
      balancedWithCard.moveSpeedMultiplier * 1.14,
      5,
    );
    // clampBuild's band survives the fold: nothing resolves outside it.
    expect(sprinterWithCard.moveSpeedMultiplier).toBeLessThanOrEqual(1.55);
    expect(resolvePlayerBuild(mkPlayer("g", "heavy")).moveSpeedMultiplier).toBeGreaterThanOrEqual(0.45);
  });
});

describe("P1.3 — recoil control is real physics", () => {
  function selfKickAfterOneShot(characterId: CharacterArchetype): number {
    let nextId = 1;
    const result = stepWeapon(
      mkPlayer(`rc-${characterId}`, characterId),
      true,
      { x: 500, y: 400 },
      DT_MS,
      () => EntityId(nextId++),
    );
    expect(result.fired).toBe(true);
    return Math.hypot(result.player.vx, result.player.vy);
  }

  test("Kindled's gun kicks less than Geometrician's; Interstice's kicks more", () => {
    const balanced = selfKickAfterOneShot("balanced");
    const kindled = selfKickAfterOneShot("heavy");
    const interstice = selfKickAfterOneShot("sprinter");
    expect(kindled).toBeLessThan(balanced);
    expect(interstice).toBeGreaterThan(balanced);
    // The exact ratios are the table's — recoil DIVIDES by recoilControl.
    expect(kindled).toBeCloseTo(balanced / 1.25, 3);
    expect(interstice).toBeCloseTo(balanced / 0.9, 3);
  });
});

describe("P1.2 integration — the speed difference is real in a stepped world", () => {
  const flatMap: MapDefinition = {
    id: "chassis-test",
    name: "chassis-test",
    size: { x: 4000, y: 720 },
    spawns: [
      { x: 200, y: 400 },
      { x: 200, y: 400 },
    ],
    platforms: [
      { id: "floor", kind: "floor", position: { x: 2000, y: 700 }, size: { x: 4000, y: 40 } },
    ],
  };

  function mkState(players: PlayerEntity[]): WorldState {
    const playerMap: Record<PlayerId, PlayerEntity> = {};
    for (const p of players) playerMap[p.id] = p;
    return {
      tick: Tick(0),
      rngState: 1234567 >>> 0,
      players: playerMap,
      projectiles: {},
      destructibles: {},
      firePatches: {},
      pickups: {},
      satellites: {},
      round: {
        phase: "fighting",
        countdownRemainingMs: 90_000,
        scores: Object.fromEntries(players.map((p) => [p.id, 0])),
        roundIndex: 0,
        winnerPlayerId: null,
      },
    };
  }

  test("a bare Interstice outruns a bare Kindled over 60 ticks of held-right", () => {
    // Same spawn x, far apart in y-agnostic flat ground; both hold RIGHT for
    // a full second of sim time. The gap must be strictly ordered
    // Interstice > Geometrician > Kindled — the roster card's promise,
    // finally measurable.
    const kindled = mkPlayer("kin", "heavy", { x: 200, y: 400 });
    const geo = mkPlayer("geo", "balanced", { x: 200, y: 500 });
    const interstice = mkPlayer("int", "sprinter", { x: 200, y: 300 });
    let state = mkState([kindled, geo, interstice]);
    const runtime = createRuntime(flatMap);
    for (let i = 0; i < 60; i++) {
      const frames: Record<PlayerId, InputFrame | null> = {};
      for (const p of [kindled, geo, interstice]) {
        frames[p.id] = {
          seq: InputSeq(i + 1),
          tick: Tick(i),
          keys: RIGHT_BIT,
          aimX: 4000,
          aimY: p.y,
          dtMs: DT_MS,
        };
      }
      state = stepWithRuntime(state, runtime, frames, DT_MS).state;
    }
    const kinDx = state.players[kindled.id]!.x - 200;
    const geoDx = state.players[geo.id]!.x - 200;
    const intDx = state.players[interstice.id]!.x - 200;
    expect(kinDx).toBeGreaterThan(0); // everyone actually moved
    expect(intDx).toBeGreaterThan(geoDx);
    expect(geoDx).toBeGreaterThan(kinDx);
  });
});
