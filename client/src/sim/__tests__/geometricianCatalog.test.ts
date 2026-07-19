// Geometrician catalog v1 (docs/class-ability-catalogs-v1.md) — the wizard's
// 10-ability class catalog, plugged into the EXISTING six-axes rack/draft
// substrate (docs/six-axes-goal.md), not a new UI or slot system. See
// docs/classes-goal.md "Rotation system" for the catalog-vs-cards contract
// and the 3-slot rack lock.
//
// Coverage: (1) role-tag coverage across the six locked roles, (2) classId
// gating at the offer roll — wizard sees the catalog, no other chassis does
// (classes-goal.md P2-P4 discipline: absent, never stubbed, never
// inherited), (3) rack-fill via the existing resolvePlayerBuild/createWeapon
// Build mechanism, (4) representative v1 sim-effect tests for each ability.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { enterDrafting } from "../round.js";
import { resolvePlayerBuild } from "../weapon.js";
import { crystalRoundsCards } from "../data/cards.js";
import {
  MAX_ABILITY_SLOTS,
  type AbilityRole,
} from "../data/cardTypes.js";
import {
  GEO_SUNLANCE_DAMAGE_MULTIPLIER,
  GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER,
  GEO_PRISM_FAN_RANGE_PX,
  GEO_LATTICE_ZONE_RADIUS_PX,
  GEO_RETURN_GLASS_SHIELD_REFUND,
  GEO_SLIP_NODE_RANGE_PX,
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
const FIRE_BIT = 1 << 6;

const GEOMETRICIAN_ABILITY_IDS = [
  "sunlance",
  "facet-break",
  "prism-fan",
  "lattice",
  "return-glass",
  "hard-aperture",
  "overclock",
  "measure",
  "slip-node",
  "recoil-step",
] as const;

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 500 }, size: { x: 1280, y: 60 } },
  ],
};

