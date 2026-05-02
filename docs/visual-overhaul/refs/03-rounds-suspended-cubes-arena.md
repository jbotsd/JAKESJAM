# Ref 03 — ROUNDS: suspended-cubes arena + draft-result HUD

Source: `ref images/rounds/ss_b9621a0a4d3587d330d99f505e313a0683077231.jpg`

## Scene structure
A round-start "stand-off" frame. Two players spawn on opposite sides. The arena is a constellation of small **wooden cubes hanging from thin strings** descending from off-screen above. Cubes are scattered at varying heights forming an organic, gravity-puzzle skyline.

## Palette
- **BG:** very dark navy/charcoal (~#0E1118 → #1A222C top), with subtle painterly cloud washes mid-frame (~#2A3340) — fog/atmosphere not detail.
- **Cubes:** warm wood brown (~#9B5A28 with darker ~#5C3414 shading on the side faces). Faceted sides give 3D depth even though everything is otherwise flat.
- **Strings:** single-pixel hairline ~#C0A878, near-invisible — they're a *suggestion* of suspension, not a render.
- **Player chips:** orange (#F26B3A) and blue (#3AA0F2), name + lime HP bar above. Same chip language as refs 01-02.
- **Faint ground hint:** vertical light beams (~#202830) imply unseen pillars/structure behind the void — atmospheric, not gameplay.

## HUD elements (top corners — KEY for our draft system)
- **Top-left ammo/status row:** two rows of small dots — orange row (~5 dots, one bigger = active ammo?) and a blue/grey row (cooldown/charges). Pure dots, no chrome, no bar.
- **Top-right card slot row:** **8 small rounded-square chips in a 2×4 grid**, each labeled with a 2-letter abbreviation (Gr / Wi / Gr / Pa / Pa / Te / Pa). These are **drafted card pills** — one per round won. Lightly outlined, transparent fill, lime-tinted text. This is exactly what our build summary should look like.

## Composition rules
- **Wide negative space** — half the frame is empty navy. The cubes float in vast emptiness.
- **Atmospheric perspective** — back layer (clouds, beams) is dimmer/cooler than foreground cubes. Gives depth without 3D.
- **Symmetry around center** — both players bracket the cube field. Stage feels like a duel arena.
- **Hanging-from-string** is a memorable arena gimmick: physics bodies tethered to invisible anchors. Cubes can be cut down / swung.

## Direct guidance for our overhaul
- **Adopt the 2×N card-pill HUD** for current build display (top-right). Use 2-letter or 3-letter card abbreviation, lime border tint matching rarity. We already have rarity colors — reuse.
- **Ammo/cooldown as dot rows**, not bars. Dots are denser visually than a thin bar at small scales.
- **Add atmospheric layers**: a backdrop of dim painterly clouds + faint vertical light beams — cheap parallax effect via 1-2 extra static layers.
- **Arena variants need gimmicks** — "suspended cubes on strings" is a great theme. We could do: floating crystals, swinging chandeliers, breakable tethers. Each arena should have ONE memorable structural idea.
- **Cube/platform shading**: don't flat-fill. Two-tone — top face lighter, side face ~50% darker. Sells dimension instantly.
- **String/tether rendering**: literally a 1px line. Don't over-render thin connectors.
