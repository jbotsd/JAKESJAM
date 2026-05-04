import type { SimExports } from "./types";

// Wasm is built into client/public/wasm/sim.wasm by `cd sim && zig build`
// (configured in sim/build.zig). Vite copies public/ verbatim to dist/,
// so the production URL is stable at `/wasm/sim.wasm`. No hashing —
// versioning is via deployment, not URL fingerprint.
const WASM_URL = "/wasm/sim.wasm";

export type Sim = {
  readonly statePtr: number;
  readonly stateLen: number;
  step(inputsPtr: number, inputsLen: number, dtMs: number): void;
  currentTick(): number;
  reset(): void;
  /**
   * Always returns a fresh view — wasm memory may grow / be remapped,
   * so caching across calls is unsound. Keep the view scoped to a
   * single tick boundary.
   */
  stateView(): Uint8Array;
  memoryView(): Uint8Array;
  /** Direct access to typed exports (for parity probes, hot-path swaps). */
  readonly exports: SimExports;
};

let cached: Sim | null = null;

export async function loadSim(): Promise<Sim> {
  if (cached) return cached;
  const inst = await instantiate(WASM_URL);
  cached = wrap(inst);
  return cached;
}

/**
 * Bun-friendly variant: instantiate from raw bytes. The default
 * `loadSim()` uses Vite's `?url` import which doesn't resolve under
 * `bun test`, so the test harness reads the file directly and hands
 * the bytes here.
 */
export async function loadSimFromBytes(bytes: ArrayBuffer): Promise<Sim> {
  const mod = await WebAssembly.compile(bytes);
  const inst = await WebAssembly.instantiate(mod, {});
  return wrap(inst);
}

async function instantiate(url: string): Promise<WebAssembly.Instance> {
  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      const resp = await fetch(url);
      const out = await WebAssembly.instantiateStreaming(resp, {});
      return out.instance;
    } catch {
      // Fall through to the plain bytes path — some dev servers serve
      // wasm with a non-`application/wasm` MIME, which makes
      // instantiateStreaming reject.
    }
  }
  const bytes = await fetch(url).then((r) => r.arrayBuffer());
  const mod = await WebAssembly.compile(bytes);
  return WebAssembly.instantiate(mod, {});
}

function wrap(inst: WebAssembly.Instance): Sim {
  const ex = inst.exports as unknown as SimExports;
  const statePtr = ex.alloc_state();
  const stateLen = ex.state_size();
  const memBuf = (): Uint8Array => new Uint8Array(ex.memory.buffer);
  return {
    statePtr,
    stateLen,
    step: (inputsPtr, inputsLen, dtMs) =>
      ex.step(statePtr, stateLen, inputsPtr, inputsLen, dtMs),
    currentTick: () => ex.current_tick(),
    reset: () => ex.reset(),
    stateView: () => memBuf().subarray(statePtr, statePtr + stateLen),
    memoryView: memBuf,
    exports: ex,
  };
}
