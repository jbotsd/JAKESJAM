import { describe, expect, test } from "bun:test";
import { assistTouchAim } from "../touchAimAssist";
import type { WorldState } from "../../../sim/types";

function stateWith(players: Record<string, { x: number; y: number; alive?: boolean; health?: number }>): WorldState {
  const out: Record<string, unknown> = {};
  for (const [id, p] of Object.entries(players)) {
    out[id] = { x: p.x, y: p.y, alive: p.alive ?? true, health: p.health ?? 100 };
  }
  return { players: out } as unknown as WorldState;
}

const ORIGIN = { x: 0, y: 0 };

describe("assistTouchAim", () => {
  test("no players → stick unchanged", () => {
    const s = stateWith({ me: { x: 0, y: 0 } });
    const d = assistTouchAim(s, "me", ORIGIN, { x: 1, y: 0 });
    expect(d).toEqual({ x: 1, y: 0 });
  });

  test("enemy inside cone pulls aim toward it, bounded", () => {
    // Enemy 10° off the stick direction at 400px.
    const a = (10 * Math.PI) / 180;
    const s = stateWith({
      me: { x: 0, y: 0 },
      foe: { x: Math.cos(a) * 400, y: Math.sin(a) * 400 },
    });
    const d = assistTouchAim(s, "me", ORIGIN, { x: 1, y: 0 });
    const angle = Math.atan2(d.y, d.x);
    expect(angle).toBeGreaterThan(0); // pulled toward the foe...
    expect(angle).toBeLessThan(a); // ...but never past it (bounded blend)
  });

  test("enemy outside the 20° cone is ignored", () => {
    const a = (45 * Math.PI) / 180;
    const s = stateWith({
      me: { x: 0, y: 0 },
      foe: { x: Math.cos(a) * 400, y: Math.sin(a) * 400 },
    });
    const d = assistTouchAim(s, "me", ORIGIN, { x: 1, y: 0 });
    expect(d).toEqual({ x: 1, y: 0 });
  });

  test("dead enemies and out-of-range enemies are ignored", () => {
    const s = stateWith({
      me: { x: 0, y: 0 },
      dead: { x: 300, y: 0, alive: false },
      far: { x: 2000, y: 0 },
    });
    const d = assistTouchAim(s, "me", ORIGIN, { x: 1, y: 0 });
    expect(d).toEqual({ x: 1, y: 0 });
  });

  test("crosshair-nearest wins over distance-nearest", () => {
    const off = (15 * Math.PI) / 180;
    const s = stateWith({
      me: { x: 0, y: 0 },
      close_but_off: { x: Math.cos(off) * 150, y: -Math.sin(off) * 150 },
      far_but_centered: { x: 700, y: 8 },
    });
    const d = assistTouchAim(s, "me", ORIGIN, { x: 1, y: 0 });
    // Pulled DOWNWARD-free: toward the centered target (tiny +y), not the
    // off-axis close one (-y).
    expect(d.y).toBeGreaterThanOrEqual(0);
  });

  test("zero stick input passes through", () => {
    const s = stateWith({ me: { x: 0, y: 0 }, foe: { x: 200, y: 0 } });
    const d = assistTouchAim(s, "me", ORIGIN, { x: 0, y: 0 });
    expect(d).toEqual({ x: 0, y: 0 });
  });
});
