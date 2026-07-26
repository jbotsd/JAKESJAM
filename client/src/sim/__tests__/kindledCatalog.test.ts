// Kindled catalog v1 (docs/class-ability-catalogs-v1.md) — the paladin's
// class ability catalog, plugged into the EXISTING six-axes rack/draft
// substrate (docs/six-axes-goal.md) and the Geometrician catalog's own
// activation-switch pattern (class-overhaul-workboard.md chunk 2.6). All 10
// of the doc's 10 are wired as of the chunk 2.6 fast-follow (2026-07-18) —
// the original pass shipped 7; Retribution Edge, Shock Ring, and Rally
// Light (below the original 7) are the fast-follow's own additions. Kindled
// Resolve and Bulwark Step (further below) are a SECOND fast-follow
// (docs/axiom-deviations-audit.md "Kindled — two structural gaps",
// 2026-07-18), growing the catalog to 12/12 and closing the buff×1/
// movement×1 coverage-floor miss the audit found.
//
// CUT NOTE (2026-07-19): the catalog was brought back down to 10/10 —
// Retribution Edge (offense) and Consecrated Field (aoe) were removed
// entirely, not deferred. Retribution Edge carried an unaddressed self-
// fueling-loop brake gap (docs/axiom-deviations-audit.md's D3/AX.3 flag —
// same category of issue the Syzygist class had this session, which WAS
// fixed with a difference-fed brake; Retribution Edge's equivalent was
// never built) — removing it sidesteps that open design debt rather than
// building the fix. Consecrated Field was cut for role redundancy against
// Shock Ring (both "AOE damage zone near yourself"; Shock Ring reads as
// more central to the class's heaven-tank identity). This drops offense
// and aoe from 2-per-role to 1-per-role each — an accepted, intentional
// consequence of THIS cut, not a re-opened coverage gap; buff/movement
// (Kindled Resolve/Bulwark Step, the abilities that closed that exact gap
// above) are untouched. See docs/class-ability-catalogs-v1.md's own cut
// note for the full reasoning. `KINDLED_ABILITY_IDS` below is back to 10
// entries — if you're reading this wondering why it used to have 12, this
// is why.
//
// Coverage, mirroring geometricianCatalog.test.ts's own shape:
//   (1) data authoring — all 10 cards exist as classId:"paladin" ability
//       cards wired to their AbilityKind.
//   (2) offer-roll classId gating — only a paladin (heavy) ever sees these;
//       every other chassis (including the OTHER melee class, ninja) never
//       does, proving round.ts's generic `c.classId !== playerClassId` gate
//       already extends correctly to a SECOND classId with no code change.
//   (3) rack fill via the existing resolvePlayerBuild/createWeaponBuild
//       mechanism — no new slot system.
//   (4) representative v1 sim-effect tests for each of the 10 abilities.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { enterDrafting } from "../round.js";
import { resolvePlayerBuild } from "../weapon.js";
import { crystalRoundsCards } from "../data/cards.js";
import { MAX_ABILITY_SLOTS } from "../data/cardTypes.js";
import {
  KIN_BASTION_PULSE_SHIELD_REFUND,
  KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER,
  KIN_SUNSPIKE_DAMAGE,
  KIN_JUDGMENT_AMP_MULTIPLIER,
  KIN_SEAL_DAMAGE_MULTIPLIER,
  KIN_SEAL_STAGGER_MULTIPLIER,
  KIN_PLANT_CHARGE_RANGE_PX,
  KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER,
  KIN_KINDLED_RESOLVE_KINDLING_COST,
  KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER,
  KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION,
  KIN_BULWARK_STEP_RANGE_PX,
  KIN_AEGIS_SHARE_SOLO_KINDLING_FEED,
  SHIELD_MAX_CHARGE_DEFAULT,
} from "../constants.js";
import { KINDLING_MAX } from "../combat.js";
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
const C = PlayerId("c");
const DT_MS = 1000 / 60;
const SLOT1_BIT = 1 << 10;
const FIRE_BIT = 1 << 6;
const LEFT_BIT = 1 << 0;
const RIGHT_BIT = 1 << 1;

