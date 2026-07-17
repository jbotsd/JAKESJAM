// Map registry — single source of truth for map id → MapDefinition.
//
// Both the Bun host and the Phaser client look up maps here so the
// authoritative collision and the rendered geometry are guaranteed
// byte-identical. Adding a new map: import + add one entry.
//
// `MapId` is intentionally a narrow string-literal union so a typo at
// the call site fails at compile, not at runtime when a player lands
// in an empty world.

import { boxworksWorld } from "./boxworks.js";
import { generateArena, isGenMapId, parseGenSeed } from "./mapGen.js";

export { isGenMapId };
import { boxworksMini } from "./boxworks-mini.js";
import { boxworksTower } from "./boxworks-tower.js";
import { vesselNexus } from "./vessel-nexus.js";
import { skyseam } from "./skyseam.js";
import type { MapDefinition } from "../types.js";

export type MapId = "vessel-nexus" | "skyseam" | "boxworks" | "boxworks-mini" | "boxworks-tower";

export const mapsById: Record<MapId, MapDefinition> = {
  "vessel-nexus": vesselNexus,
  "skyseam": skyseam,
  "boxworks": boxworksWorld as MapDefinition,
  "boxworks-mini": boxworksMini,
  "boxworks-tower": boxworksTower,
};

/**
 * Alias table: extra string ids that map to the SAME MapDefinition as a
 * canonical `MapId`. Populated from the embedded `.id` of each registered
 * map so the broadcast-vs-resolve path can never silently fall back to
 * the default just because the map's `.id` got renamed (e.g. `expandMap`
 * tags the expanded boxworks as `"boxworks-expanded"`, which would otherwise
 * miss the registry on a `resolveMap("boxworks-expanded")` lookup).
 *
 * Built once at module load so resolution is O(1).
 */
const mapAliasesById: Record<string, MapDefinition> = (() => {
  const out: Record<string, MapDefinition> = {};
  for (const [id, def] of Object.entries(mapsById)) {
    out[id] = def;
    // The canonical id from the registry key is already in `out`. If the
    // embedded `.id` differs (post-expansion etc.), register that too.
    if (def.id && def.id !== id && !(def.id in out)) {
      out[def.id] = def;
    }
  }
  return out;
})();

/** Hot Lobby default — 16-pad mega vessel dock. */
export const DEFAULT_MAP_ID: MapId = "vessel-nexus";

export function isMapId(value: string): value is MapId {
  return value in mapsById;
}

/**
 * Picks a map for a given id, falling back to the default if unknown.
 * Use at trust boundaries (network decode, Convex reads) where the
 * incoming string hasn't been narrowed yet.
 *
 * Resolution order:
 *   1. `MapId` literal (exact key in `mapsById`)
 *   2. Embedded `.id` alias (e.g. `"boxworks-expanded"` → boxworksWorld)
 *   3. DEFAULT_MAP_ID fallback
 *
 * Step 2 is what keeps the netcode hello path honest: the server always
 * broadcasts `this.map.id` (the embedded `.id`, not the registry key),
 * and without alias resolution the client used to silently fall through
 * to the default — which only worked by accident when the default
 * happened to be the same expanded map.
 */
/** Cache of generated arenas by seed — generation is pure/deterministic,
 *  so caching is just an allocation saver for repeat lookups. */
const genMapCache = new Map<number, MapDefinition>();

/** Arena Forge custom maps: "custom:<code>". Unlike gen:<seed>, a custom
 *  map's geometry is arbitrary Forge-authored content — it can't be
 *  independently re-derived from the id, it has to actually be fetched
 *  (server/src/mapStore.ts, via client/src/net/mapClient.ts's
 *  prefetchCustomMap). resolveMap() itself STAYS SYNCHRONOUS (required —
 *  client/src/net/clientLoop.ts calls it from inside the per-message sim
 *  path), so the fetch has to happen separately, earlier, in the
 *  connection-setup flow, before this id is ever passed to resolveMap().
 *  A cache miss here (fetch hasn't completed / never happened) falls
 *  through to the same DEFAULT_MAP_ID fallback an unknown gen:<seed>
 *  already gets — graceful degradation, not a new failure mode. */
