// Per-card juice when a draft pick resolves (or local confirm).
//
// Law (game-feel-juice): every meaningful event gets ≥3 of hit-stop-ish
// flash, shake, particles, audio, color flash, scale punch.
// Render-only — never touches sim. Every CardDefinition has `visual`
// (glowColor / particleColor / iconShape); we use those so each card
// reads as itself, not a generic "card got" pop.

// Phaser-free at import (bun:test) — scene is structural; blend mode ADD = 1.
import type { CardDefinition } from "../../sim/data/cardTypes.js";
import type { ParticlePool } from "../systems/ParticlePool";
import { transientVfx } from "./TransientVfx";

/** Minimal scene surface used for world bursts (no full Phaser import). */
export type CardFeelScene = {
  add: {
    circle: (
      x: number,
      y: number,
      r: number,
      color: number,
      alpha: number,
    ) => CardFeelGfx;
    rectangle: (
      x: number,
      y: number,
      w: number,
      h: number,
      color: number,
      alpha: number,
    ) => CardFeelGfx;
  };
};

export type CardFeelGfx = {
  setStrokeStyle?: (w: number, color: number, alpha: number) => unknown;
  setDepth: (d: number) => unknown;
  setBlendMode: (m: number | string) => unknown;
  setRadius?: (r: number) => unknown;
  setAlpha: (a: number) => unknown;
  setFillStyle?: (c: number, a: number) => unknown;
  setScale?: (s: number) => unknown;
  setPosition?: (x: number, y: number) => unknown;
  rotation?: number;
  x?: number;
  y?: number;
  destroy?: () => void;
};

export type CardFeelDeps = {
  scene: CardFeelScene;
  pool: ParticlePool | null;
  /** World position to explode at (usually local player). */
  at: { x: number; y: number };
  /** Trauma 0–1 (ActionCamera / CameraJuice). */
  addTrauma?: (amount: number) => void;
  /** Optional audio — 'card' cue already exists on ProceduralAudio. */
  playCardSfx?: (rarity: CardDefinition["rarity"], category: CardDefinition["category"]) => void;
  /** Flash the local player rig with card glow. */
  flashLocalRig?: (color: number) => void;
};

function parseHex(hex: string | undefined, fallback = 0x8ff8ff): number {
  if (!hex) return fallback;
  const s = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = Number.parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
  return Number.isFinite(n) ? n : fallback;
}

/** Rarity → juice scale. Legendary punches hardest. */
function rarityScale(r: CardDefinition["rarity"]): number {
  switch (r) {
    case "common":
      return 0.7;
    case "uncommon":
      return 0.9;
    case "rare":
      return 1.15;
    case "legendary":
      return 1.45;
    case "cursed":
      return 1.3;
    default:
      return 1;
  }
}

/**
 * Fire the full pick stack for ANY card. Category tweaks the motion of
 * particles (weapon = outward fan, movement = upward, defense = ring, …)
 * but every card always gets particles + trauma + sfx + rig flash.
 */
export function playCardPickFeel(card: CardDefinition, deps: CardFeelDeps): void {
  const scale = rarityScale(card.rarity);
  const color = parseHex(card.visual?.particleColor ?? card.visual?.glowColor);
  const { x, y } = deps.at;

  // 1. Camera trauma (bigger for rarer)
  deps.addTrauma?.(0.12 * scale);

  // 2. Audio
  deps.playCardSfx?.(card.rarity, card.category);

  // 3. Rig flash in card glow
  deps.flashLocalRig?.(color);

  // 4. Particle burst (shape/category flavored)
  const count = Math.round(10 * scale);
  if (deps.pool) {
    spawnPoolBurst(deps.pool, x, y, color, count, card.category);
  } else {
    spawnTransientBurst(deps.scene, x, y, color, count, card.category);
  }

  // 5. Expanding ring (defense / legendary get a second ring)
  spawnRing(deps.scene, x, y, color, 28 + 18 * scale, 220 + 80 * scale);
  if (card.category === "defense" || card.rarity === "legendary") {
    spawnRing(deps.scene, x, y, color, 48 + 24 * scale, 320 + 60 * scale);
  }

  // 6. Category signature extras
  if (card.category === "movement") {
    // Upward whoosh of shards
    spawnDirectional(deps.scene, x, y, color, -Math.PI / 2, 8, 90);
  } else if (card.category === "weapon" || card.category === "projectile") {
    // Fan along aim-right as default (reads as "armed")
    spawnDirectional(deps.scene, x, y, color, 0, 10, 110);
  } else if (card.category === "utility" || card.category === "tradeoff") {
    spawnDirectional(deps.scene, x, y, color, Math.PI * 0.25, 6, 70);
  }
}

