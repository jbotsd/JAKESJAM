# JAKESJAM — Art Direction

**Version:** 0.3 (gnostic-vessel silhouette pivot)
**Status:** Locked. Character silhouette superseded 2026-07-06 — see "Gnostic Vessel Silhouette Spec" below. Arena/palette/VFX sections from v0.2 (cyberpunk-sorcerer pivot, 2026-05-02) still hold; only the character's proportions and the source of its "sorcerer" identity changed.
**Date:** 2026-05-02 (character section revised 2026-07-06)

## Title / Concept

**Crystal-tech wizards in a geometric arena. Cartoon-meaty hits, professional UI.**

JAKESJAM is a browser 2D arena platform shooter pivoting to an always-on world with a rogue-lite card draft. The fiction is **cyberpunk sorcerers / techno-mages** — exoskeleton-clad casters who fire faceted "crystal rounds" from palm-mounted projectors. Not robe-and-staff fantasy. The visual language pairs **geometric-minimal arenas** (Geometry Wars / SUPERHOT colour blocks) with **cartoon-meaty Vlambeer juice** (chunky particles, freeze frames, screen shake). Tone is serious-competitive, but punchy. The camera takes the fight seriously; the hits laugh.

## Reference Moodboard

Ten references, each with the specific thing we are stealing.

- **Nuclear Throne** — hit juice. The tiny actor, the chunky shard burst, the freeze frame on connection. Our impact rule of "12-24 chunky shards + 50ms freeze + 4px shake" comes directly from this.
- **Geometry Wars: Retro Evolved 2** — arena clarity. Bright accent colours on a near-black field, glow-additive projectiles that read at 8px. Our background ethos.
- **SUPERHOT** — geometric reduction. Players, projectiles, and props all reducible to a few flat planes. We borrow the philosophy that *shape carries silhouette, colour carries threat*.
- **Risk of Rain 2** — spell readability under stack-pressure. RoR2 makes you read a screen with 200 active VFX by giving each item a unique trail/shape signature. Our card-axes table is built the same way.
- **Hyper Light Drifter** — crystal-tech glyph language. Etched runes that glow on a hard sci-fi material. Our palm-projector glyphs and shoulder-crystal etchings borrow this exact treatment.
- **Hades** — card draft elegance. Card-pick UX that feels weighty, animated, expensive. Our draft-pick radial wipe and glow pulse are calibrated to this register.
- **Furi** — boss-mode silhouette. When a player picks up a boss-core they should read the way Furi bosses do: bigger, slower, halo-lit, *dangerous on sight*.
- **Mirror's Edge** — palette discipline. A handful of saturated accents on a near-monochrome base. Our themes use this rule: 1-2 hot accents per palette, not five.
- **Tron: Legacy (film)** — energy-line lighting language. Bright filaments routed across dark armour. Our rig's spine conduit and cannon energy-channel use the exact "thin glowing tube along the limb" trick.
- **JetBrains New UI / Darcula+** — UI elevation. Subtle inner glows, micro-gradients on flat fills, deeper shadows. Our "juicing pass" (see `themes.md`) is calibrated to feel like that "paid IDE" depth, not programmer-art chips.

## Gnostic Vessel Silhouette Spec (v0.3, supersedes "Wizard Silhouette Spec")

**UI / shell extension:** character silhouette is only half the language. Menus, panels, dual accent (Autogenes gold house vs crystal cyan combat), and withdraw-not-ascend motion are specified in **`docs/visual-language-gnostic-vessel.md`** (feeds `docs/ui-shell-goal.md`). Do not invent a second mythology for chrome.

**Brief that drove this:** lean into a Warframe-esque read — "a ghost operating a manufactured vessel" — which is also literally what "Autogenes" (self-generated, individuated, not from pairing or inherited programming) names in the Gnostic-translation sense. Constraint: **palatable but gorgeous** — stay bipedal and readable, don't collapse into an alien mess; keep the rendering rich/premium. Research spine: Autogenes Editions / Nag Hammadi fidelity work (Allogenes *anachōrei* = withdraw; keep *gnosis/archon/ousia* un-flattened as *form*, not UI copy).

