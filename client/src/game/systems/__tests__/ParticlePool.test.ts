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

  test("exhaustion returns null and warns once", () => {
    const pool = new ParticlePool(makeScene());
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      // Drain the bolt pool (size 4 — smallest, easiest to exhaust).
      for (let i = 0; i < 4; i++) {
        const b = pool.acquireBolt();
        expect(b).not.toBeNull();
      }
      // Next two attempts should each return null. Only one warn fires.
      expect(pool.acquireBolt()).toBeNull();
      expect(pool.acquireBolt()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
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
