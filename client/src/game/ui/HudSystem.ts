// HudSystem — shared in-game HUD renderer.
//
// Used by both MatchScene (offline) and OnlineMatchScene (online) so both
// scenes get identical visual treatment. Each scene creates one instance in
// create(), calls update() every frame, and calls destroy() on shutdown.
//
// Layout (Crystal Cyan palette, anchored to viewport via setScrollFactor(0)):
//
//   ┌─ top-left (plate-less) ──────────────────────────────────────────────────┐
//   │  [HP bar 200px]  HP nnn/max                                              │
//   │  [SH bar 160px]  SH nnn/max      (hidden when no shield)                 │
//   │  [JET bar 120px] JET nn%         (hidden when no jetpack)                │
//   │  [• • • • • •]  dot-row ability charge                                   │
//   │  [buff strip - outline chips per active buff/debuff]                     │
//   └──────────────────────────────────────────────────────────────────────────┘
//
//   ┌─ top-right ───────────────────────────────────────────────────────────────┐
//   │  [AB][CD]  2×N build-summary pill grid                                   │
//   │  [EF][GH]                                                                │
//   └───────────────────────────────────────────────────────────────────────────┘
//
//   ┌─ top-center ──────────────────────────────────────────────────────────────┐
//   │  mm:ss (big timer, Consolas)                                               │
//   │  YOU 2   THEM 1 (score row, Inter)                                         │
//   └───────────────────────────────────────────────────────────────────────────┘
//
// A low-health vignette (full-viewport rectangle, alpha-pulsed via tween)
// kicks in below 30 % HP.
//
// All Phaser objects are created on the scene passed to the constructor.

import Phaser from "phaser";
import { playerTag } from "./botIdentity";
import { PALETTE } from "./palette.js";
import { crystalRoundsCards } from "../../sim/data/cards.js";
import type { PlayerId } from "../../sim/types.js";

export type HudVitals = {
  health: number;
  maxHealth: number;
  /** undefined = no shield for this character */
  shieldCharge?: number;
  shieldMaxCharge?: number;
  /** Active buff/debuff chip descriptors */
  chips: HudChip[];
  /**
   * Short card names in pick order. No longer rendered in the HUD —
   * cards are visible during the draft overlay. Kept for type compat.
   */
  cardNames?: string[];
  /** 0-1 ability charge fraction — drives the dot-row ammo display. */
  abilityCharge?: number;
  /** Card ids in pick order — drives the build-summary pill grid. */
  cardIds?: string[];
  isDead: boolean;
};

export type HudRound = {
  phase: "countdown" | "fighting" | "round-over" | "drafting";
  countdownRemainingMs: number;
  roundIndex: number;
  scores: Record<PlayerId, number>;
  winnerLabel?: string;
};

