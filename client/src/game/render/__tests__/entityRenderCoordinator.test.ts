// Phase C2a follow-up — contract tests for EntityRenderCoordinator.
//
// Stubs scene.add.{circle,graphics} and the drawer/colour
// resolvers, dispatches update() with various WorldStates, asserts
// sprites + graphics tracking matches expectations.

import { describe, expect, test, beforeEach } from "bun:test";
import { EntityRenderCoordinator } from "../EntityRenderCoordinator";
import {
  EntityId,
  PlayerId,
  Tick,
  type WorldState,
} from "../../../sim/types";

type FakeArc = {
  destroyed: boolean;
  x: number;
  y: number;
  radius: number;
  fill: number;
  stroke: { width: number; color: number; alpha: number } | null;
  depth: number;
  setPosition(x: number, y: number): FakeArc;
  setRadius(r: number): FakeArc;
  setFillStyle(c: number): FakeArc;
  setStrokeStyle(w: number, c: number, a: number): FakeArc;
  setDepth(d: number): FakeArc;
  destroy(): void;
};

type FakeGraphics = {
  destroyed: boolean;
  cleared: number;
  /** Count of fill/stroke primitives drawn (body + trail shapes). */
  fillOps: number;
  drawCalls: Array<{ kind: string; args: unknown[] }>;
  depth: number;
  blendMode: number;
  clear(): FakeGraphics;
  setDepth(d: number): FakeGraphics;
  setBlendMode(m: number): FakeGraphics;
  fillStyle(c: number, a?: number): FakeGraphics;
  fillCircle(x: number, y: number, r: number): FakeGraphics;
  fillTriangle(...a: number[]): FakeGraphics;
  fillPath(): FakeGraphics;
  beginPath(): FakeGraphics;
  closePath(): FakeGraphics;
  moveTo(x: number, y: number): FakeGraphics;
  lineTo(x: number, y: number): FakeGraphics;
  lineStyle(w: number, c: number, a?: number): FakeGraphics;
  lineBetween(x1: number, y1: number, x2: number, y2: number): FakeGraphics;
  destroy(): void;
};

function fakeArc(x: number, y: number, r: number, color: number): FakeArc {
  const obj: FakeArc = {
    destroyed: false,
    x,
    y,
    radius: r,
    fill: color,
    stroke: null,
    depth: 0,
    setPosition(nx, ny) {
      obj.x = nx;
      obj.y = ny;
      return obj;
    },
    setRadius(nr) {
      obj.radius = nr;
      return obj;
    },
    setFillStyle(c) {
      obj.fill = c;
      return obj;
    },
    setStrokeStyle(w, c, a) {
      obj.stroke = { width: w, color: c, alpha: a };
      return obj;
    },
    setDepth(d) {
      obj.depth = d;
      return obj;
    },
    destroy() {
      obj.destroyed = true;
    },
  };
  return obj;
}

function fakeGraphics(): FakeGraphics {
  const obj: FakeGraphics = {
    destroyed: false,
    cleared: 0,
    fillOps: 0,
    drawCalls: [],
    depth: 0,
    blendMode: 0,
    clear() {
      obj.cleared += 1;
      return obj;
    },
    setDepth(d) {
      obj.depth = d;
      return obj;
    },
    setBlendMode(m) {
      obj.blendMode = m;
      return obj;
    },
    fillStyle() {
      return obj;
    },
    fillCircle() {
      obj.fillOps += 1;
      return obj;
    },
    fillTriangle() {
      obj.fillOps += 1;
      return obj;
    },
    fillPath() {
      obj.fillOps += 1;
      return obj;
    },
    beginPath() {
      return obj;
    },
    closePath() {
      return obj;
    },
    moveTo() {
      return obj;
    },
    lineTo() {
      return obj;
    },
    lineStyle() {
      return obj;
    },
    lineBetween() {
      obj.fillOps += 1;
      return obj;
    },
    destroy() {
      obj.destroyed = true;
    },
  };
  return obj;
}

