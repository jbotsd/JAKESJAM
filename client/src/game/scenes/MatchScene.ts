import Phaser from "phaser";
import { boxworksWorld, seededUnit } from "../../sim/data/boxworks.js";
import { crystalRoundsCards } from "../data/cards";
import { characters } from "../data/characters";
import { getChaosModifiers, projectileShapes } from "../data/chaosModifiers";
import { starterWeapon } from "../data/weapons";
import { RoomClient } from "../net/RoomClient";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { GameAudioSystem } from "../systems/AudioSystem";
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
  CardDefinition,
  CharacterId,
  ChaosModifierId,
  DestructibleKind,
  ElementType,
  PickupKind,
  Vec2,
} from "../types/game";
import type { MatchPlayerSnapshot, RoomPlayer } from "../types/net";

const STANDING_CHEST_OFFSET = 75;
const CROUCHING_CHEST_OFFSET = 54;
const MUZZLE_REACH = 43;
const PLAYER_VISUAL_SCALE = 0.78;
const SNAPSHOT_SEND_INTERVAL_MS = 100;
const REMOTE_SMOOTHING = 0.26;
const CHAOS_MODIFIERS_KEY = "jakesjam.chaosModifiers";
const CARD_CACHE_RELOCATE_MS = 20000;
const REMOTE_PLAYER_TARGET_PREFIX = "remote-player:";
const VISIBLE_MUTATOR_BUCKETS = ["delivery", "quantity", "shape", "trajectory", "impact", "element"] as const;
const DEATH_POPUP_DELAY_MS = 520;
const RESPAWN_COUNTDOWN_MS = 3000;
const PARRY_ACTIVE_MS = 420;
const PARRY_COOLDOWN_MS = 4300;
const PARRY_BASE_ARC_RADIANS = Math.PI * 0.72;
const PARRY_BASE_RANGE = 98;
const DAMAGE_AMP_MULTIPLIER = 1.42;
const SPEED_BOOST_MULTIPLIER = 1.22;
const SLOW_DEBUFF_MULTIPLIER = 0.62;
const VULNERABILITY_MULTIPLIER = 1.38;
const BOSS_HEALTH_BONUS = 90;
const BOSS_MOVE_MULTIPLIER = 0.72;
const BOSS_DAMAGE_MULTIPLIER = 1.55;
const BOSS_FIRE_RATE_MULTIPLIER = 0.72;

