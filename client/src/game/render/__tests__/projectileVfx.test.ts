// ProjectileVfx contract (docs/vfx-spec.md).
//
//   - TOTALITY: every ElementType and every ProjectileShape draws (no
//     element/shape silently falls back to "invisible" or throws).
//   - POOL-NULL SAFETY: with no ParticlePool, bodies/trails still draw and
//     muzzle/impact no-op gracefully (pool exhaustion is non-fatal).
//   - NO PER-FRAME ALLOC IN THE TRAIL: the ring buffer reuses storage.

import { describe, expect, test, beforeEach } from "bun:test";
import { ProjectileVfx } from "../ProjectileVfx";
import {
  EntityId,
  Tick,
  type ElementType,
  type ProjectileShape,
  type WorldState,
} from "../../../sim/types";

const ELEMENTS: ElementType[] = [
  "crystal", "neutral", "fire", "ice", "lightning", "void",
  "radiant", "electric", "toxic", "sticky", "explosive",
];
const SHAPES: ProjectileShape[] = ["circle", "triangle", "square", "hexagon", "orb", "x", "bar"];

type FakeGraphics = {
  fillOps: number;
  cleared: number;
  destroyed: boolean;
  clear(): FakeGraphics;
  setDepth(): FakeGraphics;
  setBlendMode(): FakeGraphics;
  fillStyle(): FakeGraphics;
  fillCircle(): FakeGraphics;
  fillTriangle(): FakeGraphics;
  fillPath(): FakeGraphics;
  beginPath(): FakeGraphics;
  closePath(): FakeGraphics;
  moveTo(): FakeGraphics;
  lineTo(): FakeGraphics;
  lineStyle(): FakeGraphics;
  lineBetween(): FakeGraphics;
  destroy(): void;
};

function fakeGraphics(): FakeGraphics {
  const g: FakeGraphics = {
    fillOps: 0,
    cleared: 0,
    destroyed: false,
    clear() { g.cleared += 1; return g; },
    setDepth() { return g; },
    setBlendMode() { return g; },
    fillStyle() { return g; },
    fillCircle() { g.fillOps += 1; return g; },
    fillTriangle() { g.fillOps += 1; return g; },
    fillPath() { g.fillOps += 1; return g; },
    beginPath() { return g; },
    closePath() { return g; },
    moveTo() { return g; },
    lineTo() { return g; },
    lineStyle() { return g; },
    lineBetween() { g.fillOps += 1; return g; },
    destroy() { g.destroyed = true; },
  };
  return g;
}

function fakeScene(graphicsSink: FakeGraphics[]): Phaser.Scene {
  return {
    add: {
      graphics() {
        const g = fakeGraphics();
        graphicsSink.push(g);
        return g;
      },
    },
    tweens: { add() {} },
  } as unknown as Phaser.Scene;
}

function emptyState(): WorldState {
  return {
    tick: Tick(0),
    rngState: 0,
    players: {},
    projectiles: {},
    destructibles: {},
    firePatches: {},
    pickups: {},
    satellites: {},
    round: { phase: "fighting", countdownRemainingMs: 0, scores: {}, roundIndex: 0, winnerPlayerId: null },
  } as WorldState;
}

function projectile(id: number, element: ElementType, shape: ProjectileShape) {
  return {
    id: EntityId(id),
    ownerId: null,
    x: 100 + id,
    y: 200,
    vx: 60,
    vy: 20,
    shape,
    radius: 6,
    damage: 20,
    lifetimeMs: 1000,
    pathing: "straight",
    element,
    bouncesRemaining: 0,
    pierceRemaining: 0,
  };
}

const resolve = () => 0x50e3c2;

describe("ProjectileVfx totality + safety", () => {
  let graphics: FakeGraphics[];
  let vfx: ProjectileVfx;

  beforeEach(() => {
    graphics = [];
    vfx = new ProjectileVfx(fakeScene(graphics), null); // pool null: safety path
  });

  test("every element draws a body without throwing", () => {
    for (const el of ELEMENTS) {
      const s = emptyState();
      s.projectiles = { [1]: projectile(1, el, "circle") } as unknown as WorldState["projectiles"];
      expect(() => vfx.render(s, resolve)).not.toThrow();
    }
    const body = graphics[1]!; // trail=0, body=1
    expect(body.fillOps).toBeGreaterThan(0);
  });

  test("every shape draws a body without throwing", () => {
    for (const shape of SHAPES) {
      const s = emptyState();
      s.projectiles = { [1]: projectile(1, "neutral", shape) } as unknown as WorldState["projectiles"];
      expect(() => vfx.render(s, resolve)).not.toThrow();
    }
    const body = graphics[1]!;
    expect(body.fillOps).toBeGreaterThan(0);
  });

  test("despawn (impact) with null pool does not throw", () => {
    const s = emptyState();
    s.projectiles = { [1]: projectile(1, "fire", "circle") } as unknown as WorldState["projectiles"];
    vfx.render(s, resolve);
    s.projectiles = {} as WorldState["projectiles"];
    expect(() => vfx.render(s, resolve)).not.toThrow();
  });

  test("body + trail graphics cleared every frame", () => {
    const s = emptyState();
    vfx.render(s, resolve);
    vfx.render(s, resolve);
    expect(graphics[0]!.cleared).toBe(2); // trail
    expect(graphics[1]!.cleared).toBe(2); // body
  });

  test("long-lived projectile does not grow the trail unbounded", () => {
    const s = emptyState();
    const p = projectile(1, "neutral", "circle");
    s.projectiles = { [1]: p } as unknown as WorldState["projectiles"];
    // 100 frames — ring buffer must cap trail draws at TRAIL_SAMPLES-1 segments.
    let maxOps = 0;
    for (let f = 0; f < 100; f += 1) {
      graphics[0]!.fillOps = 0;
      (p as { x: number }).x += 5;
      vfx.render(s, resolve);
      maxOps = Math.max(maxOps, graphics[0]!.fillOps);
    }
    expect(maxOps).toBeLessThanOrEqual(6); // TRAIL_SAMPLES cap
  });

  test("destroy tears down both graphics", () => {
    vfx.destroy();
    expect(graphics[0]!.destroyed).toBe(true);
    expect(graphics[1]!.destroyed).toBe(true);
  });
});
