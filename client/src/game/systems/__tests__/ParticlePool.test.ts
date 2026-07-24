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
      // reserve (24 total — Interstice I5 bump — − 2 reserved = 22 ambient).
      for (let i = 0; i < 22; i++) {
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
      for (let i = 0; i < 22; i++) expect(pool.acquireBolt()).not.toBeNull();
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

  test("an ambient exhaustion warning never silences a later kill-tier exhaustion warning (Interstice wave 3)", () => {
    // Before this fix, `warned: Set<PoolName>` fired once EVER per pool
    // name — since ambient demand always exhausts a pool first (it's the
    // vastly more common acquire path), the one warning that actually
    // matters (kill-tier hitting a truly empty reserve) would be
    // permanently suppressed by the routine ambient one that came first.
    const pool = new ParticlePool(makeScene());
    const warnCalls: string[] = [];
    const original = console.warn;
    console.warn = mock((msg: string) => { warnCalls.push(msg); });
    try {
      // Drain to the ambient floor (22 = 24 total - 2 reserve) -> one
      // ambient warning fires.
      for (let i = 0; i < 22; i++) pool.acquireBolt();
      pool.acquireBolt(); // ambient: warns once
      expect(warnCalls.length).toBe(1);
      expect(warnCalls[0]).toContain("bolt pool exhausted; skipping spawn");
      // Drain the reserve itself with kill-tier acquires, then push past
      // empty — this MUST produce its own, separate, more alarming warning.
      pool.acquireBolt("kill");
      pool.acquireBolt("kill");
      pool.acquireBolt("kill"); // truly empty now — kill-tier warns
      expect(warnCalls.length).toBe(2);
      expect(warnCalls[1]).toContain("KILL-TIER");
      // Both are now suppressed on repeat (each key warns once).
      pool.acquireBolt();
      pool.acquireBolt("kill");
      expect(warnCalls.length).toBe(2);
    } finally {
      console.warn = original;
    }
  });

  // These two deliberately don't hardcode the exact reserve size (an
  // independently-tunable constant — see ParticlePool's own
  // blastCircleKillReserve/sparkKillReserve docblock) — they drain ambient
  // acquires until the reserve floor stops them, THEN prove the invariant
  // that actually matters: kill-tier can still dip into that exact floor.
  test("kill-tier spark acquire may drain the reserve ambient spawns cannot touch (Interstice wave 3 — universal player-killed blast)", () => {
    const pool = new ParticlePool(makeScene());
    const original = console.warn;
    console.warn = mock(() => {});
    try {
      let n = 0;
      while (pool.acquireSpark() !== null) n++;
      expect(n).toBeGreaterThan(0); // ambient legitimately acquired some
      expect(pool.acquireSpark()).toBeNull(); // floor holds on repeat
      // The universal kill blast (spawnBlastAtPlayer(..., "kill") ->
      // RenderLayer.spawnExplosionBlast -> spawnBlastSparks) still gets the
      // reserved tail — every kill in the game (both classes) depends on
      // this read; ambient status-VFX churn must never starve it.
      let killN = 0;
      while (pool.acquireSpark("kill") !== null) killN++;
      expect(killN).toBeGreaterThan(0); // the reserve had real capacity for kills
      expect(pool.acquireSpark("kill")).toBeNull(); // a truly empty pool is empty for everyone
    } finally {
      console.warn = original;
    }
  });

  test("kill-tier blastCircle acquire may drain the reserve ambient spawns cannot touch (Interstice wave 3 — universal player-killed blast)", () => {
    const pool = new ParticlePool(makeScene());
    const original = console.warn;
    console.warn = mock(() => {});
    try {
      let n = 0;
      while (pool.acquireBlastCircle() !== null) n++;
      expect(n).toBeGreaterThan(0);
      expect(pool.acquireBlastCircle()).toBeNull();
      let killN = 0;
      while (pool.acquireBlastCircle("kill") !== null) killN++;
      expect(killN).toBeGreaterThan(0);
      expect(pool.acquireBlastCircle("kill")).toBeNull();
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
