// Online match scene running on the new netcode path.
// Connects to the Bun game server through Convex matchmaker, runs ClientLoop
// for prediction/reconciliation, and renders the full WorldState (players,
// projectiles, destructibles, fire patches, pickups, satellites) plus a HUD,
// round banner, and SimEvent-driven audio. Reuses the same ProceduralPlayerRig,
// CardDraftOverlay, MatchResultsOverlay, and GameAudioSystem as the offline
// MatchScene so feel parity is good enough to playtest.
//
// Activated by `?netcode=new` on the page URL. Without that flag, lobby start
// boots the existing full-featured MatchScene which still goes through the
// per-frame Convex sync path. The two coexist so we can A/B without breaking
// playable gameplay during the cutover.

import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import { ConvexClient } from "convex/browser";
import {
  ClientLoop,
  WsTransport,
  buildGameServerWsUrl,
  fetchMatchAssignment,
  fetchWorldAssignment,
  InputBit,
  type NetStats,
} from "../../net";
import type { Id } from "../../../../convex/_generated/dataModel";
import { HighlightTracker } from "../highlights/highlightRules";
import { ClipRecorder } from "../highlights/ClipRecorder";
import { showClipShareToast } from "../ui/ClipShareToast";
import {
  STEP_MS,
  crystalRoundsCards,
  type DestructibleEntity,
  type DestructibleKind,
  type FireEntity,
  type MapDefinition,
  type PickupEntity,
  type PickupKind,
  type PlayerEntity,
  PlayerId,
  type SimEvent,
  type WorldState,
} from "../../sim";
import {
  resolveMap,
} from "../../sim/data/maps";
import { hashPlayerEntity } from "../../sim/hash";
import { setActiveCameraGetter, setActiveLocalPlayerIdGetter, setActiveNetStatsGetter, setActiveRigDebugGetter, setActiveStateGetter } from "../../debug/wasmStateProbe";
import { computeBotInput } from "../../debug/botDriver";
import { BOT_RIG_COLOR, botLabel, isBotId, playerTag } from "../ui/botIdentity";
import { characters } from "../data/characters";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { ProceduralAudio } from "../systems/ProceduralAudio";
import {
  CardDraftOverlay,
  type CardPickHandler,
} from "../ui/CardDraftOverlay";
import {
  MatchResultsOverlay,
  type MatchResultsRow,
} from "../ui/MatchResultsOverlay";
import { HudSystem, type HudChip, type HudVitals, type HudRound } from "../ui/HudSystem";
import { RoundBanner } from "../ui/RoundBanner";
import { DeathOverlay } from "../ui/DeathOverlay";
import { ConnectionOverlay } from "../ui/ConnectionOverlay";
import { ParticlePool } from "../systems/ParticlePool";
import { StatusVfxController } from "../systems/StatusVfxController";
import { PlatformLayer } from "../render/PlatformPainter";
import { LightBeamLayer } from "../render/LightingLayer";
import { RenderLayer } from "../render/RenderLayer";
import { transientVfx } from "../render/TransientVfx";
import { EntityRenderCoordinator } from "../render/EntityRenderCoordinator";
import { SimEventRouter } from "../render/SimEventRouter";
import { TouchControls } from "../input/TouchControls";
import { isTouchPrimary, isPortraitMobile } from "../input/mobile";
import { ActionIntensity } from "../systems/ActionIntensity.js";
import { CameraJuice } from "../systems/CameraJuice.js";

// Portrait-mobile camera framing. The arena is 2:1 wide but a phone held
// upright is ~1:2 tall, so we frame the arena HEIGHT into the upper play-area
// and follow the player horizontally, biasing them above centre so the
// bottom control band never covers them. Tunable.
// Camera zoom stays 1.0 in portrait: Phaser scales scroll-fixed HUD objects
// with zoom (pushing them off-screen at zoom>1), and a dedicated UI camera is
// too invasive for this scene. Framing is done entirely via the upward bias +
// extended bottom bounds, which keeps the player in the upper play-area with
// the ground below — no HUD breakage.
const PORTRAIT_CAM_ZOOM = 1.0;
const PORTRAIT_CAM_Y_BIAS = 150; // world px: camera centres BELOW the player → player rides in the upper third, clear of the bottom control band
import { PALETTE, ARENA_THEMES } from "../ui/palette";
import type {
  CardDefinition,
  CharacterDefinition,
  CharacterId,
} from "../types/game";

export type OnlineMatchSceneInit = {
  /**
   * `matchId` is required for the legacy room flow. Omitted when
   * `mode === "world"` — the io-style world has no matchId and skips
   * the Convex matchmaker round-trip entirely.
   */
  matchId?: string;
  localPlayerId: string;
  /** Convex URL is only consulted in `mode === "room"`. Optional for world. */
  convexUrl?: string;
  /** "room" = legacy lobby/Convex flow. "world" = io singleton. */
  mode?: "room" | "world";
};

// PROJECTILE_RADIUS_DEFAULT moved to EntityRenderCoordinator (C2a).
// Mirrors MatchScene's PLAYER_VISUAL_SCALE so online and offline rigs match.
const PLAYER_VISUAL_SCALE = 0.78;
// Sim body heights (sim/player.ts: bodyHeight=56, crouchHeight=38).
// PlayerEntity (x, y) is the body center; rig wants foot position.
const SIM_BODY_HALF_HEIGHT = 28;
const SIM_CROUCH_HALF_HEIGHT = 19;
const LOCAL_PLAYER_FALLBACK_COLOR = 0x50e3c2;
const REMOTE_PLAYER_FALLBACK_COLOR = 0xff88aa;
// Match the offline target. Needed to format "First to N" in the results
// overlay; ClientLoop doesn't expose targetScore, so we mirror the constant
// used by World.create.
const TARGET_SCORE_DEFAULT = 3;

// DAMAGE_FLASH_MS moved to EntityRenderCoordinator (C2a).

/** Color per destructible kind. Mirrors MatchScene.destructibleColor. */
function destructibleColor(kind: DestructibleKind): number {
  const colors: Record<DestructibleKind, number> = {
    barrel: 0xff7a18, // orange
    box: 0x8b5a2b, // brown
    mine: 0xff3b3b, // red
    cube: 0x8a8f99, // gray
  };
  return colors[kind];
}

/** Color per pickup kind. Mirrors MatchScene.pickupColor. */
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

/** Element-based projectile tint. */
function projectileColorByElement(element: string, ownerId: string | null): number {
  switch (element) {
    case "fire":
      return 0xff7a18;
    case "ice":
      return 0x9bf6ff;
    case "lightning":
    case "electric":
      return 0xfde047;
    case "void":
      return 0xa78bfa;
    case "radiant":
      return 0xfff7d6;
    case "toxic":
      return 0x86efac;
    case "sticky":
      return 0xfb923c;
    case "explosive":
      return 0xfb7185;
    case "crystal":
      return 0xf0abfc;
    default:
      // Neutral / unknown: deterministic owner color so shots from the same
      // player still read as "theirs".
      return colorForOwner(ownerId);
  }
}

function colorForOwner(ownerId: string | null): number {
  if (ownerId === null) return 0xffffff; // world-owned: neutral white
  let hash = 0;
  for (let i = 0; i < ownerId.length; i += 1) {
    hash = (hash * 31 + ownerId.charCodeAt(i)) >>> 0;
  }
  const palette = [0x50e3c2, 0xff88aa, 0xffd166, 0x9bf6ff, 0xa0e7a0, 0xcaa7ff];
  return palette[hash % palette.length]!;
}

type BuffDescriptor = {
  key: string;
  field: keyof PlayerEntity;
  label: string;
  color: number;
};

const BUFF_DESCRIPTORS: BuffDescriptor[] = [
  { key: "overcharge", field: "overchargeUntilTick", label: "OC", color: 0xffd166 },
  { key: "damage-amp", field: "damageAmpUntilTick", label: "DMG", color: 0xfb7185 },
  { key: "speed", field: "speedBoostUntilTick", label: "SPD", color: 0x67e8f9 },
  { key: "melee", field: "meleeModeUntilTick", label: "MEL", color: 0xf97316 },
  { key: "boss", field: "bossModeUntilTick", label: "BOSS", color: 0xfff7d6 },
];

const DEBUFF_DESCRIPTORS: BuffDescriptor[] = [
  { key: "slow", field: "slowDebuffUntilTick", label: "SLOW", color: 0xbfdbfe },
  { key: "vuln", field: "vulnerabilityUntilTick", label: "VULN", color: 0xfca5a5 },
  { key: "no-block", field: "blockJammerUntilTick", label: "JAM", color: 0xc084fc },
];