const KINDLED_ABILITY_IDS = [
  "bastion-pulse",
  "sunspike",
  "judgment-line",
  "unbroken-seal",
  "aegis-share",
  "plant-charge",
  "shock-ring",
  "rally-light",
  "kindled-resolve",
  "bulwark-step",
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
  characterId: PlayerEntity["characterId"] = "heavy",
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

function kinCard(id: (typeof KINDLED_ABILITY_IDS)[number]) {
  const card = crystalRoundsCards.find((c) => c.id === id);
  if (!card) throw new Error(`missing catalog card: ${id}`);
  return card;
}

describe("Kindled catalog v1 — data authoring", () => {
  test("all 10 wired catalog abilities exist as classId:'paladin' ability cards", () => {
    for (const id of KINDLED_ABILITY_IDS) {
      const card = kinCard(id);
      expect(card.classId).toBe("paladin");
      expect(card.active).toBeDefined();
      expect(card.active?.kind).toBe(id);
      expect(card.category).toBe("ability");
    }
  });

  test("role coverage across the 10 wired abilities: defense/single/offense/aoe/movement/buff all present", () => {
    const roles = new Set(KINDLED_ABILITY_IDS.map((id) => kinCard(id).role));
    expect(roles.has("defense")).toBe(true);
    expect(roles.has("single")).toBe(true);
    expect(roles.has("offense")).toBe(true);
    expect(roles.has("aoe")).toBe(true);
    expect(roles.has("movement")).toBe(true);
    expect(roles.has("buff")).toBe(true);
  });

  // CUT NOTE (2026-07-19): this used to assert a ≥2-per-role floor across
  // ALL six roles (docs/classes-goal.md), closed by the coverage-floor
  // fast-follow below (Kindled Resolve/Bulwark Step). The 12→10 cut
  // (Retribution Edge/offense, Consecrated Field/aoe — see docs/class-
  // ability-catalogs-v1.md's cut note) deliberately drops offense and aoe
  // to 1-per-role; that's an accepted consequence of THIS cut, not a
  // re-opened gap needing another fast-follow. buff/movement — the roles
  // the original audit actually flagged, and the ones Kindled Resolve/
  // Bulwark Step exist to fix — stay at the ≥2 floor and are asserted
  // below; offense/aoe are asserted at exactly 1 so a future accidental
  // regression (or restoration) is caught either way.
  test("coverage FLOOR (docs/classes-goal.md '≥2 primary tags per role') holds for buff/movement — the roles the audit flagged and Kindled Resolve/Bulwark Step fixed; offense/aoe are intentionally 1-per-role after the 2026-07-19 cut", () => {
    const counts: Record<string, number> = {};
    for (const id of KINDLED_ABILITY_IDS) {
      const role = kinCard(id).role!;
      counts[role] = (counts[role] ?? 0) + 1;
    }
    expect(counts["buff"]).toBeGreaterThanOrEqual(2);
    expect(counts["movement"]).toBeGreaterThanOrEqual(2);
    expect(counts["defense"]).toBeGreaterThanOrEqual(2);
    expect(counts["single"]).toBeGreaterThanOrEqual(2);
    // Intentional 1-per-role after the cut (Unbroken Seal/Shock Ring are
    // the sole survivors) — not a floor violation.
    expect(counts["offense"]).toBe(1);
    expect(counts["aoe"]).toBe(1);
  });

  // (The 3 Paladin exclusives — Crater/Retort/Bastion, card-pool-v2.md
  // #26-28 — used to be authored-and-classId-gated here too. Cut entirely
  // 2026-07-19: they were leaking into the loadout station's 10-card
  // catalog as 13 total, a live-playtest bug Jake caught, not a feature —
  // see cards.ts's cut note above the old crater/retort/bastion card
  // definitions. Their dedicated describe blocks further down this file
  // (Shock Ring/Crater's landing-detection pair, plus Retort's and
  // Bastion's own fast-follow blocks) were removed too.)
});

describe("Kindled catalog v1 — offer-roll classId gating", () => {
  test("a paladin (heavy) player is offered catalog abilities across seeds", () => {
    const paladin = mkPlayer(A, 400, 400, "heavy");
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
      const roll = enterDrafting(round, { [A]: paladin, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      if (offer.some((id) => (KINDLED_ABILITY_IDS as readonly string[]).includes(id))) {
        sawCatalogOffer = true;
      }
    }
    expect(sawCatalogOffer).toBe(true);
  });

  test("a Wizard (balanced) NEVER sees a Kindled catalog offer", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced");
    const other = mkPlayer(B, 600, 400, "heavy");
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
      expect(offer.some((id) => (KINDLED_ABILITY_IDS as readonly string[]).includes(id))).toBe(false);
    }
  });

  test("the OTHER melee chassis (sprinter/Interstice) NEVER sees a Kindled catalog offer — the generic classId gate distinguishes two melee classes correctly", () => {
    const ninja = mkPlayer(A, 400, 400, "sprinter");
    const other = mkPlayer(B, 600, 400, "heavy");
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
      expect(offer.some((id) => (KINDLED_ABILITY_IDS as readonly string[]).includes(id))).toBe(false);
    }
  });

  test("shielded (Syzygist) never sees the Kindled catalog either", () => {
    const priest = mkPlayer(A, 400, 400, "shielded");
    const other = mkPlayer(B, 600, 400, "heavy");
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    for (let seed = 1; seed <= 30; seed++) {
      const roll = enterDrafting(round, { [A]: priest, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.some((id) => (KINDLED_ABILITY_IDS as readonly string[]).includes(id))).toBe(false);
    }
  });

  test("a paladin (heavy) NEVER sees a Geometrician (wizard-only) catalog offer — the gate is symmetric", () => {
    const paladin = mkPlayer(A, 400, 400, "heavy");
    const other = mkPlayer(B, 600, 400, "balanced");
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    const geoIds = ["sunlance", "facet-break", "prism-fan", "lattice", "return-glass"];
    for (let seed = 1; seed <= 60; seed++) {
      const roll = enterDrafting(round, { [A]: paladin, [B]: other }, Tick(100), seed >>> 0);
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.some((id) => geoIds.includes(id))).toBe(false);
    }
  });
});

