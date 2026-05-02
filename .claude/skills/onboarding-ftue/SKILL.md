---
name: onboarding-ftue
description: >
  First-time-user experience for the io-style always-on JAKESJAM lobby
  and first match. Use when editing client/src/game/scenes/MainMenuScene.ts,
  BootScene.ts, the lobby Convex flow, or anything a brand-new player
  sees before their first kill. Triggered by "tutorial", "onboarding",
  "FTUE", "first match", "new player".
version: 1.0.0
---

# Onboarding & First-Time-Player Experience

## Why this skill exists

JAKESJAM's planned io-style flow is "land on URL → name yourself → in
a match in <10 seconds". That's the *strength* of the genre, but it
puts the entire teaching burden on the first 60 seconds of gameplay.
There is no time for a 5-minute scripted tutorial, and forced
tutorials in PvP shooters churn 20–40% of new players (GMTK survey
data + Steam refund cohorts). Mark Brown has already published the
exact decision tree for "do I make a tutorial?" and "if so, what
shape?". This skill encodes it for JAKESJAM's specific shape.

## The hard line

**No modal tutorial. No "press WASD to move" overlay. Teach inside
the first match via designed encounters and progressive disclosure.
Every mechanic the player can do in round 1 must be discoverable in
round 1 — without text — by a player who has never read a games
journalism article in their life.**

## What the KOL says

**Mark Brown, Game Maker's Toolkit**, has 10+ years of tutorial-design
videos. The core rules across the series:

> "The best tutorials are levels. They aren't pop-ups. They aren't
> arrows. They're *spaces designed so that the only thing you can
> do is the thing you need to learn*."
> — Mark Brown, multiple GMTK videos on tutorial design

Brown's tutorial heuristics (paraphrased from the GMTK back catalogue
and his "10 Game Design Lessons from 10 Years of GMTK" recap):

1. **Teach mechanics in their context of use** — never on a blank
   plain.
2. **Use Mario 1-1 framing** — present the danger, present the
   tool, let the player connect them.
3. **One mechanic per encounter.** Don't teach "double jump while
   shooting while parrying".
4. **No text until the player has tried.** Reward discovery; only
   *confirm* with text after the fact.
5. **Cut anything you'd describe as 'optional reading'.** If they
   skip it, they skip it forever.

JAKESJAM cannot use Brown's preferred technique (single-player
designed encounters) because round 1 is PvP. So we adapt: **the
*lobby* is the tutorial, and the first match drops the player into
a deliberately easy bot warmup if it's their first session.**

## How JAKESJAM applies it

Concrete files:

- `client/src/game/scenes/MainMenuScene.ts` — first thing they see.
  Currently asks for a name + room code. Add the auto-spawn movement
  playground BEHIND the menu (visible while typing).
- `client/src/game/scenes/BootScene.ts` / `PreloadScene.ts` — the
  asset load. Cover it with a kinetic title that demonstrates a
  rocket arc and an explosion. The loading screen *is* the trailer.
- `convex/users.ts` — needs a `firstSessionAt` timestamp so the
  match-maker can detect "this player has never played". On detect,
  matchmaker queues them into a bot-only match for 90s before real
  matchmaking.
- `client/src/game/scenes/OnlineMatchScene.ts` — show the controls
  legend ONLY in round 1, ONLY for new players, ONLY in the first
  3 seconds of the round. Auto-fades.
- `client/src/game/ui/CardDraftOverlay.ts` — first draft ever shows
  one extra line: "Pick one. Stacks for the rest of the match."
  Then never shows it again.

## Recipes

### 1. The "playground in the menu"

```ts
// client/src/game/scenes/MainMenuScene.ts
create() {
  // The menu is layered ON TOP of a tiny live sim instance.
  this.playground = new MenuPlayground(this, {
    width: 640, height: 360,
    botCount: 2,
    map: 'boxworks-mini',
  });
  this.playground.start();   // bots fight bots in the background

  this.add.text(...);        // menu UI on top
}
```

The player picks up movement and shooting *visually* before they
ever click "Find Match". This is Brown's "show, don't tell" applied
at the front door.

### 2. First-session bot warmup

```ts
// convex/matchmaker.ts (Convex query/mutation — lobby only,
// no 60Hz path)
export const findMatch = mutation({
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user.firstSessionAt) {
      // Mark and route to a bot match
      await ctx.db.patch(userId, { firstSessionAt: Date.now() });
      return { kind: 'bot-warmup', durationSec: 90 };
    }
    return realMatchmaker(ctx, userId);
  },
});
```

The bot warmup runs on the same Bun host using the same `MatchHost`,
but with `BotPlayer` entities seeded by the sim. Same code path. No
forked "tutorial mode" to maintain.

### 3. Progressive disclosure for HUD

