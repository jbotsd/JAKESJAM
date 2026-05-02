// RenderLayer tests. Each method is "given a position, paint a thing" so we
// only need to verify the GameObject factory is called with the right shape
// and a tween is registered. We mock scene.add + scene.tweens minimally to
// stay Phaser-runtime-free.

import { describe, expect, test } from "bun:test";
import { RenderLayer } from "../RenderLayer";

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
});
