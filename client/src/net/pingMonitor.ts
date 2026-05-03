// Ping/pong RTT tracking + snapshot arrival rate.
//
// Owns the ping interval timer, outstanding-ping set, RTT sample window,
// and the snapshot-arrival timestamps used to compute snapRateHz. Pure
// of WS/Bun specifics — the caller passes a `send(message)` and routes
// pong/snap arrivals back via notePong / noteSnapshotArrived.
//
// Extracted from clientLoop.ts during PR 6 (E3c). The full
// ConnectionDriver in the plan would also wrap the Transport itself
// and own hello dispatch; that's deferred — wrapping the Transport
// would entangle this module with the reconnect supervisor, which is
// already a self-contained seam.

import { encodeMessage } from "./protocol.js";
import type { Pong } from "./protocol.js";

const PING_INTERVAL_MS = 1000;
const RTT_SAMPLE_LIMIT = 10;
const SNAP_RATE_WINDOW_MS = 1000;

export type PingMonitorStats = {
  /** Rolling-average RTT in ms over last RTT_SAMPLE_LIMIT pongs. 0 until first pong. */
  rttMs: number;
  /** Snapshots received in the last SNAP_RATE_WINDOW_MS. */
  snapRateHz: number;
};

export type PingMonitorOptions = {
  /** Caller's send function — driver doesn't own the transport. */
  send: (encoded: Uint8Array) => void;
  /** Predicate for whether the transport is open enough to ping. */
  canSend: () => boolean;
};

export class PingMonitor {
  private readonly opts: PingMonitorOptions;
  private readonly outstandingPings = new Set<number>();
  private readonly rttSamples: number[] = [];
  private readonly snapshotTimestamps: number[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: PingMonitorOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Caller routes incoming pong messages here. Stale clientTime values
   *  (i.e. a pong for a ping we forgot about after reconnect) are dropped. */
  notePong(message: Pong): void {
    if (!this.outstandingPings.has(message.clientTime)) return;
    this.outstandingPings.delete(message.clientTime);
    const rtt = performance.now() - message.clientTime;
    this.rttSamples.push(rtt);
    while (this.rttSamples.length > RTT_SAMPLE_LIMIT) {
      this.rttSamples.shift();
    }
  }

  /** Caller calls this on every snapshot the dispatcher accepts. */
  noteSnapshotArrived(): void {
    this.snapshotTimestamps.push(performance.now());
  }

  /** Sample the rolling RTT + snap-rate. Caller composes with the rest of
   *  NetStats; PingMonitor doesn't know about pendingInputs, slew, etc. */
  stats(): PingMonitorStats {
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
    return { rttMs, snapRateHz: this.snapshotTimestamps.length };
  }

  private sendPing(): void {
    if (!this.opts.canSend()) return;
    const clientTime = performance.now();
    this.outstandingPings.add(clientTime);
    this.opts.send(encodeMessage({ t: "ping", clientTime }));
  }
}
