import Phaser from "phaser";
import { crystalRoundsCards } from "../data/cards";
import { characters } from "../data/characters";
import { getChaosModifiers, projectileShapes } from "../data/chaosModifiers";
import { boxworks } from "../data/maps";
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
  MapDefinition,
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
const WORLD_COLUMNS = 5;
const WORLD_ROWS = 3;
const VERTICAL_SHAFT_WIDTH = 150;
const boxworksWorld = expandMap(boxworks, WORLD_COLUMNS, WORLD_ROWS);
const CHAOS_MODIFIERS_KEY = "jakesjam.chaosModifiers";
const CARD_CACHE_RESPAWN_MS = 18000;
const REMOTE_PLAYER_TARGET_PREFIX = "remote-player:";

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

export class MatchScene extends Phaser.Scene {
  private readonly movement = new MovementSystem();
  private audio?: GameAudioSystem;
  private projectileSystem?: ProjectileSystem;
  private roomClient?: RoomClient;
  private unsubscribeSnapshots?: () => void;
  private playerRig?: ProceduralPlayerRig;
  private readonly remoteRigs = new Map<string, ProceduralPlayerRig>();
  private readonly remoteSnapshots = new Map<string, MatchPlayerSnapshot>();
  private cameraTarget?: Phaser.GameObjects.Zone;
  private reticle?: Phaser.GameObjects.Graphics;
  private debugText?: Phaser.GameObjects.Text;
  private weaponText?: Phaser.GameObjects.Text;
  private targetGraphics?: Phaser.GameObjects.Graphics;
  private targetText?: Phaser.GameObjects.Text;
  private destructibleGraphics?: Phaser.GameObjects.Graphics;
  private fireGraphics?: Phaser.GameObjects.Graphics;
  private pickupGraphics?: Phaser.GameObjects.Graphics;
  private keys?: MovementKeys;
  private movementDebug: MovementDebug = { coyoteMs: 0, jumpBufferMs: 0 };
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
  private shieldCharge = 100;
  private shieldActive = false;
  private temporaryShieldMs = 0;
  private overchargeMs = 0;
  private lastPickupStatus = "none";
  private shieldGraphics?: Phaser.GameObjects.Graphics;
  private roomCode?: string;
  private roomId?: string;
  private matchId?: string;
  private localPlayerId = "offline-player";
  private roomPlayers: RoomPlayer[] = [];
  private snapshotSendTimerMs = 0;
  private snapshotSequence = 0;
  private networkStatus = "offline playground";
  private chaosModifierIds: ChaosModifierId[] = [];
  private fireHazardTimerMs = 0;

  constructor() {
    super("MatchScene");
  }

  init(data: MatchSceneInitData = {}) {
    this.roomId = data.roomId;
    this.roomCode = data.roomCode;
    this.matchId = data.matchId;
    this.localPlayerId = data.localPlayerId ?? "offline-player";
    this.roomPlayers = data.players ?? [];
    this.chaosModifierIds = data.chaosModifierIds ?? readStoredChaosModifiers();
    this.fireHazardTimerMs = 0;
    this.networkStatus = this.roomCode
      ? `room ${this.roomCode}  players ${Math.max(1, this.roomPlayers.length)}`
      : "offline playground";
  }

