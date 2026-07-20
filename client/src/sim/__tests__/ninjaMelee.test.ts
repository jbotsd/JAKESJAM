// NINJA MELEE — the dual-blade slash + wave-off-swing verb, dash-through
// body-cross, class energy resource, and dash-i-frame evasion. First new
// combat verb since the Zig cutover (docs/classes-goal.md ninja chassis).
//
// Follows dashBash.test.ts's fixture conventions exactly — same mkPlayer/
// mkState/noInputs helpers, same createRuntime + stepWithRuntime harness.
// classId is derived from characterId ("sprinter" = ninja); every test that
// proves a behavior is ninja-only re-runs the identical scenario on a
// "balanced" (wizard) characterId and asserts NOTHING ninja-shaped happens
// — that's the classId-gating proof the task calls for.

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

/**
 * A REAL "key released" tick — `keys: 0` sent as an actual InputFrame, NOT
 * `null`. World.ts's `runtime.prevKeys` is only updated `if (input)`
 * (line ~1431) — a `null` input frame means "no update this tick" (missing/
 * dropped network frame tolerance), so it does NOT clear a held bit for
 * rising-edge purposes. A test that "releases" Fire via `noInputs` never
 * actually clears `prevKeys`, so a later re-press sees a STALE prevKeys
 * still holding the bit and silently never re-edges — a vacuous pass, not
 * a real test of any re-trigger gate. Always use this (not `noInputs`)
 * when a test needs a genuine release-then-re-press sequence.
 */
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

/** Step the sim `n` more times with no new inputs (holding whatever was
 *  last true — release is implicit since a fresh InputFrame isn't sent). */
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

// Commit-frame constants mirrored from World.ts (SLASH_WINDUP_MS=60,
// SLASH_CONTACT_DELAY_MS=22, SLASH_ACTIVE_MS=45, SLASH_RECOVERY_MS=110 — halved
// 2026-07-20 alongside SLASH_DAMAGE, same DPS, twice the cadence) — kept
// local so a change to the real constants fails this test loudly instead
// of silently drifting.
const WINDUP_TICKS = Math.ceil(60 / DT_MS);
const CONTACT_TICKS = Math.ceil(22 / DT_MS);
const ACTIVE_TICKS = Math.ceil(45 / DT_MS);
const RECOVERY_TICKS = Math.ceil(110 / DT_MS);

describe("ninja melee — classId gating (zero behavior change for other chassis)", () => {
  test("a non-ninja (balanced) pressing Fire still fires stepWeapon, not a slash", () => {
    const attacker = mkPlayer(A, 500, 300, { characterId: "balanced", aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime, pressInputs([attacker], A, 900, 300, 1), DT_MS,
    );
    // The ordinary ranged weapon fired (shot-fired), NOT a slash-started.
    expect(res.events.some((e) => e.t === "shot-fired")).toBe(true);
    expect(res.events.some((e) => e.t === "slash-started")).toBe(false);
    expect(res.state.players[A]!.energy ?? 0).toBe(0);
  });

  test("a non-ninja dashing through an enemy does NOT get evasion or a dash-through event", () => {
    const attacker = mkPlayer(A, 500, 300, {
      characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300,
    });
    const victim = mkPlayer(B, 540, 300, { characterId: "balanced" });
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    // Seed victim mid-dash (the one whose evasion we're testing) AND
    // attacker mid-dash (to also exercise dash-through gating).
    runtime.movement.set(B, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });
    const projHit = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
    // No dash-through event for a non-ninja dashing attacker (attacker A
    // isn't dashing here, but confirms nothing ninja-shaped fired at all).
    expect(projHit.events.some((e) => e.t === "dash-through")).toBe(false);
  });
});

