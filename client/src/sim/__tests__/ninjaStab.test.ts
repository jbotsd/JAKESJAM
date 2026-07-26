// NINJA STAB — finish-line-goal.md Track F1, slash-feel-ledger's Interstice
// "arc-arc-STAB cadence" direction (2026-07-26). Every THIRD ninja swing is
// the chain's linear-thrust finisher: longer reach, much narrower arc, the
// SAME damage as the ordinary arc (a hard guardrail — NINJA_UNDERCUT_
// HEALTH_THRESHOLD needs a bare swing, including a bare stab, to stay under
// 15 or Undercut's "the base swing alone can't execute" identity breaks),
// a harder shove along the line, and its own `stab-landed` contact event
// (distinct from `slash-hit`, same "own contact register" precedent as
// Kindled's `bash-landed`). Chain advances per STARTED swing (whiffs
// count), resets after NINJA_STAB_CHAIN_GAP_MS of idle, and on death.
//
// Fixture conventions mirror shieldBash.test.ts / ninjaMelee.test.ts
// exactly (same mkPlayer/mkState/pressInputs/releaseInputs helpers, same
// createRuntime + stepWithRuntime harness, sprinter=ninja characterId).

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime, freshNinjaMeleeMemory } from "../World.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type SimEvent,
  type WorldState,
} from "../types.js";

const FIRE_BIT = 1 << 6;

const A = PlayerId("a");
const B = PlayerId("b");
const DT_MS = 1000 / 60;

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 500 }, size: { x: 1280, y: 60 } },
  ],
};

function mkPlayer(id: PlayerId, x: number, y: number, over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id, characterId: "sprinter", x, y, vx: 0, vy: 0,
    aimX: x + 100, aimY: y, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 0, abilityCharge: 0, lastProcessedInputSeq: InputSeq(0), ...over,
  };
}

function mkState(players: PlayerEntity[]): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  return {
    tick: Tick(0), rngState: 1234567 >>> 0, players: playerMap, projectiles: {},
    destructibles: {}, firePatches: {}, pickups: {}, satellites: {},
    round: {
      phase: "fighting", countdownRemainingMs: 90_000,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      roundIndex: 0, winnerPlayerId: null,
    },
  };
}

const noInputs = (players: PlayerEntity[]): Record<PlayerId, InputFrame | null> =>
  Object.fromEntries(players.map((p) => [p.id, null]));

function pressInputs(
  players: PlayerEntity[],
  attackerId: PlayerId,
  aimX: number,
  aimY: number,
  tick: number,
): Record<PlayerId, InputFrame | null> {
  const out = noInputs(players);
  out[attackerId] = {
    seq: InputSeq(1), tick: Tick(tick), keys: FIRE_BIT as InputBitfield,
    aimX, aimY, dtMs: DT_MS,
  };
  return out;
}

function releaseInputs(
  players: PlayerEntity[],
  releasedId: PlayerId,
  aimX: number,
  aimY: number,
  tick: number,
): Record<PlayerId, InputFrame | null> {
  const out = noInputs(players);
  out[releasedId] = {
    seq: InputSeq(1), tick: Tick(tick), keys: 0 as InputBitfield,
    aimX, aimY, dtMs: DT_MS,
  };
  return out;
}

type Runtime = ReturnType<typeof createRuntime>;

/** Drive a scripted mash: presses at the given step indices (rising edges
 *  — the following step always releases). Collects every slash-started's
 *  verb (in firing order) plus all events per step. Mirrors shieldBash.
 *  test.ts's runScript exactly, adapted to `melee` (not `paladinMelee`). */
function runScript(
  state: WorldState,
  runtime: Runtime,
  players: PlayerEntity[],
  attackerId: PlayerId,
  steps: number,
  pressSteps: number[],
  aim: { x: number; y: number },
): { state: WorldState; startVerbs: (string | undefined)[]; allEvents: SimEvent[] } {
  let s = state;
  const startVerbs: (string | undefined)[] = [];
  const allEvents: SimEvent[] = [];
  const pressSet = new Set(pressSteps);
  let prevPressed = false;
  for (let i = 0; i < steps; i++) {
    const press = pressSet.has(i);
    const inputs = press
      ? pressInputs(players, attackerId, aim.x, aim.y, i + 1)
      : prevPressed
        ? releaseInputs(players, attackerId, aim.x, aim.y, i + 1)
        : noInputs(players);
    prevPressed = press;
    const res = stepWithRuntime(s, runtime, inputs, DT_MS);
    s = res.state;
    for (const e of res.events) {
      allEvents.push(e);
      if (e.t === "slash-started" && e.playerId === attackerId) {
        startVerbs.push(e.verb);
      }
    }
  }
  return { state: s, startVerbs, allEvents };
}

