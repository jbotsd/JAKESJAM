// Match-end results overlay (Milestone 14). Shown when stepRound reports
// matchComplete: a player reached the target round score (or all opponents
// were eliminated). Renders a DOM panel above the canvas with:
//   - the match winner (or DRAW),
//   - per-player final scores,
//   - each player's drafted card list,
//   - Rematch / Back to Lobby actions.
//
// Mirrors CardDraftOverlay's structure: a single fixed-position root that
// owns inline styles, a show()/hide()/destroy() lifecycle, and click
// handlers piped back to MatchScene via callbacks.
//
// For offline practice, only the local player has authored cards in scope —
// remote players appear in the score table but with an empty card list.
// For online matches the same surface is reused; the calling scene supplies
// each player's cards via `players[i].cardIds`.

import { findCardsById } from "../systems/WeaponSystem";
import type { CardDefinition } from "../types/game";
import { crystalRoundsCards } from "../data/cards";
import {
  formatSealChip,
  sealAccent,
  sealForCard,
  SEAL_ACCENT_HEX,
} from "./cardSeals.js";

export type MatchResultsRow = {
  playerId: string;
  name: string;
  color?: string;
  score: number;
  /** Drafted card ids for this player, in pick order. */
  cardIds: string[];
  /** Whether this row represents the local player (gets a "(you)" tag). */
  isLocal?: boolean;
};

export type MatchResultsView = {
  /** PlayerId of the match winner, or null on a draw. */
  winnerPlayerId: string | null;
  /** First-to-N target score for context (e.g. "First to 3"). */
  targetScore: number;
  /** Scoreboard rows. The overlay sorts by score desc internally. */
  rows: MatchResultsRow[];
  /** Optional highlight clip URL for Share/Copy. */
  shareUrl?: string;
};

export type MatchResultsHandlers = {
  onRematch: () => void;
  onReturnToLobby: () => void;
};

export class MatchResultsOverlay {
  private root: HTMLDivElement;
  private stage: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private scoreboardEl: HTMLDivElement;
  private actionsEl: HTMLDivElement;
  private destroyed = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.matchResults = "true";
    Object.assign(this.root.style, BASE_OVERLAY_STYLE);

    this.stage = document.createElement("div");
    const stage = this.stage;
    Object.assign(stage.style, STAGE_STYLE);

    this.titleEl = document.createElement("div");
    Object.assign(this.titleEl.style, TITLE_STYLE);

    this.subtitleEl = document.createElement("div");
    Object.assign(this.subtitleEl.style, SUBTITLE_STYLE);

    this.scoreboardEl = document.createElement("div");
    Object.assign(this.scoreboardEl.style, SCOREBOARD_STYLE);

    this.actionsEl = document.createElement("div");
    Object.assign(this.actionsEl.style, ACTIONS_STYLE);

    stage.append(this.titleEl, this.subtitleEl, this.scoreboardEl, this.actionsEl);
    this.root.appendChild(stage);

