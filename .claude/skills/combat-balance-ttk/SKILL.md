---
name: combat-balance-ttk
description: >
  Time-to-kill, weapon archetype matrix, dodge windows, parry timing,
  damage curves. Use when editing client/src/sim/data/weapons.ts,
  weaponBuild.ts, sim/combat.ts, or sim/constants.ts. Also use when
  reviewing chaos modifiers that change damage, RPS, or hitboxes —
  they must keep TTK inside the band.
version: 1.0.0
---

# Combat Balance & TTK

## Why this skill exists

JAKESJAM is a 1v1-first arena shooter pivoting to N-player. Every
new card, weapon, or chaos modifier shifts the time-to-kill (TTK)
curve. Without a stated TTK target, balance becomes "whoever shipped
the last weapon gets to feel powerful". Halo, Quake, and the FGC
have already settled this argument: pick a TTK band, defend it,
and *every* weapon must justify itself against the band.

## The hard line

**1v1 TTK target band: 1.8s – 3.5s at neutral range. Any weapon or
card that pushes the median TTK outside this band is broken until
proven otherwise. No "instakill" weapons. No "tickle" weapons. No
exceptions for "fun" — fun is what TTK enables.**

## What the KOL says

**Jaime Griesemer, "30 seconds of fun"** — Halo lead designer,
Bungie. The phrase came out of the GDC 2002 talk *The Illusion of
Intelligence: AI and Level Design in Halo* (with Chris Butcher) and
got canonised in the Halo 2 behind-the-scenes documentary:

> "In Halo 1, there was maybe 30 seconds of fun that happened over
> and over and over again, so if you can get 30 seconds of fun, you
> can pretty much stretch that out to be an entire game."
> — Jaime Griesemer

Two implications JAKESJAM must honour:
1. The 30-second loop is *engagement → flank → reposition → engage*.
   If the TTK is too short the loop collapses to "die first, lose".
   If too long, the loop stretches past 30s and players disengage.
2. Every weapon must be evaluable inside *one* engagement. Weapons
   whose value is "useful in the next fight" (e.g. status DoT that
   only matters in 8s) are second-class.

**David Sirlin, "Playing to Win"** — Street Fighter HD Remix designer.
Sirlin's chapter "Balance Theory" introduces the *paper-rock-scissors
test*: every viable strategy must have at least one strategy that
beats it. Single-strategy dominance ("scrub strategies") destroys
competitive depth.

> "If a strategy has no counter, the metagame collapses to that
> strategy. Add the counter, or remove the strategy."
> — Sirlin, Playing to Win, ch. "Balance Theory"

## How JAKESJAM applies it

Concrete files:

- `client/src/sim/data/weapons.ts` — base weapon defs (DPS, RPS,
  spread, projectile speed). Constrained by the TTK band.
- `client/src/sim/data/weaponBuild.ts` — applies cards. The unit
  test boundary for "this combo breaks TTK".
- `client/src/sim/combat.ts` — damage application, parry/shield
  resolution. Defines the dodge window via projectile speed +
  player accel.
- `client/src/sim/constants.ts` — `PLAYER_BASE_HP`,
  `PARRY_WINDOW_MS`, `SHIELD_DURATION_MS`. These are the levers.
- `client/src/sim/data/chaosModifiers.ts` — modifiers like
  `golden-gun` (1-shot kill) violate the band by design. They are
  *temporal* (one round) and clearly signposted; not the default
  experience.

`PLAYER_BASE_HP = 100` is the anchor. A weapon doing 30 dmg/shot at
3 RPS = 1.1s TTK ⇒ too fast. Same weapon at 2 RPS = 1.7s ⇒ at the
edge. 25 dmg/shot at 3 RPS = 1.3s ⇒ still too fast. 25 at 2 RPS =
2.0s ⇒ in band.

## Recipes

### 1. Compute TTK as a derived constant in the data file

```ts
// client/src/sim/data/weapons.ts
import { PLAYER_BASE_HP } from '../constants';

export type WeaponDef = {
  id: WeaponId;
  damagePerShot: number;
  shotsPerSecond: number;
  // ... pathing, shape, etc.
};

export function neutralTTK(w: WeaponDef): number {
  return PLAYER_BASE_HP / (w.damagePerShot * w.shotsPerSecond);
}

// Asserted in tests:
//   for (const w of WEAPONS) {
//     expect(neutralTTK(w)).toBeGreaterThanOrEqual(1.8);
//     expect(neutralTTK(w)).toBeLessThanOrEqual(3.5);
//   }
```

Add the assertion in `client/src/sim/__tests__/weaponBuild.test.ts`.
Any new weapon outside the band fails CI.

### 2. The archetype matrix (Sirlin's RPS test)

The MVP has 4 weapon paths (`AGENTS.md`). Lock them as a
deliberate paper-rock-scissors:

| Archetype | Strong vs   | Weak vs      | TTK target |
| --------- | ----------- | ------------ | ---------- |
| Rapid     | Heavy       | Burst        | 2.0s       |
| Heavy     | Burst       | Rapid (kite) | 2.4s       |
| Burst     | Rapid       | Heavy (miss) | 1.9s       |
| Control   | All (zone)  | Direct DPS   | 3.2s       |

