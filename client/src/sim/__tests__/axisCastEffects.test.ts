// Six Axes Layer 1 — axis-live cast effects (docs/six-axes-goal.md Phase 1).
// The cast reads the WHOLE hand: Drain leeches, Ward shells, Stride refunds,
// Mystery wraps, Technique executes — each derived from fields the hand
// already carries, each silent on a hand without them (doctrine #3).
// World-stepping tests on the production TS path, deterministic inputs.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { EMISSION_CHARGE_MAX } from "../constants.js";
import {
  EMISSION_DRAIN_LEECH_FRACTION,
  EMISSION_WARD_DAMAGE_MULT,
} from "../data/emission.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type SimEvent,
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

function abilityPress(seq = 1): InputFrame {
  return {
    seq: InputSeq(seq),
    tick: Tick(0),
    keys: ABILITY_BIT,
    aimX: 0,
    aimY: 0,
    dtMs: DT_MS,
  };
}

/** Cast A's emission on tick 1, then run the sim forward collecting events
 *  until `ticks` have elapsed. Returns final state + all events seen. */
function castAndRun(
  players: PlayerEntity[],
  ticks: number,
  runtime = createRuntime(flatMap),
): { state: WorldState; events: SimEvent[] } {
  let state = mkState(players);
  const all: SimEvent[] = [];
  let res = stepWithRuntime(
    state,
    runtime,
    inputsWith(players, { [A as string]: abilityPress() }),
    DT_MS,
  );
  all.push(...res.events);
  state = res.state;
  for (let t = 0; t < ticks; t++) {
    res = stepWithRuntime(state, runtime, inputsWith(players, {}), DT_MS);
    all.push(...res.events);
    state = res.state;
  }
  return { state, events: all };
}

describe("Drain axis — leech-flagged shards feed the caster", () => {
  test("a fangs hand's cast heals the caster from landed shard damage", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["stolen-fangs"];
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    caster.health = 50;
    const victim = mkPlayer(B, 480, 370);

    const { state, events } = castAndRun([caster, victim], 60);

    const leech = events.filter((e) => e.t === "emission-leech");
    expect(leech.length).toBeGreaterThan(0);
    expect(state.players[A]!.health).toBeGreaterThan(50);
    // The heal is exactly the post-mitigation damage × the working fraction
    // (one damage model): every leech event's amount matches its share.
    const totalHealed = leech.reduce(
      (s, e) => s + (e.t === "emission-leech" ? e.amount : 0),
      0,
    );
    expect(state.players[A]!.health).toBeCloseTo(50 + totalHealed, 5);
    const damageTakenByVictim = 100 - state.players[B]!.health;
    expect(totalHealed).toBeLessThanOrEqual(
      damageTakenByVictim * EMISSION_DRAIN_LEECH_FRACTION + 0.01,
    );
  });

  test("a no-Drain hand's cast heals zero (doctrine #3: empty axis = silent)", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    caster.health = 50;
    const victim = mkPlayer(B, 480, 370);

    const { state, events } = castAndRun([caster, victim], 60);

    expect(events.some((e) => e.t === "emission-leech")).toBe(false);
    expect(state.players[A]!.health).toBe(50);
  });

  test("self-damage never leeches (a shard cannot feed on its own vessel)", () => {
    // Caster alone: shards can only ever interact with the caster itself
    // (they don't — owner-immunity — but the leech guard is explicit).
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["stolen-fangs"];
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    caster.health = 50;

    const { state, events } = castAndRun([caster], 60);
    expect(events.some((e) => e.t === "emission-leech")).toBe(false);
    expect(state.players[A]!.health).toBe(50);
  });
});

