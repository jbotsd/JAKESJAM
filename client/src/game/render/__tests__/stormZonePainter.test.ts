// Smoke test for the storm-zone painter: proves it executes without
// throwing and actually draws the boundary at the model's radius, using a
// minimal call-recording Graphics stand-in (no Phaser/DOM needed).

import { describe, expect, test } from "bun:test";
import { drawStormZone } from "../stormZonePainter.js";
import type { StormZoneRenderModel } from "../renderContract.js";

class FakeGraphics {
  strokeCircleCalls: Array<{ x: number; y: number; r: number }> = [];
  fillCircleCalls: Array<{ x: number; y: number; r: number }> = [];
  lineStyle(): void {}
  fillStyle(): void {}
  strokeCircle(x: number, y: number, r: number): void {
    this.strokeCircleCalls.push({ x, y, r });
  }
  fillCircle(x: number, y: number, r: number): void {
    this.fillCircleCalls.push({ x, y, r });
  }
  fillEllipse(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  strokePath(): void {}
}

function zone(overrides: Partial<StormZoneRenderModel> = {}): StormZoneRenderModel {
  return {
    active: true,
    centerX: 1000,
    centerY: 500,
    radius: 800,
    scale: 0.8,
    kind: "endgame",
    ...overrides,
  };
}

describe("drawStormZone", () => {
  test("inactive zone draws nothing", () => {
    const g = new FakeGraphics();
    drawStormZone(g as never, zone({ active: false }), 100, 2);
    expect(g.strokeCircleCalls.length).toBe(0);
  });

  test("active zone strokes a ring at the model's exact radius", () => {
    const g = new FakeGraphics();
    drawStormZone(g as never, zone(), 100, 2);
    expect(g.strokeCircleCalls.length).toBeGreaterThan(0);
    const atRadius = g.strokeCircleCalls.filter((c) => Math.abs(c.r - 800) < 0.01);
    expect(atRadius.length).toBeGreaterThan(0);
    for (const c of atRadius) {
      expect(c.x).toBe(1000);
      expect(c.y).toBe(500);
    }
  });

  test("sudden-death kind draws more (haze + rings) than fx0 endgame", () => {
    const g0 = new FakeGraphics();
    drawStormZone(g0 as never, zone({ kind: "endgame" }), 100, 0);
    const g2 = new FakeGraphics();
    drawStormZone(g2 as never, zone({ kind: "sudden-death" }), 100, 2);
    expect(g2.strokeCircleCalls.length).toBeGreaterThan(g0.strokeCircleCalls.length);
  });

  test("never throws across a tick sweep (animation is well-defined everywhere)", () => {
    const g = new FakeGraphics();
    for (let tick = 0; tick < 600; tick += 7) {
      expect(() => drawStormZone(g as never, zone(), tick, 2)).not.toThrow();
    }
  });
});
