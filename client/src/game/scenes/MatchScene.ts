import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import { boxworksWorld, seededUnit } from "../../sim/data/boxworks.js";
import {
  COUNTDOWN_MS,
  TARGET_SCORE_DEFAULT,
  stepRound,
} from "../../sim/round.js";
import type {
  PlayerEntity,
  PlayerId,
  RoundState,
} from "../../sim/types.js";
import { crystalRoundsCards } from "../data/cards";
import { characters } from "../data/characters";
import { getChaosModifiers, projectileShapes } from "../data/chaosModifiers";
import { starterWeapon } from "../data/weapons";
import { RoomClient } from "../net/RoomClient";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { GameAudioSystem } from "../systems/AudioSystem";
import { CardDraftOverlay } from "../ui/CardDraftOverlay";
import {
  MatchResultsOverlay,
  type MatchResultsRow,
} from "../ui/MatchResultsOverlay";
import { HudSystem, type HudChip } from "../ui/HudSystem";
import { RoundBanner } from "../ui/RoundBanner";
import { DeathOverlay } from "../ui/DeathOverlay";
import {
  MovementSystem,
  type MovementDebug,
  type MovementInput,
  type PlayerBody,
} from "../systems/MovementSystem";
import {
  ProjectileSystem,
  type ProjectileHit,
  type ProjectileTarget,
} from "../systems/ProjectileSystem";
import {
  createWeaponBuild,
  findCardsById,
  type ResolvedWeaponBuild,
} from "../systems/WeaponSystem";
import type {
  CharacterDefinition,
  CharacterId,
  ChaosModifierId,
  DestructibleKind,
  ElementType,
  MatchId,
  PickupKind,
  RoomId,
  Vec2,
} from "../types/game";
import { CardSystem } from "../systems/CardSystem";
import type { MatchPlayerSnapshot, RoomPlayer } from "../types/net";

const STANDING_CHEST_OFFSET = 75;
const CROUCHING_CHEST_OFFSET = 54;
const MUZZLE_REACH = 43;
const PLAYER_VISUAL_SCALE = 0.78;
const SNAPSHOT_SEND_INTERVAL_MS = 100;
const REMOTE_SMOOTHING = 0.26;
const CHAOS_MODIFIERS_KEY = "jakesjam.chaosModifiers";
// const CARD_CACHE_RELOCATE_MS = 20000; // ROUNDS: Removed - draft between rounds
const REMOTE_PLAYER_TARGET_PREFIX = "remote-player:";
// Synthetic player id used to feed the dummy target into the round state
// machine. With only one human player + a dummy, we treat the dummy as a
// second "player" so last-alive resolution kicks in when the player kills it
// (or vice versa). Picked to avoid clashing with real player ids.
const DUMMY_TARGET_PLAYER_ID = "dummy:practice-target";
const DEATH_POPUP_DELAY_MS = 520;
const RESPAWN_COUNTDOWN_MS = 3000;
const PARRY_ACTIVE_MS = 420;
const PARRY_COOLDOWN_MS = 4300;
const PARRY_BASE_ARC_RADIANS = Math.PI * 0.72;
const PARRY_BASE_RANGE = 98;
// const DAMAGE_AMP_MULTIPLIER = 1.42;
// const SPEED_BOOST_MULTIPLIER = 1.22;
const SLOW_DEBUFF_MULTIPLIER = 0.62;
const VULNERABILITY_MULTIPLIER = 1.38;
// const BOSS_MOVE_MULTIPLIER = 0.72;
// const BOSS_DAMAGE_MULTIPLIER = 1.55;
// const BOSS_FIRE_RATE_MULTIPLIER = 0.72;

type MatchSceneInitData = {
  roomId?: RoomId;
  roomCode?: string;
  matchId?: MatchId;
  localPlayerId?: string;
  players?: RoomPlayer[];
  chaosModifierIds?: ChaosModifierId[];
};

type MovementKeys = {
  a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  r: Phaser.Input.Keyboard.Key;
  shift: Phaser.Input.Keyboard.Key;
  c: Phaser.Input.Keyboard.Key;
  tab: Phaser.Input.Keyboard.Key;
};

type ChaosProfile = {
  names: string[];
  gravityMultiplier: number;
  timeScale: number;
  damageMultiplier: number;
  fireRateMultiplier: number;
  recoilMultiplier: number;
  disableProjectiles: boolean;
  randomProjectileShapes: boolean;
  fireHazardIntervalMs?: number;
};

type PlayerScore = {
  kills: number;
  deaths: number;
};