export class OnlineMatchScene extends Phaser.Scene {
  private loop: ClientLoop | null = null;
  private convex: ConvexClient | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  /** Captured from init data so onRematch / onReturnToLobby can branch. */
  private sceneMode: "room" | "world" = "room";
  private playerRigs = new Map<string, ProceduralPlayerRig>();
  /**
   * Phase C2a: extracted out of the scene into
   * `EntityRenderCoordinator`. Owns projectile / satellite sprites
   * + destructible / fire / pickup graphics. Single update() entry
   * per frame.
   */
  private entityRender: EntityRenderCoordinator | null = null;
  /** Phase C2b: SimEvent → audio + shake + overlay routing.
   *  Lazy-init in handleSimEvents because audio + overlays come up
   *  asynchronously during scene boot. */
  private simEventRouter: SimEventRouter | null = null;
  /** Highlight-clip capture (see client/src/game/highlights/). OFF unless the
   *  player opted in via ?clips=1 — this records gameplay to the server, so
   *  it must never activate silently. null when not opted in. */
  private highlightTracker: HighlightTracker | null = null;
  private clipRecorder: ClipRecorder | null = null;
  /** Static arena geometry (platforms, walls, floor, vignette). Drawn
   *  once on hello receipt; never per-frame. */
  private arenaGraphics: Phaser.GameObjects.Graphics | null = null;
  /** Per-frame combat state overlay: shield bubbles + parry arcs for every
   *  player, drawn from wire state (shieldActive / parryActiveUntilTick /
   *  parryFacing). Cleared and redrawn each renderWorld pass. */
  private combatFx: Phaser.GameObjects.Graphics | null = null;
  /** Per-player last shield charge + block-flash timer (shield-block VFX). */
  private readonly shieldPrevCharge = new Map<string, number>();
  private readonly shieldBlockFlash = new Map<string, number>();
  private platformLayer: PlatformLayer | null = null;
  private lightBeams: LightBeamLayer | null = null;
  // Sentinel — overwritten in init(data) before any consumer reads it.
  // Cast bypasses the validating constructor; "" is not a valid PlayerId.
  private localPlayerId: PlayerId = "" as PlayerId;
  private lastFrameMs = 0;
  private keys!: Record<"a" | "d" | "w" | "s" | "space" | "shift" | "dash", Phaser.Input.Keyboard.Key>;
  private statsVisible = false;
  private statsText: Phaser.GameObjects.Text | null = null;
  private statsBg: Phaser.GameObjects.Rectangle | null = null;
  private statsToggleKey: Phaser.Input.Keyboard.Key | null = null;
  /** Always-visible RTT badge (top-right). Independent of toggleable stats HUD. */
  private rttBadge: Phaser.GameObjects.Text | null = null;
  /** Throttle rtt badge updates — per-frame setText is wasteful. */
  private rttBadgeNextUpdateMs = 0;
  private rttBadgeLastValue = -1;
  /** Determinism debug overlay (toggle with F2). Bottom-left tick + hash. */
  private detOverlay: Phaser.GameObjects.Text | null = null;
  private detOverlayVisible = false;
  // Reused buffer so we don't allocate a new string-array each frame.
  private readonly statsLineBuf: string[] = ["", "", "", "", "", ""];

  // ---- New shared UI systems ----
  private hudSystem: HudSystem | null = null;
  private roundBannerSystem: RoundBanner | null = null;
  private deathOverlay: DeathOverlay | null = null;
  private connectionOverlay: ConnectionOverlay | null = null;

  // ---- Audio + overlays ----
  private audio?: ProceduralAudio;
  /** Tracks the local player's shield state to drive shield-up / hum audio. */
  private prevLocalShield = false;
  private cardDraftOverlay?: CardDraftOverlay;
  private matchResultsOverlay?: MatchResultsOverlay;
  private matchHasEnded = false;

  /** Stored on renderArena so spawnPlatformBlastTint can iterate platforms. */
  private currentMap: MapDefinition | null = null;

  // ---- Status VFX + render helpers (sim-authoritative) ----
  private particlePool: ParticlePool | null = null;
  private statusVfx: StatusVfxController | null = null;
  private renderLayer: RenderLayer | null = null;
  /** P3: cinematic combat FX (kill flash/zoom-punch/bloom). Enabled when the
   *  renderer is WebGL and not disabled via ?fx=off. */
  private combatCinematics = false;
  private cameraJuice!: CameraJuice;
  private readonly actionIntensity = new ActionIntensity();
  /** Local-player movement-juice edge detection (landing/wall-jump/dash). */
  private prevLocalGrounded = true;
  private prevLocalWallDir = 0;
  private prevLocalDashing = false;
  private prevLocalVy = 0;
  /** Mobile on-screen twin-stick controls; null on desktop/keyboard. */
  private touchControls: TouchControls | null = null;
  /** Last aim direction from the touch aim-stick, so shots keep heading when
   *  the thumb lifts. */
  private lastTouchAim: { x: number; y: number } = { x: 1, y: 0 };
  // Events arrive via ClientLoop.onEvents; buffer per-frame and drain in update().
  private pendingSimEvents: SimEvent[] = [];
  // Snapshot pending card-offer events queued before the overlay was ready,
  // and remember the last ids we've already shown so we don't reshow the
  // overlay every snapshot if the same event re-fires from the buffer.
  private lastCardOfferKey: string | null = null;

  // ---- Kill-streak tracking (render-only, per combat-balance-ttk taste) ----
  // Track which player ids were alive last frame so we can detect transitions.
  private prevAlive = new Set<string>();
  // Per-killer kill count in the current round for escalating callouts.
  private killStreakCount = new Map<string, number>();

  constructor() {
    super(SceneKeys.OnlineMatch);
  }

  init(data: OnlineMatchSceneInit) {
    this.localPlayerId = PlayerId(data.localPlayerId);
    this.sceneMode = data.mode ?? "room";
    void this.connect(data);
  }

