// Debug state-probe harness. Exposes deterministic-state observability
// on the global window so Playwright (and any other external tool) can
// pull a stable hash of the current WorldState without forking sim
// internals or depending on Phaser GameObject layout.
//
// The probe is install-once + register-when-active:
//
//   - main.ts calls `installWindowProbe()` at boot to wire the globals.
//   - Each scene that owns a WorldState calls `setActiveStateGetter(fn)`
//     when it starts, and `setActiveStateGetter(null)` when it stops.
//   - When no scene owns state, all probe calls return null.
//
// Globals exposed:
//   window.__simStateHash() : number | null   -- 32-bit FNV1a-mix
//   window.__simStepNo()    : number | null   -- current tick
//   window.__simHasState()  : boolean         -- true if a getter is live
//
// Used by: tests/e2e/gameplay.spec.ts, tests/e2e/long-horizon.spec.ts,
// tests/e2e/multi-client.spec.ts.

import { hashWorldStateLite } from "../sim/hash.js";
import type { WorldState } from "../sim/types.js";

let activeStateGetter: (() => WorldState | null) | null = null;

const FNV1A_PRIME_32 = 0x01000193;
const FNV1A_BASIS_32 = 0x811c9dc5;

function mixU32(hash: number, v: number): number {
  return Math.imul(hash ^ (v >>> 0), FNV1A_PRIME_32) >>> 0;
}

function combineHash(state: WorldState): number {
  const lite = hashWorldStateLite(state);
  let h = FNV1A_BASIS_32;
  h = mixU32(h, state.tick | 0);
  // Sort keys so iteration order is stable across V8 versions /
  // map-deletion patterns.
  const playerIds = Object.keys(lite.players).sort();
  for (const pid of playerIds) {
    h = mixU32(h, lite.players[pid as keyof typeof lite.players] ?? 0);
  }
  const projIds = Object.keys(lite.projectiles).sort();
  for (const eid of projIds) {
    h = mixU32(h, lite.projectiles[+eid as keyof typeof lite.projectiles] ?? 0);
  }
  return h >>> 0;
}

export function setActiveStateGetter(
  fn: (() => WorldState | null) | null,
): void {
  activeStateGetter = fn;
}

type ProbeWindow = {
  __simStateHash?: () => number | null;
  __simStepNo?: () => number | null;
  __simHasState?: () => boolean;
  __simSampleHashes?: (count: number, intervalMs: number) => Promise<number[]>;
};

export function installWindowProbe(): void {
  const w = window as unknown as ProbeWindow;
  w.__simStateHash = () => {
    const s = activeStateGetter?.();
    if (!s) return null;
    return combineHash(s);
  };
  w.__simStepNo = () => {
    const s = activeStateGetter?.();
    return s ? (s.tick | 0) : null;
  };
  w.__simHasState = () => activeStateGetter?.() != null;
  w.__simSampleHashes = async (count, intervalMs) => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const s = activeStateGetter?.();
      if (s) out.push(combineHash(s));
      else out.push(0);
      if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }
    return out;
  };
}