The character is the `ProceduralPlayerRig` (`client/src/game/rendering/ProceduralPlayerRig.ts`, two-bone IK, spring-damped "wobbly" foot IK for secondary motion, per-player tinted). Unlike the old spec, there is **no separate overlay pass** — the previous `wizardOverlay.ts` was written but never wired in (dead code, now deleted); every visual element below is drawn inline by the rig itself, which is the only file that determines the on-screen look. The rig stays small (~30-60px tall in play) and noticeably **leaner** than the old "chunky armored" build — a manufactured shell, not a tank.

Parts, top to bottom (all inline in `ProceduralPlayerRig.ts`):

- **Visor seam.** Replaces the old thick "eye-slit" with a longer, narrower line of light — less helmet-visor, more "the vessel's face is a seam of light." Colour is the rig's `accentColor` (see cosmetic hook below), shifting to a warning red below 25% health. Pulses gently at idle.
- **Slimmed hood/hull.** Narrower trapezoid than the old helmet build — reads as a sealed vessel hull, not hard armor plating.
- **Spine energy conduit.** A glowing filament from pelvis to chest — the "I'm alive"/"self-generated" signal: dim when low health, bright when full. Unchanged in concept from the old spec, tuned brighter as the character's core identity motif.
- **Crystal joint stubs.** Small faceted accents at the shoulder and — unchanged from the old spec's ankle-stub idea — reads as manufactured joint seals rather than armor bolted on.
- **Palm-projector glow + energy-channel cannon.** Unchanged in concept: an additive glow at the lead hand, brightening on fire, with a thin energy channel running the "barrel" — now on a slimmer cannon body to match the leaner limbs.

**Cosmetic accent hook.** `accentColor` (constructor option on `ProceduralPlayerRig`, default crystal cyan `0x8ff8ff`) is the single seam every glow element (visor, spine, shoulder crystal, cannon channel/muzzle) reads from. This is the plug-in point for paid cosmetic skins (e.g. an "Autogenes" tier: gold/teal accent echoing the Autogenes Editions palette) — swap the color, not the geometry. Purely visual; the sim never reads it.

**Per-player tint** (the existing `color` option) still drives the primary body/hood/limb color, unchanged from the old spec. There is no live "active theme" system reaching the rig (confirmed absent codebase-wide) — the old spec's "active theme drives the accent" line was aspirational and never built; `accentColor` today is set once per rig instance, not swapped at runtime by a global theme.

## Spell Readability Rules

Every card produces a projectile readable at-a-glance through a **five-axis visual signature**: shape (delivery+round bucket), colour (element bucket), trail style (trajectory bucket), size (damage tier), glyph overlay (impact bucket). The card catalog in `client/src/sim/data/cards.ts` already encodes the underlying axes via `buckets[]` — this table is the visual mapping.

### Shape — drives "what kind of round"

| `ProjectileShape` | Card example | Visual signature |
|---|---|---|
| `circle` | Circle Rounds, Magnet Spray | Solid filled disc + 1px ring. Reads as a clean round. |
| `triangle` | Triangle Rounds, Seeker Facets | Equilateral facing velocity, sharp leading vertex. |
| `square` | Square Rounds, Bouncy Prism | Axis-aligned (no rotation) so bounces feel architectural. |
| `hexagon` | Crystal Volley, Arc Shards | Faceted; the "default crystal" silhouette. |
| `orb` | Orby Blap Blap, Cluster Bomb | Larger than circle; has a soft outer halo. |
| `x` | X Rounds | Two crossed bars; reads as a damage marker. |
| `bar` | I Rounds, Needle Hose | Long thin rectangle aligned to velocity. |

### Colour — drives "what element"

Mapped per active theme (see `themes.md` § Per-Theme Element Overrides). Defaults shown for **Crystal Cyan**:

| Element | Colour token | Crystal Cyan default |
|---|---|---|
| `crystal` (default) | `element.crystal` | `#8ff8ff` (cyan-white) |
| `neutral` | `element.neutral` | `#ddd6fe` (pale violet) |
| `fire` | `element.fire` | `#ff7a18` (molten orange) |
| `ice` | `element.ice` | `#93c5fd` (ice blue) |
| `lightning` | `element.lightning` | `#fef08a` (electric yellow) |
| `void` | `element.void` | `#a78bfa` (deep violet) |
| `radiant` | `element.radiant` | `#fefce8` (white-gold) |
| `electric` | `element.electric` | `#67e8f9` (alias of lightning, paler) |
| `toxic` | `element.toxic` | `#86efac` (acid green) |
| `sticky` | `element.sticky` | `#f97316` (warm amber) |
| `explosive` | `element.explosive` | `#fb7185` (hot pink-red) |

