# Game Feel & Juice — Feel (More Mountains) Integration Plan

## What's currently in `game-feel-juice/SKILL.md`

- Hit-stop (tweens.timeScale)
- Screen shake (Nijman's budget-aware approach)
- Particle bursts
- Knockback (visual overshoot snap)
- Scale punch
- Camera flash
- Audio pitch jitter
- Tweened staggered spawning
- Random pitch on SFX
- Camera kick

## Features from feel.moremountains.com / Nijman's talks that are **NOT** in the skill yet

### Physics-based Feedback

1. **Elasto-kinetic bounce** — when a hit connects, the target should *physically* bounce a few pixels back, not just shake. Related to "springy" feel. Nijman shows this as a critical layer in his demo.

2. **Procedural spring overshoot** — not just "kickback", but the victim should overshoot their hit position, like a real spring, then settle. More than linear offset.

3. **Impact rotation** — hit objects spin slightly on impact, then dampen. Very common in 2D shooters (e.g. Vampire Survivors, Cuphead).

4. **Velocity dampening** — after a big hit, the victim slows briefly as "energy" is spent, then accelerates back. Gives weight to impact.

5. **Elastic rebound** — similar to velocity dampening but with a bounce-back term. Feels like the projectile transferred momentum.

### Depth-based / Layered Juice

6. **Z-depth fog** — when a kill happens, push fog or particles *behind* the impact point, giving depth. Less common but used in "juicy" games.

7. **Depth parallax shake** — different camera axes shake with different intensities (X more than Y, or vice versa) for directional punch.

8. **Multi-layer particles** — Nijman's demo uses 3+ particle layers:
   - Inner: sparks (fast, white-hot)
   - Middle: smoke/steam (slower)
   - Outer: debris/death trail

9. **Screen vignette flash** — not just color flash, but temporary *vignette* on impact. Simulates high-contrast impact focus.

10. **Background pulse/bloom** — subtle brightness increase behind the impact. Makes the foreground feel closer.

### Screen / Canvas Effects

11. **Color invert on hard hit** — 1-frame color invert (like Doom's "headshot" or Street Fighter's "combo burst").

12. **Scan line flash** — temporary scan line overlay on impact. Cyberpunk feel.

13. **RGB split chromatic aberration** — temporary red/blue shift on super hits.

14. **Screen curvature** — slight "fisheye" zoom on critical hit (like Tekken combos).

### Audio Feedback

15. **Layered audio reverb tail** — after a big hit, a short reverb tail simulates "the air got hit".

16. **Sub-bass thump** — low-frequency sub drop (15-60Hz) that's mostly felt than heard.

17. **Audio envelope tail decay** — sounds don't just stop; they decay with a specific tail. Some audio systems add 5-10% extra tail for "bigger" feel.

18. **Frequency ducking** — after a big hit, temporarily *duck* other sounds (music, UI) to emphasize impact.

### Visual Effects

19. **Motion trails** — Nijman calls this "trails". When a fast projectile hits, it leaves a visible trail for 1-2 frames.

20. **Speed lines** — when camera shakes hard, add speed line overlays. Classic anime effect.

21. **Bloom on bright hits** — impact point temporarily glows with bloom.

22. **Hit marker overlay** — small UI marker at impact location that pulses.

23. **Target reticle bounce** — when you have a reticle, it bounces on hit.

24. **Combo counter pop** — if tracking combos, the counter should jump/scale/pop on hit confirmation.

### "Feel" from Nijman's 2013 talk (completing his checklist)

25. **Impact "plop" effect** — a quick *subtle* movement on the object being hit (not just the camera).

26. **Screen "punch" (not shake)** — a very fast, tiny (2-5px) linear push on the entire canvas. Faster than shake, smaller.

27. **Camera "lerp"** — after shake ends, the camera *eases back* with overcorrection (Back.easeOut or similar).

28. **Muzzle flash** — Nijman's #5. A directional flash from the shooter's weapon.

29. **"Sleep frames"** — Nijman's #11. After a big kill, the enemy sprite stays in its death pose for 1 extra frame before dissapearing (permanence).

30. **Permanence** — Nijman's #1. Small persistent marks that accumulate (blood splatter, burn spots, impact marks).

### Advanced / "Next Gen" Feel

31. **GPU instanced particle burst** — for high-count bursts, use instancing for performance.

32. **Per-particle velocity scatter** — not just random positions, but random *velocities* to simulate "spreading outward".

33. **Secondary particle cascade** — when particles hit each other or the screen edge, spawn secondary tiny particles.

34. **Color temperature shift on big impact** — warm (orange) on melee, cool (blue) on ranged.

35. **Variable burst count** — not fixed 24 particles. Maybe 18-30±4 to feel less deterministic.

36. **Temporal bloom** — after a few hits, bloom builds up slightly before dissipating.

---

## Suggested Priority Queue

### High (add first — big payoff, already in spirit of current skill):

1. **Elasto-kinetic bounce** (visual, simple implementation)
2. **Impact rotation** (simple, feels very "physical")
3. **Velocity dampening** (adds weight)
4. **Z-depth fog** (adds depth perception)
5. **Multi-layer particles** (Nijman's explicit layering)
6. **Screen vignette flash** (cheap, good effect)
7. **RGB split on hard hits** (stylistic)
8. **Motion trails** (simple, feels fast)
9. **Impact "plop"** (Nijman's #30)
10. **Camera lerp** (Nijman's #7)

### Medium:

11. **Speed lines** (Nijman's #13)
12. **Combo counter pop** (if you have combo tracking)
13. **Bloom on bright hits** (already have bloom skill, just need combo)
14. **Hit marker overlay** (simple)
15. **Temporal bloom** (cool idea, might be overkill for JAKESJAM)
16. **Per-particle velocity scatter** (improves existing particle work)

### Nice to have:

17. **GPU instancing** (performance optimization for particle bursts)
18. **Secondary cascade** (fancy, might be a lot for JAKESJAM)
19. **Variable burst count** (adds natural feel)
20. **Permanence marks** (depends on art style — blood, burns, etc.)
21. **Sub-bass thump** (audio work, depends on AudioSystem)
22. **Audio ducking** (depends on audio implementation)

---

## Implementation Plan

1. **Extend `StatusVfxController` or create `ImpactEffectController`** to handle the physics-based layers (bounce, rotation, dampening).

2. **Extend `ParticlePool.burstAt`** to accept a `config` with:
   - `layers` array of layer types ("inner", "middle", "outer")
   - `depthMode` (fog, bloom, vignette, none)
   - `rotation` (boolean, random)
   - `velocityDamp` (0-1)

3. **Add `cameraLerp()`** helper after big impact shakes.

4. **Add `depthVignetteFlash()`** for Z-depth feel.

5. **Add `multiLayerParticles()`** recipe in the skill.

6. **Add RGB split, speed lines, impact plop** as optional effects.

7. **Document the 30-item Nijman checklist** as a reference.

8. **Add audio tail/ducking** if AudioSystem supports it.

---

## Questions

1. Should `ImpactEffectController` be a *separate controller* from `StatusVfxController`, or do they merge?

2. Do we want a "juice level" system (low/med/high) that scales effects per round or per build?

3. Should I create a small `ImpactEffectConstants` module with named values (like `ELASTIC_BOUNCE_SCALE = 1.2`) so effects are tweakable?

4. Do we want a "juice recipe" per event type (kill vs impact vs pick vs chaos roll)?
