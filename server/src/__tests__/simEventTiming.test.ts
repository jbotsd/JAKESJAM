import { describe, expect, test } from "bun:test";
import { PlayerId, Tick, type SimEvent } from "@sim/types.ts";
import { stampSimEventTicks } from "../matchHost.ts";

describe("authoritative SimEvent timing", () => {
  test("stamps every event with its occurrence tick before snapshot batching", () => {
    const events: SimEvent[] = [
      { t: "shot-fired", playerId: PlayerId("p1"), x: 10, y: 20 },
      {
        t: "hit-confirmed",
        victimId: PlayerId("p2"),
        attackerId: PlayerId("p1"),
        damage: 12,
        sourceProjectileId: null,
      },
    ];
    stampSimEventTicks(events, Tick(77));
    expect(events.map((event) => event.atTick === undefined ? undefined : Number(event.atTick)))
      .toEqual([77, 77]);
  });

  test("does not erase a tick already preserved by an upstream batch", () => {
    const events: SimEvent[] = [
      { t: "slash-started", playerId: PlayerId("p1"), x: 0, y: 0, atTick: Tick(70) },
    ];
    stampSimEventTicks(events, Tick(73));
    expect(Number(events[0]!.atTick)).toBe(70);
  });
});