Every card must declare which archetype it pushes the build toward
(`tag` in `cards.ts`). The matrix is the single source of truth in
`docs/jakesjam-design-pillars.md` — update both files together.

### 3. Dodge window must exceed reaction time

Human reaction to a visual stimulus floors at ~200ms (the literature
hovers 200–250ms for trained shooter players). Projectiles in
JAKESJAM must give the target ≥ 250ms between *visible spawn* and
*impact* at neutral range (16 tiles). Below that, the game stops
being a duel and becomes hitscan roulette.

```ts
// client/src/sim/__tests__/weapon.test.ts
test('every projectile is dodgeable at neutral range', () => {
  for (const w of WEAPONS) {
    const distance = NEUTRAL_RANGE_TILES * TILE_SIZE;
    const timeToImpact = distance / w.projectileSpeed;
    expect(timeToImpact).toBeGreaterThanOrEqual(0.25);
  }
});
```

### 4. Parry/shield as a deliberate counter, not an escape

`PARRY_WINDOW_MS` should sit in the 120–180ms range. Below 120ms it's
muscle-memory only (no skill ceiling for newcomers). Above 180ms it
becomes the dominant strategy and the game devolves to "hold parry".

```ts
// client/src/sim/constants.ts
export const PARRY_WINDOW_MS = 150;        // Sirlin: "make the optimal play hard but learnable"
export const PARRY_COOLDOWN_MS = 1200;     // Hard cooldown. No spamming.
export const SHIELD_DURATION_MS = 600;     // Shorter than TTK by half — never a get-out-of-jail card
```

### 5. Per-card TTK regression test

Every card mutation goes through `createWeaponBuild`. Test the worst-
case (best-case for the picker) combo:

```ts
// client/src/sim/__tests__/weaponBuild.test.ts
test('no card combo lets a weapon breach 1.5s TTK', () => {
  for (const w of WEAPONS) {
    for (const c1 of CARDS) for (const c2 of CARDS) for (const c3 of CARDS) {
      if (c1 === c2 || c2 === c3 || c1 === c3) continue;
      const build = createWeaponBuild(w, [c1, c2, c3]);
      expect(neutralTTKBuild(build)).toBeGreaterThanOrEqual(1.5);
    }
  }
});
```

The hard floor is 1.5s (not 1.8s) because card stacking is the
*reward* for winning the draft; allow a 0.3s squeeze, not a free
instakill.

### 6. Chaos modifiers signposted as out-of-band

```ts
// client/src/sim/data/chaosModifiers.ts
export type ChaosModifier = {
  id: ChaosModifierId;
  ttkBandViolation: boolean;   // explicit declaration
  // ...
};

// In the round banner:
if (modifier.ttkBandViolation) {
  banner.show(`CHAOS: ${modifier.label} (extreme TTK)`, 0xff3333);
}
```

Players need to *know* the round is wild. Quiet rule changes are the
#1 perceived-unfairness driver in arena PvP.

## Anti-patterns

- **Adding a "+50% damage" card.** It always picks. Always
  dominates. It violates the matrix. Do not ship.
- **A weapon whose dodge window is < 250ms at neutral range.**
  Hitscan roulette. Players blame the netcode. Netcode isn't the
  problem.
- **Parry window > 200ms.** Optimal play becomes "hold parry,
  punish on whiff". The game becomes a parry-fishing simulator.
- **Adding a 5th archetype "for variety" before the 4 are tuned.**
  Sirlin: tighten the matrix before widening it.
- **Treating chaos modifiers as the default tuning lever.** They
  are exceptions. The base game must sing without any modifier on.
- **Per-weapon balance in isolation.** Balance the *matrix*, not
  the cell. A buff to Rapid implies a re-look at Heavy and Burst.
- **Letting `WeaponSystem.ts` (render layer) compute damage.**
  Damage lives in `sim/combat.ts`. Render shows the number, never
  decides it.

## Pre-flight checklist

- [ ] `neutralTTK(w)` test passes for every weapon in the band.
- [ ] Every card's worst-case stack tested against the 1.5s floor.
- [ ] Every projectile has ≥250ms dodge window at neutral range.
- [ ] `PARRY_WINDOW_MS` is between 120 and 180.
- [ ] `SHIELD_DURATION_MS < neutralTTK(slowestWeapon) * 1000 / 2`.
- [ ] The 4 archetypes still fit the RPS matrix after the change.
- [ ] Chaos modifiers that violate TTK are flagged and the banner
      warns the player.
- [ ] No new card grants flat unconditional damage with no
      counterplay.
- [ ] `docs/jakesjam-design-pillars.md` updated if the matrix
      shifted.

## Source

- Jaime Griesemer / Chris Butcher, "The Illusion of Intelligence:
  AI and Level Design in Halo" — GDC 2002. Catalog entry referenced
  in: https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
- Half-Minute Halo interview (Engadget, 2011, the canonical source
  for the "30 seconds of fun" quote):
  https://www.engadget.com/2011-07-14-half-minute-halo-an-interview-with-jaime-griesemer.html
- David Sirlin, "Playing to Win: Becoming the Champion" — full text
  https://www.sirlin.net/ptw — chapter "Balance Theory" especially.
