# Ref 02 — ROUNDS: explosion cascade / fire-build payoff

Source: `ref images/rounds/ss_a45fb5c56e1d445aa225f1f471f58375d145b121-1777670332.jpg`

## What's happening
Orange player (Wilnyl, top-right) has fired what reads as a multi-bounce / explosive build. A diagonal cascade of orange fireball blooms tracks down-left across the map — the same shot is detonating multiple times. Bottom-center has a huge starburst spark explosion from final impact.

## Palette
- **Background:** dark slate-blue (~#15202C top, fading to ~#0B1620 bottom). Cooler than ref 01 — almost navy.
- **Platforms:** off-white slabs (~#E8EFF2) with vertical pale-cyan brush streaks (~#9BC8D4) — same painterly wash, different colorway.
- **Fireballs:** layered. Outer halo ~#FFB347 → core ~#FFE066 → bright white center ~#FFF8DC. Each "puff" is a soft round bloom, additive.
- **Sparks:** tiny gold-orange dots (~#FFC04A), drifting up like embers.
- **Player:** orange ~#F26B3A, white name + lime HP bar — same chip language as ref 01.
- **Light beams:** faint warm rays cast downward from off-screen top — adds dramatic stage lighting without rendering geometry.

## Composition / staging
- **Diagonal cascade** — explosions form a top-left-to-bottom-center sweep, drawing the eye exactly where the action just was.
- **Negative space at top-right** holds the shooter so the cascade has somewhere to come *from*.
- **Star-shaped impact spike** at the largest blast — long thin radial spikes (~16 of them), uneven length, outline in dark navy. Reads as "this one mattered."
- **Platforms get backlit** by nearby blasts — cool blue platforms briefly take warm orange light. Implies dynamic lighting via additive blend, not real lighting.

## VFX vocabulary (copyable to our game)
- **Explosion = stacked soft circles** of varying size + an additive sparkfan + a few drifting embers afterward. NOT a single sprite.
- **Sparks = tiny dots**, 1-3px equivalent, ballistic upward drift, fade over ~600ms.
- **Bigger blast = bigger sparkfan + jagged star spikes**, scaled by damage/size.
- **Explosion cores stay near-white** at peak, fading through yellow → orange → smoke. Multi-tone gradient is what sells it.
- **Cascade pattern**: a series of timed blooms along a path (perfect for a piercing/multi-hit projectile or chain explosion card). Each bloom 80-120ms apart.

## Lighting
- **Light-beam rays** from above are a simple polygon (long pale triangle, ~10% alpha additive) — cheap, adds atmosphere fast.
- **Halation around fireballs** — a much larger soft circle at very low alpha bleeds light into surrounding void. This is the "glow" people remember.

## Direct guidance for our overhaul
- Our current explosion is too crisp/geometric. Replace with **3-5 stacked soft Phaser circles** per blast, additive blend, scaled randomly +/- 20%, fading on staggered tweens.
- Add **persistent spark particles** post-blast (use ParticlePool — already built).
- For "big" blasts (boss, ult, killing-blow), add the **radial star-spike overlay** — 16 thin rectangles from center, varied length, dark outline.
- Add **arena light beams** as decoration on key arenas — cheap and elevates mood massively.
- Platforms should **react to nearby explosions** with a brief warm tint — 100ms additive overlay matched to blast color.
- Confirm: the game's dark-slate arena variant should match this navy (~#15202C), cleaner than the teal of ref 01.
