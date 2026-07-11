// Scan a replay for player-killed ticks (deterministic re-sim).
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { STEP_MS, World } from "@sim/index.ts";
import { createRuntime, stepWithRuntime } from "@sim/World.ts";
import { resolveMap } from "@sim/data/maps.ts";
import { applyMidMatchJoin, applyRosterLeave } from "@sim/rosterOps.ts";
import type { InputFrame, PlayerId, PlayerSpawnInfo } from "@sim/types.ts";

const path = process.argv[2]!;
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const { header, inputs, rosterEvents } = msgpackDecode(bytes) as any;
const map = resolveMap(header.mapId);
const spawns = header.players.map((p: any) => p as PlayerSpawnInfo);
const byTick = new Map<number, any[]>();
for (const e of inputs) {
  let b = byTick.get(e.atTick);
  if (!b) byTick.set(e.atTick, (b = []));
  b.push(e);
}
const rosterByTick = new Map<number, any[]>();
for (const e of rosterEvents ?? []) {
  let b = rosterByTick.get(e.atTick);
  if (!b) rosterByTick.set(e.atTick, (b = []));
  b.push(e);
}
let state = World.create(map, spawns, header.rngSeed, [...header.chaosModifierIds]);
const runtime = createRuntime(map);
while (state.tick < header.totalTicks) {
  const roster = rosterByTick.get(state.tick);
  if (roster) for (const ev of roster) state = ev.t === "join" ? applyMidMatchJoin(state, map, ev.spawn) : applyRosterLeave(state, ev.playerId);
  const entries = byTick.get(state.tick);
  const frame: Record<PlayerId, InputFrame | null> = {};
  if (entries) for (const e of entries) frame[e.playerId as PlayerId] = e.frame;
  const r = stepWithRuntime(state, runtime, frame, STEP_MS);
  state = r.state;
  for (const ev of r.events) {
    if (ev.t === "player-killed") console.log(`kill tick=${state.tick} victim=${ev.victimId} killer=${ev.killerId} cause=${ev.cause}`);
  }
}
console.log(`total ticks: ${header.totalTicks}`);
