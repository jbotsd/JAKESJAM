# JAKESJAM — Character Overlay Spec (Hand-Off to phaser-coder) [SUPERSEDED]

**Superseded (2026-07-06).** The `wizardOverlay.ts` this spec described was written but never wired into any scene — it was dead code. Its ideas (hood/visor, energy bands, palm glow, crystal stubs, spine filaments) were independently and more roughly reimplemented *inline* in `ProceduralPlayerRig.ts` itself, which is the file that actually draws every player on screen. Rather than maintain two half-finished parallel systems, `wizardOverlay.ts` has been deleted and its accent-color parameter (`accentColor`, defaulting to crystal cyan) was folded directly into `ProceduralPlayerRig`'s constructor options — see that file's top-of-file doc comment for the current ("gnostic vessel," Warframe-esque) design direction. This doc is kept for historical context only; do not implement against it.

**This file is NOT for AI image generation.** It is a written implementation spec for the cyberpunk-sorcerer overlay that draws on top of the existing `ProceduralPlayerRig` (`client/src/game/rendering/ProceduralPlayerRig.ts`).

The procedural rig stays as-is. This overlay is layered on top in the same `Phaser.GameObjects.Graphics` draw pass (or a sibling Graphics object) and uses values already computed by the rig (head position, chest position, hand positions, facing, aim angle).

## Goals

1. Make every player read as a **cyberpunk sorcerer / techno-mage**, not a stick figure.
2. Preserve silhouette readability at 30-60px tall.
3. React to per-player tint, active theme accent, and active element buffs.
4. Cost <0.3ms per player per frame on the render thread.

## Drawn Parts

All parts are drawn in `ProceduralPlayerRig.draw()` after the existing rig limbs/body but before the nameplate. They use the same `graphics` instance.

### 1. Hooded Sci-Fi Visor (replaces existing face)

Replaces the current `drawFace` call.

- Geometry: A **trapezoid hood** drawn from the head circle's top centre, widening as it descends, terminating just below the head circle's vertical centre. Hood points slightly toward `facing`.
- Fill: `tintShade(playerColor, -0.35)` — darker shade of player tint.
- Stroke: 1px in `tintShade(playerColor, -0.55)`.
- **Eye-line slit**: a horizontal rectangle across the head circle at the eye height (`head.y - 2 * scale`), `8 * scale` wide × `1.5 * scale` tall. Slit position offsets toward `facing` by `2 * scale`.
- Slit fill: `accentColor` (active theme `accent.primary`) at full alpha.
- Slit additive glow: a 2px-blur shadow sprite at `alpha 0.6`, same colour.
- When player has an active element buff (`*UntilTick > tick`), slit colour temporarily shifts to that element's `theme.colors.element[elementId]` for 400ms after each shot.

### 2. Upper-Arm Energy Bands

Drawn around each upper arm (where `solveTwoBone` gives the joint position).

- Geometry: Two thin filled rings centred on the upper-arm midpoint, oriented perpendicular to the upper-arm bone direction. Outer ring `4 * scale` radius, inner ring `2 * scale` radius (the band is the area between them).
- Fill: `accentColor`.
- **Pulse animation**: alpha lerps between `0.5` and `0.9` at `0.5 Hz` idle, `2 Hz` while `fireCooldownMs > 0` (i.e. just fired).
- Skip on the back arm if it would obscure the body (z-order check: only draw if `backArmJoint.x` is on the visible side of the chest given facing).

### 3. Palm-Projector Glow (replaces existing muzzle dot)

Replaces the existing `g.fillStyle(0xffd166, 1); g.fillCircle(muzzle.x, muzzle.y, 3 * scale);` line in `drawGun`.

- Geometry: An additive disc at the lead hand position (`handLead`).
- Radius: `5 * scale + (damageTier * 0.5 * scale)` where `damageTier` = 0..3 from the active weapon build.
- Fill: `accentColor` at alpha `0.9`.
- Outer additive halo: same colour, radius `2× disc`, alpha `0.3`.
- **On fire** (when `fireCooldownMs` was just reset): scale lerps from `1.6×` to `1.0×` over 80ms. A 1-frame brighter pulse spawns a small additive sprite at the muzzle, decoupled from the rig.

The "gun line" between hand and muzzle should also retint to `accentColor` instead of the current white — this is the energy filament forming the projector arm.

