// Drafted actives (docs/six-axes-goal.md Layer 2, Phase 2 pilot).
// Input bits 10..12 press action-bar slots 1..3 in pick order (rack locked
// at exactly 3, docs/classes-goal.md "Rotation system"): rising edge +
// alive + fighting + cooldown expired → activate; the effect is ordinary sim
// state. Crimson Tithe is the end-to-end pilot: a 3s window during which the
// gun's own shots carry leechFraction — the SAME machinery (hit site, event,
// crimson thread) as a Drain-hand Emission shard.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { ABILITY_TITHE_LEECH_FRACTION } from "../constants.js";
import { enterDrafting } from "../round.js";
import { resolvePlayerBuild } from "../weapon.js";
import { MAX_ABILITY_SLOTS } from "../data/cardTypes.js";
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
const SLOT1_BIT = 1 << 10;
const FIRE_BIT = 1 << 6;

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

describe("drafted active slots (bits 10..12, rack locked at 3)", () => {
  test("pressing slot 1 activates Crimson Tithe: window set, cooldown set, event emitted", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["crimson-tithe"];
    const state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );

    const ev = res.events.find((e) => e.t === "ability-activated");
    expect(ev).toBeDefined();
    if (ev?.t !== "ability-activated") throw new Error("unreachable");
    expect(ev.playerId).toBe(A);
    expect(ev.slot).toBe(0);
    expect(ev.kind).toBe("crimson-tithe");
    const p = res.state.players[A]!;
    expect(p.titheUntilTick).toBeDefined();
    expect((p.titheUntilTick as number) > res.state.tick).toBe(true);
    expect(p.slot1CooldownUntilTick).toBeDefined();
    expect((p.slot1CooldownUntilTick as number) > res.state.tick).toBe(true);
  });

  test("cooldown gates re-activation; holding the bit is not an edge", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["crimson-tithe"];
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);

    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(true);
    const cdAfterFirst = state.players[A]!.slot1CooldownUntilTick;

    // Hold across the next tick — no re-trigger (edge semantics).
    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 2) }),
      DT_MS,
    );
    state = res.state;
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(false);

    // Release, then press again while cooling down — still gated.
    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(0, 3) }),
      DT_MS,
    );
    state = res.state;
    res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 4) }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(false);
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBe(cdAfterFirst);
  });

  test("gun shots during the Tithe window leech; shots after it do not", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["crimson-tithe"];
    caster.health = 40;
    const victim = mkPlayer(B, 480, 370);
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);

    // Activate, then hold fire at the victim for ~1.5s (inside the 3s window).
    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, victim], {
        [A as string]: frame(SLOT1_BIT, 1, victim.x, victim.y - 30),
      }),
      DT_MS,
    );
    state = res.state;
    const leeches: SimEvent[] = [];
    for (let t = 0; t < 90; t++) {
      res = stepWithRuntime(
        state,
        runtime,
        inputsWith([caster, victim], {
          [A as string]: frame(FIRE_BIT, 2 + t, victim.x, victim.y - 30),
        }),
        DT_MS,
      );
      state = res.state;
      leeches.push(...res.events.filter((e) => e.t === "emission-leech"));
    }
    expect(leeches.length).toBeGreaterThan(0);
    expect(state.players[A]!.health).toBeGreaterThan(40);
    // Leech is the working fraction of post-mitigation damage — never more.
    const victimDamage = 100 - state.players[B]!.health;
    const healed = state.players[A]!.health - 40;
    expect(healed).toBeLessThanOrEqual(
      victimDamage * ABILITY_TITHE_LEECH_FRACTION + 0.01,
    );

    // Burn past the window (3s = 180 ticks), then fire again: no leech.
    for (let t = 0; t < 200; t++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster, victim], {}), DT_MS);
      state = res.state;
    }
    const healthBefore = state.players[A]!.health;
    let lateLeeches = 0;
    for (let t = 0; t < 60; t++) {
      res = stepWithRuntime(
        state,
        runtime,
        inputsWith([caster, victim], {
          [A as string]: frame(FIRE_BIT, 400 + t, victim.x, victim.y - 30),
        }),
        DT_MS,
      );
      state = res.state;
      lateLeeches += res.events.filter((e) => e.t === "emission-leech").length;
    }
    expect(lateLeeches).toBe(0);
    expect(state.players[A]!.health).toBe(healthBefore);
  });

  test("a hand with no actives ignores the slot bits entirely", () => {
    const caster = mkPlayer(A, 400, 400);
    const res = stepWithRuntime(
      mkState([caster]),
      createRuntime(flatMap),
      inputsWith([caster], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(false);
    expect(res.state.players[A]!.slot1CooldownUntilTick).toBeUndefined();
    expect(res.state.players[A]!.titheUntilTick).toBeUndefined();
  });

  test("death no-ops the press", () => {
    const dead = mkPlayer(A, 400, 400);
    dead.cards = ["crimson-tithe"];
    dead.alive = false;
    dead.health = 0;
    const res2 = stepWithRuntime(
      mkState([dead]),
      createRuntime(flatMap),
      inputsWith([dead], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(res2.events.some((e) => e.t === "ability-activated")).toBe(false);
    expect(res2.state.players[A]!.titheUntilTick).toBeUndefined();
  });

  // Hangout mode: abilities ARE live in the venue lobby (live playtest
  // 2026-07-18, Jake: "the button presses dont fire off the spells" — a
  // stale `|| hangoutMode` clause on this gate predated the lobby ever
  // having cards to activate at all). Player-vs-player safety is enforced
  // at each individual damage site (projectilePlayerIds = [] in hangout,
  // plus the melee arc-hit/bash/splash/fire-patch/storm sites' own
  // `!hangoutMode` guards) — NOT by blocking activation here. Crimson
  // Tithe is self-only (titheUntilTick), so it's a clean self-effect probe
  // for "did activation actually happen".
  test("hangout mode activates a self-only ability normally", () => {
    const inHangout = mkPlayer(A, 400, 400);
    inHangout.cards = ["crimson-tithe"];
    const res = stepWithRuntime(
      mkState([inHangout]),
      createRuntime(flatMap, "hangout"),
      inputsWith([inHangout], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    expect(res.events.some((e) => e.t === "ability-activated")).toBe(true);
    expect(res.state.players[A]!.titheUntilTick).toBeDefined();
  });

  // A damage-dealing ability (Crimson Tithe's leech only matters once a
  // shot lands) still deals zero damage to another PLAYER in hangout: the
  // existing player-immunity mechanism (empty projectile candidate list)
  // holds even though the ability itself now activates.
  test("hangout mode: a damage-dealing ability still deals zero damage to another player", () => {
    const caster = mkPlayer(A, 400, 400);
    caster.cards = ["crimson-tithe"];
    const victim = mkPlayer(B, 460, 400);
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap, "hangout");
    // Activate Crimson Tithe, then fire at the victim.
    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, victim], { [A as string]: frame(SLOT1_BIT, 1) }),
      DT_MS,
    );
    state = res.state;
    expect(state.players[A]!.titheUntilTick).toBeDefined();
    const victimHealthBefore = state.players[B]!.health;
    for (let t = 0; t < 30; t++) {
      res = stepWithRuntime(
        state,
        runtime,
        inputsWith([caster, victim], {
          [A as string]: frame(FIRE_BIT, 400 + t, victim.x, victim.y),
        }),
        DT_MS,
      );
      state = res.state;
    }
    expect(state.players[B]!.health).toBe(victimHealthBefore);
    expect(res.events.some((e) => e.t === "hit-confirmed")).toBe(false);
  });

  test("ability pity floor: a hand with no actives ALWAYS sees at least one ability offer", () => {
    const fresh = mkPlayer(A, 400, 400); // no cards at all
    const other = mkPlayer(B, 600, 400);
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 0, [B]: 1 },
      roundIndex: 1,
      winnerPlayerId: B,
    };
    for (let seed = 1; seed <= 60; seed++) {
      const roll = enterDrafting(
        round,
        { [A]: fresh, [B]: other },
        Tick(100),
        seed >>> 0,
      );
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.length).toBeGreaterThan(0);
      const abilityIds = [
        "crimson-tithe",
        "shadow-step",
        "veil-of-nought",
        "severing-answer",
        "shelter-seal",
        // Geometrician catalog v1 (docs/class-ability-catalogs-v1.md,
        // classId:"wizard") — this suite's `mkPlayer` default characterId
        // is "balanced" (wizard), so these ten are eligible offers too.
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
      ];
      expect(offer.some((id) => abilityIds.includes(id))).toBe(true);
    }
  });

  test("a held unique ability card is never re-offered at the draft", () => {
    const holder = mkPlayer(A, 400, 400);
    holder.cards = ["crimson-tithe"];
    const other = mkPlayer(B, 600, 400);
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 1, [B]: 0 },
      roundIndex: 1,
      winnerPlayerId: A,
    };
    // Roll many draft entries across seeds — the holder must never see the
    // tithe again (unique + slot machinery both point the same way).
    for (let seed = 1; seed <= 40; seed++) {
      const roll = enterDrafting(
        round,
        { [A]: holder, [B]: other },
        Tick(100),
        seed >>> 0,
      );
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.length).toBeGreaterThan(0); // guard against a vacuous pass
      expect(offer.includes("crimson-tithe")).toBe(false);
    }
  });

  // Rack size (docs/classes-goal.md "Rotation system", soft lock
  // 2026-07-17): exactly 3 slots, never 4. These pin both enforcement
  // sites (weaponBuild resolve + round.ts offer-roll) to the canonical
  // constant so a future edit can't silently drift the two apart.
  test("MAX_ABILITY_SLOTS is locked at 3 (docs/classes-goal.md Rotation system)", () => {
    expect(MAX_ABILITY_SLOTS).toBe(3);
  });

  test("a hand holding four+ ability cards resolves to exactly 3 actives (weaponBuild cap)", () => {
    const holder = mkPlayer(A, 400, 400);
    holder.cards = [
      "crimson-tithe",
      "shadow-step",
      "veil-of-nought",
      "severing-answer",
      "shelter-seal",
    ];
    const build = resolvePlayerBuild(holder);
    expect(build.actives.length).toBe(3);
  });

  test("the draft stops offering ability cards once 3 slots are held (offer-roll cap)", () => {
    const holder = mkPlayer(A, 400, 400);
    holder.cards = ["crimson-tithe", "shadow-step", "veil-of-nought"];
    const other = mkPlayer(B, 600, 400);
    const round = {
      phase: "round-over" as const,
      countdownRemainingMs: 0,
      scores: { [A]: 1, [B]: 0 },
      roundIndex: 1,
      winnerPlayerId: A,
    };
    const abilityIds = [
        "crimson-tithe",
        "shadow-step",
        "veil-of-nought",
        "severing-answer",
        "shelter-seal",
        // Geometrician catalog v1 (docs/class-ability-catalogs-v1.md,
        // classId:"wizard") — this suite's `mkPlayer` default characterId
        // is "balanced" (wizard), so these ten are eligible offers too.
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
      ];
    for (let seed = 1; seed <= 40; seed++) {
      const roll = enterDrafting(
        round,
        { [A]: holder, [B]: other },
        Tick(100),
        seed >>> 0,
      );
      const offer = roll.state.draftingOffers?.[A] ?? [];
      expect(offer.some((id) => abilityIds.includes(id))).toBe(false);
    }
  });
});
