// The wasm half of the port passport — gospel N0.4.
//
// Mirror of `jjsim replay-hash`: same replay, same input contract, same
// FNV1a over the same packed state buffer — but stepped through sim.wasm
// instead of the native build. If the two hash streams differ, native and
// wasm are not the same game and L10 is violated.
//
//   bun server/tools/replay-hash-wasm.ts <replay.jjr> [--every N] [--max-ticks N]
//
// Output format matches jjsim exactly (a `#` header line, then
// "<tick>\t<hex>" rows, then "final\t<hex>") so the comparison is `diff`.
//
// The initial state is rebuilt here rather than read from the .init.bin so
// this harness exercises the same construction path the live host uses; the
// dumper writes the identical bytes for the native side.

import { decode as msgpackDecode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { World } from "@sim/World.ts";
import {
  packWorldState,
  packedPlayerOrder,
  WORLD_STATE_TOTAL_SIZE,
  HEADER_SIZE,
  PLAYER_ENTITY_SIZE,
} from "@sim/wasm/worldStateBridge.ts";
import { resolveMap } from "@sim/data/maps.ts";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";
import { loadServerSim } from "../src/wasmRuntime.ts";

// Same non-standard FNV1a variant the sim uses on both sides (sim/hash.zig,
// client/src/sim/hash.ts) — each byte mix XORs in BASIS >> 16. A stock
// FNV1a here would disagree with Zig for reasons that have nothing to do
// with the sim.
const FNV1A_PRIME_32 = 0x01000193;
const FNV1A_BASIS_32 = 0x811c9dc5;
const FNV1A_BASIS_HI16 = FNV1A_BASIS_32 >>> 16;

function hashBytes(bytes: Uint8Array): number {
  let h = FNV1A_BASIS_32;
  for (const b of bytes) {
    h = (Math.imul(h ^ (b & 0xff), FNV1A_PRIME_32) ^ FNV1A_BASIS_HI16) >>> 0;
  }
  return h >>> 0;
}

// Player-entity field offsets — the same constants serverWasmHost patches.
const AIMX_OFF = 4 * 8;
const AIMY_OFF = 5 * 8;
const CURR_OFF = 268;
const PREV_OFF = 272;

type ReplayHeader = {
  formatVersion: number;
  mapId: string;
  rngSeed: number;
  totalTicks: number;
  players: Array<{
    playerId: string;
    characterId: string;
    name: string;
    color: string;
    weaponId: string;
  }>;
  chaosModifierIds?: string[];
  backendFallbackTicks?: number;
};

type ReplayInput = {
  atTick: number;
  playerId: string;
  frame: { keys: number; aimX: number; aimY: number };
};

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: bun server/tools/replay-hash-wasm.ts <replay.jjr> [--every N] [--max-ticks N]");
    return 2;
  }
  const path = args[0]!;
  let every = 60;
  let maxTicks = 0;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--every") every = Number(args[++i]) || 60;
    else if (args[i] === "--max-ticks") maxTicks = Number(args[++i]) || 0;
    else {
      console.error(`unknown argument: ${args[i]}`);
      return 2;
    }
  }

  const decoded = msgpackDecode(readFileSync(path)) as {
    header: ReplayHeader;
    inputs: ReplayInput[];
  };
  const header = decoded.header;
  if (header.formatVersion !== 1) {
    console.error(`unsupported formatVersion ${header.formatVersion}`);
    return 1;
  }
  if ((header.backendFallbackTicks ?? 0) > 0) {
    console.error(
      `${path}: ${header.backendFallbackTicks} backend-fallback tick(s) — not a passport fixture`,
    );
    return 1;
  }

  const map = resolveMap(header.mapId as Parameters<typeof resolveMap>[0]);
  const spawns: PlayerSpawnInfo[] = header.players.map((p) => ({
    playerId: PlayerId(p.playerId),
    characterId: p.characterId as PlayerSpawnInfo["characterId"],
    weaponId: p.weaponId as PlayerSpawnInfo["weaponId"],
    name: p.name,
    color: p.color,
  }));
  const state = World.create(map, spawns, header.rngSeed, header.chaosModifierIds ?? []);
  const init = packWorldState(state);
  const order = packedPlayerOrder(state.players);

  // loadServerSim already allocates the state buffer and installs the trig
  // LUT — the same loader the live host uses, so this harness cannot drift
  // from production setup.
  const sim = await loadServerSim();
  if (!sim) {
    console.error("sim.wasm failed to load — run 'bun run sim:build'");
    return 1;
  }
  const ex = sim.ex as unknown as {
    memory: WebAssembly.Memory;
    step_world: (ptr: number, dt: number) => number;
  };
  const statePtr = sim.statePtr;
  if (sim.stateLen < WORLD_STATE_TOTAL_SIZE) {
    console.error(`wasm state buffer ${sim.stateLen}B < WorldState ${WORLD_STATE_TOTAL_SIZE}B`);
    return 1;
  }
  new Uint8Array(ex.memory.buffer).set(init, statePtr);

  const playersStart = statePtr + HEADER_SIZE + 8;
  const lastKeys = new Map<string, number>();
  const total = maxTicks > 0 ? maxTicks : header.totalTicks;

  // Inputs are appended in server-tick order, so a forward cursor suffices.
  let cursor = 0;
  let applied = 0;
  const lines: string[] = [];
  let finalHash = 0;

  for (let tick = 1; tick <= total; tick++) {
    const view = new DataView(ex.memory.buffer);
    // Every tick clears all keys, exactly as packWorldState does on the live
    // path before the host patches the subset that has frames.
    for (let s = 0; s < order.length; s++) {
      const off = playersStart + s * PLAYER_ENTITY_SIZE;
      view.setUint32(off + CURR_OFF, 0, true);
      view.setUint32(off + PREV_OFF, 0, true);
    }
    while (cursor < decoded.inputs.length && decoded.inputs[cursor]!.atTick < tick) cursor++;
    while (cursor < decoded.inputs.length && decoded.inputs[cursor]!.atTick === tick) {
      const entry = decoded.inputs[cursor]!;
      const slot = order.indexOf(entry.playerId);
      if (slot >= 0) {
        const off = playersStart + slot * PLAYER_ENTITY_SIZE;
        view.setFloat64(off + AIMX_OFF, entry.frame.aimX, true);
        view.setFloat64(off + AIMY_OFF, entry.frame.aimY, true);
        view.setUint32(off + CURR_OFF, entry.frame.keys >>> 0, true);
        view.setUint32(off + PREV_OFF, lastKeys.get(entry.playerId) ?? 0, true);
        lastKeys.set(entry.playerId, entry.frame.keys >>> 0);
        applied++;
      }
      cursor++;
    }

    const rc = ex.step_world(statePtr, 1000 / 60);
    if (rc !== 0) {
      console.error(`step_world returned ${rc} at tick ${tick}`);
      break;
    }

    if (tick % every === 0 || tick === total) {
      const bytes = new Uint8Array(ex.memory.buffer, statePtr, WORLD_STATE_TOTAL_SIZE);
      const h = hashBytes(bytes);
      lines.push(`${tick}\t${h.toString(16).padStart(8, "0")}`);
    }
  }
  finalHash = hashBytes(
    new Uint8Array(ex.memory.buffer, statePtr, WORLD_STATE_TOTAL_SIZE),
  );

  console.log(
    `# ${path}\tmap=${header.mapId}\tseed=${header.rngSeed}\tticks=${total}\tinputs_applied=${applied}`,
  );
  for (const l of lines) console.log(l);
  console.log(`final\t${finalHash.toString(16).padStart(8, "0")}`);
  return 0;
}

process.exit(await main());
