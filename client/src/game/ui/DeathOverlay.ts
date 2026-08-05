// DeathOverlay — intentional "you died" state screen.
//
// Shown after the death explosion settles. Communicates clearly:
//   - You are dead (not a freeze / bug)
//   - Respawn timer counting down
//   - Context: waiting for the round to end (rogue-lite flow)
//   - The score right now — this is the ONLY screen up during that wait
//     (RoundBanner explicitly hides itself during "fighting" phase, and
//     this overlay's own full-viewport blur darkens the peripheral
//     nameplate column behind it), so "what else is going on" has to live
//     HERE or it's genuinely not visible to a dead player (Jake, 2026-07-14
//     UI pass: "does it need to [show] what else is going on when it
//     happens" — audit found it didn't, added the score line below).
//
// Redesigned 2026-07-14 to match docs/visual-language-gnostic-vessel.md's
// own "Death / results" section, which this screen predated: "Full void
// wash (aperture). Single centered seal mark. No 'YOU DIED' soulless-souls
// clone; keep ELIMINATED." The previous version was a bordered gradient
// card with a 16px border-radius and a drop-shadow — exactly the "thick
// card, Material elevation shadow" anti-pattern the doctrine calls out, and
// past the doctrine's own 8-12px corner-radius ceiling. This version is a
// void wash with content floating directly in it — no card, no plate — and
// the "✦" text glyph replaced with a CSS ring that echoes the same
// "extinguished vessel" ring drawFacetedRing draws elsewhere (badge disc +
// dim dashed ring), so the seal reads as YOUR vessel, not a generic icon.
//
// DOM-based so it reads cleanly over any arena background.
// Lifecycle: show() / updateTimer() / hide() / destroy()

export type DeathOverlayShowOpts = {
  /** At most one contextual tip (from shell/deathTip). */
  tip?: string | null;
  /** Shareable highlight URL if a clip is known for this life. */
  shareUrl?: string | null;
  /** Pre-formatted "YOU 1  ·  BOT · PISTON 2  ·  BOT · SPARK 0" line — same
   *  format/order as RoundBanner's score line, so the two screens read as
   *  one system. Omit to hide the row entirely (e.g. solo practice). */
  scoreLine?: string | null;
  /** One-shot copy override for THIS show() only (Doors 1.4: the
   *  pending-entrant NEXT BELL framing reuses this surface). Absent fields
   *  fall back to the constructor copy on every show(), so a pending show
   *  can never leak its copy into a later real death. */
  title?: string;
  subtitle?: string;
  /** "pending" drops the death-coded treatment — extinguished-vessel seal
   *  hidden, title in the score-line cyan instead of kill-rose — because
   *  this player hasn't died (or even fought yet). Default "death". */
  variant?: "death" | "pending";
};

/** What the big number means right now — label + whether it's an upper-bound
 *  estimate (rendered with a "~"). See phaseCountdown.ts for the semantics;
 *  omitting a label keeps the bare-number rendering (practice/tutorial). */
export type DeathTimer = {
  seconds: number;
  label?: string;
  approx?: boolean;
};

export class DeathOverlay {
  private root: HTMLDivElement;
  private stage: HTMLDivElement;
  private sealEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private timerEl: HTMLSpanElement;
  private timerLabelEl: HTMLDivElement;
  private tipEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private shareBtn: HTMLButtonElement;
  private readonly defaultTitle: string;
  private readonly defaultSubtitle: string;
  private destroyed = false;

