# ROUNDS Game Design Analysis

**Source:** ROUNDS by RUNDISC  
**Analysis Date:** 2026-05-02  
**Purpose:** Extract design principles for JAKESJAM adaptation

---

## 1. Core Game Loop

### The ROUNDS Formula

```
┌─────────────────────────────────────────────────────────────┐
│                    MATCH LOOP (3-5 min)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  ROUND 1: Fight → Winner determined → Loser drafts card    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  ROUND 2: Fight with new cards → Loser drafts again        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Repeat until match win condition (typically 3-5 rounds)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Match Complete → New Match → Fresh Draft                  │
└─────────────────────────────────────────────────────────────┘
```

### Key Timing

| Phase | Duration | Notes |
|-------|----------|-------|
| Round | 15-45 seconds | Fast, decisive engagements |
| Draft | 10-20 seconds | 3 card choices, immediate impact |
| Match | 3-5 minutes | Best of 5-7 rounds typical |
| Between Matches | 5-10 seconds | Reset, new draft pool |

### Critical Design Insight

**ROUNDS uses "loser drafts" as its core comeback mechanic.** The player who loses a round gets to pick an upgrade card. This creates:

1. **Catch-up potential** - falling behind grants power
2. **Meaningful choices** - each card changes your build
3. **Escalating chaos** - matches get wilder over time
4. **Psychological relief** - losing feels like opportunity, not defeat

---

## 2. Card Categories

ROUNDS cards fall into distinct functional categories. Each category serves a specific design purpose.

### 2.1 Weapon Cards (Direct Combat Modifications)

| Card | Effect | Stats Change | Rarity |
|------|--------|--------------|--------|
| **Barrage** | Fire many bullets at once | +4 Bullets, +5 Ammo, -70% DMG, +0.25s Reload | Uncommon |
| **Buckshot** | Shotgun-style spread | +4 Bullets, +5 Ammo, -60% DMG, +0.25s Reload | Uncommon |
| **Burst** | Sequential multi-shot | +2 Bullets, +3 Ammo, -60% DMG, +0.25s Reload | Common |
| **Spray** | Extreme fire rate | +1000% ATKSPD, +12 Ammo, -75% DMG, +0.25s Reload | Uncommon |
| **Combine** | High damage, slow | +100% DMG, -2 Ammo, +0.5s Reload | Common |
| **Careful Planning** | Extreme damage trade | +100% DMG, -150% ATKSPD, +0.5s Reload | Uncommon |

**Design Principle:** Weapon cards create **orthogonal build paths**. Spray creates a DPS build, Combine creates a sniper build, Buckshot creates a close-range build.

### 2.2 Projectile Cards (Bullet Behavior)

| Card | Effect | Stats Change | Rarity |
|------|--------|--------------|--------|
| **Big Bullets** | Larger hitbox | +0.25s Reload | Common |
| **Bouncy** | Ricochet behavior | +2 Bounces, +25% DMG, +0.25s Reload | Uncommon |
| **Cold Bullets** | Slows enemies | +70% Bullet Slow, +0.25s Reload | Common |
| **Explosive Bullet** | AOE on impact | -100% ATKSPD, +0.25s Reload | Uncommon |
| **Fastball** | Extreme velocity | +250% Bullet Speed, -50% ATKSPD, +0.25s Reload | Common |
| **Grow** | Damage increases over flight | +0.25s Reload | Uncommon |
| **Homing** | Auto-aim | -25% DMG, -50% ATKSPD, +0.25s Reload | Uncommon |
| **Remote** | Manual steering | -40% Bullet Speed, +0.25s Reload | Rare |
| **Sneaky** | Avoids ground | +0.25s Reload | Uncommon |
| **Trickster** | Damage per bounce | +2 Bounces, -20% DMG, +0.5s Reload | Rare |

**Design Principle:** Projectile cards change **how you aim and position**. Homing removes aim but reduces damage. Big Bullets trade fire rate for hit reliability.

### 2.3 Movement Cards (Mobility & Positioning)

| Card | Effect | Stats Change | Rarity |
|------|--------|--------------|--------|
| **Chase** | Speed toward enemy | +30% HP, +60% Move Speed (toward enemy) | Uncommon |
| **Shield Charge** | Launch forward on block | +0.25s Block Cooldown | Uncommon |
| **Taste of Blood** | Speed after hitting | +30% Lifesteal, +60% Move Speed (3s after hit) | Uncommon |
| **Teleport** | Blink on block | -30% Block Cooldown | Rare |

