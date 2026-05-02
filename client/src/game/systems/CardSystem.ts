import type { CardDefinition } from "../types/game";
import { crystalRoundsCards } from "../data/cards";

/**
 * CardSystem - Manages card drafting and application
 * 
 * ROUNDS-style: Cards are drafted between rounds, not collected in arena.
 * Loser drafts first. Cards persist entire match and stack with diminishing returns.
 */
export class CardSystem {
  private ownedCards: CardDefinition[] = [];

  /**
   * Generate 3 draft choices for a player
   * @param playerBehind True if player is losing (gets better rarities)
   * @param ownedCards Cards the player already has
   */
  generateDraftChoices(playerBehind: boolean, ownedCards: CardDefinition[]): CardDefinition[] {
    this.ownedCards = ownedCards;
    
    // Build weighted card pool based on comeback mechanics
    const weightedPool = this.buildWeightedCardPool(playerBehind);
    
    // Apply synergy bonuses with owned cards
    const synergyBoosted = this.applySynergyWeights(weightedPool, ownedCards);
    
    // Return 3 random choices (no duplicates)
    const choices: CardDefinition[] = [];
    const usedIds = new Set<string>();
    
    while (choices.length < 3 && synergyBoosted.length > 0) {
      const index = Math.floor(Math.random() * synergyBoosted.length);
      const card = synergyBoosted.splice(index, 1)[0];
      if (card && !usedIds.has(card.id)) {
        choices.push(card);
        usedIds.add(card.id);
      }
    }
    
    return choices;
  }

  /**
   * Build weighted card pool with rarity distribution
   */
  private buildWeightedCardPool(playerBehind: boolean): CardDefinition[] {
    // Rarity weights based on comeback mechanics
    const weights = playerBehind
      ? { common: 20, uncommon: 30, rare: 50 }  // Behind: more rares
      : { common: 50, uncommon: 35, rare: 15 };  // Ahead or tied: standard
    
    const pool: CardDefinition[] = [];
    
    for (const card of crystalRoundsCards) {
      const weight = this.getCardWeight(card, weights);
      for (let i = 0; i < weight; i++) {
        pool.push(card);
      }
    }
    
    return pool;
  }

  /**
   * Get weight for a card based on rarity
   */
  private getCardWeight(card: CardDefinition, weights: { common: number; uncommon: number; rare: number }): number {
    switch (card.rarity) {
      case "common": return weights.common;
      case "uncommon": return weights.uncommon;
      case "rare": return weights.rare;
      default: return 10;
    }
  }

  /**
   * Apply synergy bonuses - cards that combo well with owned cards get boosted
   */
  private applySynergyWeights(pool: CardDefinition[], ownedCards: CardDefinition[]): CardDefinition[] {
    if (ownedCards.length === 0) return pool;

    const synergyMatrix: Record<string, string[]> = {
      "homing": ["homing", "cluster", "split"],
      "bounce": ["ricochet", "bouncy", "trick-shot"],
      "explosive": ["explosive", "aoe", "damage"],
      "speed": ["speed", "fire-rate", "rapid"],
      "tank": ["health", "shield", "defense"],
    };

    const boosted: CardDefinition[] = [];
    
    for (const card of pool) {
      let weightMultiplier = 1;
      
      for (const owned of ownedCards) {
        const ownedTags = synergyMatrix[owned.id] || [];
        const cardTags = synergyMatrix[card.id] || [];
        
        // Check for synergy
        if (ownedTags.some(tag => cardTags.includes(tag)) ||
            cardTags.some(tag => ownedTags.includes(tag))) {
          weightMultiplier *= 1.5; // 50% boost for synergy
        }
      }
      
      // Add card multiple times based on weight
      for (let i = 0; i < weightMultiplier; i++) {
        boosted.push(card);
      }
    }
    
    return boosted;
  }

  // Authoritative card-application logic lives in
  // client/src/sim/data/weaponBuild.ts:applyCard. CardSystem is a draft-time
  // helper only; do not reintroduce a parallel applyCard here.


  /**
   * Reset owned cards (new match)
   */
  reset() {
    this.ownedCards = [];
  }

  /**
   * Add card to owned cards
   */
  addCard(card: CardDefinition) {
    this.ownedCards.push(card);
  }

  /**
   * Get currently owned cards
   */
  getOwnedCards(): CardDefinition[] {
    return [...this.ownedCards];
  }
}
