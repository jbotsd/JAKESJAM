// Vessel Creator — the cosmetic channel picker (docs/vessel-creator-design.md
// §4). Built the same way CardDraftOverlay.ts is: a DOM root appended to
// document.body, shown/hidden via style.display, independent of Phaser and
// of the ShellController/placeMachine DOM-shell state machine (this panel is
// reachable only from MainMenuScene, not from the HOME/SETTINGS/CLIPS places).
//
// Docks from the right edge rather than a full-bleed center modal (a real
// "void dock," per docs/visual-language-gnostic-vessel.md's own vocabulary)
// so MainMenuScene's idle preview rig stays visible, dimmed, behind it —
// that rig IS the live "current loadout" preview (including its nameplate
// portrait badge), so this overlay never needs to build a second one.

import type { VesselCosmetics } from "../../sim/types.js";

export type VesselCreatorHandlers = {
  /** Fired on every swatch click — caller updates the live preview rig. */
  onPreview: (cosmetics: VesselCosmetics) => void;
  /** Fired once on Save; caller persists the pick. */
  onSave: (cosmetics: VesselCosmetics) => void;
  /** Fired on cancel/close (✕, Escape, or backdrop click); caller should
   *  revert the preview to whatever was showing before this session opened
   *  (the value passed to show()). */
  onCancel: (revertTo: VesselCosmetics) => void;
};

type ChannelKey = keyof VesselCosmetics;

const CHANNELS: ReadonlyArray<{ key: ChannelKey; label: string; hint: string }> = [
  { key: "accentColor", label: "Hull tone", hint: "primary crystal accent" },
  { key: "visorColor", label: "Visor glow", hint: "the aperture, not a face" },
  { key: "palmColor", label: "Palm channel", hint: "seen on every shot fired" },
  { key: "jointColor", label: "Joint seal", hint: "shoulder crystal stubs" },
  { key: "auraColor", label: "Aura motes", hint: "the field around the vessel" },
];

// Same curated spirit as LobbyController's COLOR_PALETTE (a handful of
// considered hues, not a raw <input type=color> spectrum picker — reads as
// a designed system, per the design doc §4) — reused across all 5 rows
// rather than authoring 5 separate palettes for a foundation pass.
const SWATCHES: readonly string[] = [
  "#8ff8ff", // crystal cyan — the shipped default
  "#c9a84c", // Autogenes gold (house)
  "#50e3c2", // teal
  "#a78bfa", // violet (future void tier)
  "#fb7185", // rose
  "#fde68a", // amber
  "#86efac", // jade
  "#fdba74", // coral
];

const GOLD = "#c9a84c";
const GOLD_DIM = "#8a7033";
const TEXT_DIM = "#7a8299";
const WHITE = "#e8ecf4";

export class VesselCreatorOverlay {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private draft: VesselCosmetics = {};
  private savedAtOpen: VesselCosmetics = {};
  private destroyed = false;
  private sequenceInFlight = false;
  private readonly handlers: VesselCreatorHandlers;
  private readonly swatchButtonsByChannel = new Map<ChannelKey, HTMLButtonElement[]>();
  private readonly boundOnKeydown: (ev: KeyboardEvent) => void;

