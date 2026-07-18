// Syzygist catalog v1 (docs/class-ability-catalogs-v1.md) — the priest's
// class ability catalog, plugged into the EXISTING six-axes rack/draft
// substrate (docs/six-axes-goal.md) and the Geometrician/Kindred catalogs'
// own activation-switch pattern (class-overhaul-workboard.md chunk 3.4).
// All 10 of the doc's 10 abilities are wired this pass.
//
// Coverage, mirroring kindredCatalog.test.ts's own shape:
//   (1) data authoring — the 10 cards exist as classId:"priest" ability
//       cards wired to their AbilityKind.
//   (2) offer-roll classId gating — only a priest (shielded) ever sees
//       these; every other chassis never does.
//   (3) rack fill via the existing resolvePlayerBuild mechanism.
//   (4) representative v1 sim-effect tests for each of the 10 abilities.
//   (5) classId gating on sim effects.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime, applyRegenToAlly } from "../World.js";
import { enterDrafting } from "../round.js";
import { resolvePlayerBuild } from "../weapon.js";
import { crystalRoundsCards } from "../data/cards.js";
import { MAX_ABILITY_SLOTS } from "../data/cardTypes.js";
import {
  SYZ_BLEED_TITHE_DAMAGE,
  SYZ_SEVERANCE_DAMAGE,
  SYZ_BORROWED_TIME_HEAL_ALLY,
  SYZ_BORROWED_TIME_DRAIN_ALLY,
  SYZ_BORROWED_TIME_HEAL_SELF,
  SYZ_BORROWED_TIME_DRAIN_SELF,
  SYZ_BORROWED_TIME_DEBT_DELAY_TICKS,
  SYZ_FOCUS_HEX_AMP_MULTIPLIER,
  SYZ_SELF_LATTICE_ABSORB,
  SYZ_GLASS_WARD_ALLY_ABSORB,
  SYZ_GLASS_WARD_SELF_FALLBACK_ABSORB,
  SYZ_HASTE_MULTIPLIER_DEFAULT,
  SYZ_HASTE_GIFT_SELF_MULTIPLIER,
  SYZ_DRIFT_STEP_RANGE_PX,
  SYZ_FLOCK_PULSE_BASE_DAMAGE,
  SYZ_FLOCK_PULSE_PER_SOURCE_DAMAGE,
  SYZ_SNOWBALL_BRAKE_FLOOR,
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

const A = PlayerId("a");
const B = PlayerId("b");
const DT_MS = 1000 / 60;
const SLOT1_BIT = 1 << 10;

const SYZYGIST_ABILITY_IDS = [
  "bleed-tithe",
  "severance",
  "borrowed-time",
  "focus-hex",
  "contagion",
  "flock-pulse",
  "self-lattice",
  "glass-ward",
  "haste-gift",
  "drift-step",
] as const;

// Platform `position` is CENTER-origin — a 1280-wide floor centered at
// x=640 spans [0, 1280], covering every test position in this file
// (kindredCatalog.test.ts's own fixture only needed [0,600], hence its
// x=0 center; this file's wider spread needs the recentered version).
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
  characterId: PlayerEntity["characterId"] = "shielded",
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

function frame(keys: number, seq: number, aimX = 0, aimY = 0): InputFrame {
  return { seq: InputSeq(seq), tick: Tick(0), keys, aimX, aimY, dtMs: DT_MS };
}

function syzCard(id: (typeof SYZYGIST_ABILITY_IDS)[number]) {
  const card = crystalRoundsCards.find((c) => c.id === id);
  if (!card) throw new Error(`missing catalog card: ${id}`);
  return card;
}

/** Step until a predicate holds or the budget runs out — the standard
 *  "let a fast shard travel and land" idiom kindredCatalog.test.ts's own
 *  Sunspike/Consecrated Field tests use. */
function stepUntil(
  state: WorldState,
  runtime: ReturnType<typeof createRuntime>,
  players: PlayerEntity[],
  budget: number,
  predicate: (s: WorldState) => boolean,
): { state: WorldState; runtime: ReturnType<typeof createRuntime> } {
  let s = state;
  for (let i = 0; i < budget && !predicate(s); i++) {
    const res = stepWithRuntime(s, runtime, inputsWith(players, {}), DT_MS);
    s = res.state;
  }
  return { state: s, runtime };
}

describe("Syzygist catalog v1 — data authoring", () => {
  test("all 10 catalog abilities exist as classId:'priest' ability cards", () => {
    for (const id of SYZYGIST_ABILITY_IDS) {
      const card = syzCard(id);
      expect(card.classId).toBe("priest");
      expect(card.active).toBeDefined();
      expect(card.active?.kind).toBe(id);
      expect(card.category).toBe("ability");
    }
  });

  test("role coverage across the 10 abilities: all six locked roles present", () => {
    const roles = new Set(SYZYGIST_ABILITY_IDS.map((id) => syzCard(id).role));
    expect(roles.has("defense")).toBe(true);
    expect(roles.has("offense")).toBe(true);
    expect(roles.has("buff")).toBe(true);
    expect(roles.has("aoe")).toBe(true);
    expect(roles.has("single")).toBe(true);
    expect(roles.has("movement")).toBe(true);
  });
});

describe("Syzygist catalog v1 — offer-roll classId gating", () => {
  test("a priest (shielded) player is offered catalog abilities across seeds", () => {
    const priest = mkPlayer(A, 400, 400, "shielded");
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
      const roll = enterDrafting(round, { [A]: priest, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      if (offer.some((id) => (SYZYGIST_ABILITY_IDS as readonly string[]).includes(id))) {
        sawCatalogOffer = true;
      }
    }
    expect(sawCatalogOffer).toBe(true);
  });

  test("a Wizard (balanced) NEVER sees a Syzygist catalog offer", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced");
    const other = mkPlayer(B, 600, 400, "shielded");
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
      expect(offer.some((id) => (SYZYGIST_ABILITY_IDS as readonly string[]).includes(id))).toBe(false);
    }
  });

  test("Paladin (heavy) and Ninja (sprinter) never see a Syzygist catalog offer either", () => {
    for (const cid of ["heavy", "sprinter"] as const) {
      const other = mkPlayer(A, 400, 400, cid);
      const bystander = mkPlayer(B, 600, 400, "shielded");
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
        expect(offer.some((id) => (SYZYGIST_ABILITY_IDS as readonly string[]).includes(id))).toBe(false);
      }
    }
  });

  test("a priest NEVER sees a Kindred (paladin-only) or Geometrician (wizard-only) catalog offer — the gate is symmetric", () => {
    const priest = mkPlayer(A, 400, 400, "shielded");
    const other = mkPlayer(B, 600, 400, "balanced");
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    const foreignIds = ["sunlance", "facet-break", "unbroken-seal", "sunspike", "judgment-line"];
    for (let seed = 1; seed <= 60; seed++) {
      const roll = enterDrafting(round, { [A]: priest, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.some((id) => foreignIds.includes(id))).toBe(false);
    }
  });
});