describe("Ward axis — the cast leaves a shell on the vessel", () => {
  test("a shield hand's cast sets the shell; a plain hand's does not", () => {
    const warded = mkPlayer(A, 400, 400);
    warded.cards = ["riot-mirror"];
    warded.abilityCharge = EMISSION_CHARGE_MAX;
    const bystander = mkPlayer(B, 900, 400);

    const { state } = castAndRun([warded, bystander], 0);
    expect(state.players[A]!.wardShellUntilTick).toBeDefined();
    expect(
      (state.players[A]!.wardShellUntilTick as number) > state.tick,
    ).toBe(true);

    const plain = mkPlayer(A, 400, 400);
    plain.abilityCharge = EMISSION_CHARGE_MAX;
    const { state: state2 } = castAndRun([plain, mkPlayer(B, 900, 400)], 0);
    expect(state2.players[A]!.wardShellUntilTick).toBeUndefined();
  });

  test("damage taken during the shell is halved vs the identical un-warded run", () => {
    // Comparative determinism: same seed, same positions, same attacker
    // cast — the only difference is whether A's shell is up when B's
    // shards land.
    const attackerCastDamage = (wardedHand: boolean): number => {
      // A sits 30px ABOVE B: B's shards spawn at B.y − 30 and fly at A's
      // center (same geometry as the Drain test's victim placement).
      const a = mkPlayer(A, 400, 370);
      if (wardedHand) {
        a.cards = ["riot-mirror"];
        a.abilityCharge = EMISSION_CHARGE_MAX;
      }
      const b = mkPlayer(B, 480, 400);
      b.abilityCharge = EMISSION_CHARGE_MAX;

      let state = mkState([a, b]);
      const runtime = createRuntime(flatMap);
      // Tick 1: A casts (or holds nothing at 0 charge); B casts the same
      // tick — B's shards reach A while A's shell (if any) is live.
      const inputs = wardedHand
        ? { [A as string]: abilityPress(1), [B as string]: abilityPress(1) }
        : { [B as string]: abilityPress(1) };
      let res = stepWithRuntime(
        state,
        runtime,
        inputsWith([a, b], inputs),
        DT_MS,
      );
      state = res.state;
      for (let t = 0; t < 60; t++) {
        res = stepWithRuntime(state, runtime, inputsWith([a, b], {}), DT_MS);
        state = res.state;
      }
      return 100 - state.players[A]!.health;
    };

    const wardedTaken = attackerCastDamage(true);
    const plainTaken = attackerCastDamage(false);
    expect(wardedTaken).toBeGreaterThan(0);
    expect(plainTaken).toBeGreaterThan(0);
    // The warded run's damage per landed shard is EMISSION_WARD_DAMAGE_MULT
    // of the plain run's. Shard-for-shard landings are identical (same
    // deterministic volley), so the totals scale by exactly the multiplier.
    expect(wardedTaken).toBeCloseTo(plainTaken * EMISSION_WARD_DAMAGE_MULT, 1);
  });
});

describe("Stride axis — the cast refunds spent air movement", () => {
  test("a movement hand's mid-air cast zeroes the used-counters", () => {
    const caster = mkPlayer(A, 400, 300); // airborne (floor top at 500)
    caster.cards = ["double-jump", "blink-dash"];
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    // Prime: one step creates the movement memory, then seed spent counters.
    let res = stepWithRuntime(state, runtime, inputsWith([caster], {}), DT_MS);
    state = res.state;
    const mem = runtime.movement.get(A)!;
    mem.airJumpsUsed = 1;
    mem.dashUsedInAir = 1;

    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress() }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "emission-cast")).toBe(true);
    expect(runtime.movement.get(A)!.airJumpsUsed).toBe(0);
    expect(runtime.movement.get(A)!.dashUsedInAir).toBe(0);
    // The refund surfaces as its own SimEvent at the caster's site — the
    // counters live in host movement memory (never the snapshot), so this
    // event is the ONLY way a renderer can present the moment.
    const refund = res.events.find((e) => e.t === "stride-refunded");
    expect(refund).toBeDefined();
    if (refund?.t === "stride-refunded") {
      expect(refund.playerId).toBe(A);
      expect(typeof refund.x).toBe("number");
      expect(typeof refund.y).toBe("number");
    }
  });

  test("a stride-charged cast with nothing spent stays silent (honest read)", () => {
    const caster = mkPlayer(A, 400, 300);
    caster.cards = ["double-jump", "blink-dash"];
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    // Prime movement memory but spend NOTHING — the reset is a no-op, so
    // no refund event may fire (a false "movement restored" read is noise).
    let res = stepWithRuntime(state, runtime, inputsWith([caster], {}), DT_MS);
    state = res.state;
    expect(runtime.movement.get(A)!.airJumpsUsed).toBe(0);

    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress() }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "emission-cast")).toBe(true);
    expect(res.events.some((e) => e.t === "stride-refunded")).toBe(false);
  });

  test("a no-Stride hand's cast leaves the counters spent", () => {
    const caster = mkPlayer(A, 400, 300);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(state, runtime, inputsWith([caster], {}), DT_MS);
    state = res.state;
    const mem = runtime.movement.get(A)!;
    mem.airJumpsUsed = 1;
    mem.dashUsedInAir = 1;

    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress() }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "emission-cast")).toBe(true);
    expect(runtime.movement.get(A)!.airJumpsUsed).toBe(1);
    expect(runtime.movement.get(A)!.dashUsedInAir).toBe(1);
    expect(res.events.some((e) => e.t === "stride-refunded")).toBe(false);
  });
});