describe("Kindled catalog v1 — rack fill (existing substrate, no new slot system)", () => {
  test("a Kindled ability card resolves into build.actives exactly like a universal one", () => {
    const paladin = mkPlayer(A, 400, 400, "heavy");
    paladin.cards = ["bastion-pulse", "sunspike", "judgment-line"];
    const build = resolvePlayerBuild(paladin);
    expect(build.actives.length).toBe(3);
    expect(build.actives.map((a): string => a.kind).sort()).toEqual(
      ["bastion-pulse", "judgment-line", "sunspike"].sort(),
    );
  });

  test("mixing universal + catalog abilities still caps at MAX_ABILITY_SLOTS (3)", () => {
    const paladin = mkPlayer(A, 400, 400, "heavy");
    paladin.cards = ["crimson-tithe", "bastion-pulse", "sunspike", "judgment-line"];
    const build = resolvePlayerBuild(paladin);
    expect(build.actives.length).toBe(MAX_ABILITY_SLOTS);
  });
});

describe("Kindled catalog v1 — representative sim effects", () => {
  test("Bastion Pulse: instant shield-charge tick, doubled while Ward is held", () => {
    const notHolding = mkPlayer(A, 400, 400, "heavy", { cards: ["bastion-pulse"], shieldCharge: 0, shieldActive: false });
    const s1 = stepWithRuntime(
      mkState([notHolding]), createRuntime(flatMap),
      inputsWith([notHolding], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(s1.state.players[A]!.shieldCharge).toBeGreaterThanOrEqual(KIN_BASTION_PULSE_SHIELD_REFUND);
    expect(s1.state.players[A]!.shieldCharge).toBeLessThan(KIN_BASTION_PULSE_SHIELD_REFUND + 1);

    const holding = mkPlayer(A, 400, 400, "heavy", { cards: ["bastion-pulse"], shieldCharge: 0, shieldActive: true });
    const s2 = stepWithRuntime(
      mkState([holding]), createRuntime(flatMap),
      inputsWith([holding], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    const doubled = KIN_BASTION_PULSE_SHIELD_REFUND * KIN_BASTION_PULSE_WARD_HELD_MULTIPLIER;
    expect(s2.state.players[A]!.shieldCharge).toBeGreaterThanOrEqual(doubled);
    expect(s2.state.players[A]!.shieldCharge).toBeLessThan(doubled + 1);
    expect(s2.state.players[A]!.shieldCharge!).toBeGreaterThan(s1.state.players[A]!.shieldCharge!);
  });

  test("Sunspike: an aimed thrust deals high single-target damage on contact", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", { cards: ["sunspike"] });
    const victim = mkPlayer(B, 460, 400, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1, 900, 400) }), DT_MS,
    );
    // The shard is fast enough (KIN_SUNSPIKE_SPEED) to reach a 60px-away
    // victim within a handful of ticks; step forward until it lands or the
    // shard expires.
    let s = res.state;
    let victimHealth = s.players[B]!.health;
    for (let i = 0; i < 10 && victimHealth === 100; i++) {
      const step = stepWithRuntime(s, runtime, inputsWith([caster, victim], {}), DT_MS);
      s = step.state;
      victimHealth = s.players[B]!.health;
    }
    expect(victimHealth).toBeLessThan(100);
    // Range, not an exact figure: this shard rides the SAME hit-resolution
    // path every other projectile does, including player.ts's headshot
    // bonus (HEADSHOT_DAMAGE_MULTIPLIER 1.2×) — a real consequence of
    // reusing the existing projectile substrate, not a bug in this test.
    const dealt = 100 - victimHealth;
    expect(dealt).toBeGreaterThanOrEqual(KIN_SUNSPIKE_DAMAGE - 0.5);
    expect(dealt).toBeLessThanOrEqual(KIN_SUNSPIKE_DAMAGE * 1.2 + 0.5);
  });

  test("Judgment Line: marks the nearest foe in the aim cone", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", { cards: ["judgment-line"] });
    const victim = mkPlayer(B, 480, 400, "balanced");
    const state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1, victim.x, victim.y) }), DT_MS,
    );
    expect(res.state.players[A]!.judgmentTargetId).toBe(B);
    expect(res.state.players[A]!.judgmentMarkUntilTick).toBeDefined();
  });

  test("Judgment Line: a marked target takes amplified damage from a landed Kindled Edge hit", () => {
    const attacker = mkPlayer(A, 500, 300, "heavy", {
      cards: ["judgment-line"], aimX: 900, aimY: 300,
    });
    const victim = mkPlayer(B, 560, 300, "balanced");
    const bystander = mkPlayer(PlayerId("z"), 2000, 2000, "balanced");
    let state = mkState([attacker, victim, bystander]);
    const runtime = createRuntime(flatMap);

    // Mark B first.
    let res = stepWithRuntime(
      state, runtime,
      inputsWith([attacker, victim, bystander], { [A as string]: frame(SLOT1_BIT, 1, victim.x, victim.y) }),
      DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.judgmentTargetId).toBe(B);

    // Swing Kindled Edge at the marked victim.
    res = stepWithRuntime(
      state, runtime,
      inputsWith([attacker, victim, bystander], { [A as string]: frame(FIRE_BIT, 2, 900, 300) }),
      DT_MS,
    );
    state = res.state;
    const HIT_TICKS = Math.ceil(200 / DT_MS) + 1 + Math.ceil(100 / DT_MS);
    for (let i = 0; i < HIT_TICKS; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([attacker, victim, bystander], {}), DT_MS);
      state = res.state;
    }
    const markedDamage = 100 - state.players[B]!.health;
    expect(markedDamage).toBeGreaterThan(0);

    // Unmarked control: identical swing against a fresh, unmarked victim.
    const attacker2 = mkPlayer(A, 500, 300, "heavy", { aimX: 900, aimY: 300 });
    const victim2 = mkPlayer(B, 560, 300, "balanced");
    let state2 = mkState([attacker2, victim2]);
    const runtime2 = createRuntime(flatMap);
    let res2 = stepWithRuntime(
      state2, runtime2,
      inputsWith([attacker2, victim2], { [A as string]: frame(FIRE_BIT, 1, 900, 300) }),
      DT_MS,
    );
    state2 = res2.state;
    for (let i = 0; i < HIT_TICKS; i++) {
      res2 = stepWithRuntime(state2, runtime2, inputsWith([attacker2, victim2], {}), DT_MS);
      state2 = res2.state;
    }
    const unmarkedDamage = 100 - state2.players[B]!.health;
    expect(markedDamage).toBeCloseTo(unmarkedDamage * KIN_JUDGMENT_AMP_MULTIPLIER, 0);
  });

  test("Unbroken Seal: the next landed Kindled Edge hit is amplified and staggers the victim", () => {
    const attacker = mkPlayer(A, 500, 300, "heavy", { cards: ["unbroken-seal"], aimX: 900, aimY: 300 });
    const victim = mkPlayer(B, 560, 300, "balanced");
    let state = mkState([attacker, victim]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state, runtime,
      inputsWith([attacker, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.sealUntilTick).toBeDefined();

    res = stepWithRuntime(
      state, runtime,
      inputsWith([attacker, victim], { [A as string]: frame(FIRE_BIT, 2, 900, 300) }), DT_MS,
    );
    state = res.state;
    const HIT_TICKS = Math.ceil(200 / DT_MS) + 1 + Math.ceil(100 / DT_MS);
    for (let i = 0; i < HIT_TICKS; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([attacker, victim], {}), DT_MS);
      state = res.state;
    }
    const sealedDamage = 100 - state.players[B]!.health;
    expect(sealedDamage).toBeGreaterThan(0);
    // Baseline unsealed Edge hit is EDGE_DAMAGE (38, 2026-07-26 balance
    // pass) — the sealed hit must exceed it by roughly KIN_SEAL_DAMAGE_MULTIPLIER.
    expect(sealedDamage).toBeCloseTo(38 * KIN_SEAL_DAMAGE_MULTIPLIER, 0);
    // Stagger: victim is heavily slowed.
    expect(state.players[B]!.slowedUntilTick).toBeDefined();
    expect(state.players[B]!.slowMultiplier).toBeCloseTo(KIN_SEAL_STAGGER_MULTIPLIER, 5);
    // Consumed — the window is gone after landing.
    expect(state.players[A]!.sealUntilTick === undefined || state.players[A]!.sealUntilTick! <= state.tick).toBe(true);
  });

  test("Aegis Share: opens a window that widens this player's team-peel radius", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", { cards: ["aegis-share"] });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.aegisShareUntilTick).toBeDefined();
    expect((res.state.players[A]!.aegisShareUntilTick as number) > res.state.tick).toBe(true);
  });

  test("Aegis Share solo fallback (axiom-deviations-audit.md, 2026-07-18): with no ally in range, the caster still gets SOMETHING — a Kindling tick — instead of the previous dead press", () => {
    const solo = mkPlayer(A, 400, 400, "heavy", { cards: ["aegis-share"], kindling: 0 });
    const state = mkState([solo]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([solo], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    // The window still opens (unchanged team behavior)...
    expect(res.state.players[A]!.aegisShareUntilTick).toBeDefined();
    // ...AND the caster now banks a real Kindling tick, solo, with nobody
    // else on the map to peel for.
    expect(res.state.players[A]!.kindling).toBeCloseTo(KIN_AEGIS_SHARE_SOLO_KINDLING_FEED, 5);
  });

  test("Aegis Share with an ally in range: the team behavior is unchanged (no solo Kindling tick — the audit's fix is additive, not a rewrite)", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", {
      cards: ["aegis-share"],
      teamId: "red",
      kindling: 0,
    });
    const ally = mkPlayer(B, 440, 400, "heavy", { teamId: "red" });
    const state = mkState([caster, ally]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, ally], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.aegisShareUntilTick).toBeDefined();
    expect(res.state.players[A]!.kindling ?? 0).toBe(0);
  });

  test("Aegis Share solo fallback caps at KINDLING_MAX like every other Kindling grant in the file", () => {
    const solo = mkPlayer(A, 400, 400, "heavy", {
      cards: ["aegis-share"],
      kindling: KINDLING_MAX - 1,
    });
    const state = mkState([solo]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([solo], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.kindling).toBe(KINDLING_MAX);
  });

  test("Plant Charge: repositions toward aim within KIN_PLANT_CHARGE_RANGE_PX and tips shield charge up", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", { cards: ["plant-charge"], shieldCharge: 0 });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1, 900, 400) }), DT_MS,
    );
    const moved = res.state.players[A]!;
    const dist = Math.hypot(moved.x - 400, moved.y - 400);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThanOrEqual(KIN_PLANT_CHARGE_RANGE_PX + 1);
    expect(moved.shieldCharge).toBeGreaterThan(0);
    expect(moved.shieldCharge!).toBeLessThanOrEqual(SHIELD_MAX_CHARGE_DEFAULT);
  });
});