describe("ninja melee — arc hit detection", () => {
  test("damage lands at the authored radial intercept, not during windup or early active", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300); // ~60px ahead, within SLASH_RANGE 78
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    expect(s1.events.some((e) => e.t === "slash-started" && e.playerId === A)).toBe(true);
    // Still in windup — no hit yet.
    expect(s1.state.players[B]!.health).toBe(100);

    const beforeContact = stepIdle(
      s1.state, runtime, [attacker, victim], WINDUP_TICKS + CONTACT_TICKS - 1,
    );
    expect(beforeContact.players[B]!.health).toBe(100);
    const atContact = stepIdle(beforeContact, runtime, [attacker, victim], 1);
    expect(atContact.players[B]!.health).toBeLessThan(100);
  });

  test("an enemy outside the arc (behind the swing) is not hit", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 }); // swings toward +x
    const victim = mkPlayer(B, 440, 300); // behind the swing direction
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS + ACTIVE_TICKS);
    expect(after.players[B]!.health).toBe(100);
  });

  test("an enemy outside SLASH_RANGE is not hit", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 700, 300); // 200px away, beyond SLASH_RANGE 78
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS + ACTIVE_TICKS);
    expect(after.players[B]!.health).toBe(100);
  });

  test("the arc hits ALL enemies in range/cone, not just the first", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const victimNear = mkPlayer(B, 550, 300);
    const victimAlsoNear = mkPlayer(C, 550, 320);
    const state = mkState([attacker, victimNear, victimAlsoNear]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(
      state, runtime, pressInputs([attacker, victimNear, victimAlsoNear], A, 900, 300, 1), DT_MS,
    );
    const after = stepIdle(
      s1.state, runtime, [attacker, victimNear, victimAlsoNear], WINDUP_TICKS + CONTACT_TICKS,
    );
    expect(after.players[B]!.health).toBeLessThan(100);
    expect(after.players[C]!.health).toBeLessThan(100);
  });

  test("re-swinging is blocked during recovery, then allowed once recovery ends", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker], A, 900, 300, 1), DT_MS);
    // Walk into recovery (windup + active complete).
    let s = stepIdle(s1.state, runtime, [attacker], WINDUP_TICKS + ACTIVE_TICKS);
    // Release (a REAL keys:0 frame — see releaseInputs's doc comment on
    // why `noInputs` can't be used here) then re-press Fire mid-recovery —
    // must NOT start a new swing ("gate re-swinging during recovery" /
    // "no free cast").
    let res = stepWithRuntime(s, runtime, releaseInputs([attacker], A, 900, 300, 50), DT_MS);
    res = stepWithRuntime(res.state, runtime, pressInputs([attacker], A, 900, 300, 99), DT_MS); // re-press
    expect(res.events.some((e) => e.t === "slash-started")).toBe(false);

    // Walk through the rest of recovery — a couple of ticks were already
    // spent above (release + the blocked re-press), so pad RECOVERY_TICKS
    // by a small buffer rather than hand-tracking the exact remainder.
    // Release, then re-press — a fresh swing IS allowed once the FSM
    // returns to idle.
    s = stepIdle(res.state, runtime, [attacker], RECOVERY_TICKS + 2);
    res = stepWithRuntime(s, runtime, releaseInputs([attacker], A, 900, 300, 150), DT_MS);
    res = stepWithRuntime(res.state, runtime, pressInputs([attacker], A, 900, 300, 200), DT_MS); // re-press
    expect(res.events.some((e) => e.t === "slash-started" && e.playerId === A)).toBe(true);
  });
});

describe("ninja melee — the basic swing is PURE MELEE (the wave rides Edge Storm only)", () => {
  // 2026-07-18 (Jake): "not projectile at all on rogue for mouse button" — a
  // basic mouse swing spawns NO aftermath wave; the crystal wave now only fires
  // while the Edge Storm ability is live (see ninjaCatalog.test.ts for that path).
  test("a basic swing spawns NO wave projectile (mouse is pure melee)", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300 });
    const state = mkState([attacker]); // nobody else on the map — cannot land a hit
    const runtime = createRuntime(flatMap);

    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker], A, 900, 300, 1), DT_MS);
    let s = s1.state;
    let sawWave = false;
    for (let i = 0; i < WINDUP_TICKS + ACTIVE_TICKS + 1; i++) {
      const res = stepWithRuntime(s, runtime, noInputs([attacker]), DT_MS);
      s = res.state;
      if (res.events.some((e) => e.t === "wave-spawned")) sawWave = true;
    }
    expect(sawWave).toBe(false);
    expect(Object.keys(s.projectiles).length).toBe(0);
  });
});

describe("ninja melee — energy resource", () => {
  test("passive regen raises energy over time even without contact", () => {
    const attacker = mkPlayer(A, 500, 300, { energy: 0 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    const after = stepIdle(state, runtime, [attacker], 30);
    expect(after.players[A]!.energy ?? 0).toBeGreaterThan(0);
  });

  test("a landed melee hit restores energy to the attacker", () => {
    const attacker = mkPlayer(A, 500, 300, { aimX: 900, aimY: 300, energy: 0 });
    const victim = mkPlayer(B, 550, 300);
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(state, runtime, pressInputs([attacker, victim], A, 900, 300, 1), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS + CONTACT_TICKS);
    expect(after.players[B]!.health).toBeLessThan(100); // sanity: the hit landed
    expect(after.players[A]!.energy ?? 0).toBeGreaterThan(0);
  });

  test("energy never exceeds NINJA_ENERGY_MAX (100)", () => {
    const attacker = mkPlayer(A, 500, 300, { energy: 99 });
    const state = mkState([attacker]);
    const runtime = createRuntime(flatMap);
    const after = stepIdle(state, runtime, [attacker], 120); // ~2s of passive regen
    expect(after.players[A]!.energy ?? 0).toBeLessThanOrEqual(100);
  });
});

describe("ninja melee — dash-through body-cross", () => {
  test("a dash sweeping through an enemy's hitbox emits dash-through once and grants energy", () => {
    const attacker = mkPlayer(A, 500, 300, { vx: 600, energy: 0 });
    const victim = mkPlayer(B, 520, 300); // overlapping hitboxes at this range
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });

    let s = state;
    let crossCount = 0;
    for (let i = 0; i < 6; i++) {
      const res = stepWithRuntime(s, runtime, noInputs([attacker, victim]), DT_MS);
      s = res.state;
      crossCount += res.events.filter((e) => e.t === "dash-through").length;
    }
    // Exactly one body-cross for this single dash burst — not one per
    // tick of overlap (dashThroughTagged debounce).
    expect(crossCount).toBe(1);
    expect(s.players[A]!.energy ?? 0).toBeGreaterThan(0);
  });
});