describe("Mystery axis — wrap-flagged shards fold across the map rect", () => {
  test("a void hand's leftward shard reappears at the far edge", () => {
    const caster = mkPlayer(A, 30, 400); // near the left edge
    caster.cards = ["void-fracture"];
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress() }),
      DT_MS,
    );
    state = res.state;

    // Run until some leftward shard has folded to the right edge.
    let wrapped = false;
    for (let t = 0; t < 30 && !wrapped; t++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster], {}), DT_MS);
      state = res.state;
      for (const p of Object.values(state.projectiles)) {
        if (p.ownerId === A && p.vx < 0 && p.x > flatMap.size.x - 100) {
          wrapped = true;
        }
      }
    }
    expect(wrapped).toBe(true);
  });

  test("a plain hand's shards fly off the rect and never fold back", () => {
    const caster = mkPlayer(A, 30, 400);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: abilityPress() }),
      DT_MS,
    );
    state = res.state;
    for (let t = 0; t < 30; t++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster], {}), DT_MS);
      state = res.state;
      for (const p of Object.values(state.projectiles)) {
        if (p.ownerId === A && p.vx < 0) {
          expect(p.x).toBeLessThan(flatMap.size.x - 100);
        }
      }
    }
  });
});

describe("Technique axis — execute below the threshold, never above it", () => {
  const castAtVictim = (victimHealth: number) => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["voltaic-spark"]; // pierce 1 → Technique, no splits
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    const victim = mkPlayer(B, 480, 370);
    victim.health = victimHealth;
    return castAndRun([caster, victim], 60);
  };

  test("a 14%-health victim is finished by a shard that deals less", () => {
    const { state, events } = castAtVictim(14);
    expect(state.players[B]!.alive).toBe(false);
    expect(state.players[B]!.health).toBe(0);
    // The kill event carries the additive execute flag (Track L legibility)
    // so the death-FX can draw the severance mark.
    const kill = events.find((e) => e.t === "player-killed");
    expect(kill).toBeDefined();
    if (kill?.t === "player-killed") {
      expect(kill.victimId).toBe(B);
      expect(kill.executed).toBe(true);
    }
  });

  test("an ordinary lethal shard kills WITHOUT the execute flag", () => {
    // Plain hand (no Technique axis): a 5-health victim dies to raw damage
    // — the kill event must not wear the severance mark.
    const caster = mkPlayer(A, 400, 400);
    caster.abilityCharge = EMISSION_CHARGE_MAX;
    const victim = mkPlayer(B, 480, 370);
    victim.health = 5;
    const { state, events } = castAndRun([caster, victim], 60);
    expect(state.players[B]!.alive).toBe(false);
    const kill = events.find((e) => e.t === "player-killed");
    expect(kill).toBeDefined();
    if (kill?.t === "player-killed") {
      expect(kill.executed).toBeUndefined();
    }
  });

  test("a 16%-health victim survives the same shard (no execute above threshold)", () => {
    const { state } = castAtVictim(16);
    // One rightward shard at ~70/6 ≈ 11.67 damage (lightning chain has no
    // second target here): 16 − 11.67 ≈ 4.33 — hurt, alive, NOT executed.
    expect(state.players[B]!.alive).toBe(true);
    expect(state.players[B]!.health).toBeGreaterThan(0);
  });
});
