// Six Axes Phase 3 actives (docs/six-axes-goal.md): Shadow Step (blink),
// Veil of Nought (targeting blindness, breaks on fire), Severing Answer
// (counter-stance, negate + capped return), Shelter Seal (self-bulwark —
// the risk-register fallback, placed-ward upgrade recorded), plus the
// E-coupling law (an ability card deepens its axis in the cast).

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import {
  ABILITY_COUNTER_RETURN_CAP,
  ABILITY_STEP_RANGE_PX,
  EMISSION_CHARGE_MAX,
} from "../constants.js";
import {
  EMISSION_DRAIN_LEECH_FRACTION_DEEP,
  EMISSION_EXECUTE_BELOW_FRAC_DEEP,
  EMISSION_SELF_VEIL_MS,
  EMISSION_WARD_FIELD_MS_DEEP,
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
const SLOT1_BIT = 1 << 10;
const FIRE_BIT = 1 << 6;
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

function frame(keys: number, seq: number, aimX = 0, aimY = 0): InputFrame {
  return { seq: InputSeq(seq), tick: Tick(0), keys, aimX, aimY, dtMs: DT_MS };
}

describe("Shadow Step", () => {
  test("blinks toward aim by up to the range; cooldown burns", () => {
    const caster = mkPlayer(A, 300, 300); // airborne, open space
    caster.cards = ["shadow-step"];
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 900, 300) }),
      DT_MS,
    );
    const p = res.state.players[A]!;
    expect(p.x).toBeGreaterThan(300 + ABILITY_STEP_RANGE_PX - 20);
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(true);
    expect(p.slot1CooldownUntilTick).toBeDefined();
  });

  test("a fully-blocked blink does nothing and keeps the cooldown", () => {
    // Passing THROUGH a slab to open space beyond is legal ("the path
    // between") — so the blocked case needs solid ground deeper than the
    // whole blink range. Mega-slab from y=300 to the map floor: every
    // sample toward it lands inside stone.
    const slabMap: MapDefinition = {
      ...flatMap,
      platforms: [
        {
          id: "mega-slab",
          kind: "floor",
          position: { x: 0, y: 300 },
          size: { x: 1280, y: 420 },
        },
      ],
    };
    const caster = mkPlayer(A, 640, 270);
    caster.cards = ["shadow-step"];
    const state = mkState([caster]);
    const runtime = createRuntime(slabMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 640, 900) }),
      DT_MS,
    );
    const p = res.state.players[A]!;
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(false);
    expect(p.slot1CooldownUntilTick).toBeUndefined();
  });
});

describe("Veil of Nought", () => {
  test("activation sets the window; firing breaks it early", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["veil-of-nought"];
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.veilUntilTick).toBeDefined();
    expect((state.players[A]!.veilUntilTick as number) > state.tick).toBe(true);

    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(FIRE_BIT, 2, 900, 370) }),
      DT_MS,
    );
    expect(res.state.players[A]!.veilUntilTick).toBeUndefined();
  });

  test("a homing shot fired AWAY only connects by tracking — and cannot track the veiled", () => {
    // Isolates the LOCK (not incidental straight-line physics): B fires a
    // seeker gun shot aimed 90° away from A. It reaches A only if the
    // homing steer turns it — so the control run proves the curve, and the
    // veiled run proves the blindness.
    //
    // Shooter is "shielded" (priest), not the original "balanced" (wizard):
    // wizard is ALWAYS raycast now (THE GEOMETRICIAN RULING, 2026-07-24,
    // weapons.ts) — a wizard shot resolves as a same-tick straight ray
    // (Seeker Facets' homing fields still ride the build, but only for
    // real-projectile consumers like Emission/split children — the basic
    // shot itself never curves), so a wizard rig can no longer produce the
    // traveling homing projectile this LOCK test needs. Priest is the
    // sim's class-true homing carrier (Seeker Facets' own priest
    // classModifiers variant keeps `delivery: "projectile"`), driving the
    // exact same closestNonOwnerPlayer lock path the veil must blind.
    const run = (veiled: boolean): number => {
      // Geometry, retuned for the priest tendril (~288px/s = 320 × 0.9, at
      // 2.5rad/s → turn radius ~115px):
      //   - The aim offset (~30° off the muzzle→A line) must EXCEED the
      //     tendril fan's ±13° spread (SYZ_TENDRIL_SPREAD_RADIANS 0.45
      //     across 3 tendrils) so no stray pellet connects by straight-
      //     line luck in the veiled run — the wizard-era single-bolt
      //     version could aim just ~12° wide, a fan cannot.
      //   - It must stay head-on-ish: fired fully sideways the tendrils
      //     ORBIT A at the turn circle forever without converging
      //     (empirically traced), so ~30° is the working band between
      //     "spread hits anyway" and "orbits without landing". Control
      //     connects at ~tick 19.
      //   - The 85-tick budget stays inside Veil of Nought's 1500ms
      //     (90-tick) window: the surviving tendrils outlive the veil
      //     (2.6s lifetime), and stepping past expiry would let them
      //     re-lock and hit — which would be testing the veil's DURATION,
      //     not its blindness.
      const target = mkPlayer(A, 480, 100);
      if (veiled) target.cards = ["veil-of-nought"];
      const shooter = mkPlayer(B, 480, 400);
      shooter.characterId = "shielded";
      shooter.cards = ["seeker-facets"];
      let state = mkState([target, shooter]);
      const runtime = createRuntime(flatMap);
      // Tick 1: A raises the veil (or idles); B fires wide of A.
      const first: Partial<Record<string, InputFrame>> = {
        [B as string]: frame(FIRE_BIT, 1, 620, 160),
      };
      if (veiled) first[A as string] = frame(SLOT1_BIT, 1);
      let res = stepWithRuntime(state, runtime, inputsWith([target, shooter], first), DT_MS);
      state = res.state;
      for (let t = 0; t < 85; t++) {
        res = stepWithRuntime(state, runtime, inputsWith([target, shooter], {}), DT_MS);
        state = res.state;
      }
      return 100 - state.players[A]!.health;
    };

    expect(run(false)).toBeGreaterThan(0); // the seeker curves back and finds the body
    expect(run(true)).toBe(0); // the unmade cannot be locked
  });
});