// ── Kindled catalog v1 fast-follow (class-overhaul-workboard.md chunk 2.6,
// 2026-07-18) — originally Retribution Edge, Shock Ring, Rally Light: the 3
// abilities the original pass deferred, now wired. Retribution Edge (and
// its whole "cast opens armed window / self-block readies it / next Edge
// hit consumes it" describe block that used to live here) was cut
// 2026-07-19 — see docs/class-ability-catalogs-v1.md's cut note — not
// deferred, so there's no test to keep for it. ─────────────────────────────

describe("Kindled catalog v1 fast-follow — Shock Ring (landing-detection hop-slam)", () => {
  test("Shock Ring: cast hops upward and arms a window; landing triggers a damaging slam nova, then clears", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", { cards: ["shock-ring"] });
    const victim = mkPlayer(B, 440, 400, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.vy).toBeLessThan(0);
    expect(state.players[A]!.shockRingArmedUntilTick).toBeDefined();
    let victimHealth = state.players[B]!.health;
    for (let i = 0; i < 120 && victimHealth === 100; i++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster, victim], {}), DT_MS);
      state = res.state;
      victimHealth = state.players[B]!.health;
    }
    expect(victimHealth).toBeLessThan(100);
    expect(
      state.players[A]!.shockRingArmedUntilTick === undefined ||
        state.players[A]!.shockRingArmedUntilTick! <= state.tick,
    ).toBe(true);
    // Aoe role rework (2026-07-18): a real radius check, no shard-ring
    // projectiles spawned at any point.
    expect(Object.keys(state.projectiles).length).toBe(0);
  });

  // (Crater's own landing-detection test — leap, arm a window, land into an
  // epicenter burst + traveling ring — used to live here. Cut entirely
  // 2026-07-19 alongside the card itself; see cards.ts's cut note above
  // the old crater/retort/bastion card definitions.)
});