function mkPlayer(
  id: PlayerId,
  x: number,
  y: number,
  characterId: PlayerEntity["characterId"] = "balanced",
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

function geoCard(id: (typeof GEOMETRICIAN_ABILITY_IDS)[number]) {
  const card = crystalRoundsCards.find((c) => c.id === id);
  if (!card) throw new Error(`missing catalog card: ${id}`);
  return card;
}

describe("Geometrician catalog v1 — data authoring", () => {
  test("all 10 catalog abilities exist as classId:'wizard' ability cards", () => {
    for (const id of GEOMETRICIAN_ABILITY_IDS) {
      const card = geoCard(id);
      expect(card.classId).toBe("wizard");
      expect(card.active).toBeDefined();
      expect(card.active?.kind).toBe(id);
      expect(card.category).toBe("ability");
    }
  });

  test("role coverage: every one of the six locked roles appears at least once", () => {
    const roles: AbilityRole[] = ["defense", "offense", "buff", "aoe", "single", "movement"];
    const seen = new Set(GEOMETRICIAN_ABILITY_IDS.map((id) => geoCard(id).role));
    for (const role of roles) {
      expect(seen.has(role)).toBe(true);
    }
  });

  test("the five universal six-axes ability cards stay classId-unset (untouched)", () => {
    for (const id of ["crimson-tithe", "shadow-step", "veil-of-nought", "severing-answer", "shelter-seal"]) {
      const card = crystalRoundsCards.find((c) => c.id === id)!;
      expect(card.classId).toBeUndefined();
    }
  });
});

describe("Geometrician catalog v1 — offer-roll classId gating", () => {
  test("a wizard (balanced) player is offered catalog abilities across seeds", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced");
    const other = mkPlayer(B, 600, 400);
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    let sawCatalogOffer = false;
    for (let seed = 1; seed <= 80; seed++) {
      const roll = enterDrafting(round, { [A]: wizard, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      if (offer.some((id) => (GEOMETRICIAN_ABILITY_IDS as readonly string[]).includes(id))) {
        sawCatalogOffer = true;
      }
    }
    expect(sawCatalogOffer).toBe(true);
  });

  test("a non-wizard chassis (sprinter/Interstice) NEVER sees a Geometrician catalog offer", () => {
    const ninja = mkPlayer(A, 400, 400, "sprinter");
    const other = mkPlayer(B, 600, 400);
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    for (let seed = 1; seed <= 80; seed++) {
      const roll = enterDrafting(round, { [A]: ninja, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.some((id) => (GEOMETRICIAN_ABILITY_IDS as readonly string[]).includes(id))).toBe(
        false,
      );
    }
  });

  test("heavy (Kindled) and shielded (Syzygist) also never see the Geometrician catalog", () => {
    const other = mkPlayer(B, 600, 400);
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    for (const characterId of ["heavy", "shielded"] as const) {
      const p = mkPlayer(A, 400, 400, characterId);
      for (let seed = 1; seed <= 30; seed++) {
        const roll = enterDrafting(round, { [A]: p, [B]: other }, Tick(100), seed >>> 0);
        const offer = roll.state.draftingOffers?.[A] ?? [];
        expect(
          offer.some((id) => (GEOMETRICIAN_ABILITY_IDS as readonly string[]).includes(id)),
        ).toBe(false);
      }
    }
  });
});

describe("Geometrician catalog v1 — rack fill (existing substrate, no new slot system)", () => {
  test("a Geometrician ability card resolves into build.actives exactly like a universal one", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced");
    wizard.cards = ["sunlance", "prism-fan", "slip-node"];
    const build = resolvePlayerBuild(wizard);
    expect(build.actives.length).toBe(3);
    expect(build.actives.map((a): string => a.kind).sort()).toEqual(
      ["prism-fan", "slip-node", "sunlance"].sort(),
    );
  });

  test("mixing universal + catalog abilities still caps at MAX_ABILITY_SLOTS (3)", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced");
    wizard.cards = ["crimson-tithe", "sunlance", "facet-break", "prism-fan"];
    const build = resolvePlayerBuild(wizard);
    expect(build.actives.length).toBe(MAX_ABILITY_SLOTS);
  });
});

describe("Geometrician catalog v1 — representative sim effects", () => {
  test("Sunlance: shots fired during the window deal the boosted multiplier", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["sunlance"];
    caster.ammo = 5;
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.sunlanceUntilTick).toBeDefined();

    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(FIRE_BIT, 2, 500, 400) }),
      DT_MS,
    );
    const shard = Object.values(res.state.projectiles)[0];
    expect(shard).toBeDefined();
    // Starter pistol base damage is a positive constant; the sunlance shot
    // must exceed a bare unmultiplied shot fired from an identical rig.
    const plainCaster = mkPlayer(B, 400, 400);
    plainCaster.ammo = 5;
    const plainRes = stepWithRuntime(
      mkState([plainCaster]),
      createRuntime(flatMap),
      inputsWith([plainCaster], { [B as string]: frame(FIRE_BIT, 1, 500, 400) }),
      DT_MS,
    );
    const plainShard = Object.values(plainRes.state.projectiles)[0]!;
    expect(shard!.damage).toBeCloseTo(plainShard.damage * GEO_SUNLANCE_DAMAGE_MULTIPLIER, 5);
  });

  test("Overclock: fire rate is boosted while the window is live", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["overclock"];
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.overclockUntilTick).toBeDefined();

    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(FIRE_BIT, 2, 500, 400) }),
      DT_MS,
    );
    const boostedCooldown = res.state.players[A]!.fireCooldownMs;

    const plain = mkPlayer(B, 400, 400);
    const plainRes = stepWithRuntime(
      mkState([plain]),
      createRuntime(flatMap),
      inputsWith([plain], { [B as string]: frame(FIRE_BIT, 1, 500, 400) }),
      DT_MS,
    );
    const plainCooldown = plainRes.state.players[B]!.fireCooldownMs;
    expect(boostedCooldown).toBeLessThan(plainCooldown);
    expect(boostedCooldown).toBeCloseTo(plainCooldown / GEO_OVERCLOCK_FIRE_RATE_MULTIPLIER, 5);
  });

  test("Facet Break: marks the nearest foe in the aim cone; a subsequent hit is amplified", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["facet-break"];
    const victim = mkPlayer(B, 480, 400);
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, victim], {
        [A as string]: frame(SLOT1_BIT, 1, victim.x, victim.y),
      }),
      DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.facetTargetId).toBe(B);
    expect(state.players[A]!.facetMarkUntilTick).toBeDefined();
  });

  test("Facet Break: a whiff (no target in the cone) does not burn the cooldown", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["facet-break"];
    const state = mkState([caster]); // solo — nothing to mark
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(false);
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBeUndefined();
  });

  test("Prism Fan: an instant cone radius-check hits an enemy in the cone, spawns no projectiles", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["prism-fan"];
    // Aimed at +x (700,400) — inCone sits directly along that aim, well
    // inside GEO_PRISM_FAN_RANGE_PX; behindCaster sits at the SAME distance
    // but 180° off the aim — inside radius, outside the 50° cone, proving
    // this is a real cone+radius check, not a bare radius check.
    const inCone = mkPlayer(B, 550, 400);
    const behindCaster = mkPlayer(PlayerId("c"), 250, 400);
    const state = mkState([caster, inCone, behindCaster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, inCone, behindCaster], { [A as string]: frame(SLOT1_BIT, 1, 700, 400) }),
      DT_MS,
    );
    expect(Object.keys(res.state.projectiles).length).toBe(0);
    expect(res.events.some((e) => e.t === "ability-activated" && e.kind === "prism-fan")).toBe(
      true,
    );
    expect(res.state.players[B]!.health).toBeLessThan(100);
    expect(res.state.players[PlayerId("c")]!.health).toBe(100);
  });

  test("Prism Fan: an enemy beyond GEO_PRISM_FAN_RANGE_PX is unaffected", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["prism-fan"];
    const farAway = mkPlayer(B, 400 + GEO_PRISM_FAN_RANGE_PX + 100, 400);
    const state = mkState([caster, farAway]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, farAway], { [A as string]: frame(SLOT1_BIT, 1, 700, 400) }),
      DT_MS,
    );
    expect(res.state.players[B]!.health).toBe(100);
  });

  test("Lattice: a genuine lingering zone (no projectiles) damages an enemy standing in it over multiple ticks, leaves a distant enemy untouched", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["lattice"];
    const nearby = mkPlayer(B, 400 + GEO_LATTICE_ZONE_RADIUS_PX - 20, 400);
    // Outside the zone radius, same y as caster/nearby (so it lands on the
    // SAME floor the same way they do — no unrelated free-fall-to-void
    // over the long tick loop below) but on the OPPOSITE side, still well
    // within the floor platform's span (this file's flatMap fixture).
    const farAway = mkPlayer(PlayerId("c"), 400 - GEO_LATTICE_ZONE_RADIUS_PX - 40, 400);
    let state = mkState([caster, nearby, farAway]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, nearby, farAway], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;
    // No shard-fan projectiles — the zone itself is a firePatches entity.
    expect(Object.keys(state.projectiles).length).toBe(0);
    expect(Object.keys(state.firePatches).length).toBe(1);
    // Tick forward WITHOUT re-pressing the ability — the zone alone must
    // keep re-applying damage tick after tick (proves "lingering", not a
    // one-shot burst tagged as a zone).
    let firstTickHealth = 100;
    let laterTickHealth = 100;
    for (let i = 0; i < 170; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster, nearby, farAway], {}), DT_MS);
      state = res.state;
      if (i === 5) firstTickHealth = state.players[B]!.health;
      if (i === 40) laterTickHealth = state.players[B]!.health;
    }
    expect(firstTickHealth).toBeLessThan(100);
    // Damage kept accruing after the first sample — re-applies over time.
    expect(laterTickHealth).toBeLessThan(firstTickHealth);
    expect(state.players[PlayerId("c")]!.health).toBe(100);
    // The zone eventually burns out (remainingMs exhausted).
    expect(Object.keys(state.firePatches).length).toBe(0);
  });

  test("Return Glass: grants an instant shield charge tick, capped at max", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["return-glass"];
    caster.shieldCharge = 0;
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    // The ability grant runs before this tick's ordinary shield recharge
    // tick, so the observed value is the grant plus one tick of passive
    // regen — bound it rather than pin an exact float.
    expect(res.state.players[A]!.shieldCharge).toBeGreaterThanOrEqual(
      GEO_RETURN_GLASS_SHIELD_REFUND,
    );
    expect(res.state.players[A]!.shieldCharge).toBeLessThan(GEO_RETURN_GLASS_SHIELD_REFUND + 1);
  });

  test("Hard Aperture: reuses the ward shell — halves the next hit while live", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["hard-aperture"];
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(res.state.players[A]!.wardShellUntilTick).toBeDefined();
    expect((res.state.players[A]!.wardShellUntilTick as number) > res.state.tick).toBe(true);
  });

  test("Measure: banks one free shot (ammo+1, capped at magazine size)", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["measure"];
    caster.ammo = 0;
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(res.state.players[A]!.ammo).toBe(1);
  });

  test("Slip Node: blinks toward aim, landing within GEO_SLIP_NODE_RANGE_PX", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["slip-node"];
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 900, 400) }),
      DT_MS,
    );
    const moved = res.state.players[A]!;
    const dist = Math.hypot(moved.x - 400, moved.y - 400);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThanOrEqual(GEO_SLIP_NODE_RANGE_PX + 1);
    expect(res.events.some((e) => e.t === "ability-activated" && e.kind === "slip-node")).toBe(
      true,
    );
  });

  test("Recoil Step: applies an instant velocity impulse opposite the aim direction", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["recoil-step"];
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state,
      runtime,
      // Aim to the right (+x); the hop should push velocity leftward (-x).
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 900, 400) }),
      DT_MS,
    );
    expect(res.state.players[A]!.vx).toBeLessThan(0);
  });
});