  create() {
    this.events.once("shutdown", () => {
      this.teardownNetworkSync();
      this.audio?.destroy();
      this.audio = undefined;
    });
    this.teardownNetworkSync();
    this.audio?.destroy();
    this.audio = new GameAudioSystem(this);
    this.projectileSystem?.destroy();
    this.destroyPlayerVisuals();
    this.target = createTestTarget();
    this.destructibles = createDestructibleStates();
    this.pickups = createPickupStates();
    this.firePatches = [];
    this.shieldCharge = 100;
    this.shieldActive = false;
    this.temporaryShieldMs = 0;
    this.overchargeMs = 0;
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
    this.bindKeys();
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
    this.updateShield(scaledDeltaMs);
    const wasGrounded = this.playerBody.grounded;
    const input = this.readInput();
    this.movementDebug = this.movement.update(
      this.playerBody,
      input,
      boxworksWorld.platforms,
      scaledDeltaSeconds,
      {
        speedMultiplier: this.getLocalCharacter().moveSpeedMultiplier,
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

    const title = this.add
      .text(32, 26, "BOXWORKS", {
        color: "#f7fbff",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "28px",
        fontStyle: "900",
      })
      .setShadow(0, 3, "#000000", 8);
    title.setScrollFactor(0);

    const help = this.add.text(34, 60, "A/D move  W/Space jump  S crouch/fast fall  Shift shield  Left click fire  collect card caches  R reset", {
      color: "#9ba7b8",
      fontFamily: "Inter, Arial, sans-serif",
      fontSize: "14px",
    });
    help.setScrollFactor(0);
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
    this.debugText = this.add.text(34, 84, "", {
      color: "#50e3c2",
      fontFamily: "Consolas, monospace",
      fontSize: "13px",
      lineSpacing: 4,
    });
    this.debugText.setScrollFactor(0);
    this.updateDebugText();
  }

  private createWeaponOverlay() {
    this.weaponText = this.add.text(610, 24, "", {
      color: "#dff7ff",
      fontFamily: "Consolas, monospace",
      fontSize: "12px",
      lineSpacing: 4,
    });
    this.weaponText.setScrollFactor(0);
    this.updateWeaponOverlay();
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
    };
  }

  private readInput(): MovementInput {
    if (!this.keys) {
      return {
        left: false,
        right: false,
        jumpPressed: false,
        jumpHeld: false,
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
      fastFall: this.keys.s.isDown && !this.playerBody.grounded,
      crouch: this.keys.s.isDown,
    };
  }

  private syncPlayerVisuals(deltaMs = 16) {
    if (!this.playerRig) {
      return;
    }

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
    this.shieldActive = canShield && this.keys.shift.isDown && this.shieldCharge > 0;

    if (this.shieldActive) {
      this.shieldCharge = Math.max(0, this.shieldCharge - deltaMs * 0.036);
      if (this.shieldCharge <= 0) {
        this.shieldActive = false;
      }
      return;
    }

    this.shieldCharge = Math.min(100, this.shieldCharge + deltaMs * 0.014);
  }

  private drawShield() {
    if (!this.shieldGraphics) {
      return;
    }

    this.shieldGraphics.clear();
    if (!this.shieldActive) {
      return;
    }

    const radius = Math.max(this.playerBody.size.x, this.playerBody.size.y) * 0.82;
    this.shieldGraphics.fillStyle(0x93c5fd, 0.08);
    this.shieldGraphics.fillCircle(this.playerBody.position.x, this.playerBody.position.y, radius);
    this.shieldGraphics.lineStyle(2, 0x93c5fd, 0.62);
    this.shieldGraphics.strokeCircle(this.playerBody.position.x, this.playerBody.position.y, radius);
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
      });
    }
  }

  private setupNetworkSync() {
    if (!this.roomId || !this.matchId) {
      return;
    }

    const convexUrl = import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL;
    if (!convexUrl) {
      this.networkStatus = "online match: missing Convex URL";
      return;
    }

    this.roomClient = new RoomClient(convexUrl);
    this.unsubscribeSnapshots = this.roomClient.subscribeMatchPlayerSnapshots(
      this.matchId,
      (snapshots) => this.applyRemoteSnapshots(snapshots),
      () => {
        this.networkStatus = "snapshot sync interrupted";
      },
    );
    this.networkStatus = `room ${this.roomCode ?? "------"}  syncing ${this.roomPlayers.length} players`;
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
    const build: ResolvedWeaponBuild = {
      ...this.weaponBuild,
      damage: this.weaponBuild.damage * chaos.damageMultiplier * (overcharged ? 1.25 : 1),
      fireRate: Math.max(0.2, this.weaponBuild.fireRate * chaos.fireRateMultiplier * (overcharged ? 1.2 : 1)),
      recoilImpulse: this.weaponBuild.recoilImpulse * chaos.recoilMultiplier,
      projectile: { ...this.weaponBuild.projectile },
      cards: this.weaponBuild.cards,
      occupiedBuckets: this.weaponBuild.occupiedBuckets,
    };

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
      sequence: this.snapshotSequence,
    }).catch(() => {
      this.networkStatus = "snapshot write failed";
    });
  }

  private applyRemoteSnapshots(snapshots: MatchPlayerSnapshot[]) {
    for (const snapshot of snapshots) {
      if (snapshot.playerId === this.localPlayerId) {
        this.reconcileLocalSnapshot(snapshot);
        continue;
      }

      const previous = this.remoteSnapshots.get(snapshot.playerId);
      this.remoteSnapshots.set(snapshot.playerId, previous
        ? smoothSnapshot(previous, snapshot)
        : snapshot);
    }

    this.networkStatus = `room ${this.roomCode ?? "------"}  snapshots ${snapshots.length}`;
  }

  private reconcileLocalSnapshot(snapshot: MatchPlayerSnapshot) {
    if (this.playerRespawnPending) {
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
    if (!this.projectileSystem || this.fireCooldownMs > 0) {
      return;
    }

    const pointer = this.input.activePointer;
    if (!pointer.isDown || pointer.rightButtonDown()) {
      return;
    }

    const origin = this.getMuzzlePosition();
    const aimTarget = this.getAimTarget();
    const aimAngle = Math.atan2(aimTarget.y - origin.y, aimTarget.x - origin.x);
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
    this.fireCooldownMs = 1000 / build.fireRate;
    const recoil =
      (build.recoilImpulse * build.projectile.recoilMultiplier) /
      this.getLocalCharacter().recoilControlMultiplier;
    this.playerBody.velocity.x -= Math.cos(aimAngle) * recoil;
    this.playerBody.velocity.y -= Math.sin(aimAngle) * recoil * 0.45;
    this.applyProjectileHits(result.hits);
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
    }).catch(() => {
      this.networkStatus = "damage write failed";
    });
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

  private damagePlayer(amount: number) {
    if (amount <= 0 || this.playerHealth <= 0 || this.playerRespawnPending) {
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

    this.playerHealth = Math.max(0, this.playerHealth - amount);
    this.audio?.play("hit");
    if (this.playerHealth <= 0) {
      this.killPlayer();
    }
  }

  private killPlayer() {
    if (this.playerRespawnPending) {
      return;
    }

    this.playerRespawnPending = true;
    this.playerBody.velocity = { x: 0, y: 0 };
    this.audio?.play("explosion");
    this.spawnPlayerDeathExplosion(this.playerBody.position);
    this.showDeathPopup();
    this.time.delayedCall(1100, () => this.resetPlayer());
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

  private showDeathPopup() {
    const { width, height } = this.scale;
    const popup = this.add
      .text(width / 2, height * 0.28, "LOL GIT GUD CUNT", {
        color: "#fff7d6",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "34px",
        fontStyle: "900",
        stroke: "#0b0e14",
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1000);

    this.tweens.add({
      targets: popup,
      y: popup.y - 26,
      alpha: 0,
      duration: 980,
      ease: "Sine.easeOut",
      onComplete: () => popup.destroy(),
    });
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
      this.damagePlayer(damage);
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
        this.damagePlayer(patch.dps * deltaSeconds);
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

    this.overchargeMs = Math.max(this.overchargeMs, pickup.durationMs ?? 0);
    this.lastPickupStatus = "overcharge";
    this.floatPickupText(pickup, "overcharge", "#ffd166");
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

    const occupiedBuckets = new Set(this.weaponBuild.occupiedBuckets);
    const eligible = crystalRoundsCards.filter((card) => {
      if (!card.modifier) {
        return false;
      }

      const ownedCount = ownedCounts.get(card.id) ?? 0;
      if (card.unique && ownedCount > 0) {
        return false;
      }
      if (ownedCount >= (card.maxStacks ?? 1)) {
        return false;
      }

      return (card.buckets ?? []).every((bucket) => !occupiedBuckets.has(bucket));
    });

    if (eligible.length === 0) {
      return undefined;
    }

    return Phaser.Utils.Array.GetRandom(eligible);
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

    const { position, velocity, grounded } = this.playerBody;
    const character = this.getLocalCharacter();
    this.debugText.setText([
      this.networkStatus,
      `char ${character.name}  hp ${Math.ceil(this.playerHealth)}/${this.playerMaxHealth}`,
      `shield ${this.shieldActive ? "up" : "ready"} ${Math.round(this.shieldCharge)}%  hold Shift`,
      `pickup ${this.lastPickupStatus}  cards ${this.progressionCardIds.length}  overcharge ${Math.ceil(this.overchargeMs / 1000)}s`,
      `pos ${position.x.toFixed(1)}, ${position.y.toFixed(1)}`,
      `vel ${velocity.x.toFixed(1)}, ${velocity.y.toFixed(1)}`,
      `grounded ${grounded ? "yes" : "no"}`,
      `crouch ${this.playerBody.crouching ? "yes" : "no"}`,
      `coyote ${this.movementDebug.coyoteMs}ms  buffer ${this.movementDebug.jumpBufferMs}ms`,
    ]);
  }

  private updateWeaponOverlay() {
    if (!this.weaponText || !this.projectileSystem) {
      return;
    }

    const cardNames = this.weaponBuild.cards.length > 0
      ? this.weaponBuild.cards.map((card) => card.name).join(", ")
      : "No cards";
    const chaos = this.getChaosProfile();
    const activeBuild = this.createChaosWeaponBuild();

    this.weaponText.setText([
      this.matchId ? `match ${this.matchId.slice(-6)}` : "local match",
      `character ${this.getLocalCharacter().name}  size ${this.getLocalCharacter().sizeScale}x`,
      `world ${WORLD_COLUMNS}x${WORLD_ROWS} screens  camera follow on`,
      `pickups ${this.pickups.filter((pickup) => pickup.available).length}/${this.pickups.length} active`,
      `chaos ${chaos.names.length > 0 ? chaos.names.join(", ") : "none"}`,
      `weapon ${starterWeapon.name}  mutators ${this.progressionCardIds.length}`,
      `delivery ${activeBuild.delivery}  shape ${activeBuild.projectile.shape}`,
      `path ${activeBuild.projectile.pathing}  element ${activeBuild.projectile.element}`,
      `impact ${activeBuild.projectile.impact}  shots ${chaos.disableProjectiles ? 0 : activeBuild.projectile.count}`,
      `dmg ${activeBuild.damage}  rate ${activeBuild.fireRate}/s  active ${this.projectileSystem.activeCount()}`,
      cardNames,
    ]);
  }

  private resetPlayer() {
    const spawn = this.getLocalSpawn();
    const character = this.getLocalCharacter();
    this.playerBody = createPlayerBody(spawn.x, spawn.y, character.sizeScale);
    this.playerMaxHealth = character.maxHealth;
    this.playerHealth = character.maxHealth;
    this.playerRespawnPending = false;
    this.shieldCharge = Math.max(this.shieldCharge, 55);
    this.shieldActive = false;
    this.movement.reset();
    this.movementDebug = { coyoteMs: 0, jumpBufferMs: 0 };
    this.updateCameraTarget();
    this.syncPlayerVisuals();
    this.updateDebugText();
  }

  private rebuildWeaponBuild() {
    const cards = findCardsById(crystalRoundsCards, this.progressionCardIds);
    this.weaponBuild = createWeaponBuild(starterWeapon, cards);
    this.fireCooldownMs = 0;
    this.audio?.play("card");
    this.updateWeaponOverlay();
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

function expandMap(base: MapDefinition, columns: number, rows: number): MapDefinition {
  const platforms: MapDefinition["platforms"] = [];
  const destructibles: MapDefinition["destructibles"] = [];
  const pickups: MapDefinition["pickups"] = [];
  const spawns: MapDefinition["spawns"] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offset = {
        x: column * base.size.x,
        y: row * base.size.y,
      };
      const variant = createCellVariant(column, row);
      const shaftX = offset.x + base.size.x / 2;
      const cellLeft = offset.x;
      const cellRight = offset.x + base.size.x;

      for (const spawn of base.spawns) {
        spawns.push(transformCellPosition(spawn, offset, base, variant, 0.28));
      }

      for (const platform of base.platforms) {
        if (platform.kind === "wall") {
          continue;
        }

        const position = platform.kind === "floor"
          ? { x: platform.position.x + offset.x, y: platform.position.y + offset.y }
          : transformCellPosition(platform.position, offset, base, variant, 1);
        const widthScale = platform.kind === "floor" ? 1 : variant.platformWidthScale;
        const size = {
          x: Math.max(86, platform.size.x * widthScale),
          y: platform.size.y,
        };

        appendPlatformWithShaftGap(platforms, {
          ...platform,
          id: `${platform.id}-${column}-${row}`,
          position,
          size,
        }, shaftX);
      }

      for (const object of base.destructibles) {
        const position = nudgeBoxOutOfShaft(
          transformCellPosition(object.position, offset, base, variant, 1),
          object.size,
          shaftX,
          cellLeft,
          cellRight,
        );
        destructibles.push({
          ...object,
          id: `${object.id}-${column}-${row}`,
          position,
        });
      }

      for (const pickup of base.pickups) {
        const position = nudgeCircleOutOfShaft(
          transformCellPosition(pickup.position, offset, base, variant, 1),
          pickup.radius,
          shaftX,
          cellLeft,
          cellRight,
        );
        pickups.push({
          ...pickup,
          id: `${pickup.id}-${column}-${row}`,
          position,
        });
      }

      const cardCachePosition = nudgeCircleOutOfShaft(
        {
          x: offset.x + variant.cardCacheLocalPosition.x,
          y: offset.y + variant.cardCacheLocalPosition.y,
        },
        18,
        shaftX,
        cellLeft,
        cellRight,
      );
      pickups.push({
        id: `card-cache-${column}-${row}`,
        kind: "card-cache",
        position: cardCachePosition,
        radius: 18,
        amount: 1,
        respawnMs: CARD_CACHE_RESPAWN_MS,
      });
    }
  }

  addTraversalConnectors(platforms, base, columns, rows);

  const worldSize = {
    x: base.size.x * columns,
    y: base.size.y * rows,
  };

  platforms.push(
    {
      id: "world-left-wall",
      kind: "wall",
      position: { x: 34, y: worldSize.y / 2 },
      size: { x: 28, y: worldSize.y },
    },
    {
      id: "world-right-wall",
      kind: "wall",
      position: { x: worldSize.x - 34, y: worldSize.y / 2 },
      size: { x: 28, y: worldSize.y },
    },
  );

  return {
    ...base,
    id: `${base.id}-expanded`,
    name: `${base.name} ${columns}x${rows}`,
    size: worldSize,
    spawns,
    platforms,
    destructibles,
    pickups,
  };
}

type CellVariant = {
  mirror: boolean;
  xJitter: number;
  yJitter: number;
  platformWidthScale: number;
  cardCacheLocalPosition: Vec2;
};

function createCellVariant(column: number, row: number): CellVariant {
  return {
    mirror: seededUnit(column, row, 1) > 0.5,
    xJitter: seededRange(column, row, 2, -52, 52),
    yJitter: seededRange(column, row, 3, -28, 30),
    platformWidthScale: seededRange(column, row, 4, 0.82, 1.18),
    cardCacheLocalPosition: {
      x: seededRange(column, row, 5, 250, 710),
      y: seededRange(column, row, 6, 190, 370),
    },
  };
}

function transformCellPosition(
  localPosition: Vec2,
  offset: Vec2,
  base: MapDefinition,
  variant: CellVariant,
  jitterScale: number,
): Vec2 {
  const mirroredX = variant.mirror ? base.size.x - localPosition.x : localPosition.x;
  return {
    x: Phaser.Math.Clamp(
      offset.x + mirroredX + variant.xJitter * jitterScale,
      offset.x + 82,
      offset.x + base.size.x - 82,
    ),
    y: Phaser.Math.Clamp(
      offset.y + localPosition.y + variant.yJitter * jitterScale,
      offset.y + 138,
      offset.y + base.size.y - 54,
    ),
  };
}

function seededRange(
  column: number,
  row: number,
  salt: number,
  min: number,
  max: number,
): number {
  return min + (max - min) * seededUnit(column, row, salt);
}

function seededUnit(column: number, row: number, salt: number): number {
  const value = Math.sin((column + 1) * 127.1 + (row + 1) * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function addTraversalConnectors(
  platforms: MapDefinition["platforms"],
  base: MapDefinition,
  columns: number,
  rows: number,
) {
  for (let row = 0; row < rows; row += 1) {
    const rowOffsetY = row * base.size.y;
    for (let gap = 1; gap < columns; gap += 1) {
      const gapX = gap * base.size.x;
      platforms.push({
        id: `row-${row}-gap-${gap}-jump-bridge`,
        kind: "platform",
        position: { x: gapX, y: rowOffsetY + 430 },
        size: { x: 116, y: 16 },
      });
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    const boundaryY = (row + 1) * base.size.y;
    for (let column = 0; column < columns; column += 1) {
      const shaftX = column * base.size.x + base.size.x / 2;
      platforms.push(
        {
          id: `row-${row}-column-${column}-upper-climb-left`,
          kind: "platform",
          position: { x: shaftX - 154, y: boundaryY + 62 },
          size: { x: 118, y: 16 },
        },
        {
          id: `row-${row}-column-${column}-middle-climb-right`,
          kind: "platform",
          position: { x: shaftX + 154, y: boundaryY + 142 },
          size: { x: 118, y: 16 },
        },
        {
          id: `row-${row}-column-${column}-lower-climb-left`,
          kind: "platform",
          position: { x: shaftX - 154, y: boundaryY + 222 },
          size: { x: 118, y: 16 },
        },
      );
    }
  }
}

function appendPlatformWithShaftGap(
  platforms: MapDefinition["platforms"],
  platform: MapDefinition["platforms"][number],
  shaftX: number,
) {
  const left = platform.position.x - platform.size.x / 2;
  const right = platform.position.x + platform.size.x / 2;
  const gapLeft = shaftX - VERTICAL_SHAFT_WIDTH / 2;
  const gapRight = shaftX + VERTICAL_SHAFT_WIDTH / 2;

  if (right <= gapLeft || left >= gapRight) {
    platforms.push(platform);
    return;
  }

  const pieces = [
    { id: `${platform.id}-left`, left, right: gapLeft },
    { id: `${platform.id}-right`, left: gapRight, right },
  ];

  for (const piece of pieces) {
    const width = piece.right - piece.left;
    if (width < 36) {
      continue;
    }

    platforms.push({
      ...platform,
      id: piece.id,
      position: {
        x: piece.left + width / 2,
        y: platform.position.y,
      },
      size: {
        x: width,
        y: platform.size.y,
      },
    });
  }
}

function nudgeBoxOutOfShaft(
  position: Vec2,
  size: Vec2,
  shaftX: number,
  cellLeft: number,
  cellRight: number,
): Vec2 {
  return nudgeHorizontalOutOfShaft(position, size.x / 2, shaftX, cellLeft, cellRight);
}

function nudgeCircleOutOfShaft(
  position: Vec2,
  radius: number,
  shaftX: number,
  cellLeft: number,
  cellRight: number,
): Vec2 {
  return nudgeHorizontalOutOfShaft(position, radius, shaftX, cellLeft, cellRight);
}

function nudgeHorizontalOutOfShaft(
  position: Vec2,
  halfWidth: number,
  shaftX: number,
  cellLeft: number,
  cellRight: number,
): Vec2 {
  const gapLeft = shaftX - VERTICAL_SHAFT_WIDTH / 2;
  const gapRight = shaftX + VERTICAL_SHAFT_WIDTH / 2;
  if (position.x + halfWidth <= gapLeft || position.x - halfWidth >= gapRight) {
    return position;
  }

  const padding = 28;
  const preferredX =
    position.x <= shaftX ? gapLeft - halfWidth - padding : gapRight + halfWidth + padding;
  const minX = cellLeft + halfWidth + 52;
  const maxX = cellRight - halfWidth - 52;

  return {
    ...position,
    x: Math.min(maxX, Math.max(minX, preferredX)),
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