export class MatchScene extends Phaser.Scene {
  private readonly movement = new MovementSystem();
  private readonly handleScoreboardKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Tab") {
      return;
    }

    event.preventDefault();
    if (event.repeat) {
      return;
    }

    this.scoreboardVisible = !this.scoreboardVisible;
    this.updateScoreboardOverlay();
  };
  private audio?: GameAudioSystem;
  private projectileSystem?: ProjectileSystem;
  private roomClient?: RoomClient;
  private unsubscribeSnapshots?: () => void;
  private playerRig?: ProceduralPlayerRig;
  private readonly remoteRigs = new Map<string, ProceduralPlayerRig>();
  private readonly remoteSnapshots = new Map<string, MatchPlayerSnapshot>();
  private readonly remoteShotSequences = new Map<string, number>();
  private cameraTarget?: Phaser.GameObjects.Zone;
  private reticle?: Phaser.GameObjects.Graphics;
  private scoreboardBack?: Phaser.GameObjects.Rectangle;
  private scoreboardText?: Phaser.GameObjects.Text;
  private scoreboardVisible = false;
  private respawnText?: Phaser.GameObjects.Text;
  private readonly cardSystem = new CardSystem();
  private targetText?: Phaser.GameObjects.Text;
  private targetGraphics?: Phaser.GameObjects.Graphics;
  private destructibleGraphics?: Phaser.GameObjects.Graphics;
  private fireGraphics?: Phaser.GameObjects.Graphics;
  private pickupGraphics?: Phaser.GameObjects.Graphics;
  private keys?: MovementKeys;
  private movementDebug: MovementDebug = {
    coyoteMs: 0,
    jumpBufferMs: 0,
    jetpackFuel: 100,
    jetpackActive: false,
  };
  private playerBody: PlayerBody = createPlayerBody();
  private target: TestTarget = createTestTarget();
  private destructibles: ArenaDestructible[] = createDestructibleStates();
  private pickups: ArenaPickup[] = createPickupStates();
  private firePatches: FirePatch[] = [];
  private weaponBuild: ResolvedWeaponBuild = createWeaponBuild(starterWeapon, []);
  private progressionCardIds: string[] = [];
  private fireCooldownMs = 0;
  private targetKills = 0;
  private nextFirePatchId = 1;
  private playerHealth = 100;
  private playerMaxHealth = 100;
  private playerRespawnPending = false;
  private respawnRemainingMs = 0;
  private respawnCountdownActive = false;
  private deathSequenceId = 0;
  private cardDraftOverlay?: CardDraftOverlay;
  private shieldCharge = 100;
  private shieldActive = false;
  private temporaryShieldMs = 0;
  private overchargeMs = 0;
  private damageAmpMs = 0;
  private speedBoostMs = 0;
  private meleeModeMs = 0;
  private slowDebuffMs = 0;
  private vulnerabilityMs = 0;
  private blockJammerMs = 0;
  private parryActiveMs = 0;
  private parryCooldownMs = 0;
  private rightMouseParryWasDown = false;
  private lastPickupStatus = "none";
  private shieldGraphics?: Phaser.GameObjects.Graphics;
  private roomId?: RoomId;
  private matchId?: MatchId;
  private localPlayerId = "offline-player";
  private roomPlayers: RoomPlayer[] = [];
  private readonly playerScores = new Map<string, PlayerScore>();
  private snapshotSendTimerMs = 0;
  private snapshotSequence = 0;
  private shotSequence = 0;
  private ignoreLocalSnapshotsThroughSequence = 0;
  private chaosModifierIds: ChaosModifierId[] = [];
  private fireHazardTimerMs = 0;
  // Round-flow state owned by this scene; sim/round.ts is reused as a pure
  // helper. Initialised on create() to a fresh countdown.
  private roundState: RoundState = createInitialRoundState();
  private targetScore = TARGET_SCORE_DEFAULT;
  private matchResultsOverlay?: MatchResultsOverlay;
  // True once stepRound emits matchComplete this scene-life. Stops further
  // round/score mutations and gates the results overlay.
  private matchHasEnded = false;
  private hudSystem?: HudSystem;
  private roundBannerSystem?: RoundBanner;
  private deathOverlay?: DeathOverlay;

  constructor() {
    super(SceneKeys.Match);
  }

  init(data: MatchSceneInitData = {}) {
    this.roomId = data.roomId;
    this.matchId = data.matchId;
    this.localPlayerId = data.localPlayerId ?? "offline-player";
    this.roomPlayers = data.players ?? [];
    this.chaosModifierIds = data.chaosModifierIds ?? readStoredChaosModifiers();
    this.fireHazardTimerMs = 0;
  }

  create() {
    this.events.once("shutdown", () => {
      window.removeEventListener("keydown", this.handleScoreboardKeyDown);
      this.teardownNetworkSync();
      this.audio?.destroy();
      this.audio = undefined;
      this.cardDraftOverlay?.destroy();
      this.cardDraftOverlay = undefined;
      this.matchResultsOverlay?.destroy();
      this.matchResultsOverlay = undefined;
      this.hudSystem?.destroy();
      this.hudSystem = undefined;
      this.roundBannerSystem?.destroy();
      this.roundBannerSystem = undefined;
      this.deathOverlay?.destroy();
      this.deathOverlay = undefined;
    });
    window.removeEventListener("keydown", this.handleScoreboardKeyDown);
    window.addEventListener("keydown", this.handleScoreboardKeyDown);
    this.input.mouse?.disableContextMenu();
    this.teardownNetworkSync();
    this.audio?.destroy();
    this.audio = new GameAudioSystem(this);
    this.projectileSystem?.destroy();
    this.destroyPlayerVisuals();
    this.target = createTestTarget();
    this.destructibles = createDestructibleStates();
    this.pickups = createPickupStates();
    this.firePatches = [];
    this.clearRespawnText();
    this.playerRespawnPending = false;
    this.respawnRemainingMs = 0;
    this.respawnCountdownActive = false;
    this.deathSequenceId += 1;
    this.cardDraftOverlay?.hide();
    if (!this.cardDraftOverlay) {
      this.cardDraftOverlay = new CardDraftOverlay();
    }
    this.shieldCharge = 100;
    this.shieldActive = false;
    this.temporaryShieldMs = 0;
    this.overchargeMs = 0;
    this.damageAmpMs = 0;
    this.speedBoostMs = 0;
    this.meleeModeMs = 0;
    this.slowDebuffMs = 0;
    this.vulnerabilityMs = 0;
    this.blockJammerMs = 0;
    this.parryActiveMs = 0;
    this.parryCooldownMs = 0;
    this.rightMouseParryWasDown = false;
    this.shotSequence = 0;
    this.ignoreLocalSnapshotsThroughSequence = 0;
    this.lastPickupStatus = "none";
    this.progressionCardIds = [];
    this.projectileSystem = new ProjectileSystem(this);
    this.roundState = createInitialRoundState();
    this.matchHasEnded = false;
    this.playerScores.clear();
    this.resetPlayer();
    this.renderArena();
    this.configureCamera();
    this.createArenaHazardVisuals();
    this.createTargetVisuals();
    this.createPlayerVisuals();
    this.createRemotePlayerVisuals();
    this.createReticle();
    this.createScoreboardOverlay();
    this.hudSystem?.destroy();
    this.hudSystem = new HudSystem(this, this.localPlayerId);
    this.roundBannerSystem?.destroy();
    this.roundBannerSystem = new RoundBanner(this);
    if (!this.deathOverlay) {
      this.deathOverlay = new DeathOverlay();
    } else {
      this.deathOverlay.hide();
    }
    this.bindKeys();
    this.ensureScore(this.localPlayerId);
    this.rebuildWeaponBuild();
    this.setupNetworkSync();
    if (!this.matchResultsOverlay) {
      this.matchResultsOverlay = new MatchResultsOverlay();
    } else {
      this.matchResultsOverlay.hide();
    }
  }

  update(_time: number, deltaMs: number) {
    if (!this.keys || !this.playerRig || !this.projectileSystem) {
      return;
    }

    // Drive the round state machine first so input gating below picks up
    // the new phase on the same tick. Round timing uses raw wall-clock dt
    // so chaos time-scale doesn't stretch the countdown / round-timer.
    this.advanceRoundState(deltaMs);

    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
      this.resetPlayer();
      this.resetTarget();
      this.resetDestructibles();
    }

    const chaos = this.getChaosProfile();
    const scaledDeltaMs = deltaMs * chaos.timeScale;
    const scaledDeltaSeconds = Math.min(scaledDeltaMs / 1000, 1 / 30);
    this.updateRespawnCountdown(deltaMs);

    if (this.playerRespawnPending) {
      this.playerBody.velocity = { x: 0, y: 0 };
      this.shieldActive = false;
      this.updateTarget(scaledDeltaMs);
      this.updateChaosHazards(scaledDeltaMs);
      this.updateFirePatches(scaledDeltaMs);
      const hits = this.projectileSystem.update(
        scaledDeltaSeconds,
        boxworksWorld.platforms,
        this.getProjectileTargets(),
      );
      this.applyProjectileHits(hits);
      this.updateNetworkSync(deltaMs);
      this.syncPlayerVisuals(deltaMs);
      this.syncRemotePlayerVisuals(deltaMs);
      this.updateReticle();
      this.updateScoreboardOverlay();
      this.updateHudSystem();
      this.updateRoundBannerSystem();
      return;
    }

    this.updateShield(scaledDeltaMs);
    this.updateParry(scaledDeltaMs);
    const wasGrounded = this.playerBody.grounded;
    const input = this.readInput();
    this.movementDebug = this.movement.update(
      this.playerBody,
      input,
      boxworksWorld.platforms,
      scaledDeltaSeconds,
      {
        speedMultiplier: this.getLocalCharacter().moveSpeedMultiplier * this.getMoveSpeedModifier(),
        gravityMultiplier: chaos.gravityMultiplier,
      },
    );
    this.playMovementSounds(wasGrounded);

    if (this.isOutOfBounds()) {
      this.resetPlayer();
    }
    this.updateCameraTarget();
    this.updatePickups(scaledDeltaMs);

    this.fireCooldownMs = Math.max(0, this.fireCooldownMs - scaledDeltaMs);
    this.tryFireWeapon();
    this.updateTarget(scaledDeltaMs);
    this.updateChaosHazards(scaledDeltaMs);
    this.updateFirePatches(scaledDeltaMs);

    const hits = this.projectileSystem.update(
      scaledDeltaSeconds,
      boxworksWorld.platforms,
      this.getProjectileTargets(),
    );
    this.applyProjectileHits(hits);

    this.updateNetworkSync(deltaMs);
    this.syncPlayerVisuals(deltaMs);
    this.syncRemotePlayerVisuals(deltaMs);
    this.updateReticle();
    this.updateScoreboardOverlay();
    this.updateHudSystem();
    this.updateRoundBannerSystem();
  }

  private renderArena() {
    const { x: width, y: height } = boxworksWorld.size;
    this.add.rectangle(width / 2, height / 2, width, height, 0x0b0e14);
    this.add.grid(width / 2, height / 2, width, height, 40, 40, 0x111722, 0.65, 0x1f2a3a, 0.26);

    for (const platform of boxworksWorld.platforms) {
      const color = platform.kind === "floor" ? 0x354054 : 0x2a3242;
      this.add
        .rectangle(platform.position.x, platform.position.y, platform.size.x, platform.size.y, color)
        .setStrokeStyle(1, 0x56647c, 0.55);
    }

    for (const spawn of boxworksWorld.spawns) {
      this.add.circle(spawn.x, spawn.y, 5, 0x50e3c2, 0.5);
    }

  }

  private configureCamera() {
    this.cameras.main.setBounds(0, 0, boxworksWorld.size.x, boxworksWorld.size.y);
    this.cameras.main.setRoundPixels(true);
    this.cameraTarget?.destroy();
    this.cameraTarget = this.add.zone(this.playerBody.position.x, this.playerBody.position.y, 2, 2);
    this.cameras.main.startFollow(this.cameraTarget, false, 0.12, 0.12);
    this.updateCameraTarget();
  }

  private updateCameraTarget() {
    this.cameraTarget?.setPosition(this.playerBody.position.x, this.playerBody.position.y);
  }

  private createArenaHazardVisuals() {
    this.fireGraphics = this.add.graphics();
    this.destructibleGraphics = this.add.graphics();
    this.pickupGraphics = this.add.graphics();
    this.updateFireVisuals();
    this.updateDestructibleVisuals();
    this.updatePickupVisuals();
  }

  private createPlayerVisuals() {
    const localPlayer = this.getLocalRoomPlayer();
    const character = this.getLocalCharacter();
    this.shieldGraphics = this.add.graphics();
    this.playerRig = new ProceduralPlayerRig(this, {
      color: colorToNumber(localPlayer?.color ?? "#50e3c2"),
      name: `${localPlayer?.name ?? "jakesjam"} / ${character.name}`,
      scale: this.getVisualScale(character),
    });
    this.syncPlayerVisuals();
  }

  private createRemotePlayerVisuals() {
    for (const player of this.roomPlayers) {
      if (player.playerId === this.localPlayerId) {
        continue;
      }

      const rig = new ProceduralPlayerRig(this, {
        color: colorToNumber(player.color),
        name: `${player.name} / ${this.getCharacter(player.characterId).name}`,
        scale: this.getVisualScale(this.getCharacter(player.characterId)),
      });
      this.remoteRigs.set(player.playerId, rig);
    }
    this.syncRemotePlayerVisuals();
  }

  private createTargetVisuals() {
    this.targetGraphics = this.add.graphics();
    this.targetText = this.add
      .text(this.target.position.x, this.target.position.y - 44, "", {
        color: "#f7fbff",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "12px",
        fontStyle: "800",
      })
      .setOrigin(0.5, 1);
    this.updateTargetVisuals();
  }

  private createReticle() {
    this.reticle = this.add.graphics();
  }

  private createScoreboardOverlay() {
    const { width } = this.scale;
    this.scoreboardBack = this.add
      .rectangle(width / 2, 126, 410, 196, 0x07101c, 0.84)
      .setStrokeStyle(2, 0x50e3c2, 0.5)
      .setScrollFactor(0)
      .setDepth(950)
      .setVisible(false);
    this.scoreboardText = this.add
      .text(width / 2 - 180, 50, "", {
        color: "#f7fbff",
        fontFamily: "Consolas, monospace",
        fontSize: "14px",
        fontStyle: "800",
        lineSpacing: 6,
      })
      .setScrollFactor(0)
      .setDepth(951)
      .setVisible(false);
  }

  /**
   * Build a minimal synthetic Record<PlayerId, PlayerEntity> for stepRound.
   * The state machine only reads `alive` and `health`; everything else is
   * stub data so the type matches. For offline practice we include the
   * dummy crystal target as a synthetic second "player" so the round can
   * resolve via last-alive when the player kills it (or vice versa) — this
   * is what turns the previously-endless sandbox into a real round loop.
   */
  private buildSimPlayers(): Record<PlayerId, PlayerEntity> {
    const players: Record<PlayerId, PlayerEntity> = {};
    const localAlive = !this.playerRespawnPending && this.playerHealth > 0;
    players[this.localPlayerId] = makeSimPlayerStub(this.localPlayerId, this.playerHealth, localAlive);

    if (this.roomPlayers.length === 0) {
      // Solo / practice — let the dummy stand in as the opponent so the
      // last-alive resolver has something to compare against.
      players[DUMMY_TARGET_PLAYER_ID] = makeSimPlayerStub(
        DUMMY_TARGET_PLAYER_ID,
        this.target.alive ? this.target.health : 0,
        this.target.alive,
      );
      return players;
    }

    for (const remote of this.roomPlayers) {
      if (remote.playerId === this.localPlayerId) continue;
      const snapshot = this.remoteSnapshots.get(remote.playerId);
      const health = snapshot?.health ?? 100;
      const alive = snapshot ? snapshot.alive !== false && health > 0 : true;
      players[remote.playerId] = makeSimPlayerStub(remote.playerId, health, alive);
    }
    return players;
  }

  /**
   * Advance the round state machine and react to phase transitions /
   * `round-end` events. Pure state transitions live in sim/round.ts; this
   * method wires them to scene-side concerns:
   *   - on round-end, increment scoreboard kills for the winner;
   *   - on round-over → countdown (next-round boundary), respawn the local
   *     player and reset the dummy/destructibles for a clean fight;
   *   - on matchComplete, freeze the loop and surface the results overlay.
   */
  private advanceRoundState(deltaMs: number) {
    if (this.matchHasEnded) {
      // Match is parked. Don't keep stepping: stepRound is idempotent on
      // round-over with countdown=0 + scores satisfying the winner check,
      // but skipping avoids re-emitting boundary work.
      return;
    }

    const players = this.buildSimPlayers();
    const previousPhase = this.roundState.phase;
    const result = stepRound({
      state: this.roundState,
      players,
      dtMs: deltaMs,
      targetScore: this.targetScore,
    });
    this.roundState = result.state;

    for (const event of result.events) {
      if (event.t === "round-end") {
        this.handleRoundEnd(event.winnerId);
      }
    }

    // round-over → countdown is the "next round starts" boundary. When the
    // match has been decided, stepRound parks in round-over and reports
    // matchComplete instead of advancing — so we only respawn between
    // non-final rounds.
    const enteredCountdownFromOver = previousPhase === "round-over" && this.roundState.phase === "countdown";
    if (enteredCountdownFromOver) {
      // Force-close any pending death-draft so the next round starts on a
      // clean slate. The picked card is already in progressionCardIds; if
      // the player hadn't picked yet, the draft is dropped (no penalty —
      // they get fresh chances on subsequent deaths).
      this.cardDraftOverlay?.hide();
      this.respawnPlayer();
      this.resetTarget();
      this.resetDestructibles();
    }

    if (result.matchComplete) {
      this.matchHasEnded = true;
      this.showMatchResults();
    }
  }

  private handleRoundEnd(winnerId: PlayerId | null) {
    if (winnerId !== null) {
      // Use kills as a proxy for round-wins on the existing scoreboard so
      // the held-Tab overlay starts reflecting round-flow progress without
      // a schema change. Hooks into ensureScore so unknown winners (e.g.
      // the dummy) still get tallied and surfaced in the results overlay.
      this.addKill(winnerId);

      // ROUNDS: Launch draft scene for the loser after each round
      const loserId = winnerId === this.localPlayerId
        ? DUMMY_TARGET_PLAYER_ID
        : this.localPlayerId;

      // Only the local player drafts (online draft sync is future work)
      if (loserId === this.localPlayerId && !this.matchHasEnded) {
        const ownedCards = findCardsById(crystalRoundsCards, this.progressionCardIds);
        const draftChoices = this.cardSystem.generateDraftChoices(false, ownedCards);

        if (draftChoices.length > 0) {
          // Brief delay so round-over banner is visible first
          this.time.delayedCall(1800, () => {
            if (this.matchHasEnded) return;
            this.scene.pause();
            this.scene.launch("DraftScene", {
              availableCards: draftChoices,
              currentBuild: ownedCards,
              roundNumber: this.roundState.roundIndex,
              playerBehind: false,
              localPlayerId: this.localPlayerId,
            });

            // Listen for draft completion: resume match and apply card
            const draftScene = this.scene.get("DraftScene");
            if (draftScene) {
              draftScene.events.once("shutdown", () => {
                // Read selected card from registry
                const selectedCard = this.registry.get("draftSelectedCard");
                if (selectedCard) {
                  this.progressionCardIds.push(selectedCard.id);
                  this.rebuildWeaponBuild();
                  this.registry.remove("draftSelectedCard");
                }
                // Resume the match scene so round state continues advancing
                this.scene.resume();
              });
            }
          });
        }
      }
    }
  }

  private getRoundWinnerLabel(winnerId: PlayerId | null): string {
    if (winnerId === null) {
      return "DRAW";
    }
    if (winnerId === this.localPlayerId) {
      return (this.getLocalRoomPlayer()?.name ?? "YOU").toUpperCase();
    }
    if (winnerId === DUMMY_TARGET_PLAYER_ID) {
      return "CRYSTAL DUMMY";
    }
    const remote = this.getRoomPlayer(winnerId);
    // Fall back to a short id slice (last 4 chars) instead of dumping the
    // full raw id like 'PLAYER_1B89' which wraps and reads like garbage.
    return (remote?.name ?? winnerId.slice(-4)).toUpperCase();
  }

  private showMatchResults() {
    if (!this.matchResultsOverlay) {
      this.matchResultsOverlay = new MatchResultsOverlay();
    }
    const view = this.buildResultsView();
    this.matchResultsOverlay.show(view, {
      onRematch: () => this.handleRematch(),
      onReturnToLobby: () => this.handleReturnToLobby(),
    });
  }

  private buildResultsView() {
    const targetScore = this.targetScore;
    const winnerPlayerId = this.roundState.winnerPlayerId;
    const rows: MatchResultsRow[] = [];

    const localRoom = this.getLocalRoomPlayer();
    rows.push({
      playerId: this.localPlayerId,
      name: localRoom?.name ?? "jakesjam",
      color: localRoom?.color,
      // Round wins for the local player are tracked in roundState.scores.
      score: this.roundState.scores[this.localPlayerId] ?? 0,
      cardIds: [...this.progressionCardIds],
      isLocal: true,
    });

    if (this.roomPlayers.length === 0) {
      rows.push({
        playerId: DUMMY_TARGET_PLAYER_ID,
        name: "Crystal Dummy",
        color: "#a78bfa",
        score: this.roundState.scores[DUMMY_TARGET_PLAYER_ID] ?? 0,
        cardIds: [],
      });
    } else {
      for (const remote of this.roomPlayers) {
        if (remote.playerId === this.localPlayerId) continue;
        rows.push({
          playerId: remote.playerId,
          name: remote.name,
          color: remote.color,
          score: this.roundState.scores[remote.playerId] ?? 0,
          // Online card lists belong in RoomSnapshot; for now we only have
          // them locally. Empty list is acceptable until that wiring lands.
          cardIds: [],
        });
      }
    }

    return { winnerPlayerId, targetScore, rows };
  }

  private handleRematch() {
    // Card progression resets between matches: a rematch is a fresh build
    // run, mirroring how each match is its own draft arc. Cards picked
    // mid-round still carry across rounds inside a match — only crossing
    // a match boundary clears the deck.
    this.matchResultsOverlay?.hide();
    this.scene.restart({
      roomId: this.roomId,
      matchId: this.matchId,
      localPlayerId: this.localPlayerId,
      players: this.roomPlayers,
      chaosModifierIds: this.chaosModifierIds,
    });
  }

  private handleReturnToLobby() {
    this.matchResultsOverlay?.hide();
    window.dispatchEvent(new CustomEvent("jakesjam:return-to-lobby"));
  }

  private bindKeys() {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input is unavailable.");
    }

    this.keys = {
      a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      space: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      r: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      shift: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      c: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      tab: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB),
    };
    keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
  }

  private readInput(): MovementInput {
    if (!this.keys || this.isInputLockedByRoundPhase()) {
      // Lock during countdown / round-over / match-over: pin the player in
      // place so the banner reads cleanly and nobody can pre-fire shots
      // during the "3 / 2 / 1 / FIGHT" window.
      return {
        left: false,
        right: false,
        jumpPressed: false,
        jumpHeld: false,
        jetpackHeld: false,
        fastFall: false,
        crouch: false,
      };
    }

    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.keys.w) || Phaser.Input.Keyboard.JustDown(this.keys.space);

    return {
      left: this.keys.a.isDown,
      right: this.keys.d.isDown,
      jumpPressed,
      jumpHeld: this.keys.w.isDown || this.keys.space.isDown,
      jetpackHeld: this.keys.space.isDown,
      fastFall: this.keys.s.isDown && !this.playerBody.grounded,
      crouch: this.keys.s.isDown,
    };
  }

  private isInputLockedByRoundPhase(): boolean {
    // "fighting" is the only phase where player input drives the sim. Both
    // the pre-round countdown and the post-round hold (also where the
    // results overlay sits, since round-over is a terminal park state when
    // the match has been decided) freeze the player.
    return this.roundState.phase !== "fighting";
  }

  private syncPlayerVisuals(deltaMs = 16) {
    if (!this.playerRig) {
      return;
    }

    if (this.playerRespawnPending) {
      this.playerRig.setVisible(false);
      this.shieldGraphics?.clear();
      return;
    }

    this.playerRig.setVisible(true);
    const bodyFeet = {
      x: this.playerBody.position.x,
      y: this.playerBody.position.y + this.playerBody.size.y / 2,
    };
    const aimTarget = this.getAimTarget();

    this.playerRig.update(deltaMs, {
      position: bodyFeet,
      velocity: this.playerBody.velocity,
      aimTarget,
      grounded: this.playerBody.grounded,
      crouching: this.playerBody.crouching,
      health: this.playerHealth,
      maxHealth: this.playerMaxHealth,
    });
    this.drawShield();
  }

  private playMovementSounds(wasGrounded: boolean) {
    if (wasGrounded && !this.playerBody.grounded && this.playerBody.velocity.y < 0) {
      this.audio?.play("jump");
    } else if (!wasGrounded && this.playerBody.grounded) {
      this.audio?.play("land");
    }
  }

  private updateShield(deltaMs: number) {
    if (!this.keys) {
      return;
    }

    this.temporaryShieldMs = Math.max(0, this.temporaryShieldMs - deltaMs);
    const canShield = this.getLocalCharacter().abilityType === "shield" || this.temporaryShieldMs > 0;
    this.shieldActive = canShield && this.blockJammerMs <= 0 && this.keys.shift.isDown && this.shieldCharge > 0;

    if (this.shieldActive) {
      this.shieldCharge = Math.max(0, this.shieldCharge - deltaMs * 0.036);
      if (this.shieldCharge <= 0) {
        this.shieldActive = false;
      }
      return;
    }

    this.shieldCharge = Math.min(100, this.shieldCharge + deltaMs * 0.014);
  }

  private updateParry(deltaMs: number) {
    if (!this.keys) {
      return;
    }

    this.parryActiveMs = Math.max(0, this.parryActiveMs - deltaMs);
    this.parryCooldownMs = Math.max(0, this.parryCooldownMs - deltaMs);
    const rightMouseDown = this.input.activePointer.rightButtonDown();
    const rightMousePressed = rightMouseDown && !this.rightMouseParryWasDown;
    this.rightMouseParryWasDown = rightMouseDown;

    if (
      (rightMousePressed || Phaser.Input.Keyboard.JustDown(this.keys.c)) &&
      this.blockJammerMs <= 0 &&
      this.parryCooldownMs <= 0 &&
      !this.isInputLockedByRoundPhase()
    ) {
      this.parryActiveMs = PARRY_ACTIVE_MS;
      this.parryCooldownMs = this.getParryCooldownMs();
      this.audio?.play("hit");
    }
  }

  private drawShield() {
    if (!this.shieldGraphics) {
      return;
    }

    this.shieldGraphics.clear();

    if (this.shieldActive) {
      const radius = Math.max(this.playerBody.size.x, this.playerBody.size.y) * 0.82;
      this.shieldGraphics.fillStyle(0x93c5fd, 0.08);
      this.shieldGraphics.fillCircle(this.playerBody.position.x, this.playerBody.position.y, radius);
      this.shieldGraphics.lineStyle(2, 0x93c5fd, 0.62);
      this.shieldGraphics.strokeCircle(this.playerBody.position.x, this.playerBody.position.y, radius);
    }

    if (this.movementDebug.jetpackActive) {
      const plumeX = this.playerBody.position.x - this.playerBody.facing * 6;
      const plumeY = this.playerBody.position.y + this.playerBody.size.y / 2 - 4;
      this.shieldGraphics.fillStyle(0xffd166, 0.8);
      this.shieldGraphics.fillTriangle(
        plumeX - 7,
        plumeY,
        plumeX + 7,
        plumeY,
        plumeX,
        plumeY + 22,
      );
      this.shieldGraphics.fillStyle(0x67e8f9, 0.58);
      this.shieldGraphics.fillTriangle(
        plumeX - 4,
        plumeY,
        plumeX + 4,
        plumeY,
        plumeX,
        plumeY + 13,
      );
    }

    if (this.parryActiveMs <= 0) {
      return;
    }

    const aimAngle = this.getAimAngleFromPlayer();
    const arc = this.getParryArcRadians();
    const range = this.getParryRange();
    this.shieldGraphics.fillStyle(0xf7fbff, 0.13);
    this.shieldGraphics.slice(
      this.playerBody.position.x,
      this.playerBody.position.y,
      range,
      aimAngle - arc / 2,
      aimAngle + arc / 2,
      false,
    );
    this.shieldGraphics.fillPath();
    this.shieldGraphics.lineStyle(3, 0xf7fbff, 0.82);
    this.shieldGraphics.beginPath();
    this.shieldGraphics.arc(
      this.playerBody.position.x,
      this.playerBody.position.y,
      range,
      aimAngle - arc / 2,
      aimAngle + arc / 2,
      false,
    );
    this.shieldGraphics.strokePath();
  }

  private syncRemotePlayerVisuals(deltaMs = 16) {
    if (this.remoteRigs.size === 0) {
      return;
    }

    for (const [playerId, rig] of this.remoteRigs) {
      const playerIndex = this.getRoomPlayerIndex(playerId);
      const spawn = boxworksWorld.spawns[playerIndex % boxworksWorld.spawns.length] ?? { x: 0, y: 0 };
      const character = this.getCharacter(this.getRoomPlayer(playerId)?.characterId);
      const snapshot = this.remoteSnapshots.get(playerId);
      if (snapshot?.alive === false) {
        rig.setVisible(false);
        continue;
      }

      rig.setVisible(true);
      const targetPosition = snapshot?.position ?? spawn;
      const footPosition = {
        x: targetPosition.x,
        y: targetPosition.y + getPlayerBodySize(character.sizeScale).y / 2,
      };
      const aimTarget = {
        x: targetPosition.x + Math.cos(snapshot?.aimAngle ?? 0) * 120,
        y: targetPosition.y + Math.sin(snapshot?.aimAngle ?? 0) * 120,
      };
      const velocity = snapshot?.velocity ?? { x: 0, y: 0 };

      rig.update(deltaMs, {
        position: footPosition,
        velocity,
        aimTarget,
        grounded: true,
        crouching: snapshot?.crouching ?? false,
        health: snapshot?.health ?? character.maxHealth,
        maxHealth: Math.max(character.maxHealth, snapshot?.health ?? character.maxHealth),
      });
    }
  }

  private setupNetworkSync() {
    if (!this.roomId || !this.matchId) {
      return;
    }

    const convexUrl = import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL;
    if (!convexUrl) {
      return;
    }

    this.roomClient = new RoomClient(convexUrl);
    this.unsubscribeSnapshots = this.roomClient.subscribeMatchPlayerSnapshots(
      this.matchId,
      (snapshots) => this.applyRemoteSnapshots(snapshots),
      () => undefined,
    );
    this.sendPlayerSnapshot();
  }

  private getChaosProfile(): ChaosProfile {
    const modifiers = getChaosModifiers(this.chaosModifierIds);
    return {
      names: modifiers.map((modifier) => modifier.name),
      gravityMultiplier: modifiers.reduce((value, modifier) => value * modifier.gravityMultiplier, 1),
      timeScale: modifiers.reduce((value, modifier) => value * modifier.timeScale, 1),
      damageMultiplier: modifiers.reduce((value, modifier) => value * modifier.damageMultiplier, 1),
      fireRateMultiplier: modifiers.reduce((value, modifier) => value * modifier.fireRateMultiplier, 1),
      recoilMultiplier: modifiers.reduce((value, modifier) => value * modifier.recoilMultiplier, 1),
      disableProjectiles: modifiers.some((modifier) => modifier.disableProjectiles),
      randomProjectileShapes: modifiers.some((modifier) => modifier.randomProjectileShapes),
      fireHazardIntervalMs: modifiers.find((modifier) => modifier.fireHazardIntervalMs)?.fireHazardIntervalMs,
    };
  }

  private createChaosWeaponBuild(): ResolvedWeaponBuild {
    const chaos = this.getChaosProfile();
    const overcharged = false; // ROUNDS: Overcharge removed
    const damageBoost = 1; // ROUNDS: Damage amp and boss mode removed
    const fireRateBoost = 1; // ROUNDS: Boss mode removed
    const projectileSpeedBoost = this.slowDebuffMs > 0 ? 0.72 : 1;
    const build: ResolvedWeaponBuild = {
      ...this.weaponBuild,
      damage: this.weaponBuild.damage * chaos.damageMultiplier * (overcharged ? 1.25 : 1) * damageBoost,
      fireRate: Math.max(0.2, this.weaponBuild.fireRate * chaos.fireRateMultiplier * (overcharged ? 1.2 : 1) * fireRateBoost),
      recoilImpulse: this.weaponBuild.recoilImpulse * chaos.recoilMultiplier,
      projectileSpeed: this.weaponBuild.projectileSpeed * projectileSpeedBoost,
      projectile: { ...this.weaponBuild.projectile },
      cards: this.weaponBuild.cards,
      occupiedBuckets: this.weaponBuild.occupiedBuckets,
      maxHealthAdd: this.weaponBuild.maxHealthAdd,
      moveSpeedMultiplier: this.weaponBuild.moveSpeedMultiplier,
      parryCoverMultiplier: this.weaponBuild.parryCoverMultiplier,
      parryCooldownMultiplier: this.weaponBuild.parryCooldownMultiplier,
    };

    if (this.meleeModeMs > 0) {
      build.delivery = "projectile";
      build.damage *= 1.18;
      build.fireRate = Math.max(build.fireRate, 3.2);
      build.spreadRadians = Math.max(build.spreadRadians, Math.PI * 0.58);
      build.projectile = {
        ...build.projectile,
        count: Math.max(build.projectile.count, 7),
        rangePx: Math.min(build.projectile.rangePx, 240),
        impact: build.projectile.impact === "none" ? "explosive" : build.projectile.impact,
        impactRadiusPx: Math.max(build.projectile.impactRadiusPx, 28),
        sizeMultiplier: Math.max(build.projectile.sizeMultiplier, 0.76),
      };
    }

    if (chaos.randomProjectileShapes) {
      build.projectile.shape = Phaser.Utils.Array.GetRandom(projectileShapes);
    }

    return build;
  }

  private updateChaosHazards(deltaMs: number) {
    const intervalMs = this.getChaosProfile().fireHazardIntervalMs;
    if (!intervalMs) {
      return;
    }

    this.fireHazardTimerMs += deltaMs;
    if (this.fireHazardTimerMs < intervalMs) {
      return;
    }

    this.fireHazardTimerMs = 0;
    const timeSeconds = this.time.now / 1000;
    this.spawnFirePatch({
      x: 80 + seededUnit(Math.floor(timeSeconds), 0, 300) * (boxworksWorld.size.x - 160),
      y: 160 + seededUnit(Math.floor(timeSeconds), 1, 301) * (boxworksWorld.size.y - 250),
    }, 36 + seededUnit(Math.floor(timeSeconds), 2, 302) * 26);
  }

  private updateNetworkSync(deltaMs: number) {
    if (!this.roomClient || !this.roomId || !this.matchId) {
      return;
    }

    this.snapshotSendTimerMs += deltaMs;
    if (this.snapshotSendTimerMs < SNAPSHOT_SEND_INTERVAL_MS) {
      return;
    }

    this.snapshotSendTimerMs = 0;
    this.sendPlayerSnapshot();
  }

  private sendPlayerSnapshot() {
    if (!this.roomClient || !this.roomId || !this.matchId) {
      return;
    }

    const aimTarget = this.getAimTarget();
    const origin = this.getMuzzlePosition();
    const aimAngle = Math.atan2(aimTarget.y - origin.y, aimTarget.x - origin.x);
    this.snapshotSequence += 1;

    void this.roomClient.submitPlayerSnapshot({
      matchId: this.matchId,
      roomId: this.roomId,
      playerId: this.localPlayerId,
      position: { ...this.playerBody.position },
      velocity: { ...this.playerBody.velocity },
      aimAngle,
      health: this.playerHealth,
      alive: this.playerHealth > 0 && !this.playerRespawnPending,
      crouching: this.playerBody.crouching,
      shieldActive: this.shieldActive,
      shieldCharge: this.shieldCharge,
      shotSequence: this.shotSequence,
      sequence: this.snapshotSequence,
    }).catch(() => undefined);
  }

  private applyRemoteSnapshots(snapshots: MatchPlayerSnapshot[]) {
    for (const snapshot of snapshots) {
      if (snapshot.playerId === this.localPlayerId) {
        this.reconcileLocalSnapshot(snapshot);
        continue;
      }

      this.ensureScore(snapshot.playerId);
      const previous = this.remoteSnapshots.get(snapshot.playerId);
      this.spawnRemoteProjectileBursts(snapshot, previous);
      this.remoteSnapshots.set(snapshot.playerId, previous
        ? smoothSnapshot(previous, snapshot)
        : snapshot);
    }

  }

  private spawnRemoteProjectileBursts(
    snapshot: MatchPlayerSnapshot,
    previous?: MatchPlayerSnapshot,
  ) {
    if (!this.projectileSystem || !snapshot.alive) {
      return;
    }

    const shotSequence = snapshot.shotSequence ?? 0;
    const previousSequence = this.remoteShotSequences.get(snapshot.playerId);
    if (previousSequence === undefined) {
      this.remoteShotSequences.set(snapshot.playerId, shotSequence);
      return;
    }

    if (shotSequence <= previousSequence) {
      return;
    }

    this.remoteShotSequences.set(snapshot.playerId, shotSequence);
    const burstCount = Math.min(3, shotSequence - previousSequence);
    const build = createWeaponBuild(starterWeapon, []);
    const origin = this.getRemoteMuzzlePosition(previous ?? snapshot, snapshot);

    for (let index = 0; index < burstCount; index += 1) {
      const aimJitter = burstCount > 1 ? (index - (burstCount - 1) / 2) * 0.035 : 0;
      this.projectileSystem.fire(origin, snapshot.aimAngle + aimJitter, build, [], true);
    }
  }

  private getRemoteMuzzlePosition(
    previous: MatchPlayerSnapshot,
    snapshot: MatchPlayerSnapshot,
  ): Vec2 {
    const character = this.getCharacter(this.getRoomPlayer(snapshot.playerId)?.characterId);
    const bodySize = getPlayerBodySize(character.sizeScale);
    const visualScale = this.getVisualScale(character);
    const position = previous
      ? lerpVec(previous.position, snapshot.position, 0.65)
      : snapshot.position;
    const crouchAmount = snapshot.crouching ? 1 : 0;
    const feetY = position.y + bodySize.y / 2;
    const chest = {
      x: position.x,
      y: feetY -
        Phaser.Math.Linear(STANDING_CHEST_OFFSET, CROUCHING_CHEST_OFFSET, crouchAmount) *
          visualScale,
    };
    const muzzleReach = MUZZLE_REACH * visualScale;

    return {
      x: chest.x + Math.cos(snapshot.aimAngle) * muzzleReach,
      y: chest.y + Math.sin(snapshot.aimAngle) * muzzleReach,
    };
  }

  private reconcileLocalSnapshot(snapshot: MatchPlayerSnapshot) {
    if (snapshot.sequence <= this.ignoreLocalSnapshotsThroughSequence) {
      return;
    }

    if (this.playerRespawnPending) {
      return;
    }

    if (snapshot.health < this.playerHealth && this.blockJammerMs <= 0 && this.parryActiveMs > 0) {
      this.lastPickupStatus = "parried remote";
      this.audio?.play("hit");
      return;
    }

    if (snapshot.health < this.playerHealth) {
      this.playerHealth = Math.max(0, snapshot.health);
      this.audio?.play("hit");
    }

    if (snapshot.shieldCharge !== undefined && snapshot.shieldCharge < this.shieldCharge) {
      this.shieldCharge = Math.max(0, snapshot.shieldCharge);
    }

    if (!snapshot.alive || this.playerHealth <= 0) {
      this.playerHealth = 0;
      this.killPlayer();
    }
  }

  private tryFireWeapon() {
    if (!this.projectileSystem || this.fireCooldownMs > 0 || this.playerRespawnPending) {
      return;
    }

    if (this.isInputLockedByRoundPhase()) {
      return;
    }

    const pointer = this.input.activePointer;
    if (!pointer.isDown || pointer.rightButtonDown()) {
      return;
    }

    const origin = this.getMuzzlePosition();
    const aimTarget = this.getAimTarget();
    const pointerAimAngle = Math.atan2(aimTarget.y - origin.y, aimTarget.x - origin.x);
    const aimAngle = pointerAimAngle; // ROUNDS: Boss pattern removed
    const chaos = this.getChaosProfile();
    const build = this.createChaosWeaponBuild();
    const result = chaos.disableProjectiles
      ? { fired: true, hits: [] }
      : this.projectileSystem.fire(
          origin,
          aimAngle,
          build,
          this.getProjectileTargets(),
        );

    if (!result.fired) {
      return;
    }

    this.audio?.play("shoot");
    this.shotSequence += 1;
    this.sendPlayerSnapshot();
    this.fireCooldownMs = this.getShotCooldownMs(build);
    const recoil =
      (build.recoilImpulse * build.projectile.recoilMultiplier) /
      this.getLocalCharacter().recoilControlMultiplier;
    this.playerBody.velocity.x -= Math.cos(aimAngle) * recoil;
    this.playerBody.velocity.y -= Math.sin(aimAngle) * recoil * 0.45;
    this.applyProjectileHits(result.hits);
  }


  private getShotCooldownMs(build: ResolvedWeaponBuild): number {
    const base = 1000 / build.fireRate;
    const projectileTax = Math.max(0, build.projectile.count - 1) * 0.16;
    const splitTax = build.projectile.splitCount * 0.06;
    const bounceTax = Math.max(0, build.projectile.bounces) * 0.035;
    const areaTax = Math.min(0.4, build.projectile.impactRadiusPx / 280);
    const homingTax = build.projectile.pathing === "homing" ? 0.24 : 0;
    const beamTax = build.delivery === "raycast" || build.delivery === "continuous-beam" ? 0.18 : 0;
    return base * (1 + projectileTax + splitTax + bounceTax + areaTax + homingTax + beamTax);
  }

  private getAimTarget(): Vec2 {
    const pointer = this.input.activePointer;
    const pointerIsInsideArena =
      Number.isFinite(pointer.x) &&
      Number.isFinite(pointer.y) &&
      pointer.x > 8 &&
      pointer.y > 8 &&
      pointer.x < this.scale.width - 8 &&
      pointer.y < this.scale.height - 8;

    if (pointerIsInsideArena) {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      return { x: worldPoint.x, y: worldPoint.y };
    }

    return {
      x: this.playerBody.position.x + this.playerBody.facing * 160,
      y: this.playerBody.position.y - 10,
    };
  }

  private getAimAngleFromPlayer(): number {
    const aimTarget = this.getAimTarget();
    return Math.atan2(
      aimTarget.y - this.playerBody.position.y,
      aimTarget.x - this.playerBody.position.x,
    );
  }

  private getParryArcRadians(): number {
    return Math.min(Math.PI * 1.55, PARRY_BASE_ARC_RADIANS * this.weaponBuild.parryCoverMultiplier);
  }

  private getParryRange(): number {
    return PARRY_BASE_RANGE * Math.sqrt(this.weaponBuild.parryCoverMultiplier);
  }

  private getParryCooldownMs(): number {
    return PARRY_COOLDOWN_MS * this.weaponBuild.parryCooldownMultiplier;
  }

  private getMoveSpeedModifier(): number {
    let multiplier = this.weaponBuild.moveSpeedMultiplier;
    // ROUNDS: Speed boost pickup removed
    if (this.slowDebuffMs > 0) {
      multiplier *= SLOW_DEBUFF_MULTIPLIER;
    }
    // ROUNDS: Boss mode removed
    return multiplier;
  }

  private getMuzzlePosition(): Vec2 {
    const aimTarget = this.getAimTarget();
    const chest = this.getChestPosition();
    const aimAngle = Math.atan2(aimTarget.y - chest.y, aimTarget.x - chest.x);
    const muzzleReach = MUZZLE_REACH * this.getVisualScale(this.getLocalCharacter());

    return {
      x: chest.x + Math.cos(aimAngle) * muzzleReach,
      y: chest.y + Math.sin(aimAngle) * muzzleReach,
    };
  }

  private getChestPosition(): Vec2 {
    const crouchAmount = this.playerBody.crouching ? 1 : 0;
    const feetY = this.playerBody.position.y + this.playerBody.size.y / 2;
    const visualScale = this.getVisualScale(this.getLocalCharacter());

    return {
      x: this.playerBody.position.x,
      y: feetY -
        Phaser.Math.Linear(STANDING_CHEST_OFFSET, CROUCHING_CHEST_OFFSET, crouchAmount) *
          visualScale,
    };
  }

  private applyProjectileHits(hits: ProjectileHit[]) {
    for (const hit of hits) {
      if (hit.targetId === this.target.id) {
        this.audio?.play("hit");
        this.damageTarget(hit.damage, hit);
        this.applyImpactArea(hit);
        continue;
      }

      const destructible = this.destructibles.find((object) => object.id === hit.targetId);
      if (destructible) {
        this.audio?.play("hit");
        this.damageDestructible(destructible, hit.damage, hit);
        this.applyImpactArea(hit);
        continue;
      }

      const remotePlayerId = playerIdFromRemoteTargetId(hit.targetId);
      if (remotePlayerId) {
        this.audio?.play("hit");
        this.damageRemotePlayer(remotePlayerId, hit);
        this.applyImpactArea(hit);
      }
    }

    this.updateTargetVisuals();
    this.updateDestructibleVisuals();
  }

  private damageRemotePlayer(playerId: string, hit: ProjectileHit) {
    const snapshot = this.remoteSnapshots.get(playerId);
    if (!snapshot || !snapshot.alive) {
      return;
    }

    const nextSnapshot = applySnapshotDamage(snapshot, hit.damage);
    this.remoteSnapshots.set(playerId, nextSnapshot);
    this.floatRemoteDamageText(nextSnapshot.position, hit.damage, hit.element);

    if (!nextSnapshot.alive) {
      this.addKill(this.localPlayerId);
      this.addDeath(playerId);
      this.spawnPlayerDeathExplosion(nextSnapshot.position);
    }

    if (!this.roomClient || !this.roomId || !this.matchId) {
      return;
    }

    void this.roomClient.applyPlayerDamage({
      matchId: this.matchId,
      roomId: this.roomId,
      attackerPlayerId: this.localPlayerId,
      targetPlayerId: playerId,
      damage: hit.damage,
    }).catch(() => undefined);
  }

  private floatRemoteDamageText(position: Vec2, amount: number, element: ElementType) {
    const color = element === "fire" ? "#ffb86b" : "#f0abfc";
    const text = this.add
      .text(position.x, position.y - 34, Math.round(amount).toString(), {
        color,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "13px",
        fontStyle: "900",
      })
      .setOrigin(0.5, 0.5);

    this.tweens.add({
      targets: text,
      y: text.y - 28,
      alpha: 0,
      duration: 360,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private damageTarget(amount: number, hit: ProjectileHit) {
    if (!this.target.alive) {
      return;
    }

    this.target.health = Math.max(0, this.target.health - amount);
    this.flashTarget(hit);

    if (this.target.health <= 0) {
      this.killTarget(hit);
    }
  }

  private damagePlayer(amount: number, sourcePosition?: Vec2) {
    if (amount <= 0 || this.playerHealth <= 0 || this.playerRespawnPending) {
      return;
    }

    if (this.blockJammerMs <= 0 && this.parryActiveMs > 0 && this.isParryCovering(sourcePosition)) {
      this.parryActiveMs = Math.max(this.parryActiveMs, 120);
      this.lastPickupStatus = "parried";
      this.audio?.play("hit");
      return;
    }

    if (this.shieldActive) {
      this.shieldCharge = Math.max(0, this.shieldCharge - amount * 1.8);
      this.audio?.play("hit");
      if (this.shieldCharge <= 0) {
        this.shieldActive = false;
      }
      return;
    }

    const modifiedAmount = amount *
      (this.vulnerabilityMs > 0 ? VULNERABILITY_MULTIPLIER : 1);
    this.playerHealth = Math.max(0, this.playerHealth - modifiedAmount);
    this.audio?.play("hit");
    this.spawnDamageNumber(this.playerBody.position, modifiedAmount, true);
    if (this.playerHealth <= 0) {
      this.killPlayer();
    }
  }

  private spawnDamageNumber(position: Vec2, amount: number, isLocal: boolean): void {
    if (amount < 1) return;
    const spread = (Math.random() - 0.5) * 22;
    const text = this.add
      .text(position.x + spread, position.y - 32, Math.round(amount).toString(), {
        color: isLocal ? "#fb7185" : "#fff7d6",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: amount >= 30 ? "18px" : "14px",
        fontStyle: "900",
        stroke: "#05080f",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(800);
    this.tweens.add({
      targets: text,
      y: text.y - 28,
      alpha: 0,
      duration: 560,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private isParryCovering(sourcePosition?: Vec2): boolean {
    if (!sourcePosition) {
      return true;
    }

    const distanceToSource = distance(sourcePosition, this.playerBody.position);
    if (distanceToSource > this.getParryRange() + Math.max(this.playerBody.size.x, this.playerBody.size.y)) {
      return false;
    }

    const sourceAngle = Math.atan2(
      sourcePosition.y - this.playerBody.position.y,
      sourcePosition.x - this.playerBody.position.x,
    );
    const aimAngle = this.getAimAngleFromPlayer();
    return Math.abs(Phaser.Math.Angle.Wrap(sourceAngle - aimAngle)) <= this.getParryArcRadians() / 2;
  }

  private killPlayer() {
    if (this.playerRespawnPending) {
      return;
    }

    const deathSequence = this.deathSequenceId + 1;
    this.deathSequenceId = deathSequence;
    this.clearRespawnText();
    this.playerRespawnPending = true;
    this.respawnRemainingMs = RESPAWN_COUNTDOWN_MS;
    this.respawnCountdownActive = false;
    this.playerHealth = 0;
    this.addDeath(this.localPlayerId);
    this.playerBody.velocity = { x: 0, y: 0 };
    this.shieldActive = false;
    this.clearTemporaryCombatEffects();
    this.shieldGraphics?.clear();
    this.playerRig?.setVisible(false);
    // Cards persist across deaths; the next life starts with the existing
    // build PLUS whichever draft card the player picks below.
    this.audio?.play("explosion");
    this.spawnPlayerDeathExplosion(this.playerBody.position);
    this.time.delayedCall(DEATH_POPUP_DELAY_MS, () => {
      if (this.deathSequenceId !== deathSequence || !this.playerRespawnPending) {
        return;
      }
      // ROUNDS: Death-draft removed. Player drafts between rounds instead.
      // Auto-respawn via the round state machine (resetTarget + respawnPlayer
      // fire when round-over → countdown transition completes).
      this.showDeathPopup();
      this.respawnCountdownActive = true;
      this.respawnRemainingMs = RESPAWN_COUNTDOWN_MS;
    });
  }

  private spawnPlayerDeathExplosion(position: Vec2) {
    const blast = this.add.circle(position.x, position.y, 10, 0xf7fbff, 0.52);
    blast.setStrokeStyle(4, 0xfb7185, 0.95);
    this.tweens.add({
      targets: blast,
      radius: 118,
      alpha: 0,
      duration: 520,
      ease: "Sine.easeOut",
      onComplete: () => blast.destroy(),
    });

    for (let index = 0; index < 18; index += 1) {
      const angle = (Math.PI * 2 * index) / 18;
      const shard = this.add.rectangle(position.x, position.y, 5, 14, index % 2 === 0 ? 0x50e3c2 : 0xf0abfc, 0.92);
      shard.rotation = angle;
      this.tweens.add({
        targets: shard,
        x: position.x + Math.cos(angle) * 82,
        y: position.y + Math.sin(angle) * 82,
        alpha: 0,
        duration: 500,
        ease: "Sine.easeOut",
        onComplete: () => shard.destroy(),
      });
    }
  }

  private spawnRespawnBurst(position: Vec2) {
    const ring = this.add.circle(position.x, position.y, 8, 0x50e3c2, 0.18);
    ring.setStrokeStyle(3, 0x50e3c2, 0.82);
    this.tweens.add({
      targets: ring,
      radius: 54,
      alpha: 0,
      duration: 360,
      ease: "Sine.easeOut",
      onComplete: () => ring.destroy(),
    });
  }

  private showDeathPopup() {
    this.clearRespawnText();
    const sec = Math.ceil(this.respawnRemainingMs / 1000);
    if (this.deathOverlay) {
      this.deathOverlay.show(sec);
    }
  }

  private updateRespawnCountdown(deltaMs: number) {
    if (!this.playerRespawnPending || !this.respawnCountdownActive) {
      return;
    }

    this.respawnRemainingMs = Math.max(0, this.respawnRemainingMs - deltaMs);
    this.updateRespawnText();
  }

  private updateRespawnText() {
    const sec = Math.ceil(this.respawnRemainingMs / 1000);
    if (this.deathOverlay?.isOpen()) {
      this.deathOverlay.updateTimer(sec);
    }
    // Legacy text fallback (destroyed path)
    if (!this.respawnText) {
      return;
    }
    this.respawnText.setText(this.getRespawnMessage());
  }

  private getRespawnMessage(): string {
    const seconds = Math.ceil(this.respawnRemainingMs / 1000);
    return `RESPAWN ${seconds}`;
  }

  private clearRespawnText() {
    this.respawnText?.destroy();
    this.respawnText = undefined;
    this.deathOverlay?.hide();
  }

  // ── HUD system update ─────────────────────────────────────────────────────

  private updateHudSystem(): void {
    if (!this.hudSystem) return;

    const chips = this.buildHudChips();
    const cardNames = this.progressionCardIds
      .map((id) => this.crystalCardsById(id))
      .filter((n): n is string => n !== undefined);

    const vitals: import("../ui/HudSystem").HudVitals = {
      health: this.playerHealth,
      maxHealth: this.playerMaxHealth,
      shieldCharge: this.shieldCharge,
      shieldMaxCharge: 100,
      jetpackFuel: this.movementDebug.jetpackFuel < 100 || this.movementDebug.jetpackActive
        ? this.movementDebug.jetpackFuel
        : undefined,
      chips,
      cardNames,
      isDead: this.playerRespawnPending,
    };

    const scores: Record<string, number> = {};
    for (const [pid, score] of this.playerScores) {
      scores[pid] = score.kills;
    }

    const round: import("../ui/HudSystem").HudRound = {
      phase: this.roundState.phase,
      countdownRemainingMs: this.roundState.countdownRemainingMs,
      roundIndex: this.roundState.roundIndex,
      scores,
      winnerLabel: this.roundState.phase === "round-over"
        ? this.getRoundWinnerLabel(this.roundState.winnerPlayerId)
        : undefined,
    };

    this.hudSystem.update(vitals, round);
  }

  private updateRoundBannerSystem(): void {
    if (!this.roundBannerSystem) return;
    const winnerLabel = this.roundState.phase === "round-over"
      ? this.getRoundWinnerLabel(this.roundState.winnerPlayerId)
      : undefined;
    this.roundBannerSystem.update({
      phase: this.roundState.phase,
      countdownRemainingMs: this.roundState.countdownRemainingMs,
      roundIndex: this.roundState.roundIndex,
      winnerLabel,
    });
  }

  private buildHudChips(): HudChip[] {
    const chips: HudChip[] = [];
    const now = performance.now(); // approximate — just for remaining calc
    // Buffs
    if (this.overchargeMs > 0) chips.push({ label: "OVERCHARGE", color: 0xfde68a, remainingSec: this.overchargeMs / 1000, isDebuff: false });
    if (this.damageAmpMs > 0) chips.push({ label: "DMG AMP", color: 0xfb923c, remainingSec: this.damageAmpMs / 1000, isDebuff: false });
    if (this.speedBoostMs > 0) chips.push({ label: "SPEED", color: 0x67e8f9, remainingSec: this.speedBoostMs / 1000, isDebuff: false });
    if (this.meleeModeMs > 0) chips.push({ label: "MELEE", color: 0xf0abfc, remainingSec: this.meleeModeMs / 1000, isDebuff: false });
    // Debuffs
    if (this.slowDebuffMs > 0) chips.push({ label: "SLOW", color: 0x93c5fd, remainingSec: this.slowDebuffMs / 1000, isDebuff: true });
    if (this.vulnerabilityMs > 0) chips.push({ label: "VULN", color: 0xfb7185, remainingSec: this.vulnerabilityMs / 1000, isDebuff: true });
    if (this.blockJammerMs > 0) chips.push({ label: "JAMMER", color: 0x9aa5b1, remainingSec: this.blockJammerMs / 1000, isDebuff: true });
    void now; // suppress unused
    return chips;
  }

  private crystalCardsById(id: string): string | undefined {
    return crystalRoundsCards.find((c) => c.id === id)?.name;
  }

  private respawnPlayer() {
    this.clearRespawnText();
    this.resetPlayer();
    this.sendPlayerSnapshot();
    this.ignoreLocalSnapshotsThroughSequence = this.snapshotSequence;
    this.spawnRespawnBurst(this.playerBody.position);
  }

  private damageDestructible(
    object: ArenaDestructible,
    amount: number,
    hit: ProjectileHit | HazardHit,
  ) {
    if (!object.alive) {
      return;
    }

    object.health = Math.max(0, object.health - amount);

    if (object.flammable && hit.element === "fire") {
      object.burnMs = Math.max(object.burnMs, 900);
      this.spawnFirePatch(hit.position, object.kind === "barrel" ? 54 : 42);
    }

    this.flashDestructible(object, amount, hit.element);

    if (object.health <= 0) {
      this.destroyDestructible(object, hit);
    }
  }

  private destroyDestructible(object: ArenaDestructible, hit: ProjectileHit | HazardHit) {
    if (!object.alive) {
      return;
    }

    object.alive = false;
    this.destructibleBurst(object, hit.element);

    if (object.explosive) {
      const radius = object.kind === "mine" ? 82 : 104;
      this.spawnExplosion(object.position, radius, object.kind === "mine" ? 34 : 46, hit.element);
    }

    if (object.flammable) {
      this.spawnFirePatch(object.position, object.kind === "barrel" ? 72 : 48);
    }
  }

  private applyImpactArea(hit: ProjectileHit) {
    const shouldBurn = hit.element === "fire";
    const shouldExplode = hit.impact === "explosive" || hit.impact === "sticky";
    const radius = Math.max(hit.impactRadiusPx, shouldExplode ? 58 : 0, shouldBurn ? 42 : 0);

    if (shouldBurn) {
      this.spawnFirePatch(hit.position, Math.max(38, radius));
    }

    if (radius <= 0) {
      return;
    }

    const damage = shouldExplode ? hit.damage * 0.72 : hit.damage * 0.35;
    this.applyAreaDamage(hit.position, radius, damage, hit.element, hit.targetId);
  }

  private spawnExplosion(position: Vec2, radius: number, damage: number, element: ElementType) {
    this.audio?.play("explosion");
    const blast = this.add.circle(position.x, position.y, 6, 0xffd166, 0.36);
    blast.setStrokeStyle(3, 0xfb7185, 0.95);
    this.tweens.add({
      targets: blast,
      radius,
      alpha: 0,
      duration: 260,
      ease: "Sine.easeOut",
      onComplete: () => blast.destroy(),
    });

    this.applyAreaDamage(position, radius, damage, element);
  }

  private applyAreaDamage(
    position: Vec2,
    radius: number,
    damage: number,
    element: ElementType,
    excludedId?: string,
  ) {
    const hazardHit: HazardHit = {
      position,
      element,
      impactRadiusPx: radius,
    };

    if (this.target.alive && this.target.id !== excludedId) {
      const targetRadius = Math.max(this.target.size.x, this.target.size.y) / 2;
      if (distance(position, this.target.position) <= radius + targetRadius) {
        this.damageTarget(damage, {
          ...hazardHit,
          targetId: this.target.id,
          damage,
          knockback: 0,
          impact: "explosive",
        });
      }
    }

    const playerRadius = Math.max(this.playerBody.size.x, this.playerBody.size.y) / 2;
    if (distance(position, this.playerBody.position) <= radius + playerRadius) {
      this.damagePlayer(damage, position);
    }

    for (const object of this.destructibles) {
      if (!object.alive || object.id === excludedId) {
        continue;
      }

      const objectRadius = Math.max(object.size.x, object.size.y) / 2;
      if (distance(position, object.position) <= radius + objectRadius) {
        this.damageDestructible(object, damage, hazardHit);
      }
    }

    for (const [playerId, snapshot] of this.remoteSnapshots) {
      if (!snapshot.alive || remotePlayerTargetId(playerId) === excludedId) {
        continue;
      }

      const character = this.getCharacter(this.getRoomPlayer(playerId)?.characterId);
      const remoteRadius = Math.max(getPlayerBodySize(character.sizeScale).x, getPlayerBodySize(character.sizeScale).y) / 2;
      if (distance(position, snapshot.position) <= radius + remoteRadius) {
        this.damageRemotePlayer(playerId, {
          targetId: remotePlayerTargetId(playerId),
          damage,
          knockback: 0,
          position: { ...snapshot.position },
          element,
          impact: "explosive",
          impactRadiusPx: radius,
        });
      }
    }
  }

  private spawnFirePatch(position: Vec2, radius: number) {
    this.audio?.play("fire");
    this.firePatches.push({
      id: this.nextFirePatchId,
      position: { ...position },
      radius,
      ttlMs: 3000,
      dps: 13,
    });
    this.nextFirePatchId += 1;
    this.updateFireVisuals();
  }

  private updateFirePatches(deltaMs: number) {
    if (this.firePatches.length === 0) {
      return;
    }

    const deltaSeconds = deltaMs / 1000;
    for (const patch of this.firePatches) {
      patch.ttlMs -= deltaMs;
      const hazardHit: HazardHit = {
        position: patch.position,
        element: "fire",
        impactRadiusPx: patch.radius,
      };

      if (this.target.alive && distance(patch.position, this.target.position) <= patch.radius + 24) {
        this.target.health = Math.max(0, this.target.health - patch.dps * deltaSeconds);
        if (this.target.health <= 0) {
          this.killTarget({
            ...hazardHit,
            targetId: this.target.id,
            damage: patch.dps,
            knockback: 0,
            impact: "explosive",
          });
        }
      }

      const playerRadius = Math.max(this.playerBody.size.x, this.playerBody.size.y) / 2;
      if (distance(patch.position, this.playerBody.position) <= patch.radius + playerRadius) {
        this.damagePlayer(patch.dps * deltaSeconds, patch.position);
      }

      for (const object of this.destructibles) {
        if (!object.alive || !object.flammable) {
          continue;
        }

        const objectRadius = Math.max(object.size.x, object.size.y) / 2;
        if (distance(patch.position, object.position) <= patch.radius + objectRadius) {
          object.burnMs = Math.max(object.burnMs, 600);
          object.health = Math.max(0, object.health - patch.dps * 1.25 * deltaSeconds);
          if (object.health <= 0) {
            this.destroyDestructible(object, hazardHit);
          }
        }
      }
    }

    this.firePatches = this.firePatches.filter((patch) => patch.ttlMs > 0);
    for (const object of this.destructibles) {
      object.burnMs = Math.max(0, object.burnMs - deltaMs);
    }

    this.updateTargetVisuals();
    this.updateDestructibleVisuals();
    this.updateFireVisuals();
  }

  private flashDestructible(object: ArenaDestructible, amount: number, element: ElementType) {
    const color = element === "fire" ? "#ffb86b" : "#f7fbff";
    const text = this.add
      .text(object.position.x, object.position.y - object.size.y / 2 - 10, Math.round(amount).toString(), {
        color,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "11px",
        fontStyle: "900",
      })
      .setOrigin(0.5, 0.5);

    this.tweens.add({
      targets: text,
      y: text.y - 22,
      alpha: 0,
      duration: 280,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private destructibleBurst(object: ArenaDestructible, element: ElementType) {
    const color = element === "fire" ? 0xff7a18 : destructibleColor(object.kind);
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI * 2 * index) / 8;
      const shard = this.add.rectangle(object.position.x, object.position.y, 4, 9, color, 0.86);
      shard.rotation = angle;
      this.tweens.add({
        targets: shard,
        x: object.position.x + Math.cos(angle) * 38,
        y: object.position.y + Math.sin(angle) * 28,
        alpha: 0,
        duration: 260,
        ease: "Sine.easeOut",
        onComplete: () => shard.destroy(),
      });
    }
  }

  private flashTarget(hit: ProjectileHit) {
    const color = hit.element === "fire"
      ? "#ffb86b"
      : hit.element === "ice"
        ? "#bfdbfe"
        : hit.element === "radiant"
          ? "#fff7d6"
          : "#50e3c2";
    const text = this.add
      .text(hit.position.x, hit.position.y - 24, Math.round(hit.damage).toString(), {
        color,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "13px",
        fontStyle: "900",
      })
      .setOrigin(0.5, 0.5);

    this.tweens.add({
      targets: text,
      y: hit.position.y - 52,
      alpha: 0,
      duration: 380,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private killTarget(hit: ProjectileHit) {
    this.target.alive = false;
    this.target.respawnMs = 900;
    this.targetKills += 1;
    const burst = this.add.circle(this.target.position.x, this.target.position.y, 8, 0xf7fbff, 0.5);
    burst.setStrokeStyle(3, 0x50e3c2, 0.9);
    this.tweens.add({
      targets: burst,
      radius: Math.max(90, hit.impactRadiusPx),
      alpha: 0,
      duration: 420,
      ease: "Sine.easeOut",
      onComplete: () => burst.destroy(),
    });
  }

  private updateTarget(deltaMs: number) {
    if (this.target.alive) {
      return;
    }

    this.target.respawnMs -= deltaMs;
    if (this.target.respawnMs <= 0) {
      this.resetTarget();
    }
  }

  private resetTarget() {
    this.target = createTestTarget();
    this.updateTargetVisuals();
  }

  private updateTargetVisuals() {
    if (!this.targetGraphics || !this.targetText) {
      return;
    }

    const graphics = this.targetGraphics;
    graphics.clear();
    this.targetText.setVisible(this.target.alive);

    if (!this.target.alive) {
      return;
    }

    const { position, size, health, maxHealth } = this.target;
    graphics.fillStyle(0x07101c, 0.75);
    graphics.fillRoundedRect(
      position.x - size.x / 2 - 6,
      position.y - size.y / 2 - 6,
      size.x + 12,
      size.y + 12,
      4,
    );

    graphics.fillStyle(0xa78bfa, 0.82);
    graphics.beginPath();
    graphics.moveTo(position.x, position.y - size.y / 2);
    graphics.lineTo(position.x + size.x / 2, position.y);
    graphics.lineTo(position.x, position.y + size.y / 2);
    graphics.closePath();
    graphics.fillPath();

    graphics.fillStyle(0x50e3c2, 0.82);
    graphics.beginPath();
    graphics.moveTo(position.x, position.y - size.y / 2);
    graphics.lineTo(position.x - size.x / 2, position.y);
    graphics.lineTo(position.x, position.y + size.y / 2);
    graphics.closePath();
    graphics.fillPath();

    graphics.lineStyle(2, 0xf7fbff, 0.7);
    graphics.strokeRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y);

    const barWidth = 58;
    const barX = position.x - barWidth / 2;
    const barY = position.y - size.y / 2 - 18;
    graphics.fillStyle(0x1f2937, 1);
    graphics.fillRect(barX, barY, barWidth, 5);
    graphics.fillStyle(0xb8f05a, 1);
    graphics.fillRect(barX, barY, barWidth * (health / maxHealth), 5);

    this.targetText.setText(`CRYSTAL DUMMY x${this.targetKills}`);
    this.targetText.setPosition(position.x, position.y - size.y / 2 - 20);
  }

  private updateDestructibleVisuals() {
    if (!this.destructibleGraphics) {
      return;
    }

    const graphics = this.destructibleGraphics;
    graphics.clear();

    for (const object of this.destructibles) {
      if (!object.alive) {
        continue;
      }

      const { position, size } = object;
      const healthRatio = object.health / object.maxHealth;
      const color = object.burnMs > 0 ? 0xff7a18 : destructibleColor(object.kind);

      graphics.fillStyle(0x07101c, 0.45);
      graphics.fillRoundedRect(
        position.x - size.x / 2 - 3,
        position.y - size.y / 2 - 3,
        size.x + 6,
        size.y + 6,
        3,
      );

      graphics.fillStyle(color, object.kind === "mine" ? 0.92 : 0.84);
      if (object.kind === "barrel") {
        graphics.fillRoundedRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y, 7);
        graphics.lineStyle(2, 0xf7fbff, 0.35);
        graphics.beginPath();
        graphics.moveTo(position.x - size.x / 2 + 3, position.y - 5);
        graphics.lineTo(position.x + size.x / 2 - 3, position.y - 5);
        graphics.moveTo(position.x - size.x / 2 + 3, position.y + 8);
        graphics.lineTo(position.x + size.x / 2 - 3, position.y + 8);
        graphics.strokePath();
      } else if (object.kind === "mine") {
        graphics.fillRoundedRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y, 2);
        graphics.fillStyle(0xfff7d6, 0.9);
        graphics.fillCircle(position.x, position.y - 2, 3);
      } else {
        graphics.fillRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y);
        if (object.kind === "box") {
          graphics.lineStyle(2, 0x513820, 0.45);
          graphics.strokeLineShape(new Phaser.Geom.Line(
            position.x - size.x / 2 + 4,
            position.y - size.y / 2 + 4,
            position.x + size.x / 2 - 4,
            position.y + size.y / 2 - 4,
          ));
          graphics.strokeLineShape(new Phaser.Geom.Line(
            position.x + size.x / 2 - 4,
            position.y - size.y / 2 + 4,
            position.x - size.x / 2 + 4,
            position.y + size.y / 2 - 4,
          ));
        }
      }

      graphics.lineStyle(1, 0xf7fbff, 0.5);
      graphics.strokeRect(position.x - size.x / 2, position.y - size.y / 2, size.x, size.y);

      if (healthRatio < 1) {
        const barWidth = Math.max(24, size.x + 8);
        graphics.fillStyle(0x1f2937, 0.9);
        graphics.fillRect(position.x - barWidth / 2, position.y - size.y / 2 - 10, barWidth, 4);
        graphics.fillStyle(healthRatio > 0.35 ? 0xb8f05a : 0xfb7185, 1);
        graphics.fillRect(position.x - barWidth / 2, position.y - size.y / 2 - 10, barWidth * healthRatio, 4);
      }
    }
  }

  private updateFireVisuals() {
    if (!this.fireGraphics) {
      return;
    }

    const graphics = this.fireGraphics;
    graphics.clear();

    for (const patch of this.firePatches) {
      const lifeRatio = Phaser.Math.Clamp(patch.ttlMs / 3000, 0, 1);
      graphics.fillStyle(0xff7a18, 0.18 * lifeRatio);
      graphics.fillCircle(patch.position.x, patch.position.y, patch.radius);
      graphics.lineStyle(2, 0xffd166, 0.45 * lifeRatio);
      graphics.strokeCircle(patch.position.x, patch.position.y, patch.radius * 0.72);

      for (let index = 0; index < 5; index += 1) {
        const angle = patch.id + index * 1.26 + this.time.now * 0.004;
        const flameRadius = patch.radius * (0.22 + index * 0.08);
        graphics.fillStyle(index % 2 === 0 ? 0xffd166 : 0xfb7185, 0.42 * lifeRatio);
        graphics.fillCircle(
          patch.position.x + Math.cos(angle) * flameRadius,
          patch.position.y + Math.sin(angle * 0.8) * flameRadius * 0.38,
          5 + index,
        );
      }
    }
  }

  private updatePickups(deltaMs: number) {
    this.overchargeMs = Math.max(0, this.overchargeMs - deltaMs);
    this.damageAmpMs = Math.max(0, this.damageAmpMs - deltaMs);
    this.speedBoostMs = Math.max(0, this.speedBoostMs - deltaMs);
    this.meleeModeMs = Math.max(0, this.meleeModeMs - deltaMs);
    this.slowDebuffMs = Math.max(0, this.slowDebuffMs - deltaMs);
    this.vulnerabilityMs = Math.max(0, this.vulnerabilityMs - deltaMs);
    this.blockJammerMs = Math.max(0, this.blockJammerMs - deltaMs);

    // ROUNDS: Card cache relocation removed - draft between rounds

    let changed = false;
    for (const pickup of this.pickups) {
      if (!pickup.available) {
        pickup.respawnRemainingMs = Math.max(0, pickup.respawnRemainingMs - deltaMs);
        if (pickup.respawnRemainingMs <= 0) {
          pickup.available = true;
          changed = true;
        }
        continue;
      }

      const playerRadius = Math.max(this.playerBody.size.x, this.playerBody.size.y) / 2;
      if (distance(pickup.position, this.playerBody.position) <= pickup.radius + playerRadius) {
        this.collectPickup(pickup);
        changed = true;
      }
    }

    if (changed || this.pickups.some((pickup) => pickup.available)) {
      this.updatePickupVisuals();
    }
  }

  private collectPickup(pickup: ArenaPickup) {
    pickup.available = false;
    pickup.respawnRemainingMs = pickup.respawnMs;
    this.audio?.play("pickup");

    if (pickup.kind === "card-cache") {
      this.collectProgressionCard(pickup);
      return;
    }

    if (pickup.kind === "health-shard") {
      const before = this.playerHealth;
      this.playerHealth = Math.min(this.playerMaxHealth, this.playerHealth + pickup.amount);
      this.lastPickupStatus = `health +${Math.round(this.playerHealth - before)}`;
      this.floatPickupText(pickup, this.lastPickupStatus, "#86efac");
      return;
    }

    if (pickup.kind === "shield-cell") {
      this.shieldCharge = Math.min(100, this.shieldCharge + pickup.amount);
      this.temporaryShieldMs = Math.max(this.temporaryShieldMs, pickup.durationMs ?? 0);
      this.lastPickupStatus = `shield +${Math.round(pickup.amount)}`;
      this.floatPickupText(pickup, this.lastPickupStatus, "#93c5fd");
      return;
    }

    // ROUNDS: All other pickups removed - draft provides power progression
    return;
  }

  // ROUNDS: relocateCardCaches() and getRandomCardCachePosition() removed
  // Cards are now drafted between rounds, not collected in arena

  private collectProgressionCard(pickup: ArenaPickup) {
    // ROUNDS: Card collection removed - all progression through between-round draft
    this.overchargeMs = Math.max(this.overchargeMs, 4200);
    this.lastPickupStatus = "draft between rounds";
    this.floatPickupText(pickup, "draft disabled", "#f0abfc");
  }

  private floatPickupText(pickup: ArenaPickup, label: string, color: string) {
    const text = this.add
      .text(pickup.position.x, pickup.position.y - 22, label.toUpperCase(), {
        color,
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "11px",
        fontStyle: "900",
      })
      .setOrigin(0.5, 0.5);

    this.tweens.add({
      targets: text,
      y: text.y - 30,
      alpha: 0,
      duration: 520,
      ease: "Sine.easeOut",
      onComplete: () => text.destroy(),
    });
  }

  private updatePickupVisuals() {
    if (!this.pickupGraphics) {
      return;
    }

    const graphics = this.pickupGraphics;
    graphics.clear();

    for (const pickup of this.pickups) {
      const color = pickupColor(pickup.kind);
      const alpha = pickup.available ? 0.92 : 0.18;
      const pulse = pickup.available ? 1 + Math.sin(this.time.now * 0.006 + pickup.position.x) * 0.08 : 0.72;
      const radius = pickup.radius * pulse;

      graphics.lineStyle(2, color, alpha * 0.82);
      graphics.fillStyle(color, alpha * 0.22);
      graphics.fillCircle(pickup.position.x, pickup.position.y, radius + 7);
      graphics.strokeCircle(pickup.position.x, pickup.position.y, radius + 7);

      if (pickup.kind === "health-shard") {
        graphics.fillStyle(color, alpha);
        graphics.fillRect(pickup.position.x - 3, pickup.position.y - 10, 6, 20);
        graphics.fillRect(pickup.position.x - 10, pickup.position.y - 3, 20, 6);
      } else if (pickup.kind === "shield-cell") {
        graphics.fillStyle(color, alpha);
        graphics.beginPath();
        graphics.moveTo(pickup.position.x, pickup.position.y - 12);
        graphics.lineTo(pickup.position.x + 10, pickup.position.y - 4);
        graphics.lineTo(pickup.position.x + 7, pickup.position.y + 10);
        graphics.lineTo(pickup.position.x, pickup.position.y + 14);
        graphics.lineTo(pickup.position.x - 7, pickup.position.y + 10);
        graphics.lineTo(pickup.position.x - 10, pickup.position.y - 4);
        graphics.closePath();
        graphics.fillPath();
      } else if (pickup.kind === "card-cache") {
        graphics.fillStyle(color, alpha);
        graphics.fillRoundedRect(pickup.position.x - 11, pickup.position.y - 14, 22, 28, 3);
        graphics.lineStyle(2, 0xf7fbff, alpha * 0.72);
        graphics.strokeRoundedRect(pickup.position.x - 11, pickup.position.y - 14, 22, 28, 3);
        graphics.fillStyle(0xf7fbff, alpha * 0.78);
        drawPickupDiamond(graphics, pickup.position, 6);
      } else if (pickup.kind === "boss-core") {
        graphics.fillStyle(color, alpha * 0.75);
        graphics.fillCircle(pickup.position.x, pickup.position.y, 13);
        graphics.lineStyle(3, 0xf7fbff, alpha * 0.86);
        graphics.strokeCircle(pickup.position.x, pickup.position.y, 19);
        graphics.lineStyle(2, 0xfb7185, alpha * 0.9);
        graphics.beginPath();
        graphics.moveTo(pickup.position.x - 16, pickup.position.y);
        graphics.lineTo(pickup.position.x + 16, pickup.position.y);
        graphics.moveTo(pickup.position.x, pickup.position.y - 16);
        graphics.lineTo(pickup.position.x, pickup.position.y + 16);
        graphics.strokePath();
      } else if (
        pickup.kind === "slow-trap" ||
        pickup.kind === "vulnerability-trap" ||
        pickup.kind === "block-jammer"
      ) {
        graphics.lineStyle(3, color, alpha);
        graphics.strokeCircle(pickup.position.x, pickup.position.y, 13);
        graphics.beginPath();
        graphics.moveTo(pickup.position.x - 9, pickup.position.y - 9);
        graphics.lineTo(pickup.position.x + 9, pickup.position.y + 9);
        graphics.strokePath();
      } else {
        graphics.fillStyle(color, alpha);
        drawPickupDiamond(graphics, pickup.position, 12);
        graphics.fillStyle(0xf7fbff, alpha * 0.8);
        drawPickupDiamond(graphics, pickup.position, 5);
      }

      if (!pickup.available) {
        const progress = 1 - pickup.respawnRemainingMs / pickup.respawnMs;
        graphics.lineStyle(3, color, 0.48);
        graphics.beginPath();
        graphics.arc(
          pickup.position.x,
          pickup.position.y,
          radius + 12,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * Phaser.Math.Clamp(progress, 0, 1),
        );
        graphics.strokePath();
      }
    }
  }

  private resetDestructibles() {
    this.destructibles = createDestructibleStates();
    this.pickups = createPickupStates();
    this.firePatches = [];
    this.updateDestructibleVisuals();
    this.updatePickupVisuals();
    this.updateFireVisuals();
  }

  private getProjectileTargets(): ProjectileTarget[] {
    const targets: ProjectileTarget[] = this.target.alive ? [this.target] : [];
    for (const object of this.destructibles) {
      if (object.alive) {
        targets.push(object);
      }
    }
    for (const [playerId, snapshot] of this.remoteSnapshots) {
      if (!snapshot.alive) {
        continue;
      }

      const character = this.getCharacter(this.getRoomPlayer(playerId)?.characterId);
      targets.push({
        id: remotePlayerTargetId(playerId),
        position: { ...snapshot.position },
        size: getPlayerBodySize(character.sizeScale),
        alive: true,
      });
    }
    return targets;
  }

  private updateReticle() {
    if (!this.reticle) {
      return;
    }

    const aimTarget = this.getAimTarget();
    const origin = this.getMuzzlePosition();
    this.reticle.clear();
    // Aim trace line — subtle cyan, dashed effect via two segments
    this.reticle.lineStyle(1, 0x8ff8ff, 0.22);
    this.reticle.beginPath();
    this.reticle.moveTo(origin.x, origin.y);
    this.reticle.lineTo(aimTarget.x, aimTarget.y);
    this.reticle.strokePath();

    // Outer ring (dark outline for contrast on any background)
    this.reticle.lineStyle(4, 0x05080f, 0.55);
    this.reticle.strokeCircle(aimTarget.x, aimTarget.y, 10);
    // Inner ring (bright accent)
    this.reticle.lineStyle(2, 0x8ff8ff, 0.92);
    this.reticle.strokeCircle(aimTarget.x, aimTarget.y, 10);

    // Cross-hair lines — dark outline first for contrast
    const crossLines: Array<[number, number, number, number]> = [
      [aimTarget.x - 17, aimTarget.y, aimTarget.x - 5, aimTarget.y],
      [aimTarget.x + 5, aimTarget.y, aimTarget.x + 17, aimTarget.y],
      [aimTarget.x, aimTarget.y - 17, aimTarget.x, aimTarget.y - 5],
      [aimTarget.x, aimTarget.y + 5, aimTarget.x, aimTarget.y + 17],
    ];
    this.reticle.lineStyle(3, 0x05080f, 0.5);
    this.reticle.beginPath();
    for (const [x1, y1, x2, y2] of crossLines) {
      this.reticle.moveTo(x1, y1);
      this.reticle.lineTo(x2, y2);
    }
    this.reticle.strokePath();
    this.reticle.lineStyle(1.5, 0xf7fbff, 0.95);
    this.reticle.beginPath();
    for (const [x1, y1, x2, y2] of crossLines) {
      this.reticle.moveTo(x1, y1);
      this.reticle.lineTo(x2, y2);
    }
    this.reticle.strokePath();
  }

  private updateScoreboardOverlay() {
    if (!this.scoreboardBack || !this.scoreboardText || !this.keys) {
      return;
    }

    this.scoreboardBack.setVisible(this.scoreboardVisible);
    this.scoreboardText.setVisible(this.scoreboardVisible);
    if (!this.scoreboardVisible) {
      return;
    }

    const rows = this.getScoreboardRows();
    this.scoreboardText.setText([
      "PLAYER                 K   D",
      "----------------------------",
      ...rows.map((row) =>
        `${row.name.padEnd(20).slice(0, 20)} ${row.score.kills.toString().padStart(2)}  ${row.score.deaths.toString().padStart(2)}`,
      ),
    ]);
  }

  private getScoreboardRows(): Array<{ playerId: string; name: string; score: PlayerScore }> {
    const players = this.roomPlayers.length > 0
      ? this.roomPlayers
      : [{
          playerId: this.localPlayerId,
          name: this.getLocalRoomPlayer()?.name ?? "jakesjam",
          characterId: this.getLocalCharacter().id,
        }];

    return players
      .map((player) => ({
        playerId: player.playerId,
        name: player.playerId === this.localPlayerId ? `${player.name} *` : player.name,
        score: this.ensureScore(player.playerId),
      }))
      .sort((a, b) => b.score.kills - a.score.kills || a.score.deaths - b.score.deaths || a.name.localeCompare(b.name));
  }

  private ensureScore(playerId: string): PlayerScore {
    const existing = this.playerScores.get(playerId);
    if (existing) {
      return existing;
    }

    const score = { kills: 0, deaths: 0 };
    this.playerScores.set(playerId, score);
    return score;
  }

  private addKill(playerId: string) {
    this.ensureScore(playerId).kills += 1;
  }

  private addDeath(playerId: string) {
    this.ensureScore(playerId).deaths += 1;
  }

  private resetPlayer() {
    const spawn = this.getLocalSpawn();
    const character = this.getLocalCharacter();
    this.deathSequenceId += 1;
    this.clearRespawnText();
    this.playerBody = createPlayerBody(spawn.x, spawn.y, character.sizeScale);
    this.syncEffectiveMaxHealth(false);
    this.playerHealth = this.playerMaxHealth;
    this.playerRespawnPending = false;
    this.respawnRemainingMs = 0;
    this.respawnCountdownActive = false;
    this.shieldCharge = Math.max(this.shieldCharge, 55);
    this.shieldActive = false;
    this.playerRig?.setVisible(true);
    this.movement.reset();
    this.updateCameraTarget();
    this.syncPlayerVisuals();
  }

  private rebuildWeaponBuild(playSound = true) {
    const cards = findCardsById(crystalRoundsCards, this.progressionCardIds);
    const oldMaxHealth = this.playerMaxHealth;
    this.weaponBuild = createWeaponBuild(starterWeapon, cards);
    const nextMaxHealth = this.getLocalCharacter().maxHealth +
      this.weaponBuild.maxHealthAdd +
      0 /* ROUNDS: Boss mode removed */;
    this.syncEffectiveMaxHealth(nextMaxHealth > oldMaxHealth);
    this.fireCooldownMs = 0;
    if (playSound) {
      this.audio?.play("card");
    }
  }

  private syncEffectiveMaxHealth(healAddedHealth: boolean) {
    const character = this.getLocalCharacter();
    const oldMaxHealth = this.playerMaxHealth;
    this.playerMaxHealth = character.maxHealth + this.weaponBuild.maxHealthAdd + 0 /* ROUNDS: Boss mode removed */;
    if (healAddedHealth && this.playerMaxHealth > oldMaxHealth) {
      this.playerHealth = Math.min(this.playerMaxHealth, this.playerHealth + (this.playerMaxHealth - oldMaxHealth));
      return;
    }
    this.playerHealth = Math.min(this.playerHealth, this.playerMaxHealth);
  }

  private clearTemporaryCombatEffects() {
    this.damageAmpMs = 0;
    this.speedBoostMs = 0;
    this.meleeModeMs = 0;
    this.slowDebuffMs = 0;
    this.vulnerabilityMs = 0;
    this.blockJammerMs = 0;
    this.parryActiveMs = 0;
    this.parryCooldownMs = 0;
    this.overchargeMs = 0;
    this.temporaryShieldMs = 0;
  }

  private isOutOfBounds(): boolean {
    const margin = 180;
    return (
      this.playerBody.position.y > boxworksWorld.size.y + margin ||
      this.playerBody.position.x < -margin ||
      this.playerBody.position.x > boxworksWorld.size.x + margin
    );
  }

  private getLocalSpawn(): Vec2 {
    const spawn = Phaser.Utils.Array.GetRandom(boxworksWorld.spawns);
    return { ...spawn };
  }

  private getRoomPlayerIndex(playerId: string): number {
    const index = this.roomPlayers.findIndex((player) => player.playerId === playerId);
    return index >= 0 ? index : 0;
  }

  private getLocalRoomPlayer(): RoomPlayer | undefined {
    return this.roomPlayers.find((player) => player.playerId === this.localPlayerId);
  }

  private getRoomPlayer(playerId: string): RoomPlayer | undefined {
    return this.roomPlayers.find((player) => player.playerId === playerId);
  }

  private getLocalCharacter(): CharacterDefinition {
    return this.getCharacter(this.getLocalRoomPlayer()?.characterId);
  }

  private getCharacter(characterId: CharacterId = "balanced"): CharacterDefinition {
    return characters.find((character) => character.id === characterId) ?? characters[0] ?? { id: "balanced", name: "Balanced", maxHealth: 100, moveSpeedMultiplier: 1, sizeScale: 1, recoilControlMultiplier: 1, abilityType: "shield" as const, weakness: "" };
  }

  private getVisualScale(character: CharacterDefinition): number {
    return PLAYER_VISUAL_SCALE * character.sizeScale;
  }

  private destroyPlayerVisuals() {
    this.playerRig?.destroy();
    this.playerRig = undefined;
    this.shieldGraphics?.destroy();
    this.shieldGraphics = undefined;
    for (const rig of this.remoteRigs.values()) {
      rig.destroy();
    }
    this.remoteRigs.clear();
    this.remoteSnapshots.clear();
    this.remoteShotSequences.clear();
  }

  private teardownNetworkSync() {
    this.unsubscribeSnapshots?.();
    this.unsubscribeSnapshots = undefined;
    void this.roomClient?.close();
    this.roomClient = undefined;
    this.snapshotSendTimerMs = 0;
  }
}

type TestTarget = ProjectileTarget & {
  health: number;
  maxHealth: number;
  respawnMs: number;
};

type ArenaDestructible = ProjectileTarget & {
  kind: DestructibleKind;
  health: number;
  maxHealth: number;
  explosive: boolean;
  flammable: boolean;
  burnMs: number;
};

type ArenaPickup = {
  id: string;
  kind: PickupKind;
  position: Vec2;
  radius: number;
  amount: number;
  respawnMs: number;
  respawnRemainingMs: number;
  durationMs?: number;
  available: boolean;
};

type FirePatch = {
  id: number;
  position: Vec2;
  radius: number;
  ttlMs: number;
  dps: number;
};

type HazardHit = {
  position: Vec2;
  element: ElementType;
  impactRadiusPx: number;
};

function createInitialRoundState(): RoundState {
  return {
    phase: "countdown",
    countdownRemainingMs: COUNTDOWN_MS,
    scores: {},
    roundIndex: 1,
    winnerPlayerId: null,
  };
}

/**
 * Build a stub PlayerEntity for the round state machine. stepRound only
 * touches `alive` and `health`; everything else is pinned to type-correct
 * defaults. Importantly, this stub MUST NOT be passed to anything that
 * actually simulates physics — it's input-only for round resolution.
 *
 * Note: ROUND_TIME_LIMIT_MS is imported but currently only consumed inside
 * sim/round.ts; we re-export the read so future scoreboard polish can show
 * a wall-clock round timer without re-importing.
 */
function makeSimPlayerStub(id: PlayerId, health: number, alive: boolean): PlayerEntity {
  return {
    id,
    characterId: "balanced",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 0,
    health,
    shieldActive: false,
    crouching: false,
    alive,
    weaponId: "stub",
    cards: [],
    fireCooldownMs: 0,
    ammo: 0,
    abilityCharge: 0,
    lastProcessedInputSeq: 0,
  };
}

function createPlayerBody(x = 220, y = 430, sizeScale = 1): PlayerBody {
  return {
    position: { x, y },
    velocity: { x: 0, y: 0 },
    size: getPlayerBodySize(sizeScale),
    grounded: false,
    crouching: false,
    facing: 1,
  };
}

function getPlayerBodySize(sizeScale: number): Vec2 {
  return {
    x: 30 * sizeScale,
    y: 38 * sizeScale,
  };
}

function createDestructibleStates(): ArenaDestructible[] {
  return boxworksWorld.destructibles.map((object) => ({
    id: object.id,
    kind: object.kind,
    position: { ...object.position },
    size: { ...object.size },
    alive: true,
    health: object.health,
    maxHealth: object.health,
    explosive: object.explosive,
    flammable: object.flammable,
    burnMs: 0,
  }));
}

function createPickupStates(): ArenaPickup[] {
  return boxworksWorld.pickups.map((pickup) => ({
    id: pickup.id,
    kind: pickup.kind,
    position: { ...pickup.position },
    radius: pickup.radius,
    amount: pickup.amount,
    respawnMs: pickup.respawnMs,
    respawnRemainingMs: 0,
    durationMs: pickup.durationMs,
    available: true,
  }));
}

function createTestTarget(): TestTarget {
  return {
    id: "dummy-target",
    position: { x: 740, y: 430 },
    size: { x: 42, y: 54 },
    alive: true,
    health: 180,
    maxHealth: 180,
    respawnMs: 0,
  };
}

function destructibleColor(kind: DestructibleKind): number {
  const colors: Record<DestructibleKind, number> = {
    barrel: 0xff6b6b,
    box: 0xc49a6c,
    mine: 0xffd166,
    cube: 0x8fa3c8,
  };
  return colors[kind];
}

function pickupColor(kind: PickupKind): number {
  const colors: Record<PickupKind, number> = {
    "health-shard": 0x86efac,
    "shield-cell": 0x93c5fd,
    // ROUNDS: All other pickups removed, grayed out
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

function remotePlayerTargetId(playerId: string): string {
  return `${REMOTE_PLAYER_TARGET_PREFIX}${playerId}`;
}

function playerIdFromRemoteTargetId(targetId: string): string | undefined {
  return targetId.startsWith(REMOTE_PLAYER_TARGET_PREFIX)
    ? targetId.slice(REMOTE_PLAYER_TARGET_PREFIX.length)
    : undefined;
}

function applySnapshotDamage(
  snapshot: MatchPlayerSnapshot,
  damage: number,
): MatchPlayerSnapshot {
  const shieldActive = (snapshot.shieldActive ?? false) && (snapshot.shieldCharge ?? 0) > 0;
  if (shieldActive) {
    const shieldCharge = Math.max(0, (snapshot.shieldCharge ?? 0) - damage * 1.8);
    return {
      ...snapshot,
      shieldActive: shieldCharge > 0,
      shieldCharge,
    };
  }

  const health = Math.max(0, snapshot.health - damage);
  return {
    ...snapshot,
    health,
    alive: health > 0,
  };
}

function drawPickupDiamond(graphics: Phaser.GameObjects.Graphics, position: Vec2, radius: number) {
  graphics.beginPath();
  graphics.moveTo(position.x, position.y - radius);
  graphics.lineTo(position.x + radius, position.y);
  graphics.lineTo(position.x, position.y + radius);
  graphics.lineTo(position.x - radius, position.y);
  graphics.closePath();
  graphics.fillPath();
}

function colorToNumber(color: string): number {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0x50e3c2;
}

function readStoredChaosModifiers(): ChaosModifierId[] {
  const raw = localStorage.getItem(CHAOS_MODIFIERS_KEY);
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as ChaosModifierId[];
  } catch {
    return [];
  }
}

function smoothSnapshot(
  previous: MatchPlayerSnapshot,
  next: MatchPlayerSnapshot,
): MatchPlayerSnapshot {
  return {
    ...next,
    position: lerpVec(previous.position, next.position, REMOTE_SMOOTHING),
    velocity: lerpVec(previous.velocity, next.velocity, REMOTE_SMOOTHING),
    aimAngle: Phaser.Math.Angle.RotateTo(previous.aimAngle, next.aimAngle, 0.35),
  };
}

function lerpVec(a: Vec2, b: Vec2, amount: number): Vec2 {
  return {
    x: Phaser.Math.Linear(a.x, b.x, amount),
    y: Phaser.Math.Linear(a.y, b.y, amount),
  };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
