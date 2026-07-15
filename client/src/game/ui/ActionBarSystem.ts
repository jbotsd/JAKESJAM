// ActionBarSystem — bottom-center Diablo-style hotkey bar.
//
// Jake, 2026-07-14: "design and build a diablo style hotkeys thing" +
// "i think therell be about the diablo amount of abilities" — grounded in
// sourced research across D2/D3/D4 (not recalled-only): dual resource orbs
// flanking a central ability row, consumable input ALWAYS separate from the
// ability slots (D2's belt keys, D3's locked "5", D4's "Q" — no mainline
// entry ever shares that key with an ability), max ~6 active slots as the
// converged build-depth/legibility ceiling (D3 Elective Mode, D4's skill
// bar), radial-wipe cooldowns over numeral overlays, and a buff/debuff icon
// row ABOVE the bar — capped and prioritized from day one, since D4 players
// have filed live complaints about that row hiding stacks when uncapped.
//
// JAKESJAM today has exactly two hotkeyable actions (Fire/M1, Dash/M2) —
// the other four slots render RESERVED (dim outline, no glyph) rather than
// being omitted, so the bar is already sized for the ability count Jake
// expects the card system to grow into, instead of a redesign later.
//
// Visual language matches the rest of the HUD, not a new style: chamfered
// "crystal-cut" diamonds (docs/asset-prompts/02-hud-chrome.md, "Ability
// Cooldown Diamond") and the same faceted-ring resource language as the
// nameplate column (facetedRing.ts) — one manufactured system, not a
// bolted-on ARPG skin.

import Phaser from "phaser";
import { uiWidth, uiHeight } from "../render/renderResolution.js";
import { PALETTE } from "./palette.js";
import { drawFacetedRing, healthRingColor } from "../render/facetedRing.js";
import type { HudChip } from "./HudSystem.js";

export type ActionBarVitals = {
  health: number;
  maxHealth: number;
  shieldCharge: number;
  shieldMaxCharge: number;
  /** 0-1, dash-bash readiness (0 = just used, 1 = ready) — drives the M2 slot's ring. */
  dashReadyFrac: number;
  isDead: boolean;
};

const PAD_BOTTOM = 20;
const PAD_BOTTOM_COMPACT = 14;
// Full-size bar: HP orb + 6 slots + shield orb spans ~460px — overflows a
// 400px phone viewport (orbs clipped off both edges). Compact sizing keeps
// the same layout ratios at a scale that fits with margin either side.
const ORB_R = 38;
const ORB_R_COMPACT = 24;
const ORB_GAP = 26;
const ORB_GAP_COMPACT = 13;
const SLOT_R = 21;
const SLOT_R_COMPACT = 13;
const SLOT_GAP = 9;
const SLOT_GAP_COMPACT = 5;
const SLOT_COUNT = 6;
const BUFF_TICK_R = 9;
const BUFF_TICK_GAP = 6;
const MAX_BUFF_TICKS = 6; // D4's uncapped row is a documented cautionary tale — cap on day one.

const C_SHIELD = 0x93c5fd;
const C_FRAME = 0x2a3550;
const C_FRAME_DIM = 0x1c2438;

/** Linear RGB lerp between two 0xRRGGBB ints — used to make the ability
 *  slot's color/alpha genuinely track `ready` across the whole cooldown
 *  instead of snapping at the very last instant (see drawLiveSlot). */
function lerpHexColor(from: number, to: number, t: number): number {
  const k = Phaser.Math.Clamp(t, 0, 1);
  const fr = (from >> 16) & 0xff, fg = (from >> 8) & 0xff, fb = from & 0xff;
  const tr = (to >> 16) & 0xff, tg = (to >> 8) & 0xff, tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * k);
  const gr = Math.round(fg + (tg - fg) * k);
  const b = Math.round(fb + (tb - fb) * k);
  return (r << 16) | (gr << 8) | b;
}

type LiveSlot = { keyLabel: string; glyph: "shuriken" | "dash" };
const LIVE_SLOTS: LiveSlot[] = [
  { keyLabel: "M1", glyph: "shuriken" }, // Fire — no cooldown today, reads always-ready.
  { keyLabel: "M2", glyph: "dash" }, // Dash — ring driven by dashReadyFrac.
];

export class ActionBarSystem {
  private readonly scene: Phaser.Scene;
  private g!: Phaser.GameObjects.Graphics;
  private hpText!: Phaser.GameObjects.Text;
  private shText!: Phaser.GameObjects.Text;
  private slotKeyLabels: Phaser.GameObjects.Text[] = [];

