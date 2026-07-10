// Single source of truth for visual overhaul color tokens.
// Sci-fi gnostic vessel language (docs/visual-language-gnostic-vessel.md)
// + combat cyan readability. Complements elementColors.ts.

export type ArenaTheme = {
  bg: number;
  hi: number;
  wash: number;
  /** Optional explicit shadow/shade color for platform drop-shadow layer. */
  shade?: number;
  /** If true, MatchScene renders additive warm light-beam triangles from above. */
  hasLightBeams?: boolean;
  /** Sci-fi gnostic hull chrome: gold instrument rim + cyan conduit ticks. */
  vesselChrome?: boolean;
  /** Gold house accent (Autogenes / Elyad instrument rule). */
  gold?: number;
};

export const PALETTE = {
  // Void / background — midnight vessel dock
  voidDeep: 0x0a0e1a,
  voidEdge: 0x0d1117,
  voidNavy: 0x0a1424,
  voidCharcoal: 0x080b12,
  voidAbyss: 0x05080f,

  // Platform hull (sci-fi gnostic)
  hullSlate: 0x1e2740,
  hullSlateHi: 0x2a3550,
  hullWashCyan: 0x50e3c2,
  hullWashBright: 0x8ff8ff,
  hullGold: 0xc9a84c,
  hullGoldDim: 0x8a7033,
  hullBronze: 0x3a3020,
  hullBronzeWash: 0xc9a84c,

  // Legacy aliases (kept so older call sites don't break)
  platformLimeHi: 0x50e3c2,
  platformLimeMid: 0x2d8a7e,
  platformWashCy: 0x8ff8ff,
  platformWashTl: 0x50e3c2,
  platformIvoryHi: 0x2a3550,
  platformIvoryWash: 0x8ff8ff,
  platformWoodHi: 0x3a3020,
  platformWoodLo: 0x1a1510,

  // String/tether
  tetherHair: 0xc9a84c,

  // Lighting
  lightBeamWarm: 0xffe9b0,
  lightBeamCyan: 0x8ff8ff,
  lampOrbCore: 0xfff5d1,

  // Player body colors
  playerOrange: 0xf26b3a,
  playerOrangeShade: 0x9c2e16,
  playerBlue: 0x3aa0f2,
  playerBlueShade: 0x1e4d8c,

  // HP / typography
  hpLime: 0xb6f25a,
  hpDanger: 0xe55a4a,
  textHi: 0xe8ecf4,
  textMid: 0x9fe0cb,
  textDim: 0x7a8299,

  // Draft UI
  cardFrameInk: 0x0a1418,
  cardBracket: 0x5dcfd9,
  cardBracketGlow: 0x7ae3f0,
  cardTitle: 0x9fe0cb,
  benefitGreen: 0x7de05a,
  penaltyRed: 0xe55a4a,

  // Explosion gradient
  blastHalo: 0xffb347,
  blastMid: 0xffe066,
  blastCore: 0xfff8dc,
  emberGold: 0xffc04a,
} as const satisfies Record<string, number>;

/**
 * Arena themes — sci-fi gnostic vessel grammar.
 * Gold = house / instrument. Cyan = live spark / combat wash.
 * Legacy keys (jadeIsles / ivoryClouds / hangingWood) remapped so old
 * map JSON keeps working without a content migration.
 */
export const ARENA_THEMES = {
  /** Hot Lobby default — void dock, slate hull, cyan spark, gold seal. */
  voidVessel: {
    bg: PALETTE.voidDeep,
    hi: PALETTE.hullSlate,
    wash: PALETTE.hullWashCyan,
    shade: PALETTE.voidEdge,
    gold: PALETTE.hullGold,
    hasLightBeams: true,
    vesselChrome: true,
  },
  /** Crystal munitions bay — brighter cyan wash. */
  crystalDock: {
    bg: PALETTE.voidNavy,
    hi: PALETTE.hullSlateHi,
    wash: PALETTE.hullWashBright,
    shade: PALETTE.voidDeep,
    gold: PALETTE.hullGold,
    hasLightBeams: true,
    vesselChrome: true,
  },
  /** Autogenes hull — bronze / gold instrument plate. */
  autogenesHull: {
    bg: PALETTE.voidCharcoal,
    hi: PALETTE.hullBronze,
    wash: PALETTE.hullBronzeWash,
    shade: 0x120e08,
    gold: PALETTE.hullGold,
    hasLightBeams: true,
    vesselChrome: true,
  },
  // Legacy aliases → vessel grammar
  jadeIsles: {
    bg: PALETTE.voidDeep,
    hi: PALETTE.hullSlate,
    wash: PALETTE.hullWashCyan,
    shade: PALETTE.voidEdge,
    gold: PALETTE.hullGold,
    hasLightBeams: true,
    vesselChrome: true,
  },
  ivoryClouds: {
    bg: PALETTE.voidNavy,
    hi: PALETTE.hullSlateHi,
    wash: PALETTE.hullWashBright,
    shade: PALETTE.voidDeep,
    gold: PALETTE.hullGold,
    hasLightBeams: true,
    vesselChrome: true,
  },
  hangingWood: {
    bg: PALETTE.voidCharcoal,
    hi: PALETTE.hullBronze,
    wash: PALETTE.hullBronzeWash,
    shade: 0x120e08,
    gold: PALETTE.hullGold,
    hasLightBeams: true,
    vesselChrome: true,
  },
} satisfies Record<string, ArenaTheme>;
