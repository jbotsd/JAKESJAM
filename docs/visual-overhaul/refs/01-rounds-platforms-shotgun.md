# Ref 01 — ROUNDS: platforms + shotgun engagement

Source: `ref images/rounds/ss_546d44400e6dbdfb33cf700559f31e4034c56ed8.jpg`

## Palette (eyedropper-level)
- **Background void:** near-black with a teal undertone (~#06181C → #0A2A30 vignette toward edges).
- **Platform fill:** lime/spring green (~#9DE642 highlight, ~#5DBE5A midtone, ~#3A8FA0 cool teal in the wash).
- **Painterly wash on platforms:** seafoam/cyan streaks (~#7AE3CC, ~#4FB6B0) — clearly hand-painted not a tile fill.
- **Player A (orange):** body ~#F26B3A, outline darker ~#9C2E16, white eye highlights.
- **Player B (blue):** body ~#3AA0F2, deeper navy outline ~#1E4D8C.
- **HP bar:** bright lime (~#B6F25A) underline, no chrome.
- **Projectile cluster (red shotgun spread):** ~#E04030 hot red blobs, irregular.

## Composition rules to copy
- **2-3 saturated colors max** per scene. Everything else is dark void or platform texture.
- **Asymmetric chunky platforms** — rotated squares + irregular pentagons, NOT axis-aligned grid blocks. Floating, no ground line.
- **Dark negative space dominates** — easily 50%+ of frame is empty void. Fights/projectiles read instantly because BG never competes.
- **Painterly texture on solids** — every platform has a watercolor wash with visible brush direction. Not noise, not gradient — directional streaks.

## Character design
- **Tiny round body** (~8% of screen height), stick limbs, tiny dot eyes, no face detail.
- Silhouette-first: a circle + 4 sticks. Readable at any zoom.
- **Name + HP chip** floats above head: thin sans label, thin lime underline. No box, no background plate. Pure typography.
- Holding weapon as a small line+dot (gun barrel). Weapon is glyph-tier minimal.
- Subtle vertical line shading on body (3 white stripes on blue) — implies form without rendering.

## VFX
- **Projectiles = blob clusters**, not pixel sprites. Irregular hand-drawn red splotches in a spread cone.
- **Movement trail:** small saturated dots in body color, sparse (~6 dots), fading.
- **Embers/sparks:** tiny orange points scattered in air around the action — ambient liveliness, not tied to a specific shooter.

## Lighting
- Soft directional light cones from top-left implied by lighter platform faces vs. dark sides.
- No real shadows cast on BG — platforms float in pure void.

## Direct guidance for our overhaul
- **Drop the dark-blue/grey HUD-on-arena look.** Go full void-black with one or two saturated platform colors per arena.
- **Replace any tiled/pixel platform art with painterly polygon fills + brush-streak overlay.**
- **Player rigs need to shrink and simplify** — current rigs read as too detailed. Aim for "circle with sticks + name chip."
- **Projectiles should be element-tinted blobs**, not crisp geometric shapes. Fire = red splotches, ice = blue shards, lightning = jagged white-yellow lines.
- **Name+HP chip = floating text, no plate.** Drop the boxed health UI.
