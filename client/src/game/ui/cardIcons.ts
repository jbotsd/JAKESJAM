// Per-bucket geometric glyph icons drawn at runtime via Phaser Graphics.
// No asset files — all shapes are constructed programmatically.
//
// drawBucketIcon returns an array of GameObjects (glow first, icon on top)
// so the caller can add them to a Container in the right depth order.

// `import type` keeps Phaser bundle out of Bun headless test runtime.
// BlendModes.ADD is inlined as a constant (stable across Phaser 3→4).
import type Phaser from "phaser";

/** BLEND_MODE_ADD — inlined to avoid runtime Phaser import in tests. */
const BLEND_MODE_ADD = 1;
import type { WeaponBucket } from "../../sim/data/cardTypes";
import type { ElementType, ProjectileShape } from "../../sim/types";
import { ELEMENT_COLORS, NEUTRAL_ELEMENTS } from "./elementColors";
import {
  drawIcon_frostPrism,
  drawIcon_moltenCore,
  drawIcon_voltaicSpark,
  drawIcon_voidFracture,
  drawIcon_radiantOverload,
  drawIcon_cataclysmicPrism,
  drawIcon_homingCluster,
  drawIcon_overcharge,
  drawIcon_mirrorShield,
  drawIcon_pierceChain,
  drawIcon_shardBloom,
  drawIcon_clusterBomb,
  drawIcon_seekerFacets,
  drawIcon_stickyRay,
  drawIcon_orbyBlapBlap,
} from "./signatureIcons";

export type CardRarity = "common" | "uncommon" | "rare" | "legendary" | "cursed";

/** Point literal — keeps polygon arrays terse. Typed as Vector2 for fillPoints/strokePoints
 *  compatibility; plain {x,y} object works at runtime. */
function v(x: number, y: number): Phaser.Math.Vector2 {
  return { x, y } as unknown as Phaser.Math.Vector2;
}

// ── Color helpers ────────────────────────────────────────────────────────────

export function getRarityColor(rarity: CardRarity): number {
  switch (rarity) {
    case "legendary": return 0xfb923c;
    case "rare":      return 0xa78bfa;
    case "uncommon":  return 0x4ade80;
    case "cursed":    return 0xfb7185;
    default:          return 0x9aa5b1; // common / gray
  }
}

function iconFillColor(
  element: ElementType | undefined,
  rarity: CardRarity,
): number {
  if (element && !NEUTRAL_ELEMENTS.has(element)) {
    return ELEMENT_COLORS[element];
  }
  return getRarityColor(rarity);
}

// ── Signature icon dispatch ──────────────────────────────────────────────────

/**
 * Attempt to draw a "signature" (character-art) icon for a named card.
 *
 * Returns `[glowGfx, iconGfx]` when a signature exists for `cardId`, or an
 * empty array when no signature is registered (caller should fall back to
 * `drawBucketIcon`'s geometric glyph path).
 *
 * Glow layer: additive blend, 0.28 alpha, same draw function at 1.4× radius.
 */
