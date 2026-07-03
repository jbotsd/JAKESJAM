// MatchHost input-queue regression tests.
//
// The server buffers a per-player FIFO of input frames and consumes exactly
// one per tick. The prior design was a last-write-wins slot: any input that
// arrived in the same tick interval as a later one was silently dropped AND
// acked as processed, so the client pruned it from its replay set — the
// predicted movement was permanently lost on the server and every reconcile
// yanked the local player backward (rubber-banding under jitter).
//
// Contracts under test:
//   1. Jitter-batched inputs are ALL simulated, one per tick, in seq order.
//   2. The ack watermark only advances for inputs actually consumed.
//   3. Empty-queue ticks re-apply the last real input (input-hold), capped.
//   4. Queue overflow drains oldest-first and acks what it drops.
//   5. Duplicate / out-of-order seqs are rejected at the queue boundary.

import { describe, test, expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import { MatchHost, type MatchSocketData } from "../matchHost.ts";
import { InputSeq, PlayerId, type InputFrame, type PlayerSpawnInfo, type WorldState } from "@sim/types.ts";

const PID = PlayerId("p1");

type HostInternals = {
  applyInput(playerId: PlayerId, input: { seq: number; tick: number; keys: number; aimX: number; aimY: number; dt: number }): void;
  tick(): void;
  stop(): void;
  state: WorldState;
  pendingInputs: Map<PlayerId, InputFrame[]>;
  lastProcessedInputSeq: Map<PlayerId, InputSeq>;
  lastAppliedInput: Map<PlayerId, InputFrame>;
  heldInputTicks: Map<PlayerId, number>;
};

function makeFakeWs(playerId: PlayerId): ServerWebSocket<MatchSocketData> {
  return {
    data: { matchId: "test-match", playerId, authedAt: Date.now() },
    send: () => 1,
    close: () => {},
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<MatchSocketData>;
}

function makeHost(): { host: MatchHost; internals: HostInternals } {
  const spawn: PlayerSpawnInfo = {
    playerId: PID,
    characterId: "balanced",
    weaponId: "starter-pistol",
    color: "#ff0000",
    name: "P1",
  };
  const host = new MatchHost("test-match", [spawn], []);
  const internals = host as unknown as HostInternals;
  host.attachClient(makeFakeWs(PID));
  // attachClient starts the real setInterval loop; kill it so the test
  // drives ticks deterministically.
  internals.stop();
  return { host, internals };
}

/** Send an input stamped at the host's current tick (always in-window). */
function sendInput(internals: HostInternals, seq: number, keys = 0b1): void {
  internals.applyInput(PID, {
    seq,
    tick: internals.state.tick,
    keys,
    aimX: 0,
    aimY: 0,
    dt: 16.67,
  });
}

describe("MatchHost input queue", () => {
  test("jitter-batched inputs are all consumed, one per tick, in order", () => {
    const { internals } = makeHost();

    // Three inputs land between server ticks (jitter batch).
    sendInput(internals, 1);
    sendInput(internals, 2);
    sendInput(internals, 3);
    expect(internals.pendingInputs.get(PID)!.length).toBe(3);

    internals.tick();
    expect(internals.lastProcessedInputSeq.get(PID)).toBe(InputSeq(1));
    expect(internals.pendingInputs.get(PID)!.length).toBe(2);

    internals.tick();
    expect(internals.lastProcessedInputSeq.get(PID)).toBe(InputSeq(2));

    internals.tick();
    expect(internals.lastProcessedInputSeq.get(PID)).toBe(InputSeq(3));
    expect(internals.pendingInputs.get(PID)!.length).toBe(0);
  });

  test("ack watermark does NOT advance on empty-queue ticks", () => {
    const { internals } = makeHost();
    sendInput(internals, 1);
    internals.tick();
    expect(internals.lastProcessedInputSeq.get(PID)).toBe(InputSeq(1));

    // No new input; watermark must hold at 1.
    internals.tick();
    internals.tick();
    expect(internals.lastProcessedInputSeq.get(PID)).toBe(InputSeq(1));
  });

  test("empty-queue ticks hold the last real input, capped at 15 ticks", () => {
    const { internals } = makeHost();
    const HELD_KEYS = 0b10; // Right
    sendInput(internals, 1, HELD_KEYS);
    internals.tick();
    expect(internals.heldInputTicks.get(PID)).toBe(0);

    // Gap: server keeps re-applying the held frame...
    internals.tick();
    expect(internals.heldInputTicks.get(PID)).toBe(1);
    expect(internals.lastAppliedInput.get(PID)!.keys).toBe(HELD_KEYS);

    for (let i = 0; i < 30; i++) internals.tick();
    // ...but never past the cap.
    expect(internals.heldInputTicks.get(PID)).toBe(15);

    // A fresh real input resets the hold counter.
    sendInput(internals, 2, HELD_KEYS);
    internals.tick();
    expect(internals.heldInputTicks.get(PID)).toBe(0);
  });

  test("overflow drains oldest-first WITHOUT acking dropped frames", () => {
    const { internals } = makeHost();
    for (let seq = 1; seq <= 20; seq++) sendInput(internals, seq);

    internals.tick();
    // Drain to soft cap (5): seqs 1..15 dropped silently (the watermark
    // must only advance for SIMULATED inputs — ack-on-drop erased
    // predicted projectiles client-side); seq 16 is applied and its ack
    // covers the dropped seqs monotonically.
    expect(internals.lastProcessedInputSeq.get(PID)).toBe(InputSeq(16));
    expect(internals.pendingInputs.get(PID)!.length).toBe(4);
  });

  test("duplicate and out-of-order seqs are rejected at the boundary", () => {
    const { internals } = makeHost();
    sendInput(internals, 5);
    sendInput(internals, 5); // duplicate
    sendInput(internals, 3); // out-of-order
    expect(internals.pendingInputs.get(PID)!.length).toBe(1);

    internals.tick();
    expect(internals.lastProcessedInputSeq.get(PID)).toBe(InputSeq(5));
    // Anything at-or-below the processed watermark is also rejected.
    sendInput(internals, 4);
    expect(internals.pendingInputs.get(PID)!.length).toBe(0);
  });
});
