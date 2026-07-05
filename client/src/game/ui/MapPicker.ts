// MapPicker — DOM card-grid widget for choosing the next match's map.
//
// Lives inside the lobby panel. Disabled for non-host viewers but still
// reflects the host's selection live (Convex pushes `selectedMapId`
// updates through the room snapshot stream). Host clicks → setMap
// mutation → snapshot updates → both clients re-render highlighted card.
//
// Style: matches the splash + chaos-modifier cards; no dependency on
// CardDraftOverlay (different rarity/glow palette).

import {
  mapPickerOrder,
  previewMapForPicker,
  isMapId,
  isGenMapId,
  GEN_RANDOM_PICKER_ID,
  type MapPickerId,
} from "../../sim/data/maps";
import type { MapDefinition } from "../../sim";

export type MapPickerOptions = {
  /** Container the picker mounts inside. */
  mount: HTMLElement;
  /**
   * Fired when the host clicks a card. The picker does NOT optimistically
   * highlight — it waits for `setSelected` to be called with the value
   * Convex confirmed (avoids selection flicker on validation failure).
   */
  onPick: (mapId: MapPickerId) => void;
};

export class MapPicker {
  private readonly root: HTMLDivElement;
  private readonly cards = new Map<MapPickerId, HTMLButtonElement>();
  private selectedId: MapPickerId | null = null;
  private hostMode = false;

  constructor(opts: MapPickerOptions) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, ROOT_STYLE);

    const heading = document.createElement("div");
    heading.textContent = "Map";
    Object.assign(heading.style, HEADING_STYLE);

    const grid = document.createElement("div");
    Object.assign(grid.style, GRID_STYLE);

    for (const entry of mapPickerOrder) {
      const map = previewMapForPicker(entry.id);
      const card = this.buildCard(map, entry.blurb, entry.recommendedPlayers);
      this.cards.set(entry.id, card);
      card.addEventListener("click", () => {
        if (!this.hostMode) return;
        opts.onPick(entry.id);
      });
      grid.appendChild(card);
    }

    this.root.append(heading, grid);
    opts.mount.appendChild(this.root);
  }

  /**
   * Mark a single card as selected. Pass `null` to clear.
   * Always reflects the source of truth (Convex room.selectedMapId),
   * never local optimistic state.
   */
  setSelected(mapId: string | undefined): void {
    const next: MapPickerId | null =
      mapId === undefined
        ? null
        : isMapId(mapId)
          ? mapId
          : isGenMapId(mapId)
            ? GEN_RANDOM_PICKER_ID
            : null;
    if (next === this.selectedId) return;
    if (this.selectedId !== null) {
      this.applySelected(this.selectedId, false);
    }
    this.selectedId = next;
    if (next !== null) this.applySelected(next, true);
  }

  /**
   * Toggle interactivity. Non-hosts see the same selection but can't pick.
   */
  setHostMode(isHost: boolean): void {
    if (this.hostMode === isHost) return;
    this.hostMode = isHost;
    for (const card of this.cards.values()) {
      card.style.cursor = isHost ? "pointer" : "default";
      card.style.opacity = isHost ? "1" : "0.78";
    }
  }

  destroy(): void {
    this.root.remove();
    this.cards.clear();
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private buildCard(
    map: MapDefinition,
    blurb: string,
    recommendedPlayers: string,
  ): HTMLButtonElement {
    const card = document.createElement("button");
    card.type = "button";
    Object.assign(card.style, CARD_STYLE);

    const name = document.createElement("div");
    name.textContent = map.name;
    Object.assign(name.style, NAME_STYLE);

    const meta = document.createElement("div");
    meta.textContent = `${map.size.x}×${map.size.y}  ·  ${recommendedPlayers}p`;
    Object.assign(meta.style, META_STYLE);

    const blurbEl = document.createElement("div");
    blurbEl.textContent = blurb;
    Object.assign(blurbEl.style, BLURB_STYLE);

    const preview = this.buildPreview(map);

    card.append(name, meta, preview, blurbEl);
    return card;
  }

  private buildPreview(map: MapDefinition): HTMLDivElement {
    // Tiny SVG silhouette of the map: scale down platforms into an
    // 80×52 box so the player gets a glanceable sense of geometry.
    const svgNS = "http://www.w3.org/2000/svg";
    const previewW = 110;
    const previewH = Math.max(36, Math.round((previewW * map.size.y) / map.size.x));
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      ...PREVIEW_STYLE,
      height: `${previewH + 4}px`,
    });
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${map.size.x} ${map.size.y}`);
    svg.setAttribute("width", `${previewW}`);
    svg.setAttribute("height", `${previewH}`);
    svg.style.display = "block";
    for (const plat of map.platforms) {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", `${plat.position.x - plat.size.x / 2}`);
      rect.setAttribute("y", `${plat.position.y - plat.size.y / 2}`);
      rect.setAttribute("width", `${plat.size.x}`);
      rect.setAttribute("height", `${plat.size.y}`);
      rect.setAttribute(
        "fill",
        plat.kind === "floor" || plat.kind === "wall" ? "#8ff8ff" : "#caffea",
      );
      rect.setAttribute("opacity", "0.85");
      svg.appendChild(rect);
    }
    for (const spawn of map.spawns) {
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", `${spawn.x}`);
      dot.setAttribute("cy", `${spawn.y}`);
      dot.setAttribute("r", `${Math.max(8, map.size.x / 80)}`);
      dot.setAttribute("fill", "#fde68a");
      dot.setAttribute("opacity", "0.6");
      svg.appendChild(dot);
    }
    wrap.appendChild(svg);
    return wrap;
  }

  private applySelected(id: MapPickerId, on: boolean): void {
    const card = this.cards.get(id);
    if (!card) return;
    if (on) {
      card.style.borderColor = "#8ff8ff";
      card.style.boxShadow = "0 0 0 2px rgba(143, 248, 255, 0.45), 0 8px 22px rgba(0, 0, 0, 0.45)";
      card.style.background = "linear-gradient(160deg, rgba(20, 32, 48, 0.95), rgba(11, 18, 28, 0.97))";
    } else {
      card.style.borderColor = "rgba(143, 248, 255, 0.18)";
      card.style.boxShadow = "0 4px 14px rgba(0, 0, 0, 0.32)";
      card.style.background = "linear-gradient(160deg, rgba(16, 22, 34, 0.92), rgba(10, 14, 22, 0.96))";
    }
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  marginTop: "12px",
};

const HEADING_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  fontWeight: "900",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#8ff8ff",
};

const GRID_STYLE: Partial<CSSStyleDeclaration> = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "10px",
};

const CARD_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "12px 12px 14px",
  borderRadius: "12px",
  border: "1px solid rgba(143, 248, 255, 0.18)",
  background: "linear-gradient(160deg, rgba(16, 22, 34, 0.92), rgba(10, 14, 22, 0.96))",
  color: "#f7fbff",
  cursor: "pointer",
  textAlign: "left",
  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.32)",
  transition: "transform 120ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 120ms ease, border-color 120ms ease, background 120ms ease",
  fontFamily: "Inter, Arial, sans-serif",
};

const NAME_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "13px",
  fontWeight: "900",
  letterSpacing: "0.04em",
};

const META_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "10px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#7a8aa3",
};

const BLURB_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  lineHeight: "1.4",
  color: "#caffea",
  marginTop: "2px",
};

const PREVIEW_STYLE: Partial<CSSStyleDeclaration> = {
  marginTop: "4px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(5, 8, 15, 0.55)",
  borderRadius: "8px",
  padding: "4px",
  border: "1px solid rgba(143, 248, 255, 0.08)",
};
