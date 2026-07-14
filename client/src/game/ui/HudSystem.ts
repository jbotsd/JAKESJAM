// HudSystem — shared in-game HUD renderer.
//
// Used by both MatchScene (offline) and OnlineMatchScene (online) so both
// scenes get identical visual treatment. Each scene creates one instance in
// create(), calls update() every frame, and calls destroy() on shutdown.
//
// Layout (Crystal Cyan palette, anchored to viewport via setScrollFactor(0)):
//
//   ┌─ top-left (fused nameplate column) ───────────────────────────────────────┐
//   │  (◕)══ ▸ YOU        2   84/100    ← badge + health/shield ring, one row   │
//   │  (◕)══   R3F9       1              per player in the match (Jake,        │
//   │  (◕)══   BOT · SPARK 0             2026-07-14: "give everyone the match  │
//   │  [buff strip - outline chips per active buff/debuff]  a nameplate" —     │
//   │                                     health+shield+name+score fused      │
//   │                                     into one object, not a separate bar) │
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
// kicks in below 30 % HP. The dash-readiness meter this HUD used to draw as
// a 6-dot row now lives on ActionBarSystem's bottom-center hotkey bar
// instead (Jake, 2026-07-14) — no duplicate readiness indicator on screen.
//
// All Phaser objects are created on the scene passed to the constructor.

import Phaser from "phaser";
import { playerTag } from "./botIdentity";
import { uiWidth, uiHeight } from "../render/renderResolution.js";
import { PALETTE } from "./palette.js";
import { crystalRoundsCards } from "../../sim/data/cards.js";
import type { PlayerId } from "../../sim/types.js";
import { drawPortraitBadge, drawNameplateRing, nameplateOuterRadius } from "../render/portraitBadge.js";
import { RARITY_COLORS } from "./rarityColors.js";

export type HudVitals = {
  health: number;
  maxHealth: number;
  /** Active buff/debuff chip descriptors */
  chips: HudChip[];
  /** Card ids in pick order — drives the build-summary pill grid. */
  cardIds?: string[];
  isDead: boolean;
  /** Standing outside the storm-zone boundary — the answer to "why am I
   *  taking damage with no explanation" (Jake, 2026-07-11). */
  outsideStorm?: boolean;
};

export type HudRound = {
  phase: "countdown" | "fighting" | "round-over" | "drafting";
  countdownRemainingMs: number;
  roundIndex: number;
  scores: Record<PlayerId, number>;
  /** playerId → display name (hello roster); ids fall back to tags. */
  names?: Record<string, string>;
  /**
   * playerId → identity color for the nameplate's per-row badge (same badge
   * recipe as the in-world nameplate — portraitBadge.ts). Missing entries
   * fall back to a dim neutral badge rather than skipping the row.
   */
  colors?: Record<string, number>;
  /**
   * playerId → live health/shield state for the fused nameplate ring
   * (Jake, 2026-07-14: "make our health shield and nameplate the whole
   * thing" — every player's ring, not just the local player's flat bars).
   * Missing entries render a full, undamaged ring rather than an empty one.
   */
  healthByPlayer?: Record<string, { ratio: number; shieldRatio?: number; isDead: boolean }>;
  /**
   * playerId → active buff/debuff colors for the row's compact status ticks
   * (Jake, 2026-07-14: "lobby/party member need... possibly status buffs
   * and debuffs" — the full text chip strip stays local-only for detail/
   * countdowns, but every row gets a glance-level tick summary, CS2-killfeed
   * style: small stacked marks, not sentence-construction, since a row is
   * one badge-height tall).
   */
  statusByPlayer?: Record<string, NameplateStatusTick[]>;
  winnerLabel?: string;
};

