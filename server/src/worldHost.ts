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
import {
  MatchHost,
  type MatchSocketData,
} from "./matchHost.ts";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";
import { DEFAULT_MAP_ID, isMapId, type MapId } from "@sim/data/maps.ts";
import { convexClient, type ConvexId } from "./convexClient.ts";

const WORLD_MATCH_ID = "world";

/**
 * Map rotation pool. Two intentions:
 *   1. Once round-rotation lands (DEFER), the host steps through this list at
 *      round boundaries. For now `nextMapId()` always returns the head; flipping
 *      the constructor option `rotateMaps: true` enables round-rotation.
 *   2. Tested in __tests__/worldHost.test.ts to guard against a regression where
 *      a typo in `MapId` literal silently falls back to `DEFAULT_MAP_ID`.
 */
// Lead with boxworks-mini so the always-on world starts on the user's
// preferred default. The full-size "boxworks" arena is excluded from
// rotation — it's available only for explicit room hosts that pick it.
const ROTATION_MAPS: readonly MapId[] = ["boxworks-mini", "boxworks-tower"];

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
  private readonly rotateMaps: boolean;
  /** Index into ROTATION_MAPS used by `nextMapId`. Reset alongside host
   *  rebuild when the existing host is torn down for any reason. */
  private rotationCursor = 0;

  constructor(opts: { mapId?: MapId | string; rotateMaps?: boolean } = {}) {
    // Validate the constructor mapId at the boundary so a typo is loud,
    // not silent. Prior code passed the raw mapId straight into MatchHost,
    // which then `resolveMap()`d back to DEFAULT_MAP_ID on miss — producing a
    // running but wrong-arena world. Now we throw at boot.
    if (opts.mapId !== undefined && !isMapId(opts.mapId)) {
      throw new Error(
        `WorldHost: unknown mapId "${opts.mapId}". Known: ${Object.keys({ boxworks: 1, "boxworks-mini": 1, "boxworks-tower": 1 }).join(", ")}`,
      );
    }
    this.mapId = (opts.mapId as MapId | undefined) ?? DEFAULT_MAP_ID;
    this.rotateMaps = opts.rotateMaps ?? false;
  }

  /**
   * Hand a fresh socket to the singleton host. Lazily boots the host
   * on first connect using the new player as the seed spawn (MatchHost
   * requires at least one PlayerSpawnInfo at construction).
   *
   * Race safety: JS is single-threaded so concurrent attach calls cannot
   * race the `if (!this.host)` check, BUT `MatchHost`'s constructor is
   * synchronous in current code — if it ever becomes async (e.g. if it
   * starts awaiting a Convex lookup for chaosModifiers), this would need
   * to gate with a Promise<MatchHost> sentinel. Comment so we remember.
   */
  attach(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (!this.host) {
      const spawn = this.spawnFor(ws.data.playerId);
      // WorldHost doesn't have a room to read chaos modifiers from, so we fall back
      // to the no-chaos baseline. Future workitem: add a lightweight Convex world token
      // endpoint that exposes a default/modifiable chaos set for the always-on world.
      this.host = new MatchHost(WORLD_MATCH_ID, [spawn], [], this.nextMapId());
    } else if (!this.host.hasPlayer(playerId)) {
      this.host.addPlayer(this.spawnFor(ws.data.playerId));
    }
    this.host.attachClient(ws);
  }

  /**
   * Return the next mapId for a host construction. Rotation is opt-in via
   * `rotateMaps: true` in the constructor options; without it, every call
   * returns `this.mapId`. Wired here so a future "rotate at round-end"
   * feature can call this without further plumbing.
   */
  private nextMapId(): MapId {
    if (!this.rotateMaps) return this.mapId;
    const id = ROTATION_MAPS[this.rotationCursor % ROTATION_MAPS.length]!;
    this.rotationCursor += 1;
    return id;
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

// Construction is now done in server/src/index.ts at boot time and the
// instance is passed explicitly to the WS handler closure. Removing the
// module-level singleton makes the host testable, swappable, and
// guarantees `index.ts` controls lifecycle ordering.
