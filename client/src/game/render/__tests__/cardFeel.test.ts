// Card pick juice must fire multi-layer reactions driven by card.visual.
// Drives the shipped playCardPickFeel entry point with mock deps (no Phaser).

import { describe, expect, test } from "bun:test";
import { playCardPickFeel, type CardFeelScene } from "../CardFeel.js";
import { crystalRoundsCards } from "../../../sim/data/cards.js";
import type { CardDefinition } from "../../../sim/data/cardTypes.js";
import { transientVfx } from "../TransientVfx.js";

function mockScene(): CardFeelScene & {
  _circles: unknown[];
  _rects: unknown[];
  tweens: { add: (opts: { onUpdate?: (tw: { progress: number }) => void; onComplete?: () => void }) => { progress: number } };
  events: { once: () => void };
} {
  const circles: unknown[] = [];
  const rects: unknown[] = [];
  const scene = {
    add: {
      circle: () => {
        const c = {
          setStrokeStyle: () => c,
          setDepth: () => c,
          setBlendMode: () => c,
          setRadius: () => c,
          setAlpha: () => c,
          destroy: () => {},
        };
        circles.push(c);
        return c;
      },
      rectangle: () => {
        const r = {
          setDepth: () => r,
          setBlendMode: () => r,
          setAlpha: () => r,
          setFillStyle: () => r,
          setScale: () => r,
          setPosition: () => r,
          destroy: () => {},
          rotation: 0,
          x: 0,
          y: 0,
        };
        rects.push(r);
        return r;
      },
    },
    tweens: {
      add: (opts: {
        onUpdate?: (tw: { progress: number }) => void;
        onComplete?: () => void;
      }) => {
        const tw = { progress: 1 };
        // Defer complete so TransientVfx can finish constructing `entry`
        // (real Phaser also completes asynchronously).
        queueMicrotask(() => {
          opts.onUpdate?.(tw);
          opts.onComplete?.();
        });
        return tw;
      },
      killTweensOf: () => {},
    },
    events: { once: () => {} },
    _circles: circles,
    _rects: rects,
  };
  return scene;
}

describe("playCardPickFeel (shipped entry)", () => {
  test("every crystalRounds card has visual identity used for color", () => {
    expect(crystalRoundsCards.length).toBeGreaterThan(20);
    for (const c of crystalRoundsCards) {
      expect(c.visual?.glowColor || c.visual?.particleColor, c.id).toBeTruthy();
    }
  });

  test("fires trauma + sfx + rig flash + world visuals for an arbitrary card", () => {
    const card = crystalRoundsCards.find((c) => c.id === "void-fracture")!;
    expect(card.visual?.glowColor).toBeTruthy();

    let trauma = 0;
    let sfxCalls = 0;
    let flashColor = 0;
    const scene = mockScene();
    // Bind transientVfx so spawn factories run against our mock scene.
    transientVfx.attach(scene as unknown as import("phaser").Scene);

    playCardPickFeel(card, {
      scene,
      pool: null,
      at: { x: 100, y: 200 },
      addTrauma: (a) => {
        trauma += a;
      },
      playCardSfx: () => {
        sfxCalls += 1;
      },
      flashLocalRig: (c) => {
        flashColor = c;
      },
    });

    // Multi-layer stack: trauma + sfx + rig + graphics (rings/shards)
    expect(trauma).toBeGreaterThan(0);
    expect(sfxCalls).toBe(1);
    expect(flashColor).toBeGreaterThan(0);
    // parseHex of void purple
    expect(flashColor).toBe(0xa78bfa);
    const gfx = scene._circles.length + scene._rects.length;
    expect(gfx).toBeGreaterThan(3);
    transientVfx.drainAll();
  });

  test("legendary scales trauma harder than common", () => {
    const common: CardDefinition = {
      id: "c-test",
      name: "C",
      category: "utility",
      rarity: "common",
      description: "x",
      visual: { iconShape: "circle", glowColor: "#ffffff", particleColor: "#ffffff" },
      modifier: { fireRateMultiplier: 1.05 },
    };
    const legendary: CardDefinition = {
      ...common,
      id: "l-test",
      rarity: "legendary",
    };
    let tCommon = 0;
    let tLeg = 0;
    const scene = mockScene();
    transientVfx.attach(scene as unknown as import("phaser").Scene);
    playCardPickFeel(common, {
      scene,
      pool: null,
      at: { x: 0, y: 0 },
      addTrauma: (a) => {
        tCommon = a;
      },
    });
    playCardPickFeel(legendary, {
      scene,
      pool: null,
      at: { x: 0, y: 0 },
      addTrauma: (a) => {
        tLeg = a;
      },
    });
    expect(tLeg).toBeGreaterThan(tCommon);
    transientVfx.drainAll();
  });
});