  /**
   * `title`/`subtitle` default to the online-match copy ("ELIMINATED" /
   * "Back in at the next bell") — combat-coded language that assumes an
   * opponent and a round; "the bell" is the venue vocabulary for the round
   * boundary where fighters re-enter (docs/venue-design.md §3). Practice
   * mode (no enemies, no round/match wrapper — docs/practice-zone-goal.md
   * item 3) passes its own copy so a solo fall doesn't read as being
   * killed by someone.
   */
  // Subtitle stays TRUE in both death modes (fast-respawn ruling,
  // 2026-07-17): ordinary rounds re-form you in seconds (timer label
  // RESPAWNING), sudden death benches you to the bell (NEXT BELL). The
  // rule-specific part is carried by the timer label, not this line —
  // a subtitle asserting one rule read as an arbitrary punishment under
  // the other (Jake, mid-playtest: "why does that happen its not even
  // clear").
  constructor(title = "ELIMINATED", subtitle = "Watch the arena — you're going back in") {
    this.defaultTitle = title;
    this.defaultSubtitle = subtitle;
    this.root = document.createElement("div");
    this.root.dataset.deathOverlay = "true";
    Object.assign(this.root.style, ROOT_STYLE);

    this.stage = document.createElement("div");
    Object.assign(this.stage.style, STAGE_STYLE);

    // Extinguished-vessel seal — echoes the badge+ring recipe used
    // everywhere else in the HUD (portraitBadge.ts / facetedRing.ts)
    // instead of a generic "✦" glyph unrelated to that system.
    const seal = document.createElement("div");
    Object.assign(seal.style, SEAL_STYLE);
    const sealCore = document.createElement("div");
    Object.assign(sealCore.style, SEAL_CORE_STYLE);
    seal.appendChild(sealCore);
    this.sealEl = seal;

    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    Object.assign(titleEl.style, TITLE_STYLE);
    this.titleEl = titleEl;

    const sub = document.createElement("div");
    sub.textContent = subtitle;
    Object.assign(sub.style, SUB_STYLE);
    this.subEl = sub;

    this.timerLabelEl = document.createElement("div");
    Object.assign(this.timerLabelEl.style, TIMER_LABEL_STYLE);
    this.timerLabelEl.hidden = true;

    this.timerEl = document.createElement("span");
    this.timerEl.textContent = "3";
    Object.assign(this.timerEl.style, TIMER_STYLE);

    this.scoreEl = document.createElement("div");
    Object.assign(this.scoreEl.style, SCORE_STYLE);
    this.scoreEl.hidden = true;

    this.tipEl = document.createElement("div");
    Object.assign(this.tipEl.style, TIP_STYLE);
    this.tipEl.hidden = true;

    this.shareBtn = document.createElement("button");
    this.shareBtn.type = "button";
    this.shareBtn.textContent = "Share highlight";
    Object.assign(this.shareBtn.style, SHARE_BTN_STYLE);
    this.shareBtn.hidden = true;
    this.shareBtn.style.pointerEvents = "auto";

    this.stage.append(seal, titleEl, sub, this.timerLabelEl, this.timerEl, this.scoreEl, this.tipEl, this.shareBtn);
    this.root.appendChild(this.stage);

    document.body.appendChild(this.root);
    this.root.style.display = "none";
  }

  show(timer: number | DeathTimer, opts: DeathOverlayShowOpts = {}): void {
    if (this.destroyed) return;
    // Copy + variant treatment re-resolved on EVERY show — an override is
    // one-shot by construction (Doors 1.4: the pending-entrant show must
    // never bleed into the next real death, and vice versa).
    this.titleEl.textContent = opts.title ?? this.defaultTitle;
    this.subEl.textContent = opts.subtitle ?? this.defaultSubtitle;
    const pending = opts.variant === "pending";
    // Nothing died: no extinguished-vessel seal, and the title borrows the
    // score line's cyan (SCORE_STYLE) instead of the kill-rose.
    this.sealEl.style.display = pending ? "none" : "flex";
    this.titleEl.style.color = pending ? PENDING_TITLE_COLOR : TITLE_COLOR;
    this.titleEl.style.textShadow = pending ? PENDING_TITLE_GLOW : TITLE_GLOW;
    this.applyTimer(timer);
    const tip = opts.tip?.trim() || "";
    this.tipEl.textContent = tip;
    this.tipEl.hidden = !tip;
    const scoreLine = opts.scoreLine?.trim() || "";
    this.scoreEl.textContent = scoreLine;
    this.scoreEl.hidden = !scoreLine;
    const shareUrl = opts.shareUrl?.trim() || "";
    if (shareUrl) {
      this.shareBtn.hidden = false;
      this.shareBtn.onclick = () => {
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
              this.shareBtn.textContent = "Copied!";
              setTimeout(() => {
                this.shareBtn.textContent = "Share highlight";
              }, 1200);
            }
          } catch {
            /* user cancel */
          }
        })();
      };
    } else {
      this.shareBtn.hidden = true;
      this.shareBtn.onclick = null;
    }
    this.root.style.display = "flex";
    // Fade in
    this.root.style.opacity = "0";
    requestAnimationFrame(() => {
      this.root.style.opacity = "1";
    });
  }

  updateTimer(timer: number | DeathTimer): void {
    if (this.destroyed) return;
    this.applyTimer(timer);
  }

  /** Bare number (legacy practice/tutorial callers) or the labeled,
   *  honesty-aware shape from phaseCountdown.ts — "~" marks upper-bound
   *  estimates so the number never asserts precision it doesn't have. */
  private applyTimer(timer: number | DeathTimer): void {
    const t: DeathTimer = typeof timer === "number" ? { seconds: timer } : timer;
    this.timerEl.textContent = `${t.approx ? "~" : ""}${t.seconds}`;
    const label = t.label?.trim() || "";
    if (this.timerLabelEl.textContent !== label) this.timerLabelEl.textContent = label;
    this.timerLabelEl.hidden = !label;
  }

  /** Score can change (another player scores) while this stays open for the
   *  whole "fighting" phase — refreshed every frame from OnlineMatchScene
   *  alongside updateTimer(), not just at show() time. */
  updateScoreLine(scoreLine: string | null | undefined): void {
    if (this.destroyed) return;
    const line = scoreLine?.trim() || "";
    if (this.scoreEl.textContent !== line) this.scoreEl.textContent = line;
    this.scoreEl.hidden = !line;
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
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  inset: "0",
  zIndex: "8500",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  // Void wash (doctrine: "Full void wash (aperture)") — no card behind the
  // content, this IS the whole background treatment.
  background: "rgba(5, 8, 15, 0.72)",
  backdropFilter: "blur(4px)",
  pointerEvents: "none",
  transition: "opacity 300ms ease",
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "10px",
  // No border, no fill, no radius, no shadow — content floats directly in
  // the void wash instead of a second "card" layer on top of it (was the
  // exact anti-pattern docs/visual-language-gnostic-vessel.md calls out:
  // "thick white cards, Material elevation shadows as primary depth").
};