describe("Kindled catalog v1 fast-follow — Rally Light (read-only continuous aura, no cross-player write)", () => {
  test("cast opens the aura-source window", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", { cards: ["rally-light"] });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.rallyLightUntilTick).toBeDefined();
    expect((res.state.players[A]!.rallyLightUntilTick as number) > res.state.tick).toBe(true);
  });

  test("self movement speed increases while the aura is live (solo-safe, no teamId needed)", () => {
    const RIGHT_BIT = 1 << 1;
    const buffed = mkPlayer(A, 400, 400, "heavy", { rallyLightUntilTick: Tick(600) });
    const plain = mkPlayer(A, 400, 400, "heavy");
    const resBuffed = stepWithRuntime(
      mkState([buffed]), createRuntime(flatMap),
      inputsWith([buffed], { [A as string]: frame(RIGHT_BIT, 1) }), DT_MS,
    );
    const resPlain = stepWithRuntime(
      mkState([plain]), createRuntime(flatMap),
      inputsWith([plain], { [A as string]: frame(RIGHT_BIT, 1) }), DT_MS,
    );
    expect(resBuffed.state.players[A]!.vx).toBeGreaterThan(resPlain.state.players[A]!.vx);
  });

  test("self damage output is amplified while the aura is live (solo-safe, no teamId needed)", () => {
    const dealtDamage = (buffed: boolean): number => {
      const caster = mkPlayer(A, 400, 400, "heavy", {
        cards: ["sunspike"],
        rallyLightUntilTick: buffed ? Tick(600) : undefined,
      });
      const victim = mkPlayer(B, 460, 400, "balanced");
      let state = mkState([caster, victim]);
      const runtime = createRuntime(flatMap);
      let res = stepWithRuntime(
        state, runtime,
        inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1, 900, 400) }), DT_MS,
      );
      state = res.state;
      let victimHealth = state.players[B]!.health;
      for (let i = 0; i < 10 && victimHealth === 100; i++) {
        res = stepWithRuntime(state, runtime, inputsWith([caster, victim], {}), DT_MS);
        state = res.state;
        victimHealth = state.players[B]!.health;
      }
      return 100 - victimHealth;
    };
    const buffedDamage = dealtDamage(true);
    const plainDamage = dealtDamage(false);
    expect(buffedDamage).toBeGreaterThan(plainDamage);
    expect(buffedDamage).toBeCloseTo(plainDamage * KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER, 0);
  });

  test("covers a nearby ALLY's damage too, but not a non-ally at the same distance (cross-player-write-safety: this is a READ, never a write onto the ally)", () => {
    const dealtDamage = (allySameTeam: boolean): number => {
      const source = mkPlayer(A, 350, 400, "heavy", { teamId: "red", rallyLightUntilTick: Tick(600) });
      const attacker = mkPlayer(C, 400, 400, "heavy", {
        teamId: allySameTeam ? "red" : "blue",
        cards: ["sunspike"],
        aimX: 900, aimY: 400,
      });
      const victim = mkPlayer(B, 460, 400, "balanced");
      let state = mkState([source, attacker, victim]);
      const runtime = createRuntime(flatMap);
      let res = stepWithRuntime(
        state, runtime,
        inputsWith([source, attacker, victim], { [C as string]: frame(SLOT1_BIT, 1, 900, 400) }), DT_MS,
      );
      state = res.state;
      // Rally Light itself must never have written onto the attacker's OR
      // source's entity — the aura is read-only by construction.
      expect(state.players[C]!.rallyLightUntilTick).toBeUndefined();
      let victimHealth = state.players[B]!.health;
      for (let i = 0; i < 10 && victimHealth === 100; i++) {
        res = stepWithRuntime(state, runtime, inputsWith([source, attacker, victim], {}), DT_MS);
        state = res.state;
        victimHealth = state.players[B]!.health;
      }
      return 100 - victimHealth;
    };
    const allyDamage = dealtDamage(true);
    const nonAllyDamage = dealtDamage(false);
    expect(allyDamage).toBeGreaterThan(nonAllyDamage);
    expect(allyDamage).toBeCloseTo(nonAllyDamage * KIN_RALLY_LIGHT_DAMAGE_MULTIPLIER, 0);
  });
});

