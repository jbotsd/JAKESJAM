---
name: card-recipe
description: >
  End-to-end recipe for adding a roguelite draft card to JAKESJAM.
  Use when the user says "add card", "new card", "card idea", "draft
  card", or when editing client/src/sim/data/cards.ts. Triggers also
  on weapon mutator design tasks. Pairs with combat-balance-ttk
  (TTK band) and roguelite-draft-design (rarity/synergy economy).
version: 1.0.0
---

# Card Recipe

## Why this skill exists

Adding a card touches 4+ files in 3 layers (sim data, draft pool,
test fixture, telemetry). Doing it wrong = a card that's never
drafted, mandatory, or breaks the TTK band. This skill is the
checklist.

## The hard line

**A card is not "added" until: defined in `cards.ts`, weighted in the
draft pool, has a balance test asserting TTK stays in band, and
ships with a rarity assignment that matches its power.**

Never skip the balance test. The draft system relies on cards being
roughly comparable within rarity tier; an unbalanced card warps every
match it appears in.

## File map

| File | Role |
|---|---|
| `client/src/sim/data/cards.ts` | Card definitions: id, name, rarity, mutator function |
| `client/src/sim/weaponBuild.ts` | How card mutators stack into the active weapon |
| `client/src/sim/data/weapons.ts` | Base weapons cards mutate |
| `client/src/sim/__tests__/weaponBuild.test.ts` | Build-stacking tests |
| `client/src/sim/__tests__/draft.test.ts` (or similar) | Pool weighting, draft offer counts |
| `client/src/sim/constants.ts` | `DRAFT_OFFER_COUNT`, rarity weights |

Read all of these before designing a card. The shape of the card you
can express is constrained by `weaponBuild.ts`'s mutator API.

## Step-by-step

### 1. Read the existing card system

```bash
cat client/src/sim/data/cards.ts | head -80
cat client/src/sim/weaponBuild.ts
grep -n "rarity\|RARITY\|weight" client/src/sim/data/cards.ts client/src/sim/constants.ts
```

Understand:
- What rarity tiers exist (common/uncommon/rare/legendary?)
- What weights each tier has in the draft pool
- What mutator slots the WeaponBuild exposes (damage mult, projectile
  count, fire rate, shape, pathing, element, etc.)

### 2. Pick rarity by power level (not flavor)

| Rarity | Power band | Example |
|---|---|---|
| common | ±10% baseline | "+15% damage", "+1 projectile to side-shots" |
| uncommon | ±20–30%, single-axis | "+30% fire rate", "homing on small targets" |
| rare | ±40%, multi-axis or new mechanic | "split projectiles on hit", "ricochet 1×" |
| legendary | game-changing, anti-archetype | "swap weapon to katana with +100% damage" |

Power inflation is the #1 design failure mode. If unsure, ship at one
rarity lower than your gut says.

### 3. Define the card

```ts
// client/src/sim/data/cards.ts
export const CARDS = [
  // ... existing cards
  {
    id: "burst-volley" as CardId,
    name: "Burst Volley",
    rarity: "uncommon",
    description: "Fires 3 projectiles in a tight cone every 2nd shot.",
    mutator: (build: WeaponBuild): WeaponBuild => ({
      ...build,
      // mutator implementation
    }),
  },
] satisfies readonly Card[];
```

Use `satisfies` (not `as`) per `ts-pocock` skill. Brand the id.

### 4. Write the build-stacking test

```ts
// client/src/sim/__tests__/weaponBuild.test.ts
test("burst-volley stacks with base", () => {
  const base = makeBaseWeapon();
  const card = CARDS.find(c => c.id === "burst-volley")!;
  const built = applyMutators(base, [card]);
  expect(built.projectileCount).toBe(3);
  expect(built.fireRateMultiplier).toBeCloseTo(0.5);
});
```

Test the stacking with at least one OTHER card to catch interaction
bugs:

```ts
test("burst-volley + double-shot: projectile count multiplies", () => {
  // ... assert no exponential explosion
});
```

### 5. TTK band check (mandatory)

Add to `client/src/sim/__tests__/weaponBuild-ttk.test.ts` (or the
canonical TTK suite — read `combat-balance-ttk` skill):

```ts
test("burst-volley solo card: TTK in band", () => {
  const ttk = simulateTTK({
    attackerCards: ["burst-volley"],
    defenderArchetype: "balanced",
    range: "neutral",
  });
  expect(ttk).toBeGreaterThanOrEqual(1.8);
  expect(ttk).toBeLessThanOrEqual(3.5);
});
```

If TTK falls outside the band: rebalance the card (lower the multiplier),
not the band. The band is the constraint.

### 6. Verify

```bash
cd /mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM
bun test client/src/sim/__tests__/weaponBuild
bun test client/src/sim/__tests__/draft
bun typecheck
```

All green. Otherwise, the card is not added.

## Anti-patterns

- ❌ Adding a card without a TTK test ("seems fine in playtesting")
- ❌ Legendary rarity for "fun flavor" cards — flavor is for common
- ❌ Cards that synergize multiplicatively without a cap (e.g. "+30%
  damage" + "+30% damage" + "+30% damage" → 219.7%, breaks TTK)
- ❌ Writing the mutator as a closure over external state — must be
  pure given a WeaponBuild input (sim determinism)
- ❌ Adding card to `cards.ts` but forgetting to wire into the draft
  pool (card is defined but never offered)

## Reporting a card add

```
added card: <id> (<rarity>)
files: cards.ts, weaponBuild.test.ts, weaponBuild-ttk.test.ts
TTK measured: <value>s (in band 1.8–3.5)
verified: bun test sim/ → N pass, 0 fail
```
