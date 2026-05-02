import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import type { CardDefinition } from "../types/game";
import type { ElementType } from "../../sim/types";
import { ELEMENT_COLORS, NEUTRAL_ELEMENTS } from "../ui/elementColors";
import { drawBucketIcon } from "../ui/cardIcons";
import { drawCardBracket } from "../ui/CardBracketFrame";
import { HeroPresenter } from "../ui/HeroPresenter";
import { PALETTE } from "../ui/palette";

type DraftSceneInitData = {
  availableCards: CardDefinition[];
  currentBuild: CardDefinition[];
  roundNumber: number;
  playerBehind: boolean;
  localPlayerId: string;
};

/**
 * DraftScene - ROUNDS-style between-round card selection
 *
 * Shows 3 card choices after each round. Loser drafts first.
 * Cards persist for the entire match and stack.
 */
export class DraftScene extends Phaser.Scene {
  private availableCards: CardDefinition[] = [];
  private currentBuild: CardDefinition[] = [];
  private roundNumber = 1;
  private playerBehind = false;
  private hero!: HeroPresenter;
  private cardContainers: Phaser.GameObjects.Container[] = [];
  private cardBaseY: number[] = [];

  constructor() {
    super(SceneKeys.Draft);
  }

  init(data: DraftSceneInitData) {
    this.availableCards = data.availableCards;
    this.currentBuild = data.currentBuild;
    this.roundNumber = data.roundNumber;
    this.playerBehind = data.playerBehind;
  }

  create() {
    const { width, height } = this.scale;

    // Void background
    this.add.rectangle(0, 0, width, height, PALETTE.voidDeep).setOrigin(0);

    // ── Atmospheric scan lines (horizontal rules, very low alpha) ─────────────
    this.addScanLines(width, height);

    // ── Radial hero glow — warm orb behind presenter position ─────────────────
    const heroGlow = this.add.graphics();
    const heroGlowX = width / 2;
    const heroGlowY = height - 80;
    heroGlow.fillStyle(PALETTE.lampOrbCore, 0.04);
    heroGlow.fillCircle(heroGlowX, heroGlowY, 200);
    heroGlow.fillStyle(PALETTE.lightBeamWarm, 0.03);
    heroGlow.fillCircle(heroGlowX, heroGlowY, 310);

    // ── Vignette — stacked dark radial edges ──────────────────────────────────
    this.addVignette(width, height);

    // Title — Space Grotesk display font
    this.add.text(width / 2, 48, "CHOOSE YOUR UPGRADE", {
      fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
      fontStyle: "bold",
      fontSize: "36px",
      color: "#f7fbff",
      letterSpacing: 2,
    }).setOrigin(0.5);

    // Kicker above title — mono label
    this.add.text(width / 2, 24, `ROUND ${this.roundNumber}`, {
      fontFamily: "'Space Mono', 'Courier New', monospace",
      fontSize: "11px",
      color: "#8ff8ff",
      letterSpacing: 4,
    }).setOrigin(0.5);

    // Round info / comeback message
    const subtitle = this.playerBehind
      ? `You're behind — pick wisely.`
      : `Select a card to enhance your build.`;
    this.add.text(width / 2, 78, subtitle, {
      fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
      fontSize: "16px",
      color: this.playerBehind ? "#f87171" : "#9ba7b8",
    }).setOrigin(0.5);

    // Current build summary (small cards at top)
    this.renderCurrentBuild(width / 2, 130);

    // Three card choices (main display)
    this.renderCardChoices(width / 2, height / 2 + 20);

    // ── Lamp orb prop ─────────────────────────────────────────────────────────
    // A visible warm light source at bottom-left grounding the scene.
    this.addLampOrb(width, height);

    // Hero presenter — bottom center
    this.hero = new HeroPresenter(this, width / 2, height - 80, {
      bodyColor: PALETTE.playerOrange,
      shadeColor: PALETTE.playerOrangeShade,
      playerBehind: this.playerBehind,
    });

    // Instructions
    this.add.text(width / 2, height - 30, "Click a card to select it", {
      fontFamily: "'Space Mono', 'Courier New', monospace",
      fontSize: "11px",
      color: "#50e3c2",
      letterSpacing: 2,
    }).setOrigin(0.5);

    // Escape key to pause (optional)
    this.input.keyboard?.on("keydown-ESC", () => {
      // Could add pause functionality here
    });
  }

