import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import { PALETTE, ARENA_THEMES } from "../ui/palette";
import { PlatformLayer } from "../render/PlatformPainter";
import { LightBeamLayer } from "../render/LightingLayer";
import { transientVfx } from "../render/TransientVfx";
import { boxworksPractice } from "../../sim/data/boxworks-practice.js";
import { PlayerId } from "../../sim/types.js";
import { characters } from "../data/characters";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { TouchControls } from "../input/TouchControls";
import { isPortraitMobile, isTouchPrimary } from "../input/mobile";
import { InputBit } from "../../net/protocol";
import { GameAudioSystem } from "../systems/AudioSystem";
import { ParticlePool } from "../systems/ParticlePool";
import { DeathOverlay } from "../ui/DeathOverlay";
import { LocalPlayerController } from "../systems/LocalPlayerController.js";
import type { InputBitfield } from "../../sim/types.js";
import type {
  CharacterDefinition,
  CharacterId,
  MatchId,
  RoomId,
  Vec2,
} from "../types/game";
import { RenderLayer } from "../render/RenderLayer";
import { ActionIntensity } from "../systems/ActionIntensity.js";
import { ActionCamera } from "../systems/ActionCamera.js";
import { CameraJuice } from "../systems/CameraJuice.js";
import { installHudCamera } from "../systems/HudCamera.js";
import type { RoomPlayer } from "../types/net";

const PLAYER_VISUAL_SCALE = 0.78;
// Desktop crop-in for Practice — matches the online DESKTOP_CAM_ZOOM.
const PRACTICE_CAM_ZOOM = 1.4;
// Portrait mobile: same framing contract as OnlineMatchScene — the camera
// centres BELOW the player so they ride the upper third, clear of the
// bottom touch-control band.
const PORTRAIT_CAM_Y_BIAS = 150;
const DEATH_POPUP_DELAY_MS = 520;

/**
 * Section checkpoints for boxworks-practice, in course order. Respawn goes
 * to the furthest one reached, not the course start — per
 * docs/practice-zone-goal.md item 2 ("never all the way back to the
 * start"). Positions sit a little above each section's resting height,
 * matching the map's own spawn convention, so the drop-in reads the same as
 * the initial spawn. Thresholds are grounded-x checks (see
 * updateCheckpoint()), so a checkpoint only banks once actually stood on,
 * never mid-air over the gap that precedes it.
 */
const CHECKPOINTS: readonly Vec2[] = [
  { x: 150, y: 800 }, // course start
  { x: 700, y: 800 }, // floor-2, past the warm-up gap
  { x: 1400, y: 180 }, // shaft-walkway, past the wall-jump climb
  { x: 2150, y: 180 }, // dash-landing, past the dash gap
];
const RESPAWN_COUNTDOWN_MS = 3000;

type MatchSceneInitData = {
  roomId?: RoomId;
  roomCode?: string;
  matchId?: MatchId;
  localPlayerId?: string;
  players?: RoomPlayer[];
};

type MovementKeys = {
  a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
  r: Phaser.Input.Keyboard.Key;
  /** Dash — matches the online path's binding (parry, which used to share
   *  this key, is gone). */
  c: Phaser.Input.Keyboard.Key;
};

