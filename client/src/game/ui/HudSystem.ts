// HudSystem — shared in-game HUD renderer.
//
// Used by both MatchScene (offline) and OnlineMatchScene (online) so both
// scenes get identical visual treatment. Each scene creates one instance in
// create(), calls update() every frame, and calls destroy() on shutdown.
//
// Layout (Crystal Cyan palette, anchored to viewport via setScrollFactor(0)):
//
//   ┌─ top-left panel ─────────────────────────────────────────────────────┐
//   │  [HP bar 200px]  HP nnn/max                                          │
//   │  [SH bar 160px]  SH nnn/max      (hidden when no shield)             │
//   │  [JET bar 120px] JET nn%         (hidden when no jetpack)            │
//   │  [buff strip - rounded icon chips per active buff/debuff]            │
//   │  [cards line - tiny pill chips]                                       │
//   └──────────────────────────────────────────────────────────────────────┘
//
//   ┌─ top-center ──────────────────────────────────────────────────────────┐
//   │  mm:ss (big timer, Consolas)                                           │
//   │  YOU 2   THEM 1 (score row, Inter)                                     │
//   └───────────────────────────────────────────────────────────────────────┘
//
// A low-health vignette (full-viewport rectangle, alpha-pulsed via tween)
// kicks in below 30 % HP.
//
// All Phaser objects are created on the scene passed to the constructor.

import Phaser from "phaser";

export type HudVitals = {
  health: number;
  maxHealth: number;
  /** undefined = no shield for this character */
  shieldCharge?: number;
  shieldMaxCharge?: number;
  /** undefined = no jetpack for this character */
  jetpackFuel?: number;
  /** Active buff/debuff chip descriptors */
  chips: HudChip[];
  /** Short card names in pick order */
  cardNames: string[];
  isDead: boolean;
};

