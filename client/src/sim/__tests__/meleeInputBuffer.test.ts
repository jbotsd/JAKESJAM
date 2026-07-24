// MELEE INPUT BUFFER — slash-feel-ledger R1 row 1 (2026-07-24, the
// R3-binding first step of the melee-feel loops): a Fire press during
// windup/active/recovery QUEUES for MELEE_BUFFER_MS (100ms / 6t) and fires
// at phase 0 — the same tick recovery expires — instead of being eaten.
// Before this, the swing FSMs only read the Fire rising edge from idle
// ("none found" in the research repo-audit, row 1's Current column).
//
// Fixture conventions mirror ninjaMelee.test.ts/paladinMelee.test.ts
// exactly (mkPlayer/mkState/pressInputs/stepIdle + createRuntime/
// stepWithRuntime). Rather than hand-deriving float-epsilon tick counts
// (see paladinMelee.test.ts's WINDUP_TICKS "+1" war story), these tests
// OBSERVE the FSM through the runtime's own melee memory maps and count
// `slash-started` events per tick — the properties proved are:
//   1. a press mid-swing inside the buffer window fires EXACTLY ONCE, on
//      the EXACT tick the FSM returns to idle (zero dead frames — Jake's
//      "smooth on retrig" constraint);
//   2. a press that goes stale (>100ms before recovery ends) does NOT
//      fire — the buffer is a window, not a latch;
//   3. mashing (multiple presses mid-swing) still fires exactly once
//      (latest press wins, one press one swing);
//   4. the queued swing uses the aim captured AT PRESS TIME (the buffered
//      cursor point), not whatever the cursor did afterwards;
//   5. both classes get the identical contract (R1 row 1 is BOTH-column).

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
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

/** Read the swing phase for `id` from whichever class map holds it. */
function phaseOf(runtime: Runtime, id: PlayerId): number {
  return runtime.melee.get(id)?.phase ?? runtime.paladinMelee.get(id)?.phase ?? 0;
}

/**
 * Drive one scripted run: `pressAt` maps step-index -> aim point for a
 * Fire press (rising edge; the NEXT step is always a release so a later
 * press reads as a fresh edge). Returns, per step, how many
 * `slash-started` fired and the post-step FSM phase — the raw material
 * every property below asserts on.
 */
function run(
  state: WorldState,
  runtime: Runtime,
  players: PlayerEntity[],
  attackerId: PlayerId,
  steps: number,
  pressAt: Map<number, { x: number; y: number }>,
): { state: WorldState; starts: number[]; phases: number[] } {
  let s = state;
  const starts: number[] = [];
  const phases: number[] = [];
  let prevPressed = false;
  for (let i = 0; i < steps; i++) {
    const press = pressAt.get(i);
    const inputs = press
      ? pressInputs(players, attackerId, press.x, press.y, i + 1)
      : prevPressed
        ? releaseInputs(players, attackerId, 900, 300, i + 1)
        : noInputs(players);
    prevPressed = press !== undefined;
    const res = stepWithRuntime(s, runtime, inputs, DT_MS);
    s = res.state;
    starts.push(res.events.filter((e) => e.t === "slash-started").length);
    phases.push(phaseOf(runtime, attackerId));
  }
  return { state: s, starts, phases };
}

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** First step index at which the FSM sits idle again after step `after`. */
function idleTickAfter(phases: number[], after: number): number {
  for (let i = after + 1; i < phases.length; i++) {
    if (phases[i] === 0) return i;
  }
  return -1;
}

