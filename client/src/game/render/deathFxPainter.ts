// Painter for the death-FX contract models (renderContract.produceDeathFx).
// ONE painter, imported by OnlineMatchScene AND ReplayScene, so live play
// and replay-rendered clips are the same code path (pillar 6).
//
// Everything is drawn on a single ADD-blended Graphics per frame — no
// sprites, no tweens, no allocation. Determinism holds because every mark
// derives from the model (which derives from sim state + age).
//
// Palette: the soul is LIGHT — hot white core, the game's crystal cyan
// inner glow, and the motif's gold as the halo — reads gnostic against the
// sacred-geometry seal without team-color confusion.

import type Phaser from "phaser";
import type { ShardRenderModel, SoulRenderModel, UploadRenderModel } from "./renderContract.js";
import { SOUL_ABSORB, SOUL_DENIED, SOUL_JOURNEY, SOUL_RELEASE } from "./renderContract.js";

const CORE = 0xffffff;
const INNER = 0x8ff8ff;
const HALO = 0xffd166;

// ASCENSION DENIED palette (void-hand kills — emission-engine-goal P2):
// the light is WRONG — a bruised violet core, void inner, near-black halo.
// Same three-layer mote grammar, inverted register: everyone who has
// watched one normal death reads instantly that this soul isn't rising.
const D_CORE = 0xd8ccf4;
const D_INNER = 0x8b5cf6;
const D_HALO = 0x3b1d6e;

const TWO_PI = Math.PI * 2;

/**
 * Draw every soul. `fxLevel`: 0 = legible core only (mote + short trail +
 * absorb ring), 1 = + corpse dissolve motes and full trail, 2 = + orbiting
 * rune triangle, ribbon, and layered absorb flare.
 */
