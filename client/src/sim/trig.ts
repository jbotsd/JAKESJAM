// LUT-based sin/cos/atan2 for the JAKESJAM sim — TS mirror of
// `sim/src/trig.zig`. The whole point: both sides sample the
// IDENTICAL precomputed tables (loaded from wasm memory at boot)
// and run identical lookup math, so cross-host trig drift becomes
// impossible by construction.
//
// Phase F2a (ADR-0006). The tables are baked into the wasm
// binary at compile time and exposed via `lut_sin_table_ptr` /
// `lut_atan_table_ptr` exports. TS reads them once at boot and
// caches as Float64Arrays.
//
// Sim purity: this file imports nothing outside `@sim/`. The
// host (`client/src/sim/wasm/runtime.ts`) calls `installLutTables`
// at boot to populate the tables; until then the LUT functions
// fall back to `Math.sin`/`Math.cos`/`Math.atan2` so unit tests
// that don't load wasm still work.

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

// Filled in by installLutTables(). Until then, lutSin etc. delegate
// to Math.sin so the sim still functions in environments that
// haven't loaded wasm (legacy tests, Convex actions, etc.).
let SIN_TABLE: Float64Array | null = null;
let ATAN_TABLE: Float64Array | null = null;
let TABLE_SIZE = 0;
let STEP_RAD = 0;

/**
 * Install the precomputed LUTs from the wasm binary. The host
 * calls this at boot once `lut_sin_table_ptr()` etc. are callable.
 *
 * `sinTable` and `atanTable` MUST be the exact byte content of the
 * wasm SIN_TABLE / ATAN_TABLE (Float64 little-endian). Pass them
 * via `new Float64Array(wasm.memory.buffer, ptr, size)`.
 */
export function installLutTables(
  sinTable: Float64Array,
  atanTable: Float64Array,
): void {
  if (sinTable.length !== atanTable.length) {
    throw new Error("LUT size mismatch");
  }
  // Copy out so we don't hold a view into wasm memory (which can
  // detach if the wasm grows its memory).
  SIN_TABLE = new Float64Array(sinTable);
  ATAN_TABLE = new Float64Array(atanTable);
  TABLE_SIZE = sinTable.length;
  STEP_RAD = HALF_PI / TABLE_SIZE;
}

export function lutSin(x: number): number {
  if (SIN_TABLE === null) return Math.sin(x);
  const reduced = x - Math.floor(x / TWO_PI) * TWO_PI;

  let quadX: number;
  let sign = 1;
  if (reduced < HALF_PI) {
    quadX = reduced;
  } else if (reduced < PI) {
    quadX = PI - reduced;
  } else if (reduced < PI + HALF_PI) {
    quadX = reduced - PI;
    sign = -1;
  } else {
    quadX = TWO_PI - reduced;
    sign = -1;
  }

  const idxF = quadX / STEP_RAD;
  const idxLo = Math.floor(idxF);
  const frac = idxF - idxLo;
  const a = idxLo < TABLE_SIZE ? SIN_TABLE[idxLo]! : 1;
  const b = idxLo + 1 < TABLE_SIZE ? SIN_TABLE[idxLo + 1]! : 1;
  return sign * (a + (b - a) * frac);
}

export function lutCos(x: number): number {
  return lutSin(x + HALF_PI);
}

function lutAtan(t: number): number {
  if (ATAN_TABLE === null) return Math.atan(t);
  const idxF = t * TABLE_SIZE;
  let idxLo = Math.floor(idxF);
  if (idxLo < 0) idxLo = 0;
  if (idxLo > TABLE_SIZE - 1) idxLo = TABLE_SIZE - 1;
  const frac = idxF - idxLo;
  const a = ATAN_TABLE[idxLo]!;
  const b = idxLo + 1 < TABLE_SIZE ? ATAN_TABLE[idxLo + 1]! : a;
  return a + (b - a) * frac;
}

export function lutAtan2(y: number, x: number): number {
  if (ATAN_TABLE === null) return Math.atan2(y, x);
  if (x === 0 && y === 0) return 0;

  const ax = Math.abs(x);
  const ay = Math.abs(y);

  let base: number;
  if (ay <= ax) {
    base = lutAtan(ay / ax);
  } else {
    base = HALF_PI - lutAtan(ax / ay);
  }

  if (x >= 0) return y >= 0 ? base : -base;
  return y >= 0 ? PI - base : base - PI;
}

/** Test/debug — returns true once `installLutTables` has run. */
export function lutTablesInstalled(): boolean {
  return SIN_TABLE !== null;
}
