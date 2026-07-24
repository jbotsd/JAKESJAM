// KINDLED CANCEL WINDOW — slash-feel-ledger R1 row 16 (2026-07-24 wave 2):
// dash/ward may cancel the FINAL 40% of Edge recovery (from 204ms of the
// 340ms in). Design (see World.ts's KIN_CANCEL_TAIL_FRACTION doc block):
//   - triggers are RISING edges landing inside the tail — a dash begun
//     earlier or a shield held through the swing never cancels;
//   - the ward must have actually ENGAGED (a dead-battery press is free);
//   - A QUEUED SWING WINS over a cancel (bufferedMs > 0 suppresses it) —
//     R1 row 1's "mashing never eats a swing" is absolute and no
//     dash-cancel cycle-compression tech exists by construction;
//   - a cancel still ADVANCES the chain (the swing's beat happened).
//
// Fixture conventions mirror shieldBash.test.ts exactly. The Zig-side
// mirror is proven tick-for-tick in meleeSwingMemoryBridge.test.ts gate E.

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
const SHIELD_BIT = 1 << 8;
const DASH_BIT = 1 << 9;

const A = PlayerId("a");
const DT_MS = 1000 / 60;

// Recovery = 340ms; the cancel tail opens at phaseMs <= 340 * 0.4 = 136.
// phaseMs decrements by DT_MS per step AFTER the recovery-entry step, so
// the first cancellable step is the 13th decrement (phaseMs 123.3;
// elapsed 216.7 >= 204) and the 12th (phaseMs 140; elapsed 200) is the
// last non-cancellable one — the exact window edge, asserted both ways.
const EDGE_RECOVERY_MS = 340;
const CANCEL_TAIL_MS = EDGE_RECOVERY_MS * 0.4;

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

type Runtime = ReturnType<typeof createRuntime>;

/** Drive the paladin with a per-step key function; returns per-step
 *  post-step FSM observations. */
function drive(
  runtime: Runtime,
  state: WorldState,
  steps: number,
  keysAt: (step: number) => number,
): { phases: number[]; phaseMs: number[]; chain: number[]; slashStarts: number } {
  let s = state;
  const phases: number[] = [];
  const phaseMs: number[] = [];
  const chain: number[] = [];
  let slashStarts = 0;
  for (let i = 0; i < steps; i++) {
    const inputs: Record<PlayerId, InputFrame | null> = {
      [A]: {
        seq: InputSeq(i + 1), tick: Tick(i + 1),
        keys: keysAt(i) as InputBitfield,
        aimX: 900, aimY: 400, dtMs: DT_MS,
      },
    };
    const res = stepWithRuntime(s, runtime, inputs, DT_MS);
    s = res.state;
    for (const e of res.events) if (e.t === "slash-started" && e.playerId === A) slashStarts++;
    const mem = runtime.paladinMelee.get(A);
    phases.push(mem?.phase ?? -1);
    phaseMs.push(mem?.phaseMs ?? -1);
    chain.push(mem?.chainIndex ?? -1);
  }
  return { phases, phaseMs, chain, slashStarts };
}

/** First step index whose POST-step phase is 3 (recovery), from a press
 *  at step 0. Derived by observation so the test can't drift from the
 *  windup/active constants. */
function recoveryEntryStep(): number {
  const runtime = createRuntime(flatMap);
  const { phases } = drive(runtime, mkState([mkPlayer(A, 500, 300)]), 60, (i) =>
    i === 0 ? FIRE_BIT : 0,
  );
  const r = phases.findIndex((p) => p === 3);
  expect(r).toBeGreaterThan(0);
  return r;
}

describe("row 16 — dash cancels the final 40% of recovery, exactly at the edge", () => {
  test("a dash edge ONE step before the window does NOT cancel; ON the window edge it does", () => {
    const R = recoveryEntryStep();
    // The nth decrement lands on step R+n (recovery-entry step R holds the
    // full 340). First step inside the tail: smallest n with 340 - n*DT <= 136.
    const edgeN = Math.ceil((EDGE_RECOVERY_MS - CANCEL_TAIL_MS) / DT_MS); // 13
    expect(340 - (edgeN - 1) * DT_MS).toBeGreaterThan(CANCEL_TAIL_MS);
    expect(340 - edgeN * DT_MS).toBeLessThanOrEqual(CANCEL_TAIL_MS);

    // Case A: dash rising edge lands on step R+edgeN-1 (phaseMs 140 —
    // outside). No cancel: recovery continues that step.
    {
      const runtime = createRuntime(flatMap);
      const { phases } = drive(runtime, mkState([mkPlayer(A, 500, 300)]), R + edgeN + 1, (i) =>
        i === 0 ? FIRE_BIT : i === R + edgeN - 1 ? DASH_BIT : 0,
      );
      expect(phases[R + edgeN - 1]).toBe(3);
    }

    // Case B: dash rising edge lands on step R+edgeN (phaseMs 123.3 —
    // first step inside the tail). Cancel: idle that same step, chain
    // advanced (the swing's beat happened).
    {
      const runtime = createRuntime(flatMap);
      const { phases, chain } = drive(runtime, mkState([mkPlayer(A, 500, 300)]), R + edgeN + 1, (i) =>
        i === 0 ? FIRE_BIT : i === R + edgeN ? DASH_BIT : 0,
      );
      expect(phases[R + edgeN - 1]).toBe(3); // still recovering the step before
      expect(phases[R + edgeN]).toBe(0); // cancelled on the edge step
      expect(chain[R + edgeN]).toBe(1); // beat counted, not reset
    }
  });

  test("a dash begun BEFORE the window (early recovery) never cancels — no rising edge in the tail", () => {
    const R = recoveryEntryStep();
    const runtime = createRuntime(flatMap);
    // Dash pressed 2 steps into recovery (phaseMs ~306 — outside the tail);
    // the burst is still active when the window opens, but there is no
    // fresh edge, so recovery must complete naturally.
    const total = R + 25;
    const { phases } = drive(runtime, mkState([mkPlayer(A, 500, 300)]), total, (i) =>
      i === 0 ? FIRE_BIT : i === R + 2 ? DASH_BIT : 0,
    );
    // Recovery runs its full 340ms (21 decrements): idle only at R+21.
    for (let n = 1; n <= 20; n++) expect(phases[R + n]).toBe(3);
    expect(phases[R + 21]).toBe(0);
  });
});