**Design Principle:** Movement cards reward **aggressive play**. Chase only works when moving toward enemies. Taste of Blood requires you to land hits.

### 2.4 Defense Cards (Survival & Blocking)

| Card | Effect | Stats Change | Rarity |
|------|--------|--------------|--------|
| **Bombs Away** | Explosive block | +30% HP, +0.25s Block Cooldown | Uncommon |
| **Brawler** | Regen after dealing damage | +200% HP regen (3s after dealing DMG) | Uncommon |
| **Decay** | Damage over time mitigation | +50% HP (damage dealt to you is dealt over 4s) | Uncommon |
| **Defender** | Faster blocking | -30% Block Cooldown, +30% HP | Uncommon |
| **Echo** | Double block trigger | +30% HP, +0.25s Block Cooldown | Uncommon |
| **EMP** | Block spawns projectiles | +30% HP, +0.25s Block Cooldown | Uncommon |
| **Huge** | Raw health | +80% HP | Common |
| **Leech** | Lifesteal | +75% Lifesteal, +30% HP | Common |
| **Overpower** | Block deals AOE damage | +30% HP, +0.25s Block Cooldown | Uncommon |
| **Phoenix** | Auto-revive | -35% HP (respawn once on death) | Rare |
| **Tank** | Tank stats | +100% HP, -25% ATKSPD, +0.5s Reload | Common |

**Design Principle:** Defense cards in ROUNDS are **active, not passive**. Bombs Away, EMP, and Overpower all require you to block (an active input) to trigger their effects.

### 2.5 Utility Cards (Special Mechanics)

| Card | Effect | Stats Change | Rarity |
|------|--------|--------------|--------|
| **Empower** | Block buffs next shot | +0.25s Block Cooldown (increases damage/speed of next shot) | Uncommon |
| **Healing Field** | Block creates healing zone | +30% HP, +0.25s Block Cooldown | Common |
| **Radar Shot** | Auto-aim on block | +30% HP, +0.25s Block Cooldown | Uncommon |
| **Radiance** | Damage waves on reload | +30% HP | Rare |
| **Refresh** | Block reset on hit | Block cooldown resets when dealing damage | Rare |
| **Scavenger** | Hit reloads weapon | +0.5s Reload Time | Uncommon |
| **Shields Up** | Auto-block on empty | +0.5s Reload, +0.5s Block Cooldown | Rare |
| **Tactical Reload** | Block reloads | +0.25s Block Cooldown | Rare |

**Design Principle:** Utility cards create **combo opportunities**. Empower + Bombs Away = explosive launch. Tactical Reload + Shields Up = infinite block loop.

### 2.6 Curse/Tradeoff Cards (High Risk, High Reward)

| Card | Effect | Stats Change | Rarity |
|------|--------|--------------|--------|
| **Demonic Pact** | Shoot costs HP | +9 Bullets, +2 Splash DMG, +0.25s Reload (shooting costs 10 HP) | Rare |
| **Glass Cannon** | Extreme trade | +100% DMG, -100% HP, +0.25s Reload | Uncommon |
| **Wind Up** | Charge shot | +100% Bullet Speed, +60% DMG, -100% ATKSPD, +0.5s Reload | Common |

**Design Principle:** Curse cards are **build-defining**. Demonic Pact completely changes how you play—you must avoid taking any damage while shooting.

---

## 3. Card Design Principles

### 3.1 Orthogonal Upgrades

ROUNDS excels at creating **different** builds, not just **better** builds.

```
STAT LADDER (Bad Design):
Card A: +10% damage
Card B: +20% damage
Card C: +30% damage

ORTHOGONAL AXES (Good Design):
Card A: +100% fire rate, -75% damage (Spray build)
Card B: +100% damage, -150% fire rate (Sniper build)
Card C: +4 bullets, -60% damage (Shotgun build)
Card D: +2 bounces, +25% damage (Geometry build)
```

### 3.2 Visible Impact

Every card in ROUNDS has **immediately observable effects**:

| Card | Visual Feedback |
|------|-----------------|
| Big Bullets | Projectile is literally larger |
| Spray | Bullets come out faster (obvious) |
| Bouncy | Bullets bounce off walls (visible) |
| Homing | Bullets curve toward enemies |
| Explosive Bullet | Explosion on impact |
| Glass Cannon | Player health bar is visibly smaller |
| Chase | Player moves noticeably faster |

