# ROUNDS → JAKESJAM Adaptation Plan

**Date:** 2026-05-02  
**Status:** Implementation Planning  
**Target:** Integrate ROUNDS-style draft system into JAKESJAM MVP

---

## 1. What JAKESJAM Already Has ✅

### 1.1 Design Foundation

| Element | Status | Notes |
|---------|--------|-------|
| **Core game loop** | ✅ Documented | GDD defines round → draft → repeat |
| **Card categories** | ✅ Defined | Weapon, Projectile, Movement, Defense, Utility, Tradeoff |
| **Draft rules** | ✅ Specified | Loser drafts, 3 card choices |
| **Orthogonal upgrades** | ✅ Understood | GDD emphasizes different builds, not stat ladders |
| **Target session length** | ✅ Defined | 5-12 minutes per match |
| **1v1 duel prototype** | ✅ Priority | First real mode |
| **Card stacking** | ✅ Allowed | With caps defined |

### 1.2 Technical Foundation

| Element | Status | File Location |
|---------|--------|---------------|
| **CardDefinition type** | ✅ Drafted | `docs/game-design-document.md:1190+` |
| **CardSystem placeholder** | ✅ Planned | `client/src/game/systems/CardSystem.ts` |
| **DraftScene placeholder** | ✅ Planned | `client/src/game/scenes/DraftScene.ts` |
| **12-18 prototype cards** | ✅ Listed | GDD Section 8.4 |

### 1.3 Design Alignment

JAKESJAM's GDD already incorporates ROUNDS principles:

```
GDD Quote (Section 8.1):
"Cards should create new tactics and funny combinations without making 
the game unreadable."

GDD Quote (Section 8.3.1):
"Good upgrade design creates a visible identity."
```

---

## 2. What Needs Work 🔄

### 2.1 Critical Gaps

| Gap | Priority | Effort | Impact |
|-----|----------|--------|--------|
| **Card tradeoff system** | 🔴 High | Medium | High |
| **Loser-drafts-first logic** | 🔴 High | Low | High |
| **Draft UI implementation** | 🔴 High | Medium | High |
| **Card rarity system** | 🟡 Medium | Low | Medium |
| **Comeback mechanics** | 🟡 Medium | Medium | High |
| **Visual feedback for cards** | 🟡 Medium | High | High |
| **Card synergy documentation** | 🟡 Medium | Low | Medium |

### 2.2 Specific Implementation Needs

#### 2.2.1 Card Tradeoff System

**Current State:** JAKESJAM cards have effects but lack explicit tradeoffs

**Required Change:**
```typescript
// Current (from GDD)
export type CardDefinition = {
  id: CardId;
  name: string;
  category: 'weapon' | 'projectile' | 'movement' | 'defense' | 'utility' | 'tradeoff';
  rarity: 'common' | 'uncommon' | 'rare' | 'cursed';
  description: string;
  unique?: boolean;
  maxStacks?: number;
};

// Required (ROUNDS-style)
export type CardDefinition = {
  id: CardId;
  name: string;
  category: 'weapon' | 'projectile' | 'movement' | 'defense' | 'utility' | 'tradeoff';
  rarity: 'common' | 'uncommon' | 'rare' | 'cursed';
  description: string;
  
  // NEW: Explicit tradeoffs
  benefits: StatModifier[];
  penalties: StatModifier[];
  behavioralChange?: string; // Human-readable tradeoff description
  
  unique?: boolean;
  maxStacks?: number;
  synergyTags?: string[]; // For combo discovery
};

export type StatModifier = {
  stat: 'damage' | 'fireRate' | 'health' | 'speed' | 'reload' | 'projectileCount' | 'bounce' | 'lifesteal';
  value: number; // Positive or negative
  multiplier?: boolean; // true = percentage, false = flat
};
```

#### 2.2.2 Loser-Drafts-First Logic

**Current State:** Not implemented

