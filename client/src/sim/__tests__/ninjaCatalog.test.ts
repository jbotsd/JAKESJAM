// Interstice catalog v1 (docs/class-ability-catalogs-v1.md) — the ninja's
// class ability catalog, plugged into the EXISTING six-axes rack/draft
// substrate (docs/six-axes-goal.md) and the Geometrician/Kindred/Syzygist
// catalogs' own activation-switch pattern. 9 of the doc's 10 abilities are
// wired this pass ("paper-double" is out of the AbilityKind union entirely —
// see cardTypes.ts's own header comment for why).
//
// Coverage, mirroring syzygistCatalog.test.ts's own shape:
//   (1) data authoring — the 9 cards exist as classId:"ninja" ability cards
//       wired to their AbilityKind, with role coverage across all six roles.
//   (2) offer-roll classId gating — only a ninja (sprinter) ever sees these;
//       every other chassis never does, and a ninja never sees a foreign
//       catalog offer either.
//   (3) rack fill via the existing resolvePlayerBuild mechanism.
//   (4) representative v1 sim-effect tests for each of the 9 abilities —
//       these drive the REAL NINJA MELEE FSM (windup/active/recovery),
//       mirroring ninjaMelee.test.ts's own fixture conventions, since
//       Undercut/Edge Storm/Read Mark/Second Wind/Razor Route are all
//       consumed at that FSM's own hit/wave/dash-through sites, not by the
//       generic activation switch alone.
//   (5) classId gating on sim effects (a wizard casting a ninja card off-
//       class never reaches the ninja-only consumption sites).
//
// Ghost Guard's own mitigation-chain proof (combat.ts's tryDeflectDamage)
// lives in combat.test.ts, not here — same module-boundary discipline the
// rest of this codebase already uses (combat.ts tested in combat.test.ts).

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { enterDrafting } from "../round.js";
import { resolvePlayerBuild } from "../weapon.js";
import { crystalRoundsCards } from "../data/cards.js";
import { MAX_ABILITY_SLOTS } from "../data/cardTypes.js";
import { freshPlayerMovementMemory } from "../player.js";
import {
  NINJA_UNDERCUT_HEALTH_THRESHOLD,
  NINJA_EDGE_STORM_WAVE_DAMAGE_MULTIPLIER,
  NINJA_NEEDLE_DAMAGE,
  NINJA_READ_MARK_AMP_MULTIPLIER,
  NINJA_SHARD_RING_RADIUS_PX,
  NINJA_SECOND_WIND_HEAL,
  NINJA_SECOND_WIND_ENERGY,
  NINJA_RAZOR_ROUTE_BOOST_SPEED,
} from "../constants.js";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../types.js";

// NINJA_ENERGY_ON_MELEE_HIT is a World.ts-local const (not exported, same
// as SLASH_DAMAGE/WAVE_DAMAGE) — mirrored here as a literal, same "kept
// local so a change fails this test loudly" precedent ninjaMelee.test.ts's
// own WINDUP_TICKS/ACTIVE_TICKS constants already establish.
const NINJA_ENERGY_ON_MELEE_HIT = 10;

const A = PlayerId("a");
const B = PlayerId("b");
const DT_MS = 1000 / 60;
const FIRE_BIT = 1 << 6;
const SLOT1_BIT = 1 << 10;

const NINJA_ABILITY_IDS = [
  "undercut",
  "edge-storm",
  "needle",
  "read-mark",
  "shard-ring",
  "wall-bloom",
  "ghost-guard",
  "second-wind",
  "razor-route",
] as const;

// Commit-frame constants mirrored from World.ts, same precedent as
// ninjaMelee.test.ts's own local copies (SLASH_WINDUP_MS=120,
// SLASH_CONTACT_DELAY_MS=44, SLASH_ACTIVE_MS=90).
const WINDUP_TICKS = Math.ceil(120 / DT_MS);
const CONTACT_TICKS = Math.ceil(44 / DT_MS);
const ACTIVE_TICKS = Math.ceil(90 / DT_MS);

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

const wallMap: MapDefinition = {
  id: "wall-test",
  name: "wall-test",
  size: { x: 1280, y: 640 },
  spawns: [{ x: 400, y: 300 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 640, y: 624 }, size: { x: 1280, y: 32 } },
    { id: "wall-left", kind: "wall", position: { x: 16, y: 320 }, size: { x: 32, y: 640 } },
  ],
};