export class MatchScene extends Phaser.Scene {
  // Real physics (wall-jump/wall-slide/dash/wobble-compatible pose data) —
  // the same client/src/sim/player.ts stepPlayer the online path uses,
  // wrapped for a single offline/local player. Replaces the legacy
  // MovementSystem/PlayerBody (deleted — see docs/dev-stream-sim.md).
  private localPlayer!: LocalPlayerController;
  private audio?: GameAudioSystem;
  private platformLayer: PlatformLayer | null = null;
  private lightBeams: LightBeamLayer | null = null;
  private particlePool?: ParticlePool;
  private playerRig?: ProceduralPlayerRig;
  private renderLayer!: RenderLayer;
  private actionCamera!: ActionCamera;
  private cameraJuice!: CameraJuice;
  private readonly actionIntensity = new ActionIntensity();
  private prevWallDir = 0;
  private prevDashing = false;
  /** Ambient haze ellipses (renderArena) + their resting alpha, retained so
   *  environment reactivity can brighten them with action intensity. */
  private hazeEllipses: Array<{ ellipse: Phaser.GameObjects.Ellipse; baseAlpha: number }> = [];
  /** Full-screen additive "energy" glow, scroll-fixed, alpha driven by
   *  action intensity — the theme-independent environment cue (light beams
   *  only exist on some themes). */
  private energyBloom?: Phaser.GameObjects.Rectangle;
  private respawnText?: Phaser.GameObjects.Text;
  private keys?: MovementKeys;
  /** Mobile twin-stick overlay (null on desktop). */
  private touchControls: TouchControls | null = null;
  private lastTouchAim: { x: number; y: number } = { x: 1, y: 0 };
  private playerRespawnPending = false;
  private respawnRemainingMs = 0;
  private respawnCountdownActive = false;
  private deathSequenceId = 0;
  private localPlayerId: PlayerId = PlayerId("offline-player");
  private roomPlayers: RoomPlayer[] = [];
  private deathOverlay?: DeathOverlay;
  private lastCheckpointIndex = 0;

  constructor() {
    super(SceneKeys.Match);
  }

  init(data: MatchSceneInitData = {}) {
    this.localPlayerId = PlayerId(data.localPlayerId ?? "offline-player");
    this.roomPlayers = data.players ?? [];
  }

  create() {
    this.events.once("shutdown", () => {
      this.touchControls?.destroy();
      this.touchControls = null;
      this.audio?.destroy();
      this.audio = undefined;
      this.deathOverlay?.destroy();
      this.deathOverlay = undefined;
      this.particlePool?.destroy();
      this.particlePool = undefined;
    });
    this.input.mouse?.disableContextMenu();
    this.audio?.destroy();
    this.audio = new GameAudioSystem(this);
    this.particlePool?.destroy();
    this.particlePool = new ParticlePool(this);
    this.renderLayer = new RenderLayer(this, this.particlePool);
    this.destroyPlayerVisuals();
    this.clearRespawnText();
    this.playerRespawnPending = false;
    this.respawnRemainingMs = 0;
    this.respawnCountdownActive = false;
    this.deathSequenceId += 1;
    // C1a: bind the TransientVfx coordinator so its spawn calls
    // route to this scene + its drainAll fires on shutdown.
    transientVfx.attach(this);
    // Built once per scene create (collision cache is a bit of work);
    // resetPlayer() below and on every respawn just calls .reset() on it.
    this.localPlayer = new LocalPlayerController(boxworksPractice, this.getLocalSpawn(), this.localPlayerId);
    this.resetPlayer();
    this.renderArena();
    this.configureCamera();
    this.createPlayerVisuals();
    if (!this.deathOverlay) {
      this.deathOverlay = new DeathOverlay("OFF COURSE", "Recovering — try again");
    } else {
      this.deathOverlay.hide();
    }
    this.bindKeys();
    // Split the HUD onto its own 1:1 camera so the world crop-in doesn't drag
    // scroll-fixed HUD off-screen. Installed last so the initial partition
    // sees everything already created.
    installHudCamera(this);
  }