### Trail — drives "what trajectory"

| `ProjectilePathing` | Trail style |
|---|---|
| `straight` | 6-frame fading line of the projectile colour, 0.5× width. |
| `gravity` | Same as straight, but trail droops with velocity. |
| `bounce` | Trail brightens by +20% saturation on each bounce; small ring particle at the bounce point. |
| `boomerang` | Two-tone trail — outbound in projectile colour, return leg in accent. |
| `homing` | Curved trail with 3 small "tracking" sparkles offset perpendicular. |
| `anti-homing` | Trail with a faint negative-space gap between projectile and its trail head. |
| `float` | Slow-drifting orbit-sparkles around the projectile (no directional trail). |
| `accelerate` | Trail length scales with speed; trail thickens as projectile accelerates. |

### Size — drives damage tier

Projectile radius (already authored in card data via `sizeMultiplier`) maps to a coarse 4-tier glow:

| Damage tier | Render scale | Outer glow radius |
|---|---|---|
| Tiny (`<0.8×`) | 1× sprite | 1.5× sprite |
| Standard (`0.8-1.2×`) | 1× sprite | 2× sprite |
| Heavy (`1.2-1.5×`) | 1× sprite | 2.5× sprite + 1px stroke |
| Massive (`>1.5×`, e.g. Cataclysmic Prism) | 1× sprite | 3.5× sprite + 2px stroke + slow rune halo |

### Glyph — drives impact behaviour

Each `ProjectileImpact` flashes a single faceted rune at impact, regardless of element/shape:

| Impact | Glyph | Shown for |
|---|---|---|
| `none` | (no glyph, just the shard burst) | default |
| `explosive` | Hexagonal ring expanding then fading | Explosive Facet, Cataclysmic Prism |
| `sticky` | Small triskelion (3-armed spiral) pulsing | Sticky Shards, Sticky Ray |
| `pierce-chain` | Two-line chevron pointing along velocity | Pierce Chain, Voltaic Spark |
| `slow-field` | Concentric circle ripple, slow ease-out | Slow Field, Frost Prism, Continuous Refractor |

A player who has never read this table should still be able to look at any card art and the live projectile and match them by shape + colour alone. The glyph is the bonus that confirms the kill cause.

## VFX Juice Rulebook

Quantified, implementation-ready. Every number here is a constant a future agent can drop into the rendering layer.

- **Hit shake** — `4px` amplitude, `80ms` duration, ease-out. Stacks additively up to a `12px` cap. Skip on multi-hit cascades within the same 80ms window (only the first hit shakes).
- **Freeze frame on hit confirmation** — `50ms` global pause. Skip on multi-hit cascades (apply once per `hit-confirmed` event burst). Apply on parry-deflected too.
- **Particle burst per hit** — 12-24 chunky shards (count scales with damage), radiating from impact point at 200-400 px/s, with the projectile's element colour. 250ms lifetime, ease-out alpha.
- **Death** — `36-shard` ring at the player position + a single bright crystal-tech rune flash at 3× projectile size, 320ms total, then a fading silhouette ghost (the rig drawn at 30% alpha) for 600ms.
- **Draft card pick** — radial wipe outward from the picked card (240ms), white-additive glow pulse around the card frame (180ms), other cards fade to 40% alpha. On confirm: brief screen flash at 8% alpha in the active theme accent.
- **Round end** — camera pulls back 10% over 600ms, a single chromatic-aberration pulse (max 6px, 220ms) flashes on the winner. Loser's wizard dims to silhouette.
- **Muzzle flash** — 1-frame (16ms) bright additive disc at the palm projector, scaling with damage tier (5-12px radius), then a 60ms fade.
- **Bounce ping** — 4-shard mini-burst at the bounce point, no shake, no freeze.
- **Pickup collected** — 8-shard rising burst in the pickup's colour, 300ms lifetime, "pop" scale on the picker's energy filaments.

