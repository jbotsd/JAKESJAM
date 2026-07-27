// clip-goal STUDY 3, D1 — "the credited kill has no visual corroboration",
// reproduced in 7 of 7 real-pipeline clips studied 2026-07-27.
//
// Root cause, pinned here: matchHost.ts rewinds opponents for a shooter
// whose fire input trails the server tick (LagCompensator's "rewind
// opponents for the shooter" technique — standard lag comp, and the
// starter-pistol is TRUE hitscan resolved same-tick, so the rewind is the
// ENTIRE determinant of whether the shot connects). ReplayScene's offline
// re-simulation used to feed the SAME recorded inputs into bare
// `stepWithRuntime`, with no rewind at all — any hit that only connected
// LIVE because of the rewind silently misses in the replay: the recorded
// `player-killed` tick shows no event at all when re-simulated, which is
// exactly "no shot, no death, no damage number" (D1).
//
// This test drives ONE identical recorded input log (a fire input whose
// `.tick` trails the current server tick by 5 ticks, aimed at the target's
// PAST position, while the target has since moved off that line) through
// both paths:
//   - bare `stepWithRuntime` (the OLD ReplayScene behavior) — the shot
//     must MISS, pinning the regression this fix closes.
//   - `stepTickWithLagCompensation` (the NEW ReplayScene behavior, sharing
//     matchHost's own LagCompensator) — the shot must CONNECT, proving the
//     fix reproduces what actually happened live.

import { describe, test, expect } from "bun:test";
import { World, createRuntime, stepWithRuntime } from "../World.js";
import { LagCompensator } from "../LagCompensator.js";
import { stepTickWithLagCompensation } from "../lagCompensatedStep.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerSpawnInfo,
  type SimEvent,
  type WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;
const FIRE_BIT = 1 << 6;
const A = PlayerId("a");
const B = PlayerId("b");

const arena: MapDefinition = {
  id: "test-arena",
  name: "Test Arena",
  size: { x: 2000, y: 2000 },
  spawns: [
    { x: 100, y: 300 },
    { x: 900, y: 300 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 1900 }, size: { x: 2000, y: 100 } },
  ],
};

const spawnInfo: PlayerSpawnInfo[] = [
  { playerId: A, characterId: "balanced", name: "Alpha", color: "#ff0000", weaponId: "starter-pistol" },
  { playerId: B, characterId: "balanced", name: "Bravo", color: "#00ff00", weaponId: "starter-pistol" },
];

function idleInput(atTick: number): InputFrame {
  return { seq: InputSeq(1), tick: Tick(atTick), keys: 0 as InputBitfield, aimX: 0, aimY: 0, dtMs: DT_MS };
}

/** B's scripted position at a given tick — steady vertical drift away from
 *  A's fixed y=300 firing line, x pinned so A's aim can target the exact
 *  historical (x,y) B occupied at any earlier tick. By tick 10 B has moved
 *  80 world px off the line A's rewound shot will trace — comfortably
 *  outside any hitbox/pellet radius (PLAYER_RADIUS=18), so a raycast at
 *  B's REAL current position misses cleanly while the rewound trace (aimed
 *  at B's tick-5 position) connects exactly. */
function bPositionAtTick(tick: number): { x: number; y: number } {
  return { x: 900, y: 300 - tick * 16 };
}

/** Force-set both players' kinematics for this tick (bypasses gravity/
 *  physics entirely, same technique matchHostLagCompDiag.test.ts's
 *  `primeHistoryWithMovingTarget` uses) — deterministic scripted movement,
 *  not something the sim's own physics needs to reproduce for this test. */
function scriptState(state: WorldState, tick: number): WorldState {
  const b = bPositionAtTick(tick);
  return {
    ...state,
    // World.create starts a combat match in "countdown" (weapons frozen
    // until the round machine transitions) — force "fighting" so this test
    // exercises the actual fire/hit pipeline, matching every other
    // World-level integration test's fixture pattern (see
    // firstBloodSuddenDeath.test.ts).
    round: { ...state.round, phase: "fighting" },
    players: {
      ...state.players,
      [A]: { ...state.players[A]!, x: 100, y: 300, vx: 0, vy: 0 },
      [B]: { ...state.players[B]!, x: b.x, y: b.y, vx: 0, vy: 0 },
    },
  } as WorldState;
}

function hasHitOn(events: SimEvent[], victimId: PlayerId): boolean {
  return events.some(
    (e) => (e.t === "hit-confirmed" || e.t === "player-killed") && (e as { victimId?: unknown }).victimId === victimId,
  );
}

const LOOKBACK_TICKS = 5;
const FIRE_TICK = 10;

/** The exact recorded input log a real match would produce: idle ticks 0..9
 *  (priming position history), then a fire input AT tick 10 whose `.tick`
 *  field trails the server tick by LOOKBACK_TICKS (simulated latency),
 *  aimed at B's position AT that earlier tick. */
function buildInputLog(): Array<Record<PlayerId, InputFrame | null>> {
  const log: Array<Record<PlayerId, InputFrame | null>> = [];
  for (let t = 0; t < FIRE_TICK; t++) {
    log.push({ [A]: idleInput(t), [B]: idleInput(t) });
  }
  const aimAt = bPositionAtTick(FIRE_TICK - LOOKBACK_TICKS);
  log.push({
    [A]: {
      seq: InputSeq(2),
      tick: Tick(FIRE_TICK - LOOKBACK_TICKS),
      keys: FIRE_BIT as InputBitfield,
      aimX: aimAt.x,
      aimY: aimAt.y,
      dtMs: DT_MS,
    },
    [B]: idleInput(FIRE_TICK),
  });
  return log;
}

describe("clip-goal STUDY 3 D1 — replay re-simulation must apply lag compensation", () => {
  test("bare stepWithRuntime (the OLD ReplayScene path) MISSES the lag-comp-only hit", () => {
    let state = World.create(arena, spawnInfo, 1, []);
    const runtime = createRuntime(arena);
    const log = buildInputLog();
    let fireEvents: SimEvent[] = [];
    for (let t = 0; t < log.length; t++) {
      state = scriptState(state, t);
      const result = stepWithRuntime(state, runtime, log[t]!, DT_MS);
      state = result.state;
      if (t === FIRE_TICK) fireEvents = result.events;
    }
    expect(hasHitOn(fireEvents, B)).toBe(false);
  });

  test("stepTickWithLagCompensation (the NEW ReplayScene path) reproduces the hit live play would have registered", () => {
    let state = World.create(arena, spawnInfo, 1, []);
    const runtime = createRuntime(arena);
    const lagComp = new LagCompensator();
    const log = buildInputLog();
    let fireEvents: SimEvent[] = [];
    for (let t = 0; t < log.length; t++) {
      state = scriptState(state, t);
      const result = stepTickWithLagCompensation(state, runtime, log[t]!, lagComp, DT_MS);
      state = result.state;
      if (t === FIRE_TICK) fireEvents = result.events;
    }
    expect(hasHitOn(fireEvents, B)).toBe(true);
  });
});
