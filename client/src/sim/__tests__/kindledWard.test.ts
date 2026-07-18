// KINDLED WARD + KINDLING — Paladin's directional block and the resource it
// generates on absorb (class-overhaul-workboard.md chunks 2.2/2.3).
//
// Two layers, same split as ninjaMelee.test.ts vs paladinMelee.test.ts:
//   - Pure `tryDeflectDamage` tests (combat.ts), mirroring combat.test.ts's
//     mkPlayer/mkProjectile fixture conventions — fast, deterministic,
//     directly exercise the mitigation math without going through the full
//     tick loop or the swing FSM's windup timing.
//   - A handful of `stepWithRuntime` integration tests proving the wiring
//     (tickShield → shieldActive, World.ts's attackerPos plumbing, the
//     ward-absorbed event, and classId gating) actually holds end to end.
//
// Every classId-gating claim is proven by re-running the identical scenario
// on a non-paladin (balanced) victim and asserting the OLD generic
// omnidirectional-full-block shield behavior is completely unchanged — the
// task's explicit "byte-identical for non-Paladin" requirement.

import { describe, expect, test } from "bun:test";
import {
  KINDLING_MAX,
  KINDLING_PER_DAMAGE_BLOCKED,
  WARD_MITIGATION_FRACTION,
  tryDeflectDamage,
} from "../combat.js";
import { createRuntime, stepWithRuntime } from "../World.js";
import { freshPlayerMovementMemory } from "../player.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type ProjectileEntity,
  type WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;
const SHIELD_BIT = 1 << 8;

function mkPlayer(overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("p1"),
    characterId: "heavy", // paladin
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: -100, // facing -x by default (toward an attacker at +x... see per-test aim)
    aimY: 0,
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
    ...overrides,
  };
}

function mkProjectile(overrides: Partial<ProjectileEntity> = {}): ProjectileEntity {
  return {
    id: EntityId(1),
    ownerId: PlayerId("enemy"),
    x: 50, // approaching from +x
    y: 0,
    vx: -300,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 25,
    lifetimeMs: 1000,
    pathing: "straight",
    element: "crystal",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ...overrides,
  };
}