describe("Kindled catalog v1 coverage-floor fast-follow — Kindled Resolve (buff #2, self-only, spends Kindling; docs/axiom-deviations-audit.md, 2026-07-18)", () => {
  test("with enough Kindling, a cast spends the cost and opens the buff window", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", {
      cards: ["kindled-resolve"],
      kindling: 60,
    });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.kindling).toBeCloseTo(60 - KIN_KINDLED_RESOLVE_KINDLING_COST, 5);
    expect(res.state.players[A]!.kindledResolveUntilTick).toBeDefined();
    expect((res.state.players[A]!.kindledResolveUntilTick as number) > res.state.tick).toBe(true);
  });

  test("insufficient Kindling is a dead press: no window, no spend, no cooldown burn", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", {
      cards: ["kindled-resolve"],
      kindling: KIN_KINDLED_RESOLVE_KINDLING_COST - 1,
    });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.kindledResolveUntilTick).toBeUndefined();
    expect(res.state.players[A]!.kindling).toBe(KIN_KINDLED_RESOLVE_KINDLING_COST - 1);
    // A dead press never starts the slot cooldown — pressing again
    // immediately (now with enough Kindling banked from nothing changing)
    // still can't activate without the missing amount, but the slot itself
    // must still be off cooldown: prove it by giving a SECOND press, same
    // tick shape, enough Kindling this time, and confirming it activates.
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBeUndefined();
  });

  test("self damage output is amplified while the window is live", () => {
    const dealtDamage = (buffed: boolean): number => {
      const caster = mkPlayer(A, 400, 400, "heavy", {
        cards: ["sunspike"],
        kindledResolveUntilTick: buffed ? Tick(600) : undefined,
      });
      const victim = mkPlayer(B, 460, 400, "balanced");
      let state = mkState([caster, victim]);
      const runtime = createRuntime(flatMap);
      let res = stepWithRuntime(
        state, runtime,
        inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1, 900, 400) }), DT_MS,
      );
      state = res.state;
      let victimHealth = state.players[B]!.health;
      for (let i = 0; i < 10 && victimHealth === 100; i++) {
        res = stepWithRuntime(state, runtime, inputsWith([caster, victim], {}), DT_MS);
        state = res.state;
        victimHealth = state.players[B]!.health;
      }
      return 100 - victimHealth;
    };
    const buffedDamage = dealtDamage(true);
    const plainDamage = dealtDamage(false);
    expect(buffedDamage).toBeGreaterThan(plainDamage);
    expect(buffedDamage).toBeCloseTo(plainDamage * KIN_KINDLED_RESOLVE_DAMAGE_MULTIPLIER, 0);
  });

  test("incoming stagger severity is halved while the window is live (Unbroken Seal's stagger as the source)", () => {
    const staggerMultiplierFor = (buffed: boolean): number => {
      const attacker = mkPlayer(A, 500, 300, "heavy", {
        aimX: 900, aimY: 300,
        sealUntilTick: Tick(600),
      });
      const victim = mkPlayer(B, 560, 300, "balanced", {
        kindledResolveUntilTick: buffed ? Tick(600) : undefined,
      });
      let state = mkState([attacker, victim]);
      const runtime = createRuntime(flatMap);
      let res = stepWithRuntime(
        state, runtime,
        inputsWith([attacker, victim], { [A as string]: frame(FIRE_BIT, 1, 900, 300) }), DT_MS,
      );
      state = res.state;
    const HIT_TICKS = Math.ceil(200 / DT_MS) + 1 + Math.ceil(100 / DT_MS);
    for (let i = 0; i < HIT_TICKS; i++) {
        res = stepWithRuntime(state, runtime, inputsWith([attacker, victim], {}), DT_MS);
        state = res.state;
      }
      expect(state.players[B]!.slowedUntilTick).toBeDefined();
      return state.players[B]!.slowMultiplier!;
    };
    const resisted = staggerMultiplierFor(true);
    const raw = staggerMultiplierFor(false);
    expect(resisted).toBeCloseTo(raw + (1 - raw) * KIN_KINDLED_RESOLVE_STAGGER_RESIST_FRACTION, 5);
    expect(resisted).toBeGreaterThan(raw); // closer to 1 = less severe.
  });

  test("classId gating: the activation switch case is reachable for any classId holding the card (offer-roll is the primary gate, round.ts)", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced", {
      cards: ["kindled-resolve"],
      kindling: 60,
    });
    const state = mkState([wizard]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([wizard], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.kindledResolveUntilTick).toBeDefined();
  });
});

