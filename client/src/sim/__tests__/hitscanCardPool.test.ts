// Card-pool raycast-compatibility pass (2026-07-20, Jake: "a lot of things
// break raycast on wizard, deeply iterate current system to work raycast
// too"). Covers the Category B mechanics that now work NATIVELY on a
// same-tick hitscan hit instead of falling back to a traveling projectile:
// pierce (resolveHitscanShot gathers multiple ordered hits along one ray),
// explosive/slow-field impact (routed through the existing PendingInstantAoe
// queue), and split (spawns real child ProjectileEntitys at the ray's
// terminal point). See weaponBuild.test.ts's "travel-time-only cards fall
// back to delivery: projectile" for the Category A (homing/bounce/gravity/
// etc.) half of this same pass.

import { describe, expect, test } from "bun:test";
import { createRuntime, stepWithRuntime } from "../World.js";
import { spawnProjectile, stepProjectile } from "../projectile.js";
import {
  EntityId,
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
const C = PlayerId("c");

const DT_MS = 1000 / 60;
const FIRE_BIT = 1 << 6;

const flatMap: MapDefinition = {
  id: "test",
  name: "test",
  size: { x: 1280, y: 720 },
  spawns: [
    { x: 200, y: 400 },
    { x: 900, y: 400 },
  ],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 640, y: 700 }, size: { x: 1280, y: 40 } },
  ],
};

const wallMap: MapDefinition = {
  id: "wall-test",
  name: "wall-test",
  size: { x: 1280, y: 720 },
  spawns: [{ x: 200, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 640, y: 700 }, size: { x: 1280, y: 40 } },
    { id: "wall-right", kind: "wall", position: { x: 620, y: 400 }, size: { x: 32, y: 400 } },
  ],
};

