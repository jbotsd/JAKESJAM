// RenderLayer tests. Each method is "given a position, paint a thing" so we
// only need to verify the GameObject factory is called with the right shape
// and a tween is registered. We mock scene.add + scene.tweens minimally to
// stay Phaser-runtime-free.

import { describe, expect, test } from "bun:test";
import { RenderLayer } from "../RenderLayer";
import { ParticlePool } from "../../systems/ParticlePool";

type Stub = {
  rotation: number;
  x: number;
  y: number;
  setStrokeStyle: () => Stub;
  setOrigin: () => Stub;
  setDepth: () => Stub;
  destroy: () => void;
  destroyed: boolean;
};

function makeStub(x = 0, y = 0): Stub {
  const s: Stub = {
    rotation: 0,
    x,
    y,
    setStrokeStyle: () => s,
    setOrigin: () => s,
    setDepth: () => s,
    destroyed: false,
    destroy: () => {
      s.destroyed = true;
    },
  };
  return s;
}

interface AddCall { name: string; args: unknown[]; }
interface TweenCall { config: { duration: number; onComplete?: () => void } & Record<string, unknown>; }

function makeScene() {
  const adds: AddCall[] = [];
  const tweens: TweenCall[] = [];
  const scene = {
    add: {
      circle: (x: number, y: number, ..._rest: unknown[]) => {
        adds.push({ name: "circle", args: [x, y, ..._rest] });
        return makeStub(x, y);
      },
      rectangle: (x: number, y: number, ..._rest: unknown[]) => {
        adds.push({ name: "rectangle", args: [x, y, ..._rest] });
        return makeStub(x, y);
      },
      text: (x: number, y: number, ..._rest: unknown[]) => {
        adds.push({ name: "text", args: [x, y, ..._rest] });
        return makeStub(x, y);
      },
    },
    tweens: {
      add: (config: TweenCall["config"]) => {
        tweens.push({ config });
        return undefined;
      },
    },
    __adds: adds,
    __tweens: tweens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return scene;
}

describe("RenderLayer", () => {
  test("spawnPlayerDeathExplosion creates big-blast + ring + 18 shards + spike rects", () => {
    const scene = makeScene();
    new RenderLayer(scene).spawnPlayerDeathExplosion({ x: 50, y: 60 });
    const circles = scene.__adds.filter((c: AddCall) => c.name === "circle").length;
    const rects = scene.__adds.filter((c: AddCall) => c.name === "rectangle").length;
    // Big blast (no pool): 1 fallback circle + 16 spike rects.
    // Ring blast: 1 circle.  Shards: 18 rects.
    expect(circles).toBe(2); // big-blast circle + ring
    expect(rects).toBe(34);  // 16 spikes + 18 shards
    // Tweens: 1 big-blast tween + 16 spike tweens + 1 ring tween + 18 shard tweens = 36
    expect(scene.__tweens.length).toBe(36);
  });

  test("spawnRespawnBurst creates exactly one ring + tween", () => {
    const scene = makeScene();
    new RenderLayer(scene).spawnRespawnBurst({ x: 0, y: 0 });
    expect(scene.__adds.length).toBe(1);
    expect(scene.__tweens.length).toBe(1);
    expect(scene.__tweens[0].config.duration).toBe(360);
  });

  test("destructibleBurst spawns 8 directional shards", () => {
    const scene = makeScene();
    new RenderLayer(scene).destructibleBurst({ x: 100, y: 100 }, "box", "neutral");
    expect(scene.__adds.filter((c: AddCall) => c.name === "rectangle").length).toBe(8);
    expect(scene.__tweens.length).toBe(8);
  });

  test("flashDestructibleText skips spawning when amount<1 still spawns text", () => {
    // Note: floor of round(0) = 0 is still drawn — we just want to confirm
    // a text is registered with the right offset (above the destructible).
    const scene = makeScene();
    new RenderLayer(scene).flashDestructibleText({ x: 200, y: 300 }, 40, 17, "fire");
    expect(scene.__adds.length).toBe(1);
    expect(scene.__adds[0].name).toBe("text");
    // y should be position.y - sizeY/2 - 10 = 300 - 20 - 10 = 270
    expect(scene.__adds[0].args[1]).toBe(270);
    // amount text "17"
    expect(scene.__adds[0].args[2]).toBe("17");
  });

  test("spawnDamageNumber early-returns when amount<1", () => {
    const scene = makeScene();
    new RenderLayer(scene).spawnDamageNumber({ x: 0, y: 0 }, 0.4, true);
    expect(scene.__adds.length).toBe(0);
    expect(scene.__tweens.length).toBe(0);
  });

  test("killTargetBurst clamps radius to at least 90", () => {
    const scene = makeScene();
    new RenderLayer(scene).killTargetBurst({ x: 10, y: 10 }, 12);
    expect(scene.__tweens.length).toBe(1);
    expect(scene.__tweens[0].config.radius).toBe(90);

    const scene2 = makeScene();
    new RenderLayer(scene2).killTargetBurst({ x: 0, y: 0 }, 200);
    expect(scene2.__tweens[0].config.radius).toBe(200);
  });

  test("spawnExplosionBlast tweens to the requested radius", () => {
    const scene = makeScene();
    new RenderLayer(scene).spawnExplosionBlast({ x: 0, y: 0 }, 64);
    expect(scene.__tweens.length).toBe(1);
    expect(scene.__tweens[0].config.radius).toBe(64);
    expect(scene.__tweens[0].config.duration).toBe(260);
  });

  // Interstice wave 3 (pool-stress item): spawnExplosionBlast's pooled path
  // (blastCircle + spark) is the universal "someone died here" read every
  // kill in the game depends on. This proves the "kill" tier ACTUALLY
  // reaches ParticlePool.acquireBlastCircle/acquireSpark through RenderLayer
  // (spawnExplosionBlast -> spawnExplosionBlastBig -> spawnBloomLayers/
  // spawnBlastSparks), closing the one hop ParticlePool.test.ts (pool-level)
  // and simEventRouter.test.ts (dispatch-level) don't individually cover.
  describe("spawnExplosionBlast — pooled path threads the kill-tier reserve (Interstice wave 3)", () => {
    function makeParticlePoolScene() {
      const stub = () => ({
        setVisible: () => stub(),
        setAlpha: () => stub(),
        setScale: () => stub(),
        setRotation: () => stub(),
        setPosition: () => stub(),
        setBlendMode: () => stub(),
        setTint: () => stub(),
        setFillStyle: () => stub(),
        setRadius: () => stub(),
        setStrokeStyle: () => stub(),
        clear: () => stub(),
        destroy: () => undefined,
      });
      return {
        add: {
          rectangle: () => stub(),
          circle: () => stub(),
          graphics: () => stub(),
        },
        textures: { exists: () => false, createCanvas: () => ({ context: {}, refresh: () => undefined }) },
        // Deliberately does NOT invoke onComplete — acquired pool objects
        // must stay "active" (not auto-released) so this test can observe
        // free-list draining under acquisition, not the release cycle.
        tweens: { add: () => undefined },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }

    test("ambient blast (hit-confirmed) cannot dip into the reserve; kill-tier blast can", () => {
      // Deliberately does NOT hardcode the exact reserve size (it's an
      // internal, independently-tunable constant — see ParticlePool's own
      // blastCircleKillReserve docblock) — this drains ambient acquires
      // until they stop succeeding, THEN proves the invariant that
      // actually matters: a kill-tier blast still gets through, and it
      // measurably dips below whatever floor ambient hit.
      const scene = makeParticlePoolScene();
      const pool = new ParticlePool(scene);
      const layer = new RenderLayer(scene, pool);
      const original = console.warn;
      console.warn = () => {};
      try {
        // Drain ambient hit-confirmed-style blasts (damage <= 25, so
        // isBig=false -> ONE spawnBloomLayers call = 5 blastCircle each)
        // until the reserve floor stops any further ambient acquisition.
        const freeCount = () => (pool as unknown as { blastCircleFree: unknown[] }).blastCircleFree.length;
        let before = freeCount();
        for (let i = 0; i < 20; i++) {
          layer.spawnExplosionBlast({ x: 0, y: 0 }, 22, 20); // ambient, wants 5
          const now = freeCount();
          if (now === before) break; // no progress -> ambient hit the reserve floor
          before = now;
        }
        const reserveFloor = freeCount();
        expect(reserveFloor).toBeGreaterThan(0); // the reserve itself is intact, untouched by ambient
        // One more ambient attempt makes zero further progress — proves
        // the floor holds, not just "got lucky on the last iteration".
        layer.spawnExplosionBlast({ x: 0, y: 0 }, 22, 20);
        expect(freeCount()).toBe(reserveFloor);
        // Now the REAL player-killed blast (tier="kill") must still be
        // able to dip into that exact protected floor even though ambient
        // could not touch it.
        layer.spawnExplosionBlast({ x: 0, y: 0 }, 36, 50, "kill");
        expect(freeCount()).toBeLessThan(reserveFloor);
      } finally {
        console.warn = original;
      }
    });
  });
});