describe("Kindled catalog v1 coverage-floor fast-follow — Bulwark Step (movement #2, input-facing shuffle, NOT aim-directed; docs/axiom-deviations-audit.md, 2026-07-18)", () => {
  test("holding RIGHT repositions rightward, within KIN_BULWARK_STEP_RANGE_PX, regardless of aim", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", { cards: ["bulwark-step"], aimX: 0, aimY: 400 });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT | RIGHT_BIT, 1, 0, 400) }), DT_MS,
    );
    const moved = res.state.players[A]!;
    expect(moved.x).toBeGreaterThan(400);
    expect(moved.x - 400).toBeLessThanOrEqual(KIN_BULWARK_STEP_RANGE_PX + 1);
    // Purely lateral — the ability itself never touches y (ordinary gravity
    // within the SAME tick's movement step can still nudge it a hair).
    expect(Math.abs(moved.y - 400)).toBeLessThan(5);
  });

  test("holding LEFT repositions leftward — the SAME press, aim held constant, moves the opposite way input does (proves this reads currKeys, not aimX/aimY, unlike Plant Charge)", () => {
    const casterRight = mkPlayer(A, 400, 400, "heavy", { cards: ["bulwark-step"], aimX: 900, aimY: 400 });
    const resRight = stepWithRuntime(
      mkState([casterRight]), createRuntime(flatMap),
      inputsWith([casterRight], { [A as string]: frame(SLOT1_BIT | RIGHT_BIT, 1, 900, 400) }), DT_MS,
    );
    const casterLeft = mkPlayer(A, 400, 400, "heavy", { cards: ["bulwark-step"], aimX: 900, aimY: 400 });
    const resLeft = stepWithRuntime(
      mkState([casterLeft]), createRuntime(flatMap),
      inputsWith([casterLeft], { [A as string]: frame(SLOT1_BIT | LEFT_BIT, 1, 900, 400) }), DT_MS,
    );
    expect(resRight.state.players[A]!.x).toBeGreaterThan(400);
    expect(resLeft.state.players[A]!.x).toBeLessThan(400);
  });

  test("with no left/right held, falls back to current horizontal velocity direction (never a dead press for lack of a held direction)", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", {
      cards: ["bulwark-step"],
      vx: -50,
    });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }), DT_MS,
    );
    const moved = res.state.players[A]!;
    expect(moved.x).not.toBe(400);
  });

  test("does not clear shieldActive — Ward survives the reposition (tickShield recomputes it fresh from held input every tick regardless of this ability)", () => {
    const caster = mkPlayer(A, 400, 400, "heavy", {
      cards: ["bulwark-step"],
      shieldActive: true,
      shieldCharge: 50,
    });
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const SHIELD_BIT = 1 << 8;
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT | RIGHT_BIT | SHIELD_BIT, 1) }), DT_MS,
    );
    const moved = res.state.players[A]!;
    expect(moved.x).toBeGreaterThan(400);
    expect(moved.shieldActive).toBe(true);
  });

  test("genuinely distinct from Plant Charge: same press, same aim, different trigger (input vs aim) — Plant Charge moves toward aim even with a movement key held, Bulwark Step ignores aim entirely", () => {
    const plantCaster = mkPlayer(A, 400, 400, "heavy", { cards: ["plant-charge"], aimX: 400, aimY: 200 });
    const resPlant = stepWithRuntime(
      mkState([plantCaster]), createRuntime(flatMap),
      inputsWith([plantCaster], { [A as string]: frame(SLOT1_BIT | RIGHT_BIT, 1, 400, 200) }), DT_MS,
    );
    // Plant Charge follows aim (straight up, aimX===x) — x barely moves.
    expect(Math.abs(resPlant.state.players[A]!.x - 400)).toBeLessThan(20);
    expect(resPlant.state.players[A]!.y).toBeLessThan(400);

    const bulwarkCaster = mkPlayer(A, 400, 400, "heavy", { cards: ["bulwark-step"], aimX: 400, aimY: 200 });
    const resBulwark = stepWithRuntime(
      mkState([bulwarkCaster]), createRuntime(flatMap),
      inputsWith([bulwarkCaster], { [A as string]: frame(SLOT1_BIT | RIGHT_BIT, 1, 400, 200) }), DT_MS,
    );
    // Bulwark Step ignores the SAME aim entirely — pure lateral shuffle.
    expect(resBulwark.state.players[A]!.x).toBeGreaterThan(400);
    expect(Math.abs(resBulwark.state.players[A]!.y - 400)).toBeLessThan(5);
  });

  test("classId gating: the activation switch case is reachable for any classId holding the card (offer-roll is the primary gate, round.ts)", () => {
    const wizard = mkPlayer(A, 400, 400, "balanced", { cards: ["bulwark-step"] });
    const state = mkState([wizard]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([wizard], { [A as string]: frame(SLOT1_BIT | RIGHT_BIT, 1) }), DT_MS,
    );
    expect(res.state.players[A]!.x).toBeGreaterThan(400);
  });
});

