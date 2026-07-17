// True slope collision — the first movement-collision-core change since
// the Zig cutover (docs/map-design.md "Diagonals & sky", greenlit
// 2026-07-17). Pins the foot-point one-way grounding model:
//   • determinism: identical runs are byte-identical over slope traversal
//   • ramp feel: running up a 2:1 grounds every tick and converts run
//     speed to climb (magnitude-preserving tangent projection)
//   • crest launch: leaving the top carries the tangent velocity
//     ballistically — falls out of the projection, no special case
//   • dash-up-slope at 940 px/s: no tunneling (L1 sub-step guard), real
//     air off the crest
//   • one-way: a jump from below never grounds through the surface
//   • snap tolerance edge: the 8px band grounds a walk-down hover, and
//     one pixel past it does not
//   • prediction path: resolveMap("skyseam") → createRuntime carries the
//     slopes into the collision cache stepPlayer actually reads
//
// The TS-vs-wasm bit-exactness gate for the same model lives in
// client/src/sim/wasm/__tests__/slopeParity.test.ts.

import { describe, expect, test } from "bun:test";

import {
  buildStaticCache,
  SLOPE_SNAP_TOL,
  TWO_INV_SQRT5,
  INV_SQRT5,
} from "../collision";
import {
  freshPlayerMovementMemory,
  setStepPlayerBackend,
  stepPlayer,
  JETPACK_MAX_FUEL,
  type PlayerMovementMemory,
} from "../player";
import { createRuntime } from "../World";
import { resolveMap } from "../data/maps";
import type {
  CharacterArchetype,
  InputBitfield,
  InputSeq,
  MapDefinition,
  PlayerEntity,
  PlayerId,
  SlopeDefinition,
} from "../types";

// These tests exercise the NATIVE TS step; make sure no other suite's
// backend swap leaks in.
setStepPlayerBackend(null);

const DT_MS = 1000 / 60;

const Bit = {
  Left: 1 << 0,
  Right: 1 << 1,
  Jump: 1 << 4,
  Dash: 1 << 9,
} as const;

function makePlayer(x: number, y: number): PlayerEntity {
  return {
    id: "p0" as PlayerId,
    characterId: "starter" as CharacterArchetype,
    x, y,
    vx: 0, vy: 0,
    aimX: x + 100, aimY: y,
    health: 100,
    shieldActive: false,
    crouching: false,
    alive: true,
    weaponId: "scrap-rifle",
    cards: [],
    fireCooldownMs: 0,
    ammo: 12,
    abilityCharge: 0,
    lastProcessedInputSeq: 0 as InputSeq,
    jetpackFuel: JETPACK_MAX_FUEL,
  };
}

