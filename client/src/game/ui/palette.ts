// Single source of truth for visual overhaul color tokens.
// Sci-fi gnostic vessel language (docs/visual-language-gnostic-vessel.md).
// Complements elementColors.ts (the separate, sanctioned element rainbow —
// never conflate the two; see the accent note below).
//
// PALETTE PIVOT (2026-07-15, ~/Documents/JAKESJAM_UX_Research_20260715/
// color_scheme_proposal.md) — Jake: "not married to what it is now... want
// out, more consistent and unique and quality... from the ground up decide
// how it should be done correctly... REAL art direction." Retired cyan/teal
// as the UI/combat accent (OKLCH-research finding: cyan/teal is the *least*
// distinctive sci-fi accent hue family available, not just "common") and
// retired gold as a second competing saturated accent (two co-equal accents
// was the structural mistake, before any hue was even picked).
//
// Replaced with ONE hot accent — "Sapphire Conduit" — locked to the SAME hue
// family as this file's own void/hull structure (H258-269°, computed and
// gamut-checked in OKLCH), so combat/vessel light reads as "this exact
// material, charged" rather than an arbitrary colored light source with no
// relationship to what it's lighting (satisfies the manifesto's "cut, not
// poured — material logic" law directly, docs/ui-axioms.md §0).
//
// Gold's hue is KEPT (warmth is the deliberate contrast that separates house
// from combat without needing two saturated hues) but demoted to
// "Instrument Ink": chroma cut ~60%, text/hairline/seam weight only, never
// a fill, never a glow — directly defuses the doctrine's own flagged risk
// ("marble/gold luxury mysticism").
//
// `hullWashCyan`/`hullWashBright`/`lightBeamCyan`/`platformWashCy` etc. KEEP
// their old key names (churn-minimizing — every call site reading through
// these names picks up the new value automatically) but now hold sapphire
// hex, not cyan. `ELEMENT_COLORS.crystal` in elementColors.ts is explicitly
// NOT touched — the element table is its own sanctioned rainbow (C6),
// deliberately decoupled from the UI-accent question (see the proposal
// §3.3: these were only ever coincidentally the same hex, never the same
// concept). HP ladder / shield / dead-grey / danger are unchanged — verified
// sound in OKLCH by the same research pass, not swept up in the rebrand.

export type ArenaTheme = {
  bg: number;
  hi: number;
  wash: number;
  /** Optional explicit shadow/shade color for platform drop-shadow layer. */
  shade?: number;
  /** If true, MatchScene renders additive warm light-beam triangles from above. */
  hasLightBeams?: boolean;
  /** Sci-fi gnostic hull chrome: instrument-ink rim + sapphire conduit ticks. */
  vesselChrome?: boolean;
  /** Instrument-ink house accent (Autogenes / Elyad instrument rule). */
  gold?: number;
};

export const PALETTE = {
  // Void / background — midnight vessel dock (Existence register — unchanged,
  // verified as a clean monotonic OKLCH lightness ramp at a consistent hue).
  voidDeep: 0x0a0e1a,
  voidEdge: 0x0d1117,
  voidNavy: 0x0a1424,
  voidCharcoal: 0x080b12,
  voidAbyss: 0x05080f,

  // Platform hull (sci-fi gnostic) — wash keys now hold Sapphire Conduit
  // (Vitality register: the one hot accent, H262° — same hue family as the
  // void/hull structure above, "the hull material, charged").
  hullSlate: 0x1e2740,
  hullSlateHi: 0x2a3550,
  hullWashCyan: 0x2750a2, // Sapphire, dim (idle seam)
  hullWashBright: 0x3c79f0, // Sapphire, steady (the accent — default fill/border)
  hullGold: 0x897f69, // Instrument Ink, mid (rule/seam — was gold #c9a84c)
  hullGoldDim: 0x544c3c, // Instrument Ink, dim (rest-state border)
  hullBronze: 0x3a3020,
  hullBronzeWash: 0x897f69,

  // Legacy aliases (kept so older call sites don't break) — same pivot.
  platformLimeHi: 0x2750a2,
  platformLimeMid: 0x1e5a8a,
  platformWashCy: 0x3c79f0,
  platformWashTl: 0x2750a2,
  platformIvoryHi: 0x2a3550,
  platformIvoryWash: 0x3c79f0,
  platformWoodHi: 0x3a3020,
  platformWoodLo: 0x1a1510,

  // String/tether
  tetherHair: 0x897f69,

  // Lighting
  lightBeamWarm: 0xffe9b0,
  lightBeamCyan: 0x3c79f0,
  lampOrbCore: 0xfff5d1,

  // Sapphire Conduit — the full four-step ramp (dim/steady/pulse/bloom),
  // named directly for call sites that want a specific energy state rather
  // than the default "steady" via hullWashBright.
  sapphireDim: 0x2750a2,
  sapphireSteady: 0x3c79f0,
  sapphirePulse: 0x6b98f4,
  sapphireBloom: 0xcedffd,

  // Instrument Ink — the full three-step ramp (bright/mid/dim).
  inkBright: 0xaa9e7f,
  inkMid: 0x897f69,
  inkDim: 0x544c3c,

  // Player body colors
  playerOrange: 0xf26b3a,
  playerOrangeShade: 0x9c2e16,
  playerBlue: 0x3aa0f2,
  playerBlueShade: 0x1e4d8c,

  // HP / typography — gameplay-legible, verified sound in OKLCH, unchanged.
  hpLime: 0xb8f05a,
  /** Formalized 2026-07-15 — was missing despite hpLime/hpDanger both
   *  existing; several call sites (facetedRing.ts, ParticlePool.ts) already
   *  hand-typed this exact value as their mid-health-tier warn color. */
  hpWarn: 0xfde68a,
  hpDanger: 0xfb7185,
  /** Dead/extinguished vessel state — desaturated grey, never black (C5). */
  deadGrey: 0x2a3550,
  textHi: 0xe8ecf4,
  textMid: 0x9fe0cb,
  textDim: 0x7a8299,

  // Draft UI
  cardFrameInk: 0x0a1418,
  cardBracket: 0x5dcfd9,
  cardBracketGlow: 0x7ae3f0,
  cardTitle: 0x9fe0cb,
  benefitGreen: 0x7de05a,
  penaltyRed: 0xfb7185,

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
