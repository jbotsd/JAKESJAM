# Card Redesign Proposals

**ROUNDS-Style Tradeoffs for JAKESJAM**  
**Date:** 2026-05-02  
**Purpose:** Transform JAKESJAM cards with explicit tradeoffs

---

## Part 1: Existing Cards Redesigned (10 Cards)

### Card 1: Bigger Bullets → **Bulky Rounds**

```typescript
{
  id: "bulky_rounds",
  name: "Bulky Rounds",
  category: "projectile",
  rarity: "common",
  
  description: "Larger, heavier projectiles",
  
  benefits: [
    { stat: "projectileSize", value: 1.6, multiplier: true },   // +60% size
    { stat: "damage", value: 1.15, multiplier: true },          // +15% damage
    { stat: "knockback", value: 1.2, multiplier: true },        // +20% knockback
  ],
  penalties: [
    { stat: "fireRate", value: 0.8, multiplier: true },         // -20% fire rate
    { stat: "reloadTime", value: 0.3, multiplier: false },      // +0.3s reload
    { stat: "projectileSpeed", value: 0.85, multiplier: true }, // -15% speed
  ],
  
  behavioralChange: "Slower shooting but hits harder and easier to land",
  synergyTags: ["homing", "slow-projectiles", "knockback"],
  maxStacks: 3,
}
```

**Design Notes:**
- ROUNDS inspiration: "Big Bullets" (+0.25s reload)
- JAKESJAM adaptation: Added damage and speed tradeoffs
- Visual: Projectile visibly larger, slower travel
- Counterplay: Dodge easier due to slow speed

---

### Card 2: Ricochet → **Ricochet Rounds**

```typescript
{
  id: "ricochet_rounds",
  name: "Ricochet Rounds",
  category: "projectile",
  rarity: "uncommon",
  
  description: "Bullets bounce off terrain once",
  
  benefits: [
    { stat: "bounces", value: 1, multiplier: false },           // +1 bounce
    { stat: "damage", value: 1.2, multiplier: true },           // +20% damage on bounce
  ],
  penalties: [
    { stat: "fireRate", value: 0.85, multiplier: true },        // -15% fire rate
    { stat: "reloadTime", value: 0.25, multiplier: false },     // +0.25s reload
    { stat: "directDamage", value: 0.9, multiplier: true },     // -10% direct hit damage
  ],
  
  behavioralChange: "Shoot walls for angled attacks, weaker direct hits",
  synergyTags: ["bounce", "geometry", "trick-shot", "target-bounce"],
  maxStacks: 2,
}
```

**Design Notes:**
- ROUNDS inspiration: "Bouncy" (+2 bounces, +25% DMG, +0.25s reload)
- JAKESJAM adaptation: Penalize direct hits to encourage creative angles
- Visual: Brighter trail on bounced projectiles
- Counterplay: Stand away from walls

---

### Card 3: Split Shot → **Twin Barrel**

```typescript
{
  id: "twin_barrel",
  name: "Twin Barrel",
  category: "weapon",
  rarity: "uncommon",
  
  description: "Fires two weaker projectiles per shot",
  
  benefits: [
    { stat: "projectileCount", value: 2, multiplier: false },   // Fire 2 projectiles
    { stat: "damage", value: 0.65, multiplier: true },          // Each does 65% damage (130% total)
  ],
  penalties: [
    { stat: "spread", value: 1.8, multiplier: true },           // +80% spread
    { stat: "reloadTime", value: 0.3, multiplier: false },      // +0.3s reload
    { stat: "ammoCost", value: 2, multiplier: false },          // Uses 2 ammo per shot
  ],
  
  behavioralChange: "Double hits at close range, wasteful and inaccurate",
  synergyTags: ["spray", "close-range", "multi-projectile", "scavenger"],
  maxStacks: 2,
}
```