**Required Change:**
```typescript
// convex/matches.ts (pseudo-code)
export const selectCardForRound = mutation({
  args: {
    matchId: idType("matches"),
    playerId: idType("players"),
    cardId: string(),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    
    // CRITICAL: Only allow loser of previous round to draft
    const lastRound = match.rounds[match.rounds.length - 1];
    if (lastRound.winnerId === args.playerId) {
      throw new Error("Only the loser can draft");
    }
    
    // Apply card
    await applyCardToPlayer(ctx, args.playerId, args.cardId);
  }
});
```

#### 2.2.3 Draft UI

**Current State:** DraftScene placeholder exists, no implementation

**Required Implementation:**
- 3 card display with rarity colors
- Hover/click to select
- Current build summary
- Timer display (optional for MVP)
- Confirm selection animation

---

## 3. Priority Implementation (4 Phases)

### Phase 1: Core Draft System (Week 1-2)

**Goal:** Make drafting functional

| Task | File | Acceptance Criteria |
|------|------|---------------------|
| **1.1 Card data structure** | `client/src/game/data/cards.ts` | 12 cards with benefits/penalties defined |
| **1.2 CardSystem skeleton** | `client/src/game/systems/CardSystem.ts` | Can apply stat modifiers to player |
| **1.3 DraftScene basic UI** | `client/src/game/scenes/DraftScene.ts` | Shows 3 cards, allows selection |
| **1.4 Match flow integration** | `client/src/game/scenes/MatchScene.ts` | Loser sees draft after round ends |
| **1.5 Card persistence** | `convex/matches.ts` | Cards saved per match |

**Definition of Done:**
- Player loses round → sees 3 cards → picks one → next round reflects change

### Phase 2: Tradeoff System (Week 3)

**Goal:** Make cards meaningful

| Task | File | Acceptance Criteria |
|------|------|---------------------|
| **2.1 Stat modifier system** | `client/src/game/systems/CardSystem.ts` | Benefits and penalties apply correctly |
| **2.2 Card redesign pass** | `client/src/game/data/cards.ts` | All 12 cards have explicit tradeoffs |
| **2.3 Visual feedback** | `client/src/game/systems/ProjectileSystem.ts` | Card effects visible (bigger bullets, etc.) |
| **2.4 UI stat display** | `client/src/game/scenes/DraftScene.ts` | Shows +green/-red stat changes |

**Definition of Done:**
- Every card has clear upsides and downsides
- Player can see stat changes before selecting

### Phase 3: Comeback Mechanics (Week 4)

**Goal:** Make losing feel rewarding

| Task | File | Acceptance Criteria |
|------|------|---------------------|
| **3.1 Rarity weighting** | `client/src/game/systems/CardSystem.ts` | Behind players see more rares |
| **3.2 Card stacking** | `client/src/game/systems/CardSystem.ts` | Same card can be picked multiple times |
| **3.3 Synergy suggestions** | `client/src/game/scenes/DraftScene.ts` | UI highlights synergies with existing cards |
| **3.4 Match momentum tracking** | `convex/matches.ts` | Track round differential for weighting |

**Definition of Done:**
- Player behind by 2+ rounds sees higher rarity cards
- Stacking cards creates escalating builds

### Phase 4: Polish & Feedback (Week 5)

**Goal:** Make it feel good

| Task | File | Acceptance Criteria |
|------|------|---------------------|
| **4.1 Card activation VFX** | Various systems | Cards flash when triggered |
| **4.2 Sound effects** | `client/src/game/systems/AudioSystem.ts` | Draft select, card activate sounds |
| **4.3 Build summary UI** | `client/src/game/ui/Hud.ts` | Show owned cards during match |
| **4.4 Tutorial hints** | `client/src/game/scenes/DraftScene.ts` | Explain tradeoffs to new players |

**Definition of Done:**
- Drafting feels exciting, not confusing
- Players understand why they lost/won

---

## 4. Card Redesigns for Tradeoffs

### 4.1 Existing JAKESJAM Cards → ROUNDS Style