### 4. Crystal Shoulder & Ankle Stubs

- Geometry: Small filled hexagons (`3-4 * scale` radius) drawn at:
  - Lead shoulder (use `shoulderLead`)
  - Each ankle (use `leftFoot.y - 2 * scale` and `rightFoot.y - 2 * scale`)
- Fill: `tintShade(playerColor, +0.15)` (slightly brighter than player tint).
- Stroke: 1px white at alpha `0.5` along the upper edge, 1px black at alpha `0.5` along the lower edge — gives the faceted look.
- **Reactive glow**: hexagon centre additive glow when relevant buff active:
  - `overchargeUntilTick > tick` → shoulder hex glows `accentColor` at alpha `0.6`
  - `speedBoostUntilTick > tick` → ankle hexes glow `accentColor` at alpha `0.6`
  - `bossModeUntilTick > tick` → all three glow at alpha `0.8` and add a `12 * scale` halo

### 5. Spine Energy Filaments

- Geometry: Two parallel 1px lines along the spine, from `pelvis` to `chest`, offset perpendicular to the spine by `±1 * scale`.
- Stroke: `accentColor` at alpha `0.4 + 0.4 × healthRatio` (where `healthRatio = health / maxHealth`).
- When `health < 0.25 × maxHealth`: stroke lerps to `theme.colors.accent.danger` at alpha `0.7`, with a `2 Hz` flicker.
- On hit (when `health` decreased this frame): flash the filaments to white at alpha `1.0` for 1 frame.

## Helper Functions

Implement in a new file `client/src/game/rendering/wizardOverlay.ts`:

```ts
export function tintShade(baseHex: number, deltaLuminance: number): number;
// Adjusts the luminance of an RGB hex by deltaLuminance in [-1, 1].

export function drawHood(g: Graphics, head: Vec2, facing: -1 | 1, scale: number, color: number): void;

export function drawVisorSlit(g: Graphics, head: Vec2, facing: -1 | 1, scale: number, accent: number, alpha: number): void;

export function drawArmBand(g: Graphics, midpoint: Vec2, perp: Vec2, scale: number, accent: number, pulseAlpha: number): void;

export function drawPalmProjector(g: Graphics, hand: Vec2, scale: number, accent: number, damageTier: number, firePulse: number): void;

export function drawCrystalHex(g: Graphics, center: Vec2, scale: number, baseColor: number, glowAccent: number | null, glowAlpha: number): void;

export function drawSpineFilaments(g: Graphics, pelvis: Vec2, chest: Vec2, scale: number, accent: number, healthRatio: number, hitPulse: boolean): void;
```

## Theme Hookup

The overlay reads `accentColor` from `getActiveTheme().colors.accent.primary` at draw time. When the user swaps themes via the Options menu, the next frame draws with the new accent — no manual refresh needed.

The overlay registers itself as a `ThemeAware` system (see `docs/themes.md` § Implementation Hint) so cached colour values (e.g. precomputed hood shade) recompute on theme change.

## Performance Budget

| Cost item | Per player | Per 10 players |
|---|---|---|
| Hood (1 trapezoid + stroke) | 0.02ms | 0.2ms |
| Visor slit (1 rect + glow shadow) | 0.02ms | 0.2ms |
| Arm bands (2 rings × 2 arms) | 0.04ms | 0.4ms |
| Palm projector (disc + halo) | 0.02ms | 0.2ms |
| Crystal hexes (3 hexes + reactive glow) | 0.04ms | 0.4ms |
| Spine filaments (2 lines + flicker) | 0.02ms | 0.2ms |
| **Total** | **~0.16ms** | **~1.6ms** |

Comfortably under the 0.3ms-per-player target. If perf bites later, the cheapest cut is the spine filaments (replace with a single line) followed by the crystal hexes (skip ankles).

## Acceptance Criteria

- Two players in the same arena, different per-player tints, are instantly distinguishable by hood colour.
- A player with `overchargeUntilTick > tick` shows a glowing shoulder hex visible from across the arena.
- Theme swap in the Options menu retints all overlays on the next frame without a reload.
- At 30px tall, the silhouette still reads as "humanoid with hood + palm glow".
- At 60px tall, all five overlay parts are individually legible.
- No frame drops vs the bare `ProceduralPlayerRig` baseline (60 fps stable on a 1v1 reference machine).
