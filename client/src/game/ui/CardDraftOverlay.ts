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
import { isPortraitMobile, isTouchPrimary } from "../input/mobile";
import {
  formatSealGloss,
  formatSealLine,
  sealAccent,
  sealForCard,
  SEAL_ACCENT_HEX,
} from "./cardSeals.js";
import { cardGlyphHtml } from "./cardGlyphs.js";

export type CardPickHandler = (card: CardDefinition) => void;

/** Optional juice hooks so the scene can fire camera/audio/world VFX on pick
 *  without the overlay importing Phaser. */
export type CardDraftJuice = {
  /** Called immediately when the player confirms a card (before hide). */
  onPicked?: (card: CardDefinition) => void;
};

/** Card copy lives in sim data (cards.ts) and is written for desktop
 *  ("press C"). Rewrite input references at render time for touch players —
 *  the data file feeds the Zig codegen and must stay input-agnostic. */
function localizeDescriptionForInput(description: string): string {
  if (!isTouchPrimary()) return description;
  return description.replace(/\(press C\)/g, "(DASH button)");
}

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
  private juice: CardDraftJuice = {};

  constructor(juice: CardDraftJuice = {}) {
    this.juice = juice;
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

    // Instrument imprint — Coptic seal with English gloss (not a sermon).
    const sealImprint = document.createElement("div");
    sealImprint.setAttribute("aria-hidden", "true");
    Object.assign(sealImprint.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "2px",
      marginTop: "2px",
    } as Partial<CSSStyleDeclaration>);
    const sealCoptic = document.createElement("div");
    sealCoptic.textContent = "ⲤⲪⲢⲀⲄⲒⲤ  ·  sphragis";
    Object.assign(sealCoptic.style, {
      fontSize: "11px",
      letterSpacing: "0.18em",
      color: "#c9a84c",
      fontFamily: "'Segoe UI Historic', 'Noto Sans Coptic', 'Noto Sans', serif",
      opacity: "0.85",
    } as Partial<CSSStyleDeclaration>);
    const sealGloss = document.createElement("div");
    sealGloss.textContent = "seal — pick one emission into the vessel";
    Object.assign(sealGloss.style, {
      fontSize: "9px",
      letterSpacing: "0.12em",
      color: "#7a8299",
      textTransform: "lowercase",
      fontFamily: "'Space Mono', 'Courier New', monospace",
    } as Partial<CSSStyleDeclaration>);
    sealImprint.append(sealCoptic, sealGloss);

    this.hintEl = document.createElement("div");
    this.hintEl.textContent = "Pick one card. Auto-selects when the timer expires.";
    Object.assign(this.hintEl.style, HINT_STYLE);

    header.append(kicker, this.titleEl, sealImprint, this.hintEl);

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
    // Per onboarding-ftue/SKILL.md: the FIRST draft ever gets one extra
    // teaching line, then never again (localStorage-gated, same pattern as
    // the controls legend).
    const FIRST_DRAFT_KEY = "jakesjam-ftue-first-draft-shown";
    let firstDraftEver = false;
    try {
      firstDraftEver = localStorage.getItem(FIRST_DRAFT_KEY) !== "1";
      if (firstDraftEver) localStorage.setItem(FIRST_DRAFT_KEY, "1");
    } catch {
      // localStorage unavailable — skip the extra line rather than nag forever.
    }
    this.hintEl.textContent = firstDraftEver
      ? "Pick one. It stacks with your weapon for the rest of the match. Auto-selects when the timer expires."
      : "Pick one card. Auto-selects when the timer expires.";
    this.cardsContainer.replaceChildren();

    cards.forEach((card, i) => {
      const el = this.makeCardElement(card);
      el.addEventListener("click", () => this.handlePick(card));
      // Nijman staggered spawn — each plate overshoots in.
      el.style.opacity = "0";
      el.style.transform = "translateY(28px) scale(0.88)";
      el.style.transition = `opacity 200ms ease ${i * 55}ms, transform 240ms cubic-bezier(0.34,1.4,0.64,1) ${i * 55}ms`;
      this.cardsContainer.appendChild(el);
      requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0) scale(1)";
      });
    });

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

  /**
   * Public hide — also called externally (SimEventRouter's hideCardDraft)
   * whenever the server-authoritative round phase moves on. A single-
   * player-vs-bots match can satisfy "everyone picked" the instant the
   * local player clicks, so that external call can land within tens of
   * ms of a pick — well before the reveal sequence below has had its
   * ~860ms to play. Deferring to an in-flight sequence here (rather than
   * force-hiding underneath it) is what makes the sequence actually
   * finish playing instead of getting cut off almost every time (Jake,
   * 2026-07-14: "animate it all together with sequence" — found via a
   * live CDP check: the overlay was vanishing after ~300ms of a ~860ms
   * sequence). The sequence's own completion calls forceHide() directly,
   * which always actually hides — this only guards the EXTERNAL path.
   */
  hide(): void {
    if (this.destroyed || this.pickInFlight) return;
    this.forceHide();
  }

  private forceHide(): void {
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

  /** True while a pick sequence is playing — guards against a second
   *  click/auto-pick firing mid-sequence and stomping the timers below. */
  private pickInFlight = false;

  private handlePick(card: CardDefinition): void {
    if (this.pickInFlight) return;
    this.pickInFlight = true;
    const handler = this.currentHandler;
    // Pick juice BEFORE hide so the scene can still flash while overlay fades.
    try {
      this.juice.onPicked?.(card);
    } catch {
      // never block the pick path on juice errors
    }

    // ── Sequenced reveal (Jake, 2026-07-14: "animate it all together with
    // sequence") — was a single instant flash+dismiss; now the winning
    // card gets its own short beat before the overlay closes, staging
    // through the SAME plates already on screen (no separate confirmation
    // modal to build/maintain):
    //   1. every OTHER card dims + settles back (spotlight the winner)
    //   2. the winner steps forward (scale/elevate, Nijman overshoot —
    //      matches the entry animation's own motion language above)
    //   3. rarity label flashes, icon pops, name+rule reveals, seal fades
    //   4. the existing whole-stage glow flash, then hide()
    const winnerEl = this.cardsContainer.querySelector<HTMLElement>(
      `[data-card-plate="${card.id}"]`,
    );
    const others = Array.from(
      this.cardsContainer.querySelectorAll<HTMLElement>("[data-card-plate]"),
    ).filter((el) => el !== winnerEl);

    for (const el of others) {
      el.style.transition = "opacity 260ms ease, transform 260ms ease";
      el.style.opacity = "0.16";
      el.style.transform = "scale(0.92)";
      el.style.pointerEvents = "none";
    }

    const glow = card.visual?.glowColor ?? colorForRarity(card.rarity);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      timers.push(setTimeout(() => { if (!this.destroyed) fn(); }, ms));
    };

    if (winnerEl) {
      winnerEl.style.position = "relative";
      winnerEl.style.zIndex = "3";
      winnerEl.style.pointerEvents = "none";
      // Step forward — same overshoot curve as the entry spawn (Nijman),
      // not a different bounce, so the two beats read as one motion voice.
      winnerEl.style.transition =
        "transform 260ms cubic-bezier(0.34,1.4,0.64,1), box-shadow 260ms ease";
      winnerEl.style.transform = "translateY(-6px) scale(1.07)";
      winnerEl.style.boxShadow = `0 0 0 1px ${withAlpha(glow, 0.55)}, 0 16px 40px rgba(0,0,0,0.55), 0 0 32px ${withAlpha(glow, 0.35)}`;

      const rarityEl = winnerEl.querySelector<HTMLElement>("[data-card-rarity]");
      const orbEl = winnerEl.querySelector<HTMLElement>("[data-card-orb]");
      const nameEl = winnerEl.querySelector<HTMLElement>("[data-card-name]");
      const sealEl = winnerEl.querySelector<HTMLElement>(`[data-card-seal="${card.id}"]`);
      for (const el of [rarityEl, orbEl, nameEl, sealEl]) {
        if (!el) continue;
        el.style.transition = "none";
        el.style.opacity = "0.35";
        el.style.transform = el === orbEl ? "scale(0.8)" : "translateY(4px)";
      }
      const reveal = (el: HTMLElement | null, delayMs: number, scalePop: boolean) => {
        if (!el) return;
        after(delayMs, () => {
          el.style.transition = scalePop
            ? "opacity 180ms ease, transform 220ms cubic-bezier(0.34,1.4,0.64,1)"
            : "opacity 180ms ease, transform 220ms ease";
          el.style.opacity = "1";
          el.style.transform = scalePop ? "scale(1)" : "translateY(0)";
        });
      };
      reveal(rarityEl, 80, false);
      reveal(orbEl, 160, true);
      reveal(nameEl, 280, false);
      reveal(sealEl, 380, false);
    }

    after(560, () => {
      // Brief whole-stage glow so every pick "lands" — now the CLOSING
      // beat of the sequence rather than the only beat.
      const flash = document.createElement("div");
      Object.assign(flash.style, {
        position: "fixed",
        inset: "0",
        zIndex: "9001",
        pointerEvents: "none",
        background: `radial-gradient(circle at 50% 50%, ${withAlpha(glow, 0.55)} 0%, transparent 55%)`,
        opacity: "1",
        transition: "opacity 280ms ease",
      } as Partial<CSSStyleDeclaration>);
      document.body.appendChild(flash);
      requestAnimationFrame(() => {
        flash.style.opacity = "0";
        setTimeout(() => flash.remove(), 320);
      });
      this.pickInFlight = false;
      this.hide();
      handler?.(card);
    });
  }

  private makeCardElement(card: CardDefinition): HTMLDivElement {
    const el = document.createElement("div");
    el.dataset.cardPlate = card.id;
    Object.assign(el.style, CARD_STYLE);
    // Phones: compact plates so 2–3 options stay on-screen under the timer.
    if (isTouchPrimary()) {
      el.style.minHeight = "0";
      el.style.padding = "16px 16px";
      if (isPortraitMobile()) el.style.width = "min(280px, 78vw)";
    }

    // Matte plate — glyph silhouette + copy carry identity. Minimal radiance.
    const rarityColor = colorForRarity(card.rarity);
    const glow = card.visual?.glowColor ?? rarityColor;
    const accent = sealAccent(card);
    const accentHex = SEAL_ACCENT_HEX[accent];
    const seal = sealForCard(card);

    el.style.background = "linear-gradient(165deg, rgba(14, 18, 28, 0.98), rgba(8, 10, 16, 0.99))";
    el.style.border = `1px solid ${withAlpha(glow, 0.14)}`;
    el.style.setProperty(
      "--jj-card-glow",
      [
        `0 0 0 1px ${withAlpha(glow, 0.08)}`,
        "0 8px 24px rgba(0,0,0,0.45)",
        "inset 0 1px 0 rgba(255,255,255,0.04)",
      ].join(", "),
    );
    el.style.setProperty(
      "--jj-card-glow-hot",
      [
        `0 0 0 1px ${withAlpha(glow, 0.2)}`,
        "0 10px 28px rgba(0,0,0,0.5)",
        "inset 0 1px 0 rgba(255,255,255,0.06)",
      ].join(", "),
    );
    el.style.boxShadow = "var(--jj-card-glow)";
    el.style.overflow = "hidden";

    const rarity = document.createElement("div");
    rarity.dataset.cardRarity = "";
    rarity.textContent = card.rarity.toUpperCase();
    Object.assign(rarity.style, RARITY_STYLE);
    rarity.style.color = rarityColor;
    rarity.style.textShadow = "none";
    rarity.style.position = "relative";
    rarity.style.zIndex = "2";

    // Glyph only — no aura halo. Symbol is the icon.
    const orbWrap = document.createElement("div");
    orbWrap.dataset.cardOrb = "";
    Object.assign(orbWrap.style, {
      position: "relative",
      width: "76px",
      height: "76px",
      margin: "4px auto 8px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "2",
    } as Partial<CSSStyleDeclaration>);
    const glyph = document.createElement("div");
    glyph.innerHTML = cardGlyphHtml(card);
    Object.assign(glyph.style, {
      position: "relative",
      zIndex: "1",
      lineHeight: "0",
      opacity: "0.95",
    } as Partial<CSSStyleDeclaration>);
    orbWrap.append(glyph);

    // ── Card identity stack (this IS the plate, not a header footnote) ──
    // Name → seal (Coptic · latin) → english gloss → buckets
    const name = document.createElement("div");
    name.dataset.cardName = "";
    name.textContent = card.name;
    Object.assign(name.style, NAME_STYLE);
    name.style.textAlign = "center";

    // Gold hairline under name (Orthodox inscription bar → instrument rule)
    const nameRule = document.createElement("div");
    Object.assign(nameRule.style, {
      width: "48%",
      height: "1px",
      margin: "0 auto 4px",
      background: `linear-gradient(90deg, transparent, ${accentHex}, transparent)`,
      opacity: "0.7",
    } as Partial<CSSStyleDeclaration>);

    const sealBlock = document.createElement("div");
    sealBlock.setAttribute("data-card-seal", card.id);
    Object.assign(sealBlock.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
      margin: "2px 0 6px",
      padding: "6px 10px",
      borderRadius: "4px",
      border: `1px solid ${withAlpha(accentHex, 0.14)}`,
      background: "transparent",
      width: "100%",
      boxSizing: "border-box",
    } as Partial<CSSStyleDeclaration>);
    const sealLine = document.createElement("div");
    sealLine.textContent = formatSealLine(seal);
    sealLine.title = `${seal.latin} — ${seal.english} (${seal.motif})`;
    Object.assign(sealLine.style, {
      fontSize: "13px",
      letterSpacing: "0.12em",
      color: accentHex,
      fontFamily: "'Segoe UI Historic', 'Noto Sans Coptic', 'Noto Sans', 'Segoe UI', serif",
      textAlign: "center",
      lineHeight: "1.35",
      opacity: "0.98",
    } as Partial<CSSStyleDeclaration>);
    const sealGloss = document.createElement("div");
    // Always show english — and latin again for screen readers / no-Coptic fonts
    sealGloss.textContent = `${formatSealGloss(seal)}  ·  ${seal.latin}`;
    Object.assign(sealGloss.style, {
      fontSize: "9px",
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: withAlpha(accentHex, 0.8),
      fontFamily: "'Space Mono', 'Courier New', monospace",
      fontWeight: "600",
      textAlign: "center",
    } as Partial<CSSStyleDeclaration>);
    sealBlock.append(sealLine, sealGloss);

    const buckets = document.createElement("div");
    buckets.textContent = (card.buckets ?? []).join(" · ").toUpperCase() || card.category.toUpperCase();
    Object.assign(buckets.style, BUCKETS_STYLE);
    buckets.style.textAlign = "center";

    // WHAT IT DOES — primary scannable truth (gameplay first)
    const doesLabel = document.createElement("div");
    doesLabel.textContent = "EFFECT";
    Object.assign(doesLabel.style, {
      fontSize: "9px",
      letterSpacing: "0.18em",
      color: withAlpha(glow, 0.7),
      fontFamily: "'Space Mono', monospace",
      fontWeight: "700",
      marginTop: "6px",
      alignSelf: "flex-start",
      position: "relative",
      zIndex: "2",
    } as Partial<CSSStyleDeclaration>);

    const description = document.createElement("div");
    description.textContent = localizeDescriptionForInput(card.description);
    Object.assign(description.style, DESCRIPTION_STYLE);

    // LORE — secondary, quieter (a little story under the facts)
    const loreLabel = document.createElement("div");
    loreLabel.textContent = card.flavorText ? "LORE" : "";
    Object.assign(loreLabel.style, {
      fontSize: "9px",
      letterSpacing: "0.18em",
      color: withAlpha("#c4b5fd", 0.55),
      fontFamily: "'Space Mono', monospace",
      fontWeight: "700",
      marginTop: "8px",
      alignSelf: "flex-start",
      position: "relative",
      zIndex: "2",
    } as Partial<CSSStyleDeclaration>);

    const flavor = document.createElement("div");
    flavor.textContent = card.flavorText ? `“${card.flavorText}”` : "";
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

    // Reading order: rarity → glyph (what it looks like) → name → seal →
    // EFFECT copy → stats → LORE (quiet).
    el.append(
      rarity,
      orbWrap,
      name,
      nameRule,
      sealBlock,
      buckets,
      doesLabel,
      description,
      ...benefitEls,
      ...penaltyEls,
    );
    if (card.flavorText) {
      el.append(loreLabel, flavor);
    }

    // Add 4 L-shaped corner bracket divs (cyan, ROUNDS-style)
    appendBracketCorners(el, glow);

    el.addEventListener("mouseenter", () => {
      el.style.transform = "translateY(-4px)";
      el.style.boxShadow = "var(--jj-card-glow-hot)";
      el.style.borderColor = withAlpha(glow, 0.28);
    });
    el.addEventListener("mouseleave", () => {
      el.style.transform = "translateY(0)";
      el.style.boxShadow = "var(--jj-card-glow)";
      el.style.borderColor = withAlpha(glow, 0.14);
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
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
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
  // Lamp-orb warm fill radiates from bottom-left (mirrors the Phaser DraftScene
  // lamp orb prop). The radial gradient is layered under the slate gradient so
  // it reads as an ambient warm glow rather than a flat tint.
  background: [
    "radial-gradient(ellipse 420px 320px at 6% 96%, rgba(255, 210, 100, 0.10) 0%, transparent 70%)",
    "linear-gradient(160deg, rgba(16, 20, 32, 0.94), rgba(10, 13, 22, 0.97))",
  ].join(", "),
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
  fontWeight: "700",
  letterSpacing: "0.22em",
  color: "#c9a84c",
  textTransform: "uppercase",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "26px",
  fontWeight: "900",
  letterSpacing: "0.12em",
  color: "#f7fbff",
  textTransform: "uppercase",
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
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
  width: "286px",
  minHeight: "400px",
  padding: "22px 20px",
  background: "#0A1418",
  border: "none",
  color: "#f7fbff",
  cursor: "pointer",
  // Plain hover lift (mouseenter/leave below) — a 4px lift doesn't need
  // spring overshoot; that curve is reserved for the winner's actual
  // reveal beat (see the sequenced-reveal block further down), so the
  // "presented to you" moment stays distinct from ordinary hover chrome.
  transition: "transform 200ms cubic-bezier(0.16,1,0.3,1), box-shadow 200ms ease, filter 200ms ease",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  willChange: "transform, box-shadow",
};

const RARITY_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

const NAME_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "22px",
  fontWeight: "800",
  lineHeight: "1.1",
  letterSpacing: "0.01em",
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
  color: "#e8eef4",
  textShadow: "none",
  position: "relative",
  zIndex: "2",
};

