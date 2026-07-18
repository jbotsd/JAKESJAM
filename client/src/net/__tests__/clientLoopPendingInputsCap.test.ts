// Perf audit M1 (2026-07-18) regression test.
//
// ClientLoop.pendingInputs had no hard cap: every local predicted tick
// pushed one more InputFrame, drained only by the server's ack watermark.
// A genuine connection stall (ack stream stops without a re-hello/epoch
// reset) let this grow unbounded, and every incoming snapshot replays the
// ENTIRE queue via a full stepWithRuntime per entry — so an unbounded queue
// means unbounded, worsening reconcile cost. Fixed with a drop-oldest cap.
import { describe, expect, test } from "bun:test";
import { ClientLoop } from "../clientLoop";
import { World, createRuntime, type WorldRuntime } from "../../sim/World.js";
import { PlayerId } from "../../sim/types.js";
import type { InputFrame, MapDefinition, WorldState } from "../../sim/types.js";
import type { Transport, TransportState } from "../transport";

const PID = PlayerId("solo");

const arena: MapDefinition = {
  id: "pending-cap-arena",
  name: "Pending Cap Arena",
  size: { x: 1280, y: 720 },
  spawns: [{ x: 200, y: 400 }],
  platforms: [
    { id: "floor", kind: "floor", position: { x: 0, y: 500 }, size: { x: 1280, y: 60 } },
  ],
};

function makeTransport(): Transport {
  return {
    state: "open" as TransportState,
    send: () => {},
    onOpen: () => {},
    onMessage: () => {},
    onClose: () => {},
    close: () => {},
  } as unknown as Transport;
}

type LoopInternals = {
  predictedState: WorldState | null;
  runtime: WorldRuntime | null;
  pendingInputs: InputFrame[];
  stepOnce(): void;
};

describe("ClientLoop.pendingInputs hard cap (perf audit M1)", () => {
  test("never grows past the cap even under a sustained stall (no acks draining it)", () => {
    const loop = new ClientLoop({
      transport: makeTransport(),
      matchId: "world",
      playerId: PID,
    });
    const internals = loop as unknown as LoopInternals;
    internals.predictedState = World.create(arena, [], 1);
    internals.runtime = createRuntime(arena);

    // Simulate a long stall: no server acks ever arrive to drain the queue
    // (that only happens via the message handler, never called here), just
    // local prediction ticking forward every frame.
    for (let i = 0; i < 400; i += 1) {
      internals.stepOnce();
    }

    expect(internals.pendingInputs.length).toBeLessThanOrEqual(240);
    // Drop-oldest semantics: the surviving entries are the MOST RECENT ones,
    // i.e. the tail seqs, not an arbitrary subset.
    const seqs = internals.pendingInputs.map((f) => f.seq as unknown as number);
    const last = seqs[seqs.length - 1]!;
    expect(last).toBe(400);
    expect(seqs[0]).toBe(last - internals.pendingInputs.length + 1);

    loop.stop();
  });
});
