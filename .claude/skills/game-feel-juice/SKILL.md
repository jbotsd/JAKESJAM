---
name: game-feel-juice
description: >
  Hit-stop, screen shake, knockback, particle bursts, kickback. Use when
  editing client/src/game/systems/ParticlePool.ts, StatusVfxController.ts,
  WeaponSystem.ts, or any time a JAKESJAM weapon "feels weak", a death
  feels mushy, or a card pick has no payoff. Render-layer only — never
  touches the deterministic sim.
version: 1.0.0
---

# Game Feel & Juice

## Why this skill exists

JAKESJAM's projectiles, deaths, and card-draft pops all currently fire
through the same generic particle pool. Without a deliberate juice
budget the game reads as "deterministic numbers moving on a screen".
The sim is locked (it must stay deterministic — see
`game-sim-determinism`), so 100% of feel work happens in
`client/src/game/` render+VFX code. This skill encodes Vlambeer's and
Swink's rules so that every hit, kill, draft, and chaos-modifier swap
has a layered, repeatable juice signature.

## The hard line

**Every meaningful event gets at least three of: hit-stop, screen
shake, particle burst, knockback, sound, color flash, scale punch.
One channel alone is never enough. None of it lives in `client/src/sim/`.**

## What the KOL says

**Jan Willem Nijman, "The Art of Screenshake"** (Vlambeer, INDIGO Classes
2013, ~30 min). Nijman's live demo of *Super Crate Box* turns a
flat-feeling shooter into Nuclear-Throne-grade juice by adding 30+
layered effects one at a time. The recurring pattern:

> "Every action needs reaction. Bigger reactions for bigger actions."
> — Nijman, Art of Screenshake (timestamp ~12:00)

His demo's checklist (verbatim ordering from the talk):
permanence → bigger explosions → impact effects → screen shake →
muzzle flashes → screen freezing (hit-stop) → camera lerp → camera
kick → recoil → enemy hit-flashes → permanent corpses → sleep frames
on kill → knockback → speed lines → tweened spawning → random
pitch on SFX.

**Steve Swink, "Game Feel: A Game Designer's Guide to Virtual
Sensation"** (Morgan Kaufmann, 2008). Chapter 9 ("The Feel of Polish")
calls these layered cues "polish stack" and argues you cannot evaluate
any one of them in isolation — only the stack matters.

## How JAKESJAM applies it

Concrete files:

- `client/src/game/systems/ParticlePool.ts` — owns particle burst
  budgets. Every weapon impact passes through here.
- `client/src/game/systems/StatusVfxController.ts` — owns flashes,
  scale punches, color tints on `PlayerEntity` rigs.
- `client/src/game/systems/WeaponSystem.ts` — owns kickback (visual
  only — the sim's weapon spread/recoil already runs in
  `sim/weapon.ts`).
- `client/src/game/systems/AudioSystem.ts` — owns pitch jitter,
  layered SFX.
- `client/src/game/scenes/MatchScene.ts` / `OnlineMatchScene.ts` —
  owns camera shake via `this.cameras.main.shake(...)`.
- `client/src/game/ui/CardDraftOverlay.ts` — drafting picks need
  juice too. A card click without a screen kick is a wasted moment.

The boundary is hard: `StepResult` from the sim emits *events*
(`projectileImpacted`, `playerKilled`, `cardSelected`, `chaosRolled`).
The render layer reads those events and runs the juice stack. The sim
never knows shake or hit-stop happened.

## Recipes

### 1. The "kill stack" — every player death

```ts
// client/src/game/systems/StatusVfxController.ts
onPlayerKilled(victimId: PlayerId, killerId: PlayerId | null) {
  // 1. Hit-stop (visual freeze of render only — sim keeps ticking)
  this.scene.tweens.timeScale = 0;
  this.scene.time.delayedCall(80, () => { this.scene.tweens.timeScale = 1; });

  // 2. Screen shake — bigger for kills than impacts
  this.scene.cameras.main.shake(180, 0.012);

  // 3. Particle burst — chunky, color-matched to victim element
  this.particles.burstAt(victim.x, victim.y, {
    count: 24, speedRange: [180, 360], lifetime: 600,
    tint: elementColors[victim.weapon.element],
  });

  // 4. Color flash on victim rig (1 frame white, then fade)
  this.flashRig(victimId, 0xffffff, 60);

  // 5. Audio: layered low boom + high "tink", random pitch ±10%
  this.audio.play('kill_boom', { rate: 0.95 + Math.random() * 0.1 });
  this.audio.play('kill_tink', { rate: 0.95 + Math.random() * 0.1 });

  // 6. Knockback on the killer's camera (subtle — they did the kill)
  if (killerId === this.localPlayerId) {
    this.cameraKick(0, -8, 120);
  }
}
```

### 2. Hit-stop on projectile impact (render-only)

Hit-stop in JAKESJAM CANNOT pause the sim — the sim is authoritative
and shared. Pause only the *render* tween clock and post-processing
shaders. The sim keeps ticking; players keep moving; only the impact
visual freezes.

