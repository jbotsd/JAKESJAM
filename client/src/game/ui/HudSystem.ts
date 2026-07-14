// HudSystem — shared in-game HUD renderer.
//
// Used by both MatchScene (offline) and OnlineMatchScene (online) so both
// scenes get identical visual treatment. Each scene creates one instance in
// create(), calls update() every frame, and calls destroy() on shutdown.
//
// Layout (Crystal Cyan palette, anchored to viewport via setScrollFactor(0)):
//
//   ┌─ top-left (party-frame) ─────────────────────────────────────────────────┐
//   │  (◕) [HP bar]  HP nnn/max                                                │
//   │      [SH bar]  SH nnn/max         (hidden when no shield)                │
//   │      [• • • • • •]  dot-row ability charge                               │
//   │  [buff strip - outline chips per active buff/debuff]                     │
//   │  (◕) ▸ YOU        2    ← scoreboard rows, one portrait badge per player  │
//   │  (◕)   BOT · SPARK 0                                                     │
//   └──────────────────────────────────────────────────────────────────────────┘
//
//   ┌─ top-right ───────────────────────────────────────────────────────────────┐
//   │  [AB][CD]  2×N build-summary pill grid                                   │
//   │  [EF][GH]                                                                │
//   └───────────────────────────────────────────────────────────────────────────┘
//
//   ┌─ top-center ──────────────────────────────────────────────────────────────┐
//   │  mm:ss (big timer, Consolas)                                               │
//   └───────────────────────────────────────────────────────────────────────────┘
//
// A low-health vignette (full-viewport rectangle, alpha-pulsed via tween)
// kicks in below 30 % HP.
//
// All Phaser objects are created on the scene passed to the constructor.

import Phaser from "phaser";
import { playerTag } from "./botIdentity";
import { uiWidth, uiHeight } from "../render/renderResolution.js";
import { PALETTE } from "./palette.js";
import { crystalRoundsCards } from "../../sim/data/cards.js";
import type { PlayerId } from "../../sim/types.js";
import { drawPortraitBadge } from "../render/portraitBadge.js";

export type HudVitals = {
  health: number;
  maxHealth: number;
  /** undefined = no shield for this character */
  shieldCharge?: number;
  shieldMaxCharge?: number;
  /** Active buff/debuff chip descriptors */
  chips: HudChip[];
  /** 0-1 ability charge fraction — drives the dot-row ammo display. */
  abilityCharge?: number;
  /** Card ids in pick order — drives the build-summary pill grid. */
  cardIds?: string[];
  isDead: boolean;
  /** Standing outside the storm-zone boundary — the answer to "why am I
   *  taking damage with no explanation" (Jake, 2026-07-11). */
  outsideStorm?: boolean;
  /**
   * Player-identity color for the portrait badge (party-frame layout,
   * Jake 2026-07-14: "the nameplate goes on the left of the screen below
   * — designed well like this" — reference was a WoW-style unit frame:
   * portrait left, bars extending right, screen-anchored not floating
   * above the head). Same badge recipe as ProceduralPlayerRig's in-world
   * nameplate (dark ring + identity color + procedural glyph), just
   * relocated here as a fixed HUD element. Undefined hides the badge and
   * the vitals block falls back to its original left edge.
   */
  portraitColor?: number;
  /** Seed for the badge's generated sigil (portraitBadge.ts) — the local
   *  player's own id. Required whenever portraitColor is set. */
  portraitSeed?: string;
};

