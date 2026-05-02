# Current Visual State — Audit

Snapshot of where our game's graphics live RIGHT NOW, mapped against the ROUNDS reference. Use this to know what to tear out vs. keep.

## Files that own the look

| File | LOC | Owns |
|---|---|---|
| `client/src/game/scenes/MatchScene.ts` | 2894 | Arena BG, platforms, players, projectiles, HUD chips, status VFX |
| `client/src/game/scenes/DraftScene.ts` | 260 | Between-round card pick UI |
| `client/src/game/render/RenderLayer.ts` | — | Generic graphics/rect/circle/tween calls (extracted in D) |
| `client/src/game/systems/DestructibleRenderer.ts` | — | Destructibles (crates etc.) |
| `client/src/game/systems/RemotePlayerManager.ts` | — | Remote rig sync |
| `client/src/game/systems/ParticlePool.ts` | 202 | Pre-allocated spark/shard/ring/bolt pools |
| `client/src/game/systems/StatusVfxController.ts` | 212 | Sim-state-driven burn/freeze/chain VFX |
| `client/src/game/ui/cardIcons.ts` | 454 | 7 bucket-glyph icons (geometric, no art) |
| `client/src/game/ui/elementColors.ts` | 20 | `ELEMENT_COLORS` const + `NEUTRAL_ELEMENTS` set |
| `client/src/game/ui/CardDraftOverlay.ts` | — | In-match online draft overlay |
| `client/src/game/ui/HudCompositor.ts` + `HudSystem.ts` | — | HP/ammo/status chips |
| `client/src/game/ui/RoundBanner.ts`, `DeathOverlay.ts`, `MatchResultsOverlay.ts` | — | Between-state messages |

## Current palette (extracted from `MatchScene.ts`)

| Token | Hex | Role | ROUNDS verdict |
|---|---|---|---|
| Arena BG | `#0B0E14` | Match background fill | ✅ Close to ROUNDS void — keep, push slightly cooler/teal |
| Grid lines | `#111722` / `#1F2A3A` | Decorative grid overlay | ❌ **Drop entirely** — ROUNDS has no grid, just void |
| Floor platform | `#354054` | Solid floor fill | ❌ **Replace** — slate blue, no texture, no painterly wash |
| Soft platform | `#2A3242` | Other platforms | ❌ **Replace** — same problem |
| Platform stroke | `#56647C` | Outline | ⚠️ ROUNDS platforms have no stroke, two-tone fill instead |
| HUD plate | `#07101C` @ 0.84α | Chip background plates | ❌ **Drop plates** — ROUNDS HUD is plate-less typography |
| HUD accent | `#50E3C2` | Cyan brand accent | ✅ Keep — close to ROUNDS draft cyan |
| Element fire | `#FF7A18` | Fire tint | ⚠️ Slightly orange-shift; ROUNDS uses ~`#FFB347` for halos |
| Element ice | `#93C5FD` | Ice tint | ✅ Good |
| Element lightning | `#FEF08A` | Lightning core | ✅ Good |
| Status chip orange | `#FB923C` | Damage amp chip | — Used on debuff chips |
| Status chip pink | `#FB7185` | Vulnerability | — |

## Gaps vs. ROUNDS reference (rolled up from refs 01-04)

### Arena (refs 01, 02, 03)
- ❌ **No painterly platform texture.** Solid slate fills. Need watercolor/brush-streak overlay.
- ❌ **Grid overlay fights aesthetic.** ROUNDS = pure void.
- ❌ **No atmospheric backdrop.** No far-BG cloud wash, no light beams.
- ❌ **Platforms are not chunky/asymmetric polygons.** Currently grid-aligned rectangles.
- ❌ **No two-tone shading on platforms.** Flat fill = no implied dimension.
- ❌ **No arena-specific gimmicks.** ROUNDS Refs 01/03 each have memorable structural ideas (suspended cubes, painterly green isles).
- ✅ **Background base color is close** — `#0B0E14` is in the ballpark of `#06181C`.

### Players (ref 01)
- ⚠️ **Rigs are too detailed** — ROUNDS character is a circle + 4 sticks. Our rigs use multiple shapes per limb.
- ❌ **HP/name uses boxed plate** — ROUNDS uses pure floating typography with thin lime underline.
- ⚠️ **Movement trail exists in sparks but not body-color trail.** ROUNDS shows ~6 sparse body-color dots.

### Projectiles & VFX (refs 01, 02)
- ⚠️ **Projectiles are crisp geometric shapes**, not blob clusters.
- ⚠️ **Explosions are single sprites/circles**, not 3-5 stacked soft additive circles.
- ❌ **No radial spike overlay on big blasts** (16-spike star burst from ref 02).
- ❌ **No platform-warm-tint reaction** to nearby explosions.
- ❌ **No light-beam rays** from off-screen for atmosphere.
- ✅ **ParticlePool exists** — infrastructure ready for more spark/ember work.
- ✅ **StatusVfxController is sim-state-driven** — burn/freeze/chain already correct.

### HUD (ref 03)
- ❌ **Ammo/cooldown rendered as bars**, not dot rows.
- ❌ **Build summary uses card-thumb row**, not 2×N pill grid with letter abbreviations.
- ✅ **Active-status chip system exists** — close to ROUNDS, just needs plate removal.

### Draft Screen (ref 04 — **★ biggest miss**)
- ❌ **No hero character.** Blank dark BG with cards floating.
- ❌ **No corner-bracket card frames.** Uses full `setStrokeStyle` borders (rarity-tinted).
- ❌ **Title sits inside card** instead of floating above.
- ❌ **No themed creature icons** — only 7 bucket-glyphs (geometric, generic).
- ⚠️ **Hover tween exists** (scale 1.05) but missing lift + tilt.
- ❌ **No DOF-blurred MatchScene backdrop.**
- ❌ **No light-source prop** (lamp/orb).
- ⚠️ **Stat hierarchy uses "BENEFITS:" header** — ROUNDS just uses color + `+`/`-` prefix, no header.
- ⚠️ **3 cards** — ROUNDS shows 5. Decision: keep 3 for game-jam scope or expand.
- ❌ **No thematic draft groups** — `CardSystem.generateDraftChoices` rolls 3 random.

## Verdict

We have the **plumbing** (sim-driven VFX, particle pool, element colors, card system, draft scene scaffolding). We're missing the **art direction layer** — texture, atmosphere, character, and the specific ROUNDS visual grammar (corner brackets, painterly washes, blob projectiles, plate-less HUD typography, hero presenter).

**The overhaul is 80% asset & shader work, 20% code restructure.** Most code paths already exist; they just render the wrong thing.
