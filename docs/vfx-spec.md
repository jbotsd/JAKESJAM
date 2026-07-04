# Combat VFX spec — high-fidelity projectile system

Deep-dive requested 2026-07-04: "high-fidelity bullet VFX to spec to the
combat projectile system … not everything has visual effects, overhaul
with great game feel, maybe shaders." Grounded in the shipped sim
(`sim/types.ts` projectile taxonomy), the render path
(`render/EntityRenderCoordinator.ts`, `systems/ProjectileSystem.ts`,
`systems/ParticlePool.ts`, `render/SimEventRouter.ts`), and the
`juice-it` skill (reactive / tiered / three-layer feedback).

## The core finding — why "not everything has VFX"

There are **two render paths** and they are not equal:

| | Offline `MatchScene` | **Live world `OnlineMatchScene`** (the product) |
| --- | --- | --- |
| Projectile body | `ProjectileSystem`: glow halo, beam/pulse, pathing visuals | **flat `Phaser.circle`, element-tinted** (`EntityRenderCoordinator.renderProjectiles`) |
| Muzzle | glow burst on spawn | none (router does audio + 40ms recoil only) |
| Trail | additive glow follow | none |
| Impact | element burst on despawn | generic `spawnBlastAtPlayer` on hit-confirmed only |
| Bounce / expire | visual tell | none |

The pooled toolkit (`ParticlePool`: 64 glow, 64 spark, 32 shard, 16 ring,
16 blastCircle, 4 bolt) and `TransientVfx` are already constructed in the
live scene — **they're just not used for projectiles.** The overhaul is
mostly wiring existing, proven primitives into the live projectile path,
plus a small amount of new shaped-body + trail code.

## Design laws (from juice-it, tiered to combat)

1. **Reactive, never decorative.** Every effect fires on a sim event or a
   projectile lifecycle transition (spawn / travel / bounce / impact /
   expire). No idle animation on projectiles.
2. **Tier the response to the stake.** A pistol pellet ≠ a rocket ≠ a
   kill. Tier by `damage`, `impactRadiusPx`, and `element`.
3. **Three layers per beat.** Visual (glow/shape/trail/particles) + audio
   (already routed) + "haptic" = screen-shake/hit-stop (already tiered in
   `SimEventRouter`). Projectiles currently ship only the audio layer at
   muzzle and nothing mid-flight — this closes the visual layer.
4. **Pixel-art discipline.** Renderer is `pixelArt:true, antialias:false,
   roundPixels:true`. Glow uses the existing additive radial texture (hot
   core → halo → wash). Shapes stay crisp; trails are segmented, not
   gaussian blurs. Any shader must not soften the sprite layer.

## The lifecycle — muzzle → travel → impact

Every projectile gets a three-beat arc. Position source is the sim
snapshot (`state.projectiles`); spawn/despawn are detected by the
`seen`-set diff already in `renderProjectiles`.

### Beat 1 — Muzzle (on `shot-fired` / first-seen)
- Additive **flash** glow pop at muzzle (x,y from the event), scaled by
  `damage` tier, element-tinted, 60–90ms ease-out.
- 3–5 **spark streaks** ejected along the aim vector (cone ±18°), pooled.
- Existing 40ms recoil shake stays; scale to `damage` for heavy weapons.

### Beat 2 — Travel (per frame while alive)
- **Body**: shape-correct (`ProjectileShape`), velocity-oriented, with an
  element core color + additive glow halo sized to `radius`.
- **Trail**: short segmented additive streak behind the body, length ∝
  speed, fading over ~6 samples. One shared additive Graphics per
  coordinator (not pooled glows — avoids exhausting the 64-glow pool with
  many shots). Homing/boomerang curves read naturally because the trail
  follows real positions.
- **Pathing tells**: `gravity`/`float` tint the trail toward warm/cool;
  `bounce` flashes on wall contact (see Beat 3 partial); `homing` gets a
  faint targeting flicker; `accelerate` stretches the trail as speed rises.

### Beat 3 — Impact / expire (on despawn)
- **Hit** (despawn near a victim, or `hit-confirmed`): element burst —
  ring + spark fan + core flash, tiered by `damage`. Explosive
  (`impact:'explosive'`, `impactRadiusPx`) upgrades to a blast circle +
  platform tint (already exists for destructibles — reuse).
- **Expire** (lifetime/range end, no hit): soft **fizzle** — a single
  dim glow shrink, no shake. Distinguishes "missed" from "hit" at a
  glance, which is real combat information.
- **Bounce**: small spark tick + brief glow at the contact point so
  bounce-pathing shots read as skillful, not glitchy.

## Element visual language (11 elements)

