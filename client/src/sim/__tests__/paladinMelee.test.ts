// PALADIN MELEE — Kindled Edge, the tighter/harder arc swing that reuses
// P2's arc-hit-detection primitive (class-overhaul-workboard.md chunk 2.1).
//
// Mirrors ninjaMelee.test.ts's fixture conventions exactly — same
// mkPlayer/mkState/noInputs/pressInputs/releaseInputs/stepIdle helpers,
// same createRuntime + stepWithRuntime harness. classId is derived from
// characterId ("heavy" = paladin); every test that proves a behavior is
// paladin-only re-runs the identical scenario on a "balanced" (wizard)
// characterId and asserts NOTHING paladin-shaped happens — that's the
// classId-gating proof the task calls for. A second family of tests proves
// Kindled Edge is NOT ninja's slash wearing new numbers: no wave spawns, no
// energy is granted on a landed hit — Kindred's resource (Kindling) comes
// exclusively from Ward absorbing damage (kindledWard.test.ts), never from
// Edge dealing it.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { freshPlayerMovementMemory } from "../player.js";
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
const C = PlayerId("c");
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

/** Fire a single tick's press for `attackerId`, aimed at (aimX, aimY);
 *  everyone else gets a null input. */
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

/** A REAL "key released" tick (see ninjaMelee.test.ts's identical helper
 *  doc comment for why `noInputs` can't stand in for this). */
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

function stepIdle(
  state: WorldState,
  runtime: ReturnType<typeof createRuntime>,
  players: PlayerEntity[],
  n: number,
): WorldState {
  let s = state;
  for (let i = 0; i < n; i++) {
    s = stepWithRuntime(s, runtime, noInputs(players), DT_MS).state;
  }
  return s;
}

// Commit-frame constants mirrored from World.ts (EDGE_WINDUP_MS=200,
// EDGE_ACTIVE_MS=110, EDGE_RECOVERY_MS=340) — kept local so a change to the
// real constants fails this test loudly instead of silently drifting.
// WINDUP_TICKS has a +1 the ninja file's equivalent constant doesn't need:
// 200ms happens to sit almost exactly on a 12-tick boundary at 60Hz
// (12 * 16.6667ms ≈ 200.0000000000003), so cumulative float subtraction
// leaves `phaseMs` at a tiny POSITIVE epsilon (~7e-15) after exactly 12
// idle ticks rather than crossing to ≤0 — the swing needs one more real
// tick to actually flip windup→active. Verified against the real FSM, not
// hand-derived (this file's own harness, not a fudge factor).
const WINDUP_TICKS = Math.ceil(200 / DT_MS) + 1;
const ACTIVE_TICKS = Math.ceil(110 / DT_MS);
const RECOVERY_TICKS = Math.ceil(340 / DT_MS);

describe("paladin melee — classId gating (zero behavior change for other chassis)", () => {
  test("a non-paladin (balanced) pressing Fire still fires stepWeapon, not an edge swing", () => {
    const attacker = mkPlayer(A, 500, 300, { characterId: "balanced", aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime, pressInputs([attacker], A, 900, 300, 1), DT_MS,
    );
    expect(res.events.some((e) => e.t === "shot-fired")).toBe(true);
    expect(res.events.some((e) => e.t === "slash-started")).toBe(false);
  });

  test("a non-paladin dashing through an enemy is unaffected by the paladin melee step", () => {
    const attacker = mkPlayer(A, 500, 300, {
      characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300,
    });
    const victim = mkPlayer(B, 540, 300, { characterId: "balanced" });
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(B, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });
    const res = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
    expect(res.events.some((e) => e.t === "slash-started")).toBe(false);
  });
});

