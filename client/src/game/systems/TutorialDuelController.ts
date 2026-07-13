// Client-side wrapper around sim/tutorialDuel.ts, playing the same role
// LocalPlayerController.ts plays for solo movement-only Practice: owns the
// runtime/collision cache and per-tick scratch state so the scene's touchpoint
// is just step()/snapshot()/reset(). Originally a fixed TWO-entity duel
// (hero + one scripted vessel); now a full ROSTER controller — the sim
// module underneath was always N-entity capable (it mirrors World.ts's
// generic per-player loop over whatever's in state.players), so wave-spawned
// "archon shard" minions are just additional entity records with their own
// scripted inputs. See tutorialDuel.ts for why this composition exists
// rather than reusing LocalPlayerController or World.ts directly.

import {
  createTutorialDuelRuntime,
  createTutorialDuelState,
  stepTutorialDuel,
  type ShieldState,
  type TutorialDuelInput,
  type TutorialDuelRuntime,
} from "../../sim/tutorialDuel.js";
import { InputSeq, PlayerId, type Tick } from "../../sim/types.js";
import type { MapDefinition, PlayerEntity, SimEvent, Vec2, WorldState } from "../../sim/types.js";

export const TUTORIAL_HERO_ID = PlayerId("pretennoia-hero");
export const TUTORIAL_DUMMY_ID = PlayerId("pretennoia-vessel");

export type MinionSpawnOptions = {
  /** Starting health — shards die in a couple of hits by design. */
  health?: number;
  /** Card build (real card ids from sim/data/cards.ts) — this is what turns
   *  a minion's starter pistol into a "spell" (homing/fan/fire/explosive). */
  cards?: string[];
  /** Directional-shield ("warder" tier) — see tutorialDuel.ts's SHIELD_*
   *  constants for the actual mitigation logic. */
  shielded?: boolean;
};

export class TutorialDuelController {
  private readonly runtime: TutorialDuelRuntime;
  private readonly heroSpawn: Vec2;
  private readonly dummySpawn: Vec2;
  private state: WorldState;

  constructor(map: MapDefinition, heroSpawn: Vec2, dummySpawn: Vec2) {
    this.heroSpawn = heroSpawn;
    this.dummySpawn = dummySpawn;
    this.runtime = createTutorialDuelRuntime(map);
    this.state = this.buildInitialState();
  }

  private buildInitialState(): WorldState {
    const positions = new Map<string, Vec2>([
      [TUTORIAL_HERO_ID as string, this.heroSpawn],
      [TUTORIAL_DUMMY_ID as string, this.dummySpawn],
    ]);
    // Coherence: the adversary is ESTAPHAIOS — one of the lesser rulers
    // subordinate to Yeldabaoth in the same source text this project draws
    // its Coptic terms from — in COPPER (the danger/void support family).
    // Deliberately NOT "Archon": a generic title explains itself, which
    // breaks the game's own "never explain the sigil" rule. It was
    // previously "The Vessel" in gold before that, which was doubly wrong:
    // the PLAYER is the vessel, and gold is the player's own house/self
    // color — fighting a gold "Vessel" read as fighting yourself with no
    // payoff for the confusion.
    return createTutorialDuelState(
      [
        { playerId: TUTORIAL_HERO_ID, characterId: "balanced", name: "You", color: "#e8e4d6", weaponId: "starter-pistol" },
        { playerId: TUTORIAL_DUMMY_ID, characterId: "balanced", name: "Estaphaios", color: "#d08a5a", weaponId: "starter-pistol" },
      ],
      positions,
    );
  }

  /** Advance one tick. `inputs` carries the hero's real input plus every
   *  scripted entity's computed input, keyed by entity id. */
  step(inputs: Record<string, TutorialDuelInput>, dtMs: number): SimEvent[] {
    const result = stepTutorialDuel(this.state, this.runtime, inputs, dtMs);
    this.state = result.state;
    return result.events;
  }

  /** Read-only snapshot of the live world state — feeds EntityRenderCoordinator/SimEventRouter directly. */
  snapshot(): WorldState {
    return this.state;
  }

  hero() {
    return this.state.players[TUTORIAL_HERO_ID]!;
  }

  dummy() {
    return this.state.players[TUTORIAL_DUMMY_ID]!;
  }

  entity(id: string): PlayerEntity | undefined {
    return this.state.players[PlayerId(id)];
  }

  /** Every living entity id that isn't the hero — the current threat roster. */
  enemyIds(): string[] {
    return Object.keys(this.state.players).filter(
      (id) => id !== (TUTORIAL_HERO_ID as string) && this.state.players[PlayerId(id)]!.alive,
    );
  }

  /** Full reset — fresh runtime-independent state, same spawns. Used when a
   *  combat zone (a scripted "duel") restarts, e.g. skip/replay. */
  reset(): void {
    this.state = this.buildInitialState();
  }

