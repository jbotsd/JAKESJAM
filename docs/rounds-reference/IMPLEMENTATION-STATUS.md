# ROUNDS Transformation - Implementation Status

**Date:** 2026-05-02  
**Status:** Phase 1 Complete - Draft System Foundation ✅

---

## ✅ COMPLETED

### 1. Draft Scene Infrastructure
- **DraftScene.ts** - Full UI for between-round card selection
  - Shows 3 card choices with rarity-colored borders
  - Displays benefits (green) and penalties (red)
  - Click-to-select interaction with visual feedback
  - Current build summary at top
  - Professional UI matching ROUNDS style

### 2. Card System Logic  
- **CardSystem.ts** - Draft generation and card application
  - Weighted rarity pools (comeback mechanics)
  - Loser sees more rares (20/30/50 vs 50/35/15)
  - Synergy detection for card combos
  - Diminishing returns on stacked cards
  - Stat modifier application with scaling

### 3. Type System Updates
- **cardTypes.ts** - Added ROUNDS-style fields
  - `StatModifier` type for benefits/penalties
  - `benefits?: StatModifier[]` on CardDefinition
  - `penalties?: StatModifier[]` on CardDefinition
  - Backwards compatible with existing Crystal Rounds cards

### 4. Scene Integration
- **SceneKeys.ts** - Added `Draft: "DraftScene"`
- **GameConfig.ts** - Added DraftScene to scene list
- All TypeScript typechecks pass ✅

### 5. Comprehensive Documentation
Created 4 detailed reference docs in `docs/rounds-reference/`:
- **ROUNDS-ANALYSIS.md** - Complete game design breakdown
- **JAKESJAM-ADAPTATION.md** - Detailed adaptation plan with code
- **CARD-REDESIGN-PROPOSALS.md** - 15 cards with ROUNDS tradeoffs
- **SCREENSHOTS-LIST.md** - 20 reference screenshots to gather

---

## 🔄 NEXT PHASE: Arena Pickup Removal

### Files to Modify

#### 1. `client/src/sim/data/boxworks.ts`
**Action:** Set pickups array to empty or health-only

```typescript
// Line ~226
pickups: [
  // Option 1: NO pickups (pure ROUNDS)
  // Option 2: Health-only (3-4 max)
  { 
    id: "health-1", 
    kind: "health-shard", 
    position: { x: 480, y: 300 }, 
    radius: 12,
    amount: 25,
    respawnMs: 8000,
  },
],
```

#### 2. `client/src/game/scenes/MatchScene.ts`
**Actions:**
- Remove `CARD_CACHE_RELOCATE_MS` constant
- Remove `cardCacheRelocateTimerMs` field
- Remove `cardCacheRelocateTimerMs` update logic (~line 2222-2226)
- Remove `relocateCardCaches()` function (~line 2316-2334)
- Remove `collectProgressionCard()` function (~line 2336-2349)
- Simplify `collectPickup()` to only handle health/shield
- Remove stat-buff pickup cases (damage-amp, speed-boost, etc.)

#### 3. `client/src/game/types/game.ts`  
**Action:** Simplify `PickupKind` type (optional, for cleanliness)

```typescript
export type PickupKind =
  | "health-shard"
  | "shield-cell";
  // All others removed
```

---

## 🔄 NEXT PHASE: Wire Draft to Match Flow

### Modify `client/src/game/scenes/MatchScene.ts`

**Add draft transition after round ends:**

