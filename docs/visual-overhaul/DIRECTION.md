# Visual Overhaul — Direction & Roadmap

**TL;DR:** Adopt ROUNDS' visual grammar end-to-end. Void-black arenas, painterly polygon platforms, plate-less HUD typography, blob-cluster projectiles, stacked-additive explosions, and — the biggest swing — a hero-presenter DraftScene with cyan-bracket cards and themed creature icons.

This doc is the synthesis. For per-image detail see `refs/01..04-*.md`. For audit of what we have see `CURRENT-STATE.md`. For exact hex tokens see `PALETTE-TOKENS.md`.

---

## Pillars (in priority order)

### Pillar 1 — DraftScene rebuild ★ (biggest visible win)
**Why first:** Players see the draft every round. It's the highest-frequency, highest-impact UI surface, and it's currently the weakest. Ref 04 gives an almost pixel-precise spec.

**What to build:**
1. **Hero presenter** — large player sprite anchored bottom-center, holds the currently-hovered card. Reactive expressions (3 states: angry / neutral / smug) tied to `playerBehind`/`playerAhead`/`even` from existing `DraftSceneInitData`.
2. **Cyan corner-bracket card frames** — replace `setStrokeStyle(5, rarity)` with 4 L-shape Graphics calls. Rarity tints the bracket only.
3. **Title floats above card** — move from inside-frame to a y-offset of `-cardHeight/2 - 14`.
4. **Hover tween** — scale 1.1 + lift 20px + 3° forward tilt. Currently scale 1.05 only.
5. **Dim inactive cards** to 50% alpha; only hovered/selected card is full-bright.
6. **Themed icon art panel** — replace bucket-glyph with creature/object illustration. Bucket-glyph stays as fallback only.
7. **Stat hierarchy** — drop "BENEFITS:"/"TRADEOFFS:" headers. Just two lines: lime `+`, coral `-`. Matches ref 04 exactly.
8. **DOF-blurred backdrop** — capture last MatchScene frame to RenderTexture, apply blur (or use a static brick wash placeholder until pipeline ready).
9. **Lamp orb prop** bottom-left for ambient warm fill.
10. **Thematic draft groups** — bias `CardSystem.generateDraftChoices` to share a trigger (block/hit/kill) for narrative cohesion.

**Code touch points:**
- `client/src/game/scenes/DraftScene.ts` (260 LOC → ~400)
- `client/src/game/ui/cardIcons.ts` (extend `drawBucketIcon` with optional themed-icon variant)
- `client/src/game/systems/CardSystem.ts` (group-bias in `generateDraftChoices`)
- NEW: `client/src/game/ui/HeroPresenter.ts` (hero rig + expression state machine)
- NEW: `client/src/game/ui/CardBracketFrame.ts` (L-shape Graphics renderer)

### Pillar 2 — Arena painterly upgrade
**Why second:** Match arena is the main playfield. Worth the lift.

**What to build:**
1. **Drop the grid overlay** in `MatchScene.ts:458`.
2. **Two-tone platform shading** — top face `platformLimeHi`, side face `platformLimeMid`. Implement via a darker rectangle below the main fill, offset 4px down/right.
3. **Painterly wash overlay** — RenderTexture with 4-6 directional brush streaks at low alpha multiplied onto each platform. Either pre-bake to a texture asset or generate at scene-start.
4. **Atmospheric back layer** — 1-2 dim cloud-wash sprites (low alpha, low contrast) drifting slowly in BG.
5. **Light-beam rays** from above on key arenas — additive triangle polygons, 10% alpha, 2-3 per scene.
6. **Arena themes** — wire `ARENA_THEMES` from PALETTE-TOKENS.md into existing arena selection. Three presets: Jade Isles / Ivory Clouds / Hanging Wood.
7. **Per-arena gimmick** — pick one structural idea each (e.g. Hanging Wood = cubes on hairline tethers).

**Code touch points:**
- `client/src/game/scenes/MatchScene.ts:455-470` (BG/platform render)
- `client/src/game/render/RenderLayer.ts` (the painterly wash + light-beam helpers)
- NEW: `client/src/game/render/PlatformPainter.ts` (two-tone + wash composer)

### Pillar 3 — Projectile & explosion VFX
**Why third:** ParticlePool already exists; this is mostly a visual swap.

