// ArenaForgeUI — DOM overlay for the in-game map editor ("Arena Forge").
//
// Same convention as DeathOverlay/CardDraftOverlay: plain div trees styled
// via Object.assign(style, ...), mounted over the canvas, show()/destroy()
// lifecycle. Unlike DeathOverlay (mostly passive readout), this overlay IS
// the primary input surface for tool selection and field editing, so its
// root stays pointer-events:auto throughout (no fade-in/out choreography
// needed — it's always present while ArenaForgeScene is active).
//
// Three docked panels + a top action bar:
//   left    — piece palette (arm a placement tool)
//   right   — inspector (edit the selected piece's fields)
//   bottom  — live validateMap() status
//   top     — Test Play / grid-snap toggle / back to menu

import type { MapValidation } from "../../sim/data/mapGen.js";
import type { DestructibleKind, PickupKind } from "../../sim/types.js";

export type ForgeTool =
  | "select"
  | "platform-floor"
  | "platform-wall"
  | "platform-platform"
  | "spawn"
  | "pickup"
  | "destructible";

/** Loosely-typed selection payload — the scene owns the canonical
 *  MapDefinition piece; this is just enough to render+edit it generically. */
export type ForgeSelection =
  | { type: "platform"; id: string; x: number; y: number; w: number; h: number; kind: string }
  | { type: "spawn"; id: string; x: number; y: number }
  | {
      type: "pickup";
      id: string;
      x: number;
      y: number;
      radius: number;
      amount: number;
      respawnMs: number;
      kind: PickupKind;
    }
  | {
      type: "destructible";
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      health: number;
      explosive: boolean;
      flammable: boolean;
      kind: DestructibleKind;
    }
  | null;

export type ForgeUICallbacks = {
  onToolChange: (tool: ForgeTool, kind?: PickupKind | DestructibleKind) => void;
  /** field name matches the ForgeSelection shape's own keys (x/y/w/h/kind/etc). */
  onFieldChange: (field: string, value: number | string | boolean) => void;
  onDeleteSelection: () => void;
  onTestPlay: () => void;
  onGridSnapToggle: (enabled: boolean) => void;
  onBack: () => void;
};

const PICKUP_KINDS: PickupKind[] = [
  "health-shard",
  "shield-cell",
  "overcharge-core",
  "damage-amp",
  "speed-boost",
  "melee-mode",
  "slow-trap",
  "vulnerability-trap",
  "block-jammer",
  "boss-core",
  "card-cache",
];

const DESTRUCTIBLE_KINDS: DestructibleKind[] = ["barrel", "box", "mine", "cube"];

export class ArenaForgeUI {
  private readonly cb: ForgeUICallbacks;
  private root: HTMLDivElement;
  private paletteButtons: Map<ForgeTool, HTMLButtonElement> = new Map();
  private pickupKindSelect: HTMLSelectElement;
  private destructibleKindSelect: HTMLSelectElement;
  private inspectorBody: HTMLDivElement;
  private validatorBody: HTMLDivElement;
  private activeTool: ForgeTool = "select";
  private destroyed = false;

  constructor(cb: ForgeUICallbacks) {
    this.cb = cb;
    this.root = document.createElement("div");
    Object.assign(this.root.style, ROOT_STYLE);

    const top = this.buildTopBar();
    const palette = this.buildPalette();
    this.inspectorBody = document.createElement("div");
    const inspector = this.buildPanel("INSPECTOR", this.inspectorBody, RIGHT_PANEL_STYLE);
    this.validatorBody = document.createElement("div");
    const validator = this.buildPanel("VALIDATOR", this.validatorBody, BOTTOM_PANEL_STYLE);
    this.setInspectorEmpty();
    this.setValidation(null);

    this.pickupKindSelect = document.createElement("select");
    this.destructibleKindSelect = document.createElement("select");

    this.root.append(top, palette, inspector, validator);
    document.body.appendChild(this.root);
  }

  // ─── Public API (driven by the scene) ──────────────────────────────────

  setArmedTool(tool: ForgeTool): void {
    this.activeTool = tool;
    for (const [t, btn] of this.paletteButtons) {
      btn.style.borderColor = t === tool ? "#8ff8ff" : "rgba(143, 248, 255, 0.25)";
      btn.style.background = t === tool ? "rgba(143, 248, 255, 0.14)" : "transparent";
    }
  }

