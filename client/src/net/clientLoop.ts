// Client-side simulation loop with prediction + reconciliation.
// Owns: local input capture polling, sim.step prediction, snapshot ingestion,
// rewind+replay reconciliation, interpolation buffer per remote entity.
//
// Render reads from `getRenderState()`. The Phaser scene never mutates state.
// See docs/netcode-architecture.md "Frame-by-frame, client".

import { STEP_MS, World } from "../sim/index.js";
import type {
  InputFrame,
  InputSeq,
  PlayerEntity,
  PlayerId,
  SimEvent,
  Tick,
  WorldState,
} from "../sim/types.js";
import {
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "./protocol.js";
import { InterpolationBuffer } from "./interpolationBuffer.js";
import type { Transport, TransportState } from "./transport.js";

export type ClientLoopOptions = {
  transport: Transport;
  matchId: string;
  playerId: string;
  onEvents?: (events: SimEvent[]) => void;
  onAuthoritativeApplied?: (state: WorldState) => void;
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
};

const PING_INTERVAL_MS = 1000;
const RTT_SAMPLE_LIMIT = 10;
const SNAP_RATE_WINDOW_MS = 1000;

export class ClientLoop {
  private readonly transport: Transport;
  private readonly matchId: string;
  private readonly playerId: PlayerId;
  private readonly onEvents?: (events: SimEvent[]) => void;
  private readonly onAuthoritativeApplied?: (state: WorldState) => void;

  private predictedState: WorldState | null = null;
  private authoritativeState: WorldState | null = null;
  private readonly pendingInputs: InputFrame[] = [];
  private nextInputSeq: InputSeq = 1;
  private currentInput: LocalInput = { keys: 0, aimX: 0, aimY: 0 };
  private interval: ReturnType<typeof setInterval> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private accumulator = 0;
  private lastTickAt = 0;
  private lastSnapshotTick: Tick = 0;
  private readonly remoteInterp = new Map<PlayerId, InterpolationBuffer<PlayerEntity>>();

  // Net stats bookkeeping.
  private readonly rttSamples: number[] = [];
  private readonly outstandingPings = new Set<number>();
  private readonly snapshotTimestamps: number[] = [];
  private lastPredictDeltaPx = 0;

  constructor(opts: ClientLoopOptions) {
    this.transport = opts.transport;
    this.matchId = opts.matchId;
    this.playerId = opts.playerId;
    this.onEvents = opts.onEvents;
    this.onAuthoritativeApplied = opts.onAuthoritativeApplied;

    this.transport.onOpen(() => this.sendHello());
    this.transport.onMessage((data) => this.handleMessage(data));
    this.transport.onClose(() => this.stop());
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
  }

  /** Updated by the input capture layer every frame before the next tick. */
  setLocalInput(input: LocalInput): void {
    this.currentInput = input;
  }

  /** Snapshot state used by the renderer. Clone if you intend to mutate. */
  getRenderState(): WorldState | null {
    return this.predictedState;
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

    return {
      rttMs,
      snapRateHz: this.snapshotTimestamps.length,
      pendingInputs: this.pendingInputs.length,
      lastPredictDeltaPx: this.lastPredictDeltaPx,
      lastSnapshotTick: this.lastSnapshotTick,
      transportState: this.transport.state,
    };
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
    if (this.accumulator < STEP_MS) return;

    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      this.stepOnce();
    }
  }

  private stepOnce(): void {
    if (!this.predictedState) return;
    const input: InputFrame = {
      seq: this.nextInputSeq++,
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
    this.start();
  }

  private applySnapshot(message: import("./protocol.js").Snapshot): void {
    // Predict-vs-auth delta is captured BEFORE we overwrite predicted state via
    // rewind+replay — this measures how far the local prediction had drifted.
    const priorPredicted = this.predictedState;
    const incomingMe = message.state.players[this.playerId];
    if (priorPredicted) {
      const predictedMe = priorPredicted.players[this.playerId];
      if (predictedMe && incomingMe) {
        const dx = predictedMe.x - incomingMe.x;
        const dy = predictedMe.y - incomingMe.y;
        this.lastPredictDeltaPx = Math.sqrt(dx * dx + dy * dy);
      }
    }

    this.authoritativeState = message.state;
    this.lastSnapshotTick = message.tick;
    this.snapshotTimestamps.push(performance.now());

    // Drop pending inputs the server has already processed.
    const ackedSeq = message.lastProcessedInputSeq[this.playerId] ?? 0;
    while (this.pendingInputs.length > 0 && this.pendingInputs[0]!.seq <= ackedSeq) {
      this.pendingInputs.shift();
    }

    // Rewind + replay: start from the authoritative state, replay any local
    // input the server has not yet processed. World.step is currently a no-op
    // stub — once Dev A's sim is real, this gives us full Gambetta prediction.
    let replayState = cloneState(this.authoritativeState);
    for (const input of this.pendingInputs) {
      const inputs: Record<PlayerId, InputFrame | null> = {};
      inputs[this.playerId] = input;
      replayState = World.step(replayState, inputs, STEP_MS).state;
    }
    this.predictedState = replayState;

    // Push remote players into their interpolation buffers.
    const serverTimeMs = message.tick * STEP_MS;
    for (const [pid, entity] of Object.entries(message.state.players)) {
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
