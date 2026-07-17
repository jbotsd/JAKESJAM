// Emission Engine P0 — charge fill (docs/emission-engine-goal.md).
// abilityCharge fills from this tick's hit-confirmed events at the single
// end-of-damage post-pass in World.stepWithRuntime: +0.5×damage for the
// attacker (non-self only), +0.2×damage for the victim, clamped to 100.
// Parried/shielded hits never emit hit-confirmed, so refused damage must
// not charge meters. Charge persists through death (doctrine). All tests
// deterministic — fixed seed, scripted projectiles, no wall-clock.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import {
  EMISSION_CHARGE_MAX,
  EMISSION_FILL_PER_DAMAGE_DEALT,
  EMISSION_FILL_PER_DAMAGE_TAKEN,
} from "../constants.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type ProjectileEntity,
  type WorldState,
} from "../types.js";

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
    lastProcessedInputSeq: InputSeq(0),
  };
}

function mkProjectile(
  idRaw: number,
  ownerId: PlayerId,
  x: number,
  y: number,
  damage = 20,
): ProjectileEntity {
  const id = EntityId(idRaw);
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
    element: "neutral",
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
  const projMap: Record<EntityId, ProjectileEntity> = {};
  for (const pr of projectiles) projMap[pr.id] = pr;
  return {
    tick: Tick(0),
    rngState: 1234567 >>> 0,
    players: playerMap,
    projectiles: projMap,
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

function noInputs(players: PlayerEntity[]): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = null;
  return out;
}

describe("emission charge fill", () => {
  test("a direct hit fills attacker at 0.5x and victim at 0.2x the applied damage", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim = mkPlayer(B, 100, 400);
    const proj = mkProjectile(1, A, 95, 400, 20);
    const state = mkState([attacker, victim], [proj]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
    expect(res.state.players[B]!.health).toBe(80);
    expect(res.state.players[A]!.abilityCharge).toBeCloseTo(
      20 * EMISSION_FILL_PER_DAMAGE_DEALT,
      10,
    );
    expect(res.state.players[B]!.abilityCharge).toBeCloseTo(
      20 * EMISSION_FILL_PER_DAMAGE_TAKEN,
      10,
    );
  });

  test("charge clamps at EMISSION_CHARGE_MAX and never exceeds it", () => {
    const attacker = mkPlayer(A, 0, 400);
    attacker.abilityCharge = 99;
    const victim = mkPlayer(B, 100, 400);
    victim.abilityCharge = 99.9;
    const proj = mkProjectile(1, A, 95, 400, 20);
    const state = mkState([attacker, victim], [proj]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
    expect(res.state.players[A]!.abilityCharge).toBe(EMISSION_CHARGE_MAX);
    expect(res.state.players[B]!.abilityCharge).toBe(EMISSION_CHARGE_MAX);
  });

  test("~200 damage dealt fills the attacker to full (goal-doc economy)", () => {
    // 10 sequential 20-damage hits = 200 dealt → 100 charge exactly at the
    // 0.5 rate. The goal doc's "~150 ≈ 1.5 kills" is the design intent;
    // this asserts the math that delivers it.
    const runtime = createRuntime(flatMap);
    let attacker = mkPlayer(A, 0, 400);
    let charge = 0;
    for (let hit = 0; hit < 10; hit++) {
      const victim = mkPlayer(B, 100, 400); // fresh victim each hit
      attacker = { ...attacker, abilityCharge: charge };
      const proj = mkProjectile(100 + hit, A, 95, 400, 20);
      const state = mkState([attacker, victim], [proj]);
      const res = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
      charge = res.state.players[A]!.abilityCharge;
    }
    expect(charge).toBe(EMISSION_CHARGE_MAX);
  });

  test("a shielded (absorbed) hit charges neither side — refused damage is not participation", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim = mkPlayer(B, 100, 400);
    victim.shieldActive = true;
    victim.shieldCharge = 100;
    victim.shieldMaxCharge = 100;
    const proj = mkProjectile(1, A, 95, 400, 20);
    const state = mkState([attacker, victim], [proj]);
    const runtime = createRuntime(flatMap);

    // The victim must actively HOLD the shield bit — a null input frame
    // reads as all-keys-released and drops the shield before the hit.
    const SHIELD_BIT = 1 << 8;
    const inputs = noInputs([attacker, victim]);
    inputs[B] = {
      seq: InputSeq(1),
      tick: Tick(0),
      keys: SHIELD_BIT,
      aimX: victim.aimX,
      aimY: victim.aimY,
      dtMs: DT_MS,
    };

    const res = stepWithRuntime(state, runtime, inputs, DT_MS);
    // Shield absorbed: victim health untouched, and no charge moved.
    expect(res.state.players[B]!.health).toBe(100);
    expect(res.state.players[A]!.abilityCharge).toBe(0);
    expect(res.state.players[B]!.abilityCharge).toBe(0);
  });

  test("the killing blow still fills, and the dead player keeps their charge", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim = mkPlayer(B, 100, 400);
    victim.health = 10;
    victim.abilityCharge = 40;
    const proj = mkProjectile(1, A, 95, 400, 20);
    const state = mkState([attacker, victim], [proj]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
    const deadVictim = res.state.players[B]!;
    expect(deadVictim.alive).toBe(false);
    // Applied damage on the killing blow: the full 20 (health floor doesn't
    // reduce the event's damage in the TS drain path).
    expect(deadVictim.abilityCharge).toBeCloseTo(
      40 + 20 * EMISSION_FILL_PER_DAMAGE_TAKEN,
      10,
    );
    expect(res.state.players[A]!.abilityCharge).toBeCloseTo(
      20 * EMISSION_FILL_PER_DAMAGE_DEALT,
      10,
    );
  });

  test("environmental damage (burn DoT, no attacker) fills only the victim's taken side", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim = mkPlayer(B, 100, 400);
    const proj: ProjectileEntity = {
      ...mkProjectile(1, A, 95, 400, 20),
      element: "fire",
    };
    let state = mkState([attacker, victim], [proj]);
    const runtime = createRuntime(flatMap);
    const inputs = noInputs([attacker, victim]);

    // Hit lands: burn applied (burnDps = 8). Capture post-hit charges.
    let res = stepWithRuntime(state, runtime, inputs, DT_MS);
    state = res.state;
    const attackerAfterHit = state.players[A]!.abilityCharge;
    const victimAfterHit = state.players[B]!.abilityCharge;
    expect(state.players[B]!.burnDps).toBe(8);

    // Step until at least one burn tick applies (~1s of sim time).
    let burnTicked = false;
    for (let i = 0; i < 90 && !burnTicked; i++) {
      res = stepWithRuntime(state, runtime, inputs, DT_MS);
      state = res.state;
      if (res.events.some((e) => e.t === "hit-confirmed" && e.victimId === B)) {
        burnTicked = true;
      }
    }
    expect(burnTicked).toBe(true);
    // Victim gained taken-side charge from the burn tick (8 dmg × 0.2).
    expect(state.players[B]!.abilityCharge).toBeCloseTo(
      victimAfterHit + 8 * EMISSION_FILL_PER_DAMAGE_TAKEN,
      10,
    );
    // Attacker gained NOTHING from the burn tick (attackerId is null on
    // burn DoT hit-confirmed events — environmental by contract).
    expect(state.players[A]!.abilityCharge).toBe(attackerAfterHit);
  });

  test("hangout mode never charges meters", () => {
    const attacker = mkPlayer(A, 0, 400);
    const victim = mkPlayer(B, 100, 400);
    const proj = mkProjectile(1, A, 95, 400, 20);
    const state = mkState([attacker, victim], [proj]);
    const runtime = createRuntime(flatMap, "hangout");

    // Step several ticks — hangout players are damage-immune and no
    // combat events exist, so charge must stay at 0 throughout.
    let s = state;
    for (let i = 0; i < 10; i++) {
      const res = stepWithRuntime(s, runtime, noInputs([attacker, victim]), DT_MS);
      s = res.state;
    }
    expect(s.players[A]!.abilityCharge).toBe(0);
    expect(s.players[B]!.abilityCharge).toBe(0);
  });
});
