# JAKESJAM — Theme System

**Version:** 0.1
**Status:** Spec, ready for code implementation
**Date:** 2026-05-02
**Companion doc:** `docs/art-direction.md`

JAKESJAM ships with multiple swappable colour themes plus an "elevated juicing pass" that mimics the JetBrains New-UI / paid-Darcula treatment: boosted saturation on accents, micro-gradients on flat fills, subtle outer glow on bright elements, deeper shadows for perceived depth. Themes are runtime-swappable from the Options menu and persist via `localStorage`.

## Theme System Overview

```text
client/src/game/themes/
  index.ts                — exports active theme + applyTheme()
  ThemePalette.ts         — type definitions
  juicing.ts              — JuicingPass spec + helpers
  palettes/
    crystalCyan.ts        — default theme
    gruvboxTech.ts        — warm gold variant
    monokaiDrift.ts       — high-saturation neon variant
    darculaPlus.ts        — stretch
    solarflare.ts         — stretch
  themeRegistry.ts        — id → theme map for the switcher UI
  storage.ts              — localStorage read/write of selected theme id
```

**`ThemePalette` shape** (sketch — final types live in code):

```ts
export interface ThemePalette {
  id: string;             // 'crystal-cyan' | 'gruvbox-tech' | ...
  name: string;           // human-readable
  colors: {
    bg: { deep: number; mid: number; near: number };  // arena depths
    fg: { primary: number; secondary: number; muted: number };
    accent: { primary: number; secondary: number; danger: number };
    ui: { panel: number; panelStroke: number; chip: number; chipStroke: number };
    health: { good: number; warn: number; crit: number };
    element: Record<ElementType, number>;  // see art-direction.md
    player: number[]; // 8-slot per-player tint ramp
  };
  juicing: JuicingPass;
}

export interface JuicingPass {
  enabled: boolean;
  saturationBoost: number;     // +0.12 to +0.18 typical
  innerGlowAlpha: number;      // 0.15
  outerGlowBlurPx: number;     // 2-3
  outerGlowAlpha: number;      // 0.25
  bgGradientStrength: number;  // 0.04 (4% radial)
  shadowDeepenBlack: number;   // +0.08
  shadowBlurPx: number;        // 2
}
```

**Runtime swap mechanism:**

1. On boot, `storage.ts` reads `localStorage['jakesjam.theme']` (default `'crystal-cyan'`).
2. `applyTheme(scene, theme)` retints all known game objects: HUD chips, card frames, projectile graphics templates, particle palettes, lighting tints, wizard overlay accents.
3. Options menu calls `applyTheme(scene, themeRegistry.get(id))` and persists the id. No reload needed — the call is a one-frame retint pass.
4. New objects spawned after a swap pull from the active theme via `getActiveTheme().colors.*`. There is no per-object snapshot of colours; everything reads through the theme module.

## The Juicing Pass

Quantified treatment applied on top of any base palette so all themes get the "paid IDE" depth.

- **Saturation boost.** Accent colours (`accent.*`, `element.*`) shift by **+12% to +18%** in HSL saturation at render time. Computed once at theme-load and cached. Base/UI fills are not boosted (they stay readable).
- **Inner glow on bright UI elements.** Buttons, score chips, weapon-card chips, active-tab markers get a 1px inner bevel at `alpha 0.15` of their accent colour. Implemented as a second stroke pass with `alpha 0.15` inset 1px.
- **Outer glow on text + icons.** Bitmap text and icon sprites get a `2-3px` blur-shadow in the accent colour at `alpha 0.25`. Phaser: `setShadow(0, 0, color, 3, false, true)`.
- **Background micro-gradient.** Arena and panel fills get a subtle radial gradient (4% delta from `bg.deep` at edges to `bg.mid` at the focal point — usually screen centre or the focal HUD element). Replaces flat fills.
- **Deeper shadows.** Drop shadows behind cards, panels, nameplates use `bg.deep` darkened by **+8%** with a `2px softer blur`. Translates to "depth without making the dark areas muddy".

The juicing pass is a render-time decoration, not a colour-table mutation. Themes ship with their canonical hex values; the pass interprets them at draw time. This means one `juicing` parameter swap re-juices every theme without a rebuild.

## Three Core Themes

### Crystal Cyan (default)

Cold cyan-violet-white core, deep navy bg. The crystal-tech native palette.

