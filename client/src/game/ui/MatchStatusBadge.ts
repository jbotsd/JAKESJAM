// MatchStatusBadge — DOM widget showing live status of a match (or the
// io world) with a "Join" CTA + "Copy link" share button.
//
// Used in two places:
//   - Splash screen: bound to the io world. URL = `${origin}?world=1`.
//     Polls /world/summary every POLL_MS to keep the player count + round
//     timer + "joinable" flag fresh. Click "Join" → joinWorld().
//   - Lobby panel for an active room: bound to a specific matchId.
//     Polls /match/summary?matchId=X. Same render, different data source.
//
// Design notes:
//   - Polling beats WebSocket-of-status — joining a room takes a WS,
//     and we don't want a second one open just to render "round 2 of 5".
//     Poll interval is generous (3 s) since this is a passive HUD.
//   - When the badge is hidden (e.g. user navigated away from splash)
//     polling stops to avoid a leak.

export type MatchSummary = {
  matchId: string;
  mapId: string;
  phase: "countdown" | "fighting" | "round-over" | "drafting";
  roundIndex: number;
  countdownRemainingMs: number;
  players: number;
  targetScore: number;
  joinable: boolean;
  chaosModifierIds: string[];
};

export type MatchStatusBadgeOptions = {
  mount: HTMLElement;
  /** URL to copy when the user clicks "Copy link". Use `null` to hide the button. */
  shareUrl: string | null;
  /** Returns latest summary or `null` if the world hasn't booted yet / fetch failed. */
  fetchSummary: () => Promise<MatchSummary | null>;
  /** Action to take when the user clicks "Join". `null` hides the join button. */
  onJoin: (() => void) | null;
  /** Heading shown above the row. Default "Live Match". */
  title?: string;
  /** Poll interval (ms). Default 3000. */
  pollMs?: number;
};

const POLL_MS_DEFAULT = 3000;

export class MatchStatusBadge {
  private readonly root: HTMLDivElement;
  private readonly statusDot: HTMLSpanElement;
  private readonly summaryEl: HTMLSpanElement;
  private readonly joinBtn: HTMLButtonElement | null;
  private readonly shareBtn: HTMLButtonElement | null;
  private readonly fetchSummary: () => Promise<MatchSummary | null>;
  private readonly pollMs: number;
  private timer: number | null = null;
  private destroyed = false;

  constructor(opts: MatchStatusBadgeOptions) {
    this.fetchSummary = opts.fetchSummary;
    this.pollMs = opts.pollMs ?? POLL_MS_DEFAULT;

    this.root = document.createElement("div");
    Object.assign(this.root.style, ROOT_STYLE);

    const heading = document.createElement("div");
    heading.textContent = opts.title ?? "Live Match";
    Object.assign(heading.style, HEADING_STYLE);

    const row = document.createElement("div");
    Object.assign(row.style, ROW_STYLE);

    this.statusDot = document.createElement("span");
    Object.assign(this.statusDot.style, DOT_STYLE);

    this.summaryEl = document.createElement("span");
    Object.assign(this.summaryEl.style, SUMMARY_STYLE);
    this.summaryEl.textContent = "checking…";

    row.append(this.statusDot, this.summaryEl);

    const actions = document.createElement("div");
    Object.assign(actions.style, ACTIONS_STYLE);

    if (opts.onJoin) {
      this.joinBtn = document.createElement("button");
      this.joinBtn.type = "button";
      this.joinBtn.textContent = "Join";
      Object.assign(this.joinBtn.style, BTN_PRIMARY_STYLE);
      this.joinBtn.disabled = true;
      this.joinBtn.addEventListener("click", () => {
        if (this.joinBtn?.disabled) return;
        opts.onJoin?.();
      });
      actions.appendChild(this.joinBtn);
    } else {
      this.joinBtn = null;
    }

    if (opts.shareUrl !== null) {
      const url = opts.shareUrl;
      this.shareBtn = document.createElement("button");
      this.shareBtn.type = "button";
      this.shareBtn.textContent = "Copy link";
      Object.assign(this.shareBtn.style, BTN_SECONDARY_STYLE);
      this.shareBtn.addEventListener("click", () => {
        void this.copyShareLink(url);
      });
      actions.appendChild(this.shareBtn);
    } else {
      this.shareBtn = null;
    }

    this.root.append(heading, row, actions);
    opts.mount.appendChild(this.root);

    void this.poll();
    this.timer = window.setInterval(() => void this.poll(), this.pollMs);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.root.remove();
  }