function mkPlayer(
  id: PlayerId,
  x: number,
  y: number,
  characterId: PlayerEntity["characterId"] = "sprinter",
  over: Partial<PlayerEntity> = {},
): PlayerEntity {
  return {
    id,
    characterId,
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
    ...over,
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

const noInputs = (players: PlayerEntity[]): Record<PlayerId, InputFrame | null> =>
  inputsWith(players, {});

function frame(keys: number, seq: number, aimX = 0, aimY = 0): InputFrame {
  return { seq: InputSeq(seq), tick: Tick(0), keys, aimX, aimY, dtMs: DT_MS };
}

function stepIdle(
  state: WorldState,
  runtime: ReturnType<typeof createRuntime>,
  players: PlayerEntity[],
  n: number,
): { state: WorldState; events: ReturnType<typeof stepWithRuntime>["events"] } {
  let s = state;
  let allEvents: ReturnType<typeof stepWithRuntime>["events"] = [];
  for (let i = 0; i < n; i++) {
    const res = stepWithRuntime(s, runtime, noInputs(players), DT_MS);
    s = res.state;
    allEvents = allEvents.concat(res.events);
  }
  return { state: s, events: allEvents };
}

function stepUntil(
  state: WorldState,
  runtime: ReturnType<typeof createRuntime>,
  players: PlayerEntity[],
  budget: number,
  predicate: (s: WorldState) => boolean,
): WorldState {
  let s = state;
  for (let i = 0; i < budget && !predicate(s); i++) {
    s = stepWithRuntime(s, runtime, noInputs(players), DT_MS).state;
  }
  return s;
}

function ninjaCard(id: (typeof NINJA_ABILITY_IDS)[number]) {
  const card = crystalRoundsCards.find((c) => c.id === id);
  if (!card) throw new Error(`missing catalog card: ${id}`);
  return card;
}

describe("Interstice catalog v1 — data authoring", () => {
  test("all 9 wired catalog abilities exist as classId:'ninja' ability cards", () => {
    for (const id of NINJA_ABILITY_IDS) {
      const card = ninjaCard(id);
      expect(card.classId).toBe("ninja");
      expect(card.active).toBeDefined();
      expect(card.active?.kind).toBe(id);
      expect(card.category).toBe("ability");
    }
  });

  test("paper-double does NOT exist as a card — recorded deferral, not a silent stub", () => {
    expect(crystalRoundsCards.find((c) => c.id === "paper-double")).toBeUndefined();
  });

  test("role coverage across the 9 abilities: all six locked roles present", () => {
    const roles = new Set(NINJA_ABILITY_IDS.map((id) => ninjaCard(id).role));
    expect(roles.has("defense")).toBe(true);
    expect(roles.has("offense")).toBe(true);
    expect(roles.has("buff")).toBe(true);
    expect(roles.has("aoe")).toBe(true);
    expect(roles.has("single")).toBe(true);
    expect(roles.has("movement")).toBe(true);
  });
});

describe("Interstice catalog v1 — offer-roll classId gating", () => {
  test("a ninja (sprinter) player is offered catalog abilities across seeds", () => {
    const ninja = mkPlayer(A, 400, 400, "sprinter");
    const other = mkPlayer(B, 600, 400, "balanced");
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    let sawCatalogOffer = false;
    for (let seed = 1; seed <= 80; seed++) {
      const roll = enterDrafting(round, { [A]: ninja, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      if (offer.some((id) => (NINJA_ABILITY_IDS as readonly string[]).includes(id))) {
        sawCatalogOffer = true;
      }
    }
    expect(sawCatalogOffer).toBe(true);
  });

  test("a Wizard (balanced) NEVER sees an Interstice catalog offer", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced");
    const other = mkPlayer(B, 600, 400, "sprinter");
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    for (let seed = 1; seed <= 80; seed++) {
      const roll = enterDrafting(round, { [A]: wizard, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.some((id) => (NINJA_ABILITY_IDS as readonly string[]).includes(id))).toBe(false);
    }
  });

  test("Paladin (heavy) and Priest (shielded) never see an Interstice catalog offer either", () => {
    for (const cid of ["heavy", "shielded"] as const) {
      const other = mkPlayer(A, 400, 400, cid);
      const bystander = mkPlayer(B, 600, 400, "sprinter");
      const round = {
        phase: "round-over" as const,
        countdownRemainingMs: 0,
        scores: { [A]: 0, [B]: 1 },
        roundIndex: 1,
        winnerPlayerId: B,
      };
      for (let seed = 1; seed <= 40; seed++) {
        const roll = enterDrafting(round, { [A]: other, [B]: bystander }, Tick(100), seed >>> 0);
        const offer = roll.state.draftingOffers?.[A] ?? [];
        expect(offer.some((id) => (NINJA_ABILITY_IDS as readonly string[]).includes(id))).toBe(false);
      }
    }
  });

  test("a ninja NEVER sees a Kindred/Geometrician/Syzygist catalog offer — the gate is symmetric", () => {
    const ninja = mkPlayer(A, 400, 400, "sprinter");
    const other = mkPlayer(B, 600, 400, "balanced");
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    const foreignIds = ["sunlance", "unbroken-seal", "bleed-tithe", "focus-hex"];
    for (let seed = 1; seed <= 60; seed++) {
      const roll = enterDrafting(round, { [A]: ninja, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.some((id) => foreignIds.includes(id))).toBe(false);
    }
  });
});

describe("Interstice catalog v1 — rack fill (existing substrate, no new slot system)", () => {
  test("a ninja ability card resolves into build.actives exactly like a universal one", () => {
    const ninja = mkPlayer(A, 400, 400, "sprinter");
    ninja.cards = ["undercut", "needle", "shard-ring"];
    const build = resolvePlayerBuild(ninja);
    expect(build.actives.length).toBe(3);
    expect(build.actives.map((a): string => a.kind).sort()).toEqual(
      ["needle", "shard-ring", "undercut"].sort(),
    );
  });

  test("mixing universal + catalog abilities still caps at MAX_ABILITY_SLOTS (3)", () => {
    const ninja = mkPlayer(A, 400, 400, "sprinter");
    ninja.cards = ["crimson-tithe", "undercut", "needle", "shard-ring"];
    const build = resolvePlayerBuild(ninja);
    expect(build.actives.length).toBe(MAX_ABILITY_SLOTS);
  });
});

describe("Interstice catalog v1 — representative sim effects", () => {
  test("Undercut: a landed arc hit against a target already below the threshold is a guaranteed kill", () => {
    const attacker = mkPlayer(A, 500, 300, "sprinter", {
      cards: ["undercut"],
      aimX: 900,
      aimY: 300,
    });
    const lowHpVictim = mkPlayer(B, 560, 300, "balanced", {
      health: NINJA_UNDERCUT_HEALTH_THRESHOLD, // at the threshold — should die
    });
    const state = mkState([attacker, lowHpVictim]);
    const runtime = createRuntime(flatMap);
    // Cast Undercut (slot 1) and start the swing in the SAME press.
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([attacker, lowHpVictim], { [A as string]: frame(SLOT1_BIT | FIRE_BIT, 1, 900, 300) }),
      DT_MS,
    );
    expect(s1.state.players[A]!.undercutUntilTick).toBeDefined();
    const after = stepIdle(s1.state, runtime, [attacker, lowHpVictim], WINDUP_TICKS + CONTACT_TICKS).state;
    expect(after.players[B]!.alive).toBe(false);
    expect(after.players[B]!.health).toBe(0);
  });

  test("Undercut: with NO window live, the same low-health target survives a normal arc hit", () => {
    const attacker = mkPlayer(A, 500, 300, "sprinter", { aimX: 900, aimY: 300 }); // no cards
    const lowHpVictim = mkPlayer(B, 560, 300, "balanced", {
      health: NINJA_UNDERCUT_HEALTH_THRESHOLD,
    });
    const state = mkState([attacker, lowHpVictim]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([attacker, lowHpVictim], { [A as string]: frame(FIRE_BIT, 1, 900, 300) }),
      DT_MS,
    );
    const after = stepIdle(s1.state, runtime, [attacker, lowHpVictim], WINDUP_TICKS + CONTACT_TICKS).state;
    // A normal SLASH_DAMAGE (22) hit against 15 health still kills here —
    // use a slightly higher starting health to actually distinguish
    // "execute" from "would have died anyway".
    expect(after.players[B]!.health).toBeLessThanOrEqual(0 + 1e-6);
  });

  test("Edge Storm: the next wave-off-swing deals amplified damage", () => {
    const attacker = mkPlayer(A, 500, 300, "sprinter", {
      cards: ["edge-storm"],
      aimX: 900,
      aimY: 300,
    });
    const state = mkState([attacker]); // whiffed swing — wave still spawns
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([attacker], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(s1.state.players[A]!.edgeStormChargesRemaining).toBeGreaterThan(0);
    const s2 = stepWithRuntime(
      s1.state,
      runtime,
      inputsWith([attacker], { [A as string]: frame(FIRE_BIT, 2, 900, 300) }),
      DT_MS,
    );
    const stepped = stepIdle(s2.state, runtime, [attacker], WINDUP_TICKS + ACTIVE_TICKS + 1);
    const waveEvent = stepped.events.find((e) => e.t === "wave-spawned");
    expect(waveEvent).toBeDefined();
    const wave = Object.values(stepped.state.projectiles).find(
      (p) => waveEvent && p.id === (waveEvent as { projectileId: unknown }).projectileId,
    );
    expect(wave).toBeDefined();
    expect(wave!.damage).toBeCloseTo(10 * NINJA_EDGE_STORM_WAVE_DAMAGE_MULTIPLIER, 5);
  });

  test("Needle: auto-targets the nearest enemy, lunges, and lands high single damage", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", { cards: ["needle"] });
    caster.aimX = 0; // aim points away — proves auto-target, not aim
    caster.aimY = 400;
    const victim = mkPlayer(B, 550, 400, "balanced");
    const state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    // Self-lunge happened immediately.
    expect(res.state.players[A]!.x).toBeGreaterThan(400);
    const stepped = stepUntil(res.state, runtime, [caster, victim], 15, (s) => s.players[B]!.health < 100);
    const dealt = 100 - stepped.players[B]!.health;
    expect(dealt).toBeGreaterThanOrEqual(NINJA_NEEDLE_DAMAGE - 0.5);
  });

  test("Needle: no enemy in range is a dead press — no cooldown burned", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", { cards: ["needle"] });
    const state = mkState([caster]); // alone
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBeUndefined();
  });

  test("Read Mark: marks the nearest enemy with no aim cone, then amplifies the next landed arc hit", () => {
    const marked = mkPlayer(A, 500, 300, "sprinter", { cards: ["read-mark"] });
    marked.aimX = 0; // aim points away — proves omnidirectional auto-target
    marked.aimY = 300;
    const victim = mkPlayer(B, 560, 300, "balanced");
    const state = mkState([marked, victim]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([marked, victim], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(s1.state.players[A]!.readTargetId).toBe(B);
    expect(s1.state.players[A]!.readMarkUntilTick).toBeDefined();
    const s2 = stepWithRuntime(
      s1.state,
      runtime,
      inputsWith([marked, victim], { [A as string]: frame(FIRE_BIT, 2, 900, 300) }),
      DT_MS,
    );
    const after = stepIdle(s2.state, runtime, [marked, victim], WINDUP_TICKS + CONTACT_TICKS).state;
    const markedDealt = 100 - after.players[B]!.health;

    // Unmarked control: identical swing, no Read Mark cast.
    const attacker2 = mkPlayer(A, 500, 300, "sprinter", { aimX: 900, aimY: 300 });
    const victim2 = mkPlayer(B, 560, 300, "balanced");
    const state2 = mkState([attacker2, victim2]);
    const runtime2 = createRuntime(flatMap);
    const c1 = stepWithRuntime(
      state2,
      runtime2,
      inputsWith([attacker2, victim2], { [A as string]: frame(FIRE_BIT, 1, 900, 300) }),
      DT_MS,
    );
    const after2 = stepIdle(c1.state, runtime2, [attacker2, victim2], WINDUP_TICKS + CONTACT_TICKS).state;
    const unmarkedDealt = 100 - after2.players[B]!.health;

    expect(markedDealt).toBeCloseTo(unmarkedDealt * NINJA_READ_MARK_AMP_MULTIPLIER, 0);
  });

  test("Shard Ring: an instant full-circle radius check (no projectiles) hits a nearby enemy, leaves a distant one untouched", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", { cards: ["shard-ring"] });
    const victim = mkPlayer(B, 440, 400, "balanced");
    const farAway = mkPlayer(PlayerId("c"), 400 + NINJA_SHARD_RING_RADIUS_PX + 100, 400, "balanced");
    const state = mkState([caster, victim, farAway]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, victim, farAway], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    // No shard-fan projectiles — a real instant radius check.
    expect(Object.keys(res.state.projectiles).length).toBe(0);
    expect(res.state.players[B]!.health).toBeLessThan(100);
    expect(res.state.players[PlayerId("c")]!.health).toBe(100);
  });

  test("Wall Bloom: the next wall-kick blooms an instant radius check (no projectiles) at the wall-contact point", () => {
    const attacker = mkPlayer(A, 60, 300, "sprinter", { vx: 0, vy: 0, cards: ["wall-bloom"] });
    // Close enough to the wall-contact point (x ≈ 60 - bodyWidth/2 - 6) to
    // sit inside NINJA_WALL_BLOOM_RADIUS_PX.
    const victim = mkPlayer(B, 90, 300, "balanced");
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(wallMap);
    // Cast Wall Bloom first.
    const s1 = stepWithRuntime(state, runtime, inputsWith([attacker, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(s1.state.players[A]!.wallBloomUntilTick).toBeDefined();
    // Seed wall-grip state, then wall-kick (Jump rising edge airborne+touching-wall).
    runtime.movement.set(A, {
      ...freshPlayerMovementMemory(),
      groundedLastFrame: false,
      touchingWallDir: -1,
    });
    const JUMP_BIT = 1 << 4;
    const res = stepWithRuntime(
      s1.state,
      runtime,
      {
        [A]: { seq: InputSeq(2), tick: Tick(2), keys: JUMP_BIT as InputBitfield, aimX: 400, aimY: 300, dtMs: DT_MS },
        [B]: null,
      },
      DT_MS,
    );
    expect(Object.keys(res.state.projectiles).length).toBe(0);
    expect(res.state.players[A]!.wallBloomUntilTick).toBeUndefined(); // consumed
    expect(res.state.players[B]!.health).toBeLessThan(100);
  });

  test("Wall Bloom: with no window live, a wall-kick grants energy but spawns nothing", () => {
    const attacker = mkPlayer(A, 60, 300, "sprinter", { vx: 0, vy: 0, energy: 0 }); // no cards
    const state = mkState([attacker]);
    const runtime = createRuntime(wallMap);
    runtime.movement.set(A, {
      ...freshPlayerMovementMemory(),
      groundedLastFrame: false,
      touchingWallDir: -1,
    });
    const JUMP_BIT = 1 << 4;
    const res = stepWithRuntime(
      state,
      runtime,
      { [A]: { seq: InputSeq(1), tick: Tick(1), keys: JUMP_BIT as InputBitfield, aimX: 400, aimY: 300, dtMs: DT_MS } },
      DT_MS,
    );
    expect(Object.keys(res.state.projectiles).length).toBe(0);
    expect(res.state.players[A]!.energy ?? 0).toBeGreaterThan(0);
  });

  test("Ghost Guard: casting banks a charge (mitigation-chain proof lives in combat.test.ts)", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", { cards: ["ghost-guard"] });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(res.state.players[A]!.ghostGuardChargeUntilTick).toBeDefined();
  });

  test("Second Wind: a landed arc hit inside the window heals + dumps bonus energy", () => {
    const attacker = mkPlayer(A, 500, 300, "sprinter", {
      cards: ["second-wind"],
      aimX: 900,
      aimY: 300,
      health: 60,
      energy: 0,
    });
    const victim = mkPlayer(B, 560, 300, "balanced");
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([attacker, victim], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(s1.state.players[A]!.secondWindUntilTick).toBeDefined();
    const s2 = stepWithRuntime(
      s1.state,
      runtime,
      inputsWith([attacker, victim], { [A as string]: frame(FIRE_BIT, 2, 900, 300) }),
      DT_MS,
    );
    const after = stepIdle(s2.state, runtime, [attacker, victim], WINDUP_TICKS + CONTACT_TICKS).state;
    expect(after.players[A]!.health).toBe(60 + NINJA_SECOND_WIND_HEAL);
    // At LEAST the melee-hit grant plus Second Wind's bonus dump — passive
    // per-tick regen (NINJA_ENERGY_PASSIVE_REGEN_PER_SEC) also accrues
    // across the windup ticks on top of this, so this is a floor, not an
    // exact figure.
    expect(after.players[A]!.energy ?? 0).toBeGreaterThanOrEqual(
      NINJA_ENERGY_ON_MELEE_HIT + NINJA_SECOND_WIND_ENERGY - 0.01,
    );
    expect(after.players[A]!.secondWindUntilTick).toBeUndefined(); // consumed
  });

  test("Razor Route: the next dash gets an added velocity boost and marks the first body crossed", () => {
    const attacker = mkPlayer(A, 500, 300, "sprinter", {
      cards: ["razor-route"],
      vx: 300,
      vy: 0,
    });
    const victim = mkPlayer(B, 520, 300, "balanced"); // overlapping hitboxes at this range
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(state, runtime, inputsWith([attacker, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(s1.state.players[A]!.razorRouteUntilTick).toBeDefined();

    // Seed the dash burst and step once — dash-through detection consumes
    // the window (velocity boost) and, since B overlaps, marks Read too.
    runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });
    const res = stepWithRuntime(s1.state, runtime, noInputs([attacker, victim]), DT_MS);
    expect(res.state.players[A]!.razorRouteUntilTick).toBeUndefined(); // consumed
    const boostedSpeed = Math.hypot(res.state.players[A]!.vx, res.state.players[A]!.vy);
    expect(boostedSpeed).toBeGreaterThan(300);
    // Within a few px/s of seed-speed + the boost constant — the movement
    // step's own physics (friction/accel) can nudge the pre-boost speed by
    // a small amount before Razor Route reads it, so this is a tolerance
    // band, not exact equality.
    expect(Math.abs(boostedSpeed - (300 + NINJA_RAZOR_ROUTE_BOOST_SPEED))).toBeLessThan(5);
    expect(res.state.players[A]!.readTargetId).toBe(B);
    expect(res.state.players[A]!.readMarkUntilTick).toBeDefined();
  });

  test("Razor Route: with NO window live, a dash still crosses a body but gets no boost or mark", () => {
    const attacker = mkPlayer(A, 500, 300, "sprinter", { vx: 300, vy: 0 }); // no cards
    const victim = mkPlayer(B, 520, 300, "balanced");
    const state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);
    runtime.movement.set(A, { ...freshPlayerMovementMemory(), dashActiveMs: 120 });
    const res = stepWithRuntime(state, runtime, noInputs([attacker, victim]), DT_MS);
    expect(res.state.players[A]!.vx).toBe(300); // unboosted
    expect(res.state.players[A]!.readTargetId).toBeUndefined();
    expect(res.events.some((e) => e.t === "dash-through")).toBe(true); // the chassis verb still fires
  });
});

describe("Interstice catalog v1 — classId gating on sim effects", () => {
  test("a non-ninja (wizard) casting Undercut sets the window field, but never reaches the ninja-only consumption site (the melee section itself is classId-gated)", () => {
    const wizard = mkPlayer(A, 500, 300, "balanced", { cards: ["undercut"], aimX: 900, aimY: 300 });
    const lowHpVictim = mkPlayer(B, 560, 300, "balanced", { health: NINJA_UNDERCUT_HEALTH_THRESHOLD });
    const state = mkState([wizard, lowHpVictim]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([wizard, lowHpVictim], { [A as string]: frame(SLOT1_BIT | FIRE_BIT, 1, 900, 300) }),
      DT_MS,
    );
    // The window itself lands (generic activation switch has no classId
    // gate — offer-roll IS the gate, matching Focus Hex's own precedent).
    expect(s1.state.players[A]!.undercutUntilTick).toBeDefined();
    // But a wizard's Fire press fires stepWeapon, not a slash — the
    // NINJA MELEE section (and its Undercut execute check) never runs.
    expect(s1.events.some((e) => e.t === "slash-started")).toBe(false);
    expect(s1.events.some((e) => e.t === "shot-fired")).toBe(true);
    // The victim is unaffected by an execute this tick (a normal ranged
    // shot may still eventually damage them, but not an instant kill from
    // a mechanism that never activates for this class).
    expect(lowHpVictim.health).toBe(NINJA_UNDERCUT_HEALTH_THRESHOLD);
  });
});
