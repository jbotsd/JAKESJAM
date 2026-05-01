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
import type { Transport } from "./transport.js";
import { WsTransport } from "./wsTransport.js";

/**
 * Backoff schedule (ms) for automatic reconnect. Length defines the max
 * attempt count (5). Exponential pattern: 500, 1000, 2000, 4000, 8000.
 */
export const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

/** Close reasons that should NOT trigger reconnect (terminal disconnects). */
const TERMINAL_CLOSE_REASONS = new Set<string>([
  "match-ended",
  "auth-failed",
  "protocol-mismatch",
  "server-shutdown",
]);

export type ReconnectState = {
  attempt: number;
  lastAttemptAt: number | null;
  isReconnecting: boolean;
};

export type ClientLoopOptions = {
  transport: Transport;
  matchId: string;
  playerId: string;
  onEvents?: (events: SimEvent[]) => void;
  onAuthoritativeApplied?: (state: WorldState) => void;
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

export class ClientLoop {
  private transport: Transport;
  private readonly matchId: string;
  private readonly playerId: PlayerId;
  private readonly onEvents?: (events: SimEvent[]) => void;
  private readonly onAuthoritativeApplied?: (state: WorldState) => void;
  private readonly reconnectUrl?: string;
  private readonly onConnectionLost?: (reason: string) => void;
  private readonly onReconnectAttempt?: (attemptNumber: number, nextDelayMs: number) => void;

  private predictedState: WorldState | null = null;
  private authoritativeState: WorldState | null = null;
  private readonly pendingInputs: InputFrame[] = [];
  private nextInputSeq: InputSeq = 1;
  private currentInput: LocalInput = { keys: 0, aimX: 0, aimY: 0 };
  private interval: ReturnType<typeof setInterval> | null = null;
  private accumulator = 0;
  private lastTickAt = 0;
  private lastSnapshotTick: Tick = 0;
  private readonly remoteInterp = new Map<PlayerId, InterpolationBuffer<PlayerEntity>>();

  // ---- Reconnect supervision ----
  private reconnectAttempt = 0;
  private reconnectLastAttemptAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectInProgress = false;
  /** Set true once we've decided to give up on reconnect or never reconnect. */
  private connectionAbandoned = false;

  constructor(opts: ClientLoopOptions) {
    this.transport = opts.transport;
    this.matchId = opts.matchId;
    this.playerId = opts.playerId;
    this.onEvents = opts.onEvents;
    this.onAuthoritativeApplied = opts.onAuthoritativeApplied;
    this.reconnectUrl = opts.reconnectUrl;
    this.onConnectionLost = opts.onConnectionLost;
    this.onReconnectAttempt = opts.onReconnectAttempt;

    this.wireTransport(this.transport);
  }

  /**
   * Attach the standard set of handlers to a transport (initial OR a
   * replacement built during reconnect). On close we route through the
   * reconnect supervisor instead of just stopping.
   */
  private wireTransport(transport: Transport): void {
    transport.onOpen(() => {
      // First-time connect or successful reconnect — both reset the attempt
      // counter so any subsequent drop starts a fresh backoff schedule.
      this.reconnectAttempt = 0;
      this.reconnectInProgress = false;
      this.sendHello();
    });
    transport.onMessage((data) => this.handleMessage(data));
    transport.onClose((reason) => this.handleTransportClose(reason));
  }

  /**
   * Decide whether to schedule a reconnect or accept the disconnect as final.
   * Terminal reasons (match-ended, auth-failed, ...) skip retry. We also
   * skip if no reconnectUrl was supplied (test mode / bare mock transport).
   */
  private handleTransportClose(reason: string): void {
    if (this.connectionAbandoned) {
      this.stop();
      return;
    }
    if (!this.reconnectUrl || TERMINAL_CLOSE_REASONS.has(reason)) {
      this.connectionAbandoned = true;
      this.stop();
      this.onConnectionLost?.(reason);
      return;
    }
    if (this.reconnectAttempt >= RECONNECT_BACKOFF_MS.length) {
      this.connectionAbandoned = true;
      this.stop();
      this.onConnectionLost?.(reason);
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = RECONNECT_BACKOFF_MS[this.reconnectAttempt]!;
    const attemptNumber = this.reconnectAttempt + 1;
    this.reconnectInProgress = true;
    this.onReconnectAttempt?.(attemptNumber, delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptReconnect();
    }, delay);
  }

  private attemptReconnect(): void {
    if (this.connectionAbandoned || !this.reconnectUrl) return;
    this.reconnectAttempt += 1;
    this.reconnectLastAttemptAt = Date.now();
    const next = new WsTransport({ url: this.reconnectUrl });
    this.transport = next;
    this.wireTransport(next);
    // If the new socket fails to open, its close handler will route back
    // through handleTransportClose and either schedule the next backoff
    // step or give up depending on attempt count.
  }

  /** Snapshot of the current reconnect state for UI consumers. */
  getReconnectState(): ReconnectState {
    return {
      attempt: this.reconnectAttempt,
      lastAttemptAt: this.reconnectLastAttemptAt,
      isReconnecting: this.reconnectInProgress,
    };
  }

  start(): void {
    if (this.interval) return;
    this.lastTickAt = performance.now();
    this.interval = setInterval(() => this.tick(), STEP_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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
        // RTT tracking goes here later.
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
    this.authoritativeState = message.state;
    this.lastSnapshotTick = message.tick;

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
