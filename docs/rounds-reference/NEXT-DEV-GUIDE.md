# ROUNDS Transformation - Next Dev Guide

**Status:** Phase 1 Complete (Draft System) ✅  
**Next:** Phase 2 (Pickup Removal) + Phase 3 (Match Flow Wiring)

---

## What's Done ✅

1. **DraftScene** - Card selection UI ready to use
2. **CardSystem** - Draft logic with comeback mechanics
3. **Types** - CardDefinition has benefits/penalties
4. **Integration** - DraftScene in GameConfig

## What's Next 🔄

You need to complete 2 tasks:

### Task 1: Remove Arena Pickups (30 mins)

Edit `client/src/game/scenes/MatchScene.ts`:

**Step 1:** Remove constant (line ~61)
```typescript
// DELETE this line:
const CARD_CACHE_RELOCATE_MS = 20000;
```

**Step 2:** Remove field (line ~199)  
```typescript
// CHANGE from:
private cardCacheRelocateTimerMs = 0;

// TO:
private cardCacheRelocateTimerMs = 0; // ROUNDS: Removed
```

**Step 3:** Remove relocation logic (lines ~2232-2236)
```typescript
// DELETE these 5 lines:
this.cardCacheRelocateTimerMs += deltaMs;
if (this.cardCacheRelocateTimerMs >= CARD_CACHE_RELOCATE_MS) {
  this.cardCacheRelocateTimerMs = 0;
  this.relocateCardCaches();
}
```

**Step 4:** Remove functions (find and delete)
```typescript
// DELETE entire relocateCardCaches() function (~line 2344)
// DELETE entire getRandomCardCachePosition() function (~line 2354)
// REPLACE collectProgressionCard() with stub that does nothing
```

**Step 5:** Simplify collectPickup() (~line 2260)
```typescript
private collectPickup(pickup: ArenaPickup) {
  pickup.available = false;
  pickup.respawnRemainingMs = pickup.respawnMs;
  this.audio?.play("pickup");

  // ROUNDS: Only health/shield, rest removed
  if (pickup.kind === "health-shard") {
    // ... keep health logic
    return;
  }
  if (pickup.kind === "shield-cell") {
    // ... keep shield logic  
    return;
  }
  return; // Ignore all other pickups
}
```

**Step 6:** Simplify pickup colors (~line 2894)
```typescript
function pickupColor(kind: PickupKind): number {
  const colors: Record<PickupKind, number> = {
    "health-shard": 0x86efac,
    "shield-cell": 0x93c5fd,
    // Gray out everything else
    "overcharge-core": 0x666666,
    "card-cache": 0x666666,
    "damage-amp": 0x666666,
    "speed-boost": 0x666666,
    "melee-mode": 0x666666,
    "slow-trap": 0x666666,
    "vulnerability-trap": 0x666666,
    "block-jammer": 0x666666,
    "boss-core": 0x666666,
  };
  return colors[kind];
}
```

**Step 7:** Simplify pickup rendering (~line 2413)
```typescript
// In updatePickupVisuals(), find the big if/else chain
// DELETE all cases except health-shard and shield-cell
// Add default case that does nothing

} else if (pickup.kind === "shield-cell") {
  // ... keep shield rendering
} else {
  // ROUNDS: Other pickups removed
}
```

**Test:** Run `bun run --filter client typecheck` - should pass!

---

### Task 2: Wire Draft to Match Flow (1 hour)

**Step 1:** Import CardSystem in MatchScene
```typescript
import { CardSystem } from "../systems/CardSystem";
```

**Step 2:** Add CardSystem field
```typescript
private readonly cardSystem = new CardSystem();
```

**Step 3:** Find where rounds end (search for "round end" or "winner")

**Step 4:** Add draft transition after round ends
```typescript
private async handleRoundEnd(winnerId: string) {
  // Existing round end code...
  this.showRoundResult(winnerId);
  await this.delay(2000);
  
  // NEW: Determine who drafts (loser)
  const loserId = winnerId === this.localPlayerId 
    ? this.opponentId 
    : this.localPlayerId;
  
  const playerBehind = loserId === this.localPlayerId && this.isPlayerBehind();
  
  // NEW: Generate 3 card choices
  const ownedCards = this.progressionCardIds.map(id => this.getCardById(id));
  const draftChoices = this.cardSystem.generateDraftChoices(playerBehind, ownedCards);
  
  // NEW: Launch DraftScene
  this.scene.pause();
  this.scene.launch(SceneKeys.Draft, {
    availableCards: draftChoices,
    currentBuild: ownedCards,
    roundNumber: this.currentRound,
    playerBehind: playerBehind,
    localPlayerId: this.localPlayerId,
  });
  
  this.scene.sleep();
}
```

**Step 5:** Handle draft completion
```typescript
// In create() or init(), add listener:
this.scene.events.on('shutdown', (data: any) => {
  if (data?.selectedCard) {
    // Apply card
    this.progressionCardIds.push(data.selectedCard.id);
    this.rebuildWeaponBuild();
    
    // Start next round
    this.startNextRound();
  }
});
```

**Test:** Run `bun run dev:client` and play a match!

---

## Testing Checklist

After completing both tasks:

- [ ] TypeScript compiles: `bun run typecheck`
- [ ] Game runs: `bun run dev:client`
- [ ] Arena has NO card-caches floating around
- [ ] Round ends → Draft scene appears
- [ ] Can click a card to select it
- [ ] Next round reflects card changes
- [ ] Cards persist across rounds

---

## Files Reference

**Already Done:**
- `client/src/game/scenes/DraftScene.ts` ✅
- `client/src/game/systems/CardSystem.ts` ✅
- `client/src/game/scenes/SceneKeys.ts` ✅ (Draft added)
- `client/src/game/GameConfig.ts` ✅ (DraftScene in list)
- `client/src/sim/data/cardTypes.ts` ✅ (benefits/penalties)

**Need Editing:**
- `client/src/game/scenes/MatchScene.ts` - Remove pickups, wire draft

---

## Common Pitfalls

**DON'T:**
- ❌ Delete the entire pickup system (keep health/shield)
- ❌ Remove CARD_CACHE_RELOCATE_MS without commenting usages
- ❌ Forget to handle draft completion callback
- ❌ Skip typecheck after edits

**DO:**
- ✅ Make one change at a time
- ✅ Run typecheck after each change
- ✅ Test locally after wiring draft
- ✅ Comment code instead of deleting (for now)

---

## Success Criteria

You're done when:

1. ✅ No card-caches appear in arena
2. ✅ Round ends show draft UI
3. ✅ Picking a card changes your weapon
4. ✅ Cards persist to next round
5. ✅ Loser sees better rarity cards
6. ✅ TypeScript compiles cleanly

---

## Time Estimate

- **Pickup removal:** 30-45 minutes
- **Draft wiring:** 45-60 minutes  
- **Testing:** 15-30 minutes
- **Total:** 1.5-2.5 hours

---

## Questions?

Read these docs:
- `docs/rounds-reference/JAKESJAM-ADAPTATION.md` - Full plan
- `docs/rounds-reference/IMPLEMENTATION-STATUS.md` - Progress tracker
- `docs/rounds-reference/ROUNDS-ANALYSIS.md` - Design reference

Good luck! 🚀