export function drawSignatureIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  cardId: string,
  element: ElementType | undefined,
  rarity: CardRarity,
  size: number,
): Phaser.GameObjects.GameObject[] {
  const fill   = iconFillColor(element, rarity);
  const stroke = getRarityColor(rarity);
  const r      = size * 0.5;

  type DrawFn = (
    g: Phaser.GameObjects.Graphics,
    radius: number,
    fill: number,
    stroke: number,
  ) => void;

  let drawFn: DrawFn | null = null;

  switch (cardId) {
    case "frost-prism":         drawFn = drawIcon_frostPrism;        break;
    case "molten-core":         drawFn = drawIcon_moltenCore;         break;
    case "voltaic-spark":       drawFn = drawIcon_voltaicSpark;       break;
    case "void-fracture":       drawFn = drawIcon_voidFracture;       break;
    case "radiant-overload":    drawFn = drawIcon_radiantOverload;    break;
    case "cataclysmic-prism":   drawFn = drawIcon_cataclysmicPrism;   break;
    case "homing-cluster":      drawFn = drawIcon_homingCluster;      break;
    case "overcharge":          drawFn = drawIcon_overcharge;         break;
    case "mirror-shield":       drawFn = drawIcon_mirrorShield;       break;
    case "pierce-chain":        drawFn = drawIcon_pierceChain;        break;
    case "shard-bloom":         drawFn = drawIcon_shardBloom;         break;
    case "cluster-bomb":        drawFn = drawIcon_clusterBomb;        break;
    case "seeker-facets":       drawFn = drawIcon_seekerFacets;       break;
    case "sticky-ray":          drawFn = drawIcon_stickyRay;          break;
    case "orby-blap-blap":      drawFn = drawIcon_orbyBlapBlap;       break;
    default:                    drawFn = null;
  }

  if (drawFn === null) {
    return [];
  }

  // Glow layer
  const glow = scene.add.graphics({ x, y });
  glow.setBlendMode(BLEND_MODE_ADD);
  glow.setAlpha(0.28);
  drawFn(glow, r * 1.4, fill, fill);

  // Crisp icon layer
  const icon = scene.add.graphics({ x, y });
  drawFn(icon, r, fill, stroke);

  return [glow, icon];
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Draw a bucket-specific geometric icon at (x, y) and return [glowGfx, iconGfx].
 *
 * `size` is the outer bounding-box diameter (e.g. 100 → icon fits inside a
 * 100×100 box).  Caller is responsible for adding the returned objects to a
 * Container (glow at index 0 so it renders behind the crisp icon).
 *
 * If `iconShape` is provided and is a recognised ProjectileShape, it takes
 * priority over the bucket fallback.
 *
 * When `cardId` is provided and matches a known signature, the signature icon
 * is returned instead of the generic bucket glyph.
 */
export function drawBucketIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  bucket: WeaponBucket | undefined,
  element: ElementType | undefined,
  rarity: CardRarity,
  size: number,
  iconShape?: ProjectileShape,
  cardId?: string,
): Phaser.GameObjects.GameObject[] {
  // Signature icon takes priority — richer character art over generic geometry.
  if (cardId !== undefined) {
    const sig = drawSignatureIcon(scene, x, y, cardId, element, rarity, size);
    if (sig.length > 0) {
      return sig;
    }
  }

  const fill   = iconFillColor(element, rarity);
  const stroke = getRarityColor(rarity);
  const r      = size * 0.5; // radius / half-size

  // Glow: additive, low alpha, scaled up 1.4×
  const glow = scene.add.graphics({ x, y });
  glow.setBlendMode(BLEND_MODE_ADD);
  glow.setAlpha(0.28);

  // Icon (crisp, full alpha)
  const icon = scene.add.graphics({ x, y });

  // Decide which glyph to draw
  const shape = resolveShape(iconShape, bucket);
  drawGlyph(icon, shape, r, fill, stroke);

  // Draw the same glyph on the glow layer at 1.4× scale
  drawGlyph(glow, shape, r * 1.4, fill, fill); // stroke same as fill for soft bloom

  return [glow, icon];
}

// ── Shape resolver ───────────────────────────────────────────────────────────

type GlyphKey =
  | "diamond"
  | "hexagon"
  | "fan-squares"
  | "starburst"
  | "prism"
  | "square"
  | "gear"
  | "rotated-rect"
  | "circle"
  | "triangle"
  | "x-shape"
  | "bar";

function resolveShape(
  iconShape: ProjectileShape | undefined,
  bucket: WeaponBucket | undefined,
): GlyphKey {
  // iconShape takes priority when it maps to a distinct glyph
  if (iconShape) {
    switch (iconShape) {
      case "circle":   return "circle";
      case "triangle": return "triangle";
      case "square":   return "square";
      case "hexagon":  return "hexagon";
      case "orb":      return "circle";
      case "x":        return "x-shape";
      case "bar":      return "bar";
    }
  }

  // Bucket fallback
  switch (bucket) {
    case "delivery":    return "diamond";
    case "trajectory":  return "hexagon";
    case "quantity":    return "fan-squares";
    case "impact":      return "starburst";
    case "element":     return "prism";
    case "shape":       return "square";
    case "utility":     return "gear";
    default:            return "rotated-rect";
  }
}

// ── Glyph drawers ────────────────────────────────────────────────────────────

const LINE_WIDTH = 2.5;

