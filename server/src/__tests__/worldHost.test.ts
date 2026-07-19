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
    // Eager-boot population is bots, honestly reported as bots — the
    // humans/bots split (Pillar 0.1) means an empty server never claims
    // human players.
    expect(summary!.bots).toBeGreaterThanOrEqual(2);
    expect(summary!.humans).toBe(0);
    expect(wh.size()).toBe(1);
  });

  test("threads public mode rules into the live host", () => {
    const wh = new WorldHost({ bots: 1, modeModifierIds: ["target-score-5"] });
    expect(wh.summary()?.targetScore).toBe(5);
    expect(wh.summary()?.chaosModifierIds).toContain("target-score-5");
  });
});
