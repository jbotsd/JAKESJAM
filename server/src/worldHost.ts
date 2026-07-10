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
import { WorldBots } from "./worldBots.ts";
import { STEP_MS } from "@sim/index.ts";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";
import { DEFAULT_MAP_ID, isMapId, resolveMap, type MapId } from "@sim/data/maps.ts";
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
// Hot Lobby rotation: mega Vessel Nexus first, then vertical Spire Dock.
// Full multi-cell "boxworks" stays room-picker only.
const ROTATION_MAPS: readonly MapId[] = ["vessel-nexus", "boxworks-tower"];

/**
 * How many recycles between curated-map appearances. Slots that aren't
 * curated roll a seeded procgen arena ("gen:<seed>") — the seed rides in
 * the mapId, so clients expand the identical map deterministically. See
 * docs/map-design.md + client/src/sim/data/mapGen.ts (validator-gated).
 */
const GEN_SLOTS_PER_CURATED = 2;

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
  /** Live sockets by player — maintained across host recycles so a
   *  completed match can migrate everyone into the replacement host. */
  private readonly sockets = new Map<PlayerId, ServerWebSocket<MatchSocketData>>();
  /** Pending recycle timer (results-display hold). */
  private recycleTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long the final scoreboard stays up before the world rolls a new
   *  match. Overridable for tests. */
  private readonly resultsHoldMs: number;
  /** Server-side AI duelists that keep the world alive. Count via the
   *  WORLD_BOTS env (host-public.sh default 2 — enough motion, not a gang). */
  private readonly botCount: number;
  private readonly bots = new WorldBots();
  private botTimer: ReturnType<typeof setInterval> | null = null;
  /** Index into ROTATION_MAPS used by `nextMapId`. Reset alongside host
   *  rebuild when the existing host is torn down for any reason. */
  private rotationCursor = 0;

  constructor(opts: { mapId?: MapId | string; rotateMaps?: boolean; resultsHoldMs?: number; bots?: number } = {}) {
    this.resultsHoldMs = opts.resultsHoldMs ?? 6000;
    // Cap 6 — 4+ on mega docks felt like a firing squad for solo humans.
    this.botCount = Math.max(0, Math.min(6, opts.bots ?? 0));
    if (this.botCount > 0) {
      // Bot brains tick at sim rate; think() no-ops while the host loop
      // is stopped (empty world), so idle cost is a timer wakeup.
      this.botTimer = setInterval(() => {
        if (this.host) this.bots.think(this.host, Date.now());
      }, STEP_MS);
    }
    // Validate the constructor mapId at the boundary so a typo is loud,
    // not silent. Prior code passed the raw mapId straight into MatchHost,
    // which then `resolveMap()`d back to DEFAULT_MAP_ID on miss — producing a
    // running but wrong-arena world. Now we throw at boot.
    if (opts.mapId !== undefined && !isMapId(opts.mapId) && !opts.mapId.startsWith("gen:")) {
      throw new Error(
        `WorldHost: unknown mapId "${opts.mapId}". Known: vessel-nexus, boxworks, boxworks-mini, boxworks-tower, gen:<seed>`,
      );
    }
    this.mapId = (opts.mapId as MapId | undefined) ?? DEFAULT_MAP_ID;
    this.rotateMaps = opts.rotateMaps ?? false;
    // Eager-boot when bots are configured: the always-on world should be
    // live (rounds advancing, drafting cycling) before the first human opens
    // the share link — otherwise /health shows world=null and visitors land
    // in a frozen arena.
    if (this.botCount > 0) {
      const botSpawns = this.bots
        .spawnInfosFor(this.botCount)
        .map((b) => this.botSpawn(b.playerId, b.name));
      this.host = this.buildHost(botSpawns);
      this.host.ensureTickLoop();
    }
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
    this.sockets.set(playerId, ws);
    if (!this.host) {
      const spawn = this.spawnFor(ws.data.playerId);
      // WorldHost doesn't have a room to read chaos modifiers from, so we fall back
      // to the no-chaos baseline. Future workitem: add a lightweight Convex world token
      // endpoint that exposes a default/modifiable chaos set for the always-on world.
      this.host = this.buildHost([spawn]);
    } else if (!this.host.hasPlayer(playerId)) {
      this.host.addPlayer(this.spawnFor(ws.data.playerId));
    }
    this.host.attachClient(ws);
  }

  private buildHost(spawns: PlayerSpawnInfo[]): MatchHost {
    // Bots ride along in every host build (including recycles).
    const botSpawns = this.bots
      .spawnInfosFor(this.botCount)
      .filter((b) => !spawns.some((sp) => sp.playerId === b.playerId))
      .map((b) => this.botSpawn(b.playerId, b.name));
    const mapId = this.nextMapId();
    // Map-aware brains: cover / hop / LOS for the arena they're actually on.
    this.bots.bindMap(resolveMap(mapId));
    return new MatchHost(WORLD_MATCH_ID, [...spawns, ...botSpawns], [], mapId, {
      onMatchComplete: () => this.scheduleRecycle(),
    });
  }

  private botSpawn(playerId: PlayerId, name: string): PlayerSpawnInfo {
    return {
      playerId,
      characterId: "balanced",
      name: `BOT · ${name}`,
      // Amber — the client also colors bot rigs by the bot_ id prefix, but
      // the roster color keeps room-mode consistent too.
      color: "#ffb454",
      weaponId: "starter-pistol",
    };
  }

  /**
   * A match just completed (someone reached the target score). The round
   * machine deliberately parks in round-over so the results UI can show —
   * in room mode the registry tears the host down, but the always-on world
   * must ROLL ON. After a short scoreboard hold, rebuild the host on the
   * next rotation map and migrate every live socket into it. Without this
   * the world stays parked in round-over forever (observed live 2026-07-03).
   */
  private scheduleRecycle(): void {
    if (this.recycleTimer) return;
    this.recycleTimer = setTimeout(() => {
      this.recycleTimer = null;
      this.recycle();
    }, this.resultsHoldMs);
  }

  private recycle(): void {
    const old = this.host;
    if (!old) return;
    // Drop sockets that closed while the scoreboard was up.
    for (const [pid, ws] of this.sockets) {
      if (ws.readyState !== 1) this.sockets.delete(pid);
    }
    if (this.sockets.size === 0) {
      // Nobody connected — tear down and lazy-boot on the next attach.
      old.dispose();
      this.host = null;
      console.log("[worldHost] match complete with no players — world reset (lazy reboot)");
      return;
    }
    const spawns = [...this.sockets.keys()].map((pid) => this.spawnFor(pid));
    this.host = this.buildHost(spawns);
    old.dispose();
    for (const ws of this.sockets.values()) {
      // attachClient sends a fresh ServerHello (new map + startTick); the
      // client re-renders the arena and resyncs off the first full snapshot.
      this.host.attachClient(ws);
    }
    console.log(
      `[worldHost] recycled world after match completion — map=${this.host.summary().mapId} players=${this.sockets.size}`,
    );
  }

  /**
   * Return the next mapId for a host construction. Rotation is opt-in via
   * `rotateMaps: true` in the constructor options; without it, every call
   * returns `this.mapId`. Wired here so a future "rotate at round-end"
   * feature can call this without further plumbing.
   */
  private nextMapId(): MapId | string {
    if (!this.rotateMaps) return this.mapId;
    const slot = this.rotationCursor;
    this.rotationCursor += 1;
    // Pattern with GEN_SLOTS_PER_CURATED=2: curated, gen, gen, curated, …
    // Curated slots walk ROTATION_MAPS; gen slots roll a fresh seed.
    // Seed choice is SERVER-side only (transmitted via mapId), so wall
    // clock is fine here — expansion from the seed is what must be pure.
    if (slot % (GEN_SLOTS_PER_CURATED + 1) === 0) {
      const idx = Math.floor(slot / (GEN_SLOTS_PER_CURATED + 1));
      return ROTATION_MAPS[idx % ROTATION_MAPS.length]!;
    }
    return `gen:${Math.floor(Date.now() / 1000) % 1_000_000}`;
  }

  route(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    if (!this.host) {
      ws.close(1011, "no world");
      return;
    }
    this.host.routeMessage(ws, raw);
  }

  detach(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (this.sockets.get(playerId) === ws) this.sockets.delete(playerId);
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
