// Venue-lobby-tableau fast-follow (docs/venue-lobby-tableau-goal.md,
// 2026-07-18) — "fully enable all of the abilities to work" against the
// practice dummies. Before this pass, ninja/paladin melee and all 7
// instant-AOE catalog abilities had NO destructible-hit path at all in
// hangout mode (only player-damage sites existed, and those are correctly
// suppressed there) — this file proves the new destructible-facing paths
// work, that player immunity in hangout mode is untouched, that a
// melee/AOE-broken destructible is actually removed (not left as a
// permanently-dead entry respawnDestructibles would never revive), and
// that Emission charge now fills from this damage.
//
// Harness conventions copied directly from ninjaMelee.test.ts/
// ninjaCatalog.test.ts (same mkPlayer/mkState/frame/inputsWith/stepIdle
// shapes) — the only new pieces are a destructible fixture and
// createRuntime(map, "hangout") instead of the default "combat" mode.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { isAlly } from "../team.js";
import { NINJA_SHARD_RING_RADIUS_PX } from "../constants.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type DestructibleEntity,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../types.js";

const A = PlayerId("a");
const B = PlayerId("b");
const DT_MS = 1000 / 60;
const FIRE_BIT = 1 << 6;
const SLOT1_BIT = 1 << 10;

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

function mkPlayer(
  id: PlayerId,
  x: number,
  y: number,
  characterId: PlayerEntity["characterId"],
  over: Partial<PlayerEntity> = {},
): PlayerEntity {
  return {
    id, characterId, x, y, vx: 0, vy: 0,
    aimX: x + 100, aimY: y, health: 100, shieldActive: false, crouching: false,
    alive: true, weaponId: "starter-pistol", cards: [], fireCooldownMs: 0,
    ammo: 0, abilityCharge: 0, lastProcessedInputSeq: InputSeq(0), ...over,
  };
}

function dummy(id: number, x: number, y: number, health = 60): DestructibleEntity {
  return {
    id: EntityId(id),
    kind: "trainingDummy",
    x, y,
    width: 44, height: 44,
    health,
    explosive: false,
    flammable: false,
  };
}

