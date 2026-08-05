// Arena pre-connect holder + adoption adapter (open-doors 1.3).
//
// The network half (armArenaPreconnect's token fetch + real WebSocket) is
// exercised by the live venue flow; what's pinned here is the pure
// contract the scenes rely on:
//   1. take() hands the warm socket over exactly once, to the right
//      player, and never a dead one.
//   2. The adopting loop's message handler meets the stored hello BEFORE
//      any live frame (microtask replay), then the live stream flows.
//   3. disarm closes an un-adopted socket but never one already handed
//      to the arena loop.

import { describe, test, expect } from "bun:test";
import type { Transport, TransportState } from "../transport.js";
import {
  disarmArenaPreconnect,
  installArenaPreconnectForTest,
  takeArenaPreconnect,
} from "../arenaPreconnect.js";

class FakeTransport implements Transport {
  state: TransportState = "open";
  closedWith: string | undefined;
  private messageHandlers: Array<(data: Uint8Array) => void> = [];
  send(): void {}
  onOpen(): void {}
  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandlers.push(handler);
  }
  onClose(): void {}
  close(reason?: string): void {
    this.state = "closed";
    this.closedWith = reason ?? "closed";
  }
  push(frame: Uint8Array): void {
    for (const h of this.messageHandlers) h(frame);
  }
}

const HELLO = new Uint8Array([1, 2, 3]);
const LIVE = new Uint8Array([9, 9, 9]);

describe("arenaPreconnect holder", () => {
  test("take() with nothing armed → null (fresh-connect fallback)", () => {
    disarmArenaPreconnect();
    expect(takeArenaPreconnect("p_any")).toBeNull();
  });

  test("take() for a DIFFERENT player → null, holder untouched", () => {
    const inner = new FakeTransport();
    installArenaPreconnectForTest("p_mine", inner, "ws://x/ws/world?token=t", null);
    expect(takeArenaPreconnect("p_other")).toBeNull();
    expect(takeArenaPreconnect("p_mine")).not.toBeNull();
    disarmArenaPreconnect();
  });

  test("take() of a dead socket → null (the race fell back to a fresh connect)", () => {
    const inner = new FakeTransport();
    inner.state = "closed";
    installArenaPreconnectForTest("p_dead", inner, "ws://x/ws/world?token=t", null);
    expect(takeArenaPreconnect("p_dead")).toBeNull();
  });

  test("take() is one-shot — the second caller gets null", () => {
    const inner = new FakeTransport();
    installArenaPreconnectForTest("p_once", inner, "ws://x/ws/world?token=t", null);
    expect(takeArenaPreconnect("p_once")).not.toBeNull();
    expect(takeArenaPreconnect("p_once")).toBeNull();
  });

  test("disarm closes an un-adopted socket; a taken one belongs to the arena loop", () => {
    const kept = new FakeTransport();
    installArenaPreconnectForTest("p_keep", kept, "ws://x/ws/world?token=t", null);
    disarmArenaPreconnect();
    expect(kept.closedWith).toBe("preconnect-disarmed");

    const adopted = new FakeTransport();
    installArenaPreconnectForTest("p_adopt", adopted, "ws://x/ws/world?token=t", null);
    expect(takeArenaPreconnect("p_adopt")).not.toBeNull();
    disarmArenaPreconnect();
    expect(adopted.closedWith).toBeUndefined(); // never closed from here
  });
});

describe("hello-replaying adoption adapter", () => {
  test("the stored hello reaches the handler before any live frame, then the live stream flows", async () => {
    const inner = new FakeTransport();
    installArenaPreconnectForTest("p_replay", inner, "ws://x/ws/world?token=t", HELLO);
    const pre = takeArenaPreconnect("p_replay");
    expect(pre).not.toBeNull();

    const seen: Uint8Array[] = [];
    pre!.transport.onMessage((data) => seen.push(data));
    // Synchronously after registration nothing has arrived yet — the
    // replay is a microtask, giving the adopting constructor time to
    // finish building the loop.
    expect(seen.length).toBe(0);
    await Promise.resolve(); // drain microtasks
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual(HELLO);
    // Live frames pass straight through after the replay.
    inner.push(LIVE);
    expect(seen.length).toBe(2);
    expect(seen[1]).toEqual(LIVE);
  });

  test("no stored hello (server never re-helloed yet) → pure pass-through, no phantom frame", async () => {
    const inner = new FakeTransport();
    installArenaPreconnectForTest("p_bare", inner, "ws://x/ws/world?token=t", null);
    const pre = takeArenaPreconnect("p_bare");
    const seen: Uint8Array[] = [];
    pre!.transport.onMessage((data) => seen.push(data));
    await Promise.resolve();
    expect(seen.length).toBe(0);
    inner.push(LIVE);
    expect(seen.length).toBe(1);
  });

  test("adapter delegates send/close/state to the warm socket", () => {
    const inner = new FakeTransport();
    installArenaPreconnectForTest("p_del", inner, "ws://x/ws/world?token=t", null);
    const pre = takeArenaPreconnect("p_del");
    expect(pre!.transport.state).toBe("open");
    pre!.transport.close("client-leave");
    expect(inner.closedWith).toBe("client-leave");
    expect(pre!.transport.state).toBe("closed");
  });
});