describe("melee input buffer — Kindled (paladin), R1 row 1", () => {
  test("press during ACTIVE + re-press during recovery (mash) fires exactly once, with zero idle gap", () => {
    // Kindled: windup 200 / active 110 / recovery 340. A press during the
    // active window alone would go stale (recovery 340 > buffer 100), so
    // the mash case is the honest one: press mid-active, press again mid-
    // recovery — the SECOND press re-arms the window and the queued swing
    // fires the exact tick recovery expires. phases[] must never show 0
    // between the two swings (fires AT phase 0, not one tick after).
    const attacker = mkPlayer(A, 500, 300);
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Step 0: initial press. Step 15 (~250ms in) = mid-active/early-
    // recovery press. Step 36 (~600ms in) = mid-recovery press, well
    // inside the last 100ms of the ~650ms cycle.
    const { starts, phases } = run(
      state, runtime, [attacker], A, 80,
      new Map([
        [0, { x: 900, y: 300 }],
        [15, { x: 900, y: 300 }],
        [36, { x: 900, y: 300 }],
      ]),
    );
    expect(starts[0]).toBe(1);
    // Exactly ONE queued swing fired from the two mid-swing presses.
    expect(total(starts)).toBe(2);
    // It fired on the retrig tick: find it and prove the FSM never sat
    // idle before it (phase stays 1..3 from step 0 until the second
    // slash-started, and is 1 (windup) ON that step — fired AT phase 0).
    const secondStart = starts.findIndex((n, i) => i > 0 && n > 0);
    expect(secondStart).toBeGreaterThan(36);
    for (let i = 0; i < secondStart; i++) {
      expect(phases[i]).toBeGreaterThan(0);
    }
    expect(phases[secondStart]).toBe(1);
  });

  test("a press that goes stale (>100ms before recovery ends) is dropped", () => {
    const attacker = mkPlayer(A, 500, 300);
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Press at step 0, then once mid-windup (step 6, ~100ms in — the
    // cycle still has ~550ms to run, far beyond the 100ms window).
    const { starts, phases } = run(
      state, runtime, [attacker], A, 80,
      new Map([
        [0, { x: 900, y: 300 }],
        [6, { x: 900, y: 300 }],
      ]),
    );
    expect(total(starts)).toBe(1);
    // The FSM returned to idle and STAYED idle — nothing queued fired.
    expect(idleTickAfter(phases, 0)).toBeGreaterThan(0);
    expect(phases[phases.length - 1]).toBe(0);
  });

  test("the queued swing uses the aim captured at press time (buffered cursor point)", () => {
    // Attacker faces +X for swing 1; the buffered mid-recovery press aims
    // LEFT (-X) where victim B stands. Swing 1 must not touch B; the
    // queued swing 2 must hit B — proving the buffered point (not the
    // original aim, not a stale unit vector) drives the queued swing.
    const attacker = mkPlayer(A, 500, 300);
    const victim = mkPlayer(B, 440, 300, { characterId: "balanced" }); // 60px LEFT, inside EDGE_RANGE 84
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    let s = state;
    const players = [attacker, victim];
    let startsTotal = 0;
    let healthBeforeSecondSwing = 0;
    // Step 0: press aiming RIGHT. Step 36: press aiming LEFT (buffered).
    let prevPressed = false;
    for (let i = 0; i < 90; i++) {
      const press = i === 0 ? { x: 900, y: 300 } : i === 36 ? { x: 100, y: 300 } : undefined;
      const inputs = press
        ? pressInputs(players, A, press.x, press.y, i + 1)
        : prevPressed
          ? releaseInputs(players, A, 900, 300, i + 1)
          : noInputs(players);
      prevPressed = press !== undefined;
      const res = stepWithRuntime(s, runtime, inputs, DT_MS);
      s = res.state;
      const n = res.events.filter((e) => e.t === "slash-started").length;
      if (startsTotal === 1 && n > 0) healthBeforeSecondSwing = s.players[B]!.health;
      startsTotal += n;
    }
    expect(startsTotal).toBe(2);
    // Swing 1 (aimed right, victim on the left) never touched B.
    expect(healthBeforeSecondSwing).toBe(100);
    // Swing 2 (buffered LEFT aim) landed.
    expect(s.players[B]!.health).toBeLessThan(100);
  });
});

describe("melee input buffer — Interstice (ninja), R1 row 1", () => {
  test("press inside the last 100ms of recovery fires exactly once at phase 0", () => {
    // Ninja cycle: windup 60 / active 45 / recovery 110 (~215ms, ~14
    // ticks). A press ~10 ticks in (~166ms) sits inside recovery's final
    // 100ms — it must fire on the exact recovery-expiry tick.
    const attacker = mkPlayer(A, 500, 300, { characterId: "sprinter" });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    const { starts, phases } = run(
      state, runtime, [attacker], A, 40,
      new Map([
        [0, { x: 900, y: 300 }],
        [10, { x: 900, y: 300 }],
      ]),
    );
    expect(starts[0]).toBe(1);
    expect(total(starts)).toBe(2);
    const secondStart = starts.findIndex((n, i) => i > 0 && n > 0);
    expect(secondStart).toBeGreaterThan(10);
    // Zero dead frames: never idle before the retrig, windup ON it.
    for (let i = 0; i < secondStart; i++) {
      expect(phases[i]).toBeGreaterThan(0);
    }
    expect(phases[secondStart]).toBe(1);
  });

  test("a stale press (mid-windup, >100ms early) is dropped; mashing still fires exactly once", () => {
    const attacker = mkPlayer(A, 500, 300, { characterId: "sprinter" });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    // Presses at steps 2 (goes stale) and 10 (fires) — two mid-swing
    // presses, exactly one queued swing (latest press wins).
    const { starts } = run(
      state, runtime, [attacker], A, 40,
      new Map([
        [0, { x: 900, y: 300 }],
        [2, { x: 900, y: 300 }],
        [10, { x: 900, y: 300 }],
      ]),
    );
    expect(total(starts)).toBe(2);
  });

  test("classId gating unchanged: a wizard's mid-'swing' press buffers nothing (no melee FSM at all)", () => {
    const attacker = mkPlayer(A, 500, 300, { characterId: "balanced" });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    const { starts } = run(
      state, runtime, [attacker], A, 20,
      new Map([
        [0, { x: 900, y: 300 }],
        [3, { x: 900, y: 300 }],
      ]),
    );
    expect(total(starts)).toBe(0);
    expect(runtime.melee.size).toBe(0);
    expect(runtime.paladinMelee.size).toBe(0);
  });
});
