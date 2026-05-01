// One MatchHost per active match. Owns the World, the tick loop, and the set
// of connected client WebSockets. Inputs flow in via routeMessage; snapshots
// flow out via the broadcast loop.

import type { ServerWebSocket } from "bun";
import { SNAPSHOT_INTERVAL_TICKS, STEP_MS, World } from "@sim/index.ts";
import { createRuntime, stepWithRuntime, type WorldRuntime } from "@sim/World.ts";
import { boxworksWorld } from "@sim/data/boxworks.ts";
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

// Boxworks is built once in `@sim/data/boxworks.ts` and shared verbatim with
// the client so authoritative collision matches client prediction. The cast
// strips Boxworks's wider pickup-kind union back down to the baseline sim
// type — `World.create` only copies `pickup.kind` through, so any string is
// safe at runtime.
const BOXWORKS_MAP: MapDefinition = boxworksWorld as MapDefinition;

/**
 * How long to keep a disconnected player's entity alive in the world while we
 * wait for them to reconnect. After this window expires the entity, score
 * entry, and bookkeeping are all evicted.
 */
export const RECONNECT_GRACE_MS = 10_000;

export class MatchHost {
  readonly matchId: string;
  private state: WorldState;
  private readonly runtime: WorldRuntime;
  private readonly clients = new Map<PlayerId, ServerWebSocket<MatchSocketData>>();
  private readonly playerInfo = new Map<PlayerId, PlayerLobbyInfo>();
  private readonly pendingInputs = new Map<PlayerId, InputFrame>();
  private readonly lastProcessedInputSeq = new Map<PlayerId, InputSeq>();
  /**
   * Wall-clock ms (Date.now) at which each known player's connection dropped.
   * Entries are added on `detachClient`, cleared on a successful re-attach.
   * The tick loop evicts entries older than RECONNECT_GRACE_MS.
   */
  private readonly disconnectedAt = new Map<PlayerId, number>();
  /** Last wall-clock time we received an input from a given player. */
  private readonly lastSeenAt = new Map<PlayerId, number>();
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
    this.state = World.create(BOXWORKS_MAP, players, this.rngSeed);
    this.runtime = createRuntime(BOXWORKS_MAP);
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
    // Reconnect path: clear any pending grace-window timer so the eviction
    // tick won't drop their entity, and refresh their last-seen.
    if (this.disconnectedAt.has(playerId)) {
      this.disconnectedAt.delete(playerId);
      console.log(
        `[matchHost ${this.matchId}] player ${playerId} reconnected within grace window`,
      );
    }
    this.lastSeenAt.set(playerId, Date.now());
    this.sendHello(ws);
    this.maybeStartLoop();
  }

  detachClient(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = ws.data.playerId;
    if (this.clients.get(playerId) === ws) {
      this.clients.delete(playerId);
      // We deliberately keep the player's entity, score, input-seq state, and
      // playerInfo entry intact so a quick reconnect can resume seamlessly.
      // The grace-window check in `tick` ultimately evicts them if they
      // don't come back within RECONNECT_GRACE_MS.
      if (this.playerInfo.has(playerId)) {
        this.disconnectedAt.set(playerId, Date.now());
      }
    }
    // NOTE: previously this stopped the loop when clients hit zero. We now
    // keep the loop running while there are pending grace windows so the
    // eviction sweep can fire. Once all disconnects have expired (or there
    // are no players left at all) `tick` itself calls `stop()`, and the
    // registry tears the host down via hasClients()+hasPendingDisconnects().
    if (this.clients.size === 0 && this.disconnectedAt.size === 0) {
      this.stop();
    }
  }

  hasClients(): boolean {
    return this.clients.size > 0;
  }

  /** True while at least one player is in their reconnect grace window. */
  hasPendingDisconnects(): boolean {
    return this.disconnectedAt.size > 0;
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
      BOXWORKS_MAP.spawns[existingCount % Math.max(1, BOXWORKS_MAP.spawns.length)] ??
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
    // Refresh liveness regardless — even a duplicate seq proves the client is
    // alive on the wire.
    this.lastSeenAt.set(playerId, Date.now());
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

  /**
   * Walk the disconnect map and evict any player whose grace window has
   * elapsed. Removes them from `state.players` (so the sim no longer renders
   * them), drops their score entry, and clears all bookkeeping. Called once
   * per tick from the top of `tick()`.
   */
  private evictExpiredDisconnects(): void {
    if (this.disconnectedAt.size === 0) {
      // Nothing to do; also use this opportunity to wind down a host that
      // has no live clients and no pending grace timers.
      if (this.clients.size === 0) this.stop();
      return;
    }
    const now = Date.now();
    let evicted = false;
    for (const [playerId, disconnectedAt] of this.disconnectedAt) {
      if (now - disconnectedAt <= RECONNECT_GRACE_MS) continue;
      this.disconnectedAt.delete(playerId);
      this.playerInfo.delete(playerId);
      this.lastProcessedInputSeq.delete(playerId);
      this.lastSeenAt.delete(playerId);
      this.pendingInputs.delete(playerId);
      // Strip the entity + score from the world state. We rebuild the maps
      // immutably to stay consistent with how addPlayer mutates state.
      const nextPlayers = { ...this.state.players };
      delete nextPlayers[playerId];
      const nextScores = { ...this.state.round.scores };
      delete nextScores[playerId];
      this.state = {
        ...this.state,
        players: nextPlayers,
        round: { ...this.state.round, scores: nextScores },
      };
      evicted = true;
      console.log(
        `[matchHost ${this.matchId}] evicted player ${playerId} after ${RECONNECT_GRACE_MS}ms reconnect grace`,
      );
    }
    if (evicted && this.clients.size === 0 && this.disconnectedAt.size === 0) {
      this.stop();
    }
  }

  private tick(): void {
    this.evictExpiredDisconnects();

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
        mapId: BOXWORKS_MAP.id,
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