Here are 10 cards from the GDD, redesigned with explicit tradeoffs:

#### Card 1: Bigger Bullets
```typescript
{
  id: "bigger_bullets",
  name: "Bigger Bullets",
  category: "projectile",
  rarity: "common",
  description: "Larger projectile hitbox",
  
  benefits: [
    { stat: "projectileSize", value: 1.5, multiplier: true }, // +50% size
    { stat: "damage", value: 1.1, multiplier: true }, // +10% damage
  ],
  penalties: [
    { stat: "fireRate", value: 0.85, multiplier: true }, // -15% fire rate
    { stat: "reload", value: 0.25, multiplier: false }, // +0.25s reload
  ],
  behavioralChange: "Slower shooting but easier to hit",
  synergyTags: ["homing", "slow-projectiles"]
}
```

#### Card 2: Ricochet
```typescript
{
  id: "ricochet",
  name: "Ricochet",
  category: "projectile",
  rarity: "uncommon",
  description: "Bullets bounce once off terrain",
  
  benefits: [
    { stat: "bounce", value: 1, multiplier: false }, // +1 bounce
    { stat: "damage", value: 1.25, multiplier: true }, // +25% damage on bounce
  ],
  penalties: [
    { stat: "fireRate", value: 0.9, multiplier: true }, // -10% fire rate
    { stat: "reload", value: 0.25, multiplier: false }, // +0.25s reload
  ],
  behavioralChange: "Shoot walls for angled attacks",
  synergyTags: ["bounce", "geometry", "trick-shot"]
}
```

#### Card 3: Split Shot
```typescript
{
  id: "split_shot",
  name: "Split Shot",
  category: "weapon",
  rarity: "uncommon",
  description: "Fires two weaker angled bullets",
  
  benefits: [
    { stat: "projectileCount", value: 2, multiplier: false }, // +1 projectile (total 2)
    { stat: "damage", value: 0.7, multiplier: true }, // -30% damage per projectile
  ],
  penalties: [
    { stat: "spread", value: 1.5, multiplier: true }, // +50% spread
    { stat: "reload", value: 0.25, multiplier: false }, // +0.25s reload
  ],
  behavioralChange: "Double hits at close range",
  synergyTags: ["spray", "close-range", "multi-projectile"]
}
```

#### Card 4: Heavy Rounds
```typescript
{
  id: "heavy_rounds",
  name: "Heavy Rounds",
  category: "weapon",
  rarity: "common",
  description: "More damage and knockback, slower fire rate",
  
  benefits: [
    { stat: "damage", value: 1.5, multiplier: true }, // +50% damage
    { stat: "knockback", value: 1.5, multiplier: true }, // +50% knockback
  ],
  penalties: [
    { stat: "fireRate", value: 0.6, multiplier: true }, // -40% fire rate
    { stat: "projectileSpeed", value: 0.8, multiplier: true }, // -20% speed
  ],
  behavioralChange: "Slow, hitting shots",
  synergyTags: ["sniper", "knockback", "high-damage"]
}
```

#### Card 5: Quick Hands
```typescript
{
  id: "quick_hands",
  name: "Quick Hands",
  category: "weapon",
  rarity: "common",
  description: "Faster reload",
  
  benefits: [
    { stat: "reload", value: -0.5, multiplier: false }, // -0.5s reload
    { stat: "fireRate", value: 1.1, multiplier: true }, // +10% fire rate
  ],
  penalties: [
    { stat: "damage", value: 0.9, multiplier: true }, // -10% damage
  ],
  behavioralChange: "Reload often, maintain pressure",
  synergyTags: ["reload", "sustained-dps"]
}
```

