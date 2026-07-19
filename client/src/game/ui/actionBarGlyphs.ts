// Per-kind active-ability glyphs for the action bar (ActionBarSystem.ts).
//
// House convention (see ActionBarSystem.drawActiveSlot / drawAcquiredSlot,
// cardGlyphs.ts): the mechanic is drawn in strokes, no icon asset pipeline.
// Extracted to a standalone pure function — same reasoning as cardIcons.ts's
// drawGlyph/drawBucketIcon split — so the per-kind dispatch is unit-testable
// without a live Phaser scene (`import Phaser from "phaser"` throws outside
// a DOM: `window is not defined`; a real Graphics object can't be
// constructed in `bun test`). Callers pass any duck-typed Graphics-like
// object; ActionBarSystem passes the real `Phaser.GameObjects.Graphics`.
//
// Color: no new hardcoded hues — `glyphColor` is whatever the caller
// resolved (ActionBarSystem tracks it from the cooldown-ready lerp, crimson
// on an active effect window), so every glyph automatically rides the
// existing combat-register (cyan/sapphire ready state) coloring instead of
// introducing a second palette.
//
// docs/class-ability-catalogs-v1.md Geometrician catalog (chunk 4.3,
// docs/class-overhaul-workboard.md): the ten `sunlance` .. `recoil-step`
// kinds previously fell through to the generic filled-dot fallback below.

export type GlyphGraphics = {
  lineStyle: (width: number, color: number, alpha?: number) => unknown;
  fillStyle: (color: number, alpha?: number) => unknown;
  beginPath: () => unknown;
  moveTo: (x: number, y: number) => unknown;
  lineTo: (x: number, y: number) => unknown;
  closePath: () => unknown;
  strokePath: () => unknown;
  strokeCircle: (x: number, y: number, radius: number) => unknown;
  fillCircle: (x: number, y: number, radius: number) => unknown;
  arc: (
    x: number,
    y: number,
    radius: number,
    startRadians: number,
    endRadians: number,
    anticlockwise?: boolean,
  ) => unknown;
};

const TAU = Math.PI * 2;
function degToRad(deg: number): number {
  return (deg / 360) * TAU;
}

/**
 * Draw the per-kind glyph for a drafted-active slot (six-axes Layer 2,
 * `AbilityKind` in cardTypes.ts) centered at (cx, cy) inside a slot of
 * outer radius `r`. Sets its own lineStyle/fillStyle — callers don't need
 * to pre-arm graphics state.
 */