  create() {
    // Match jadeIsles arena theme background (PALETTE.voidDeep = 0x06181C).
    this.cameras.main.setBackgroundColor("#06181C");
    // Right-click triggers parry (InputBit.Ability) — suppress the browser
    // context menu so it's usable in combat. Mirrors MatchScene.
    this.input.mouse?.disableContextMenu();

    // Mobile: spawn the on-screen twin-stick controls. On desktop this stays
    // null and keyboard/mouse drive input as before.
    if (isTouchPrimary()) {
      this.touchControls = new TouchControls();
      this.touchControls.attach();
      this.touchControls.setVisible(true);
    }

    // Portrait-mobile camera framing + re-apply on orientation change.
    this.applyMobileCamera();
    this.scale.on("resize", this.applyMobileCamera, this);
    this.statusText = this.add
      .text(20, 20, "Connecting to game server...", {
        color: "#9aa5b1",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "14px",
      })
      .setScrollFactor(0)
      .setDepth(1000);

    if (this.input.keyboard) {
      this.keys = {
        a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        shift: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
        // Dash (card-gated: inert without a dash card). C is free + reachable.
        dash: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      };
      this.statsToggleKey = this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.BACKTICK,
      );
      this.statsToggleKey.on("down", () => this.toggleStats());
      const detKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F2);
      detKey.on("down", () => this.toggleDetOverlay());
    }

    this.audio = new ProceduralAudio();
    // Web Audio unlocks on a user gesture (matches the global audio-unlock).
    this.input.once("pointerdown", () => this.audio?.unlock());
    this.input.keyboard?.once("keydown", () => this.audio?.unlock());
    this.cardDraftOverlay = new CardDraftOverlay();
    this.matchResultsOverlay = new MatchResultsOverlay();

    // World-space entity render. C2a: was 5 separate fields +
    // helper methods; now one coordinator owns all of them.
    // Pool is pre-allocated (no GC during combat) BEFORE the entity
    // coordinator so projectile VFX (muzzle/trail/impact) can draw from it.
    this.particlePool = new ParticlePool(this);

    // P3: enable cinematic combat FX only on WebGL (camera flash/zoom read
    // poorly on the Canvas fallback) and honor an opt-out flag.
    const rendererType = (this.game.renderer as { type?: number } | undefined)?.type;
    const fxDisabled = new URLSearchParams(window.location.search).get("fx") === "off";
    this.combatCinematics = !fxDisabled && rendererType === Phaser.WEBGL;
    this.cameraJuice = new CameraJuice(this.cameras.main, this.actionIntensity);

    // Highlight-clip capture — EXPLICIT opt-in only (?clips=1). This records
    // gameplay video and uploads it to the server; it must never activate by
    // default. See client/src/game/highlights/ — no consent UI exists yet,
    // so treat this flag as a developer/tester switch, not a shipped feature.
    if (new URLSearchParams(window.location.search).get("clips") === "1") {
      this.highlightTracker = new HighlightTracker();
      this.clipRecorder = new ClipRecorder(this.game.canvas, {
        onUploaded: (url) => {
          console.log(`[clips] uploaded: ${url}`);
          showClipShareToast(url);
        },
        onError: (err) => console.warn("[clips] capture/upload failed:", err),
      });
      this.clipRecorder.start();
      // Debug hook (mirrors client/src/debug/wasmStateProbe.ts's philosophy):
      // lets an external test force a trigger to verify the capture/upload
      // mechanism without depending on rare in-game highlight RNG.
      (window as unknown as { __clipsTrigger?: () => void }).__clipsTrigger = () =>
        this.clipRecorder?.trigger();
    }

    this.entityRender = new EntityRenderCoordinator(
      this,
      {
        projectileColor: (element, ownerId) =>
          projectileColorByElement(element, ownerId),
        drawDestructible: (g, obj, flashing) =>
          drawDestructible(g, obj, flashing),
        drawFirePatch: (g, fire, nowMs) => drawFirePatch(g, fire, nowMs),
        drawPickup: (g, pickup, nowMs) => drawPickup(g, pickup, nowMs),
      },
      this.particlePool,
    );

    this.createStatsHud();
    // Shared HUD/banner/death systems (replace inline text with polished versions)
    this.hudSystem = new HudSystem(this, this.localPlayerId);
    this.roundBannerSystem = new RoundBanner(this);
    this.deathOverlay = new DeathOverlay();
    this.connectionOverlay = new ConnectionOverlay();

    // Status VFX driven by sim state (burnUntilTick / freezeUntilTick) plus
    // chain-hit SimEvents.
    this.statusVfx = new StatusVfxController(this, this.particlePool);
    this.renderLayer = new RenderLayer(this, this.particlePool);
    // C1a: bind TransientVfx so all spawned visuals route here +
    // drain on shutdown.
    transientVfx.attach(this);

    this.lastFrameMs = performance.now();
    this.events.once("shutdown", () => this.teardown());

    // Register the state-probe getter so window.__simStateHash() can
    // read this scene's predicted WorldState from Playwright + the
    // V1/V3/V6 evidence specs. Cleared in teardown().
    setActiveStateGetter(() => this.loop?.getRenderState() ?? null);
    setActiveCameraGetter(() => ({
      scrollX: this.cameras.main.scrollX,
      scrollY: this.cameras.main.scrollY,
    }));
    setActiveLocalPlayerIdGetter(() => this.localPlayerId);
    setActiveNetStatsGetter(() =>
      this.loop
        ? {
            ...this.loop.getNetStats(),
            authRound: this.loop.getAuthoritativeRound(),
            authStateDump: this.loop.getAuthoritativeStateDebug(),
          }
        : null,
    );
    setActiveRigDebugGetter(() => {
      const state = this.loop?.getRenderState() ?? null;
      const rows = [];
      for (const [pid, rig] of this.playerRigs) {
        const info = rig.debugInfo();
        const p = state?.players[pid as PlayerId];
        rows.push({
          pid,
          visible: info.visible,
          x: info.x,
          y: info.y,
          stateX: p?.x ?? null,
          stateY: p?.y ?? null,
          alive: p?.alive ?? null,
        });
      }
      return rows;
    });

    // Sim-loop ↔ Phaser-tick seam (per phaser4-game SKILL.md "Tab-blur is
    // the failure mode"):
    //
    // ClientLoop runs sim ticks on `setInterval(STEP_MS)`. Browsers throttle
    // setInterval to ~1Hz when the tab is hidden but freeze RAF entirely.
    // On return, the sim has advanced N seconds; render hasn't. The reconcile
    // path normally smooths drift over a 100ms window — much smaller than a
    // typical away-time. The jam-friendly choice is to PAUSE the sim loop on
    // BLUR so the local player isn't fighting their own ghost when they
    // return. The server's RECONNECT_GRACE_MS (10s) covers the resulting
    // input gap; longer absences will reconnect via WS close→reopen.
    //
    // We bind to game-level events because Phaser's per-scene 'pause' fires
    // for many reasons (dialog overlay, scene.pause), and we only want to
    // freeze the SIM clock, not the renderer. The handlers no-op if `loop`
    // is null (pre-connect) so they're safe at any lifecycle point.
    const onBlur = () => this.renderHostStop();
    const onFocus = () => this.renderHostStart();
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    this.game.events.on(Phaser.Core.Events.FOCUS, onFocus);
    this.events.once("shutdown", () => {
      this.game.events.off(Phaser.Core.Events.BLUR, onBlur);
      this.game.events.off(Phaser.Core.Events.FOCUS, onFocus);
    });

    this.setupFtueLegend();
  }

  /**
   * Per onboarding-ftue/SKILL.md recipe 3: show a controls legend in the first
   * match only, fade out after 3s, never show again. Persists via localStorage.
   * No modal, no skip button — Mark Brown's rule "the only good tutorial is the
   * one you can't tell is a tutorial".
   */
  private setupFtueLegend(): void {
    const FTUE_KEY = "jakesjam-ftue-controls-shown";
    try {
      if (localStorage.getItem(FTUE_KEY) === "1") return;
      localStorage.setItem(FTUE_KEY, "1");
    } catch {
      // localStorage unavailable (private mode, file://, …). Show every time.
    }
    const lines = this.touchControls
      ? [
          "LEFT STICK  move",
          "PUSH UP  jump",
          "RIGHT STICK  aim & fire",
          "SHIELD / PARRY  buttons",
        ]
      : [
          "WASD  move",
          "SPACE  jump",
          "MOUSE  aim & fire",
          // Shift maps to InputBit.Shield (hold-to-shield); right mouse is the
          // parry (InputBit.Ability).
          "SHIFT  shield",
          "RIGHT CLICK  parry",
        ];
    // y=48: below the always-visible RTT pill (top-right, ~28px tall) so
    // the two don't overlap during the legend's 3s life.
    const text = this.add
      .text(this.scale.width - 20, 48, lines.join("\n"), {
        color: "#cffaff",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "14px",
        align: "right",
        backgroundColor: "rgba(5,8,15,0.45)",
        padding: { left: 10, right: 10, top: 8, bottom: 8 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000)
      .setAlpha(0);
    this.tweens.add({
      targets: text,
      alpha: 1,
      duration: 220,
      ease: "Cubic.easeOut",
    });
    this.time.delayedCall(3000, () => {
      this.tweens.add({
        targets: text,
        alpha: 0,
        duration: 380,
        ease: "Cubic.easeIn",
        onComplete: () => text.destroy(),
      });
    });
  }

  /** Stop the sim loop. Idempotent. Called on tab BLUR. */
  private renderHostStop(): void {
    this.loop?.stop();
  }
  /** Restart the sim loop. Idempotent. Called on tab FOCUS. */
  private renderHostStart(): void {
    this.loop?.start();
  }

  update() {
    if (!this.loop) return;
    const state = this.loop.getRenderState();
    if (!state) return;

    // Translate input to InputBitfield + aim coordinates.
    let keys = 0;
    if (this.keys.a.isDown) keys |= InputBit.Left;
    if (this.keys.d.isDown) keys |= InputBit.Right;
    if (this.keys.w.isDown || this.keys.space.isDown) keys |= InputBit.Jump;
    if (this.keys.s.isDown) keys |= InputBit.Down;
    if (this.keys.s.isDown) keys |= InputBit.Crouch;
    if (
      this.input.activePointer.isDown &&
      !this.input.activePointer.rightButtonDown()
    ) {
      keys |= InputBit.Fire;
    }
    if (this.keys.shift.isDown) keys |= InputBit.Shield;
    if (this.keys.dash.isDown) keys |= InputBit.Dash;
    // Parry: right mouse button -> InputBit.Ability. The sim handles the
    // rising-edge trigger + cooldown (tryStartParry via prevKeys), so we
    // just report the held state like every other key.
    if (this.input.activePointer.rightButtonDown()) keys |= InputBit.Ability;

    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    let aimX = pointer.x + cam.scrollX;
    let aimY = pointer.y + cam.scrollY;

    // Mobile: touch controls REPLACE keyboard/mouse. Movement + fire/shield/
    // parry come from the bitfield; aim is the local player's position plus
    // the right-stick direction (kept from last aim when the thumb lifts, so
    // shots keep their heading).
    if (this.touchControls) {
      const t = this.touchControls.getState();
      keys = t.keys;
      if (t.aimDir) this.lastTouchAim = t.aimDir;
      const me = state.players[this.localPlayerId];
      const AIM_REACH = 420;
      const ox = me?.x ?? aimX;
      const oy = me?.y ?? aimY;
      aimX = ox + this.lastTouchAim.x * AIM_REACH;
      aimY = oy + this.lastTouchAim.y * AIM_REACH;
    }

    // Debug bot autopilot (combat probe): when a goal is set via
    // __setBotInput, it replaces human input for this frame. No-op in
    // normal play — computeBotInput returns null when no goal is set.
    const bot = computeBotInput(state, this.localPlayerId);
    if (bot) {
      keys = bot.keys;
      aimX = bot.aimX;
      aimY = bot.aimY;
    }

    this.loop.setLocalInput({ keys, aimX, aimY });

    const now = performance.now();
    const deltaMs = Math.max(1, Math.min(50, now - this.lastFrameMs));
    this.lastFrameMs = now;

    this.renderWorld(state, deltaMs, now);
    this.followLocalPlayer(state);
    this.updateShieldAudio(state);
    this.updateHudSystem(state);
    this.maybeShowMatchResults(state);
    this.updateLocalMovementJuice(state);
    this.actionIntensity.update(deltaMs);

    if (this.statusVfx) {
      const events = this.pendingSimEvents;
      this.statusVfx.update(state, events, deltaMs, (id) => {
        const p = state.players[id];
        return p ? { x: p.x, y: p.y } : undefined;
      });
      if (events.length > 0) events.length = 0;
    }

    if (this.statsVisible) {
      this.updateStatsHud();
    }
    this.updateRttBadge();
    this.updateDetOverlay(state);
  }

  // ---------------- HUD ----------------

  private repositionHud() {
    this.repositionStatsHud();
  }


  // ---------------- New shared HUD system ----------------

  private updateHudSystem(state: WorldState): void {
    if (!this.hudSystem || !this.roundBannerSystem) return;

    const local = state.players[this.localPlayerId];
    const character = this.getCharacter(local?.characterId);
    const maxHealth = character.maxHealth;

    const chips: HudChip[] = [];
    if (local) {
      for (const buff of BUFF_DESCRIPTORS) {
        const tickValue = local[buff.field] as number | undefined;
        if (typeof tickValue === "number" && tickValue > state.tick) {
          const remainingMs = Math.max(0, (tickValue - state.tick) * STEP_MS);
          chips.push({ label: buff.label, color: buff.color, remainingSec: remainingMs / 1000, isDebuff: false });
        }
      }
      for (const debuff of DEBUFF_DESCRIPTORS) {
        const tickValue = local[debuff.field] as number | undefined;
        if (typeof tickValue === "number" && tickValue > state.tick) {
          const remainingMs = Math.max(0, (tickValue - state.tick) * STEP_MS);
          chips.push({ label: debuff.label, color: debuff.color, remainingSec: remainingMs / 1000, isDebuff: true });
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
      maxHealth,
      shieldCharge: local?.shieldCharge,
      shieldMaxCharge: local?.shieldMaxCharge ?? 0,
      jetpackFuel: local?.jetpackFuel,
      chips,
      cardNames,
      isDead: !local || local.health <= 0 || !local.alive,
    };

    const scores = state.round.scores;

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
      scores,
      winnerLabel,
    };

    this.hudSystem.update(vitals, round);

    if (!this.matchHasEnded) {
      this.roundBannerSystem.update({
        phase: state.round.phase,
        countdownRemainingMs: state.round.countdownRemainingMs,
        roundIndex: state.round.roundIndex,
        winnerLabel,
      });
    }
  }

  // ---------------- Net stats overlay ----------------

  private createStatsHud() {
    const cam = this.cameras.main;
    const panelWidth = 220;
    const panelHeight = 110;
    const x = cam.width - panelWidth - 12;
    const y = 12;
    this.statsBg = this.add
      .rectangle(x, y, panelWidth, panelHeight, 0x000000, 0.55)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setStrokeStyle(1, 0x50e3c2, 0.5)
      .setVisible(false)
      .setDepth(950);
    this.statsText = this.add
      .text(x + 8, y + 6, "", {
        color: "#dfe7ee",
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: "12px",
        lineSpacing: 2,
      })
      .setScrollFactor(0)
      .setVisible(false)
      .setDepth(951);

    // Always-visible RTT pill. Anchored top-right; color-coded by latency.
    this.rttBadge = this.add
      .text(cam.width - 12, 12, "—ms", {
        color: "#94a3b8",
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: "11px",
        backgroundColor: "rgba(5,8,15,0.55)",
        padding: { left: 8, right: 8, top: 4, bottom: 4 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(960);

    // Determinism debug overlay (F2). Hidden by default.
    this.detOverlay = this.add
      .text(12, cam.height - 12, "", {
        color: "#cffaff",
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        fontSize: "11px",
        backgroundColor: "rgba(5,8,15,0.65)",
        padding: { left: 8, right: 8, top: 4, bottom: 4 },
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(960)
      .setVisible(false);
  }

  private repositionStatsHud() {
    if (!this.statsBg || !this.statsText) return;
    const cam = this.cameras.main;
    const panelWidth = (this.statsBg.width as number) || 220;
    const x = cam.width - panelWidth - 12;
    const y = 12;
    this.statsBg.setPosition(x, y);
    this.statsText.setPosition(x + 8, y + 6);
    // RTT pill anchors to top-right regardless of stats panel state.
    this.rttBadge?.setPosition(cam.width - 12, this.statsVisible ? y + (this.statsBg.height as number) + 6 : 12);
  }

  private toggleStats() {
    this.statsVisible = !this.statsVisible;
    this.statsBg?.setVisible(this.statsVisible);
    this.statsText?.setVisible(this.statsVisible);
    if (this.statsVisible) this.updateStatsHud();
  }

  private updateStatsHud() {
    if (!this.loop || !this.statsText) return;
    const stats: NetStats = this.loop.getNetStats();
    const buf = this.statsLineBuf;
    buf[0] = `RTT       ${stats.rttMs.toFixed(1)} ms`;
    buf[1] = `Snap rate ${stats.snapRateHz} Hz`;
    buf[2] = `Pending   ${stats.pendingInputs}`;
    buf[3] = `Δ pred    ${stats.lastPredictDeltaPx.toFixed(2)} px`;
    buf[4] = `Last tick ${stats.lastSnapshotTick}`;
    buf[5] = `Conn      ${stats.transportState}`;
    this.statsText.setText(buf);
  }

  private updateRttBadge() {
    if (!this.rttBadge || !this.loop) return;
    // Throttle: badge updates 4×/s. Avoids per-frame setText / setColor cost.
    const now = performance.now();
    if (now < this.rttBadgeNextUpdateMs) return;
    this.rttBadgeNextUpdateMs = now + 250;
    const rttRaw = this.loop.getNetStats().rttMs;
    const rtt = rttRaw > 0 ? Math.round(rttRaw) : -1;
    if (rtt === this.rttBadgeLastValue) return;
    this.rttBadgeLastValue = rtt;
    let color = "#86efac"; // green
    if (rtt > 180) color = "#fb7185"; // red
    else if (rtt > 80) color = "#fde68a"; // amber
    this.rttBadge.setText(rtt > 0 ? `${rtt}ms` : "—ms");
    this.rttBadge.setColor(color);
  }

  private toggleDetOverlay() {
    this.detOverlayVisible = !this.detOverlayVisible;
    this.detOverlay?.setVisible(this.detOverlayVisible);
  }

  private updateDetOverlay(state: WorldState) {
    if (!this.detOverlayVisible || !this.detOverlay) return;
    // Lightweight per-tick fingerprint. Sum of player-entity hashes —
    // catches position / health / status drift across hosts.
    let h = 0;
    for (const pid in state.players) {
      const p = state.players[pid as PlayerId];
      if (p) h = (h ^ hashPlayerEntity(p)) >>> 0;
    }
    this.detOverlay.setText(
      `tick ${state.tick}\nplayers ${Object.keys(state.players).length}\nhash 0x${h.toString(16).padStart(8, "0")}`,
    );
  }

  // ---------------- Connect ----------------

  private async connect(data: OnlineMatchSceneInit) {
    try {
      const wsUrl = await this.resolveWsUrl(data);
      this.setStatus("Opening WebSocket...");
      const transport = new WsTransport({ url: wsUrl });
      this.loop = new ClientLoop({
        transport,
        matchId: data.matchId ?? "world",
        playerId: data.localPlayerId,
        onAuthoritativeApplied: () => {
          this.setStatus(""); // hide status once we start receiving snapshots
          this.connectionOverlay?.hide();
        },
        onHello: (hello) => {
          // Server told us which map this match runs on. Render its
          // geometry now so the player isn't dropped into a black void
          // before the first snapshot.
          this.renderArena(hello.mapId);
          // World recycle: after a completed match the server rebuilds the
          // world and re-hellos every socket. Clear the stale results
          // overlay so players roll straight into the new match.
          if (this.matchHasEnded) {
            this.matchHasEnded = false;
            this.matchResultsOverlay?.hide();
            this.setStatus("");
          }
        },
        onEvents: (events) => this.handleSimEvents(events),
        onReconnectAttempt: (attempt, nextDelayMs) =>
          this.connectionOverlay?.show({ kind: "reconnecting", attempt, nextDelayMs }),
      });
      transport.onClose((reason) => {
        this.setStatus(`Disconnected: ${reason}`);
        this.connectionOverlay?.show({ kind: "lost", reason });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      this.setStatus(`Connect failed: ${msg}`);
    }
  }

  private async resolveWsUrl(data: OnlineMatchSceneInit): Promise<string> {
    if (data.mode === "world") {
      this.setStatus("Joining live world...");
      const assignment = await fetchWorldAssignment(data.localPlayerId);
      return assignment.wsUrl;
    }
    if (!data.matchId || !data.convexUrl) {
      throw new Error("room mode requires matchId + convexUrl");
    }
    this.convex = new ConvexClient(data.convexUrl);
    this.setStatus("Fetching match assignment from Convex...");
    const assignment = await fetchMatchAssignment(
      this.convex,
      data.matchId as Id<"matches">,
      data.localPlayerId,
    );
    this.setStatus(`Opening WebSocket to ${assignment.region ?? "host"}...`);
    return buildGameServerWsUrl(assignment, data.matchId);
  }

  // ---------------- Sim event → audio + overlays ----------------

  private handleSimEvents(events: SimEvent[]) {
    // Forward all events to the per-frame VFX drain buffer (filters internally).
    if (events.length > 0) {
      for (const e of events) this.pendingSimEvents.push(e);
    }
    // Highlight capture — independent of audio readiness, opt-in only (?clips=1).
    if (this.highlightTracker && this.clipRecorder) {
      const highlights = this.highlightTracker.ingest(events, performance.now());
      for (const h of highlights) {
        console.log(`[clips] highlight: ${h.label} (${h.playerId})`);
        this.clipRecorder.trigger();
      }
    }
    if (!this.audio) return;
    // C2b: per-event dispatch lives in SimEventRouter. The 120-line
    // switch was inline here. Lazy-init the router on first use so
    // it picks up the now-ready audio + overlay refs.
    if (!this.simEventRouter) {
      this.simEventRouter = new SimEventRouter({
        scene: this,
        audio: this.audio,
        localPlayerId: this.localPlayerId,
        safeShake: (durationMs, intensity) => this.safeShake(durationMs, intensity),
        spawnDamageNumber: (vid, dmg) => this.spawnDamageNumber(vid, dmg),
        spawnBlastAtPlayer: (pid, r, d) => this.spawnBlastAtPlayer(pid, r, d),
        killCinematic: (vid) => this.killCinematic(vid),
        shotAudioParams: (pid) => this.resolveShotAudioParams(pid),
        spawnPlatformBlastTint: (pos) => this.spawnPlatformBlastTint(pos),
        showCardDraft: (cardIds) => this.showCardDraft(cardIds),
        hideCardDraft: () => this.cardDraftOverlay?.hide(),
        playerRigs: this.playerRigs,
        particlePool: this.particlePool,
        renderLayer: this.renderLayer,
        killStreakCount: this.killStreakCount,
        prevAlive: this.prevAlive,
      });
    }
    for (const event of events) {
      this.simEventRouter.dispatch(event);
    }
  }

  private showCardDraft(cardIds: string[]) {
    if (!this.cardDraftOverlay) return;
    const key = cardIds.join("|");
    if (this.lastCardOfferKey === key && this.cardDraftOverlay.isOpen()) {
      // Same offer, overlay already visible — nothing to do.
      return;
    }
    this.lastCardOfferKey = key;
    const candidates = cardIds
      .map((id) => crystalRoundsCards.find((c) => c.id === id))
      .filter((c): c is CardDefinition => Boolean(c));
    if (candidates.length === 0) return;
    // Hide the death overlay so the picker is fully readable + clickable.
    this.deathOverlay?.hide();
    const onPick: CardPickHandler = (card) => {
      const state = this.loop?.getRenderState();
      if (!state || !this.loop) return;
      this.loop.sendCardPick(state.round.roundIndex, card.id);
    };
    this.cardDraftOverlay.show(candidates, onPick);
  }

  private spawnDamageNumber(victimId: string, damage: number) {
    const state = this.loop?.getRenderState();
    if (!state) return;
    const victim = state.players[PlayerId(victimId)];
    if (!victim || damage < 1) return;
    const isLocal = victimId === this.localPlayerId;
    const spread = (Math.random() - 0.5) * 22;

    // Damage tiers: light <15, medium 15–29, heavy 30+.
    // Per game-feel-juice/SKILL.md: bigger impacts need bigger reactions.
    const isHeavy = damage >= 30;
    const isMedium = damage >= 15;
    const fontSize = isHeavy ? "22px" : isMedium ? "17px" : "13px";
    // Overshoot scale: punch in at 1.4× then settle to 1.0 (Nijman's "tweened spawning").
    const spawnScale = isHeavy ? 1.6 : isMedium ? 1.35 : 1.2;
    const color = isLocal ? "#fb7185" : isHeavy ? "#ffffff" : "#fff7d6";

    const text = this.add
      .text(victim.x + spread, victim.y - 36, Math.round(damage).toString(), {
        color,
        fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
        fontSize,
        fontStyle: "900",
        stroke: "#05080f",
        strokeThickness: isHeavy ? 4 : 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(800)
      .setScale(spawnScale);

    // Two-phase: overshoot pop (Back.easeOut) then float-up + fade.
    this.tweens.add({
      targets: text,
      scaleX: 1,
      scaleY: 1,
      duration: 120,
      ease: "Back.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: text,
          y: text.y - (isHeavy ? 44 : 28),
          alpha: 0,
          duration: isHeavy ? 700 : 560,
          ease: "Sine.easeOut",
          onComplete: () => text.destroy(),
        });
      },
    });
  }

  /**
   * Resolve procedural-audio params for a shot by its firing player: the
   * element comes from that player's most recent live projectile (so the
   * sound matches the actual round fired). Best-effort — undefined falls back
   * to a neutral shot.
   */
  private resolveShotAudioParams(
    playerId: string,
  ):
    | { element?: string; charge?: number; heavy?: boolean; shape?: string; impact?: string; pathing?: string }
    | undefined {
    const state = this.loop?.getRenderState();
    if (!state) return undefined;
    // The newest live projectile owned by this player carries the FULL card
    // build (element/shape/impact/pathing), so every draft card is audible.
    let newest: { id: number; proj: (typeof state.projectiles)[keyof typeof state.projectiles] } | undefined;
    for (const [idStr, proj] of Object.entries(state.projectiles)) {
      if (proj.ownerId !== playerId) continue;
      const id = Number(idStr);
      if (!newest || id > newest.id) newest = { id, proj };
    }
    const player = state.players[PlayerId(playerId)];
    const charge =
      player?.overchargeUntilTick !== undefined && (player.overchargeUntilTick as number) > state.tick
        ? 0.7
        : 0;
    const heavy = player?.characterId === "heavy";
    const proj = newest?.proj;
    return {
      element: proj?.element,
      shape: proj?.shape,
      impact: proj?.impact,
      pathing: proj?.pathing,
      charge,
      heavy,
    };
  }

  /**
   * Drive shield-up / continuous hum audio off the LOCAL player's shield
   * state. Called each frame; edge-detects the shieldActive transition.
   */
  private updateShieldAudio(state: WorldState): void {
    if (!this.audio) return;
    const me = state.players[this.localPlayerId];
    const active = me?.shieldActive === true && me.alive;
    if (active && !this.prevLocalShield) this.audio.play("shield-up");
    else if (!active && this.prevLocalShield) this.audio.setShieldHum(false);
    this.prevLocalShield = active;
  }

  /** Spawn a visual blast at the current world position of a player entity. */
  private spawnBlastAtPlayer(playerId: string, radius: number, damage: number): void {
    if (!this.renderLayer) return;
    const state = this.loop?.getRenderState();
    if (!state) return;
    const player = state.players[PlayerId(playerId)];
    if (!player) return;
    this.renderLayer.spawnExplosionBlast({ x: player.x, y: player.y }, radius, damage);
  }

  /**
   * P3 (docs/vfx-spec.md) — cinematic KILL moment: camera flash + micro
   * zoom-punch + an additive bloom pop at the victim. Built on Phaser 4's
   * built-in camera FX (Phaser 4.1 dropped the PostFXPipeline API, so no
   * fragment-shader bloom — the additive-glow layer is the bloom). Gated by
   * `combatCinematics` so it's off on Canvas fallback or `?fx=off`.
   */
  private killCinematic(victimId: string): void {
    if (!this.combatCinematics) return;
    const cam = this.cameras.main;
    // Brief warm flash — sells the "everything pops" beat over the hit-stop.
    cam.flash(90, 255, 240, 200, false);
    // Zoom-punch: snap in ~4% then ease back.
    this.cameraJuice.punchZoom(cam.zoom * 0.04, 70, 200);
    // Additive bloom pop at the victim.
    const state = this.loop?.getRenderState();
    const victim = state?.players[PlayerId(victimId)];
    const pool = this.particlePool;
    if (victim && pool) {
      const glow = pool.acquireGlow();
      if (glow) {
        glow
          .setPosition(victim.x, victim.y)
          .setTint(0xffe9c0)
          .setAlpha(0.9)
          .setScale(0.4)
          .setDepth(7)
          .setBlendMode(1);
        this.tweens.add({
          targets: glow,
          alpha: 0,
          scaleX: 1.6,
          scaleY: 1.6,
          duration: 300,
          ease: "Quad.easeOut",
          onComplete: () => pool.release(glow),
        });
      }
    }
  }

  // ---------------- Arena (static geometry) ----------------

  /**
   * Draw the arena's platforms, walls, floor, and a subtle backdrop.
   * Called exactly once per match on `onHello` (we don't switch maps
   * mid-match). Sets camera bounds to the map size so the cyan motes +
   * arena + camera follow agree on world coordinates.
   *
   * Crystal-tech-wizard palette (per `docs/art-direction.md` +
   * `.claude/skills/phaser4-game/SKILL.md`):
   * - Floor / walls: cyan-tinted slate, accent border at top edge
   * - Platforms (drop-through): translucent crystal cyan, glow halo
   * - Subtle vertical gradient backdrop so the world isn't black
   * - 80px grid lines at 3% alpha — sells "geometric world" brief
   */
  private renderArena(mapId: string): void {
    const map: MapDefinition = resolveMap(mapId);
    this.currentMap = map;
    const { x: width, y: height } = map.size;
    const themeKey = (map.arenaTheme ?? "jadeIsles") as keyof typeof ARENA_THEMES;
    const theme = ARENA_THEMES[themeKey] as import("../ui/palette").ArenaTheme;

    // Diagnostic: confirms the hello → render hop ran. One log per match
    // (renderArena fires once on first ServerHello; tear-down + re-attach
    // would log again, which is intentional). If this never appears in the
    // console, the bug is upstream — `onHello` never fired or the WS hello
    // never landed; check ClientLoop.applyHello / WsTransport state.
    console.info(
      `[OnlineMatchScene] renderArena: requested="${mapId}" → resolved="${map.id}" ` +
        `size=${width}x${height} platforms=${map.platforms.length}`,
    );

    // Camera bounds with a small breathing-room pad. Originally the pad was
    // half a viewport in each direction — that worked for the edge-pinning
    // problem the comment used to describe, but it created MORE void than
    // world on widescreen viewports (1920×1080 viewport on a 1280×640 world
    // = 540 px of void below the floor). Players reported the rig feeling
    // "stranded floating in an abyss" even when standing perfectly on the
    // floor. Reduce padding to 1/6 of the viewport — enough that a player
    // standing at world-edge isn't visually pinned to screen-edge, but the
    // void around the world is bounded.
    const cam = this.cameras.main;
    const padX = Math.round(cam.width / 6);
    const padY = Math.round(cam.height / 6);
    // Portrait mobile biases the player high on the tall screen (so the bottom
    // control band never covers them). That only works if the camera may drop
    // BELOW the arena floor — otherwise the bottom bound clamps the view and
    // the player slides down behind the controls. Give generous bottom room.
    const bottomPad = isPortraitMobile() ? Math.round(cam.height / 1.4) : padY;
    cam.setBounds(-padX, -padY, width + padX * 2, height + padY + bottomPad);
    cam.setRoundPixels(true);

    // Tear down any previous arena render (e.g. on reconnect to a new match).
    this.arenaGraphics?.destroy();
    const g = this.add.graphics();
    // Explicit negative depth so we render strictly UNDER everything else
    // even when other layers are also at depth 0 (legacy: arenaGraphics used
    // depth 0, but a same-depth tie depends on creation order — fragile when
    // other agents add new layers).
    g.setDepth(-10);
    this.arenaGraphics = g;

    // Backdrop fill — solid theme base first, gradient atmosphere on top.
    //
    // Why both: `fillGradientStyle` is documented as a WebGL-only feature.
    // If the renderer ever falls back to Canvas (WebGL context lost,
    // headless smoke test, old browser) the gradient is a silent no-op
    // and the arena would render fully transparent — only the camera
    // clear-colour would show, reading as "no terrain". The solid fill
    // below guarantees a visible base regardless of backend; the gradient
    // adds atmosphere on WebGL.
    g.fillStyle(theme.bg, 1);
    g.fillRect(0, 0, width, height);
    g.fillGradientStyle(0x0a1424, 0x0a1424, 0x05080f, 0x05080f, 0.95, 0.95, 1, 1);
    g.fillRect(0, 0, width, height);
    // Reset to a flat fill so subsequent platform draws don't accidentally
    // inherit the gradient state (Phaser keeps fill state on the Graphics
    // object across calls).
    g.fillStyle(0xffffff, 1);

    // Atmospheric back layer: dim overlapping ellipses for parallax depth.
    const bgShade = PALETTE.voidEdge;
    this.add.ellipse(width * 0.3, height * 0.45, width * 0.55, height * 0.4, bgShade, 0.08);
    this.add.ellipse(width * 0.72, height * 0.55, width * 0.5, height * 0.38, bgShade, 0.08);

    // Atmospheric mid-Z haze: 3 large soft ellipses between BG layer and platforms.
    const hazeColor = 0x0e2a35;
    const hazeDefs: Array<{ rx: number; ry: number; ew: number; eh: number; a: number }> = [
      { rx: 0.18 + Math.random() * 0.15, ry: 0.3 + Math.random() * 0.2, ew: width * 0.7, eh: height * 0.32, a: 0.05 },
      { rx: 0.45 + Math.random() * 0.15, ry: 0.55 + Math.random() * 0.15, ew: width * 0.9, eh: height * 0.4, a: 0.04 },
      { rx: 0.65 + Math.random() * 0.15, ry: 0.35 + Math.random() * 0.2, ew: width * 0.6, eh: height * 0.3, a: 0.06 },
    ];
    for (const hd of hazeDefs) {
      this.add
        .ellipse(width * hd.rx, height * hd.ry, hd.ew, hd.eh, hazeColor, hd.a)
        .setDepth(0.5);
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
    this.platformLayer.repaint(map.platforms, theme);
  }

  /**
   * Platform warm-tint flash on explosion: platforms within 220px briefly glow.
   * Mirrors MatchScene.spawnPlatformBlastTint.
   */
  private spawnPlatformBlastTint(position: { x: number; y: number }): void {
    if (!this.currentMap) return;
    const BLAST_RANGE = 220;
    for (const platform of this.currentMap.platforms) {
      const cx = platform.position.x;
      const cy = platform.position.y;
      const dist = Math.hypot(cx - position.x, cy - position.y);
      if (dist >= BLAST_RANGE) continue;
      const tintAlpha = 0.10 * (1 - dist / BLAST_RANGE);
      const sizeX = platform.size.x;
      const sizeY = platform.size.y;
      transientVfx.spawn({
        factory: () => {
          const tintRect = this.add.rectangle(
            cx,
            cy,
            sizeX,
            sizeY,
            PALETTE.blastHalo,
            tintAlpha,
          );
          tintRect.setBlendMode(Phaser.BlendModes.ADD);
          tintRect.setDepth(5);
          return tintRect;
        },
        lifetimeMs: 140,
        startAlpha: tintAlpha,
        ease: "Linear",
      });
    }
  }

  // ---------------- World rendering ----------------

  private renderWorld(state: WorldState, deltaMs: number, nowMs: number) {
    // Players — procedurally rigged puppets, matching the offline MatchScene.
    const seenPlayers = new Set<string>();
    // Detect alive→dead transitions this frame for kill-streak callouts.
    const newlyDead: string[] = [];
    for (const [pid, player] of Object.entries(state.players)) {
      seenPlayers.add(pid);
      const wasAlive = this.prevAlive.has(pid);
      const isAlive = player.alive && player.health > 0;
      if (wasAlive && !isAlive) {
        newlyDead.push(pid);
      }
      if (isAlive) {
        this.prevAlive.add(pid);
      } else {
        this.prevAlive.delete(pid);
      }

      let rig = this.playerRigs.get(pid);
      if (!rig) {
        rig = this.makePlayerRig(player, pid === this.localPlayerId);
        this.playerRigs.set(pid, rig);
      }
      this.updatePlayerRig(rig, player, deltaMs);
    }

    // Process kills detected this frame: emit escalating callout banners.
    // We can't know the *killer* from the snapshot alone (no kill event in sim),
    // so we attribute the streak to the local player if the last pending
    // hit-confirmed was against this victim — a reasonable approximation.
    for (const deadPid of newlyDead) {
      const wasLocalKill = this.pendingSimEvents.some(
        (e) => e.t === "hit-confirmed" && e.victimId === deadPid,
      );
      if (wasLocalKill) {
        const prev = this.killStreakCount.get(this.localPlayerId) ?? 0;
        const streak = prev + 1;
        this.killStreakCount.set(this.localPlayerId, streak);
        this.spawnKillCallout(state.players[PlayerId(deadPid)], streak);
      }
    }

    for (const [pid, rig] of this.playerRigs) {
      if (!seenPlayers.has(pid)) {
        rig.destroy();
        this.playerRigs.delete(pid);
      }
    }

    this.drawCombatFx(state);

    this.entityRender?.update(state, deltaMs, nowMs);
  }

  /**
   * Shield bubbles + parry arcs for every player, driven purely by wire
   * state so local AND remote combat reads identically. Mirrors the
   * offline MatchScene visuals (drawShield): blue 0x93c5fd circle while
   * shieldActive; white 0xf7fbff arc slice for the parry window.
   *
   * Sizes come from the sim: body 26x56 -> shield radius 56*0.82 ~= 46;
   * parry visual range mirrors MatchLogic.PARRY_BASE_RANGE (98) and
   * PARRY_ARC_RADIANS (60 deg cone).
   */
  private drawCombatFx(state: WorldState): void {
    if (!this.combatFx) {
      this.combatFx = this.add.graphics().setDepth(12);
    }
    const g = this.combatFx;
    g.clear();
    const SHIELD_RADIUS = 46;
    const PARRY_RANGE = 98;
    const PARRY_ARC = Math.PI / 3;
    for (const player of Object.values(state.players)) {
      if (!player.alive) continue;
      // Shield BLOCK flash: a hit absorbed drops shieldCharge far more than the
      // passive hold-drain (~0.6/frame), so a >5 single-frame drop = a block.
      const pid = player.id as string;
      const charge = player.shieldCharge ?? 0;
      const prevCharge = this.shieldPrevCharge.get(pid);
      if (prevCharge !== undefined && prevCharge - charge > 5 && player.shieldActive) {
        this.shieldBlockFlash.set(pid, 1);
      }
      this.shieldPrevCharge.set(pid, charge);
      const flash = this.shieldBlockFlash.get(pid) ?? 0;
      if (player.shieldActive) {
        g.fillStyle(0x93c5fd, 0.08 + flash * 0.28);
        g.fillCircle(player.x, player.y, SHIELD_RADIUS);
        g.lineStyle(2 + flash * 3, 0x93c5fd, 0.62 + flash * 0.38);
        g.strokeCircle(player.x, player.y, SHIELD_RADIUS);
        // Expanding ripple ring on a block.
        if (flash > 0.02) {
          g.lineStyle(2, 0xdbeafe, flash * 0.75);
          g.strokeCircle(player.x, player.y, SHIELD_RADIUS + (1 - flash) * 24);
        }
      }
      if (flash > 0) this.shieldBlockFlash.set(pid, Math.max(0, flash - 0.14));
      if (
        player.parryActiveUntilTick !== undefined &&
        player.parryActiveUntilTick > state.tick
      ) {
        const facing = player.parryFacing ?? 0;
        g.fillStyle(0xf7fbff, 0.13);
        g.slice(
          player.x,
          player.y,
          PARRY_RANGE,
          facing - PARRY_ARC / 2,
          facing + PARRY_ARC / 2,
          false,
        );
        g.fillPath();
        g.lineStyle(3, 0xf7fbff, 0.82);
        g.beginPath();
        g.arc(
          player.x,
          player.y,
          PARRY_RANGE,
          facing - PARRY_ARC / 2,
          facing + PARRY_ARC / 2,
          false,
        );
        g.strokePath();
      }
    }
  }

  /**
   * Spawn an escalating kill callout banner near the victim's position.
   * Single kill = plain "KILL", double = "DOUBLE KILL" (bigger), triple+ = "MULTI KILL" (biggest).
   * Per combat-balance-ttk/SKILL.md taste section: Crysis-style escalating feedback.
   */
  private spawnKillCallout(victim: PlayerEntity | undefined, streak: number): void {
    if (!victim) return;
    const labels = ["KILL", "DOUBLE KILL", "TRIPLE KILL", "MULTI KILL"];
    const label = labels[Math.min(streak - 1, labels.length - 1)]!;
    const scale = 1 + (streak - 1) * 0.3;
    const fontSize = `${Math.round(14 + (streak - 1) * 5)}px`;
    const color = streak === 1 ? "#fff7d6" : streak === 2 ? "#ffd166" : "#fb7185";

    const text = this.add
      .text(victim.x, victim.y - 60, label, {
        color,
        fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
        fontSize,
        fontStyle: "900",
        stroke: "#05080f",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(801)
      .setScale(scale * 1.4);

    // Overshoot pop in, then float up + fade.
    this.tweens.add({
      targets: text,
      scaleX: scale,
      scaleY: scale,
      duration: 160,
      ease: "Back.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: text,
          y: text.y - 50,
          alpha: 0,
          duration: 900,
          ease: "Sine.easeOut",
          delay: 200,
          onComplete: () => text.destroy(),
        });
      },
    });

    // Extra camera kick for the killer on streak ≥ 2.
    if (streak >= 2) {
      this.safeShake(100, 0.008 + (streak - 2) * 0.003);
    }
  }

  // C2a: renderProjectiles / renderDestructibles / renderFirePatches /
  // renderPickups / renderSatellites moved to EntityRenderCoordinator.
  // The scene now calls `entityRender.update(state, dt, nowMs)` once
  // per frame from renderWorld.

  // ---------------- Player rig wiring ----------------

  private makePlayerRig(player: PlayerEntity, isLocal: boolean): ProceduralPlayerRig {
    const character = this.getCharacter(player.characterId);
    const bot = isBotId(player.id);
    return new ProceduralPlayerRig(this, {
      // Bots render AMBER with a "BOT · NAME" plate — unmistakable next to
      // the teal local / crimson remote rigs.
      color: bot
        ? BOT_RIG_COLOR
        : isLocal
          ? LOCAL_PLAYER_FALLBACK_COLOR
          : REMOTE_PLAYER_FALLBACK_COLOR,
      // No room-roster lookup yet on the netcode path; fall back to the player
      // id suffix + character name so the nameplate is stable + identifiable.
      name: bot ? botLabel(player.id) : `${player.id.slice(-4)} / ${character.name}`,
      scale: this.getVisualScale(character),
    });
  }

  private updatePlayerRig(
    rig: ProceduralPlayerRig,
    player: PlayerEntity,
    deltaMs: number,
  ) {
    if (!player.alive) {
      rig.setVisible(false);
      return;
    }
    rig.setVisible(true);
    const halfHeight = player.crouching ? SIM_CROUCH_HALF_HEIGHT : SIM_BODY_HALF_HEIGHT;
    const character = this.getCharacter(player.characterId);
    rig.update(deltaMs, {
      position: { x: player.x, y: player.y + halfHeight },
      velocity: { x: player.vx, y: player.vy },
      aimTarget: { x: player.aimX, y: player.aimY },
      // PlayerEntity.grounded is wire-encoded as of commit ef365c7 (P_HI
      // bit 4). Falls back to true if the snapshot omits it (older builds
      // or the brief window before the first snap arrives).
      grounded: player.grounded ?? true,
      crouching: player.crouching,
      health: player.health,
      maxHealth: character.maxHealth,
      // touchingWallDir/dashing wire-encoded per P_HI.wallDirNeg/wallDirPos/
      // dashing (same optional/additive pattern as grounded above).
      touchingWallDir: player.touchingWallDir ?? 0,
      dashing: player.dashing ?? false,
    });
  }

  private getCharacter(
    characterId: CharacterId | string | undefined,
  ): CharacterDefinition {
    return (
      characters.find((character) => character.id === characterId) ??
      characters[0]!
    );
  }

  private getVisualScale(character: CharacterDefinition): number {
    return PLAYER_VISUAL_SCALE * character.sizeScale;
  }

  private followLocalPlayer(state: WorldState) {
    const local = state.players[this.localPlayerId];
    if (!local) return;
    // Portrait mobile: bias the player above screen centre so the bottom
    // control band doesn't cover them (centre the camera BELOW the player).
    const yBias = isPortraitMobile() ? PORTRAIT_CAM_Y_BIAS : 0;
    this.cameras.main.centerOn(local.x, local.y + yBias);
  }

  /**
   * Camera juice for the LOCAL player's own movement — landing impact,
   * wall-jump/power-slide kick-off, dash burst. Mirrors MatchScene's
   * updateMovementJuice (same trigger shapes, same tuning) so Practice and
   * real combat feel consistent; combat itself already had shake via
   * safeShake/killCinematic (both now routed through the same CameraJuice,
   * see above) — this just closes the gap where movement alone had none.
   * Never applied to remote players/bots — shaking the camera for a bot's
   * wall-jump off-screen would feel disconnected from what the local
   * player is actually doing.
   */
  private updateLocalMovementJuice(state: WorldState): void {
    const local = state.players[this.localPlayerId];
    if (!local || !local.alive) return;

    if (!this.prevLocalGrounded && local.grounded && this.prevLocalVy > 200) {
      const fallRatio = Phaser.Math.Clamp((this.prevLocalVy - 200) / 700, 0, 1);
      this.cameraJuice.safeShake(90 + fallRatio * 80, 0.002 + fallRatio * 0.006);
    }

    const wallDir = local.touchingWallDir ?? 0;
    if (this.prevLocalWallDir !== 0 && wallDir === 0 && !local.grounded) {
      const speedRatio = Phaser.Math.Clamp((Math.abs(local.vx) - 400) / 300, 0, 1);
      this.cameraJuice.safeShake(120, 0.006 + speedRatio * 0.006);
      this.cameraJuice.punchZoom(-0.03 - speedRatio * 0.03);
    }
    this.prevLocalWallDir = wallDir;

    const dashing = local.dashing ?? false;
    if (!this.prevLocalDashing && dashing) {
      this.cameraJuice.punchZoom(-0.05, 50, 180);
    }
    this.prevLocalDashing = dashing;

    this.prevLocalGrounded = local.grounded ?? true;
    this.prevLocalVy = local.vy;
  }

  /**
   * Apply the mobile camera zoom for the current orientation. Portrait frames
   * the arena height into the upper play-area; landscape/desktop use 1:1.
   * Called on create and whenever the viewport resizes (orientation change).
   */
  private applyMobileCamera(): void {
    const cam = this.cameras.main;
    cam.setZoom(isPortraitMobile() ? PORTRAIT_CAM_ZOOM : 1);
  }

  // ---------------- Match results ----------------

  private maybeShowMatchResults(state: WorldState) {
    if (this.matchHasEnded) return;
    const { winnerPlayerId } = state.round;
    if (winnerPlayerId === null) return;
    const winnerScore = state.round.scores[winnerPlayerId] ?? 0;
    if (winnerScore < TARGET_SCORE_DEFAULT) return;
    this.matchHasEnded = true;
    this.showMatchResults(state);
  }

  private showMatchResults(state: WorldState) {
    if (!this.matchResultsOverlay) return;
    const rows: MatchResultsRow[] = Object.entries(state.round.scores)
      .map(([pid_, score]) => {
        const pid = pid_ as PlayerId;
        const player = state.players[pid];
        return {
          playerId: pid,
          name: pid === this.localPlayerId ? "You" : playerTag(pid),
          score,
          cardIds: player?.cards ?? [],
          isLocal: pid === this.localPlayerId,
        };
      });
    this.matchResultsOverlay.show(
      {
        winnerPlayerId: state.round.winnerPlayerId,
        targetScore: TARGET_SCORE_DEFAULT,
        rows,
      },
      {
        onRematch: () => {
          // World mode: server keeps the world alive and rolls the next
          // round on its own — clicking Rematch just dismisses the
          // overlay so the player sees the next round when it starts.
          // CRUCIAL: keep `matchHasEnded = true`. The server is still parked
          // in match-over (winner at target score), so if we reset the flag
          // here, the very next snapshot re-fires maybeShowMatchResults and the
          // overlay POPS RIGHT BACK UP — you can't dismiss it until recycle.
          // The recycle's re-hello (onHello) clears the flag when the NEXT
          // match actually starts.
          this.matchResultsOverlay?.hide();
          if (this.sceneMode === "world") {
            this.setStatus("Waiting for next round…");
            return;
          }
          // Room mode: full rematch isn't wired yet; bounce back to lobby so
          // the host can re-create the match.
          this.matchHasEnded = false;
          window.dispatchEvent(new CustomEvent("jakesjam:return-to-lobby"));
        },
        onReturnToLobby: () => {
          this.matchResultsOverlay?.hide();
          window.dispatchEvent(new CustomEvent("jakesjam:return-to-lobby"));
        },
      },
    );
  }

  // ---------------- Status text ----------------

  /**
   * Camera shake with stacking guard. Per game-feel-juice/SKILL.md recipe 3:
   * only escalate shake if the incoming intensity is LARGER than the current one
   * — prevents a tiny footstep clobbering a kill shake. Delegates to the
   * shared CameraJuice (also used by Practice) so this and every combat
   * shake call site feed the same action-intensity score for free.
   */
  private safeShake(durationMs: number, intensity: number): void {
    this.cameraJuice.safeShake(durationMs, intensity);
  }

  private setStatus(message: string) {
    if (this.statusText) {
      this.statusText.setText(message);
      this.statusText.setVisible(message.length > 0);
    }
  }

  private teardown() {
    this.scale.off("resize", this.repositionHud, this);
    this.scale.off("resize", this.applyMobileCamera, this);
    this.clipRecorder?.stop();
    this.clipRecorder = null;
    this.highlightTracker = null;
    delete (window as unknown as { __clipsTrigger?: () => void }).__clipsTrigger;
    setActiveStateGetter(null);
    setActiveCameraGetter(null);
    setActiveRigDebugGetter(null);
    setActiveNetStatsGetter(null);
    setActiveLocalPlayerIdGetter(null);
    // drawCombatFx lazily re-creates this; without the null the guard
    // would reuse a DESTROYED Graphics on scene restart.
    this.combatFx?.destroy();
    this.combatFx = null;
    this.touchControls?.destroy();
    this.touchControls = null;
    this.loop?.stop();
    this.loop = null;
    void this.convex?.close();
    this.convex = null;
    this.audio?.destroy();
    this.audio = undefined;
    this.cardDraftOverlay?.destroy();
    this.cardDraftOverlay = undefined;
    this.matchResultsOverlay?.destroy();
    this.matchResultsOverlay = undefined;
    for (const rig of this.playerRigs.values()) rig.destroy();
    this.playerRigs.clear();
    this.entityRender?.destroy();
    this.entityRender = null;
    this.arenaGraphics?.destroy();
    this.arenaGraphics = null;
    this.hudSystem?.destroy();
    this.hudSystem = null;
    this.roundBannerSystem?.destroy();
    this.roundBannerSystem = null;
    this.deathOverlay?.destroy();
    this.deathOverlay = null;
    this.connectionOverlay?.destroy();
    this.connectionOverlay = null;
    this.statusVfx?.destroy();
    this.statusVfx = null;
    this.particlePool?.destroy();
    this.particlePool = null;
    this.pendingSimEvents.length = 0;
    this.statsText?.destroy();
    this.statsText = null;
    this.statsBg?.destroy();
    this.statsBg = null;
    this.statsToggleKey = null;
    // C2a: prevDestructibleHealth + destructibleFlashUntilMs moved
    // into EntityRenderCoordinator.destroy().
    this.killStreakCount.clear();
    this.prevAlive.clear();
  }
}

// ---------------- Drawing helpers (file-local) ----------------

function drawDestructible(
  graphics: Phaser.GameObjects.Graphics,
  obj: DestructibleEntity,
  flashing: boolean,
) {
  const halfW = obj.width / 2;
  const halfH = obj.height / 2;
  const baseColor = destructibleColor(obj.kind);
  const color = flashing ? 0xffffff : baseColor;
  const alpha = obj.kind === "mine" ? 0.92 : 0.84;

  graphics.fillStyle(0x07101c, 0.45);
  graphics.fillRoundedRect(
    obj.x - halfW - 3,
    obj.y - halfH - 3,
    obj.width + 6,
    obj.height + 6,
    3,
  );
  graphics.fillStyle(color, alpha);
  if (obj.kind === "barrel") {
    graphics.fillRoundedRect(obj.x - halfW, obj.y - halfH, obj.width, obj.height, 7);
  } else if (obj.kind === "mine") {
    graphics.fillRoundedRect(obj.x - halfW, obj.y - halfH, obj.width, obj.height, 2);
    graphics.fillStyle(0xfff7d6, 0.9);
    graphics.fillCircle(obj.x, obj.y - 2, 3);
  } else {
    graphics.fillRect(obj.x - halfW, obj.y - halfH, obj.width, obj.height);
  }
  graphics.lineStyle(1, 0xf7fbff, 0.5);
  graphics.strokeRect(obj.x - halfW, obj.y - halfH, obj.width, obj.height);
}

function drawFirePatch(
  graphics: Phaser.GameObjects.Graphics,
  fire: FireEntity,
  nowMs: number,
) {
  // Tween scale + alpha based on remainingMs (target lifetime ~3s — same
  // visual feel as the offline scene). Fades + shrinks as it expires.
  const lifeRatio = Phaser.Math.Clamp(fire.remainingMs / 3000, 0, 1);
  const radius = fire.radius * (0.85 + 0.15 * lifeRatio);
  graphics.fillStyle(0xff7a18, 0.18 * lifeRatio);
  graphics.fillCircle(fire.x, fire.y, radius);
  graphics.lineStyle(2, 0xffd166, 0.45 * lifeRatio);
  graphics.strokeCircle(fire.x, fire.y, radius * 0.72);

  for (let index = 0; index < 5; index += 1) {
    const angle = fire.id + index * 1.26 + nowMs * 0.004;
    const flameRadius = radius * (0.22 + index * 0.08);
    graphics.fillStyle(index % 2 === 0 ? 0xffd166 : 0xfb7185, 0.42 * lifeRatio);
    graphics.fillCircle(
      fire.x + Math.cos(angle) * flameRadius,
      fire.y + Math.sin(angle * 0.8) * flameRadius * 0.38,
      5 + index,
    );
  }
}

function drawPickup(
  graphics: Phaser.GameObjects.Graphics,
  pickup: PickupEntity,
  nowMs: number,
) {
  const color = pickupColor(pickup.kind);
  const alpha = pickup.active ? 0.92 : 0.18;
  const pulse = pickup.active
    ? 1 + Math.sin(nowMs * 0.006 + pickup.x) * 0.08
    : 0.72;
  const radius = pickup.radius * pulse;

  graphics.lineStyle(2, color, alpha * 0.82);
  graphics.fillStyle(color, alpha * 0.22);
  graphics.fillCircle(pickup.x, pickup.y, radius + 7);
  graphics.strokeCircle(pickup.x, pickup.y, radius + 7);

  if (pickup.kind === "health-shard") {
    graphics.fillStyle(color, alpha);
    graphics.fillRect(pickup.x - 3, pickup.y - 10, 6, 20);
    graphics.fillRect(pickup.x - 10, pickup.y - 3, 20, 6);
  } else if (pickup.kind === "shield-cell") {
    graphics.fillStyle(color, alpha);
    graphics.beginPath();
    graphics.moveTo(pickup.x, pickup.y - 12);
    graphics.lineTo(pickup.x + 10, pickup.y - 4);
    graphics.lineTo(pickup.x + 7, pickup.y + 10);
    graphics.lineTo(pickup.x, pickup.y + 14);
    graphics.lineTo(pickup.x - 7, pickup.y + 10);
    graphics.lineTo(pickup.x - 10, pickup.y - 4);
    graphics.closePath();
    graphics.fillPath();
  } else if (pickup.kind === "card-cache") {
    graphics.fillStyle(color, alpha);
    graphics.fillRoundedRect(pickup.x - 11, pickup.y - 14, 22, 28, 3);
    graphics.lineStyle(2, 0xf7fbff, alpha * 0.72);
    graphics.strokeRoundedRect(pickup.x - 11, pickup.y - 14, 22, 28, 3);
  } else if (
    pickup.kind === "slow-trap" ||
    pickup.kind === "vulnerability-trap" ||
    pickup.kind === "block-jammer"
  ) {
    graphics.lineStyle(3, color, alpha);
    graphics.strokeCircle(pickup.x, pickup.y, 13);
    graphics.beginPath();
    graphics.moveTo(pickup.x - 9, pickup.y - 9);
    graphics.lineTo(pickup.x + 9, pickup.y + 9);
    graphics.strokePath();
  } else {
    graphics.fillStyle(color, alpha);
    drawDiamond(graphics, pickup.x, pickup.y, 12);
    graphics.fillStyle(0xf7fbff, alpha * 0.8);
    drawDiamond(graphics, pickup.x, pickup.y, 5);
  }
}

function drawDiamond(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  radius: number,
) {
  graphics.beginPath();
  graphics.moveTo(x, y - radius);
  graphics.lineTo(x + radius, y);
  graphics.lineTo(x, y + radius);
  graphics.lineTo(x - radius, y);
  graphics.closePath();
  graphics.fillPath();
}