  private compact = false;
  // Resolved sizes (compact vs full) — set once in build() from viewport
  // width, same convention as HudSystem's nameplateR.
  private orbR = ORB_R;
  private orbGap = ORB_GAP;
  private slotR = SLOT_R;
  private slotGap = SLOT_GAP;
  private padBottom = PAD_BOTTOM;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.build();
  }

  destroy(): void {
    this.scene.scale.off("resize", this.onResize, this);
    this.g.destroy();
    this.hpText.destroy();
    this.shText.destroy();
    for (const t of this.slotKeyLabels) t.destroy();
    this.slotKeyLabels = [];
  }

  private build(): void {
    const s = this.scene;
    const depth = 900;
    this.compact = uiWidth(s) < 520;
    this.orbR = this.compact ? ORB_R_COMPACT : ORB_R;
    this.orbGap = this.compact ? ORB_GAP_COMPACT : ORB_GAP;
    this.slotR = this.compact ? SLOT_R_COMPACT : SLOT_R;
    this.slotGap = this.compact ? SLOT_GAP_COMPACT : SLOT_GAP;
    this.padBottom = this.compact ? PAD_BOTTOM_COMPACT : PAD_BOTTOM;

    this.g = s.add.graphics().setScrollFactor(0).setDepth(depth + 1);

    const fontBase = {
      fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
      fontStyle: "bold",
      stroke: "#05080f",
      strokeThickness: 3,
    } as const;

    this.hpText = s.add
      .text(0, 0, "", { ...fontBase, fontSize: this.compact ? "11px" : "13px", color: "#b8f05a" })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 2);
    this.shText = s.add
      .text(0, 0, "", { ...fontBase, fontSize: this.compact ? "9px" : "10px", color: "#93c5fd" })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 2);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const label = s.add
        .text(0, 0, i < LIVE_SLOTS.length ? LIVE_SLOTS[i]!.keyLabel : "—", {
          ...fontBase,
          fontSize: this.compact ? "7px" : "8px",
          color: i < LIVE_SLOTS.length ? "#8ff8ff" : "#4b5568",
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(depth + 2);
      this.slotKeyLabels.push(label);
    }

    s.scale.on("resize", this.onResize, this);
    this.layout();
  }

  private onResize(): void {
    this.layout();
  }

  /** Positions everything that doesn't move frame-to-frame (labels) — the
   *  Graphics itself is fully redrawn each update() call regardless. */
  private layout(): void {
    const s = this.scene;
    const w = uiWidth(s);
    const h = uiHeight(s);
    const centerX = w / 2;
    const barY = h - this.padBottom - Math.max(this.orbR, this.slotR);
    const rowW = SLOT_COUNT * this.slotR * 2 + (SLOT_COUNT - 1) * this.slotGap;
    const rowLeft = centerX - rowW / 2;

    this.hpText.setPosition(centerX - rowW / 2 - this.orbGap - this.orbR, barY);
    this.shText.setPosition(centerX + rowW / 2 + this.orbGap + this.orbR, barY);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const sx = rowLeft + this.slotR + i * (this.slotR * 2 + this.slotGap);
      this.slotKeyLabels[i]!.setPosition(sx, barY + this.slotR + 4);
    }
  }

  update(vitals: ActionBarVitals, chips: HudChip[]): void {
    this.layout(); // cheap; keeps labels correct if uiWidth changed without a resize event
    const g = this.g;
    g.clear();

    const s = this.scene;
    const w = uiWidth(s);
    const h = uiHeight(s);
    const centerX = w / 2;
    const barY = h - this.padBottom - Math.max(this.orbR, this.slotR);
    const rowW = SLOT_COUNT * this.slotR * 2 + (SLOT_COUNT - 1) * this.slotGap;
    const rowLeft = centerX - rowW / 2;
    const hpOrbX = centerX - rowW / 2 - this.orbGap - this.orbR;
    const shOrbX = centerX + rowW / 2 + this.orbGap + this.orbR;

    // ── Resource orbs (health left, shield right — dual-orb convention
    // held across D2/D3/D4; ratio-only fill, no liquid-sim, matching the
    // rest of the HUD's faceted-ring language rather than a new widget) ──
    const hpRatio = vitals.maxHealth > 0 ? Phaser.Math.Clamp(vitals.health / vitals.maxHealth, 0, 1) : 0;
    const shRatio = vitals.shieldMaxCharge > 0 ? Phaser.Math.Clamp(vitals.shieldCharge / vitals.shieldMaxCharge, 0, 1) : 0;

    this.drawOrb(g, hpOrbX, barY, this.orbR, hpRatio, healthRingColor(hpRatio), vitals.isDead);
    this.hpText.setText(vitals.isDead ? "—" : `${Math.ceil(vitals.health)}`);
    this.hpText.setVisible(true);

    if (vitals.shieldMaxCharge > 0 && !vitals.isDead) {
      this.drawOrb(g, shOrbX, barY, this.orbR, shRatio, C_SHIELD, false);
      this.shText.setText(`${Math.ceil(vitals.shieldCharge)}`);
      this.shText.setVisible(true);
    } else if (vitals.shieldMaxCharge > 0) {
      // Dead — shield exists but isn't usable right now; show it extinguished
      // rather than a normal charged orb (the bar shouldn't claim you can
      // still block while eliminated).
      this.drawOrb(g, shOrbX, barY, this.orbR, shRatio, C_SHIELD, true);
      this.shText.setVisible(false);
    } else {
      // No shield resource on this character — dim empty frame, not a lit
      // "0" orb (a real absence reads differently from a drained resource).
      this.drawEmptyOrbFrame(g, shOrbX, barY, this.orbR);
      this.shText.setVisible(false);
    }

    // ── Ability slots — chamfered "crystal-cut" diamonds. Slot 0 = Fire
    // (M1, no cooldown today → always reads ready). Slot 1 = Dash (M2,
    // ring driven by dashReadyFrac). Slots 2-5 = reserved for future
    // abilities (Jake: "diablo amount of abilities") — dim outline only,
    // no glyph, so the bar doesn't need a redesign when they go live. While
    // dead, ALL live slots render disabled — the bar shouldn't keep reading
    // "ready to fire" when the input is actually inert (caught in a UI pass,
    // 2026-07-14: the bar only dimmed the HP orb, never the abilities). ──
    for (let i = 0; i < SLOT_COUNT; i++) {
      const sx = rowLeft + this.slotR + i * (this.slotR * 2 + this.slotGap);
      const live = LIVE_SLOTS[i];
      if (!live) {
        this.drawReservedSlot(g, sx, barY, this.slotR);
        continue;
      }
      if (vitals.isDead) {
        this.drawDisabledSlot(g, sx, barY, this.slotR, live.glyph);
        continue;
      }
      const ready = live.glyph === "dash" ? vitals.dashReadyFrac : 1;
      this.drawLiveSlot(g, sx, barY, this.slotR, ready, live.glyph);
    }

    // ── Buff/debuff row above the bar — capped + priority-ordered (D4's
    // own players complain when this row isn't; see file header). ──
    const shown = chips.slice(0, MAX_BUFF_TICKS);
    if (shown.length > 0) {
      const tickR = this.compact ? BUFF_TICK_R * 0.75 : BUFF_TICK_R;
      const tickGap = this.compact ? BUFF_TICK_GAP * 0.75 : BUFF_TICK_GAP;
      const tickRowW = shown.length * tickR * 2 + Math.max(0, shown.length - 1) * tickGap;
      let tx = centerX - tickRowW / 2 + tickR;
      const ty = barY - this.slotR - 22;
      for (const chip of shown) {
        this.drawBuffTick(g, tx, ty, tickR, chip);
        tx += tickR * 2 + tickGap;
      }
    }
  }

  // ─── Drawing helpers ──────────────────────────────────────────────────────

  private drawOrb(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    ratio: number,
    color: number,
    isDead: boolean,
  ): void {
    g.fillStyle(0x0a0e1a, 0.9);
    g.fillCircle(cx, cy, r * 0.86);
    if (isDead) {
      g.lineStyle(Math.max(2, r * 0.14), C_FRAME_DIM, 0.6);
      g.strokeCircle(cx, cy, r * 0.86);
      return;
    }
    drawFacetedRing(g, cx, cy, r, Math.max(2.5, r * 0.16), ratio, color, 0.95, 0x1f2937, 0.4);
    g.lineStyle(1, C_FRAME, 0.7);
    g.strokeCircle(cx, cy, r * 0.7);
  }

  private drawEmptyOrbFrame(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
    g.fillStyle(0x0a0e1a, 0.5);
    g.fillCircle(cx, cy, r * 0.86);
    g.lineStyle(1.5, C_FRAME_DIM, 0.5);
    g.strokeCircle(cx, cy, r * 0.86);
  }

  /** Chamfered diamond outline — 12 points (4 tips + 2 chamfer points each). */
  private diamondPoints(cx: number, cy: number, r: number): Phaser.Math.Vector2[] {
    const tips = [-90, 0, 90, 180];
    const pts: Phaser.Math.Vector2[] = [];
    for (const tip of tips) {
      for (const offset of [-14, 0, 14]) {
        const a = Phaser.Math.DegToRad(tip + offset);
        const rr = offset === 0 ? r : r * 0.82;
        pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr));
      }
    }
    return pts;
  }

  private drawLiveSlot(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    ready: number,
    glyph: "shuriken" | "dash",
  ): void {
    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, 0.92);
    g.fillPoints(pts, true);

    // Cooldown ring inside the diamond frame — same faceted-ring language
    // as the resource orbs and nameplate rings, sized to sit clear of the
    // diamond's own tips.
    //
    // Color/alpha track `ready` continuously (textDim -> sapphireSteady,
    // 0.6/0.75 -> 0.85/1 alpha) instead of a binary ready>=1 switch — the
    // old switch meant the icon sat at its single "not ready" tint for the
    // ENTIRE cooldown and only snapped bright the instant it hit exactly
    // 1.0. Invisible at the old 520ms dash cooldown; unmissably "stuck" at
    // the current 3000ms one (Jake, 2026-07-15). The faceted ring's own
    // fill amount was always driven by `ready` correctly — only the
    // color/alpha around it were static.
    const readyColor = lerpHexColor(PALETTE.textDim, PALETTE.sapphireSteady, ready);
    const ringAlpha = 0.75 + 0.25 * Phaser.Math.Clamp(ready, 0, 1);
    drawFacetedRing(g, cx, cy, r * 0.62, Math.max(2, r * 0.12), ready, readyColor, ringAlpha, 0x1f2937, 0.35);

    const frameColor = lerpHexColor(C_FRAME, PALETTE.sapphireSteady, ready);
    const frameAlpha = 0.6 + 0.25 * Phaser.Math.Clamp(ready, 0, 1);
    g.lineStyle(1.5, frameColor, frameAlpha);
    g.strokePoints(pts, true);

    // Small vector glyph — shuriken for the throw, chevron-burst for dash —
    // no icon asset pipeline needed, and it's literally the mechanic.
    g.lineStyle(Math.max(1.2, r * 0.09), readyColor, 0.9);
    if (glyph === "shuriken") {
      const spokeR = r * 0.3;
      for (let i = 0; i < 4; i++) {
        const a = Phaser.Math.DegToRad(i * 90 + 45);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * spokeR, cy + Math.sin(a) * spokeR);
        g.strokePath();
      }
      g.fillStyle(readyColor, 0.9);
      g.fillCircle(cx, cy, r * 0.08);
    } else {
      const dashR = r * 0.28;
      g.beginPath();
      g.moveTo(cx - dashR, cy - dashR * 0.7);
      g.lineTo(cx + dashR, cy);
      g.lineTo(cx - dashR, cy + dashR * 0.7);
      g.strokePath();
    }
  }

  private drawReservedSlot(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number): void {
    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, 0.55);
    g.fillPoints(pts, true);
    g.lineStyle(1, C_FRAME_DIM, 0.4);
    g.strokePoints(pts, true);
  }

  /** A live ability while dead — distinct from `drawReservedSlot`: this one
   *  is YOURS, just inert right now, so the glyph stays faintly visible
   *  (grey, no ready-ring) instead of reading as "not unlocked yet." */
  private drawDisabledSlot(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    r: number,
    glyph: "shuriken" | "dash",
  ): void {
    const pts = this.diamondPoints(cx, cy, r);
    g.fillStyle(0x0a0e1a, 0.55);
    g.fillPoints(pts, true);
    g.lineStyle(1, C_FRAME_DIM, 0.5);
    g.strokePoints(pts, true);

    g.lineStyle(Math.max(1, r * 0.08), C_FRAME, 0.55);
    if (glyph === "shuriken") {
      const spokeR = r * 0.3;
      for (let i = 0; i < 4; i++) {
        const a = Phaser.Math.DegToRad(i * 90 + 45);
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * spokeR, cy + Math.sin(a) * spokeR);
        g.strokePath();
      }
    } else {
      const dashR = r * 0.28;
      g.beginPath();
      g.moveTo(cx - dashR, cy - dashR * 0.7);
      g.lineTo(cx + dashR, cy);
      g.lineTo(cx - dashR, cy + dashR * 0.7);
      g.strokePath();
    }
  }

  private drawBuffTick(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, chip: HudChip): void {
    g.fillStyle(0x0a0e1a, 0.85);
    g.fillCircle(cx, cy, r);
    g.lineStyle(1.5, chip.color, chip.isDebuff ? 0.7 : 0.95);
    g.strokeCircle(cx, cy, r);
    if (chip.isDebuff) {
      g.fillStyle(chip.color, 0.85);
      g.fillTriangle(cx - r * 0.4, cy - r * 0.3, cx + r * 0.4, cy - r * 0.3, cx, cy + r * 0.45);
    } else {
      g.fillStyle(chip.color, 0.85);
      g.fillTriangle(cx - r * 0.4, cy + r * 0.3, cx + r * 0.4, cy + r * 0.3, cx, cy - r * 0.45);
    }
  }
}