function mkState(players: PlayerEntity[], destructibles: DestructibleEntity[] = []): WorldState {
  const playerMap: Record<PlayerId, PlayerEntity> = {};
  for (const p of players) playerMap[p.id] = p;
  const destructibleMap: Record<EntityId, DestructibleEntity> = {};
  for (const d of destructibles) destructibleMap[d.id] = d;
  return {
    tick: Tick(0), rngState: 1234567 >>> 0, players: playerMap,
    projectiles: {}, destructibles: destructibleMap, firePatches: {}, pickups: {}, satellites: {},
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
const noInputs = (players: PlayerEntity[]): Record<PlayerId, InputFrame | null> => inputsWith(players, {});

function frame(keys: number, seq: number, aimX = 0, aimY = 0): InputFrame {
  return { seq: InputSeq(seq), tick: Tick(0), keys, aimX, aimY, dtMs: DT_MS };
}

function stepIdle(
  state: WorldState,
  runtime: ReturnType<typeof createRuntime>,
  players: PlayerEntity[],
  n: number,
): WorldState {
  let s = state;
  for (let i = 0; i < n; i++) {
    s = stepWithRuntime(s, runtime, noInputs(players), DT_MS).state;
  }
  return s;
}

// Commit-frame constants mirrored from World.ts, same "kept local so a
// change fails this test loudly" precedent as ninjaMelee.test.ts.
const WINDUP_TICKS = Math.ceil(120 / DT_MS); // SLASH_WINDUP_MS (ninja)
const ACTIVE_TICKS = Math.ceil(90 / DT_MS); // SLASH_ACTIVE_MS (ninja)
// +1: paladinMelee.test.ts's own WINDUP_TICKS needs the same fudge factor
// (its comment: "has a +1 the ninja file's equivalent constant doesn't need").
const EDGE_WINDUP_TICKS = Math.ceil(200 / DT_MS) + 1; // EDGE_WINDUP_MS (paladin)
const EDGE_ACTIVE_TICKS = Math.ceil(110 / DT_MS); // EDGE_ACTIVE_MS (paladin)

// GROUNDED, not airborne (measured: a player spawned at y=300 above this
// floor settles at y=442 under gravity). Destructibles never fall — they
// stay exactly where placed — so an airborne attacker drifting downward
// during a swing's windup (Kindled Edge's 200ms windup drifts ~60px) tilts
// the swing's fixed aim angle off a stationary dummy that never moved with
// it. Spawning grounded matches how a real player actually stands at the
// practice table and avoids that drift entirely.
const GROUND_Y = 442;

describe("ninja/paladin melee vs. destructibles in hangout mode", () => {
  test("ninja melee damages a destructible dummy", () => {
    const attacker = mkPlayer(A, 500, GROUND_Y, "sprinter", { aimX: 900, aimY: GROUND_Y });
    const target = dummy(1, 560, GROUND_Y); // ~60px ahead, within SLASH_RANGE 78
    const state = mkState([attacker], [target]);
    const runtime = createRuntime(flatMap, "hangout");

    const s1 = stepWithRuntime(state, runtime, inputsWith([attacker], { [A as string]: frame(FIRE_BIT, 1, 900, GROUND_Y) }), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker], WINDUP_TICKS + 1);
    const survivor = after.destructibles[EntityId(1)];
    // Either damaged (health dropped) or broken (removed) — both are a real hit.
    expect(survivor === undefined || survivor.health < 60).toBe(true);
  });

  test("ninja melee still never damages another PLAYER in hangout mode (immunity unchanged)", () => {
    const attacker = mkPlayer(A, 500, GROUND_Y, "sprinter", { aimX: 900, aimY: GROUND_Y });
    const victim = mkPlayer(B, 560, GROUND_Y, "balanced");
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap, "hangout");

    const s1 = stepWithRuntime(state, runtime, inputsWith([attacker, victim], { [A as string]: frame(FIRE_BIT, 1, 900, GROUND_Y) }), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS + ACTIVE_TICKS);
    expect(after.players[B]!.health).toBe(100);
  });

  test("paladin (Kindled Edge) melee damages a destructible dummy", () => {
    const attacker = mkPlayer(A, 500, GROUND_Y, "heavy", { aimX: 900, aimY: GROUND_Y });
    const target = dummy(1, 555, GROUND_Y); // within EDGE_RANGE
    const state = mkState([attacker], [target]);
    const runtime = createRuntime(flatMap, "hangout");

    const s1 = stepWithRuntime(state, runtime, inputsWith([attacker], { [A as string]: frame(FIRE_BIT, 1, 900, GROUND_Y) }), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker], EDGE_WINDUP_TICKS + EDGE_ACTIVE_TICKS);
    const survivor = after.destructibles[EntityId(1)];
    expect(survivor === undefined || survivor.health < 60).toBe(true);
  });

  test("a destructible melee-broken to 0 health is REMOVED, not left as a dead entry, and fires destructible-broken", () => {
    const attacker = mkPlayer(A, 500, GROUND_Y, "sprinter", { aimX: 900, aimY: GROUND_Y });
    const target = dummy(1, 560, GROUND_Y, 5); // one hit (SLASH_DAMAGE=22) easily kills it
    const state = mkState([attacker], [target]);
    const runtime = createRuntime(flatMap, "hangout");

    const s1 = stepWithRuntime(state, runtime, inputsWith([attacker], { [A as string]: frame(FIRE_BIT, 1, 900, GROUND_Y) }), DT_MS);
    let brokeEvent = s1.events.some((e) => e.t === "destructible-broken");
    let s = s1.state;
    for (let i = 0; i < WINDUP_TICKS + ACTIVE_TICKS && !brokeEvent; i++) {
      const res = stepWithRuntime(s, runtime, noInputs([attacker]), DT_MS);
      s = res.state;
      if (res.events.some((e) => e.t === "destructible-broken")) brokeEvent = true;
    }
    expect(brokeEvent).toBe(true);
    expect(s.destructibles[EntityId(1)]).toBeUndefined();
  });
});

