// NINJA/INTERSTICE — Shield deals NO mitigation, ever (2026-07-18 fix).
//
// LOCKED doctrine, stated twice: docs/character-sheets-v1.md's
// DI-Tempest/WoW-Rogue comparison table, Defense row — "Dash i-frames
// only — never block" (contrasted explicitly against DI Tempest's "dodge
// through storm" and WoW Rogue's "vanish, cloak, feint"); and
// docs/classes-goal.md — "dash i-frames — never blocks, only isn't there".
// Ninja's entire defensive identity IS the dash-through evasion i-frame;
// Shield is explicitly NOT a defensive tool for this class.
//
// Bug this fixes: before this pass, no `classId === "ninja"` branch existed
// in combat.ts's tryDeflectDamage, so Ninja's held-Shield fell through to
// the SAME generic 100%-block omnidirectional shield every unclassed/
// pre-class-split character gets — directly contradicting the doctrine
// above. The fix adds a narrow, additive `classId === "ninja"` branch,
// modeled on the existing Kindled Ward (paladin) branch's insertion point,
// that makes Shield deal zero mitigation: full damage always passes
// through, exactly as if shieldActive were false.
//
// Two layers, same split as kindledWard.test.ts:
//   - Pure `tryDeflectDamage` tests (combat.ts) — fast, deterministic,
//     directly exercise the pass-through math.
//   - A `stepWithRuntime` integration test proving the wiring holds through
//     the real tick loop (tickShield still sets shieldActive from the held
//     input bit — that part is untouched — but a landed hit on a
//     shielded ninja still costs full health).
//
// The classId-gating claim is proven by re-running the identical scenario
// on non-ninja chassis (paladin's Kindled Ward, and a generic/unclassed
// chassis's plain 100% block) and asserting their behavior is completely
// unchanged — this file's own regression proof that the addition is
// narrow and additive, not a rewrite of the shared shield code path.

import { describe, expect, test } from "bun:test";
import { WARD_MITIGATION_FRACTION, tryDeflectDamage } from "../combat.js";
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
    characterId: "sprinter", // ninja
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 100,
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
    x: 50, // approaching from +x — frontal to the default aim below
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

describe("Ninja never blocks (tryDeflectDamage) — Shield deals zero mitigation", () => {
  test("a ninja holding Shield, facing the projectile source, still takes full damage", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50 });
    const proj = mkProjectile({ x: 50, y: 0 }); // frontal
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.damage).toBe(25);
    expect(r.shielded).toBe(false);
    expect(r.warded).toBe(false);
    expect(r.deflected).toBe(false);
    expect(r.shieldPopped).toBe(false);
    // Shield charge itself is untouched by this hit — the ninja branch
    // doesn't drain/pop charge on a landed hit (there's nothing to "pop").
    expect(r.player.shieldCharge).toBe(50);
  });

  test("a ninja holding Shield, facing AWAY from the source, still takes full damage (facing is irrelevant — there's no cone to fail)", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: -100, aimY: 0, shieldActive: true, shieldCharge: 50 });
    const proj = mkProjectile({ x: 50, y: 0 }); // behind the ninja's facing
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.damage).toBe(25);
    expect(r.shielded).toBe(false);
  });

  test("a ninja holding Shield takes full melee damage (null-projectile hit, no attackerPos needed)", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50 });
    const r = tryDeflectDamage(p, null, 30, Tick(10));
    expect(r.damage).toBe(30);
    expect(r.shielded).toBe(false);
  });

  test("a ninja NOT holding Shield also takes full damage — no behavior change either way", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: false });
    const proj = mkProjectile({ x: 50, y: 0 });
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.damage).toBe(25);
  });

  test("Void Fracture's voidPiercing option is a no-op for ninja — already full damage either way", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50 });
    const proj = mkProjectile({ x: 50, y: 0, damage: 25 });
    const r = tryDeflectDamage(p, proj, 25, Tick(10), { voidPiercing: true });
    expect(r.damage).toBe(25);
  });

  test("classId gating: a paladin in the identical scenario still gets real Kindled Ward mitigation, proving the ninja branch didn't touch paladin's", () => {
    const p = mkPlayer({ characterId: "heavy", x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50, kindling: 0 });
    const proj = mkProjectile({ x: 50, y: 0, damage: 25 });
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.warded).toBe(true);
    expect(r.damage).toBeCloseTo(25 * (1 - WARD_MITIGATION_FRACTION), 5);
  });

  test("classId gating: a non-ninja, non-paladin (balanced) chassis in the identical scenario still gets the OLD generic 100% block, proving the ninja branch is additive-only", () => {
    const p = mkPlayer({ characterId: "balanced", x: 0, y: 0, aimX: 100, aimY: 0, shieldActive: true, shieldCharge: 50 });
    const proj = mkProjectile({ x: 50, y: 0, damage: 25 });
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.shielded).toBe(true);
    expect(r.damage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: prove the wiring through the real tick loop — tickShield still
// sets shieldActive from the held input bit exactly as it always has (this
// fix does not touch tickShield), but a landed hit on a shielded ninja still
// costs full health end to end.

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
    id, characterId: "sprinter", x, y, vx: 0, vy: 0,
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
const B = PlayerId("b"); // shielding ninja victim

describe("Ninja never blocks — integration (dash-bash into a shielding ninja)", () => {
  test("a ninja holding Shield, facing the basher, still takes the full bash — tickShield engages shieldActive, but the hit isn't mitigated at all", () => {
    const attacker = mkWorldPlayer(A, 500, 300, {
      characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300,
    });
    const victim = mkWorldPlayer(B, 540, 300, { aimX: 440, aimY: 300 });
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
    expect(res.state.players[B]!.shieldActive).toBe(true); // tickShield still engages — untouched
    expect(res.events.some((e) => e.t === "ward-absorbed")).toBe(false);
    // Full BASH_DAMAGE (34) landed — not partially mitigated, not zeroed.
    expect(res.state.players[B]!.health).toBe(100 - 34);
  });

  test("classId gating: the same scenario with a paladin victim still gets real mitigation — proves this fix left Kindled Ward's wiring untouched", () => {
    const attacker = mkWorldPlayer(A, 500, 300, {
      characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300,
    });
    const victim = mkWorldPlayer(B, 540, 300, { characterId: "heavy", aimX: 440, aimY: 300, kindling: 0 });
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
    expect(res.events.some((e) => e.t === "ward-absorbed")).toBe(true);
    expect(res.state.players[B]!.health).toBeGreaterThan(100 - 34);
  });

  test("classId gating: the same scenario with a non-ninja, non-paladin (balanced) victim still gets the OLD generic full block — byte-identical to pre-fix behavior", () => {
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
    expect(res.state.players[B]!.health).toBe(100); // fully blocked, no health lost
  });

  test("a ninja who never holds Shield is fully damaged by a bash — unaffected either way", () => {
    const attacker = mkWorldPlayer(A, 500, 300, {
      characterId: "balanced", vx: 600, vy: 0, aimX: 900, aimY: 300,
    });
    const victim = mkWorldPlayer(B, 540, 300); // ninja, never presses Shield
    const state = mkWorldState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });

    const res = stepWithRuntime(state, runtime, { [A]: null, [B]: null }, DT_MS);
    expect(res.state.players[B]!.health).toBe(100 - 34);
  });
});
