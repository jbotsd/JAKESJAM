// Sim-tick benchmark — the client-prediction hot path (pure TS, no wasm),
// which is ALSO the server-authority path today. Run:
//   cd client && bun bench/simTick.bench.ts
//
// Realistic-ish load: 8 players (4 "humans" + 4 bots-shaped), everyone
// moving and firing, so projectile count settles at a steady-state churn.
// Reports ms/tick avg + p99 and heap growth per 1k ticks (GC pressure).

import { World, createRuntime, stepWithRuntime } from "../src/sim/World.ts";
import { resolveMap } from "../src/sim/data/maps.ts";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type PlayerSpawnInfo,
} from "../src/sim/types.ts";

const DT_MS = 1000 / 60;
const PLAYERS = Number(process.env.BENCH_PLAYERS ?? 8);
const WARMUP_TICKS = 600;
const MEASURE_TICKS = 3000;

const FireBit = 1 << 6;
const LeftBit = 1 << 0;
const RightBit = 1 << 1;
const JumpBit = 1 << 4;
const DashBit = 1 << 9;

const map = resolveMap("boxworks-mini");
const spawns: PlayerSpawnInfo[] = Array.from({ length: PLAYERS }, (_, i) => ({
  playerId: PlayerId(`p${i}`),
  name: `p${i}`,
  characterId: "balanced" as const,
  weaponId: "starter-pistol",
}));

let state = World.create(map, spawns, 1);
// BENCH_HEAVY=1: give every player a max-pellet, bouncy, fast-firing build —
// the worst-case projectile load a real drafted endgame can produce.
if (process.env.BENCH_HEAVY === "1") {
  const heavyCards = [
    "five-shard-spray", "five-shard-spray", "five-shard-spray",
    "one-more-shard", "one-more-shard", "one-more-shard", "one-more-shard",
    "rapid-refraction", "rapid-refraction",
    "bouncy-prism", "extra-bounce",
  ];
  const heavyPlayers: typeof state.players = {};
  for (const [pid, pl] of Object.entries(state.players)) {
    heavyPlayers[pid as PlayerId] = { ...pl, cards: [...heavyCards] };
  }
  state = { ...state, players: heavyPlayers };
}
// Force the round into fighting so weapons actually fire.
state = {
  ...state,
  round: { ...state.round, phase: "fighting", countdownRemainingMs: 90_000 },
};
const runtime = createRuntime(map);
// BENCH_NO_SCRATCH=1: disable the hit-sweep scratch to A/B the optimization
// under IDENTICAL machine contention (cross-run comparisons are useless
// when other workloads share the box).
if (process.env.BENCH_NO_SCRATCH === "1") {
  (runtime as { scratchHitSweep?: unknown }).scratchHitSweep = undefined;
}

let seq = 1;
function inputsForTick(tick: number): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (let i = 0; i < PLAYERS; i++) {
    const pid = PlayerId(`p${i}`);
    // Deterministic movement pattern per player: strafe direction flips on
    // a per-player period; everyone holds fire; periodic jumps and dashes.
    const dir = ((tick >> (4 + (i % 3))) & 1) === 0 ? LeftBit : RightBit;
    let keys = dir | FireBit;
    if ((tick + i * 7) % 90 === 0) keys |= JumpBit;
    if ((tick + i * 13) % 120 === 0) keys |= DashBit;
    out[pid] = {
      seq: InputSeq(seq++),
      tick: Tick(tick),
      keys,
      aimX: 200 + ((tick * 3 + i * 160) % 880),
      aimY: 150 + ((tick * 2 + i * 90) % 400),
      dtMs: DT_MS,
    };
  }
  return out;
}

// God-mode sustain: revive everyone each tick and pin the round in
// `fighting` so the brawl never resolves — the bench measures a permanent
// worst-case combat load, not round-cycle idle time.
function sustain(s0: typeof state): typeof state {
  let anyDead = false;
  for (const pl of Object.values(s0.players)) {
    if (!pl.alive || pl.health < 100) { anyDead = true; break; }
  }
  const round = s0.round.phase !== "fighting" || s0.round.countdownRemainingMs < 10_000
    ? { ...s0.round, phase: "fighting" as const, countdownRemainingMs: 90_000, suddenDeathActive: false }
    : s0.round;
  if (!anyDead && round === s0.round) return s0;
  const players: typeof s0.players = {};
  for (const [pid, pl] of Object.entries(s0.players)) {
    players[pid as PlayerId] = pl.alive && pl.health >= 100 ? pl : { ...pl, alive: true, health: 100 };
  }
  return { ...s0, players, round };
}

// Warmup (JIT + steady-state projectile population).
for (let t = 0; t < WARMUP_TICKS; t++) {
  const res = stepWithRuntime(sustain(state), runtime, inputsForTick(t), DT_MS);
  state = res.state;
}

Bun.gc(true);
const heapBefore = process.memoryUsage().heapUsed;

const samples = new Float64Array(MEASURE_TICKS);
for (let t = 0; t < MEASURE_TICKS; t++) {
  const sustained = sustain(state);
  const t0 = performance.now();
  const res = stepWithRuntime(sustained, runtime, inputsForTick(WARMUP_TICKS + t), DT_MS);
  samples[t] = performance.now() - t0;
  state = res.state;
}

const heapAfter = process.memoryUsage().heapUsed;

const sorted = [...samples].sort((a, b) => a - b);
const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
const max = sorted[sorted.length - 1]!;
const projCount = Object.keys(state.projectiles).length;

console.log(`players=${PLAYERS} ticks=${MEASURE_TICKS} steady-state projectiles=${projCount}`);
console.log(`ms/tick avg=${avg.toFixed(3)} p50=${p50.toFixed(3)} p99=${p99.toFixed(3)} max=${max.toFixed(3)}`);
console.log(`heap growth ≈ ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(1)} MB over ${MEASURE_TICKS} ticks (pre-GC churn indicator)`);
