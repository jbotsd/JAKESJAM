// Cross-impl parity for swept-AABB collision: TS V8 vs Zig wasm.
//
// This is the marquee test for the substrate pivot (ADR-0006). The
// "barely detects standing" / "falls through terrain" symptoms came
// from float drift between V8 (browser predict) and JSC (Bun
// authoritative server) running independent IEEE 754 ops. The wasm
// spec mandates bit-identical IEEE 754 reproducibility — so two
// hosts running this same wasm bytecode get identical hit times,
// normals, and surface indices.
//
// If this test ever goes red, the pivot has stopped working. Don't
// "fix" it by loosening the equality check — root-cause it.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  sweepAABB,
  resolveMove,
  resolveMoveCached,
  buildStaticCache,
  type AABB,
  type SweepHit,
} from "../../collision";
import type { PlatformDefinition } from "../../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

interface CollisionExports {
  readonly memory: WebAssembly.Memory;
  alloc_state(): number;
  state_size(): number;
  sweep_against_one_flat(
    mx: number, my: number, mw: number, mh: number,
    dx: number, dy: number,
    tx: number, ty: number, tw: number, th: number,
    outT: number, outNx: number, outNy: number,
  ): number;
  sweep_aabb_many(
    mx: number, my: number, mw: number, mh: number,
    vx: number, vy: number, dt: number,
    staticsPtr: number, staticsCount: number,
    outHitPtr: number,
  ): number;
  resolve_move(
    mx: number, my: number, mw: number, mh: number,
    vx: number, vy: number, dt: number,
    staticsPtr: number, staticsCount: number,
    outPtr: number,
  ): void;
  resolve_move_cached(
    mx: number, my: number, mw: number, mh: number,
    vx: number, vy: number, dt: number,
    staticsPtr: number, staticsCount: number,
    oneWayPtr: number, oneWayCount: number,
    outPtr: number,
  ): void;
  sizeof_aabb(): number;
  sizeof_sweep_hit(): number;
  sizeof_resolve_move_out(): number;
}

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const mod = await WebAssembly.compile(ab);
const inst = await WebAssembly.instantiate(mod, {});
const w = inst.exports as unknown as CollisionExports;
const SIZEOF_AABB = w.sizeof_aabb();
const SIZEOF_HIT = w.sizeof_sweep_hit();
expect(SIZEOF_AABB).toBe(32);
expect(SIZEOF_HIT).toBe(32);

// Use the wasm state buffer as scratch space. State buffer is 64KB,
// way more than we need for these tests.
const SCRATCH_PTR = w.alloc_state();
function scratchView(): DataView {
  return new DataView(w.memory.buffer, SCRATCH_PTR, w.state_size());
}

function packAABBs(aabbs: ReadonlyArray<AABB>, baseOffset: number): number {
  const dv = scratchView();
  for (let i = 0; i < aabbs.length; i++) {
    const off = baseOffset + i * SIZEOF_AABB;
    dv.setFloat64(off + 0, aabbs[i]!.x, true);
    dv.setFloat64(off + 8, aabbs[i]!.y, true);
    dv.setFloat64(off + 16, aabbs[i]!.w, true);
    dv.setFloat64(off + 24, aabbs[i]!.h, true);
  }
  return SCRATCH_PTR + baseOffset;
}

function readSweepHit(absPtr: number): {
  t: number;
  nx: number;
  ny: number;
  index: number;
} {
  const off = absPtr - SCRATCH_PTR;
  const dv = scratchView();
  return {
    t: dv.getFloat64(off + 0, true),
    nx: dv.getFloat64(off + 8, true),
    ny: dv.getFloat64(off + 16, true),
    index: dv.getInt32(off + 24, true),
  };
}

function callWasmSweep(
  mover: AABB,
  vx: number,
  vy: number,
  dt: number,
  statics: ReadonlyArray<AABB>,
): SweepHit | null {
  const staticsBaseOff = 64; // skip first 64 bytes for hit output area
  const hitOff = 0;
  const staticsAbsPtr = packAABBs(statics, staticsBaseOff);
  const hitAbsPtr = SCRATCH_PTR + hitOff;
  const got = w.sweep_aabb_many(
    mover.x, mover.y, mover.w, mover.h,
    vx, vy, dt,
    staticsAbsPtr, statics.length,
    hitAbsPtr,
  );
  if (got === 0) return null;
  const r = readSweepHit(hitAbsPtr);
  return { t: r.t, nx: r.nx, ny: r.ny, index: r.index };
}