**What to build:**
1. **Blob-cluster projectiles** — replace solid Phaser shapes with 3-5 small additive circles slightly offset, driven by element color.
2. **Stacked explosion** — 3-5 soft circles on additive blend, scaled `[0.4, 0.7, 1.0, 1.2, 1.5]`, fading on staggered tweens (60ms apart). Layer gradient `core → mid → halo` per `PALETTE-TOKENS.md`.
3. **Radial spike overlay** for big blasts (boss/ult/killing-blow) — 16 thin rectangles fanned, varied length, dark navy outline.
4. **Persistent ember sparks** — drift up post-blast for ~600ms, fade. Reuse `ParticlePool.acquireSpark`.
5. **Platform warm-tint reaction** — 100ms additive overlay matched to blast color, on platforms within 200px of blast center.
6. **Movement trail** — sparse 6-dot body-color trail behind moving players.

**Code touch points:**
- `client/src/game/systems/ProjectileSystem.ts` (projectile render swap)
- `client/src/game/systems/StatusVfxController.ts` (extend for blast events)
- `client/src/game/scenes/MatchScene.ts:applyProjectileHits` (trigger stacked explosion)
- `client/src/game/render/RenderLayer.ts` (light-beam + tint helpers)

### Pillar 4 — HUD plate-less typography
**Why fourth:** Lower-impact polish but quick win.

**What to build:**
1. **Drop name+HP plate** — currently a boxed background; move to floating text + thin lime underline (2px, color `hpLime`).
2. **Ammo/cooldown as dot rows** — replace the existing bar with a row of 5-8 small circles. Empty/dim for spent, bright for charged.
3. **Build-summary 2×N pill grid** in top-right — each pill is a rounded rect with a 2-letter card abbreviation, lime stroke matching rarity.
4. **Status chips** — keep existing `HudCompositor` chips but drop their plate fill (transparent bg, colored 1px outline + colored text).

**Code touch points:**
- `client/src/game/ui/HudCompositor.ts`
- `client/src/game/ui/HudSystem.ts`
- `client/src/game/scenes/MatchScene.ts` (lines 1900-1930 chip definitions stay; rendering changes in HudCompositor)

### Pillar 5 — Player rig simplification [REDEFINED 2026-07-06]
**Status:** Landed, but aimed at a different target than originally specified below. The original plan (SUPERHOT-style flat reduction — single circle body, 4 thin stick limbs, 2 dot eyes) was superseded by a **Warframe-esque "gnostic vessel"** direction: a leaner biomechanical-frame silhouette, still built from the same filled-polygon torso/limb/hood/visor language as before, just slimmed down and re-tuned rather than collapsed to primitives. See `docs/art-direction.md`'s "Gnostic Vessel Silhouette Spec" for the shipped spec. This still accomplishes this pillar's actual goal (de-bulk the "chunky armored" build) without going as far as flat geometric reduction — kept because it reads as "palatable but gorgeous" rather than minimal.

**Original plan (not built, kept for history):**
1. **Body = single circle** with body-color fill + 2-3 thin white shading lines (vertical strokes per ref 01).
2. **Limbs = 4 thin sticks** with rounded ends. Currently multi-shape; collapse to `Phaser.GameObjects.Rectangle` with thin width.
3. **Eyes = 2 dot circles**. No mouth (silhouette-first).
4. **Optional: facial expression states** for damage/death/win moments only — not per-frame.

**Code touch points:**
- `client/src/game/rendering/ProceduralPlayerRig.ts` (the actual rig — confirmed the sole file that draws the character; `MatchScene.ts`/`RemotePlayerManager.ts` just feed it pose data)

---

## Asset shopping list

| Asset | Format | Purpose | Pillar |
|---|---|---|---|
| Hero portrait sprite (2 colors × 3 expressions = 6) | PNG 256×256 | DraftScene presenter | 1 |
| Lamp orb glow | PNG 64×64 | Draft warm-light prop | 1 |
| Brick-wash backdrop | PNG 1280×720 (or runtime-blur) | Draft background | 1 |
| Platform painterly wash overlays (3 themes × 4 streak variants) | PNG 256×128 | Arena texture | 2 |
| Cloud-wash atmospheric layer (2 variants) | PNG 1280×360 | BG depth | 2 |
| Themed card icons (start with top-tier 15) | PNG 128×128 | Card art | 1 |
| Sparks / ember texture | already covered by ParticlePool primitives | — | 3 |

