// Server-side wasm sim loader. Loads the same `.wasm` artifact the
// browser loads, instantiates it with Bun's native WebAssembly
// support, and (optionally) routes the shared sim's
// `resolveMoveCached` calls through it.
//
// This is the server half of the substrate pivot (ADR-0006). When
// both the client AND the server route collision through this same
// wasm bytecode, predict ↔ authority is byte-identical and the
// float-drift reconcile churn vanishes.
//
// Triggered by the `JAKESJAM_WASM_COLLISION=1` env var (config.ts).
//
// Bun's `WebAssembly` global is the same surface as the browser's,
// so the loader path mirrors `client/src/sim/wasm/loader.ts`.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  setResolveMoveCachedBackend,
  type AABB,
  type ResolveMoveCachedResult,
  type StaticCollisionCache,
} from "@sim/collision.ts";
import { setStepPlayerBackend } from "@sim/player.ts";
import {
  makeStepPlayerWasmBackend,
  type SimHandle,
} from "@sim/wasm/playerWasmBackend.ts";
import type { SimExports } from "@sim/wasm/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In dev, the wasm lives at <repo>/client/public/wasm/sim.wasm.
// In Docker (Fly), the same relative path holds because we copy
// `client/public/` alongside `server/` in the image.
const WASM_PATH = resolve(__dirname, "..", "..", "client", "public", "wasm", "sim.wasm");

let cached: { instance: WebAssembly.Instance; ex: SimExports } | null = null;

export async function loadServerSim(): Promise<{
  ex: SimExports;
  statePtr: number;
  stateLen: number;
} | null> {
  if (cached) {
    return {
      ex: cached.ex,
      statePtr: cached.ex.alloc_state(),
      stateLen: cached.ex.state_size(),
    };
  }
  try {
    const bytes = await Bun.file(WASM_PATH).arrayBuffer();
    const mod = await WebAssembly.compile(bytes);
    const inst = await WebAssembly.instantiate(mod, {});
    const ex = inst.exports as unknown as SimExports;
    cached = { instance: inst, ex };
    return {
      ex,
      statePtr: ex.alloc_state(),
      stateLen: ex.state_size(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[wasm-sim] server-side load failed: ${msg}`);
    return null;
  }
}

/**
 * Boot-time entrypoint. If the env var is set, load the wasm and
 * install the resolveMoveCached backend so every authoritative tick
 * routes collision through wasm. If load fails, log and continue
 * with the TS impl — server stays functional, just without the
 * determinism win.
 */
export async function applyServerWasmCollision(): Promise<void> {
  const got = await loadServerSim();
  if (!got) {
    console.warn(
      "[wasm-sim] collision swap skipped — server stays on TS native",
    );
    return;
  }
  const { ex, statePtr, stateLen } = got;
  const SIZEOF_AABB = ex.sizeof_aabb();
  const SIZEOF_RESOLVE = ex.sizeof_resolve_move_out();
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
    const memBuf = ex.memory.buffer;
    const dv = new DataView(memBuf, statePtr, stateLen);
    const u8 = new Uint8Array(memBuf, statePtr, stateLen);

    for (let i = 0; i < count; i++) {
      const off = STATICS_OFF + i * SIZEOF_AABB;
      dv.setFloat64(off + 0, aabbs[i]!.x, true);
      dv.setFloat64(off + 8, aabbs[i]!.y, true);
      dv.setFloat64(off + 16, aabbs[i]!.w, true);
      dv.setFloat64(off + 24, aabbs[i]!.h, true);
    }
    const oneWayOff = STATICS_OFF + count * SIZEOF_AABB + 8;
    for (let i = 0; i < oneWay.length; i++) {
      u8[oneWayOff + i] = respectOneWay && oneWay[i]! ? 1 : 0;
    }

    ex.resolve_move_cached(
      mover.x, mover.y, mover.w, mover.h,
      vx, vy, dt,
      statePtr + STATICS_OFF, count,
      statePtr + oneWayOff, oneWay.length,
      statePtr + OUT_OFF,
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
    "[wasm-sim] server-side resolveMoveCached now executes in Zig wasm",
  );
}

/**
 * Phase B4 — full player physics swap. Wires the shared
 * `makeStepPlayerWasmBackend` factory so the server uses Zig wasm
 * for stepPlayer. Combined with `?wasm-player=1` on the client,
 * predict ↔ authority is bit-identical for movement.
 */
export async function applyServerWasmPlayer(): Promise<void> {
  const got = await loadServerSim();
  if (!got) {
    console.warn("[wasm-sim] player swap skipped — server stays on TS native");
    return;
  }
  const handle: SimHandle = {
    statePtr: got.statePtr,
    stateLen: got.stateLen,
    exports: got.ex as unknown as SimExports,
  };
  setStepPlayerBackend(makeStepPlayerWasmBackend(handle));
  console.info(
    "[wasm-sim] server-side stepPlayer now executes in Zig wasm",
  );
}
