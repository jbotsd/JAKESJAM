// WorldHost regression tests.
//
// Two contracts:
//   1. Construction validates mapId at the boundary — a typo throws loudly
//      instead of silently falling back to DEFAULT_MAP_ID (the prior behavior
//      produced a running but wrong-arena world that was hard to diagnose).
//   2. The map rotation hook returns the configured mapId until rotateMaps is
//      enabled, then advances through the ROTATION_MAPS list.

import { describe, test, expect } from "bun:test";
import { WorldHost } from "../worldHost.ts";

describe("WorldHost construction", () => {
  test("accepts the default mapId implicitly", () => {
    const wh = new WorldHost();
    // No throw, summary returns null until first attach (no host yet).
    expect(wh.summary()).toBeNull();
    expect(wh.size()).toBe(0);
  });

  test("accepts a known explicit mapId", () => {
    const wh = new WorldHost({ mapId: "boxworks-mini" });
    expect(wh.size()).toBe(0);
  });

  test("THROWS on an unknown mapId at construction time", () => {
    expect(() => new WorldHost({ mapId: "boxworks-fake" as never })).toThrow(
      /unknown mapId/,
    );
  });

  test("eager-boots the world when bots > 0", () => {
    const wh = new WorldHost({ bots: 2 });
    const summary = wh.summary();
    expect(summary).not.toBeNull();
    expect(summary!.players).toBeGreaterThanOrEqual(2);
    expect(wh.size()).toBe(1);
  });
});
