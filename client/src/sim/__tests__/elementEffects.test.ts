// Element status effects (Crystal Rounds card system).
// Verifies fire burn DoT, ice freeze movement multiplier, lightning chain, and
// radiant bonus damage. All tests are deterministic — fixed RNG seed, scripted
// inputs, tick-quantized timers, no wall-clock reads.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import type {
  InputFrame,
  MapDefinition,
  PlayerEntity,
  PlayerId,
  ProjectileEntity,
  WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;
const Bit = {
  Right: 1 << 1,
} as const;

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    {
      id: "floor",
      kind: "floor",
      position: { x: 0, y: 500 },
      size: { x: 1280, y: 60 },
    },
  ],
};

function mkPlayer(id: PlayerId, x: number, y: number): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x,
    y,
    vx: 0,
    vy: 0,
    aimX: x + 100,
    aimY: y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "starter-pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: 0,
  };
}

function mkProjectile(
  id: number,
  ownerId: PlayerId,
  x: number,
  y: number,
  element: string,
  damage = 20,
): ProjectileEntity {
  return {
    id,
    ownerId,
    x,
    y,
    vx: 600,
    vy: 0,
    shape: "circle",
    radius: 8,
    damage,
    lifetimeMs: 1000,
    pathing: "straight",
    element,
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
}

function mkState(
  players: PlayerEntity[],
  projectiles: ProjectileEntity[],
): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  const projMap: Record<number, ProjectileEntity> = {};
  for (const pr of projectiles) projMap[pr.id] = pr;
  return {
    tick: 0,
    rngState: 1234567 >>> 0,
    players: playerMap,
    projectiles: projMap,
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      // Keep the round timer well above zero so `stepRound` doesn't trigger
      // a time-out resolution while these tests run.
      countdownRemainingMs: 90_000,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
}

function noInputs(players: PlayerEntity[]): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = null;
  return out;
}

describe("element status effects", () => {
  test("fire projectile applies 3-second burn DoT at 0.4x damage per second", () => {
    // Position projectile so it hits the victim immediately (within radius).
    const attacker = mkPlayer("a", 0, 400);
    const victim = mkPlayer("b", 100, 400);
    const proj = mkProjectile(1, "a", 95, 400, "fire", 20);
    let state = mkState([attacker, victim], [proj]);
    const runtime = createRuntime(flatMap);
    const inputs = noInputs([attacker, victim]);

    // Step 1: hit lands. health = 100 - 20 = 80. burnDps = 8.
    let res = stepWithRuntime(state, runtime, inputs, DT_MS);
    state = res.state;
    expect(state.players.b!.health).toBe(80);
    expect(state.players.b!.burnDps).toBe(8);
    expect(state.players.b!.burnUntilTick).toBeGreaterThan(state.tick);

    // Step ~3 seconds (180 ticks). Burn ticks at second boundaries.
    let burnHits = 0;
    for (let i = 0; i < 200; i++) {
      res = stepWithRuntime(state, runtime, inputs, DT_MS);
      state = res.state;
      for (const ev of res.events) {
        if (
          ev.t === "hit-confirmed" &&
          ev.victimId === "b" &&
          ev.sourceProjectileId === null
        ) {
          burnHits += 1;
        }
      }
    }
    // 3 burn ticks expected over 3 seconds.
    expect(burnHits).toBeGreaterThanOrEqual(2);
    expect(burnHits).toBeLessThanOrEqual(4);
    // Health dropped further from burn.
    expect(state.players.b!.health).toBeLessThan(80);
    // Burn cleared after window.
    expect(state.players.b!.burnUntilTick).toBeUndefined();
  });

  test("ice projectile freezes target → recorded movement is half", () => {
    // Two parallel sims: one with ice hit, one without. Compare displacement.
    const TICKS = 60; // 1 second at 60Hz
    const runScenario = (withIce: boolean) => {
      const attacker = mkPlayer("a", 0, 400);
      const victim = mkPlayer("b", 100, 400);
      const projectiles = withIce
        ? [mkProjectile(1, "a", 95, 400, "ice", 1)]
        : [];
      let state = mkState([attacker, victim], projectiles);
      const runtime = createRuntime(flatMap);
      // Scripted: victim presses Right the entire time.
      const startX = state.players.b!.x;
      for (let i = 0; i < TICKS; i++) {
        const inputs: Record<PlayerId, InputFrame | null> = {
          a: null,
          b: {
            seq: i,
            tick: i,
            keys: Bit.Right,
            aimX: 1000,
            aimY: 400,
            dtMs: DT_MS,
          },
        };
        const res = stepWithRuntime(state, runtime, inputs, DT_MS);
        state = res.state;
      }
      return state.players.b!.x - startX;
    };
    const withoutIce = runScenario(false);
    const withIce = runScenario(true);
    // Ice should yield ~50% of normal displacement (within tolerance).
    expect(withoutIce).toBeGreaterThan(0);
    expect(withIce).toBeGreaterThan(0);
    expect(withIce).toBeLessThan(withoutIce);
    const ratio = withIce / withoutIce;
    // Freeze starts the tick after the hit lands, so ratio drifts a bit
    // above 0.5 — accept a generous band centered there.
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.7);
  });

  test("lightning projectile chains half damage to nearest other player", () => {
    const attacker = mkPlayer("a", 0, 400);
    const victim = mkPlayer("b", 100, 400);
    const bystander = mkPlayer("c", 250, 400); // within 220px chain radius
    const proj = mkProjectile(1, "a", 95, 400, "lightning", 30);
    let state = mkState([attacker, victim, bystander], [proj]);
    const runtime = createRuntime(flatMap);
    const inputs = noInputs([attacker, victim, bystander]);

    const res = stepWithRuntime(state, runtime, inputs, DT_MS);
    state = res.state;
    // Primary takes full 30, chain target takes 15.
    expect(state.players.b!.health).toBe(70);
    expect(state.players.c!.health).toBe(85);
  });

  test("radiant projectile deals 1.4x damage to a target with active status", () => {
    // Pre-burn the victim, then hit with radiant.
    const attacker = mkPlayer("a", 0, 400);
    const victim: PlayerEntity = {
      ...mkPlayer("b", 100, 400),
      burnUntilTick: 9999,
      burnDps: 1,
      burnTickLastApplied: 0,
    };
    const proj = mkProjectile(1, "a", 95, 400, "radiant", 20);
    let state = mkState([attacker, victim], [proj]);
    const runtime = createRuntime(flatMap);
    const inputs = noInputs([attacker, victim]);

    const res = stepWithRuntime(state, runtime, inputs, DT_MS);
    state = res.state;
    // 20 base * 1.4 = 28. Victim starts at 100. Health = 100 - 28 = 72.
    // Burn DoT may also tick on the same step (state.tick was 0,
    // burnTickLastApplied was 0, ONE_SECOND_TICKS = 60, so 0 - 0 = 0 < 60,
    // burn does NOT tick this step). So pure radiant = 28.
    expect(state.players.b!.health).toBe(72);
  });
});
