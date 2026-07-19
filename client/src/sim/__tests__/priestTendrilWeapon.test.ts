// Priest "oozing tendrils of fire" basic fire (weapon.ts stepWeaponNative,
// constants.ts's SYZ_TENDRIL_* doc comment has the full design rationale).
// Priest's basic-fire ramping-channel mechanic (this class used to own) was
// reassigned to Wizard mid-session — see wizardChannelWeapon.test.ts — and
// Priest needed "something completely different... oozing tendrils of
// fire" in its place, built from the SAME low-aim/self-guiding throughline
// as the class's own Bleed Tithe ability (syzygistCatalog.test.ts).
//
// REVISED 2026-07-19 (Jake: "your shooting projectiles not object avoiding
// tendrils that pulse attack or healing effects depending"): the volley is
// now DUAL-PURPOSE (homes onto the closest player of EITHER team — ally or
// enemy — and pulses a HEAL on an ally instead of damage+burn) and steers
// away from nearby platform geometry instead of flying a straight-ish
// homing line through it. This file's old "enemyOnly" coverage (a tendril
// must never home onto the caster's own ally) is GONE — that's now the
// opposite of the intended behavior — replaced by dual-target coverage.
//
// Coverage:
//   (1) the tendrils themselves: multi-tendril spawn shape, total-damage
//       bookkeeping, genuine per-tick homing onto an off-axis target,
//       fire-element burn-on-hit, and a real card modifier surviving on a
//       fired tendril.
//   (2) dual-target homing + heal/damage split: a volley curves onto and
//       HEALS the closest ally when no enemy is nearer; still damages+burns
//       the closest ENEMY exactly as before when no ally is nearer; and a
//       volley with no other player in range at all fires and steps
//       sanely (no crash, no silent no-op) rather than needing enemy-only
//       special-casing for the empty-target case.
//   (3) obstacle avoidance: a tendril's per-tick homing turn measurably
//       curves away from nearby platform geometry, unlike an identical
//       non-tendril homing shard (straight, undeflected baseline) — and
//       survives a near-graze that the same undeflected baseline dies to.
//   (4) class gating, both directions: Wizard/Ninja/Paladin's
//       stepWeaponNative output AND their projectile collision/targeting
//       behavior are completely unaffected by this change (Priest/Ninja/
//       Paladin staying unaffected by the SEPARATE wizard-ramp change is
//       wizardChannelWeapon.test.ts's own responsibility — its
//       NON_WIZARD_CLASSES loop already covers that direction).

import { describe, test, expect } from "bun:test";
import { stepWeapon, resolvePlayerBuild } from "../weapon.js";
import { createRuntime, stepWithRuntime } from "../World.js";
import { stepProjectile } from "../projectile.js";
import { buildStaticCache } from "../collision.js";
import {
  SYZ_TENDRIL_COUNT,
  SYZ_TENDRIL_DAMAGE,
  SYZ_TENDRIL_HOMING_STRENGTH,
} from "../constants.js";
import {
  EntityId,
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type MapDefinition,
  type PlatformDefinition,
  type PlayerEntity,
  type ProjectileEntity,
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
  test("a single Fire press spawns SYZ_TENDRIL_COUNT independently-homing, fire-element shards, identity-flagged as tendrils", () => {
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
      // `tendril` (identity) is stamped; `enemyOnly` (targeting-exclusion)
      // is deliberately NOT — dual-target homing is now the default
      // no-flag `closestNonOwnerPlayer` behavior (see constants.ts).
      expect(proj.tendril).toBe(true);
      expect(proj.enemyOnly).toBeUndefined();
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
      expect(proj.tendril).toBe(true);
    }
  });
});

