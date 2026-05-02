# Palette Tokens — ROUNDS-style

Single source of truth for the overhaul's color tokens. Distilled from refs 01-04 (eyedropper estimates). Use these when adding/changing any visual code; do NOT introduce ad-hoc hexes.

## Implementation target
Add a new file `client/src/game/ui/palette.ts` exporting these as `as const satisfies` typed maps, in the same style as `elementColors.ts`. Wire `MatchScene`, `DraftScene`, `RenderLayer`, `HudCompositor` to consume these tokens instead of inline hexes.

```ts
// client/src/game/ui/palette.ts (proposed)
export const PALETTE = {
  // Void / background
  voidDeep:      0x06181C, // base arena fill
  voidEdge:      0x0A2A30, // vignette edge
  voidNavy:      0x15202C, // navy-variant arena (ref 02)
  voidCharcoal:  0x0E1118, // charcoal-variant arena (ref 03)

  // Platform palettes (one per arena theme)
  platformLimeHi:  0x9DE642,
  platformLimeMid: 0x5DBE5A,
  platformWashCy:  0x7AE3CC,
  platformWashTl:  0x4FB6B0,

  platformIvoryHi:  0xE8EFF2,
  platformIvoryWash:0x9BC8D4,

  platformWoodHi:  0x9B5A28,
  platformWoodLo:  0x5C3414,

  // String/tether
  tetherHair: 0xC0A878,

  // Lighting
  lightBeamWarm: 0xFFE9B0, // additive light-cone from above
  lampOrbCore:   0xFFF5D1, // draft hero lamp

  // Player body colors (named, not hex-mapped per character; chosen at lobby)
  playerOrange: 0xF26B3A,
  playerOrangeShade: 0x9C2E16,
  playerBlue:   0x3AA0F2,
  playerBlueShade: 0x1E4D8C,

  // HP / typography
  hpLime:    0xB6F25A,
  hpDanger:  0xE55A4A,
  textHi:    0xF5F8F8,
  textMid:   0x9FE0CB,
  textDim:   0x6F7A82,

  // Draft UI
  cardFrameInk: 0x0A1418, // card body fill
  cardBracket:  0x5DCFD9, // corner brackets
  cardBracketGlow: 0x7AE3F0, // hover halo
  cardTitle:    0x9FE0CB,
  benefitGreen: 0x7DE05A,
  penaltyRed:   0xE55A4A,

  // Explosion gradient (stack these soft circles)
  blastHalo:   0xFFB347,
  blastMid:    0xFFE066,
  blastCore:   0xFFF8DC,
  emberGold:   0xFFC04A,
} as const;
```

## Per-arena theme presets

Pick one per map. Each is a 3-token tuple (BG, platform high, platform wash):

```ts
export const ARENA_THEMES = {
  jadeIsles:   { bg: PALETTE.voidDeep,     hi: PALETTE.platformLimeHi,   wash: PALETTE.platformWashCy },
  ivoryClouds: { bg: PALETTE.voidNavy,     hi: PALETTE.platformIvoryHi,  wash: PALETTE.platformIvoryWash },
  hangingWood: { bg: PALETTE.voidCharcoal, hi: PALETTE.platformWoodHi,   wash: PALETTE.platformWoodLo },
} as const satisfies Record<string, ArenaTheme>;
```

## Gradients (for tween/animation interpolation)

- **Explosion bloom (per soft-circle, top-down stacking):**
  `#FFF8DC` (core, scale 0.4) → `#FFE066` (mid, scale 0.7) → `#FFB347` (halo, scale 1.2) at increasing alpha-decay rates.
- **Burn DoT spark:** `#FF7A18` → fade alpha to 0 over 600ms, drift up.
- **Freeze shard:** `#93C5FD` → fade scale to 0 over 800ms.
- **Lightning bolt:** `#FEF08A` core stroke 3px, `#FBBF24` outer stroke 6px alpha 0.6, jitter 6px on the segment endpoints.

## Typography
- **Body / chips:** `Inter` (already loaded), 12-14px regular for body, 13-16px bold for HUD numbers.
- **Card titles:** uppercase bold, slight letter-spacing (`+1`), color `cardTitle` `#9FE0CB`.
- **HP/name floats:** 12px, color `textHi`, no plate, thin 2px `hpLime` underline.

## Don'ts
- ❌ Don't introduce a 4th platform-color preset without first naming an arena for it.
- ❌ Don't mix two saturated palette colors in the same scene — pick one platform tint, the rest stays void/text/accent.
- ❌ Don't add UI plates with rounded corners + opacity. Plate-less typography is non-negotiable.
- ❌ Don't render a grid overlay on the arena.
