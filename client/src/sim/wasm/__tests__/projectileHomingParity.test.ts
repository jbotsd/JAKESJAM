// Cross-impl parity for the homing/boomerang helpers (Phase F1a
// finish-half-1). The full pathing dispatch in stepProjectile still
// lives TS-side; these primitives are what the dispatch will call
// once the orchestrator is ported.

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadSimFromBytes } from "../loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, "..", "sim.wasm");

const bytes = await readFile(WASM_PATH);
const ab = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const sim = await loadSimFromBytes(ab);
const ex = sim.exports as unknown as typeof sim.exports & {
  projectile_closest_non_owner_player(
    fromX: number, fromY: number, ownerIdx: number,
    xsPtr: number, ysPtr: number, alivePtr: number, n: number,
  ): number;
  projectile_boomerang_should_return(
    returningAlready: number, traveled: number, range: number,
  ): number;
  projectile_boomerang_turn_rate(): number;
  projectile_homing_turn_rate_default(): number;
};

const BOOMERANG_RANGE_FRACTION = 0.55;
const BOOMERANG_TURN_RATE = 8.4;
const HOMING_TURN_RATE_DEFAULT = 4;

const SCRATCH = sim.statePtr;
const XS_OFF = 0;
const YS_OFF = 256;
const ALIVE_OFF = 512;

function packPlayers(xs: number[], ys: number[], alive: boolean[]): {
  xsPtr: number; ysPtr: number; alivePtr: number;
} {
  const dv = new DataView(sim.exports.memory.buffer);
  const u8 = new Uint8Array(sim.exports.memory.buffer);
  for (let i = 0; i < xs.length; i++) {
    dv.setFloat64(SCRATCH + XS_OFF + i * 8, xs[i]!, true);
    dv.setFloat64(SCRATCH + YS_OFF + i * 8, ys[i]!, true);
    u8[SCRATCH + ALIVE_OFF + i] = alive[i] ? 1 : 0;
  }
  return {
    xsPtr: SCRATCH + XS_OFF,
    ysPtr: SCRATCH + YS_OFF,
    alivePtr: SCRATCH + ALIVE_OFF,
  };
}

// TS reference (mirrors the Zig impl, which mirrors projectile.ts).
function refClosestNonOwner(
  fromX: number, fromY: number, ownerIdx: number,
  xs: number[], ys: number[], alive: boolean[],
): number {
  let best = -1;
  let bestSq = Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (ownerIdx >= 0 && i === ownerIdx) continue;
    if (!alive[i]) continue;
    const dx = xs[i]! - fromX;
    const dy = ys[i]! - fromY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestSq) {
      best = i;
      bestSq = d2;
    }
  }
  return best;
}

describe("projectile homing helpers parity (TS V8 vs Zig wasm)", () => {
  test("constants match", () => {
    expect(ex.projectile_boomerang_turn_rate()).toBe(BOOMERANG_TURN_RATE);
    expect(ex.projectile_homing_turn_rate_default()).toBe(HOMING_TURN_RATE_DEFAULT);
  });

  test("closest non-owner: skips owner + dead, picks min distance", () => {
    const xs = [100, 200, 300, 400];
    const ys = [100, 100, 100, 100];
    const alive = [true, true, false, true];
    const ptrs = packPlayers(xs, ys, alive);
    // From (0, 100), owner=0 → expect index 1 (closest non-owner alive)
    const ts = refClosestNonOwner(0, 100, 0, xs, ys, alive);
    const wa = ex.projectile_closest_non_owner_player(
      0, 100, 0, ptrs.xsPtr, ptrs.ysPtr, ptrs.alivePtr, xs.length,
    );
    expect(wa).toBe(ts);
    expect(wa).toBe(1);
  });

  test("closest non-owner: no owner (-1) considers all alive", () => {
    const xs = [50, 200, 300];
    const ys = [50, 50, 50];
    const alive = [true, true, true];
    const ptrs = packPlayers(xs, ys, alive);
    // From (60, 50) → 50 is closest (idx 0)
    const wa = ex.projectile_closest_non_owner_player(
      60, 50, -1, ptrs.xsPtr, ptrs.ysPtr, ptrs.alivePtr, xs.length,
    );
    expect(wa).toBe(0);
  });

  test("closest non-owner: all dead returns -1", () => {
    const xs = [100, 200];
    const ys = [100, 100];
    const alive = [false, false];
    const ptrs = packPlayers(xs, ys, alive);
    const wa = ex.projectile_closest_non_owner_player(
      0, 0, -1, ptrs.xsPtr, ptrs.ysPtr, ptrs.alivePtr, xs.length,
    );
    expect(wa).toBe(-1);
  });

  test("closest non-owner: 100 random fixtures byte-identical", () => {
    let s = 0xacab_face >>> 0;
    const r01 = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const range = (a: number, b: number) => a + (b - a) * r01();

    let mismatches = 0;
    for (let i = 0; i < 100; i++) {
      const n = 2 + Math.floor(r01() * 5); // 2..6 players
      const xs: number[] = [];
      const ys: number[] = [];
      const alive: boolean[] = [];
      for (let j = 0; j < n; j++) {
        xs.push(range(0, 1000));
        ys.push(range(0, 1000));
        alive.push(r01() > 0.2);
      }
      const ptrs = packPlayers(xs, ys, alive);
      const ownerIdx = r01() > 0.5 ? Math.floor(r01() * n) : -1;
      const fromX = range(0, 1000);
      const fromY = range(0, 1000);
      const ts = refClosestNonOwner(fromX, fromY, ownerIdx, xs, ys, alive);
      const wa = ex.projectile_closest_non_owner_player(
        fromX, fromY, ownerIdx, ptrs.xsPtr, ptrs.ysPtr, ptrs.alivePtr, n,
      );
      if (ts !== wa) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  test("boomerang return-trigger logic matches", () => {
    const refReturn = (
      returningAlready: boolean, traveled: number, range: number,
    ): boolean => {
      if (returningAlready) return false;
      if (range <= 0) return false;
      return traveled > range * BOOMERANG_RANGE_FRACTION;
    };

    const cases: Array<[boolean, number, number]> = [
      [false, 100, 0], // no range — never return
      [false, 200, 300], // 200 > 165 → return
      [false, 100, 300], // 100 < 165 → no return
      [true, 500, 300], // already returning → false
      [false, 0, 100],
      [false, 165.001, 300], // exactly past threshold
      [false, 165, 300], // exactly at threshold (>, not >=)
    ];
    for (const [ret, trav, rng] of cases) {
      const ts = refReturn(ret, trav, rng);
      const wa = ex.projectile_boomerang_should_return(ret ? 1 : 0, trav, rng) === 1;
      expect(wa).toBe(ts);
    }
  });
});
