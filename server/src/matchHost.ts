// One MatchHost per active match. Owns the World, the tick loop, and the set
// of connected client WebSockets. Inputs flow in via routeMessage; snapshots
// flow out via the broadcast loop.

import type { ServerWebSocket } from "bun";
import { SNAPSHOT_INTERVAL_TICKS, STEP_MS, World } from "@sim/index.ts";
import { createRuntime, stepWithRuntime, type WorldRuntime } from "@sim/World.ts";
import type {
  InputFrame,
  InputSeq,
  MapDefinition,
  PlayerId,
  PlayerSpawnInfo,
  WorldState,
} from "@sim/types.ts";
import { convexClient, type ConvexId } from "./convexClient.ts";
import {
  decodeMessage,
  encodeMessage,
  type ClientMessage,
  type PlayerLobbyInfo,
} from "./protocol.ts";

export type MatchSocketData = {
  matchId: string;
  playerId: string;
  authedAt: number;
};

// Minimal Boxworks scaffold so the server has terrain to collide against until
// the full map definition is shared between client and server (next iteration).
// Placeholder floor + a couple of platforms so jumps and projectile blocks work.
const PLACEHOLDER_MAP: MapDefinition = {
  id: "boxworks",
  name: "Boxworks",
  size: { x: 4800, y: 1620 },
  spawns: [
    { x: 240, y: 540 },
    { x: 4560, y: 540 },
  ],
  platforms: [
    { id: "floor", position: { x: 2400, y: 1580 }, size: { x: 4800, y: 80 }, kind: "floor" },
    { id: "wall-l", position: { x: 20, y: 810 }, size: { x: 40, y: 1620 }, kind: "wall" },
    { id: "wall-r", position: { x: 4780, y: 810 }, size: { x: 40, y: 1620 }, kind: "wall" },
    { id: "plat-1", position: { x: 1200, y: 1200 }, size: { x: 320, y: 30 }, kind: "platform" },
    { id: "plat-2", position: { x: 2400, y: 1000 }, size: { x: 320, y: 30 }, kind: "platform" },
    { id: "plat-3", position: { x: 3600, y: 1200 }, size: { x: 320, y: 30 }, kind: "platform" },
  ],
};

export class MatchHost {
  readonly matchId: string;
  private state: WorldState;
  private readonly runtime: WorldRuntime;
  private readonly clients = new Map<PlayerId, ServerWebSocket<MatchSocketData>>();
  private readonly playerInfo = new Map<PlayerId, PlayerLobbyInfo>();
  private readonly pendingInputs = new Map<PlayerId, InputFrame>();
  private readonly lastProcessedInputSeq = new Map<PlayerId, InputSeq>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly rngSeed: number;
  private startedAt = 0;
  /** Set true the first time a `matchComplete` post to Convex is *initiated*.
   *  Prevents duplicate writes (in addition to the idempotent server-side
   *  mutation). One flag per host == one write per match lifetime. */
  private matchCompletePosted = false;

  constructor(matchId: string, players: PlayerSpawnInfo[]) {
    this.matchId = matchId;
    this.rngSeed = (Math.random() * 0xffffffff) >>> 0;
    this.state = World.create(PLACEHOLDER_MAP, players, this.rngSeed);
    this.runtime = createRuntime(PLACEHOLDER_MAP);
    for (const spawn of players) {
      this.playerInfo.set(spawn.playerId, {
        playerId: spawn.playerId,
        characterId: spawn.characterId,
        color: spawn.color ?? "#ffffff",
        name: spawn.name ?? spawn.playerId,
      });
      this.lastProcessedInputSeq.set(spawn.playerId, 0);
    }
  }

  attachClient(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = ws.data.playerId;
    const previous = this.clients.get(playerId);
    if (previous && previous !== ws) {
      previous.close(1000, "replaced");
    }
    this.clients.set(playerId, ws);
    this.sendHello(ws);
    this.maybeStartLoop();
  }

  detachClient(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = ws.data.playerId;
    if (this.clients.get(playerId) === ws) {
      this.clients.delete(playerId);
    }
    if (this.clients.size === 0) {
      this.stop();
    }
  }

  hasClients(): boolean {
    return this.clients.size > 0;
  }

  hasPlayer(playerId: PlayerId): boolean {
    return this.playerInfo.has(playerId);
  }

  /**
   * Insert a new player into the world mid-match. Used when a second client
   * connects to a match that was created with only the first player.
   * Spawns them at one of the map's spawn points.
   */
  addPlayer(spawn: PlayerSpawnInfo): void {
    if (this.playerInfo.has(spawn.playerId)) return;
    this.playerInfo.set(spawn.playerId, {
      playerId: spawn.playerId,
      characterId: spawn.characterId,
      color: spawn.color ?? "#ffffff",
      name: spawn.name ?? spawn.playerId,
    });
    this.lastProcessedInputSeq.set(spawn.playerId, 0);

    const existingCount = Object.keys(this.state.players).length;
    const spawnPoint =
      PLACEHOLDER_MAP.spawns[existingCount % Math.max(1, PLACEHOLDER_MAP.spawns.length)] ??
      { x: 0, y: 0 };
    this.state = {
      ...this.state,
      players: {
        ...this.state.players,
        [spawn.playerId]: {
          id: spawn.playerId,
          characterId: spawn.characterId,
          x: spawnPoint.x,
          y: spawnPoint.y,
          vx: 0,
          vy: 0,
          aimX: spawnPoint.x + 160,
          aimY: spawnPoint.y,
          health: 100,
          shieldActive: false,
          crouching: false,
          alive: true,
          weaponId: spawn.weaponId,
          cards: [],
          fireCooldownMs: 0,
          ammo: 0,
          abilityCharge: 0,
          lastProcessedInputSeq: 0,
        },
      },
      round: {
        ...this.state.round,
        scores: {
          ...this.state.round.scores,
          [spawn.playerId]: 0,
        },
      },
    };
  }

