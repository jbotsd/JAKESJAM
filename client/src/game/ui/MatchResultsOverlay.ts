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
import { rarityColorCss } from "./rarityColors.js";
import { describeBuild } from "./buildDescription.js";
import { matchResultsClassTag, type MatchResultsClassTag } from "./matchResultsClassTag.js";
import type { CharacterArchetype } from "../../sim/types.js";

export type MatchResultsRow = {
  playerId: string;
  name: string;
  color?: string;
  score: number;
  /** Drafted card ids for this player, in pick order. */
  cardIds: string[];
  /** Chassis selects the class-aware reading of the same card stack. */
  characterId?: CharacterArchetype;
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
  /** Second subtitle line ("First to N · match over") — a PERSISTENT
   *  element, not appended per show(): this overlay instance outlives
   *  world recycles, and an append-per-show leaked one extra line per
   *  finished match all session (12 stacked lines on Jake's screenshot,
   *  2026-07-17). */
  private secondaryEl: HTMLDivElement;
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

    this.secondaryEl = document.createElement("div");
    Object.assign(this.secondaryEl.style, SUBTITLE_STYLE);
    // Tuck against the primary subtitle — the two caption lines read as one
    // block, not two gapped rows fighting the stage's 18px flex gap.
    this.secondaryEl.style.marginTop = "-12px";
    this.secondaryEl.style.display = "none";

    this.scoreboardEl = document.createElement("div");
    Object.assign(this.scoreboardEl.style, SCOREBOARD_STYLE);

    this.actionsEl = document.createElement("div");
    Object.assign(this.actionsEl.style, ACTIONS_STYLE);

    stage.append(this.titleEl, this.subtitleEl, this.secondaryEl, this.scoreboardEl, this.actionsEl);
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
      this.subtitleEl.textContent = "THE RECORD NAMES ITS VICTOR";
    } else {
      this.titleEl.textContent = "DRAW";
      this.titleEl.style.color = "#f7fbff";
      this.titleEl.style.textShadow = "0 0 18px rgba(247,251,255,0.3)";
      this.subtitleEl.textContent = `First to ${view.targetScore} — the record closes level`;
    }

    // Secondary subtitle line — persistent element, toggled per show.
    if (winnerRow) {
      this.secondaryEl.textContent = `First to ${view.targetScore} · the record is closed`;
      this.secondaryEl.style.display = "";
    } else {
      this.secondaryEl.style.display = "none";
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
    // Doors 0.7 honest-copy: this button does NOT restart a match — it
    // re-queues you for the next cycle (worldClient.postRematchReady →
    // worldHost.markRematchReady fast-forwards the intermission timer).
    // Label says what it does; the onRematch identifier chain is untouched.
    const rematchButton = makeButton("Ready for next cycle", PRIMARY_BUTTON_STYLE);
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
      const shareButton = makeButton("Share highlight", SHARE_BUTTON_STYLE);
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

    // M1: settle in on open — a single restrained opacity + scale move,
    // plain ease-out, no spring/overshoot, no multi-stage cascade. Rows get
    // a small capped stagger so a full roster still settles well inside the
    // duration ceiling, instead of the old 80ms-per-row cascade.
    this.root.style.display = "flex";
    this.root.style.opacity = "0";

    this.stage.style.transform = "scale(0.98)";
    this.stage.style.opacity = "0";
    this.stage.style.transition = "none";

    this.titleEl.style.transform = "scale(1)";
    this.titleEl.style.opacity = "0";
    this.titleEl.style.transition = "none";

    const rowEls = Array.from(this.scoreboardEl.children) as HTMLElement[];
    for (const row of rowEls) {
      row.style.opacity = "0";
      row.style.transform = "translateY(6px)";
      row.style.transition = "none";
    }

    requestAnimationFrame(() => {
      this.root.style.opacity = "1";

      this.stage.style.transition = "transform 200ms ease-out, opacity 200ms ease-out";
      this.stage.style.transform = "scale(1)";
      this.stage.style.opacity = "1";

      this.titleEl.style.transition = "opacity 200ms ease-out";
      this.titleEl.style.opacity = "1";

      // Capped stagger (20ms/row, max 80ms) — total sequence stays under
      // ~260ms even for a full roster.
      rowEls.forEach((row, i) => {
        const delay = Math.min(i * 20, 80);
        setTimeout(() => {
          row.style.transition = "transform 160ms ease-out, opacity 160ms ease-out";
          row.style.transform = "translateY(0)";
          row.style.opacity = "1";
        }, delay);
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
    el.dataset.matchResultsRow = row.playerId;
    if (isWinner) {
      el.style.borderColor = row.color ?? "#fff7d6";
      el.style.boxShadow = `0 0 18px ${withAlpha(row.color ?? "#fff7d6", 0.45)}`;
    }

    const header = document.createElement("div");
    Object.assign(header.style, ROW_HEADER_STYLE);
    header.dataset.matchResultsHeader = "";

    const nameEl = document.createElement("div");
    nameEl.textContent = `${row.name}${row.isLocal ? " (you)" : ""}${isWinner ? "  ★" : ""}`;
    Object.assign(nameEl.style, ROW_NAME_STYLE);
    nameEl.dataset.matchResultsName = "";
    if (row.color) {
      nameEl.style.color = row.color;
    }

    // Name + class tag as one flex group so the tag rides next to the name
    // without disturbing the header's name/score space-between split.
    const nameRow = document.createElement("div");
    Object.assign(nameRow.style, ROW_NAME_ROW_STYLE);
    nameRow.dataset.matchResultsNameRow = "";
    nameRow.appendChild(nameEl);
    const classTag = matchResultsClassTag(row.characterId);
    if (classTag) {
      nameRow.appendChild(this.makeClassTagElement(classTag));
    }

    const scoreEl = document.createElement("div");
    scoreEl.textContent = `${row.score}`;
    Object.assign(scoreEl.style, ROW_SCORE_STYLE);
    scoreEl.dataset.matchResultsScore = "";

    header.append(nameRow, scoreEl);

    const cards = findCardsById(crystalRoundsCards, row.cardIds);
    const build = describeBuild(row.cardIds, row.characterId);
    const buildEl = document.createElement("div");
    Object.assign(buildEl.style, BUILD_SUMMARY_STYLE);
    buildEl.textContent = `${cards.length > 0 ? "BUILD AS IT STOOD" : "BUILD AS FORGED"} · ${build.summary}`;
    const cardListEl = document.createElement("div");
    Object.assign(cardListEl.style, CARD_LIST_STYLE);
    if (cards.length === 0) {
      cardListEl.textContent = "No cards drafted — stood as forged";
      cardListEl.style.opacity = "0.6";
    } else {
      for (const card of cards) {
        cardListEl.appendChild(this.makeCardChipElement(card));
      }
    }

    el.append(header, buildEl, cardListEl);
    return el;
  }

  private makeClassTagElement(tag: MatchResultsClassTag): HTMLSpanElement {
    const chip = document.createElement("span");
    Object.assign(chip.style, CLASS_TAG_CHIP_STYLE);
    chip.style.borderColor = tag.colorCss;
    chip.style.color = tag.colorCss;
    chip.textContent = tag.label;
    return chip;
  }

  private makeCardChipElement(card: CardDefinition): HTMLSpanElement {
    const chip = document.createElement("span");
    Object.assign(chip.style, CARD_CHIP_STYLE);
    const glow = card.visual?.glowColor ?? rarityColorCss(card.rarity);
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
  // transform never gets set on the root (only opacity, in show() below) —
  // dropped the dead transform clause rather than transitioning a property
  // nothing ever touches.
  transition: "opacity 280ms cubic-bezier(0.4,0,0.2,1)",
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "18px",
  padding: "36px 40px",
  borderRadius: "12px",
  border: "1px solid rgba(143, 248, 255, 0.28)",
  // Void-dark flat interior, no gradient fill standing in for a physical
  // card (G2/G3) — a hollow seam frame with content floating in void.
  background: "rgba(9, 12, 20, 0.97)",
  // Thin symmetric (no y-offset) glow only — no elevation boxShadow.
  boxShadow: "0 0 40px rgba(80,227,194,0.07), inset 0 1px 0 rgba(143,248,255,0.09)",
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
  // Hollow seam frame, void/transparent interior — not a filled plate
  // (G2/G3).
  border: "1px solid rgba(154, 165, 177, 0.35)",
  background: "transparent",
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
  // clusterA-05 (mobile-experience.md wave 2): the class-tag chip
  // (bd6b51f) plus a long callsign genuinely overflows a 393px-wide row —
  // the 2026-07-09 sweep only ever fixed the STAGE's own min-width, never
  // gave the name column itself a shrink/truncate story. `minWidth: 0`
  // overrides the flex-item default automatic minimum (content-based —
  // i.e. "never shrink below the full name's width"), and
  // overflow+whiteSpace+textOverflow turn that reclaimed shrink room into
  // a real ellipsis instead of wrapping/overflowing the row.
  minWidth: "0",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

const ROW_NAME_ROW_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: "0",
  // Take exactly the space header's space-between split leaves it (never
  // grows to push the score off — score/chip stay fixed, name is the only
  // thing that shrinks). Without an explicit basis, a flex item long
  // enough to want more than its share can still refuse to shrink evenly
  // against a sibling with no competing content (the score digits).
  flex: "1 1 auto",
};

// Class tag chip — GEO/INT/KIN/SYZ, the exact abbreviations + monospace
// font family the in-match roster nameplate uses (HudSystem.updateScoreRows
// / classAccentColors.classShortLabel), colored per the class's accent
// register (chassis-design-axioms CA2) since this overlay has the visual
// budget for it that the compact nameplate text doesn't. Chamfered, not a
// capsule (G1 — "no sausage").
const CLASS_TAG_CHIP_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "2px 7px",
  borderRadius: "5px",
  border: "1px solid currentColor",
  fontFamily: "'Space Mono', 'Courier New', monospace",
  fontSize: "10px",
  fontWeight: "900",
  letterSpacing: "0.08em",
  lineHeight: "1.4",
  flexShrink: "0",
};

const ROW_SCORE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "26px",
  fontWeight: "900",
  fontFamily: "'Space Mono', 'Courier New', monospace",
  color: "#50e3c2",
  // clusterA-05: the score is the one header element that must never give
  // up its space to a long name — pairs with ROW_NAME_ROW_STYLE's flex-grow
  // so all the squeezing lands on the name column's ellipsis, not here.
  flexShrink: "0",
};

const CARD_LIST_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  fontSize: "11px",
  color: "#caffea",
};

const BUILD_SUMMARY_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "13px",
  lineHeight: "1.4",
  color: "#fff7d6",
  letterSpacing: "0.01em",
};