```typescript
// In handleRoundEnd() or similar:

private async handleRoundEnd(winnerId: string) {
  // Show round result banner
  this.showRoundResult(winnerId);
  await this.delay(2000);
  
  // Determine who drafts (loser)
  const loserId = winnerId === this.localPlayerId 
    ? this.opponentId 
    : this.localPlayerId;
  
  const playerBehind = this.isPlayerBehind();
  
  // Generate 3 card choices
  const cardSystem = new CardSystem();
  const draftChoices = cardSystem.generateDraftChoices(
    playerBehind,
    this.progressionCardIds.map(id => this.getCardById(id))
  );
  
  // Launch DraftScene
  this.scene.pause();
  this.scene.launch(SceneKeys.Draft, {
    availableCards: draftChoices,
    currentBuild: this.progressionCardIds.map(id => this.getCardById(id)),
    roundNumber: this.currentRound,
    playerBehind: playerBehind,
    localPlayerId: this.localPlayerId,
  });
  
  this.scene.sleep();
}

// Listen for draft completion:
this.scene.events.on('shutdown', (data: any) => {
  if (data?.selectedCard) {
    this.progressionCardIds.push(data.selectedCard.id);
    this.rebuildWeaponBuild();
    this.startNextRound();
  }
});
```

---

## 📊 IMPLEMENTATION PROGRESS

| Phase | Status | Completion |
|-------|--------|------------|
| **1. Draft Foundation** | ✅ Complete | 100% |
| **2. Remove Pickups** | 🔄 Pending | 0% |
| **3. Wire to Match** | 🔄 Pending | 0% |
| **4. Comeback Mechanics** | 🔄 Pending | 0% |
| **5. Polish & VFX** | 🔄 Pending | 0% |

**Overall:** 20% Complete

---

## 🎯 TESTING CHECKLIST

After Phase 2-3 implementation:

- [ ] Arena has NO card-caches
- [ ] Arena has 0-4 health pickups max
- [ ] Round ends → Draft scene appears
- [ ] 3 cards shown with rarity colors
- [ ] Clicking card applies it to player
- [ ] Next round reflects card changes
- [ ] Loser drafts first
- [ ] Player behind sees better rarities
- [ ] Cards persist across rounds
- [ ] Match ends → Cards reset

---

## 📝 CURRENT STATE

**What Works Now:**
- DraftScene can be launched manually
- CardSystem generates weighted choices
- Type system supports benefits/penalties
- All code compiles and typechecks

**What's Missing:**
- DraftScene not wired to match flow yet
- Arena still has all pickups
- Cards not actually applied to stats yet
- No visual feedback when cards activate

---

## ⏱️ ESTIMATED TIMELINE

| Task | Estimated Time |
|------|----------------|
| Remove arena pickups | 2-3 hours |
| Wire draft to match flow | 3-4 hours |
| Implement card stat application | 2-3 hours |
| Comeback mechanics tuning | 1-2 hours |
| Playtest & balance | 2-4 hours |
| **Total** | **10-16 hours** |

---

## 🚀 QUICK START FOR NEXT DEVELOPER

1. **Read the docs:**
   - `docs/rounds-reference/JAKESJAM-ADAPTATION.md` - Full implementation guide
   - `docs/rounds-reference/CARD-REDESIGN-PROPOSALS.md` - 15 ROUNDS-style cards

2. **Start with pickup removal:**
   - Edit `boxworks.ts` line 226 - empty the pickups array
   - Edit `MatchScene.ts` - remove card-cache logic

3. **Wire draft to match:**
   - Find where rounds end in MatchScene
   - Add `this.scene.launch(SceneKeys.Draft, ...)` call
   - Handle draft completion callback

4. **Test locally:**
   ```bash
   bun run dev:client
   # Play a match, verify draft appears after round
   ```

---

## 💡 DESIGN PRINCIPLES TO REMEMBER

1. **Loser drafts first** - This is THE core comeback mechanic
2. **Tradeoffs matter** - Every card must have upsides AND downsides
3. **Visible impact** - Cards must change how you play, not just numbers
4. **Short rounds, long matches** - 30-60s rounds, best of 5-7
5. **Arena is for fighting, not powerups** - Remove distraction pickups

---

**Status:** Foundation complete. Ready for pickup removal and match flow integration.

**Next Step:** Start Phase 2 - Remove 90% of arena pickups.
