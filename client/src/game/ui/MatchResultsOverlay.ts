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
};

export type MatchResultsHandlers = {
  onRematch: () => void;
  onReturnToLobby: () => void;
};

export class MatchResultsOverlay {
  private root: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subtitleEl: HTMLDivElement;
  private scoreboardEl: HTMLDivElement;
  private actionsEl: HTMLDivElement;
  private destroyed = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.matchResults = "true";
    Object.assign(this.root.style, BASE_OVERLAY_STYLE);

    const stage = document.createElement("div");
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
      this.titleEl.textContent = `MATCH WINNER: ${winnerRow.name.toUpperCase()}`;
      this.titleEl.style.color = winnerRow.color ?? "#fff7d6";
    } else {
      this.titleEl.textContent = "DRAW";
      this.titleEl.style.color = "#f7fbff";
    }

    this.subtitleEl.textContent = `First to ${view.targetScore}`;

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

    this.root.style.display = "flex";
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
    chip.textContent = card.name;
    Object.assign(chip.style, CARD_CHIP_STYLE);
    const glow = card.visual?.glowColor ?? colorForRarity(card.rarity);
    chip.style.borderColor = glow;
    chip.style.color = glow;
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
  background: "rgba(8, 11, 18, 0.85)",
  backdropFilter: "blur(8px)",
  fontFamily: "Inter, Arial, sans-serif",
  pointerEvents: "auto",
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "16px",
  padding: "32px 36px",
  borderRadius: "18px",
  border: "1px solid rgba(80, 227, 194, 0.35)",
  background: "linear-gradient(180deg, rgba(20, 24, 36, 0.95), rgba(11, 14, 20, 0.98))",
  boxShadow: "0 0 48px rgba(80, 227, 194, 0.18)",
  minWidth: "520px",
  maxWidth: "min(820px, 92vw)",
  maxHeight: "92vh",
  overflowY: "auto",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "30px",
  fontWeight: "900",
  letterSpacing: "0.18em",
  textAlign: "center",
  color: "#fff7d6",
  textShadow: "0 0 18px rgba(255, 247, 214, 0.45)",
};

const SUBTITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "12px",
  letterSpacing: "0.18em",
  color: "#9aa5b1",
  textTransform: "uppercase",
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
};

const ROW_SCORE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "26px",
  fontWeight: "900",
  fontFamily: "Consolas, monospace",
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
  padding: "11px 22px",
  borderRadius: "10px",
  fontFamily: "Inter, Arial, sans-serif",
  fontWeight: "900",
  fontSize: "14px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
  border: "1px solid #50e3c2",
  transition: "transform 120ms ease, filter 120ms ease",
};

const PRIMARY_BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  background: "linear-gradient(180deg, #50e3c2, #20c5a4)",
  color: "#0b0e14",
  borderColor: "#50e3c2",
};

const SECONDARY_BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  background: "rgba(11, 14, 20, 0.85)",
  color: "#f7fbff",
  borderColor: "#9aa5b1",
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