export type NameplateStatusTick = {
  color: number;
  isDebuff: boolean;
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

// Compact (phone-width) HUD: below this CSS-px viewport width the full-size
// fonts/radii collide with the centred timer + score row (seen on a 393px
// portrait phone), so the nameplate column shrinks.
const COMPACT_MAX_WIDTH = 520;

// Chip layout (chip strip still uses a wrap boundary)
const PANEL_W = 244;
const PANEL_PAD = 8;

// Fused nameplate column — badge + health ring + shield ring, one row per
// player (portraitBadge.ts's drawNameplateRing). Radius is bigger than the
// old plain scoreboard dot so the faceted health/shield rings read clearly.
const NAMEPLATE_R = 15;
const NAMEPLATE_R_COMPACT = 12;
// Local player's row reads slightly bigger than the rest of the roster —
// "your own vitals are the primary signal" (existence/vitality hierarchy,
// docs/visual-language-gnostic-vessel.md), not just another list entry.
const NAMEPLATE_R_LOCAL_BONUS = 3;
const NAMEPLATE_ROW_GAP = 10;

// Build-pill grid constants
const PILL_W = 36;
const PILL_H = 20;
const PILL_GAP = 5;
const PILL_ROWS = 2;

export class HudSystem {
  private readonly scene: Phaser.Scene;

  // Vital text labels
  private chipGraphics!: Phaser.GameObjects.Graphics;
  private chipTexts: Phaser.GameObjects.Text[] = [];

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

  // Fused nameplate column — one Graphics for all rows (badge + rings,
  // redrawn each frame since health changes continuously), text pool grows
  // on demand for the name/score (+ local player's numeric HP) label.
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
  private nameplateR = NAMEPLATE_R;
  // Y anchor for the chip strip — BELOW the entire nameplate column, not
  // just the local player's row, so it never collides with row 1+
  // regardless of roster size. Recomputed every frame in updateScoreRows()
  // (runs first — see update()) since column height depends on how many
  // players are in the match. (The dash-readiness dot-row that used to
  // anchor here moved to ActionBarSystem's M2 slot — Jake, 2026-07-14 —
  // so this doesn't duplicate that state in two places on screen.)
  private chipStripY = 0;

  // Local player's own live health, cached each frame in updateVitals() so
  // the nameplate column can show it as a secondary numeric readout next to
  // their ring (HUD-research finding: numbers are a confirming signal, not
  // the primary one — the ring is primary).
  private localHealth = 0;
  private localMaxHealth = 1;

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
    // Nameplate column first — it sets chipStripY for this frame, which
    // updateVitals's chip-strip positioning reads below.
    this.updateTopCenter(round);
    this.updateVitals(vitals);
    this.updateVignette(vitals);
    this.updateStormWarning(vitals);
  }

  destroy(): void {
    this.scene.scale.off("resize", this.onResize, this);
    this.chipGraphics.destroy();
    for (const t of this.chipTexts) t.destroy();
    this.chipTexts = [];
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
    this.nameplateR = this.compact ? NAMEPLATE_R_COMPACT : NAMEPLATE_R;
    // Placeholder — updateScoreRows() (called first every frame, see
    // update()) recomputes this from the actual column height before
    // drawChips() positions anything against it.
    this.chipStripY = PAD_TOP + 80;

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

    // Fused nameplate column — badge + health/shield ring + name/score, one
    // row per player, down the left side (Jake 2026-07-11 moved the old
    // plain-text scoreboard off the centred strip that fought the timer;
    // Jake 2026-07-14 asked for health/shield to fuse into the SAME object
    // as the nameplate, for every player, not just local). Graphics + text
    // pool built lazily in updateScoreRows(); nothing to create here beyond
    // the shared Graphics object.
    this.scoreGraphics = s.add.graphics();
    this.scoreGraphics.setScrollFactor(0).setDepth(depth + 2);

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

  // ─── Vitals (local-only widgets: chip strip, vignette source) ────────────

  private updateVitals(v: HudVitals): void {
    this.localHealth = v.health;
    this.localMaxHealth = v.maxHealth;

    if (v.isDead) {
      this.drawChips([]);
      return;
    }

    this.drawChips(v.chips);
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
    let cy = this.chipStripY;
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
      g.strokeRoundedRect(cx, cy, chipW, chipH, 4);
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

    // Nameplate rows: sorted by score (leader first), local pinned to the
    // top regardless of rank — dash dots / chip strip anchor a fixed offset
    // below row 0, so "you" always needs to be row 0.
    const entries = Object.entries(round.scores).sort(
      ([aId, a], [bId, b]) => b - a || aId.localeCompare(bId),
    );
    this.updateScoreRows(entries, round);
  }

  /** One fused badge + health/shield ring + name/score row per player,
   *  down the left side under the timer. Local player pinned first. */
  private updateScoreRows(entries: [string, number][], round: HudRound): void {
    const g = this.scoreGraphics;
    g.clear();

    if (entries.length === 0) {
      for (const t of this.scoreRowTexts) t.setVisible(false);
      return;
    }

    // Float the local player to row 0 — Array.sort is stable in V8/JS spec,
    // so this only reorders "is it local", preserving the score ordering
    // already applied to `entries` for everyone else.
    const sorted = [...entries].sort(([aId], [bId]) => {
      if (aId === this.localPlayerId) return -1;
      if (bId === this.localPlayerId) return 1;
      return 0;
    });

    const rOther = this.nameplateR;
    const rLocal = this.nameplateR + NAMEPLATE_R_LOCAL_BONUS;
    // Row spacing always budgets for the bigger local radius AND a shield
    // ring, so the grid never shifts when the local row's own shield toggles
    // on/off mid-match.
    const maxOuterR = nameplateOuterRadius(rLocal, true);
    const rowH = maxOuterR * 2 + NAMEPLATE_ROW_GAP;
    const startY = PAD_TOP + maxOuterR;
    // Breathing pulse for critical-health rings (portraitBadge.ts dims
    // between 65-100% alpha) — one shared clock, not per-row tweens.
    const pulseAlpha = (Math.sin(this.scene.time.now / 140) + 1) / 2;

    while (this.scoreRowTexts.length < sorted.length) {
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
    for (let i = sorted.length; i < this.scoreRowTexts.length; i += 1) {
      this.scoreRowTexts[i]!.setVisible(false);
    }

    for (let i = 0; i < sorted.length; i += 1) {
      const [pid, score] = sorted[i]!;
      const isLocal = pid === this.localPlayerId;
      const r = isLocal ? rLocal : rOther;
      let tag = isLocal ? "YOU" : (round.names?.[pid] ?? playerTag(pid));
      if (this.compact) tag = tag.replace("BOT · ", "");
      tag = tag.slice(0, 14);

      const cy = startY + i * rowH;
      const color = round.colors?.[pid] ?? PALETTE.textDim;
      const hv = round.healthByPlayer?.[pid];

      // Identity badge (sigil + notched dial bezel) — unchanged recipe.
      drawPortraitBadge(g, PAD_LEFT + r, cy, r, color, pid, undefined, isLocal ? 0x8ff8ff : undefined);
      // Fused health/shield ring, drawn outside the badge (Jake 2026-07-14:
      // "make our health shield and nameplate the whole thing" — every
      // player's live vitals, not just local's).
      drawNameplateRing(g, PAD_LEFT + r, cy, r, {
        healthRatio: hv?.ratio ?? 1,
        shieldRatio: hv?.shieldRatio,
        isDead: hv?.isDead ?? false,
        pulseAlpha,
      });

      const text = this.scoreRowTexts[i]!;
      let label = `${isLocal ? "▸ " : "  "}${tag}  ${score}`;
      // Numeric HP as a secondary confirming readout — only for local,
      // since the ring already carries the primary signal for everyone.
      if (isLocal) label += `   ${Math.ceil(this.localHealth)}/${this.localMaxHealth}`;
      const textX = PAD_LEFT + rLocal * 2 + 10;
      text.setText(label);
      text.setPosition(textX, cy);
      text.setVisible(true);

      // Thin underline seam beneath the label (doctrine: "floating type +
      // thin underlines", not a filled plate) — ties name/score visually
      // to the badge without adding a background box.
      g.lineStyle(1, color, isLocal ? 0.5 : 0.28);
      const underlineY = cy + text.height / 2 + 2;
      g.lineBetween(textX, underlineY, textX + text.width, underlineY);

      // Compact status ticks — small filled triangles after the label, one
      // per active buff (▲) / debuff (▼), CS2-killfeed-style icon-stacking
      // rather than the full text chip strip (no room for that per row).
      const ticks = round.statusByPlayer?.[pid];
      if (ticks && ticks.length > 0) {
        const tickR = 3.5;
        const tickGap = 4;
        let tx = textX + text.width + 10;
        const shown = ticks.slice(0, 5);
        for (const tick of shown) {
          g.fillStyle(tick.color, 0.9);
          if (tick.isDebuff) {
            g.fillTriangle(tx - tickR, cy - tickR * 0.6, tx + tickR, cy - tickR * 0.6, tx, cy + tickR * 0.9);
          } else {
            g.fillTriangle(tx - tickR, cy + tickR * 0.6, tx + tickR, cy + tickR * 0.6, tx, cy - tickR * 0.9);
          }
          tx += tickR * 2 + tickGap;
        }
      }
    }

    // Chip strip anchors below the FULL column, not just row 0 — avoids
    // colliding with row 1 when the roster grows past just "you" (Jake,
    // 2026-07-14 iteration pass).
    const columnBottom = startY + (sorted.length - 1) * rowH + maxOuterR;
    this.chipStripY = columnBottom + 18;
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const C_VIGNETTE = 0xfb7185;

function numToHex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}