function mkPlayer(
  id: PlayerId,
  x: number,
  y: number,
  over: Partial<PlayerEntity> = {},
): PlayerEntity {
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

describe("Hitscan pierce (Void Fracture / Voltaic Spark / Pierce Chain)", () => {
  test("a single shot damages TWO lined-up victims in the same tick, no ProjectileEntity ever created", () => {
    // "balanced" (wizard) defaults to raycast delivery again (THE
    // GEOMETRICIAN RULING, 2026-07-24, weapons.ts — the 2026-07-22
    // `wizardStarterWeapon` projectile era was a misread of Jake's intent).
    // The explicit Raycast Prism pick (added while that misread was live)
    // stays: it's still a real, pickable delivery-changing card, and on an
    // already-raycast wizard it's simply a no-op — the pick keeps this
    // suite's hitscan coverage independent of any class's base delivery.
    const shooter = mkPlayer(A, 400, 400, { cards: ["void-fracture", "raycast-prism"] });
    // Both victims sit on the muzzle's own aim line (same y as the aim
    // target) so one ray sweeps through both in order. Far enough out that
    // the muzzle-height-vs-aim-line offset (the ray starts a bit above the
    // nominal y and angles down toward it) has already converged by the
    // time it reaches them — closer victims at this same y sit just above
    // the ray's actual path and get missed.
    const victim1 = mkPlayer(B, 700, 400);
    const victim2 = mkPlayer(C, 850, 400);
    const state = mkState([shooter, victim1, victim2]);
    const runtime = createRuntime(flatMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([shooter, victim1, victim2], { [A as string]: frame(FIRE_BIT, 1, 900, 400) }),
      DT_MS,
    );

    expect(res.state.players[B]!.health).toBeLessThan(100);
    expect(res.state.players[C]!.health).toBeLessThan(100);
    expect(Object.keys(res.state.projectiles).length).toBe(0);
  });
});

describe("Hitscan explosive impact (Explosive Facet)", () => {
  test("a shot that hits a wall still splashes a bystander standing near the impact point", () => {
    // Raycast Prism pick — a no-op on today's raycast-by-ruling wizard;
    // see the pierce describe block above.
    const shooter = mkPlayer(A, 400, 400, { cards: ["explosive-facet", "raycast-prism"] });
    // Bystander offset PERPENDICULAR to the ray (below it), within
    // impactRadiusPx of the wall-impact point but never directly hit by the
    // ray itself — proves the AOE, not a direct hit.
    const bystander = mkPlayer(B, 585, 420);
    const state = mkState([shooter, bystander]);
    const runtime = createRuntime(wallMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([shooter, bystander], { [A as string]: frame(FIRE_BIT, 1, 900, 400) }),
      DT_MS,
    );

    expect(res.state.players[B]!.health).toBeLessThan(100);
  });
});

describe("Hitscan slow-field impact (Slow Field)", () => {
  test("a shot that hits a wall still slows a bystander standing near the impact point", () => {
    // Raycast Prism pick — a no-op on today's raycast-by-ruling wizard;
    // see the pierce describe block above.
    const shooter = mkPlayer(A, 400, 400, { cards: ["slow-field", "raycast-prism"] });
    const bystander = mkPlayer(B, 585, 420);
    const state = mkState([shooter, bystander]);
    const runtime = createRuntime(wallMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([shooter, bystander], { [A as string]: frame(FIRE_BIT, 1, 900, 400) }),
      DT_MS,
    );

    expect(res.state.players[B]!.slowedUntilTick).toBeDefined();
    expect(res.state.players[B]!.slowMultiplier ?? 1).toBeLessThan(1);
  });
});

describe("Hitscan split (Pierce Chain / Cluster Bomb)", () => {
  test("a resolved hitscan shot spawns real child ProjectileEntitys at the ray's terminal point", () => {
    const shooter = mkPlayer(A, 400, 400, { cards: ["cluster-bomb"] });
    const state = mkState([shooter]);
    const runtime = createRuntime(wallMap);

    const res = stepWithRuntime(
      state,
      runtime,
      inputsWith([shooter], { [A as string]: frame(FIRE_BIT, 1, 900, 400) }),
      DT_MS,
    );

    expect(Object.keys(res.state.projectiles).length).toBeGreaterThan(0);
  });
});

describe("void-fracture pierce also works for a REAL traveling projectile (not just hitscan)", () => {
  test("regression: projectile.ts's pierce-continue branch used to require impact === 'pierce-chain' specifically, silently making Void Fracture's pierceCount dead code for EVERY delivery — a plain traveling projectile with pierceRemaining set (impact left at the default 'none', matching Void Fracture) survives its first hit and goes on to also hit a second victim", () => {
    // Bypasses class/Fire-input routing entirely (no character in this sim
    // has a plain straight-shot base weapon to drive this through: Ninja's
    // base weapon is the raycast starterWeapon, Priest's base weapon bakes
    // in homing tendrils, Paladin's Fire never calls stepWeapon at all — see
    // this session's notes). Instead this drives projectile.ts's own
    // stepProjectile directly, exactly like projectileHitbox.test.ts does,
    // isolating the exact branch the fix touched.
    const victim1Id = PlayerId("v1");
    const victim2Id = PlayerId("v2");
    const players: Record<PlayerId, PlayerEntity> = {
      [victim1Id]: mkPlayer(victim1Id, 460, 300),
      [victim2Id]: mkPlayer(victim2Id, 900, 300),
    };

    let proj = {
      ...spawnProjectile(EntityId(1), {
        ownerId: PlayerId("shooter"),
        origin: { x: 60, y: 300 },
        aimAngle: 0,
        speed: 900,
        damage: 20,
        lifetimeMs: 5000,
      }),
      // Void Fracture's own shape: pierceCount set, impact left at "none".
      pierceRemaining: 3,
    };

    const victimsHit = new Set<string>();
    let rngState = 1;
    let sawSurviveAfterFirstHit = false;
    for (let tick = 0; tick < 80; tick++) {
      const result = stepProjectile(proj, {
        platforms: [],
        players,
        dtMs: DT_MS,
        tick: Tick(tick),
        rngState,
      });
      rngState = result.rngState;
      const hits = result.events.filter((e): e is Extract<SimEvent, { t: "hit-confirmed" }> => e.t === "hit-confirmed");
      for (const hit of hits) victimsHit.add(hit.victimId as string);
      if (hits.length > 0 && !result.expired) sawSurviveAfterFirstHit = true;
      if (result.expired || !result.projectile) break;
      proj = result.projectile;
    }

    // The regression: before the fix, ANY hit with impact !== "pierce-chain"
    // expired the projectile immediately, so it could never reach victim2.
    expect(sawSurviveAfterFirstHit).toBe(true);
    expect(victimsHit.has(victim1Id as string)).toBe(true);
    expect(victimsHit.has(victim2Id as string)).toBe(true);
  });
});
