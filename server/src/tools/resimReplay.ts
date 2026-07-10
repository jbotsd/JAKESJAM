// Re-simulate a persisted replay file from disk — the foundation stone of
// the headless replay renderer (RENDER_OVERHAUL_PLAN Phase 5): proves that
// a real match's .jjr (kilobytes of inputs) reconstructs the full WorldState
// timeline, and measures how much faster than realtime the re-sim runs.
//
// NOTE this deliberately does NOT use ReplayRecorder.playReplay(): that
// helper only steps ticks that HAVE inputs, which is correct for the dense
// round-trip test but WRONG for real matches — countdown/draft/idle ticks
// carry no inputs, and the live host steps EVERY tick regardless. The
// renderer must do what this does: step 0..totalTicks, applying recorded
// inputs at their ticks.
//
// Usage: bun server/src/tools/resimReplay.ts server/.replays/<file>.jjr

import { decode as msgpackDecode } from "@msgpack/msgpack";
import { STEP_MS, World } from "@sim/index.ts";
import { createRuntime, stepWithRuntime } from "@sim/World.ts";
import { resolveMap } from "@sim/data/maps.ts";
import type { InputFrame, PlayerId } from "@sim/types.ts";
import type { ReplayHeader, ReplayInputEntry } from "../ReplayRecorder.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun server/src/tools/resimReplay.ts <replay.jjr>");
  process.exit(1);
}

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const { header, inputs, rosterEvents } = msgpackDecode(bytes) as {
  header: ReplayHeader;
  inputs: ReplayInputEntry[];
  rosterEvents?: Array<{ atTick: number; t: string }>;
};

console.log(
  `replay: match=${header.matchId} map=${header.mapId} seed=${header.rngSeed} ` +
    `ticks=${header.totalTicks} inputs=${inputs.length} players=${header.players.length} ` +
    `backend=${header.simBackend ?? "unknown"} fallbackTicks=${header.backendFallbackTicks ?? 0}`,
);
if (rosterEvents && rosterEvents.length > 0) {
  console.warn(
    `warning: ${rosterEvents.length} mid-match roster events recorded — this tool does not ` +
      `apply them yet, so joiners/leavers are missing from this reconstruction (renderer TODO)`,
  );
}
if (header.simBackend === "wasm") {
  console.warn(
    "warning: live match ran the WASM backend; this TS re-sim is parity-tested but not bit-guaranteed",
  );
}

const map = resolveMap(header.mapId);
const spawns = header.players.map((p) => ({
  playerId: p.playerId as PlayerId,
  characterId: p.characterId,
  name: p.name,
  color: p.color,
  weaponId: p.weaponId,
}));

const byTick = new Map<number, ReplayInputEntry[]>();
for (const e of inputs) {
  let b = byTick.get(e.atTick);
  if (!b) byTick.set(e.atTick, (b = []));
  b.push(e);
}

let state = World.create(map, spawns, header.rngSeed, [...header.chaosModifierIds]);
const runtime = createRuntime(map);
const t0 = performance.now();
let applied = 0;
while (state.tick < header.totalTicks) {
  const entries = byTick.get(state.tick);
  const frame: Record<PlayerId, InputFrame | null> = {};
  if (entries) {
    for (const e of entries) {
      frame[e.playerId as PlayerId] = e.frame;
      applied += 1;
    }
  }
  state = stepWithRuntime(state, runtime, frame, STEP_MS).state;
}
const elapsed = performance.now() - t0;
const simSeconds = (header.totalTicks * STEP_MS) / 1000;

let hash = 0;
for (const pid in state.players) {
  const p = state.players[pid as PlayerId]!;
  hash = (hash ^ ((Math.round(p.x * 100) * 31 + Math.round(p.y * 100)) | 0)) >>> 0;
}

console.log(
  `re-simulated ${header.totalTicks} ticks (${simSeconds.toFixed(1)}s of match) in ` +
    `${(elapsed / 1000).toFixed(2)}s — ${(simSeconds / (elapsed / 1000)).toFixed(1)}x realtime, ` +
    `${applied}/${inputs.length} inputs applied`,
);
console.log(`final tick=${state.tick} rng=${state.rngState} posHash=${hash.toString(16)}`);
for (const pid in state.players) {
  const p = state.players[pid as PlayerId]!;
  console.log(
    `  ${pid}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) hp=${p.health} alive=${p.alive}`,
  );
}
