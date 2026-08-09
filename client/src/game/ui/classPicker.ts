// The class picker — ONE presentation, wherever a class is chosen.
// gospel Doors 1.8, docs/classes-goal.md § Naming.
//
// Why this module exists: the game had two class pickers with nothing in
// common. The venue's loadout station showed rich tiles — sigil, locked
// persona name, a true-today kit line — while the private-room form showed
// a bare `<select>` of the same four archetypes. Same choice, two visual
// languages, and the good one was reachable only by walking to a totem
// most players never found. Since Doors 1.1 made the venue the default
// landing and 1.6 can queue you for the bell on arrival, a player can now
// reach a fight without ever passing the station at all — so "the rich
// picker lives at the station" stopped being good enough.
//
// Extracted verbatim from CardDraftOverlay.makeClassRow (which now
// delegates here) so the station's appearance is unchanged and every other
// surface inherits it rather than reinventing it.
//
// Chassis rule (chassis-design-axioms): colour is EARNED — the sigils are
// gold-on-dark and the tiles carry no class-coloured fills. Sigils are
// crystal/slash/kite/ring geometry; no triangle-in-rings, no eye.

/** One selectable class. */
export type ClassOption = {
  /** Sim/wire-stable archetype id ("balanced"...) — what actually persists. */
  id: string;
  /** Class display name — the LOCKED persona ("Geometrician", "Interstice",
   *  "Kindled", "Syzygist"; docs/classes-goal.md § Naming). */
  name: string;
  /** Display class id — picks the drawn sigil. */
  classId: "wizard" | "ninja" | "paladin" | "priest";
  /** One-line TRUE-TODAY kit summary (stats, not future verbs). */
  summary: string;
  /** Shows the quiet "FULL KIT SOON" tag. */
  kitComing?: boolean;
};

export type ClassRowConfig = {
  /** Row heading, e.g. "CHOOSE YOUR CLASS" — plain UI label, no Coptic
   *  (naming protocol: lore names never in HUD-critical copy). */
  title: string;
  options: ClassOption[];
  /** Initially-selected archetype id (the persisted value). */
  selectedId: string;
  /** Fired on every tile click — caller persists + announces. */
  onSelect: (id: string) => void;
};

export type ClassPickerHandle = {
  /** Detached element — the caller mounts it. */
  el: HTMLDivElement;
  /**
   * Repaint for a selection made ELSEWHERE (the venue station and the
   * settings form are two views of one persisted value, so a write on one
   * must not leave the other stale). Does not fire `onSelect` — this is
   * "someone else already did it", not a new choice.
   */
  setSelected(id: string): void;
};

/**
 * Build the picker. Keeps its own selection state so tiles repaint without
 * a re-render from above.
 */
export function buildClassPicker(config: ClassRowConfig): ClassPickerHandle {
  const wrap = document.createElement("div");
  wrap.dataset.classRow = "true";
  Object.assign(wrap.style, CLASS_ROW_WRAP_STYLE);

  const title = document.createElement("div");
  title.textContent = config.title;
  Object.assign(title.style, CLASS_ROW_TITLE_STYLE);

  const row = document.createElement("div");
  Object.assign(row.style, CLASS_ROW_STYLE);

  let selectedId = config.selectedId;
  const tiles = new Map<string, HTMLButtonElement>();

  const paintTile = (tile: HTMLButtonElement, selected: boolean) => {
    tile.setAttribute("aria-pressed", selected ? "true" : "false");
    tile.style.border = selected
      ? "1px solid rgba(201, 168, 76, 0.85)"
      : "1px solid rgba(255, 255, 255, 0.10)";
    tile.style.boxShadow = selected
      ? "0 0 0 1px rgba(201,168,76,0.25), 0 6px 18px rgba(0,0,0,0.4)"
      : "none";
    tile.style.background = selected
      ? "linear-gradient(165deg, rgba(26, 24, 16, 0.95), rgba(12, 12, 10, 0.98))"
      : "linear-gradient(165deg, rgba(14, 18, 28, 0.9), rgba(8, 10, 16, 0.95))";
    tile.style.opacity = selected ? "1" : "0.82";
  };

  for (const option of config.options) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.dataset.classTile = option.id;
    Object.assign(tile.style, CLASS_TILE_STYLE);

    const sigil = document.createElement("div");
    sigil.innerHTML = classSigilSvg(option.classId);
    Object.assign(sigil.style, {
      lineHeight: "0",
      color: "#c9a84c",
      opacity: "0.9",
    } as Partial<CSSStyleDeclaration>);

    const name = document.createElement("div");
    name.textContent = option.name.toUpperCase();
    Object.assign(name.style, CLASS_TILE_NAME_STYLE);

    const summary = document.createElement("div");
    summary.textContent = option.summary;
    Object.assign(summary.style, CLASS_TILE_SUMMARY_STYLE);

    tile.append(sigil, name, summary);

    if (option.kitComing) {
      const tag = document.createElement("div");
      tag.textContent = "FULL KIT SOON";
      Object.assign(tag.style, CLASS_TILE_TAG_STYLE);
      tile.append(tag);
    }

    paintTile(tile, option.id === selectedId);
    tile.addEventListener("click", (e) => {
      // Never bubble into a host surface's own click handling (the draft
      // overlay's card-pick surface is the original reason for this).
      e.stopPropagation();
      if (option.id === selectedId) return;
      selectedId = option.id;
      for (const [id, t] of tiles) paintTile(t, id === selectedId);
      config.onSelect(option.id);
    });
    tile.addEventListener("mouseenter", () => {
      if (option.id !== selectedId) tile.style.opacity = "1";
    });
    tile.addEventListener("mouseleave", () => {
      paintTile(tile, option.id === selectedId);
    });

    tiles.set(option.id, tile);
    row.appendChild(tile);
  }

  wrap.append(title, row);
  return {
    el: wrap,
    setSelected: (id: string) => {
      if (id === selectedId || !tiles.has(id)) return;
      selectedId = id;
      for (const [tileId, t] of tiles) paintTile(t, tileId === selectedId);
    },
  };
}

