// Priest "oozing tendrils of fire" basic fire (weapon.ts stepWeaponNative,
// constants.ts's SYZ_TENDRIL_* doc comment has the full design rationale).
// Priest's basic-fire ramping-channel mechanic (this class used to own) was
// reassigned to Wizard mid-session — see wizardChannelWeapon.test.ts — and
// Priest needed "something completely different... oozing tendrils of
// fire" in its place, built from the SAME low-aim/self-guiding throughline
// as the class's own Bleed Tithe ability (syzygistCatalog.test.ts).
//
// Coverage:
//   (1) the tendrils themselves: multi-tendril spawn shape, total-damage
//       bookkeeping, genuine per-tick homing onto an off-axis target,
//       fire-element burn-on-hit, and a real card modifier surviving on a
//       fired tendril.
//   (2) enemyOnly: a tendril volley never homes onto the caster's own ally
//       even when the ally is far closer than the actual enemy target.
//   (3) class gating, both directions: Wizard/Ninja/Paladin's
//       stepWeaponNative output is unaffected by this change (Priest/
//       Ninja/Paladin staying unaffected by the SEPARATE wizard-ramp change
//       is wizardChannelWeapon.test.ts's own responsibility — its
//       NON_WIZARD_CLASSES loop already covers that direction).

import { describe, test, expect } from "bun:test";
import { stepWeapon, resolvePlayerBuild } from "../weapon.js";
import { createRuntime, stepWithRuntime } from "../World.js";
import { SYZ_TENDRIL_COUNT, SYZ_TENDRIL_DAMAGE } from "../constants.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlayerEntity,
  type WorldState,
} from "../types.js";

const DT_MS = 1000 / 60;
const FIRE_BIT = 1 << 6; // player.ts's Bit.Fire

function mkPlayer(over: Partial<PlayerEntity> = {}): PlayerEntity {
  return {
    id: "p1" as PlayerId,
    characterId: "shielded",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 100,
    aimY: 0,
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

describe("Priest tendrils: shape of the volley (unit-level, no world state needed)", () => {
  test("a single Fire press spawns SYZ_TENDRIL_COUNT independently-homing, fire-element shards", () => {
    const player = mkPlayer();
    const build = resolvePlayerBuild(player);
    expect(build.projectile.count).toBe(SYZ_TENDRIL_COUNT);
    expect(build.damage).toBe(SYZ_TENDRIL_DAMAGE);
    expect(build.projectile.pathing).toBe("homing");
    expect(build.projectile.element).toBe("fire");

    let nextId = 1;
    const result = stepWeapon(player, true, { x: 500, y: 0 }, DT_MS, () => EntityId(nextId++));
    expect(result.fired).toBe(true);
    expect(result.projectiles).toHaveLength(SYZ_TENDRIL_COUNT);
    for (const proj of result.projectiles) {
      expect(proj.damage).toBe(SYZ_TENDRIL_DAMAGE);
      expect(proj.pathing).toBe("homing");
      expect(proj.element).toBe("fire");
      expect(proj.enemyOnly).toBe(true);
    }
    // Total damage if every tendril connects is DELIBERATELY below the old
    // single-shot detune total (9) — REVISED 2026-07-19 (Jake: "long range
    // but weak on attack powerful on effects"). constants.ts's own
    // SYZ_TENDRIL_* bookkeeping comment.
    const totalIfAllConnect = result.projectiles.reduce((sum, p) => sum + p.damage, 0);
    expect(totalIfAllConnect).toBe(SYZ_TENDRIL_COUNT * SYZ_TENDRIL_DAMAGE);
  });
});

describe("Priest tendrils: card modifiers still fully apply to a fired tendril", () => {
  test("+1 Projectile (class-blind quantity card) visibly changes the volley: +1 tendril, damage scaled by its own multiplier", () => {
    const player = mkPlayer({ cards: ["one-more-shard"] });
    const build = resolvePlayerBuild(player);
    // one-more-shard's modifier: projectileCountAdd 1, damageMultiplier 0.94.
    expect(build.projectile.count).toBe(SYZ_TENDRIL_COUNT + 1);
    expect(build.damage).toBeCloseTo(SYZ_TENDRIL_DAMAGE * 0.94, 5);

    let nextId = 1;
    const result = stepWeapon(player, true, { x: 500, y: 0 }, DT_MS, () => EntityId(nextId++));
    expect(result.fired).toBe(true);
    expect(result.projectiles).toHaveLength(SYZ_TENDRIL_COUNT + 1);
    for (const proj of result.projectiles) {
      // The card's damage multiplier survives on every tendril, not just
      // the base weapon's own baseline — the ramp/tendril machinery never
      // bypasses the resolved build.
      expect(proj.damage).toBeCloseTo(SYZ_TENDRIL_DAMAGE * 0.94, 5);
      expect(proj.element).toBe("fire");
      expect(proj.pathing).toBe("homing");
      expect(proj.enemyOnly).toBe(true);
    }
  });
});

// ── Full-sim tests (homing/burn/ally-exclusion genuinely need per-tick
// projectile stepping against a real `state.players` map — the same
// createRuntime/stepWithRuntime harness syzygistCatalog.test.ts's own
// Bleed Tithe tests use, adapted for a HELD Fire input instead of a
// rising-edge ability slot). ──────────────────────────────────────────────

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1600, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 600, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 800, y: 500 }, size: { x: 1600, y: 60 } },
  ],
};