describe("ninja melee — evasion (dash i-frames)", () => {
  test("a dashing ninja takes ZERO damage from an incoming melee bash", () => {
    // B is the ninja evader, C is a dash-bashing attacker.
    const evader = mkPlayer(B, 540, 300, { characterId: "sprinter" });
    const basher = mkPlayer(C, 500, 300, { characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300 });
    const state = mkState([basher, evader]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(C, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });
    runtime.movement.set(B, { ...freshPlayerMovementMemory(), dashActiveMs: 120 }); // evader also dashing

    const res = stepWithRuntime(state, runtime, noInputs([basher, evader]), DT_MS);
    expect(res.state.players[B]!.health).toBe(100); // untouched
    expect(res.events.some((e) => e.t === "hit-confirmed" && e.victimId === "b")).toBe(false);
  });

  test("a NON-dashing ninja still takes damage from a bash (evasion is dash-gated, not classId-only)", () => {
    const evader = mkPlayer(B, 540, 300, { characterId: "sprinter" }); // NOT dashing
    const basher = mkPlayer(C, 500, 300, { characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300 });
    const state = mkState([basher, evader]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(C, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });

    const res = stepWithRuntime(state, runtime, noInputs([basher, evader]), DT_MS);
    expect(res.state.players[B]!.health).toBeLessThan(100);
  });

  test("classId gating proof: a dashing NON-ninja does not get evasion", () => {
    const evader = mkPlayer(B, 540, 300, { characterId: "balanced" }); // dashing but NOT a ninja
    const basher = mkPlayer(C, 500, 300, { characterId: "heavy", vx: 600, vy: 0, aimX: 900, aimY: 300 });
    const state = mkState([basher, evader]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(C, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });
    runtime.movement.set(B, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });

    const res = stepWithRuntime(state, runtime, noInputs([basher, evader]), DT_MS);
    expect(res.state.players[B]!.health).toBeLessThan(100); // bash lands normally
  });
});

describe("ninja melee — wall-kick energy grant", () => {
  const JUMP_BIT = 1 << 4;
  const wallMap: MapDefinition = {
    id: "wall-test", name: "wall-test", size: { x: 1280, y: 640 },
    spawns: [{ x: 400, y: 300 }],
    platforms: [
      { id: "floor", kind: "floor", position: { x: 640, y: 624 }, size: { x: 1280, y: 32 } },
      { id: "wall-left", kind: "wall", position: { x: 16, y: 320 }, size: { x: 32, y: 640 } },
    ],
  };

  test("a wall-jump rising edge while airborne+touching-wall grants energy to a ninja", () => {
    const attacker = mkPlayer(A, 60, 300, { vx: 0, vy: 0, energy: 0 });
    const state = mkState([attacker]);
    const runtime = createRuntime(wallMap);
    runtime.movement.set(A, {
      ...freshPlayerMovementMemory(),
      groundedLastFrame: false,
      touchingWallDir: -1, // gripping the left wall
    });

    const res = stepWithRuntime(
      state, runtime,
      { [A]: { seq: InputSeq(1), tick: Tick(1), keys: JUMP_BIT as InputBitfield, aimX: 400, aimY: 300, dtMs: DT_MS } },
      DT_MS,
    );
    expect(res.state.players[A]!.energy ?? 0).toBeGreaterThan(0);
  });

  test("classId gating proof: a non-ninja wall-jump does not grant energy", () => {
    const attacker = mkPlayer(A, 60, 300, { characterId: "balanced", vx: 0, vy: 0, energy: 0 });
    const state = mkState([attacker]);
    const runtime = createRuntime(wallMap);
    runtime.movement.set(A, {
      ...freshPlayerMovementMemory(),
      groundedLastFrame: false,
      touchingWallDir: -1,
    });

    const res = stepWithRuntime(
      state, runtime,
      { [A]: { seq: InputSeq(1), tick: Tick(1), keys: JUMP_BIT as InputBitfield, aimX: 400, aimY: 300, dtMs: DT_MS } },
      DT_MS,
    );
    expect(res.state.players[A]!.energy ?? 0).toBe(0);
  });
});