const customMapCache = new Map<string, MapDefinition>();
const CUSTOM_MAP_PREFIX = "custom:";

export function isCustomMapId(id: string): boolean {
  return id.startsWith(CUSTOM_MAP_PREFIX);
}

/** Populates the cache resolveMap() reads from. Called by
 *  prefetchCustomMap() once the fetch completes — kept here (not in
 *  net/mapClient.ts) so this module never needs a network import. */
export function setCustomMap(code: string, map: MapDefinition): void {
  customMapCache.set(code, map);
}

export function resolveMap(id: string | undefined): MapDefinition {
  if (id !== undefined) {
    if (isMapId(id)) return mapsById[id];
    const aliased = mapAliasesById[id];
    if (aliased) return aliased;
    // Seeded procgen arenas: "gen:<seed>". Client and server expand the
    // seed through the same pure generator — byte-identical geometry.
    if (isGenMapId(id)) {
      const seed = parseGenSeed(id);
      if (seed !== null) {
        let map = genMapCache.get(seed);
        if (!map) {
          map = generateArena(seed);
          genMapCache.set(seed, map);
        }
        return map;
      }
    }
    if (isCustomMapId(id)) {
      const cached = customMapCache.get(id.slice(CUSTOM_MAP_PREFIX.length));
      if (cached) return cached;
    }
  }
  return mapsById[DEFAULT_MAP_ID];
}

/**
 * Display metadata for the lobby map picker. Keep parallel to mapsById.
 * Order here is the order players see them.
 */
/**
 * Picker-only id: not a real `MapId` (never appears in `mapsById`/`resolveMap`
 * as a literal key). Selecting it means "mint a fresh `gen:<seed>` on pick" —
 * see `LobbyController.onMapPicked`. Kept separate from `MapId` so that type
 * stays a strict compile-time guard against wire/registry typos (per the
 * header comment above); this is purely a UI-layer affordance.
 */
export const GEN_RANDOM_PICKER_ID = "gen-random" as const;
export type MapPickerId = MapId | typeof GEN_RANDOM_PICKER_ID;

/** Representative arena shown on the "Generated Arena" picker card. Lazy
 *  so a broken generator can't crash module import during tests. */
let _genPreview: MapDefinition | null = null;
export function getGenPreviewMap(): MapDefinition {
  if (!_genPreview) _genPreview = generateArena(0);
  return _genPreview;
}
/** @deprecated use getGenPreviewMap() — kept for call sites that import the const name. */
export const GEN_PREVIEW_MAP: MapDefinition = new Proxy({} as MapDefinition, {
  get(_t, prop) {
    return (getGenPreviewMap() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** Resolves a picker id (real MapId or the gen-random sentinel) to the
 *  MapDefinition used for the card preview. */
export function previewMapForPicker(id: MapPickerId): MapDefinition {
  return id === GEN_RANDOM_PICKER_ID ? GEN_PREVIEW_MAP : mapsById[id];
}

export const mapPickerOrder: ReadonlyArray<{
  id: MapPickerId;
  blurb: string;
  recommendedPlayers: string;
}> = [
  {
    id: "vessel-nexus",
    blurb: "The Arena's mega-dock. Sixteen vessel pads, hull shafts, sci-fi gnostic chrome.",
    recommendedPlayers: "8-16",
  },
  {
    id: "skyseam",
    blurb: "Two crossing seam-ramps under a sky archipelago. Hold the high line.",
    recommendedPlayers: "8-16",
  },
  {
    id: "boxworks-mini",
    blurb: "Tight 1v1 cell. Every shot is a real engagement.",
    recommendedPlayers: "2",
  },
  {
    id: "boxworks",
    blurb: "Classic multi-cell flow. Room-scale FFA.",
    recommendedPlayers: "2-8",
  },
  {
    id: "boxworks-tower",
    blurb: "Vertical climb chaos. Wall-jump or fall.",
    recommendedPlayers: "4-8",
  },
  {
    id: GEN_RANDOM_PICKER_ID,
    blurb: "Fresh mega dock every match. Validated layout, never the same twice.",
    recommendedPlayers: "8-16",
  },
];
