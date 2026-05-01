// On-death card draft overlay. Spawns a DOM panel over the canvas with N
// card choices; picking one calls back into MatchScene to add the card to
// the player's progression. If the respawn timer expires without a pick,
// MatchScene auto-picks the first candidate.
//
// Lifecycle: scene constructs once on `create`, calls show() in killPlayer,
// hide() on pick or auto-pick, destroy() on scene shutdown.

import type { CardDefinition } from "../types/game";

export type CardPickHandler = (card: CardDefinition) => void;

export class CardDraftOverlay {
  private root: HTMLDivElement;
  private cardsContainer: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private currentCards: CardDefinition[] = [];
  private currentHandler: CardPickHandler | null = null;
  private destroyed = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.cardDraft = "true";
    Object.assign(this.root.style, BASE_OVERLAY_STYLE);

    const stage = document.createElement("div");
    Object.assign(stage.style, STAGE_STYLE);

    this.titleEl = document.createElement("div");
    this.titleEl.textContent = "PICK A CARD";
    Object.assign(this.titleEl.style, TITLE_STYLE);

    this.hintEl = document.createElement("div");
    this.hintEl.textContent = "Choose one. The next life starts when you pick (or when the respawn timer ends).";
    Object.assign(this.hintEl.style, HINT_STYLE);

    this.cardsContainer = document.createElement("div");
    Object.assign(this.cardsContainer.style, CARDS_CONTAINER_STYLE);

    stage.append(this.titleEl, this.hintEl, this.cardsContainer);
    this.root.appendChild(stage);

    document.body.appendChild(this.root);
    this.root.style.display = "none";
  }

  show(cards: CardDefinition[], onPick: CardPickHandler): void {
    if (this.destroyed) return;
    this.currentCards = cards;
    this.currentHandler = onPick;
    this.cardsContainer.replaceChildren();

    for (const card of cards) {
      const el = this.makeCardElement(card);
      el.addEventListener("click", () => this.handlePick(card));
      this.cardsContainer.appendChild(el);
    }

    this.root.style.display = "flex";
  }

  hide(): void {
    if (this.destroyed) return;
    this.root.style.display = "none";
    this.currentHandler = null;
    this.currentCards = [];
  }

  /**
   * Called when the respawn timer expires without a manual pick. Calls the
   * handler with the first candidate (UX: the leftmost card becomes the
   * default if you can't decide).
   */
  autoPick(): CardDefinition | null {
    if (this.destroyed) return null;
    const first = this.currentCards[0];
    if (!first || !this.currentHandler) return null;
    this.handlePick(first);
    return first;
  }

  isOpen(): boolean {
    return !this.destroyed && this.root.style.display !== "none";
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.currentHandler = null;
    this.root.remove();
  }

  private handlePick(card: CardDefinition): void {
    const handler = this.currentHandler;
    this.hide();
    handler?.(card);
  }

  private makeCardElement(card: CardDefinition): HTMLDivElement {
    const el = document.createElement("div");
    Object.assign(el.style, CARD_STYLE);

    // Border + glow use the card's identity color (or the rarity color if the
    // card hasn't authored one). Rarity badge ALWAYS uses the rarity color so
    // a card with a per-card glow doesn't make its rarity look like a
    // different tier (e.g. an orange uncommon used to read as "legendary").
    const rarityColor = colorForRarity(card.rarity);
    const glow = card.visual?.glowColor ?? rarityColor;
    el.style.borderColor = glow;
    el.style.boxShadow = `0 0 24px ${withAlpha(glow, 0.45)}, inset 0 0 18px ${withAlpha(glow, 0.18)}`;

    const rarity = document.createElement("div");
    rarity.textContent = card.rarity.toUpperCase();
    Object.assign(rarity.style, RARITY_STYLE);
    rarity.style.color = rarityColor;

    const name = document.createElement("div");
    name.textContent = card.name;
    Object.assign(name.style, NAME_STYLE);

    const buckets = document.createElement("div");
    buckets.textContent = (card.buckets ?? []).join(" · ").toUpperCase() || card.category.toUpperCase();
    Object.assign(buckets.style, BUCKETS_STYLE);

    const description = document.createElement("div");
    description.textContent = card.description;
    Object.assign(description.style, DESCRIPTION_STYLE);

    const flavor = document.createElement("div");
    flavor.textContent = card.flavorText ?? "";
    Object.assign(flavor.style, FLAVOR_STYLE);

    el.append(rarity, name, buckets, description, flavor);

    el.addEventListener("mouseenter", () => {
      el.style.transform = "translateY(-4px) scale(1.02)";
      el.style.boxShadow = `0 0 32px ${withAlpha(glow, 0.65)}, inset 0 0 22px ${withAlpha(glow, 0.28)}`;
    });
    el.addEventListener("mouseleave", () => {
      el.style.transform = "translateY(0) scale(1)";
      el.style.boxShadow = `0 0 24px ${withAlpha(glow, 0.45)}, inset 0 0 18px ${withAlpha(glow, 0.18)}`;
    });

    return el;
  }
}

// ---------------- Styles ----------------

const BASE_OVERLAY_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  inset: "0",
  zIndex: "9000",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(11, 14, 20, 0.78)",
  backdropFilter: "blur(6px)",
  fontFamily: "Inter, Arial, sans-serif",
  pointerEvents: "auto",
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "18px",
  padding: "28px 32px",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "28px",
  fontWeight: "900",
  letterSpacing: "0.18em",
  color: "#f7fbff",
  textShadow: "0 0 18px rgba(80, 227, 194, 0.55)",
};

const HINT_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "12px",
  color: "#9aa5b1",
  letterSpacing: "0.05em",
};

const CARDS_CONTAINER_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  gap: "20px",
  marginTop: "8px",
};

const CARD_STYLE: Partial<CSSStyleDeclaration> = {
  width: "240px",
  minHeight: "300px",
  padding: "20px 18px",
  borderRadius: "14px",
  border: "2px solid #f0abfc",
  background: "linear-gradient(160deg, rgba(20, 24, 36, 0.92), rgba(11, 14, 20, 0.96))",
  color: "#f7fbff",
  cursor: "pointer",
  transition: "transform 120ms ease, box-shadow 120ms ease",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const RARITY_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "900",
  letterSpacing: "0.18em",
};

const NAME_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "20px",
  fontWeight: "900",
  lineHeight: "1.1",
};

const BUCKETS_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: "0.12em",
  color: "#9aa5b1",
};

const DESCRIPTION_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "13px",
  lineHeight: "1.4",
  color: "#caffea",
  flex: "1",
};

const FLAVOR_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  fontStyle: "italic",
  color: "#f0abfc",
  opacity: "0.78",
  marginTop: "auto",
};

/**
 * Standard MMO/loot rarity convention:
 *   common = gray, uncommon = green, rare = purple, legendary = orange,
 *   cursed = red.
 * Used both for the rarity badge text and as a fallback border/glow when a
 * card hasn't authored its own identity color.
 */
function colorForRarity(rarity: CardDefinition["rarity"]): string {
  switch (rarity) {
    case "legendary":
      return "#fb923c"; // orange
    case "rare":
      return "#a78bfa"; // purple
    case "uncommon":
      return "#4ade80"; // green
    case "cursed":
      return "#fb7185"; // red-pink
    default:
      return "#9aa5b1"; // gray (common)
  }
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