**Design Notes:**
- ROUNDS inspiration: "Barrage" (+4 bullets, -70% DMG)
- JAKESJAM adaptation: Ammo cost penalty prevents infinite spraying
- Visual: Two muzzle flashes, slightly angled projectiles
- Counterplay: Stay at range where spread matters

---

### Card 4: Heavy Rounds → **Slug Rounds**

```typescript
{
  id: "slug_rounds",
  name: "Slug Rounds",
  category: "weapon",
  rarity: "common",
  
  description: "Single heavy projectile with massive knockback",
  
  benefits: [
    { stat: "damage", value: 1.6, multiplier: true },           // +60% damage
    { stat: "knockback", value: 2.0, multiplier: true },        // +100% knockback
    { stat: "projectileSize", value: 1.4, multiplier: true },   // +40% size
  ],
  penalties: [
    { stat: "fireRate", value: 0.5, multiplier: true },         // -50% fire rate
    { stat: "projectileSpeed", value: 0.7, multiplier: true },  // -30% speed
    { stat: "projectileCount", value: 0.5, multiplier: true },  // Fire half as many (if multi-shot)
  ],
  
  behavioralChange: "Slow, telegraphed shots that launch enemies",
  synergyTags: ["sniper", "knockback", "high-damage", "stage-kill"],
  maxStacks: 3,
}
```

**Design Notes:**
- ROUNDS inspiration: "Combine" (+100% DMG, -2 ammo, +0.5s reload)
- JAKESJAM adaptation: Emphasize knockback for stage kills
- Visual: Large, dark projectile with heavy trail
- Counterplay: Easy to dodge due to slow speed

---

### Card 5: Quick Hands → **Muscle Memory**

```typescript
{
  id: "muscle_memory",
  name: "Muscle Memory",
  category: "weapon",
  rarity: "common",
  
  description: "Faster reload and weapon swap",
  
  benefits: [
    { stat: "reloadTime", value: -0.5, multiplier: false },     // -0.5s reload
    { stat: "fireRate", value: 1.15, multiplier: true },        // +15% fire rate
    { stat: "weaponSwap", value: 0.5, multiplier: true },       // -50% swap time
  ],
  penalties: [
    { stat: "damage", value: 0.85, multiplier: true },          // -15% damage
    { stat: "accuracy", value: 0.8, multiplier: true },         // -20% accuracy (more spread)
  ],
  
  behavioralChange: "Reload often to maintain DPS, less precise",
  synergyTags: ["reload", "sustained-dps", "tactical-reload"],
  maxStacks: 3,
}
```

**Design Notes:**
- ROUNDS inspiration: "Quick Reload" (-70% reload time)
- JAKESJAM adaptation: Added accuracy penalty for balance
- Visual: Faster reload animation, slightly wider spread
- Counterplay: Bait reload, punish during reload window

---

### Card 6: Spray & Pray → **Full Auto Mod**

```typescript
{
  id: "full_auto_mod",
  name: "Full Auto Mod",
  category: "weapon",
  rarity: "uncommon",
  
  description: "Hold to fire continuously, massive spread",
  
  benefits: [
    { stat: "fireRate", value: 2.5, multiplier: true },         // +150% fire rate
    { stat: "magazineSize", value: 1.8, multiplier: true },     // +80% mag size
    { stat: "reloadTime", value: -0.3, multiplier: false },     // -0.3s reload
  ],
  penalties: [
    { stat: "damage", value: 0.45, multiplier: true },          // -55% damage
    { stat: "spread", value: 3.0, multiplier: true },           // +200% spread
    { stat: "accuracy", value: 0.5, multiplier: true },         // -50% accuracy
  ],
  
  behavioralChange: "Get in close and hold trigger, ineffective at range",
  synergyTags: ["spray", "close-range", "dps", "scavenger"],
  maxStacks: 2,
}
```