describe("Severing Answer", () => {
  test("the stance negates the next hit and returns capped damage; consumed on use", () => {
    const stancer = mkPlayer(A, 400, 370);
    stancer.cards = ["severing-answer"];
    const attacker = mkPlayer(B, 480, 400);
    attacker.abilityCharge = EMISSION_CHARGE_MAX;
    let state = mkState([stancer, attacker]);
    const runtime = createRuntime(flatMap);

    // Same tick: A takes the stance, B casts (leftward shard reaches A in
    // a few ticks — inside the 0.5s window).
    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([stancer, attacker], {
        [A as string]: frame(SLOT1_BIT, 1),
        [B as string]: frame(ABILITY_BIT, 1),
      }),
      DT_MS,
    );
    state = res.state;
    let returnedHit = false;
    for (let t = 0; t < 30; t++) {
      res = stepWithRuntime(state, runtime, inputsWith([stancer, attacker], {}), DT_MS);
      state = res.state;
      for (const e of res.events) {
        if (e.t === "hit-confirmed" && e.victimId === B && e.attackerId === A) {
          returnedHit = true;
          expect(e.damage).toBeLessThanOrEqual(ABILITY_COUNTER_RETURN_CAP);
        }
      }
      if (returnedHit) break;
    }
    expect(returnedHit).toBe(true);
    expect(state.players[A]!.health).toBe(100); // the answered hit never landed
    expect(state.players[B]!.health).toBeLessThan(100); // the answer did
    expect(state.players[A]!.counterUntilTick).toBeUndefined(); // consumed
  });
});

describe("Shelter Seal (self-bulwark v1)", () => {
  test("activation raises the ward shell for the window", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["shelter-seal"];
    const res = stepWithRuntime(
      mkState([caster]),
      createRuntime(flatMap),
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    const p = res.state.players[A]!;
    expect(p.wardShellUntilTick).toBeDefined();
    expect((p.wardShellUntilTick as number) > res.state.tick).toBe(true);
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(true);
  });
});

describe("E-coupling (doctrine #7: the card deepens its axis in the cast)", () => {
  const buildWith = (ids: string[]) =>
    createWeaponBuild(starterWeapon, findCardsById(crystalRoundsCards, ids));

  test("Crimson Tithe deepens Drain leech; Shelter Seal deepens the Ward shell; Severing Answer deepens the execute", () => {
    expect(resolveEmission(buildWith(["crimson-tithe"])).drain.leechFraction).toBe(
      EMISSION_DRAIN_LEECH_FRACTION_DEEP,
    );
    expect(resolveEmission(buildWith(["shelter-seal"])).ward.fieldMs).toBe(
      EMISSION_WARD_FIELD_MS_DEEP,
    );
    expect(
      resolveEmission(buildWith(["severing-answer"])).technique.executeBelowFrac,
    ).toBe(EMISSION_EXECUTE_BELOW_FRAC_DEEP);
    expect(resolveEmission(buildWith(["veil-of-nought"])).mystery.markMs).toBe(
      EMISSION_SELF_VEIL_MS,
    );
  });

  test("a Veil hand's cast applies the self-veil; a Step hand's cast surges speed", () => {
    const cast = (cardId: string) => {
      const caster = mkPlayer(A, 400, 400);
      caster.cards = [cardId];
      caster.abilityCharge = EMISSION_CHARGE_MAX;
      return stepWithRuntime(
        mkState([caster]),
        createRuntime(flatMap),
        inputsWith([caster], { [A as string]: frame(ABILITY_BIT, 1) }),
        DT_MS,
      );
    };
    const veiled = cast("veil-of-nought");
    expect(veiled.events.some((e) => e.t === "emission-cast")).toBe(true);
    expect(veiled.state.players[A]!.veilUntilTick).toBeDefined();

    const stepped = cast("shadow-step");
    expect(stepped.events.some((e) => e.t === "emission-cast")).toBe(true);
    expect(stepped.state.players[A]!.speedBoostUntilTick).toBeDefined();
  });
});