```ts
// client/src/game/ui/HudSystem.ts
showFor(playerId: PlayerId, isFirstMatch: boolean) {
  this.showHealth();
  this.showAmmo();
  if (isFirstMatch) {
    this.showControlsLegend();             // fades after 3s
    this.showLegend('shoot', 0);
    this.showLegend('jump', 800);
    this.showLegend('parry', 1600);
  }
}
```

After round 1 the legend never appears again, even if the player
loses. Mark Brown's rule: *don't keep teaching after they've shown
they can do it*.

### 4. The Mario 1-1 first map

`docs/visual-overhaul` and `data/boxworks.ts` already define
Boxworks. For first-match ONLY, use `boxworks-tutorial` (a small
variant of `boxworks-mini`):

- Single elevated platform (teaches platforming).
- One destructible barrel placed where a new player will try to
  shoot it (teaches destructibles → see `phaser4-game` skill on
  visual hierarchy).
- Two health pickups in clearly opposite corners (teaches "go get
  the pickup").
- One chaos modifier locked off (don't teach 3 things at once).

Add `boxworks-tutorial` to `client/src/sim/data/maps.ts` and
register in `MapPicker.ts`. Tutorial map is server-side selected
when `kind: 'bot-warmup'` is set.

### 5. Card draft tutorial — by example

The first-ever card pick shows 3 *deliberately good and obviously
different* cards: one rapid-fire, one heavy-damage, one mobility.
The "synergy tag" chips light up so the player sees them. After
they pick, the next round's draft shows another card with the same
tag chip pre-highlighted ("synergy: matches your last pick"). This
teaches the synergy system without text.

```ts
// client/src/sim/round.ts — drafting phase
const offers = isFirstDraftEver(state, playerId)
  ? FIRST_EVER_DRAFT   // hand-picked deterministic 3
  : rollDraftOffers(state, playerId);
```

`FIRST_EVER_DRAFT` lives in `sim/data/cards.ts` as a constant — it
doesn't break determinism (same input → same output).

### 6. Death screen as the teacher

Most learning in PvP happens on the death screen — they have
attention, they're frustrated, they want to know why. Use it.

```ts
// client/src/game/ui/DeathOverlay.ts
showCauseOfDeath({
  killer, weapon, distance, dodgeAvailable
}: DeathCause) {
  this.show(`Killed by ${killer.name} — ${weapon.name}`);
  if (dodgeAvailable && distance > NEUTRAL_RANGE_TILES) {
    this.show('You could have dodged this projectile.');
  } else if (weapon.kind === 'parry-vulnerable') {
    this.show('Hold SHIFT next time to parry.');
  }
  // ... never more than one tip per death.
}
```

One tip per death. Brown: "if you give them three, they read zero."

## Anti-patterns

- **A modal "Press WASD to move" overlay.** Players close it. They
  never read it. They wonder why the game feels slow.
- **A separate single-player tutorial scene.** Forks the codebase,
  rots, and the bot AI in it diverges from the real bot AI used
  in matches.
- **A "Skip Tutorial" button.** If you're offering it, the
  tutorial is wrong. Brown: "the only good tutorial is the one
  you can't tell is a tutorial."
- **Showing every keybinding at once.** Brown's "one mechanic per
  encounter" rule. Stagger them.
- **Re-showing the controls legend on round 2.** They learned it.
  Stop nagging.
- **Treating Convex `firstSessionAt` as authoritative for combat
  decisions.** It's a lobby flag — the match host trusts the
  matchmaker payload, doesn't re-query Convex inside the 60Hz loop.
- **Designing the tutorial map to be "balanced".** It should be
  *stacked toward the new player learning a thing*, not a fair
  duel.

## Pre-flight checklist

- [ ] No modal popup blocks the game on first launch.
- [ ] Menu shows live gameplay behind it (the playground).
- [ ] Convex matchmaker routes new users (no `firstSessionAt`) to
      a bot warmup.
- [ ] First match uses `boxworks-tutorial`, no chaos modifier.
- [ ] HUD legend appears only in round 1, fades after 3s.
- [ ] First-ever card draft offers a hand-picked, tag-diverse trio.
- [ ] Death overlay surfaces ONE specific tip — never three.
- [ ] No "Skip Tutorial" button anywhere.
- [ ] Playtest with a player who has never seen JAKESJAM. They
      get a kill in round 1 or 2.

## Source

- Game Maker's Toolkit channel (Mark Brown):
  https://www.youtube.com/channel/UCqJ-Xo29CKyLTjn6z2XwYAw
- "10 Game Design Lessons from 10 Years of GMTK" (the recap of
  Brown's recurring rules):
  https://www.youtube.com/watch?v=Cm2_drGLGbc
- "How To Think Like A Game Designer":
  https://www.youtube.com/watch?v=iIOIT3dCy5w
- Brown's site (back catalogue index):
  https://gamemakerstoolkit.com/
