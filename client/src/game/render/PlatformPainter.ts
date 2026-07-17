/**
 * PlatformPainter — paints two-tone + brush-streak platform visuals
 * directly into a single Graphics object per platform. Phaser 4 compatible
 * (the previous RenderTexture-saveTexture-destroy-recreate-Image flow was
 * Phaser 3 idiom and silently produced empty textures in Phaser 4.1.0
 * — confirmed via Playwright pixel probe showing 63 paintPlatform calls
 * with 0 platform-color pixels on screen).
 *
 * Layers (bottom → top):
 *   (a) Drop shadow: offset rect 4px down/right, shade color at alpha 0.55
 *   (b) Main fill: theme.hi
 *   (c) Top-edge rim highlight (2px white)
 *   (d) Brush streaks pass 1: 5 thin rotated rects, theme.wash, alpha 0.32
 *   (e) Brush streaks pass 2: 3 perpendicular cross-hatch streaks, alpha 0.12
 *
 * Per-platform deterministic seed so brushwork is stable across renders
 * (matters for test-determinism and for the player's mental map of the arena).
 */

import Phaser from "phaser";
import type { ArenaTheme } from "../ui/palette";
import { drawRimHighlight } from "./LightingLayer";
import {
  computeDiagonalSlabGeometry,
  groupDiagonalChainSteps,
  type SlabStep,
} from "./diagonalSlab";

// Re-export so callers can import ArenaTheme from here as well.
export type { ArenaTheme };