  update(_time: number, deltaMs: number) {
    if (!this.keys || !this.playerRig) {
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
      this.resetPlayer();
    }

    this.updateRespawnCountdown(deltaMs);

    if (this.playerRespawnPending) {
      this.localPlayer.zeroVelocity();
      this.syncPlayerVisuals(deltaMs);
      return;
    }

    const wasGrounded = this.localPlayer.grounded;
    const fallSpeedBeforeStep = this.localPlayer.velocity.y;
    const currKeys = this.readInput();
    const aimTarget = this.getAimTarget();
    // Clamp the physics step like the online path does (1/30s spike guard).
    const physicsStepMs = Math.min(deltaMs, 1000 / 30);
    this.localPlayer.step(currKeys, aimTarget.x, aimTarget.y, physicsStepMs, {
      speedMultiplier: this.getLocalCharacter().moveSpeedMultiplier,
      gravityMultiplier: 1,
      // Practice showcases the baseline+dash traversal kit regardless of
      // drafted cards — there's no draft here to gate it on.
      dashCharges: 1,
    });
    this.playMovementSounds(wasGrounded);
    this.updateMovementJuice(wasGrounded, fallSpeedBeforeStep);
    this.actionIntensity.update(deltaMs);
    this.actionIntensity.dispatchToMusic(deltaMs);
    this.updateEnvironmentReactivity();
    this.updateCheckpoint();

    if (this.isOutOfBounds()) {
      this.killPlayer();
    }
    this.actionCamera.update(deltaMs, {
      x: this.localPlayer.position.x,
      y: this.localPlayer.position.y,
      vx: this.localPlayer.velocity.x,
      vy: this.localPlayer.velocity.y,
      aimX: aimTarget.x,
      aimY: aimTarget.y,
      // Portrait mobile: keep the player above the bottom control band.
      yBias: isPortraitMobile() ? PORTRAIT_CAM_Y_BIAS : 0,
    });
    this.syncPlayerVisuals(deltaMs);
  }

  /**
   * Camera feedback tied to the same movement beats the rig's own
   * squash/stretch sells — landing, wall-jump/power-slide, dash. All via
   * trauma shake (additive on the smoothed follow), NEVER a zoom-punch: a
   * zoom-punch on a frequent movement action pulses the whole frame and
   * reads as instability (this is exactly the "wall-jump plays bad"
   * feedback — the zoom is gone). Also the sole feed into actionIntensity
   * in Practice (no combat here to bump it another way).
   */
  private updateMovementJuice(wasGrounded: boolean, fallSpeedBeforeStep: number): void {
    // Landing: an impact — a real thump scaled by fall speed.
    if (!wasGrounded && this.localPlayer.grounded && fallSpeedBeforeStep > 200) {
      const fallRatio = Phaser.Math.Clamp((fallSpeedBeforeStep - 200) / 700, 0, 1);
      this.cameraJuice.addTrauma(0.18 + fallRatio * 0.4);
      this.actionIntensity.bump(0.12 + fallRatio * 0.18);
    }

    // Wall-jump / power-slide kick-off: the tick touchingWallDir drops back
    // to 0 while still airborne (mirrors the rig's own wall-kick trigger).
    // GENTLE trauma only — the previous zoom-punch here played badly.
    const wallDir = this.localPlayer.touchingWallDir;
    if (this.prevWallDir !== 0 && wallDir === 0 && !this.localPlayer.grounded) {
      const speedRatio = Phaser.Math.Clamp((Math.abs(this.localPlayer.velocity.x) - 400) / 300, 0, 1);
      this.cameraJuice.addTrauma(0.12 + speedRatio * 0.1);
      this.actionIntensity.bump(0.25 + speedRatio * 0.15);
    }
    this.prevWallDir = wallDir;

    // Dash burst: the look-ahead already sells the speed; a small trauma
    // adds a kick without perturbing framing (no zoom).
    if (!this.prevDashing && this.localPlayer.dashing) {
      this.cameraJuice.addTrauma(0.14);
      this.actionIntensity.bump(0.3);
      this.audio?.play("dash");
    }
    this.prevDashing = this.localPlayer.dashing;
  }

  /**
   * The environment reacting to action intensity — same score driving the
   * camera juice and music (see ActionIntensity). The haze ellipses were
   * too faint to read on their own (0.05 alpha × 2.2 is imperceptible), so
   * the main cue is the light beams flaring (additive, very legible); the
   * haze lift (now ~4x) is a supporting glow. Neither touches platforms or
   * the rig — those have their own reactions.
   */
  private updateEnvironmentReactivity(): void {
    const intensity = this.actionIntensity.get();
    for (const { ellipse, baseAlpha } of this.hazeEllipses) {
      ellipse.setAlpha(baseAlpha * (1 + intensity * 3));
    }
    this.lightBeams?.setReactiveBoost(intensity);
    // Eased so the bloom only really shows in the top half of the intensity
    // range — a light jog shouldn't tint the screen, but a firefight should.
    this.energyBloom?.setAlpha(intensity * 0.14);
  }