Color already exists in `projectileColorByElement`; the overhaul adds
glow intensity, trail character, and impact flavor per element. Keep it a
single table so it's one source of truth.

| Element | Core | Glow | Trail | Impact flavor |
| --- | --- | --- | --- | --- |
| fire | `#ff7a18` | hot, large | embers, warm fade | burst + lingering warm tint |
| ice | `#9bf6ff` | crisp, tight | crystalline shards | shatter ring, cool |
| lightning/electric | `#fde047` | flicker | jagged, short | fork bolt (reuse `acquireBolt`) |
| void | `#a78bfa` | dark-cored | inward wisp | implosion ring |
| radiant | `#fff7d6` | bright bloom | long, bright | flash + slow fade |
| toxic | `#86efac` | dim, pulsing | dripping | lingering cloud puff |
| sticky | `#fb923c` | globby | thick, slow | splat, fuse blink while stuck |
| explosive | `#fb7185` | pulsing | thick | blast circle + shake tier |
| crystal | `#f0abfc` | faceted | sparkly | prismatic spark fan |
| neutral | owner color | medium | medium | standard spark fan |

## Shape language (7 shapes)

`ProjectileShape` is currently ignored (all circles). Overhaul draws each
via a shared additive Graphics, velocity-oriented:

- `circle`/`orb` — filled disc (orb = bigger halo). Pistol/default.
- `triangle` — arrowhead pointing along velocity. Reads as "fast/piercing".
- `square`/`hexagon` — chunky, slower feel. Heavy/AoE weapons.
- `x` — spinning cross. Reads as "special".
- `bar` — capsule stretched along velocity. Railgun/beam feel.

## Shaders — opt-in Phase, not required for the win

Non-shader glow gets ~80% of the fidelity with zero pixel-art risk. A
WebGL **PostFX bloom pipeline** is the tasteful shader add: threshold-blur
only the additive layer so hot cores bleed, without softening sprites.
Candidates, in order of value/risk:

1. **Additive-only bloom PostFX** — bloom the glow/particle layer. High
   value, moderate risk (must exclude the pixel sprite layer or it muddies).
2. **Impact chromatic-aberration pulse** — 120ms RGB split on big impacts
   / kills (catalog maps Feel "Chromatic Aberration"). Cheap, punchy.
3. **Hit color-grade** — brief brightness/saturation lift on kill
   (already have hit-stop + shake; this completes the "everything pops"
   moment). CSS-`filter`-equivalent via camera post-pipeline.

Gate all three behind a quality flag; default on desktop, off if the
renderer falls back to Canvas (`Phaser.AUTO` → no WebGL → skip pipelines).

## Phased plan

- **P1 — Projectile bodies + lifecycle (flagship, this pass):** element
  language table, shaped+glowing+trailed bodies in the live coordinator,
  muzzle flash on `shot-fired`, element impact/fizzle on despawn. Closes
  the visual layer for every shot. No shaders.
- **P2 — Pathing/impact richness (DONE 2026-07-04):** bounce ticks
  (velocity-flip inference), explosive blast circle (impactRadiusPx),
  sticky fuse blink, and element-specific impacts — lightning fork bolt,
  void implosion (inward ring + inward sparks), fire embers, ice shatter,
  radiant flash, toxic linger cloud, sticky splat, crystal prism fan.
- **P3 — Cinematic tier (DONE 2026-07-04, adapted):** Phaser 4.1 dropped
  the Phaser-3 PostFXPipeline API (only BaseShader remains), so a custom
  fragment-shader bloom pipeline isn't viable/stable. Adapted to built-in
  camera FX: KILL moment = camera flash + micro zoom-punch + additive
  bloom pop (the additive-glow layer IS the bloom). Gated by
  `combatCinematics` (WebGL only; `?fx=off` opt-out; Canvas fallback
  skips it). True fragment-shader bloom/chromatic remains a future item
  if/when Phaser exposes a stable post-pipeline API.

New sim events worth adding for P2 (all additive, optional): none strictly
required — despawn-diff + `hit-confirmed` + `parry-deflected` cover P1.
`projectile-bounced {x,y,element}` would make bounce tells exact rather
than inferred; add only if inference proves jittery.

## Test / verify contract

- Unit: element-language table is total over `ElementType`; shape drawer
  total over `ProjectileShape`; trail ring-buffer never allocates per
  frame; pool acquisitions all null-checked (exhaustion is non-fatal).
- Live: bots fighting on the world, screenshot mid-volley — every
  projectile shows core+glow+trail; muzzle flash on fire; distinct
  hit-burst vs expire-fizzle. RTT/predictDelta unchanged (VFX is
  render-only, never touches sim).