describe("instant-AOE catalog abilities vs. destructibles in hangout mode", () => {
  test("Shard Ring (representative instant-AOE) damages a nearby destructible dummy", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", { cards: ["shard-ring"] });
    const target = dummy(1, 440, 400); // well inside NINJA_SHARD_RING_RADIUS_PX
    const farAway = dummy(2, 400 + NINJA_SHARD_RING_RADIUS_PX + 100, 400);
    const state = mkState([caster], [target, farAway]);
    const runtime = createRuntime(flatMap, "hangout");

    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    const nearSurvivor = res.state.destructibles[EntityId(1)];
    expect(nearSurvivor === undefined || nearSurvivor.health < 60).toBe(true);
    // Distant dummy untouched — proves this is a real radius check, not a
    // blanket "damage everything" bug.
    expect(res.state.destructibles[EntityId(2)]?.health).toBe(60);
  });
});

describe("emission charge fills from hangout-mode destructible damage", () => {
  test("melee damage against a dummy credits the attacker's abilityCharge", () => {
    const attacker = mkPlayer(A, 500, GROUND_Y, "sprinter", { aimX: 900, aimY: GROUND_Y });
    const target = dummy(1, 560, GROUND_Y);
    const state = mkState([attacker], [target]);
    const runtime = createRuntime(flatMap, "hangout");

    const s1 = stepWithRuntime(state, runtime, inputsWith([attacker], { [A as string]: frame(FIRE_BIT, 1, 900, GROUND_Y) }), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker], WINDUP_TICKS + 1);
    expect(after.players[A]!.abilityCharge).toBeGreaterThan(0);
  });

  test("instant-AOE damage against a dummy credits the caster's abilityCharge", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", { cards: ["shard-ring"] });
    const target = dummy(1, 440, 400);
    const state = mkState([caster], [target]);
    const runtime = createRuntime(flatMap, "hangout");

    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(res.state.players[A]!.abilityCharge).toBeGreaterThan(0);
  });

  test("outside hangout mode, this new path never double-fires (still the original hit-confirmed-only site)", () => {
    // Sanity guard: a hangout-mode-only accumulator existing at all must
    // never leak into a real combat match. In combat mode there ARE no
    // destructibles in this fixture, so this is really just proving no
    // crash/behavior-change when pendingHangoutDestructibleDamage stays
    // empty (the common case, every real match).
    const attacker = mkPlayer(A, 500, 300, "sprinter", { aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300, "balanced");
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap, "combat");
    const s1 = stepWithRuntime(state, runtime, inputsWith([attacker, victim], { [A as string]: frame(FIRE_BIT, 1, 900, 300) }), DT_MS);
    const after = stepIdle(s1.state, runtime, [attacker, victim], WINDUP_TICKS + 1);
    expect(after.players[B]!.health).toBeLessThan(100); // real combat still works
  });
});

describe("lobby practice-ally teamId (venue-lobby-tableau Part 2)", () => {
  test("isAlly() reads true between two players sharing the same teamId", () => {
    const visitor = mkPlayer(A, 0, 0, "balanced", { teamId: "lobby-practice" });
    const ally = mkPlayer(B, 0, 0, "balanced", { teamId: "lobby-practice" });
    expect(isAlly(visitor, ally)).toBe(true);
  });

  test("isAlly() reads false when teamId is absent (today's default lobby state, pre-fix)", () => {
    const visitor = mkPlayer(A, 0, 0, "balanced");
    const ally = mkPlayer(B, 0, 0, "balanced");
    expect(isAlly(visitor, ally)).toBe(false);
  });
});