describe("ninja stab — fixed cadence (arc·arc·STAB)", () => {
  test("the third swing of a sustained chain carries verb:'stab'; whiffs count (no victim needed)", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Cycle ≈ 215ms ≈ 13 ticks. Presses every 15 ticks land in (or just
    // after) each swing's final buffer window — buffered or fresh-from-
    // idle, the idle gap stays far under the 785ms chain reset either way.
    const { startVerbs } = runScript(
      state, runtime, [attacker], A, 70, [0, 15, 30, 46], { x: 900, y: 300 },
    );
    expect(startVerbs.length).toBe(4);
    expect(startVerbs[0]).toBeUndefined();
    expect(startVerbs[1]).toBeUndefined();
    expect(startVerbs[2]).toBe("stab"); // the chain's third beat
    expect(startVerbs[3]).toBeUndefined(); // chain wraps back to arcs
  });

  test("the chain cools back to arcs after >785ms of idle gap", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Two chained swings, then a long idle (100 ticks ≈ 1.67s ≫ 785ms),
    // then a third press — position 2 would have been the stab, but the
    // gap reset the chain, so it opens with an ordinary arc again.
    const { startVerbs } = runScript(
      state, runtime, [attacker], A, 140, [0, 15, 115], { x: 900, y: 300 },
    );
    expect(startVerbs.length).toBe(3);
    expect(startVerbs[2]).toBeUndefined();
  });

  test("death resets the chain", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Seed the chain at position 2 (stab next), then kill the ninja and
    // step once — the dead-branch must cool the chain to 0.
    const mem = freshNinjaMeleeMemory();
    mem.chainIndex = 2;
    mem.chainGapMs = 50;
    runtime.melee.set(A, mem);
    let s = stepWithRuntime(state, runtime, noInputs([attacker]), DT_MS).state;
    s = { ...s, players: { ...s.players, [A]: { ...s.players[A]!, alive: false, health: 0 } } };
    stepWithRuntime(s, runtime, noInputs([attacker]), DT_MS);
    expect(runtime.melee.get(A)!.chainIndex).toBe(0);
    expect(runtime.melee.get(A)!.chainGapMs).toBe(0);
  });
});

