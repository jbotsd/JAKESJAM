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
import { boxworksMini } from "./boxworks-mini.js";
import { boxworksTower } from "./boxworks-tower.js";
import type { MapDefinition } from "../types.js";

export type MapId = "boxworks" | "boxworks-mini" | "boxworks-tower";

export const mapsById: Record<MapId, MapDefinition> = {
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

export const DEFAULT_MAP_ID: MapId = "boxworks-mini";

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
export function resolveMap(id: string | undefined): MapDefinition {
  if (id !== undefined) {
    if (isMapId(id)) return mapsById[id];
    const aliased = mapAliasesById[id];
    if (aliased) return aliased;
  }
  return mapsById[DEFAULT_MAP_ID];
}

/**
 * Display metadata for the lobby map picker. Keep parallel to mapsById.
 * Order here is the order players see them.
 */
export const mapPickerOrder: ReadonlyArray<{
  id: MapId;
  blurb: string;
  recommendedPlayers: string;
}> = [
  {
    id: "boxworks-mini",
    blurb: "Tight 1v1 brawl. Every shot is a real engagement.",
    recommendedPlayers: "2",
  },
  {
    id: "boxworks",
    blurb: "Classic 3-tier flow. The default arena.",
    recommendedPlayers: "2-8",
  },
  {
    id: "boxworks-tower",
    blurb: "Vertical jetpack chaos. Burn fuel or fall.",
    recommendedPlayers: "4-6",
  },
];