describe("paladin melee — arc hit detection (reuses P2's isBodyInMeleeArc primitive)", () => {
  test("windup delays the hit: no damage on the press tick, arc lands once active", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300); // ~60px ahead, within EDGE_RANGE 84
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    expect(s1.events.some((e) => e.t === "slash-started" && e.playerId === A)).toBe(true);
    expect(s1.state.players[B]!.health).toBe(100);

    const afterWindup = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS);
    expect(afterWindup.players[B]!.health).toBeLessThan(100);
  });

  test("an enemy well off the swing axis, within range, is not hit — the tighter arc excludes it", () => {
    // EDGE_ARC_RADIANS is 70° wide (±35° half-arc). (520,378) sits ~76° off
    // the +x swing direction at the CENTRE point, ~80px out (within
    // EDGE_RANGE 84) — and even the most-favourable sampled hitbox corner
    // (the one isBodyInMeleeArc's 5-point sample nudges closest to the aim
    // line) stays above 35° at this distance, so this is a clean miss on
    // every sample point, not just the centre.
    // Both players start airborne (spawned above the floor) and free-fall
    // under gravity until landing — idling all the way through the active
    // window would let them converge toward the SAME resting height and
    // silently turn this into a false hit as dy shrinks over time (not an
    // arc-gating bug, just gravity closing the gap this test relies on).
    // Checking right at the FIRST active tick (WINDUP_TICKS, the same
    // moment the "windup delays hit" test above confirms the arc turns on)
    // keeps drift minimal and tests the real thing: the arc, not physics.
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 }); // swings toward +x
    const victim = mkPlayer(B, 520, 378);
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS);
    expect(after.players[B]!.health).toBe(100);
  });

  test("an enemy behind the swing is not hit", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 440, 300); // behind the swing direction
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS + ACTIVE_TICKS);
    expect(after.players[B]!.health).toBe(100);
  });

  test("an enemy outside EDGE_RANGE is not hit", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 700, 300); // 200px away, beyond EDGE_RANGE 84
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS + ACTIVE_TICKS);
    expect(after.players[B]!.health).toBe(100);
  });

  test("the arc hits ALL enemies in range/cone, not just the first", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victimNear = mkPlayer(B, 550, 300);
    const victimAlsoNear = mkPlayer(C, 550, 310);
    const state = mkState([attacker, victimNear, victimAlsoNear]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(
      state, runtime, pressInputs([attacker, victimNear, victimAlsoNear], A, 900, 300, 1), DT_MS,
    );
    const after = stepIdle(s1.state, runtime, [attacker, victimNear, victimAlsoNear], WINDUP_TICKS);
    expect(after.players[B]!.health).toBeLessThan(100);
    expect(after.players[C]!.health).toBeLessThan(100);
  });

  test("a landed hit deals EDGE_DAMAGE (harder than ninja's SLASH_DAMAGE)", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300);
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS);
    // EDGE_DAMAGE (32) > ninja's SLASH_DAMAGE (22) — "harder hit".
    expect(after.players[B]!.health).toBe(68);
  });

  test("re-swinging is blocked during recovery, then allowed once recovery ends", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker], A, 900, 300, 1), DT_MS);
    let s = stepIdle(s1.state, runtime, [attacker], WINDUP_TICKS + ACTIVE_TICKS);
    let res = stepWithRuntime(s, runtime, releaseInputs([attacker], A, 900, 300, 50), DT_MS);
    res = stepWithRuntime(res.state, runtime, pressInputs([attacker], A, 900, 300, 99), DT_MS);
    expect(res.events.some((e) => e.t === "slash-started")).toBe(false);

    s = stepIdle(res.state, runtime, [attacker], RECOVERY_TICKS + 2);
    res = stepWithRuntime(s, runtime, releaseInputs([attacker], A, 900, 300, 150), DT_MS);
    res = stepWithRuntime(res.state, runtime, pressInputs([attacker], A, 900, 300, 200), DT_MS);
    expect(res.events.some((e) => e.t === "slash-started" && e.playerId === A)).toBe(true);
  });
});

describe("paladin melee — Kindled Edge is NOT ninja's slash with new numbers", () => {
  test("a landed hit spawns NO wave projectile (unlike ninja's wave-off-swing)", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300);
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    let s = s1.state;
    let sawWave = false;
    for (let i = 0; i < WINDUP_TICKS + ACTIVE_TICKS + RECOVERY_TICKS + 2; i++) {
      const res = stepWithRuntime(s, runtime, noInputs([attacker, victim]), DT_MS);
      s = res.state;
      if (res.events.some((e) => e.t === "wave-spawned")) sawWave = true;
    }
    expect(sawWave).toBe(false);
    expect(Object.keys(s.projectiles).length).toBe(0);
  });

  test("a landed hit grants the attacker NO energy/kindling — Kindling comes only from Ward absorb", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300, kindling: 0 });
    const victim = mkPlayer(B, 560, 300);
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS);
    expect(after.players[B]!.health).toBeLessThan(100); // sanity: the hit landed
    expect(after.players[A]!.kindling ?? 0).toBe(0);
    expect(after.players[A]!.energy ?? 0).toBe(0);
  });
});