const BUCKETS_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: "0.14em",
  color: "#7a8aa3",
  textTransform: "uppercase",
};

const DESCRIPTION_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "13.5px",
  lineHeight: "1.45",
  color: "#dce8f0",
  flex: "1",
  fontWeight: "500",
  // Read first — light lift, not neon wash
  textShadow: "0 1px 0 rgba(0,0,0,0.45)",
  position: "relative",
  zIndex: "2",
  width: "100%",
};

const FLAVOR_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11.5px",
  fontStyle: "italic",
  color: "#b8a8d8",
  opacity: "0.88",
  marginTop: "2px",
  lineHeight: "1.4",
  textShadow: "none",
  position: "relative",
  zIndex: "2",
  width: "100%",
};

const STAT_BENEFIT_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "12px",
  fontWeight: "700",
  color: "#7DE05A",
  lineHeight: "1.4",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

const STAT_PENALTY_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "12px",
  fontWeight: "700",
  color: "#E55A4A",
  lineHeight: "1.4",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

// Bracket corner dimensions
const LEG = 18; // px per leg

/**
 * Appends 4 absolute-positioned L-shaped divs — ROUNDS-style corners,
 * tinted to the card's identity glow when provided.
 */
function appendBracketCorners(el: HTMLDivElement, color = "#5DCFD9"): void {
  // Quiet corner marks — no glow filter.
  const c = withAlpha(color, 0.45);
  const corners: Array<{
    top?: string; bottom?: string; left?: string; right?: string;
    borderTop?: string; borderBottom?: string; borderLeft?: string; borderRight?: string;
  }> = [
    { top: "0", left: "0", borderTop: `2px solid ${c}`, borderLeft: `2px solid ${c}` },
    { top: "0", right: "0", borderTop: `2px solid ${c}`, borderRight: `2px solid ${c}` },
    { bottom: "0", left: "0", borderBottom: `2px solid ${c}`, borderLeft: `2px solid ${c}` },
    { bottom: "0", right: "0", borderBottom: `2px solid ${c}`, borderRight: `2px solid ${c}` },
  ];
  for (const corner of corners) {
    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.width = `${LEG}px`;
    div.style.height = `${LEG}px`;
    div.style.pointerEvents = "none";
    div.style.zIndex = "3";
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