  setSelection(sel: ForgeSelection): void {
    if (!sel) {
      this.setInspectorEmpty();
      return;
    }
    this.inspectorBody.innerHTML = "";
    this.inspectorBody.appendChild(this.fieldRow("X", "x", Math.round(sel.x)));
    this.inspectorBody.appendChild(this.fieldRow("Y", "y", Math.round(sel.y)));
    if (sel.type === "platform" || sel.type === "destructible") {
      this.inspectorBody.appendChild(this.fieldRow("W", "w", Math.round(sel.w)));
      this.inspectorBody.appendChild(this.fieldRow("H", "h", Math.round(sel.h)));
    }
    if (sel.type === "platform") {
      this.inspectorBody.appendChild(
        this.selectRow("Kind", "kind", ["floor", "wall", "platform"], sel.kind),
      );
    }
    if (sel.type === "pickup") {
      this.inspectorBody.appendChild(this.fieldRow("Radius", "radius", sel.radius));
      this.inspectorBody.appendChild(this.fieldRow("Amount", "amount", sel.amount));
      this.inspectorBody.appendChild(this.fieldRow("Respawn ms", "respawnMs", sel.respawnMs));
      this.inspectorBody.appendChild(this.selectRow("Kind", "kind", PICKUP_KINDS, sel.kind));
    }
    if (sel.type === "destructible") {
      this.inspectorBody.appendChild(this.fieldRow("Health", "health", sel.health));
      this.inspectorBody.appendChild(this.checkboxRow("Explosive", "explosive", sel.explosive));
      this.inspectorBody.appendChild(this.checkboxRow("Flammable", "flammable", sel.flammable));
      this.inspectorBody.appendChild(this.selectRow("Kind", "kind", DESTRUCTIBLE_KINDS, sel.kind));
    }
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete (Del)";
    Object.assign(del.style, DELETE_BTN_STYLE);
    del.onclick = () => this.cb.onDeleteSelection();
    this.inspectorBody.appendChild(del);
  }

  setValidation(v: MapValidation | null): void {
    this.validatorBody.innerHTML = "";
    if (!v) {
      const line = document.createElement("div");
      line.textContent = "—";
      Object.assign(line.style, VALIDATOR_LINE_STYLE);
      this.validatorBody.appendChild(line);
      return;
    }
    const rules: Array<[string, boolean]> = [
      ["Reachable", v.unreachable.length === 0],
      [`Routes up (${v.routesUp}/2+)`, v.routesUp >= 2],
      [`Sightline (${Math.round(v.sightline)}px)`, v.sightline <= 480],
      [`Density (${v.density.toFixed(2)})`, v.density >= 0.06 && v.density <= 0.28],
      ["Spawns", v.spawnsOk],
    ];
    const headline = document.createElement("div");
    headline.textContent = v.ok ? "✓ PLAYABLE" : "✗ NOT PLAYABLE YET";
    Object.assign(headline.style, VALIDATOR_HEADLINE_STYLE, {
      color: v.ok ? "#86efac" : "#fb7185",
    });
    this.validatorBody.appendChild(headline);
    for (const [label, ok] of rules) {
      const line = document.createElement("div");
      line.textContent = `${ok ? "✓" : "✗"} ${label}`;
      Object.assign(line.style, VALIDATOR_LINE_STYLE, { color: ok ? "#9ba7b8" : "#fb7185" });
      this.validatorBody.appendChild(line);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.remove();
  }

  // ─── Private builders ───────────────────────────────────────────────────

  private buildTopBar(): HTMLDivElement {
    const bar = document.createElement("div");
    Object.assign(bar.style, TOP_BAR_STYLE);

    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "← Menu";
    Object.assign(back.style, TOOL_BTN_STYLE);
    back.onclick = () => this.cb.onBack();

    const title = document.createElement("div");
    title.textContent = "ARENA FORGE";
    Object.assign(title.style, FORGE_TITLE_STYLE);

    const snap = document.createElement("label");
    Object.assign(snap.style, SNAP_LABEL_STYLE);
    const snapCheck = document.createElement("input");
    snapCheck.type = "checkbox";
    snapCheck.checked = true;
    snapCheck.onchange = () => this.cb.onGridSnapToggle(snapCheck.checked);
    snap.append(snapCheck, document.createTextNode(" Grid snap"));

    const test = document.createElement("button");
    test.type = "button";
    test.textContent = "▶ Test Play";
    Object.assign(test.style, TEST_PLAY_BTN_STYLE);
    test.onclick = () => this.cb.onTestPlay();

    bar.append(back, title, snap, test);
    return bar;
  }

  private buildPalette(): HTMLDivElement {
    const panel = document.createElement("div");
    Object.assign(panel.style, LEFT_PANEL_STYLE);
    const heading = document.createElement("div");
    heading.textContent = "PALETTE";
    Object.assign(heading.style, PANEL_HEADING_STYLE);
    panel.appendChild(heading);

    const addTool = (tool: ForgeTool, label: string) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      Object.assign(btn.style, TOOL_BTN_STYLE);
      btn.onclick = () => {
        this.setArmedTool(tool);
        if (tool === "pickup") this.cb.onToolChange(tool, this.pickupKindSelect.value as PickupKind);
        else if (tool === "destructible")
          this.cb.onToolChange(tool, this.destructibleKindSelect.value as DestructibleKind);
        else this.cb.onToolChange(tool);
      };
      this.paletteButtons.set(tool, btn);
      panel.appendChild(btn);
    };

    addTool("select", "Select");
    addTool("platform-floor", "+ Floor");
    addTool("platform-wall", "+ Wall");
    addTool("platform-platform", "+ Ledge");
    addTool("spawn", "+ Spawn point");

    addTool("pickup", "+ Pickup");
    this.pickupKindSelect = document.createElement("select");
    Object.assign(this.pickupKindSelect.style, KIND_SELECT_STYLE);
    for (const k of PICKUP_KINDS) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      this.pickupKindSelect.appendChild(opt);
    }
    this.pickupKindSelect.onchange = () => {
      if (this.activeTool === "pickup") {
        this.cb.onToolChange("pickup", this.pickupKindSelect.value as PickupKind);
      }
    };
    panel.appendChild(this.pickupKindSelect);

