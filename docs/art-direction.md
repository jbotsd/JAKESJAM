# JAKESJAM — Art and Audio Direction

## Visual Direction

Readable, bold, fast, and slightly stupid in the best way.

The reference set points toward side-view arena shooters with dirty terrain,
compact HUDs, tiny readable fighters, and bright combat traces. JAKESJAM should
feel like a low-fi multiplayer fight happening inside a rough industrial toybox:
messy, physical, funny, and always readable.

The game should prioritize:

- clear player silhouettes;
- visible bullets/projectiles;
- obvious collision geometry;
- punchy impact effects;
- simple but expressive characters;
- arena readability over decoration.

## Reference Pillars

- Side-on arena readability: the camera should show the fight, major routes,
  risky gaps, and projectile lanes without cinematic cropping.
- Murky terrain, bright action: backgrounds and terrain can be olive, teal,
  charcoal, rust, brown, dusty red, or saturated teal/lime, while players,
  projectiles, muzzle flashes, impacts, pickups, and UI use brighter accents.
- Painterly, low-fi maps: terrain should use chunky silhouettes, rough painted
  texture, and scrap-built platforms rather than clean vector perfection.
- Tiny expressive fighters: characters should stay simple, colorful, and
  readable at small size, with exaggerated weapons, limbs, aim poses, and
  clear name/health markers.
- Visible projectile grammar: bullets, blaps, beams, arcs, ricochets, fire, and
  explosions should have distinct trails or silhouettes so players understand
  what happened.
- Compact arcade HUD: health, ammo, score, card/build state, and team/player
  markers should be quick to scan and should not cover the center of combat.

## Environment Style

Boxworks and early maps should lean into:

- layered industrial scrap, planks, metal beams, crates, ropes, ladders, ducts,
  and blocky platforms;
- earthy or polluted atmospheres with foggy depth layers;
- occasional high-saturation cave or neon-industrial palettes, especially
  teal/lime terrain against deep blue shadows;
- chunky collision silhouettes that match actual gameplay collision;
- textured terrain edges, stains, cracks, grime, and small grass/moss details;
- clear foreground/background separation so playable surfaces are never
  confused with scenery.

Avoid making arenas look too clean, glossy, or toy-flat. Simple shapes are fine,
but they should still carry some dirt, texture, shadow, and damage.

## Character and Combat Readability

- Player team colors should be saturated enough to stand out from the map.
- Character bodies can be small and goofy, but their facing, aim direction, and
  hit state must be readable.
- Nameplates and small health bars should follow the player without becoming
  visual clutter.
- Projectile shapes from the upgrade system should be identifiable in motion.
- Fire, napalm, explosions, and hit sparks should flare brightly, then clear
  quickly so follow-up shots remain visible.
- When the screen gets chaotic, prioritize player silhouettes and active
  projectiles over decorative effects.

## Animation Direction

Characters should favor procedural 2D puppet animation with inverse kinematics
over large early sprite-sheet commitments.

- Use two-bone IK for legs so feet can plant, step, lift, and recover against
  slopes or moving platforms later.
- Use arm IK to keep hands attached to the weapon and aimed at the cursor or
  current target.
- Walking should read through alternating foot targets, hip bob, body lean,
  and clear facing direction.
- Jumping and knockback should stretch the same rig rather than swapping to
  unrelated poses.
- Character archetypes may change limb proportions, body size, stance, or
  gait, but hitbox readability must stay stable.
- Procedural animation should stay tiny and snappy, not smooth in a way that
  makes impacts feel mushy.

## UI Style

- Use compact, match-first UI rather than large menu panels during combat.
- Prefer score pips, bars, icons, short labels, and small build/card summaries.
- Use crisp bitmap or bitmap-inspired typography if it remains legible.
- Keep HUD elements pinned to edges and corners.
- Draft and lobby screens can be more spacious, but should still feel like part
  of the same rough arcade shooter instead of a glossy card game.

## Prototype Art

Use placeholders:

- capsule or rectangle players;
- solid colour teams;
- simple gun line/sprite;
- basic projectile circles, triangles, squares, hexagons, orbs, and lines;
- blockout arenas;
- plain UI cards.

No final art is required before the game loop is fun.

Prototype placeholders should still respect the final contrast plan: muted
terrain, bright player colors, bright projectiles, and collision shapes that
clearly read as solid.

## MVP Art Targets

- 1 player base body with colour variants.
- 4 readable character silhouettes or stat archetype variants.
- 3–5 weapon sprites.
- 3 arenas.
- 12–18 card icons.
- muzzle flash, hit impact, explosion, death effect.
- readable UI card frames.
- destructible barrels, boxes, mines, and cubes/blocks.
- fire/napalm VFX that catches, burns, and dissipates without hiding players or bullets.

## Audio Direction

Audio should make combat legible.

Priority sounds:

- gunshot;
- reload;
- hit;
- jump;
- land;
- explosion;
- shield trigger;
- card pick;
- round start/end;
- match win.

Music should support energy but not mask important combat sounds.
