// WorldHost — process-wide singleton MatchHost for io-style always-on play.
//
// One MatchHost serves every `/ws/world` connection. Players drift in
// and out continuously; the round timer keeps rolling regardless of
// who's connected. Reuses the existing MatchHost class wholesale —
// only the lifecycle differs (singleton vs per-room map).
//
// Why a thin wrapper instead of patching MatchHost itself:
//   - Keeps the room-flow path unmodified during the io rollout.
//   - Lets the architecture-deepening agent (parallel work) land its
//     MatchHost partition cleanly — we don't reach inside MatchHost,
//     just hold one instance of it.

import type { ServerWebSocket } from "bun";
import { MatchHost, type MatchSocketData } from "./matchHost.ts";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";
import { DEFAULT_MAP_ID, type MapId } from "@sim/data/maps.ts";

const WORLD_MATCH_ID = "world";

const WORLD_COLOR_PALETTE = [
  "#88ccff",
  "#ff88aa",
  "#ffd166",
  "#9bf6ff",
  "#a0e7a0",
  "#caa7ff",
  "#ff9f6b",
  "#ffe39b",
  "#9affd1",
  "#ff7676",
] as const;

function pickColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return WORLD_COLOR_PALETTE[hash % WORLD_COLOR_PALETTE.length]!;
}

export class WorldHost {
  /**
   * The singleton MatchHost instance. Lazily constructed on first
   * `attach()` so the bun server can boot before anyone connects.
   */
  private host: MatchHost | null = null;
  private readonly mapId: MapId;

  constructor(opts: { mapId?: MapId } = {}) {
    this.mapId = opts.mapId ?? DEFAULT_MAP_ID;
  }

  /**
   * Hand a fresh socket to the singleton host. Lazily boots the host
   * on first connect using the new player as the seed spawn (MatchHost
   * requires at least one PlayerSpawnInfo at construction).
   */
  attach(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (!this.host) {
      const spawn = this.spawnFor(ws.data.playerId);
      this.host = new MatchHost(WORLD_MATCH_ID, [spawn], [], this.mapId);
    } else if (!this.host.hasPlayer(playerId)) {
      this.host.addPlayer(this.spawnFor(ws.data.playerId));
    }
    this.host.attachClient(ws);
  }

  route(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    if (!this.host) {
      ws.close(1011, "no world");
      return;
    }
    this.host.routeMessage(ws, raw);
  }

  detach(ws: ServerWebSocket<MatchSocketData>): void {
    if (!this.host) return;
    this.host.detachClient(ws);
    // Note: unlike MatchRegistry, we deliberately do NOT tear down the
    // host when client count hits zero. The world is always-on; an empty
    // room is still a room. Rounds keep rolling against whatever players
    // are present (or none, in which case stepWithRuntime sees an empty
    // players record and the round timer drifts toward time-out → null
    // winner → next round). When a player rejoins the existing host
    // welcomes them.
  }

  /** Diagnostic — reflected in /health. */
  size(): number {
    return this.host ? 1 : 0;
  }

  /**
   * Public summary surfaced through HTTP /health. `null` when the
   * world hasn't booted yet (no players have ever connected). The
   * client status badge polls this every few seconds.
   */
  summary(): ReturnType<MatchHost["summary"]> | null {
    return this.host ? this.host.summary() : null;
  }

  private spawnFor(playerIdRaw: string): PlayerSpawnInfo {
    return {
      playerId: PlayerId(playerIdRaw),
      characterId: "balanced",
      name: playerIdRaw,
      color: pickColor(playerIdRaw),
      weaponId: "starter-pistol",
    };
  }
}

/** Module-level singleton — there's exactly one world per server process. */
export const worldHost = new WorldHost();