    addTool("destructible", "+ Destructible");
    this.destructibleKindSelect = document.createElement("select");
    Object.assign(this.destructibleKindSelect.style, KIND_SELECT_STYLE);
    for (const k of DESTRUCTIBLE_KINDS) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k;
      this.destructibleKindSelect.appendChild(opt);
    }
    this.destructibleKindSelect.onchange = () => {
      if (this.activeTool === "destructible") {
        this.cb.onToolChange("destructible", this.destructibleKindSelect.value as DestructibleKind);
      }
    };
    panel.appendChild(this.destructibleKindSelect);

    const hint = document.createElement("div");
    hint.textContent = "Click to arm, click canvas to place. Esc/right-click cancels.";
    Object.assign(hint.style, HINT_STYLE);
    panel.appendChild(hint);

    this.setArmedTool("select");
    return panel;
  }

  private buildPanel(title: string, body: HTMLDivElement, positionStyle: Partial<CSSStyleDeclaration>): HTMLDivElement {
    const panel = document.createElement("div");
    Object.assign(panel.style, PANEL_BASE_STYLE, positionStyle);
    const heading = document.createElement("div");
    heading.textContent = title;
    Object.assign(heading.style, PANEL_HEADING_STYLE);
    panel.append(heading, body);
    return panel;
  }

  private setInspectorEmpty(): void {
    this.inspectorBody.innerHTML = "";
    const line = document.createElement("div");
    line.textContent = "Nothing selected.";
    Object.assign(line.style, HINT_STYLE);
    this.inspectorBody.appendChild(line);
  }

  private fieldRow(label: string, field: string, value: number): HTMLDivElement {
    const row = document.createElement("div");
    Object.assign(row.style, FIELD_ROW_STYLE);
    const lbl = document.createElement("span");
    lbl.textContent = label;
    Object.assign(lbl.style, FIELD_LABEL_STYLE);
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(value);
    Object.assign(input.style, FIELD_INPUT_STYLE);
    input.onchange = () => this.cb.onFieldChange(field, Number(input.value));
    row.append(lbl, input);
    return row;
  }

  private selectRow(label: string, field: string, options: readonly string[], value: string): HTMLDivElement {
    const row = document.createElement("div");
    Object.assign(row.style, FIELD_ROW_STYLE);
    const lbl = document.createElement("span");
    lbl.textContent = label;
    Object.assign(lbl.style, FIELD_LABEL_STYLE);
    const select = document.createElement("select");
    Object.assign(select.style, FIELD_INPUT_STYLE);
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o;
      opt.selected = o === value;
      select.appendChild(opt);
    }
    select.onchange = () => this.cb.onFieldChange(field, select.value);
    row.append(lbl, select);
    return row;
  }

  private checkboxRow(label: string, field: string, value: boolean): HTMLDivElement {
    const row = document.createElement("div");
    Object.assign(row.style, FIELD_ROW_STYLE);
    const lbl = document.createElement("span");
    lbl.textContent = label;
    Object.assign(lbl.style, FIELD_LABEL_STYLE);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.onchange = () => this.cb.onFieldChange(field, input.checked);
    row.append(lbl, input);
    return row;
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  inset: "0",
  zIndex: "7000",
  pointerEvents: "none",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

const PANEL_BASE_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  pointerEvents: "auto",
  background: "linear-gradient(160deg, rgba(10, 14, 22, 0.92), rgba(6, 9, 15, 0.96))",
  border: "1px solid rgba(143, 248, 255, 0.22)",
  borderRadius: "10px",
  padding: "10px 12px",
  color: "#e8f6ff",
  fontSize: "11px",
  boxShadow: "0 0 24px rgba(0,0,0,0.4)",
};

