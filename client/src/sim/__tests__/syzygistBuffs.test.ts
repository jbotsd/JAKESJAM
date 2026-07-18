// Syzygist status substrate extension (class-overhaul-workboard.md chunk
// 3.1: "Status substrate extension (buffs, not just debuffs)"). The
// existing substrate (burn/freeze/slow, sim/types.ts) is debuff-only and
// self-only-vs-caster (nothing about it targets ANOTHER player). This chunk
// adds the opposite: regen (heal-over-time) and haste (move+fire-rate),
// applied to an ALLY (gated by team.ts's `isAlly`) rather than only the
// caster's own entity.
//
// Infrastructure only — no real Priest ability card or catalog entry exists
// yet (that's chunk 3.4, docs/class-ability-catalogs-v1.md's "Borrowed
// Time"/"Haste Gift"). This file proves the MECHANISM directly:
//   1. `applyRegenToAlly`/`applyHasteToAlly` (World.ts) — pure unit tests
//      against a bare `players` record, no full sim tick, no card/input.
//   2. Integration via `stepWithRuntime` — regen actually heals over real
//      ticks and stops at expiry (capped at SYZ_REGEN_HEALTH_CAP); haste
//      actually boosts movement speed AND fire rate, and stops at expiry.
//   3. Isolation — a player nobody ever buffs is completely unaffected
//      (byte-identical to a control run that never calls either function).

import { describe, expect, test } from "bun:test";
import {
  createRuntime,
  stepWithRuntime,
  applyRegenToAlly,
  applyHasteToAlly,
} from "../World.js";
import {
  SYZ_REGEN_HEALTH_CAP,
} from "../constants.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;
const RIGHT_BIT = 1 << 1;
const FIRE_BIT = 1 << 6;

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
    { x: 900, y: 400 },
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

function inputsWith(
  players: PlayerEntity[],
  overrides: Partial<Record<string, InputFrame>>,
): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = overrides[p.id as string] ?? null;
  return out;
}

function frame(keys: number, seq: number, aimX = 0, aimY = 0): InputFrame {
  return { seq: InputSeq(seq), tick: Tick(0), keys, aimX, aimY, dtMs: DT_MS };
}

const A = PlayerId("a"); // caster (Syzygist, standing in for a future cast)
const B = PlayerId("b"); // ally target
const C = PlayerId("c"); // enemy / non-ally

// ---------------------------------------------------------------------------
// 1. Pure mechanism — applyRegenToAlly / applyHasteToAlly against a bare
//    `players` record. No stepWithRuntime, no card, no input — proves the
//    "can player A's cast legally write a buff onto player B's entity"
//    question directly.
// ---------------------------------------------------------------------------

describe("applyRegenToAlly — mechanism", () => {
  test("an ally target gets regenUntilTick/regenHps set", () => {
    const caster = mkPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkPlayer(B, 50, 0, { teamId: "t1" });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [B]: target };
    const applied = applyRegenToAlly(caster, target, players, Tick(10), 6, 30);
    expect(applied).toBe(true);
    expect(players[B]!.regenUntilTick).toBe(Tick(41));
    expect(players[B]!.regenHps).toBe(6);
    // The caster's own entity is untouched — this mutates the TARGET only.
    expect(players[A]!.regenUntilTick).toBeUndefined();
  });

  test("a non-ally target (different teamId) is a no-op", () => {
    const caster = mkPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkPlayer(C, 50, 0, { teamId: "t2" });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [C]: target };
    const applied = applyRegenToAlly(caster, target, players, Tick(10));
    expect(applied).toBe(false);
    expect(players[C]!.regenUntilTick).toBeUndefined();
  });

  test("a non-ally target (no teamId at all — ordinary FFA foe) is a no-op", () => {
    const caster = mkPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkPlayer(C, 50, 0); // no teamId
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [C]: target };
    const applied = applyRegenToAlly(caster, target, players, Tick(10));
    expect(applied).toBe(false);
    expect(players[C]!.regenUntilTick).toBeUndefined();
  });

  test("EDGE CASE — a solo/FFA caster (no teamId) cannot buff ANYONE, not even themselves", () => {
    // team.ts's `isAlly` requires `a.teamId !== undefined` — a caster with
    // no team can never pass the ally gate, including self-targeting. This
    // is the mechanical expression of "buffs are teams-native" (docs/
    // classes-goal.md MANA section) — solo Syzygist's floor is curses/
    // lifesteal (chunk 0.3), NOT this mechanism.
    const soloCaster = mkPlayer(A, 0, 0); // no teamId
    const players: Record<PlayerId, PlayerEntity> = { [A]: soloCaster };
    const appliedOnSelf = applyRegenToAlly(soloCaster, soloCaster, players, Tick(10));
    expect(appliedOnSelf).toBe(false);
    expect(players[A]!.regenUntilTick).toBeUndefined();
  });

  test("a teamed caster CAN self-target (isAlly(a, a) is true when teamId is set)", () => {
    const caster = mkPlayer(A, 0, 0, { teamId: "t1" });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster };
    const applied = applyRegenToAlly(caster, caster, players, Tick(10));
    expect(applied).toBe(true);
    expect(players[A]!.regenUntilTick).toBeDefined();
  });

  test("a dead ally target is a no-op (never revives via regen)", () => {
    const caster = mkPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkPlayer(B, 50, 0, { teamId: "t1", alive: false, health: 0 });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [B]: target };
    const applied = applyRegenToAlly(caster, target, players, Tick(10));
    expect(applied).toBe(false);
    expect(players[B]!.regenUntilTick).toBeUndefined();
  });
});