  private renderArena() {
    const { x: width, y: height } = boxworksPractice.size;
    // Resolve theme from map metadata; fall back to jadeIsles.
    const themeKey = (boxworksPractice.arenaTheme ?? "jadeIsles") as keyof typeof ARENA_THEMES;
    const theme: import("../ui/palette").ArenaTheme = ARENA_THEMES[themeKey] as import("../ui/palette").ArenaTheme;

    // Solid void background — no grid.
    this.add.rectangle(width / 2, height / 2, width, height, theme.bg);

    // Atmospheric back layer: dim overlapping ellipses for parallax depth.
    const bgShade = PALETTE.voidEdge;
    this.add.ellipse(width * 0.3, height * 0.45, width * 0.55, height * 0.4, bgShade, 0.08);
    this.add.ellipse(width * 0.72, height * 0.55, width * 0.5, height * 0.38, bgShade, 0.08);

    // Atmospheric mid-Z haze: 3 large soft ellipses between BG layer and platforms.
    // Slightly lighter than theme.bg to imply depth fog. Alpha 0.04–0.06, depth 0.5.
    // Positions seeded at scene-create (Math.random acceptable — render only, not sim).
    const hazeColor = 0x0e2a35; // ~theme.bg + 8 luminance units (voidDeep variant)
    const hazeDefs: Array<{ rx: number; ry: number; ew: number; eh: number; a: number }> = [
      { rx: 0.18 + Math.random() * 0.15, ry: 0.3 + Math.random() * 0.2, ew: width * 0.7, eh: height * 0.32, a: 0.05 },
      { rx: 0.45 + Math.random() * 0.15, ry: 0.55 + Math.random() * 0.15, ew: width * 0.9, eh: height * 0.4, a: 0.04 },
      { rx: 0.65 + Math.random() * 0.15, ry: 0.35 + Math.random() * 0.2, ew: width * 0.6, eh: height * 0.3, a: 0.06 },
    ];
    this.hazeEllipses = [];
    for (const hd of hazeDefs) {
      const ellipse = this.add
        .ellipse(width * hd.rx, height * hd.ry, hd.ew, hd.eh, hazeColor, hd.a)
        .setDepth(0.5);
      this.hazeEllipses.push({ ellipse, baseAlpha: hd.a });
    }

    if (theme.hasLightBeams) {
      if (!this.lightBeams) this.lightBeams = new LightBeamLayer(this);
      this.lightBeams.spawn(
        [
          { x: width * 0.25, w: 80 },
          { x: width * 0.55, w: 100 },
          { x: width * 0.78, w: 70 },
        ],
        height,
        PALETTE.lightBeamWarm,
        0.1,
      );
    }

    if (!this.platformLayer) this.platformLayer = new PlatformLayer(this);
    this.platformLayer.repaint(boxworksPractice.platforms, theme);
    for (const spawn of boxworksPractice.spawns) {
      this.add.circle(spawn.x, spawn.y, 5, PALETTE.textMid, 0.5);
    }

    // ── Edge vignette ─────────────────────────────────────────────────────────
    // Four dark bands at the world edges — depth cue matching ROUNDS ref.
    // depth=1 so they sit above BG but below platforms/players.
    const vigG = this.add.graphics().setDepth(1);
    vigG.fillStyle(0x000000, 0.52);
    vigG.fillRect(0, 0, width, height * 0.14);          // top
    vigG.fillRect(0, height * 0.86, width, height * 0.14); // bottom
    vigG.fillStyle(0x000000, 0.38);
    vigG.fillRect(0, 0, width * 0.10, height);          // left
    vigG.fillRect(width * 0.90, 0, width * 0.10, height); // right

    // ── Ambient dust motes ────────────────────────────────────────────────────
    // 16 tiny rectangles drifting upward very slowly; scrollFactor 0.6 gives
    // gentle parallax vs camera. Alpha 0.06-0.14 keeps them subliminal.
    this.spawnAmbientMotes(width, height);

    this.energyBloom = this.createEnergyBloom();
  }