```json
{
  "id": "crystal-cyan",
  "name": "Crystal Cyan",
  "colors": {
    "bg":      { "deep": "#05080f", "mid": "#0b1322", "near": "#152033" },
    "fg":      { "primary": "#f7fbff", "secondary": "#cbd9ec", "muted": "#7a8aa3" },
    "accent":  { "primary": "#8ff8ff", "secondary": "#a78bfa", "danger": "#fb7185" },
    "ui":      { "panel": "#0f1a2e", "panelStroke": "#1f2d47", "chip": "#152841", "chipStroke": "#2a4a73" },
    "health":  { "good": "#b8f05a", "warn": "#fde68a", "crit": "#fb7185" },
    "element": {
      "crystal":   "#8ff8ff", "neutral":   "#ddd6fe", "fire":  "#ff7a18",
      "ice":       "#93c5fd", "lightning": "#fef08a", "void":  "#a78bfa",
      "radiant":   "#fefce8", "electric":  "#67e8f9", "toxic": "#86efac",
      "sticky":    "#f97316", "explosive": "#fb7185"
    },
    "player": ["#8ff8ff","#fb7185","#fde68a","#86efac","#a78bfa","#f0abfc","#67e8f9","#ff7a18"]
  },
  "juicing": { "enabled": true, "saturationBoost": 0.15, "innerGlowAlpha": 0.15, "outerGlowBlurPx": 3, "outerGlowAlpha": 0.25, "bgGradientStrength": 0.04, "shadowDeepenBlack": 0.08, "shadowBlurPx": 2 }
}
```

### Gruvbox Tech

Gruvbox dark warm palette adapted: muted yellow-orange-red accents, brown-green deep, warm beige highlights. Crystal-tech motifs render in gold instead of cyan.

```json
{
  "id": "gruvbox-tech",
  "name": "Gruvbox Tech",
  "colors": {
    "bg":      { "deep": "#1d2021", "mid": "#282828", "near": "#3c3836" },
    "fg":      { "primary": "#fbf1c7", "secondary": "#ebdbb2", "muted": "#a89984" },
    "accent":  { "primary": "#fabd2f", "secondary": "#d3869b", "danger": "#fb4934" },
    "ui":      { "panel": "#32302f", "panelStroke": "#504945", "chip": "#3c3836", "chipStroke": "#665c54" },
    "health":  { "good": "#b8bb26", "warn": "#fabd2f", "crit": "#fb4934" },
    "element": {
      "crystal":   "#fabd2f", "neutral":   "#ebdbb2", "fire":  "#fb4934",
      "ice":       "#83a598", "lightning": "#fabd2f", "void":  "#d3869b",
      "radiant":   "#fbf1c7", "electric":  "#8ec07c", "toxic": "#b8bb26",
      "sticky":    "#fe8019", "explosive": "#cc241d"
    },
    "player": ["#fabd2f","#fb4934","#b8bb26","#83a598","#d3869b","#8ec07c","#fe8019","#fbf1c7"]
  },
  "juicing": { "enabled": true, "saturationBoost": 0.12, "innerGlowAlpha": 0.18, "outerGlowBlurPx": 2, "outerGlowAlpha": 0.22, "bgGradientStrength": 0.05, "shadowDeepenBlack": 0.1, "shadowBlurPx": 2 }
}
```

### Monokai Drift

Monokai-inspired hot pink, neon green, cyan, yellow-orange against deep grey-black. Very saturated, very alive.

```json
{
  "id": "monokai-drift",
  "name": "Monokai Drift",
  "colors": {
    "bg":      { "deep": "#1a1a1f", "mid": "#272822", "near": "#3e3d32" },
    "fg":      { "primary": "#f8f8f2", "secondary": "#cfcfc2", "muted": "#75715e" },
    "accent":  { "primary": "#f92672", "secondary": "#a6e22e", "danger": "#fd5ff0" },
    "ui":      { "panel": "#272822", "panelStroke": "#49483e", "chip": "#3e3d32", "chipStroke": "#75715e" },
    "health":  { "good": "#a6e22e", "warn": "#e6db74", "crit": "#f92672" },
    "element": {
      "crystal":   "#66d9ef", "neutral":   "#f8f8f2", "fire":  "#fd971f",
      "ice":       "#66d9ef", "lightning": "#e6db74", "void":  "#ae81ff",
      "radiant":   "#f8f8f2", "electric":  "#a6e22e", "toxic": "#a6e22e",
      "sticky":    "#fd971f", "explosive": "#f92672"
    },
    "player": ["#f92672","#a6e22e","#66d9ef","#fd971f","#ae81ff","#e6db74","#fd5ff0","#f8f8f2"]
  },
  "juicing": { "enabled": true, "saturationBoost": 0.18, "innerGlowAlpha": 0.18, "outerGlowBlurPx": 3, "outerGlowAlpha": 0.3, "bgGradientStrength": 0.04, "shadowDeepenBlack": 0.08, "shadowBlurPx": 2 }
}
```