**Design Notes:**
- ROUNDS inspiration: "Spray" (+1000% ATKSPD, +12 ammo, -75% DMG)
- JAKESJAM adaptation: Slightly less extreme, more controllable
- Visual: Rapid muzzle flash, heavy smoke
- Counterplay: Stay at range, they can't aim

---

### Card 7: Rocket Feet → **Thruster Boots**

```typescript
{
  id: "thruster_boots",
  name: "Thruster Boots",
  category: "movement",
  rarity: "uncommon",
  
  description: "Jumping launches you higher with explosion on landing",
  
  benefits: [
    { stat: "jumpHeight", value: 1.7, multiplier: true },       // +70% jump
    { stat: "moveSpeed", value: 1.25, multiplier: true },       // +25% speed
    { stat: "landingDamage", value: 25, multiplier: false },    // 25 damage on landing near enemies
  ],
  penalties: [
    { stat: "health", value: 0.75, multiplier: true },          // -25% health
    { stat: "landingRecovery", value: 0.4, multiplier: false }, // +0.4s recovery
    { stat: "control", value: 0.8, multiplier: true },          // -20% air control
  ],
  
  behavioralChange: "High mobility, fragile, risky landings",
  synergyTags: ["vertical", "evasive", "glass-cannon", "aoe"],
  maxStacks: 2,
}
```

**Design Notes:**
- ROUNDS inspiration: "Shield Charge" (launch forward) + "Taste of Blood" (speed on hit)
- JAKESJAM adaptation: Added landing damage for offensive potential
- Visual: Flame trail from boots, explosion dust on landing
- Counterplay: Anti-air, punish recovery frames

---

### Card 8: Panic Shield → **Reactive Barrier**

```typescript
{
  id: "reactive_barrier",
  name: "Reactive Barrier",
  category: "defense",
  rarity: "common",
  
  description: "Shield at round start, explodes when broken",
  
  benefits: [
    { stat: "shieldHealth", value: 40, multiplier: false },     // +40 shield HP
    { stat: "damageReduction", value: 0.6, multiplier: true },  // 40% reduction while shield active
    { stat: "explosionDamage", value: 30, multiplier: false },  // 30 damage when shield breaks
  ],
  penalties: [
    { stat: "health", value: 0.85, multiplier: true },          // -15% health
    { stat: "moveSpeed", value: 0.9, multiplier: true },        // -10% speed
  ],
  
  behavioralChange: "Strong early game, play aggressive until shield breaks",
  synergyTags: ["shield", "defensive", "early-game", "explosion"],
  maxStacks: 1, // Unique
}
```

**Design Notes:**
- ROUNDS inspiration: "Defender" (-30% block cooldown, +30% HP)
- JAKESJAM adaptation: Made it round-start only with explosion payoff
- Visual: Blue barrier that cracks and explodes
- Counterplay: Break shield early, then exploit low health

---

### Card 9: Last Chance → **Phoenix Protocol**

```typescript
{
  id: "phoenix_protocol",
  name: "Phoenix Protocol",
  category: "defense",
  rarity: "rare",
  
  description: "Auto-revive once per match at 50% HP",
  
  benefits: [
    { stat: "revive", value: 1, multiplier: false },            // 1 auto-revive per match
    { stat: "reviveHealth", value: 50, multiplier: false },     // Revive at 50% HP
    { stat: "reviveIframes", value: 2.0, multiplier: false },   // 2s invincibility on revive
  ],
  penalties: [
    { stat: "health", value: 0.65, multiplier: true },          // -35% health permanently
    { stat: "moveSpeed", value: 0.85, multiplier: true },       // -15% speed
    { stat: "damage", value: 0.9, multiplier: true },           // -10% damage
  ],
  
  behavioralChange: "One free mistake, but permanently weaker",
  synergyTags: ["revive", "comeback", "high-risk", "sustain"],
  maxStacks: 1, // Unique
}
```

**Design Notes:**
- ROUNDS inspiration: "Phoenix" (-35% HP, respawn once)
- JAKESJAM adaptation: Added iframes and reduced penalties
- Visual: Golden glow, fiery revive animation
- Counterplay: Burst damage through iframes, or wait them out