#### Card 6: Spray & Pray
```typescript
{
  id: "spray_and_pray",
  name: "Spray & Pray",
  category: "weapon",
  rarity: "uncommon",
  description: "Higher fire rate, more spread",
  
  benefits: [
    { stat: "fireRate", value: 2.0, multiplier: true }, // +100% fire rate
    { stat: "magazineSize", value: 1.5, multiplier: true }, // +50% mag
  ],
  penalties: [
    { stat: "damage", value: 0.5, multiplier: true }, // -50% damage
    { stat: "spread", value: 2.0, multiplier: true }, // +100% spread
  ],
  behavioralChange: "Get in close and hold click",
  synergyTags: ["spray", "close-range", "dps"]
}
```

#### Card 7: Rocket Feet
```typescript
{
  id: "rocket_feet",
  name: "Rocket Feet",
  category: "movement",
  rarity: "uncommon",
  description: "Increased jump impulse",
  
  benefits: [
    { stat: "jumpHeight", value: 1.5, multiplier: true }, // +50% jump
    { stat: "moveSpeed", value: 1.2, multiplier: true }, // +20% speed
  ],
  penalties: [
    { stat: "health", value: 0.8, multiplier: true }, // -20% health
    { stat: "landingRecovery", value: 0.3, multiplier: false }, // +0.3s recovery
  ],
  behavioralChange: "High jumps, fragile body",
  synergyTags: ["vertical", "evasive", "glass-cannon"]
}
```

#### Card 8: Panic Shield
```typescript
{
  id: "panic_shield",
  name: "Panic Shield",
  category: "defense",
  rarity: "common",
  description: "Small shield at round start",
  
  benefits: [
    { stat: "shieldHealth", value: 50, multiplier: false }, // +50 shield at start
    { stat: "damageReduction", value: 0.5, multiplier: true }, // 50% reduction while shield active
  ],
  penalties: [
    { stat: "health", value: 0.9, multiplier: true }, // -10% health
    { stat: "moveSpeed", value: 0.95, multiplier: true }, // -5% speed
  ],
  behavioralChange: "Strong start, play safe",
  synergyTags: ["shield", "defensive", "early-game"]
}
```

#### Card 9: Last Chance
```typescript
{
  id: "last_chance",
  name: "Last Chance",
  category: "defense",
  rarity: "rare",
  description: "Survive one lethal hit at 1 HP",
  
  benefits: [
    { stat: "revive", value: 1, multiplier: false }, // 1 auto-revive per match
    { stat: "health", value: 1, multiplier: false }, // Set to 1 HP after trigger
  ],
  penalties: [
    { stat: "health", value: 0.7, multiplier: true }, // -30% health permanently
    { stat: "moveSpeed", value: 0.9, multiplier: true }, // -10% speed
  ],
  behavioralChange: "One free mistake, then you're fragile",
  synergyTags: ["revive", "comeback", "high-risk"]
}
```

#### Card 10: Glass Cannon
```typescript
{
  id: "glass_cannon",
  name: "Glass Cannon",
  category: "tradeoff",
  rarity: "uncommon",
  description: "More damage, lower max health",
  
  benefits: [
    { stat: "damage", value: 2.0, multiplier: true }, // +100% damage
  ],
  penalties: [
    { stat: "health", value: 0.5, multiplier: true }, // -50% health
  ],
  behavioralChange: "Kill fast or die fast",
  synergyTags: ["high-risk", "burst", "all-in"]
}
```

---

## 5. Draft UI Mockup Description

### 5.1 Layout Specification

