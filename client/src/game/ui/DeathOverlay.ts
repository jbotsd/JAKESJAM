// DeathOverlay — intentional "you died" state screen.
//
// Shown after the death explosion settles. Communicates clearly:
//   - You are dead (not a freeze / bug)
//   - Respawn timer counting down
//   - Context: waiting for the round to end (rogue-lite flow)
//
// DOM-based so it reads cleanly over any arena background.
// Lifecycle: show() / updateTimer() / hide() / destroy()

export class DeathOverlay {
  private root: HTMLDivElement;
  private timerEl: HTMLSpanElement;
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

    const stage = document.createElement("div");
    Object.assign(stage.style, STAGE_STYLE);

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

    stage.append(skull, titleEl, sub, this.timerEl);
    this.root.appendChild(stage);

    document.body.appendChild(this.root);
    this.root.style.display = "none";
  }

  show(remainingSec: number): void {
    if (this.destroyed) return;
    this.timerEl.textContent = remainingSec.toString();
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
