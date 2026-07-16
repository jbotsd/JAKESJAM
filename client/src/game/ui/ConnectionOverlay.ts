// ConnectionOverlay — shown when the WebSocket disconnects or while
// reconnect attempts are in flight. Hides on next snapshot received.
//
// DOM-based so it reads cleanly over any arena background.
// Lifecycle: show(state) / hide() / destroy()

type State =
  | { kind: "lost"; reason: string }
  | { kind: "reconnecting"; attempt: number; nextDelayMs: number }
  | { kind: "terminal"; reason: string };

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  inset: "0",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(5,8,15,0.78)",
  backdropFilter: "blur(6px)",
  zIndex: "9000",
  pointerEvents: "none",
  // Carries a real display headline (TITLE_STYLE, 32px/900) — Space Grotesk
  // is this project's established display face, not the generic default.
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
  // M1: settle in on open / withdraw (fade) on close.
  transition: "opacity 200ms ease-out",
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  // Void interior, hollow seam border — no gradient fill, no elevation
  // shadow (G2/G3), radius at the 12px DOM ceiling (G1).
  background: "rgba(6, 11, 20, 0.95)",
  border: "1px solid rgba(143,248,255,0.18)",
  borderRadius: "12px",
  padding: "32px 40px",
  textAlign: "center",
  color: "#e3f3ff",
  // S5: min() clamp so a narrow phone viewport isn't forced wider than
  // itself — same convention as MatchResultsOverlay.ts's STAGE_STYLE.
  minWidth: "min(320px, 92vw)",
  maxWidth: "min(440px, 92vw)",
};

const KICKER_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  fontWeight: "900",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#67e8f9",
  marginBottom: "10px",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "clamp(24px, 7vw, 32px)",
  fontWeight: "900",
  letterSpacing: "0.04em",
  marginBottom: "12px",
};

const SUB_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "14px",
  color: "#94a3b8",
};

export class ConnectionOverlay {
  private root: HTMLDivElement;
  private kickerEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private destroyed = false;

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.connectionOverlay = "true";
    Object.assign(this.root.style, ROOT_STYLE);

    const stage = document.createElement("div");
    Object.assign(stage.style, STAGE_STYLE);

    this.kickerEl = document.createElement("div");
    Object.assign(this.kickerEl.style, KICKER_STYLE);

    this.titleEl = document.createElement("div");
    Object.assign(this.titleEl.style, TITLE_STYLE);

    this.subEl = document.createElement("div");
    Object.assign(this.subEl.style, SUB_STYLE);

    stage.append(this.kickerEl, this.titleEl, this.subEl);
    this.root.appendChild(stage);

    document.body.appendChild(this.root);
    this.root.style.display = "none";
  }

  show(state: State): void {
    if (this.destroyed) return;
    switch (state.kind) {
      case "lost":
        // No retry promise in this copy — whether a reconnect is actually
        // coming is the supervisor's call, and it announces itself through
        // the "reconnecting" state. This state just reports the fact.
        this.kickerEl.textContent = "Connection";
        this.titleEl.textContent = "Connection lost";
        this.subEl.textContent = `Reason: ${state.reason}`;
        break;
      case "reconnecting":
        this.kickerEl.textContent = "Reconnecting";
        this.titleEl.textContent = `Attempt ${state.attempt}`;
        this.subEl.textContent = `Retrying in ${Math.ceil(state.nextDelayMs / 1000)}s…`;
        break;
      case "terminal":
        this.kickerEl.textContent = "Disconnected";
        this.titleEl.textContent = "Connection ended";
        this.subEl.textContent = state.reason;
        break;
    }
    if (this.root.style.display !== "flex") {
      // M1: settle in — opacity fade only, no slide/scale/overshoot.
      this.root.style.display = "flex";
      this.root.style.opacity = "0";
      requestAnimationFrame(() => {
        this.root.style.opacity = "1";
      });
    } else {
      this.root.style.opacity = "1";
    }
  }

  hide(): void {
    if (this.destroyed) return;
    if (this.root.style.display === "none") return;
    // M1: withdraw — fade out before actually detaching from layout.
    this.root.style.opacity = "0";
    window.setTimeout(() => {
      if (this.destroyed) return;
      this.root.style.display = "none";
    }, 200);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.remove();
  }
}