function drawGlyph(
  g: Phaser.GameObjects.Graphics,
  shape: GlyphKey,
  r: number, // half-size / radius
  fill: number,
  stroke: number,
): void {
  g.clear();

  switch (shape) {
    case "diamond":
      drawDiamond(g, r, fill, stroke);
      break;
    case "hexagon":
      drawPolygon(g, 6, r * 0.9, 0, fill, stroke);
      break;
    case "fan-squares":
      drawFanSquares(g, r, fill, stroke);
      break;
    case "starburst":
      drawStarburst(g, r, fill, stroke);
      break;
    case "prism":
      drawPrism(g, r, fill, stroke);
      break;
    case "square":
      drawSquare(g, r * 0.85, fill, stroke);
      break;
    case "gear":
      drawGear(g, r, fill, stroke);
      break;
    case "circle":
      drawCircle(g, r * 0.85, fill, stroke);
      break;
    case "triangle":
      drawPolygon(g, 3, r * 0.9, -Math.PI / 2, fill, stroke);
      break;
    case "x-shape":
      drawXShape(g, r, fill, stroke);
      break;
    case "bar":
      drawBar(g, r, fill, stroke);
      break;
    default:
      drawRotatedRect(g, r, fill, stroke);
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual glyph implementations
// ─────────────────────────────────────────────────────────────────────────────

/** Diamond — delivery bucket */
function drawDiamond(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH, stroke, 1);
  g.fillTriangle(0, -r, r * 0.75, 0, 0, r);
  g.fillTriangle(0, -r, -r * 0.75, 0, 0, r);
  g.strokeTriangle(0, -r, r * 0.75, 0, 0, r);
  g.strokeTriangle(0, -r, -r * 0.75, 0, 0, r);
}

/** Regular polygon (hexagon, triangle) */
function drawPolygon(
  g: Phaser.GameObjects.Graphics,
  sides: number,
  r: number,
  startAngle: number,
  fill: number,
  stroke: number,
): void {
  const points: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = startAngle + (Math.PI * 2 * i) / sides;
    points.push(v(Math.cos(angle) * r, Math.sin(angle) * r));
  }
  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH, stroke, 1);
  g.fillPoints(points, true);
  g.strokePoints(points, true);
}

/** 3 small rotated squares fanned ±15° — quantity bucket */
function drawFanSquares(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  const sq = r * 0.38;
  const angles: [number, number, number] = [-Math.PI / 12, 0, Math.PI / 12];
  const offsets: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
    { x: -r * 0.38, y: r * 0.12 },
    { x: 0, y: -r * 0.1 },
    { x: r * 0.38, y: r * 0.12 },
  ];

  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH, stroke, 1);

  for (let i = 0; i < 3; i++) {
    const ox  = offsets[i]!.x;
    const oy  = offsets[i]!.y;
    const a   = angles[i]!;
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    // Rotated square corners
    const corners: Phaser.Math.Vector2[] = [
      v(ox + (-sq * cos - -sq * sin), oy + (-sq * sin + -sq * cos)),
      v(ox + ( sq * cos - -sq * sin), oy + ( sq * sin + -sq * cos)),
      v(ox + ( sq * cos -  sq * sin), oy + ( sq * sin +  sq * cos)),
      v(ox + (-sq * cos -  sq * sin), oy + (-sq * sin +  sq * cos)),
    ];
    g.fillPoints(corners, true);
    g.strokePoints(corners, true);
  }
}

/** 8 thin rectangles radiating from center — impact bucket */
function drawStarburst(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH * 0.5, stroke, 1);

  const spokes = 8;
  const innerR = r * 0.18;
  const outerR = r * 0.88;
  const halfW  = r * 0.1;

  for (let i = 0; i < spokes; i++) {
    const angle = (Math.PI * 2 * i) / spokes;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const pc = Math.cos(perp) * halfW;
    const ps = Math.sin(perp) * halfW;

    const pts: Phaser.Math.Vector2[] = [
      v(cos * innerR - pc, sin * innerR - ps),
      v(cos * outerR - pc, sin * outerR - ps),
      v(cos * outerR + pc, sin * outerR + ps),
      v(cos * innerR + pc, sin * innerR + ps),
    ];
    g.fillPoints(pts, true);
  }
  // Center circle
  g.fillCircle(0, 0, innerR * 1.2);
}

