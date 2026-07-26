// KINDLED SHIELD BASH — slash-feel-ledger "THE SHIELD IS IN THE CHAIN" +
// the design-decision block (2026-07-24, wave 1): every THIRD Edge swing
// is the slab-led BASH. Fixed cadence (swing·swing·BASH), payoff is
// CONTROL not DPS: damage 14 (≤ half an Edge hit's 32), the game's
// biggest knockback (760/260 > dash-bash's 660/240), and a brief victim
// stagger reusing the slowedUntilTick machinery. Chain advances per
// STARTED swing (whiffs count), resets after 350ms of idle gap, and the
// bash emits `bash-landed` (not `slash-hit`) + a `verb: "bash"` marker on
// its slash-started so the render leads with the slab from windup.
//
// Fixture conventions mirror paladinMelee.test.ts exactly.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime, freshPaladinMeleeMemory } from "../World.js";
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
    id, characterId: "heavy", x, y, vx: 0, vy: 0,
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
 *  verb (in firing order) plus all events per step. */
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

describe("shield bash — fixed cadence (swing·swing·BASH)", () => {
  test("the third swing of a sustained chain carries verb:'bash'; whiffs count (no victim needed)", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Cycle ≈ 650ms ≈ 41 ticks. Presses at 40/80/122 land in (or just
    // after) each swing's final 100ms — buffered or fresh-from-idle, the
    // idle gap stays far under the 350ms chain reset either way.
    const { startVerbs } = runScript(
      state, runtime, [attacker], A, 200, [0, 40, 80, 122], { x: 900, y: 300 },
    );
    expect(startVerbs.length).toBe(4);
    expect(startVerbs[0]).toBeUndefined();
    expect(startVerbs[1]).toBeUndefined();
    expect(startVerbs[2]).toBe("bash"); // the chain's third beat
    expect(startVerbs[3]).toBeUndefined(); // chain wraps back to blades
  });

  test("the chain cools back to blades after >350ms of idle gap", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Two chained swings, then a long idle (120 ticks ≈ 2s ≫ 350ms), then
    // a third press — position 2 would have been the bash, but the gap
    // reset the chain, so it opens with a blade again.
    const { startVerbs } = runScript(
      state, runtime, [attacker], A, 300, [0, 40, 210], { x: 900, y: 300 },
    );
    expect(startVerbs.length).toBe(3);
    expect(startVerbs[2]).toBeUndefined();
  });

  test("death resets the chain", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Seed the chain at position 2 (bash next), then kill the paladin and
    // step once — the dead-branch must cool the chain to 0.
    const mem = freshPaladinMeleeMemory();
    mem.chainIndex = 2;
    mem.chainGapMs = 50;
    runtime.paladinMelee.set(A, mem);
    let s = stepWithRuntime(state, runtime, noInputs([attacker]), DT_MS).state;
    s = { ...s, players: { ...s.players, [A]: { ...s.players[A]!, alive: false, health: 0 } } };
    stepWithRuntime(s, runtime, noInputs([attacker]), DT_MS);
    expect(runtime.paladinMelee.get(A)!.chainIndex).toBe(0);
    expect(runtime.paladinMelee.get(A)!.chainGapMs).toBe(0);
  });
});