**Rule:** If a player can't tell they have a card within 3 seconds of combat, it needs redesign.

### 3.3 Tradeoff Design

Every powerful effect has a cost:

| Benefit | Tradeoff | Card Example |
|---------|----------|--------------|
| +1000% fire rate | -75% damage | Spray |
| +100% damage | -100% HP | Glass Cannon |
| Homing bullets | -25% damage, -50% fire rate | Homing |
| +9 bullets, no cooldown | Shooting costs 10 HP | Demonic Pact |
| +250% bullet speed | -50% fire rate | Fastball |
| Auto-revive | -35% max HP | Phoenix |

**The ROUNDS Formula:**
```
Powerful Effect = Stat Benefit + Stat Penalty + Behavioral Change
```

### 3.4 Synergy Design

Best cards in ROUNDS create **combos**:

| Combo | Result | Why It Works |
|-------|--------|--------------|
| **Tactical Reload + Shields Up** | Infinite block loop | Block reloads, empty mag triggers block |
| **Empower + Bombs Away** | Explosive teleport | Block triggers bombs + empowered shot |
| **Spray + Scavenger** | Never reload | Hitting enemies reloads your spray gun |
| **Combine + Radar Shot** | Burst snipe | Block auto-fires high-damage shot |
| **Brawler + Taste of Blood** | Sustain monster | Hit for speed, then regen health |
| **Echo + Shield Charge** | Double launch | Block triggers charge twice |

**Synergy Rule:** Cards should enable 2-3 obvious combos while remaining viable alone.

---

## 4. Draft Mechanics

### 4.1 Loser Picks First

The core ROUNDS draft rule:

```
Round 1: Player A wins, Player B loses
       → Player B chooses 1 of 3 random cards
       → Player A gets nothing

Round 2: Player B wins (with new card), Player A loses
       → Player A chooses 1 of 3 random cards
       → Player B gets nothing

Round 3: Player A wins, Player B loses
       → Player B chooses again (can stack with existing card)
```

### 4.2 Comeback Mechanics

| Mechanism | Implementation |
|-----------|----------------|
| **Loser drafts** | Falling behind = more power |
| **Card stacking** | Multiple copies of same card allowed |
| **Synergy scaling** | Cards get better with other cards |
| **Rarity weighting** | Behind players may see higher rarity |

### 4.3 Draft UI Flow

```
┌─────────────────────────────────────────────────────────┐
│                    ROUND 2 - DRAFT                      │
│                                                         │
│   Player B chooses an upgrade                           │
│                                                         │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│   │  CARD 1  │  │  CARD 2  │  │  CARD 3  │            │
│   │  [Icon]  │  │  [Icon]  │  │  [Icon]  │            │
│   │  Name    │  │  Name    │  │  Name    │            │
│   │  Effect  │  │  Effect  │  │  Effect  │            │
│   │  Rarity  │  │  Rarity  │  │  Rarity  │            │
│   └──────────┘  └──────────┘  └──────────┘            │
│                                                         │
│   [Current Build: 3 cards]                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.4 Draft Timing

| Phase | Duration | Player Experience |
|-------|----------|-------------------|
| Round ends | 1-2 seconds | Death animation, result banner |
| Card reveal | 0.5 seconds | 3 cards appear |
| Selection | 5-15 seconds | Player reads and chooses |
| Confirmation | 1 second | Card selected, applied |
| Next round | 2-3 seconds | Countdown, spawn |

**Total draft time: 10-20 seconds**

---

## 5. Match Flow Timing

### 5.1 Complete Match Breakdown

```
MATCH START (0:00)
│
├─ Round 1 (0:00 - 0:30)
│  ├─ Countdown: 2 seconds
│  ├─ Fight: 15-30 seconds
│  └─ Result: 2 seconds
│
├─ Draft 1 (0:30 - 0:45)
│  └─ Loser picks: 10-15 seconds
│
├─ Round 2 (0:45 - 1:30)
│  └─ (same structure)
│
├─ Draft 2 (1:30 - 1:45)
│
├─ Round 3 (1:45 - 2:30)
│
├─ [Continue to match win condition]
│
└─ MATCH END (~3-5 minutes total)
```

### 5.2 Session Length Targets

| Mode | Duration | Rounds |
|------|----------|--------|
| Quick Match | 3-5 minutes | Best of 5 |
| Standard | 5-8 minutes | Best of 7 |
| Tournament | 10-15 minutes | Best of 9 |

### 5.3 Pacing Rules

1. **No round should exceed 60 seconds** (force sudden death)
2. **Draft should never exceed 20 seconds** (add timer if needed)
3. **Match should complete in under 10 minutes** (prevent fatigue)
4. **Rematch should start within 15 seconds** (reduce friction)

---

## 6. Balancing Principles

### 6.1 The ROUNDS Balance Philosophy

```
FUN > FAIR

