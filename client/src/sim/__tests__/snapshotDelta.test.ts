// Tests for the delta snapshot codec (encodeDelta / applyDelta).
// These live alongside the sim tests for discoverability, but the module
// itself is in src/net/ — a wire/net concern that never imports the sim.

import { describe, test, expect } from "bun:test";
import { encodeDelta, applyDelta } from "../../net/snapshotDelta.js";
import { World, STEP_MS, SNAPSHOT_INTERVAL_TICKS } from "../index.js";
import type { WorldState, PlayerEntity, ProjectileEntity, PlayerSpawnInfo } from "../types.js";
import { EntityId, PlayerId, Tick, InputSeq } from "../types.js";
import { boxworksWorld } from "../data/boxworks.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePlayer(overrides: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: PlayerId("p1"),
    characterId: "balanced",
    x: 100,
    y: 200,
    vx: 0,
    vy: 0,
    aimX: 150,
    aimY: 200,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "pistol",
    cards: [],
    fireCooldownMs: 0,
    ammo: 10,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(1),
    ...overrides,
  };
}

function makeProjectile(overrides: Partial<ProjectileEntity> = {}): ProjectileEntity {
  return {
    id: EntityId(1),
    ownerId: PlayerId("p1"),
    x: 50,
    y: 100,
    vx: 300,
    vy: 0,
    shape: "circle",
    radius: 4,
    damage: 10,
    lifetimeMs: 2000,
    pathing: "straight",
    element: "neutral",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    ...overrides,
  };
}

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    tick: Tick(1),
    rngState: 42,
    players: {},
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 0,
      winnerPlayerId: null,
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("snapshotDelta", () => {
  describe("encodeDelta / applyDelta round-trip", () => {
    test("identical states produce empty entity deltas", () => {
      const pid = PlayerId("p1");
      const state = makeWorld({ players: { [pid]: makePlayer() }, tick: Tick(10) });
      const delta = encodeDelta(state, state);

      expect(Object.keys(delta.players.added)).toHaveLength(0);
      expect(Object.keys(delta.players.updated)).toHaveLength(0);
      expect(delta.players.removed).toHaveLength(0);

      const reconstructed = applyDelta(state, delta);
      expect(reconstructed.tick).toBe(Tick(10));
      expect(reconstructed.players[pid]?.x).toBe(state.players[pid]!.x);
    });

    test("changed player fields appear in updated, unchanged fields absent", () => {
      const pid = PlayerId("p1");
      const prev = makeWorld({ players: { [pid]: makePlayer({ x: 100, y: 200 }) }, tick: Tick(1) });
      const next = makeWorld({ players: { [pid]: makePlayer({ x: 110, y: 200 }) }, tick: Tick(2) });

      const delta = encodeDelta(prev, next);
      const upd = delta.players.updated[pid];
      expect(upd).toBeDefined();
      // x changed
      expect((upd as { x?: number }).x).toBe(110);
      // y unchanged — should NOT be in the patch (bitsLo bit 1 not set)
      // We can't easily inspect bitsLo from outside, but we can verify applyDelta
      // gives the right answer.
      const result = applyDelta(prev, delta);
      expect(result.players[pid]?.x).toBe(110);
      expect(result.players[pid]?.y).toBe(200);
    });

    test("applyDelta reconstructs full state equal to next for a two-player scenario", () => {
      const p1 = PlayerId("p1");
      const p2 = PlayerId("p2");
      const eid = EntityId(99);

      const prev = makeWorld({
        tick: Tick(5),
        players: {
          [p1]: makePlayer({ id: p1, x: 100 }),
          [p2]: makePlayer({ id: p2, x: 400 }),
        },
        projectiles: {
          [eid]: makeProjectile({ id: eid, x: 50 }),
        },
      });

      const next: WorldState = {
        ...prev,
        tick: Tick(6),
        rngState: 99,
        players: {
          [p1]: { ...prev.players[p1]!, x: 102, vy: -5, health: 90 },
          [p2]: { ...prev.players[p2]!, aimX: 450, fireCooldownMs: 100 },
        },
        projectiles: {
          [eid]: { ...prev.projectiles[eid]!, x: 55, ageMs: 16 },
        },
      };

      const delta = encodeDelta(prev, next);
      const result = applyDelta(prev, delta);

      expect(result.tick).toBe(Tick(6));
      expect(result.rngState).toBe(99);
      expect(result.players[p1]?.x).toBe(102);
      expect(result.players[p1]?.vy).toBe(-5);
      expect(result.players[p1]?.health).toBe(90);
      expect(result.players[p1]?.y).toBe(prev.players[p1]!.y); // unchanged
      expect(result.players[p2]?.aimX).toBe(450);
      expect(result.players[p2]?.fireCooldownMs).toBe(100);
      expect(result.players[p2]?.x).toBe(400); // unchanged
      expect(result.projectiles[eid]?.x).toBe(55);
      expect(result.projectiles[eid]?.ageMs).toBe(16);
    });
  });

  describe("tombstones (removed entities)", () => {
    test("removed player ids appear in removed array and are absent from result", () => {
      const p1 = PlayerId("p1");
      const p2 = PlayerId("p2");

      const prev = makeWorld({
        players: {
          [p1]: makePlayer({ id: p1 }),
          [p2]: makePlayer({ id: p2, x: 300 }),
        },
      });
      // p2 leaves the match
      const next = makeWorld({ players: { [p1]: prev.players[p1]! } });

      const delta = encodeDelta(prev, next);
      expect(delta.players.removed).toContain(p2);

      const result = applyDelta(prev, delta);
      expect(result.players[p2]).toBeUndefined();
      expect(result.players[p1]).toBeDefined();
    });

    test("removed projectile ids appear in removed array and are absent from result", () => {
      const eid = EntityId(7);
      const prev = makeWorld({ projectiles: { [eid]: makeProjectile({ id: eid }) } });
      const next = makeWorld({ projectiles: {} });

      const delta = encodeDelta(prev, next);
      // Object.keys widens branded EntityId back to string; the wire stores
       // the stringified id. Test for both shapes since downstream may number-cast.
       expect(
         delta.projectiles.removed.some(
           (id) => id === eid || String(id) === String(eid),
         ),
       ).toBe(true);

      const result = applyDelta(prev, delta);
      expect(result.projectiles[eid]).toBeUndefined();
    });
  });

  describe("added entities", () => {
    test("new player id appears in added with full state", () => {
      const p1 = PlayerId("p1");
      const p2 = PlayerId("p2");

      const prev = makeWorld({ players: { [p1]: makePlayer({ id: p1 }) } });
      const next = makeWorld({
        players: {
          [p1]: prev.players[p1]!,
          [p2]: makePlayer({ id: p2, x: 500, y: 300 }),
        },
      });

      const delta = encodeDelta(prev, next);
      expect(delta.players.added[p2]).toBeDefined();
      expect(delta.players.added[p2]?.x).toBe(500);

      const result = applyDelta(prev, delta);
      expect(result.players[p2]?.x).toBe(500);
      expect(result.players[p2]?.y).toBe(300);
    });

    test("new projectile id appears in added with full state", () => {
      const eid = EntityId(42);
      const prev = makeWorld({ projectiles: {} });
      const next = makeWorld({
        projectiles: { [eid]: makeProjectile({ id: eid, x: 200, vy: -50 }) },
      });

      const delta = encodeDelta(prev, next);
      expect(delta.projectiles.added[eid]).toBeDefined();

      const result = applyDelta(prev, delta);
      expect(result.projectiles[eid]?.x).toBe(200);
      expect(result.projectiles[eid]?.vy).toBe(-50);
    });
  });

  describe("round / scalar fields always present", () => {
    test("tick, rngState, and round are present even when no entities changed", () => {
      const state = makeWorld({ tick: Tick(50), rngState: 12345 });
      const nextState = makeWorld({ tick: Tick(51), rngState: 12346 });
      const delta = encodeDelta(state, nextState);

      expect(delta.tick).toBe(51);
      expect(delta.rngState).toBe(12346);
      expect(delta.round).toEqual(nextState.round);
    });
  });

  describe("optional player fields (status effects)", () => {
    test("setting a buff on one player round-trips cleanly", () => {
      const p1 = PlayerId("p1");
      const prev = makeWorld({ players: { [p1]: makePlayer({ id: p1 }) } });
      const next = makeWorld({
        players: {
          [p1]: {
            ...prev.players[p1]!,
            overchargeUntilTick: Tick(200),
            slowedUntilTick: Tick(150),
            slowMultiplier: 0.5,
          },
        },
      });

      const delta = encodeDelta(prev, next);
      const result = applyDelta(prev, delta);

      expect(result.players[p1]?.overchargeUntilTick).toBe(Tick(200));
      expect(result.players[p1]?.slowedUntilTick).toBe(Tick(150));
      expect(result.players[p1]?.slowMultiplier).toBe(0.5);
    });

    test("six-axes fields round-trip (ward shell, slot cooldowns, tithe window)", () => {
      // Additive-contract proof (six-axes-goal.md acceptance B2): the new
      // Layer 1/2 player fields ride the P_HI tail like every buff tick —
      // present when changed, absent otherwise, no wire format change.
      const p1 = PlayerId("p1");
      const prev = makeWorld({ players: { [p1]: makePlayer({ id: p1 }) } });
      const next = makeWorld({
        players: {
          [p1]: {
            ...prev.players[p1]!,
            wardShellUntilTick: Tick(90),
            slot1CooldownUntilTick: Tick(700),
            slot3CooldownUntilTick: Tick(950),
            titheUntilTick: Tick(240),
          },
        },
      });

      const delta = encodeDelta(prev, next);
      const result = applyDelta(prev, delta);

      expect(result.players[p1]?.wardShellUntilTick).toBe(Tick(90));
      expect(result.players[p1]?.slot1CooldownUntilTick).toBe(Tick(700));
      expect(result.players[p1]?.slot2CooldownUntilTick).toBeUndefined();
      expect(result.players[p1]?.slot3CooldownUntilTick).toBe(Tick(950));
      expect(result.players[p1]?.titheUntilTick).toBe(Tick(240));
      // And an old-shape state (fields absent) still decodes untouched.
      const noop = encodeDelta(prev, prev);
      const same = applyDelta(prev, noop);
      expect(same.players[p1]?.wardShellUntilTick).toBeUndefined();
      expect(same.players[p1]?.titheUntilTick).toBeUndefined();
    });

    test("grounded flag transition round-trips (false → true)", () => {
      const p1 = PlayerId("p1");
      const basePlayer = makePlayer({ id: p1, grounded: false });
      const prev = makeWorld({ players: { [p1]: basePlayer } });
      const next = makeWorld({
        players: { [p1]: { ...basePlayer, grounded: true } },
      });
      const delta = encodeDelta(prev, next);
      const result = applyDelta(prev, delta);
      expect(result.players[p1]?.grounded).toBe(true);
    });

    test("grounded flag transition round-trips (true → false)", () => {
      const p1 = PlayerId("p1");
      const basePlayer = makePlayer({ id: p1, grounded: true });
      const prev = makeWorld({ players: { [p1]: basePlayer } });
      const next = makeWorld({
        players: { [p1]: { ...basePlayer, grounded: false } },
      });
      const delta = encodeDelta(prev, next);
      const result = applyDelta(prev, delta);
      expect(result.players[p1]?.grounded).toBe(false);
    });

    test("touchingWallDir transition round-trips (0 → -1 → +1 → 0)", () => {
      const p1 = PlayerId("p1");
      const base = makePlayer({ id: p1, touchingWallDir: 0 });
      const prev0 = makeWorld({ players: { [p1]: base } });

      const negWorld = makeWorld({ players: { [p1]: { ...base, touchingWallDir: -1 } } });
      const negDelta = encodeDelta(prev0, negWorld);
      const negResult = applyDelta(prev0, negDelta);
      expect(negResult.players[p1]?.touchingWallDir).toBe(-1);

      const posWorld = makeWorld({ players: { [p1]: { ...base, touchingWallDir: 1 } } });
      const posDelta = encodeDelta(negWorld, posWorld);
      const posResult = applyDelta(negResult, posDelta);
      expect(posResult.players[p1]?.touchingWallDir).toBe(1);

      const zeroWorld = makeWorld({ players: { [p1]: { ...base, touchingWallDir: 0 } } });
      const zeroDelta = encodeDelta(posWorld, zeroWorld);
      const zeroResult = applyDelta(posResult, zeroDelta);
      expect(zeroResult.players[p1]?.touchingWallDir).toBe(0);
    });

    test("dashing flag transition round-trips (false → true)", () => {
      const p1 = PlayerId("p1");
      const basePlayer = makePlayer({ id: p1, dashing: false });
      const prev = makeWorld({ players: { [p1]: basePlayer } });
      const next = makeWorld({
        players: { [p1]: { ...basePlayer, dashing: true } },
      });
      const delta = encodeDelta(prev, next);
      const result = applyDelta(prev, delta);
      expect(result.players[p1]?.dashing).toBe(true);
    });

    test("dashing flag transition round-trips (true → false)", () => {
      const p1 = PlayerId("p1");
      const basePlayer = makePlayer({ id: p1, dashing: true });
      const prev = makeWorld({ players: { [p1]: basePlayer } });
      const next = makeWorld({
        players: { [p1]: { ...basePlayer, dashing: false } },
      });
      const delta = encodeDelta(prev, next);
      const result = applyDelta(prev, delta);
      expect(result.players[p1]?.dashing).toBe(false);
    });

    test("clearing a buff (undefined) round-trips cleanly", () => {
      const p1 = PlayerId("p1");
      const basePlayer = makePlayer({
        id: p1,
        overchargeUntilTick: Tick(200),
        slowedUntilTick: Tick(150),
      });
      const prev = makeWorld({ players: { [p1]: basePlayer } });
      const next = makeWorld({
        players: {
          [p1]: { ...basePlayer, overchargeUntilTick: undefined, slowedUntilTick: undefined },
        },
      });

      const delta = encodeDelta(prev, next);
      const result = applyDelta(prev, delta);

      expect(result.players[p1]?.overchargeUntilTick).toBeUndefined();
      expect(result.players[p1]?.slowedUntilTick).toBeUndefined();
    });
  });

  describe("size measurement (JSON proxy)", () => {
    test("2-player Boxworks: idle and active scenarios", () => {
      const players: PlayerSpawnInfo[] = [
        { playerId: PlayerId("p1"), characterId: "balanced", name: "Alice", color: "#f00", weaponId: "pistol" },
        { playerId: PlayerId("p2"), characterId: "heavy", name: "Bob", color: "#00f", weaponId: "shotgun" },
      ];
      let state = World.create(boxworksWorld as any, players, 12345, []);
      for (let i = 0; i < 200; i++) { state = World.step(state, {}, STEP_MS).state; }

      const baseline = state;
      for (let i = 0; i < SNAPSHOT_INTERVAL_TICKS; i++) { state = World.step(state, {}, STEP_MS).state; }
      const next = state;

      const fullMsg = { t: "snap", tick: next.tick, lastProcessedInputSeq: {}, baseline: null, state: next, events: [] };
      const delta = encodeDelta(baseline, next);
      const deltaMsg = { t: "snap", tick: next.tick, lastProcessedInputSeq: {}, baseline: baseline.tick, delta, events: [] };

      const fLen = JSON.stringify(fullMsg).length;
      const dLen = JSON.stringify(deltaMsg).length;
      console.log(`\nIdle JSON Full=${fLen}ch Delta=${dLen}ch ${((1 - dLen / fLen) * 100).toFixed(1)}% reduction (${(fLen / dLen).toFixed(1)}x)`);

      const FIRE_BIT = 1 << 6;
      let s2 = next;
      for (let i = 0; i < SNAPSHOT_INTERVAL_TICKS; i++) {
        const inp: Record<string, { seq: number; tick: number; keys: number; aimX: number; aimY: number; dtMs: number }> = {
          [PlayerId("p1")]: { seq: i + 1, tick: s2.tick, keys: (1 << 1) | FIRE_BIT, aimX: 500, aimY: 300, dtMs: STEP_MS },
          [PlayerId("p2")]: { seq: i + 1, tick: s2.tick, keys: (1 << 0) | FIRE_BIT, aimX: 100, aimY: 300, dtMs: STEP_MS },
        };
        s2 = World.step(s2, inp as any, STEP_MS).state;
      }
      const aF = JSON.stringify({ t: "snap", tick: s2.tick, lastProcessedInputSeq: {}, baseline: null, state: s2, events: [] }).length;
      const ad = encodeDelta(next, s2);
      const aD = JSON.stringify({ t: "snap", tick: s2.tick, lastProcessedInputSeq: {}, baseline: next.tick, delta: ad, events: [] }).length;
      console.log(`Active JSON Full=${aF}ch Delta=${aD}ch ${((1 - aD / aF) * 100).toFixed(1)}% reduction (${(aF / aD).toFixed(1)}x)\n`);

      // Delta should always be smaller than full
      expect(dLen).toBeLessThan(fLen);
      expect(aD).toBeLessThan(aF);
    });
  });
});
