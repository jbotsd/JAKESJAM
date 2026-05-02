// Single source of truth for visual overhaul color tokens.
// Distilled from the ROUNDS reference (docs/visual-overhaul/PALETTE-TOKENS.md).
// Complements elementColors.ts — do NOT replace it.

export type ArenaTheme = {
  bg: number;
  hi: number;
  wash: number;
  /** Optional explicit shadow/shade color for platform drop-shadow layer. */
  shade?: number;
  /** If true, MatchScene renders additive warm light-beam triangles from above. */
  hasLightBeams?: boolean;
};

export const PALETTE = {
  // Void / background
  voidDeep:     0x06181C,
  voidEdge:     0x0A2A30,
  voidNavy:     0x15202C,
  voidCharcoal: 0x0E1118,

  // Platform palettes (one per arena theme)
  platformLimeHi:   0x9DE642,
  platformLimeMid:  0x5DBE5A,
  platformWashCy:   0x7AE3CC,
  platformWashTl:   0x4FB6B0,

  platformIvoryHi:   0xE8EFF2,
  platformIvoryWash: 0x9BC8D4,

  platformWoodHi: 0x9B5A28,
  platformWoodLo: 0x5C3414,

  // String/tether
  tetherHair: 0xC0A878,

  // Lighting
  lightBeamWarm: 0xFFE9B0,
  lampOrbCore:   0xFFF5D1,

  // Player body colors
  playerOrange:      0xF26B3A,
  playerOrangeShade: 0x9C2E16,
  playerBlue:        0x3AA0F2,
  playerBlueShade:   0x1E4D8C,

  // HP / typography
  hpLime:   0xB6F25A,
  hpDanger: 0xE55A4A,
  textHi:   0xF5F8F8,
  textMid:  0x9FE0CB,
  textDim:  0x6F7A82,

  // Draft UI
  cardFrameInk:    0x0A1418,
  cardBracket:     0x5DCFD9,
  cardBracketGlow: 0x7AE3F0,
  cardTitle:       0x9FE0CB,
  benefitGreen:    0x7DE05A,
  penaltyRed:      0xE55A4A,

  // Explosion gradient
  blastHalo: 0xFFB347,
  blastMid:  0xFFE066,
  blastCore: 0xFFF8DC,
  emberGold: 0xFFC04A,
} as const satisfies Record<string, number>;

export const ARENA_THEMES = {
  jadeIsles:   { bg: PALETTE.voidDeep,     hi: PALETTE.platformLimeHi,  wash: PALETTE.platformWashCy },
  ivoryClouds: { bg: PALETTE.voidNavy,     hi: PALETTE.platformIvoryHi, wash: PALETTE.platformIvoryWash, hasLightBeams: true },
  hangingWood: { bg: PALETTE.voidCharcoal, hi: PALETTE.platformWoodHi,  wash: PALETTE.platformWoodLo,   shade: PALETTE.platformWoodLo },
} satisfies Record<string, ArenaTheme>;
