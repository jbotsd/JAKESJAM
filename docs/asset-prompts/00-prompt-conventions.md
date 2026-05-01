# JAKESJAM — Prompt Conventions (House Style)

Read this once. Every file in this folder assumes it.

## Trade Dress (the JAKESJAM look in one paragraph)

A futuristic, geometric-minimal sci-fi world where **cyberpunk sorcerers / techno-mages** fire faceted crystal rounds. Trade-dress vocabulary: **cyan-violet glow**, **crystal-tech faceted surfaces**, **hard-edged exoskeleton armour**, **arcane glyphs etched in glow on dark metal**, **deep navy-black backgrounds**, **bright additive accents**. Cartoon-meaty action energy (Vlambeer juice) on top of geometric-minimal forms (Geometry Wars / SUPERHOT). Serious-competitive tone. No fantasy robes, no anime, no realistic gore, no flat-vector hipster cleanliness, no chiptune retro pixel.

## Default Parameters

Use these unless a specific prompt overrides them.

### Midjourney v7

```
--ar 1:1 --style raw --stylize 200 --quality 1 --v 7
```

Append for transparent PNGs: `--no background`. Append for wide UI assets: `--ar 16:9` or `--ar 21:9`.

### SDXL / Recraft

- Aspect: 1:1 unless noted
- Resolution: **2048×2048** for hero assets (logo, splash), **1024×1024** for icons/chips, **512×512** for particle textures
- Sampler: DPM++ 2M Karras, 30 steps
- CFG: 6-7
- Style: "concept art, sharp, geometric, additive glow, dark background"

### ChatGPT Image (gpt-image-1)

- `quality: high`, `size: 2048x2048` for heroes, `1024x1024` for icons
- `background: transparent` for HUD chrome and icons; `background: opaque` for backdrops

## Universal Negative Prompt

Paste at the end of every prompt unless overridden:

```
no text, no words, no logos, no watermark, no signature, no fantasy robes, no anime, no chibi, no realistic gore, no blood, no medieval, no parchment, no stone runes, no clutter, no pastel illustration, no flat hipster vector, no chiptune pixel art, no JPEG artifacts, no low resolution
```

## Output Specs

| Asset class | Format | Size | Background |
|---|---|---|---|
| Logo / wordmark | PNG | 2048×2048 | transparent |
| HUD chrome (frames, badges, chips) | PNG | 1024×1024 | transparent |
| Menu backdrops | PNG | 2560×1440 | opaque |
| Card frame templates | PNG | 1024×1536 (portrait) | transparent |
| Particle textures | PNG | 512×512 | transparent |

## Colour Anchors (paste into prompts when needed)

- **Crystal Cyan default:** `#8ff8ff` cyan, `#a78bfa` violet, `#fb7185` hot pink, `#fefce8` white-gold, `#05080f` near-black
- **Gruvbox Tech:** `#fabd2f` gold, `#d3869b` muted pink, `#fb4934` red, `#1d2021` deep brown-black
- **Monokai Drift:** `#f92672` hot pink, `#a6e22e` neon green, `#66d9ef` cyan, `#fd971f` orange, `#272822` deep grey

When generating chrome that must work across themes, prefer **neutral metallic + bright cyan glow** (the Crystal Cyan default) and let runtime tinting handle the rest.

## What "Crystal-Tech Faceted" Means Visually

- Surfaces show **flat polygonal facets** (4-8 visible planes per element), not curved shading
- **1px highlight** along the upper edge of each facet, **1px shadow** along the lower
- **Glowing seams** between facets where the glyph etching lives
- **No procedural noise textures** — surfaces are clean
- **Dark base colour, bright accent glow** — never the inverse

## What "Cyberpunk-Sorcerer" Means Visually (for character art)

- Hooded sci-fi visor with a single horizontal glowing eye-line slit (no face shown)
- Exoskeleton plating on shoulders, forearms, shins
- Palm-mounted projector disc (the "wand" replacement)
- Energy filaments routed along the spine and limbs
- Crystal hex-chip accents on shoulder and ankles
- **No robes, no staves, no pointy hats, no scrolls.** This is closer to Tron / Hyper Light Drifter than to Gandalf.

## Workflow Tips

1. Generate 4 variants per prompt. Pick one. If none work, change the *first* descriptor (the subject), not the modifiers.
2. For HUD chrome, generate on a **mid-grey** background, then key out — pure transparent backgrounds confuse most generators.
3. For chrome that needs to be tinted at runtime: generate in **white + grey + black only**, no colour. Phaser will tint.
4. For card art templates: generate at 1024×1536 portrait, leave the centre 60% empty for the icon overlay.
5. Re-run with `--seed` locked when you need a coherent set (e.g. all four corner brackets matching).
