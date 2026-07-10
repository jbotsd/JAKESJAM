/**
 * Cosmic Arena Skybox — Halo Forerunner megastructure × Destiny-class parallax.
 *
 * FAR  (0.65)  dense void + teal nebula + starfield (Destiny sky density)
 * DEEP (0.80)  distant Forerunner pylons / hard-light lattice silhouette
 * MID  (0.92)  nested hard-light frames + segmented rings (hugs playfield)
 * MAP  (1.00)  central portal seal on the map (world-locked)
 *
 * Geometric law (perfection over eclecticism):
 *  - Exact φ cascade, ad-quadratum (square→diamond×φ⁻¹), regular n-gons
 *  - Perfect circles, vesica, seed-of-life (7), hexagon frame (not hexagram)
 *  - Triangle motif = nested POINT-UP only — never inverted (no Star of David)
 *  - No skew / origin-offset scale hacks. Never scrollFactor 0 (HUD rule).
 */

import Phaser from "phaser";
import { getSonicField } from "../systems/SonicField";
import { PALETTE } from "../ui/palette";

const PHI = 1.618033988749895;
const PHI_INV = 1 / PHI;
const PHI_INV2 = PHI_INV * PHI_INV;
const PHI_INV3 = PHI_INV2 * PHI_INV;
const SQRT2 = Math.SQRT2;
/** Connecting midpoints of equilateral → smaller equilateral, still point-up. */
const TRI_MID_SCALE = 0.5;

const D_FAR = -9;
const D_DEEP = -7.5;
const D_MID = -6;
const D_MOTIF = -0.5;
const D_FLOOR = -0.4;

/** Stay near the map — camera follows player; low SF = empty void. */
const SF_FAR = 0.65;
const SF_DEEP = 0.8;
const SF_MID = 0.92;
const SF_MAP = 1;

const TWINKLE = 40;

// Forerunner palette
const HL = PALETTE.hullWashCyan; // 0x50e3c2 hard-light
const HL_HI = 0x8ff8ff;
const HULL = 0x101820;
const HULL_HI = 0x1a2838;
const RIM = 0x90a8b8;
const GOLD = PALETTE.hullGold; // sparse house ticks only

type Twinkle = {
  body: Phaser.GameObjects.Arc;
  baseA: number;
  phase: number;
  band: "high" | "mid" | "bass";
};

type Seal = {
  arc: Phaser.GameObjects.Arc;
  restA: number;
  restR: number;
  /** Rotation sense + speed bias */
  spin: number;
  /** 0 music-mid, 1 voice-chant, 2 bass, 3 gnostic */
  band: 0 | 1 | 2 | 3;
};

export class CosmicArenaLayer {
  private readonly scene: Phaser.Scene;

  private farG?: Phaser.GameObjects.Graphics;
  private deepG?: Phaser.GameObjects.Graphics;
  private midG?: Phaser.GameObjects.Graphics;
  private roseG?: Phaser.GameObjects.Graphics;
  private floorG?: Phaser.GameObjects.Graphics;
  private twinkles: Twinkle[] = [];
  private seals: Seal[] = [];