    document.body.appendChild(this.root);
    this.root.style.display = "none";
  }

  show(view: MatchResultsView, handlers: MatchResultsHandlers): void {
    if (this.destroyed) return;

    const winnerRow = view.winnerPlayerId
      ? view.rows.find((row) => row.playerId === view.winnerPlayerId)
      : undefined;

    if (winnerRow) {
      this.titleEl.textContent = winnerRow.name.toUpperCase();
      this.titleEl.style.color = winnerRow.color ?? "#fff7d6";
      this.titleEl.style.textShadow = `0 0 28px ${withAlpha(winnerRow.color ?? "#fff7d6", 0.45)}`;
      this.subtitleEl.textContent = "MATCH WINNER";
    } else {
      this.titleEl.textContent = "DRAW";
      this.titleEl.style.color = "#f7fbff";
      this.titleEl.style.textShadow = "0 0 18px rgba(247,251,255,0.3)";
      this.subtitleEl.textContent = `First to ${view.targetScore}`;
    }

    // Secondary subtitle line
    if (winnerRow) {
      const secondary = document.createElement("div");
      secondary.textContent = `First to ${view.targetScore} · match over`;
      Object.assign(secondary.style, SUBTITLE_STYLE);
      this.subtitleEl.after(secondary);
    }

    this.scoreboardEl.replaceChildren();
    const sortedRows = [...view.rows].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });
    for (const row of sortedRows) {
      this.scoreboardEl.appendChild(this.makeRowElement(row, view.winnerPlayerId === row.playerId));
    }

    this.actionsEl.replaceChildren();
    const rematchButton = makeButton("Rematch", PRIMARY_BUTTON_STYLE);
    rematchButton.addEventListener("click", () => {
      this.hide();
      handlers.onRematch();
    });
    const lobbyButton = makeButton("Back to Lobby", SECONDARY_BUTTON_STYLE);
    lobbyButton.addEventListener("click", () => {
      this.hide();
      handlers.onReturnToLobby();
    });
    this.actionsEl.append(rematchButton, lobbyButton);
    if (view.shareUrl) {
      const shareUrl = view.shareUrl;
      const shareButton = makeButton("Share highlight", SECONDARY_BUTTON_STYLE);
      shareButton.addEventListener("click", () => {
        void (async () => {
          try {
            if (typeof navigator.share === "function") {
              await navigator.share({
                title: "JAKESJAM highlight",
                text: "Check out this play from JAKESJAM!",
                url: shareUrl,
              });
            } else {
              await navigator.clipboard.writeText(shareUrl);
              shareButton.textContent = "Copied!";
            }
          } catch {
            /* cancel */
          }
        })();
      });
      this.actionsEl.appendChild(shareButton);
    }

    // Orchestrated slam-in: backdrop fades, stage slams from below, then
    // title crashes in overscale → settles, then scoreboard rows stagger in.
    this.root.style.display = "flex";
    this.root.style.opacity = "0";

    // Stage starts off-screen below
    this.stage.style.transform = "translateY(60px) scale(0.88)";
    this.stage.style.opacity = "0";
    this.stage.style.transition = "none";

    // Title starts overscale
    this.titleEl.style.transform = "scale(1.6)";
    this.titleEl.style.opacity = "0";
    this.titleEl.style.transition = "none";

    // Hide scoreboard rows for stagger
    const rowEls = Array.from(this.scoreboardEl.children) as HTMLElement[];
    for (const row of rowEls) {
      row.style.opacity = "0";
      row.style.transform = "translateX(-18px)";
      row.style.transition = "none";
    }

    requestAnimationFrame(() => {
      // 1. Backdrop fade in
      this.root.style.opacity = "1";

      // 2. Stage slams up (60ms after backdrop starts)
      setTimeout(() => {
        this.stage.style.transition = "transform 340ms cubic-bezier(0.22,1,0.36,1), opacity 200ms ease";
        this.stage.style.transform = "translateY(0) scale(1)";
        this.stage.style.opacity = "1";
      }, 60);

      // 3. Title crashes in
      setTimeout(() => {
        this.titleEl.style.transition = "transform 280ms cubic-bezier(0.34,1.56,0.64,1), opacity 160ms ease";
        this.titleEl.style.transform = "scale(1)";
        this.titleEl.style.opacity = "1";
      }, 180);

      // 4. Scoreboard rows stagger in
      rowEls.forEach((row, i) => {
        setTimeout(() => {
          row.style.transition = "transform 240ms cubic-bezier(0.34,1.56,0.64,1), opacity 160ms ease";
          row.style.transform = "translateX(0)";
          row.style.opacity = "1";
        }, 380 + i * 80);
      });
    });
  }

  hide(): void {
    if (this.destroyed) return;
    this.root.style.display = "none";
  }

  isOpen(): boolean {
    return !this.destroyed && this.root.style.display !== "none";
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.remove();
  }

  private makeRowElement(row: MatchResultsRow, isWinner: boolean): HTMLDivElement {
    const el = document.createElement("div");
    Object.assign(el.style, ROW_STYLE);
    if (isWinner) {
      el.style.borderColor = row.color ?? "#fff7d6";
      el.style.boxShadow = `0 0 18px ${withAlpha(row.color ?? "#fff7d6", 0.45)}`;
    }

    const header = document.createElement("div");
    Object.assign(header.style, ROW_HEADER_STYLE);

    const nameEl = document.createElement("div");
    nameEl.textContent = `${row.name}${row.isLocal ? " (you)" : ""}${isWinner ? "  ★" : ""}`;
    Object.assign(nameEl.style, ROW_NAME_STYLE);
    if (row.color) {
      nameEl.style.color = row.color;
    }

    const scoreEl = document.createElement("div");
    scoreEl.textContent = `${row.score}`;
    Object.assign(scoreEl.style, ROW_SCORE_STYLE);

    header.append(nameEl, scoreEl);

    const cards = findCardsById(crystalRoundsCards, row.cardIds);
    const cardListEl = document.createElement("div");
    Object.assign(cardListEl.style, CARD_LIST_STYLE);
    if (cards.length === 0) {
      cardListEl.textContent = "No cards drafted";
      cardListEl.style.opacity = "0.6";
    } else {
      for (const card of cards) {
        cardListEl.appendChild(this.makeCardChipElement(card));
      }
    }

    el.append(header, cardListEl);
    return el;
  }

  private makeCardChipElement(card: CardDefinition): HTMLSpanElement {
    const chip = document.createElement("span");
    Object.assign(chip.style, CARD_CHIP_STYLE);
    const glow = card.visual?.glowColor ?? colorForRarity(card.rarity);
    chip.style.borderColor = glow;
    chip.style.color = glow;
    chip.style.display = "inline-flex";
    chip.style.flexDirection = "column";
    chip.style.alignItems = "flex-start";
    chip.style.gap = "2px";
    chip.style.lineHeight = "1.2";

    // Card plate micro-seal: Coptic + english (never bare Coptic)
    const seal = sealForCard(card);
    const accent = SEAL_ACCENT_HEX[sealAccent(card)];
    const sealEl = document.createElement("span");
    sealEl.textContent = formatSealChip(card);
    sealEl.title = `${seal.latin} — ${seal.english}`;
    Object.assign(sealEl.style, {
      fontSize: "9px",
      letterSpacing: "0.08em",
      color: accent,
      fontFamily: "'Segoe UI Historic', 'Noto Sans Coptic', 'Noto Sans', serif",
      opacity: "0.9",
    } as Partial<CSSStyleDeclaration>);
    const nameEl = document.createElement("span");
    nameEl.textContent = card.name;
    Object.assign(nameEl.style, {
      fontSize: "11px",
      fontWeight: "700",
      color: glow,
    } as Partial<CSSStyleDeclaration>);
    chip.append(sealEl, nameEl);
    return chip;
  }
}