export type HudChip = {
  label: string;
  color: number;
  remainingSec: number;
  isDebuff: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PAD_LEFT = 16;
const PAD_TOP = 14;
const BAR_W = 200;
const BAR_H = 12;
const BAR_SHIELD_W = 160;
const BAR_SHIELD_H = 9;
const LINE_H = 20;

// Compact (phone-width) HUD: below this CSS-px viewport width the full-size
// bars/fonts collide with the centred timer + score row (seen on a 393px
// portrait phone: HP text under the timer, score under the RTT pill), so
// everything in the top strip shrinks.
const COMPACT_MAX_WIDTH = 520;
const BAR_W_COMPACT = 96;
const BAR_SHIELD_W_COMPACT = 76;

// Palette — Crystal Cyan (bars)
const C_TRACK = 0x111827;
const C_HP_GOOD = 0xb8f05a;
const C_HP_WARN = 0xfde68a;
const C_HP_CRIT = 0xfb7185;
const C_SHIELD = 0x93c5fd;
const C_VIGNETTE = 0xfb7185;

// Chip layout (chip strip still uses a wrap boundary)
const PANEL_W = 244;
const PANEL_PAD = 8;

// Rarity stroke colours for build pills
const RARITY_COLORS: Record<string, number> = {
  common: 0x9ca3af,
  uncommon: PALETTE.textMid,
  rare: 0x60a5fa,
  legendary: 0xfbbf24,
  cursed: PALETTE.hpDanger,
};

// Dot-row constants
const DOT_COUNT = 6;
const DOT_RADIUS = 4;
const DOT_GAP = 6;

// Build-pill grid constants
const PILL_W = 36;
const PILL_H = 20;
const PILL_GAP = 5;
const PILL_ROWS = 2;

export class HudSystem {
  private readonly scene: Phaser.Scene;

  // Vitals graphics (bars drawn each frame)
  private vitalGraphics!: Phaser.GameObjects.Graphics;

  // Vital text labels
  private hpLabel!: Phaser.GameObjects.Text;
  private shLabel!: Phaser.GameObjects.Text;
  private chipGraphics!: Phaser.GameObjects.Graphics;
  private chipTexts: Phaser.GameObjects.Text[] = [];
  // Cache so we don't re-call setColor every frame (string allocation).
  private hpLabelColorCache = 0;

  // Dot-row ability charge
  private dotArcs: Phaser.GameObjects.Arc[] = [];

  // Build-pill grid (top-right)
  private pillGraphics!: Phaser.GameObjects.Graphics;
  private pillTexts: Phaser.GameObjects.Text[] = [];
  private lastCardIdsKey = "";

  // Top-center elements
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;

  // Low-health vignette
  private vignette!: Phaser.GameObjects.Rectangle;
  private vignetteTween?: Phaser.Tweens.Tween;
  private vignetteActive = false;

  // Phone-width compact layout (decided once at build; phones don't grow).
  private compact = false;
  private barW = BAR_W;
  private barShieldW = BAR_SHIELD_W;

  private localPlayerId: string;

  constructor(scene: Phaser.Scene, localPlayerId: string) {
    this.scene = scene;
    this.localPlayerId = localPlayerId;
    this.build();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
  }

  update(vitals: HudVitals, round: HudRound): void {
    this.updateVitals(vitals);
    this.updateTopCenter(round);
    this.updateVignette(vitals);
  }

  destroy(): void {
    this.scene.scale.off("resize", this.onResize, this);
    this.vitalGraphics.destroy();
    this.hpLabel.destroy();
    this.shLabel.destroy();
    this.chipGraphics.destroy();
    for (const t of this.chipTexts) t.destroy();
    this.chipTexts = [];
    for (const arc of this.dotArcs) arc.destroy();
    this.dotArcs = [];
    this.pillGraphics.destroy();
    for (const t of this.pillTexts) t.destroy();
    this.pillTexts = [];
    this.timerText.destroy();
    this.scoreText.destroy();
    this.vignette.destroy();
    this.vignetteTween?.stop();
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  private build(): void {
    const s = this.scene;
    const depth = 900;

    this.compact = s.scale.width < COMPACT_MAX_WIDTH;
    this.barW = this.compact ? BAR_W_COMPACT : BAR_W;
    this.barShieldW = this.compact ? BAR_SHIELD_W_COMPACT : BAR_SHIELD_W;

    // Full-screen vignette (behind HUD elements)
    this.vignette = s.add
      .rectangle(0, 0, s.scale.width, s.scale.height, C_VIGNETTE, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth - 1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    // Vital bars (redrawn each frame)
    this.vitalGraphics = s.add.graphics();
    this.vitalGraphics.setScrollFactor(0).setDepth(depth + 1);

    const fontBase = {
      fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
      fontStyle: "bold",
    } as const;

    const labelX = PAD_LEFT + this.barW + 8;
    const vitalsFontSize = this.compact ? "9px" : "10px";

    this.hpLabel = s.add
      .text(labelX, PAD_TOP + 1, "", { ...fontBase, fontSize: vitalsFontSize, color: "#b8f05a" })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    this.shLabel = s.add
      .text(labelX, PAD_TOP + LINE_H + 1, "", { ...fontBase, fontSize: vitalsFontSize, color: "#93c5fd" })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    // Chip strip — outline-only chips (plate-less)
    this.chipGraphics = s.add.graphics();
    this.chipGraphics.setScrollFactor(0).setDepth(depth + 1);

    // Top-center: timer + score
    this.timerText = s.add
      .text(s.scale.width / 2, this.compact ? 10 : 12, "", {
        fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
        fontSize: this.compact ? "17px" : "24px",
        fontStyle: "bold",
        color: "#f7fbff",
        stroke: "#05080f",
        strokeThickness: this.compact ? 3 : 4,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 2);

    // Compact puts the score on its own row BELOW the shield row — at 393px
    // a centred score line horizontally collides with the shield label.
    this.scoreText = s.add
      .text(s.scale.width / 2, this.compact ? 47 : 42, "", {
        fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
        fontSize: this.compact ? "10px" : "13px",
        fontStyle: "bold",
        color: "#8ff8ff",
        stroke: "#05080f",
        strokeThickness: 3,
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 2);

    // Dot-row ammo arcs — created once, recolored each frame (hidden until
    // something actually feeds abilityCharge). Rows shifted up one LINE_H
    // since the vestigial jetpack bar row was removed.
    const dotY = PAD_TOP + LINE_H * 2 - 2;
    for (let i = 0; i < DOT_COUNT; i++) {
      const arc = s.add
        .arc(
          PAD_LEFT + DOT_RADIUS + i * (DOT_RADIUS * 2 + DOT_GAP),
          dotY,
          DOT_RADIUS,
          0,
          360,
          false,
          PALETTE.textDim,
          1,
        )
        .setScrollFactor(0)
        .setDepth(depth + 2);
      this.dotArcs.push(arc);
    }

    // Build-pill graphics (redrawn only when card list changes)
    this.pillGraphics = s.add.graphics();
    this.pillGraphics.setScrollFactor(0).setDepth(depth + 1);

    s.scale.on("resize", this.onResize, this);
  }

  private onResize(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    this.timerText.setX(w / 2);
    this.scoreText.setX(w / 2);
    this.vignette.setSize(w, h);
    // Rebuild pills so they stay anchored to top-right
    this.lastCardIdsKey = "";
  }

  // ─── Vitals ───────────────────────────────────────────────────────────────

  private updateVitals(v: HudVitals): void {
    const g = this.vitalGraphics;
    g.clear();

    if (v.isDead) {
      this.hpLabel.setText("");
      this.shLabel.setVisible(false);
      this.drawChips([]);
      this.updateDots(undefined);
      return;
    }

    // ── Health bar ──────────────────────────────────────────────────────────
    const hpRatio = Phaser.Math.Clamp(v.health / v.maxHealth, 0, 1);
    const hpColor = hpRatio > 0.55 ? C_HP_GOOD : hpRatio > 0.28 ? C_HP_WARN : C_HP_CRIT;
    this.drawBar(g, PAD_LEFT, PAD_TOP, this.barW, BAR_H, hpRatio, hpColor);
    if (hpColor !== this.hpLabelColorCache) {
      this.hpLabel.setColor(numToHex(hpColor));
      this.hpLabelColorCache = hpColor;
    }
    this.hpLabel.setText(`${Math.ceil(v.health)} / ${v.maxHealth}`);

    // ── Shield bar ──────────────────────────────────────────────────────────
    const shMax = v.shieldMaxCharge ?? 0;
    if (shMax > 0 && v.shieldCharge !== undefined) {
      const shRatio = Phaser.Math.Clamp(v.shieldCharge / shMax, 0, 1);
      this.drawBar(g, PAD_LEFT, PAD_TOP + LINE_H, this.barShieldW, BAR_SHIELD_H, shRatio, C_SHIELD);
      this.shLabel.setText(`${Math.ceil(v.shieldCharge)}`);
      this.shLabel.setVisible(true);
    } else {
      this.shLabel.setVisible(false);
    }

    // ── Chip strip (outline-only, plate-less) ────────────────────────────────
    this.drawChips(v.chips);

    // ── Dot-row ability charge ───────────────────────────────────────────────
    this.updateDots(v.abilityCharge);

    // ── Build-pill grid (only rebuilds when card list changes) ───────────────
    this.updateBuildPills(v.cardIds ?? []);
  }

  // ─── Chip rendering (plate-less: outline + text only) ────────────────────

  private drawChips(chips: HudChip[]): void {
    const g = this.chipGraphics;
    g.clear();

    // Grow the text pool on demand
    while (this.chipTexts.length < chips.length) {
      const t = this.scene.add
        .text(0, 0, "", {
          fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
          fontSize: "9px",
          fontStyle: "bold",
          color: "#f5f8f8",
        })
        .setScrollFactor(0)
        .setDepth(902)
        .setOrigin(0, 0.5);
      this.chipTexts.push(t);
    }
    for (let i = chips.length; i < this.chipTexts.length; i += 1) {
      this.chipTexts[i]!.setVisible(false);
    }

    let cx = PAD_LEFT;
    let cy = PAD_TOP + LINE_H * 2 + 16; // below dot row (jetpack row removed)
    const chipH = 16;
    const chipPadX = 7;
    const gap = 4;
    const maxX = PAD_LEFT + (PANEL_W - PANEL_PAD * 2);

    for (let i = 0; i < chips.length; i += 1) {
      const chip = chips[i]!;
      const label = `${chip.isDebuff ? "↓" : "↑"}${chip.label} ${chip.remainingSec.toFixed(1)}s`;
      const text = this.chipTexts[i]!;
      text.setText(label);
      // Set chip text color to match the chip's own color
      text.setColor(numToHex(chip.color));
      const textW = Math.ceil(text.width);
      const chipW = textW + chipPadX * 2;
      // Wrap to next row
      if (cx + chipW > maxX && cx !== PAD_LEFT) {
        cx = PAD_LEFT;
        cy += chipH + gap;
      }
      // Plate-less: 1px colored outline only, no fill.
      // Dominant-accent rule: only the first chip (highest priority) shows
      // at full brightness. Subsequent chips dim to 35% so multiple
      // simultaneous buffs don't compete for visual attention.
      const baseBrightness = chip.isDebuff ? 0.6 : 0.85;
      const chipAlpha = i === 0 ? baseBrightness : baseBrightness * 0.38;
      const textAlpha = i === 0 ? 1 : 0.45;
      g.lineStyle(1, chip.color, chipAlpha);
      g.strokeRoundedRect(cx, cy, chipW, chipH, chipH / 2);
      text.setAlpha(textAlpha);

      text.setPosition(cx + chipPadX, cy + chipH / 2);
      text.setVisible(true);
      cx += chipW + gap;
    }
  }

  // ─── Top-center ───────────────────────────────────────────────────────────

  private updateTopCenter(round: HudRound): void {
    // Timer
    const ms = Math.max(0, round.countdownRemainingMs);
    const totalSec = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, "0")}`);

    // Score
    const entries = Object.entries(round.scores).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      this.scoreText.setText(`ROUND ${round.roundIndex + 1}`);
    } else {
      const parts = entries.map(([pid, score]) => {
        let tag = pid === this.localPlayerId ? "YOU" : playerTag(pid);
        // Phone widths: "BOT · PISTON 2   BOT · SPARK 0   YOU 0" overflows the
        // 393px row into the FTUE legend / RTT pill — drop the "BOT · " prefix.
        if (this.compact) tag = tag.replace("BOT · ", "");
        return `${tag} ${score}`;
      });
      this.scoreText.setText(parts.join(this.compact ? "  " : "   "));
    }
  }

  // ─── Vignette ─────────────────────────────────────────────────────────────

  private updateVignette(v: HudVitals): void {
    const lowHealth = !v.isDead && v.health / v.maxHealth < 0.3;
    if (lowHealth && !this.vignetteActive) {
      this.vignetteActive = true;
      this.vignetteTween?.stop();
      this.vignetteTween = this.scene.tweens.add({
        targets: this.vignette,
        alpha: 0.22,
        duration: 280,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else if (!lowHealth && this.vignetteActive) {
      this.vignetteActive = false;
      this.vignetteTween?.stop();
      this.vignetteTween = undefined;
      this.vignette.setAlpha(0);
    }
  }

  // ─── Dot-row ability charge ───────────────────────────────────────────────

  private updateDots(charge: number | undefined): void {
    // Nothing feeds abilityCharge → hide the row entirely rather than pin six
    // permanently-dim dots to the HUD (dead UI, and precious space on phones).
    if (charge === undefined) {
      for (const arc of this.dotArcs) arc.setVisible(false);
      return;
    }
    const filledCount = Math.round(Phaser.Math.Clamp(charge, 0, 1) * DOT_COUNT);
    for (let i = 0; i < this.dotArcs.length; i++) {
      const arc = this.dotArcs[i]!;
      const filled = i < filledCount;
      arc.setVisible(true);
      arc.setFillStyle(filled ? PALETTE.textHi : PALETTE.textDim, filled ? 1 : 0.45);
    }
  }

  // ─── Build-pill grid (top-right) ─────────────────────────────────────────

  private updateBuildPills(cardIds: string[]): void {
    const key = cardIds.join("|");
    if (key === this.lastCardIdsKey) return;
    this.lastCardIdsKey = key;

    const g = this.pillGraphics;
    g.clear();

    // Hide stale text labels
    for (const t of this.pillTexts) t.setVisible(false);

    if (cardIds.length === 0) return;

    const cols = Math.ceil(cardIds.length / PILL_ROWS);
    const gridW = cols * PILL_W + Math.max(0, cols - 1) * PILL_GAP;
    const startX = this.scene.scale.width - gridW - PAD_LEFT;
    const startY = PAD_TOP;
    const depth = 901;

    for (let i = 0; i < cardIds.length; i++) {
      const id = cardIds[i]!;
      const card = crystalRoundsCards.find((c) => c.id === id);
      const abbrev = card ? card.name.slice(0, 2).toUpperCase() : "??";
      const rarity = card?.rarity ?? "common";
      const strokeColor = RARITY_COLORS[rarity] ?? (RARITY_COLORS["common"] as number);

      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = startX + col * (PILL_W + PILL_GAP);
      const py = startY + row * (PILL_H + PILL_GAP);

      // Transparent fill, colored 1.5px stroke
      g.lineStyle(1.5, strokeColor, 0.9);
      g.fillStyle(0x000000, 0);
      g.fillRoundedRect(px, py, PILL_W, PILL_H, 4);
      g.strokeRoundedRect(px, py, PILL_W, PILL_H, 4);

      // Grow text pool on demand
      while (this.pillTexts.length <= i) {
        const t = this.scene.add
          .text(0, 0, "", {
            fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
            fontSize: "9px",
            fontStyle: "bold",
            color: numToHex(PALETTE.textHi),
          })
          .setScrollFactor(0)
          .setDepth(depth + 1)
          .setOrigin(0.5, 0.5);
        this.pillTexts.push(t);
      }
      const label = this.pillTexts[i]!;
      label.setText(abbrev);
      label.setPosition(px + PILL_W / 2, py + PILL_H / 2);
      label.setVisible(true);
    }
  }

  // ─── Bar drawing helper ───────────────────────────────────────────────────

  private drawBar(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    fillColor: number,
  ): void {
    // Track
    g.fillStyle(C_TRACK, 0.92);
    g.fillRoundedRect(x, y, w, h, 3);
    // Fill
    if (ratio > 0) {
      g.fillStyle(fillColor, 0.95);
      g.fillRoundedRect(x, y, Math.max(3, w * ratio), h, 3);
    }
    // Shine overlay (top-half lighter strip)
    g.fillStyle(0xffffff, 0.06);
    g.fillRoundedRect(x, y, w, Math.floor(h / 2), 3);
    // Border
    g.lineStyle(1, 0xffffff, 0.12);
    g.strokeRoundedRect(x, y, w, h, 3);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function numToHex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