describe("shield bash — the landed hit (control, not DPS)", () => {
  /** Seed a paladin whose NEXT swing is the bash (chain position 2). */
  function seedBashNext(runtime: Runtime, id: PlayerId): void {
    const mem = freshPaladinMeleeMemory();
    mem.chainIndex = 2;
    runtime.paladinMelee.set(id, mem);
  }

  test("bash: low damage (14), the game's biggest knockback, and a brief stagger", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300, { characterId: "balanced" }); // 60px ahead
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    seedBashNext(runtime, A);

    const { state: s, allEvents } = runScript(
      state, runtime, [attacker, victim], A, 40, [0], { x: 900, y: 470 },
    );
    // Damage: exactly SHIELD_BASH_DAMAGE, under half an Edge hit (38, 2026-07-26 balance pass).
    expect(s.players[B]!.health).toBe(100 - 14);
    // Events: bash-landed (with the same damage) + generic hit-confirmed;
    // NO slash-hit for a bash.
    const bash = allEvents.find((e) => e.t === "bash-landed");
    expect(bash).toBeDefined();
    if (bash?.t === "bash-landed") {
      expect(bash.attackerId).toBe(A);
      expect(bash.victimId).toBe(B);
      expect(bash.damage).toBe(14);
    }
    expect(allEvents.some((e) => e.t === "hit-confirmed" && e.victimId === B)).toBe(true);
    expect(allEvents.some((e) => e.t === "slash-hit")).toBe(false);
    // The 300ms stagger expires (and clears) before the 40-step run ends
    // — that's the point of "brief". Void the end-state read; the re-run
    // below samples both the stagger and the launch AT the hit tick.
    void s;
    // Knockback: biggest in the game — larger than dash-bash's 660 (the
    // hit tick writes ~760 px/s along the near-horizontal aim; friction
    // only starts next tick, so sample the peak). Stagger: sampled live
    // while slowedUntilTick is defined — the slowedUntilTick machinery
    // reused, no new status system, 0.55 multiplier.
    const runtime2 = createRuntime(flatMap);
    seedBashNext(runtime2, A);
    let s2 = mkState([attacker, victim]);
    let peakVx = 0;
    let sawStaggerMul: number | undefined;
    let prevPressed = false;
    for (let i = 0; i < 30; i++) {
      const inputs = i === 0
        ? pressInputs([attacker, victim], A, 900, 470, i + 1)
        : prevPressed
          ? releaseInputs([attacker, victim], A, 900, 470, i + 1)
          : noInputs([attacker, victim]);
      prevPressed = i === 0;
      s2 = stepWithRuntime(s2, runtime2, inputs, DT_MS).state;
      peakVx = Math.max(peakVx, s2.players[B]!.vx);
      if (s2.players[B]!.slowedUntilTick !== undefined && sawStaggerMul === undefined) {
        sawStaggerMul = s2.players[B]!.slowMultiplier;
      }
    }
    // 760 written along a near-horizontal aim; the observable peak is one
    // tick of stagger-dampened physics later (~700 — the victim's OWN
    // fresh slow bites immediately), still decisively above dash-bash's
    // 660 write for the "biggest in the game" tier claim.
    expect(peakVx).toBeGreaterThan(680);
    expect(sawStaggerMul).toBeCloseTo(0.55, 5);
  });

  test("bash has the shortest reach: a victim the blade reaches (corner ~77px) is outside the slab's 62px", () => {
    // Victim center 88px ahead: nearest hitbox sample ≈ 72-77px out —
    // inside EDGE_RANGE (84, blade hits) but outside SHIELD_BASH_RANGE
    // (62, bash whiffs).
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 588, 300, { characterId: "balanced" });
    const runtime = createRuntime(flatMap);

    // Blade control: chain position 0 — the same victim takes the hit.
    const { state: bladeState } = runScript(
      mkState([attacker, victim]), runtime, [attacker, victim], A, 40, [0], { x: 900, y: 470 },
    );
    expect(bladeState.players[B]!.health).toBeLessThan(100);

    // Bash: chain position 2 — same geometry, no contact.
    const runtime2 = createRuntime(flatMap);
    const mem = freshPaladinMeleeMemory();
    mem.chainIndex = 2;
    runtime2.paladinMelee.set(A, mem);
    const { state: bashState, allEvents } = runScript(
      mkState([attacker, victim]), runtime2, [attacker, victim], A, 40, [0], { x: 900, y: 470 },
    );
    expect(bashState.players[B]!.health).toBe(100);
    expect(allEvents.some((e) => e.t === "bash-landed")).toBe(false);
  });

  test("Unbroken Seal's stronger stagger takes precedence over the bash's own", () => {
    const attacker = mkPlayer(A, 500, 300, {
      aimX: 900, aimY: 300,
      sealUntilTick: Tick(10_000),
    });
    const victim = mkPlayer(B, 560, 300, { characterId: "balanced" });
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    const mem = freshPaladinMeleeMemory();
    mem.chainIndex = 2;
    runtime.paladinMelee.set(A, mem);
    const { state: s } = runScript(
      state, runtime, [attacker, victim], A, 40, [0], { x: 900, y: 470 },
    );
    // Seal's 0.25 multiplier (not the bash's 0.55) — and Seal's amp made
    // the low bash damage bigger (14 * 1.45), still nowhere near a blade.
    expect(s.players[B]!.slowMultiplier).toBeCloseTo(0.25, 5);
    expect(s.players[B]!.health).toBeCloseTo(100 - 14 * 1.45, 5);
  });
});
