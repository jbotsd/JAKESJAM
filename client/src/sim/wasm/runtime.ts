// Boot-time wasm sim singleton + URL flag helpers.
//
// This is the seam where the live game first touches the Zig→WASM
// substrate. Phase A/B work shipped the parity-proven `.wasm` artifact
// + loader; this module wires it into the actual runtime so a deployed
// client genuinely loads + executes wasm at startup.
//
// Default behaviour: wasm boots in the background, available to any
// caller that asks via `getWasmSim()`. No hot-path is touched.
//
// `?wasm-canary=1` runs a once-per-second RNG parity probe in the
// console — provides production observability that the wasm is
// genuinely executing and stays bit-identical to the TS sim.

import { loadSim, type Sim } from "./loader";
import { nextU32Native, setRngBackend } from "../rng";
import {
  setResolveMoveCachedBackend,
  type AABB,
  type ResolveMoveCachedResult,
  type StaticCollisionCache,
} from "../collision";
import { setStepPlayerBackend } from "../player";
import { makeStepPlayerWasmBackend } from "./playerWasmBackend";
import { installLutTables } from "../trig";

let bootPromise: Promise<Sim | null> | null = null;
let bootResult: Sim | null = null;
let bootError: Error | null = null;

/**
 * Lazily boot-load the wasm sim. Safe to call from anywhere; resolves
 * to the same Sim instance on subsequent calls. Returns null if the
 * wasm artifact failed to load (production fallback to TS sim).
 */
