# Practice Zone — the exhaustive, elegant, complete goal

**Status:** North star. The tactical build-out (staged, incremental, checkpointed) lives in the current plan file; this doc is what "done, done right" looks like if we go all the way. Not a sprint backlog — a target to build toward and check work against.

## What this is not

Not the new-player onboarding experience. `.claude/skills/onboarding-ftue/SKILL.md` owns that, via a real bot-warmup PvP match — teaching inside the actual game, with real bot AI, no forked scene to rot. The Practice Zone is a **separate, player-sought, optional** space: something a player who already knows the game opens deliberately to drill movement, feel a fresh build, or just move for the joy of it. The two must never merge, share a map, or reference each other's logic.

## The complete vision

### 1. Real physics, zero compromise (done)
Practice runs the identical `stepPlayer` physics the online path runs — same wall-jump, wall-slide, dash, same collision cache, same determinism guarantees. No second physics engine to drift out of sync, ever again. This is the foundation everything below stands on.

### 2. A teaching corridor that's actually good level design
Not a flat testing box — a real hand-authored space (`boxworks-practice.ts`) that teaches by *architecture*, the way a good platformer's tutorial level does (Celeste, Super Meat Boy): each section is unmissable, each mechanic's window is generous the first time and tightens as the corridor continues, and nothing is explained by text when the geometry can teach it.

- **Warm-up run/jump.** Flat ground, one simple gap. Proves input works, costs nothing.
- **Wall-jump shaft.** A climbing chamber, not a single pair of walls — three or four kicks in sequence, with the gap tightening slightly each story so confidence builds kick by kick. A visible "top" (light, open sky, a landing platform) so the goal reads before the player starts climbing.
- **Dash runway.** A gap that is honestly impossible without a dash, immediately preceded by a shorter gap that's honestly impossible *without* a run-up — so the player discovers dash is a distance tool, not just a speed button, through failure-then-success rather than a tooltip.
- **Landing/wobble showcase.** A tall, dramatic drop back down, framed so the camera holds the landing a beat — this is the "wow" moment for the leg-wobble secondary motion, deliberately staged as a payoff, not just incidentally present.
- **A closing loop**, not a dead end: the corridor curls back near the start so a player can immediately re-run the whole thing without a menu round-trip. Practice should never punish repetition with friction.

Reachability proven two ways, honestly: `unreachablePlatforms()` for the plain-jump/wall-jump sections (same validator `boxworks-mini` uses), and a bespoke scripted-`stepPlayer` test for the dash gap specifically, since the route-graph validator has no dash edge modeled and would give a false failure — documented as a known gap, not silently worked around.

### 3. A real no-enemy read, not a half-measure
Every combat-adjacent system genuinely gone — dummy target, weapon fire, pickups, hazards, destructibles, the draft overlay, chaos modifiers, damage numbers, the whole round/score/results wrapper. What's left reads unambiguously as "this is about how you move," not "this is a fight with the guns turned off." The HUD is minimal: no score, no round timer, no health bar with nothing threatening it — if health/combat UI has nothing to report, it should not be on screen at all, not just zeroed out.

Death/respawn survives as a *recovery* mechanic (falling off a wall-jump attempt, landing wrong) — no life count, no scoreboard, no "match." Respawn is instant and returns you to the section you were drilling, never all the way back to the start.

### 4. Every game-feel system gets its moment
This zone is the one place a player can hold still and actually look at what the animation work in this repo does — the argument for building it at all. Leg wobble on landing, wall-slide lean and grip, wall-jump kick, dash torso-commitment, the off-hand's living idle sway — none of it should be incidental background motion here; the level geometry should create moments (the tall drop, the wall shaft, the dash gap) that exist specifically to let each system read clearly, once, before the player moves on.

### 5. The cosmetic tier has a home (verified, done — the pipeline, not the skin)
If/when the Autogenes cosmetic skin (Phase 3 of the animation-rework plan — gold accent, void-black, "self-generated" light-through-crystal read per the Destiny 2 Stasis reference, tracked separately, not part of this rework) ships, the Practice Zone is the natural place to preview it: no combat urgency, plenty of camera-held stillness, the exact context where a player actually looks at their own character. Not a dedicated "mirror room" — just the existing zone doing double duty, since a forked cosmetics-preview scene would be exactly the kind of scope creep the onboarding-ftue skill warns against for tutorials.

This item asks for a *home*, not the skin itself — Phase 3 (the actual Autogenes asset/shader work) is separate, larger, not-yet-started work with its own task. What's verifiable now is the pipeline the skin would ride on: the menu's color/character pickers (`LobbyController.startPractice()`) already flow straight into `MatchScene.init()` → `roomPlayers` → `getLocalRoomPlayer()` → `createPlayerVisuals()` → `ProceduralPlayerRig`'s `color` param, with zero Practice-specific plumbing. Live-verified: setting the menu's `[data-player-color]` picker to an arbitrary color (`#ff00aa`) before entering Practice renders the rig in that exact color, no code changes needed. Whatever the Autogenes skin turns out to be (a color, a character entry, or a small extension of this same pipeline), Practice already previews it today — that's the "home" this item asks for.

### 6. Never a second source of truth
Everything here is additive to `sim/`, never a fork of it. If a future mechanic needs teaching, it gets a new *section* of this same corridor (or a second corridor map, still built on `LocalPlayerController`) — never a new movement system, never a scene-local physics shortcut. The day this zone would need its own physics to teach something the real sim can't do is the day that mechanic doesn't belong in the game yet.

## What "elegant" means here, concretely

- One map file, one scene (`MatchScene.ts` repointed, not duplicated), one physics wrapper (`LocalPlayerController`) — no new categories of thing, only new content inside existing categories.
- Every teaching section is provable by an automated test (reachability or scripted physics), not just "feels fine when I tried it once."
- Nothing in the no-enemy strip is a stub or a hidden flag — deleted code, not `if (practiceMode) return;` scattered through the combat systems.
- The zone costs nothing to maintain going forward: because it shares the real physics, every future tuning pass (new wall-jump numbers, a new card, a new dash augment) is automatically correct here too, with no second place to remember to update.
