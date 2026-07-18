// Syzygist Ward (class-overhaul-workboard.md chunk 3.3: "Wards defense
// verb: small absorb barriers, castable on allies"). DIFFERENT SHAPE from
// Paladin's Kindled Ward (kindledWard.test.ts): a flat absorb POOL (not a
// mitigation FRACTION) and NO facing/aim requirement (cast-and-forget —
// the low-aim design direction). Same two-layer split as kindledWard's own
// tests: pure `combat.ts` (via `tryDeflectDamage`) mitigation-math tests,
// then `stepWithRuntime` integration proving `applyWardToAlly`'s wiring
// (isAlly gate, self AND ally targeting, break-on-depletion, expiry) holds
// end to end.

import { describe, expect, test } from "bun:test";
import { tryDeflectDamage } from "../combat.js";
import { createRuntime, stepWithRuntime, applyWardToAlly } from "../World.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type ProjectileEntity,
  type WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;

function mkPlayer(overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("p1"),
    characterId: "shielded", // priest
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: -100,
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
    id: 1 as unknown as ProjectileEntity["id"],
    ownerId: PlayerId("enemy"),
    x: 50,
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

describe("Syzygist Ward (trySyzygistWard, via tryDeflectDamage) — flat absorb pool, no facing check", () => {
  test("absorbs damage fully up to the pool, regardless of facing (no cone check)", () => {
    // Player facing AWAY (-x) from the source at +x — Kindled Ward would
    // fail this hit closed; Syzygist Ward must not care.
    const p = mkPlayer({ x: 0, y: 0, aimX: -100, aimY: 0, wardAbsorbUntilTick: Tick(100), wardAbsorbRemaining: 30 });
    const proj = mkProjectile({ x: 50, y: 0, damage: 20 });
    const r = tryDeflectDamage(p, proj, 20, Tick(10));
    expect(r.syzWarded).toBe(true);
    expect(r.damage).toBe(0);
    expect(r.syzWardDamageBlocked).toBe(20);
    expect(r.player.wardAbsorbRemaining).toBe(10);
    expect(r.syzWardBroke).toBe(false);
  });

  test("only absorbs up to the remaining pool — excess damage passes through, and the pool breaks", () => {
    const p = mkPlayer({ wardAbsorbUntilTick: Tick(100), wardAbsorbRemaining: 15 });
    const proj = mkProjectile({ damage: 25 });
    const r = tryDeflectDamage(p, proj, 25, Tick(10));
    expect(r.syzWarded).toBe(true);
    expect(r.syzWardDamageBlocked).toBe(15);
    expect(r.damage).toBe(10); // 25 - 15
    expect(r.syzWardBroke).toBe(true);
    expect(r.player.wardAbsorbUntilTick).toBeUndefined();
    expect(r.player.wardAbsorbRemaining).toBeUndefined();
    expect(r.player.wardAbsorbSourceId).toBeUndefined();
  });

  test("a non-priest (paladin) with the same fields set never gets Syzygist Ward — classId-gated", () => {
    const p = mkPlayer({
      characterId: "heavy",
      wardAbsorbUntilTick: Tick(100),
      wardAbsorbRemaining: 30,
    });
    const proj = mkProjectile({ damage: 20 });
    const r = tryDeflectDamage(p, proj, 20, Tick(10));
    expect(r.syzWarded ?? false).toBe(false);
    expect(r.damage).toBe(20); // full damage, untouched
  });

  test("an expired window (wardAbsorbUntilTick <= tick) never mitigates, even with pool remaining", () => {
    const p = mkPlayer({ wardAbsorbUntilTick: Tick(5), wardAbsorbRemaining: 30 });
    const proj = mkProjectile({ damage: 20 });
    const r = tryDeflectDamage(p, proj, 20, Tick(10));
    expect(r.syzWarded ?? false).toBe(false);
    expect(r.damage).toBe(20);
  });

  test("no Ward fields set at all is a complete no-op (priest with no cast never mitigates)", () => {
    const p = mkPlayer();
    const proj = mkProjectile({ damage: 20 });
    const r = tryDeflectDamage(p, proj, 20, Tick(10));
    expect(r.syzWarded ?? false).toBe(false);
    expect(r.damage).toBe(20);
  });

  test("no-facing-required proof: a priest facing squarely AWAY from a melee attacker (null projectile, attackerPos) still mitigates", () => {
    const p = mkPlayer({ x: 0, y: 0, aimX: -100, aimY: 0, wardAbsorbUntilTick: Tick(100), wardAbsorbRemaining: 30 });
    const r = tryDeflectDamage(p, null, 20, Tick(10), { attackerPos: { x: 50, y: 0 } });
    expect(r.syzWarded).toBe(true);
    expect(r.damage).toBe(0);
  });

  test("no-facing-required proof, part 2: mitigates even with NO attackerPos at all (unlike Kindled Ward, which fails closed without one)", () => {
    const p = mkPlayer({ wardAbsorbUntilTick: Tick(100), wardAbsorbRemaining: 30 });
    const r = tryDeflectDamage(p, null, 20, Tick(10)); // no attackerPos option
    expect(r.syzWarded).toBe(true);
    expect(r.damage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration — applyWardToAlly + stepWithRuntime.

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 640, y: 500 }, size: { x: 1280, y: 60 } },
  ],
};

function mkWorldPlayer(id: PlayerId, x: number, y: number, over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id, characterId: "shielded", x, y, vx: 0, vy: 0,
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

function inputsWith(
  players: PlayerEntity[],
  overrides: Partial<Record<string, InputFrame>>,
): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = overrides[p.id as string] ?? null;
  return out;
}

const A = PlayerId("a"); // Syzygist caster
const B = PlayerId("b"); // ally target
const C = PlayerId("c"); // enemy / non-ally

describe("applyWardToAlly — mechanism", () => {
  test("an ally target gets a live absorb pool from the caster", () => {
    const caster = mkWorldPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkWorldPlayer(B, 50, 0, { teamId: "t1" });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [B]: target };
    const applied = applyWardToAlly(caster, target, players, Tick(10), 30, 120);
    expect(applied).toBe(true);
    expect(players[B]!.wardAbsorbUntilTick).toBe(Tick(131));
    expect(players[B]!.wardAbsorbRemaining).toBe(30);
    expect(players[B]!.wardAbsorbSourceId).toBe(A);
    expect(players[A]!.wardAbsorbUntilTick).toBeUndefined();
  });

  test("a non-ally target is a no-op", () => {
    const caster = mkWorldPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkWorldPlayer(C, 50, 0, { teamId: "t2" });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [C]: target };
    const applied = applyWardToAlly(caster, target, players, Tick(10));
    expect(applied).toBe(false);
    expect(players[C]!.wardAbsorbUntilTick).toBeUndefined();
  });

  test("a teamed caster CAN self-target (Self-Lattice's isAlly(a,a) shape)", () => {
    const caster = mkWorldPlayer(A, 0, 0, { teamId: "t1" });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster };
    const applied = applyWardToAlly(caster, caster, players, Tick(10), 20);
    expect(applied).toBe(true);
    expect(players[A]!.wardAbsorbRemaining).toBe(20);
  });

  test("a dead ally target is a no-op", () => {
    const caster = mkWorldPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkWorldPlayer(B, 50, 0, { teamId: "t1", alive: false, health: 0 });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [B]: target };
    const applied = applyWardToAlly(caster, target, players, Tick(10));
    expect(applied).toBe(false);
  });
});