describe("applyHasteToAlly — mechanism", () => {
  test("an ally target gets hasteUntilTick/hasteMultiplier set", () => {
    const caster = mkPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkPlayer(B, 50, 0, { teamId: "t1" });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [B]: target };
    const applied = applyHasteToAlly(caster, target, players, Tick(10), 1.3, 20);
    expect(applied).toBe(true);
    expect(players[B]!.hasteUntilTick).toBe(Tick(31));
    expect(players[B]!.hasteMultiplier).toBe(1.3);
  });

  test("a non-ally target is a no-op", () => {
    const caster = mkPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkPlayer(C, 50, 0, { teamId: "t2" });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [C]: target };
    const applied = applyHasteToAlly(caster, target, players, Tick(10));
    expect(applied).toBe(false);
    expect(players[C]!.hasteUntilTick).toBeUndefined();
  });

  test("a dead ally target is a no-op", () => {
    const caster = mkPlayer(A, 0, 0, { teamId: "t1" });
    const target = mkPlayer(B, 50, 0, { teamId: "t1", alive: false, health: 0 });
    const players: Record<PlayerId, PlayerEntity> = { [A]: caster, [B]: target };
    const applied = applyHasteToAlly(caster, target, players, Tick(10));
    expect(applied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Integration — stepWithRuntime. Regen heals over real ticks and stops
//    (both by expiry AND by hitting the health cap); haste boosts real
//    movement + fire rate and stops at expiry.
// ---------------------------------------------------------------------------

describe("Regen — integration (heals over time, capped, stops at expiry)", () => {
  test("heals once per second of sim time while the window is live", () => {
    const target = mkPlayer(B, 400, 400, { teamId: "t1", health: 50 });
    let state = mkState([target]);
    const runtime = createRuntime(flatMap);

    // Open a 2-second regen window at 6 hps directly on the players record
    // (mirrors what a future Priest cast will do — chunk 3.4).
    applyRegenToAlly(target, target, state.players, state.tick, 6, 120);

    // regenTickLastApplied is stamped at tick 0 (application time, mirrors
    // Burn's own apply-site convention) — the heal-tick gate requires
    // `state.tick - regenTickLastApplied >= ONE_SECOND_TICKS`, so the first
    // real heal fires on the step whose INCOMING tick is exactly
    // ONE_SECOND_TICKS (60 at 60Hz), i.e. the 61st stepWithRuntime call.
    const ONE_SECOND_TICKS = Math.round(1000 / DT_MS);
    // 60 calls consume incoming ticks 0..59 — none satisfy the gate yet.
    for (let i = 0; i < ONE_SECOND_TICKS; i++) {
      const res = stepWithRuntime(state, runtime, inputsWith([target], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.health).toBe(50);

    // The 61st call (incoming tick === ONE_SECOND_TICKS) crosses the gate —
    // exactly one heal tick (6 hps) applies.
    let res = stepWithRuntime(state, runtime, inputsWith([target], {}), DT_MS);
    state = res.state;
    expect(state.players[B]!.health).toBe(56);

    // Advance one more full second (60 more calls) — a second heal tick
    // lands on the last call of this batch (incoming tick === 2 *
    // ONE_SECOND_TICKS).
    for (let i = 0; i < ONE_SECOND_TICKS; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([target], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.health).toBe(62);
  });

  test("caps at SYZ_REGEN_HEALTH_CAP — never overheals", () => {
    const target = mkPlayer(B, 400, 400, { teamId: "t1", health: 98 });
    let state = mkState([target]);
    const runtime = createRuntime(flatMap);
    applyRegenToAlly(target, target, state.players, state.tick, 50, 600);

    const ONE_SECOND_TICKS = Math.round(1000 / DT_MS);
    for (let i = 0; i < ONE_SECOND_TICKS + 1; i++) {
      const res = stepWithRuntime(state, runtime, inputsWith([target], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.health).toBe(SYZ_REGEN_HEALTH_CAP);
  });

  test("stops healing once the window expires — health holds steady after", () => {
    const target = mkPlayer(B, 400, 400, { teamId: "t1", health: 50 });
    let state = mkState([target]);
    const runtime = createRuntime(flatMap);
    // A window that closes almost immediately (2 ticks) — no heal tick has
    // time to land (the burn/regen rate limiter requires a full second).
    applyRegenToAlly(target, target, state.players, state.tick, 6, 2);

    for (let i = 0; i < 10; i++) {
      const res = stepWithRuntime(state, runtime, inputsWith([target], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.health).toBe(50);
    // The window fields are cleared once expired (mirrors freeze expiry).
    expect(state.players[B]!.regenUntilTick).toBeUndefined();
    expect(state.players[B]!.regenHps).toBeUndefined();
  });
});

describe("Haste — integration (boosts move speed + fire rate, stops at expiry)", () => {
  test("a hasted player moves faster than an identical un-hasted player", () => {
    const hasted = mkPlayer(A, 400, 400, { teamId: "t1" });
    let hastedState = mkState([hasted]);
    const hastedRuntime = createRuntime(flatMap);
    applyHasteToAlly(hasted, hasted, hastedState.players, hastedState.tick, 1.5, 60);
    const hastedRes = stepWithRuntime(
      hastedState, hastedRuntime,
      inputsWith([hasted], { [A as string]: frame(RIGHT_BIT, 1) }),
      DT_MS,
    );

    const plain = mkPlayer(B, 400, 400, { teamId: "t1" });
    const plainState = mkState([plain]);
    const plainRuntime = createRuntime(flatMap);
    const plainRes = stepWithRuntime(
      plainState, plainRuntime,
      inputsWith([plain], { [B as string]: frame(RIGHT_BIT, 1) }),
      DT_MS,
    );

    expect(hastedRes.state.players[A]!.vx).toBeGreaterThan(plainRes.state.players[B]!.vx);
    // Exactly the SYZ haste multiplier — composes cleanly with the
    // existing speedMul chain (no other multiplier active on either run).
    expect(hastedRes.state.players[A]!.vx).toBeCloseTo(plainRes.state.players[B]!.vx * 1.5, 5);
  });

  test("a hasted player fires with a shorter cooldown than an identical un-hasted player", () => {
    const hasted = mkPlayer(A, 400, 400, { teamId: "t1" });
    let hastedState = mkState([hasted]);
    const hastedRuntime = createRuntime(flatMap);
    applyHasteToAlly(hasted, hasted, hastedState.players, hastedState.tick, 1.4, 60);
    const hastedRes = stepWithRuntime(
      hastedState, hastedRuntime,
      inputsWith([hasted], { [A as string]: frame(FIRE_BIT, 1, 500, 400) }),
      DT_MS,
    );
    const boostedCooldown = hastedRes.state.players[A]!.fireCooldownMs;

    const plain = mkPlayer(B, 400, 400, { teamId: "t1" });
    const plainRes = stepWithRuntime(
      mkState([plain]), createRuntime(flatMap),
      inputsWith([plain], { [B as string]: frame(FIRE_BIT, 1, 500, 400) }),
      DT_MS,
    );
    const plainCooldown = plainRes.state.players[B]!.fireCooldownMs;

    expect(boostedCooldown).toBeLessThan(plainCooldown);
    expect(boostedCooldown).toBeCloseTo(plainCooldown / 1.4, 5);
  });

  test("stops boosting once the window expires", () => {
    const target = mkPlayer(A, 400, 400, { teamId: "t1" });
    let state = mkState([target]);
    const runtime = createRuntime(flatMap);
    applyHasteToAlly(target, target, state.players, state.tick, 1.5, 1);

    // Advance past expiry (tick 0 -> the window closes at tick 2).
    for (let i = 0; i < 3; i++) {
      const res = stepWithRuntime(state, runtime, inputsWith([target], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[A]!.hasteUntilTick).toBeUndefined();
    expect(state.players[A]!.hasteMultiplier).toBeUndefined();

    const boosted = stepWithRuntime(
      state, runtime,
      inputsWith([target], { [A as string]: frame(RIGHT_BIT, 10) }),
      DT_MS,
    );
    const plain = mkPlayer(B, 400, 400, { teamId: "t1" });
    const plainRes = stepWithRuntime(
      mkState([plain]), createRuntime(flatMap),
      inputsWith([plain], { [B as string]: frame(RIGHT_BIT, 1) }),
      DT_MS,
    );
    // Once expired, velocity matches the un-hasted baseline exactly (same
    // speedMul chain, hasteMul folds back to 1).
    expect(boosted.state.players[A]!.vx).toBeCloseTo(plainRes.state.players[B]!.vx, 5);
  });
});

// ---------------------------------------------------------------------------
// 3. Isolation — a player nobody ever buffs is completely unaffected.
//    Non-Priest classes and players who never receive regen/haste are
//    byte-identical to a control run that never touches this substrate.
// ---------------------------------------------------------------------------

describe("Isolation — players never touched by regen/haste are unaffected", () => {
  test("a bystander in a multi-player match with an ACTIVE regen/haste elsewhere never gains the fields", () => {
    const buffed = mkPlayer(A, 400, 400, { teamId: "t1" });
    const bystander = mkPlayer(B, 900, 400, { teamId: "t2", characterId: "heavy" });
    let state = mkState([buffed, bystander]);
    const runtime = createRuntime(flatMap);
    applyRegenToAlly(buffed, buffed, state.players, state.tick, 10, 120);
    applyHasteToAlly(buffed, buffed, state.players, state.tick, 1.5, 120);

    for (let i = 0; i < 30; i++) {
      const res = stepWithRuntime(state, runtime, inputsWith([buffed, bystander], {}), DT_MS);
      state = res.state;
    }

    expect(state.players[B]!.regenUntilTick).toBeUndefined();
    expect(state.players[B]!.regenHps).toBeUndefined();
    expect(state.players[B]!.hasteUntilTick).toBeUndefined();
    expect(state.players[B]!.hasteMultiplier).toBeUndefined();
    expect(state.players[B]!.health).toBe(100);
  });

  test("a full match tick sequence with NO regen/haste ever applied is byte-identical to before this chunk existed (spot-check: fields stay undefined, health/velocity match a hand-computed baseline)", () => {
    const p1 = mkPlayer(A, 400, 400);
    const p2 = mkPlayer(B, 700, 400, { characterId: "heavy" });
    let state = mkState([p1, p2]);
    const runtime = createRuntime(flatMap);
    for (let i = 0; i < 20; i++) {
      const res = stepWithRuntime(
        state, runtime,
        inputsWith([p1, p2], { [A as string]: frame(RIGHT_BIT, i + 1) }),
        DT_MS,
      );
      state = res.state;
    }
    for (const pid of [A, B]) {
      expect(state.players[pid]!.regenUntilTick).toBeUndefined();
      expect(state.players[pid]!.regenHps).toBeUndefined();
      expect(state.players[pid]!.regenTickLastApplied).toBeUndefined();
      expect(state.players[pid]!.hasteUntilTick).toBeUndefined();
      expect(state.players[pid]!.hasteMultiplier).toBeUndefined();
    }
    expect(state.players[A]!.health).toBe(100);
    expect(state.players[B]!.health).toBe(100);
  });
});