  private renderCardChoices(centerX: number, centerY: number) {
    const cardWidth = 220;
    const cardHeight = 300;
    const spacing = 40;
    const totalWidth = cardWidth * 3 + spacing * 2;
    const startX = centerX - totalWidth / 2;

    this.cardContainers = [];
    this.cardBaseY = [];

    this.availableCards.forEach((card, index) => {
      const x = startX + (cardWidth + spacing) * index + cardWidth / 2;
      const cardContainer = this.add.container(x, centerY);
      this.cardContainers.push(cardContainer);
      this.cardBaseY.push(centerY);

      // Fully transparent background (plate-less design)
      const hitArea = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0);
      cardContainer.add(hitArea);

      // Element accent: use element color for bracket if card has one; else cyan
      const cardElement: ElementType | undefined = card.modifier?.projectile?.element;
      const bracketColor =
        cardElement && !NEUTRAL_ELEMENTS.has(cardElement)
          ? ELEMENT_COLORS[cardElement]
          : PALETTE.cardBracket;

      const bracket = drawCardBracket(this, 0, 0, cardWidth, cardHeight, bracketColor);
      cardContainer.add(bracket);

      // Bucket-glyph icon (reused as-is per constraints)
      const iconObjs = drawBucketIcon(
        this,
        0, -90,
        card.buckets?.[0],
        cardElement,
        card.rarity,
        100,
        card.visual?.iconShape,
      );
      cardContainer.add(iconObjs);

      // Card name ABOVE the frame
      const nameY = -(cardHeight / 2 + 14);
      const name = this.add.text(0, nameY, card.name.toUpperCase(), {
        fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "15px",
        color: `#${PALETTE.cardTitle.toString(16).padStart(6, "0")}`,
        letterSpacing: 2,
      }).setOrigin(0.5, 1);
      cardContainer.add(name);

      // Card description
      const desc = this.add.text(0, -20, card.description, {
        fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
        fontSize: "13px",
        color: "#f5f8f8",
        wordWrap: { width: cardWidth - 40 },
      }).setOrigin(0.5);
      cardContainer.add(desc);

      // Benefits — green colored lines, no header
      let statY = 30;
      if (card.benefits && card.benefits.length > 0) {
        card.benefits.forEach((benefit, i) => {
          const benefitText = this.add.text(
            0, statY + i * 20,
            `+${this.formatStat(benefit)}`,
            {
              fontFamily: "'Space Mono', 'Courier New', monospace",
              fontStyle: "bold",
              fontSize: "12px",
              color: `#${PALETTE.benefitGreen.toString(16).padStart(6, "0")}`,
            },
          ).setOrigin(0.5);
          cardContainer.add(benefitText);
        });
        statY += card.benefits.length * 20 + 4;
      }

      // Penalties — coral colored lines, no header
      if (card.penalties && card.penalties.length > 0) {
        card.penalties.forEach((penalty, i) => {
          const penaltyText = this.add.text(
            0, statY + i * 20,
            `-${this.formatStat(penalty)}`,
            {
              fontFamily: "'Space Mono', 'Courier New', monospace",
              fontStyle: "bold",
              fontSize: "12px",
              color: `#${PALETTE.penaltyRed.toString(16).padStart(6, "0")}`,
            },
          ).setOrigin(0.5);
          cardContainer.add(penaltyText);
        });
      }

      // Interaction — use hitArea rectangle as the interactive target
      hitArea.setInteractive({ useHandCursor: true });
      hitArea.on("pointerdown", () => this.selectCard(card));
      hitArea.on("pointerover", () => {
        this.highlightCard(cardContainer, index, true);
        this.hero?.leanToward(cardContainer.x);
      });
      hitArea.on("pointerout", () => {
        this.highlightCard(cardContainer, index, false);
      });
    });
  }

  private selectCard(card: CardDefinition) {
    // Disable all card inputs to prevent double-pick
    this.input.enabled = false;

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // Screen shake
    this.cameras.main.shake(240, 0.012);

    // Radial flash: expanding ring burst
    const ring = this.add.circle(cx, cy, 8, PALETTE.cardBracket, 0.0);
    ring.setStrokeStyle(3, PALETTE.cardBracketGlow, 0.9);
    this.tweens.add({
      targets: ring,
      radius: 260,
      alpha: 0,
      duration: 460,
      ease: "Sine.easeOut",
      onComplete: () => ring.destroy(),
    });

    // 12 outward sparks
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12;
      const spark = this.add.rectangle(cx, cy, 4, 12, PALETTE.blastHalo, 0.92);
      spark.rotation = angle;
      this.tweens.add({
        targets: spark,
        x: cx + Math.cos(angle) * 120,
        y: cy + Math.sin(angle) * 120,
        alpha: 0,
        duration: 400,
        ease: "Sine.easeOut",
        onComplete: () => spark.destroy(),
      });
    }

    // Flash text with Back.easeOut spring
    const flash = this.add
      .text(cx, cy + 20, "SELECTED!", {
        fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
        fontStyle: "bold",
        fontSize: "52px",
        color: "#4ade80",
        stroke: "#05080f",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setScale(0.6);

    this.tweens.add({
      targets: flash,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      y: cy - 20,
      duration: 280,
      ease: "Back.easeOut",
      onComplete: () => {
        // Hold briefly, then fade out and close
        this.time.delayedCall(320, () => {
          this.tweens.add({
            targets: flash,
            alpha: 0,
            y: cy - 60,
            duration: 220,
            ease: "Sine.easeIn",
            onComplete: () => {
              flash.destroy();
              this.registry.set("draftSelectedCard", card);
              this.scene.stop(SceneKeys.Draft);
            },
          });
        });
      },
    });
  }

  private formatStat(stat: { multiplier?: boolean; value: number; stat: string } | undefined): string {
    if (!stat) return "";
    if (stat.multiplier) {
      const pct = Math.round((stat.value - 1) * 100);
      return `${pct > 0 ? "+" : ""}${pct}% ${stat.stat}`;
    }
    return `${stat.value > 0 ? "+" : ""}${stat.value} ${stat.stat}`;
  }

  private highlightCard(
    container: Phaser.GameObjects.Container,
    index: number,
    highlight: boolean,
  ) {
    // Dim all other cards when one is hovered
    this.cardContainers.forEach((c, i) => {
      if (i !== index) {
        this.tweens.add({
          targets: c,
          alpha: highlight ? 0.45 : 1.0,
          duration: 200,
          ease: "Sine.easeOut",
        });
      }
    });

    const baseY = this.cardBaseY[index] ?? container.y;
    if (highlight) {
      this.tweens.add({
        targets: container,
        scaleX: 1.12,
        scaleY: 1.12,
        y: baseY - 24,
        rotation: 0.05,
        alpha: 1.0,
        duration: 240,
        ease: "Back.easeOut",
      });
    } else {
      this.tweens.add({
        targets: container,
        scaleX: 1,
        scaleY: 1,
        y: baseY,
        rotation: 0,
        alpha: 1.0,
        duration: 180,
        ease: "Sine.easeOut",
      });
    }
  }

  /**
   * Procedural edge vignette — four dark gradient ellipses at screen corners.
   * Gives the ROUNDS void-black atmosphere without a render texture.
   */
  private addVignette(width: number, height: number): void {
    const g = this.add.graphics();
    // Top edge
    g.fillStyle(0x000000, 0.55);
    g.fillRect(0, 0, width, height * 0.18);
    // Bottom edge
    g.fillStyle(0x000000, 0.5);
    g.fillRect(0, height * 0.82, width, height * 0.18);
    // Left edge
    g.fillStyle(0x000000, 0.38);
    g.fillRect(0, 0, width * 0.12, height);
    // Right edge
    g.fillStyle(0x000000, 0.38);
    g.fillRect(width * 0.88, 0, width * 0.12, height);
    // Center radial darkening (subtle)
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(width / 2, height / 2, width * 1.1, height * 1.1);
    g.fillStyle(0x000000, 0.0);
    g.fillEllipse(width / 2, height / 2, width * 0.55, height * 0.55);
  }

  /**
   * Horizontal scan-line overlay — every 4px a 1px dark rule at low alpha.
   * Adds CRT-esque texture to the void background without an image asset.
   */
  private addScanLines(width: number, height: number): void {
    const g = this.add.graphics();
    g.lineStyle(1, 0x000000, 0.14);
    for (let y = 0; y < height; y += 4) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(width, y);
      g.strokePath();
    }
  }

  /**
   * Lamp orb prop — a bright warm point-light source at bottom-left.
   * Solid bright core + 3 stacked additive halos + a soft cone toward the hero.
   */
  private addLampOrb(width: number, height: number): void {
    const orbX = 160;
    const orbY = height - 120;
    const coreR = 14;

    // Soft cone polygon: apex at orb, pointing toward hero position.
    // Simulated gradient via two stacked polygons of decreasing alpha.
    const heroX = width / 2;
    const heroY = height - 80;
    const coneAngle = Math.atan2(heroY - orbY, heroX - orbX);
    const halfCone = Math.PI / 6; // 60° half-angle = 30° each side
    const coneLen = Math.hypot(heroX - orbX, heroY - orbY) + 40;

    const conePoints = (scale: number) => [
      { x: orbX, y: orbY },
      {
        x: orbX + Math.cos(coneAngle - halfCone * scale) * coneLen,
        y: orbY + Math.sin(coneAngle - halfCone * scale) * coneLen,
      },
      {
        x: orbX + Math.cos(coneAngle + halfCone * scale) * coneLen,
        y: orbY + Math.sin(coneAngle + halfCone * scale) * coneLen,
      },
    ];

    // Outer cone (wider, very low alpha)
    const coneOuter = this.add.polygon(
      0,
      0,
      conePoints(1.0),
      PALETTE.lightBeamWarm,
      0.06,
    );
    coneOuter.setBlendMode(Phaser.BlendModes.ADD);
    coneOuter.setOrigin(0, 0);

    // Inner cone (tighter, slightly higher alpha)
    const coneInner = this.add.polygon(
      0,
      0,
      conePoints(0.55),
      PALETTE.lightBeamWarm,
      0.10,
    );
    coneInner.setBlendMode(Phaser.BlendModes.ADD);
    coneInner.setOrigin(0, 0);

    // Halos: additive arcs at 3 scales around the orb
    const haloScales: Array<{ scale: number; alpha: number }> = [
      { scale: 1,   alpha: 0.6  },
      { scale: 2.4, alpha: 0.25 },
      { scale: 4.8, alpha: 0.10 },
    ];

    for (const { scale, alpha } of haloScales) {
      const halo = this.add.arc(
        orbX,
        orbY,
        coreR * scale,
        0,
        360,
        false,
        PALETTE.lampOrbCore,
        alpha,
      );
      halo.setBlendMode(Phaser.BlendModes.ADD);
    }

    // Solid bright core on top
    this.add.arc(orbX, orbY, coreR, 0, 360, false, PALETTE.lampOrbCore, 1.0);
  }

  private renderCurrentBuild(centerX: number, y: number) {
    if (this.currentBuild.length === 0) {
      this.add.text(centerX, y, "No cards yet — first draft!", {
        fontFamily: "'Space Mono', 'Courier New', monospace",
        fontSize: "11px",
        color: "#6b7280",
      }).setOrigin(0.5);
      return;
    }

    this.add.text(centerX, y - 25, "CURRENT BUILD:", {
      fontFamily: "'Space Mono', 'Courier New', monospace",
      fontSize: "10px",
      color: "#9ba7b8",
      letterSpacing: 3,
    }).setOrigin(0.5);

    this.currentBuild.forEach((card, index) => {
      const x = centerX - (this.currentBuild.length - 1) * 30 + index * 60;
      const buildElement: ElementType | undefined = card.modifier?.projectile?.element;
      const iconObjs = drawBucketIcon(
        this,
        x, y,
        card.buckets?.[0],
        buildElement,
        card.rarity,
        44,
        card.visual?.iconShape,
      );
      void iconObjs;
    });
  }
}