**MVP path:** can ship Pillars 1-3 with code-generated Graphics (no PNGs) — corner brackets, hero as parametric circle/sticks, painterly wash via runtime brush-streak Graphics. Saves the asset pipeline for v2.

---

## Phased rollout

### Phase A — Code-only, ship in one branch (1-2 days)
- Pillar 1 steps 2/3/4/5/7 (bracket frames, title float, hover tween, dim inactive, stat hierarchy)
- Pillar 2 step 1 (drop grid)
- Pillar 4 steps 1/4 (drop HP plate, drop chip plates)
- All achievable with zero new assets, zero new dependencies.
- **Ship branch:** `feat/visual-overhaul-phase-a`.

### Phase B — Code + parametric art (3-4 days)
- Pillar 1 step 1 (hero presenter, parametric — circle+sticks+expression sprites)
- Pillar 1 step 6 fallback (themed icons via richer parametric Graphics)
- Pillar 2 steps 2/3/6 (two-tone platforms, runtime brush wash, arena themes)
- Pillar 3 steps 1/2/3/4 (blob projectiles, stacked explosion, spike overlay, ember persistence)
- Pillar 4 steps 2/3 (dot-row ammo, pill-grid build summary)
- **Ship branch:** `feat/visual-overhaul-phase-b`.

### Phase C — Asset-driven polish (when art is available)
- Pillar 1 step 1 (real hero sprite art)
- Pillar 1 step 6 (real themed card icons — start with 15, expand)
- Pillar 1 step 8 (real DOF-blur RenderTexture pipeline)
- Pillar 2 steps 4/5/7 (cloud washes, light beams, arena gimmicks)
- Pillar 5 (rig simplification with art validation)
- Pillar 1 step 10 (thematic draft grouping — design tuning, not art)

---

## Success criteria

- [ ] Draft screen at first glance reads as ROUNDS-adjacent, not generic-MOBA-card-screen.
- [ ] Arena BG has zero grid lines; platforms have visible painterly directional brush.
- [ ] Explosions stack 3+ soft circles on additive blend, not single sprite.
- [ ] HP/name above players uses lime underline, no plate.
- [ ] Build summary shows 2×N pill grid in corner.
- [ ] At least 2 arena themes wired through `ARENA_THEMES`.
- [ ] Hero in DraftScene reacts visibly to `playerBehind` flag.
- [ ] All hex literals in `MatchScene.ts`/`DraftScene.ts` come from `palette.ts` tokens (no inline `0x` hexes outside `palette.ts` and `elementColors.ts`).
- [ ] No regression in `bun test` (currently 126 pass).

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Painterly wash kills perf at 60fps | Pre-bake to RenderTexture once per platform, not per-frame |
| Blob projectiles hurt hit-readability | Keep collision shape unchanged; only the visual is multi-circle |
| Stacked explosions allocate `Graphics` objects | All blast circles must come from `ParticlePool` — extend pool with a `blastCircle` slot |
| DraftScene hero asset blocks Phase A ship | Phase A explicitly excludes hero rendering; ship without |
| Arena gimmicks scope-creep | One per arena, code-only physics, no new server-side state |

---

## Out of scope (defer)

- Animated cutscenes / round-intro stingers
- Full character customization (more than 2 player colors)
- Particle weather (rain, snow) — nice but post-jam
- Shader-based post-processing (bloom pass, chromatic aberration) — Phaser pipelines work but add complexity; defer until Phase C ships and we still want polish
- Audio cues for visual events — separate workstream

---

## Single source of truth

- **Refs:** `docs/visual-overhaul/refs/01..04-*.md`
- **Audit:** `docs/visual-overhaul/CURRENT-STATE.md`
- **Tokens:** `docs/visual-overhaul/PALETTE-TOKENS.md`
- **This doc:** roadmap & priorities.

When in doubt about a visual choice, the order of authority is: **ref MD → palette token → existing code**. Don't introduce ad-hoc colors or styles. If a ref is silent on a question, write the answer into a ref MD before coding it.