const BLEND_ADD = 1;

function spawnPoolBurst(
  pool: ParticlePool,
  x: number,
  y: number,
  color: number,
  count: number,
  category: CardDefinition["category"],
): void {
  for (let i = 0; i < count; i++) {
    const spark = pool.acquireSpark() as CardFeelGfx | null;
    if (!spark) break;
    const ang =
      category === "movement"
        ? -Math.PI / 2 + (Math.random() - 0.5) * 1.2
        : (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const dist = 24 + Math.random() * 48;
    const sx = x;
    const sy = y;
    const tx = x + Math.cos(ang) * dist;
    const ty = y + Math.sin(ang) * dist;
    spark.setPosition?.(sx, sy);
    spark.setFillStyle?.(color, 0.95);
    spark.setScale?.(1);
    spark.setAlpha(0.95);
    transientVfx.spawn({
      factory: () => spark as unknown as Phaser.GameObjects.GameObject,
      lifetimeMs: 280 + Math.random() * 160,
      startAlpha: 0.95,
      ease: "Sine.easeOut",
      onTick: (obj, t) => {
        const s = obj as unknown as CardFeelGfx;
        if (s.x !== undefined) s.x = sx + (tx - sx) * t;
        if (s.y !== undefined) s.y = sy + (ty - sy) * t;
        s.setAlpha(0.95 * (1 - t));
        s.setScale?.(1 - t * 0.5);
      },
    });
  }
}

function spawnTransientBurst(
  scene: CardFeelScene,
  x: number,
  y: number,
  color: number,
  count: number,
  _category: CardDefinition["category"],
): void {
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count;
    const dist = 30 + Math.random() * 40;
    const tx = x + Math.cos(ang) * dist;
    const ty = y + Math.sin(ang) * dist;
    transientVfx.spawn({
      factory: () => {
        const r = scene.add.rectangle(x, y, 3, 10, color, 0.9);
        r.setDepth(30);
        r.setBlendMode(BLEND_ADD);
        r.rotation = ang;
        return r as unknown as Phaser.GameObjects.GameObject;
      },
      lifetimeMs: 260,
      startAlpha: 0.9,
      onTick: (obj, t) => {
        const r = obj as unknown as CardFeelGfx;
        if (r.x !== undefined) r.x = x + (tx - x) * t;
        if (r.y !== undefined) r.y = y + (ty - y) * t;
        r.setAlpha(0.9 * (1 - t));
      },
    });
  }
}

function spawnRing(
  scene: CardFeelScene,
  x: number,
  y: number,
  color: number,
  endR: number,
  lifeMs: number,
): void {
  transientVfx.spawn({
    factory: () => {
      const c = scene.add.circle(x, y, 6, color, 0);
      c.setStrokeStyle?.(2, color, 0.9);
      c.setDepth(29);
      c.setBlendMode(BLEND_ADD);
      return c as unknown as Phaser.GameObjects.GameObject;
    },
    lifetimeMs: lifeMs,
    startAlpha: 0.9,
    onTick: (obj, t) => {
      const c = obj as unknown as CardFeelGfx;
      c.setRadius?.(6 + (endR - 6) * t);
      c.setAlpha(0.9 * (1 - t));
    },
  });
}

function spawnDirectional(
  scene: CardFeelScene,
  x: number,
  y: number,
  color: number,
  baseAng: number,
  n: number,
  dist: number,
): void {
  for (let i = 0; i < n; i++) {
    const ang = baseAng + (Math.random() - 0.5) * 0.9;
    const d = dist * (0.5 + Math.random());
    const tx = x + Math.cos(ang) * d;
    const ty = y + Math.sin(ang) * d;
    transientVfx.spawn({
      factory: () => {
        const r = scene.add.rectangle(x, y, 2, 12, color, 0.85);
        r.setDepth(30);
        r.setBlendMode(BLEND_ADD);
        r.rotation = ang;
        return r as unknown as Phaser.GameObjects.GameObject;
      },
      lifetimeMs: 220,
      startAlpha: 0.85,
      onTick: (obj, t) => {
        const r = obj as unknown as CardFeelGfx;
        if (r.x !== undefined) r.x = x + (tx - x) * t;
        if (r.y !== undefined) r.y = y + (ty - y) * t;
        r.setAlpha(0.85 * (1 - t));
      },
    });
  }
}
