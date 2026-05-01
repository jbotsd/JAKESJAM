# JAKESJAM — Card Art Templates (Per Bucket)

**Output target:** PNG, 1024×1536 portrait, transparent background.
**Use:** the painted illustration that lives inside a card frame. The frame chrome comes from `02-hud-chrome.md`. Per-card iconography (shape, colour, glyph) is overlaid by code at runtime — these templates are the **bucket-level backdrop art** for the card.
**House style:** see `00-prompt-conventions.md`.

The card system in `client/src/sim/data/cards.ts` groups cards by `buckets[]`: `delivery`, `shape`, `quantity`, `trajectory`, `impact`, `element`, `utility`. We generate **one template per bucket** (six total below) so every card in that bucket shares a coherent backdrop. The card's specific iconography (`visual.iconShape`, `visual.glowColor`) is drawn on top procedurally.

The composition rule: leave the centre 60% dark and quiet — the icon overlay sits there. Push detail to the edges and corners.

## Bucket 1 — Delivery (raycast / projectile / continuous-beam)

Cards: Raycast Prism, Crystal Volley, Continuous Refractor, Sticky Ray, etc.

```
Vertical sci-fi card art template for a weapon delivery upgrade, top half shows a stylised palm-mounted crystal projector emitting a thin bright cyan #8ff8ff energy filament that crosses the upper third of the card, the lower half is dark navy #05080f void with faint faceted crystal architecture in deep violet #a78bfa, the central 60% of the canvas is intentionally quiet and dark so an icon can be overlaid, no characters in focus, only the projector hand visible from elbow forward, painterly geometric concept art, transparent background outside the painted area, 1024x1536 portrait, --ar 2:3 --style raw --stylize 220 --v 7

no text, no characters fully visible, no faces, no fantasy, no medieval, no anime, no JPEG artifacts
```

## Bucket 2 — Shape (circle / triangle / square / hexagon / orb / x / bar rounds)

Cards: Circle Rounds, Triangle Rounds, Square Rounds, X Rounds, I Rounds, etc.

```
Vertical sci-fi card art template for a projectile shape upgrade, the canvas shows a dark navy #05080f void with faint faceted crystal lattice pattern in violet #a78bfa receding into depth around the perimeter, the centre 60% is left intentionally dark and clean for an icon overlay, faint cyan #8ff8ff light streaks at the corners suggest projectile motion paths, no characters, no specific projectile rendered, abstract geometric backdrop, painterly concept art, transparent background outside the painted area, 1024x1536 portrait, --ar 2:3 --style raw --stylize 220 --v 7

no text, no specific shapes in the centre, no characters, no fantasy, no medieval, no anime, no JPEG artifacts
```

## Bucket 3 — Quantity (more shots, spread, satellites, cluster)

Cards: Dual Splitter, Triple Fan, Five Shard Spray, Wide Barrage, Needle Hose, Orbiting Satellites, Cluster Bomb, etc.

```
Vertical sci-fi card art template for a projectile quantity upgrade, the canvas shows a faint radial fan of thin cyan #8ff8ff light streaks emanating from the bottom centre and spreading upward in a 60-degree arc that fades before reaching the top, the centre 60% is dark navy #05080f and quiet for an icon overlay, faceted crystal motes scattered at the periphery in violet #a78bfa, abstract geometric backdrop conveying multiplicity and spread, painterly concept art, transparent background outside the painted area, 1024x1536 portrait, --ar 2:3 --style raw --stylize 220 --v 7

no text, no specific projectiles, no characters, no fantasy, no medieval, no anime, no JPEG artifacts
```

## Bucket 4 — Trajectory (homing, bounce, gravity, boomerang, float)

Cards: Seeker Facets, Bouncy Prism, Boomerang Prism, Arc Shards, Zero-G Floaters, Magnet Spray, etc.

```
Vertical sci-fi card art template for a projectile trajectory upgrade, the canvas shows curving glowing cyan #8ff8ff path-lines arcing across the perimeter of the frame, paths bend and curl suggesting non-linear motion, the centre 60% is dark navy #05080f void and quiet for an icon overlay, faint violet #a78bfa motion trails follow the curves, faceted crystal architecture barely visible in the deepest corners, abstract geometric backdrop, painterly concept art, transparent background outside the painted area, 1024x1536 portrait, --ar 2:3 --style raw --stylize 220 --v 7

no text, no specific projectiles, no characters, no fantasy, no medieval, no anime, no JPEG artifacts
```

## Bucket 5 — Impact (explosive, sticky, pierce-chain, slow-field)

Cards: Explosive Facet, Sticky Shards, Pierce Chain, Slow Field, Cataclysmic Prism, etc.

```
Vertical sci-fi card art template for a projectile impact upgrade, the canvas shows a single off-centre impact bloom in the upper third — a bright cyan #8ff8ff burst with hot pink #fb7185 inner core, surrounded by a slow shockwave ring, the lower two-thirds is dark navy #05080f void with cracking radial fractures glowing faintly violet #a78bfa, the centre 60% remains quiet enough for an icon overlay, faceted shard debris scattered at the edges, painterly geometric concept art, transparent background outside the painted area, 1024x1536 portrait, --ar 2:3 --style raw --stylize 240 --v 7

no text, no characters, no realistic explosions or fire, no fantasy, no medieval, no anime, no JPEG artifacts
```

## Bucket 6 — Element + Utility (combined template — fire/ice/lightning/void/radiant + speed/health/parry/etc.)

Cards: Molten Core, Frost Prism, Voltaic Spark, Void Fracture, Radiant Overload, Rapid Refraction, Crystal Plating, Phase Soles, Wide Parry, etc.

```
Vertical sci-fi card art template for an elemental or utility upgrade, the canvas shows an abstract crystal-tech ritual circle inscribed faintly into the dark navy #05080f background, the circle glows with a bright neutral white #fefce8 outline around the perimeter ready to be tinted by code per element (fire orange / ice blue / lightning yellow / void violet / radiant white-gold) at runtime, four small faceted crystal anchor stones at cardinal points around the circle in deep violet #a78bfa, the centre 60% within the circle is dark and quiet ready for an icon overlay, painterly geometric concept art, transparent background outside the painted area, 1024x1536 portrait, --ar 2:3 --style raw --stylize 220 --v 7

no text, no medieval runes, no fantasy circles, no anime, no characters, no specific elemental flames, no JPEG artifacts
```

## Selection Notes

These six templates cover every card in the current catalog. When a card belongs to two buckets (e.g. Orby Blap Blap is `shape + quantity`), pick the bucket that drives the gameplay headline — usually the first bucket listed in `cards.ts`.

The icon overlay (drawn by code, not AI) uses `visual.iconShape` and `visual.glowColor` from the card definition. The AI template provides only the *backdrop* — colour theming and the central iconography come from the runtime.