describe("row 16 — ward raise cancels; held/dead wards do not", () => {
  test("a ward RAISE inside the tail cancels (engaged shield, rising edge)", () => {
    const R = recoveryEntryStep();
    const edgeN = Math.ceil((EDGE_RECOVERY_MS - CANCEL_TAIL_MS) / DT_MS);
    const runtime = createRuntime(flatMap);
    const { phases, chain } = drive(runtime, mkState([mkPlayer(A, 500, 300)]), R + edgeN + 1, (i) =>
      i === 0 ? FIRE_BIT : i >= R + edgeN ? SHIELD_BIT : 0,
    );
    expect(phases[R + edgeN - 1]).toBe(3);
    expect(phases[R + edgeN]).toBe(0);
    expect(chain[R + edgeN]).toBe(1);
  });

  test("a shield held from BEFORE the swing never cancels (no rising edge)", () => {
    const R = recoveryEntryStep();
    const runtime = createRuntime(flatMap);
    const total = R + 25;
    // Shield held the entire run; Fire pressed at step 4 (shield already
    // down for 4 steps — the edge happened long before the tail).
    const { phases } = drive(runtime, mkState([mkPlayer(A, 500, 300)]), total + 4, (i) =>
      i === 4 ? SHIELD_BIT | FIRE_BIT : SHIELD_BIT,
    );
    // Recovery must complete naturally (entry shifted by the press at 4).
    const r2 = phases.findIndex((p) => p === 3);
    for (let n = 1; n <= 20; n++) expect(phases[r2 + n]).toBe(3);
    expect(phases[r2 + 21]).toBe(0);
  });

  test("a dead-battery ward press does NOT cancel (shield never engages)", () => {
    // A drained battery can't be fixtured statically (tickShield's caller
    // passes maxCharge explicitly, so idle steps recharge any starting
    // charge) — drain it for real: hold Shield ~3s (35/s drain empties the
    // 100 bar), swing while still holding, release for exactly ONE step
    // inside the tail, then re-press. The press is a genuine rising edge
    // but the one released step only recharged ~0.23 charge — the same
    // step's drain (0.58) empties it again, so shieldActive stays false
    // and the cancel must not fire.
    const R = recoveryEntryStep();
    const edgeN = Math.ceil((EDGE_RECOVERY_MS - CANCEL_TAIL_MS) / DT_MS);
    const F = 180; // shield-drain lead-in (180 steps = 3s > 100/35 s)
    const runtime = createRuntime(flatMap);
    const { phases } = drive(runtime, mkState([mkPlayer(A, 500, 300)]), F + R + 25, (i) => {
      if (i < F) return SHIELD_BIT;
      if (i === F) return SHIELD_BIT | FIRE_BIT; // swing, ward still held
      if (i === F + R + edgeN - 1) return 0; // the single released step
      return SHIELD_BIT; // re-press at F+R+edgeN — rising edge, dead battery
    });
    expect(phases[F + R + edgeN]).toBe(3); // still recovering — no free cancel
    expect(phases[F + R + 21]).toBe(0); // recovery completes naturally
  });
});

describe("row 16 — precedence: a queued swing WINS over a cancel", () => {
  test("buffered Fire in the tail suppresses a same-window dash cancel; the queued swing fires at natural phase 0", () => {
    const R = recoveryEntryStep();
    const edgeN = Math.ceil((EDGE_RECOVERY_MS - CANCEL_TAIL_MS) / DT_MS);
    const runtime = createRuntime(flatMap);
    // Fire buffered a few steps into the window (R+16 — the 100ms buffer
    // comfortably outlives the natural end at R+21), then dash INSIDE the
    // window one step later (R+17). The cancel must NOT fire; the
    // buffered swing starts the moment recovery naturally expires.
    const total = R + 30;
    const { phases, slashStarts } = drive(runtime, mkState([mkPlayer(A, 500, 300)]), total, (i) =>
      i === 0 ? FIRE_BIT
      : i === R + 16 ? FIRE_BIT
      : i === R + 17 ? DASH_BIT
      : 0,
    );
    // Still recovering through the whole tail (dash suppressed by the
    // queued swing)...
    for (let n = edgeN; n <= 20; n++) expect(phases[R + n]).toBe(3);
    // ...and the buffered press starts swing 2 the tick recovery expires
    // (phase 1 = windup, zero dead frames — mashing never ate the swing).
    expect(phases[R + 21]).toBe(1);
    expect(slashStarts).toBe(2);
    void edgeN;
  });
});