// ── Full-sim tests (homing/burn/heal genuinely need per-tick projectile
// stepping against a real `state.players` map — the same
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

  test("dual-target homing: a tendril volley curves onto and HEALS the closest ALLY when no enemy is nearer", () => {
    // Ally C sits right next to the caster (well inside what the generic
    // closest-non-owner-player homing snaps to); "enemy" B (no shared team)
    // sits much farther away. Under the OLD enemyOnly-gated behavior this
    // volley was proven to skip C and connect with B instead; dual-target
    // homing flips that — the closest non-owner player is now legal
    // regardless of team, so the volley should curve onto C and heal them.
    const caster = mkFullPlayer(A, 400, 400, "shielded", { teamId: "duo" });
    const ally = mkFullPlayer(C, 440, 440, "balanced", { teamId: "duo", health: 60 });
    const enemy = mkFullPlayer(B, 800, 400, "sprinter");
    let state = mkState([caster, ally, enemy]);
    const runtime = createRuntime(flatMap);
    let seq = 1;
    let healed = false;
    for (let t = 0; t < 90 && !healed; t++) {
      const res = stepWithRuntime(
        state,
        runtime,
        inputsWith([caster, ally, enemy], { [A as string]: frame(FIRE_BIT, seq++, 800, 400) }),
        DT_MS,
      );
      state = res.state;
      if (state.players[C]!.health > 60) healed = true;
    }
    expect(healed).toBe(true);
    expect(state.players[C]!.health).toBeGreaterThan(60);
    expect(state.players[C]!.health).toBeLessThanOrEqual(100);
    // A heal is not a hit: no burn/status ever lands on the healed ally.
    expect(state.players[C]!.burnUntilTick).toBeUndefined();
    // The farther enemy was never reached this run.
    expect(state.players[B]!.health).toBe(100);
  });

  test("dual-target homing: still damages+burns the closest ENEMY exactly as before when no ally is nearer (regression parity with the old behavior)", () => {
    const caster = mkFullPlayer(A, 400, 400, "shielded", { teamId: "duo" });
    const enemy = mkFullPlayer(B, 440, 440, "sprinter"); // closest, no shared team
    const ally = mkFullPlayer(C, 800, 400, "balanced", { teamId: "duo" });
    let state = mkState([caster, enemy, ally]);
    const runtime = createRuntime(flatMap);
    let seq = 1;
    let hit = false;
    for (let t = 0; t < 90 && !hit; t++) {
      const res = stepWithRuntime(
        state,
        runtime,
        inputsWith([caster, enemy, ally], { [A as string]: frame(FIRE_BIT, seq++, 440, 440) }),
        DT_MS,
      );
      state = res.state;
      if (state.players[B]!.health < 100) hit = true;
    }
    expect(hit).toBe(true);
    expect(state.players[B]!.health).toBeLessThan(100);
    expect(state.players[B]!.burnUntilTick).toBeDefined();
    // The farther ally, never reached, is untouched — no stray heal either.
    expect(state.players[C]!.health).toBe(100);
  });

  test("no other player nearby: the volley still fires and steps for its full run without throwing or silently no-oping", () => {
    const caster = mkFullPlayer(A, 400, 400, "shielded");
    let state = mkState([caster]);
    const runtime = createRuntime(flatMap);
    expect(() => {
      let seq = 1;
      for (let t = 0; t < 200; t++) {
        const res = stepWithRuntime(
          state,
          runtime,
          inputsWith([caster], { [A as string]: frame(FIRE_BIT, seq++, 800, 400) }),
          DT_MS,
        );
        state = res.state;
      }
    }).not.toThrow();
    // The volley was genuinely spawned and is live mid-flight (not silently
    // dropped) — the caster's own health is untouched (no self-harm) and
    // the caster is still alive/firing.
    expect(state.players[A]!.alive).toBe(true);
    expect(state.players[A]!.health).toBe(100);
    expect(Object.keys(state.projectiles).length).toBeGreaterThan(0);
  });
});

