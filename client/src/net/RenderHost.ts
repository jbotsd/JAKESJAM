// RenderHost — seam between ClientLoop and the Phaser render layer.
//
// Wraps a ClientLoop and owns its lifecycle. The render layer (OnlineMatchScene)
// never calls ClientLoop methods directly — it calls RenderHost instead.
//
// Depth: ClientLoop's full construction path (transport, matchId, playerId,
// callback wiring) plus reconnect-state plumbing and snapshot routing sits
// behind the small interface below. The scene goes from knowing about
// ClientLoopOptions, WsTransport, fetchMatchAssignment, and buildGameServerWsUrl
// to knowing only about RenderHost.
//
// Interface:
//   getRenderSnapshot() → { world, localStats, isReconnecting }
//   setLocalInput(LocalInput)
//   commitCardPick(roundIndex, cardId)
//   start() / stop() / destroy()

import {
  ClientLoop,
  WsTransport,
  buildGameServerWsUrl,
  fetchMatchAssignment,
  type LocalInput,
  type NetStats,
} from "./index.js";
import { ConvexClient } from "convex/browser";
import type { Id } from "../../../convex/_generated/dataModel.js";
import type { SimEvent, WorldState } from "../sim/types.js";

export type RenderSnapshot = {
  world: WorldState | null;
  localStats: NetStats;
  isReconnecting: boolean;
};

export type RenderHostOptions = {
  matchId: string;
  localPlayerId: string;
  convexUrl: string;
  onEvents: (events: SimEvent[]) => void;
  onStatusChange: (message: string) => void;
};

// Default net-stats when the loop hasn't connected yet.
const EMPTY_STATS: NetStats = {
  rttMs: 0,
  snapRateHz: 0,
  pendingInputs: 0,
  lastPredictDeltaPx: 0,
  lastSnapshotTick: 0 as import("../sim/types.js").Tick,
  transportState: "closed",
};

export class RenderHost {
  private loop: ClientLoop | null = null;

  private readonly opts: RenderHostOptions;

  constructor(opts: RenderHostOptions) {
    this.opts = opts;
    // Begin async connection immediately. The caller can call start() to begin
    // the sim-tick loop once the loop is ready, but getRenderSnapshot() is safe
    // to call at any time — it returns null world until a snapshot arrives.
    void this.connect();
  }

  // ── Interface ──────────────────────────────────────────────────────────────

  getRenderSnapshot(): RenderSnapshot {
    const world = this.loop?.getRenderState() ?? null;
    const localStats = this.loop?.getNetStats() ?? EMPTY_STATS;
    const isReconnecting = this.loop?.getReconnectState().isReconnecting ?? false;
    return { world, localStats, isReconnecting };
  }

  setLocalInput(input: LocalInput): void {
    this.loop?.setLocalInput(input);
  }

  commitCardPick(roundIndex: number, cardId: string): void {
    this.loop?.sendCardPick(roundIndex, cardId);
  }

  start(): void {
    this.loop?.start();
  }

  stop(): void {
    this.loop?.stop();
  }

  destroy(): void {
    this.loop?.stop();
    this.loop = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    try {
      const { matchId, localPlayerId, convexUrl } = this.opts;
      const convex = new ConvexClient(convexUrl);
      this.opts.onStatusChange("Fetching match assignment from Convex...");
      let assignment;
      try {
        assignment = await fetchMatchAssignment(
          convex,
          matchId as Id<"matches">,
          localPlayerId,
        );
      } finally {
        // Close the Convex client after the one-shot fetch; we don't need it again.
        void convex.close();
      }
      const wsUrl = buildGameServerWsUrl(assignment, matchId);
      this.opts.onStatusChange(`Opening WebSocket to ${assignment.region ?? "host"}...`);
      const transport = new WsTransport({ url: wsUrl });
      this.loop = new ClientLoop({
        transport,
        matchId,
        playerId: localPlayerId,
        onAuthoritativeApplied: () => {
          this.opts.onStatusChange("");
        },
        onEvents: this.opts.onEvents,
        reconnectUrl: wsUrl,
        onConnectionLost: (reason) => {
          this.opts.onStatusChange(`Disconnected: ${reason}`);
        },
        onReconnectAttempt: (attempt, delay) => {
          this.opts.onStatusChange(`Reconnecting (attempt ${attempt}, delay ${delay}ms)...`);
        },
      });
      // No explicit start() call here — caller decides when to begin ticking.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      this.opts.onStatusChange(`Connect failed: ${msg}`);
    }
  }
}
