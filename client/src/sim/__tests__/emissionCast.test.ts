// Emission cast execution (docs/emission-engine-goal.md P1).
// The Ability rising edge at full charge casts: radial volley composed from
// the hand, charge consumed to 0, emission-cast event emitted, parry edge
// consumed. Below full charge the edge falls through to the legacy parry
// (bot defensive behavior). Deterministic — scripted inputs, no wall-clock.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { EMISSION_CHARGE_MAX } from "../constants.js";
import {
  EMISSION_FREEZE_CAP_MS,
  EMISSION_VOLLEY_MIN,
  resolveEmission,
} from "../data/emission.js";
import { crystalRoundsCards } from "../data/cards.js";
import { starterWeapon } from "../data/weapons.js";
import { createWeaponBuild, findCardsById } from "../data/weaponBuild.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../types.js";

const A = PlayerId("a");
const B = PlayerId("b");

const DT_MS = 1000 / 60;
const ABILITY_BIT = 1 << 7;

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

function mkState(players: PlayerEntity[]): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  return {
    tick: Tick(0),
    rngState: 1234567 >>> 0,
    players: playerMap,
    projectiles: {},
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

function inputsWith(
  players: PlayerEntity[],
  overrides: Partial<Record<string, InputFrame>>,
): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (const p of players) out[p.id] = overrides[p.id as string] ?? null;
  return out;
}

function abilityPress(_pid: PlayerId, seq = 1): InputFrame {
  return {
    seq: InputSeq(seq),
    tick: Tick(0),
    keys: ABILITY_BIT,
    aimX: 0,
    aimY: 0,
    dtMs: DT_MS,
  };
}

describe("emission cast", () => {
  test("full charge + Ability edge casts: volley spawned, charge zeroed, event emitted", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    const other = mkPlayer(B, 900, 400);
    const state = mkState([caster, other]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, other], { [A as string]: abilityPress(A) }),
      DT_MS,
    );

    const cast = res.events.find((e) => e.t === "emission-cast");
    expect(cast).toBeDefined();
    if (cast?.t !== "emission-cast") throw new Error("unreachable");
    expect(cast.playerId).toBe(A);
    expect(cast.volleyCount).toBeGreaterThanOrEqual(EMISSION_VOLLEY_MIN);

    expect(res.state.players[A]!.abilityCharge).toBe(0);
    const shards = Object.values(res.state.projectiles).filter((p) => p.ownerId === A);
    expect(shards.length).toBe(cast.volleyCount);
    // Budget: even if EVERY shard hit one body, total stays below a kill.
    const total = shards.reduce((s, p) => s + p.damage, 0);
    expect(total).toBeLessThan(100);
  });

  test("below full charge: no cast, no charge change — and the legacy parry fall-through still fires", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.abilityCharge = 60;
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress(A) }),
      DT_MS,
    );

    expect(res.events.some((e) => e.t === "emission-cast")).toBe(false);
    expect(res.state.players[A]!.abilityCharge).toBe(60);
    expect(Object.keys(res.state.projectiles).length).toBe(0);
    // Parry started (bot defensive path preserved).
    expect(res.state.players[A]!.parryActiveUntilTick).toBeDefined();
    expect((res.state.players[A]!.parryActiveUntilTick as number) > 0).toBe(true);
  });

  test("a full-charge cast consumes the edge — no parry on the same press", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress(A) }),
      DT_MS,
    );

    expect(res.events.some((e) => e.t === "emission-cast")).toBe(true);
    expect(res.state.players[A]!.parryActiveUntilTick).toBeUndefined();
  });

  test("holding Ability is not an edge — one cast per press", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    // Press and hold across several ticks.
    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress(A, 1) }),
      DT_MS,
    );
    state = res.state;
    expect(res.events.filter((e) => e.t === "emission-cast").length).toBe(1);

    // Refill instantly (test-only) and keep HOLDING — must not recast.
    state = {
      ...state,
      players: {
        ...state.players,
        [A]: { ...state.players[A]!, abilityCharge: EMISSION_CHARGE_MAX },
      },
    };
    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress(A, 2) }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "emission-cast")).toBe(false);
    expect(res.state.players[A]!.abilityCharge).toBe(EMISSION_CHARGE_MAX);
  });

  test("dead players cannot cast", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    caster.alive = false;
    caster.health = 0;
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress(A) }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "emission-cast")).toBe(false);
    expect(res.state.players[A]!.abilityCharge).toBe(EMISSION_CHARGE_MAX);
  });

  test("hangout mode never casts, even at full charge", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap, "hangout");

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress(A) }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "emission-cast")).toBe(false);
    expect(res.state.players[A]!.abilityCharge).toBe(EMISSION_CHARGE_MAX);
  });

  test("an ice hand's cast freezes for the scaled (doubled, capped) duration", () => {
    // frost-prism = ice element. Cast a shard directly into a nearby victim.
    const iceCards = findCardsById(crystalRoundsCards, ["frost-prism"]);
    const build = createWeaponBuild(starterWeapon, iceCards);
    const emission = resolveEmission(build);
    expect(emission.element).toBe("ice");

    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["frost-prism"];
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    // Victim close enough that the rightward shard (angle 0) hits within
    // a few ticks of flight.
    const victim = mkPlayer(B, 480, 370);
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, victim], { [A as string]: abilityPress(A) }),
      DT_MS,
    );
    state = res.state;
    expect(res.events.some((e) => e.t === "emission-cast")).toBe(true);

    // Run the volley until it connects.
    let hitTick = -1;
    for (let t = 0; t < 60 && hitTick < 0; t++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster, victim], {}), DT_MS);
      state = res.state;
      if (state.players[B]!.freezeUntilTick !== undefined) hitTick = state.tick;
    }
    expect(hitTick).toBeGreaterThan(-1);
    const remainingTicks = (state.players[B]!.freezeUntilTick as number) - state.tick;
    const remainingMs = remainingTicks * DT_MS;
    // Doubled from the 1s base, within the 2s cap (allow one tick of slack).
    expect(remainingMs).toBeGreaterThan(1500);
    expect(remainingMs).toBeLessThanOrEqual(EMISSION_FREEZE_CAP_MS + DT_MS);
  });
});
