// DestructibleRenderer tests. We mock just enough of the Phaser.Graphics
// surface to record the calls made during a redraw and assert ordering /
// counts. No canvas / no Phaser runtime needed.

import { describe, expect, test } from "bun:test";
import { DestructibleRenderer, destructibleColor, type RenderableDestructible } from "../DestructibleRenderer";

type Call = { name: string; args: unknown[] };

function makeGraphics() {
  const calls: Call[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
    return graphics;
  };
  const graphics = {
    clear: record("clear"),
    fillStyle: record("fillStyle"),
    fillRect: record("fillRect"),
    fillRoundedRect: record("fillRoundedRect"),
    fillCircle: record("fillCircle"),
    lineStyle: record("lineStyle"),
    strokeRect: record("strokeRect"),
    strokeLineShape: record("strokeLineShape"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    strokePath: record("strokePath"),
    destroy: () => {
      calls.push({ name: "destroy", args: [] });
    },
    __calls: calls,
  };
  return graphics;
}

function makeScene(graphics: ReturnType<typeof makeGraphics>) {
  return {
    add: {
      graphics: () => graphics,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function box(overrides: Partial<RenderableDestructible> = {}): RenderableDestructible {
  return {
    id: "d1",
    position: { x: 100, y: 200 },
    size: { x: 32, y: 32 },
    alive: true,
    kind: "box",
    health: 100,
    maxHealth: 100,
    burnMs: 0,
    ...overrides,
  };
}

describe("DestructibleRenderer", () => {
  test("redraw clears once per frame regardless of state count", () => {
    const g = makeGraphics();
    const renderer = new DestructibleRenderer(makeScene(g));
    renderer.redraw([box(), box({ id: "d2" }), box({ id: "d3" })]);
    expect(g.__calls.filter((c) => c.name === "clear")).toHaveLength(1);
  });

  test("redraw skips destructibles with alive=false", () => {
    const g = makeGraphics();
    const renderer = new DestructibleRenderer(makeScene(g));
    renderer.redraw([box({ alive: false })]);
    // Only the clear call should be present — no fills/strokes.
    const drawing = g.__calls.filter((c) => c.name !== "clear");
    expect(drawing).toHaveLength(0);
  });

  test("redraw draws health bar only when below full", () => {
    const fullG = makeGraphics();
    new DestructibleRenderer(makeScene(fullG)).redraw([box({ health: 100, maxHealth: 100 })]);

    const damagedG = makeGraphics();
    new DestructibleRenderer(makeScene(damagedG)).redraw([box({ health: 50, maxHealth: 100 })]);

    // Damaged version emits at least 2 extra fillRect calls (bg + fg of health bar).
    const fullRects = fullG.__calls.filter((c) => c.name === "fillRect").length;
    const damagedRects = damagedG.__calls.filter((c) => c.name === "fillRect").length;
    expect(damagedRects).toBeGreaterThan(fullRects);
  });

  test("burning destructible uses burn color override", () => {
    const g = makeGraphics();
    new DestructibleRenderer(makeScene(g)).redraw([box({ burnMs: 1000 })]);
    // Find the colored fillStyle call (skip the 0x07101c shadow). Burn color is 0xff7a18.
    const colorCalls = g.__calls.filter((c) => c.name === "fillStyle");
    const usedBurnColor = colorCalls.some((c) => c.args[0] === 0xff7a18);
    expect(usedBurnColor).toBe(true);
  });

  test("destructibleColor returns a stable mapping", () => {
    expect(destructibleColor("barrel")).toBe(0xff6b6b);
    expect(destructibleColor("box")).toBe(0xc49a6c);
    expect(destructibleColor("mine")).toBe(0xffd166);
    expect(destructibleColor("cube")).toBe(0x8fa3c8);
  });

  test("destroy disposes underlying graphics", () => {
    const g = makeGraphics();
    const renderer = new DestructibleRenderer(makeScene(g));
    renderer.destroy();
    expect(g.__calls.some((c) => c.name === "destroy")).toBe(true);
  });
});
