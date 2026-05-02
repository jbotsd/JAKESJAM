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
  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
};

const STAGE_STYLE: Partial<CSSStyleDeclaration> = {
  background: "linear-gradient(160deg, rgba(10,16,28,0.95), rgba(5,10,18,0.95))",
  border: "1px solid rgba(143,248,255,0.18)",
  borderRadius: "18px",
  padding: "32px 40px",
  textAlign: "center",
  color: "#e3f3ff",
  boxShadow: "0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(143,248,255,0.07)",
  minWidth: "320px",
};

const KICKER_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#67e8f9",
  marginBottom: "10px",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "32px",
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
        this.kickerEl.textContent = "Connection";
        this.titleEl.textContent = "Connection lost";
        this.subEl.textContent = `Reason: ${state.reason}. Trying to reconnect…`;
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
    this.root.style.display = "flex";
  }

  hide(): void {
    if (this.destroyed) return;
    this.root.style.display = "none";
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.remove();
  }
}