  routeMessage(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    const decoded = decodeMessage<ClientMessage>(
      raw instanceof Buffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : raw,
    );
    if (!decoded) return;
    const { message } = decoded;
    switch (message.t) {
      case "in":
        this.applyInput(ws.data.playerId, message);
        break;
      case "ack":
        // TODO(deltaCodec): drop snapshots in the per-client baseline ring up
        // through message.lastSnapshotTick. Until delta encoding is in we
        // simply trust last-seen and move on.
        break;
      case "ping":
        ws.send(
          encodeMessage({
            t: "pong",
            clientTime: message.clientTime,
            serverTime: this.now(),
          }),
        );
        break;
      case "hello":
        // Hello is implicit on connect; ignore extras.
        break;
    }
  }

  private applyInput(playerId: PlayerId, input: import("./protocol.ts").Input): void {
    const last = this.lastProcessedInputSeq.get(playerId) ?? 0;
    if (input.seq <= last) return; // out-of-order or duplicate
    this.pendingInputs.set(playerId, {
      seq: input.seq,
      tick: input.tick,
      keys: input.keys,
      aimX: input.aimX,
      aimY: input.aimY,
      dtMs: input.dt,
    });
  }

  private maybeStartLoop(): void {
    if (this.interval) return;
    this.startedAt = this.now();
    this.interval = setInterval(() => this.tick(), STEP_MS);
  }

  private stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  private tick(): void {
    const inputsByPlayer: Record<PlayerId, InputFrame | null> = {};
    for (const playerId of this.clients.keys()) {
      const input = this.pendingInputs.get(playerId) ?? null;
      inputsByPlayer[playerId] = input;
      if (input) this.lastProcessedInputSeq.set(playerId, input.seq);
    }
    this.pendingInputs.clear();

    const result = stepWithRuntime(this.state, this.runtime, inputsByPlayer, STEP_MS);
    this.state = result.state;

    if (result.matchComplete && !this.matchCompletePosted) {
      this.matchCompletePosted = true;
      // Fire-and-forget: never block the tick loop on a Convex round-trip.
      // The mutation itself is idempotent and the per-host flag above is the
      // throttle (one write per match per server process).
      void this.postMatchResult();
    }

    if (this.state.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.broadcastSnapshot(result.events);
    }
  }

  /**
   * Resolve the match's roomId via Convex, compute winner + scores from the
   * current world state, and call `recordMatchResult`. Errors are swallowed
   * (logged in convexClient) so a Convex outage never crashes the sim.
   */
  private async postMatchResult(): Promise<void> {
    try {
      const matchId = this.matchId as ConvexId;
      const summary = await convexClient.getMatchSummary(matchId);
      if (!summary) {
        console.warn(
          `[matchHost ${this.matchId}] cannot post result — match summary unavailable (Convex unreachable or match deleted).`,
        );
        return;
      }
      const scores = this.state.round.scores;
      const finalScores: Record<string, number> = { ...scores };
      const winnerPlayerId = pickWinner(scores);
      const roundsPlayed = this.state.round.roundIndex + 1;
      await convexClient.recordMatchResult({
        matchId,
        roomId: summary.roomId,
        winnerPlayerId,
        finalScores,
        roundsPlayed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[matchHost ${this.matchId}] postMatchResult crashed: ${message}`,
      );
    }
  }

  private broadcastSnapshot(events: import("@sim/types.ts").SimEvent[]): void {
    const lastProcessed: Record<string, InputSeq> = {};
    for (const [pid, seq] of this.lastProcessedInputSeq) lastProcessed[pid] = seq;

    const payload = encodeMessage({
      t: "snap",
      tick: this.state.tick,
      lastProcessedInputSeq: lastProcessed,
      baseline: null,
      state: this.state,
      events,
    });
    for (const ws of this.clients.values()) {
      ws.send(payload);
    }
  }

  private sendHello(ws: ServerWebSocket<MatchSocketData>): void {
    ws.send(
      encodeMessage({
        t: "hello",
        matchId: this.matchId,
        startTick: this.state.tick,
        rngSeed: this.rngSeed,
        mapId: PLACEHOLDER_MAP.id,
        yourPlayerId: ws.data.playerId,
        allPlayers: Array.from(this.playerInfo.values()),
      }),
    );
  }

  private now(): number {
    return Date.now() - this.startedAt;
  }
}

/**
 * Pick the highest-scoring player. Returns null on a tie (or empty scores) —
 * the schema treats null as a draw and recordMatchResult coerces it to "".
 * Iteration is in sorted-id order to keep ties deterministic.
 */
function pickWinner(scores: Record<PlayerId, number>): PlayerId | null {
  const ids = Object.keys(scores).sort();
  let bestId: PlayerId | null = null;
  let bestScore = -Infinity;
  let tied = false;
  for (const id of ids) {
    const score = scores[id]!;
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  if (bestId === null || tied) return null;
  return bestId;
}