describe("Syzygist Ward — integration (works on self AND an ally via isAlly, does nothing for a non-ally)", () => {
  test("a Ward cast on an ALLY absorbs a real incoming hit for that ally", () => {
    const attacker = mkWorldPlayer(PlayerId("atk"), 500, 300, {
      characterId: "balanced", aimX: 900, aimY: 300,
    });
    const warded = mkWorldPlayer(B, 560, 300, { teamId: "t1" });
    let state = mkWorldState([attacker, warded]);
    const runtime = createRuntime(flatMap);
    applyWardToAlly(
      mkWorldPlayer(A, 0, 0, { teamId: "t1" }),
      warded,
      state.players,
      state.tick,
      30,
      600,
    );
    expect(state.players[B]!.wardAbsorbRemaining).toBe(30);

    // Fire a shot from the attacker toward the warded ally.
    let res = stepWithRuntime(
      state, runtime,
      inputsWith([attacker, warded], {
        [PlayerId("atk") as string]: {
          seq: InputSeq(1), tick: Tick(1), keys: 1 << 6, aimX: 560, aimY: 300, dtMs: DT_MS,
        },
      }),
      DT_MS,
    );
    state = res.state;
    // Step forward until the shard lands or times out.
    for (let i = 0; i < 30 && state.players[B]!.wardAbsorbRemaining === 30; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([attacker, warded], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.wardAbsorbRemaining).toBeLessThan(30);
    expect(state.players[B]!.health).toBe(100); // fully absorbed (shot damage < 30)
    const wardEvent = res.events.find((e) => e.t === "syz-ward-absorbed");
    expect(wardEvent).toBeDefined();
    if (wardEvent && wardEvent.t === "syz-ward-absorbed") {
      expect(wardEvent.casterId).toBe(A);
    }
  });

  test("a Ward cast on SELF (Self-Lattice shape) absorbs a real incoming hit", () => {
    const attacker = mkWorldPlayer(PlayerId("atk"), 500, 300, {
      characterId: "balanced", aimX: 900, aimY: 300,
    });
    const self = mkWorldPlayer(B, 560, 300, { teamId: "t1" });
    let state = mkWorldState([attacker, self]);
    const runtime = createRuntime(flatMap);
    applyWardToAlly(self, self, state.players, state.tick, 20, 600);
    expect(state.players[B]!.wardAbsorbRemaining).toBe(20);

    let res = stepWithRuntime(
      state, runtime,
      inputsWith([attacker, self], {
        [PlayerId("atk") as string]: {
          seq: InputSeq(1), tick: Tick(1), keys: 1 << 6, aimX: 560, aimY: 300, dtMs: DT_MS,
        },
      }),
      DT_MS,
    );
    state = res.state;
    for (let i = 0; i < 30 && state.players[B]!.wardAbsorbRemaining === 20; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([attacker, self], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.wardAbsorbRemaining).toBeLessThan(20);
  });

  test("classId gating: a non-priest with wardAbsorbUntilTick/Remaining somehow set (shouldn't happen via draft) never mitigates via combat.ts's own gate", () => {
    const attacker = mkWorldPlayer(PlayerId("atk"), 500, 300, {
      characterId: "balanced", aimX: 900, aimY: 300,
    });
    const victim = mkWorldPlayer(B, 560, 300, {
      characterId: "heavy", // paladin, not priest
      wardAbsorbUntilTick: Tick(600),
      wardAbsorbRemaining: 30,
    });
    let state = mkWorldState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(
      state, runtime,
      inputsWith([attacker, victim], {
        [PlayerId("atk") as string]: {
          seq: InputSeq(1), tick: Tick(1), keys: 1 << 6, aimX: 560, aimY: 300, dtMs: DT_MS,
        },
      }),
      DT_MS,
    );
    state = res.state;
    for (let i = 0; i < 30 && state.players[B]!.health === 100; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([attacker, victim], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.health).toBeLessThan(100); // took full damage, un-warded
    expect(state.players[B]!.wardAbsorbRemaining).toBe(30); // untouched, never consumed
    expect(res.events.some((e) => e.t === "syz-ward-absorbed")).toBe(false);
  });

  test("expiry: a Ward window that lapses unspent is cleared by the per-tick expiry pass", () => {
    const caster = mkWorldPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkWorldPlayer(B, 400, 400, { teamId: "t1" });
    let state = mkWorldState([target]);
    const runtime = createRuntime(flatMap);
    applyWardToAlly(caster, target, state.players, state.tick, 30, 2); // closes in 2 ticks
    for (let i = 0; i < 10; i++) {
      const res = stepWithRuntime(state, runtime, inputsWith([target], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.wardAbsorbUntilTick).toBeUndefined();
    expect(state.players[B]!.wardAbsorbRemaining).toBeUndefined();
    expect(state.players[B]!.wardAbsorbSourceId).toBeUndefined();
  });
});
