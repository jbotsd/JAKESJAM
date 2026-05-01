import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import type { CardDefinition } from "../types/game";

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
    this.add.rectangle(0, 0, width, height, 0x000000, 0.85);

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

    // Instructions
    this.add.text(width / 2, height - 50, "Click a card to select it", {
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
    const totalWidth = (cardWidth * 3) + (spacing * 2);
    const startX = centerX - totalWidth / 2;

    this.availableCards.forEach((card, index) => {
      const x = startX + (cardWidth + spacing) * index;
      const cardContainer = this.add.container(x, centerY);

      // Card background with rarity-colored border
      const border = this.add.rectangle(0, 0, cardWidth, cardHeight, 0x000000, 0);
      border.setStrokeStyle(5, this.getRarityColor(card.rarity));
      cardContainer.add(border);

      // Card background
      const bg = this.add.rectangle(0, 0, cardWidth - 10, cardHeight - 10, 0x1f2937);
      cardContainer.add(bg);

      // Element accent: tint the border with element color if card has one
      const cardElement = card.modifier?.projectile?.element;
      if (cardElement && cardElement !== "neutral" && cardElement !== "crystal") {
        border.setStrokeStyle(5, this.getElementColor(cardElement));
      }

      // Card icon placeholder
      const iconBg = this.add.rectangle(0, -90, 100, 100, this.getRarityColor(card.rarity));
      iconBg.setAngle(45);
      cardContainer.add(iconBg);

      // Card name
      const name = this.add.text(0, -50, card.name.toUpperCase(), {
        font: "bold 16px Inter, Arial, sans-serif",
        color: "#f7fbff",
      }).setOrigin(0.5);
      cardContainer.add(name);

      // Card description
      const desc = this.add.text(0, -20, card.description, {
        font: "13px Inter, Arial, sans-serif",
        color: "#9ba7b8",
        wordWrap: { width: cardWidth - 40 },
      }).setOrigin(0.5);
      cardContainer.add(desc);

      // Benefits (green text)
      let benefitsY = 30;
      if (card.benefits && card.benefits.length > 0) {
        this.add.text(0, benefitsY - 15, "BENEFITS:", {
          font: "bold 11px Inter, Arial, sans-serif",
          color: "#4ade80",
        }).setOrigin(0.5);
        cardContainer.add(this.add.text(0, benefitsY - 15, "BENEFITS:", {
          font: "bold 11px Inter, Arial, sans-serif",
          color: "#4ade80",
        }).setOrigin(0.5));
        
        card.benefits.forEach((benefit, i) => {
          const benefitText = this.add.text(0, benefitsY + (i * 20), `+${this.formatStat(benefit)}`, {
            font: "bold 13px Inter, Arial, sans-serif",
            color: "#4ade80",
          }).setOrigin(0.5);
          cardContainer.add(benefitText);
        });
        benefitsY += card.benefits.length * 20 + 20;
      }

      // Penalties (red text)
      if (card.penalties && card.penalties.length > 0) {
        this.add.text(0, benefitsY, "TRADEOFFS:", {
          font: "bold 11px Inter, Arial, sans-serif",
          color: "#f87171",
        }).setOrigin(0.5);
        
        card.penalties.forEach((penalty, i) => {
          const penaltyText = this.add.text(0, benefitsY + 15 + (i * 20), `-${this.formatStat(penalty)}`, {
            font: "bold 13px Inter, Arial, sans-serif",
            color: "#f87171",
          }).setOrigin(0.5);
          cardContainer.add(penaltyText);
        });
      }

      // Click handler
      border.setInteractive({ useHandCursor: true });
      border.on("pointerdown", () => this.selectCard(card));
      border.on("pointerover", () => this.highlightCard(cardContainer, true));
      border.on("pointerout", () => this.highlightCard(cardContainer, false));
    });
  }

  private selectCard(card: CardDefinition) {
    // Flash effect
    this.cameras.main.shake(200, 0.01);
    
    // Visual feedback
    this.add.text(this.scale.width / 2, this.scale.height / 2, "SELECTED!", {
      font: "bold 48px Inter, Arial, sans-serif",
      color: "#4ade80",
    }).setOrigin(0.5).setAlpha(0);
    
    this.tweens.add({
      targets: this.children.list[this.children.list.length - 1],
      alpha: 1,
      y: this.scale.height / 2 - 50,
      duration: 200,
      ease: "Power2",
      onComplete: () => {
        // Store selected card in registry so MatchScene can read it
        this.registry.set("draftSelectedCard", card);
        // Stop DraftScene - MatchScene listens for shutdown event
        this.scene.stop(SceneKeys.Draft);
      }
    });
  }

  private getElementColor(element: string): number {
    const colors: Record<string, number> = {
      fire: 0xff7a18,
      ice: 0x93c5fd,
      lightning: 0xfef08a,
      void: 0xa78bfa,
      radiant: 0xfff7d6,
      electric: 0xfef08a,
      toxic: 0x86efac,
      explosive: 0xfb7185,
    };
    return colors[element] ?? 0x9ca3af;
  }

  private getRarityColor(rarity: string): number {
    const colors: Record<string, number> = {
      common: 0x9ca3af,      // Gray
      uncommon: 0x3b82f6,    // Blue
      rare: 0xd946ef,        // Magenta
      legendary: 0xf59e0b,   // Gold
      cursed: 0xef4444,      // Red
    };
    return colors[rarity] || colors.common;
  }

  private formatStat(stat: any): string {
    if (!stat) return "";
    if (stat.multiplier) {
      const pct = Math.round((stat.value - 1) * 100);
      return `${pct > 0 ? '+' : ''}${pct}% ${stat.stat}`;
    }
    return `${stat.value > 0 ? '+' : ''}${stat.value} ${stat.stat}`;
  }

  private highlightCard(container: Phaser.GameObjects.Container, highlight: boolean) {
    if (highlight) {
      this.tweens.add({
        targets: container,
        scale: 1.05,
        duration: 150,
        ease: "Power2",
      });
    } else {
      this.tweens.add({
        targets: container,
        scale: 1,
        duration: 150,
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
      const x = centerX - ((this.currentBuild.length - 1) * 30) + (index * 60);
      const icon = this.add.rectangle(x, y, 50, 50, this.getRarityColor(card.rarity));
      icon.setStrokeStyle(2, 0xffffff);
      icon.setAngle(45);
    });
  }
}