```
┌─────────────────────────────────────────────────────────────────┐
│                        DRAFT PHASE                              │
│                    Round 2 - Your Choice                        │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │              CURRENT BUILD (3 cards)                     │  │
│   │  [Card1] [Card2] [Card3]  ← Small icons                  │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│            CHOOSE YOUR UPGRADE                                  │
│                                                                 │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│   │              │ │              │ │              │          │
│   │   [ICON]     │ │   [ICON]     │ │   [ICON]     │          │
│   │              │ │              │ │              │          │
│   │  CARD NAME   │ │  CARD NAME   │ │  CARD NAME   │          │
│   │  Rarity      │ │  Rarity      │ │  Rarity      │          │
│   │              │ │              │ │              │          │
│   │  + Benefit   │ │  + Benefit   │ │  + Benefit   │          │
│   │  - Penalty   │ │  - Penalty   │ │  - Penalty   │          │
│   │              │ │              │ │              │          │
│   │  [SELECT]    │ │  [SELECT]    │ │  [SELECT]    │          │
│   └──────────────┘ └──────────────┘ └──────────────┘          │
│                                                                 │
│   ⚠️ You lost Round 1. Pick wisely.                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Visual Specifications

| Element | Specification |
|---------|---------------|
| Card size | 180x260px each |
| Card spacing | 20px between cards |
| Rarity border | Common: gray, Uncommon: blue, Rare: magenta |
| Benefit text | Green (#4ADE80) |
| Penalty text | Red (#F87171) |
| Select button | White hover, colored on rarity match |
| Background | Dimmed match arena (50% opacity) |

### 5.3 Interaction Flow

```
1. Round ends → Screen fades to draft UI (0.5s)
2. Cards reveal left-to-right (0.2s each)
3. Hover over card → Shows detailed stats (instant)
4. Click SELECT → Card highlights (0.2s)
5. Confirm button appears → Click to finalize (0.3s)
6. Card applies → Visual flash on player (0.5s)
7. Transition to next round (1s)

Total: 3-5 seconds minimum, 15 seconds typical
```

### 5.4 Accessibility Requirements

- Colorblind mode: Add symbols to rarity (○ □ △)
- Text size: Minimum 14px for card descriptions
- Keyboard navigation: Tab between cards, Enter to select
- Screen reader: Announce card name, benefits, penalties

---

## 6. Comeback Mechanic Implementation

### 6.1 Rarity Weighting System

```typescript
// client/src/game/systems/CardSystem.ts

interface DraftWeights {
  common: number;
  uncommon: number;
  rare: number;
}

function calculateDraftWeights(roundDifferential: number): DraftWeights {
  // roundDifferential: positive = you're ahead, negative = you're behind
  
  if (roundDifferential <= -2) {
    // Behind by 2+ rounds: heavily weighted toward rares
    return { common: 20, uncommon: 40, rare: 40 };
  } else if (roundDifferential === -1) {
    // Behind by 1 round: slight rare boost
    return { common: 40, uncommon: 40, rare: 20 };
  } else if (roundDifferential === 0) {
    // Tied: standard distribution
    return { common: 50, uncommon: 35, rare: 15 };
  } else {
    // Ahead (shouldn't draft, but fallback)
    return { common: 70, uncommon: 25, rare: 5 };
  }
}

function generateDraftOptions(
  playerCards: CardId[],
  roundDifferential: number
): CardId[] {
  const weights = calculateDraftWeights(roundDifferential);
  const pool = buildWeightedCardPool(weights);
  
  // Synergy bonus: if player has related cards, boost similar cards
  const synergyBoosted = applySynergyWeights(pool, playerCards);
  
  // Return 3 random choices from weighted pool
  return randomChoice(synergyBoosted, 3);
}
```

### 6.2 Synergy Detection

```typescript
const SYNERGY_MATRIX: Record<string, string[]> = {
  "spray_and_pray": ["scavenger", "quick_hands", "split_shot"],
  "ricochet": ["trickster", "bouncy", "target_bounce"],
  "heavy_rounds": ["combine", "wind_up", "glass_cannon"],
  "rocket_feet": ["taste_of_blood", "chase", "air_control"],
  "panic_shield": ["defender", "echo", "shields_up"],
  "glass_cannon": ["last_chance", "heavy_rounds", "demonic_pact"],
};

function applySynergyWeights(
  pool: WeightedCard[],
  ownedCards: CardId[]
): WeightedCard[] {
  for (const card of pool) {
    for (const owned of ownedCards) {
      if (SYNERGY_MATRIX[owned]?.includes(card.id)) {
        card.weight *= 1.5; // 50% boost for synergy
      }
      if (SYNERGY_MATRIX[card.id]?.includes(owned)) {
        card.weight *= 1.5; // Reciprocal synergy
      }
    }
  }
  return pool;
}
```

### 6.3 Stack Scaling (Diminishing Returns)

```typescript
// Prevent infinite stacking from becoming broken