describe("Priest tendrils: obstacle avoidance (Part 2 — steers away from nearby platform geometry)", () => {
  // A floor-like platform whose top surface sits 30px BELOW the tendril's
  // flight altitude — close enough to enter the SYZ_TENDRIL_AVOID_LOOKAHEAD_PX
  // sensing radius (80px) well before the shard would ever actually touch
  // it, far enough that an undeflected straight shot never clips it at all.
  // Isolates the STEERING effect from the "does it die" question.
  const NEARBY_FLOOR: PlatformDefinition = {
    id: "nearby-floor",
    kind: "floor",
    position: { x: 550, y: 480 }, // top edge at 480 - 50 = 430
    size: { x: 300, y: 100 },
  };
  const avoidCache = buildStaticCache([NEARBY_FLOOR], 2000, 2000);

  function mkHomingShard(overrides: Partial<ProjectileEntity> = {}): ProjectileEntity {
    return {
      id: EntityId(1),
      ownerId: PlayerId("shooter"),
      x: 300,
      y: 400,
      vx: 320,
      vy: 0,
      shape: "circle",
      radius: 6,
      damage: SYZ_TENDRIL_DAMAGE,
      lifetimeMs: 3000,
      pathing: "homing",
      element: "fire",
      bouncesRemaining: 0,
      pierceRemaining: 0,
      homingStrength: SYZ_TENDRIL_HOMING_STRENGTH,
      ageMs: 1, // past the spawn-overlap grace tick
      traveledPx: 0,
      originX: 300,
      originY: 400,
      returning: false,
      ...overrides,
    };
  }

  function runTicks(proj: ProjectileEntity, platform: PlatformDefinition, ticks: number) {
    let cur: ProjectileEntity | null = proj;
    let lastY = proj.y;
    let expiredAtTick = -1;
    for (let t = 0; t < ticks; t++) {
      if (!cur) break;
      const stepped = stepProjectile(cur, {
        platforms: [platform],
        players: {}, // no player target — isolates avoidance from homing-onto-a-player
        dtMs: DT_MS,
        tick: Tick(t),
        rngState: 1,
        collisionCache: avoidCache,
      });
      if (stepped.projectile) lastY = stepped.projectile.y;
      cur = stepped.projectile;
      if (stepped.expired && expiredAtTick === -1) expiredAtTick = t;
    }
    return { finalY: lastY, expiredAtTick, alive: cur !== null };
  }

  test("a tendril (proj.tendril=true) curves measurably away from nearby platform geometry, unlike an identical non-tendril homing shard", () => {
    const tendril = mkHomingShard({ tendril: true });
    const plain = mkHomingShard(); // no tendril flag — old/every-other-class behavior

    const tendrilResult = runTicks(tendril, NEARBY_FLOOR, 40);
    const plainResult = runTicks(plain, NEARBY_FLOOR, 40);

    // Baseline: with no player target and no avoidance code path, a plain
    // homing shard's homing case is a complete no-op (no target => no
    // turn) — it flies dead straight along y=400 the whole run.
    expect(plainResult.finalY).toBeCloseTo(400, 5);

    // The tendril senses the floor once within the lookahead radius and
    // steers its heading upward (away from it) — a real, measurable
    // deviation off the same straight line the plain shard stayed on.
    expect(Math.abs(tendrilResult.finalY - 400)).toBeGreaterThan(5);
    expect(tendrilResult.finalY).toBeLessThan(plainResult.finalY);
  });

  test("a tendril survives a near-graze that an identical non-tendril homing shard clips and dies to", () => {
    // Same floor, but its top edge sits only 4px below the flight line —
    // inside the shard's own radius (6), so an UNDEFLECTED straight shot
    // clips it once it enters the platform's horizontal span and expires.
    const grazingFloor: PlatformDefinition = {
      id: "grazing-floor",
      kind: "floor",
      position: { x: 550, y: 454 }, // top edge at 454 - 50 = 404 (4px below y=400)
      size: { x: 300, y: 100 },
    };
    const grazeCache = buildStaticCache([grazingFloor], 2000, 2000);

    function run(proj: ProjectileEntity) {
      let cur: ProjectileEntity | null = proj;
      let expired = false;
      for (let t = 0; t < 60 && cur; t++) {
        const stepped = stepProjectile(cur, {
          platforms: [grazingFloor],
          players: {},
          dtMs: DT_MS,
          tick: Tick(t),
          rngState: 1,
          collisionCache: grazeCache,
        });
        cur = stepped.projectile;
        if (stepped.expired) {
          expired = true;
          break;
        }
      }
      return { expired, survivedAllTicks: cur !== null };
    }

    const plainResult = run(mkHomingShard());
    const tendrilResult = run(mkHomingShard({ tendril: true }));

    // The plain shard flies dead straight into the 4px-under floor and
    // dies to it, exactly like every other class's homing shot would.
    expect(plainResult.expired).toBe(true);
    // The tendril, steering away in advance, does not die to the same
    // terrain it was "supposed to organically dodge".
    expect(tendrilResult.survivedAllTicks).toBe(true);
  });
});