  constructor(handlers: VesselCreatorHandlers) {
    this.handlers = handlers;
    this.boundOnKeydown = (ev) => {
      if (ev.key === "Escape" && this.isOpen()) this.cancel();
    };

    this.root = document.createElement("div");
    this.root.dataset.vesselCreator = "true";
    Object.assign(this.root.style, ROOT_STYLE);
    this.root.addEventListener("click", (ev) => {
      if (ev.target === this.root) this.cancel();
    });

    this.panel = document.createElement("div");
    Object.assign(this.panel.style, PANEL_STYLE);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Close");
    Object.assign(closeBtn.style, CLOSE_BTN_STYLE);
    closeBtn.addEventListener("click", () => this.cancel());

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      marginBottom: "18px",
      paddingRight: "28px",
    } as Partial<CSSStyleDeclaration>);
    const kicker = document.createElement("div");
    kicker.textContent = "HOUSE · SELF-GENERATED";
    Object.assign(kicker.style, KICKER_STYLE);
    const title = document.createElement("div");
    title.textContent = "Vessel Signature";
    Object.assign(title.style, TITLE_STYLE);
    const sub = document.createElement("div");
    sub.textContent = "Direct picks only — nothing here is random, and nothing here is power.";
    Object.assign(sub.style, SUB_STYLE);
    header.append(kicker, title, sub);

    const rows = document.createElement("div");
    Object.assign(rows.style, {
      display: "flex",
      flexDirection: "column",
      gap: "18px",
      flex: "1",
      overflowY: "auto",
    } as Partial<CSSStyleDeclaration>);
    for (const channel of CHANNELS) rows.appendChild(this.makeChannelRow(channel));

    const footer = document.createElement("div");
    Object.assign(footer.style, { display: "flex", gap: "10px", marginTop: "18px" } as Partial<CSSStyleDeclaration>);
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    Object.assign(saveBtn.style, SAVE_BTN_STYLE);
    saveBtn.addEventListener("click", () => this.save());
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    Object.assign(cancelBtn.style, CANCEL_BTN_STYLE);
    cancelBtn.addEventListener("click", () => this.cancel());
    footer.append(saveBtn, cancelBtn);

    this.panel.append(closeBtn, header, rows, footer);
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    this.root.style.display = "none";
  }

  show(initial: VesselCosmetics): void {
    if (this.destroyed) return;
    this.draft = { ...initial };
    this.savedAtOpen = { ...initial };
    this.syncSwatchSelection();
    this.root.style.display = "flex";
    this.root.style.opacity = "0";
    this.panel.style.transform = "translateX(24px)";
    requestAnimationFrame(() => {
      this.root.style.opacity = "1";
      this.panel.style.transform = "translateX(0)";
    });
    window.addEventListener("keydown", this.boundOnKeydown);
  }

  isOpen(): boolean {
    return !this.destroyed && this.root.style.display !== "none";
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("keydown", this.boundOnKeydown);
    this.root.remove();
  }

  private cancel(): void {
    if (this.sequenceInFlight || !this.isOpen()) return;
    this.forceHide();
    this.handlers.onCancel(this.savedAtOpen);
  }

  private forceHide(): void {
    if (this.destroyed) return;
    window.removeEventListener("keydown", this.boundOnKeydown);
    // Withdraw, don't ascend (visual-language doc §3): fades + slides back
    // toward the edge it docked from, never up/out.
    this.root.style.opacity = "0";
    this.panel.style.transform = "translateX(24px)";
    window.setTimeout(() => {
      if (!this.destroyed) this.root.style.display = "none";
    }, 220);
  }

  private makeChannelRow(channel: { key: ChannelKey; label: string; hint: string }): HTMLDivElement {
    const row = document.createElement("div");
    row.dataset.vesselChannel = channel.key;
    Object.assign(row.style, { display: "flex", flexDirection: "column", gap: "6px" } as Partial<CSSStyleDeclaration>);

    const label = document.createElement("div");
    label.textContent = channel.label;
    Object.assign(label.style, ROW_LABEL_STYLE);
    const hint = document.createElement("div");
    hint.textContent = channel.hint;
    Object.assign(hint.style, ROW_HINT_STYLE);

    const swatchRow = document.createElement("div");
    Object.assign(swatchRow.style, { display: "flex", gap: "8px", flexWrap: "wrap" } as Partial<CSSStyleDeclaration>);

    const buttons: HTMLButtonElement[] = [];
    // Every channel except the hull tone itself can defer to accentColor —
    // the rig's own default (ProceduralPlayerRigOptions' docblock) — rather
    // than force an explicit pick on channels a player doesn't care about.
    if (channel.key !== "accentColor") {
      const matchBtn = this.makeSwatchButton(null, channel.key);
      buttons.push(matchBtn);
      swatchRow.appendChild(matchBtn);
    }
    for (const hex of SWATCHES) {
      const btn = this.makeSwatchButton(hex, channel.key);
      buttons.push(btn);
      swatchRow.appendChild(btn);
    }
    this.swatchButtonsByChannel.set(channel.key, buttons);

    row.append(label, hint, swatchRow);
    return row;
  }

  private makeSwatchButton(hex: string | null, channel: ChannelKey): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.hex = hex ?? "";
    btn.setAttribute("aria-label", hex ?? "match hull");
    Object.assign(btn.style, SWATCH_STYLE);
    btn.style.background = hex ?? "transparent";
    if (!hex) {
      btn.style.border = `1px dashed ${TEXT_DIM}`;
      btn.textContent = "–"; // en dash — "unset / match hull"
      btn.style.color = TEXT_DIM;
      btn.style.fontSize = "13px";
    }
    appendSwatchCorners(btn, hex ?? GOLD_DIM);
    btn.addEventListener("click", () => {
      const next: VesselCosmetics = { ...this.draft };
      next[channel] = hex ?? undefined;
      this.draft = next;
      this.syncSwatchSelection();
      this.handlers.onPreview({ ...this.draft });
    });
    return btn;
  }

  private syncSwatchSelection(): void {
    for (const [channel, buttons] of this.swatchButtonsByChannel) {
      const active = this.draft[channel] ?? null;
      for (const btn of buttons) {
        const isActive = (btn.dataset.hex || null) === active;
        btn.style.boxShadow = isActive
          ? `0 0 0 2px ${WHITE}, 0 0 14px ${withAlpha(btn.dataset.hex || GOLD, 0.6)}`
          : "none";
        btn.style.transform = isActive ? "scale(1.08)" : "scale(1)";
        btn.style.opacity = "1";
      }
    }
  }

  /**
   * Confirm beat — reuses CardDraftOverlay's sequenced-reveal grammar
   * (spotlight the selection, hold, closing glow) rather than inventing a
   * second "you chose something" motion language (design doc §4): every
   * unselected swatch dims first, then a whole-panel glow flash in the
   * chosen hull tone, THEN withdraw — never an ascend/fly-up close
   * (visual-language doc §3).
   */
  private save(): void {
    if (this.sequenceInFlight || this.destroyed) return;
    this.sequenceInFlight = true;
    const cosmetics = { ...this.draft };

    for (const [channel, buttons] of this.swatchButtonsByChannel) {
      const active = this.draft[channel] ?? null;
      for (const btn of buttons) {
        if ((btn.dataset.hex || null) !== active) {
          btn.style.transition = "opacity 220ms ease";
          btn.style.opacity = "0.25";
        }
      }
    }

    const glow = cosmetics.accentColor ?? "#8ff8ff";
    window.setTimeout(() => {
      if (this.destroyed) return;
      const flash = document.createElement("div");
      Object.assign(flash.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        background: `radial-gradient(circle at 50% 20%, ${withAlpha(glow, 0.35)} 0%, transparent 65%)`,
        opacity: "1",
        transition: "opacity 320ms ease",
      } as Partial<CSSStyleDeclaration>);
      this.panel.appendChild(flash);
      requestAnimationFrame(() => {
        flash.style.opacity = "0";
        window.setTimeout(() => flash.remove(), 340);
      });
      this.sequenceInFlight = false;
      this.forceHide();
      this.handlers.onSave(cosmetics);
    }, 420);
  }
}