describe("ninja stab — the landed hit (reach/precision, not a DPS lever)", () => {
  /** Seed a ninja whose NEXT swing is the stab (chain position 2). */
  function seedStabNext(runtime: Runtime, id: PlayerId): void {
    const mem = freshNinjaMeleeMemory();
    mem.chainIndex = 2;
    runtime.melee.set(id, mem);
  }

  test("stab: damage equal to the ordinary arc (14), a harder shove, distinct stab-landed event", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300, { characterId: "balanced" }); // 60px ahead
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    seedStabNext(runtime, A);

    const { state: s, allEvents } = runScript(
      state, runtime, [attacker, victim], A, 40, [0], { x: 900, y: 300 },
    );
    // Damage: exactly NINJA_STAB_DAMAGE, equal to SLASH_DAMAGE (14) — the
    // Undercut-threshold guardrail (World.ts's own doc comment).
    expect(s.players[B]!.health).toBe(100 - 14);
    const stab = allEvents.find((e) => e.t === "stab-landed");
    expect(stab).toBeDefined();
    if (stab?.t === "stab-landed") {
      expect(stab.attackerId).toBe(A);
      expect(stab.victimId).toBe(B);
      expect(stab.damage).toBe(14);
    }
    expect(allEvents.some((e) => e.t === "hit-confirmed" && e.victimId === B)).toBe(true);
    // NO slash-hit for a stab — same "own contact register" split bash-landed uses.
    expect(allEvents.some((e) => e.t === "slash-hit")).toBe(false);

    // Knockback: NINJA_STAB_KNOCKBACK (340) is meaningfully more than the
    // ordinary arc's SLASH_KNOCKBACK (260) — sample the hit tick's peak
    // (friction only starts next tick).
    const runtime2 = createRuntime(flatMap);
    seedStabNext(runtime2, A);
    let s2 = mkState([attacker, victim]);
    let peakVx = 0;
    let prevPressed = false;
    for (let i = 0; i < 30; i++) {
      const inputs = i === 0
        ? pressInputs([attacker, victim], A, 900, 300, i + 1)
        : prevPressed
          ? releaseInputs([attacker, victim], A, 900, 300, i + 1)
          : noInputs([attacker, victim]);
      prevPressed = i === 0;
      s2 = stepWithRuntime(s2, runtime2, inputs, DT_MS).state;
      peakVx = Math.max(peakVx, s2.players[B]!.vx);
    }
    expect(peakVx).toBeGreaterThan(300); // decisively above the arc's own 260 write
  });

  test("stab reaches farther than the ordinary arc: a victim outside SLASH_RANGE (78) but inside NINJA_STAB_RANGE (104) is hit ONLY by the stab", () => {
    // Victim center 95px ahead: nearest hitbox sample is outside SLASH_RANGE
    // (78, blade whiffs) but inside NINJA_STAB_RANGE (104, stab connects).
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 595, 300, { characterId: "balanced" });
    const runtime = createRuntime(flatMap);

    // Ordinary-arc control: chain position 0 — the far victim is untouched.
    const { state: bladeState } = runScript(
      mkState([attacker, victim]), runtime, [attacker, victim], A, 40, [0], { x: 900, y: 300 },
    );
    expect(bladeState.players[B]!.health).toBe(100);

    // Stab: chain position 2 — same geometry, longer reach connects.
    const runtime2 = createRuntime(flatMap);
    const mem = freshNinjaMeleeMemory();
    mem.chainIndex = 2;
    runtime2.melee.set(A, mem);
    const { state: stabState, allEvents } = runScript(
      mkState([attacker, victim]), runtime2, [attacker, victim], A, 40, [0], { x: 900, y: 300 },
    );
    expect(stabState.players[B]!.health).toBeLessThan(100);
    expect(allEvents.some((e) => e.t === "stab-landed")).toBe(true);
  });

  test("stab's arc is much narrower than the ordinary slash: a victim inside SLASH_ARC_RADIANS but outside NINJA_STAB_ARC_RADIANS is hit by the arc, NOT the stab", () => {
    // Victim offset well off the aim axis (still inside the arc's own ±50°
    // cone via its nearest hitbox corner) but outside the stab's much
    // tighter ±15° cone (isBodyInMeleeArc samples center + 4 corners, hit
    // if ANY point qualifies — verified against every one of the 5 points,
    // not just the center, with a healthy margin on both sides).
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 545, 235, { characterId: "balanced" }); // up-and-right of aim axis
    const runtime = createRuntime(flatMap);

    const { state: bladeState } = runScript(
      mkState([attacker, victim]), runtime, [attacker, victim], A, 40, [0], { x: 900, y: 300 },
    );
    expect(bladeState.players[B]!.health).toBeLessThan(100);

    const runtime2 = createRuntime(flatMap);
    const mem = freshNinjaMeleeMemory();
    mem.chainIndex = 2;
    runtime2.melee.set(A, mem);
    const { state: stabState, allEvents } = runScript(
      mkState([attacker, victim]), runtime2, [attacker, victim], A, 40, [0], { x: 900, y: 300 },
    );
    expect(stabState.players[B]!.health).toBe(100);
    expect(allEvents.some((e) => e.t === "stab-landed" || e.t === "slash-hit")).toBe(false);
  });

  test("Undercut guardrail: a bare stab does NOT execute a victim sitting exactly at NINJA_UNDERCUT_HEALTH_THRESHOLD (15) without the window live", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300, { characterId: "balanced", health: 15 });
    const runtime = createRuntime(flatMap);
    const mem = freshNinjaMeleeMemory();
    mem.chainIndex = 2;
    runtime.melee.set(A, mem);
    const { state: s } = runScript(
      mkState([attacker, victim]), runtime, [attacker, victim], A, 40, [0], { x: 900, y: 300 },
    );
    // 15 - 14 = 1: survives. If NINJA_STAB_DAMAGE ever crept to >=15 this
    // would fail loudly — Undercut's "the base swing alone can't" identity
    // depends on every base-swing verb staying under the threshold.
    expect(s.players[B]!.health).toBe(1);
    expect(s.players[B]!.alive).toBe(true);
  });
});

describe("ninja stab — classId gating (zero behavior change for other chassis)", () => {
  test("a non-ninja (balanced) never gets a chain/stab even with chainIndex seeded", () => {
    const attacker = mkPlayer(A, 500, 300, { characterId: "balanced", aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime, pressInputs([attacker], A, 900, 300, 1), DT_MS,
    );
    expect(res.events.some((e) => e.t === "slash-started")).toBe(false);
    expect(res.events.some((e) => e.t === "stab-landed")).toBe(false);
  });
});
