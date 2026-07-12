// Storm-zone painter — the shrinking safe circle, made UNMISTAKABLE.
//
// Jake, 2026-07-11: "The big circle that encloses works to some extent
// but it is invisible... you just start dying and there is no
// explanation for it." Before this pass there was ZERO rendering of the
// boundary anywhere — computeStormZone (sim/suddenDeath.ts) drove real
// damage with nothing drawn. This painter is the fix: a thick glowing
// seal-ring, on-brand with CosmicArenaLayer's sacred-geometry language,
// animated deterministically off the sim tick (replay-safe).
//
// ONE painter, both scenes (pillar 6) — the ring a clip shows is the ring
// that hurt the player.

import type Phaser from "phaser";
import type { StormZoneRenderModel } from "./renderContract.js";

const TWO_PI = Math.PI * 2;

/** Cool cyan/gold — a warning, not yet a punish. */
const ENDGAME_RING = 0x8ff8ff;
const ENDGAME_GLOW = 0xffd166;
/** Hot crimson/gold — the real storm. */
const SUDDEN_RING = 0xff4d5e;
const SUDDEN_GLOW = 0xffd166;

/**
 * Draw the storm boundary. `tick` is the sim tick (NOT wall-clock) so the
 * animation is bit-identical across live play and replay renders.
 */
export function drawStormZone(
  g: Phaser.GameObjects.Graphics,
  m: StormZoneRenderModel,
  tick: number,
  fxLevel: number,
): void {
  if (!m.active) return;
  const hot = m.kind === "sudden-death";
  const ring = hot ? SUDDEN_RING : ENDGAME_RING;
  const glow = hot ? SUDDEN_GLOW : ENDGAME_GLOW;
  // Urgency rises as the zone closes in (scale 1→END) — pulse speeds up
  // and the ring thickens. Tick-driven, deterministic.
  const closedness = hot ? 1 - (m.scale - 0.6) / 0.4 : 1 - (m.scale - 0.75) / 0.25;
  const t = tick / 60; // seconds-equivalent, sim-clock
  const pulseHz = 0.5 + closedness * 1.2;
  const pulse = 0.5 + 0.5 * Math.sin(t * TWO_PI * pulseHz);

  // ── Outer danger haze: concentric fading rings OUTSIDE the boundary —
  // reads as "the void beyond the seal" without needing a true clip/hole. ──
  const hazeBands = fxLevel >= 1 ? 5 : 3;
  for (let i = 0; i < hazeBands; i++) {
    const r = m.radius + 14 + i * 22;
    const a = (0.10 - i * 0.016) * (0.6 + 0.4 * closedness);
    if (a <= 0.005) continue;
    g.lineStyle(3, ring, a);
    g.strokeCircle(m.centerX, m.centerY, r);
  }

  // ── The seal itself: layered glow → hard ring → hot inner line ──
  const baseWidth = 3 + closedness * 3;
  g.lineStyle(baseWidth + 10, glow, 0.10 + 0.08 * pulse);
  g.strokeCircle(m.centerX, m.centerY, m.radius);
  g.lineStyle(baseWidth + 4, ring, 0.28 + 0.14 * pulse);
  g.strokeCircle(m.centerX, m.centerY, m.radius);
  g.lineStyle(baseWidth, ring, 0.85 + 0.15 * pulse);
  g.strokeCircle(m.centerX, m.centerY, m.radius);
  g.lineStyle(1.4, 0xffffff, 0.55 + 0.35 * pulse);
  g.strokeCircle(m.centerX, m.centerY, m.radius);

  // ── Rune ticks around the circumference (fx1+): the seal's geometric
  // language — short radial marks, slowly counter-rotating. ──
  if (fxLevel >= 1) {
    const ticks = 24;
    const spin = t * (hot ? 0.12 : 0.06);
    for (let k = 0; k < ticks; k++) {
      const a = spin + (k * TWO_PI) / ticks;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const inner = m.radius - 6;
      const outer = m.radius + (k % 4 === 0 ? 16 : 9);
      g.lineStyle(k % 4 === 0 ? 2 : 1, glow, k % 4 === 0 ? 0.7 : 0.4);
      g.beginPath();
      g.moveTo(m.centerX + cos * inner, m.centerY + sin * inner);
      g.lineTo(m.centerX + cos * outer, m.centerY + sin * outer);
      g.strokePath();
    }
  }

  // ── fx2: a slow counter-rotating dashed outer ring — full mandala read. ──
  if (fxLevel >= 2) {
    const dashCount = 40;
    const dashSpin = -t * 0.1;
    const dashR = m.radius + 30;
    g.lineStyle(1.5, ring, 0.35);
    for (let k = 0; k < dashCount; k += 2) {
      const a0 = dashSpin + (k * TWO_PI) / dashCount;
      const a1 = dashSpin + ((k + 1) * TWO_PI) / dashCount;
      g.beginPath();
      g.moveTo(m.centerX + Math.cos(a0) * dashR, m.centerY + Math.sin(a0) * dashR);
      g.lineTo(m.centerX + Math.cos(a1) * dashR, m.centerY + Math.sin(a1) * dashR);
      g.strokePath();
    }
  }
}
