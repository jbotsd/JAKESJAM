// Client-side simulation loop with prediction + reconciliation.
// Owns: local input capture polling, sim.step prediction, snapshot ingestion,
// rewind+replay reconciliation, interpolation buffer per remote entity.
//
// Render reads from `getRenderState()`. The Phaser scene never mutates state.
// See docs/netcode-architecture.md "Frame-by-frame, client".

import { STEP_MS, World, hashWorldStateLite } from "../sim/index.js";
import { EntityId, InputSeq, PlayerId, Tick } from "../sim/types.js";
import type {
  InputFrame,
  PlayerEntity,
  SimEvent,
  WorldState,
} from "../sim/types.js";
import {
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "./protocol.js";
import { applyDelta } from "./snapshotDelta.js";
import { InterpolationBuffer } from "./interpolationBuffer.js";
import type { Transport, TransportState } from "./transport.js";
import { WsTransport } from "./wsTransport.js";
import {
  RECONNECT_BACKOFF_MS,
  ReconnectSupervisor,
  type ReconnectState,
} from "./reconnectSupervisor.js";
import {
  DEFAULT_SMOOTHING,
  RenderSmoother,
  type SmoothingOptions,
} from "./renderSmoother.js";

// Re-export for backwards compatibility with prior consumers.
export { RECONNECT_BACKOFF_MS, DEFAULT_SMOOTHING };
export type { ReconnectState, SmoothingOptions };

export type ClientLoopOptions = {
  transport: Transport;
  matchId: string;
  playerId: string;
  onEvents?: (events: SimEvent[]) => void;
  onAuthoritativeApplied?: (state: WorldState) => void;
  /**
   * Fired exactly once when the server's first ServerHello lands.
   * Carries the map id so the scene can render arena geometry before
   * the first snapshot arrives.
   */
  onHello?: (hello: import("./protocol.js").ServerHello) => void;
  /**
   * Local-player render smoothing parameters. The Gambetta + Source-engine
   * standard: after a reconcile rewind+replay, the new predicted position is
   * the "target" and the currently-rendered position is "current". Lerp
   * current toward target over `smoothingWindowMs` so float drift doesn't
   * cause a visible snap on every snapshot tick. Big deltas (teleport,
   * respawn, sync) skip smoothing.
   *
   * Sim correctness is unchanged — only the rendered position is smoothed.
   */
  smoothing?: Partial<SmoothingOptions>;
  /**
   * Optional URL used to construct replacement WsTransports during automatic
   * reconnect. If omitted, the loop will not attempt to reconnect — useful
   * for tests that pass a hand-rolled mock transport.
   */
  reconnectUrl?: string;
  /**
   * Fired after all reconnect attempts have been exhausted (or immediately
   * if reconnect is not configured for the given close reason).
   */
  onConnectionLost?: (reason: string) => void;
  /**
   * Fired before each reconnect attempt is scheduled. Useful for surfacing
   * progress in the UI.
   */
  onReconnectAttempt?: (attemptNumber: number, nextDelayMs: number) => void;
};

export type LocalInput = {
  keys: number;
  aimX: number;
  aimY: number;
};

/** Snapshot of network/prediction health for the in-game stats HUD. */
export type NetStats = {
  /** Rolling-average round-trip time in milliseconds (last 10 pongs). 0 until first pong. */
  rttMs: number;
  /** Snapshots received in the last 1000ms. */
  snapRateHz: number;
  /** Inputs sent to the server but not yet acked. */
  pendingInputs: number;
  /** Euclidean distance (px) between predicted and authoritative local-player position
   *  at the moment of the most recent reconcile. 0 until first snapshot. */
  lastPredictDeltaPx: number;
  /** Tick number of the most recent snapshot received (0 until first snapshot). */
  lastSnapshotTick: Tick;
  /** Underlying transport state. */
  transportState: TransportState;
  /**
   * Rolling average of tickAdjustMs over the last 10 snapshots that carried
   * the field. 0 until the first slew hint arrives. +ve = server is telling
   * the client to slow down; -ve = speed up.
   */
  slewMsAvg: number;
  /**
   * Number of entities (players + projectiles) skipped (not rewound) during
   * the most recent per-entity reconcile pass. 0 after a full safety sweep.
   */
  lastReconcileSkippedEntities: number;
};

export type ReconcileStats = {
  /** Distance between predicted and previously-rendered position at last reconcile, in px. */
  lastDeltaPx: number;
  /** Whether the last reconcile snapped instead of smoothing. */
  lastSnapped: boolean;
  /** Magnitude of the smoothing offset still in flight, in px. */
  currentOffsetPx: number;
};

const PING_INTERVAL_MS = 1000;
const RTT_SAMPLE_LIMIT = 10;
const SNAP_RATE_WINDOW_MS = 1000;

/**
 * Every FULL_RECONCILE_INTERVAL_MS we force a whole-world rewind+replay
 * regardless of hash comparison results. This is a safety sweep that catches
 * any false-positive hash collisions before they accumulate into visible drift.
 */
const FULL_RECONCILE_INTERVAL_MS = 5000;

export class ClientLoop {
  private transport: Transport;
  private readonly matchId: string;
  private readonly playerId: PlayerId;
  private readonly onEvents?: (events: SimEvent[]) => void;
  private readonly onAuthoritativeApplied?: (state: WorldState) => void;
  private readonly onHello?: (hello: import("./protocol.js").ServerHello) => void;
  private readonly reconnectUrl?: string;
  private readonly onConnectionLost?: (reason: string) => void;
  private readonly onReconnectAttempt?: (attemptNumber: number, nextDelayMs: number) => void;

  private predictedState: WorldState | null = null;
  private authoritativeState: WorldState | null = null;
  private readonly pendingInputs: InputFrame[] = [];
  private nextInputSeq: InputSeq = InputSeq(1);
  private currentInput: LocalInput = { keys: 0, aimX: 0, aimY: 0 };
  private interval: ReturnType<typeof setInterval> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private accumulator = 0;
  private lastTickAt = 0;
  private lastSnapshotTick: Tick = Tick(0);
  private readonly remoteInterp = new Map<PlayerId, InterpolationBuffer<PlayerEntity>>();

  // Net stats bookkeeping.
  private readonly rttSamples: number[] = [];
  private readonly outstandingPings = new Set<number>();
  private readonly snapshotTimestamps: number[] = [];
  private lastPredictDeltaPx = 0;

  // ---- Delta snapshot ring ----
  /** Last N received WorldStates keyed by their tick. Used to resolve baseline
   *  when a DeltaSnapshot arrives. Ring size matches server's BASELINE_RING_SIZE. */
  private readonly snapshotRing = new Map<Tick, WorldState>();
  private static readonly SNAPSHOT_RING_SIZE = 10;

  // ---- Per-entity reconcile state ----
  private lastFullReconcileAt = 0;
  private lastReconcileSkippedEntities = 0;

  // ---- Local-player render smoothing state ----
  private readonly smoother: RenderSmoother;

  // ---- Server-driven tick slew ----
  /**
   * Accumulated budget of ms to inject into / drain from the accumulator.
   * +ve budget means the server wants us to slow down: we REDUCE the
   * accumulator by 1 ms each tick until the budget is drained, effectively
   * stretching the time between sim steps.
   * -ve budget means the server wants us to speed up: we ADD 1 ms per tick.
   */
  private slewMsBudget = 0;
  /** Rolling window of the last 10 non-zero tickAdjustMs values for NetStats. */
  private readonly slewMsHistory: number[] = [];
  private static readonly SLEW_HISTORY_LIMIT = 10;

  // ---- Reconnect supervision ----
  private readonly reconnect: ReconnectSupervisor;

  constructor(opts: ClientLoopOptions) {
    this.transport = opts.transport;
    this.matchId = opts.matchId;
    this.playerId = PlayerId(opts.playerId);
    this.onEvents = opts.onEvents;
    this.onAuthoritativeApplied = opts.onAuthoritativeApplied;
    this.onHello = opts.onHello;
    this.smoother = new RenderSmoother(opts.smoothing);
    this.reconnectUrl = opts.reconnectUrl;
    this.onConnectionLost = opts.onConnectionLost;
    this.onReconnectAttempt = opts.onReconnectAttempt;

    this.reconnect = new ReconnectSupervisor(this.reconnectUrl !== undefined, {
      onAttempt: () => this.attemptReconnect(),
      onAbandon: (reason) => {
        this.stop();
        this.onConnectionLost?.(reason);
      },
      onScheduled: (attempt, delay) => this.onReconnectAttempt?.(attempt, delay),
    });

    this.wireTransport(this.transport);
  }

  /**
   * Attach the standard set of handlers to a transport (initial OR a
   * replacement built during reconnect). On close we route through the
   * reconnect supervisor instead of just stopping.
   */
  private wireTransport(transport: Transport): void {
    transport.onOpen(() => {
      this.reconnect.noteOpen();
      this.sendHello();
    });
    transport.onMessage((data) => this.handleMessage(data));
    transport.onClose((reason) => {
      if (this.reconnect.isAbandoned()) {
        this.stop();
        return;
      }
      this.reconnect.noteClose(reason);
    });
  }

  private attemptReconnect(): void {
    if (!this.reconnectUrl) return;
    const next = new WsTransport({ url: this.reconnectUrl });
    this.transport = next;
    this.wireTransport(next);
    // If the new socket fails to open, its close handler will route back
    // through reconnect.noteClose and either schedule the next backoff
    // step or give up depending on attempt count.
  }

  /** Snapshot of the current reconnect state for UI consumers. */
  getReconnectState(): ReconnectState {
    return this.reconnect.state();
  }

  start(): void {
    if (this.interval) return;
    this.lastTickAt = performance.now();
    this.interval = setInterval(() => this.tick(), STEP_MS);
    // Ping loop runs on its own timer so it survives even if sim ticks stall.
    if (!this.pingInterval) {
      this.pingInterval = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.reconnect.cancel();
  }

  /**
   * Send a draft-phase card commit. Server validates it's the right round
   * and that `cardId` is in the player's offer set. The matching
   * `draft-resolved` SimEvent comes back through the normal snapshot path.
   */
  sendCardPick(roundIndex: number, cardId: string): void {
    this.transport.send(
      encodeMessage({ t: "card-pick", roundIndex, cardId }),
    );
  }

  /** Updated by the input capture layer every frame before the next tick. */
  setLocalInput(input: LocalInput): void {
    this.currentInput = input;
  }

  /**
   * Snapshot state used by the renderer. The local player's position has the
   * smoothing offset applied (rendered = predicted + offset, where offset
   * decays to zero over `smoothing.windowMs`). All other entities are
   * unchanged. Clone if you intend to mutate.
   */
  getRenderState(): WorldState | null {
    if (!this.predictedState) return null;
    this.smoother.advance(performance.now());
    if (!this.smoother.hasOffset()) {
      return this.predictedState;
    }
    const local = this.predictedState.players[this.playerId];
    if (!local) return this.predictedState;
    // Shallow clone state + players record + the local player so callers see
    // smoothed coords without us mutating the predicted sim state.
    const offset = this.smoother.offset();
    const smoothedLocal: PlayerEntity = {
      ...local,
      x: local.x + offset.x,
      y: local.y + offset.y,
    };
    return {
      ...this.predictedState,
      players: {
        ...this.predictedState.players,
        [this.playerId]: smoothedLocal,
      },
    };
  }

  /** Look up a remote player at a given render time (ms in server clock). */
  getRemotePlayerAt(playerId: PlayerId, renderTimeMs: number): PlayerEntity | null {
    const buffer = this.remoteInterp.get(playerId);
    if (!buffer) return null;
    return buffer.sample(renderTimeMs);
  }

  /** Latest network/prediction health snapshot for the stats HUD. */
  getNetStats(): NetStats {
    // Trim snapshot timestamps to a 1s sliding window for snap-rate.
    const now = performance.now();
    const windowStart = now - SNAP_RATE_WINDOW_MS;
    while (
      this.snapshotTimestamps.length > 0 &&
      this.snapshotTimestamps[0]! < windowStart
    ) {
      this.snapshotTimestamps.shift();
    }

    let rttMs = 0;
    if (this.rttSamples.length > 0) {
      let sum = 0;
      for (const sample of this.rttSamples) sum += sample;
      rttMs = sum / this.rttSamples.length;
    }

    let slewMsAvg = 0;
    if (this.slewMsHistory.length > 0) {
      let slewSum = 0;
      for (const v of this.slewMsHistory) slewSum += v;
      slewMsAvg = slewSum / this.slewMsHistory.length;
    }

    return {
      rttMs,
      snapRateHz: this.snapshotTimestamps.length,
      pendingInputs: this.pendingInputs.length,
      lastPredictDeltaPx: this.lastPredictDeltaPx,
      lastSnapshotTick: this.lastSnapshotTick,
      transportState: this.transport.state,
      slewMsAvg,
      lastReconcileSkippedEntities: this.lastReconcileSkippedEntities,
    };
  }

  /**
   * Most recent reconcile delta + current smoothing offset. Hook for debug
   * overlays — does not allocate, safe to poll every frame.
   */
  getReconcileStats(): ReconcileStats {
    return this.smoother.stats();
  }

  // ---------------- Internals ----------------

  private sendHello(): void {
    this.transport.send(
      encodeMessage({
        t: "hello",
        matchId: this.matchId,
        playerId: this.playerId,
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
  }

  private sendPing(): void {
    if (this.transport.state !== "open") return;
    const clientTime = performance.now();
    this.outstandingPings.add(clientTime);
    this.transport.send(encodeMessage({ t: "ping", clientTime }));
  }

  private handlePong(message: import("./protocol.js").Pong): void {
    if (!this.outstandingPings.has(message.clientTime)) return;
    this.outstandingPings.delete(message.clientTime);
    const rtt = performance.now() - message.clientTime;
    this.rttSamples.push(rtt);
    while (this.rttSamples.length > RTT_SAMPLE_LIMIT) {
      this.rttSamples.shift();
    }
  }

  private tick(): void {
    if (!this.predictedState) return;
    const now = performance.now();
    this.accumulator += now - this.lastTickAt;
    this.lastTickAt = now;

    // Drain one ms of slew budget per tick call. This nudges the effective
    // tick rate toward the server's desired lead without any discontinuity.
    //
    // Sign convention (matches server's intent):
    //   slewMsBudget > 0 → server asked client to slow down.
    //     We subtract 1 ms from the accumulator, making it harder to cross
    //     the STEP_MS threshold → slightly fewer steps per wall-clock second.
    //   slewMsBudget < 0 → server asked client to speed up.
    //     We add 1 ms to the accumulator, making it easier to cross the
    //     threshold → slightly more steps per wall-clock second.
    if (Math.abs(this.slewMsBudget) >= 1) {
      const drain = this.slewMsBudget > 0 ? -1 : 1;
      this.accumulator += drain;  // drain > 0 when speeding up, < 0 when slowing
      this.slewMsBudget += drain; // move budget toward zero by the same magnitude
    }

    if (this.accumulator < STEP_MS) return;

    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      this.stepOnce();
    }
  }

  private stepOnce(): void {
    if (!this.predictedState) return;
    const input: InputFrame = {
      seq: (() => { const s = this.nextInputSeq; this.nextInputSeq = InputSeq(this.nextInputSeq + 1); return s; })(),
      tick: this.predictedState.tick,
      keys: this.currentInput.keys,
      aimX: this.currentInput.aimX,
      aimY: this.currentInput.aimY,
      dtMs: STEP_MS,
    };
    this.pendingInputs.push(input);

    const inputs: Record<PlayerId, InputFrame | null> = {};
    inputs[this.playerId] = input;
    const result = World.step(this.predictedState, inputs, STEP_MS);
    this.predictedState = result.state;

    this.transport.send(
      encodeMessage({
        t: "in",
        seq: input.seq,
        tick: input.tick,
        keys: input.keys,
        aimX: input.aimX,
        aimY: input.aimY,
        dt: input.dtMs,
      }),
    );
  }

  private handleMessage(raw: Uint8Array): void {
    const decoded = decodeMessage<ServerMessage>(raw);
    if (!decoded) return;
    if (decoded.version !== PROTOCOL_VERSION) {
      this.transport.close("protocol-mismatch");
      return;
    }
    const { message } = decoded;
    switch (message.t) {
      case "hello":
        this.applyHello(message);
        break;
      case "snap":
        this.applySnapshot(message);
        break;
      case "pong":
        this.handlePong(message);
        break;
      case "bye":
        this.transport.close(message.reason);
        break;
    }
  }

  private applyHello(message: import("./protocol.js").ServerHello): void {
    // First snapshot will replace state proper. Until it lands we use an empty
    // placeholder so getRenderState doesn't return null.
    if (!this.predictedState) {
      this.predictedState = makeEmptyState(message.startTick, message.rngSeed);
      this.authoritativeState = makeEmptyState(message.startTick, message.rngSeed);
    }
    this.onHello?.(message);
    this.start();
  }

  private applySnapshot(message: import("./protocol.js").Snapshot): void {
    // Resolve the authoritative state from the snapshot (full or delta).
    let resolvedState: WorldState | null = null;

    if (message.baseline === null) {
      // FullSnapshot
      resolvedState = message.state;
    } else {
      // DeltaSnapshot — look up the baseline in our ring
      const baselineState = this.snapshotRing.get(message.baseline);
      if (baselineState) {
        resolvedState = applyDelta(baselineState, message.delta);
      } else {
        // Baseline evicted from ring. Signal the server to send a full snap
        // by sending ack with lastSnapshotTick: 0. Discard this snapshot.
        this.transport.send(
          encodeMessage({ t: "ack", lastSnapshotTick: Tick(0) }),
        );
        return;
      }
    }

    // Store in ring for future delta resolution
    this.snapshotRing.set(message.tick, resolvedState);
    if (this.snapshotRing.size > ClientLoop.SNAPSHOT_RING_SIZE) {
      // Evict the chronologically oldest tick. Map insertion order is not a
      // safe proxy when ticks can arrive out of order (reconnect, dropped
      // packets), so scan keys for the minimum.
      let oldest: Tick | undefined;
      for (const k of this.snapshotRing.keys()) {
        if (oldest === undefined || k < oldest) oldest = k;
      }
      if (oldest !== undefined) this.snapshotRing.delete(oldest);
    }

    // Predict-vs-auth delta is captured BEFORE we overwrite predicted state via
    // rewind+replay — this measures how far the local prediction had drifted.
    const priorPredicted = this.predictedState;
    const incomingMe = resolvedState.players[this.playerId];
    if (priorPredicted) {
      const predictedMe = priorPredicted.players[this.playerId];
      if (predictedMe && incomingMe) {
        const dx = predictedMe.x - incomingMe.x;
        const dy = predictedMe.y - incomingMe.y;
        this.lastPredictDeltaPx = Math.sqrt(dx * dx + dy * dy);
      }
    }

    this.authoritativeState = resolvedState;
    this.lastSnapshotTick = message.tick;
    this.snapshotTimestamps.push(performance.now());

    // Accumulate server-driven slew hint into the budget.
    // The budget is drained 1 ms per tick() call (see tick()).
    if (message.tickAdjustMs) {
      this.slewMsBudget += message.tickAdjustMs;
      // Record for NetStats rolling average.
      this.slewMsHistory.push(message.tickAdjustMs);
      while (this.slewMsHistory.length > ClientLoop.SLEW_HISTORY_LIMIT) {
        this.slewMsHistory.shift();
      }
    }

    // Drop pending inputs the server has already processed.
    const ackedSeq = message.lastProcessedInputSeq[this.playerId] ?? 0;
    while (this.pendingInputs.length > 0 && this.pendingInputs[0]!.seq <= ackedSeq) {
      this.pendingInputs.shift();
    }

    // Capture the position the renderer was showing for the local player
    // BEFORE we rewind. We need this to compute the smoothing offset that
    // keeps the rendered position visually continuous across reconcile.
    const prevLocal = this.predictedState?.players[this.playerId];
    const offset = this.smoother.offset();
    const prevRenderedX =
      prevLocal !== undefined ? prevLocal.x + offset.x : null;
    const prevRenderedY =
      prevLocal !== undefined ? prevLocal.y + offset.y : null;

    // ---- Per-entity reconcile ----
    //
    // Compare FNV1a-32 hashes for each player and projectile in the predicted
    // vs authoritative snapshot. Only diverged entities need the authoritative
    // state copied in; entities whose hashes match can keep their predicted
    // values. The replay still runs the full World.step for every pending
    // input — the savings come from the snap-fix step being narrower.
    //
    // Exception: the local player ALWAYS gets the authoritative state as its
    // starting point (smoothing depends on measuring the residual delta).
    //
    // Every FULL_RECONCILE_INTERVAL_MS we skip the hash check entirely and
    // do a whole-world rewind regardless. This bounds the damage from any
    // false-positive hash collision to at most FULL_RECONCILE_INTERVAL_MS.
    const nowMs = performance.now();
    const doFullReconcile =
      nowMs - this.lastFullReconcileAt >= FULL_RECONCILE_INTERVAL_MS ||
      this.predictedState === null;

    let replayState: WorldState;

    if (doFullReconcile || this.predictedState === null) {
      this.lastFullReconcileAt = nowMs;
      this.lastReconcileSkippedEntities = 0;
      replayState = cloneState(this.authoritativeState);
    } else {
      // Hash-guided partial reconcile.
      const authHashes = hashWorldStateLite(this.authoritativeState);
      const predHashes = hashWorldStateLite(this.predictedState);

      const divergedPlayers = new Set<PlayerId>();
      const divergedProjectiles = new Set<EntityId>();

      // Collect diverged players.
      for (const pid in this.authoritativeState.players) {
        const typedPid = pid as PlayerId;
        const aHash = authHashes.players[typedPid];
        const pHash = predHashes.players[typedPid];
        if (aHash === undefined || pHash === undefined || aHash !== pHash) {
          divergedPlayers.add(typedPid);
        }
      }
      // Catch any players present in predicted but dropped from authoritative.
      for (const pid in this.predictedState.players) {
        const typedPid = pid as PlayerId;
        if (!(typedPid in this.authoritativeState.players)) {
          divergedPlayers.add(typedPid);
        }
      }

      // Local player ALWAYS rewinds — smoothing delta depends on it.
      divergedPlayers.add(this.playerId);

      // Collect diverged projectiles.
      for (const eid in this.authoritativeState.projectiles) {
        const typedEid = Number(eid) as EntityId;
        const aHash = authHashes.projectiles[typedEid];
        const pHash = predHashes.projectiles[typedEid];
        if (aHash === undefined || pHash === undefined || aHash !== pHash) {
          divergedProjectiles.add(typedEid);
        }
      }
      // Catch projectiles in predicted but dropped from authoritative.
      for (const eid in this.predictedState.projectiles) {
        const typedEid = Number(eid) as EntityId;
        if (!(typedEid in this.authoritativeState.projectiles)) {
          divergedProjectiles.add(typedEid);
        }
      }

      // Count total entities to compute skip ratio.
      const totalPlayers =
        Object.keys(this.authoritativeState.players).length;
      const totalProjectiles =
        Object.keys(this.authoritativeState.projectiles).length;
      const totalEntities = totalPlayers + totalProjectiles;
      const divergedCount = divergedPlayers.size + divergedProjectiles.size;
      this.lastReconcileSkippedEntities = Math.max(
        0,
        totalEntities - divergedCount,
      );

      // Build the starting state for replay: authoritative base, but for
      // entities NOT in the diverged set, patch in the predicted entity so
      // the physics replay starts from the already-correct predicted value.
      replayState = cloneState(this.authoritativeState);

      // Patch in non-diverged predicted players.
      for (const pid in this.predictedState.players) {
        const typedPid = pid as PlayerId;
        if (!divergedPlayers.has(typedPid)) {
          replayState.players[typedPid] =
            this.predictedState.players[typedPid]!;
        }
      }

      // Patch in non-diverged predicted projectiles.
      for (const eid in this.predictedState.projectiles) {
        const typedEid = Number(eid) as EntityId;
        if (!divergedProjectiles.has(typedEid)) {
          replayState.projectiles[typedEid] =
            this.predictedState.projectiles[typedEid]!;
        }
      }
    }

    // Replay all pending inputs through the (possibly patched) base state.
    for (const input of this.pendingInputs) {
      const inputs: Record<PlayerId, InputFrame | null> = {};
      inputs[this.playerId] = input;
      replayState = World.step(replayState, inputs, STEP_MS).state;
    }
    this.predictedState = replayState;

    // Recompute the smoothing offset so rendered = previous-rendered, then
    // it decays to the new predicted position over smoothing.windowMs.
    const newLocal = this.predictedState?.players[this.playerId];
    if (newLocal) {
      this.smoother.applyReconcile(prevRenderedX, prevRenderedY, newLocal.x, newLocal.y);
    }

    // Push remote players into their interpolation buffers.
    const serverTimeMs = message.tick * STEP_MS;
    for (const [pid_, entity] of Object.entries(resolvedState.players)) {
      const pid = pid_ as PlayerId;
      if (pid === this.playerId) continue;
      let buffer = this.remoteInterp.get(pid);
      if (!buffer) {
        buffer = new InterpolationBuffer<PlayerEntity>(lerpPlayer);
        this.remoteInterp.set(pid, buffer);
      }
      buffer.push(serverTimeMs, entity);
    }

    if (message.events.length > 0 && this.onEvents) {
      this.onEvents(message.events);
    }

    if (this.onAuthoritativeApplied) {
      this.onAuthoritativeApplied(this.authoritativeState);
    }

    // Ack — lets the server free its snapshot baseline ring for us.
    this.transport.send(
      encodeMessage({
        t: "ack",
        lastSnapshotTick: this.lastSnapshotTick,
      }),
    );
  }

}

// ---------------- Helpers ----------------

function makeEmptyState(tick: Tick, rngSeed: number): WorldState {
  return {
    tick,
    rngState: rngSeed >>> 0,
    players: {},
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: {
      phase: "countdown",
      countdownRemainingMs: 3000,
      scores: {},
      roundIndex: 0,
      winnerPlayerId: null,
    },
  };
}

function cloneState(state: WorldState): WorldState {
  // Shallow + structuredClone for nested records. Deterministic, fast enough
  // for prototype scale (<200 entities). Replace with delta-aware patcher when
  // Dev A's deltaCodec lands.
  return structuredClone(state);
}

function lerpPlayer(a: PlayerEntity, b: PlayerEntity, t: number): PlayerEntity {
  return {
    ...b,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    aimX: lerp(a.aimX, b.aimX, t),
    aimY: lerp(a.aimY, b.aimY, t),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