export function drawActiveGlyph(
  g: GlyphGraphics,
  cx: number,
  cy: number,
  r: number,
  kind: string,
  glyphColor: number,
): void {
  g.lineStyle(Math.max(1.2, r * 0.09), glyphColor, 0.9);
  const gr = r * 0.26;

  switch (kind) {
    // ── Five class-blind six-axes actives (pre-existing) ────────────────
    case "crimson-tithe":
      // The tithe cross — two crossed cuts (the card's X sigil).
      g.beginPath();
      g.moveTo(cx - gr, cy - gr);
      g.lineTo(cx + gr, cy + gr);
      g.moveTo(cx + gr, cy - gr);
      g.lineTo(cx - gr, cy + gr);
      g.strokePath();
      return;

    case "shadow-step":
      // Double chevron — the step past the step.
      for (const off of [-gr * 0.55, gr * 0.45]) {
        g.beginPath();
        g.moveTo(cx + off - gr * 0.5, cy - gr * 0.7);
        g.lineTo(cx + off + gr * 0.5, cy);
        g.lineTo(cx + off - gr * 0.5, cy + gr * 0.7);
        g.strokePath();
      }
      return;

    case "veil-of-nought":
      // The nought — an empty circle where a target would be.
      g.strokeCircle(cx, cy, gr * 0.85);
      return;

    case "severing-answer":
      // A cut answer — one bar, severed.
      g.beginPath();
      g.moveTo(cx - gr, cy);
      g.lineTo(cx - gr * 0.2, cy);
      g.moveTo(cx + gr * 0.2, cy);
      g.lineTo(cx + gr, cy);
      g.strokePath();
      return;

    case "shelter-seal":
      // The seal — a small held diamond.
      g.beginPath();
      g.moveTo(cx, cy - gr);
      g.lineTo(cx + gr, cy);
      g.lineTo(cx, cy + gr);
      g.lineTo(cx - gr, cy);
      g.closePath();
      g.strokePath();
      return;

    // ── Geometrician catalog v1 (docs/class-ability-catalogs-v1.md) ─────
    case "sunlance":
      // Charge-and-release lance: one committed line, one hard tip.
      g.beginPath();
      g.moveTo(cx - gr, cy);
      g.lineTo(cx + gr * 0.55, cy);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx + gr * 0.15, cy - gr * 0.45);
      g.lineTo(cx + gr, cy);
      g.lineTo(cx + gr * 0.15, cy + gr * 0.45);
      g.strokePath();
      return;

    case "facet-break":
      // A single crack breaking a facet — one hard zigzag.
      g.beginPath();
      g.moveTo(cx - gr * 0.7, cy - gr);
      g.lineTo(cx - gr * 0.1, cy - gr * 0.15);
      g.lineTo(cx + gr * 0.35, cy - gr * 0.15);
      g.lineTo(cx + gr * 0.7, cy + gr);
      g.strokePath();
      return;

    case "prism-fan":
      // Three shards fanning from one point.
      for (const tip of [
        { x: cx + gr * 0.2, y: cy - gr },
        { x: cx + gr * 0.8, y: cy - gr * 0.1 },
        { x: cx + gr * 0.55, y: cy + gr * 0.8 },
      ]) {
        g.beginPath();
        g.moveTo(cx - gr * 0.6, cy + gr * 0.6);
        g.lineTo(tip.x, tip.y);
        g.strokePath();
      }
      return;

    case "lattice":
      // A small grid — two crossing pairs (net).
      g.beginPath();
      g.moveTo(cx - gr * 0.75, cy - gr * 0.25);
      g.lineTo(cx + gr * 0.75, cy - gr * 0.25);
      g.moveTo(cx - gr * 0.75, cy + gr * 0.25);
      g.lineTo(cx + gr * 0.75, cy + gr * 0.25);
      g.moveTo(cx - gr * 0.25, cy - gr * 0.75);
      g.lineTo(cx - gr * 0.25, cy + gr * 0.75);
      g.moveTo(cx + gr * 0.25, cy - gr * 0.75);
      g.lineTo(cx + gr * 0.25, cy + gr * 0.75);
      g.strokePath();
      return;

    case "return-glass":
      // A line rebounding off a mirror plane.
      g.beginPath();
      g.moveTo(cx + gr * 0.15, cy - gr);
      g.lineTo(cx + gr * 0.15, cy + gr);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx - gr * 0.9, cy - gr * 0.55);
      g.lineTo(cx + gr * 0.05, cy);
      g.lineTo(cx - gr * 0.9, cy + gr * 0.55);
      g.strokePath();
      return;

    case "hard-aperture": {
      // A closing iris — four gated arcs, not a full ring (contrast with
      // veil-of-nought's plain circle).
      const rad = gr * 0.85;
      for (const start of [20, 110, 200, 290]) {
        g.beginPath();
        g.arc(cx, cy, rad, degToRad(start), degToRad(start + 55), false);
        g.strokePath();
      }
      return;
    }

    case "overclock":
      // A bolt — the fuel spike.
      g.beginPath();
      g.moveTo(cx + gr * 0.15, cy - gr);
      g.lineTo(cx - gr * 0.35, cy + gr * 0.1);
      g.lineTo(cx + gr * 0.1, cy + gr * 0.1);
      g.lineTo(cx - gr * 0.15, cy + gr);
      g.strokePath();
      return;

    case "measure":
      // A measured line — ticks along a rule.
      g.beginPath();
      g.moveTo(cx - gr, cy);
      g.lineTo(cx + gr, cy);
      g.strokePath();
      for (const tx of [-gr * 0.66, -gr * 0.22, gr * 0.22, gr * 0.66]) {
        g.beginPath();
        g.moveTo(cx + tx, cy - gr * 0.25);
        g.lineTo(cx + tx, cy + gr * 0.25);
        g.strokePath();
      }
      return;

    case "slip-node":
      // Two nodes — where you are (hollow), where you'll land (filled).
      g.strokeCircle(cx - gr * 0.5, cy, gr * 0.4);
      g.fillStyle(glyphColor, 0.9);
      g.fillCircle(cx + gr * 0.5, cy, gr * 0.22);
      return;

    case "recoil-step":
      // A backward hop — chevron kicking off a ground mark.
      g.beginPath();
      g.moveTo(cx + gr * 0.6, cy - gr * 0.55);
      g.lineTo(cx - gr * 0.5, cy);
      g.lineTo(cx + gr * 0.6, cy + gr * 0.55);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx - gr * 0.85, cy + gr * 0.75);
      g.lineTo(cx - gr * 0.15, cy + gr * 0.75);
      g.strokePath();
      return;

    // ── Interstice catalog v1 (docs/class-ability-catalogs-v1.md) ───────
    // Sharp/angular/precise strokes — insidious-precise tone (classes-
    // goal.md C4), distinct from the Geometrician block's crystal-facet
    // language and Kindled's board/shield language: every glyph here is a
    // cut, a mark, or a single decisive line, never a rounded/ornate shape.
    case "undercut":
      // One clean horizontal cut, low — the execute line under a body.
      g.beginPath();
      g.moveTo(cx - gr, cy + gr * 0.55);
      g.lineTo(cx + gr, cy + gr * 0.55);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx - gr * 0.6, cy - gr * 0.5);
      g.lineTo(cx + gr * 0.6, cy - gr * 0.5);
      g.strokePath();
      return;

    case "edge-storm":
      // Three parallel cuts — the battery of empowered swings.
      for (const off of [-gr * 0.6, 0, gr * 0.6]) {
        g.beginPath();
        g.moveTo(cx + off - gr * 0.25, cy - gr);
        g.lineTo(cx + off + gr * 0.25, cy + gr);
        g.strokePath();
      }
      return;

    case "needle":
      // A single thin dart, tip forward — the lunge-and-strike.
      g.beginPath();
      g.moveTo(cx - gr, cy);
      g.lineTo(cx + gr * 0.7, cy);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx + gr * 0.25, cy - gr * 0.35);
      g.lineTo(cx + gr, cy);
      g.lineTo(cx + gr * 0.25, cy + gr * 0.35);
      g.strokePath();
      return;

    case "read-mark":
      // An open eye-line — one lens sweep, not a stealth glyph: a straight
      // scan bar over a single hollow point (the modeled target).
      g.beginPath();
      g.moveTo(cx - gr, cy - gr * 0.6);
      g.lineTo(cx + gr, cy - gr * 0.6);
      g.strokePath();
      g.strokeCircle(cx, cy + gr * 0.3, gr * 0.3);
      return;

    case "shard-ring":
      // A ring of short radial ticks — the wave ring off a still blade.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const ix = cx + Math.cos(a) * gr * 0.45;
        const iy = cy + Math.sin(a) * gr * 0.45;
        const ox = cx + Math.cos(a) * gr;
        const oy = cy + Math.sin(a) * gr;
        g.beginPath();
        g.moveTo(ix, iy);
        g.lineTo(ox, oy);
        g.strokePath();
      }
      return;

    case "wall-bloom":
      // A vertical wall line with a burst breaking off it.
      g.beginPath();
      g.moveTo(cx - gr * 0.8, cy - gr);
      g.lineTo(cx - gr * 0.8, cy + gr);
      g.strokePath();
      for (const a of [-40, 0, 40]) {
        const rad = degToRad(a);
        g.beginPath();
        g.moveTo(cx - gr * 0.6, cy);
        g.lineTo(cx - gr * 0.6 + Math.cos(rad) * gr * 0.9, cy + Math.sin(rad) * gr * 0.9);
        g.strokePath();
      }
      return;

    case "ghost-guard": {
      // A near-miss — a single broken ring (the hit that almost landed).
      const rad = gr * 0.85;
      for (const start of [10, 130, 250]) {
        g.beginPath();
        g.arc(cx, cy, rad, degToRad(start), degToRad(start + 80), false);
        g.strokePath();
      }
      return;
    }

    case "second-wind":
      // A short upward tick — the small kick of health/energy back.
      g.beginPath();
      g.moveTo(cx - gr * 0.5, cy + gr * 0.7);
      g.lineTo(cx, cy - gr * 0.7);
      g.lineTo(cx + gr * 0.5, cy + gr * 0.7);
      g.strokePath();
      return;

    case "razor-route":
      // A dash line carrying past its own mark — the empowered route.
      g.beginPath();
      g.moveTo(cx - gr, cy);
      g.lineTo(cx + gr * 0.4, cy);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx + gr * 0.1, cy - gr * 0.4);
      g.lineTo(cx + gr, cy);
      g.lineTo(cx + gr * 0.1, cy + gr * 0.4);
      g.strokePath();
      g.fillStyle(glyphColor, 0.9);
      g.fillCircle(cx - gr * 0.75, cy, gr * 0.14);
      return;

    default:
      // No bespoke glyph registered — generic filled point.
      g.fillStyle(glyphColor, 0.9);
      g.fillCircle(cx, cy, r * 0.1);
  }
}