  private motifX = 0;
  private motifY = 0;
  private t = 0;
  private beatFlash = 0;
  private voiceFlash = 0;
  private alive = false;
  // Quantized last writes — skip Phaser set* when unchanged (hot path).
  private lastFarA = -1;
  private lastDeepA = -1;
  private lastMidA = -1;
  private lastFloorA = -1;
  private lastRoseA = -1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
  }

  spawn(worldW: number, worldH: number): void {
    this.destroy();
    this.alive = true;
    this.motifX = worldW * 0.5;
    this.motifY = worldH * 0.5;
    this.t = 0;
    this.beatFlash = 0;
    this.voiceFlash = 0;
    this.lastFarA = this.lastDeepA = this.lastMidA = this.lastFloorA = this.lastRoseA = -1;

    this.drawFarSky(worldW, worldH);
    this.drawDeepForerunnerSilhouette(worldW, worldH);
    this.drawMidHardLightLattice(worldW, worldH);
    this.drawMapPortalSeal(worldW, worldH);
    this.drawMapPortalCore(worldW, worldH);
    this.spawnTwinkles(worldW, worldH);
    this.spawnLiveRings(worldW, worldH);
  }

  update(deltaMs: number, actionIntensity: number): void {
    if (!this.alive) return;
    const dt = Math.min(0.05, deltaMs / 1000);
    this.t += dt;
    // Single shared mutable field — no alloc, no event.
    const S = getSonicField();
    const I = actionIntensity < 0 ? 0 : actionIntensity > 1 ? 1 : actionIntensity;
    const G = S.gnostic;
    const V = S.voice;
    const C = S.chant;
    const pump = S.pulse * 0.5 + I * 0.15 + S.beat * 0.28 + V * 0.75 + C * 0.35;
    const pump01 = pump < 0 ? 0 : pump > 1.6 ? 1.6 : pump;

    // Fast envelopes — snap on, short tail (was lagging the mic/music)
    this.beatFlash = Math.max(this.beatFlash * Math.exp(-dt * 11), S.beat * 1.05);
    this.voiceFlash = Math.max(
      this.voiceFlash * Math.exp(-dt * 9.5),
      S.voiceOnset * 1.15 + V * 0.35 + C * 0.2,
    );
    const flash = this.beatFlash * 0.65 + this.voiceFlash * 1.05;

    // Layer alphas — deep calm floor, large swing so hits read immediately
    this.setA(this.farG, 0.78 + S.high * 0.28 + flash * 0.18 + V * 0.14, "far");
    this.setA(this.deepG, 0.72 + S.bass * 0.35 + I * 0.1 + G * 0.22 + flash * 0.12, "deep");
    this.setA(this.midG, 0.55 + S.mid * 0.4 + pump01 * 0.28 + C * 0.35 + flash * 0.2, "mid");
    this.setA(
      this.floorG,
      0.58 + S.bass * 0.38 + flash * 0.4 + V * 0.45 + G * 0.28,
      "floor",
    );
    // Hero seal — voice/chant ignite the geometry
    this.setA(
      this.roseG,
      0.55 + S.mid * 0.35 + flash * 0.55 + V * 0.65 + C * 0.5 + G * 0.35,
      "rose",
    );

    // Twinkles: sparse loop, band-tied + voice air
    const nTw = this.twinkles.length;
    for (let i = 0; i < nTw; i++) {
      const s = this.twinkles[i]!;
      const tw = 0.35 + 0.65 * Math.sin(this.t * (2.6 + (i % 5) * 0.4) + s.phase);
      let band =
        s.band === "high" ? S.high : s.band === "mid" ? S.mid : S.bass;
      if (s.band === "high") band = band * 0.4 + V * 0.75 + S.high * 0.4;
      else if (s.band === "mid") band = band * 0.35 + C * 0.8 + flash * 0.2;
      else band = band * 0.45 + S.beat * 0.55 + S.bass * 0.4;
      const a = s.baseA * (0.25 + tw * 0.75) * (0.25 + band * 1.25 + flash * 0.45);
      s.body.setAlpha(a < 0.08 ? 0.08 : a > 1 ? 1 : a);
    }

    // Live seal rings — big scale/spin swing, no Graphics redraw
    const nSeal = this.seals.length;
    for (let i = 0; i < nSeal; i++) {
      const r = this.seals[i]!;
      let drive = G;
      if (r.band === 0) drive = S.mid * 0.85 + G * 0.55 + flash * 0.25;
      else if (r.band === 1) drive = C * 1.05 + V * 0.75 + flash * 0.65;
      else if (r.band === 2) drive = S.bass * 0.95 + S.beat * 0.75 + G * 0.4;
      else drive = G * 1.05 + flash * 0.75 + V * 0.35;
      if (drive > 1.5) drive = 1.5;
      r.arc.setRotation(this.t * (0.06 + drive * 1.15 + flash * 0.45) * r.spin);
      const sc = 1 + drive * 0.28 + flash * 0.22 + V * 0.16;
      r.arc.setScale(sc);
      const sa = r.restA * (0.35 + drive * 1.55 + flash * 0.9);
      r.arc.setAlpha(sa < 0.06 ? 0.06 : sa > 1.35 ? 1.35 : sa);
    }
  }

  /** Quantized setAlpha — skip Phaser write if within ~0.01. */
  private setA(
    g: Phaser.GameObjects.Graphics | undefined,
    a: number,
    which: "far" | "deep" | "mid" | "floor" | "rose",
  ): void {
    if (!g) return;
    // Allow deeper calm + brighter peaks so response has dynamic range
    const v = a < 0.4 ? 0.4 : a > 1.55 ? 1.55 : a;
    const q = ((v * 100) | 0) / 100;
    if (which === "far") {
      if (q === this.lastFarA) return;
      this.lastFarA = q;
    } else if (which === "deep") {
      if (q === this.lastDeepA) return;
      this.lastDeepA = q;
    } else if (which === "mid") {
      if (q === this.lastMidA) return;
      this.lastMidA = q;
    } else if (which === "floor") {
      if (q === this.lastFloorA) return;
      this.lastFloorA = q;
    } else {
      if (q === this.lastRoseA) return;
      this.lastRoseA = q;
    }
    g.setAlpha(q);
  }

  destroy(): void {
    this.alive = false;
    for (const s of this.twinkles) s.body.destroy();
    this.twinkles = [];
    for (const r of this.seals) r.arc.destroy();
    this.seals = [];
    this.farG?.destroy();
    this.deepG?.destroy();
    this.midG?.destroy();
    this.roseG?.destroy();
    this.floorG?.destroy();
    this.farG = this.deepG = this.midG = this.roseG = this.floorG = undefined;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PRIMITIVES — Forerunner hard-light kit
  // ═══════════════════════════════════════════════════════════════════════

  /** Segmented hard-light ring (classic Forerunner gate). */
  private strokeSegRing(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    segs: number,
    gap: number,
    color: number,
    alpha: number,
    width = 1.5,
    rot = 0,
  ): void {
    const step = (Math.PI * 2) / segs;
    const draw = step * (1 - gap);
    g.lineStyle(width, color, alpha);
    for (let i = 0; i < segs; i++) {
      const a0 = rot + i * step;
      g.beginPath();
      g.arc(cx, cy, r, a0, a0 + draw, false);
      g.strokePath();
    }
  }

  /** Nested square frame (axis-aligned or diamond). */
  private strokeSquare(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    half: number,
    color: number,
    alpha: number,
    width = 1.5,
    rot = 0,
  ): void {
    g.lineStyle(width, color, alpha);
    g.beginPath();
    for (let k = 0; k <= 4; k++) {
      const a = rot + (k / 4) * Math.PI * 2 + Math.PI / 4;
      const x = cx + Math.cos(a) * half * SQRT2;
      const y = cy + Math.sin(a) * half * SQRT2;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  /** Axis-aligned rect outline. */
  private strokeRect(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    color: number,
    alpha: number,
    width = 1.4,
  ): void {
    g.lineStyle(width, color, alpha);
    g.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
  }

  /** Forerunner chevron. */
  private strokeChevron(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    size: number,
    dir: 1 | -1,
    color: number,
    alpha: number,
  ): void {
    g.lineStyle(1.5, color, alpha);
    g.beginPath();
    g.moveTo(x - size * dir, y - size);
    g.lineTo(x, y);
    g.lineTo(x - size * dir, y + size);
    g.strokePath();
  }

  /**
   * Equilateral triangle — ALWAYS point-up base orientation.
   * `rot` is extra rotation; call sites must never pass π (inverted triad).
   * radius = center → vertex (circumradius).
   */
  private strokeTriangle(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    radius: number,
    color: number,
    alpha: number,
    width = 2,
    rot = 0,
  ): void {
    g.lineStyle(width, color, alpha);
    g.beginPath();
    for (let i = 0; i <= 3; i++) {
      // Point-up equilateral: -π/2 at vertex 0
      const a = rot - Math.PI / 2 + (i / 3) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  /**
   * Nested point-up triangle cascade by exact φ (or mid-connect scale).
   * Depth steps inward; all same orientation — geometric density without hexagram.
   */
  private strokeTrianglePhiCascade(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    radius: number,
    depth: number,
    color: number,
    alpha: number,
    width = 2,
    scale = PHI_INV,
  ): void {
    let r = radius;
    let a = alpha;
    let w = width;
    for (let i = 0; i < depth; i++) {
      this.strokeTriangle(g, cx, cy, r, color, a, w);
      // Midpoint connectors on outer ring of cascade (still upright geometry)
      if (i === 0 && r > 20) {
        for (let k = 0; k < 3; k++) {
          const a0 = -Math.PI / 2 + (k / 3) * Math.PI * 2;
          const a1 = -Math.PI / 2 + ((k + 1) / 3) * Math.PI * 2;
          const mx = cx + (Math.cos(a0) + Math.cos(a1)) * 0.5 * r;
          const my = cy + (Math.sin(a0) + Math.sin(a1)) * 0.5 * r;
          g.fillStyle(color, a * 0.9);
          g.fillCircle(mx, my, Math.max(1.2, w * 0.55));
        }
      }
      r *= scale;
      a *= 0.88;
      w = Math.max(1, w * 0.9);
    }
  }

  /** Regular n-gon, circumradius r. Flat-top if rot=0 for even n at top mid. */
  private strokeRegularPoly(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    n: number,
    color: number,
    alpha: number,
    width = 1.5,
    rot = 0,
  ): void {
    if (n < 3) return;
    g.lineStyle(width, color, alpha);
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = rot + (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  /**
   * Ad-quadratum cascade: square → rotated π/4 → scale by φ⁻¹·√2 so next
   * square's vertices sit on previous edges (classical construction).
   */
  private strokeAdQuadratum(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    half: number,
    depth: number,
    color: number,
    alpha: number,
  ): void {
    let h = half;
    let a = alpha;
    let rot = 0;
    for (let i = 0; i < depth; i++) {
      this.strokeSquare(g, cx, cy, h, i % 2 === 0 ? color : HL_HI, a, i === 0 ? 2 : 1.35, rot);
      // Next square circumradius such that it is inscribed-by-rotation of prior.
      h = h * PHI_INV;
      rot += Math.PI / 4;
      a *= 0.9;
    }
  }

  /** Vesica piscis — two equal circles, centers 1 radius apart (horizontal). */
  private strokeVesica(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    color: number,
    alpha: number,
    width = 1.3,
  ): void {
    g.lineStyle(width, color, alpha);
    g.strokeCircle(cx - r * 0.5, cy, r);
    g.strokeCircle(cx + r * 0.5, cy, r);
    // Vertical vesica too (cross) for denser seal — same radius law
    g.lineStyle(width * 0.85, color, alpha * 0.7);
    g.strokeCircle(cx, cy - r * 0.5, r);
    g.strokeCircle(cx, cy + r * 0.5, r);
  }

  /**
   * Seed of Life — center + 6 around (circle packing). Sacred, not a star.
   * radius = each circle's radius; packing centers at 2r.
   */
  private strokeSeedOfLife(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    color: number,
    alpha: number,
    width = 1.2,
  ): void {
    g.lineStyle(width, color, alpha);
    g.strokeCircle(cx, cy, r);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      g.strokeCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r);
    }
  }

  /** Radial tick graduation: major every `majorEvery`, length by rank. */
  private strokeRadialTicks(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    rInner: number,
    rOuter: number,
    count: number,
    majorEvery: number,
    color: number,
    alpha: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 - Math.PI / 2;
      const major = i % majorEvery === 0;
      const ri = major ? rInner : rInner + (rOuter - rInner) * 0.35;
      g.lineStyle(major ? 1.6 : 1.0, major ? HL_HI : color, major ? alpha : alpha * 0.55);
      g.lineBetween(
        cx + Math.cos(a) * ri,
        cy + Math.sin(a) * ri,
        cx + Math.cos(a) * rOuter,
        cy + Math.sin(a) * rOuter,
      );
    }
  }

  /** Vertex nodes on a regular n-gon (circumradius r). */
  private strokePolyNodes(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    n: number,
    color: number,
    alpha: number,
    nodeR = 2.4,
    rot = 0,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = rot - Math.PI / 2 + (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      g.fillStyle(color, alpha);
      g.fillCircle(x, y, nodeR);
      g.fillStyle(0xffffff, alpha * 0.55);
      g.fillCircle(x, y, nodeR * 0.4);
    }
  }

  /** Horizontal/vertical hard-light conduit with tick marks. */
  private strokeConduit(
    g: Phaser.GameObjects.Graphics,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number,
    alpha: number,
    ticks = 0,
  ): void {
    g.lineStyle(1.6, color, alpha);
    g.lineBetween(x0, y0, x1, y1);
    if (ticks <= 0) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    g.lineStyle(1, color, alpha * 0.7);
    for (let i = 1; i < ticks; i++) {
      const t = i / ticks;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      g.lineBetween(x - nx * 4, y - ny * 4, x + nx * 4, y + ny * 4);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FAR — Destiny-dense void + hard-light dust
  // ═══════════════════════════════════════════════════════════════════════

  private drawFarSky(w: number, h: number): void {
    const g = this.scene.add.graphics().setDepth(D_FAR).setScrollFactor(SF_FAR);

    // Cool installation void (not purple church night)
    g.fillStyle(0x080e18, 1);
    g.fillRect(-w * 0.05, -h * 0.05, w * 1.1, h * 1.1);

    // Layered atmosphere bands
    g.fillStyle(0x0c1828, 0.9);
    g.fillRect(0, 0, w, h * 0.35);
    g.fillStyle(0x0a1420, 0.85);
    g.fillRect(0, h * 0.3, w, h * 0.4);
    g.fillStyle(0x081018, 0.9);
    g.fillRect(0, h * 0.6, w, h * 0.4);

    // Teal nebula masses (Destiny density, Forerunner color)
    g.fillStyle(0x0a3040, 0.42);
    g.fillEllipse(w * 0.3, h * 0.28, w * 1.0, h * 0.55);
    g.fillStyle(0x123848, 0.36);
    g.fillEllipse(w * 0.72, h * 0.38, w * 0.9, h * 0.52);
    g.fillStyle(0x0c2838, 0.3);
    g.fillEllipse(w * 0.5, h * 0.15, w * 0.7, h * 0.4);
    g.fillStyle(0x0a2030, 0.32);
    g.fillEllipse(w * 0.15, h * 0.6, w * 0.55, h * 0.4);
    g.fillStyle(0x102838, 0.25);
    g.fillEllipse(w * 0.88, h * 0.55, w * 0.45, h * 0.35);

    // Hard-light dust band (milky cyan streak)
    g.lineStyle(56, 0x1a5060, 0.2);
    g.beginPath();
    g.moveTo(-30, h * 0.2);
    g.lineTo(w * 0.28, h * 0.12);
    g.lineTo(w * 0.55, h * 0.18);
    g.lineTo(w * 0.82, h * 0.1);
    g.lineTo(w + 30, h * 0.16);
    g.strokePath();
    g.lineStyle(22, HL, 0.1);
    g.beginPath();
    g.moveTo(-15, h * 0.19);
    g.lineTo(w * 0.45, h * 0.13);
    g.lineTo(w + 15, h * 0.17);
    g.strokePath();

    // Starfield
    let seed = 7919;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    // 220 stars is plenty at 1080p; 420 was pure CPU path cost at create
    // (and still heavy if graphics ever re-baked).
    for (let i = 0; i < 220; i++) {
      const x = rnd() * w;
      const y = rnd() * h * 0.9;
      const r = 0.7 + rnd() * 2.2;
      const warm = rnd();
      const col = warm < 0.1 ? 0xc0fff4 : warm < 0.4 ? 0xb0d8ff : 0xe8f0f8;
      g.fillStyle(col, 0.3 + rnd() * 0.55);
      g.fillCircle(x, y, r);
      if (rnd() > 0.93) {
        g.fillStyle(0xffffff, 0.7);
        g.fillCircle(x, y, r * 0.45);
        g.lineStyle(1, HL_HI, 0.35);
        g.lineBetween(x - r * 2.2, y, x + r * 2.2, y);
        g.lineBetween(x, y - r * 2.2, x, y + r * 2.2);
      }
    }

    // Distant hard-light body (scale cue)
    const br = Math.min(w, h) * 0.07;
    g.lineStyle(2, HL, 0.2);
    g.strokeCircle(w * 0.12, h * 0.22, br);
    this.strokeSegRing(g, w * 0.12, h * 0.22, br * 1.15, 12, 0.25, HL_HI, 0.15, 1.2);
    g.lineStyle(1.5, RIM, 0.18);
    g.strokeCircle(w * 0.9, h * 0.18, br * 0.55);

    // Geometric constellation lattice — perfect square grid + φ diagonals
    // (reads as architecture in the void, not random noise)
    const cell = Math.min(w, h) * 0.085;
    g.lineStyle(1, HL, 0.045);
    for (let x = cell; x < w; x += cell) g.lineBetween(x, 0, x, h * 0.85);
    for (let y = cell; y < h * 0.85; y += cell) g.lineBetween(0, y, w, y);
    // φ-offset secondary grid
    const cell2 = cell * PHI_INV;
    g.lineStyle(1, HL_HI, 0.03);
    for (let x = cell2 * 0.5; x < w; x += cell2) g.lineBetween(x, 0, x, h * 0.7);
    // Cross nodes on primary intersections (every 2nd)
    for (let ix = 1; ix < w / cell - 1; ix += 2) {
      for (let iy = 1; iy < (h * 0.75) / cell; iy += 2) {
        const nx = ix * cell;
        const ny = iy * cell;
        g.fillStyle(HL, 0.08);
        g.fillCircle(nx, ny, 1.4);
      }
    }

    this.farG = g;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DEEP — distant Forerunner pylons + beam lattice (silhouette mass)
  // ═══════════════════════════════════════════════════════════════════════

  private drawDeepForerunnerSilhouette(w: number, h: number): void {
    const g = this.scene.add.graphics().setDepth(D_DEEP).setScrollFactor(SF_DEEP);
    const cx = this.motifX;
    const cy = this.motifY;

    // Soft atmosphere around play center
    g.fillStyle(0x0a2835, 0.22);
    g.fillEllipse(cx, cy, w * 0.75, h * 0.55);

    // Horizon slab under play band
    const baseY = Math.min(h * 0.82, cy + Math.min(w, h) * 0.32);
    g.fillStyle(HULL, 0.92);
    g.fillRect(0, baseY, w, h - baseY + 40);
    g.lineStyle(2, HL, 0.2);
    g.lineBetween(0, baseY, w, baseY);
    // Floor conduit ticks
    g.lineStyle(1, HL_HI, 0.12);
    for (let i = 0; i < 24; i++) {
      const x = (w * i) / 23;
      g.lineBetween(x, baseY, x, baseY + 6);
    }

    // Twin pylons (Forerunner pillars) flanking center
    const pylonW = Math.min(w, h) * 0.06;
    const pylonH = Math.min(w, h) * 0.38;
    const gap = Math.min(w, h) * 0.28;
    for (const side of [-1, 1] as const) {
      const px = cx + side * gap;
      const top = baseY - pylonH;
      g.fillStyle(HULL_HI, 0.95);
      g.fillRect(px - pylonW / 2, top, pylonW, pylonH);
      g.lineStyle(1.5, RIM, 0.3);
      g.strokeRect(px - pylonW / 2, top, pylonW, pylonH);
      // Hard-light vertical seam
      g.lineStyle(2, HL, 0.4);
      g.lineBetween(px, top + 8, px, baseY - 4);
      // Cross ticks on pylon
      g.lineStyle(1.2, HL_HI, 0.3);
      for (let i = 0; i < 5; i++) {
        const yy = top + 16 + (i * (pylonH - 32)) / 4;
        g.lineBetween(px - pylonW * 0.35, yy, px + pylonW * 0.35, yy);
      }
      // Angular cap
      g.fillStyle(HULL, 0.95);
      g.fillTriangle(px, top - pylonW * 0.7, px - pylonW * 0.55, top, px + pylonW * 0.55, top);
      g.lineStyle(1.3, HL, 0.35);
      g.lineBetween(px - pylonW * 0.55, top, px, top - pylonW * 0.7);
      g.lineBetween(px + pylonW * 0.55, top, px, top - pylonW * 0.7);
    }

    // Central monolith slab
    const slabW = Math.min(w, h) * 0.22;
    const slabH = Math.min(w, h) * 0.18;
    g.fillStyle(HULL_HI, 0.9);
    g.fillRect(cx - slabW / 2, baseY - slabH, slabW, slabH);
    g.lineStyle(1.4, RIM, 0.28);
    g.strokeRect(cx - slabW / 2, baseY - slabH, slabW, slabH);
    // Nested hard-light door frame on slab
    this.strokeRect(g, cx, baseY - slabH * 0.5, slabW * 0.28, slabH * 0.35, HL, 0.3, 1.6);
    this.strokeRect(g, cx, baseY - slabH * 0.5, slabW * 0.18, slabH * 0.22, HL_HI, 0.2, 1.2);
    // Triangle motif on monolith face
    this.strokeTriangle(g, cx, baseY - slabH * 0.55, slabH * 0.22, HL, 0.28, 1.5);

    // Horizontal beam bridge between pylons
    g.lineStyle(2, HL, 0.28);
    g.lineBetween(cx - gap, baseY - pylonH * 0.55, cx + gap, baseY - pylonH * 0.55);
    g.lineStyle(1, HL_HI, 0.15);
    g.lineBetween(cx - gap, baseY - pylonH * 0.55 + 5, cx + gap, baseY - pylonH * 0.55 + 5);

    // Distant side pylons (smaller)
    for (const side of [-1, 1] as const) {
      const px = cx + side * Math.min(w, h) * 0.48;
      const ph = pylonH * 0.55;
      g.fillStyle(HULL, 0.85);
      g.fillRect(px - pylonW * 0.35, baseY - ph, pylonW * 0.7, ph);
      g.lineStyle(1.2, HL, 0.22);
      g.lineBetween(px, baseY - ph + 6, px, baseY - 2);
    }

    // Sparse chevrons
    this.strokeChevron(g, cx - slabW * 0.7, baseY - slabH * 0.7, 10, 1, HL, 0.3);
    this.strokeChevron(g, cx + slabW * 0.7, baseY - slabH * 0.7, 10, -1, HL, 0.3);

    this.deepG = g;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MID — nested hard-light portal lattice (hugs playfield)
  // ═══════════════════════════════════════════════════════════════════════

  private drawMidHardLightLattice(w: number, h: number): void {
    const g = this.scene.add.graphics().setDepth(D_MID).setScrollFactor(SF_MID);
    const cx = this.motifX;
    const cy = this.motifY;
    const R = Math.min(w, h) * 0.55;

    // Soft glow plate — exact circle
    g.fillStyle(0x0a2835, 0.2);
    g.fillCircle(cx, cy, R * 0.9);

    // Perfect φ concentric continuum — denser + higher contrast
    for (let i = 0; i < 10; i++) {
      const rr = R * Math.pow(PHI_INV, i * 0.32);
      g.lineStyle(i === 0 ? 2.2 : 1.15, i % 2 === 0 ? HL : HL_HI, 0.16 - i * 0.01);
      g.strokeCircle(cx, cy, rr);
    }

    // Outer segmented rings (Forerunner gate hierarchy) — denser segs
    for (let i = 0; i < 8; i++) {
      const rr = R * Math.pow(PHI_INV, i * 0.34);
      this.strokeSegRing(
        g,
        cx,
        cy,
        rr,
        48 - i * 4,
        0.08,
        i % 2 === 0 ? HL : HL_HI,
        0.32 - i * 0.028,
        i === 0 ? 2.8 : 1.5,
        i * 0.035,
      );
    }

    // Ad-quadratum cascade (classical square perfection)
    this.strokeAdQuadratum(g, cx, cy, R * 0.52, 8, RIM, 0.24);

    // Axis-aligned φ frames
    this.strokeRect(g, cx, cy, R * 0.55, R * 0.55, HL, 0.16, 1.4);
    this.strokeRect(g, cx, cy, R * PHI_INV * 0.55, R * PHI_INV * 0.55, HL_HI, 0.12, 1.15);
    this.strokeRect(g, cx, cy, R * PHI_INV2 * 0.55, R * PHI_INV2 * 0.55, HL, 0.1, 1.05);

    // Regular hexagon + octagon frames (n-gon perfection, not a star)
    this.strokeRegularPoly(g, cx, cy, R * 0.72, 6, HL, 0.18, 1.5);
    this.strokeRegularPoly(g, cx, cy, R * 0.58, 8, HL_HI, 0.14, 1.25);
    this.strokeRegularPoly(g, cx, cy, R * 0.42, 6, HL, 0.12, 1.15, Math.PI / 6);

    // Vesica cross through center
    this.strokeVesica(g, cx, cy, R * 0.28, HL, 0.12, 1.15);

    // Cardinal + ordinal conduits
    this.strokeConduit(g, cx - R, cy, cx + R, cy, HL, 0.2, 16);
    this.strokeConduit(g, cx, cy - R, cx, cy + R, HL, 0.2, 16);
    const d = R * 0.78;
    g.lineStyle(1.15, HL_HI, 0.12);
    g.lineBetween(cx - d, cy - d, cx + d, cy + d);
    g.lineBetween(cx + d, cy - d, cx - d, cy + d);

    // 48 radial ticks (major every 3 = 16-fold perfection)
    this.strokeRadialTicks(g, cx, cy, R * 0.28, R * 0.98, 48, 3, HL, 0.2);

    // Corner chevrons on ad-quadratum outer
    const ch = R * 0.52;
    this.strokeChevron(g, cx - ch, cy - ch, 16, 1, HL, 0.36);
    this.strokeChevron(g, cx + ch, cy - ch, 16, -1, HL, 0.36);
    this.strokeChevron(g, cx - ch, cy + ch, 16, 1, HL, 0.36);
    this.strokeChevron(g, cx + ch, cy + ch, 16, -1, HL, 0.36);

    // Double hex frame at φ radii
    this.strokeRegularPoly(g, cx, cy, R * 0.88, 6, HL, 0.22, 1.8);
    this.strokeRegularPoly(g, cx, cy, R * PHI_INV * 0.95, 6, HL_HI, 0.18, 1.4, Math.PI / 6);
    this.strokeRegularPoly(g, cx, cy, R * PHI_INV2, 12, HL, 0.12, 1.1);

    // Triangle φ cascade — point-up only (deeper)
    this.strokeTrianglePhiCascade(g, cx, cy, R * 0.55, 7, HL, 0.32, 2.1, PHI_INV);
    // Mid-connect inner cascade (still upright)
    this.strokeTrianglePhiCascade(
      g,
      cx,
      cy,
      R * 0.55 * TRI_MID_SCALE,
      4,
      HL_HI,
      0.22,
      1.4,
      TRI_MID_SCALE,
    );

    // 6 hard-light square plates on hex vertices (packing)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const dist = R * 0.78;
      const sx = cx + Math.cos(a) * dist;
      const sy = cy + Math.sin(a) * dist;
      const s = 10 + (i % 2) * 3;
      this.strokeSquare(g, sx, sy, s * 0.55, HL_HI, 0.22, 1.2, (i * Math.PI) / 6);
      g.fillStyle(HL, 0.15);
      g.fillCircle(sx, sy, 2);
    }

    this.midG = g;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MAP — portal seal under platforms (world-locked)
  // ═══════════════════════════════════════════════════════════════════════

  private drawMapPortalSeal(w: number, h: number): void {
    const g = this.scene.add.graphics().setDepth(D_FLOOR).setScrollFactor(SF_MAP);
    const cx = this.motifX;
    const cy = this.motifY;
    const R = Math.min(w, h) * 0.4;

    // Dark plate
    g.fillStyle(0x0a1824, 0.34);
    g.fillCircle(cx, cy, R);

    // Exact φ concentric continuum (8 steps)
    for (let i = 0; i < 8; i++) {
      const rr = R * Math.pow(PHI_INV, i * 0.36);
      g.lineStyle(i === 0 ? 3.0 : 1.5, i % 2 === 0 ? HL : HL_HI, 0.4 - i * 0.035);
      g.strokeCircle(cx, cy, rr);
    }

    // Ad-quadratum + axis frame
    this.strokeAdQuadratum(g, cx, cy, R * 0.58, 5, RIM, 0.22);
    this.strokeRect(g, cx, cy, R * 0.32, R * 0.32, HL_HI, 0.18, 1.35);
    this.strokeRect(g, cx, cy, R * PHI_INV2 * 0.55, R * PHI_INV2 * 0.55, HL, 0.14, 1.15);

    // Regular hexagon (flat-top) + octagon — pure n-gon grammar
    this.strokeRegularPoly(g, cx, cy, R * 0.88, 6, HL, 0.28, 1.8);
    this.strokeRegularPoly(g, cx, cy, R * 0.72, 8, HL_HI, 0.2, 1.4);
    this.strokeRegularPoly(g, cx, cy, R * PHI_INV, 6, HL, 0.18, 1.25, Math.PI / 6);
    this.strokePolyNodes(g, cx, cy, R * 0.88, 6, HL_HI, 0.4, 2.8);

    // Seed of Life under the seal (sacred packing)
    this.strokeSeedOfLife(g, cx, cy, R * 0.22, HL, 0.14, 1.1);
    // Vesica cross
    this.strokeVesica(g, cx, cy, R * 0.2, HL_HI, 0.12, 1.1);

    // Triangle φ cascade — point-up only
    this.strokeTrianglePhiCascade(g, cx, cy, R * 0.52, 6, HL, 0.32, 2.1, PHI_INV);
    this.strokeTrianglePhiCascade(
      g,
      cx,
      cy,
      R * 0.52 * TRI_MID_SCALE,
      3,
      HL_HI,
      0.2,
      1.4,
      TRI_MID_SCALE,
    );

    // Cardinal + ordinal conduits
    this.strokeConduit(g, cx - R, cy, cx + R, cy, HL, 0.28, 14);
    this.strokeConduit(g, cx, cy - R, cx, cy + R, HL, 0.28, 14);
    const d = R * 0.82;
    g.lineStyle(1.2, HL_HI, 0.14);
    g.lineBetween(cx - d, cy - d, cx + d, cy + d);
    g.lineBetween(cx + d, cy - d, cx - d, cy + d);

    // 36 radial ticks — major every 3 (= 12-fold / clock)
    this.strokeRadialTicks(g, cx, cy, R * 0.38, R * 0.98, 36, 3, HL, 0.24);

    this.strokeSegRing(g, cx, cy, R * 0.99, 24, 0.1, HL, 0.38, 2.6);
    this.strokeSegRing(g, cx, cy, R * PHI_INV * 1.05, 18, 0.12, HL_HI, 0.28, 1.8, 0.04);

    this.floorG = g;
  }

  /** Inner hard-light portal core — geometric perfection, upright seal. */
  private drawMapPortalCore(w: number, h: number): void {
    const g = this.scene.add.graphics().setDepth(D_MOTIF).setScrollFactor(SF_MAP);
    const cx = this.motifX;
    const cy = this.motifY;
    const R = Math.min(w, h) * 0.26;

    // Continuous φ rings under segmented hierarchy
    for (let i = 0; i < 6; i++) {
      const rr = R * Math.pow(PHI_INV, i * 0.42);
      g.lineStyle(i === 0 ? 1.4 : 1.0, i % 2 === 0 ? HL : HL_HI, 0.18 - i * 0.02);
      g.strokeCircle(cx, cy, rr);
    }

    // Segmented outer — dense
    this.strokeSegRing(g, cx, cy, R, 24, 0.08, HL, 0.58, 3.2);
    this.strokeSegRing(g, cx, cy, R * 0.94, 24, 0.08, HL_HI, 0.32, 1.6, 0.04);
    this.strokeSegRing(g, cx, cy, R * PHI_INV, 18, 0.12, HL, 0.42, 2.1);
    this.strokeSegRing(g, cx, cy, R * PHI_INV2, 14, 0.14, HL_HI, 0.34, 1.6);
    this.strokeSegRing(g, cx, cy, R * PHI_INV3, 10, 0.16, HL, 0.26, 1.3);
    this.strokeSegRing(g, cx, cy, R * PHI_INV3 * PHI_INV, 8, 0.18, HL_HI, 0.2, 1.1);

    // Ad-quadratum plates
    this.strokeAdQuadratum(g, cx, cy, R * 0.52, 5, RIM, 0.24);
    this.strokeRect(g, cx, cy, R * 0.2, R * 0.2, HL_HI, 0.2, 1.35);

    // Hexagon frame (point-up vertex = same as triangle apex language)
    this.strokeRegularPoly(g, cx, cy, R * 0.86, 6, HL, 0.32, 1.9);
    this.strokeRegularPoly(g, cx, cy, R * PHI_INV * 1.1, 6, HL_HI, 0.22, 1.35, Math.PI / 6);
    this.strokeRegularPoly(g, cx, cy, R * 0.7, 8, HL, 0.16, 1.2);
    this.strokePolyNodes(g, cx, cy, R * 0.86, 6, HL, 0.45, 2.6);

    // Seed of Life + vesica in the core
    this.strokeSeedOfLife(g, cx, cy, R * 0.18, HL, 0.2, 1.25);
    this.strokeVesica(g, cx, cy, R * 0.16, HL_HI, 0.16, 1.15);

    // ── Hero triangle cascade: exact φ radii, POINT-UP ONLY ──
    const triR = R * 0.82;
    this.strokeTrianglePhiCascade(g, cx, cy, triR, 9, HL, 0.55, 3.1, PHI_INV);
    // Midpoint-connect cascade (medial triangle still point-up)
    this.strokeTrianglePhiCascade(g, cx, cy, triR * TRI_MID_SCALE, 5, HL_HI, 0.4, 2.0, TRI_MID_SCALE);
    // Second medial step
    this.strokeTrianglePhiCascade(
      g,
      cx,
      cy,
      triR * TRI_MID_SCALE * TRI_MID_SCALE,
      3,
      HL,
      0.28,
      1.5,
      TRI_MID_SCALE,
    );

    // Cross beams through center (cardinal perfection)
    g.lineStyle(1.9, HL, 0.3);
    g.lineBetween(cx - R * 0.92, cy, cx + R * 0.92, cy);
    g.lineBetween(cx, cy - R * 0.92, cx, cy + R * 0.92);
    // Ordinals lighter
    const od = R * 0.72;
    g.lineStyle(1.2, HL_HI, 0.16);
    g.lineBetween(cx - od, cy - od, cx + od, cy + od);
    g.lineBetween(cx + od, cy - od, cx - od, cy + od);

    // Spokes to triangle vertices + midpoint nodes
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i / 3) * Math.PI * 2;
      g.lineStyle(2.2, HL_HI, 0.42);
      g.lineBetween(cx, cy, cx + Math.cos(a) * triR, cy + Math.sin(a) * triR);
      g.fillStyle(HL_HI, 0.6);
      g.fillCircle(cx + Math.cos(a) * triR, cy + Math.sin(a) * triR, 3.6);
      g.fillStyle(0xffffff, 0.5);
      g.fillCircle(cx + Math.cos(a) * triR, cy + Math.sin(a) * triR, 1.4);
      // Edge midpoints
      const a1 = -Math.PI / 2 + ((i + 1) / 3) * Math.PI * 2;
      const mx = cx + (Math.cos(a) + Math.cos(a1)) * 0.5 * triR;
      const my = cy + (Math.sin(a) + Math.sin(a1)) * 0.5 * triR;
      g.fillStyle(HL, 0.45);
      g.fillCircle(mx, my, 2.4);
    }

    // 24 node pips on outer ring
    this.strokePolyNodes(g, cx, cy, R * 0.78, 24, HL, 0.35, 1.8);
    this.strokeRadialTicks(g, cx, cy, R * 0.55, R * 0.96, 24, 3, HL, 0.22);

    // Core hard-light spark — concentric perfection
    g.fillStyle(HL, 0.2);
    g.fillCircle(cx, cy, 18);
    g.lineStyle(1.5, HL_HI, 0.45);
    g.strokeCircle(cx, cy, 12);
    g.strokeCircle(cx, cy, 12 * PHI_INV);
    g.fillStyle(HL_HI, 0.92);
    g.fillCircle(cx, cy, 6);
    g.fillStyle(0xffffff, 0.75);
    g.fillCircle(cx, cy, 2.5);
    // House gold at triangle apex
    g.fillStyle(GOLD, 0.55);
    g.fillCircle(cx, cy - triR * PHI_INV, 2.2);

    // Chevrons at cardinals
    this.strokeChevron(g, cx - R * 0.58, cy, 10, 1, HL, 0.38);
    this.strokeChevron(g, cx + R * 0.58, cy, 10, -1, HL, 0.38);
    this.strokeChevron(g, cx, cy - R * 0.58, 8, 1, HL_HI, 0.28);
    this.strokeChevron(g, cx, cy + R * 0.58, 8, -1, HL_HI, 0.28);

    this.roseG = g;
  }

  private spawnTwinkles(w: number, h: number): void {
    for (let i = 0; i < TWINKLE; i++) {
      const x = (i * 97 + 41) % w;
      const y = ((i * 73 + 19) % Math.floor(h * 0.7)) + 8;
      const r = 1.4 + (i % 4) * 0.5;
      const col = i % 3 === 0 ? HL_HI : 0xc0e8ff;
      const band: Twinkle["band"] = i % 3 === 0 ? "high" : i % 3 === 1 ? "mid" : "bass";
      const body = this.scene.add
        .circle(x, y, r, col, 0.65)
        .setDepth(D_FAR + 0.2)
        .setScrollFactor(SF_FAR)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.twinkles.push({ body, baseA: 0.4 + (i % 3) * 0.1, phase: i * 0.7, band });
    }
  }

  /**
   * Live Arc seals only — scale/rotate/alpha each frame.
   * Never redraw Graphics for audio (perf). φ-spaced radii.
   */
  private spawnLiveRings(w: number, h: number): void {
    const cx = this.motifX;
    const cy = this.motifY;
    const r0 = Math.min(w, h) * 0.34;
    // Radii at exact φ steps; bands map to music/voice drivers.
    const specs: Array<{ r: number; a: number; col: number; w: number; band: Seal["band"]; spin: number }> = [
      { r: r0 * PHI, a: 0.2, col: HL, w: 2.0, band: 3, spin: 1 },
      { r: r0, a: 0.28, col: HL_HI, w: 2.4, band: 1, spin: -1 },
      { r: r0 * PHI_INV, a: 0.32, col: HL, w: 2.1, band: 0, spin: 1 },
      { r: r0 * PHI_INV2, a: 0.26, col: HL_HI, w: 1.8, band: 2, spin: -1 },
      { r: r0 * PHI_INV3, a: 0.22, col: HL, w: 1.5, band: 1, spin: 1 },
      { r: r0 * PHI_INV3 * PHI_INV, a: 0.18, col: GOLD, w: 1.3, band: 3, spin: -1 },
    ];
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i]!;
      const arc = this.scene.add
        .circle(cx, cy, s.r, 0x000000, 0)
        .setStrokeStyle(s.w, s.col, s.a)
        .setDepth(D_MOTIF + 0.05 + i * 0.001)
        .setScrollFactor(SF_MAP)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.seals.push({
        arc,
        restA: s.a,
        restR: s.r,
        spin: s.spin,
        band: s.band,
      });
    }
  }
}