// ---------------- Styles ----------------

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  inset: "0",
  zIndex: "9000",
  display: "flex",
  alignItems: "stretch",
  justifyContent: "flex-end",
  // Light void dim, not a full CardDraftOverlay-style blackout — the point
  // is the idle preview rig stays visible (dimmed) behind this panel.
  background: "rgba(5, 8, 15, 0.35)",
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
  pointerEvents: "auto",
  transition: "opacity 220ms ease",
};

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: "relative",
  width: "min(420px, 92vw)",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: "28px 24px",
  boxSizing: "border-box",
  overflow: "hidden",
  borderLeft: `1px solid ${withAlpha(GOLD, 0.28)}`,
  background: [
    "radial-gradient(ellipse 380px 260px at 100% 0%, rgba(201,168,76,0.08) 0%, transparent 70%)",
    "linear-gradient(180deg, rgba(16,20,32,0.97), rgba(10,13,22,0.99))",
  ].join(", "),
  boxShadow: "-24px 0 60px rgba(0,0,0,0.55)",
  transition: "transform 240ms cubic-bezier(0.16,1,0.3,1)",
};

const CLOSE_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  top: "20px",
  right: "20px",
  width: "28px",
  height: "28px",
  border: `1px solid ${withAlpha(TEXT_DIM, 0.4)}`,
  background: "transparent",
  color: TEXT_DIM,
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: "1",
  borderRadius: "3px",
};

