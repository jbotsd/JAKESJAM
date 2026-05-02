// On-death card draft overlay. Spawns a DOM panel over the canvas with N
// card choices; picking one calls back into MatchScene to add the card to
// the player's progression. If the respawn timer expires without a pick,
// MatchScene auto-picks the first candidate.
//
// Lifecycle: scene constructs once on `create`, calls show() in killPlayer,
// hide() on pick or auto-pick, destroy() on scene shutdown.
//
// showWithTimer(cards, onPick, totalMs) enables the respawn-timer progress
// bar that counts down from totalMs. Hide/destroy stop any running timer.

import type { CardDefinition } from "../types/game";

export type CardPickHandler = (card: CardDefinition) => void;

export class CardDraftOverlay {
  private root: HTMLDivElement;
  private cardsContainer: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private timerBar: HTMLDivElement;
  private currentCards: CardDefinition[] = [];
  private currentHandler: CardPickHandler | null = null;
  private destroyed = false;
  private timerRafId: number | null = null;
  private timerStartMs = 0;
  private timerTotalMs = 0;

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.cardDraft = "true";
    Object.assign(this.root.style, BASE_OVERLAY_STYLE);

    const stage = document.createElement("div");
    Object.assign(stage.style, STAGE_STYLE);

    // Header row: kicker + title
    const header = document.createElement("div");
    Object.assign(header.style, HEADER_STYLE);

    const kicker = document.createElement("div");
    kicker.textContent = "BETWEEN ROUNDS";
    Object.assign(kicker.style, KICKER_STYLE);

    this.titleEl = document.createElement("div");
    this.titleEl.textContent = "CHOOSE YOUR UPGRADE";
    Object.assign(this.titleEl.style, TITLE_STYLE);

    this.hintEl = document.createElement("div");
    this.hintEl.textContent = "Pick one card. Auto-selects when the timer expires.";
    Object.assign(this.hintEl.style, HINT_STYLE);

    header.append(kicker, this.titleEl, this.hintEl);

    // Timer bar
    const timerTrack = document.createElement("div");
    Object.assign(timerTrack.style, TIMER_TRACK_STYLE);
    this.timerBar = document.createElement("div");
    Object.assign(this.timerBar.style, TIMER_BAR_STYLE);
    timerTrack.appendChild(this.timerBar);

    this.cardsContainer = document.createElement("div");
    Object.assign(this.cardsContainer.style, CARDS_CONTAINER_STYLE);

    stage.append(header, timerTrack, this.cardsContainer);
    this.root.appendChild(stage);

