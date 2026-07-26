// Interstice catalog v1 (docs/class-ability-catalogs-v1.md) — the ninja's
// class ability catalog, plugged into the EXISTING six-axes rack/draft
// substrate (docs/six-axes-goal.md) and the Geometrician/Kindled/Syzygist
// catalogs' own activation-switch pattern. All 10 of the doc's 10 abilities
// are now wired — "paper-double" (movement, the decoy) shipped as its own
// fast-follow pass once its blocking dependency (a new decoy/summon entity
// type in WorldState) was actually built; see cardTypes.ts's own updated
// header comment and types.ts's `PaperDoubleEntity` for the full shape, and
// this file's own "Paper Double" describe block below (separate from the
// other 9's shared describe block since it drives a different substrate —
// `state.paperDoubles`, not a caster-side window/mark field).
//
// Coverage, mirroring syzygistCatalog.test.ts's own shape:
//   (1) data authoring — all 10 cards exist as classId:"ninja" ability
//       cards wired to their AbilityKind, with role coverage across all six
//       roles.
//   (2) offer-roll classId gating — only a ninja (sprinter) ever sees these;
//       every other chassis never does, and a ninja never sees a foreign
//       catalog offer either.
//   (3) rack fill via the existing resolvePlayerBuild mechanism.
//   (4) representative v1 sim-effect tests for each of the 9 window/mark
//       abilities — these drive the REAL NINJA MELEE FSM (windup/active/
//       recovery), mirroring ninjaMelee.test.ts's own fixture conventions,
//       since Undercut/Edge Storm/Read Mark/Second Wind/Razor Route are all
//       consumed at that FSM's own hit/wave/dash-through sites, not by the
//       generic activation switch alone. Paper Double's own sim-effect
//       tests live in the dedicated describe block below (spawn/move/
//       damageable/expire/burst — a decoy entity, not a window/mark).
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
  NINJA_PAPER_DOUBLE_SPEED,
  NINJA_PAPER_DOUBLE_MAX_HEALTH,
  NINJA_PAPER_DOUBLE_LIFETIME_MS,
  NINJA_PAPER_DOUBLE_SWAP_MAX_DISPLACEMENT_PX,
  NINJA_FOOLED_DAMAGE_MULTIPLIER,
} from "../constants.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type InputBitfield,
  type InputFrame,
  type MapDefinition,
  type PaperDoubleEntity,
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
  "paper-double",
] as const;

