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
import type { SoulRenderModel } from "./renderContract.js";
import { SOUL_ABSORB, SOUL_RELEASE } from "./renderContract.js";

const CORE = 0xffffff;
const INNER = 0x8ff8ff;
const HALO = 0xffd166;

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

    // ── Corpse dissolve (fx1+): motes lifting off the death point ──
    if (fxLevel >= 1 && m.dissolveT < 1) {
      const t = m.dissolveT;
      const fade = 1 - t;
      for (let k = 0; k < (fxLevel >= 2 ? 7 : 4); k++) {
        // Deterministic scatter: angle/speed from seed+k only.
        const a = m.seed + (k * TWO_PI) / 7 + Math.sin(m.seed * 3 + k) * 0.6;
        const speed = 26 + ((k * 37) % 23);
        const dx = Math.cos(a) * speed * t;
        const dy = -Math.abs(Math.sin(a)) * (34 + speed) * t - 18 * t;
        g.fillStyle(INNER, 0.5 * fade);
        g.fillCircle(m.originX + dx, m.originY + dy, 2.4 * fade + 0.6);
      }
      // Dissolving body shadow — a fading vertical smear where they fell.
      g.fillStyle(INNER, 0.14 * fade);
      g.fillEllipse(m.originX, m.originY - 6 * t, 20 * fade, 40 * fade);
    }

    // ── Trail ──
    const trailPts = fxLevel === 0 ? Math.min(5, m.trailLen) : m.trailLen;
    for (let k = 0; k < trailPts; k++) {
      // newest→oldest: head-1 is newest.
      const idx = (m.trailHead - 1 - k + m.trailX.length * 2) % m.trailX.length;
      const age = (k + 1) / (trailPts + 1);
      const a = m.alpha * 0.34 * (1 - age);
      if (a <= 0.01) continue;
      g.fillStyle(INNER, a);
      g.fillCircle(m.trailX[idx]!, m.trailY[idx]!, m.r * (1 - age * 0.75) * 0.7);
    }

    // ── The soul mote (all tiers): halo → inner glow → hot core ──
    if (m.r > 0.2) {
      const breathe = 1 + Math.sin(m.seed + m.progress * TWO_PI * 2) * 0.08;
      g.fillStyle(HALO, 0.10 * m.alpha);
      g.fillCircle(m.x, m.y, m.r * 3.1 * breathe);
      g.fillStyle(INNER, 0.30 * m.alpha);
      g.fillCircle(m.x, m.y, m.r * 1.8 * breathe);
      g.fillStyle(CORE, 0.92 * m.alpha);
      g.fillCircle(m.x, m.y, m.r * 0.85);
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

    // ── Absorption at the motif (all tiers; richer at fx2) ──
    if (m.absorbT > 0) {
      const t = m.absorbT;
      const fade = 1 - t;
      // Expanding reception ring.
      g.lineStyle(2 + 2 * fade, HALO, 0.75 * fade);
      g.strokeCircle(m.motifX, m.motifY, 12 + t * 68);
      if (fxLevel >= 1) {
        g.lineStyle(1.5, INNER, 0.5 * fade);
        g.strokeCircle(m.motifX, m.motifY, 6 + t * 110);
      }
      if (fxLevel >= 2) {
        // Inner counter-flare: a bright collapsing ring meeting the soul.
        g.lineStyle(2, CORE, 0.6 * fade);
        g.strokeCircle(m.motifX, m.motifY, 34 * fade + 4);
        // Cross flare rays.
        const ray = 26 + 44 * t;
        g.lineStyle(1.5, HALO, 0.55 * fade);
        for (let k = 0; k < 6; k++) {
          const a = m.seed + (k * TWO_PI) / 6;
          g.beginPath();
          g.moveTo(m.motifX + Math.cos(a) * 10, m.motifY + Math.sin(a) * 10);
          g.lineTo(m.motifX + Math.cos(a) * ray, m.motifY + Math.sin(a) * ray);
          g.strokePath();
        }
      }
    }
  }
}