## Lighting Plan

2D dynamic lights — spells cast real light into the scene. The arena is dark-base (theme bg colour at full saturation), and every active light is additive on a separate render layer.

- **Projectile light** — point light, radius `~80px`, intensity = `0.3 + 0.4 × damageTier`. Colour = projectile element colour. Travels with the projectile. Cheap: small additive sprite, no shadow casting.
- **Muzzle flash light** — 1-frame intense punctate pulse at the palm projector, radius `~120px`, intensity `1.0`, then exponential decay to 0 over 80ms.
- **Fire patches** — warm orange flicker. 2 lights per patch — a static base (radius `~60px`, intensity `0.5`) and a small jitter light (radius `~20px`, intensity `0.3`, position jittered by ±4px at 20 Hz).
- **Boss-mode player** — heavy halo, radius `~180px`, intensity `0.6`, the active theme accent colour. Pulses at 0.5 Hz.
- **Sudden-death shrink boundary** — a glowing perimeter line, 2px stroke + 8px outer glow, in the active theme's `danger` colour. Pulses at 1 Hz when shrinking.
- **Player energy filaments** — small (radius `~12px`) additive light at the chest, intensity scales with health (`0.2 + 0.3 × healthRatio`). Goes red-shifted when below 25%.

## Asset Pipeline

Strict split between code-generated and AI-generated. Code owns the moving parts; AI owns the static chrome.

**Code-generated (procedural, no asset files):**
- Procedural player rig (already lives in `ProceduralPlayerRig.ts`)
- Wizard overlay accents (hood, energy bands, palm glow, crystal stubs, filaments) — to be implemented per `docs/asset-prompts/05-character-overlay-spec.md`
- All projectiles + trails + glyph overlays (Phaser Graphics primitives, tinted per theme/element)
- All particle systems (shard bursts, fire, dust, halos)
- All dynamic lights (additive sprites on a lights layer)
- Screen shake, freeze frame, chromatic aberration
- Theme retinting at runtime
- HUD layout (numbers, bars) — values rendered by code, frame chrome supplied by AI

**AI-generated (PNG assets, loaded by Phaser):**
- HUD chrome (frame brackets, score badges, round-timer ring, weapon-card chips)
- Menu backdrops (splash, lobby, results)
- Card art templates (one per bucket, used as a frame around per-card iconography)
- Logo / wordmark
- Particle textures (sparkle, smoke, crystal-shard, lightning-fork SDF sprites)
- Future: theme-specific background loops (held until after MVP)

The user is comfortable generating assets via Midjourney v7 / SDXL / Recraft / ChatGPT image. They are *not* comfortable in Figma / Photoshop / Illustrator. Every prompt in `docs/asset-prompts/` is therefore paste-ready and produces output usable without manual editing beyond background-removal / cropping.

## What We Are NOT

Explicit anti-patterns. If a draft asset reads like any of these, reject it.

- **Not fantasy-medieval.** No robes, staves, pointy hats, scrolls, leather, parchment, dragons, runes-on-stone. Glyphs etched in glow on hard sci-fi material only.
- **Not anime / moe.** No big eyes, no chibi proportions, no soft cel-shaded faces. The visor slit is the *only* facial element.
- **Not realistic gore.** Hits emit crystal shards, not blood. Deaths emit a rune flash, not a corpse.
- **Not flat-vector hipster.** No Dribbble pastel illustration, no "tech startup mascot" cleanliness. Our flat fills carry juicing-pass micro-gradients and glow.
- **Not chiptune retro pixel.** No 8-bit sprites, no NES palette, no scanlines — *unless* deliberately invoked as a future opt-in theme. Default look is high-fidelity geometric.
- **Not Soldat / industrial-scrap.** The v0.1 art-direction.md called for "olive teal charcoal rust scrap" — that direction is dead. Crystal-tech replaces it.
- **Not toy-flat.** Surfaces have depth — micro-gradient, inner glow, faint shadow. Programmer-art rectangles are forbidden in shipped UI.
- **Not desaturated.** The world is dark; the *action* is saturated. If a screenshot reads grey, the saturation pass failed.