describe("Priest tendrils: CRITICAL regression — every other class's projectile targeting AND collision is completely unaffected", () => {
  test("a plain (non-tendril) homing projectile's platform-collision behavior is byte-identical to before: it still clips and expires on terrain, with zero avoidance steering", () => {
    const floor: PlatformDefinition = {
      id: "floor",
      kind: "floor",
      position: { x: 550, y: 454 },
      size: { x: 300, y: 100 },
    };
    const cache = buildStaticCache([floor], 2000, 2000);
    const shard: ProjectileEntity = {
      id: EntityId(1),
      ownerId: PlayerId("shooter"),
      x: 300,
      y: 400,
      vx: 320,
      vy: 0,
      shape: "circle",
      radius: 6,
      damage: 10,
      lifetimeMs: 3000,
      pathing: "homing",
      element: "crystal",
      bouncesRemaining: 0,
      pierceRemaining: 0,
      homingStrength: 5,
      ageMs: 1,
      traveledPx: 0,
      originX: 300,
      originY: 400,
      returning: false,
      // tendril intentionally absent/undefined — every non-Priest shot.
    };
    let cur: ProjectileEntity | null = shard;
    let expired = false;
    let lastY = shard.y;
    for (let t = 0; t < 60 && cur; t++) {
      const stepped = stepProjectile(cur, {
        platforms: [floor],
        players: {},
        dtMs: DT_MS,
        tick: Tick(t),
        rngState: 1,
        collisionCache: cache,
      });
      if (stepped.projectile) lastY = stepped.projectile.y;
      cur = stepped.projectile;
      if (stepped.expired) {
        expired = true;
        break;
      }
    }
    // Unaffected: dies to the near-graze exactly like the "plain" arm of
    // the tendril survival test above, and never deviates off y=400 first
    // (no avoidance code path ever runs for it).
    expect(expired).toBe(true);
    expect(lastY).toBeCloseTo(400, 5);
  });

  test("a plain (non-tendril) homing projectile's TARGETING is unaffected: still homes on the closest non-owner player regardless of team, exactly like every homing shot always has", () => {
    const caster = mkFullPlayer(A, 400, 400, "shielded", { teamId: "duo" });
    const ally = mkFullPlayer(C, 440, 440, "balanced", { teamId: "duo" });
    let state = mkState([caster, ally]);
    const runtime = createRuntime(flatMap);
    // Spawn a plain (non-tendril) homing world-owned shard aimed away from
    // the ally, and confirm it re-targets onto the only other player
    // (the ally) — this is the SAME `closestNonOwnerPlayer` default
    // behavior every homing shot has always had; the tendril rework didn't
    // touch it, it only stopped Priest's OWN shots from opting out of it.
    state = {
      ...state,
      projectiles: {
        [EntityId(999)]: {
          id: EntityId(999),
          ownerId: A,
          x: 400,
          y: 400,
          vx: 320,
          vy: 0,
          shape: "circle",
          radius: 6,
          damage: 10,
          lifetimeMs: 3000,
          pathing: "homing",
          element: "crystal",
          bouncesRemaining: 0,
          pierceRemaining: 0,
          homingStrength: 5,
          ageMs: 1,
          traveledPx: 0,
          originX: 400,
          originY: 400,
          returning: false,
        },
      },
    };
    let hit = false;
    for (let t = 0; t < 90 && !hit; t++) {
      const res = stepWithRuntime(state, runtime, inputsWith([caster, ally], {}), DT_MS);
      state = res.state;
      if (state.players[C]!.health < 100) hit = true;
    }
    expect(hit).toBe(true);
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
        // Neither the (dormant) targeting-exclusion flag nor the tendril
        // identity flag ever appears for them.
        expect(proj.enemyOnly).toBeUndefined();
        expect(proj.tendril).toBeUndefined();
      }
    });
  }

  // "balanced" (wizard) legitimately carries its OWN separate,
  // already-tested (wizardChannelWeapon.test.ts) ramp-driven cooldown
  // deviation from the flat pre-ramp formula — that's Part 1 of this same
  // session's work, not a regression from the priest-tendril change, so
  // asserting exact-formula cooldown equality here would be testing the
  // wrong thing. What THIS priest-only change must not do is add anything
  // ON TOP of that: wizard's pathing/element/tendril must stay exactly
  // what starterWeapon always resolved to, completely untouched by any
  // SYZ_TENDRIL_* constant.
  test("balanced (wizard): the priest tendril rework adds nothing beyond the wizard's own already-tested ramp — pathing/element/tendril unaffected", () => {
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
    expect(result.projectiles[0]!.tendril).toBeUndefined();
  });
});
