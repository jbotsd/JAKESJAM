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
  applySnapshot(message: {
    t: "snap";
    tick: number;
    lastProcessedInputSeq: Record<string, number>;
    baseline: null;
    state: WorldState;
    events: never[];
  }): void;
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

  test("WEDGE RESYNC (2026-07-24): a snapshot that acks NOTHING against a saturated queue drops the queue and rebases prediction onto the authoritative tick", () => {
    // The permanent form of the showcase "player stationary >1s" bug: once
    // the server starts window-dropping this client's inputs, acks freeze,
    // the queue pins at the cap, and every reconcile replays all 240
    // unacked inputs on top of the authoritative state — predicted tick =
    // authTick + 240 forever, no matter what the slew hints do (taped live
    // in the K6 kindled run: offset flat at 236-239 ticks for 3+ minutes).
    const loop = new ClientLoop({
      transport: makeTransport(),
      matchId: "world",
      playerId: PID,
    });
    const internals = loop as unknown as LoopInternals;
    internals.predictedState = World.create(arena, [], 1);
    internals.runtime = createRuntime(arena);

    // Saturate: 300 local steps, zero acks → queue pinned at the cap.
    for (let i = 0; i < 300; i += 1) internals.stepOnce();
    expect(internals.pendingInputs.length).toBe(240);
    const predictedAhead = internals.predictedState!.tick as unknown as number;
    expect(predictedAhead).toBe(300);

    // Authoritative snapshot from a server that processed NONE of it.
    const authState = World.create(arena, [], 1);
    const authTick = 80;
    internals.applySnapshot({
      t: "snap",
      tick: authTick,
      lastProcessedInputSeq: {}, // acks nothing — the wedge signature
      baseline: null,
      state: { ...authState, tick: authTick as WorldState["tick"] },
      events: [],
    });

    // The fiction is gone: queue empty (not re-replayed), prediction
    // rebased to the authoritative tick instead of authTick + 240.
    expect(internals.pendingInputs.length).toBe(0);
    expect(internals.predictedState!.tick as unknown as number).toBe(authTick);

    // A HEALTHY queue (acks flowing, below the cap) must never be touched:
    // step a few inputs, ack half via the snapshot, keep the rest.
    for (let i = 0; i < 10; i += 1) internals.stepOnce();
    expect(internals.pendingInputs.length).toBe(10);
    const midSeq = internals.pendingInputs[4]!.seq as unknown as number;
    internals.applySnapshot({
      t: "snap",
      tick: authTick + 5,
      lastProcessedInputSeq: { [PID as unknown as string]: midSeq },
      baseline: null,
      state: { ...authState, tick: (authTick + 5) as WorldState["tick"] },
      events: [],
    });
    expect(internals.pendingInputs.length).toBe(5);

    loop.stop();
  });
});