/** Triangle + tinted halo — element bucket */
function drawPrism(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  // Halo (circle behind triangle)
  g.fillStyle(fill, 0.18);
  g.fillCircle(0, 0, r * 0.92);

  // Triangle
  drawPolygon(g, 3, r * 0.78, -Math.PI / 2, fill, stroke);

  // Inner shimmer line
  g.lineStyle(LINE_WIDTH * 0.6, 0xffffff, 0.55);
  const pr  = r * 0.78;
  const topX = 0;
  const topY = -pr;
  const blX  = Math.cos(Math.PI / 2 + Math.PI * 2 / 3) * pr;
  const blY  = Math.sin(Math.PI / 2 + Math.PI * 2 / 3) * pr;
  g.strokePoints([v(topX, topY), v((topX + blX) / 2, (topY + blY) / 2)]);
}

/** Outlined square — shape bucket */
function drawSquare(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH, stroke, 1);
  g.fillRect(-r, -r, r * 2, r * 2);
  g.strokeRect(-r, -r, r * 2, r * 2);
}

/** Gear: circle + 4 rect nubs — utility bucket */
function drawGear(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  const coreR = r * 0.52;
  const nubW  = r * 0.28;
  const nubH  = r * 0.22;
  const nubR  = coreR + nubH * 0.6;

  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH, stroke, 1);

  // 4 nubs at 0°, 90°, 180°, 270°
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI / 2) * i;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nx  = cos * nubR;
    const ny  = sin * nubR;
    const perp = angle + Math.PI / 2;
    const pc   = Math.cos(perp) * nubW * 0.5;
    const ps   = Math.sin(perp) * nubW * 0.5;
    const nd   = nubH * 0.5;

    const pts: Phaser.Math.Vector2[] = [
      v(nx + pc - cos * nd, ny + ps - sin * nd),
      v(nx - pc - cos * nd, ny - ps - sin * nd),
      v(nx - pc + cos * nd, ny - ps + sin * nd),
      v(nx + pc + cos * nd, ny + ps + sin * nd),
    ];
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);
  }

  // Core circle on top
  g.fillCircle(0, 0, coreR);
  g.strokeCircle(0, 0, coreR);

  // Inner hole
  g.fillStyle(0x1f2937, 1);
  g.fillCircle(0, 0, coreR * 0.45);
}

/** Circle — orb / circle iconShape */
function drawCircle(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH, stroke, 1);
  g.fillCircle(0, 0, r);
  g.strokeCircle(0, 0, r);
}

/** X / cross — x iconShape */
function drawXShape(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  const armW = r * 0.22;
  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH * 0.5, stroke, 1);

  for (let i = 0; i < 2; i++) {
    const angle = Math.PI / 4 + (Math.PI / 2) * i;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perp = angle + Math.PI / 2;
    const pc = Math.cos(perp) * armW;
    const ps = Math.sin(perp) * armW;

    const pts: Phaser.Math.Vector2[] = [
      v( cos * r - pc,  sin * r - ps),
      v( cos * r + pc,  sin * r + ps),
      v(-cos * r + pc, -sin * r + ps),
      v(-cos * r - pc, -sin * r - ps),
    ];
    g.fillPoints(pts, true);
  }
}

/** Wide horizontal bar — bar iconShape */
function drawBar(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  const hw = r * 0.9;
  const hh = r * 0.3;
  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH, stroke, 1);
  g.fillRect(-hw, -hh, hw * 2, hh * 2);
  g.strokeRect(-hw, -hh, hw * 2, hh * 2);
}

/** Fallback: rotated rectangle (original placeholder) */
function drawRotatedRect(
  g: Phaser.GameObjects.Graphics,
  r: number,
  fill: number,
  stroke: number,
): void {
  g.fillStyle(fill, 1);
  g.lineStyle(LINE_WIDTH, stroke, 1);
  const hw = r * 0.65;
  // Rotate 45° by drawing as rotated quad
  const pts: Phaser.Math.Vector2[] = [
    v(0,   -r * 0.85),
    v(hw,   0),
    v(0,    r * 0.85),
    v(-hw,  0),
  ];
  g.fillPoints(pts, true);
  g.strokePoints(pts, true);
}
