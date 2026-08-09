// Dump a replay's INITIAL packed WorldState — gospel N0.3's unblock.
//
// The port passport compares native vs wasm hashes over one input stream.
// It does not care who BUILT the starting world, so it does not have to
// wait for native world-init (N0.5) or for named-map data to reach the core
// (N-MAP's remainder), which between them block 5 of the 10 archived
// replays.
//
// TS already packs a full WorldState for the wasm path
// (worldStateBridge.packWorldState). This writes that same buffer beside
// the replay, so `jjsim` can load it and step from there.
//
//   bun server/tools/dump-replay-init.ts server/.replays/world-*.jjr
//
// Lives under server/ deliberately: @msgpack/msgpack is a server dependency
// and Bun resolves node_modules from the FILE's directory upward, not from
// cwd — a copy in the repo-root tools/ cannot see it.
//
// Output: <replay>.init.bin  (WORLD_STATE_TOTAL_SIZE bytes, little-endian,
// exactly what serverWasmHost.step would have received at tick 0) and
// <replay>.init.json (the header fields, for eyeballing).

import { decode as msgpackDecode } from "@msgpack/msgpack";
import { readFileSync, writeFileSync } from "node:fs";
import { World } from "@sim/World.ts";
import { packWorldState, WORLD_STATE_TOTAL_SIZE } from "@sim/wasm/worldStateBridge.ts";
import { resolveMap } from "@sim/data/maps.ts";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";

type ReplayHeader = {
  formatVersion: number;
  protocolVersion: number;
  matchId: string;
  mapId: string;
  rngSeed: number;
  players: Array<{
    playerId: string;
    characterId: string;
    name: string;
    color: string;
    weaponId: string;
  }>;
  chaosModifierIds?: string[];
  simBackend?: "wasm" | "ts";
  backendFallbackTicks?: number;
};

function loadHeader(path: string): ReplayHeader {
  const bytes = readFileSync(path);
  const decoded = msgpackDecode(bytes) as { header: ReplayHeader };
  if (!decoded?.header) throw new Error(`${path}: no header`);
  return decoded.header;
}

function main(): number {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("usage: bun tools/dump-replay-init.ts <replay.jjr>...");
    return 2;
  }

  let failed = 0;
  for (const path of paths) {
    try {
      const header = loadHeader(path);
      if (header.formatVersion !== 1) {
        throw new Error(`unsupported formatVersion ${header.formatVersion}`);
      }
      // A replay recorded across a mid-match backend switch is not
      // bit-reproducible by either backend alone — refuse it as a fixture
      // rather than let it produce a divergence that isn't real.
      if ((header.backendFallbackTicks ?? 0) > 0) {
        throw new Error(
          `recorded ${header.backendFallbackTicks} backend-fallback tick(s) — not a passport fixture`,
        );
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
      const packed = packWorldState(state);
      if (packed.byteLength !== WORLD_STATE_TOTAL_SIZE) {
        throw new Error(
          `packed ${packed.byteLength} bytes, expected ${WORLD_STATE_TOTAL_SIZE}`,
        );
      }

      writeFileSync(`${path}.init.bin`, packed);
      writeFileSync(
        `${path}.init.json`,
        JSON.stringify(
          {
            mapId: header.mapId,
            rngSeed: header.rngSeed,
            players: header.players.map((p) => p.playerId),
            chaosModifierIds: header.chaosModifierIds ?? [],
            simBackend: header.simBackend ?? "unknown",
            packedBytes: packed.byteLength,
            tick: state.tick,
            staticCount: map.platforms?.length ?? 0,
          },
          null,
          2,
        ),
      );
      console.log(
        `${path}\tOK\tmap=${header.mapId}\tseed=${header.rngSeed}\tplayers=${header.players.length}\tbytes=${packed.byteLength}`,
      );
    } catch (err) {
      failed += 1;
      console.log(`${path}\tFAIL\t${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return failed === 0 ? 0 : 1;
}

process.exit(main());
