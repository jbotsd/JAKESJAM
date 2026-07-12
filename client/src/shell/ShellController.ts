// DOM shell controller: applies placeMachine state to splash/lobby/layers.
// Match scenes never import this — only CustomEvents.

import {
  createShellState,
  shellCloseLayer,
  shellGoto,
  shellSetMatchMode,
  shellTogglePause,
  shellVisibility,
} from "./placeMachine.js";
import type { MatchMode, PlaceId, ShellState } from "./types.js";
import { ShellEvents, type ClipUploadedDetail } from "./types.js";
import { globalClipSession } from "./clipSession.js";
import { isClipsEnabled } from "../game/highlights/clipConsent.js";

// Re-export event helpers for main.ts only — scenes must import shell/events.ts.
export { emitShellGoto, emitMatchStarted, emitClipUploaded } from "./events.js";

export type ShellDom = {
  home: HTMLElement;
  room: HTMLElement;
  settings: HTMLElement;
  clips: HTMLElement;
  pause: HTMLElement;
  credits: HTMLElement;
  clipsList: HTMLElement;
};

export type ShellControllerOptions = {
  dom: ShellDom;
  onEnterWorld?: () => void;
  onEnterPractice?: () => void;
  onEnterRoom?: (mode: "host" | "join") => void;
  onLeaveMatch?: () => void;
  onMatchMusicMenu?: () => void;
};

export class ShellController {
  private state: ShellState = createShellState();
  private readonly dom: ShellDom;
  private unsubs: Array<() => void> = [];

  constructor(opts: ShellControllerOptions) {
    this.dom = opts.dom;
    // Callbacks reserved for future direct wiring; events handle handoff today.
    void opts;
    this.bindEvents();
    this.apply();
  }

  getState(): Readonly<ShellState> {
    return this.state;
  }

  goto(place: PlaceId): void {
    this.state = shellGoto(this.state, place);
    this.apply();
  }

  closeLayer(): void {
    this.state = shellCloseLayer(this.state);
    this.apply();
  }

  setMatchMode(mode: MatchMode): void {
    this.state = shellSetMatchMode(this.state, mode);
    this.apply();
  }

  togglePause(): void {
    this.state = shellTogglePause(this.state);
    this.apply();
  }

  refreshClipsList(): void {
    this.renderClips();
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  private bindEvents(): void {
    const on = (type: string, fn: EventListener) => {
      window.addEventListener(type, fn);
      this.unsubs.push(() => window.removeEventListener(type, fn));
    };

    on(ShellEvents.GOTO, ((e: CustomEvent<{ place: PlaceId }>) => {
      if (e.detail?.place) this.goto(e.detail.place);
    }) as EventListener);

    on(ShellEvents.MATCH_STARTED, ((e: CustomEvent<{ mode: MatchMode }>) => {
      const mode = e.detail?.mode ?? "world";
      this.setMatchMode(mode);
    }) as EventListener);

    on(ShellEvents.MATCH_ENDED, (() => {
      this.setMatchMode("none");
    }) as EventListener);

    on(ShellEvents.PAUSE_TOGGLE, (() => {
      this.togglePause();
    }) as EventListener);

    on(ShellEvents.CLIP_UPLOADED, ((e: CustomEvent<ClipUploadedDetail>) => {
      const d = e.detail;
      if (!d?.url || !d.kind) return;
      globalClipSession.add({
        url: d.url,
        kind: d.kind,
        pairId: d.pairId,
        label: d.label,
      });
      this.renderClips();
    }) as EventListener);

    on(ShellEvents.BACK_TO_SPLASH, (() => {
      this.goto("home");
    }) as EventListener);

    on(ShellEvents.RETURN_TO_LOBBY, (() => {
      // Match teardown is handled by main; shell returns to home (or room).
      this.setMatchMode("none");
      this.goto("home");
    }) as EventListener);

    // Esc toggles pause while match active; closes layer otherwise.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (this.state.matchMode !== "none") {
        // Draft/overlays may also listen — only toggle if not typing.
        const t = ev.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
          return;
        }
        this.togglePause();
        ev.preventDefault();
        return;
      }
      if (this.state.layer) {
        this.closeLayer();
        ev.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    this.unsubs.push(() => window.removeEventListener("keydown", onKey));
  }