function makeButton(label: string, baseStyle: Partial<CSSStyleDeclaration>): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  Object.assign(btn.style, BUTTON_BASE_STYLE, baseStyle);
  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "translateY(-1px)";
    btn.style.filter = "brightness(1.15)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "translateY(0)";
    btn.style.filter = "brightness(1)";
  });
  return btn;
}

// ---------------- Styles ----------------

const BASE_OVERLAY_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  inset: "0",
  zIndex: "9100",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(5, 8, 15, 0.88)",
  backdropFilter: "blur(10px)",
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
  pointerEvents: "auto",
  transition: "opacity 280ms cubic-bezier(0.4,0,0.2,1), transform 280ms cubic-bezier(0.34,1.56,0.64,1)",
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "18px",
  padding: "36px 40px",
  borderRadius: "20px",
  border: "1px solid rgba(143, 248, 255, 0.28)",
  background:
    "linear-gradient(160deg, rgba(16, 20, 32, 0.96), rgba(10, 13, 22, 0.99))",
  boxShadow:
    "0 40px 100px rgba(0,0,0,0.65), 0 0 1px rgba(143,248,255,0.35), 0 0 50px rgba(80,227,194,0.07), inset 0 1px 0 rgba(143,248,255,0.09)",
  // min() so a 393px phone is not forced wider than its own viewport
  minWidth: "min(520px, 92vw)",
  maxWidth: "min(840px, 92vw)",
  maxHeight: "92vh",
  overflowY: "auto",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "40px",
  fontWeight: "900",
  letterSpacing: "0.06em",
  textAlign: "center",
  color: "#fff7d6",
  lineHeight: "1.1",
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
};

const SUBTITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  letterSpacing: "0.2em",
  color: "#7a8aa3",
  textTransform: "uppercase",
  textAlign: "center",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

const SCOREBOARD_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  width: "100%",
  marginTop: "6px",
};

const ROW_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "14px 16px",
  borderRadius: "10px",
  border: "1px solid rgba(154, 165, 177, 0.35)",
  background: "rgba(7, 16, 28, 0.7)",
};

const ROW_HEADER_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: "16px",
};

const ROW_NAME_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "18px",
  fontWeight: "900",
  letterSpacing: "0.04em",
  color: "#f7fbff",
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
};

const ROW_SCORE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "26px",
  fontWeight: "900",
  fontFamily: "'Space Mono', 'Courier New', monospace",
  color: "#50e3c2",
};

const CARD_LIST_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  fontSize: "11px",
  color: "#caffea",
};

const CARD_CHIP_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "3px 8px",
  borderRadius: "999px",
  border: "1px solid #50e3c2",
  fontWeight: "700",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const ACTIONS_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  gap: "12px",
  marginTop: "10px",
};

const BUTTON_BASE_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "12px 26px",
  borderRadius: "10px",
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
  fontWeight: "900",
  fontSize: "13px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  cursor: "pointer",
  border: "1px solid #50e3c2",
  transition: "transform 140ms cubic-bezier(0.34,1.56,0.64,1), filter 120ms ease, box-shadow 120ms ease",
};

const PRIMARY_BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  background: "linear-gradient(180deg, #6af4d8 0%, #3fd4b2 100%)",
  color: "#071110",
  borderColor: "#59f0cf",
  boxShadow: "0 0 18px rgba(80,227,194,0.28)",
};

const SECONDARY_BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  background: "rgba(11, 14, 20, 0.88)",
  color: "#f7fbff",
  borderColor: "rgba(154,165,177,0.5)",
};

function colorForRarity(rarity: CardDefinition["rarity"]): string {
  switch (rarity) {
    case "legendary":
      return "#fb923c";
    case "rare":
      return "#a78bfa";
    case "uncommon":
      return "#4ade80";
    case "cursed":
      return "#fb7185";
    default:
      return "#9aa5b1";
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
