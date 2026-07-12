// DASH BASH — the offensive half of the shield-dash. A player mid-dash
// that rams an enemy inside the shield's frontal arc deals damage + knockback
// and their dash stops on impact. Deterministic; the attacker is pre-seeded
// mid-dash so the test doesn't need a dash-card loadout.

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

const SHIELD_BIT = 1 << 8;

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
    id, characterId: "balanced", x, y, vx: 0, vy: 0,
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

/** Seed the attacker mid-dash: airborne, dash window open, moving toward +x. */
function seedDashingAttacker(runtime: ReturnType<typeof createRuntime>, id: PlayerId) {
  runtime.movement.set(id, {
    ...freshPlayerMovementMemory(),
    groundedLastFrame: false,
    dashActiveMs: 120,
    dashCooldownMs: 400,
    dashUsedInAir: 1,
  });
}

describe("dash bash", () => {
  test("dashing into an enemy in the front arc deals damage + knockback and stops the dash", () => {
    const attacker = mkPlayer(A, 500, 300, { vx: 600, vy: 0, aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 540, 300); // 40px ahead, within BASH_RANGE 46
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    seedDashingAttacker(runtime, A);

    const res = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
    const va = res.state.players[A]!;
    const vb = res.state.players[B]!;

    // Victim took the bash and got shoved forward (+x) and up.
    expect(vb.health).toBe(100 - 34);
    expect(vb.vx).toBeGreaterThan(300);
    expect(vb.vy).toBeLessThan(0);
    // Attacker's dash stopped on impact (velocity bled way down).
    expect(Math.abs(va.vx)).toBeLessThan(300);
    expect(vb.alive).toBe(true);
    // A bash hit-confirmed (no projectile) was emitted.
    expect(
      res.events.some(
        (e) => e.t === "hit-confirmed" && e.victimId === "b" && e.sourceProjectileId === null,
      ),
    ).toBe(true);
  });

  test("an enemy OUTSIDE the frontal arc is not bashed", () => {
    // Dash toward +x, victim directly BEHIND (−x) → outside the 120° front cone.
    const attacker = mkPlayer(A, 500, 300, { vx: 600, vy: 0, aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 465, 300); // behind the lunge
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    seedDashingAttacker(runtime, A);

    const res = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
    expect(res.state.players[B]!.health).toBe(100);
  });

  test("a shielded victim clashes shields — no damage, but still shoved", () => {
    const attacker = mkPlayer(A, 500, 300, { vx: 600, vy: 0, aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 540, 300, { shieldActive: true, shieldCharge: 100 });
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    seedDashingAttacker(runtime, A);

    // Victim HOLDS shield (tickShield keeps shieldActive true only while held).
    const inputs: Record<PlayerId, InputFrame | null> = {
      [A]: null,
      [B]: {
        seq: InputSeq(1), tick: Tick(0), keys: SHIELD_BIT as InputBitfield,
        aimX: 440, aimY: 300, dtMs: DT_MS,
      },
    };
    const res = stepWithRuntime(state, runtime, inputs, DT_MS);
    const vb = res.state.players[B]!;
    expect(vb.health).toBe(100); // blocked
    expect(vb.vx).toBeGreaterThan(300); // still knocked back
    expect((vb.shieldCharge ?? 0)).toBeLessThan(100); // shield drained by the clash
    // The CLANG: a blocked bash must emit parry-deflected so the renderer
    // gets the clash (flash + sound) — it used to be a silent 660px/s hit.
    expect(
      res.events.some((e) => e.t === "parry-deflected" && e.playerId === B),
    ).toBe(true);
  });
});