describe("Syzygist catalog v1 — rack fill (existing substrate, no new slot system)", () => {
  test("a Syzygist ability card resolves into build.actives exactly like a universal one", () => {
    const priest = mkPlayer(A, 400, 400, "shielded");
    priest.cards = ["bleed-tithe", "severance", "focus-hex"];
    const build = resolvePlayerBuild(priest);
    expect(build.actives.length).toBe(3);
    expect(build.actives.map((a): string => a.kind).sort()).toEqual(
      ["bleed-tithe", "focus-hex", "severance"].sort(),
    );
  });

  test("mixing universal + catalog abilities still caps at MAX_ABILITY_SLOTS (3)", () => {
    const priest = mkPlayer(A, 400, 400, "shielded");
    priest.cards = ["crimson-tithe", "bleed-tithe", "severance", "focus-hex"];
    const build = resolvePlayerBuild(priest);
    expect(build.actives.length).toBe(MAX_ABILITY_SLOTS);
  });
});

describe("Syzygist catalog v1 — representative sim effects (low-aim auto-target)", () => {
  test("Bleed Tithe: auto-targets the nearest enemy, burns + lifesteals — no aim required", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["bleed-tithe"], health: 60 });
    // Aim points AWAY from the victim — proves this is auto-target, not aim-based.
    caster.aimX = 0;
    caster.aimY = 400;
    const victim = mkPlayer(B, 460, 400, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(state, runtime, inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    state = res.state;
    const stepped = stepUntil(state, runtime, [caster, victim], 15, (s) => s.players[B]!.health < 100);
    state = stepped.state;
    expect(state.players[B]!.health).toBeLessThan(100);
    const dealt = 100 - state.players[B]!.health;
    expect(dealt).toBeGreaterThanOrEqual(SYZ_BLEED_TITHE_DAMAGE - 0.5);
    expect(dealt).toBeLessThanOrEqual(SYZ_BLEED_TITHE_DAMAGE * 1.3 + 0.5);
    // Lifesteal: caster's health rose above its post-cast starting value.
    expect(state.players[A]!.health).toBeGreaterThan(60);
    // Burn: the victim now carries a burn DoT from the fire-element shard.
    expect(state.players[B]!.burnUntilTick).toBeDefined();
  });

  test("Bleed Tithe: no enemy in range is a dead press — no cooldown burned", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["bleed-tithe"] });
    let state = mkState([caster]); // alone
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBeUndefined();
  });

  test("Bleed Tithe: genuine homing — still connects after the target steps off the original line (2026-07-18, Jake: 'genuine homing')", () => {
    // Cast fires straight at the victim's cast-time position (400,400) ->
    // (620,400), a due-east line. Immediately after cast, the victim jumps
    // 140px off that line — a `pathing: "straight"` shard would sail past
    // at y=400 forever and never connect; only a shard that RE-TARGETS
    // every tick (`pathing: "homing"`, closestNonOwnerPlayer) can curve up
    // and still land the hit. This isolates the curve the same way
    // abilityActivesPhase3's "fired AWAY" seeker test does, adapted for an
    // ability that auto-aims at cast (so the miss has to come from a POST-
    // cast reposition instead of an initial off-aim shot).
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["bleed-tithe"] });
    const victim = mkPlayer(B, 620, 400, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(state, runtime, inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    state = res.state;
    // Off the original line, same distance band the shard still has time
    // to close within its 1200ms lifetime at SYZ_BLEED_TITHE_SPEED.
    state = { ...state, players: { ...state.players, [B]: { ...state.players[B]!, y: 260 } } };
    let hit = false;
    for (let t = 0; t < 60 && !hit; t++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster, victim], {}), DT_MS);
      state = res.state;
      if (state.players[B]!.health < 100) hit = true;
    }
    expect(hit).toBe(true);
  });

  test("Severance: only fires on an ALREADY-cursed enemy — a fresh enemy is a dead press", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["severance"] });
    const freshVictim = mkPlayer(B, 460, 400, "balanced"); // no curse
    let state = mkState([caster, freshVictim]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, freshVictim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBeUndefined();
    expect(res.state.players[B]!.health).toBe(100);
  });

  test("Severance: detonates a nearest ALREADY-cursed enemy for real damage", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["severance"] });
    const cursedVictim = mkPlayer(B, 460, 400, "balanced", {
      burnUntilTick: Tick(600), burnDps: 5, burnTickLastApplied: Tick(0),
    });
    let state = mkState([caster, cursedVictim]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, cursedVictim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.slot1CooldownUntilTick).toBeDefined();
    const stepped = stepUntil(state, runtime, [caster, cursedVictim], 15, (s) => s.players[B]!.health < 100);
    state = stepped.state;
    const dealt = 100 - state.players[B]!.health;
    expect(dealt).toBeGreaterThan(0);
    expect(dealt).toBeGreaterThanOrEqual(SYZ_SEVERANCE_DAMAGE - 0.5 - 5 /* the burn's own DoT may also tick */);
  });

  test("Borrowed Time: heals the nearest injured ally on its own, then drains back later — net always positive", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["borrowed-time"], teamId: "t1" });
    const hurtAlly = mkPlayer(B, 460, 400, "shielded", { teamId: "t1", health: 50 });
    let state = mkState([caster, hurtAlly]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, hurtAlly], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    state = res.state;
    expect(state.players[B]!.health).toBe(50 + SYZ_BORROWED_TIME_HEAL_ALLY);
    expect(state.players[B]!.debtUntilTick).toBeDefined();
    expect(state.players[B]!.debtAmount).toBe(SYZ_BORROWED_TIME_DRAIN_ALLY);

    // Advance past the debt delay — health drops by the drain, net still positive.
    for (let i = 0; i < SYZ_BORROWED_TIME_DEBT_DELAY_TICKS + 2; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster, hurtAlly], {}), DT_MS);
      state = res.state;
    }
    expect(state.players[B]!.health).toBe(50 + SYZ_BORROWED_TIME_HEAL_ALLY - SYZ_BORROWED_TIME_DRAIN_ALLY);
    expect(state.players[B]!.health).toBeGreaterThan(50); // net positive
    expect(state.players[B]!.debtUntilTick).toBeUndefined();
  });

  test("Borrowed Time: self-cast (solo, no ally) uses the weaker solo figures", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["borrowed-time"], health: 50 });
    let state = mkState([caster]); // alone — no ally at all
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(res.state.players[A]!.health).toBe(50 + SYZ_BORROWED_TIME_HEAL_SELF);
    expect(res.state.players[A]!.debtAmount).toBe(SYZ_BORROWED_TIME_DRAIN_SELF);
  });

  test("Focus Hex: marks the nearest enemy with no aim cone, then amplifies this caster's hits on them", () => {
    // Fires Bleed Tithe (slot 2) at the SAME auto-targeted victim as the
    // damage-delivery mechanism — a reliable, straight-at-the-target shard
    // (no baseline-weapon recoil/spread to fight in a unit test), so the
    // amp comparison is clean. Focus Hex's amp applies to ANY projectile
    // hit from the marking caster, not just the baseline weapon.
    const SLOT2_BIT = 1 << 11;
    const caster = mkPlayer(A, 500, 300, "shielded", { cards: ["focus-hex", "bleed-tithe"] });
    caster.aimX = 0; // aim points away — proves omnidirectional auto-target
    caster.aimY = 300;
    const victim = mkPlayer(B, 560, 300, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.focusHexTargetId).toBe(B);
    expect(state.players[A]!.focusHexMarkUntilTick).toBeDefined();

    // Cast Bleed Tithe at the same (marked) nearest enemy.
    res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, victim], { [A as string]: frame(SLOT2_BIT, 2) }), DT_MS,
    );
    state = res.state;
    const stepped = stepUntil(state, runtime, [caster, victim], 15, (s) => s.players[B]!.health < 100);
    state = stepped.state;
    const markedDamage = 100 - state.players[B]!.health;
    expect(markedDamage).toBeGreaterThan(0);

    // Unmarked control: identical Bleed Tithe cast, no Focus Hex mark.
    const caster2 = mkPlayer(A, 500, 300, "shielded", { cards: ["bleed-tithe"] });
    const victim2 = mkPlayer(B, 560, 300, "balanced");
    let state2 = mkState([caster2, victim2]);
    const runtime2 = createRuntime(flatMap);
    let res2 = stepWithRuntime(
      state2, runtime2,
      inputsWith([caster2, victim2], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    state2 = res2.state;
    const stepped2 = stepUntil(state2, runtime2, [caster2, victim2], 15, (s) => s.players[B]!.health < 100);
    state2 = stepped2.state;
    const unmarkedDamage = 100 - state2.players[B]!.health;
    expect(markedDamage).toBeCloseTo(unmarkedDamage * SYZ_FOCUS_HEX_AMP_MULTIPLIER, 0);
  });

  test("Contagion: an already-burning enemy's burn jumps to the nearest un-burned enemy", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["contagion"] });
    const burning = mkPlayer(B, 460, 400, "balanced", {
      burnUntilTick: Tick(600), burnDps: 7, burnTickLastApplied: Tick(0),
    });
    const clean = mkPlayer(PlayerId("c"), 500, 400, "balanced");
    let state = mkState([caster, burning, clean]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, burning, clean], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBeDefined();
    expect(res.state.players[PlayerId("c")]!.burnUntilTick).toBeDefined();
    expect(res.state.players[PlayerId("c")]!.burnDps).toBe(7);
  });

  test("Contagion: no burning enemy nearby is a dead press", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["contagion"] });
    const clean = mkPlayer(B, 460, 400, "balanced");
    let state = mkState([caster, clean]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, clean], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBeUndefined();
  });

  test("Flock Pulse: an instant nova that damages nearby enemies, scaling with entangled-ally count", () => {
    const soloCaster = mkPlayer(A, 400, 400, "shielded", { cards: ["flock-pulse"] });
    const soloVictim = mkPlayer(B, 440, 400, "balanced");
    let soloState = mkState([soloCaster, soloVictim]);
    const soloRuntime = createRuntime(flatMap);
    let soloRes = stepWithRuntime(
      soloState, soloRuntime,
      inputsWith([soloCaster, soloVictim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    soloState = soloRes.state;
    const soloStepped = stepUntil(soloState, soloRuntime, [soloCaster, soloVictim], 15, (s) => s.players[B]!.health < 100);
    soloState = soloStepped.state;
    const soloDealt = 100 - soloState.players[B]!.health;
    expect(soloDealt).toBeGreaterThan(0);

    // Entangled version — an ally carries this caster's regen — should hit harder.
    const buffedCaster = mkPlayer(A, 400, 400, "shielded", { cards: ["flock-pulse"], teamId: "t1" });
    const ally = mkPlayer(PlayerId("ally"), 300, 400, "shielded", { teamId: "t1" });
    const buffedVictim = mkPlayer(B, 440, 400, "balanced");
    let buffedState = mkState([buffedCaster, ally, buffedVictim]);
    applyRegenToAlly(buffedCaster, ally, buffedState.players, buffedState.tick, 6, 600);
    const buffedRuntime = createRuntime(flatMap);
    let buffedRes = stepWithRuntime(
      buffedState, buffedRuntime,
      inputsWith([buffedCaster, ally, buffedVictim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    buffedState = buffedRes.state;
    const buffedStepped = stepUntil(buffedState, buffedRuntime, [buffedCaster, ally, buffedVictim], 15, (s) => s.players[B]!.health < 100);
    buffedState = buffedStepped.state;
    const buffedDealt = 100 - buffedState.players[B]!.health;
    expect(buffedDealt).toBeGreaterThan(soloDealt);
  });

  // D3 brake (docs/axiom-deviations-audit.md's Syzygist entry — see
  // `syzygistLeadBrakeMultiplier`'s doc comment in World.ts). Flock Pulse's
  // per-source bonus is the OTHER half of the shared Devotion/Flock Pulse
  // mechanism this fix braked; this proves the bonus itself genuinely tapers
  // with in-round kill lead, using the identical single-source setup as the
  // "Entangled version" case just above (so the unbraked figure here IS
  // that test's `buffedDealt`, re-derived independently as a before/after).
  test("Flock Pulse: D3 brake — the SAME single-source nova hits softer once the caster has an in-round kill lead, and never below the base", () => {
    const mkScenario = (roundKills?: Record<PlayerId, number>) => {
      const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["flock-pulse"], teamId: "t1" });
      const ally = mkPlayer(PlayerId("ally"), 300, 400, "shielded", { teamId: "t1" });
      const victim = mkPlayer(B, 440, 400, "balanced");
      let state = mkState([caster, ally, victim]);
      if (roundKills) {
        state = { ...state, round: { ...state.round, roundKills } };
      }
      applyRegenToAlly(caster, ally, state.players, state.tick, 6, 600);
      const runtime = createRuntime(flatMap);
      let res = stepWithRuntime(state, runtime, inputsWith([caster, ally, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
      state = res.state;
      const stepped = stepUntil(state, runtime, [caster, ally, victim], 15, (s) => s.players[B]!.health < 100);
      return 100 - stepped.state.players[B]!.health;
    };

    // No round-kill picture at all — today's OLD unbraked math, unchanged.
    const unbrakedDealt = mkScenario(undefined);
    expect(unbrakedDealt).toBeCloseTo(
      SYZ_FLOCK_PULSE_BASE_DAMAGE + SYZ_FLOCK_PULSE_PER_SOURCE_DAMAGE,
      0,
    );

    // Caster is 3 kills ahead of the round's other alive players (the ally
    // sits at 0) — same single buffed ally, same source count, only the
    // round-kill picture differs.
    const brakedDealt = mkScenario({ [A]: 3 } as Record<PlayerId, number>);
    expect(brakedDealt).toBeCloseTo(
      SYZ_FLOCK_PULSE_BASE_DAMAGE + SYZ_FLOCK_PULSE_PER_SOURCE_DAMAGE * SYZ_SNOWBALL_BRAKE_FLOOR,
      0,
    );
    expect(brakedDealt).toBeLessThan(unbrakedDealt);
    // The base nova is NEVER braked away — a snowballing Syzygist's Flock
    // Pulse still always does at least SYZ_FLOCK_PULSE_BASE_DAMAGE.
    expect(brakedDealt).toBeGreaterThanOrEqual(SYZ_FLOCK_PULSE_BASE_DAMAGE);
  });

  test("Self-Lattice: opens a weak self-ward absorb pool", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["self-lattice"] });
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(res.state.players[A]!.wardAbsorbRemaining).toBe(SYZ_SELF_LATTICE_ABSORB);
    expect(res.state.players[A]!.wardAbsorbSourceId).toBe(A);
  });

  test("Glass Ward: auto-targets the nearest ally for a stronger absorb pool", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["glass-ward"], teamId: "t1" });
    const ally = mkPlayer(B, 460, 400, "shielded", { teamId: "t1" });
    let state = mkState([caster, ally]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, ally], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[B]!.wardAbsorbRemaining).toBe(SYZ_GLASS_WARD_ALLY_ABSORB);
    expect(res.state.players[B]!.wardAbsorbSourceId).toBe(A);
    expect(res.state.players[A]!.wardAbsorbRemaining ?? 0).toBe(0); // not self-warded when an ally exists
  });

  test("Glass Ward: falls back to a WEAKER self-cast when no ally is in range", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["glass-ward"] });
    let state = mkState([caster]); // alone
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(res.state.players[A]!.wardAbsorbRemaining).toBe(SYZ_GLASS_WARD_SELF_FALLBACK_ABSORB);
    expect(SYZ_GLASS_WARD_SELF_FALLBACK_ABSORB).toBeLessThan(SYZ_GLASS_WARD_ALLY_ABSORB);
  });

  test("Haste Gift: auto-targets the nearest ally for full haste", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["haste-gift"], teamId: "t1" });
    const ally = mkPlayer(B, 460, 400, "shielded", { teamId: "t1" });
    let state = mkState([caster, ally]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, ally], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[B]!.hasteMultiplier).toBe(SYZ_HASTE_MULTIPLIER_DEFAULT);
    expect(res.state.players[B]!.hasteSourceId).toBe(A);
  });

  test("Haste Gift: self-casts at HALF strength when solo", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["haste-gift"] });
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(res.state.players[A]!.hasteMultiplier).toBe(SYZ_HASTE_GIFT_SELF_MULTIPLIER);
    expect(SYZ_HASTE_GIFT_SELF_MULTIPLIER).toBeLessThan(SYZ_HASTE_MULTIPLIER_DEFAULT);
    expect(SYZ_HASTE_GIFT_SELF_MULTIPLIER).toBeGreaterThan(1);
  });

  test("Drift Step: aim-directed reposition within SYZ_DRIFT_STEP_RANGE_PX", () => {
    const caster = mkPlayer(A, 400, 400, "shielded", { cards: ["drift-step"] });
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 900, 400) }), DT_MS,
    );
    const moved = res.state.players[A]!;
    const dist = Math.hypot(moved.x - 400, moved.y - 400);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThanOrEqual(SYZ_DRIFT_STEP_RANGE_PX + 1);
  });
});

describe("Syzygist catalog v1 — classId gating on sim effects", () => {
  test("a non-priest (wizard) holding a Syzygist card directly can still cast it — the amp CONSUMPTION site is what's gated (Focus Hex mirrors Facet Break's own defense-in-depth precedent)", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced", { cards: ["focus-hex"] });
    const victim = mkPlayer(B, 460, 400, "balanced");
    const state = mkState([wizard, victim]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([wizard, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    // The mark itself lands (the generic activation switch has no classId
    // gate — offer-roll IS the gate). What matters for correctness is that
    // the mark's AMP still composes fine even off-class (harmless — no
    // regression, just an unreachable-via-normal-play state).
    expect(res.state.players[A]!.focusHexTargetId).toBe(B);
  });
});