type MatchSceneInitData = {
  roomId?: string;
  roomCode?: string;
  matchId?: string;
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
  private debugText?: Phaser.GameObjects.Text;
  private weaponText?: Phaser.GameObjects.Text;
  private scoreboardBack?: Phaser.GameObjects.Rectangle;
  private scoreboardText?: Phaser.GameObjects.Text;
  private scoreboardVisible = false;
  private respawnText?: Phaser.GameObjects.Text;
  private targetGraphics?: Phaser.GameObjects.Graphics;
  private targetText?: Phaser.GameObjects.Text;
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
  private bossModeMs = 0;
  private bossShotIndex = 0;
  private parryActiveMs = 0;
  private parryCooldownMs = 0;
  private rightMouseParryWasDown = false;
  private cardCacheRelocateTimerMs = 0;
  private lastPickupStatus = "none";
  private shieldGraphics?: Phaser.GameObjects.Graphics;
  private roomId?: string;
  private matchId?: string;
  private localPlayerId = "offline-player";
  private roomPlayers: RoomPlayer[] = [];
  private readonly playerScores = new Map<string, PlayerScore>();
  private snapshotSendTimerMs = 0;
  private snapshotSequence = 0;
  private shotSequence = 0;
  private ignoreLocalSnapshotsThroughSequence = 0;
  private chaosModifierIds: ChaosModifierId[] = [];
  private fireHazardTimerMs = 0;

  constructor() {
    super("MatchScene");
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
    this.bossModeMs = 0;
    this.bossShotIndex = 0;
    this.parryActiveMs = 0;
    this.parryCooldownMs = 0;
    this.rightMouseParryWasDown = false;
    this.shotSequence = 0;
    this.ignoreLocalSnapshotsThroughSequence = 0;
    this.cardCacheRelocateTimerMs = 0;
    this.lastPickupStatus = "none";
    this.progressionCardIds = [];
    this.projectileSystem = new ProjectileSystem(this);
    this.resetPlayer();
    this.renderArena();
    this.configureCamera();
    this.createArenaHazardVisuals();
    this.createTargetVisuals();
    this.createPlayerVisuals();
    this.createRemotePlayerVisuals();
    this.createReticle();
    this.createDebugOverlay();
    this.createWeaponOverlay();
    this.createScoreboardOverlay();
    this.bindKeys();
    this.ensureScore(this.localPlayerId);
    this.rebuildWeaponBuild();
    this.setupNetworkSync();
  }

  update(_time: number, deltaMs: number) {
    if (!this.keys || !this.playerRig || !this.debugText || !this.projectileSystem) {
      return;
    }

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
      this.updateDebugText();
      this.updateWeaponOverlay();
      this.updateScoreboardOverlay();
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
    this.updateDebugText();
    this.updateWeaponOverlay();
    this.updateScoreboardOverlay();
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

  private createDebugOverlay() {
    this.debugText = this.add.text(26, 24, "", {
      color: "#50e3c2",
      fontFamily: "Consolas, monospace",
      fontSize: "16px",
      fontStyle: "900",
      lineSpacing: 4,
    });
    this.debugText.setScrollFactor(0);
    this.updateDebugText();
  }

  private createWeaponOverlay() {
    this.weaponText = this.add.text(620, 24, "", {
      color: "#dff7ff",
      fontFamily: "Consolas, monospace",
      fontSize: "12px",
      lineSpacing: 4,
      wordWrap: { width: 315, useAdvancedWrap: true },
    });
    this.weaponText.setScrollFactor(0);
    this.updateWeaponOverlay();
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
    if (!this.keys) {
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
      this.parryCooldownMs <= 0
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
      const spawn = boxworksWorld.spawns[playerIndex % boxworksWorld.spawns.length];
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
    const overcharged = this.overchargeMs > 0;
    const damageBoost = (this.damageAmpMs > 0 ? DAMAGE_AMP_MULTIPLIER : 1) *
      (this.bossModeMs > 0 ? BOSS_DAMAGE_MULTIPLIER : 1);
    const fireRateBoost = this.bossModeMs > 0 ? BOSS_FIRE_RATE_MULTIPLIER : 1;
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

    if (this.bossModeMs > 0) {
      build.projectile = {
        ...build.projectile,
        count: Math.max(build.projectile.count, 7),
        shape: "orb",
        impact: build.projectile.impact === "none" ? "explosive" : build.projectile.impact,
        impactRadiusPx: Math.max(build.projectile.impactRadiusPx, 46),
        sizeMultiplier: Math.max(build.projectile.sizeMultiplier, 1.15),
      };
      build.spreadRadians = Math.max(build.spreadRadians, Math.PI * 0.72);
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
    this.spawnFirePatch({
      x: Phaser.Math.Between(80, boxworksWorld.size.x - 80),
      y: Phaser.Math.Between(160, boxworksWorld.size.y - 90),
    }, Phaser.Math.Between(36, 62));
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

    const pointer = this.input.activePointer;
    if (!pointer.isDown || pointer.rightButtonDown()) {
      return;
    }

    const origin = this.getMuzzlePosition();
    const aimTarget = this.getAimTarget();
    const pointerAimAngle = Math.atan2(aimTarget.y - origin.y, aimTarget.x - origin.x);
    const aimAngle = this.bossModeMs > 0 ? this.getBossPatternAngle(pointerAimAngle) : pointerAimAngle;
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

  private getBossPatternAngle(fallbackAngle: number): number {
    const pattern = [
      0,
      Math.PI / 4,
      Math.PI / 2,
      (Math.PI * 3) / 4,
      Math.PI,
      (-Math.PI * 3) / 4,
      -Math.PI / 2,
      -Math.PI / 4,
    ];
    const aimSign = Math.cos(fallbackAngle) < 0 ? Math.PI : 0;
    const angle = pattern[this.bossShotIndex % pattern.length] + aimSign;
    this.bossShotIndex += 1;
    return Phaser.Math.Angle.Wrap(angle);
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
    if (this.speedBoostMs > 0) {
      multiplier *= SPEED_BOOST_MULTIPLIER;
    }
    if (this.slowDebuffMs > 0) {
      multiplier *= SLOW_DEBUFF_MULTIPLIER;
    }
    if (this.bossModeMs > 0) {
      multiplier *= BOSS_MOVE_MULTIPLIER;
    }
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
      (this.vulnerabilityMs > 0 ? VULNERABILITY_MULTIPLIER : 1) *
      (this.bossModeMs > 0 ? 1.12 : 1);
    this.playerHealth = Math.max(0, this.playerHealth - modifiedAmount);
    this.audio?.play("hit");
    if (this.playerHealth <= 0) {
      this.killPlayer();
    }
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
    this.resetWeaponProgression();
    this.audio?.play("explosion");
    this.spawnPlayerDeathExplosion(this.playerBody.position);
    this.time.delayedCall(DEATH_POPUP_DELAY_MS, () => {
      if (this.deathSequenceId !== deathSequence || !this.playerRespawnPending) {
        return;
      }
      this.respawnCountdownActive = true;
      this.respawnRemainingMs = RESPAWN_COUNTDOWN_MS;
      this.showDeathPopup();
    });
    this.time.delayedCall(DEATH_POPUP_DELAY_MS + RESPAWN_COUNTDOWN_MS, () => {
      if (this.deathSequenceId !== deathSequence || !this.playerRespawnPending) {
        return;
      }
      this.respawnPlayer();
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
    const { width, height } = this.scale;
    this.clearRespawnText();
    this.respawnText = this.add
      .text(width / 2, height * 0.28, this.getRespawnMessage(), {
        color: "#fff7d6",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "32px",
        fontStyle: "900",
        align: "center",
        stroke: "#0b0e14",
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1000);
  }

  private updateRespawnCountdown(deltaMs: number) {
    if (!this.playerRespawnPending || !this.respawnCountdownActive) {
      return;
    }

    this.respawnRemainingMs = Math.max(0, this.respawnRemainingMs - deltaMs);
    this.updateRespawnText();
  }

  private updateRespawnText() {
    if (!this.respawnText) {
      return;
    }

    this.respawnText.setText(this.getRespawnMessage());
  }

  private getRespawnMessage(): string {
    const seconds = Math.ceil(this.respawnRemainingMs / 1000);
    return `LOL GIT GUD CUNT\nRESPAWN ${seconds}`;
  }

  private clearRespawnText() {
    this.respawnText?.destroy();
    this.respawnText = undefined;
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
    const previousBossMs = this.bossModeMs;
    this.bossModeMs = Math.max(0, this.bossModeMs - deltaMs);
    if (previousBossMs > 0 && this.bossModeMs <= 0) {
      this.syncEffectiveMaxHealth(false);
    }

    this.cardCacheRelocateTimerMs += deltaMs;
    if (this.cardCacheRelocateTimerMs >= CARD_CACHE_RELOCATE_MS) {
      this.cardCacheRelocateTimerMs = 0;
      this.relocateCardCaches();
    }

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

    if (pickup.kind === "damage-amp") {
      this.damageAmpMs = Math.max(this.damageAmpMs, pickup.durationMs ?? 0);
      this.lastPickupStatus = "damage up";
      this.floatPickupText(pickup, "damage up", "#fb7185");
      return;
    }

    if (pickup.kind === "speed-boost") {
      this.speedBoostMs = Math.max(this.speedBoostMs, pickup.durationMs ?? 0);
      this.lastPickupStatus = "speed up";
      this.floatPickupText(pickup, "speed up", "#67e8f9");
      return;
    }

    if (pickup.kind === "melee-mode") {
      this.meleeModeMs = Math.max(this.meleeModeMs, pickup.durationMs ?? 0);
      this.lastPickupStatus = "melee mode";
      this.floatPickupText(pickup, "melee mode", "#f97316");
      return;
    }

    if (pickup.kind === "slow-trap") {
      this.slowDebuffMs = Math.max(this.slowDebuffMs, pickup.durationMs ?? 0);
      this.lastPickupStatus = "slowed";
      this.floatPickupText(pickup, "slowed", "#bfdbfe");
      return;
    }

    if (pickup.kind === "vulnerability-trap") {
      this.vulnerabilityMs = Math.max(this.vulnerabilityMs, pickup.durationMs ?? 0);
      this.lastPickupStatus = "vulnerable";
      this.floatPickupText(pickup, "vulnerable", "#fca5a5");
      return;
    }

    if (pickup.kind === "block-jammer") {
      this.blockJammerMs = Math.max(this.blockJammerMs, pickup.durationMs ?? 0);
      this.shieldActive = false;
      this.parryActiveMs = 0;
      this.lastPickupStatus = "no block";
      this.floatPickupText(pickup, "no block", "#c084fc");
      return;
    }

    if (pickup.kind === "boss-core") {
      this.activateBossMode(pickup);
      return;
    }

    this.overchargeMs = Math.max(this.overchargeMs, pickup.durationMs ?? 0);
    this.lastPickupStatus = "overcharge";
    this.floatPickupText(pickup, "overcharge", "#ffd166");
  }

  private activateBossMode(pickup: ArenaPickup) {
    this.bossModeMs = Math.max(this.bossModeMs, pickup.durationMs ?? 0);
    this.bossShotIndex = 0;
    this.syncEffectiveMaxHealth(true);
    this.playerHealth = Math.min(this.playerMaxHealth, this.playerHealth + BOSS_HEALTH_BONUS);
    this.lastPickupStatus = "boss mode";
    this.floatPickupText(pickup, "boss mode", "#fff7d6");
  }

  private relocateCardCaches() {
    const cardCaches = this.pickups.filter((pickup) => pickup.kind === "card-cache");
    for (const [index, pickup] of cardCaches.entries()) {
      pickup.position = this.getRandomCardCachePosition(index);
      pickup.available = true;
      pickup.respawnRemainingMs = 0;
    }
    this.updatePickupVisuals();
  }

  private getRandomCardCachePosition(index: number): Vec2 {
    const spawn = Phaser.Utils.Array.GetRandom(boxworksWorld.spawns);
    const angle = seededUnit(index + Math.floor(this.time.now / CARD_CACHE_RELOCATE_MS), index, 300) * Math.PI * 2;
    const radius = 34 + seededUnit(index, Math.floor(this.time.now / 1000), 301) * 48;
    return {
      x: Phaser.Math.Clamp(spawn.x + Math.cos(angle) * radius, 80, boxworksWorld.size.x - 80),
      y: Phaser.Math.Clamp(spawn.y + Math.sin(angle) * radius, 140, boxworksWorld.size.y - 70),
    };
  }

  private collectProgressionCard(pickup: ArenaPickup) {
    const card = this.rollProgressionCard();
    if (!card) {
      this.overchargeMs = Math.max(this.overchargeMs, 4200);
      this.lastPickupStatus = "card capped";
      this.floatPickupText(pickup, "card capped / overcharge", "#f0abfc");
      return;
    }

    this.progressionCardIds.push(card.id);
    this.rebuildWeaponBuild();
    this.lastPickupStatus = `card ${card.name}`;
    this.floatPickupText(pickup, card.name, card.visual?.glowColor ?? "#f0abfc");
  }

  private rollProgressionCard(): CardDefinition | undefined {
    const ownedCounts = new Map<string, number>();
    for (const cardId of this.progressionCardIds) {
      ownedCounts.set(cardId, (ownedCounts.get(cardId) ?? 0) + 1);
    }

    const eligible = crystalRoundsCards.filter((card) => isEligibleMutatorCard(card, ownedCounts));
    const highSignalCards = eligible.filter((card) => isVisibleWeaponMutator(card));
    const rollPool = highSignalCards.length > 0
        ? highSignalCards
        : eligible;

    if (rollPool.length === 0) {
      return undefined;
    }

    const weightedPool = rollPool.flatMap((card) => {
      const modifier = card.modifier;
      const projectile = modifier?.projectile;
      const ownedCount = ownedCounts.get(card.id) ?? 0;
      const hasSpray = Boolean((modifier?.projectileCountAdd ?? 0) > 0 || (projectile?.count ?? 0) > 1);
      const hasHoming = projectile?.pathing === "homing" || Boolean(modifier?.projectileHomingStrengthAdd);
      let weight = 1;

      if (hasSpray) {
        weight += Math.min(4, Math.max(1, modifier?.projectileCountAdd ?? projectile?.count ?? 1));
      }
      if (hasHoming) {
        weight += 3;
      }
      if (card.buckets?.includes("trajectory")) {
        weight += 1;
      }
      if (ownedCount > 0 && !card.unique) {
        weight += 1;
      }
      if (card.rarity === "legendary") {
        weight = Math.max(1, weight - 1);
      }

      return Array.from({ length: weight }, () => card);
    });

    return Phaser.Utils.Array.GetRandom(weightedPool);
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
    this.reticle.lineStyle(1, 0x50e3c2, 0.45);
    this.reticle.beginPath();
    this.reticle.moveTo(origin.x, origin.y);
    this.reticle.lineTo(aimTarget.x, aimTarget.y);
    this.reticle.strokePath();

    this.reticle.lineStyle(2, 0xf7fbff, 0.9);
    this.reticle.strokeCircle(aimTarget.x, aimTarget.y, 9);
    this.reticle.beginPath();
    this.reticle.moveTo(aimTarget.x - 15, aimTarget.y);
    this.reticle.lineTo(aimTarget.x - 5, aimTarget.y);
    this.reticle.moveTo(aimTarget.x + 5, aimTarget.y);
    this.reticle.lineTo(aimTarget.x + 15, aimTarget.y);
    this.reticle.moveTo(aimTarget.x, aimTarget.y - 15);
    this.reticle.lineTo(aimTarget.x, aimTarget.y - 5);
    this.reticle.moveTo(aimTarget.x, aimTarget.y + 5);
    this.reticle.lineTo(aimTarget.x, aimTarget.y + 15);
    this.reticle.strokePath();
  }

  private updateDebugText() {
    if (!this.debugText) {
      return;
    }

    this.debugText.setText([
      "HEALTH",
      `${Math.ceil(this.playerHealth)}/${this.playerMaxHealth}`,
      `JET ${this.movementDebug.jetpackFuel}${this.movementDebug.jetpackActive ? " ON" : ""}`,
    ]);
  }

  private updateWeaponOverlay() {
    if (!this.weaponText || !this.projectileSystem) {
      return;
    }

    const chaos = this.getChaosProfile();
    const activeBuild = this.createChaosWeaponBuild();
    const mutatorNames = this.weaponBuild.cards.length > 0
      ? this.weaponBuild.cards.map((card) => card.name).join(", ")
      : "Base weapon";

    this.weaponText.setText([
      `WEAPON ${activeBuild.name}`,
      `MUTATORS ${this.weaponBuild.cards.length}`,
      mutatorNames,
      `fire ${activeBuild.delivery}  shots ${chaos.disableProjectiles ? 0 : activeBuild.projectile.count}`,
      `shape ${activeBuild.projectile.shape}  path ${activeBuild.projectile.pathing}`,
      `element ${activeBuild.projectile.element}  impact ${activeBuild.projectile.impact}`,
      `dmg ${activeBuild.damage}  rate ${activeBuild.fireRate}/s`,
      `cooldown ${Math.round(this.getShotCooldownMs(activeBuild))}ms  block ${this.parryCooldownMs <= 0 ? "ready" : `${Math.ceil(this.parryCooldownMs / 1000)}s`}`,
    ]);
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
    this.updateDebugText();
  }

  private rebuildWeaponBuild(playSound = true) {
    const cards = findCardsById(crystalRoundsCards, this.progressionCardIds);
    const oldMaxHealth = this.playerMaxHealth;
    this.weaponBuild = createWeaponBuild(starterWeapon, cards);
    const nextMaxHealth = this.getLocalCharacter().maxHealth +
      this.weaponBuild.maxHealthAdd +
      (this.bossModeMs > 0 ? BOSS_HEALTH_BONUS : 0);
    this.syncEffectiveMaxHealth(nextMaxHealth > oldMaxHealth);
    this.fireCooldownMs = 0;
    if (playSound) {
      this.audio?.play("card");
    }
    this.updateWeaponOverlay();
  }

  private syncEffectiveMaxHealth(healAddedHealth: boolean) {
    const character = this.getLocalCharacter();
    const oldMaxHealth = this.playerMaxHealth;
    this.playerMaxHealth = character.maxHealth + this.weaponBuild.maxHealthAdd + (this.bossModeMs > 0 ? BOSS_HEALTH_BONUS : 0);
    if (healAddedHealth && this.playerMaxHealth > oldMaxHealth) {
      this.playerHealth = Math.min(this.playerMaxHealth, this.playerHealth + (this.playerMaxHealth - oldMaxHealth));
      return;
    }
    this.playerHealth = Math.min(this.playerHealth, this.playerMaxHealth);
  }

  private resetWeaponProgression() {
    if (this.progressionCardIds.length === 0) {
      return;
    }

    this.progressionCardIds = [];
    this.lastPickupStatus = "weapon reset";
    this.rebuildWeaponBuild(false);
  }

  private clearTemporaryCombatEffects() {
    this.damageAmpMs = 0;
    this.speedBoostMs = 0;
    this.meleeModeMs = 0;
    this.slowDebuffMs = 0;
    this.vulnerabilityMs = 0;
    this.blockJammerMs = 0;
    this.bossModeMs = 0;
    this.bossShotIndex = 0;
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
    return characters.find((character) => character.id === characterId) ?? characters[0];
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
    "overcharge-core": 0xffd166,
    "card-cache": 0xf0abfc,
    "damage-amp": 0xfb7185,
    "speed-boost": 0x67e8f9,
    "melee-mode": 0xf97316,
    "slow-trap": 0xbfdbfe,
    "vulnerability-trap": 0xfca5a5,
    "block-jammer": 0xc084fc,
    "boss-core": 0xfff7d6,
  };
  return colors[kind];
}

function isEligibleMutatorCard(
  card: CardDefinition,
  ownedCounts: Map<string, number>,
): boolean {
  if (!card.modifier || card.id === "crystal-volley") {
    return false;
  }

  const ownedCount = ownedCounts.get(card.id) ?? 0;
  if (card.unique && ownedCount > 0) {
    return false;
  }
  if (ownedCount >= (card.maxStacks ?? 1)) {
    return false;
  }

  return true;
}

function isVisibleWeaponMutator(card: CardDefinition): boolean {
  const buckets = card.buckets ?? [];
  if (buckets.some((bucket) => VISIBLE_MUTATOR_BUCKETS.includes(bucket as typeof VISIBLE_MUTATOR_BUCKETS[number]))) {
    return true;
  }

  const projectile = card.modifier?.projectile;
  return Boolean(
    card.modifier?.delivery ||
      projectile?.shape ||
      projectile?.count ||
      projectile?.pathing ||
      projectile?.impact ||
      projectile?.element ||
      card.modifier?.projectileCountAdd ||
      card.modifier?.projectileBounceAdd ||
      card.modifier?.projectileSplitAdd ||
      card.modifier?.projectileHomingStrengthAdd ||
      card.modifier?.maxHealthAdd ||
      card.modifier?.moveSpeedMultiplier ||
      card.modifier?.parryCoverMultiplier ||
      card.modifier?.parryCooldownMultiplier,
  );
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