---

### Card 10: Glass Cannon → **Overclocked Core**

```typescript
{
  id: "overclocked_core",
  name: "Overclocked Core",
  category: "tradeoff",
  rarity: "uncommon",
  
  description: "Massive damage boost, critical fragility",
  
  benefits: [
    { stat: "damage", value: 2.2, multiplier: true },           // +120% damage
    { stat: "fireRate", value: 1.2, multiplier: true },         // +20% fire rate
  ],
  penalties: [
    { stat: "health", value: 0.45, multiplier: true },          // -55% health
    { stat: "knockbackResistance", value: 0.5, multiplier: true }, // -50% knockback resistance
    { stat: "shieldEffectiveness", value: 0.5, multiplier: true }, // -50% shield effectiveness
  ],
  
  behavioralChange: "Delete enemies in 2 shots, die in 2 hits",
  synergyTags: ["high-risk", "burst", "all-in", "sniper"],
  maxStacks: 1, // Unique
}
```

**Design Notes:**
- ROUNDS inspiration: "Glass Cannon" (+100% DMG, -100% HP)
- JAKESJAM adaptation: Slightly less extreme HP penalty, added defense weaknesses
- Visual: Glowing red aura, crackling energy
- Counterplay: Focus fire, any hit hurts them badly

---

## Part 2: New Cards in ROUNDS Style (5 Cards)

### Card 11: **Vampiric Touch**

```typescript
{
  id: "vampiric_touch",
  name: "Vampiric Touch",
  category: "defense",
  rarity: "uncommon",
  
  description: "Heal on hit, but healing is delayed",
  
  benefits: [
    { stat: "lifesteal", value: 0.4, multiplier: false },       // 40% of damage dealt heals you
    { stat: "healDelay", value: 2.0, multiplier: false },       // Healing delayed by 2 seconds
    { stat: "maxHealPerHit", value: 15, multiplier: false },    // Max 15 HP per hit
  ],
  penalties: [
    { stat: "health", value: 0.85, multiplier: true },          // -15% health
    { stat: "regen", value: 0, multiplier: false },             // No natural regen
  ],
  
  behavioralChange: "Aggressive play rewarded, but can't heal passively",
  synergyTags: ["lifesteal", "sustain", "aggressive", "close-range"],
  maxStacks: 2,
}
```

**Design Notes:**
- ROUNDS inspiration: "Leech" (+75% lifesteal) + "Brawler" (regen after dealing DMG)
- JAKESJAM innovation: Delayed healing creates risk/reward timing
- Visual: Red tendrils from enemy to player on heal
- Counterplay: Disengage after they hit you, let DoT finish them

---

### Card 12: **Gravity Well**

```typescript
{
  id: "gravity_well",
  name: "Gravity Well",
  category: "utility",
  rarity: "rare",
  
  description: "Blocking creates a pull field that slows enemies",
  
  benefits: [
    { stat: "blockPullRadius", value: 200, multiplier: false }, // 200px radius pull field
    { stat: "blockPullStrength", value: 150, multiplier: false }, // Pull force
    { stat: "blockSlow", value: 0.5, multiplier: true },        // 50% slow in field
    { stat: "blockDuration", value: 3.0, multiplier: false },   // Field lasts 3 seconds
  ],
  penalties: [
    { stat: "blockCooldown", value: 0.5, multiplier: false },   // +0.5s block cooldown
    { stat: "moveSpeed", value: 0.9, multiplier: true },        // -10% speed
  ],
  
  behavioralChange: "Control space with blocks, pull enemies into bad positions",
  synergyTags: ["block", "control", "zone", "pull"],
  maxStacks: 2,
}
```