const CLASS_ROW_WRAP_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "8px",
  width: "100%",
};

const CLASS_ROW_TITLE_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "11px",
  fontWeight: "700",
  letterSpacing: "0.22em",
  color: "#aa9e7f", // Instrument Ink — the house/station register
  textTransform: "uppercase",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

const CLASS_ROW_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  justifyContent: "center",
};

const CLASS_TILE_STYLE: Partial<CSSStyleDeclaration> = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "5px",
  width: "150px",
  padding: "10px 8px",
  borderRadius: "8px",
  cursor: "pointer",
  color: "#e8eef4",
  fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
  transition: "border 160ms ease, box-shadow 160ms ease, opacity 160ms ease",
};

const CLASS_TILE_NAME_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "13px",
  fontWeight: "800",
  letterSpacing: "0.1em",
};

const CLASS_TILE_SUMMARY_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "9.5px",
  lineHeight: "1.35",
  color: "#7a8aa3",
  textAlign: "center",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

const CLASS_TILE_TAG_STYLE: Partial<CSSStyleDeclaration> = {
  fontSize: "8px",
  fontWeight: "700",
  letterSpacing: "0.18em",
  color: "rgba(201, 168, 76, 0.75)",
  fontFamily: "'Space Mono', 'Courier New', monospace",
};

/** Crystal / slash / kite / ring geometry — the chassis grammar. Gold
 *  stroke on dark, never a class-coloured fill. */
export function classSigilSvg(classId: ClassOption["classId"]): string {
  const open =
    '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" ' +
    'stroke-linecap="round" aria-hidden="true">';
  const close = "</svg>";
  switch (classId) {
    case "wizard":
      // Elongated crystal shard with one facet line.
      return `${open}<path d="M14 2 L20 11 L14 26 L8 11 Z"/><path d="M14 2 L14 26" opacity="0.5"/>${close}`;
    case "ninja":
      // Twin slashes.
      return `${open}<path d="M7 22 L19 5"/><path d="M12 24 L24 7"/>${close}`;
    case "paladin":
      // Kite board.
      return `${open}<path d="M14 3 L23 8 L23 15 C23 20 19 24 14 26 C9 24 5 20 5 15 L5 8 Z"/>${close}`;
    case "priest":
      // Radiant ring — plain circle + ticks, nothing inside it.
      return (
        `${open}<circle cx="14" cy="14" r="6"/>` +
        '<path d="M14 2 L14 5"/><path d="M14 23 L14 26"/>' +
        '<path d="M2 14 L5 14"/><path d="M23 14 L26 14"/>' +
        '<path d="M5.5 5.5 L7.6 7.6"/><path d="M20.4 20.4 L22.5 22.5"/>' +
        '<path d="M22.5 5.5 L20.4 7.6"/><path d="M7.6 20.4 L5.5 22.5"/>' +
        close
      );
  }
}