const CARD_CHIP_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "3px 8px",
  // Chamfer, not a capsule (G1 — "no sausage").
  borderRadius: "6px",
  border: "1px solid #50e3c2",
  fontWeight: "700",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const ACTIONS_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  // Wrap + center: at 393px the stage's usable row (~281px inside the
  // 40px side padding) can't fit "READY FOR NEXT CYCLE" beside "BACK TO
  // LOBBY" (+ optional "SHARE HIGHLIGHT"). Buttons keep their intrinsic
  // width and wrap into centered rows instead of overflowing the stage
  // sideways — same shrink-nothing-important philosophy as clusterA-05's
  // row fix above (only the name column ever gives up space).
  flexWrap: "wrap",
  justifyContent: "center",
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
  // Plain 1px hover-lift — too small for spring overshoot to read as
  // anything but noise; clean ease-out matches .match-chrome-btn's own
  // hover convention elsewhere in the shell.
  transition: "transform 140ms cubic-bezier(0.16,1,0.3,1), filter 120ms ease, box-shadow 120ms ease",
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

// C2: share/highlight CTAs are the sanctioned gold exception (house
// feature, not combat) — matches DeathOverlay.ts's equivalent share button.
const SHARE_BUTTON_STYLE: Partial<CSSStyleDeclaration> = {
  background: "transparent",
  color: "#c9a84c",
  borderColor: "rgba(201, 168, 76, 0.45)",
};

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