  /** Respawn just the dummy at a new position with full health — used
   *  between zones (The Voice Speaks → The Response → The Vessel Answers)
   *  so each scripted fight starts clean without resetting the hero.
   *  `health` defaults to 100 (the early teaching-fight scale); the real
   *  climax fight passes a much bigger number (see tutorial-song.ts's
   *  vessel-dummy-spawn cue) — "should be an EPIC well-matched duel," not
   *  a 2-second burst regardless of the player's build. */
  respawnDummy(spawn: Vec2, health = 100): void {
    const dummy = this.state.players[TUTORIAL_DUMMY_ID]!;
    this.state = {
      ...this.state,
      players: {
        ...this.state.players,
        [TUTORIAL_DUMMY_ID]: {
          ...dummy,
          x: spawn.x,
          y: spawn.y,
          vx: 0,
          vy: 0,
          health,
          alive: true,
          shieldActive: false,
        },
      },
    };
  }

  /** Hero death in a scripted cinematic is a stumble, not a game over —
   *  put the spark back in the vessel at the zone's anchor, full health. */
  respawnHero(spawn: Vec2): void {
    const hero = this.state.players[TUTORIAL_HERO_ID]!;
    this.state = {
      ...this.state,
      players: {
        ...this.state.players,
        [TUTORIAL_HERO_ID]: {
          ...hero,
          x: spawn.x,
          y: spawn.y,
          vx: 0,
          vy: 0,
          health: 100,
          alive: true,
          shieldActive: false,
        },
      },
    };
  }

  /** Swap the boss's card build mid-fight — each escalation stage of the
   *  extraction gives the Vessel a nastier spell loadout. Card resolution
   *  is cached by identity (weapon.ts's buildIdentityCache keys on the
   *  cards ARRAY reference), so a fresh array per call is correct here. */
  setDummyCards(cards: string[]): void {
    const dummy = this.state.players[TUTORIAL_DUMMY_ID]!;
    this.state = {
      ...this.state,
      players: { ...this.state.players, [TUTORIAL_DUMMY_ID]: { ...dummy, cards: [...cards] } },
    };
  }

  /** Grant the HERO a real card mid-run — the tutorial has no draft UI
   *  (this is a solo scripted rite, not a match), so build progression
   *  here is entirely diegetic pickups (see TutorialDiegeticCues'
   *  cardManifest()) instead of a screen. Additive/stacking: each call
   *  appends, same identity-cached resolution setDummyCards relies on. */
  addHeroCard(cardId: string): void {
    const hero = this.state.players[TUTORIAL_HERO_ID]!;
    this.state = {
      ...this.state,
      players: { ...this.state.players, [TUTORIAL_HERO_ID]: { ...hero, cards: [...hero.cards, cardId] } },
    };
  }

  /** Insert a wave minion. The sim picks it up next tick automatically —
   *  movement memory and prevKeys are lazily created per-id inside
   *  stepTutorialDuel exactly like World.ts does for late joiners. */
  addMinion(id: string, spawn: Vec2, opts: MinionSpawnOptions = {}): void {
    const pid = PlayerId(id);
    const minion: PlayerEntity = {
      id: pid,
      characterId: "balanced",
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      aimX: spawn.x - 100,
      aimY: spawn.y,
      health: opts.health ?? 24,
      shieldActive: false,
      crouching: false,
      alive: true,
      weaponId: "starter-pistol",
      cards: opts.cards ? [...opts.cards] : [],
      fireCooldownMs: 0,
      ammo: 0,
      abilityCharge: 0,
      lastProcessedInputSeq: InputSeq(0),
    };
    this.state = {
      ...this.state,
      players: { ...this.state.players, [pid]: minion },
    };
    if (opts.shielded) {
      this.runtime.shields.set(pid, { hitStacks: 0, crackedMs: 0 });
    }
  }

  /** Current shield state (undefined = not a shield-bearing entity, or
   *  already removed) — the render layer reads this to draw the frontal
   *  facet cluster and the cracked/vulnerable flicker. */
  shieldState(id: string): ShieldState | undefined {
    return this.runtime.shields.get(PlayerId(id));
  }

  /** Script a shield ability phase onto ANY entity, including the boss —
   *  addMinion's `opts.shielded` only grants it at spawn time, but a real
   *  boss fight needs the ability to toggle mid-fight (a scripted "shield
   *  phase" the player has to crack, not just a static trait). Turning it
   *  on resets to a fresh unsealed state; turning it off removes the
   *  mitigation entirely (not just an already-cracked, still-flickering
   *  shield) so the fight reads as "the ability ended," not "it broke." */
  setShield(id: string, on: boolean): void {
    const pid = PlayerId(id);
    if (on) this.runtime.shields.set(pid, { hitStacks: 0, crackedMs: 0 });
    else this.runtime.shields.delete(pid);
  }

  /** Hard-remove an entity (post-dissolve prune, or horde:clear). */
  removeEntity(id: string): void {
    const pid = PlayerId(id);
    if (!this.state.players[pid]) return;
    const players = { ...this.state.players };
    delete players[pid];
    this.state = { ...this.state, players };
    this.runtime.shields.delete(pid);
  }

  /** Mark an entity dead in place (rig hides, dissolve VFX plays where it
   *  stood) without yanking the record out from under the current tick. */
  killEntity(id: string): void {
    const pid = PlayerId(id);
    const e = this.state.players[pid];
    if (!e) return;
    this.state = {
      ...this.state,
      players: { ...this.state.players, [pid]: { ...e, health: 0, alive: false } },
    };
  }

  currentTick(): Tick {
    return this.state.tick;
  }
}