export function getWasmSim(): Promise<Sim | null> {
  if (bootResult) return Promise.resolve(bootResult);
  if (bootError) return Promise.resolve(null);
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    try {
      const sim = await loadSim();
      bootResult = sim;
      // Phase F2a — install the comptime trig LUTs from wasm
      // memory so TS-side `lutSin/lutCos/lutAtan2` sample IDENTICAL
      // bits as the Zig modules. This is the cross-host
      // determinism guarantee for trig.
      const ex = sim.exports;
      const tableSize = ex.lut_table_size();
      const sinPtr = ex.lut_sin_table_ptr();
      const atanPtr = ex.lut_atan_table_ptr();
      const sinView = new Float64Array(ex.memory.buffer, sinPtr, tableSize);
      const atanView = new Float64Array(ex.memory.buffer, atanPtr, tableSize);
      installLutTables(sinView, atanView);
      console.info(
        `[wasm-sim] ready — state=${sim.stateLen}B, currentTick=${sim.currentTick()}, exports=${
          Object.keys(sim.exports).length
        }, trig LUT installed (${tableSize} entries)`,
      );
      return sim;
    } catch (err) {
      bootError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[wasm-sim] failed to load: ${bootError.message}`);
      return null;
    }
  })();
  return bootPromise;
}

/** Synchronous accessor — returns null if wasm hasn't booted yet. */
export function getWasmSimSync(): Sim | null {
  return bootResult;
}

/** True if the URL has `?<name>=1`. Cached on first call. */
const flagCache = new Map<string, boolean>();
export function wasmFlag(name: string): boolean {
  const cached = flagCache.get(name);
  if (cached !== undefined) return cached;
  if (typeof window === "undefined") {
    flagCache.set(name, false);
    return false;
  }
  const v = new URLSearchParams(window.location.search).get(name) === "1";
  flagCache.set(name, v);
  return v;
}

/**
 * True UNLESS the URL has `?<name>=0`. Used for opt-OUT flags
 * after Phase F3 flipped the default to wasm-on.
 */
const disableCache = new Map<string, boolean>();
export function wasmDisabled(name: string): boolean {
  const cached = disableCache.get(name);
  if (cached !== undefined) return cached;
  if (typeof window === "undefined") {
    disableCache.set(name, false);
    return false;
  }
  const v = new URLSearchParams(window.location.search).get(name) === "0";
  disableCache.set(name, v);
  return v;
}

/**
 * Once-per-second RNG parity canary. Calls TS `nextU32Native` and Zig
 * wasm `rng_next_u32` on the same state cursor, asserts byte-equal,
 * and logs the result. Uses `nextU32Native` directly so the canary
 * remains valid even when the active backend has been swapped to wasm
 * (otherwise TS-vs-wasm collapses to wasm-vs-wasm).
 *
 * Only runs when `?wasm-canary=1` is set. Stops after 30 ticks.
 */
export function startWasmCanary(): void {
  if (!wasmFlag("wasm-canary")) return;

  void getWasmSim().then((sim) => {
    if (!sim) {
      console.warn("[wasm-canary] sim unavailable, canary disabled");
      return;
    }
    let state = 0xc0de_b00b >>> 0;
    let tick = 0;
    let mismatches = 0;
    console.info("[wasm-canary] starting — 30 ticks @ 1Hz");

    const handle = window.setInterval(() => {
      const tsNext = nextU32Native(state);
      const wasmNext = sim.exports.rng_next_u32(state) >>> 0;
      if (tsNext !== wasmNext) {
        mismatches++;
        console.error(
          `[wasm-canary] DIVERGENCE state=${state} ts=${tsNext} wasm=${wasmNext}`,
        );
      } else if (tick % 5 === 0) {
        console.info(
          `[wasm-canary] tick=${tick} state=${state} → ${tsNext} (TS=wasm ✓)`,
        );
      }
      state = tsNext;
      tick++;
      if (tick >= 30) {
        clearInterval(handle);
        console.info(
          `[wasm-canary] complete: ${tick} ticks, ${mismatches} divergences`,
        );
      }
    }, 1000);
  });
}

/**
 * `?wasm-rng=1` — swap the sim's RNG kernel to call wasm directly.
 * Every `nextU32(state)` from anywhere in the sim now indirects to
 * Zig wasm. Parity-proven, so behaviour is identical; the win is
 * production validation that wasm executes inside the real game
 * tick loop on real users' browsers.
 *
 * If wasm fails to load, RNG silently falls back to native TS.
 * Caller should hold any RNG-dependent boot work (e.g. world seed
 * derivation) until after this resolves; today the rng_state is
 * threaded through `World.create`'s `rngSeed` arg, so the swap
 * applies as soon as it's installed.
 */
/**
 * Phase F3: RNG defaults to wasm-on. `?wasm-rng=0` opts out.
 *
 * The kernel is parity-proven (7000+ ops byte-identical) so flipping
 * the default has no behavioural change vs the TS native impl —
 * just ensures every host runs the same bytecode.
 */
export async function applyWasmRngFlag(): Promise<void> {
  if (wasmDisabled("wasm-rng")) {
    console.info("[wasm-rng] disabled by ?wasm-rng=0 — using TS native");
    return;
  }
  const sim = await getWasmSim();
  if (!sim) {
    console.warn("[wasm-rng] sim unavailable, RNG stays on TS native");
    return;
  }
  setRngBackend((state) => sim.exports.rng_next_u32(state) >>> 0);
  console.info("[wasm-rng] swap applied — sim RNG now executes in Zig wasm");
}

/**
 * `?wasm-collision=1` — swap the live `resolveMoveCached` impl to
 * call wasm. This is the cut where the "barely detects standing"
 * jitter visibly dies in production: bit-identical collision math
 * across V8 (predict) and JSC (server) eliminates the float-drift
 * reconcile churn that's been chasing us for two weeks.
 *
 * Parity proven across the 24-cell tunneling matrix, 1600+
 * randomised fixtures, drift-snap recovery, one-way platforms,
 * tall cover, and a 60-tick drop-and-rest simulation
 * (`client/src/sim/wasm/__tests__/collisionParity.test.ts`).
 */
/**
 * Phase F3: collision defaults to wasm-on. `?wasm-collision=0` opts out.
 *
 * This is the cut where the "barely detects standing" jitter
 * visibly dies in production for default users.
 */
export async function applyWasmCollisionFlag(): Promise<void> {
  if (wasmDisabled("wasm-collision")) {
    console.info("[wasm-collision] disabled by ?wasm-collision=0 — using TS native");
    return;
  }
  const sim = await getWasmSim();
  if (!sim) {
    console.warn(
      "[wasm-collision] sim unavailable, collision stays on TS native",
    );
    return;
  }

  const ex = sim.exports;
  const SIZEOF_AABB = ex.sizeof_aabb();
  const SIZEOF_RESOLVE = ex.sizeof_resolve_move_out();

  // Reserve a chunk of the wasm state buffer for collision scratch:
  //   bytes [0, SIZEOF_RESOLVE)               -> output struct
  //   bytes [SIZEOF_RESOLVE, ... ]             -> packed AABB array
  //   bytes [statics_end, statics_end + N]     -> packed one-way mask
  // The state buffer is 64KB; with ~80 platforms × 32 bytes = 2.5KB,
  // we have plenty of headroom.
  const OUT_OFF = 0;
  const STATICS_OFF = SIZEOF_RESOLVE + 8;

  const backend = (
    mover: AABB,
    vx: number,
    vy: number,
    dt: number,
    cache: StaticCollisionCache,
    respectOneWay: boolean,
  ): ResolveMoveCachedResult => {
    const aabbs = cache.aabbs;
    const oneWay = cache.oneWay;
    const count = aabbs.length;

    // Each call refreshes views — wasm memory may have grown.
    const memBuf = ex.memory.buffer;
    const dv = new DataView(memBuf, sim.statePtr, sim.stateLen);
    const u8 = new Uint8Array(memBuf, sim.statePtr, sim.stateLen);

    // Pack AABBs.
    for (let i = 0; i < count; i++) {
      const off = STATICS_OFF + i * SIZEOF_AABB;
      dv.setFloat64(off + 0, aabbs[i]!.x, true);
      dv.setFloat64(off + 8, aabbs[i]!.y, true);
      dv.setFloat64(off + 16, aabbs[i]!.w, true);
      dv.setFloat64(off + 24, aabbs[i]!.h, true);
    }

    // Pack one-way mask. When respectOneWay is false, send all-zero
    // mask so the cached impl behaves like 4-way solid everywhere.
    const oneWayOff = STATICS_OFF + count * SIZEOF_AABB + 8;
    if (respectOneWay) {
      for (let i = 0; i < oneWay.length; i++) {
        u8[oneWayOff + i] = oneWay[i]! ? 1 : 0;
      }
    } else {
      for (let i = 0; i < oneWay.length; i++) u8[oneWayOff + i] = 0;
    }

    const staticsAbsPtr = sim.statePtr + STATICS_OFF;
    const oneWayAbsPtr = sim.statePtr + oneWayOff;
    const outAbsPtr = sim.statePtr + OUT_OFF;

    ex.resolve_move_cached(
      mover.x,
      mover.y,
      mover.w,
      mover.h,
      vx,
      vy,
      dt,
      staticsAbsPtr,
      count,
      oneWayAbsPtr,
      oneWay.length,
      outAbsPtr,
    );

    return {
      x: dv.getFloat64(OUT_OFF + 0, true),
      y: dv.getFloat64(OUT_OFF + 8, true),
      vx: dv.getFloat64(OUT_OFF + 16, true),
      vy: dv.getFloat64(OUT_OFF + 24, true),
      groundedThisFrame: dv.getInt32(OUT_OFF + 32, true) === 1,
    };
  };

  setResolveMoveCachedBackend(backend);
  console.info(
    "[wasm-collision] swap applied — sim collision now executes in Zig wasm",
  );
}

/**
 * `?wasm-player=1` — swap `stepPlayer` to call wasm. Combined with
 * `?wasm-collision=1`, every player physics tick runs entirely in
 * Zig wasm: gravity, friction, jump, coyote+buffer, jetpack,
 * sub-stepped collision. Parity-proven across a 90-tick scripted
 * run (see `playerParity.test.ts`).
 */
/**
 * Phase F3: player physics defaults to wasm-on. `?wasm-player=0` opts out.
 */
export async function applyWasmPlayerFlag(): Promise<void> {
  if (wasmDisabled("wasm-player")) {
    console.info("[wasm-player] disabled by ?wasm-player=0 — using TS native");
    return;
  }
  const sim = await getWasmSim();
  if (!sim) {
    console.warn(
      "[wasm-player] sim unavailable, stepPlayer stays on TS native",
    );
    return;
  }
  setStepPlayerBackend(makeStepPlayerWasmBackend(sim));
  console.info(
    "[wasm-player] swap applied — stepPlayer now executes in Zig wasm",
  );
}
