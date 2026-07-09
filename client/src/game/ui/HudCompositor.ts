// HudCompositor — single seam between any match scene and all HUD modules.
//
// Owns HudSystem, RoundBanner, DeathOverlay, CardDraftOverlay, and
// MatchResultsOverlay. Callers construct it once with interaction callbacks
// and call `update(state, localPlayerId, character)` every frame.
//
// Depth: all five sub-overlay lifecycles, event routing, and buff/score
// projection are behind the single `update` call. A caller goes from
// managing 5 overlay fields + 5 update helpers to one field + one call.
//
// The `state` parameter carries SimEvents that drove it here via
// WorldState (events arrived through onEvents on the ClientLoop callback and
// need routing to the right overlay). For the card-offered → CardDraftOverlay
// flow the caller passes a separate `pendingCardOffer` that is cleared once
// consumed, since WorldState does not carry the last-emitted events.

import type { PlayerId, WorldState } from "../../sim/types.js";
import { playerTag } from "./botIdentity";
import { STEP_MS } from "../../sim/constants.js";
import { crystalRoundsCards } from "../../sim/data/cards.js";
import type { CharacterDefinition } from "../types/game.js";
import { HudSystem, type HudChip, type HudVitals, type HudRound } from "./HudSystem.js";
import { RoundBanner } from "./RoundBanner.js";
import { DeathOverlay } from "./DeathOverlay.js";
import { CardDraftOverlay } from "./CardDraftOverlay.js";
import {
  MatchResultsOverlay,
  type MatchResultsRow,
} from "./MatchResultsOverlay.js";

export type HudCompositorCallbacks = {
  /** Called when the local player commits a card pick from the draft overlay. */
  onCardPick: (roundIndex: number, cardId: string) => void;
  /** Called when the Rematch button is pressed on the results overlay. */
  onRematch: () => void;
  /** Called when the Back to Lobby button is pressed on the results overlay. */
  onReturnToLobby: () => void;
};

/** A card-offered event that the compositor should route to the draft overlay. */
export type PendingCardOffer = {
  cardIds: string[];
  /** Deduplication key (cardIds.join("|")). Cleared by the compositor once shown. */
  key: string;
};

// Buff/debuff descriptors — kept here so the compositor owns the full HUD
// construction path.
type BuffDescriptor = {
  field: keyof import("../../sim/types.js").PlayerEntity;
  label: string;
  color: number;
  isDebuff: boolean;
};

const BUFF_DESCRIPTORS: BuffDescriptor[] = [
  { field: "overchargeUntilTick", label: "OC", color: 0xffd166, isDebuff: false },
  { field: "damageAmpUntilTick", label: "DMG", color: 0xfb7185, isDebuff: false },
  { field: "speedBoostUntilTick", label: "SPD", color: 0x67e8f9, isDebuff: false },
  { field: "meleeModeUntilTick", label: "MEL", color: 0xf97316, isDebuff: false },
  { field: "bossModeUntilTick", label: "BOSS", color: 0xfff7d6, isDebuff: false },
  { field: "slowDebuffUntilTick", label: "SLOW", color: 0xbfdbfe, isDebuff: true },
  { field: "vulnerabilityUntilTick", label: "VULN", color: 0xfca5a5, isDebuff: true },
  { field: "blockJammerUntilTick", label: "JAM", color: 0xc084fc, isDebuff: true },
];

const TARGET_SCORE_DEFAULT = 3;

export class HudCompositor {
  private readonly hud: HudSystem;
  private readonly banner: RoundBanner;
  private readonly deathOverlay: DeathOverlay;
  private readonly cardDraft: CardDraftOverlay;
  private readonly matchResults: MatchResultsOverlay;

  private readonly localPlayerId: PlayerId;
  private readonly callbacks: HudCompositorCallbacks;

  private matchHasEnded = false;
  private lastCardOfferKey: string | null = null;

  constructor(
    scene: Phaser.Scene,
    localPlayerId: PlayerId,
    callbacks: HudCompositorCallbacks,
  ) {
    this.localPlayerId = localPlayerId;
    this.callbacks = callbacks;

    this.hud = new HudSystem(scene, localPlayerId);
    this.banner = new RoundBanner(scene);
    this.deathOverlay = new DeathOverlay();
    this.cardDraft = new CardDraftOverlay();
    this.matchResults = new MatchResultsOverlay();
  }

  /**
   * Main frame-level update. Routes state into every sub-overlay. The caller
   * passes `pendingCardOffer` when a `card-offered` SimEvent arrived this
   * frame for the local player; the compositor routes it to the draft overlay
   * and returns a cleared (null) value so the caller can zero-out their
   * pending-event field.
   */
  update(
    state: WorldState,
    character: CharacterDefinition,
    pendingCardOffer: PendingCardOffer | null,
  ): PendingCardOffer | null {
    this.updateHud(state, character);
    if (!this.matchHasEnded) {
      this.updateBanner(state);
    }
    this.updateDeathOverlay(state);
    const remaining = this.routeCardOffer(state, pendingCardOffer);
    this.maybeShowMatchResults(state);
    return remaining;
  }

  destroy(): void {
    this.hud.destroy();
    this.banner.destroy();
    this.deathOverlay.destroy();
    this.cardDraft.destroy();
    this.matchResults.destroy();
  }

  // ── Private sub-update methods ─────────────────────────────────────────────

