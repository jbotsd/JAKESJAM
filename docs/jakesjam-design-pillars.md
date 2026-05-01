# JAKESJAM — Design Pillars

**Status:** living doc. Reflects the post-pivot design (rogue-lite progression, always-on world, per-round chaos, first-blood wager, pity boss, sudden-death shrink, crystal-tech wizard direction).

## What JAKESJAM is

JAKESJAM is a browser-first 2D arena shooter you join by clicking a URL. Spawn into a live FFA, fight tiny crystal-tech wizards with kinetic guns, die, draft a card that bends your weapon into something stupider, respawn, repeat. Rounds are short, chaos modifiers reroll between them, and the build curve is fast enough that round five looks nothing like round one. The simulation is a deterministic shared package (`client/src/sim/`) running on both the Bun authority server and the client predictor.

## Design pillars

Every feature has to support at least one. If it does not, cut it or redesign it.

### 1. Build escalation is the engine of variety

One starter pistol, a pile of orthogonal mutators. The picker between rounds (`sim/data/cards.ts`, resolved by `weaponBuild.ts`) is the entire content engine. By round three the gun should look like a joke; by round five a war crime. New content means new orthogonal axes, not new base weapons.

### 2. Death is a moment of choice

Dying triggers the most interesting decision in the game: which card to draft. Pickups are gone from the arena — all build progression flows through the post-death drafting phase. Death has to feel quick, clean, rewarding.

### 3. Chaos is the texture

Round 1 baseline. Round 2+ rolls from `['low-gravity', 'slow-motion', 'golden-gun', 'slappers-only', 'fire-hazard', 'random-shapes', 'max-recoil']` (`sim/data/chaosModifiers.ts`). Chaos is the second axis of variety after the draft. Modifiers must compose with builds — Golden Gun on a homing-cluster build is the goal.

### 4. Anyone can play in five seconds

Click URL → spawn → shoot. No room codes, no Ready button, no character select, no menu friction. The world is always running, .io-style.

### 5. Readable chaos, cartoon hits

Crystal-tech cyberpunk-sorcerer look (geometric-minimal world, swappable themes — Crystal Cyan default, Gruvbox Tech, Monokai Drift) with cartoon-meaty impacts. VFX never hides hitboxes.

## What we're NOT

- **Not CS:GO.** No SBMM, no ranked ladder, no tactical realism. TTK is short and silly.
- **Not Smash.** Gun-first. Stocks-style elimination replaced by quick respawn into continuous FFA.
- **Not Slay-the-Spire.** The draft is between *rounds*, not matches. Builds reset on world exit. Persistence is cosmetic only.
- **Not Soldat-faithful.** Soldat is directional reference, not target.
- **Not a fantasy game.** "Wizard" means crystal-tech cyberpunk-sorcerer, not Tolkien.

## The match loop

```
Click URL → spawn into live FFA → fight (round timer, sudden death below)
  → die → draft 1 of 3 cards → respawn with the new card applied
  → fight again under a fresh chaos modifier → eventually leave (or stay forever)
The world keeps going. Other players come and go. There is no match-end screen.
```

## Round / stage cadence

Each round is a short, dense, tonally distinct vignette. Round 1 is baseline. Round 2+ rolls a chaos modifier; by round 3 the picker has stacked 1–2 mutators per active player; by round 5 builds are strongly asymmetric. Modifiers should *recolor* the rules, not break them. Slow-motion is underwater; Golden Gun is a high-noon standoff; Fire Hazard turns the floor into a dance. Players should read "what kind of round is this" within the first second.

## Card draft philosophy

The picker is THE feature.

- **Three offers per draft** (`CARD_OFFER_COUNT = 3` in `sim/pickup.ts`). Range 2–5; 3 is the sweet spot.
- **Orthogonal axes.** A draft hand should rarely be three cards on the same axis. Bucket model (`delivery`, `shape`, `trajectory`, `quantity`, `impact`, `element`, `utility` — see `sim/data/cardTypes.ts`).
- **First picks define identity.** Round 2's draft commits you to a path (Blap, Heavy, Trick, Element).
- **Later picks scale.** Round 5+ drafts amplify what you are. Stat-stacking is fine late; identity-shifting is mid-game.
- **Legendaries should feel earned.** Crystal Rounds "Wild" multi-bucket cards. Rare, instant-read, build-into-a-story.
- **No useless cards.** If it never wins, cut it. If it always wins, cap it.

## Distinctive features

- **Per-round chaos** — fresh modifier roll every round 2+; composes with builds.
- **First-blood wager** — first hit-landing player gets a temp speed boost for the round. Rewards aggression over camping.
- **Pity boss mode** — last-place player at 0–3 gets boss buff next round (extra HP, slower, harder-hitting). Losing streaks self-correct and stay theatrical.
- **Sudden-death shrinking arena** — both players at `targetScore-1` triggers arena scaling 1.0 → 0.6 over the round timer.
- **Procedural Crystal-tech-wizard rig** — IK-driven 2D puppet, swappable color themes layered on a "juicing" pass.
- **Deterministic shared sim** — `client/src/sim/` runs on both ends. Enables the prediction + reconciliation loop in `docs/netcode-architecture.md`.

## Anti-patterns

- **No pickups in arena.** Deleted. Build progression flows only through the picker.
- **No menu friction.** No room codes, no Ready button, no host/join split on the always-on path.
- **No pay-to-win.** Persistence is cosmetic; no card/weapon/character gated behind unlocks.
- **No SBMM gating play.** Skill curve handled by chaos and pity, not matchmaking lockout.
- **No fantasy aesthetic.** Crystal-tech, not Tolkien.
- **No second base weapon.** A second starter weapon dilutes the picker.

## What "fun" looks like

Specific moments to optimize for:

- **Absurd stacked build:** round six, your homing-cluster-explosive-pierce monster fires once and the whole arena flashes. Opponent dies before they hear the shot.
- **Comeback after pity boss:** you're 0–3, next round you spawn fat and slow with double damage, eat two shots, parry the third, knock the leader off their high ground.
- **Chaos round where gravity inverts** (low-gravity + max-recoil): every shot launches you across the arena. Nobody is in control. Somebody wins anyway.
- **Sudden-death finish:** both at `target-1`, arena shrinking, no cover, both armed to the teeth, last shot wins. The money moment.
- **First-blood read:** you spawn, sprint, ping the opponent's shield from 800px out, hold the speed buff for the round.

If a feature does not produce one of these moments — or directly enable one — cut it.
