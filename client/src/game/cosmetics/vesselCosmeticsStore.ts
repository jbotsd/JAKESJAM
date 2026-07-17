// Vessel Creator persistence (docs/vessel-creator-design.md §6). One
// localStorage key, read/written from three places: the Creator overlay
// itself (VesselCreatorOverlay), LobbyController's room create/join calls,
// and MatchScene's offline-Practice local rig. Centralized here so the key
// string and JSON shape only exist once.

import type { VesselCosmetics } from "../../sim/types.js";

/** Mirrors LobbyController's PLAYER_COLOR_KEY / PLAYER_CHARACTER_KEY naming
 *  convention (`jakesjam.<thing>`). */
export const PLAYER_COSMETICS_KEY = "jakesjam.vesselCosmetics";

export function readStoredCosmetics(): VesselCosmetics | undefined {
  try {
    const raw = localStorage.getItem(PLAYER_COSMETICS_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as VesselCosmetics) : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredCosmetics(cosmetics: VesselCosmetics): void {
  try {
    localStorage.setItem(PLAYER_COSMETICS_KEY, JSON.stringify(cosmetics));
  } catch {
    // localStorage unavailable (private mode / quota) — the pick just won't
    // survive a reload; not worth surfacing an error over a cosmetic.
  }
}