    document.body.appendChild(this.root);
    this.root.style.display = "none";
  }

  show(cards: CardDefinition[], onPick: CardPickHandler): void {
    this.showWithTimer(cards, onPick, 0);
  }

  showWithTimer(cards: CardDefinition[], onPick: CardPickHandler, totalMs: number): void {
    if (this.destroyed) return;
    this.currentCards = cards;
    this.currentHandler = onPick;
    this.cardsContainer.replaceChildren();

    for (const card of cards) {
      const el = this.makeCardElement(card);
      el.addEventListener("click", () => this.handlePick(card));
      this.cardsContainer.appendChild(el);
    }

    // Entry animation
    this.root.style.display = "flex";
    this.root.style.opacity = "0";
    this.root.style.transform = "scale(0.96)";
    requestAnimationFrame(() => {
      this.root.style.opacity = "1";
      this.root.style.transform = "scale(1)";
    });

    // Timer
    this.stopTimer();
    if (totalMs > 0) {
      this.timerTotalMs = totalMs;
      this.timerStartMs = performance.now();
      this.timerBar.style.width = "100%";
      this.tickTimer();
    } else {
      this.timerBar.style.width = "0%";
    }
  }

  hide(): void {
    if (this.destroyed) return;
    this.root.style.display = "none";
    this.currentHandler = null;
    this.currentCards = [];
    this.stopTimer();
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
    this.stopTimer();
    this.root.remove();
  }

  private stopTimer(): void {
    if (this.timerRafId !== null) {
      cancelAnimationFrame(this.timerRafId);
      this.timerRafId = null;
    }
  }

  private tickTimer(): void {
    if (this.destroyed) return;
    const elapsed = performance.now() - this.timerStartMs;
    const ratio = Math.max(0, 1 - elapsed / this.timerTotalMs);
    this.timerBar.style.width = `${ratio * 100}%`;
    // Color transitions: green → warn → red
    const pct = ratio * 100;
    if (pct > 50) {
      this.timerBar.style.background = "#b8f05a";
    } else if (pct > 20) {
      this.timerBar.style.background = "#fde68a";
    } else {
      this.timerBar.style.background = "#fb7185";
    }
    if (ratio > 0) {
      this.timerRafId = requestAnimationFrame(() => this.tickTimer());
    }
  }

  private handlePick(card: CardDefinition): void {
    const handler = this.currentHandler;
    this.hide();
    handler?.(card);
  }

  private makeCardElement(card: CardDefinition): HTMLDivElement {
    const el = document.createElement("div");
    Object.assign(el.style, CARD_STYLE);

    // ROUNDS-style: fully transparent background, cyan bracket corners via
    // CSS absolute-positioned L-divs. Rarity glow is a subtle box-shadow only.
    const rarityColor = colorForRarity(card.rarity);
    // No opaque background — plate-less design
    el.style.background = "transparent";
    el.style.border = "none";
    el.style.boxShadow = `0 0 12px ${withAlpha(rarityColor, 0.3)}`;

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

    // Benefit lines (green)
    const benefitEls: HTMLDivElement[] = (card.benefits ?? []).map(b => {
      const div = document.createElement("div");
      div.textContent = `+${formatStatLine(b)}`;
      Object.assign(div.style, STAT_BENEFIT_STYLE);
      return div;
    });

    // Penalty lines (coral)
    const penaltyEls: HTMLDivElement[] = (card.penalties ?? []).map(p => {
      const div = document.createElement("div");
      div.textContent = `-${formatStatLine(p)}`;
      Object.assign(div.style, STAT_PENALTY_STYLE);
      return div;
    });

    el.append(rarity, name, buckets, description, ...benefitEls, ...penaltyEls, flavor);

    // Add 4 L-shaped corner bracket divs (cyan, ROUNDS-style)
    appendBracketCorners(el);

    el.addEventListener("mouseenter", () => {
      el.style.transform = "translateY(-20px) scale(1.10) rotate(3deg)";
      el.style.boxShadow = `0 0 24px ${withAlpha("#5DCFD9", 0.55)}`;
    });
    el.addEventListener("mouseleave", () => {
      el.style.transform = "translateY(0) scale(1) rotate(0deg)";
      el.style.boxShadow = `0 0 12px ${withAlpha(rarityColor, 0.3)}`;
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
  background: "rgba(5, 8, 15, 0.82)",
  backdropFilter: "blur(8px)",
  fontFamily: "Inter, Arial, sans-serif",
  pointerEvents: "auto",
  transition: "opacity 220ms ease, transform 220ms ease",
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "20px",
  padding: "32px 36px",
  borderRadius: "18px",
  border: "1px solid rgba(143, 248, 255, 0.22)",
  background: "linear-gradient(160deg, rgba(16, 20, 32, 0.94), rgba(10, 13, 22, 0.97))",
  boxShadow:
    "0 32px 80px rgba(0,0,0,0.6), 0 0 1px rgba(143,248,255,0.3), inset 0 1px 0 rgba(143,248,255,0.07)",
  maxWidth: "min(1100px, 95vw)",
  maxHeight: "92vh",
  overflowY: "auto",
};

const HEADER_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "6px",
};

const KICKER_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  fontWeight: "900",
  letterSpacing: "0.18em",
  color: "#8ff8ff",
  textTransform: "uppercase",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "26px",
  fontWeight: "900",
  letterSpacing: "0.12em",
  color: "#f7fbff",
  textTransform: "uppercase",
};

const HINT_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  color: "#7a8aa3",
  letterSpacing: "0.04em",
};

