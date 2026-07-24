// ParticlePool tests. The pool itself is Phaser-free at runtime (uses only
// duck-typed `setVisible`/`setAlpha`/etc on the GameObjects), so we can mock
// the scene minimally without spinning up Phaser/canvas.

import { describe, expect, test, mock } from "bun:test";
import { ParticlePool } from "../ParticlePool";

type Stub = {
  setVisible: (v: boolean) => Stub;
  setAlpha: (a: number) => Stub;
  setScale: (s: number) => Stub;
  setRotation: (r: number) => Stub;
  setPosition: (x: number, y: number) => Stub;
  setBlendMode: (mode: number) => Stub;
  setTint: (c: number) => Stub;
  clear: () => Stub;
  destroy: () => void;
  destroyed: boolean;
};

function makeStub(): Stub {
  const s: Stub = {
    destroyed: false,
    setVisible: () => s,
    setAlpha: () => s,
    setScale: () => s,
    setRotation: () => s,
    setPosition: () => s,
    setBlendMode: () => s,
    setTint: () => s,
    clear: () => s,
    destroy: () => {
      s.destroyed = true;
    },
  };
  return s;
}

function makeScene() {
  return {
    add: {
      rectangle: () => makeStub(),
      circle: () => makeStub(),
      graphics: () => makeStub(),
      image: () => makeStub(),
    },
    textures: {
      exists: () => false,
      createCanvas: () => ({
        context: {
          createRadialGradient: () => ({ addColorStop: () => undefined }),
          fillStyle: "",
          fillRect: () => undefined,
        },
        refresh: () => undefined,
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("ParticlePool", () => {
  test("acquireSpark returns distinct instances until pool size reached", () => {
    const pool = new ParticlePool(makeScene());
    const first = pool.acquireSpark();
    const second = pool.acquireSpark();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  });

  test("release returns the instance to the free list for reuse", () => {
    const pool = new ParticlePool(makeScene());
    const a = pool.acquireSpark();
    expect(a).not.toBeNull();
    pool.release(a!);
    const b = pool.acquireSpark();
    expect(b).toBe(a);
  });

  test("released spark/shard/ring are HIDDEN (no styled junk pile at the origin)", () => {
    // Track L 2026-07-24 regression: resetCommon used to setVisible(true)
    // on release, parking every freed spark/shard/ring VISIBLE at (0,0)
    // with its last style (blastCircle/glow re-hid explicitly and were
    // immune). A recording scene catches the visible-state transitions.
    type Recorded = Stub & { visible?: boolean };
    const record = (s: Stub): Recorded => {
      const r = s as Recorded;
      const orig = r.setVisible;
      r.setVisible = (v: boolean) => {
        r.visible = v;
        return orig(v);
      };
      return r;
    };
    const scene = {
      add: {
        rectangle: () => record(makeStub()),
        circle: () => record(makeStub()),
        graphics: () => record(makeStub()),
        image: () => record(makeStub()),
      },
      textures: { exists: () => false, createCanvas: () => null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const pool = new ParticlePool(scene);
    const spark = pool.acquireSpark() as unknown as Recorded;
    const shard = pool.acquireShard() as unknown as Recorded;
    const ring = pool.acquireRing() as unknown as Recorded;
    expect(spark.visible).toBe(true);
    expect(shard.visible).toBe(true);
    expect(ring.visible).toBe(true);
    pool.release(spark as never);
    pool.release(shard as never);
    pool.release(ring as never);
    expect(spark.visible).toBe(false);
    expect(shard.visible).toBe(false);
    expect(ring.visible).toBe(false);
  });

  test("exhaustion returns null and warns once", () => {
    const pool = new ParticlePool(makeScene());
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      // Ambient acquires may drain the bolt pool only down to the kill
      // reserve (16 total − 2 reserved = 14 ambient).
      for (let i = 0; i < 14; i++) {
        const b = pool.acquireBolt();
        expect(b).not.toBeNull();
      }
      // Next two ambient attempts should each return null. One warn fires.
      expect(pool.acquireBolt()).toBeNull();
      expect(pool.acquireBolt()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = original;
    }
  });

  test("kill-tier bolt acquire may drain the reserve ambient spawns cannot touch (K10)", () => {
    const pool = new ParticlePool(makeScene());
    const original = console.warn;
    console.warn = mock(() => {});
    try {
      // Exhaust the ambient allowance.
      for (let i = 0; i < 14; i++) expect(pool.acquireBolt()).not.toBeNull();
      expect(pool.acquireBolt()).toBeNull();
      // Kill-tier spawns (the R1 row-17 shock ring) still get the reserved
      // tail — the kill moment must never lose the pool lottery to ambient
      // dust/ward chatter (proven starved on the K10 live tape).
      const k1 = pool.acquireBolt("kill");
      const k2 = pool.acquireBolt("kill");
      expect(k1).not.toBeNull();
      expect(k2).not.toBeNull();
      // A truly empty pool is empty for everyone.
      expect(pool.acquireBolt("kill")).toBeNull();
      // Releasing an ambient bolt refills the free list ABOVE the reserve
      // line only after the reserve itself is repaid: with 1 free, ambient
      // still starves while kill-tier succeeds.
      pool.release(k1!);
      expect(pool.acquireBolt()).toBeNull();
      expect(pool.acquireBolt("kill")).toBe(k1);
    } finally {
      console.warn = original;
    }
  });

  test("acquireBlastCircle returns distinct instances and release returns to free list", () => {
    const pool = new ParticlePool(makeScene());
    const a = pool.acquireBlastCircle();
    const b = pool.acquireBlastCircle();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    // Release a and re-acquire — should get back the same instance.
    pool.release(a!);
    const c = pool.acquireBlastCircle();
    expect(c).toBe(a);
  });

  test("acquireBlastCircle returns distinct instances and release returns to free list", () => {
    const pool = new ParticlePool(makeScene());
    const a = pool.acquireBlastCircle();
    const b = pool.acquireBlastCircle();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    // Release a and re-acquire — should get back the same instance.
    pool.release(a!);
    const c = pool.acquireBlastCircle();
    expect(c).toBe(a);
  });

  test("drainActive releases all active objects back to free list and kills tweens", () => {
    const killed: unknown[] = [];
    const scene = {
      ...makeScene(),
      tweens: {
        killTweensOf: (targets: unknown) => killed.push(targets),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const pool = new ParticlePool(scene);
    // Acquire several objects from different pools.
    const spark = pool.acquireSpark();
    const ring = pool.acquireRing();
    const bolt = pool.acquireBolt();
    expect(spark).not.toBeNull();
    expect(ring).not.toBeNull();
    expect(bolt).not.toBeNull();

    pool.drainActive(scene);

    // tweens.killTweensOf was called with an array containing the active objects.
    expect(killed.length).toBeGreaterThan(0);

    // After drain, the same objects should be re-acquirable (returned to free list).
    const spark2 = pool.acquireSpark();
    const ring2 = pool.acquireRing();
    expect(spark2).toBe(spark);
    expect(ring2).toBe(ring);
  });

  test("acquireGlow returns distinct instances and release pools them", () => {
    const pool = new ParticlePool(makeScene());
    const a = pool.acquireGlow();
    const b = pool.acquireGlow();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    pool.release(a!);
    const c = pool.acquireGlow();
    expect(c).toBe(a);
  });

  test("destroy cleans up free + active lists", () => {
    const pool = new ParticlePool(makeScene());
    const a = pool.acquireSpark() as unknown as Stub;
    const b = pool.acquireRing() as unknown as Stub;
    expect(a.destroyed).toBe(false);
    expect(b.destroyed).toBe(false);
    pool.destroy();
    expect(a.destroyed).toBe(true);
    expect(b.destroyed).toBe(true);
    // After destroy, acquire returns null.
    expect(pool.acquireSpark()).toBeNull();
  });
});
