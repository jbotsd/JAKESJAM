// Single source of truth for card-rarity colors.
//
// Fixes an axiom C6/S6 violation found in the 2026-07-15 doctrine audit:
// HudSystem.ts (Phaser canvas) and MatchResultsOverlay.ts (DOM) each kept
// their own, mutually conflicting rarity color tables for the same
// semantic tiers. Same token must mean the same RGB everywhere — this file
// is that one token table; both call sites import from here instead of
// declaring their own.
//
// Values are exactly the ones HudSystem.ts already used (the more recently
// reworked, doctrine-compliant file) — legendary gold `0xfbbf24` is close
// to the sanctioned house-gold family per axiom C1, which is the correct
// read for a legendary tier. No new colors were invented; every value here
// already existed in one of the two prior conflicting tables.

import { PALETTE } from "./palette.js";

export type CardRarity = "common" | "uncommon" | "rare" | "legendary" | "cursed";

/** Numeric 0xRRGGBB hex — usable directly in Phaser Graphics/Text calls. */
export const RARITY_COLORS: Record<CardRarity, number> = {
  common: 0x9ca3af,
  uncommon: PALETTE.textMid,
  rare: 0x60a5fa,
  legendary: 0xfbbf24,
  cursed: PALETTE.hpDanger,
};

const DEFAULT_RARITY_COLOR = RARITY_COLORS.common;

/** Numeric 0xRRGGBB hex for a given rarity, falling back to common's color
 *  for an unknown/missing rarity. */
export function rarityColorHex(rarity: string | undefined): number {
  return RARITY_COLORS[rarity as CardRarity] ?? DEFAULT_RARITY_COLOR;
}

/** CSS `#rrggbb` string form, for DOM-based overlays (MatchResultsOverlay). */
export function rarityColorCss(rarity: string | undefined): string {
  return `#${rarityColorHex(rarity).toString(16).padStart(6, "0")}`;
}
