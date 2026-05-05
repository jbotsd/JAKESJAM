// G2 round-trip gate — pack(state) → bytes → unpack(bytes) →
// state' must reproduce the input. Asserts byte-level layout
// alignment with the Zig extern struct (G1b/G1c) AND
// behaviour-equivalence at the TS edge.
//
// We don't compare full TS WorldState equality because the bridge
// drops fields the wasm side doesn't yet own (round.scores,
// round.draftingOffers, chaosModifierIds, weapon-build cards by
// content). Those land in follow-on cuts.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";
import {
  packWorldState,
  unpackWorldState,
  WORLD_STATE_TOTAL_SIZE,
} from "../worldStateBridge";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type DestructibleEntity,
  type FireEntity,
  type PickupEntity,
  type PlayerEntity,
  type ProjectileEntity,
  type SatelliteEntity,
  type WorldState,
} from "../../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);

type SizeofExports = {
  sizeof_world_state: () => number;
};
const ex = sim.exports as unknown as SizeofExports;

function makeFixtureState(): WorldState {
  const player1: PlayerEntity = {
    id: PlayerId("p_alpha"),
    characterId: "balanced",
    x: 100.5,
    y: 200.25,
    vx: 1.5,
    vy: -2.25,
    aimX: 300,
    aimY: 150,
    health: 88,
    shieldActive: true,
    crouching: false,
    alive: true,
    weaponId: "scrap-rifle",
    cards: ["overcharge", "burn-rounds"],
    fireCooldownMs: 120.5,
    ammo: 24,
    abilityCharge: 0.6,
    lastProcessedInputSeq: InputSeq(42),
    grounded: true,
    burnUntilTick: Tick(180),
    burnDps: 12,
    burnTickLastApplied: Tick(170),
    jetpackFuel: 0.75,
    shieldCharge: 50,
    shieldMaxCharge: 100,
    overchargeUntilTick: Tick(240),
  };
  const player2: PlayerEntity = {
    id: PlayerId("p_bravo"),
    characterId: "heavy",
    x: -50,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 0,
    health: 100,
    shieldActive: false,
    crouching: true,
    alive: true,
    weaponId: "heavy-launcher",
    cards: [],
    fireCooldownMs: 0,
    ammo: 8,
    abilityCharge: 0,
    lastProcessedInputSeq: InputSeq(7),
  };

  const projectile1: ProjectileEntity = {
    id: EntityId(1001),
    ownerId: PlayerId("p_alpha"),
    x: 110,
    y: 195,
    vx: 12.5,
    vy: 0,
    shape: "circle",
    radius: 6,
    damage: 18,
    lifetimeMs: 1500,
    pathing: "straight",
    element: "fire",
    bouncesRemaining: 0,
    pierceRemaining: 0,
    impact: "explosive",
    impactRadiusPx: 64,
    ageMs: 80,
    traveledPx: 96,
    originX: 100,
    originY: 195,
  };
  const projectile2: ProjectileEntity = {
    id: EntityId(1002),
    ownerId: null, // orphan
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    shape: "x",
    radius: 8,
    damage: 25,
    lifetimeMs: 800,
    pathing: "boomerang",
    element: "ice",
    bouncesRemaining: 2,
    pierceRemaining: 1,
    splitCount: 3,
    homingStrength: 4.5,
    returning: true,
    stickyFuseMs: 250,
  };

  const sat1: SatelliteEntity = {
    id: EntityId(2001),
    ownerId: PlayerId("p_alpha"),
    angle: Math.PI / 4,
    orbitRadius: 80,
    fireCooldownMs: 600,
    lifetimeMs: 9999,
  };

  const dest1: DestructibleEntity = {
    id: EntityId(3001),
    kind: "barrel",
    x: 250,
    y: 100,
    width: 32,
    height: 32,
    health: 100,
    explosive: true,
    flammable: false,
  };

  const fire1: FireEntity = {
    id: EntityId(4001),
    x: 320,
    y: 380,
    radius: 24,
    remainingMs: 2200,
    ownerId: PlayerId("p_bravo"),
    damagePerSecond: 8,
  };

  const pickup1: PickupEntity = {
    id: EntityId(5001),
    kind: "health-shard",
    x: 0,
    y: -100,
    radius: 12,
    amount: 25,
    active: true,
    respawnAtTick: Tick(0),
  };
  const pickup2: PickupEntity = {
    id: EntityId(5002),
    kind: "overcharge-core",
    x: 50,
    y: -100,
    radius: 12,
    amount: 1,
    active: false,
    respawnAtTick: Tick(720),
    durationMs: 5000,
    respawnMs: 12000,
  };

  return {
    tick: Tick(123),
    rngState: 0xdeadbeef,
    players: {
      [player1.id]: player1,
      [player2.id]: player2,
    },
    projectiles: {
      [projectile1.id]: projectile1,
      [projectile2.id]: projectile2,
    },
    satellites: {
      [sat1.id]: sat1,
    },
    destructibles: {
      [dest1.id]: dest1,
    },
    firePatches: {
      [fire1.id]: fire1,
    },
    pickups: {
      [pickup1.id]: pickup1,
      [pickup2.id]: pickup2,
    },
    round: {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 1,
      winnerPlayerId: null,
    },
    fireHazardTimerMs: 250,
  };
}