// Commit-frame constants mirrored from World.ts, same precedent as
// ninjaMelee.test.ts's own local copies (SLASH_WINDUP_MS=60,
// SLASH_CONTACT_DELAY_MS=22, SLASH_ACTIVE_MS=45 — halved 2026-07-20
// alongside SLASH_DAMAGE, same DPS, twice the cadence).
const WINDUP_TICKS = Math.ceil(60 / DT_MS);
const CONTACT_TICKS = Math.ceil(22 / DT_MS);
const ACTIVE_TICKS = Math.ceil(45 / DT_MS);

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
  test("all 10 wired catalog abilities exist as classId:'ninja' ability cards", () => {
    for (const id of NINJA_ABILITY_IDS) {
      const card = ninjaCard(id);
      expect(card.classId).toBe("ninja");
      expect(card.active).toBeDefined();
      expect(card.active?.kind).toBe(id);
      expect(card.category).toBe("ability");
    }
  });

  // Formerly "paper-double does NOT exist as a card — recorded deferral,
  // not a silent stub" (asserted `crystalRoundsCards.find(... "paper-
  // double") toBeUndefined()`). Flipped now that it's shipped — the
  // deferral itself is still on record (cardTypes.ts's own updated header
  // comment preserves the original paragraph rather than deleting it), this
  // test just needs to assert the opposite fact now that the card is real.
  test("paper-double exists as a card and is correctly shaped (rare, exclusive-ninja, movement, no energy-cost field — matches every other catalog ability's 'nothing SPENDS energy yet' contract)", () => {
    const card = ninjaCard("paper-double");
    expect(card.classId).toBe("ninja");
    expect(card.rarity).toBe("rare");
    expect(card.category).toBe("ability");
    expect(card.role).toBe("movement");
    expect(card.active?.kind).toBe("paper-double");
    expect(card.active?.cooldownMs).toBe(9000);
    // No durationMs — unlike the window/mark abilities, Paper Double's
    // "window" IS the spawned decoy's own lifetime, not a caster-side timer.
    expect(card.active?.durationMs).toBeUndefined();
  });

  test("role coverage across all 10 abilities: all six locked roles present", () => {
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

  test("a ninja NEVER sees a Kindled/Geometrician/Syzygist catalog offer — the gate is symmetric", () => {
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
    // 2026-07-20: SLASH_DAMAGE dropped 22 -> 11 (balance pass — same DPS,
    // twice the cadence). This test's title always claimed "survives," but
    // the old 22 damage actually overkilled the 15-health threshold victim
    // anyway (a known, previously-flagged imprecision — the old comment
    // here said "use a slightly higher starting health to actually
    // distinguish 'execute' from 'would have died anyway'"). 11 < 15 made
    // the title true for the first time: a normal hit genuinely doesn't
    // execute-kill a threshold-health target absent the Undercut card.
    // 2026-07-26 balance pass (finish-line-goal.md Track B): SLASH_DAMAGE
    // bumped again, 11->14 — still < 15, so this still holds (by a single
    // point now, not four).
    expect(after.players[B]!.alive).toBe(true);
    expect(after.players[B]!.health).toBe(NINJA_UNDERCUT_HEALTH_THRESHOLD - 14);
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

// Paper Double drives a different substrate than the 9 tests above (a
// spawned `state.paperDoubles` entity, not a caster-side window/mark field
// on PlayerEntity) — its own describe block, own fixture shapes.
describe("Interstice catalog v1 — Paper Double (decoy entity)", () => {
  test("casting spawns a decoy entity owned by the caster, at the caster's position, at full health", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double"],
      vx: 0,
      vy: 0,
      aimX: 500,
      aimY: 400,
    });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 500, 400) }),
      DT_MS,
    );
    const doubles = Object.values(res.state.paperDoubles ?? {});
    expect(doubles.length).toBe(1);
    expect(doubles[0]!.ownerId).toBe(A);
    expect(doubles[0]!.health).toBe(NINJA_PAPER_DOUBLE_MAX_HEALTH);
    // ability-activated fires generically for every case (World.ts's
    // post-switch resonance block) — same event every other catalog
    // ability gets, kind-tagged "paper-double".
    expect(res.events.some((e) => e.t === "ability-activated" && (e as { kind: string }).kind === "paper-double")).toBe(true);
  });

  test("a stationary caster's decoy runs along the FALLBACK aim direction (v1's documented 'no real movement input' case)", () => {
    // vx/vy both 0 — below NINJA_PAPER_DOUBLE_STATIONARY_SPEED_PX — so the
    // heading falls back to aim direction (World.ts's own case comment).
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double"],
      vx: 0,
      vy: 0,
      aimX: 400, // pointing straight "up" (aim is a world point above the caster)
      aimY: 100,
    });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 400, 100) }),
      DT_MS,
    );
    const pd = Object.values(res.state.paperDoubles ?? {})[0]!;
    expect(pd.vx).toBeCloseTo(0, 1);
    expect(pd.vy).toBeCloseTo(-NINJA_PAPER_DOUBLE_SPEED, 1); // world -y is "up"
  });

  test("the decoy sprints in a straight line at NINJA_PAPER_DOUBLE_SPEED — it keeps moving even after the caster's own velocity changes", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double"],
      vx: 300,
      vy: 0,
    });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    const pd0 = Object.values(s1.state.paperDoubles ?? {})[0]!;
    expect(pd0.vx).toBeCloseTo(NINJA_PAPER_DOUBLE_SPEED, 1);
    expect(pd0.vy).toBeCloseTo(0, 1);

    const ticks = 20;
    const stepped = stepIdle(s1.state, runtime, [caster], ticks).state;
    const pd1 = Object.values(stepped.paperDoubles ?? {})[0]!;
    const expectedDx = NINJA_PAPER_DOUBLE_SPEED * ((ticks * DT_MS) / 1000);
    expect(pd1.x - pd0.x).toBeCloseTo(expectedDx, 0);
    expect(pd1.y).toBeCloseTo(pd0.y, 1); // pure +x heading, no drift
  });

  test("a projectile hit damages the decoy without killing it (sub-lethal enemy weapon fire)", () => {
    // Hand-authors `state.paperDoubles` directly (same pattern the AOE-
    // burst test below uses) rather than casting it live in the same tick
    // as the shot — keeps this test about "does a sub-lethal projectile hit
    // correctly damage without killing the decoy", not about cast/spawn-race
    // timing. Wizard's basic shot is true hitscan again (THE GEOMETRICIAN
    // RULING, 2026-07-24, weapons.ts — the 2026-07-22 projectile revert was
    // a misread of Jake's intent), so the hit lands on the very first fire
    // tick and stepUntil's predicate is satisfied immediately; the
    // stepUntil FORM is deliberately kept (delivery-agnostic — it would
    // still pass for any traveling shot within the 30-tick budget) rather
    // than re-pinning the test to same-tick resolution.
    const caster = mkPlayer(A, 50, 50, "sprinter");
    const shooter = mkPlayer(B, 460, 400, "balanced", { aimX: 400, aimY: 400 });
    const pdId = EntityId(1);
    const state: WorldState = {
      ...mkState([caster, shooter]),
      paperDoubles: {
        [pdId]: {
          id: pdId,
          ownerId: A,
          x: 400,
          y: 400,
          vx: 0,
          vy: 0,
          health: NINJA_PAPER_DOUBLE_MAX_HEALTH,
          remainingMs: NINJA_PAPER_DOUBLE_LIFETIME_MS,
        },
      },
    };
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, shooter], { [B as string]: frame(FIRE_BIT, 1, 400, 400) }),
      DT_MS,
    );
    const stepped = stepUntil(
      s1.state,
      runtime,
      [caster, shooter],
      30,
      (s) => Object.values(s.paperDoubles ?? {}).some((pd) => pd.health < NINJA_PAPER_DOUBLE_MAX_HEALTH),
    );
    const doubles = Object.values(stepped.paperDoubles ?? {});
    expect(doubles.length).toBe(1); // damaged, not killed
    expect(doubles[0]!.health).toBe(NINJA_PAPER_DOUBLE_MAX_HEALTH - 12);
  });

  test("melee lands on and damages a decoy, but no longer one-shots it (SLASH_DAMAGE 14 < 20)", () => {
    // A casts, decoy runs +x toward B. B (also ninja — this arc-hit-check
    // has no classId gate, but a swing needs the ninja melee FSM to reach
    // it at all) is positioned so the decoy enters B's slash arc well
    // within the active window (see this test file's own header-comment
    // math for the geometry).
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double"],
      vx: 0,
      vy: 0,
      aimX: 500,
      aimY: 400,
    });
    const attacker = mkPlayer(B, 500, 400, "sprinter", { aimX: 400, aimY: 400 });
    const state = mkState([caster, attacker]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, attacker], {
        [A as string]: frame(SLOT1_BIT, 1, 500, 400),
        [B as string]: frame(FIRE_BIT, 1, 400, 400),
      }),
      DT_MS,
    );
    const after = stepIdle(s1.state, runtime, [caster, attacker], WINDUP_TICKS + ACTIVE_TICKS + 2).state;
    // Pre-2026-07-20 this popped in one hit (SLASH_DAMAGE was 22 >= the
    // decoy's doc-specified 20 max health, constants.ts's own "Lives 2.5s
    // or 20 damage" — an independently-tuned number, not intentionally
    // paired with ninja's own slash damage, so it wasn't touched by either
    // balance pass). SLASH_DAMAGE is now 14 (2026-07-26 balance pass,
    // finish-line-goal.md Track B) — still < 20 — damaged, not killed.
    const doubles = Object.values(after.paperDoubles ?? {});
    expect(doubles.length).toBe(1);
    expect(doubles[0]!.health).toBe(NINJA_PAPER_DOUBLE_MAX_HEALTH - 14);
  });

  test("a decoy's death (lethal projectile fire) bursts AOE damage on a nearby bystander, without hitting whoever's far off the shot's own path", () => {
    // Hand-authors `state.paperDoubles` directly (bypassing the cast flow —
    // already proven separately above) so the decoy's position is fully
    // controlled and independent of caster/attacker placement. Low starting
    // health (5) so ONE starter-pistol shot (12 dmg) overkills it cleanly.
    // The bystander sits 80px BELOW the decoy — inside
    // NINJA_PAPER_DOUBLE_BURST_RADIUS_PX (90) of the decoy — but the
    // shooter's own shot travels along a straight horizontal line toward
    // the decoy and never comes near the bystander's position, so any
    // damage the bystander takes can only be the decoy's own burst.
    // The decoy's owner (A) must still exist as a live player —
    // `resolveInstantAoeCasts` looks the caster up by id (`players[cast.
    // casterId]`) before resolving the burst, same "caster must still be
    // present" contract every other pendingInstantAoe consumer already has
    // — so A is included here too, far off in a corner, taking no actions.
    const caster = mkPlayer(A, 50, 50, "sprinter");
    const shooter = mkPlayer(B, 660, 400, "balanced", { aimX: 600, aimY: 400 });
    const C = PlayerId("c");
    const bystander = mkPlayer(C, 600, 480, "balanced");
    const pdId = EntityId(1);
    const handAuthoredDouble: PaperDoubleEntity = {
      id: pdId,
      ownerId: A,
      x: 600,
      y: 400,
      vx: 0,
      vy: 0,
      health: 5,
      remainingMs: NINJA_PAPER_DOUBLE_LIFETIME_MS,
    };
    const state: WorldState = {
      ...mkState([caster, shooter, bystander]),
      paperDoubles: { [pdId]: handAuthoredDouble },
    };
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, shooter, bystander], { [B as string]: frame(FIRE_BIT, 1, 600, 400) }),
      DT_MS,
    );
    const after = stepUntil(
      s1.state,
      runtime,
      [caster, shooter, bystander],
      20,
      (s) => Object.keys(s.paperDoubles ?? {}).length === 0,
    );
    expect(Object.keys(after.paperDoubles ?? {}).length).toBe(0); // popped
    // Caught the burst — exactly NINJA_PAPER_DOUBLE_BURST_DAMAGE (10), not
    // some multiple and not zero (the shot itself never reached C).
    expect(100 - after.players[C]!.health).toBeCloseTo(10, 1);
  });

  test("expires after ~2.5s if never damaged (no burst-radius bystander needed to prove the timer itself)", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double"],
      vx: 0,
      vy: 0,
      aimX: 500,
      aimY: 400,
    });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 500, 400) }),
      DT_MS,
    );
    expect(Object.keys(s1.state.paperDoubles ?? {}).length).toBe(1);
    // ~1.67s in — well short of the 2.5s lifetime, still alive.
    const midway = stepIdle(s1.state, runtime, [caster], 100).state;
    expect(Object.keys(midway.paperDoubles ?? {}).length).toBe(1);
    // Well past 2.5s total (180 ticks * 16.667ms ≈ 3.0s).
    const afterExpiry = stepIdle(midway, runtime, [caster], 80).state;
    expect(Object.keys(afterExpiry.paperDoubles ?? {}).length).toBe(0);
  });

  test("cooldown gates re-casting — CD (9s) exceeds max decoy lifetime (2.5s), so a caster can never have two overlapping decoys in practice", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", { cards: ["paper-double"] });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(state, runtime, inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS);
    expect(s1.state.players[A]!.slot1CooldownUntilTick).toBeDefined();
    // A second press one tick later (still on cooldown) spawns nothing new.
    const s2 = stepWithRuntime(
      s1.state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 2) }),
      DT_MS,
    );
    expect(Object.keys(s2.state.paperDoubles ?? {}).length).toBe(1); // still just the one
  });
});