  /** A scroll-fixed, full-screen additive glow whose alpha rides action
   *  intensity — the ALWAYS-visible environment reaction (light beams only
   *  exist on some themes, and the haze alone is too faint). Sits below the
   *  players/HUD but above the backdrop, so at peak action the whole frame
   *  warms up like the arena is charging, without washing out the rig. */
  private createEnergyBloom(): Phaser.GameObjects.Rectangle {
    const cam = this.cameras.main;
    return this.add
      .rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0xffc27a, 0)
      .setScrollFactor(0)
      .setDepth(1.5)
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  private spawnAmbientMotes(worldW: number, worldH: number): void {
    const MOTE_COUNT = 16;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const x = Phaser.Math.Between(40, worldW - 40);
      const y = Phaser.Math.Between(40, worldH - 40);
      const sz = Phaser.Math.Between(1, 3);
      const alpha = Phaser.Math.FloatBetween(0.06, 0.15);
      const driftDur = Phaser.Math.Between(4000, 9000);
      const mote = this.add
        .rectangle(x, y, sz, sz, PALETTE.textHi, alpha)
        .setDepth(2);
      // Slow upward drift with yoyo (oscillate vertically)
      this.tweens.add({
        targets: mote,
        y: y - Phaser.Math.Between(30, 80),
        alpha: 0,
        duration: driftDur,
        delay: Phaser.Math.Between(0, 4000),
        ease: "Sine.easeInOut",
        repeat: -1,
        repeatDelay: Phaser.Math.Between(500, 2500),
        yoyo: false,
        onRepeat: () => {
          // Relocate to a new random x so motes don't stack
          mote.x = Phaser.Math.Between(40, worldW - 40);
          mote.y = Phaser.Math.Between(worldH * 0.4, worldH - 40);
          mote.alpha = Phaser.Math.FloatBetween(0.06, 0.15);
        },
      });
    }
  }

  private configureCamera() {
    // Camera bounds with viewport-sized padding. Without padding, the camera
    // clamps so tightly at world edges that the local player visually pins
    // to the screen edge (visible in prod: player at y=1064 in an 1080-tall
    // world with an 800-tall viewport → camera can only scroll to 280, so
    // player ends up 16 px from the bottom of the screen). Padding lets the
    // camera over-scroll into the void backdrop, keeping the player centered.
    // Camera over-pad reduced from 1/2 viewport to 1/6 — see the same
    // change in OnlineMatchScene.renderArena. Half-viewport pad created
    // more void than world on widescreen displays; 1/6 keeps the
    // edge-pinning fix without leaving the rig stranded in an abyss.
    const cam = this.cameras.main;
    const padX = Math.round(cam.width / 6);
    const padY = Math.round(cam.height / 6);
    // Portrait mobile: allow the camera below the floor so the y-biased
    // framing (player in the upper half) doesn't clamp out — the practice
    // world (640 world-px) is SHORTER than a phone viewport, so without
    // this the player pins to the bottom of the screen under the thumbs.
    // 0.5×height mirrors OnlineMatchScene.renderArena (see rationale there).
    const bottomPad = isPortraitMobile() ? Math.round(cam.height * 0.5) : padY;
    cam.setBounds(
      -padX,
      -padY,
      boxworksPractice.size.x + padX * 2,
      boxworksPractice.size.y + padY + bottomPad,
    );
    cam.setRoundPixels(true);
    // Hand-driven action camera (smoothed follow + look-ahead + trauma
    // shake) replaces Phaser's frame-rate-dependent startFollow lerp.
    this.actionCamera = new ActionCamera(cam);
    this.actionCamera.snap(this.localPlayer.position.x, this.localPlayer.position.y);
    // Crop in so the character is the main event (see HudCamera / research).
    // Desktop 1.4; touch stays 1.0 (small screen already frames large, and a
    // precision movement course needs the platform sightlines).
    this.actionCamera.setBaseZoom(isTouchPrimary() ? 1.0 : PRACTICE_CAM_ZOOM);
    // No ActionIntensity passed: Practice bumps intensity explicitly in
    // updateMovementJuice, so routing it here too would double-count.
    this.cameraJuice = new CameraJuice(this.actionCamera);
  }

  private createPlayerVisuals() {
    const localPlayer = this.getLocalRoomPlayer();
    const character = this.getLocalCharacter();
    this.playerRig = new ProceduralPlayerRig(this, {
      color: colorToNumber(localPlayer?.color ?? "#50e3c2"),
      name: `${localPlayer?.name ?? "jakesjam"} / ${character.name}`,
      scale: this.getVisualScale(character),
    });
    this.syncPlayerVisuals();
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
      c: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C),
    };

    // Mobile: spawn the shared twin-stick overlay for offline Practice too,
    // so the Practice button isn't a dead end on phones. No combat buttons
    // — Practice has nothing for Shield/Parry to react to.
    if (isTouchPrimary() && !this.touchControls) {
      this.touchControls = new TouchControls(document.body, { combatButtons: false });
      this.touchControls.attach();
      this.touchControls.setVisible(true);
    }
  }

  /** Current touch bitfield, or null on desktop. Also refreshes lastTouchAim. */
  private touchKeys(): number | null {
    if (!this.touchControls) return null;
    const s = this.touchControls.getState();
    if (s.aimDir) this.lastTouchAim = s.aimDir;
    return s.keys;
  }

  /**
   * Raw input bitfield for stepPlayer. Only the current tick's DOWN state is
   * reported — stepPlayer (via LocalPlayerController's persisted prevKeys)
   * computes jump/dash press/release edges itself from prev-vs-curr, so this
   * must never pre-resolve edges on its own (that was the legacy
   * MovementInput model, and the classic bug shape is two independent
   * edge-trackers reading the same button).
   */
  private readInput(): InputBitfield {
    if (!this.keys) {
      return 0;
    }

    // No round/match wrapper here — Practice has no countdown/results state
    // to lock input during (docs/practice-zone-goal.md item 3). Input is
    // always live except during the death/respawn window (guarded in
    // update() by not calling step() while playerRespawnPending).

    // Mobile: touch controls already report a raw InputBit-encoded bitfield.
    const tk = this.touchKeys();
    if (tk !== null) {
      return tk;
    }

    let bits = 0;
    if (this.keys.a.isDown) bits |= InputBit.Left;
    if (this.keys.d.isDown) bits |= InputBit.Right;
    if (this.keys.w.isDown || this.keys.space.isDown) bits |= InputBit.Jump;
    if (this.keys.s.isDown) bits |= InputBit.Down;
    if (this.keys.s.isDown) bits |= InputBit.Crouch;
    // Aegis power-slide: right mouse (matches the online path) or C.
    if (this.keys.c.isDown || this.input.activePointer.rightButtonDown()) {
      bits |= InputBit.Dash;
    }
    return bits;
  }

  private syncPlayerVisuals(deltaMs = 16) {
    if (!this.playerRig) {
      return;
    }

    if (this.playerRespawnPending) {
      this.playerRig.setVisible(false);
      return;
    }

    this.playerRig.setVisible(true);
    const bodyFeet = {
      x: this.localPlayer.position.x,
      y: this.localPlayer.position.y + this.localPlayer.size.y / 2,
    };
    const aimTarget = this.getAimTarget();

    this.playerRig.update(deltaMs, {
      position: bodyFeet,
      velocity: this.localPlayer.velocity,
      aimTarget,
      grounded: this.localPlayer.grounded,
      crouching: this.localPlayer.crouching,
      // No health/combat here — omitted so the rig's nameplate defaults to
      // a full bar (per docs/practice-zone-goal.md: nothing to report).
      // Real physics now (LocalPlayerController/stepPlayer) — Practice mode
      // can finally show the wall-slide/wall-jump/dash rig poses that were
      // never reachable under the legacy MovementSystem.
      touchingWallDir: this.localPlayer.touchingWallDir,
      dashing: this.localPlayer.dashing,
    });
  }

  private playMovementSounds(wasGrounded: boolean) {
    if (wasGrounded && !this.localPlayer.grounded && this.localPlayer.velocity.y < 0) {
      this.audio?.play("jump");
    } else if (!wasGrounded && this.localPlayer.grounded) {
      this.audio?.play("land");
    }
  }

  private getAimTarget(): Vec2 {
    // Mobile: aim is the player position offset by the right-stick direction
    // (kept from last aim when the thumb lifts).
    if (this.touchControls) {
      const AIM_REACH = 420;
      return {
        x: this.localPlayer.position.x + this.lastTouchAim.x * AIM_REACH,
        y: this.localPlayer.position.y + this.lastTouchAim.y * AIM_REACH,
      };
    }
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
      x: this.localPlayer.position.x + this.localPlayer.facing * 160,
      y: this.localPlayer.position.y - 10,
    };
  }

  /**
   * Recovery from a failed traversal attempt (falling out of bounds) — a
   * pure movement-recovery mechanic, no score/round wrapper. Per
   * docs/practice-zone-goal.md: the death/respawn mechanic stays, the
   * match/scoreboard framing around it doesn't.
   */
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
    this.localPlayer.zeroVelocity();
    this.playerRig?.setVisible(false);
    this.audio?.play("explosion");
    this.spawnPlayerDeathExplosion(this.localPlayer.position);
    this.time.delayedCall(DEATH_POPUP_DELAY_MS, () => {
      if (this.deathSequenceId !== deathSequence || !this.playerRespawnPending) {
        return;
      }
      this.showDeathPopup();
      this.respawnCountdownActive = true;
      this.respawnRemainingMs = RESPAWN_COUNTDOWN_MS;
    });
  }

  private spawnPlayerDeathExplosion(position: Vec2) {
    this.renderLayer.spawnPlayerDeathExplosion(position);
  }

  private spawnRespawnBurst(position: Vec2) {
    this.renderLayer.spawnRespawnBurst(position);
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
    // No round/match machine driving this anymore — the countdown reaching
    // zero IS the respawn trigger.
    if (this.respawnRemainingMs <= 0) {
      this.respawnPlayer();
    }
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

  private respawnPlayer() {
    this.clearRespawnText();
    this.resetPlayer();
    this.spawnRespawnBurst(this.localPlayer.position);
  }

  private resetPlayer() {
    const spawn = CHECKPOINTS[this.lastCheckpointIndex] ?? CHECKPOINTS[0]!;
    this.deathSequenceId += 1;
    this.clearRespawnText();
    this.localPlayer.reset(spawn.x, spawn.y);
    this.playerRespawnPending = false;
    this.respawnRemainingMs = 0;
    this.respawnCountdownActive = false;
    this.playerRig?.setVisible(true);
    // Snap the camera onto the (possibly far-away checkpoint) spawn instead
    // of smearing across the whole level to catch up.
    this.actionCamera?.snap(this.localPlayer.position.x, this.localPlayer.position.y);
    this.syncPlayerVisuals();
  }

  /**
   * Bank the furthest CHECKPOINTS entry actually stood on. Grounded-only so
   * a checkpoint never banks mid-air over the gap that precedes it (e.g.
   * sailing over the dash gap without landing shouldn't count as reaching
   * dash-landing).
   */
  private updateCheckpoint(): void {
    if (!this.localPlayer.grounded) {
      return;
    }
    const x = this.localPlayer.position.x;
    for (let i = this.lastCheckpointIndex + 1; i < CHECKPOINTS.length; i++) {
      if (x < CHECKPOINTS[i]!.x) break;
      this.lastCheckpointIndex = i;
    }
  }

  private isOutOfBounds(): boolean {
    const margin = 180;
    return (
      this.localPlayer.position.y > boxworksPractice.size.y + margin ||
      this.localPlayer.position.x < -margin ||
      this.localPlayer.position.x > boxworksPractice.size.x + margin
    );
  }

  private getLocalSpawn(): Vec2 {
    const spawn = Phaser.Utils.Array.GetRandom(boxworksPractice.spawns);
    return { ...spawn };
  }

  private getLocalRoomPlayer(): RoomPlayer | undefined {
    return this.roomPlayers.find((player) => player.playerId === this.localPlayerId);
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
  }

}


function colorToNumber(color: string): number {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  const parsed = Number.parseInt(normalized, 16);
  return Number.isFinite(parsed) ? parsed : 0x50e3c2;
}
