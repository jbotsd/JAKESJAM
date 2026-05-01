# JAKESJAM — HUD Chrome Prompts

**Output target:** PNG, 1024×1024 (frames/badges) or 512×1024 (chips), transparent background.
**Tinting:** generate in **white + grey + black only** so Phaser can tint at runtime per active theme. Where colour is specified below, it is the *fallback* for assets that won't be tinted.
**House style:** see `00-prompt-conventions.md`.

These assets sit on top of the live game arena. They must read at the periphery without distracting from combat. Inner glow, micro-gradients, subtle depth — not flat programmer rectangles.

## Prompt 1 — Score Corner Badge (top-left / top-right)

```
Sci-fi HUD corner badge in the shape of an angular crystal-tech bracket, faceted polygonal frame with 1px white inner highlight on top edges and 1px black shadow on bottom edges, the bracket forms an L shape that wraps a corner of the screen, hollow centre for player name and score numerals, dark gunmetal frame with thin cyan glow seam tracing the inner edge, slight outer drop shadow at 25% alpha, transparent background, clean vector clarity, mirror-symmetric pair (one for top-left, one for top-right), 1024x1024

no text, no numbers, no logos, no fantasy, no anime, no JPEG artifacts
```

## Prompt 2 — Round Timer Ring

```
Circular sci-fi timer ring, hollow centre, faceted polygonal outer band with 8 visible segments, each segment with 1px white highlight and 1px shadow, thin glowing cyan inner stroke, the ring is symmetric and ready to be filled clockwise as a progress arc, dark gunmetal frame on transparent background, subtle violet outer bloom, small crystal shard tick marks at 12 3 6 9 positions, sharp clean edges, 1024x1024

no text, no numbers, no clock hands, no fantasy, no anime, no JPEG artifacts
```

## Prompt 3 — Health Bar Frame

```
Horizontal sci-fi health bar frame, narrow rectangular faceted bracket with chamfered crystal corner cuts on the left and right ends, hollow centre ready to be filled with a coloured fill bar, 1px white highlight on top edge 1px shadow on bottom edge of the frame, thin cyan glow stroke along inner edge, slight outer drop shadow, transparent background, dark gunmetal default colour ready to tint, very crisp clean linework, 1024x256 wide aspect, --ar 4:1

no text, no numbers, no fantasy, no anime, no JPEG artifacts
```

## Prompt 4 — Weapon Card Chip

```
Small rectangular sci-fi card chip for a weapon icon, vertical portrait aspect 3:4, faceted crystal-tech frame with chamfered corners, dark navy interior panel ready for an icon overlay, thin cyan glow stroke along the frame perimeter, a small triangular crystal accent in the top-left corner of the chip, subtle inner shadow gives the chip depth, transparent background outside the chip, clean sharp edges, 768x1024

no text, no icons inside, no fantasy, no anime, no JPEG artifacts
```

## Prompt 5 — Ability Cooldown Diamond

```
Diamond-shaped sci-fi ability indicator, four-faceted crystal frame in dark gunmetal with bright cyan inner glow, hollow centre ready for an ability icon overlay, the diamond is symmetric and reads at small size, thin violet outer bloom for that paid IDE depth, small notch detail on the top vertex, transparent background, 512x512

no text, no numbers, no fantasy, no anime, no JPEG artifacts
```

## Prompt 6 — Minimap Frame

```
Square sci-fi minimap frame for a corner HUD position, faceted crystal-tech bezel with 4 chamfered corners, hollow centre for the live minimap render, thin cyan glow stroke along inner edge, four small crystal shard mounting points one at each corner, dark gunmetal frame with subtle drop shadow, transparent background, 1024x1024

no text, no labels, no fantasy, no anime, no JPEG artifacts
```

## Prompt 7 — Notification Toast Frame

```
Horizontal sci-fi notification toast frame, long pill-shape with chamfered crystal corner cuts on both ends, hollow interior ready for short text, thin cyan glow stroke along perimeter, slight inner shadow for depth, dark gunmetal default ready to tint per theme, transparent background, the frame is wider than tall (4:1), 1024x256

no text, no fantasy, no anime, no JPEG artifacts
```

## Prompt 8 — Round-Win Banner

```
Wide horizontal sci-fi banner frame for displaying a player name on round win, faceted crystal-tech ribbon with bright cyan glow along the top and bottom edges, two angled crystal shard end-caps left and right, the centre is a hollow dark navy panel ready for player name overlay, dramatic outer violet bloom, transparent background outside the ribbon, 2048x512, --ar 4:1

no text, no fantasy, no medieval banner, no anime, no JPEG artifacts
```

## Selection Notes

Generate in **white-grey-black only** for prompts 1, 3, 4, 6, 7 — these will be runtime-tinted per theme and per player. Prompts 2, 5, 8 are acceptable in the cyan/violet default since they are theme-anchored UI moments (the timer is always cyan, the win banner gets the active theme accent applied as an additive overlay).