/** Flat floor at top=600 + one slope. */
function rampWorld(slopes: SlopeDefinition[]): ReturnType<typeof buildStaticCache> {
  const platforms = [
    { id: "floor", kind: "floor" as const, position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
  ];
  return buildStaticCache(platforms, 1280, 720, slopes);
}

const RAMP_21: SlopeDefinition = {
  // 2:1 ascending right: surface (400, 600) → (600, 500).
  id: "r21", base: { x: 400, y: 600 }, run: 200, grade: "2:1", dir: 1,
};

const surface21 = (x: number): number => 600 + -0.5 * (x - 400);

type RunResult = {
  frames: Float64Array; // x, y, vx, vy per tick
  player: PlayerEntity;
  memory: PlayerMovementMemory;
};

function run(
  cache: ReturnType<typeof buildStaticCache>,
  start: PlayerEntity,
  script: ReadonlyArray<InputBitfield>,
  aim?: (p: PlayerEntity) => { x: number; y: number },
): RunResult {
  let p = start;
  let m = freshPlayerMovementMemory();
  const frames = new Float64Array(script.length * 4);
  let prev: InputBitfield = 0;
  for (let t = 0; t < script.length; t++) {
    const curr = script[t]!;
    const a = aim ? aim(p) : { x: p.x + 100, y: p.y };
    const r = stepPlayer(p, prev, curr, a.x, a.y, m, [], DT_MS, {
      collisionCache: cache,
    });
    p = r.player;
    m = r.memory;
    frames[t * 4 + 0] = p.x;
    frames[t * 4 + 1] = p.y;
    frames[t * 4 + 2] = p.vx;
    frames[t * 4 + 3] = p.vy;
    prev = curr;
  }
  return { frames, player: p, memory: m };
}

describe("true slopes — foot-point one-way grounding", () => {
  test("determinism: two identical slope-traversal runs are byte-identical", () => {
    const cache = rampWorld([RAMP_21]);
    const script: InputBitfield[] = [];
    for (let i = 0; i < 30; i++) script.push(0); // settle on floor
    for (let i = 0; i < 120; i++) script.push(Bit.Right); // run up + off
    for (let i = 0; i < 30; i++) script.push(Bit.Left); // come back down
    const a = run(cache, makePlayer(120, 572), script);
    const b = run(cache, makePlayer(120, 572), script);
    expect(Buffer.from(a.frames.buffer).equals(Buffer.from(b.frames.buffer))).toBe(true);
  });

  test("running up a 2:1 grounds every tick, converts run speed to climb, and launches off the crest", () => {
    const cache = rampWorld([RAMP_21]);
    const script: InputBitfield[] = [];
    for (let i = 0; i < 20; i++) script.push(0);
    for (let i = 0; i < 160; i++) script.push(Bit.Right);
    let p = makePlayer(120, 572);
    let m = freshPlayerMovementMemory();
    let prev: InputBitfield = 0;
    let climbedGroundedTicks = 0;
    let crestLaunch: { vx: number; vy: number } | null = null;
    for (const curr of script) {
      const r = stepPlayer(p, prev, curr, p.x + 100, p.y, m, [], DT_MS, {
        collisionCache: cache,
      });
      const wasOnSlope = p.x > 420 && p.x < 590;
      p = r.player;
      m = r.memory;
      prev = curr;
      if (wasOnSlope && p.x < 596) {
        // Mid-slope: grounded ON the surface (foot in the snap band) with
        // an upward tangent component — that's the whole ramp feel.
        const foot = p.y + 28;
        expect(Math.abs(foot - surface21(p.x))).toBeLessThanOrEqual(SLOPE_SNAP_TOL);
        expect(m.groundedLastFrame).toBe(true);
        if (p.vy < -100) climbedGroundedTicks++;
      }
      if (crestLaunch === null && p.x >= 600 && !m.groundedLastFrame) {
        crestLaunch = { vx: p.vx, vy: p.vy };
      }
    }
    // The climb was sustained, not a lucky tick.
    expect(climbedGroundedTicks).toBeGreaterThan(10);
    // Crest exit ≈ tangent split of full stride: ~324 vx / −162 vy at 362.
    // The projection makes this fall out naturally — assert the envelope.
    expect(crestLaunch).not.toBeNull();
    expect(crestLaunch!.vx).toBeGreaterThan(280);
    expect(crestLaunch!.vy).toBeLessThan(-120);
    // Tangent ratio: vy/vx ≈ −0.5 (one tick of gravity may skew slightly).
    expect(crestLaunch!.vy / crestLaunch!.vx).toBeLessThan(-0.35);
    expect(crestLaunch!.vy / crestLaunch!.vx).toBeGreaterThan(-0.6);
  });

  test("dash up the slope at 940 px/s: no tunneling, grounded ride, real air off the crest", () => {
    const cache = rampWorld([RAMP_21]);
    // Start close to the base so the 210ms burst window still covers the
    // crest: base at x=400, crest at 600 — ~7 ticks at burst speed.
    let p = makePlayer(360, 572);
    let m = freshPlayerMovementMemory();
    let prev: InputBitfield = 0;
    // Settle 2 ticks, then dash right (aim flat right) and hold right.
    let maxPen = 0;
    let sawGroundedDashClimb = false;
    let sawAirLaunch = false;
    for (let t = 0; t < 90; t++) {
      const curr: InputBitfield =
        t < 2 ? 0 : t === 2 ? Bit.Right | Bit.Dash : Bit.Right;
      const r = stepPlayer(p, prev, curr, p.x + 200, p.y, m, [], DT_MS, {
        collisionCache: cache,
        dashCharges: 1,
      });
      p = r.player;
      m = r.memory;
      prev = curr;
      if (p.x > 400 && p.x < 600) {
        // Never below the surface beyond the snap band — the L1 sub-step
        // guard at dash speed is what makes this hold on the apex approach.
        const pen = p.y + 28 - surface21(p.x);
        if (pen > maxPen) maxPen = pen;
      }
      // THE feature: a flat 940 dash hits the ramp and rides it GROUNDED
      // at full magnitude — vy < −400 while grounded means the projection
      // converted the burst into climb (940·−0.447 ≈ −420).
      if (m.groundedLastFrame && p.vy < -400 && p.vx > 800) {
        sawGroundedDashClimb = true;
      }
      // When the burst window closes, the clamp drops vx to run speed but
      // the tangent vy carries — the player launches off the slope face
      // ballistically. Real air, no special-casing.
      if (sawGroundedDashClimb && !m.groundedLastFrame && p.vy < -350) {
        sawAirLaunch = true;
      }
    }
    expect(maxPen).toBeLessThanOrEqual(SLOPE_SNAP_TOL);
    expect(sawGroundedDashClimb).toBe(true);
    expect(sawAirLaunch).toBe(true);
    // Sanity: the tangent constants really are the projection base.
    expect(TWO_INV_SQRT5 * TWO_INV_SQRT5 + INV_SQRT5 * INV_SQRT5).toBeCloseTo(1, 15);
  });

  test("one-way: a jump from below never grounds through the surface", () => {
    // Slope hanging overhead: base (300, 500), 1:1 rising right, run 150.
    // Player stands under it at x=320 (surface overhead at 480; jump apex
    // ~134 from foot 600 reaches ~466 — genuinely crosses the band).
    const overhead: SlopeDefinition = {
      id: "oh", base: { x: 300, y: 500 }, run: 150, grade: "1:1", dir: 1,
    };
    const cache = rampWorld([overhead]);
    let p = makePlayer(320, 572);
    let m = freshPlayerMovementMemory();
    let prev: InputBitfield = 0;
    // settle, then jump and hold.
    let minFoot = Infinity;
    let landedOnTopAfterApex = false;
    for (let t = 0; t < 90; t++) {
      const curr: InputBitfield = t < 3 ? 0 : Bit.Jump;
      const r = stepPlayer(p, prev, curr, p.x, p.y - 100, m, [], DT_MS, {
        collisionCache: cache,
      });
      p = r.player;
      m = r.memory;
      prev = curr;
      const foot = p.y + 28;
      if (foot < minFoot) minFoot = foot;
      const sy = 500 + -1 * (p.x - 300);
      if (p.vy < 0 && Math.abs(foot - sy) <= SLOPE_SNAP_TOL) {
        // RISING through the band: must never be grounded (one-way).
        expect(m.groundedLastFrame).toBe(false);
      }
      if (p.vy >= 0 && m.groundedLastFrame && Math.abs(foot - sy) < 1) {
        // Falling back down onto the walkable side is legal (classic
        // one-way: hop up through, land on top).
        landedOnTopAfterApex = true;
      }
    }
    expect(minFoot).toBeLessThan(480 - SLOPE_SNAP_TOL); // truly crossed it
    expect(landedOnTopAfterApex).toBe(true);
  });

  test("snap band edge: 7px hover with ground history glues, 9px does not", () => {
    const cache = rampWorld([RAMP_21]);
    const mkHover = (gapPx: number) => {
      const x = 500; // mid-slope, surface at 550
      const p = makePlayer(x, surface21(x) - gapPx - 28);
      const m = freshPlayerMovementMemory();
      m.groundedLastFrame = true; // walked off — the walk-down glue case
      const r = stepPlayer(p, 0, 0, x, surface21(x), m, [], DT_MS, {
        collisionCache: cache,
      });
      return r;
    };
    const glued = mkHover(7);
    expect(glued.memory.groundedLastFrame).toBe(true);
    // Foot snapped exactly onto the surface line.
    expect(glued.player.y + 28).toBeCloseTo(surface21(glued.player.x), 9);
    const free = mkHover(9 + SLOPE_SNAP_TOL); // clearly past the band even after one tick of gravity
    expect(free.memory.groundedLastFrame).toBe(false);
  });

  test("prediction path: resolveMap('skyseam') → createRuntime carries slopes into the live cache", () => {
    // clientLoop builds its prediction runtime via
    // createRuntime(resolveMap(mapId)) — this IS that path.
    const map: MapDefinition = resolveMap("skyseam");
    const runtime = createRuntime(map);
    expect(runtime.collisionCache.slopes.length).toBe(3);
    // Drop a player at ramp-seam-a's base and sprint right: the
    // prediction-side step must ride the ramp (grounded, climbing).
    let p = makePlayer(80, 1064 - 28);
    let m = freshPlayerMovementMemory();
    let prev: InputBitfield = 0;
    let groundedClimbTicks = 0;
    for (let t = 0; t < 140; t++) {
      const r = stepPlayer(p, prev, Bit.Right, p.x + 100, p.y, m, [], DT_MS, {
        collisionCache: runtime.collisionCache,
      });
      p = r.player;
      m = r.memory;
      prev = Bit.Right;
      if (p.x > 130 && p.x < 320 && m.groundedLastFrame && p.vy < -50) {
        groundedClimbTicks++;
      }
      if (p.x > 340) break;
    }
    expect(groundedClimbTicks).toBeGreaterThan(8);
    // It delivered the player onto the seam chain's first step height.
    expect(p.y + 28).toBeLessThanOrEqual(958);
  });
});