  private updateHud(state: WorldState, character: CharacterDefinition): void {
    const local = state.players[this.localPlayerId];

    const chips: HudChip[] = [];
    if (local) {
      for (const descriptor of BUFF_DESCRIPTORS) {
        // PlayerEntity fields are all optional numeric tick-stamps; cast through
        // unknown — the field name comes from our own controlled descriptor list.
        const tickValue = local[descriptor.field] as number | undefined;
        if (typeof tickValue === "number" && tickValue > state.tick) {
          const remainingMs = Math.max(0, (tickValue - state.tick) * STEP_MS);
          chips.push({
            label: descriptor.label,
            color: descriptor.color,
            remainingSec: remainingMs / 1000,
            isDebuff: descriptor.isDebuff,
          });
        }
      }
    }

    const cardNames: string[] = local
      ? local.cards
          .map((id) => crystalRoundsCards.find((c) => c.id === id)?.name)
          .filter((n): n is string => Boolean(n))
      : [];

    const vitals: HudVitals = {
      health: local?.health ?? 0,
      maxHealth: character.maxHealth,
      shieldCharge: local?.shieldCharge,
      shieldMaxCharge: local?.shieldMaxCharge ?? 0,
      // jetpackFuel / abilityCharge deliberately not fed: the jetpack was
      // removed from the game and abilityCharge is a dead sim field that's
      // initialized to 0 and never written — both rendered as permanent
      // frozen HUD noise ("125%" fuel bar, six always-dim dots).
      chips,
      cardNames,
      cardIds: local?.cards,
      isDead: !local || local.health <= 0 || !local.alive,
    };

    const winnerLabel =
      state.round.phase === "round-over"
        ? (() => {
            const wid = state.round.winnerPlayerId;
            if (!wid) return "DRAW";
            if (wid === this.localPlayerId) return "YOU";
            return playerTag(wid);
          })()
        : undefined;

    const round: HudRound = {
      phase: state.round.phase,
      countdownRemainingMs: state.round.countdownRemainingMs,
      roundIndex: state.round.roundIndex,
      scores: state.round.scores,
      winnerLabel,
    };

    this.hud.update(vitals, round);
  }

  private updateBanner(state: WorldState): void {
    const winnerLabel =
      state.round.phase === "round-over"
        ? (() => {
            const wid = state.round.winnerPlayerId;
            if (!wid) return "DRAW";
            if (wid === this.localPlayerId) return "YOU";
            return playerTag(wid);
          })()
        : undefined;

    this.banner.update({
      phase: state.round.phase,
      countdownRemainingMs: state.round.countdownRemainingMs,
      roundIndex: state.round.roundIndex,
      winnerLabel,
    });
  }

  private updateDeathOverlay(state: WorldState): void {
    const local = state.players[this.localPlayerId];
    const isDead = !local || local.health <= 0 || !local.alive;

    if (!isDead) {
      if (this.deathOverlay.isOpen()) {
        this.deathOverlay.hide();
      }
      return;
    }

    // Show countdown based on round phase. During fighting the respawn is
    // "end of round"; report seconds remaining in the fighting timer.
    const remainingSec = Math.max(
      0,
      Math.ceil(state.round.countdownRemainingMs / 1000),
    );
    if (this.deathOverlay.isOpen()) {
      this.deathOverlay.updateTimer(remainingSec);
    } else {
      this.deathOverlay.show(remainingSec);
    }
  }

  /**
   * Route a pending card-offer event to the draft overlay. Hides the death
   * overlay while the picker is active. Returns null once the offer has been
   * consumed so the caller can clear their pending field.
   */
  private routeCardOffer(
    state: WorldState,
    pending: PendingCardOffer | null,
  ): PendingCardOffer | null {
    if (!pending) return null;
    if (pending.key === this.lastCardOfferKey && this.cardDraft.isOpen()) {
      // Same offer still showing — don't re-open.
      return null;
    }
    this.lastCardOfferKey = pending.key;
    const candidates = pending.cardIds
      .map((id) => crystalRoundsCards.find((c) => c.id === id))
      .filter((c): c is import("../types/game.js").CardDefinition => Boolean(c));
    if (candidates.length === 0) return null;
    this.deathOverlay.hide();
    this.cardDraft.show(candidates, (card) => {
      this.callbacks.onCardPick(state.round.roundIndex, card.id);
    });
    return null;
  }

  private maybeShowMatchResults(state: WorldState): void {
    if (this.matchHasEnded) return;
    const { winnerPlayerId } = state.round;
    if (!winnerPlayerId) return;
    const winnerScore = state.round.scores[winnerPlayerId] ?? 0;
    if (winnerScore < TARGET_SCORE_DEFAULT) return;
    this.matchHasEnded = true;

    const rows: MatchResultsRow[] = Object.entries(state.round.scores).map(
      ([pid_, score]) => {
        const pid = pid_ as PlayerId;
        const player = state.players[pid];
        return {
          playerId: pid,
          name: pid === this.localPlayerId ? "You" : playerTag(pid),
          score,
          cardIds: player?.cards ?? [],
          isLocal: pid === this.localPlayerId,
        };
      },
    );

    this.matchResults.show(
      { winnerPlayerId, targetScore: TARGET_SCORE_DEFAULT, rows },
      {
        onRematch: () => {
          this.matchResults.hide();
          this.callbacks.onRematch();
        },
        onReturnToLobby: () => {
          this.matchResults.hide();
          this.callbacks.onReturnToLobby();
        },
      },
    );
  }
}
