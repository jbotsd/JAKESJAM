// Server-tick perf probe (2026-07-27 lag/perf audit).
//
// Boots a REAL WorldHost with the EXACT production boot sequence (same
// loadServerSim + wasm collision/player install as server/src/index.ts) and
// the EXACT production WorldHost config (target-score-5, botFloor 4,
// map rotation on) — no mocks, no shortcuts. All-bot roster (0 humans) so
// this runs headless with no browser/network in the loop, but every bot
// exercises the real WorldBots AI (movement, weapon fire, class abilities,
// melee, dash/parry/shield, drafting picks) against the real MatchHost tick
// loop (server/src/matchHost.ts) — the same code path a live human match
// runs, satellites/destructibles/lag-comp included. This is deliberately
// NOT the isolated stepPlayer micro-bench (docs/zig-wasm-perf-baseline.md
// already owns that) — it's the FULL per-tick cost under real match load.
//
// Run: `bun scripts/serverTickPerfProbe.ts [seconds]` (default 120s).
//
// Reads MatchHost.getTickTimingStats() (ring buffer of tick() wall-times,
// added this pass) via WorldHost.tickTimingStats(). Real time elapses at
// 1:1 with sim ticks (MatchHost's own setInterval paces it, same as
// production) — this is intentional: performance.now() timings inside
// tick() are unaffected by how it's paced, and letting real match phases
// (countdown/fighting/round-over/drafting) cycle naturally is the only way
// to see their real relative tick costs, not an artificially accelerated one.

import { loadServerSim, applyServerWasmCollision, applyServerWasmPlayer } from "../server/src/wasmRuntime.ts";
import { WorldHost } from "../server/src/worldHost.ts";

const SECONDS = Number(process.argv[2] ?? "120");

await loadServerSim();
await applyServerWasmCollision();
await applyServerWasmPlayer();

console.log(`[probe] booting WorldHost (production config: target-score-5, bots=2, botFloor=4, rotateMaps=true) for ${SECONDS}s...`);

const worldHost = new WorldHost({
  modeModifierIds: ["target-score-5"],
  rotateMaps: true,
  bots: 2,
  botFloor: 4,
});

// (2026-07-27 lag/perf audit item 3) Lightweight heap-trend instrument —
// PROBE-SIDE only (this script's own 500ms poll loop), zero cost added to
// the hot tick path itself. JavaScriptCore (Bun's engine) doesn't expose a
// per-GC-pause timing API the way V8's `perf_hooks` PerformanceObserver
// does, so this can't directly timestamp "a GC ran here" — but a real GC
// pause frees memory, so a sudden heapUsed DROP at the same wall-clock
// moment as a `[tick-spike]` line is suggestive-of-GC; a heap that's just
// monotonically climbing with no drops around spikes argues AGAINST GC and
// FOR host-contention as the cause (this box's own CPU/swap pressure at
// measurement time, not JAKESJAM's code) — the two competing hypotheses
// item 3 was explicitly unable to distinguish between last pass.
let lastHeapUsedMB = 0;
const heapLog: Array<{ tSec: number; heapUsedMB: number; rssMB: number; deltaMB: number }> = [];

let lastPhase: string | undefined;
let lastMap: string | undefined;
const phaseLog: Array<{ tSec: number; mapId: string; phase: string }> = [];
const perPhaseStats: Array<{ tSec: number; mapId: string; phase: string; stats: ReturnType<typeof worldHost.tickTimingStats> }> = [];
const pollTimer = setInterval(() => {
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round((mem.heapUsed / 1e6) * 10) / 10;
  const rssMB = Math.round((mem.rss / 1e6) * 10) / 10;
  const deltaMB = Math.round((heapUsedMB - lastHeapUsedMB) * 10) / 10;
  heapLog.push({ tSec: Math.round(process.uptime()), heapUsedMB, rssMB, deltaMB });
  lastHeapUsedMB = heapUsedMB;

  const s = worldHost.summary();
  if (!s) return;
  const entityCounts = worldHost.host
    ? {
        players: Object.keys((worldHost.host as any).state?.players ?? {}).length,
        proj: Object.keys((worldHost.host as any).state?.projectiles ?? {}).length,
        destr: Object.keys((worldHost.host as any).state?.destructibles ?? {}).length,
        sat: Object.keys((worldHost.host as any).state?.satellites ?? {}).length,
      }
    : null;
  if (s.phase !== lastPhase || s.mapId !== lastMap) {
    // Snapshot the ring-buffer stats RIGHT BEFORE the phase changes so the
    // previous phase's distribution isn't diluted/overwritten by the next
    // phase's ticks once the 3600-sample ring wraps.
    if (lastPhase) {
      perPhaseStats.push({ tSec: Math.round(process.uptime()), mapId: lastMap!, phase: lastPhase, stats: worldHost.tickTimingStats() });
    }
    lastPhase = s.phase;
    lastMap = s.mapId;
    phaseLog.push({ tSec: Math.round(process.uptime()), mapId: s.mapId, phase: s.phase });
    console.log(`[probe] t=${Math.round(process.uptime())}s map=${s.mapId} phase=${s.phase} entities=${JSON.stringify(entityCounts)}`);
  }
}, 500);

await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
clearInterval(pollTimer);

const stats = worldHost.tickTimingStats();
console.log("\n=== server tick timing (matchHost.tick(), ms) — final 60s window ===");
console.log(JSON.stringify(stats, null, 2));
console.log("\n=== per-phase tick timing snapshots (captured at each phase edge) ===");
for (const p of perPhaseStats) {
  console.log(`  t=${p.tSec}s map=${p.mapId} phase=${p.phase}: ${JSON.stringify(p.stats)}`);
}
console.log("\n=== phase transitions observed ===");
for (const p of phaseLog) console.log(`  t=${p.tSec}s map=${p.mapId} phase=${p.phase}`);

// (2026-07-27 lag/perf audit item 3) Heap trend — cross-reference against
// any `[tick-spike]` lines above by their `tSec`/wall-clock proximity. A
// spike whose neighboring heapUsedMB reading shows a sharp NEGATIVE delta
// is consistent with a GC pause; spikes with no heap-drop nearby argue for
// host contention (scheduling, not allocation) as the cause instead.
console.log("\n=== heap trend (probe-side poll, 500ms — NOT hot-path cost) ===");
console.log("tSec\theapUsedMB\trssMB\tdeltaMB");
for (const h of heapLog) {
  const flag = h.deltaMB <= -5 ? "  <-- heap DROP (GC-consistent)" : "";
  console.log(`${h.tSec}\t${h.heapUsedMB}\t${h.rssMB}\t${h.deltaMB}${flag}`);
}
const maxHeap = Math.max(...heapLog.map((h) => h.heapUsedMB));
const minHeap = Math.min(...heapLog.map((h) => h.heapUsedMB));
const bigDrops = heapLog.filter((h) => h.deltaMB <= -5).length;
console.log(`\nheap range over run: ${minHeap}MB - ${maxHeap}MB, big-drop (>=5MB) samples: ${bigDrops}/${heapLog.length}`);

process.exit(0);