export type HudRound = {
  phase: "countdown" | "fighting" | "round-over" | "drafting";
  countdownRemainingMs: number;
  roundIndex: number;
  scores: Record<string, number>;
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
const BAR_JET_W = 120;
const BAR_JET_H = 7;
const LINE_H = 20;

// Palette — Crystal Cyan
const C_TRACK = 0x111827;
const C_HP_GOOD = 0xb8f05a;
const C_HP_WARN = 0xfde68a;
const C_HP_CRIT = 0xfb7185;
const C_SHIELD = 0x93c5fd;
const C_JET = 0x67e8f9;
const C_PANEL_BG = 0x0f1a2e;
const C_PANEL_STROKE = 0x1f3a5f;
const C_VIGNETTE = 0xfb7185;

const PANEL_W = 244;
const PANEL_PAD = 8;

export class HudSystem {
  private readonly scene: Phaser.Scene;

  // Panel background
  private panelBg!: Phaser.GameObjects.Graphics;

  // Vitals graphics (bars drawn each frame)
  private vitalGraphics!: Phaser.GameObjects.Graphics;

  // Vital text labels
  private hpLabel!: Phaser.GameObjects.Text;
  private shLabel!: Phaser.GameObjects.Text;
  private jetLabel!: Phaser.GameObjects.Text;
  private buffRow!: Phaser.GameObjects.Text;
  private cardsRow!: Phaser.GameObjects.Text;

  // Top-center elements
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;

  // Low-health vignette
  private vignette!: Phaser.GameObjects.Rectangle;
  private vignetteTween?: Phaser.Tweens.Tween;
  private vignetteActive = false;

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
    this.panelBg.destroy();
    this.vitalGraphics.destroy();
    this.hpLabel.destroy();
    this.shLabel.destroy();
    this.jetLabel.destroy();
    this.buffRow.destroy();
    this.cardsRow.destroy();
    this.timerText.destroy();
    this.scoreText.destroy();
    this.vignette.destroy();
    this.vignetteTween?.stop();
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  private build(): void {
    const s = this.scene;
    const depth = 900;

    // Full-screen vignette (behind HUD panel)
    this.vignette = s.add
      .rectangle(0, 0, s.scale.width, s.scale.height, C_VIGNETTE, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth - 1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    // Panel background — frosted glass rect
    this.panelBg = s.add.graphics();
    this.panelBg.setScrollFactor(0).setDepth(depth);
    this.drawPanel();

    // Vital bars (redrawn each frame)
    this.vitalGraphics = s.add.graphics();
    this.vitalGraphics.setScrollFactor(0).setDepth(depth + 1);

    const fontBase = {
      fontFamily: "Inter, Arial, sans-serif",
      fontStyle: "bold",
    } as const;

    const labelX = PAD_LEFT + BAR_W + 8;

    this.hpLabel = s.add
      .text(labelX, PAD_TOP + 1, "", { ...fontBase, fontSize: "10px", color: "#b8f05a" })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    this.shLabel = s.add
      .text(labelX, PAD_TOP + LINE_H + 1, "", { ...fontBase, fontSize: "10px", color: "#93c5fd" })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    this.jetLabel = s.add
      .text(labelX, PAD_TOP + LINE_H * 2 + 1, "", { ...fontBase, fontSize: "10px", color: "#67e8f9" })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    this.buffRow = s.add
      .text(PAD_LEFT, PAD_TOP + LINE_H * 3 + 4, "", {
        ...fontBase,
        fontSize: "10px",
        color: "#f7fbff",
        wordWrap: { width: PANEL_W - PANEL_PAD * 2, useAdvancedWrap: true },
      })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    this.cardsRow = s.add
      .text(PAD_LEFT, PAD_TOP + LINE_H * 4 + 6, "", {
        ...fontBase,
        fontSize: "9px",
        color: "#caffea",
        wordWrap: { width: PANEL_W - PANEL_PAD * 2, useAdvancedWrap: true },
      })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    // Top-center: timer + score
    this.timerText = s.add
      .text(s.scale.width / 2, 12, "", {
        fontFamily: "Consolas, 'Courier New', monospace",
        fontSize: "24px",
        fontStyle: "bold",
        color: "#f7fbff",
        stroke: "#05080f",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 2);

    this.scoreText = s.add
      .text(s.scale.width / 2, 42, "", {
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "13px",
        fontStyle: "bold",
        color: "#8ff8ff",
        stroke: "#05080f",
        strokeThickness: 3,
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 2);

    s.scale.on("resize", this.onResize, this);
  }

  private drawPanel(): void {
    const g = this.panelBg;
    g.clear();
    // Estimate panel height based on max content
    const panelH = 110;
    g.fillStyle(C_PANEL_BG, 0.78);
    g.fillRoundedRect(PAD_LEFT - PANEL_PAD, PAD_TOP - PANEL_PAD, PANEL_W, panelH, 8);
    g.lineStyle(1, C_PANEL_STROKE, 0.9);
    g.strokeRoundedRect(PAD_LEFT - PANEL_PAD, PAD_TOP - PANEL_PAD, PANEL_W, panelH, 8);
  }

  private onResize(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    this.timerText.setX(w / 2);
    this.scoreText.setX(w / 2);
    this.vignette.setSize(w, h);
  }

  // ─── Vitals ───────────────────────────────────────────────────────────────

  private updateVitals(v: HudVitals): void {
    const g = this.vitalGraphics;
    g.clear();

    if (v.isDead) {
      this.hpLabel.setText("");
      this.shLabel.setVisible(false);
      this.jetLabel.setVisible(false);
      this.buffRow.setText("");
      this.cardsRow.setText("");
      return;
    }

    // ── Health bar ──────────────────────────────────────────────────────────
    const hpRatio = Phaser.Math.Clamp(v.health / v.maxHealth, 0, 1);
    const hpColor = hpRatio > 0.55 ? C_HP_GOOD : hpRatio > 0.28 ? C_HP_WARN : C_HP_CRIT;
    this.drawBar(g, PAD_LEFT, PAD_TOP, BAR_W, BAR_H, hpRatio, hpColor);
    this.hpLabel.setColor(numToHex(hpColor));
    this.hpLabel.setText(`${Math.ceil(v.health)} / ${v.maxHealth}`);
    this.hpLabel.setY(PAD_TOP + 1);

    // ── Shield bar ──────────────────────────────────────────────────────────
    const shMax = v.shieldMaxCharge ?? 0;
    if (shMax > 0 && v.shieldCharge !== undefined) {
      const shRatio = Phaser.Math.Clamp(v.shieldCharge / shMax, 0, 1);
      this.drawBar(g, PAD_LEFT, PAD_TOP + LINE_H, BAR_SHIELD_W, BAR_SHIELD_H, shRatio, C_SHIELD);
      this.shLabel.setText(`${Math.ceil(v.shieldCharge)}`);
      this.shLabel.setVisible(true);
    } else {
      this.shLabel.setVisible(false);
    }

    // ── Jetpack bar ─────────────────────────────────────────────────────────
    if (v.jetpackFuel !== undefined) {
      const jetRatio = Phaser.Math.Clamp(v.jetpackFuel / 100, 0, 1);
      this.drawBar(g, PAD_LEFT, PAD_TOP + LINE_H * 2, BAR_JET_W, BAR_JET_H, jetRatio, C_JET);
      this.jetLabel.setText(`${Math.round(v.jetpackFuel)}%`);
      this.jetLabel.setVisible(true);
    } else {
      this.jetLabel.setVisible(false);
    }

    // ── Buff strip ──────────────────────────────────────────────────────────
    if (v.chips.length > 0) {
      const parts = v.chips.map((c) => {
        const prefix = c.isDebuff ? "↓" : "↑";
        return `${prefix}${c.label} ${c.remainingSec.toFixed(1)}s`;
      });
      this.buffRow.setText(parts.join("  "));
    } else {
      this.buffRow.setText("");
    }

    // ── Cards row ───────────────────────────────────────────────────────────
    if (v.cardNames.length > 0) {
      this.cardsRow.setText(v.cardNames.join("  ·  "));
    } else {
      this.cardsRow.setText("");
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
        const tag = pid === this.localPlayerId ? "YOU" : pid.slice(-4).toUpperCase();
        return `${tag} ${score}`;
      });
      this.scoreText.setText(parts.join("   "));
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