```ts
// On `projectileImpacted` event:
const stopMs = projectile.damage > 30 ? 50 : 25;
this.tweens.timeScale = 0;
this.scene.time.delayedCall(stopMs, () => { this.tweens.timeScale = 1; });
```

### 3. Camera shake budget

Per the talk, shake gets noisy fast. Use one bus and clamp:

```ts
// client/src/game/systems/CameraShakeBus.ts (create if missing)
shake(intensity: number, durationMs: number) {
  const cam = this.scene.cameras.main;
  // Don't restart shake — extend amplitude only if larger.
  const current = cam._shakeAmplitude ?? 0;
  if (intensity <= current) return;
  cam.shake(durationMs, intensity);
}
```

Buckets: `0.004` (footstep), `0.008` (impact), `0.012` (kill),
`0.020` (chaos modifier swap), `0.030` (round end). Anything above
`0.030` makes the player nauseous.

### 4. Card-draft punch

`CardDraftOverlay` currently fades cards in. Add Nijman's "tweened
spawning" + a kickback on confirm:

```ts
// client/src/game/ui/CardDraftOverlay.ts
spawnCard(card: CardDef, slotIndex: number) {
  const sprite = this.add.image(...).setScale(0.6).setAlpha(0);
  this.scene.tweens.add({
    targets: sprite,
    scale: 1, alpha: 1,
    delay: slotIndex * 60,             // staggered, not simultaneous
    duration: 180,
    ease: 'Back.easeOut',              // overshoot — Nijman pattern
  });
}

onConfirmCard(card: CardDef) {
  this.scene.cameras.main.shake(120, 0.010);
  this.scene.cameras.main.flash(80, 255, 255, 200, false);
  this.audio.play('card_pick', { rate: 0.9 + Math.random() * 0.2 });
}
```

### 5. Knockback on hit (visual only)

Sim knockback exists in `sim/combat.ts` (positions are authoritative).
Render layer adds a *visual-only* spring on the rig — the visual
overshoots the authoritative position, then snaps back inside 100ms.

```ts
// client/src/game/systems/RemotePlayerManager.ts
applyHitVisual(playerId: PlayerId, dirX: number, dirY: number) {
  const rig = this.rigs.get(playerId);
  const offsetX = dirX * 6, offsetY = dirY * 6;
  rig.visualOffsetX = offsetX; rig.visualOffsetY = offsetY;
  this.scene.tweens.add({
    targets: rig,
    visualOffsetX: 0, visualOffsetY: 0,
    duration: 90, ease: 'Cubic.easeOut',
  });
}
```

### 6. Random pitch on every SFX (Nijman's #16)

`AudioSystem.play` must default to `rate: 0.92 + Math.random() * 0.16`.
Only opt out for music and UI tones. Without this, repeated fire on
the Scrap Rifle sounds like a sewing machine.

## Anti-patterns

- **Pausing the sim for hit-stop.** It will desync from the server.
  Render-tween freeze only.
- **One global "play impact" function with no parameters.** Nijman's
  rule: bigger actions need bigger reactions. A pistol pop ≠ a
  rocket impact ≠ a kill.
- **Calling `cameras.main.shake()` from inside `World.step()` or
  `sim/combat.ts`.** The sim is shared with the Bun server — Phaser
  does not exist there. Compile error if you're lucky, silent dead
  code if you're not.
- **Stacking shakes that override each other.** Last-write-wins in
  Phaser, so a tiny footstep can clobber a kill. Route through a
  bus with `if (intensity > current)`.
- **No pitch variance on SFX.** The `Scrap Rifle` at 5 RPS becomes
  unbearable inside 10 seconds.
- **Adding particles to `client/src/sim/projectile.ts`.** Particles
  are render. The sim emits *events*; render decides what to do
  about them.
- **Skipping juice on the draft phase because "it's a menu".** The
  draft IS the rogue-lite payoff loop. A flat draft kills retention.

## Pre-flight checklist

- [ ] Every event in `StepResult.events` has a render-layer handler
      with at least 3 channels firing.
- [ ] No call to `cameras`, `tweens`, `add.particles`, or
      `Math.random()` inside any file under `client/src/sim/`.
- [ ] Shake amplitudes use the named buckets (`0.004` … `0.030`).
- [ ] All `audio.play()` calls have `rate` jitter unless explicitly
      a music or UI tone.
- [ ] Hit-stop only freezes `tweens.timeScale`, never anything that
      affects sim tick rate or input feed.
- [ ] Card-draft confirm has a screen flash + camera kick + SFX.
- [ ] A kill produces hit-stop + shake + burst + flash + 2 SFX +
      camera kick (for the killer).
- [ ] Tested on `OnlineMatchScene` (not just `MatchScene`) — net
      events route through `RenderHost`, easy to forget one.

## Source

- Jan Willem Nijman, "The Art of Screenshake" — INDIGO Classes 2013.
  https://www.youtube.com/watch?v=AJdEqssNZ-U
- Mirror + slides: https://archive.org/details/the-art-of-screenshake
- Steve Swink, "Game Feel: A Game Designer's Guide to Virtual
  Sensation", Morgan Kaufmann, 2008. Chapter 1 PDF:
  http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf
- Reference reimplementation of the demo:
  https://github.com/colinbellino/screenshake