ROUNDS prioritizes memorable moments over perfect balance.
A card that creates one amazing story is worth ten "balanced" cards.
```

### 6.2 Balance Levers

| Lever | Adjustment Range | Example |
|-------|------------------|---------|
| Damage | -75% to +100% | Spray: -75%, Combine: +100% |
| Fire Rate | -100% to +1000% | Careful Planning: -150%, Spray: +1000% |
| Health | -100% to +100% | Glass Cannon: -100%, Tank: +100% |
| Projectile Count | +1 to +12 | Barrage: +4, Buckshot: +4, Spray: +12 ammo |
| Reload Time | -70% to +0.5s | Quick Reload: -70%, Wind Up: +0.5s |
| Bullet Speed | +25% to +250% | Fastball: +250% |

### 6.3 Soft Caps and Hard Caps

| Stat | Cap Type | Limit |
|------|----------|-------|
| Fire Rate | Soft | Animation/readability threshold |
| Projectile Count | Hard | ~12 active projectiles |
| Bounces | Hard | 2-7 bounces (Mayhem: 5, Bouncy: 2) |
| Damage Reduction | Hard | Cannot reach 100% |
| Lifesteal | Soft | Never heal more than damage dealt |
| Movement Speed | Soft | Diminishing returns after ~2x |

### 6.4 Counterplay Design

Every strong card should have counters:

| Strong Card | Counter Strategy |
|-------------|------------------|
| **Glass Cannon** | Any hit kills them—focus fire |
| **Homing** | Use terrain, they can't shoot around corners well |
| **Spray** | Long range—they need to get close |
| **Phoenix** | Kill them twice, or burst damage both lives |
| **Demonic Pact** | Chip damage—they can't afford to get hit |
| **Teleport** | Area denial—they teleport into traps |

---

## 7. Map Design Requirements

### 7.1 ROUNDS Map Principles

ROUNDS maps are **single-screen arenas** with:

1. **Multiple levels** - vertical gameplay
2. **Destructible elements** - floors/walls can break
3. **Environmental hazards** - void below, sometimes spikes
4. **Clear sightlines** - readable combat
5. **Cover positions** - temporary safety

### 7.2 Map Elements

| Element | Purpose | Frequency |
|---------|---------|-----------|
| Solid platforms | Primary combat surface | High |
| Breakable floors | Vertical access, chaos | Medium |
| Walls (solid) | Cover, bounce surfaces | High |
| Walls (breakable) | Dynamic line of sight | Medium |
| Void/pit | Death zone, knockback risk | Always |
| Spawn points | Round start positions | 2+ |

### 7.3 Map Size Guidelines

```
┌──────────────────────────────────────┐
│           ROUNDS ARENA               │
│                                      │
│   Width:  ~2-3 character screens    │
│   Height: ~1.5-2 character screens  │
│   Layers: 2-4 vertical levels       │
│                                      │
│   Goal: Keep all action visible     │
└──────────────────────────────────────┘
```

### 7.4 Map Interaction Rules

1. **Projectiles interact with all surfaces** (bounce, break, or stop)
2. **Players can destroy terrain** (creates new paths)
3. **Knockback can kill** (void is always present)
4. **Cover is temporary** (destructible or flanking routes)

---

## 8. Control Schemes

### 8.1 ROUNDS Controls (Gamepad Focus)

ROUNDS is designed for **controller-first** play:

| Action | Controller | Keyboard (if supported) |
|--------|------------|------------------------|
| Move Left/Right | Left Stick | A/D |
| Jump | A / Cross | Space/W |
| Aim | Right Stick | Mouse |
| Fire | Right Trigger | Left Click |
| Block | Left Trigger | Right Click/Shift |
| Reload | X / Square | R |

### 8.2 Control Design Principles

1. **Aim and move independently** (dual stick design)
2. **Block is a dedicated input** (critical mechanic)
3. **Fire is trigger-based** (analog control possible)
4. **Jump is face button** (easy access during combat)

### 8.3 Keyboard Adaptation Notes

For JAKESJAM browser play:

- Mouse aim is **essential** for precision
- Block needs a clear keybind (right click or Q)
- Jump should support both Space and W
- Reload should be R (FPS standard)

---

## 9. Visual Design

### 9.1 Card Rarity Colors

| Rarity | Color | Triangle Color | Frequency |
|--------|-------|----------------|-----------|
| Common | White/Gray | None/Gray | ~50% |
| Uncommon | Blue | Blue | ~35% |
| Rare | Magenta/Purple | Magenta | ~15% |

### 9.2 Card Visual Themes

ROUNDS cards have **thematic color coding**:

| Theme | Color Family | Example Cards |
|-------|--------------|---------------|
| Mechanical | Violet/Purple | Demonic Pact, Parasite, Decay |
| Explosive | Orange/Red | Bombs Away, Explosive Bullet |
| Movement | Green/Blue | Chase, Taste of Blood, Teleport |
| Defense | Blue/Cyan | Defender, Echo, Shields Up |
| Damage | Red | Combine, Glass Cannon, Wind Up |

### 9.3 Feedback Requirements

| Event | Visual Feedback |
|-------|-----------------|
| Player hit | Flash, knockback animation |
| Player death | Explosion/disintegration |
| Block trigger | Shield effect, sound |
| Card activation | Icon flash, particle effect |
| Projectile fired | Muzzle flash, trail |
| Projectile impact | Spark/explosion |
| Round win | Banner, screen effect |
| Draft selection | Card highlight, confirm animation |

### 9.4 Readability Rules

1. **Player silhouettes must be clear** against any background
2. **Projectiles must contrast** with map colors
3. **Health bars must be visible** at all times
4. **Card icons must be readable** in 2 seconds or less
5. **Status effects need clear indicators** (slow, burning, etc.)

---

## 10. Audio Design

### 10.1 Audio Priority Hierarchy

```
1. Gunshots (highest priority - never ducked)
2. Hit confirmations
3. Block/shield sounds
4. Explosions
5. Card activation sounds
6. Movement sounds
7. UI feedback (draft selection, etc.)
8. Music (lowest priority - ducks during combat)
```

### 10.2 Required Sound Categories

| Category | Examples | Purpose |
|----------|----------|---------|
| Weapon Fire | Pistol, shotgun, spray | Combat feedback |
| Impacts | Hit flesh, hit wall, hit shield | Damage confirmation |
| Blocks | Shield activate, parry | Defense feedback |
| Explosions | Bomb, grenade, environmental | Area damage |
| Movement | Jump, land, dash | Position awareness |
| UI | Card select, confirm, round start/end | Game state |
| Music | Lobby, combat, victory/defeat | Atmosphere |

### 10.3 Audio Design Rules

1. **Every card activation needs a sound** (even if subtle)
2. **Different weapons need distinct audio signatures**
3. **Rarity should have audio cues** (rare cards sound more powerful)
4. **Combat should never be sonically cluttered** (prioritize clarity)

---

## 11. Key Takeaways for JAKESJAM

### 11.1 What to Steal Directly

1. **Loser-drafts-first system** - core comeback mechanic
2. **Orthogonal upgrade axes** - different builds, not just better
3. **Visible tradeoffs on every card** - no hidden stats
4. **Single-screen arenas** - readable combat
5. **Block as active mechanic** - not passive defense
6. **Card stacking allowed** - builds escalate naturally
7. **10-20 second draft windows** - fast pacing

### 11.2 What to Adapt

1. **Controller-first → Mouse/Keyboard-first** (browser platform)
2. **3D physics → 2D physics** (Phaser platformer)
3. **Destructible terrain → Fixed arenas initially** (simpler networking)
4. **6-player free-for-all → 1v1 duel first** (JAKESJAM GDD)

### 11.3 What to Avoid

1. **Overly complex cards** - keep text under 10 words
2. **Infinite combos** - cap everything
3. **Pure stat cards** - every card should change behavior
4. **Long matches** - 5-10 minutes max
5. **Hidden information** - all cards visible to opponents

---

## Appendix: Complete ROUNDS Card List

See the source wiki for all 67 cards with full stats. Key highlights:

- **67 total cards** in base game
- **~35 Common** (~52%)
- **~24 Uncommon** (~36%)
- **~8 Rare** (~12%)

**Most played/build-defining cards:**
1. Spray
2. Homing
3. Glass Cannon
4. Tactical Reload + Shields Up combo
5. Demonic Pact
6. Teleport
7. Grow
8. Combine