describe("worldStateBridge — pack/unpack round-trip (Phase G2)", () => {
  test("packed buffer matches sizeof_world_state from wasm", () => {
    expect(WORLD_STATE_TOTAL_SIZE).toBe(ex.sizeof_world_state());
  });

  test("round-trip preserves all sim-relevant fields", () => {
    const state = makeFixtureState();
    const buf = packWorldState(state);
    expect(buf.byteLength).toBe(WORLD_STATE_TOTAL_SIZE);

    const back = unpackWorldState(buf);

    expect(back.tick).toBe(state.tick);
    expect(back.rngState).toBe(state.rngState);
    expect(back.round.phase).toBe(state.round.phase);
    expect(back.fireHazardTimerMs).toBe(state.fireHazardTimerMs);

    const p1 = back.players[PlayerId("p_alpha")];
    const o1 = state.players[PlayerId("p_alpha")];
    expect(p1).toBeDefined();
    expect(p1!.x).toBe(o1!.x);
    expect(p1!.y).toBe(o1!.y);
    expect(p1!.vx).toBe(o1!.vx);
    expect(p1!.vy).toBe(o1!.vy);
    expect(p1!.aimX).toBe(o1!.aimX);
    expect(p1!.aimY).toBe(o1!.aimY);
    expect(p1!.health).toBe(o1!.health);
    expect(p1!.shieldActive).toBe(o1!.shieldActive);
    expect(p1!.crouching).toBe(o1!.crouching);
    expect(p1!.alive).toBe(o1!.alive);
    expect(p1!.weaponId).toBe(o1!.weaponId);
    expect(p1!.fireCooldownMs).toBe(o1!.fireCooldownMs);
    expect(p1!.ammo).toBe(o1!.ammo);
    expect(p1!.abilityCharge).toBe(o1!.abilityCharge);
    expect(p1!.lastProcessedInputSeq).toBe(o1!.lastProcessedInputSeq);
    expect(p1!.grounded).toBe(o1!.grounded);
    expect(p1!.burnUntilTick).toBe(o1!.burnUntilTick);
    expect(p1!.burnDps).toBe(o1!.burnDps);
    expect(p1!.burnTickLastApplied).toBe(o1!.burnTickLastApplied);
    expect(p1!.jetpackFuel).toBe(o1!.jetpackFuel);
    expect(p1!.shieldCharge).toBe(o1!.shieldCharge);
    expect(p1!.shieldMaxCharge).toBe(o1!.shieldMaxCharge);
    expect(p1!.overchargeUntilTick).toBe(o1!.overchargeUntilTick);
    expect(p1!.cards.length).toBe(o1!.cards.length);

    const p2 = back.players[PlayerId("p_bravo")]!;
    expect(p2.shieldActive).toBe(false);
    expect(p2.crouching).toBe(true);
    expect(p2.weaponId).toBe("heavy-launcher");

    const pr1 = back.projectiles[EntityId(1001)]!;
    expect(pr1.x).toBe(110);
    expect(pr1.ownerId).toBe(PlayerId("p_alpha"));
    expect(pr1.impact).toBe("explosive");
    expect(pr1.impactRadiusPx).toBe(64);
    expect(pr1.ageMs).toBe(80);
    expect(pr1.originX).toBe(100);

    const pr2 = back.projectiles[EntityId(1002)]!;
    expect(pr2.ownerId).toBeNull();
    expect(pr2.shape).toBe("x");
    expect(pr2.element).toBe("ice");
    expect(pr2.pathing).toBe("boomerang");
    expect(pr2.splitCount).toBe(3);
    expect(pr2.homingStrength).toBe(4.5);
    expect(pr2.returning).toBe(true);
    expect(pr2.stickyFuseMs).toBe(250);

    const s1 = back.satellites[EntityId(2001)]!;
    expect(s1.ownerId).toBe(PlayerId("p_alpha"));
    expect(s1.angle).toBe(Math.PI / 4);
    expect(s1.orbitRadius).toBe(80);

    const d1 = back.destructibles[EntityId(3001)]!;
    expect(d1.kind).toBe("barrel");
    expect(d1.explosive).toBe(true);
    expect(d1.flammable).toBe(false);
    expect(d1.health).toBe(100);

    const f1 = back.firePatches[EntityId(4001)]!;
    expect(f1.ownerId).toBe(PlayerId("p_bravo"));
    expect(f1.remainingMs).toBe(2200);
    expect(f1.damagePerSecond).toBe(8);

    const u1 = back.pickups[EntityId(5001)]!;
    expect(u1.kind).toBe("health-shard");
    expect(u1.active).toBe(true);

    const u2 = back.pickups[EntityId(5002)]!;
    expect(u2.active).toBe(false);
    expect(u2.durationMs).toBe(5000);
    expect(u2.respawnMs).toBe(12000);
  });

  test("chaosModifierIds round-trip through the chaos_mask bitfield", () => {
    const state = makeFixtureState();
    state.chaosModifierIds = ["low-gravity", "max-recoil"];
    const buf = packWorldState(state);
    const back = unpackWorldState(buf);
    expect(back.chaosModifierIds).toBeDefined();
    // Decoding preserves the canonical order, not insertion order.
    expect(back.chaosModifierIds).toContain("low-gravity");
    expect(back.chaosModifierIds).toContain("max-recoil");
    expect(back.chaosModifierIds).toHaveLength(2);
  });

  test("idempotent — pack→unpack→pack produces identical bytes", () => {
    const state = makeFixtureState();
    const buf1 = packWorldState(state);
    const back = unpackWorldState(buf1);

    // Re-construct a WorldState minimally from the unpacked
    // fragment (round.scores etc. aren't in the bridge yet) so we
    // can re-pack without losing equivalence.
    const restored: WorldState = {
      tick: back.tick,
      rngState: back.rngState,
      players: back.players,
      projectiles: back.projectiles,
      destructibles: back.destructibles,
      firePatches: back.firePatches,
      pickups: back.pickups,
      satellites: back.satellites,
      round: {
        phase: back.round.phase,
        countdownRemainingMs: back.round.countdownRemainingMs,
        scores: {},
        roundIndex: back.round.roundIndex,
        winnerPlayerId: null,
      },
    };
    if (back.fireHazardTimerMs != null)
      restored.fireHazardTimerMs = back.fireHazardTimerMs;

    const buf2 = packWorldState(restored);
    expect(buf2.byteLength).toBe(buf1.byteLength);
    // Compare as bytes.
    for (let i = 0; i < buf1.byteLength; i++) {
      if (buf1[i] !== buf2[i]) {
        throw new Error(`byte mismatch at offset ${i}: ${buf1[i]} vs ${buf2[i]}`);
      }
    }
  });
});