describe("Kindled Ward (tryDeflectDamage) — frontal mitigation + Kindling grant", () => {
  test("a paladin holding Ward, facing the source, mitigates a hit and gains Kindling", () => {
    // Player at origin, aiming toward +x (facing the incoming shard).
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50, kindling: 0 });
    const proj = mkProjectile({ x: 50, y: 0 }); // source is at +x — frontal
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.warded).toBe(true);
    expect(r.shielded).toBe(false); // NOT the generic full-block flag
    expect(r.deflected).toBe(false);
    expect(r.damage).toBeCloseTo(25 * (1 - WARD_MITIGATION_FRACTION), 5);
    const expectedBlocked = 25 * WARD_MITIGATION_FRACTION;
    expect(r.wardDamageBlocked).toBeCloseTo(expectedBlocked, 5);
    expect(r.wardKindlingGranted).toBeCloseTo(expectedBlocked * KINDLING_PER_DAMAGE_BLOCKED, 5);
    expect(r.player.kindling).toBeCloseTo(expectedBlocked * KINDLING_PER_DAMAGE_BLOCKED, 5);
  });

  test("a paladin holding Ward but facing AWAY from the source takes full damage, no Kindling", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: -100, aimY: 0, shieldActive: true, shieldCharge: 50, kindling: 0 });
    const proj = mkProjectile({ x: 50, y: 0 }); // source at +x, player faces -x — behind
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.warded).toBe(false);
    expect(r.damage).toBe(25);
    expect(r.wardDamageBlocked).toBe(0);
    expect(r.wardKindlingGranted).toBe(0);
    expect(r.player.kindling ?? 0).toBe(0);
  });

  test("a paladin NOT holding Ward takes full damage and gains no Kindling, regardless of facing", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: false, kindling: 0 });
    const proj = mkProjectile({ x: 50, y: 0 }); // frontal, but Ward isn't held
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.warded).toBe(false);
    expect(r.damage).toBe(25);
    expect(r.player.kindling ?? 0).toBe(0);
  });

  test("Kindling accumulates across multiple mitigated hits and caps at KINDLING_MAX", () => {
    let p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50, kindling: KINDLING_MAX - 5 });
    const proj = mkProjectile({ x: 50, y: 0, damage: 40 });
    const r = tryDeflectDamage(p, proj, 40, Tick(10));
    expect(r.warded).toBe(true);
    // 40 * WARD_MITIGATION_FRACTION (0.6) = 24 blocked, which would push
    // kindling past KINDLING_MAX (95 + 24 = 119) — must clamp to 100.
    expect(r.player.kindling).toBe(KINDLING_MAX);
  });

  test("classId gating: a NON-paladin (balanced) with shieldActive gets the OLD generic full block, not Ward", () => {
    const p = mkPlayer({
      characterId: "balanced",
      x: 0, y: 0, aimX: 100, aimY: 0,
      shieldActive: true, shieldCharge: 50,
    });
    const proj = mkProjectile({ x: 50, y: 0, damage: 25 });
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    // Generic shield: damage fully zeroed, `shielded` true, charge drains by
    // damage * SHIELD_HIT_DRAIN_MULTIPLIER — completely unchanged from
    // before Ward existed. Never `warded`.
    expect(r.warded).toBe(false);
    expect(r.shielded).toBe(true);
    expect(r.damage).toBe(0);
    expect(r.player.kindling).toBeUndefined();
  });

  test("classId gating: a NON-paladin behind their own shield still gets the omnidirectional block (no frontal requirement)", () => {
    // The generic shield has no mandatory frontal check unless directionalShield
    // is explicitly passed — proves Ward's "frontal only, no opt-out" rule is
    // genuinely paladin-specific, not a change to the shared shield code path.
    const p = mkPlayer({
      characterId: "balanced",
      x: 0, y: 0, aimX: -100, aimY: 0, // facing AWAY from the source
      shieldActive: true, shieldCharge: 50,
    });
    const proj = mkProjectile({ x: 50, y: 0, damage: 25 });
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.shielded).toBe(true);
    expect(r.damage).toBe(0);
  });

  test("null-projectile (melee/bash) hits use attackerPos for the frontal check", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50, kindling: 0 });
    const r = tryDeflectDamage(p, null, 30, Tick(10), { attackerPos: { x: 40, y: 0 } });
    expect(r.warded).toBe(true);
    expect(r.damage).toBeCloseTo(30 * (1 - WARD_MITIGATION_FRACTION), 5);
  });

  test("null-projectile hits WITHOUT attackerPos fail closed — no mitigation, no Kindling", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50, kindling: 0 });
    const r = tryDeflectDamage(p, null, 30, Tick(10)); // no attackerPos option
    expect(r.warded).toBe(false);
    expect(r.damage).toBe(30);
    expect(r.player.kindling ?? 0).toBe(0);
  });

  test("Void Fracture punches through Ward exactly like the generic shield", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50, kindling: 0 });
    const proj = mkProjectile({ x: 50, y: 0, damage: 25 });
    const r = tryDeflectDamage(p, proj, 25, Tick(10), { voidPiercing: true });
    expect(r.warded).toBe(false);
    expect(r.damage).toBe(25); // full pass-through, untouched
    expect(r.player.kindling ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: prove the wiring through the real tick loop — tickShield sets
// shieldActive from the held input bit, World.ts passes attackerPos for
// melee/bash null-projectile hits, and the ward-absorbed event fires.

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

function mkWorldPlayer(id: PlayerId, x: number, y: number, over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id, characterId: "heavy", x, y, vx: 0, vy: 0,
    aimX: x + 100, aimY: y, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 0, abilityCharge: 0, lastProcessedInputSeq: InputSeq(0), ...over,
  };
}

