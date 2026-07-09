// Snapshot delta encode/decode benchmark — the server's per-client 20Hz
// broadcast cost and the client's per-snapshot apply cost, measured at
// worst-case entity load (16 players, ~450 projectiles). Run:
//   cd client && BENCH_PLAYERS=16 BENCH_HEAVY=1 bun bench/snapshotDelta.bench.ts

import { World, createRuntime, stepWithRuntime } from "../src/sim/World.ts";
import { resolveMap } from "../src/sim/data/maps.ts";
import { encodeDelta, applyDelta } from "../src/net/snapshotDelta.ts";
import {
  InputSeq,
  PlayerId,
  Tick,
  type InputFrame,
  type PlayerSpawnInfo,
  type WorldState,
} from "../src/sim/types.ts";

const DT_MS = 1000 / 60;
const PLAYERS = Number(process.env.BENCH_PLAYERS ?? 16);
const WARMUP_TICKS = 900;

const FireBit = 1 << 6;
const LeftBit = 1 << 0;
const RightBit = 1 << 1;

const map = resolveMap("boxworks-mini");
const spawns: PlayerSpawnInfo[] = Array.from({ length: PLAYERS }, (_, i) => ({
  playerId: PlayerId(`p${i}`),
  name: `p${i}`,
  characterId: "balanced" as const,
  weaponId: "starter-pistol",
}));

let state = World.create(map, spawns, 1);
state = { ...state, round: { ...state.round, phase: "fighting", countdownRemainingMs: 90_000 } };
if (process.env.BENCH_HEAVY === "1") {
  const heavyCards = [
    "five-shard-spray", "five-shard-spray", "five-shard-spray",
    "one-more-shard", "one-more-shard", "one-more-shard", "one-more-shard",
    "rapid-refraction", "rapid-refraction", "bouncy-prism", "extra-bounce",
  ];
  const heavyPlayers: typeof state.players = {};
  for (const [pid, pl] of Object.entries(state.players)) {
    heavyPlayers[pid as PlayerId] = { ...pl, cards: [...heavyCards] };
  }
  state = { ...state, players: heavyPlayers };
}
const runtime = createRuntime(map);

let seq = 1;
function inputsForTick(tick: number): Record<PlayerId, InputFrame | null> {
  const out: Record<PlayerId, InputFrame | null> = {};
  for (let i = 0; i < PLAYERS; i++) {
    const pid = PlayerId(`p${i}`);
    const dir = ((tick >> (4 + (i % 3))) & 1) === 0 ? LeftBit : RightBit;
    out[pid] = {
      seq: InputSeq(seq++), tick: Tick(tick), keys: dir | FireBit,
      aimX: 200 + ((tick * 3 + i * 160) % 880),
      aimY: 150 + ((tick * 2 + i * 90) % 400),
      dtMs: DT_MS,
    };
  }
  return out;
}

function sustain(s0: WorldState): WorldState {
  const players: WorldState["players"] = {};
  let dirty = false;
  for (const [pid, pl] of Object.entries(s0.players)) {
    if (pl.alive && pl.health >= 100) { players[pid as PlayerId] = pl; continue; }
    players[pid as PlayerId] = { ...pl, alive: true, health: 100 };
    dirty = true;
  }
  const round = s0.round.phase !== "fighting" || s0.round.countdownRemainingMs < 10_000
    ? { ...s0.round, phase: "fighting" as const, countdownRemainingMs: 90_000, suddenDeathActive: false }
    : s0.round;
  return dirty || round !== s0.round ? { ...s0, players, round } : s0;
}

// Build up steady-state load, keeping the previous 3 ticks (SNAPSHOT_INTERVAL).
let prev = state;
for (let t = 0; t < WARMUP_TICKS; t++) {
  if (t === WARMUP_TICKS - 3) prev = state; // baseline 3 ticks back (20Hz)
  state = stepWithRuntime(sustain(state), runtime, inputsForTick(t), DT_MS).state;
}
console.log(`entities: ${Object.keys(state.players).length} players, ${Object.keys(state.projectiles).length} projectiles`);

Bun.gc(true);
const N = 2000;
// Encode bench.
let bytes = 0;
let t0 = performance.now();
for (let i = 0; i < N; i++) {
  const d = encodeDelta(prev, state);
  if (i === 0) bytes = JSON.stringify(d).length;
}
const encMs = (performance.now() - t0) / N;
// Decode bench.
const delta = encodeDelta(prev, state);
t0 = performance.now();
for (let i = 0; i < N; i++) applyDelta(prev, delta);
const decMs = (performance.now() - t0) / N;

console.log(`encodeDelta: ${(encMs * 1000).toFixed(1)}µs/call  (~payload ${(bytes / 1024).toFixed(1)}KB json)`);
console.log(`applyDelta:  ${(decMs * 1000).toFixed(1)}µs/call`);
console.log(`server @20Hz x 16 clients ≈ ${(encMs * 20 * 16).toFixed(2)}ms/s encode CPU`);

// Wire-size reality check: the actual wire is msgpack (protocol.ts
// encodeMessage), optionally deflated (perMessageDeflate). Measure both.
import { encodeMessage } from "../src/net/protocol.ts";
import { deflateRawSync } from "node:zlib";
const wire = encodeMessage({
  t: "snap",
  tick: state.tick,
  lastProcessedInputSeq: {},
  baseline: prev.tick,
  delta,
  events: [],
} as never);
const deflated = deflateRawSync(wire);
let t1 = performance.now();
for (let i = 0; i < 500; i++) deflateRawSync(wire);
const deflMs = (performance.now() - t1) / 500;
console.log(`wire msgpack: ${(wire.byteLength / 1024).toFixed(1)}KB → deflate: ${(deflated.byteLength / 1024).toFixed(1)}KB (${(100 * deflated.byteLength / wire.byteLength).toFixed(0)}%), deflate cost ${(deflMs * 1000).toFixed(0)}µs/msg`);