// Two 2026-07-19 fast-follow gaps closed (docs/card-pool-v2.md's
// "Resonance:" line, cardTypes.ts's own long-standing "STILL a v1 gap"
// note): the window-gated position swap, and the Fooled victim debuff.
describe("Interstice catalog v1 — Paper Double resonance swap", () => {
  test("casting into a live resonance window (opened by a DIFFERENT ability) with a live own-decoy swaps positions instead of spawning a new decoy", () => {
    const decoyId = EntityId(1);
    const decoy: PaperDoubleEntity = {
      id: decoyId,
      ownerId: A,
      x: 700,
      y: 400,
      vx: 50,
      vy: 0,
      health: NINJA_PAPER_DOUBLE_MAX_HEALTH,
      remainingMs: NINJA_PAPER_DOUBLE_LIFETIME_MS,
    };
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double", "recoil-step"],
      // Simulates a PRIOR different-ability cast having just opened the
      // resonance window (resonance.test.ts's own "same ability twice does
      // NOT resonate" test uses this identical direct-authoring technique).
      resonanceUntilTick: Tick(1000),
      resonanceSourceKind: "recoil-step",
    });
    const state: WorldState = {
      ...mkState([caster]),
      tick: Tick(500),
      paperDoubles: { [decoyId]: decoy },
    };
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );

    // No SECOND decoy spawned — still exactly the one.
    expect(Object.keys(res.state.paperDoubles ?? {}).length).toBe(1);
    // Caster teleported to the decoy's OLD position.
    expect(res.state.players[A]!.x).toBeCloseTo(700, 0);
    expect(res.state.players[A]!.y).toBeCloseTo(400, 0);
    // Decoy now sits at the caster's OLD position (this tick's movement
    // hasn't been applied to it yet at the moment of the swap itself, but
    // stepPaperDoubles runs immediately after within the same tick, so
    // allow for one tick's worth of its own vx=50 drift).
    const movedDecoy = Object.values(res.state.paperDoubles ?? {})[0]!;
    expect(movedDecoy.x).toBeCloseTo(400 + 50 * (DT_MS / 1000), 0);
    expect(movedDecoy.y).toBeCloseTo(400, 0);
    // Resonance's own generic bonus still applies on top (a CD refund +
    // resonance-triggered event) — the swap replaces the SPAWN, not the
    // resonance consumption itself.
    expect(res.events.some((e) => e.t === "resonance-triggered")).toBe(true);
  });

  test("casting into a live resonance window with NO live own-decoy falls back to an ordinary spawn", () => {
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double", "recoil-step"],
      resonanceUntilTick: Tick(1000),
      resonanceSourceKind: "recoil-step",
      vx: 0,
      vy: 0,
      aimX: 500,
      aimY: 400,
    });
    const state: WorldState = { ...mkState([caster]), tick: Tick(500) };
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 500, 400) }),
      DT_MS,
    );
    const doubles = Object.values(res.state.paperDoubles ?? {});
    expect(doubles.length).toBe(1);
    expect(doubles[0]!.ownerId).toBe(A);
    // The caster did NOT teleport — an ordinary spawn-in-place cast.
    expect(res.state.players[A]!.x).toBeCloseTo(400, 0);
  });

  test("casting the SAME kind twice in a row never resonates — never swaps (chains unlike abilities only)", () => {
    // A distinct, out-of-range id — this test's own cast allocates a FRESH
    // decoy id via allocId() (starting at 1 on a brand-new runtime), which
    // would otherwise collide with a hand-authored EntityId(1) and silently
    // overwrite it at the same paperDoubles key.
    const decoyId = EntityId(9001);
    const decoy: PaperDoubleEntity = {
      id: decoyId,
      ownerId: A,
      x: 700,
      y: 400,
      vx: 0,
      vy: 0,
      health: NINJA_PAPER_DOUBLE_MAX_HEALTH,
      remainingMs: NINJA_PAPER_DOUBLE_LIFETIME_MS,
    };
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double"],
      resonanceUntilTick: Tick(1000),
      resonanceSourceKind: "paper-double", // the SAME kind opened the window
      vx: 0,
      vy: 0,
      aimX: 500,
      aimY: 400,
    });
    const state: WorldState = {
      ...mkState([caster]),
      tick: Tick(500),
      paperDoubles: { [decoyId]: decoy },
    };
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 500, 400) }),
      DT_MS,
    );
    // A second, fresh decoy spawned — the swap never triggered.
    expect(Object.keys(res.state.paperDoubles ?? {}).length).toBe(2);
    expect(res.state.players[A]!.x).toBeCloseTo(400, 0); // no teleport
  });

  test("the swap distance is capped at NINJA_PAPER_DOUBLE_SWAP_MAX_DISPLACEMENT_PX — never a free cross-map blink", () => {
    const decoyId = EntityId(1);
    const farX = 400 + NINJA_PAPER_DOUBLE_SWAP_MAX_DISPLACEMENT_PX * 3; // well past the cap
    const decoy: PaperDoubleEntity = {
      id: decoyId,
      ownerId: A,
      x: farX,
      y: 400,
      vx: 0,
      vy: 0,
      health: NINJA_PAPER_DOUBLE_MAX_HEALTH,
      remainingMs: NINJA_PAPER_DOUBLE_LIFETIME_MS,
    };
    const caster = mkPlayer(A, 400, 400, "sprinter", {
      cards: ["paper-double", "recoil-step"],
      resonanceUntilTick: Tick(1000),
      resonanceSourceKind: "recoil-step",
    });
    const state: WorldState = {
      ...mkState([caster]),
      tick: Tick(500),
      paperDoubles: { [decoyId]: decoy },
    };
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    const traveled = res.state.players[A]!.x - 400;
    expect(traveled).toBeCloseTo(NINJA_PAPER_DOUBLE_SWAP_MAX_DISPLACEMENT_PX, 0);
    expect(traveled).toBeLessThan(farX - 400);
  });
});

