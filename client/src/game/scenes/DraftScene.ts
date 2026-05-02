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

    // Dark overlay background
    this.add.rectangle(0, 0, width, height, 0x000000, 0.85).setOrigin(0);

    // Title
    this.add.text(width / 2, 50, "CHOOSE YOUR UPGRADE", {
      font: "bold 36px Inter, Arial, sans-serif",
      color: "#f7fbff",
    }).setOrigin(0.5);

    // Round info and comeback message
    const subtitle = this.playerBehind
      ? `Round ${this.roundNumber} - You're behind. Pick wisely.`
      : `Round ${this.roundNumber}`;
    this.add.text(width / 2, 85, subtitle, {
      font: "18px Inter, Arial, sans-serif",
      color: this.playerBehind ? "#f87171" : "#9ba7b8",
    }).setOrigin(0.5);

    // Current build summary (small cards at top)
    this.renderCurrentBuild(width / 2, 130);

    // Three card choices (main display)
    this.renderCardChoices(width / 2, height / 2 + 20);

    // Hero presenter — bottom center
    this.hero = new HeroPresenter(this, width / 2, height - 80, {
      bodyColor: PALETTE.playerOrange,
      shadeColor: PALETTE.playerOrangeShade,
      playerBehind: this.playerBehind,
    });

    // Instructions
    this.add.text(width / 2, height - 30, "Click a card to select it", {
      font: "16px Inter, Arial, sans-serif",
      color: "#50e3c2",
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
        font: "bold 16px Inter, Arial, sans-serif",
        color: `#${PALETTE.cardTitle.toString(16).padStart(6, "0")}`,
        letterSpacing: 1,
      }).setOrigin(0.5, 1);
      cardContainer.add(name);

      // Card description
      const desc = this.add.text(0, -20, card.description, {
        font: "13px Inter, Arial, sans-serif",
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
              font: "bold 13px Inter, Arial, sans-serif",
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
              font: "bold 13px Inter, Arial, sans-serif",
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
    // Flash effect
    this.cameras.main.shake(200, 0.01);

    // Visual feedback
    const flash = this.add.text(this.scale.width / 2, this.scale.height / 2, "SELECTED!", {
      font: "bold 48px Inter, Arial, sans-serif",
      color: "#4ade80",
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: flash,
      alpha: 1,
      y: this.scale.height / 2 - 50,
      duration: 200,
      ease: "Power2",
      onComplete: () => {
        // Store selected card in registry so MatchScene can read it
        this.registry.set("draftSelectedCard", card);
        // Stop DraftScene - MatchScene listens for shutdown event
        this.scene.stop(SceneKeys.Draft);
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
          alpha: highlight ? 0.55 : 1.0,
          duration: 180,
          ease: "Power2",
        });
      }
    });

    const baseY = this.cardBaseY[index] ?? container.y;
    if (highlight) {
      this.tweens.add({
        targets: container,
        scaleX: 1.1,
        scaleY: 1.1,
        y: baseY - 20,
        rotation: 0.05,
        alpha: 1.0,
        duration: 180,
        ease: "Power2",
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
        ease: "Power2",
      });
    }
  }

  private renderCurrentBuild(centerX: number, y: number) {
    if (this.currentBuild.length === 0) {
      this.add.text(centerX, y, "No cards yet - first draft!", {
        font: "14px Inter, Arial, sans-serif",
        color: "#6b7280",
      }).setOrigin(0.5);
      return;
    }

    this.add.text(centerX, y - 25, "CURRENT BUILD:", {
      font: "bold 12px Inter, Arial, sans-serif",
      color: "#9ba7b8",
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