function fakeScene(): {
  scene: Phaser.Scene;
  arcsCreated: FakeArc[];
  graphicsCreated: FakeGraphics[];
} {
  const arcsCreated: FakeArc[] = [];
  const graphicsCreated: FakeGraphics[] = [];
  const scene = {
    add: {
      circle(x: number, y: number, r: number, c: number) {
        const arc = fakeArc(x, y, r, c);
        arcsCreated.push(arc);
        return arc;
      },
      graphics() {
        const g = fakeGraphics();
        graphicsCreated.push(g);
        return g;
      },
    },
  } as unknown as Phaser.Scene;
  return { scene, arcsCreated, graphicsCreated };
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
    round: {
      phase: "fighting",
      countdownRemainingMs: 0,
      scores: {},
      roundIndex: 0,
      winnerPlayerId: null,
    },
  } as WorldState;
}

describe("EntityRenderCoordinator — C2a contract", () => {
  let coord: EntityRenderCoordinator;
  let env: ReturnType<typeof fakeScene>;

  beforeEach(() => {
    env = fakeScene();
    coord = new EntityRenderCoordinator(env.scene, {
      projectileColor: () => 0x50e3c2,
      drawDestructible: (g) => {
        (g as unknown as FakeGraphics).drawCalls.push({
          kind: "dest",
          args: [],
        });
      },
      drawFirePatch: (g) => {
        (g as unknown as FakeGraphics).drawCalls.push({
          kind: "fire",
          args: [],
        });
      },
      drawPickup: (g) => {
        (g as unknown as FakeGraphics).drawCalls.push({
          kind: "pickup",
          args: [],
        });
      },
    });
  });

  test("constructor allocates 5 graphics: 3 persistent (2/3/4) + trail(5) + body(6)", () => {
    // ProjectileVfx adds the additive trail + body graphics (docs/vfx-spec.md).
    expect(env.graphicsCreated.length).toBe(5);
    const depths = env.graphicsCreated.map((g) => g.depth).sort((a, b) => a - b);
    expect(depths).toEqual([2, 3, 4, 5, 6]);
  });

  test("update on empty state clears persistent + vfx graphics", () => {
    coord.update(emptyState(), 16.667, 0);
    // pickup + destructible + fire + projectile body + trail each cleared once.
    const total = env.graphicsCreated.reduce((s, g) => s + g.cleared, 0);
    expect(total).toBe(5);
  });

  test("projectiles are drawn into the additive body graphics, not flat arcs", () => {
    const s = emptyState();
    s.projectiles = {
      [1]: {
        id: EntityId(1),
        ownerId: null,
        x: 100,
        y: 200,
        vx: 0,
        vy: 0,
        shape: "circle",
        radius: 7,
        damage: 25,
        lifetimeMs: 1000,
        pathing: "straight",
        element: "neutral",
        bouncesRemaining: 0,
        pierceRemaining: 0,
      },
    } as unknown as WorldState["projectiles"];
    coord.update(s, 16.667, 0);
    // No flat-circle sprites anymore.
    expect(env.arcsCreated.length).toBe(0);
    // Body graphics (depth 6) received fill primitives (shell + hot core).
    const body = env.graphicsCreated.find((g) => g.depth === 6)!;
    expect(body.fillOps).toBeGreaterThan(0);
  });

  test("projectile keeps drawing across ticks, no arcs ever created", () => {
    const s = emptyState();
    s.projectiles = {
      [1]: {
        id: EntityId(1),
        ownerId: null,
        x: 100,
        y: 200,
        vx: 50,
        vy: 0,
        shape: "circle",
        radius: 7,
        damage: 25,
        lifetimeMs: 1000,
        pathing: "straight",
        element: "neutral",
        bouncesRemaining: 0,
        pierceRemaining: 0,
      },
    } as unknown as WorldState["projectiles"];
    coord.update(s, 16.667, 0);
    const body = env.graphicsCreated.find((g) => g.depth === 6)!;
    const opsAfterFrame1 = body.fillOps;
    (s.projectiles as Record<number, { x: number; y: number }>)[1]!.x = 150;
    coord.update(s, 16.667, 16.667);
    expect(env.arcsCreated.length).toBe(0);
    expect(body.fillOps).toBeGreaterThan(opsAfterFrame1); // drew again
  });

  test("projectile removed from state → impact fires, no crash, body stops drawing", () => {
    const s = emptyState();
    s.projectiles = {
      [1]: {
        id: EntityId(1),
        ownerId: null,
        x: 100,
        y: 200,
        vx: 0,
        vy: 0,
        shape: "circle",
        radius: 7,
        damage: 25,
        lifetimeMs: 1000,
        pathing: "straight",
        element: "neutral",
        bouncesRemaining: 0,
        pierceRemaining: 0,
      },
    } as unknown as WorldState["projectiles"];
    coord.update(s, 16.667, 0);
    const body = env.graphicsCreated.find((g) => g.depth === 6)!;
    const opsWithProjectile = body.fillOps;
    s.projectiles = {};
    // Pool is null in this harness, so impact() no-ops gracefully; the key
    // contract is despawn doesn't throw and the body draws nothing new.
    coord.update(s, 16.667, 16.667);
    expect(body.fillOps).toBe(opsWithProjectile); // no further body draws
  });

  test("satellite without an alive owner is skipped (no arc spawn)", () => {
    const s = emptyState();
    s.satellites = {
      [10]: {
        id: EntityId(10),
        ownerId: PlayerId("missing"),
        angle: 0,
        orbitRadius: 38,
        damage: 5,
        cooldownMs: 0,
      },
    } as unknown as WorldState["satellites"];
    coord.update(s, 16.667, 0);
    expect(env.arcsCreated.length).toBe(0);
  });

  test("destructibleDrawer fires once per destructible per tick", () => {
    const s = emptyState();
    s.destructibles = {
      [101]: {
        id: EntityId(101),
        kind: "barrel",
        x: 100,
        y: 100,
        width: 32,
        height: 32,
        health: 100,
        explosive: true,
        flammable: false,
      },
      [102]: {
        id: EntityId(102),
        kind: "box",
        x: 200,
        y: 200,
        width: 32,
        height: 32,
        health: 50,
        explosive: false,
        flammable: false,
      },
    } as unknown as WorldState["destructibles"];
    coord.update(s, 16.667, 0);
    const destG = env.graphicsCreated.find((g) => g.depth === 3)!;
    expect(destG.drawCalls.length).toBe(2);
  });

  test("fire patch renders once per patch per tick", () => {
    const s = emptyState();
    s.firePatches = {
      [201]: {
        id: EntityId(201),
        x: 0,
        y: 0,
        radius: 32,
        remainingMs: 500,
        ownerId: null,
        damagePerSecond: 14,
      },
    } as unknown as WorldState["firePatches"];
    coord.update(s, 16.667, 0);
    const fireG = env.graphicsCreated.find((g) => g.depth === 4)!;
    expect(fireG.drawCalls.length).toBe(1);
  });

  test("destroy() releases all owned graphics + clears tracking maps", () => {
    const s = emptyState();
    s.projectiles = {
      [1]: {
        id: EntityId(1),
        ownerId: null,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        shape: "circle",
        radius: 7,
        damage: 25,
        lifetimeMs: 1000,
        pathing: "straight",
        element: "neutral",
        bouncesRemaining: 0,
        pierceRemaining: 0,
      },
    } as unknown as WorldState["projectiles"];
    coord.update(s, 16.667, 0);
    coord.destroy();
    // Projectiles no longer create flat arcs; destroy() must tear down all
    // owned graphics including the ProjectileVfx body + trail buffers.
    expect(env.graphicsCreated.every((g) => g.destroyed)).toBe(true);
  });
});
