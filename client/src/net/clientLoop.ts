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

export type ClientLoopOptions = {
  transport: Transport;
  matchId: string;
  playerId: string;
  onEvents?: (events: SimEvent[]) => void;
  onAuthoritativeApplied?: (state: WorldState) => void;
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
};

export type SmoothingOptions = {
  /** Window over which the residual offset decays to zero, in ms. */
  windowMs: number;
  /**
   * Distance (px) above which we skip smoothing and snap immediately. This is
   * a teleport/respawn/forced-sync, not float drift.
   */
  snapThresholdPx: number;
  /**
   * Maximum correction (px) applied to the rendered position in any single
   * render frame. Clamps overshoot when the renderer runs slower than
   * expected (e.g. tab refocus).
   */
  maxCorrectionPxPerFrame: number;
};

export type LocalInput = {
  keys: number;
  aimX: number;
  aimY: number;
};

export type ReconcileStats = {
  /** Distance between predicted and previously-rendered position at last reconcile, in px. */
  lastDeltaPx: number;
  /** Whether the last reconcile snapped instead of smoothing. */
  lastSnapped: boolean;
  /** Magnitude of the smoothing offset still in flight, in px. */
  currentOffsetPx: number;
};

const DEFAULT_SMOOTHING: SmoothingOptions = {
  windowMs: 100,
  snapThresholdPx: 30,
  maxCorrectionPxPerFrame: 8,
};

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
  private accumulator = 0;
  private lastTickAt = 0;
  private lastSnapshotTick: Tick = 0;
  private readonly remoteInterp = new Map<PlayerId, InterpolationBuffer<PlayerEntity>>();

  // ---- Local-player render smoothing state ----
  private readonly smoothing: SmoothingOptions;
  /**
   * Residual offset between the rendered local-player position and the
   * predicted position. Rendered = predicted + offset. After a reconcile
   * disagreement, offset is set to (oldRendered - newPredicted) so the
   * rendered position stays continuous, then it decays toward zero.
   */
  private renderOffsetX = 0;
  private renderOffsetY = 0;
  private lastRenderAt = 0;
  /** Most recent reconcile delta magnitude (px). Surfaced via getReconcileStats. */
  private lastReconcileDeltaPx = 0;
  private lastReconcileSnapped = false;

  constructor(opts: ClientLoopOptions) {
    this.transport = opts.transport;
    this.matchId = opts.matchId;
    this.playerId = opts.playerId;
    this.onEvents = opts.onEvents;
    this.onAuthoritativeApplied = opts.onAuthoritativeApplied;
    this.smoothing = { ...DEFAULT_SMOOTHING, ...(opts.smoothing ?? {}) };

    this.transport.onOpen(() => this.sendHello());
    this.transport.onMessage((data) => this.handleMessage(data));
    this.transport.onClose(() => this.stop());
  }

  start(): void {
    if (this.interval) return;
    this.lastTickAt = performance.now();
    this.interval = setInterval(() => this.tick(), STEP_MS);
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
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
    this.advanceSmoothing();
    if (this.renderOffsetX === 0 && this.renderOffsetY === 0) {
      return this.predictedState;
    }
    const local = this.predictedState.players[this.playerId];
    if (!local) return this.predictedState;
    // Shallow clone state + players record + the local player so callers see
    // smoothed coords without us mutating the predicted sim state.
    const smoothedLocal: PlayerEntity = {
      ...local,
      x: local.x + this.renderOffsetX,
      y: local.y + this.renderOffsetY,
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

  /**
   * Most recent reconcile delta + current smoothing offset. Hook for debug
   * overlays — does not allocate, safe to poll every frame.
   */
  getReconcileStats(): ReconcileStats {
    return {
      lastDeltaPx: this.lastReconcileDeltaPx,
      lastSnapped: this.lastReconcileSnapped,
      currentOffsetPx: Math.hypot(this.renderOffsetX, this.renderOffsetY),
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

    // Capture the position the renderer was showing for the local player
    // BEFORE we rewind. We need this to compute the smoothing offset that
    // keeps the rendered position visually continuous across reconcile.
    const prevLocal = this.predictedState?.players[this.playerId];
    const prevRenderedX =
      prevLocal !== undefined ? prevLocal.x + this.renderOffsetX : null;
    const prevRenderedY =
      prevLocal !== undefined ? prevLocal.y + this.renderOffsetY : null;

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

    // Recompute the smoothing offset so rendered = previous-rendered, then
    // it decays to the new predicted position over smoothing.windowMs.
    this.updateSmoothingOnReconcile(prevRenderedX, prevRenderedY);

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

  /**
   * After rewind+replay, set the render offset so the rendered position
   * matches what the user was just seeing (prevRendered). The offset then
   * decays to zero over time, sliding the visible character to the new
   * predicted position. Big jumps (teleport/respawn) skip smoothing.
   */
  private updateSmoothingOnReconcile(
    prevRenderedX: number | null,
    prevRenderedY: number | null,
  ): void {
    if (!this.predictedState) return;
    const newLocal = this.predictedState.players[this.playerId];
    if (!newLocal || prevRenderedX === null || prevRenderedY === null) {
      // No prior frame to be continuous with — start with no offset.
      this.renderOffsetX = 0;
      this.renderOffsetY = 0;
      this.lastReconcileDeltaPx = 0;
      this.lastReconcileSnapped = false;
      return;
    }
    const dx = prevRenderedX - newLocal.x;
    const dy = prevRenderedY - newLocal.y;
    const dist = Math.hypot(dx, dy);
    this.lastReconcileDeltaPx = dist;
    if (dist > this.smoothing.snapThresholdPx) {
      // Teleport / respawn / forced sync: snap, do not smooth.
      this.renderOffsetX = 0;
      this.renderOffsetY = 0;
      this.lastReconcileSnapped = true;
      return;
    }
    this.renderOffsetX = dx;
    this.renderOffsetY = dy;
    this.lastReconcileSnapped = false;
  }

  /**
   * Decay the render offset toward zero based on wall-clock elapsed since
   * the previous render call. Called from getRenderState. Linear decay over
   * `smoothing.windowMs` (so a 100ms window with ~16ms frames closes ~16% of
   * the offset per frame), with a per-frame max correction clamp to prevent
   * a visible jump when the renderer stalls.
   */
  private advanceSmoothing(): void {
    if (this.renderOffsetX === 0 && this.renderOffsetY === 0) {
      this.lastRenderAt = performance.now();
      return;
    }
    const now = performance.now();
    const elapsed = this.lastRenderAt === 0 ? 0 : Math.max(0, now - this.lastRenderAt);
    this.lastRenderAt = now;
    if (elapsed === 0) return;

    // Linear decay over windowMs. Simple, predictable, and keeps the
    // per-frame step easy to clamp. (Exponential would over-emphasise the
    // first frame after a reconcile, which is exactly when the offset is
    // most visible.)
    const windowMs = Math.max(1, this.smoothing.windowMs);
    const fraction = Math.min(1, elapsed / windowMs);
    let stepX = this.renderOffsetX * fraction;
    let stepY = this.renderOffsetY * fraction;

    // Clamp the per-frame correction so a long pause (tab refocus, GC) can't
    // produce a visible jump. Direction-preserving clamp on the 2D step.
    const stepMag = Math.hypot(stepX, stepY);
    const maxStep = this.smoothing.maxCorrectionPxPerFrame;
    if (stepMag > maxStep && stepMag > 0) {
      const k = maxStep / stepMag;
      stepX *= k;
      stepY *= k;
    }

    this.renderOffsetX -= stepX;
    this.renderOffsetY -= stepY;

    // Snap to zero once we're inside sub-pixel territory to avoid lingering
    // tiny offsets that pin getRenderState into the slow clone path.
    if (Math.abs(this.renderOffsetX) < 0.05) this.renderOffsetX = 0;
    if (Math.abs(this.renderOffsetY) < 0.05) this.renderOffsetY = 0;
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