export type HudRound = {
  phase: "countdown" | "fighting" | "round-over" | "drafting";
  countdownRemainingMs: number;
  roundIndex: number;
  scores: Record<PlayerId, number>;
  /** playerId → display name (hello roster); ids fall back to tags. */
  names?: Record<string, string>;
  /**
   * playerId → identity color for the scoreboard's per-row portrait badge
   * (same badge recipe as the vitals block and the in-world nameplate —
   * portraitBadge.ts). Missing entries fall back to a dim neutral badge
   * rather than skipping the row.
   */
  colors?: Record<string, number>;
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

// Portrait badge (party-frame layout) constants
const PORTRAIT_R = 16;
const PORTRAIT_RESERVED_W = PORTRAIT_R * 2 + 10;

// Scoreboard row constants — smaller badge than the vitals portrait since
// several rows stack vertically.
const SCORE_ROW_R = 9;
const SCORE_ROW_GAP = 4;

// Build-pill grid constants
const PILL_W = 36;
const PILL_H = 20;
const PILL_GAP = 5;
const PILL_ROWS = 2;

export class HudSystem {
  private readonly scene: Phaser.Scene;

  // Vitals graphics (bars drawn each frame)
  private vitalGraphics!: Phaser.GameObjects.Graphics;
  // Portrait badge (party-frame layout) — see HudVitals.portraitColor docblock.
  private portraitGraphics!: Phaser.GameObjects.Graphics;
  private lastPortraitColor: number | undefined = undefined;
  private lastPortraitSeed: string | undefined = undefined;

  // Vital text labels
  private hpLabel!: Phaser.GameObjects.Text;
  private shLabel!: Phaser.GameObjects.Text;
  private chipGraphics!: Phaser.GameObjects.Graphics;
  private chipTexts: Phaser.GameObjects.Text[] = [];
  // Cache so we don't re-call setColor every frame (string allocation).
  private hpLabelColorCache = 0;

  // Dot-row ability charge — currently the dash-bash readiness meter.
  private dotArcs: Phaser.GameObjects.Arc[] = [];
  private dashLabel!: Phaser.GameObjects.Text;

  // Build-pill grid (top-right)
  private pillGraphics!: Phaser.GameObjects.Graphics;
  private pillTexts: Phaser.GameObjects.Text[] = [];
  private lastCardIdsKey = "";

  // Top-center elements
  private timerText!: Phaser.GameObjects.Text;
  // Small label above the timer saying WHAT it's counting down to (Jake,
  // 2026-07-13: "confusing when a round ends" — the timer was reused
  // verbatim across fighting/round-over/drafting/countdown with nothing
  // distinguishing a 0:02 mid-fight from a 0:02 waiting-on-the-draft-timer).
  private phaseTagText!: Phaser.GameObjects.Text;

  // Scoreboard — portrait-badge rows (party-frame layout, replacing the old
  // plain-text list). One shared Graphics for all badges (redrawn each
  // update, same convention as vitalGraphics), text pool grows on demand.
  private scoreGraphics!: Phaser.GameObjects.Graphics;
  private scoreRowTexts: Phaser.GameObjects.Text[] = [];

  // Low-health vignette
  private vignette!: Phaser.GameObjects.Rectangle;
  private vignetteTween?: Phaser.Tweens.Tween;
  private vignetteActive = false;
  private stormVignette!: Phaser.GameObjects.Rectangle;
  private stormVignetteTween?: Phaser.Tweens.Tween;
  private stormVignetteActive = false;
  private stormWarningText!: Phaser.GameObjects.Text;

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
    this.updateStormWarning(vitals);
  }

  destroy(): void {
    this.scene.scale.off("resize", this.onResize, this);
    this.vitalGraphics.destroy();
    this.portraitGraphics.destroy();
    this.hpLabel.destroy();
    this.shLabel.destroy();
    this.chipGraphics.destroy();
    for (const t of this.chipTexts) t.destroy();
    this.chipTexts = [];
    for (const arc of this.dotArcs) arc.destroy();
    this.dotArcs = [];
    this.dashLabel.destroy();
    this.pillGraphics.destroy();
    for (const t of this.pillTexts) t.destroy();
    this.pillTexts = [];
    this.timerText.destroy();
    this.phaseTagText.destroy();
    this.scoreGraphics.destroy();
    for (const t of this.scoreRowTexts) t.destroy();
    this.scoreRowTexts = [];
    this.vignette.destroy();
    this.vignetteTween?.stop();
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  private build(): void {
    const s = this.scene;
    const depth = 900;

    this.compact = uiWidth(s) < COMPACT_MAX_WIDTH;
    this.barW = this.compact ? BAR_W_COMPACT : BAR_W;
    this.barShieldW = this.compact ? BAR_SHIELD_W_COMPACT : BAR_SHIELD_W;

    // Full-screen vignette (behind HUD elements)
    this.vignette = s.add
      .rectangle(0, 0, uiWidth(s), uiHeight(s), C_VIGNETTE, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth - 1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    // Storm warning glow — ADD (not MULTIPLY) so it reads as a warm
    // encroaching light rather than another darkening layer; distinct from
    // the low-health vignette so the two causes never look the same.
    this.stormVignette = s.add
      .rectangle(0, 0, uiWidth(s), uiHeight(s), 0xffd166, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth - 1)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.stormWarningText = s.add
      .text(uiWidth(s) / 2, this.compact ? 62 : 58, "OUTSIDE THE SEAL", {
        fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
        fontSize: this.compact ? "11px" : "13px",
        fontStyle: "bold",
        color: "#ffd166",
        stroke: "#05080f",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 2)
      .setAlpha(0);

    // Vital bars (redrawn each frame)
    this.vitalGraphics = s.add.graphics();
    this.vitalGraphics.setScrollFactor(0).setDepth(depth + 1);

    // Portrait badge — drawn once per color change (updateVitals), not
    // every frame; same static "who is this" read as a party-frame icon.
    this.portraitGraphics = s.add.graphics();
    this.portraitGraphics.setScrollFactor(0).setDepth(depth + 2);

    const fontBase = {
      fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
      fontStyle: "bold",
    } as const;

    // Compact (phone portrait): numbers live INSIDE the bars — the label
    // column collided with the centred timer at ~397px CSS width
    // (phone screenshot 2026-07-11: "100/1:27" mash).
    const labelX = this.compact ? PAD_LEFT + 4 : PAD_LEFT + this.barW + 8;
    const vitalsFontSize = this.compact ? "8px" : "10px";
    const vitalStroke = this.compact
      ? { stroke: "#05080f", strokeThickness: 2 }
      : {};

    this.hpLabel = s.add
      .text(labelX, PAD_TOP + (this.compact ? 2 : 1), "", {
        ...fontBase,
        fontSize: vitalsFontSize,
        color: "#b8f05a",
        ...vitalStroke,
      })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    this.shLabel = s.add
      .text(labelX, PAD_TOP + LINE_H + (this.compact ? 2 : 1), "", {
        ...fontBase,
        fontSize: vitalsFontSize,
        color: "#93c5fd",
        ...vitalStroke,
      })
      .setScrollFactor(0)
      .setDepth(depth + 2);

    // Chip strip — outline-only chips (plate-less)
    this.chipGraphics = s.add.graphics();
    this.chipGraphics.setScrollFactor(0).setDepth(depth + 1);

    // Top-center: phase tag + timer + score
    this.phaseTagText = s.add
      .text(uiWidth(s) / 2, this.compact ? 2 : 2, "", {
        fontFamily: "'Space Mono', 'Courier New', monospace",
        fontSize: this.compact ? "8px" : "9px",
        fontStyle: "bold",
        color: "#8ff8ff",
        letterSpacing: 3,
        stroke: "#05080f",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 2);

    this.timerText = s.add
      .text(uiWidth(s) / 2, this.compact ? 14 : 16, "", {
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

    // Scoreboard: portrait-badge rows DOWN THE LEFT SIDE under the vitals
    // (Jake 2026-07-11 moved this off the centred strip that fought the
    // timer; Jake 2026-07-14 asked for the plain-text list itself to become
    // per-row portrait badges, "this is the legacy name plate system" —
    // same badge recipe as the vitals block, one row per player). Graphics
    // + text pool built lazily in updateScoreRows(); nothing to create here
    // beyond the shared Graphics object.
    this.scoreGraphics = s.add.graphics();
    this.scoreGraphics.setScrollFactor(0).setDepth(depth + 2);

    // Dot-row ammo arcs — created once, recolored each frame (hidden until
    // something actually feeds abilityCharge). Rows shifted up one LINE_H
    // since the vestigial jetpack bar row was removed. Currently fed by
    // dash-bash readiness (0 = just used, 1 = ready) — dim dots = still on
    // cooldown, bright = charge available (Jake, 2026-07-14).
    const dotY = PAD_TOP + LINE_H * 2 - 2;
    const dotRowRight =
      PAD_LEFT + DOT_RADIUS * 2 + (DOT_COUNT - 1) * (DOT_RADIUS * 2 + DOT_GAP);
    this.dashLabel = s.add
      .text(dotRowRight + 6, dotY, "DASH", {
        ...fontBase,
        fontSize: this.compact ? "7px" : "8px",
        color: "#8ff8ff",
        ...vitalStroke,
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 2);
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
    const w = uiWidth(this.scene);
    const h = uiHeight(this.scene);
    this.phaseTagText.setX(w / 2);
    this.timerText.setX(w / 2);
    this.vignette.setSize(w, h);
    // Rebuild pills so they stay anchored to top-right
    this.lastCardIdsKey = "";
  }

  // ─── Vitals ───────────────────────────────────────────────────────────────

  private updateVitals(v: HudVitals): void {
    const g = this.vitalGraphics;
    g.clear();

    // Portrait badge (party-frame layout) — drawn once per color change,
    // not every frame; reserves space so bars/labels/dots shift right to
    // make room, matching the reference (portrait left, bars extending
    // right of it) instead of floating a nameplate above the head.
    const vitalsX = v.portraitColor !== undefined ? PAD_LEFT + PORTRAIT_RESERVED_W : PAD_LEFT;
    if (v.portraitColor !== this.lastPortraitColor || v.portraitSeed !== this.lastPortraitSeed) {
      this.lastPortraitColor = v.portraitColor;
      this.lastPortraitSeed = v.portraitSeed;
      this.portraitGraphics.clear();
      if (v.portraitColor !== undefined) {
        drawPortraitBadge(
          this.portraitGraphics,
          PAD_LEFT + PORTRAIT_R,
          PAD_TOP + PORTRAIT_R - 2,
          PORTRAIT_R,
          v.portraitColor,
          v.portraitSeed ?? "local",
        );
      }
    }

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
    this.drawBar(g, vitalsX, PAD_TOP, this.barW, BAR_H, hpRatio, hpColor);
    if (hpColor !== this.hpLabelColorCache) {
      this.hpLabel.setColor(numToHex(hpColor));
      this.hpLabelColorCache = hpColor;
    }
    this.hpLabel.setText(`${Math.ceil(v.health)} / ${v.maxHealth}`);
    this.hpLabel.setX(this.compact ? vitalsX + 4 : vitalsX + this.barW + 8);

    // ── Shield bar ──────────────────────────────────────────────────────────
    const shMax = v.shieldMaxCharge ?? 0;
    if (shMax > 0 && v.shieldCharge !== undefined) {
      const shRatio = Phaser.Math.Clamp(v.shieldCharge / shMax, 0, 1);
      this.drawBar(g, vitalsX, PAD_TOP + LINE_H, this.barShieldW, BAR_SHIELD_H, shRatio, C_SHIELD);
      this.shLabel.setText(`${Math.ceil(v.shieldCharge)}`);
      this.shLabel.setX(this.compact ? vitalsX + 4 : vitalsX + this.barW + 8);
      this.shLabel.setVisible(true);
    } else {
      this.shLabel.setVisible(false);
    }

    // ── Chip strip (outline-only, plate-less) ────────────────────────────────
    this.drawChips(v.chips);

    // ── Dot-row ability charge ───────────────────────────────────────────────
    this.updateDots(v.abilityCharge, vitalsX);

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
    // Timer — countdownRemainingMs is reused across all four phases (round
    // time limit while fighting, the round-over hold, the draft window, the
    // pre-fight beat), so the bare number alone doesn't say what it's
    // counting down TO. The phase tag above it disambiguates.
    const ms = Math.max(0, round.countdownRemainingMs);
    const totalSec = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, "0")}`);
    const PHASE_TAG: Record<HudRound["phase"], { label: string; color: string }> = {
      fighting: { label: "FIGHT", color: "#8ff8ff" },
      "round-over": { label: "ROUND OVER", color: "#ffd76b" },
      drafting: { label: "DRAFT PICK", color: "#c8a4ff" },
      countdown: { label: "NEXT ROUND", color: "#8ff8ff" },
    };
    const tag = PHASE_TAG[round.phase];
    this.phaseTagText.setText(tag.label).setColor(tag.color);

    // Scoreboard rows: sorted by score (leader first), local marked ▸.
    const entries = Object.entries(round.scores).sort(
      ([aId, a], [bId, b]) => b - a || aId.localeCompare(bId),
    );
    this.updateScoreRows(entries, round);
  }

  /** One portrait badge + name/score label per row, replacing the old
   *  plain-text scoreboard list. */
  private updateScoreRows(entries: [string, number][], round: HudRound): void {
    const g = this.scoreGraphics;
    g.clear();

    if (entries.length === 0) {
      for (const t of this.scoreRowTexts) t.setVisible(false);
      return;
    }

    const r = SCORE_ROW_R;
    const rowH = r * 2 + SCORE_ROW_GAP;
    const startY = PAD_TOP + LINE_H * 2 + 10;

    while (this.scoreRowTexts.length < entries.length) {
      const t = this.scene.add
        .text(0, 0, "", {
          fontFamily: "'Space Mono', Consolas, 'Courier New', monospace",
          fontSize: this.compact ? "10px" : "12px",
          fontStyle: "bold",
          color: "#8ff8ff",
          stroke: "#05080f",
          strokeThickness: 3,
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(902);
      this.scoreRowTexts.push(t);
    }
    for (let i = entries.length; i < this.scoreRowTexts.length; i += 1) {
      this.scoreRowTexts[i]!.setVisible(false);
    }

    for (let i = 0; i < entries.length; i += 1) {
      const [pid, score] = entries[i]!;
      const isLocal = pid === this.localPlayerId;
      let tag = isLocal ? "YOU" : (round.names?.[pid] ?? playerTag(pid));
      if (this.compact) tag = tag.replace("BOT · ", "");
      tag = tag.slice(0, 14);

      const cy = startY + r + i * rowH;
      const color = round.colors?.[pid] ?? PALETTE.textDim;
      // Local player's badge gets a bright cyan ring (matches the "you"
      // color used elsewhere) so it reads at a glance without needing to
      // parse the ▸ mark; everyone else keeps the default darkened-shade ring.
      drawPortraitBadge(g, PAD_LEFT + r, cy, r, color, pid, undefined, isLocal ? 0x8ff8ff : undefined);

      const text = this.scoreRowTexts[i]!;
      text.setText(`${isLocal ? "▸ " : "  "}${tag}  ${score}`);
      text.setPosition(PAD_LEFT + r * 2 + 8, cy);
      text.setVisible(true);
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

  /** "Why am I dying?" — the storm-zone answer, always on screen while it
   *  applies (2026-07-11: the boundary itself was invisible before this
   *  pass; this is the belt to the world-space ring's suspenders). */
  private updateStormWarning(v: HudVitals): void {
    const outside = Boolean(v.outsideStorm) && !v.isDead;
    if (outside && !this.stormVignetteActive) {
      this.stormVignetteActive = true;
      this.stormVignetteTween?.stop();
      this.stormVignetteTween = this.scene.tweens.add({
        targets: this.stormVignette,
        alpha: 0.16,
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      this.stormWarningText.setAlpha(1);
    } else if (!outside && this.stormVignetteActive) {
      this.stormVignetteActive = false;
      this.stormVignetteTween?.stop();
      this.stormVignetteTween = undefined;
      this.stormVignette.setAlpha(0);
      this.stormWarningText.setAlpha(0);
    }
  }

  // ─── Dot-row ability charge ───────────────────────────────────────────────

  private updateDots(charge: number | undefined, vitalsX = PAD_LEFT): void {
    // Reposition every call (cheap — 6 arcs + 1 label) so the row shifts
    // right when the portrait badge is reserving space, same as the bars.
    const dotY = PAD_TOP + LINE_H * 2 - 2;
    for (let i = 0; i < this.dotArcs.length; i++) {
      this.dotArcs[i]!.setPosition(vitalsX + DOT_RADIUS + i * (DOT_RADIUS * 2 + DOT_GAP), dotY);
    }
    const dotRowRight = vitalsX + DOT_RADIUS * 2 + (DOT_COUNT - 1) * (DOT_RADIUS * 2 + DOT_GAP);
    this.dashLabel.setPosition(dotRowRight + 6, dotY);

    // Nothing feeds abilityCharge → hide the row entirely rather than pin six
    // permanently-dim dots to the HUD (dead UI, and precious space on phones).
    if (charge === undefined) {
      for (const arc of this.dotArcs) arc.setVisible(false);
      this.dashLabel.setVisible(false);
      return;
    }
    this.dashLabel.setVisible(true);
    const ratio = Phaser.Math.Clamp(charge, 0, 1);
    const filledCount = Math.round(ratio * DOT_COUNT);
    // Ready (ratio===1) reads brighter than "almost ready" — cyan pulses in,
    // not just another dim-to-bright dot, so "it's up" is unambiguous at a
    // glance rather than needing to count dots.
    const readyColor = ratio >= 1 ? 0x8ff8ff : PALETTE.textHi;
    for (let i = 0; i < this.dotArcs.length; i++) {
      const arc = this.dotArcs[i]!;
      const filled = i < filledCount;
      arc.setVisible(true);
      arc.setFillStyle(filled ? readyColor : PALETTE.textDim, filled ? 1 : 0.45);
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
    const startX = uiWidth(this.scene) - gridW - PAD_LEFT;
    // Below the always-visible RTT pill (top-right, y≈12..34) — at PAD_TOP
    // the first pill row rendered directly through it.
    const startY = PAD_TOP + 26;
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
