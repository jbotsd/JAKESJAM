// DeathOverlay — intentional "you died" state screen.
//
// Shown after the death explosion settles. Communicates clearly:
//   - You are dead (not a freeze / bug)
//   - Respawn timer counting down
//   - Context: waiting for the round to end (rogue-lite flow)
//
// DOM-based so it reads cleanly over any arena background.
// Lifecycle: show() / updateTimer() / hide() / destroy()

export type DeathOverlayShowOpts = {
  /** At most one contextual tip (from shell/deathTip). */
  tip?: string | null;
  /** Shareable highlight URL if a clip is known for this life. */
  shareUrl?: string | null;
};

export class DeathOverlay {
  private root: HTMLDivElement;
  private stage: HTMLDivElement;
  private timerEl: HTMLSpanElement;
  private tipEl: HTMLDivElement;
  private shareBtn: HTMLButtonElement;
  private destroyed = false;

  /**
   * `title`/`subtitle` default to the online-match copy ("ELIMINATED" /
   * "Respawning next round") — combat-coded language that assumes an
   * opponent and a round. Practice mode (no enemies, no round/match wrapper
   * — docs/practice-zone-goal.md item 3) passes its own copy so a solo fall
   * doesn't read as being killed by someone.
   */
  constructor(title = "ELIMINATED", subtitle = "Respawning next round") {
    this.root = document.createElement("div");
    this.root.dataset.deathOverlay = "true";
    Object.assign(this.root.style, ROOT_STYLE);

    this.stage = document.createElement("div");
    Object.assign(this.stage.style, STAGE_STYLE);

    const skull = document.createElement("div");
    skull.textContent = "✦";
    Object.assign(skull.style, SKULL_STYLE);

    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    Object.assign(titleEl.style, TITLE_STYLE);

    const sub = document.createElement("div");
    sub.textContent = subtitle;
    Object.assign(sub.style, SUB_STYLE);

    this.timerEl = document.createElement("span");
    this.timerEl.textContent = "3";
    Object.assign(this.timerEl.style, TIMER_STYLE);

    this.tipEl = document.createElement("div");
    Object.assign(this.tipEl.style, TIP_STYLE);
    this.tipEl.hidden = true;

    this.shareBtn = document.createElement("button");
    this.shareBtn.type = "button";
    this.shareBtn.textContent = "Share highlight";
    Object.assign(this.shareBtn.style, SHARE_BTN_STYLE);
    this.shareBtn.hidden = true;
    this.shareBtn.style.pointerEvents = "auto";

    this.stage.append(skull, titleEl, sub, this.timerEl, this.tipEl, this.shareBtn);
    this.root.appendChild(this.stage);

    document.body.appendChild(this.root);
    this.root.style.display = "none";
  }

  show(remainingSec: number, opts: DeathOverlayShowOpts = {}): void {
    if (this.destroyed) return;
    this.timerEl.textContent = remainingSec.toString();
    const tip = opts.tip?.trim() || "";
    this.tipEl.textContent = tip;
    this.tipEl.hidden = !tip;
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

  updateTimer(remainingSec: number): void {
    if (this.destroyed) return;
    this.timerEl.textContent = remainingSec.toString();
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
  background: "rgba(5, 8, 15, 0.62)",
  backdropFilter: "blur(3px)",
  pointerEvents: "none",
  transition: "opacity 300ms ease",
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "10px",
  padding: "28px 40px",
  borderRadius: "16px",
  border: "1px solid rgba(251, 113, 133, 0.38)",
  background:
    "linear-gradient(160deg, rgba(20, 12, 18, 0.88), rgba(10, 6, 12, 0.94))",
  boxShadow:
    "0 0 40px rgba(251, 113, 133, 0.14), inset 0 1px 0 rgba(251, 113, 133, 0.12)",
};

const SKULL_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "32px",
  color: "#fb7185",
  lineHeight: "1",
  textShadow: "0 0 16px rgba(251, 113, 133, 0.55)",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
  fontSize: "26px",
  fontWeight: "900",
  letterSpacing: "0.2em",
  color: "#fb7185",
  textShadow: "0 0 14px rgba(251, 113, 133, 0.45)",
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

const TIP_STYLE: Partial<CSSStyleDeclaration> = {
  // Matches its siblings SUB_STYLE/TIMER_STYLE above — this was the one
  // style in the file still defaulting to the generic Inter stack.
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