**Design Notes:**
- ROUNDS inspiration: "Implode" (blocking pulls enemies) + "Static Field" (block creates damage field)
- JAKESJAM innovation: Persistent zone control instead of instant pull
- Visual: Purple swirling vortex at block location
- Counterplay: Stay out of field, or use pull to reposition yourself

---

### Card 13: **Boomerang Protocol**

```typescript
{
  id: "boomerang_protocol",
  name: "Boomerang Protocol",
  category: "projectile",
  rarity: "uncommon",
  
  description: "Projectiles return to you after reaching max range",
  
  benefits: [
    { stat: "projectileReturn", value: true, multiplier: false }, // Projectiles return
    { stat: "returnDamage", value: 0.8, multiplier: true },     // Return trip does 80% damage
    { stat: "range", value: 1.5, multiplier: true },            // +50% projectile range
  ],
  penalties: [
    { stat: "directDamage", value: 0.7, multiplier: true },     // -30% initial damage
    { stat: "projectileSpeed", value: 0.8, multiplier: true },  // -20% speed
  ],
  
  behavioralChange: "Shoot past enemies for double hits, or zone with returning shots",
  synergyTags: ["boomerang", "geometry", "double-hit", "zone"],
  maxStacks: 1, // Unique
}
```

**Design Notes:**
- ROUNDS inspiration: No direct equivalent (unique to JAKESJAM)
- JAKESJAM innovation: Skill-expression card that rewards geometry understanding
- Visual: Curved return path, different color on return
- Counterplay: Stand close (no time to return) or behind cover

---

### Card 14: **Blood Price**

```typescript
{
  id: "blood_price",
  name: "Blood Price",
  category: "tradeoff",
  rarity: "rare",
  
  description: "Shooting costs HP, but removes all cooldowns",
  
  benefits: [
    { stat: "noCooldown", value: true, multiplier: false },     // No fire cooldown
    { stat: "fireRate", value: 3.0, multiplier: true },         // +200% fire rate cap
    { stat: "damage", value: 1.3, multiplier: true },           // +30% damage
  ],
  penalties: [
    { stat: "healthCostPerShot", value: 3, multiplier: false }, // Each shot costs 3 HP
    { stat: "health", value: 0.8, multiplier: true },           // -20% health
    { stat: "healReduction", value: 0.5, multiplier: true },    // -50% healing received
  ],
  
  behavioralChange: "Unlimited ammo and fire rate, but every shot hurts you",
  synergyTags: ["high-risk", "dps", "all-in", "vampire"],
  maxStacks: 1, // Unique
}
```

**Design Notes:**
- ROUNDS inspiration: "Demonic Pact" (shooting costs 10 HP, removes cooldown)
- JAKESJAM adaptation: Lower HP cost but added heal reduction
- Visual: Red muzzle flash, player flashes red on shot
- Counterplay: Chip damage, they're killing themselves

---

### Card 15: **Temporal Anchor**

```typescript
{
  id: "temporal_anchor",
  name: "Temporal Anchor",
  category: "utility",
  rarity: "rare",
  
  description: "Return to this position in 3 seconds, no matter what",
  
  benefits: [
    { stat: "anchorDuration", value: 3.0, multiplier: false },  // Anchor lasts 3 seconds
    { stat: "anchorCooldown", value: 8.0, multiplier: false },  // 8 second cooldown
    { stat: "moveSpeed", value: 1.3, multiplier: true },        // +30% speed while anchor active
  ],
  penalties: [
    { stat: "health", value: 0.85, multiplier: true },          // -15% health
    { stat: "stunOnReturn", value: 0.5, multiplier: false },    // 0.5s stun after return
  ],
  
  behavioralChange: "Aggressive dives safe, but predictable return",
  synergyTags: ["mobility", "escape", "predictive", "high-skill"],
  maxStacks: 1, // Unique
}
```

**Design Notes:**
- ROUNDS inspiration: "Teleport" (blocking teleports forward)
- JAKESJAM innovation: Time-based return instead of instant blink
- Visual: Ghostly trail showing return path, countdown timer
- Counterplay: Predict return location, set traps