  private apply(): void {
    const v = shellVisibility(this.state);
    this.dom.home.hidden = !v.home;
    // Lobby uses class for historical CSS
    this.dom.room.classList.toggle("lobby-panel--hidden", !v.room);
    this.dom.settings.hidden = !v.settings;
    this.dom.clips.hidden = !v.clips;
    this.dom.pause.hidden = !v.pause;
    this.dom.credits.hidden = !v.credits;
    if (v.clips) this.renderClips();
  }

  private renderClips(): void {
    const root = this.dom.clipsList;
    root.replaceChildren();
    const pairs = globalClipSession.pairs();
    if (pairs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "shell-empty";
      empty.textContent = isClipsEnabled()
        ? "No clips this session yet. Tap Save clip now (in Hot Lobby), or land a multi-kill / parry-kill / chain."
        : "Clips are off. Tap Save clip now (turns on + captures) or enable Auto-clip in Settings.";
      root.appendChild(empty);
      this.appendRecentClips(root);
      return;
    }
    for (const row of pairs) {
      const item = document.createElement("div");
      item.className = "shell-clip-row";
      const title = document.createElement("div");
      title.className = "shell-clip-title";
      title.textContent = row.label ?? "Highlight";
      const actions = document.createElement("div");
      actions.className = "shell-clip-actions";
      const shareUrl = row.original?.url ?? row.vertical?.url;
      if (shareUrl) {
        actions.append(
          makeAction("Watch", () => window.open(shareUrl, "_blank", "noopener")),
          makeAction("Copy", () => void navigator.clipboard?.writeText(shareUrl)),
        );
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          actions.append(
            makeAction("Share", () =>
              void navigator.share({
                title: "JAKESJAM highlight",
                text: "Check out this play from JAKESJAM!",
                url: shareUrl,
              }),
            ),
          );
        }
      }
      if (row.original?.url) {
        actions.append(
          makeAction("Original", () => window.open(row.original!.url, "_blank", "noopener")),
        );
      }
      item.append(title, actions);
      root.appendChild(item);
    }
    this.appendRecentClips(root);
  }

  /**
   * Match highlights rendered by the HOST (clipRenderQueue) + everyone's
   * recent uploads — the server-side half of the gallery. This is how a
   * phone player finds their full-quality clip: their device never
   * rendered or encoded it (pillar 4's end state).
   */
  private appendRecentClips(root: HTMLElement): void {
    void fetch("/clips/recent")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { clips?: Array<{ id: string; url: string; mtimeMs: number }> } | null) => {
        const clips = data?.clips ?? [];
        if (clips.length === 0) return;
        const heading = document.createElement("h3");
        heading.className = "shell-clips-recent-heading";
        heading.textContent = "Match highlights (rendered by the arena)";
        root.appendChild(heading);
        for (const c of clips.slice(0, 12)) {
          const item = document.createElement("div");
          item.className = "shell-clip-row";
          const title = document.createElement("div");
          title.className = "shell-clip-title";
          const age = Math.max(0, Date.now() - c.mtimeMs);
          const mins = Math.round(age / 60_000);
          title.textContent = mins < 1 ? "Just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
          const actions = document.createElement("div");
          actions.className = "shell-clip-actions";
          actions.append(
            makeAction("Watch", () => window.open(c.url, "_blank", "noopener")),
            makeAction("Copy", () =>
              void navigator.clipboard?.writeText(new URL(c.url, window.location.origin).toString()),
            ),
          );
          item.append(title, actions);
          root.appendChild(item);
        }
      })
      .catch(() => {
        // Offline / server old — session clips alone are fine.
      });
  }
}

function makeAction(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = "shell-btn-secondary";
  b.addEventListener("click", onClick);
  return b;
}
