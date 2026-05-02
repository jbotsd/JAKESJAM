# Ref 04 — ROUNDS: ★ THE DRAFT SCREEN ★ (highest-priority ref)

Source: `ref images/rounds/ss_fa5f178546604b676b668e0eea22684473591027.1920x1080-1777670339.jpg`

This is **the** reference for our DraftScene rebuild. Everything below should be copied with intent.

## Layout
- **Foreground hero character** dominates lower half — large, expressive, *holding* a card in its right hand. The hero IS the player; this is "your character is presenting these options to you."
- **5 cards arranged in a shallow arc** behind/above the hero. Center card is largest and tallest, edges tilt inward slightly (~5° rotation each side). Subtle perspective fan.
- **One card highlighted (right):** "FROST SLAM" — bigger, fully revealed art, brighter border, cyan accent. The other 4 are dimmer/more dormant — title visible but art hidden.
- **Light source bottom-left:** a glowing white orb on a stem (crystal/lamp prop). Casts soft warm rim light on the hero. Only one light source — the rest is moody darkness.

## Hero character (HUGE upgrade target for us)
- **Massive, cute, expressive.** Round orange body fills ~60% of frame width. Sunglasses + clenched grimace teeth + furrowed-brow eyebrows = "PISSED OFF / READY TO FIGHT."
- **Faceted shading** — body has subtle polygonal facets (low-poly shading) hinting at form without rendering. Gradient from highlight (#F5803F) to shadow (#A03C12).
- **Small expressive arms** holding the highlighted card up like a trump card.
- This is character emotion theater. Hero reacts to round outcome (mad if losing, smug if winning).
- **Implementation note:** could be Phaser sprite + tween-based facial expressions (eyebrow Y, mouth scale) driven by round state (behind/ahead/even).

## Card design (SPEC — copy these exactly)
- **Card frame:** dark navy/black (~#0A1418) with **cyan corner brackets** (~#5DCFD9) at all 4 corners. Brackets are L-shaped, ~12px each leg.
- **Card aspect ratio:** ~3:4 portrait, ~180×240px equivalent.
- **Subtle outline glow** on hover/highlight — soft cyan halo ~6px outside the bracket frame.
- **Title bar at top:** centered uppercase bold sans, ~14px, lime/cyan tinted. Sits ABOVE the card not inside it. (Title floats above the dark frame — clever, gives card more art space inside.)
- **Art panel:** upper 60% of card. For inactive cards, this is dim/empty/silhouette. For active card, it's a **bright themed icon**: FROST SLAM = cyan crystal-spike snowflake creature with angry face. The icons have **personality** — they're characters, not glyphs.
- **Description:** middle, white, 12px sans. Brief verb phrase ("Slows enemies around you when you block").
- **Stat block:** bottom 2 rows.
  - **GREEN line (benefit):** "More HP" — lime ~#7DE05A, "More" prefix italic-ish.
  - **RED line (cost):** "+0.25s Block cooldown" — coral red ~#E55A4A.
- **Tradeoff is HIGHLIGHTED** — every card has a visible green up + red down. This is the design soul of ROUNDS and exactly what our cards already model with `benefits`/`penalties`. **Display them with this exact visual hierarchy.**

## Other visible cards (for vocabulary)
- **WIND UP:** ghost icon. Loads more / More DMG / Lower ATKSPD / +0.5s Reload. (Multiple benefits AND multiple penalties — chunky tradeoff.)
- **THRUSTER:** "Bullets have thrusters that push targets" / +0.25s Reload time.
- **BOMBS AWAY:** "Spawn a bunch of small bombs around you when you block" / More HP / +0.25s Block cooldown.
- **HEALING FIELD:** ringed icon. "Blocking creates a healing field" / More HP / +0.25s Block cooldown.
- **FROST SLAM:** spiky cyan ice creature, angry face. "Slows enemies around you when you block" / More HP / +0.25s Block cooldown.
- **Theme:** these are all "block-trigger" cards — the draft offered a thematic group. ❗ Worth checking if our `generateDraftChoices` does any thematic clustering or just rolls 3 random.

## Palette (cards & UI)
- **Frame inner:** ~#0A1418 (almost black with blue tint).
- **Bracket cyan:** ~#5DCFD9 (consistent on all cards = brand color of "draft UI").
- **Highlighted-card cyan glow:** ~#7AE3F0 with low-alpha bloom.
- **Title text:** ~#9FE0CB (mint/lime).
- **Description text:** white #F5F8F8.
- **Benefit green:** ~#7DE05A.
- **Penalty red:** ~#E55A4A.

## Background
- **Far BG:** soft blurry brick/wall pattern, very low contrast (~#3A4046 → #2A2E32). It's defocused — DOF blur. Adds environment without competing.
- **Mid BG:** floor implied by darker band at bottom + a single floating prop (glowing lamp orb).
- **Top vignette:** darkening upward — eyes drawn down to the hero + cards.

## Animation cues (read between frames)
- Highlighted card is **slightly larger + slightly forward-tilted** — implies a hover/select tween.
- The hero is **leaning in** with a slight side-twist — hand outstretched. Whole pose says "pick this one."
- Probably bobbing breath idle on hero, gentle parallax on cards.

## Direct guidance for our overhaul (DraftScene rebuild plan)
**Current DraftScene** (`client/src/game/scenes/DraftScene.ts`):
- 3 cards in a horizontal row, centered, no character, dark rectangle frames with rarity-color borders.
- No hero. No personality. No bracket frames. No tradeoff color hierarchy. No background atmosphere.

**Target DraftScene:**
1. **Add a hero character** — large player sprite bottom-center, expressive, holds the *currently-hovered* card. Reacts (face/pose) to player's round state (behind = angry, ahead = smug).
2. **Cyan bracket card frame** — replace `setStrokeStyle(5, rarityColor)` with 4 corner-bracket L-shapes. Use `Phaser.GameObjects.Graphics.lineBetween` or a `Polygon`. Rarity color tints the bracket, not a full border.
3. **Title floats above card** — move from inside-card to above-card position. More art room.
4. **Hovered card scales 1.1×, lifts up ~20px, tilts forward** with slight rotation.
5. **Inactive cards are dimmed** (~50% alpha), titles still visible.
6. **Dedicated icon-art-with-personality** for each card — replace bucket-glyph with **themed creature/object** icons. (Big art job — start with top-tier cards, fall back to glyphs for filler.)
7. **Stat hierarchy: GREEN benefit on top line, RED penalty on bottom line.** Drop "BENEFITS:" header — the color and `+`/`-` prefix is enough.
8. **DOF/blurred BG** — render arena BG with a heavy blur or dim/desaturate it as the draft overlay. Reuse last frame of MatchScene as backdrop, blurred.
9. **Single light orb prop** — gives the scene a focal warmth.
10. **Thematic draft groups (?):** consider biasing draft choices toward one shared trigger (block, hit, kill, projectile-spawn) for narrative cohesion. Currently random — minor tweak to `CardSystem.generateDraftChoices`.

## Asset shopping list
- 1 hero portrait sprite (orange + 1 alt color per character) with 3-4 facial expression variants.
- 4 corner-bracket SVGs or Graphics calls for card frame.
- ~15-50 themed card icon illustrations (one per signature card; use bucket glyphs for the rest).
- 1 lamp/orb prop for ambient light.
- Brick-blur BG texture (or render-to-texture pipeline that captures the previous arena frame and blurs it).