  /**
   * Force an immediate refresh — call after the user takes an action
   * that should change state (e.g. they just joined, so the player
   * count should go up).
   */
  refresh(): void {
    void this.poll();
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.destroyed) return;
    let summary: MatchSummary | null = null;
    let fetchFailed = false;
    try {
      summary = await this.fetchSummary();
    } catch {
      fetchFailed = true;
      summary = null;
    }
    if (this.destroyed) return;
    this.render(summary, fetchFailed);
  }

  private render(s: MatchSummary | null, fetchFailed = false): void {
    if (!s) {
      if (fetchFailed) {
        // fetch() itself threw (network error / CORS / server is down).
        this.statusDot.style.background = "#fb7185";
        this.summaryEl.textContent = "server unreachable";
        if (this.joinBtn) this.joinBtn.disabled = true;
      } else {
        // Fetch succeeded with !ok or returned null — server is up but world hasn't booted.
        this.statusDot.style.background = "#7a8aa3";
        this.summaryEl.textContent = "hot lobby idle · be the first to spawn in";
        if (this.joinBtn) this.joinBtn.disabled = false; // empty lobby is joinable
      }
      return;
    }
    const phaseLabel = phaseToLabel(s.phase);
    const playersLabel = s.players === 1 ? "1 player" : `${s.players} players`;
    const seconds = Math.max(0, Math.ceil(s.countdownRemainingMs / 1000));
    const timerLabel =
      s.phase === "fighting"
        ? `${formatTime(seconds)} left`
        : s.phase === "countdown"
          ? `starts in ${seconds}s`
          : s.phase === "drafting"
            ? "drafting cards"
            : "next round soon"; // phaseLabel already says "Round over"
    this.summaryEl.textContent = `${phaseLabel} · ${playersLabel} · round ${s.roundIndex + 1} · ${timerLabel}`;
    this.statusDot.style.background = s.joinable ? "#86efac" : "#fde68a";
    if (this.joinBtn) this.joinBtn.disabled = !s.joinable;
  }

  private async copyShareLink(url: string): Promise<void> {
    if (!this.shareBtn) return;
    try {
      await navigator.clipboard.writeText(url);
      const original = this.shareBtn.textContent;
      this.shareBtn.textContent = "Copied!";
      window.setTimeout(() => {
        if (this.shareBtn) this.shareBtn.textContent = original ?? "Copy link";
      }, 1400);
    } catch {
      // Fallback: prompt the user with the URL so they can copy manually.
      window.prompt("Copy this link", url);
    }
  }
}

function phaseToLabel(phase: MatchSummary["phase"]): string {
  switch (phase) {
    case "countdown":
      return "● Starting";
    case "fighting":
      return "● Live";
    case "round-over":
      return "● Round over";
    case "drafting":
      return "● Drafting";
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Styles ──────────────────────────────────────────────────────────────

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "12px 14px",
  borderRadius: "12px",
  border: "1px solid rgba(143, 248, 255, 0.18)",
  background: "linear-gradient(160deg, rgba(16, 22, 34, 0.92), rgba(10, 14, 22, 0.96))",
  // HUD-readout content (status dots, live match numbers) — Space Mono is
  // this project's established face for exactly this role.
  fontFamily: "'Space Mono', 'Courier New', monospace",
  color: "#f7fbff",
  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.32)",
  minWidth: "260px",
};

const HEADING_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "900",
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "#8ff8ff",
};

const ROW_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "12px",
};

const DOT_STYLE: Partial<CSSStyleDeclaration> = {
  display: "inline-block",
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: "#7a8aa3",
  boxShadow: "0 0 8px rgba(143, 248, 255, 0.4)",
};

const SUMMARY_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  color: "#caffea",
  letterSpacing: "0.02em",
};

const ACTIONS_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  gap: "8px",
};

const BTN_PRIMARY_STYLE: Partial<CSSStyleDeclaration> = {
  flex: "1",
  padding: "8px 12px",
  border: "1px solid rgba(143, 248, 255, 0.45)",
  borderRadius: "8px",
  background: "linear-gradient(160deg, #1f3a5f, #0f1a2e)",
  color: "#f7fbff",
  fontWeight: "900",
  letterSpacing: "0.08em",
  fontSize: "11px",
  cursor: "pointer",
  textTransform: "uppercase",
  transition: "transform 120ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 120ms ease",
};

const BTN_SECONDARY_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "8px 10px",
  border: "1px solid rgba(143, 248, 255, 0.18)",
  borderRadius: "8px",
  background: "transparent",
  color: "#8ff8ff",
  fontWeight: "700",
  letterSpacing: "0.06em",
  fontSize: "10px",
  cursor: "pointer",
  textTransform: "uppercase",
};
