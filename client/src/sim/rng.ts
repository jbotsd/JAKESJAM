// Seeded deterministic RNG for sim/. Mulberry32 — 32-bit state, ~2^32 period,
// uniform distribution good enough for game logic (spread cones, crit rolls,
// drop tables). Not cryptographic.
//
// Usage:
//   const next = nextU32(state);            // returns the new state cursor
//   const value = (next / 0xffffffff);      // 0..1
//
// State is a single uint32 stored on WorldState.rngState. All sim functions
// thread it through; never call Math.random() inside sim/.

export function nextU32(state: number): number {
  let s = (state + 0x6d2b79f5) >>> 0;
  s = Math.imul(s ^ (s >>> 15), s | 1) >>> 0;
  s ^= s + (Math.imul(s ^ (s >>> 7), s | 61) >>> 0);
  return (s ^ (s >>> 14)) >>> 0;
}

/** Returns [newState, value in [0, 1)]. */
export function nextFloat(state: number): [number, number] {
  const n = nextU32(state);
  return [n, n / 0x100000000];
}

/** Returns [newState, integer in [min, maxExclusive)]. */
export function nextInt(state: number, min: number, maxExclusive: number): [number, number] {
  const [n, f] = nextFloat(state);
  return [n, min + Math.floor(f * (maxExclusive - min))];
}

/** Returns [newState, value in [-1, 1]]. */
export function nextSigned(state: number): [number, number] {
  const [n, f] = nextFloat(state);
  return [n, f * 2 - 1];
}

/** Returns [newState, item from arr]. Array must be non-empty. */
export function pickOne<T>(state: number, arr: readonly T[]): [number, T] {
  const [n, idx] = nextInt(state, 0, arr.length);
  return [n, arr[idx]!];
}
