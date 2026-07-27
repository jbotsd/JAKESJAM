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
  "radiant", "sticky", "explosive",
];
const SHAPES: ProjectileShape[] = ["circle", "triangle", "square", "hexagon", "orb", "x", "bar"];

type FakeGraphics = {
  fillOps: number;
  strokeOps: number;
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
  arc(): FakeGraphics;
  strokePath(): FakeGraphics;
  strokeCircle(): FakeGraphics;
  destroy(): void;
};

function fakeGraphics(): FakeGraphics {
  const g: FakeGraphics = {
    fillOps: 0,
    strokeOps: 0,
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
    arc() { return g; },
    strokePath() { g.strokeOps += 1; return g; },
    strokeCircle() { g.strokeOps += 1; return g; },
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

// ── Track L identity reads (docs/legibility-audit.md) ────────────────────

type FakePoolObj = {
  setPosition(): FakePoolObj;
  setFillStyle(): FakePoolObj;
  setDepth(): FakePoolObj;
  setRotation(): FakePoolObj;
  setTint(): FakePoolObj;
  setAlpha(): FakePoolObj;
  setScale(): FakePoolObj;
};

function fakePoolObj(): FakePoolObj {
  const o: FakePoolObj = {
    setPosition() { return o; },
    setFillStyle() { return o; },
    setDepth() { return o; },
    setRotation() { return o; },
    setTint() { return o; },
    setAlpha() { return o; },
    setScale() { return o; },
  };
  return o;
}

/** Counting fake ParticlePool — unlimited objects, records acquisitions. */
function fakePool(): { pool: unknown; counts: { spark: number; glow: number } } {
  const counts = { spark: 0, glow: 0 };
  const pool = {
    acquireSpark() { counts.spark += 1; return fakePoolObj(); },
    acquireGlow() { counts.glow += 1; return fakePoolObj(); },
    acquireShard() { return fakePoolObj(); },
    acquireRing() { return fakePoolObj(); },
    acquireBolt() { return null; },
    acquireBlastCircle() { return null; },
    release() {},
  };
  return { pool, counts };
}

describe("ProjectileVfx Track L identity reads", () => {
  test("homing pathing draws the seeker reticle (stroke ops), straight does not", () => {
    const graphics: FakeGraphics[] = [];
    const vfx = new ProjectileVfx(fakeScene(graphics), null);
    const s = emptyState();
    const homing = projectile(1, "neutral", "circle");
    (homing as { pathing: string }).pathing = "homing";
    s.projectiles = { [1]: homing } as unknown as WorldState["projectiles"];
    vfx.render(s, resolve);
    const body = graphics[1]!;
    expect(body.strokeOps).toBeGreaterThan(0);

    const graphics2: FakeGraphics[] = [];
    const vfx2 = new ProjectileVfx(fakeScene(graphics2), null);
    const s2 = emptyState();
    s2.projectiles = { [1]: projectile(1, "neutral", "circle") } as unknown as WorldState["projectiles"];
    vfx2.render(s2, resolve);
    expect(graphics2[1]!.strokeOps).toBe(0);
  });

  // clip-goal STUDY 3, D5: a homing shot's seeker reticle must respect an
  // injected gate — the rendered-highlight path only wants it for the
  // star's own shots, not any bystander's unrelated homing ability
  // (`80ea1663`: a reticle on an inert bystander bot, misdirecting viewer
  // attention).
  test("seekerReticleGate suppresses the reticle when it returns false", () => {
    const graphics: FakeGraphics[] = [];
    const vfx = new ProjectileVfx(fakeScene(graphics), null, () => false);
    const s = emptyState();
    const homing = projectile(1, "neutral", "circle");
    (homing as { pathing: string }).pathing = "homing";
    s.projectiles = { [1]: homing } as unknown as WorldState["projectiles"];
    vfx.render(s, resolve);
    expect(graphics[1]!.strokeOps).toBe(0);
  });

  test("seekerReticleGate allows the reticle when it returns true, and receives the projectile's ownerId", () => {
    const graphics: FakeGraphics[] = [];
    const seenOwnerIds: Array<string | null> = [];
    const vfx = new ProjectileVfx(fakeScene(graphics), null, (ownerId) => {
      seenOwnerIds.push(ownerId as string | null);
      return ownerId === "star";
    });
    const s = emptyState();
    const homing = projectile(1, "neutral", "circle");
    (homing as { pathing: string }).pathing = "homing";
    (homing as { ownerId: string | null }).ownerId = "star";
    s.projectiles = { [1]: homing } as unknown as WorldState["projectiles"];
    vfx.render(s, resolve);
    expect(seenOwnerIds).toContain("star");
    expect(graphics[1]!.strokeOps).toBeGreaterThan(0);
  });

  test("no gate provided (live gameplay default) draws the reticle for every homing shot, unchanged", () => {
    const graphics: FakeGraphics[] = [];
    const vfx = new ProjectileVfx(fakeScene(graphics), null); // no gate arg
    const s = emptyState();
    const homing = projectile(1, "neutral", "circle");
    (homing as { pathing: string }).pathing = "homing";
    (homing as { ownerId: string | null }).ownerId = "some_bystander_bot";
    s.projectiles = { [1]: homing } as unknown as WorldState["projectiles"];
    vfx.render(s, resolve);
    expect(graphics[1]!.strokeOps).toBeGreaterThan(0);
  });

  test("leech-stamped shot draws the crimson accent ring", () => {
    const graphics: FakeGraphics[] = [];
    const vfx = new ProjectileVfx(fakeScene(graphics), null);
    const s = emptyState();
    const leechy = projectile(1, "fire", "circle");
    (leechy as { leechFraction?: number }).leechFraction = 0.5;
    s.projectiles = { [1]: leechy } as unknown as WorldState["projectiles"];
    vfx.render(s, resolve);
    expect(graphics[1]!.strokeOps).toBeGreaterThan(0);
  });

  test("wrap-flagged teleport fires the seam flash exactly once", () => {
    const graphics: FakeGraphics[] = [];
    const { pool, counts } = fakePool();
    const vfx = new ProjectileVfx(fakeScene(graphics), pool as never);
    const s = emptyState();
    const wrapper = projectile(1, "void", "circle");
    (wrapper as { wrapShots?: boolean }).wrapShots = true;
    s.projectiles = { [1]: wrapper } as unknown as WorldState["projectiles"];
    vfx.render(s, resolve); // frame 1: muzzle fires (first sight)
    const afterMuzzle = counts.spark + counts.glow;
    (wrapper as { x: number }).x += 700; // the wrap jump (> 200px guard)
    vfx.render(s, resolve); // frame 2: seam flash, exactly here
    const afterSeam = counts.spark + counts.glow;
    expect(afterSeam).toBeGreaterThan(afterMuzzle);
    (wrapper as { x: number }).x += 5; // ordinary motion
    vfx.render(s, resolve); // frame 3: nothing new
    expect(counts.spark + counts.glow).toBe(afterSeam);
  });

  test("an UNFLAGGED long jump keeps the silent break (no seam flash)", () => {
    const graphics: FakeGraphics[] = [];
    const { pool, counts } = fakePool();
    const vfx = new ProjectileVfx(fakeScene(graphics), pool as never);
    const s = emptyState();
    const plain = projectile(1, "void", "circle");
    s.projectiles = { [1]: plain } as unknown as WorldState["projectiles"];
    vfx.render(s, resolve);
    const afterMuzzle = counts.spark + counts.glow;
    (plain as { x: number }).x += 700;
    vfx.render(s, resolve);
    expect(counts.spark + counts.glow).toBe(afterMuzzle);
  });
});
