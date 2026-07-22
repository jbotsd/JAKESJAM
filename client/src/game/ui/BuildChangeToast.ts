import type { CardDefinition } from "../../sim/data/cardTypes.js";
import type { CharacterArchetype } from "../../sim/types.js";
import { describeBuild } from "./buildDescription.js";

export type BuildChangeView = {
  card: CardDefinition;
  cardIds: readonly string[];
  characterId: CharacterArchetype;
  autoPicked: boolean;
};

/** Non-modal confirmation of the authoritative draft result. */
export class BuildChangeToast {
  private readonly root: HTMLDivElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.dataset.buildChange = "true";
    Object.assign(this.root.style, {
      position: "fixed",
      zIndex: "9050",
      left: "50%",
      // Pulled down to hug the action-bar HUD band (was clamp(92,15vh,150))
      // so this reads as part of the UI chrome cluster instead of a block
      // floating mid-screen over open play space (2026-07-20, playtest
      // feedback: "these info things always cover meaningful screen space").
      bottom: "clamp(64px, 10vh, 104px)",
      width: "min(440px, calc(100vw - 32px))",
      transform: "translate(-50%, 14px)",
      opacity: "0",
      pointerEvents: "none",
      boxSizing: "border-box",
      padding: "8px 12px",
      border: "1px solid rgba(80,227,194,0.72)",
      borderRadius: "8px",
      background: "rgba(7, 12, 18, 0.94)",
      boxShadow: "0 0 28px rgba(80,227,194,0.18)",
      color: "#f7fbff",
      fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
      transition: "opacity 180ms ease-out, transform 180ms ease-out",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.root);
  }

  show(view: BuildChangeView): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    const build = describeBuild(view.cardIds, view.characterId);
    this.root.replaceChildren(
      line(`BUILD CHANGED · ${view.autoPicked ? "TIMER CHOSE" : "YOU PICKED"} ${view.card.name.toUpperCase()}`, "#50e3c2", "9px", "0.14em"),
      line(view.card.description, "#d9e7ee", "12px", "0.01em"),
      line(`NOW · ${build.summary}`, "#fff7d6", "12px", "0.01em"),
    );
    this.root.style.opacity = "1";
    this.root.style.transform = "translate(-50%, 0)";
    // Shorter dwell (was 6500ms) — less time spent covering the play area
    // for a non-modal confirmation nobody needs to read for 6+ seconds.
    this.hideTimer = setTimeout(() => this.hide(), 4500);
  }

  hide(): void {
    this.root.style.opacity = "0";
    this.root.style.transform = "translate(-50%, 14px)";
  }

  destroy(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.root.remove();
  }
}

function line(text: string, color: string, fontSize: string, letterSpacing: string): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, { color, fontSize, letterSpacing, lineHeight: "1.2", margin: "1px 0" } as Partial<CSSStyleDeclaration>);
  return el;
}
