# JAKESJAM — Menu Backdrop Prompts

**Output target:** PNG, 2560×1440, opaque background (or transparent if you plan to layer over a theme bg fill — choose per asset).
**Use:** splash, lobby, results screens. Loops/parallax come later — these are static hero compositions.
**House style:** see `00-prompt-conventions.md`.

The wizard logo or HUD chrome will sit on top of these. Keep the visual centre quiet and let the edges carry the energy.

## Prompt 1 — Splash Background

```
Wide cinematic sci-fi splash background for a 2D arena shooter, a dark cathedral of geometric crystal architecture viewed in side-elevation perspective, a near-black navy field #05080f with rays of cyan #8ff8ff light catching the upper edges of distant faceted crystal pillars, two faint silhouettes of hooded cyberpunk sorcerers facing each other from opposite sides of the frame at small scale, palm-mounted crystal projectors glowing softly, the centre of the composition is a quiet open space ready for a logo overlay, subtle violet #a78bfa atmospheric haze in the lower third, geometric minimal Geometry Wars meets Tron Legacy aesthetic, no text, 16:9 hero composition, --ar 16:9 --style raw --stylize 250 --v 7

no text, no logos, no fantasy robes, no medieval, no anime, no chibi, no realistic faces, no clutter, no JPEG artifacts
```

## Prompt 2 — Lobby Background

```
Sci-fi waiting-lobby background, a wide horizontal antechamber of polished dark crystal floor and faceted geometric pillars receding into deep navy distance, soft cyan #8ff8ff light pulses along the floor seams, faint violet #a78bfa atmospheric glow, geometric platforms float in the mid-distance suggesting the upcoming arena, the centre of the frame is open and quiet ready for player slot UI overlay, no characters visible, calm anticipatory mood, 16:9, --ar 16:9 --style raw --stylize 220 --v 7

no text, no logos, no characters, no fantasy, no medieval, no anime, no clutter, no JPEG artifacts
```

## Prompt 3 — Results Screen Background

```
Sci-fi post-match results background, a dark crystal amphitheatre with a single beam of bright white-gold #fefce8 light descending from offscreen above onto the centre stage, faceted crystal architecture frames the periphery in dark navy #05080f, soft cyan #8ff8ff and violet #a78bfa rim lighting on the architectural edges, the centre stage is empty and ready for a winner silhouette overlay, atmospheric haze, dramatic but restrained, 16:9, --ar 16:9 --style raw --stylize 250 --v 7

no text, no logos, no fantasy, no medieval, no anime, no realistic faces, no clutter, no JPEG artifacts
```

## Prompt 4 — Card Draft Background (between rounds)

```
Sci-fi card-draft background for a between-rounds upgrade screen, a dark abstract geometric field of slowly drifting faceted crystal motes against a deep navy #05080f void, three faint vertical light columns in cyan #8ff8ff suggesting card slot positions but the columns themselves are empty and quiet, subtle violet #a78bfa atmospheric depth, the composition is calm and balanced left-to-right with no focal centre because the cards will overlay on top, 16:9, --ar 16:9 --style raw --stylize 200 --v 7

no text, no logos, no characters, no card art, no fantasy, no medieval, no anime, no clutter, no JPEG artifacts
```

## Selection Notes

All four backdrops are intended as **static** assets, not animated loops. If you want subtle motion later, layer Phaser-driven crystal-mote particles on top — do not regenerate the backdrop with motion baked in.

Generate each backdrop **once per theme** if you want theme-specific splash art. For MVP, generate only the Crystal Cyan version of each — the runtime theme tinting handles UI on top, and a single splash backdrop is acceptable for jam scope.