describe("Interstice catalog v1 — Paper Double Fooled debuff", () => {
  test("the burst leaves Fooled on caught victims, amplifying the NEXT ability hit against them", () => {
    // Low-health hand-authored decoy (bypassing the cast flow, same
    // technique the existing burst test above uses) so one shot pops it
    // and its burst catches a nearby victim.
    const decoyId = EntityId(1);
    const decoy: PaperDoubleEntity = {
      id: decoyId,
      ownerId: A,
      x: 600,
      y: 400,
      vx: 0,
      vy: 0,
      health: 5,
      remainingMs: NINJA_PAPER_DOUBLE_LIFETIME_MS,
    };
    const owner = mkPlayer(A, 50, 50, "sprinter"); // far off, inert
    const shooter = mkPlayer(B, 660, 400, "balanced", { aimX: 600, aimY: 400 });
    const C = PlayerId("c");
    const victim = mkPlayer(C, 600, 480, "balanced"); // inside the burst radius
    const state: WorldState = {
      ...mkState([owner, shooter, victim]),
      paperDoubles: { [decoyId]: decoy },
    };
    const runtime = createRuntime(flatMap);
    const s1 = stepWithRuntime(
      state,
      runtime,
      inputsWith([owner, shooter, victim], { [B as string]: frame(FIRE_BIT, 1, 600, 400) }),
      DT_MS,
    );
    const afterBurst = stepUntil(
      s1.state,
      runtime,
      [owner, shooter, victim],
      20,
      (s) => Object.keys(s.paperDoubles ?? {}).length === 0,
    );
    expect(afterBurst.players[C]!.fooledUntilTick).toBeDefined();
    expect((afterBurst.players[C]!.fooledUntilTick as number) > afterBurst.tick).toBe(true);

    // A SECOND, otherwise-identical shot from B against the now-Fooled C
    // must deal MORE damage than the SAME shot fired from the SAME evolved
    // state (identical rngState/round/chaos context — the only thing that
    // differs between the two branches below is C's own fooledUntilTick)
    // against an otherwise-identical, un-fooled control. Branching from one
    // shared post-burst state (rather than a wholly separate fresh
    // scenario) rules out chaos-modifier/rngState drift as a confound.
    const healthBeforeSecondShot = afterBurst.players[C]!.health;
    const shooterState2 = { ...afterBurst.players[B]!, fireCooldownMs: 0, ammo: 5 };

    const fireSecondShotAt = (victimAfterBurst: PlayerEntity) => {
      const stateForSecondShot: WorldState = {
        ...afterBurst,
        players: { ...afterBurst.players, [B]: shooterState2, [C]: victimAfterBurst },
      };
      const s2 = stepWithRuntime(
        stateForSecondShot,
        runtime,
        inputsWith([owner, shooterState2, victimAfterBurst], { [B as string]: frame(FIRE_BIT, 2, 600, 480) }),
        DT_MS,
      );
      const afterSecondShot = stepUntil(
        s2.state,
        runtime,
        [owner, shooterState2, victimAfterBurst],
        20,
        (s) => s.players[C]!.health < healthBeforeSecondShot,
      );
      return healthBeforeSecondShot - afterSecondShot.players[C]!.health;
    };

    const fooledDamage = fireSecondShotAt(afterBurst.players[C]!);
    const unfooledDamage = fireSecondShotAt({ ...afterBurst.players[C]!, fooledUntilTick: undefined });

    expect(fooledDamage).toBeCloseTo(unfooledDamage * NINJA_FOOLED_DAMAGE_MULTIPLIER, 0);
  });

  test("Fooled expires after its duration — no amp on a hit landing after the window closes", () => {
    // Hand-authors fooledUntilTick directly (bypassing the burst — already
    // proven separately above) at a tick that has already passed by the
    // time the shot resolves.
    const shooter = mkPlayer(B, 460, 400, "balanced", { aimX: 400, aimY: 400 });
    const victim = mkPlayer(A, 400, 400, "balanced", { fooledUntilTick: Tick(1) });
    const state: WorldState = { ...mkState([shooter, victim]), tick: Tick(500) };
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([shooter, victim], { [B as string]: frame(FIRE_BIT, 1, 400, 400) }),
      DT_MS,
    );
    const afterShot = stepUntil(res.state, runtime, [shooter, victim], 20, (s) => s.players[A]!.health < 100);
    const expiredDamage = 100 - afterShot.players[A]!.health;

    const controlShooter = mkPlayer(B, 460, 400, "balanced", { aimX: 400, aimY: 400 });
    const controlVictim = mkPlayer(A, 400, 400, "balanced"); // never fooled
    const controlRuntime = createRuntime(flatMap);
    const controlRes = stepWithRuntime(
      mkState([controlShooter, controlVictim]),
      controlRuntime,
      inputsWith([controlShooter, controlVictim], { [B as string]: frame(FIRE_BIT, 1, 400, 400) }),
      DT_MS,
    );
    const controlAfter = stepUntil(controlRes.state, controlRuntime, [controlShooter, controlVictim], 20, (s) => s.players[A]!.health < 100);
    const controlDamage = 100 - controlAfter.players[A]!.health;

    expect(expiredDamage).toBeCloseTo(controlDamage, 5); // no amp — window already closed
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