const LEFT_PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  ...PANEL_BASE_STYLE,
  top: "64px",
  left: "12px",
  width: "150px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const RIGHT_PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  top: "64px",
  right: "12px",
  width: "190px",
};

const BOTTOM_PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  bottom: "12px",
  left: "50%",
  transform: "translateX(-50%)",
  width: "320px",
};

const TOP_BAR_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  top: "0",
  left: "0",
  right: "0",
  height: "48px",
  display: "flex",
  alignItems: "center",
  gap: "14px",
  padding: "0 14px",
  background: "rgba(6, 9, 15, 0.9)",
  borderBottom: "1px solid rgba(143, 248, 255, 0.18)",
  pointerEvents: "auto",
};

const FORGE_TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontWeight: "900",
  letterSpacing: "0.14em",
  color: "#8ff8ff",
  flex: "1",
  textAlign: "center",
};

const SNAP_LABEL_STYLE: Partial<CSSStyleDeclaration> = {
  color: "#9ba7b8",
  fontSize: "11px",
  display: "flex",
  alignItems: "center",
  gap: "4px",
};

const PANEL_HEADING_STYLE: Partial<CSSStyleDeclaration> = {
  fontWeight: "900",
  letterSpacing: "0.12em",
  color: "#ffd76b",
  fontSize: "10px",
  marginBottom: "6px",
};

const TOOL_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid rgba(143, 248, 255, 0.25)",
  background: "transparent",
  color: "#e8f6ff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "11px",
  textAlign: "left",
};

const KIND_SELECT_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "4px 6px",
  borderRadius: "6px",
  border: "1px solid rgba(143, 248, 255, 0.25)",
  background: "#0b0e14",
  color: "#e8f6ff",
  fontFamily: "inherit",
  fontSize: "10px",
};

const TEST_PLAY_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  padding: "8px 16px",
  borderRadius: "6px",
  border: "1px solid rgba(134, 239, 172, 0.5)",
  background: "rgba(134, 239, 172, 0.12)",
  color: "#86efac",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: "900",
  fontSize: "12px",
};

const HINT_STYLE: Partial<CSSStyleDeclaration> = {
  color: "#6b7788",
  fontSize: "9px",
  lineHeight: "1.4",
  marginTop: "4px",
};

const FIELD_ROW_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  marginBottom: "6px",
};

const FIELD_LABEL_STYLE: Partial<CSSStyleDeclaration> = {
  color: "#9ba7b8",
  fontSize: "10px",
};

const FIELD_INPUT_STYLE: Partial<CSSStyleDeclaration> = {
  width: "88px",
  padding: "3px 6px",
  borderRadius: "5px",
  border: "1px solid rgba(143, 248, 255, 0.25)",
  background: "#0b0e14",
  color: "#e8f6ff",
  fontFamily: "inherit",
  fontSize: "10px",
};

const DELETE_BTN_STYLE: Partial<CSSStyleDeclaration> = {
  marginTop: "8px",
  width: "100%",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid rgba(251, 113, 133, 0.4)",
  background: "rgba(251, 113, 133, 0.1)",
  color: "#fb7185",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: "700",
  fontSize: "11px",
};

const VALIDATOR_HEADLINE_STYLE: Partial<CSSStyleDeclaration> = {
  fontWeight: "900",
  fontSize: "12px",
  marginBottom: "4px",
};

const VALIDATOR_LINE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  lineHeight: "1.5",
};