function callWasmSweepOne(
  mover: AABB,
  dx: number,
  dy: number,
  target: AABB,
): { t: number; nx: number; ny: number } | null {
  const off0 = 0, off1 = 8, off2 = 16;
  const got = w.sweep_against_one_flat(
    mover.x, mover.y, mover.w, mover.h,
    dx, dy,
    target.x, target.y, target.w, target.h,
    SCRATCH_PTR + off0,
    SCRATCH_PTR + off1,
    SCRATCH_PTR + off2,
  );
  if (got === 0) return null;
  const dv = scratchView();
  return {
    t: dv.getFloat64(off0, true),
    nx: dv.getFloat64(off1, true),
    ny: dv.getFloat64(off2, true),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const PLAYER_W = 32;
const PLAYER_H = 56;
const STEP_SEC = 1 / 60;

function makePlayer(x: number, y: number): AABB {
  return { x, y, w: PLAYER_W, h: PLAYER_H };
}

function makePlatform(x: number, y: number, w: number, h: number): AABB {
  return { x, y, w, h };
}

// 24-cell tunneling matrix: vy ∈ {600, 900, 1200, 1800, 2400, 3000} ×
// platform thickness ∈ {8, 18, 24, 48} px.
const FAST_FALL_MATRIX: ReadonlyArray<{
  name: string;
  mover: AABB;
  vx: number;
  vy: number;
  dt: number;
  statics: ReadonlyArray<AABB>;
}> = (() => {
  const out: Array<{
    name: string;
    mover: AABB;
    vx: number;
    vy: number;
    dt: number;
    statics: ReadonlyArray<AABB>;
  }> = [];
  for (const vy of [600, 900, 1200, 1800, 2400, 3000]) {
    for (const platH of [8, 18, 24, 48]) {
      const platTopY = 600;
      out.push({
        name: `fastFall vy=${vy} platH=${platH}`,
        mover: makePlayer(100, platTopY - PLAYER_H - 4),
        vx: 0,
        vy,
        dt: STEP_SEC,
        statics: [makePlatform(0, platTopY, 1280, platH)],
      });
    }
  }
  return out;
})();

// Procedurally-generated random fixtures with a seeded LCG so the test
// is fully deterministic (no Math.random in test bodies — same intent
// as the sim itself).
function* randomFixtures(count: number): Generator<{
  name: string;
  mover: AABB;
  vx: number;
  vy: number;
  dt: number;
  statics: ReadonlyArray<AABB>;
}> {
  let s = 0xc0de_b00b >>> 0;
  const rand01 = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const range = (a: number, b: number): number => a + (b - a) * rand01();

  for (let i = 0; i < count; i++) {
    // Cluster mover + target so dt=STEP_SEC sweeps actually contact.
    const cx = range(0, 400);
    const cy = range(0, 400);
    const mover = {
      x: cx + range(-50, 50),
      y: cy + range(-50, 50),
      w: range(8, 64),
      h: range(8, 96),
    };
    const target = {
      x: cx + range(-30, 30),
      y: cy + range(-30, 30),
      w: range(16, 128),
      h: range(16, 128),
    };
    const vx = range(-3000, 3000);
    const vy = range(-3000, 3000);
    yield {
      name: `random_${i}`,
      mover,
      vx,
      vy,
      dt: STEP_SEC,
      statics: [target],
    };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("collision parity (TS V8 vs Zig wasm) — sweepAABB", () => {
  test("24-cell fast-fall matrix is byte-identical", () => {
    for (const fx of FAST_FALL_MATRIX) {
      const tsHit = sweepAABB(fx.mover, fx.vx, fx.vy, fx.dt, fx.statics);
      const wasmHit = callWasmSweep(
        fx.mover,
        fx.vx,
        fx.vy,
        fx.dt,
        fx.statics,
      );
      if (tsHit === null) {
        expect(wasmHit).toBeNull();
      } else {
        expect(wasmHit).not.toBeNull();
        expect(wasmHit!.t).toBe(tsHit.t);
        expect(wasmHit!.nx).toBe(tsHit.nx);
        expect(wasmHit!.ny).toBe(tsHit.ny);
        expect(wasmHit!.index).toBe(tsHit.index);
      }
    }
  });

  test("1000 randomised fixtures match bit-exact (hit/miss + t + nx + ny)", () => {
    let mismatches = 0;
    let hitCount = 0;
    for (const fx of randomFixtures(1000)) {
      const tsHit = sweepAABB(fx.mover, fx.vx, fx.vy, fx.dt, fx.statics);
      const wasmHit = callWasmSweep(
        fx.mover,
        fx.vx,
        fx.vy,
        fx.dt,
        fx.statics,
      );
      if (tsHit === null) {
        if (wasmHit !== null) {
          mismatches++;
          if (mismatches < 3) {
            console.error(
              `MISS divergence ${fx.name}: ts=null wasm=${JSON.stringify(wasmHit)}`,
            );
          }
        }
      } else {
        if (
          wasmHit === null ||
          wasmHit.t !== tsHit.t ||
          wasmHit.nx !== tsHit.nx ||
          wasmHit.ny !== tsHit.ny
        ) {
          mismatches++;
          if (mismatches < 3) {
            console.error(
              `HIT divergence ${fx.name}: ts=${JSON.stringify(tsHit)} wasm=${JSON.stringify(wasmHit)}`,
            );
          }
        } else {
          hitCount++;
        }
      }
    }
    expect(mismatches).toBe(0);
    // Sanity: at least 50 of the 1000 random cases must produce a hit
    // (else we're not actually testing the hit path). 99 is current.
    expect(hitCount).toBeGreaterThan(50);
  });
});

function callWasmResolveMove(
  mover: AABB,
  vx: number,
  vy: number,
  dt: number,
  statics: ReadonlyArray<AABB>,
): { x: number; y: number; vx: number; vy: number; groundedThisFrame: boolean } {
  const outOff = 0;
  const SIZEOF_RESOLVE = w.sizeof_resolve_move_out();
  expect(SIZEOF_RESOLVE).toBe(40);
  const staticsBaseOff = SIZEOF_RESOLVE + 8;
  const staticsAbsPtr = packAABBs(statics, staticsBaseOff);
  const outAbsPtr = SCRATCH_PTR + outOff;
  w.resolve_move(
    mover.x, mover.y, mover.w, mover.h,
    vx, vy, dt,
    staticsAbsPtr, statics.length,
    outAbsPtr,
  );
  const dv = scratchView();
  return {
    x: dv.getFloat64(outOff + 0, true),
    y: dv.getFloat64(outOff + 8, true),
    vx: dv.getFloat64(outOff + 16, true),
    vy: dv.getFloat64(outOff + 24, true),
    groundedThisFrame: dv.getInt32(outOff + 32, true) === 1,
  };
}

describe("collision parity — resolveMove (multi-pass slide)", () => {
  // Realistic player-vs-floor scenarios — closely mirror playerLanding.test.ts
  // intent. Uses a single floor platform so the iteration logic gets exercised.

  const PLAT_TOP_Y = 600;
  const FLOOR: AABB = { x: 0, y: PLAT_TOP_Y, w: 1280, h: 40 };

  type Fixture = {
    name: string;
    mover: AABB;
    vx: number;
    vy: number;
    dt: number;
    statics: ReadonlyArray<AABB>;
  };

  const FIXTURES: ReadonlyArray<Fixture> = [
    // Drop straight down onto floor
    {
      name: "free fall onto floor",
      mover: makePlayer(100, 0),
      vx: 0,
      vy: 800,
      dt: STEP_SEC,
      statics: [FLOOR],
    },
    // Walking on floor (already grounded)
    {
      name: "walk on floor (grounded)",
      mover: makePlayer(100, PLAT_TOP_Y - PLAYER_H),
      vx: 300,
      vy: 0,
      dt: STEP_SEC,
      statics: [FLOOR],
    },
    // Jump up
    {
      name: "jump straight up",
      mover: makePlayer(100, PLAT_TOP_Y - PLAYER_H),
      vx: 0,
      vy: -500,
      dt: STEP_SEC,
      statics: [FLOOR],
    },
    // Walk into wall
    {
      name: "walk into vertical wall",
      mover: makePlayer(100, PLAT_TOP_Y - PLAYER_H),
      vx: 800,
      vy: 0,
      dt: STEP_SEC,
      statics: [
        FLOOR,
        { x: 200, y: PLAT_TOP_Y - 100, w: 32, h: 100 }, // wall
      ],
    },
    // Diagonal hit (slide test)
    {
      name: "diagonal into corner",
      mover: makePlayer(100, PLAT_TOP_Y - PLAYER_H - 80),
      vx: 600,
      vy: 600,
      dt: STEP_SEC,
      statics: [FLOOR, { x: 200, y: PLAT_TOP_Y - 200, w: 200, h: 100 }],
    },
  ];

  // Add the 24-cell fast-fall matrix
  const ALL: ReadonlyArray<Fixture> = [...FIXTURES, ...FAST_FALL_MATRIX];

  test("end-to-end resolveMove parity across realistic and edge fixtures", () => {
    for (const fx of ALL) {
      const ts = resolveMove(fx.mover, fx.vx, fx.vy, fx.dt, fx.statics);
      const wasmOut = callWasmResolveMove(
        fx.mover, fx.vx, fx.vy, fx.dt, fx.statics,
      );
      if (
        wasmOut.x !== ts.x ||
        wasmOut.y !== ts.y ||
        wasmOut.vx !== ts.vx ||
        wasmOut.vy !== ts.vy ||
        wasmOut.groundedThisFrame !== ts.groundedThisFrame
      ) {
        throw new Error(
          `${fx.name} divergence:\n  ts:   ${JSON.stringify(ts)}\n  wasm: ${JSON.stringify(wasmOut)}`,
        );
      }
    }
    expect(ALL.length).toBeGreaterThan(20);
  });

  test("60-tick simulated drop-and-rest is byte-identical step-by-step", () => {
    // The classic determinism torture test: simulate a player dropping
    // for 60 ticks under gravity, with TS resolveMove driving one body
    // and wasm resolveMove driving another. After 60 ticks of independent
    // integration, both must be in the exact same position with the
    // exact same velocity.
    const GRAVITY = 1450;
    const VY_CAP = 900;
    const STATICS: ReadonlyArray<AABB> = [FLOOR];

    let tsX = 100, tsY = 0, tsVx = 0, tsVy = 0;
    let waX = 100, waY = 0, waVx = 0, waVy = 0;

    for (let tick = 0; tick < 60; tick++) {
      tsVy = Math.min(VY_CAP, tsVy + GRAVITY * STEP_SEC);
      waVy = Math.min(VY_CAP, waVy + GRAVITY * STEP_SEC);

      const tsR = resolveMove(
        { x: tsX, y: tsY, w: PLAYER_W, h: PLAYER_H },
        tsVx, tsVy, STEP_SEC, STATICS,
      );
      const waR = callWasmResolveMove(
        { x: waX, y: waY, w: PLAYER_W, h: PLAYER_H },
        waVx, waVy, STEP_SEC, STATICS,
      );

      if (
        tsR.x !== waR.x ||
        tsR.y !== waR.y ||
        tsR.vx !== waR.vx ||
        tsR.vy !== waR.vy ||
        tsR.groundedThisFrame !== waR.groundedThisFrame
      ) {
        throw new Error(
          `tick ${tick} divergence:\n  ts:   ${JSON.stringify(tsR)}\n  wasm: ${JSON.stringify(waR)}`,
        );
      }

      tsX = tsR.x; tsY = tsR.y; tsVx = tsR.vx; tsVy = tsR.vy;
      waX = waR.x; waY = waR.y; waVx = waR.vx; waVy = waR.vy;
    }

    // Sanity: after 60 ticks of falling, player must have landed.
    expect(tsY + PLAYER_H).toBeCloseTo(PLAT_TOP_Y, 0);
    expect(tsX).toBe(waX);
    expect(tsY).toBe(waY);
    expect(tsVy).toBe(waVy);
  });

  test("500 randomised resolveMove fixtures match bit-exact", () => {
    let mismatches = 0;
    let groundedHits = 0;
    for (const fx of randomFixtures(500)) {
      const ts = resolveMove(fx.mover, fx.vx, fx.vy, fx.dt, fx.statics);
      const wa = callWasmResolveMove(
        fx.mover, fx.vx, fx.vy, fx.dt, fx.statics,
      );
      if (
        wa.x !== ts.x ||
        wa.y !== ts.y ||
        wa.vx !== ts.vx ||
        wa.vy !== ts.vy ||
        wa.groundedThisFrame !== ts.groundedThisFrame
      ) {
        mismatches++;
        if (mismatches < 3) {
          console.error(
            `${fx.name}: ts=${JSON.stringify(ts)} wa=${JSON.stringify(wa)}`,
          );
        }
      }
      if (ts.groundedThisFrame) groundedHits++;
    }
    expect(mismatches).toBe(0);
    // Sanity: at least some random fixtures must produce a grounded hit
    // (else we're not exercising the slide → grounded transition).
    expect(groundedHits).toBeGreaterThan(5);
  });
});

function callWasmResolveMoveCached(
  mover: AABB,
  vx: number,
  vy: number,
  dt: number,
  statics: ReadonlyArray<AABB>,
  oneWay: ReadonlyArray<boolean>,
): { x: number; y: number; vx: number; vy: number; groundedThisFrame: boolean } {
  const outOff = 0;
  const SIZEOF_RESOLVE = w.sizeof_resolve_move_out();
  const staticsBaseOff = SIZEOF_RESOLVE + 8;
  const oneWayBaseOff = staticsBaseOff + statics.length * SIZEOF_AABB + 8;

  const staticsAbsPtr = packAABBs(statics, staticsBaseOff);
  // Pack one-way mask as bytes.
  const memU8 = new Uint8Array(w.memory.buffer);
  for (let i = 0; i < oneWay.length; i++) {
    memU8[SCRATCH_PTR + oneWayBaseOff + i] = oneWay[i]! ? 1 : 0;
  }
  const oneWayAbsPtr = SCRATCH_PTR + oneWayBaseOff;
  const outAbsPtr = SCRATCH_PTR + outOff;

  w.resolve_move_cached(
    mover.x, mover.y, mover.w, mover.h,
    vx, vy, dt,
    staticsAbsPtr, statics.length,
    oneWayAbsPtr, oneWay.length,
    outAbsPtr,
  );
  const dv = scratchView();
  return {
    x: dv.getFloat64(outOff + 0, true),
    y: dv.getFloat64(outOff + 8, true),
    vx: dv.getFloat64(outOff + 16, true),
    vy: dv.getFloat64(outOff + 24, true),
    groundedThisFrame: dv.getInt32(outOff + 32, true) === 1,
  };
}

describe("collision parity — resolveMoveCached (one-way + drift probe)", () => {
  // Build a real StaticCollisionCache from PlatformDefinitions so we
  // exercise the same one-way classification logic the live game uses.
  const PLATFORMS: PlatformDefinition[] = [
    // Solid floor — full-width, 40 px tall (tall = NOT one-way per
    // ONE_WAY_MAX_HEIGHT_PX = 24)
    { id: "floor", kind: "floor", position: { x: 640, y: 620 }, size: { x: 1280, y: 40 } },
    // Thin one-way platform — 18 px tall, qualifies as one-way
    { id: "p1", kind: "platform", position: { x: 400, y: 480 }, size: { x: 200, y: 18 } },
    // Tall cover obstacle — 80 px, NOT one-way despite kind=platform
    {
      id: "cover-r",
      kind: "platform",
      position: { x: 800, y: 560 },
      size: { x: 80, y: 80 },
    },
    // Wall on the right
    { id: "wall-r", kind: "wall", position: { x: 1240, y: 480 }, size: { x: 32, y: 320 } },
  ];
  const cache = buildStaticCache(PLATFORMS, 1280, 720);
  const STATICS = cache.aabbs;
  const ONE_WAY = cache.oneWay;

  type Fixture = {
    name: string;
    mover: AABB;
    vx: number;
    vy: number;
  };

  // Including the canonical "barely detects standing" scenarios:
  // a player resting on a platform with vy=0, a player whose foot
  // has drifted 1.5 px past the platform top (the post-resolve
  // probe must catch and snap), and a player jumping under the
  // thin platform (one-way short-circuit must let them pass).
  const FIXTURES: ReadonlyArray<Fixture> = [
    {
      name: "free-fall onto solid floor",
      mover: { x: 100, y: 0, w: 32, h: 56 },
      vx: 0,
      vy: 800,
    },
    {
      name: "resting on solid floor (vy=0)",
      mover: { x: 100, y: 600 - 56, w: 32, h: 56 },
      vx: 0,
      vy: 0,
    },
    {
      name: "drifted 1.5 px past floor top — probe must snap",
      mover: { x: 100, y: 600 - 56 + 1.5, w: 32, h: 56 },
      vx: 0,
      vy: 0,
    },
    {
      name: "drifted 1.9 px past one-way platform top",
      mover: { x: 350, y: 471 - 56 + 1.9, w: 32, h: 56 },
      vx: 0,
      vy: 0,
    },
    {
      name: "jumping straight up through one-way platform",
      mover: { x: 350, y: 540, w: 32, h: 56 },
      vx: 0,
      vy: -700,
    },
    {
      name: "landing on top of one-way platform",
      mover: { x: 350, y: 380, w: 32, h: 56 },
      vx: 0,
      vy: 600,
    },
    {
      name: "running into tall cover (must be solid laterally)",
      mover: { x: 700, y: 540, w: 32, h: 56 },
      vx: 600,
      vy: 0,
    },
    {
      name: "fast-fall through one-way slack zone (3 px past top, vy big)",
      mover: { x: 350, y: 471 - 56 + 3.0, w: 32, h: 56 },
      vx: 0,
      vy: 1500,
    },
    {
      name: "diagonal slide off one-way platform edge",
      mover: { x: 480, y: 471 - 56, w: 32, h: 56 },
      vx: 800,
      vy: 100,
    },
    {
      name: "wall slide on right",
      mover: { x: 1180, y: 540, w: 32, h: 56 },
      vx: 600,
      vy: 100,
    },
  ];

  test("realistic platforms + one-way platforms produce identical output", () => {
    for (const fx of FIXTURES) {
      const ts = resolveMoveCached(
        fx.mover,
        fx.vx,
        fx.vy,
        STEP_SEC,
        cache,
        true,
      );
      const wa = callWasmResolveMoveCached(
        fx.mover,
        fx.vx,
        fx.vy,
        STEP_SEC,
        STATICS,
        ONE_WAY,
      );
      if (
        wa.x !== ts.x ||
        wa.y !== ts.y ||
        wa.vx !== ts.vx ||
        wa.vy !== ts.vy ||
        wa.groundedThisFrame !== ts.groundedThisFrame
      ) {
        throw new Error(
          `${fx.name} divergence:\n  ts: ${JSON.stringify(ts)}\n  wa: ${JSON.stringify(wa)}`,
        );
      }
    }
  });

  test("60-tick drop-and-rest with cached/one-way is byte-identical", () => {
    const GRAVITY = 1450;
    const VY_CAP = 900;

    let tsX = 100, tsY = 0, tsVx = 0, tsVy = 0;
    let waX = 100, waY = 0, waVx = 0, waVy = 0;

    for (let tick = 0; tick < 60; tick++) {
      tsVy = Math.min(VY_CAP, tsVy + GRAVITY * STEP_SEC);
      waVy = Math.min(VY_CAP, waVy + GRAVITY * STEP_SEC);

      const tsR = resolveMoveCached(
        { x: tsX, y: tsY, w: PLAYER_W, h: PLAYER_H },
        tsVx, tsVy, STEP_SEC, cache, true,
      );
      const waR = callWasmResolveMoveCached(
        { x: waX, y: waY, w: PLAYER_W, h: PLAYER_H },
        waVx, waVy, STEP_SEC, STATICS, ONE_WAY,
      );

      if (
        tsR.x !== waR.x ||
        tsR.y !== waR.y ||
        tsR.vx !== waR.vx ||
        tsR.vy !== waR.vy ||
        tsR.groundedThisFrame !== waR.groundedThisFrame
      ) {
        throw new Error(
          `tick ${tick} divergence:\n  ts: ${JSON.stringify(tsR)}\n  wa: ${JSON.stringify(waR)}`,
        );
      }

      tsX = tsR.x; tsY = tsR.y; tsVx = tsR.vx; tsVy = tsR.vy;
      waX = waR.x; waY = waR.y; waVx = waR.vx; waVy = waR.vy;
    }

    // Sanity: player landed somewhere sane.
    expect(tsY + PLAYER_H).toBeLessThanOrEqual(620);
    expect(tsX).toBe(waX);
    expect(tsY).toBe(waY);
    expect(tsVy).toBe(waVy);
  });
});

describe("collision parity — sweepAgainstOne (single-target flat)", () => {
  test("100 randomised single-target fixtures match", () => {
    let mismatches = 0;
    for (const fx of randomFixtures(100)) {
      const target = fx.statics[0]!;
      const dx = fx.vx * fx.dt;
      const dy = fx.vy * fx.dt;
      const tsHit = sweepAABB(fx.mover, fx.vx, fx.vy, fx.dt, fx.statics);
      const wasmFlat = callWasmSweepOne(fx.mover, dx, dy, target);
      if (tsHit === null) {
        if (wasmFlat !== null) mismatches++;
      } else {
        if (
          wasmFlat === null ||
          wasmFlat.t !== tsHit.t ||
          wasmFlat.nx !== tsHit.nx ||
          wasmFlat.ny !== tsHit.ny
        ) {
          mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });
});