const STACK_SCALING: Record<string, number> = {
  "damage": 0.8,      // 2nd stack = 80% effectiveness
  "fireRate": 0.7,    // 2nd stack = 70% effectiveness
  "health": 0.9,      // 2nd stack = 90% effectiveness
  "bounce": 0.5,      // 2nd stack = 50% effectiveness (hard cap at 5)
  "projectileCount": 0.6, // 2nd stack = 60% effectiveness
};

function applyStackScaling(
  baseValue: number,
  stackCount: number,
  stat: string
): number {
  const scaling = STACK_SCALING[stat] ?? 0.8;
  const effectiveness = Math.pow(scaling, stackCount - 1);
  return baseValue * effectiveness;
}

// Example: 3 stacks of +25% damage
// Stack 1: +25%
// Stack 2: +25% * 0.8 = +20%
// Stack 3: +25% * 0.64 = +16%
// Total: +61% (not +75%)
```

### 6.4 Match Momentum Tracking

```typescript
// convex/schema.ts
export default defineSchema({
  matches: defineTable({
    roomId: idType("rooms"),
    players: array(idType("players")),
    rounds: array(defineSchema({
      winnerId: idType("players"),
      loserId: idType("players"),
      duration: number(),
      loserCards: array(string()), // Cards held when round was lost
    })),
    currentRound: number(),
    targetScore: number(),
    status: string(), // 'lobby' | 'active' | 'draft' | 'complete'
  }).index("by_room", ["roomId"]),
});
```

---

## 7. Implementation Checklist

### Phase 1 Checklist

- [ ] Create CardDefinition type with benefits/penalties
- [ ] Implement 12 base cards with tradeoffs
- [ ] Build CardSystem.applyCard() function
- [ ] Create DraftScene with 3-card display
- [ ] Wire up match flow: round end → draft → next round
- [ ] Test offline (single player vs dummy)

### Phase 2 Checklist

- [ ] Add stat modifier application to all relevant systems
- [ ] Implement visual feedback for each card type
- [ ] Add rarity colors to card UI
- [ ] Show +green/-red stat changes on hover
- [ ] Playtest: verify tradeoffs feel meaningful

### Phase 3 Checklist

- [ ] Implement rarity weighting based on round differential
- [ ] Allow card stacking with diminishing returns
- [ ] Add synergy highlighting in draft UI
- [ ] Test comeback mechanics (behind player should win more)

### Phase 4 Checklist

- [ ] Add particle effects for card activations
- [ ] Implement draft selection sound
- [ ] Show owned cards in match HUD
- [ ] Add tutorial tooltips for new players
- [ ] Polish: animations, transitions, feedback

---

## 8. Success Metrics

### 8.1 Playtest Goals

| Metric | Target | Measurement |
|--------|--------|-------------|
| Draft time | 10-20 seconds | Time from round end to selection |
| Card comprehension | <5 seconds | Time to understand a card |
| Comeback rate | 35-45% | Player behind wins match |
| Build diversity | 8+ unique builds | Different card combinations per session |
| Match length | 5-8 minutes | Total time including drafts |

### 8.2 Player Feedback Questions

After playtesting, ask:

1. "Did losing a round feel like an opportunity?"
2. "Could you understand what each card did in 3 seconds?"
3. "Did your builds feel meaningfully different between matches?"
4. "Did comebacks feel earned, not random?"
5. "Would you play another round right now?"

---

## 9. Next Steps

1. **Read ROUNDS-ANALYSIS.md** for full game design breakdown
2. **Review CARD-REDESIGN-PROPOSALS.md** for specific card changes
3. **Check SCREENSHOTS-LIST.md** for visual reference gathering
4. **Start Phase 1 implementation** (CardSystem + DraftScene)
