// cardIcons tests — verify signature dispatch and bucket-glyph fallback.
//
// Phaser-runtime-free: we mock scene.add.graphics minimally.
// BlendModes is used as a constant so we stub it as well.

import { describe, expect, test } from "bun:test";
import { drawSignatureIcon, drawBucketIcon } from "../cardIcons";

// ── Minimal Phaser mock ───────────────────────────────────────────────────────

function makeGraphicsStub() {
  return {
    clear: () => {},
    fillStyle: () => {},
    lineStyle: () => {},
    fillCircle: () => {},
    strokeCircle: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fillPoints: () => {},
    strokePoints: () => {},
    fillTriangle: () => {},
    strokeTriangle: () => {},
    setBlendMode: (_mode: unknown) => makeGraphicsStub(),
    setAlpha: (_a: unknown) => makeGraphicsStub(),
  };
}

type FakeScene = {
  add: {
    graphics: (config?: { x?: number; y?: number }) => ReturnType<typeof makeGraphicsStub>;
  };
  __graphicsCallCount: number;
};

function makeScene(): FakeScene {
  let count = 0;
  const scene: FakeScene = {
    __graphicsCallCount: 0,
    add: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      graphics: (_config?: { x?: number; y?: number }) => {
        count++;
        scene.__graphicsCallCount = count;
        return makeGraphicsStub();
      },
    },
  };
  return scene;
}

// Stub Phaser.BlendModes.ADD (just needs to be a value — number is fine)
// The actual import resolves via the Phaser peer dep; we mock at module level
// by patching the global before the import.  But since bun resolves ESM at
// import time we instead rely on the fact that BlendModes.ADD is used only
// inside setBlendMode() which our stub accepts any value for.

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("drawSignatureIcon", () => {
  test("frost-prism returns [glowGfx, iconGfx] (2 objects)", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawSignatureIcon(scene as any, 0, 0, "frost-prism", "ice", "uncommon", 80);
    expect(result.length).toBe(2);
    expect(scene.__graphicsCallCount).toBe(2);
  });

  test("molten-core returns 2 objects", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawSignatureIcon(scene as any, 0, 0, "molten-core", "fire", "uncommon", 80);
    expect(result.length).toBe(2);
  });

  test("voltaic-spark returns 2 objects", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawSignatureIcon(scene as any, 0, 0, "voltaic-spark", "lightning", "rare", 80);
    expect(result.length).toBe(2);
  });

  test("void-fracture returns 2 objects", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawSignatureIcon(scene as any, 0, 0, "void-fracture", "void", "rare", 80);
    expect(result.length).toBe(2);
  });

  test("radiant-overload returns 2 objects", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawSignatureIcon(scene as any, 0, 0, "radiant-overload", "radiant", "rare", 80);
    expect(result.length).toBe(2);
  });

  test("cataclysmic-prism returns 2 objects", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawSignatureIcon(scene as any, 0, 0, "cataclysmic-prism", "radiant", "legendary", 80);
    expect(result.length).toBe(2);
  });

  test("unknown card id returns empty array (bucket-glyph fallback)", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawSignatureIcon(scene as any, 0, 0, "circle-rounds", undefined, "common", 80);
    expect(result.length).toBe(0);
    expect(scene.__graphicsCallCount).toBe(0);
  });

  test("extra-bounce (common, no signature) returns empty array", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawSignatureIcon(scene as any, 0, 0, "extra-bounce", undefined, "common", 80);
    expect(result.length).toBe(0);
  });
});

describe("drawBucketIcon with cardId", () => {
  test("frost-prism uses signature path — returns exactly 2 GameObjects", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawBucketIcon(scene as any, 0, 0, "element", "ice", "uncommon", 100, undefined, "frost-prism");
    expect(result.length).toBe(2);
    expect(scene.__graphicsCallCount).toBe(2);
  });

  test("circle-rounds (no signature) falls back to bucket-glyph — still returns 2 objects", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawBucketIcon(scene as any, 0, 0, "shape", undefined, "common", 100, "circle", "circle-rounds");
    expect(result.length).toBe(2);
    expect(scene.__graphicsCallCount).toBe(2);
  });

  test("no cardId provided — still returns 2 objects (bucket-glyph path)", () => {
    const scene = makeScene();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = drawBucketIcon(scene as any, 0, 0, "impact", undefined, "uncommon", 80);
    expect(result.length).toBe(2);
  });
});