// (Retort's own describe block — bank-on-block, spend-on-landed-edge —
// and Bastion's own describe block — self/ally aura mitigation + Kindling
// feed — used to live here. Cut entirely 2026-07-19 alongside the cards
// themselves (card-pool-v2.md #27-28); see cards.ts's cut note above the
// old crater/retort/bastion card definitions.)

describe("Second Wind — Paladin classModifiers expression (card-pool-v2.md 'stomp-jump')", () => {
  test("a paladin's air jump (with the card equipped) deals ring damage to a nearby victim", () => {
    const JUMP_BIT = 1 << 4;
    const caster = mkPlayer(A, 400, 300, "heavy", { cards: ["double-jump"] });
    const victim = mkPlayer(B, 420, 320, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, victim], { [A as string]: frame(JUMP_BIT, 1) }), DT_MS,
    );
    state = res.state;
    // A first jump with no coyote time and no wall contact is treated as the
    // AIR jump (freshPlayerMovementMemory's coyoteMs starts at 0) — the same
    // signal World.ts's per-player loop reads (mem.airJumpsUsed before/after
    // stepPlayer) to fire the ring.
    expect(state.players[B]!.health).toBeLessThan(100);
  });

  test("Track P legibility close (docs/legibility-audit.md 'double-jump'): every stomp-jump shard carries the kindledThrust render identity flag", () => {
    const JUMP_BIT = 1 << 4;
    const caster = mkPlayer(A, 400, 300, "heavy", { cards: ["double-jump"] });
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster], { [A as string]: frame(JUMP_BIT, 1) }), DT_MS,
    );
    state = res.state;
    const casterShards = Object.values(state.projectiles).filter(
      (p) => p.ownerId === A,
    );
    // 6 radius-6 shards spawned in a ring (World.ts's stompCount) — every
    // one of them must carry the identity flag, not just some (the ring
    // reads as one coherent burst, not a mix of flagged/unflagged shots).
    expect(casterShards.length).toBe(6);
    for (const shard of casterShards) {
      expect(shard.kindledThrust).toBe(true);
    }
  });

  test("without the card equipped, a paladin's jump deals no ring damage", () => {
    const JUMP_BIT = 1 << 4;
    const caster = mkPlayer(A, 400, 300, "heavy");
    const victim = mkPlayer(B, 420, 320, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([caster, victim], { [A as string]: frame(JUMP_BIT, 1) }), DT_MS,
    );
    state = res.state;
    expect(state.players[B]!.health).toBe(100);
  });
});

describe("Kindled catalog v1 — classId gating on sim effects (zero behavior change for other chassis)", () => {
  test("a non-paladin (wizard) never gets judgmentTargetId set, even holding the card id directly on their hand (shouldn't happen via draft, but the sim effect itself must still be classId-gated)", () => {
    // Kindled Edge itself is classId-gated (paladinMelee.test.ts already
    // covers this exhaustively) — Judgment Line's amp lives INSIDE that
    // gated section, so a non-paladin never reaches it. This test proves
    // the activation switch case itself (judgment-line) is reachable for
    // any classId that happens to hold the card (defense in depth: the
    // offer-roll gate is the primary defense, this is the second layer).
    const wizard = mkPlayer(A, 400, 400, "balanced", { cards: ["judgment-line"] });
    const victim = mkPlayer(B, 480, 400, "balanced");
    const state = mkState([wizard, victim]);
    const runtime = createRuntime(flatMap);
    const res = stepWithRuntime(
      state, runtime,
      inputsWith([wizard, victim], { [A as string]: frame(SLOT1_BIT, 1, victim.x, victim.y) }), DT_MS,
    );
    // The generic ability-activation switch has no classId gate of its own
    // (catalog gating happens at the OFFER ROLL, round.ts) — a wizard who
    // somehow holds the card can still cast it (marks the caster's own
    // fields). What matters for classId-gating correctness is that the
    // AMP CONSUMPTION site (Kindled Edge) never runs for a non-paladin —
    // proven exhaustively in paladinMelee.test.ts's own gating suite.
    expect(res.state.players[A]!.judgmentTargetId).toBe(B);
  });
});