const KICKER_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: "0.22em",
  color: GOLD,
  textTransform: "uppercase",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

const TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "21px",
  fontWeight: "800",
  letterSpacing: "0.04em",
  color: WHITE,
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
};

const SUB_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  color: TEXT_DIM,
  letterSpacing: "0.02em",
  lineHeight: "1.4",
};

const ROW_LABEL_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0.06em",
  color: WHITE,
};

const ROW_HINT_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  color: TEXT_DIM,
  letterSpacing: "0.02em",
};

const SWATCH_STYLE: Partial<CSSStyleDeclaration> = {
  width: "28px",
  height: "28px",
  borderRadius: "3px",
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer",
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "transform 160ms cubic-bezier(0.34,1.4,0.64,1), box-shadow 160ms ease",
  padding: "0",
};

const SAVE_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  flex: "1",
  padding: "10px 0",
  border: `1px solid ${withAlpha(GOLD, 0.5)}`,
  background: withAlpha(GOLD, 0.12),
  color: WHITE,
  fontWeight: "700",
  fontSize: "12px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
  borderRadius: "3px",
};

const CANCEL_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "10px 18px",
  border: `1px solid ${withAlpha(TEXT_DIM, 0.35)}`,
  background: "transparent",
  color: TEXT_DIM,
  fontWeight: "700",
  fontSize: "12px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
  borderRadius: "3px",
};

const CORNER_LEG = 6;

/** Small bracket corners on each swatch — instrument-panel chrome, not a
 *  filled card (visual-language doc §1). Same construction as
 *  CardDraftOverlay's appendBracketCorners, scaled down for a 28px chip. */
function appendSwatchCorners(el: HTMLButtonElement, color: string): void {
  const c = withAlpha(color, 0.7);
  const corners: Array<{ top?: string; bottom?: string; left?: string; right?: string; bt?: string; bb?: string; bl?: string; br?: string }> = [
    { top: "-1px", left: "-1px", bt: `1px solid ${c}`, bl: `1px solid ${c}` },
    { top: "-1px", right: "-1px", bt: `1px solid ${c}`, br: `1px solid ${c}` },
    { bottom: "-1px", left: "-1px", bb: `1px solid ${c}`, bl: `1px solid ${c}` },
    { bottom: "-1px", right: "-1px", bb: `1px solid ${c}`, br: `1px solid ${c}` },
  ];
  for (const corner of corners) {
    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.width = `${CORNER_LEG}px`;
    div.style.height = `${CORNER_LEG}px`;
    div.style.pointerEvents = "none";
    if (corner.top !== undefined) div.style.top = corner.top;
    if (corner.bottom !== undefined) div.style.bottom = corner.bottom;
    if (corner.left !== undefined) div.style.left = corner.left;
    if (corner.right !== undefined) div.style.right = corner.right;
    if (corner.bt) div.style.borderTop = corner.bt;
    if (corner.bb) div.style.borderBottom = corner.bb;
    if (corner.bl) div.style.borderLeft = corner.bl;
    if (corner.br) div.style.borderRight = corner.br;
    el.appendChild(div);
  }
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
