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

export const DEFAULT_MAP_ID: MapId = "boxworks";

export function isMapId(value: string): value is MapId {
  return value in mapsById;
}

/**
 * Picks a map for a given id, falling back to the default if unknown.
 * Use at trust boundaries (network decode, Convex reads) where the
 * incoming string hasn't been narrowed yet.
 */
export function resolveMap(id: string | undefined): MapDefinition {
  if (id !== undefined && isMapId(id)) {
    return mapsById[id];
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