---

## Part 3: Balance Pass - Diminishing Returns

### Stat Scaling Rules

To prevent infinite stacking from breaking the game:

```typescript
// client/src/game/data/cardBalance.ts

export const STACK_SCALING: Record<string, number> = {
  // Offensive stats
  damage: 0.75,           // 2nd: 75%, 3rd: 56%, 4th: 42%
  fireRate: 0.70,         // 2nd: 70%, 3rd: 49%, 4th: 34%
  projectileCount: 0.60,  // 2nd: 60%, 3rd: 36%, 4th: 22%
  projectileSize: 0.80,   // 2nd: 80%, 3rd: 64%, 4th: 51%
  projectileSpeed: 0.75,  // 2nd: 75%, 3rd: 56%, 4th: 42%
  bounce: 0.50,           // 2nd: 50%, 3rd: 25%, 4th: 13%
  
  // Defensive stats
  health: 0.85,           // 2nd: 85%, 3rd: 72%, 4th: 61%
  shield: 0.80,           // 2nd: 80%, 3rd: 64%, 4th: 51%
  armor: 0.75,            // 2nd: 75%, 3rd: 56%, 4th: 42%
  lifesteal: 0.65,        // 2nd: 65%, 3rd: 42%, 4th: 27%
  regen: 0.70,            // 2nd: 70%, 3rd: 49%, 4th: 34%
  
  // Movement stats
  moveSpeed: 0.80,        // 2nd: 80%, 3rd: 64%, 4th: 51%
  jumpHeight: 0.75,       // 2nd: 75%, 3rd: 56%, 4th: 42%
  acceleration: 0.85,     // 2nd: 85%, 3rd: 72%, 4th: 61%
  
  // Utility stats
  reloadSpeed: 0.70,      // 2nd: 70%, 3rd: 49%, 4th: 34%
  accuracy: 0.75,         // 2nd: 75%, 3rd: 56%, 4th: 42%
  range: 0.80,            // 2nd: 80%, 3rd: 64%, 4th: 51%
};

export const HARD_CAPS: Record<string, number> = {
  projectileCount: 6,     // Max 6 projectiles per shot
  bounce: 5,              // Max 5 bounces
  fireRate: 15,           // Max 15 shots/second
  moveSpeed: 2.5,         // Max 2.5x base speed
  damage: 5.0,            // Max 500% base damage
  health: 3.0,            // Max 300% base health
  lifesteal: 0.75,        // Max 75% lifesteal
  armor: 0.90,            // Max 90% damage reduction
};

export const SOFT_CAPS: Record<string, { threshold: number; penalty: number }> = {
  moveSpeed: { threshold: 1.8, penalty: 0.5 },  // After 1.8x, gains are halved
  fireRate: { threshold: 8, penalty: 0.4 },     // After 8 shots/s, gains reduced 60%
  damage: { threshold: 2.5, penalty: 0.5 },     // After 2.5x, gains are halved
};
```

### Stacking Examples

#### Example 1: Triple Stacking "Bulky Rounds"

```
Stack 1:
  +60% size, +15% damage, +20% knockback
  -20% fire rate, +0.3s reload, -15% speed

Stack 2 (75% effectiveness):
  +45% size, +11% damage, +15% knockback
  -15% fire rate, +0.225s reload, -11% speed

Stack 3 (56% effectiveness):
  +34% size, +8% damage, +11% knockback
  -11% fire rate, +0.17s reload, -8% speed

TOTAL (3 stacks):
  +139% size, +34% damage, +46% knockback
  -46% fire rate, +0.695s reload, -34% speed

Result: Massive projectiles that hit hard but fire slowly
```

#### Example 2: Double Stacking "Full Auto Mod"

