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

    if (this.state.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.broadcastSnapshot(result.events);
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
