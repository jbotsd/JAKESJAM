# JAKESJAM — Particle Texture Prompts

**Output target:** PNG, 512×512, transparent background, generated in **white only** for runtime tinting (Phaser additive blend + tint).
**Use:** SDF-style sprite assets the VFX system samples for shard bursts, lightning forks, smoke, and sparkles. These are tiny static images blended additively in code.
**House style:** see `00-prompt-conventions.md`.

The rule: **everything is white on transparent.** Phaser's `setTint()` and `BLEND_ADD` handle the colour. If you generate any of these in colour, you double-tint at runtime and lose readability.

## Texture 1 — Sparkle (4-point star)

**Use:** muzzle flashes, pickup-collected pop, crystal-shard bursts.
**Dimensions:** 512×512.

```
Pure white 4-point star sparkle on transparent background, the four points are sharp and thin needles radiating along vertical and horizontal axes from a small bright central disc, the centre disc is a soft white bloom that fades to transparent at the edges, the four needles are 1-2 pixels wide at their base and taper to nothing at the tips, the entire shape fits within a 512x512 canvas with the centre at exact middle, no colour anywhere only pure white and transparent, hyper-clean SDF style sprite, 512x512

no text, no colour, no other shapes, no background, no fantasy stars, no anime, no JPEG artifacts, no low resolution
```

## Texture 2 — Crystal Shard

**Use:** hit bursts, death rings, bounce mini-bursts.
**Dimensions:** 512×512.

```
Pure white elongated crystal shard sprite on transparent background, the shard is a sharp four-sided diamond/lozenge shape pointing along the vertical axis, the body of the shard is a soft white inner glow that fades to a brighter 1-pixel white outline tracing the silhouette, faint internal facet seam down the centre vertical, the shape fits within a 512x512 canvas centred, no colour anywhere only pure white and transparent, hyper-clean SDF style sprite, 512x512

no text, no colour, no other shapes, no background, no fantasy crystals with multiple gems, no anime, no JPEG artifacts, no low resolution
```

## Texture 3 — Smoke Puff

**Use:** explosion residue, fire patches, post-death fade.
**Dimensions:** 512×512.

```
Pure white soft volumetric smoke puff sprite on transparent background, the puff is a roughly circular soft white cloud with subtle internal density variation suggesting volumetric depth, the edges fade smoothly to transparent over about 30% of the radius, no hard outline only soft falloff, the shape fits within a 512x512 canvas centred, slight asymmetric organic variation in the puff outline, no colour anywhere only pure white grey transparent, hyper-clean particle sprite, 512x512

no text, no colour, no other shapes, no flames, no background, no anime, no realistic smoke photo, no JPEG artifacts, no low resolution
```

## Texture 4 — Lightning Fork

**Use:** Voltaic Spark trails, pierce-chain glyph, Cataclysmic Prism arcs.
**Dimensions:** 512×512 (rendered as a wide thin strip in usage — texture is square for atlas convenience).

```
Pure white jagged lightning fork sprite on transparent background, the lightning is a single primary zig-zag bolt running vertically from top to bottom of the canvas with three smaller branching forks splitting off at irregular angles, the bolt is 2-3 pixels wide at its core with a soft 4-pixel white outer glow on either side fading to transparent, sharp angular bends not curves, no colour anywhere only pure white and transparent, the shape uses about 60% of the canvas width centred horizontally, hyper-clean SDF style sprite, 512x512

no text, no colour, no other shapes, no background, no realistic lightning photo, no anime, no JPEG artifacts, no low resolution
```

## Texture 5 — Soft Glow Disc (already procedural-friendly, but keep a sprite as backup)

**Use:** projectile point lights, palm-projector halo, fire patch base.
**Dimensions:** 512×512.

```
Pure white soft circular glow disc on transparent background, the centre is bright opaque white that fades smoothly with a Gaussian-like falloff to fully transparent at the edge of the canvas, no hard outline at any radius, perfectly radially symmetric, the shape fills the full 512x512 canvas with the brightest point at exact centre, no colour anywhere only pure white and transparent, hyper-clean light sprite, 512x512

no text, no colour, no other shapes, no background, no rays, no anime, no JPEG artifacts, no low resolution
```

## Texture 6 — Faceted Hex Glyph

**Use:** explosive impact glyph, slow-field ripple, draft-card pick wipe.
**Dimensions:** 512×512.

```
Pure white hexagonal frame sprite on transparent background, the hexagon is a hollow regular six-sided polygon outline, the stroke is 4 pixels wide with a soft 6-pixel outer glow fading to transparent, the centre is hollow and fully transparent, the hexagon fills about 80% of the 512x512 canvas centred, faint inner secondary hexagon at 50% scale with 1px stroke, no colour anywhere only pure white and transparent, hyper-clean SDF glyph sprite, 512x512

no text, no colour, no fantasy runes inside, no other shapes, no background, no anime, no JPEG artifacts, no low resolution
```

## Texture 7 — Triskelion Glyph (sticky impact)

**Use:** sticky impact glyph (`Sticky Shards`, `Sticky Ray`).
**Dimensions:** 512×512.

```
Pure white triskelion symbol sprite on transparent background, three identical curved arms spiralling outward from a small central disc with 120-degree rotational symmetry, each arm starts thick at the centre and tapers to a sharp point at the outer end, soft 4-pixel white outer glow tracing each arm, the entire shape fills about 70% of the 512x512 canvas centred, no colour anywhere only pure white and transparent, hyper-clean SDF glyph sprite, 512x512

no text, no colour, no Celtic knot, no fantasy, no anime, no other shapes, no background, no JPEG artifacts, no low resolution
```

## Selection Notes

These seven textures cover the full VFX system's needs at MVP. Rebrand priorities if budget is tight:

1. **Required:** sparkle, crystal shard, soft glow disc — these are used by every projectile and hit.
2. **Highly desired:** smoke puff, lightning fork — these gate the visual identity of the explosive and lightning element families.
3. **Polish:** faceted hex glyph, triskelion — these elevate impact reads but the VFX still works without them (replace with a circle particle).

Generate at 512×512, but render at 32-64px in-game depending on the VFX. The high resolution means trail-blur stays crisp at all viewport zooms.

If your generator refuses to produce pure-white-on-transparent (some Midjourney runs default to soft pastels), generate on a flat mid-grey background, then key out the grey in any background-removal tool. The white-only constraint is non-negotiable for runtime tinting to work.