function mkFullPlayer(
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

const A = PlayerId("a");
const B = PlayerId("b");
const C = PlayerId("c");

describe("Priest tendrils: representative sim effects (full runtime)", () => {
  test("a tendril volley connects and burns the victim (fire-element burn-on-hit reuses World.ts's generic branch)", () => {
    const caster = mkFullPlayer(A, 400, 400, "shielded");
    const victim = mkFullPlayer(B, 640, 400, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    let hit = false;
    let seq = 1;
    for (let t = 0; t < 90 && !hit; t++) {
      const res = stepWithRuntime(
        state,
        runtime,
        inputsWith([caster, victim], { [A as string]: frame(FIRE_BIT, seq++, 640, 400) }),
        DT_MS,
      );
      state = res.state;
      if (state.players[B]!.health < 100) hit = true;
    }
    expect(hit).toBe(true);
    // Burn: the victim now carries a burn DoT from a fire-element tendril.
    expect(state.players[B]!.burnUntilTick).toBeDefined();
    expect(state.players[B]!.burnDps).toBeGreaterThan(0);
  });

  test("genuine homing: a tendril volley still connects after the target steps off the original aim line", () => {
    // Fire once, aimed directly at the victim's cast-time position
    // (400,400) -> (700,400), a due-east line. Immediately after firing,
    // the victim jumps 180px off that line — a `pathing: "straight"` shard
    // would sail past forever; only a shard that RE-TARGETS every tick
    // (`pathing: "homing"`, closestNonOwnerPlayer) can curve and still
    // connect. Mirrors syzygistCatalog.test.ts's own Bleed Tithe "genuine
    // homing" test, adapted for basic fire instead of an ability cast.
    const caster = mkFullPlayer(A, 400, 400, "shielded");
    const victim = mkFullPlayer(B, 700, 400, "balanced");
    let state = mkState([caster, victim]);
    const runtime = createRuntime(flatMap);
    let res = stepWithRuntime(
      state,
      runtime,
      inputsWith([caster, victim], { [A as string]: frame(FIRE_BIT, 1, 700, 400) }),
      DT_MS,
    );
    state = res.state;
    // Off the original line, same distance band the tendrils still have
    // time to close within their SYZ_TENDRIL_LIFETIME_SECONDS lifetime at
    // SYZ_TENDRIL_SPEED.
    state = { ...state, players: { ...state.players, [B]: { ...state.players[B]!, y: 220 } } };
    let hit = false;
    for (let t = 0; t < 90 && !hit; t++) {
      res = stepWithRuntime(state, runtime, inputsWith([caster, victim], {}), DT_MS);
      state = res.state;
      if (state.players[B]!.health < 100) hit = true;
    }
    expect(hit).toBe(true);
  });

  test("enemyOnly: a tendril volley never homes onto the caster's own ally, even when the ally is far closer than the actual enemy", () => {
    // Ally C sits right next to the caster (well inside what the generic
    // closest-non-owner-player homing would normally snap to); enemy B
    // sits much farther away, in the direction the caster actually aims.
    // Without the `enemyOnly` filter, closestNonOwnerPlayer would curve the
    // tendrils onto C almost immediately. With it, C must be skipped
    // entirely — the volley must still find and connect with B.
    const caster = mkFullPlayer(A, 400, 400, "shielded", { teamId: "duo" });
    const ally = mkFullPlayer(C, 440, 440, "balanced", { teamId: "duo" });
    const enemy = mkFullPlayer(B, 800, 400, "sprinter");
    let state = mkState([caster, ally, enemy]);
    const runtime = createRuntime(flatMap);
    let seq = 1;
    let hit = false;
    for (let t = 0; t < 90 && !hit; t++) {
      const res = stepWithRuntime(
        state,
        runtime,
        inputsWith([caster, ally, enemy], { [A as string]: frame(FIRE_BIT, seq++, 800, 400) }),
        DT_MS,
      );
      state = res.state;
      if (state.players[B]!.health < 100) hit = true;
    }
    expect(hit).toBe(true);
    expect(state.players[B]!.health).toBeLessThan(100);
    // The ally was never a legal target — health untouched for the whole run.
    expect(state.players[C]!.health).toBe(100);
  });
});

describe("Priest tendrils: class gating, reverse direction — Wizard/Ninja/Paladin unaffected by this change", () => {
  // sprinter (ninja) and heavy (paladin) never touch either the wizard-ramp
  // OR the priest-tendril code paths at all — a plain byte-identical
  // formula check is the right bar for them.
  const FULLY_UNRELATED_CLASSES: PlayerEntity["characterId"][] = ["sprinter", "heavy"];
  for (const characterId of FULLY_UNRELATED_CLASSES) {
    test(`${characterId}: a single fire tick is byte-identical to the pre-tendril formula`, () => {
      const player = mkPlayer({ characterId });
      const build = resolvePlayerBuild(player);
      let nextId = 1;
      const result = stepWeapon(player, true, { x: 500, y: 0 }, DT_MS, () => EntityId(nextId++));
      expect(result.fired).toBe(true);
      expect(result.player.fireCooldownMs).toBeCloseTo(1000 / build.fireRate, 10);
      expect(result.projectiles).toHaveLength(build.projectile.count);
      for (const proj of result.projectiles) {
        expect(proj.damage).toBe(build.damage);
        expect(proj.pathing).toBe(build.projectile.pathing);
        expect(proj.element).toBe(build.projectile.element);
        // The priest-only enemyOnly stamp must never appear for them.
        expect(proj.enemyOnly).toBeUndefined();
      }
    });
  }

  // "balanced" (wizard) legitimately carries its OWN separate,
  // already-tested (wizardChannelWeapon.test.ts) ramp-driven cooldown
  // deviation from the flat pre-ramp formula — that's Part 1 of this same
  // session's work, not a regression from the priest-tendril change, so
  // asserting exact-formula cooldown equality here would be testing the
  // wrong thing. What THIS priest-only change must not do is add anything
  // ON TOP of that: wizard's pathing/element/enemyOnly must stay exactly
  // what starterWeapon always resolved to, completely untouched by any
  // SYZ_TENDRIL_* constant.
  test("balanced (wizard): the priest tendril rework adds nothing beyond the wizard's own already-tested ramp — pathing/element/enemyOnly unaffected", () => {
    const player = mkPlayer({ characterId: "balanced" });
    const build = resolvePlayerBuild(player);
    expect(build.projectile.pathing).toBe("straight");
    expect(build.projectile.element).toBe("crystal");
    let nextId = 1;
    const result = stepWeapon(player, true, { x: 500, y: 0 }, DT_MS, () => EntityId(nextId++));
    expect(result.fired).toBe(true);
    expect(result.projectiles[0]!.pathing).toBe("straight");
    expect(result.projectiles[0]!.element).toBe("crystal");
    expect(result.projectiles[0]!.enemyOnly).toBeUndefined();
  });
});