/** Darken a 24-bit RGB color by the given factor (0–1, where 0 = black). */
function darkenColor(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/** Linear mix between two 24-bit RGB colors (t = 0 → a, t = 1 → b). */
function mixColor(a: number, b: number, t: number): number {
  const mix = (sa: number, sb: number): number => Math.round(sa + (sb - sa) * t);
  const r = mix((a >> 16) & 0xff, (b >> 16) & 0xff);
  const g = mix((a >> 8) & 0xff, (b >> 8) & 0xff);
  const bl = mix(a & 0xff, b & 0xff);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Paint a platform directly into a Graphics object added to the scene.
 *
 * @param scene  Active Phaser.Scene
 * @param x      World-space centre X
 * @param y      World-space centre Y
 * @param w      Platform width  (pixels)
 * @param h      Platform height (pixels)
 * @param theme  ArenaTheme providing hi / wash / optional shade colours
 * @returns      Array containing the single Graphics that was added to the scene
 */
export function paintPlatform(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ArenaTheme,
): Phaser.GameObjects.GameObject[] {
  const shadeColor =
    "shade" in theme && typeof theme.shade === "number"
      ? theme.shade
      : darkenColor(theme.hi, 0.35);

  // Per-platform deterministic seed so brushwork is stable per location.
  const seed = ((x | 0) * 73) ^ ((y | 0) * 131);
  let rng = seed;
  const nextRng = (): number => {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff;
    return (rng >>> 0) / 0xffffffff;
  };

  const g = scene.add.graphics();
  // World-position the Graphics so all subsequent draws can be in
  // platform-local coordinates with origin at the platform top-left.
  const halfW = w / 2;
  const halfH = h / 2;
  g.setPosition(x - halfW, y - halfH);

  // (a) Drop shadow — 4px down/right.
  // Shadow draws OUTSIDE the platform rect by design; deliberately not
  // masked. Drawn on a separate (non-masked) Graphics instance.
  const shadowG = scene.add.graphics();
  shadowG.setPosition(x - halfW, y - halfH);
  shadowG.fillStyle(shadeColor, 0.55);
  shadowG.fillRect(4, 4, w, h);
  // Shadow goes BEHIND the main platform fill in render order.
  shadowG.setDepth(-0.1);

  // (b) Main fill — hull plate.
  g.fillStyle(theme.hi, 1);
  g.fillRect(0, 0, w, h);

  // (c) Top-edge rim — gold instrument rule when vesselChrome, else soft white.
  const rimColor =
    theme.vesselChrome && typeof theme.gold === "number" ? theme.gold : 0xf5f8f8;
  drawRimHighlight(g, 0, 0, w, rimColor, theme.vesselChrome ? 0.55 : 0.22);

  // Vessel seal: thin gold under-rim + cyan conduit ticks (sci-fi gnostic).
  if (theme.vesselChrome && w >= 28 && h >= 10) {
    const gold = typeof theme.gold === "number" ? theme.gold : 0xc9a84c;
    g.fillStyle(gold, 0.28);
    g.fillRect(1, Math.max(1, h - 2), w - 2, 1.5);
    // Conduit filament ticks along the plate.
    const tickN = Math.max(2, Math.min(12, Math.floor(w / 48)));
    for (let i = 0; i < tickN; i++) {
      const tx = (w * (i + 0.5)) / tickN;
      const th = Math.max(3, h * 0.45);
      g.fillStyle(theme.wash, 0.22 + nextRng() * 0.18);
      g.fillRect(tx - 0.75, h * 0.2, 1.5, th);
    }
    // Corner brackets (instrument panel language).
    const br = Math.min(6, w * 0.08, h * 0.35);
    g.fillStyle(gold, 0.4);
    g.fillRect(0, 0, br, 1.5);
    g.fillRect(0, 0, 1.5, br);
    g.fillRect(w - br, 0, br, 1.5);
    g.fillRect(w - 1.5, 0, 1.5, br);
  }

  // (d, e) Hull streaks — axis-aligned only (Phaser 4 GeometryMask quirk).
  const streakCount = theme.vesselChrome ? 11 : 9;
  for (let i = 0; i < streakCount; i++) {
    const t = i / Math.max(1, streakCount - 1);
    const sx = w * 0.04 + t * w * 0.6 + (nextRng() - 0.5) * w * 0.08;
    const sw = Math.max(3, Math.min(w * 0.32, w - sx - w * 0.04));
    const sh = Math.max(1.5, h * (0.05 + nextRng() * 0.12));
    const sy = nextRng() * (h - sh);
    const alpha = 0.14 + nextRng() * 0.22;
    g.fillStyle(theme.wash, alpha);
    g.fillRect(
      Math.max(0, sx),
      Math.max(0, Math.min(h - sh, sy)),
      sw,
      sh,
    );
  }
  const dabCount = theme.vesselChrome ? 7 : 5;
  for (let i = 0; i < dabCount; i++) {
    const sx = w * (0.1 + nextRng() * 0.8);
    const sw = Math.max(2, w * (0.04 + nextRng() * 0.06));
    const sh = Math.max(1.5, h * (0.04 + nextRng() * 0.08));
    const sy = nextRng() * (h - sh);
    g.fillStyle(theme.wash, 0.08 + nextRng() * 0.12);
    g.fillRect(
      Math.max(0, Math.min(w - sw, sx)),
      Math.max(0, Math.min(h - sh, sy)),
      sw,
      sh,
    );
  }

  return [g, shadowG];
}

/**
 * Paint a launch pad (static map geometry — `MapDefinition.launchPads`).
 * Minimal v1 visual riding the platform draw path: a low energized base
 * plate + three chevrons pointing along the impulse direction so the pad
 * reads as "this throws you THAT way" at a glance. Same Graphics-per-item
 * idiom as paintPlatform; the launch kick itself is event-driven
 * (SimEventRouter `launch-pad-fired`).
 */
export function paintLaunchPad(
  scene: Phaser.Scene,
  pad: {
    position: { x: number; y: number };
    size: { x: number; y: number };
    impulse: { x: number; y: number };
  },
  theme: ArenaTheme,
): Phaser.GameObjects.GameObject[] {
  const { x, y } = pad.position;
  const w = pad.size.x;
  const h = pad.size.y;
  const gold = typeof theme.gold === "number" ? theme.gold : 0xc9a84c;

  const g = scene.add.graphics();
  g.setPosition(x - w / 2, y - h / 2);

  // Base plate: dark slab + energized wash fill + gold rim.
  g.fillStyle(darkenColor(theme.hi, 0.45), 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(theme.wash, 0.5);
  g.fillRect(1, 1, w - 2, h - 2);
  drawRimHighlight(g, 0, 0, w, gold, 0.7);

  // Chevrons along the impulse direction, marching from the pad center.
  const mag = Math.hypot(pad.impulse.x, pad.impulse.y);
  if (mag > 0) {
    const ux = pad.impulse.x / mag;
    const uy = pad.impulse.y / mag;
    // Perpendicular for the chevron wings.
    const pxv = -uy;
    const pyv = ux;
    const cx0 = w / 2;
    const cy0 = h / 2;
    for (let i = 0; i < 3; i++) {
      const d = 10 + i * 12; // tip distance from pad center
      const tipX = cx0 + ux * d;
      const tipY = cy0 + uy * d;
      const back = 9;
      const wing = 7;
      g.lineStyle(2.5, gold, 0.85 - i * 0.22);
      g.beginPath();
      g.moveTo(tipX - ux * back + pxv * wing, tipY - uy * back + pyv * wing);
      g.lineTo(tipX, tipY);
      g.lineTo(tipX - ux * back - pxv * wing, tipY - uy * back - pyv * wing);
      g.strokePath();
    }
  }

  return [g];
}

/**
 * Paint the render-only diagonal slab silhouette under one ascent chain
 * (docs/map-design.md: "Renderer may later draw a connecting sloped
 * silhouette over the steps (render-only; collision stays rectangles)").
 * Geometry lives in diagonalSlab.ts (Phaser-free, unit-tested); this is
 * pure Graphics work in the same material language as paintPlatform.
 *
 * What a human should see: each `diag-*` / `seam-*` chain stops reading as
 * scattered floating shelves and instead reads as ONE solid angled slab —
 * a stair stringer — with the steps cut into its top face. Layer stack:
 *   depth -0.3  slab drop shadow (whole polygon offset 4px down/right,
 *               shade @ 0.55 — same recipe as the platform shadows)
 *   depth -0.2  slab body: half-shade fill (substructure, deliberately
 *               darker than the walkable theme.hi plates), gold under-rim
 *               along the straight underside when vesselChrome, rim
 *               highlight traced along the hugging top edge (the portions
 *               under the steps get covered when the steps paint over it,
 *               so the rim survives only on the exposed gap bridges and
 *               end lips — exactly where an edge would catch light), and
 *               the seeded slope-aligned brush-streak wash so the slab
 *               matches the hand-painted hull texture.
 *   depth -0.1  platform drop shadows (existing) — steps visibly cast
 *               onto the slab face beneath them.
 *   depth  0    the steps themselves — walkable top faces never occluded.
 *
 * PURE DECORATION: zero collision, zero sim contact. Degenerate chains
 * (single step, vertical stack, flat run, malformed) return [] and draw
 * nothing — see computeDiagonalSlabGeometry.
 */
export function paintDiagonalSlab(
  scene: Phaser.Scene,
  steps: ReadonlyArray<SlabStep>,
  theme: ArenaTheme,
): Phaser.GameObjects.GameObject[] {
  const geo = computeDiagonalSlabGeometry(steps);
  if (!geo) return [];
  const { outline, topEdge, bottomEdge } = geo;

  const shadeColor =
    "shade" in theme && typeof theme.shade === "number"
      ? theme.shade
      : darkenColor(theme.hi, 0.35);
  // Substructure tone: halfway from the walkable plate color toward the
  // shade, so slab reads as hull UNDER the steps, steps as the lit face.
  const slabFill = mixColor(theme.hi, shadeColor, 0.45);

  const tracePoly = (g: Phaser.GameObjects.Graphics, dx = 0, dy = 0): void => {
    g.beginPath();
    g.moveTo(outline[0]!.x + dx, outline[0]!.y + dy);
    for (let i = 1; i < outline.length; i++) {
      g.lineTo(outline[i]!.x + dx, outline[i]!.y + dy);
    }
    g.closePath();
    g.fillPath();
  };

  // (a) Drop shadow — same 4px down/right offset as the platform shadows,
  // but one depth lower so step shadows still land ON the slab face.
  const shadowG = scene.add.graphics();
  shadowG.setDepth(-0.3);
  shadowG.fillStyle(shadeColor, 0.55);
  tracePoly(shadowG, 4, 4);

  const g = scene.add.graphics();
  g.setDepth(-0.2);

  // (b) Body fill.
  g.fillStyle(slabFill, 1);
  tracePoly(g);

  // (c) Rim highlight traced along the hugging top edge — the sloped
  // equivalent of paintPlatform's drawRimHighlight (that helper is a
  // horizontal-rule primitive; the slab edge is a polyline, so we stroke
  // the same 2px rim by hand with identical color/alpha choices).
  const rimColor =
    theme.vesselChrome && typeof theme.gold === "number" ? theme.gold : 0xf5f8f8;
  g.lineStyle(2, rimColor, theme.vesselChrome ? 0.55 : 0.22);
  g.beginPath();
  g.moveTo(topEdge[0]!.x, topEdge[0]!.y);
  for (let i = 1; i < topEdge.length; i++) g.lineTo(topEdge[i]!.x, topEdge[i]!.y);
  g.strokePath();

  // (d) Vessel seal: thin gold under-rim along the straight underside
  // (mirrors paintPlatform's bottom gold rule).
  if (theme.vesselChrome) {
    const gold = typeof theme.gold === "number" ? theme.gold : 0xc9a84c;
    g.lineStyle(1.5, gold, 0.28);
    g.beginPath();
    g.moveTo(bottomEdge[0].x, bottomEdge[0].y);
    g.lineTo(bottomEdge[1].x, bottomEdge[1].y);
    g.strokePath();
  }

  // (e) Brush-streak wash — slope-aligned strokes hugging the underside so
  // the slab carries the same hand-painted hull texture as the plates.
  // Deterministic seed from the chain's end points (same LCG recipe as
  // paintPlatform) so the brushwork is stable across repaints.
  const s0 = topEdge[0]!;
  const s1 = topEdge[topEdge.length - 1]!;
  const seed =
    ((s0.x | 0) * 73) ^ ((s0.y | 0) * 131) ^ ((s1.x | 0) * 29) ^ ((s1.y | 0) * 7);
  let rng = seed;
  const nextRng = (): number => {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff;
    return (rng >>> 0) / 0xffffffff;
  };
  const bx = bottomEdge[1].x - bottomEdge[0].x;
  const by = bottomEdge[1].y - bottomEdge[0].y;
  const blen = Math.hypot(bx, by);
  if (blen > 1) {
    const ubx = bx / blen;
    const uby = by / blen;
    const streakCount =
      Math.max(4, Math.min(14, Math.round(blen / 110))) +
      (theme.vesselChrome ? 2 : 0);
    for (let i = 0; i < streakCount; i++) {
      const t0 = nextRng() * 0.72;
      // Cap the far end 24px short of the crest chamfer so a streak can
      // never poke past the slanted end face.
      const l = Math.min(blen * (0.1 + nextRng() * 0.18), blen - 24 - t0 * blen);
      if (l <= 4) continue;
      // Vertical lift above the bottom line, kept within [6, 20] — always
      // inside the polygon because the geometry guarantees SLAB_MIN_CORE
      // (26px) of body above the bottom line at every top-edge vertex.
      const lift = 6 + nextRng() * 14;
      const x0 = bottomEdge[0].x + ubx * (t0 * blen);
      const y0 = bottomEdge[0].y + uby * (t0 * blen) - lift;
      g.lineStyle(1.5 + nextRng() * 1.5, theme.wash, 0.1 + nextRng() * 0.16);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + ubx * l, y0 + uby * l);
      g.strokePath();
    }
  }

  return [g, shadowG];
}

/**
 * Paint a TRUE SLOPE (static map geometry — `MapDefinition.slopes`) as a
 * solid angled slab: a right-triangle wedge whose hypotenuse IS the
 * walkable surface. Same material language as paintDiagonalSlab (this
 * session's precedent), with one deliberate difference: the slab's rim
 * survives only on exposed bridges because steps paint over it, but a
 * slope's TOP face is the walkable surface itself — so the rim highlight
 * runs FULL-LENGTH along the hypotenuse.
 *
 * Layer stack (matches the platform painters):
 *   depth -0.1  drop shadow — whole wedge offset 4px down/right, shade @
 *               0.55 (paintPlatform's shadow recipe)
 *   depth  0    wedge body: half-shade fill (mix toward shade at 0.45 —
 *               reads as hull, darker than theme.hi plates), full-length
 *               rim highlight on the walkable edge (gold vessel-chrome),
 *               thin gold under-rim along the flat bottom, and seeded
 *               slope-aligned brush streaks (paintPlatform's LCG recipe,
 *               stable across repaints).
 *
 * Geometry from the SlopeDefinition contract (types.ts): base = bottom
 * corner, surface ascends `run` px in direction `dir`, rise = run·grade_t.
 * PURE RENDERING — the collision truth lives in stepPlayer's foot-point
 * pass (player.ts / player.zig); this draws exactly that surface line.
 */
export function paintSlope(
  scene: Phaser.Scene,
  slope: {
    base: { x: number; y: number };
    run: number;
    grade: "2:1" | "1:1";
    dir: 1 | -1;
  },
  theme: ArenaTheme,
): Phaser.GameObjects.GameObject[] {
  if (!(slope.run > 0)) return []; // degenerate authoring — draw nothing
  const t = slope.grade === "2:1" ? 0.5 : 1;
  const rise = slope.run * t;
  // A = bottom corner, B = top corner, C = bottom under the top corner.
  const ax = slope.base.x;
  const ay = slope.base.y;
  const bx = slope.base.x + slope.dir * slope.run;
  const by = slope.base.y - rise;
  const cx = bx;
  const cy = ay;

  const shadeColor =
    "shade" in theme && typeof theme.shade === "number"
      ? theme.shade
      : darkenColor(theme.hi, 0.35);
  const slabFill = mixColor(theme.hi, shadeColor, 0.45);

  const tri = (g: Phaser.GameObjects.Graphics, dx = 0, dy = 0): void => {
    g.beginPath();
    g.moveTo(ax + dx, ay + dy);
    g.lineTo(bx + dx, by + dy);
    g.lineTo(cx + dx, cy + dy);
    g.closePath();
    g.fillPath();
  };

  // (a) Drop shadow — behind the wedge, same depth as platform shadows.
  const shadowG = scene.add.graphics();
  shadowG.setDepth(-0.1);
  shadowG.fillStyle(shadeColor, 0.55);
  tri(shadowG, 4, 4);

  const g = scene.add.graphics();

  // (b) Body fill.
  g.fillStyle(slabFill, 1);
  tri(g);

  // (c) Rim highlight — FULL LENGTH along the walkable hypotenuse.
  const rimColor =
    theme.vesselChrome && typeof theme.gold === "number" ? theme.gold : 0xf5f8f8;
  g.lineStyle(2, rimColor, theme.vesselChrome ? 0.55 : 0.22);
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.strokePath();

  // (d) Vessel seal: thin gold under-rim along the flat bottom.
  if (theme.vesselChrome) {
    const gold = typeof theme.gold === "number" ? theme.gold : 0xc9a84c;
    g.lineStyle(1.5, gold, 0.28);
    g.beginPath();
    g.moveTo(ax, ay - 0.75);
    g.lineTo(cx, cy - 0.75);
    g.strokePath();
  }

  // (e) Slope-aligned brush streaks — deterministic seed from the wedge
  // corners (paintPlatform's LCG recipe) so brushwork is stable across
  // repaints. Streaks run parallel to the hypotenuse, sunk into the body;
  // the available vertical depth at fraction f along A→B is rise·f, so a
  // streak anchored past f=0.3 with lift ≤ depth·0.7 always stays inside
  // the triangle (depth only grows toward B).
  const seed = ((ax | 0) * 73) ^ ((ay | 0) * 131) ^ ((bx | 0) * 29) ^ ((by | 0) * 7);
  let rng = seed;
  const nextRng = (): number => {
    rng = (rng * 1664525 + 1013904223) & 0xffffffff;
    return (rng >>> 0) / 0xffffffff;
  };
  const hypLen = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / hypLen;
  const uy = (by - ay) / hypLen;
  const streakCount =
    Math.max(3, Math.min(12, Math.round(hypLen / 90))) +
    (theme.vesselChrome ? 2 : 0);
  for (let i = 0; i < streakCount; i++) {
    const f0 = 0.3 + nextRng() * 0.5; // anchor fraction along A→B
    const depthHere = rise * f0;
    const lift = Math.min(4 + nextRng() * 12, depthHere * 0.7);
    if (lift < 2) continue;
    const l = Math.min(hypLen * (0.08 + nextRng() * 0.16), hypLen * (0.97 - f0));
    if (l <= 4) continue;
    const x0 = ax + ux * (f0 * hypLen);
    const y0 = ay + uy * (f0 * hypLen) + lift;
    g.lineStyle(1.5 + nextRng() * 1.5, theme.wash, 0.1 + nextRng() * 0.16);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + ux * l, y0 + uy * l);
    g.strokePath();
  }

  return [g, shadowG];
}

/**
 * Tracker that owns a set of platform Graphics and lets the scene
 * repaint them safely. Without this, both MatchScene and
 * OnlineMatchScene had to keep their own `platformGraphics: GameObject[]`
 * field and remember to clear-and-destroy at the top of every renderArena
 * pass — bug 0c430b2 was the regression that hit when a re-fired
 * onHello produced doubled platforms because someone forgot the destroy.
 *
 * Use:
 *   private readonly platforms = new PlatformLayer(this);
 *   ...
 *   this.platforms.repaint(map.platforms, theme);  // safe across resyncs
 *
 * destroy() runs automatically on scene shutdown via Phaser's event so
 * callers don't need to wire it explicitly.
 */
export class PlatformLayer {
  private graphics: Phaser.GameObjects.GameObject[] = [];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
  }

  repaint(
    // `id` is optional/structural: callers pass MapDefinition.platforms
    // (which carry ids) and the diagonal-chain slabs group by id pattern;
    // id-less inputs simply never form chains.
    platforms: ReadonlyArray<{ id?: string; position: { x: number; y: number }; size: { x: number; y: number } }>,
    theme: ArenaTheme,
    // Optional/additive: static launch pads (map.launchPads). Existing
    // call sites without pads render exactly as before.
    launchPads?: ReadonlyArray<{
      position: { x: number; y: number };
      size: { x: number; y: number };
      impulse: { x: number; y: number };
    }>,
    // Optional/additive: true slopes (map.slopes). Existing call sites
    // without slopes render exactly as before.
    slopes?: ReadonlyArray<{
      base: { x: number; y: number };
      run: number;
      grade: "2:1" | "1:1";
      dir: 1 | -1;
    }>,
  ): void {
    for (const obj of this.graphics) obj.destroy();
    this.graphics = [];
    // Diagonal slab silhouettes first (they also sit at lower depths), so
    // the steps always paint over their slab. No diag-/seam- chains (e.g.
    // ArenaForge drafts) → groupDiagonalChainSteps returns [] and this is
    // a no-op.
    for (const chain of groupDiagonalChainSteps(platforms)) {
      const objs = paintDiagonalSlab(this.scene, chain, theme);
      for (const o of objs) this.graphics.push(o);
    }
    // True slopes next — solid walkable wedges. Before the platforms so a
    // plate abutting a slope crest paints its clean edge over the wedge tip.
    for (const s of slopes ?? []) {
      const objs = paintSlope(this.scene, s, theme);
      for (const o of objs) this.graphics.push(o);
    }
    for (const p of platforms) {
      const objs = paintPlatform(this.scene, p.position.x, p.position.y, p.size.x, p.size.y, theme);
      for (const o of objs) this.graphics.push(o);
    }
    for (const pad of launchPads ?? []) {
      const objs = paintLaunchPad(this.scene, pad, theme);
      for (const o of objs) this.graphics.push(o);
    }
  }

  destroy(): void {
    for (const obj of this.graphics) obj.destroy();
    this.graphics = [];
  }
}