export function drawDeathFx(
  g: Phaser.GameObjects.Graphics,
  models: SoulRenderModel[],
  count: number,
  fxLevel: number,
): void {
  for (let i = 0; i < count; i++) {
    const m = models[i]!;
    // ASCENSION DENIED (void-hand kill): same mote grammar, inverted
    // palette, and — the actual denial — NO ascending pillar, no skyward
    // scatter. The absorb bloom never fires because denied souls never
    // set absorbT (renderContract's denied envelope).
    const denied = m.stage === SOUL_DENIED;
    const coreC = denied ? D_CORE : CORE;
    const innerC = denied ? D_INNER : INNER;
    const haloC = denied ? D_HALO : HALO;

    // ── Corpse dissolve (fx1+): explosive flash, spark ring, rising motes ──
    if (fxLevel >= 1 && m.dissolveT < 1) {
      const t = m.dissolveT;
      const fade = 1 - t;
      // HEROIC pop: hot flash, DOUBLE shockwave, long radial rays — the
      // dopamine hit. All envelopes off dissolveT (deterministic). The
      // kill still POPS when denied (killer feedback stays) — it's the
      // aftermath that goes wrong.
      const pop = Math.max(0, 1 - t * 4.5);
      if (pop > 0) {
        g.fillStyle(coreC, 0.62 * pop);
        g.fillCircle(m.originX, m.originY, 42 * (1 - pop) + 10);
        g.lineStyle(4 * pop, haloC, 0.85 * pop);
        g.strokeCircle(m.originX, m.originY, 14 + (1 - pop) * 96);
        g.lineStyle(2.5 * pop, innerC, 0.6 * pop);
        g.strokeCircle(m.originX, m.originY, 8 + (1 - pop) * 148);
        const sparks = fxLevel >= 2 ? 14 : 8;
        for (let k = 0; k < sparks; k++) {
          const a = m.seed * 1.7 + (k * TWO_PI) / sparks;
          const d0 = 12 + (1 - pop) * 104;
          const len = 16 + ((k * 31) % 18);
          g.lineStyle(1.8, k % 2 ? haloC : innerC, 0.95 * pop);
          g.beginPath();
          g.moveTo(m.originX + Math.cos(a) * d0, m.originY + Math.sin(a) * d0);
          g.lineTo(m.originX + Math.cos(a) * (d0 + len), m.originY + Math.sin(a) * (d0 + len));
          g.strokePath();
        }
      }
      if (!denied) {
        // Ascending light pillar — the heroic beat: a column of light marks
        // where they fell, rushing skyward and thinning out (~900ms).
        const pillar = 1 - t;
        if (pillar > 0.02) {
          const ph = 150 + 90 * t;
          g.fillStyle(INNER, 0.13 * pillar);
          g.fillRect(m.originX - 13, m.originY - ph, 26, ph);
          g.fillStyle(CORE, 0.22 * pillar);
          g.fillRect(m.originX - 4, m.originY - ph, 8, ph);
          if (fxLevel >= 1) {
            g.fillStyle(HALO, 0.10 * pillar);
            g.fillRect(m.originX - 22, m.originY - ph * 0.6, 44, ph * 0.6);
          }
        }
        for (let k = 0; k < (fxLevel >= 2 ? 7 : 4); k++) {
          // Deterministic scatter: angle/speed from seed+k only.
          const a = m.seed + (k * TWO_PI) / 7 + Math.sin(m.seed * 3 + k) * 0.6;
          const speed = 26 + ((k * 37) % 23);
          const dx = Math.cos(a) * speed * t;
          const dy = -Math.abs(Math.sin(a)) * (34 + speed) * t - 18 * t;
          g.fillStyle(INNER, 0.5 * fade);
          g.fillCircle(m.originX + dx, m.originY + dy, 2.4 * fade + 0.6);
        }
      } else {
        // The pillar's INVERSION: a short void stain sinking BELOW the
        // death point, and the scatter motes fall instead of rising.
        const stain = 1 - t;
        if (stain > 0.02) {
          const sh = 46 + 30 * t;
          g.fillStyle(D_INNER, 0.11 * stain);
          g.fillRect(m.originX - 10, m.originY, 20, sh);
          g.fillStyle(D_HALO, 0.16 * stain);
          g.fillRect(m.originX - 4, m.originY, 8, sh * 0.8);
        }
        for (let k = 0; k < (fxLevel >= 2 ? 7 : 4); k++) {
          const a = m.seed + (k * TWO_PI) / 7 + Math.sin(m.seed * 3 + k) * 0.6;
          const speed = 26 + ((k * 37) % 23);
          const dx = Math.cos(a) * speed * t;
          const dy = Math.abs(Math.sin(a)) * (26 + speed * 0.6) * t + 10 * t;
          g.fillStyle(D_INNER, 0.5 * fade);
          g.fillCircle(m.originX + dx, m.originY + dy, 2.4 * fade + 0.6);
        }
      }
      // Dissolving body shadow — a fading vertical smear where they fell.
      g.fillStyle(innerC, 0.14 * fade);
      g.fillEllipse(m.originX, m.originY - 6 * t, 20 * fade, 40 * fade);
    }

    // ── Trail: glowing dots + a connected RIBBON (fx1+) ──
    const trailPts = fxLevel === 0 ? Math.min(5, m.trailLen) : m.trailLen;
    let prevX = m.x;
    let prevY = m.y;
    for (let k = 0; k < trailPts; k++) {
      // newest→oldest: head-1 is newest.
      const idx = (m.trailHead - 1 - k + m.trailX.length * 2) % m.trailX.length;
      const age = (k + 1) / (trailPts + 1);
      const a = m.alpha * 0.36 * (1 - age);
      const tx = m.trailX[idx]!;
      const ty = m.trailY[idx]!;
      if (a > 0.01) {
        g.fillStyle(innerC, a);
        g.fillCircle(tx, ty, m.r * (1 - age * 0.75) * 0.7);
        if (fxLevel >= 1) {
          g.lineStyle(Math.max(0.8, m.r * 0.5 * (1 - age)), innerC, a * 0.9);
          g.beginPath();
          g.moveTo(prevX, prevY);
          g.lineTo(tx, ty);
          g.strokePath();
        }
      }
      prevX = tx;
      prevY = ty;
    }
    // Sparks shed along the journey (fx1+): tiny motes drifting off the path.
    if (fxLevel >= 1 && m.stage === SOUL_JOURNEY && m.alpha > 0.5) {
      for (let k = 0; k < (fxLevel >= 2 ? 4 : 2); k++) {
        const ph = (m.progress * 7 + k * 0.37 + m.seed) % 1;
        const idx = (m.trailHead - 1 - ((k * 2) % Math.max(1, m.trailLen)) + m.trailX.length * 2) % m.trailX.length;
        const sx = m.trailX[idx]! + Math.sin(m.seed * 9 + k * 5) * 10 * ph;
        const sy = m.trailY[idx]! - 14 * ph;
        g.fillStyle(HALO, 0.55 * (1 - ph) * m.alpha);
        g.fillCircle(sx, sy, 1.4 + (1 - ph));
      }
    }

    // ── The soul mote (all tiers): halo → inner glow → hot core ──
    if (m.r > 0.2) {
      const breathe = 1 + Math.sin(m.seed + m.progress * TWO_PI * 2) * 0.09;
      g.fillStyle(haloC, 0.12 * m.alpha);
      g.fillCircle(m.x, m.y, m.r * 3.4 * breathe);
      g.fillStyle(innerC, 0.32 * m.alpha);
      g.fillCircle(m.x, m.y, m.r * 1.9 * breathe);
      g.fillStyle(coreC, 0.94 * m.alpha);
      g.fillCircle(m.x, m.y, m.r * 0.9);
      // Halo ray crown (fx1+): four slow-turning rays of light. Denied
      // souls get no crown — nothing is celebrating this one.
      if (fxLevel >= 1 && m.stage !== SOUL_RELEASE && !denied) {
        const spin = m.seed + m.progress * TWO_PI * 0.75;
        const rayLen = m.r * 3.8 * breathe;
        g.lineStyle(1.2, CORE, 0.5 * m.alpha);
        for (let k = 0; k < 4; k++) {
          const a = spin + (k * Math.PI) / 2;
          g.beginPath();
          g.moveTo(m.x + Math.cos(a) * m.r, m.y + Math.sin(a) * m.r);
          g.lineTo(m.x + Math.cos(a) * rayLen, m.y + Math.sin(a) * rayLen);
          g.strokePath();
        }
      }
    }

    // ── The UNMAKING (denied only): a contracting void ring crushes the
    // mote out during the fall phase — inward rays, the exact inverse of
    // the motif's reception rings. This is the crime, made watchable. ──
    if (denied && m.progress > 0.35) {
      const crush = (m.progress - 0.35) / 0.65;
      const ringR = 34 * (1 - crush) + m.r;
      g.lineStyle(2 + 2 * crush, D_INNER, 0.35 + 0.5 * crush);
      g.strokeCircle(m.x, m.y, ringR);
      if (fxLevel >= 1) {
        g.lineStyle(1.2, D_CORE, 0.5 * crush);
        for (let k = 0; k < 6; k++) {
          const a = m.seed * 2.3 + (k * TWO_PI) / 6 - crush * 0.8;
          const outer = ringR + 10 + 14 * (1 - crush);
          g.beginPath();
          g.moveTo(m.x + Math.cos(a) * outer, m.y + Math.sin(a) * outer);
          g.lineTo(m.x + Math.cos(a) * (ringR + 1), m.y + Math.sin(a) * (ringR + 1));
          g.strokePath();
        }
      }
    }

    // ── Orbiting rune triangle (fx2): three points circling the mote ──
    if (fxLevel >= 2 && m.stage !== SOUL_ABSORB && m.alpha > 0.3) {
      const orbit = m.r * 2.6;
      const spin = m.seed + m.progress * TWO_PI * (m.stage === SOUL_RELEASE ? 1.5 : 3);
      g.lineStyle(1, HALO, 0.5 * m.alpha);
      g.beginPath();
      for (let k = 0; k <= 3; k++) {
        const a = spin + (k % 3) * (TWO_PI / 3);
        const px = m.x + Math.cos(a) * orbit;
        const py = m.y + Math.sin(a) * orbit;
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokePath();
    }

    // ── Absorption at the motif — the AWE beat (all tiers; grand at fx2) ──
    if (m.absorbT > 0) {
      const t = m.absorbT;
      const fade = 1 - t;
      // Motif BLOOM: a soft golden swell as the seal receives the soul.
      g.fillStyle(HALO, 0.22 * fade);
      g.fillCircle(m.motifX, m.motifY, 30 + Math.sqrt(t) * 190);
      g.fillStyle(CORE, 0.18 * fade);
      g.fillCircle(m.motifX, m.motifY, 14 + Math.sqrt(t) * 90);
      // Triple staggered reception rings.
      g.lineStyle(3 + 2.5 * fade, HALO, 0.8 * fade);
      g.strokeCircle(m.motifX, m.motifY, 16 + t * 170);
      if (fxLevel >= 1) {
        g.lineStyle(2, INNER, 0.55 * fade);
        g.strokeCircle(m.motifX, m.motifY, 8 + t * 260);
        const t2 = Math.max(0, t - 0.25) / 0.75;
        if (t2 > 0) {
          g.lineStyle(1.6, CORE, 0.5 * (1 - t2));
          g.strokeCircle(m.motifX, m.motifY, 10 + t2 * 215);
        }
      }
      if (fxLevel >= 2) {
        // Inner counter-flare: a bright collapsing ring meeting the soul.
        g.lineStyle(2.2, CORE, 0.65 * fade);
        g.strokeCircle(m.motifX, m.motifY, 40 * fade + 4);
        // Ray burst — ten spokes of light.
        const ray = 40 + 150 * t;
        g.lineStyle(1.6, HALO, 0.6 * fade);
        for (let k = 0; k < 10; k++) {
          const a = m.seed + (k * TWO_PI) / 10 + t * 0.5;
          g.beginPath();
          g.moveTo(m.motifX + Math.cos(a) * 12, m.motifY + Math.sin(a) * 12);
          g.lineTo(m.motifX + Math.cos(a) * ray, m.motifY + Math.sin(a) * ray);
          g.strokePath();
        }
      }
    }
  }
}

/** Reward shards — the shiny pour-out that locks onto whoever earned it. */
export function drawDeathShards(
  g: Phaser.GameObjects.Graphics,
  models: ShardRenderModel[],
  count: number,
  fxLevel: number,
): void {
  const cap = fxLevel === 0 ? Math.min(5, count) : count;
  for (let i = 0; i < cap; i++) {
    const m = models[i]!;
    if (m.arriveT > 0) {
      // Arrival ping at the earner: expanding ring + brief gold flash.
      const fade = 1 - m.arriveT;
      g.lineStyle(2, HALO, 0.8 * fade);
      g.strokeCircle(m.targetX, m.targetY, 10 + m.arriveT * 34);
      g.fillStyle(CORE, 0.35 * fade);
      g.fillCircle(m.targetX, m.targetY, 7 * fade);
      continue;
    }
    if (m.alpha <= 0.02) continue;
    const r = 4.6 * m.size;
    // Gold diamond gem with a hot core.
    g.fillStyle(HALO, 0.85 * m.alpha);
    g.fillTriangle(m.x, m.y - r, m.x - r * 0.72, m.y, m.x + r * 0.72, m.y);
    g.fillTriangle(m.x, m.y + r, m.x - r * 0.72, m.y, m.x + r * 0.72, m.y);
    g.fillStyle(CORE, 0.95 * m.alpha);
    g.fillCircle(m.x, m.y, r * 0.34);
    if (fxLevel >= 1) {
      // Glint: a rotating sparkle cross.
      const gl = (Math.sin(m.glint) + 1) / 2;
      if (gl > 0.55) {
        const s = r * (0.9 + gl);
        const a = gl * 0.7 * m.alpha;
        g.lineStyle(1, CORE, a);
        g.beginPath();
        g.moveTo(m.x - s, m.y);
        g.lineTo(m.x + s, m.y);
        g.moveTo(m.x, m.y - s);
        g.lineTo(m.x, m.y + s);
        g.strokePath();
      }
      g.fillStyle(HALO, 0.16 * m.alpha);
      g.fillCircle(m.x, m.y, r * 2.1);
    }
  }
}

/** Spawn-in: the digital gnostic upload — spirit streams into the vessel. */
export function drawSpawnUploads(
  g: Phaser.GameObjects.Graphics,
  models: UploadRenderModel[],
  count: number,
  fxLevel: number,
): void {
  const GOLDEN = 2.399963;
  for (let i = 0; i < count; i++) {
    const m = models[i]!;
    const p = m.progress;
    // Envelope: quick arrival, sustained, dissolve at the end.
    const env = Math.min(1, p * 5) * (1 - Math.max(0, (p - 0.78) / 0.22));

    // Converging spirit motes: spiral inward as the upload completes.
    const motes = fxLevel >= 2 ? 16 : fxLevel === 1 ? 10 : 6;
    for (let k = 0; k < motes; k++) {
      // Each mote starts its infall at a staggered time.
      const phase = (p * 1.35 + k / motes) % 1;
      const rad = (1 - phase) * 74;
      if (rad < 2) continue;
      const a = m.seed + k * GOLDEN + p * 2.2;
      const mx = m.x + Math.cos(a) * rad;
      const my = m.y - 26 + Math.sin(a) * rad * 0.85;
      g.fillStyle(k % 3 === 0 ? HALO : INNER, 0.62 * env * phase);
      g.fillCircle(mx, my, 1.6 + phase * 1.8);
    }

    // Vertical beam — the download column.
    g.fillStyle(INNER, 0.10 * env);
    g.fillRect(m.x - 9, m.y - 92, 18, 92);
    g.fillStyle(CORE, 0.16 * env);
    g.fillRect(m.x - 2.5, m.y - 92, 5, 92);
    if (fxLevel >= 1) {
      // Descending data-rune dashes inside the beam.
      for (let k = 0; k < 5; k++) {
        const dp = (p * 2.4 + k * 0.2) % 1;
        g.fillStyle(HALO, 0.5 * env * (1 - dp));
        g.fillRect(m.x - 5 + ((k * 37) % 10), m.y - 90 + dp * 82, 6, 2);
      }
    }

    // Glyph ring at the feet: rotating; hexagram at fx2.
    const feetY = m.y + 28;
    const ringR = 20 + 6 * Math.sin(p * Math.PI);
    g.lineStyle(1.5, HALO, 0.55 * env);
    g.strokeEllipse(m.x, feetY, ringR * 2, ringR * 0.8);
    if (fxLevel >= 2) {
      const spin = m.seed + p * 3;
      g.lineStyle(1, INNER, 0.5 * env);
      for (let tri = 0; tri < 2; tri++) {
        g.beginPath();
        for (let k = 0; k <= 3; k++) {
          const a = spin + tri * (Math.PI / 3) + (k % 3) * (TWO_PI / 3);
          const px = m.x + Math.cos(a) * ringR;
          const py = feetY + Math.sin(a) * ringR * 0.4;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.strokePath();
      }
    }
  }
}