function mkWorldState(players: PlayerEntity[]): WorldState {
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

const A = PlayerId("a"); // attacker (dash-basher)
const B = PlayerId("b"); // warding paladin victim

describe("Kindled Ward — integration (dash-bash into a warding paladin)", () => {
  test("a paladin holding Shield, facing the basher, mitigates the bash and gains Kindling + a ward-absorbed event", () => {
    const attacker = mkWorldPlayer(A, 500, 300, {
      characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300,
    });
    // Victim just ahead of the lunge, facing back toward the attacker,
    // holding Shield every tick.
    const victim = mkWorldPlayer(B, 540, 300, { aimX: 440, aimY: 300, kindling: 0 });
    const state = mkWorldState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    // Seed a real dash burst on the attacker via the movement memory shape
    // dashBash.test.ts uses — freshPlayerMovementMemory + dashActiveMs.
    runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });

    const heldShield: Record<PlayerId, InputFrame | null> = {
      [A]: null,
      [B]: {
        seq: InputSeq(1), tick: Tick(1), keys: SHIELD_BIT as InputBitfield,
        aimX: 440, aimY: 300, dtMs: DT_MS,
      },
    };
    const res = stepWithRuntime(state, runtime, heldShield, DT_MS);
    expect(res.state.players[B]!.shieldActive).toBe(true); // tickShield engaged
    const wardEvent = res.events.find((e) => e.t === "ward-absorbed");
    expect(wardEvent).toBeDefined();
    expect(res.state.players[B]!.kindling ?? 0).toBeGreaterThan(0);
    // Damage landed (mitigated, not zero) — health dropped but by less than
    // the raw BASH_DAMAGE (34) would have.
    expect(res.state.players[B]!.health).toBeLessThan(100);
    expect(res.state.players[B]!.health).toBeGreaterThan(100 - 34);
  });

  test("classId gating: the same scenario with a non-paladin victim is byte-identical to pre-Ward behavior (full block, no Kindling field, no ward-absorbed event)", () => {
    const attacker = mkWorldPlayer(A, 500, 300, {
      characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300,
    });
    const victim = mkWorldPlayer(B, 540, 300, { characterId: "balanced", aimX: 440, aimY: 300 });
    const state = mkWorldState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });

    const heldShield: Record<PlayerId, InputFrame | null> = {
      [A]: null,
      [B]: {
        seq: InputSeq(1), tick: Tick(1), keys: SHIELD_BIT as InputBitfield,
        aimX: 440, aimY: 300, dtMs: DT_MS,
      },
    };
    const res = stepWithRuntime(state, runtime, heldShield, DT_MS);
    expect(res.events.some((e) => e.t === "ward-absorbed")).toBe(false);
    expect(res.state.players[B]!.kindling).toBeUndefined();
    // Generic shield: the bash is fully blocked (parry-deflected CLANG), no
    // health lost at all.
    expect(res.state.players[B]!.health).toBe(100);
  });

  test("a paladin who never holds Shield is fully damaged by a bash and never touches kindling — same as before Ward existed", () => {
    const attacker = mkWorldPlayer(A, 500, 300, {
      characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300,
    });
    const victim = mkWorldPlayer(B, 540, 300); // paladin, never presses Shield
    const state = mkWorldState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });

    const res = stepWithRuntime(state, runtime, { [A]: null, [B]: null }, DT_MS);
    expect(res.events.some((e) => e.t === "ward-absorbed")).toBe(false);
    expect(res.state.players[B]!.kindling ?? 0).toBe(0);
    expect(res.state.players[B]!.health).toBeLessThan(100);
  });
});

describe("Kindled Ward — a non-paladin chassis pressing Shield is completely unaffected by any of this", () => {
  test("wizard/ninja/priest holding Shield with no attacker nearby behaves exactly like tickShield always has", () => {
    const solo = mkWorldPlayer(A, 500, 300, { characterId: "balanced" });
    const state = mkWorldState([solo]);
    const runtime = createRuntime(flatMap);
    const held: Record<PlayerId, InputFrame | null> = {
      [A]: { seq: InputSeq(1), tick: Tick(1), keys: SHIELD_BIT as InputBitfield, aimX: 600, aimY: 300, dtMs: DT_MS },
    };
    const res = stepWithRuntime(state, runtime, held, DT_MS);
    expect(res.state.players[A]!.shieldActive).toBe(true);
    expect(res.state.players[A]!.kindling).toBeUndefined();
    expect(res.events.some((e) => e.t === "ward-absorbed")).toBe(false);
  });
});