const TIMER_TRACK_STYLE: Partial<CSSStyleDeclaration> = {
  width: "100%",
  height: "4px",
  borderRadius: "2px",
  background: "rgba(255,255,255,0.08)",
  overflow: "hidden",
};

const TIMER_BAR_STYLE: Partial<CSSStyleDeclaration> = {
  height: "100%",
  borderRadius: "2px",
  background: "#b8f05a",
  width: "0%",
  transition: "background 300ms ease",
};

const CARDS_CONTAINER_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  gap: "18px",
  flexWrap: "wrap",
  justifyContent: "center",
};

const CARD_STYLE: Partial<CSSStyleDeclaration> = {
  position: "relative",
  width: "280px",
  minHeight: "380px",
  padding: "22px 20px",
  // Plate-less: transparent background, bracket corners handle the frame
  background: "#0A1418",
  border: "none",
  color: "#f7fbff",
  cursor: "pointer",
  transition: "transform 180ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 180ms ease",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const RARITY_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "900",
  letterSpacing: "0.2em",
  textTransform: "uppercase",
};

const NAME_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "22px",
  fontWeight: "900",
  lineHeight: "1.1",
  letterSpacing: "0.01em",
};

const BUCKETS_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: "0.14em",
  color: "#7a8aa3",
  textTransform: "uppercase",
};

const DESCRIPTION_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "13px",
  lineHeight: "1.5",
  color: "#caffea",
  flex: "1",
};

const FLAVOR_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  fontStyle: "italic",
  color: "#a78bfa",
  opacity: "0.78",
  marginTop: "auto",
  lineHeight: "1.4",
};

const STAT_BENEFIT_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "13px",
  fontWeight: "700",
  color: "#7DE05A",
  lineHeight: "1.4",
};

const STAT_PENALTY_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "13px",
  fontWeight: "700",
  color: "#E55A4A",
  lineHeight: "1.4",
};

// Bracket corner dimensions
const LEG = 14; // px per leg

/**
 * Appends 4 absolute-positioned L-shaped divs to produce ROUNDS-style corner
 * brackets. The parent element must have `position: relative`.
 */
function appendBracketCorners(el: HTMLDivElement): void {
  const corners: Array<{
    top?: string; bottom?: string; left?: string; right?: string;
    borderTop?: string; borderBottom?: string; borderLeft?: string; borderRight?: string;
  }> = [
    // Top-left
    { top: "0", left: "0", borderTop: `3px solid #5DCFD9`, borderLeft: `3px solid #5DCFD9` },
    // Top-right
    { top: "0", right: "0", borderTop: `3px solid #5DCFD9`, borderRight: `3px solid #5DCFD9` },
    // Bottom-left
    { bottom: "0", left: "0", borderBottom: `3px solid #5DCFD9`, borderLeft: `3px solid #5DCFD9` },
    // Bottom-right
    { bottom: "0", right: "0", borderBottom: `3px solid #5DCFD9`, borderRight: `3px solid #5DCFD9` },
  ];
  for (const corner of corners) {
    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.width = `${LEG}px`;
    div.style.height = `${LEG}px`;
    div.style.pointerEvents = "none";
    if (corner.top !== undefined) div.style.top = corner.top;
    if (corner.bottom !== undefined) div.style.bottom = corner.bottom;
    if (corner.left !== undefined) div.style.left = corner.left;
    if (corner.right !== undefined) div.style.right = corner.right;
    if (corner.borderTop) div.style.borderTop = corner.borderTop;
    if (corner.borderBottom) div.style.borderBottom = corner.borderBottom;
    if (corner.borderLeft) div.style.borderLeft = corner.borderLeft;
    if (corner.borderRight) div.style.borderRight = corner.borderRight;
    el.appendChild(div);
  }
}

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

function formatStatLine(stat: { multiplier?: boolean; value: number; stat: string } | undefined): string {
  if (!stat) return "";
  if (stat.multiplier) {
    const pct = Math.round((stat.value - 1) * 100);
    return `${Math.abs(pct)}% ${stat.stat}`;
  }
  return `${Math.abs(stat.value)} ${stat.stat}`;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