```
Stack 1:
  +150% fire rate, +80% mag, -0.3s reload
  -55% damage, +200% spread, -50% accuracy

Stack 2 (70% effectiveness):
  +105% fire rate, +56% mag, -0.21s reload
  -38% damage, +140% spread, -35% accuracy

TOTAL (2 stacks):
  +255% fire rate, +136% mag, -0.51s reload
  -93% damage, +340% spread, -85% accuracy

Result: Absolute laser beam of bullets, nearly useless individually
```

---

## Part 4: Card Pool Summary

### Complete 15-Card Prototype Pool

| ID | Name | Category | Rarity | Max Stacks |
|----|------|----------|--------|------------|
| bulky_rounds | Bulky Rounds | Projectile | Common | 3 |
| ricochet_rounds | Ricochet Rounds | Projectile | Uncommon | 2 |
| twin_barrel | Twin Barrel | Weapon | Uncommon | 2 |
| slug_rounds | Slug Rounds | Weapon | Common | 3 |
| muscle_memory | Muscle Memory | Weapon | Common | 3 |
| full_auto_mod | Full Auto Mod | Weapon | Uncommon | 2 |
| thruster_boots | Thruster Boots | Movement | Uncommon | 2 |
| reactive_barrier | Reactive Barrier | Defense | Common | 1 |
| phoenix_protocol | Phoenix Protocol | Defense | Rare | 1 |
| overclocked_core | Overclocked Core | Tradeoff | Uncommon | 1 |
| vampiric_touch | Vampiric Touch | Defense | Uncommon | 2 |
| gravity_well | Gravity Well | Utility | Rare | 2 |
| boomerang_protocol | Boomerang Protocol | Projectile | Uncommon | 1 |
| blood_price | Blood Price | Tradeoff | Rare | 1 |
| temporal_anchor | Temporal Anchor | Utility | Rare | 1 |

### Rarity Distribution

| Rarity | Count | Percentage |
|--------|-------|------------|
| Common | 4 | 27% |
| Uncommon | 7 | 47% |
| Rare | 4 | 27% |

### Category Distribution

| Category | Count | Percentage |
|----------|-------|------------|
| Weapon | 4 | 27% |
| Projectile | 4 | 27% |
| Movement | 1 | 7% |
| Defense | 3 | 20% |
| Utility | 2 | 13% |
| Tradeoff | 2 | 13% |

---

## Part 5: Implementation Priority

### Week 1: Core Cards (6 cards)
1. Bulky Rounds
2. Ricochet Rounds
3. Twin Barrel
4. Slug Rounds
5. Muscle Memory
6. Full Auto Mod

### Week 2: Advanced Cards (6 cards)
7. Thruster Boots
8. Reactive Barrier
9. Phoenix Protocol
10. Overclocked Core
11. Vampiric Touch
12. Gravity Well

### Week 3: High-Skill Cards (3 cards)
13. Boomerang Protocol
14. Blood Price
15. Temporal Anchor

### Week 4: Balance Pass
- Playtest all 15 cards
- Adjust scaling values
- Tune hard caps
- Fix broken combos

---

## Appendix: Card Text Templates

### Card Description Format

```
[CARD NAME]
[Rarity Icon] [Category Icon]

[One-line effect description - max 10 words]

BENEFITS:
+X% [stat]
+X [flat stat]

PENALTIES:
-X% [stat]
-X [flat stat]

[Behavioral tip - optional]
```

### Example Card UI Text

```
BULKY ROUNDS
[Common] [Projectile]

Larger, heavier projectiles

BENEFITS:
+60% Projectile Size
+15% Damage
+20% Knockback

PENALTIES:
-20% Fire Rate
+0.3s Reload
-15% Projectile Speed

Slower but hits harder
```

---

## Next Steps

1. **Implement these 15 cards** in `client/src/game/data/cards.ts`
2. **Create card icons** (placeholder art acceptable for prototype)
3. **Build CardSystem** to apply modifiers
4. **Playtest and tune** scaling values
5. **Add visual feedback** for each card type