const SEAL_STYLE: Partial<CSSStyleDeclaration> = {
  width: "56px",
  height: "56px",
  borderRadius: "50%",
  border: "2px dashed rgba(251, 113, 133, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 0 18px rgba(251, 113, 133, 0.18)",
};

const SEAL_CORE_STYLE: Partial<CSSStyleDeclaration> = {
  width: "10px",
  height: "10px",
  borderRadius: "50%",
  background: "#fb7185",
  boxShadow: "0 0 10px rgba(251, 113, 133, 0.7)",
};

const TITLE_COLOR = "#fb7185";
const TITLE_GLOW = "0 0 14px rgba(251, 113, 133, 0.45)";
/** Pending-entrant variant: score-line cyan (SCORE_STYLE below) — venue
 *  information voice, not the kill-rose death voice. */
const PENDING_TITLE_COLOR = "#8ff8ff";
const PENDING_TITLE_GLOW = "0 0 14px rgba(143, 248, 255, 0.30)";

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
  fontSize: "26px",
  fontWeight: "900",
  letterSpacing: "0.2em",
  color: TITLE_COLOR,
  textShadow: TITLE_GLOW,
};

const SUB_STYLE: Partial<CSSStyleDeclaration> = {
  fontFamily: "'Space Mono', 'Courier New', monospace",
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  color: "#9aa5b1",
  textTransform: "uppercase",
};

const TIMER_STYLE: Partial<CSSStyleDeclaration> = {
  fontFamily: "'Space Mono', 'Courier New', monospace",
  fontSize: "48px",
  fontWeight: "900",
  color: "#fff7d6",
  lineHeight: "1.1",
  textShadow: "0 0 18px rgba(255, 247, 214, 0.35)",
  marginTop: "4px",
};
/** Caption over the big number ("NEXT BELL") — same quiet-mono voice as the
 *  subtitle so the number + caption read as one instrument. */
const TIMER_LABEL_STYLE: Partial<CSSStyleDeclaration> = {
  fontFamily: "'Space Mono', 'Courier New', monospace",
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: "0.14em",
  color: "#7a8299",
  textTransform: "uppercase",
  marginTop: "10px",
};

const SCORE_STYLE: Partial<CSSStyleDeclaration> = {
  // Same face/color/tracking as RoundBanner's score line (RoundBanner.ts)
  // so the two screens read as one system, not two different fonts for the
  // same fact.
  fontFamily: "'Space Mono', 'Courier New', monospace",
  fontSize: "13px",
  fontWeight: "700",
  letterSpacing: "0.04em",
  color: "#8ff8ff",
  marginTop: "2px",
};

const TIP_STYLE: Partial<CSSStyleDeclaration> = {
  fontFamily: "'Space Mono', 'Courier New', monospace",
  fontSize: "12px",
  fontWeight: "600",
  color: "#9ba7b8",
  maxWidth: "280px",
  textAlign: "center",
  lineHeight: "1.4",
  marginTop: "8px",
};

const SHARE_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  marginTop: "10px",
  padding: "8px 14px",
  borderRadius: "8px",
  border: "1px solid rgba(201, 168, 76, 0.45)",
  background: "transparent",
  color: "#c9a84c",
  fontWeight: "800",
  fontSize: "11px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  cursor: "pointer",
};