## Stretch Themes

Lower priority. Document for future implementation.

- **Darcula+** — IntelliJ Darcula base (`bg.deep #2b2b2b`, `accent.primary #6897bb`, `accent.secondary #cc7832`, `fg.primary #a9b7c6`), with `juicing.saturationBoost: 0.18` and `outerGlowAlpha: 0.30`. Goal: that "paid IDE" depth dialed up. Use a slightly warmer panel mid (`#3c3f41`) and a subtle violet `accent.danger` (`#9876aa`).
- **Solarflare** — high-contrast warm theme as a lighter option. Solarized Light bones (`bg.deep #fdf6e3`, `bg.mid #eee8d5`, `fg.primary #073642`), `accent.primary #cb4b16`, `accent.secondary #d33682`, `accent.danger #dc322f`. Light themes need the juicing pass tuned down: `outerGlowAlpha: 0.15`, `bgGradientStrength: 0.03`, `shadowDeepenBlack: 0.04`. The arena dark-base assumption flips — projectiles need a 1px dark outline so they read on a light field.

## Per-Theme Element Overrides

Each spell `ElementType` (from `client/src/sim/types.ts`) gets a theme-aware colour so visual readability stays consistent across themes. The mapping lives in `theme.colors.element[ElementType]` and is consumed by the projectile renderer + particle system.

| Element | Crystal Cyan | Gruvbox Tech | Monokai Drift |
|---|---|---|---|
| crystal | `#8ff8ff` | `#fabd2f` | `#66d9ef` |
| neutral | `#ddd6fe` | `#ebdbb2` | `#f8f8f2` |
| fire | `#ff7a18` | `#fb4934` | `#fd971f` |
| ice | `#93c5fd` | `#83a598` | `#66d9ef` |
| lightning | `#fef08a` | `#fabd2f` | `#e6db74` |
| void | `#a78bfa` | `#d3869b` | `#ae81ff` |
| radiant | `#fefce8` | `#fbf1c7` | `#f8f8f2` |
| electric | `#67e8f9` | `#8ec07c` | `#a6e22e` |
| toxic | `#86efac` | `#b8bb26` | `#a6e22e` |
| sticky | `#f97316` | `#fe8019` | `#fd971f` |
| explosive | `#fb7185` | `#cc241d` | `#f92672` |

The mapping discipline: **each element keeps its semantic role across themes** (fire = warm, ice = cool, void = mystical, radiant = bright). Hue may rotate to match the theme; *value contrast vs the theme bg never drops below 4.5:1*.

## Theme Switcher UI

Lives in the Options menu. A vertical list of theme entries, each rendered as:

- 28px square preview swatch grid (4 colours: `bg.deep`, `accent.primary`, `accent.secondary`, `accent.danger`)
- Theme name in `fg.primary`
- Active radio dot in `accent.primary` if selected

On hover, a 1-second "live preview" applies `applyTheme(scene, hoveredTheme)` without persisting. On click, persists to `localStorage`. On Options-menu close without click, reverts to persisted theme.

## Implementation Hint

A `Theme` interface exports `colors` (named tokens) plus `juicing` (boolean + parameters) and a single helper:

```ts
applyTheme(scene: Phaser.Scene, theme: ThemePalette): void
```

`applyTheme` walks a registered set of "themeable systems" (HUD, projectile renderer, particle system, lighting, card draft overlay, wizard overlay) and asks each to retint via a small `ThemeAware` interface (`onThemeChanged(theme)`). New systems register via `themeRegistry.registerThemeable(systemRef)` at construction. This keeps the swap fully decentralised — no monolithic switch statement.
