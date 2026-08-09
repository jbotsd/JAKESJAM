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
  postRematchReady,
  sanitizePlayerName,
  sanitizeCharacterId,
  takeArenaPreconnect,
  InputBit,
  type NetStats,
} from "../../net";
import type { Id } from "../../../../convex/_generated/dataModel";
import { HighlightTracker } from "../highlights/highlightRules";
import { ClipRecorder } from "../highlights/ClipRecorder";
import { isClipsEnabled } from "../highlights/clipConsent";
import { emitClipUploaded, emitCycleCompleted, ShellEvents } from "../../shell/events";
import { recordKill, recordDeath, recordStreak, recordMatch } from "../../shell/playerStats";
import { cycleNotables, showPersonalBests } from "../../shell/personalBest";
import { pickDeathTip, type DeathTipSignal } from "../highlights/deathTip";
import {
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
  type VesselCosmetics,
  type WorldState,
} from "../../sim";
import {
  resolveMap,
} from "../../sim/data/maps";
import { resolveModeConfig } from "../../sim/data/modeConfig";
import { EMISSION_CHARGE_MAX } from "../../sim/constants";
import { resolvePlayerBuild } from "../../sim/weapon";
import { classIdForArchetype } from "../../sim/data/cardTypes";
import { acquiredAbilities } from "../ui/acquiredAbilities";
import { activeSlotVitals } from "../ui/activeSlots";
import { deriveHudChips, deriveNameplateTicks } from "../ui/statusChips";
import { sealForCard } from "../ui/cardSeals";
import { ELEMENT_COLORS } from "../ui/elementColors";
import { classAccentPalette } from "../ui/classAccentColors";
import { createWeaponBuild, findCardsById } from "../../sim/data/weaponBuild";
import { starterWeapon } from "../../sim/data/weapons";
import { hashPlayerEntity } from "../../sim/hash";
import { setActiveCameraGetter, setActiveLocalPlayerIdGetter, setActiveNetStatsGetter, setActiveRigDebugGetter, setActiveStateGetter } from "../../debug/wasmStateProbe";
import { computeBotInput } from "../../debug/botDriver";
import { BOT_RIG_COLOR, botLabel, isBotId, playerTag } from "../ui/botIdentity";
import { characters } from "../data/characters";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { colorToNumber } from "../render/colorToNumber.js";
import { ProceduralAudio } from "../systems/ProceduralAudio";
import {
  CardDraftOverlay,
  type CardPickHandler,
} from "../ui/CardDraftOverlay";
import {
  MatchResultsOverlay,
  type MatchResultsRow,
} from "../ui/MatchResultsOverlay";
import { BuildChangeToast } from "../ui/BuildChangeToast.js";
import { HudSystem, type HudChip, type HudVitals, type HudRound, type NameplateStatusTick } from "../ui/HudSystem";
import { ActionBarSystem, type ActionBarVitals } from "../ui/ActionBarSystem";
import { RoundBanner } from "../ui/RoundBanner";
import { DeathOverlay } from "../ui/DeathOverlay";
import { draftTimerArmMs } from "../ui/phaseCountdown";
import { deathOverlayPresentation } from "../ui/deathOverlayPresentation";
import { ConnectionOverlay } from "../ui/ConnectionOverlay";
import { ParticlePool } from "../systems/ParticlePool";
import { StatusVfxController } from "../systems/StatusVfxController";
import { ConstructVfxController } from "../systems/ConstructVfxController";
import { PlatformLayer } from "../render/PlatformPainter";
import { LightBeamLayer } from "../render/LightingLayer";
import { CosmicArenaLayer } from "../render/CosmicArenaLayer";
import { getMusicLevel } from "../systems/MusicAmplitude";
import { RenderLayer } from "../render/RenderLayer";
import { transientVfx } from "../render/TransientVfx";
import { EntityRenderCoordinator } from "../render/EntityRenderCoordinator";
import { SimEventRouter } from "../render/SimEventRouter";
import { spawnFloatingDamageNumber } from "../render/damageNumber.js";
import { TouchControls } from "../input/TouchControls";
import { isTouchPrimary, isPortraitMobile } from "../input/mobile";
import { ActionIntensity } from "../systems/ActionIntensity.js";
import { CameraHype } from "../systems/CameraHype.js";
import { SlowMotion } from "../systems/SlowMotion.js";
import { RenderTimeArbiter } from "../render/RenderTimeArbiter.js";
import { presentationBudget } from "../render/presentationBudgets.js";
import { ActionCamera } from "../systems/ActionCamera.js";
import { stickyEnvelopeSubjects } from "../systems/actionCameraMath.js";
import { CameraJuice } from "../systems/CameraJuice.js";
import { installHudCamera } from "../systems/HudCamera.js";
import { killstreakLabel } from "../ui/killstreakLabels.js";
import { getRenderScale, uiWidth, uiHeight } from "../render/renderResolution.js";
import { getQualityProfile, getEffectiveRigStyle } from "../render/qualityProfile.js";
import { BakedPlayerRig } from "../rendering/BakedPlayerRig.js";
import { assistTouchAim } from "../input/touchAimAssist.js";
import { autoWallHopKeys, makeAutoHopState } from "../input/autoWallHop.js";
import {
  makeCombatFxState,
  makeDeathFxState,
  makeStormZoneModel,
  noteDeathEvents,
  produceCombatFx,
  produceDeathFx,
  produceDeathShards,
  produceSpawnFx,
  produceStormZone,
  setDeathFxTarget,
  PARRY_ARC,
  PARRY_RANGE,
  SHIELD_RADIUS,
  type CombatFxRenderModel,
  type ShardRenderModel,
  type SoulRenderModel,
  type UploadRenderModel,
} from "../render/renderContract.js";
import { drawDeathFx, drawDeathShards, drawSpawnUploads } from "../render/deathFxPainter.js";
import { drawStormZone } from "../render/stormZonePainter.js";
import { crumb, record } from "../../telemetry.js";
import { drawPlayerPresence } from "../render/presencePainter.js";
import { announce } from "../audio/AnnouncerSystem.js";
import { playCardPickFeel } from "../render/CardFeel.js";

// Portrait-mobile camera framing. The arena is 2:1 wide but a phone held
// upright is ~1:2 tall, so we frame the arena HEIGHT into the upper play-area
// and follow the player horizontally, biasing them above centre so the
// bottom control band never covers them. Tunable.
// Camera zoom stays 1.0 in portrait: Phaser scales scroll-fixed HUD objects
// with zoom (pushing them off-screen at zoom>1), and a dedicated UI camera is
// too invasive for this scene. Framing is done entirely via the upward bias +
// extended bottom bounds, which keeps the player in the upper play-area with
// the ground below — no HUD breakage.
// 0.7 after live phone playtest 2026-07-10 ("so little on screen"): a
// narrow portrait viewport at 1.0 showed a letterbox slice of arena —
// zooming OUT ~43% more world makes attackers visible before they land on
// you. The old HUD-breakage concern is gone: the HUD now lives in a
// renderScale-scaled root container on its own camera (HudCamera), so
// world zoom never touches it.
// 0.7 read "tiny character lost in backdrop" on a real phone — 0.8 keeps
// enough arena context while the fighters actually read as figures.
const PORTRAIT_CAM_ZOOM = 0.8;
// Desktop crop-in: the world camera zooms to make the player the main event
// (was 1.0 — the player read as a tiny figure showing almost the whole map).
// 1.4 puts the ~56px character at ~11% of screen height with ~4.5
// character-heights of sightline each way — the researched arena-shooter
// sweet spot (Keren/TowerFall/Duck Game framing; see HudCamera for how the
// scroll-fixed HUD is kept unzoomed). Portrait mobile stays 1.0 (small
// screen already frames the player large enough, and vertical room is tight).
const DESKTOP_CAM_ZOOM = 1.4;
// Landscape phones were getting the DESKTOP crop-in — far too tight on a
// 6-inch screen. Wider view for any touch device in landscape.
const TOUCH_LANDSCAPE_CAM_ZOOM = 1.0;
const PORTRAIT_CAM_Y_BIAS = 150; // world px: camera centres BELOW the player → player rides in the upper third, clear of the bottom control band
import { PALETTE, ARENA_THEMES } from "../ui/palette";
// Track P1 — funnel milestones fired from the input path and kill/death events.
import { funnel } from "../../shell/funnel";
import type {
  CardDefinition,
  CharacterDefinition,
  CharacterId,
} from "../types/game";

export type OnlineMatchSceneInit = {
  /**
   * `matchId` is required for room/private flow. Omitted when
   * `mode === "world"` — the io-style world has no matchId.
   */
  matchId?: string;
  localPlayerId: string;
  /** Convex URL is only consulted in legacy `mode === "room"`. */
  convexUrl?: string;
  /**
   * Server-minted match token for private rooms (no Convex).
   * When set, client connects to /ws?matchId&token directly.
   */
  matchToken?: string;
  /** Ready WebSocket URL (private rooms may pass this prebuilt). */
  wsUrl?: string;
  /** "room" = legacy Convex. "private" = server lobby. "world" = Hot Lobby. */
  mode?: "room" | "world" | "private";
};

// PROJECTILE_RADIUS_DEFAULT moved to EntityRenderCoordinator (C2a).
// Mirrors MatchScene's PLAYER_VISUAL_SCALE so online and offline rigs match.
const PLAYER_VISUAL_SCALE = 0.78;
// Sim body heights (sim/player.ts: bodyHeight=56, crouchHeight=38).
// PlayerEntity (x, y) is the body center; rig wants foot position.
const SIM_BODY_HALF_HEIGHT = 28;
const SIM_CROUCH_HALF_HEIGHT = 19;
// Radiant white-gold — YOU are the gnostic light (Jake's pick 2026-07-11):
// ivory body, gold accent; maximum value-contrast on every background and
// the same language as the soul/motif.
/** Doors 1.4 — how long a never-spawned local must stay absent/dead before
 *  the NEXT BELL overlay shows. Covers the one-frame roster races (world-
 *  recycle re-hello, countdown-entry insertion) so the overlay never
 *  flashes on a player who is about to appear; a genuinely gate-parked
 *  spectator sees it well within a beat. */
const PENDING_OVERLAY_GRACE_MS = 400;

const LOCAL_PLAYER_FALLBACK_COLOR = 0xfff3d6;
// Hot crimson (was soft pink — too close to both bots and warm terrain).
const REMOTE_PLAYER_FALLBACK_COLOR = 0xff4d5e;

// DAMAGE_FLASH_MS moved to EntityRenderCoordinator (C2a).

/** Color per destructible kind. Mirrors MatchScene.destructibleColor. */
function destructibleColor(kind: DestructibleKind): number {
  const colors: Record<DestructibleKind, number> = {
    barrel: 0xff7a18, // orange
    box: 0x8b5a2b, // brown
    mine: 0xff3b3b, // red
    cube: 0x8a8f99, // gray
    // Venue-lobby-tableau (2026-07-18): the "bad" practice dummies — the
    // game's existing rose token (ProceduralPlayerRig's low-health glow,
    // DeathOverlay, facetedRing's danger tier — all 0xfb7185), not a new
    // color invented for "hostile."
    trainingDummy: 0xfb7185,
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
export function projectileColorByElement(element: string, ownerId: string | null): number {
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
      // Was 0xf0abfc — a pale lavender-pink that matched NOTHING else the
      // class does (GEOMETRICIAN_TINT.glow is a saturated cyan everywhere
      // else: the lance, the shard-fan, the shatter flourish). The wizard's
      // most-seen thing (the basic bullet, fired constantly) reading as a
      // completely different color family was a real "fluffy, not wiz-like"
      // contributor (Jake, 2026-07-20). Matches the class's own construct
      // language now.
      return 0x35d6ff;
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

export class OnlineMatchScene extends Phaser.Scene {
  private loop: ClientLoop | null = null;
  private convex: ConvexClient | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  /** Captured from init data so onRematch / onReturnToLobby can branch. */
  private sceneMode: "room" | "world" | "private" = "room";
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
  /** Bound listeners so teardown can remove them (hot-start / save-now). */
  private readonly onClipsConsentChanged = (e: Event) => {
    const enabled = (e as CustomEvent<{ enabled?: boolean }>).detail?.enabled;
    if (enabled === false) this.stopClipCapture();
    else if (enabled === true || isClipsEnabled()) this.ensureClipCapture();
  };
  private readonly onClipSaveNow = () => {
    this.ensureClipCapture();
    if (!this.clipRecorder) {
      console.warn("[clips] save-now: recorder unavailable (consent off or no MediaRecorder)");
      return;
    }
    console.log("[clips] manual save — toast in a few seconds");
    this.clipRecorder.trigger();
  };
  /** Scene-local last shareable clip URL (no shell session import). */
  private lastShareClipUrl: string | null = null;
  /** Wall-clock of last local successful parry (for death-tip evidence). */
  private lastLocalParryAtMs = 0;
  /** Locked tip for current death stretch (undefined = not yet computed). */
  private deathTipLocked: string | null | undefined = undefined;
  /** When the local player died (performance.now), null while alive. */
  private localDeathAtMs: number | null = null;
  /** Doors 1.4 — true once we've seen OUR player alive in any received
   *  state. Until then a dead/absent local is a PENDING ENTRANT (gate-
   *  parked spectator awaiting the countdown-entry insertion), NOT a
   *  corpse: NEXT BELL copy, no death rite, no eliminated/soul-reclaimed
   *  announcer. Derived locally from observed state — no server protocol.
   *  Reset in init() and on world-recycle re-hello (the new world may park
   *  us again). */
  private localEverSpawned = false;
  /** First frame we found ourselves pending (never-spawned + absent/dead).
   *  The NEXT BELL overlay waits a short grace on this stamp so one-frame
   *  roster races (world-recycle re-hello, countdown-entry insertion)
   *  never flash it. Null while not pending. */
  private pendingSinceMs: number | null = null;
  /** Round-phase memory for the FIGHT announce edge. */
  private prevRoundPhase = "";
  /** Static arena geometry (platforms, walls, floor, vignette). Drawn
   *  once on hello receipt; never per-frame. */
  private arenaGraphics: Phaser.GameObjects.Graphics | null = null;
  /** Per-frame combat state overlay: shield bubbles + parry arcs for every
   *  player, drawn from wire state (shieldActive / parryActiveUntilTick /
   *  parryFacing). Cleared and redrawn each renderWorld pass. */
  private combatFx: Phaser.GameObjects.Graphics | null = null;
  /** Per-player last shield charge + block-flash timer (shield-block VFX). */
  private readonly combatFxState = makeCombatFxState();
  private readonly combatFxModels: CombatFxRenderModel[] = [];
  /** Figure-ground presence layer (gestalt pass; see presencePainter). */
  private presence: Phaser.GameObjects.Graphics | null = null;
  /** The shrinking safe-zone boundary — was drawn nowhere before 2026-07-11
   *  (Jake: "you just start dying and there is no explanation for it"). */
  private stormZone: Phaser.GameObjects.Graphics | null = null;
  private readonly stormZoneModel = makeStormZoneModel();
  /** Soul-return death sequences (contract producer; see deathFxPainter). */
  private deathFx: Phaser.GameObjects.Graphics | null = null;
  private readonly deathFxState = makeDeathFxState();
  private readonly deathFxModels: SoulRenderModel[] = [];
  private readonly deathShardModels: ShardRenderModel[] = [];
  private readonly spawnFxModels: UploadRenderModel[] = [];
  /** produceDeathFx count this frame — the model array is a pool. */
  private deathFxSoulCount = 0;
  /** playerId → chosen display name (ServerHello roster). */
  private readonly rosterNames = new Map<string, string>();
  /** playerId → chosen Vessel Creator cosmetics (ServerHello roster). Same
   *  population site as rosterNames — see onHello below. */
  private readonly rosterCosmetics = new Map<string, VesselCosmetics>();
  private platformLayer: PlatformLayer | null = null;
  private lightBeams: LightBeamLayer | null = null;
  private cosmicArena: CosmicArenaLayer | null = null;
  // Sentinel — overwritten in init(data) before any consumer reads it.
  // Cast bypasses the validating constructor; "" is not a valid PlayerId.
  private localPlayerId: PlayerId = "" as PlayerId;
  private lastFrameMs = 0;
  /** Last rendered local feet (for touch aim origin without pre-pump getRenderState). */
  private lastLocalRenderX: number | null = null;
  private lastLocalRenderY: number | null = null;
  // Drafted-active hotkeys: exactly 3 (docs/classes-goal.md "Rotation
  // system" — rack slots keys 1-3, never 4; MAX_ABILITY_SLOTS in
  // sim/data/cardTypes.ts is the canonical constant this mirrors).
  private keys!: Record<
    "a" | "d" | "w" | "s" | "space" | "shift" | "dash" | "emission" | "slot1" | "slot2" | "slot3",
    Phaser.Input.Keyboard.Key
  >;
  /** Last frame's local abilityCharge (updated in the HUD pass, read by the
   *  input assembly's full-charge gate — last-frame convention, see there). */
  private lastKnownEmissionCharge = 0;
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
  private readonly statsLineBuf: string[] = ["", "", "", "", "", "", "", ""];

  // ---- New shared UI systems ----
  private hudSystem: HudSystem | null = null;
  private actionBar: ActionBarSystem | null = null;
  private roundBannerSystem: RoundBanner | null = null;
  private deathOverlay: DeathOverlay | null = null;
  private connectionOverlay: ConnectionOverlay | null = null;

  // ---- Audio + overlays ----
  private audio?: ProceduralAudio;
  /** Tracks the local player's shield state to drive shield-up / hum audio. */
  private prevLocalShield = false;
  private cardDraftOverlay?: CardDraftOverlay;
  private buildChangeToast?: BuildChangeToast;
  private matchResultsOverlay?: MatchResultsOverlay;
  /** Doors 2.3 — set when a kill streak beat the stored personal best
   *  during THIS cycle. Read once at the results screen. */
  private cycleBeatStreak = false;
  private cycleBestStreak = 0;
  private matchHasEnded = false;

  /** Stored on renderArena so spawnPlatformBlastTint can iterate platforms. */
  private currentMap: MapDefinition | null = null;

  // ---- Status VFX + render helpers (sim-authoritative) ----
  private particlePool: ParticlePool | null = null;
  private statusVfx: StatusVfxController | null = null;
  private constructVfx: ConstructVfxController | null = null;
  private renderLayer: RenderLayer | null = null;
  /** P3: cinematic combat FX (kill flash/zoom-punch/bloom). Enabled when the
   *  renderer is WebGL and not disabled via ?fx=off. */
  private combatCinematics = false;
  private actionCamera!: ActionCamera;
  private cameraJuice!: CameraJuice;
  private readonly actionIntensity = new ActionIntensity();
  /** ~20s sustained-action build to the peak "dance mode" camera treatment.
   *  Driven below by the local player rig's own "circle the mouse" dance
   *  energy (ProceduralPlayerRig.getDanceState()) — the same gesture the
   *  rig's own animation already responds to, not a separate detector. */
  private readonly cameraHype = new CameraHype();
  /** Edge-detects CameraHype.isPeak() so the acknowledgment flash fires
   *  exactly once on entry, not every frame the peak state holds. */
  private cameraHypePeakPrev = false;
  /** Render-only bullet-time dip (see SlowMotion.ts) — not wired to any
   *  trigger yet, just the per-frame input-cancel plumbing (any meaningful
   *  key press ends it instantly). Call .trigger(scale, maxHoldMs) from
   *  wherever a big moment should get it. */
  private readonly renderTime = new RenderTimeArbiter(this);
  private readonly slowMotion = new SlowMotion(this, this.renderTime);
  /** Local-player movement-juice edge detection (landing/wall-jump/dash). */
  private prevLocalGrounded = true;
  private prevLocalWallDir = 0;
  private prevLocalDashing = false;
  private prevLocalVy = 0;
  /** Ambient haze ellipses (renderArena) + their resting alpha, retained so
   *  environment reactivity can brighten them with action intensity. */
  private hazeEllipses: Array<{ ellipse: Phaser.GameObjects.Ellipse; baseAlpha: number }> = [];
  /** Full-screen additive "energy" glow, scroll-fixed, alpha driven by
   *  action intensity — the theme-independent environment cue (light beams
   *  only exist on some themes). */
  private energyBloom?: Phaser.GameObjects.Rectangle;
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
  // Per-frame scratch (renderWorld) — reused to keep the hot path zero-alloc.
  private seenPlayersScratch = new Set<string>();
  private newlyDeadScratch: string[] = [];
  /** Perf audit M4 (2026-07-18): updateClipFocusWorld and followLocalPlayer
   *  each independently rebuilt an alive-non-local-players array from
   *  Object.entries(state.players) every frame. Whenever local is alive
   *  (the common case — updateClipFocusWorld early-returns entirely
   *  otherwise, and followLocalPlayer's anchor is only ever something OTHER
   *  than local while local is dead), both consumers want the exact same
   *  base set. Filled once by updateClipFocusWorld (which runs first, see
   *  renderWorld), consumed by followLocalPlayer instead of re-scanning. */
  private readonly aliveNonLocalScratch: Array<{ x: number; y: number }> = [];
  private aimWorldScratch = new Phaser.Math.Vector2();
  /** Previous frame's render state — touch aim assist reads it (aim input
   *  is assembled before pump, so this frame's state doesn't exist yet). */
  private lastStateForAssist: WorldState | null = null;
  private autoHopState = makeAutoHopState();
  private wakeLock: WakeLockSentinel | null = null;

  /** visibilitychange/pageshow → resume watchdog + wake-lock re-acquire.
   *  Arrow field so add/removeEventListener get the same reference. */
  private onVisibilityResume = (): void => {
    if (document.visibilityState !== "visible") return;
    this.loop?.noteVisible();
    void this.acquireWakeLock();
  };

  /** Keep the screen on during a match (phones sleep mid-fight otherwise).
   *  The OS releases the lock whenever the page hides — onVisibilityResume
   *  re-acquires. No-op where unsupported; denial is non-fatal. */
  private async acquireWakeLock(): Promise<void> {
    try {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      this.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      this.wakeLock = null;
    }
  }
  // Per-killer kill count in the current round for escalating callouts.
  private killStreakCount = new Map<string, number>();
  // Clip 9:16 crop focus in WORLD space — envelopes local + a STICKY duel
  // partner (same hysteresis as ActionCamera), converted to screen px in
  // clipFocusScreenPos. The old non-sticky nearest-enemy pick teleported the
  // crop target every time two foes swapped distance rank or crossed the
  // range boundary — the measured left-right-left crop slams in clips.
  private clipFocusWorld: { x: number; y: number } | null = null;
  private clipFocusSubjects: Array<{ x: number; y: number }> = [];

  constructor() {
    super(SceneKeys.OnlineMatch);
  }

  /** Fight-pair centre in SOURCE-CANVAS pixels for the vertical clip crop.
   *  worldView already accounts for zoom (its extent is viewport/zoom), so
   *  (world - worldView.origin) * zoom lands in render-resolution px.
   *  MUST track player+enemy midpoint so the 9:16 window includes the duel
   *  (ActionCamera look-ahead alone still left victims cropped out). */
  private clipFocusScreenPos(): { x: number; y: number } | null {
    if (!this.clipFocusWorld) return null;
    const cam = this.cameras.main;
    return {
      x: (this.clipFocusWorld.x - cam.worldView.x) * cam.zoom,
      y: (this.clipFocusWorld.y - cam.worldView.y) * cam.zoom,
    };
  }

  init(data: OnlineMatchSceneInit) {
    this.localPlayerId = PlayerId(data.localPlayerId);
    this.sceneMode = data.mode ?? "room";
    // Scene instances survive restarts (class-field initializers run once,
    // at construction) — per-entry spawn-tracking state must reset here or
    // a second entry inherits the first run's "has fought" verdict.
    this.localEverSpawned = false;
    this.pendingSinceMs = null;
    this.localDeathAtMs = null;
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
        fontFamily: "'Space Mono', 'Courier New', monospace",
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
        // Emission cast (Emission Engine P1 — docs/emission-engine-goal.md).
        // E is adjacent to WASD and unbound elsewhere in-match.
        emission: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
        // Drafted actives (six-axes Layer 2): action-bar slots in pick
        // order — exactly 3 (docs/classes-goal.md "Rotation system" soft
        // lock 2026-07-17). No key 4: the rack never fills a 4th slot.
        slot1: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
        slot2: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
        slot3: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
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
    this.cardDraftOverlay = new CardDraftOverlay({
      onPicked: (card) => this.playLocalCardPickFeel(card),
    });
    this.buildChangeToast = new BuildChangeToast();
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
    this.actionCamera = new ActionCamera(this.cameras.main);
    this.cameraJuice = new CameraJuice(this.actionCamera, this.actionIntensity);

    // Highlight-clip capture — opt-in only (consent toggle / ?clips=1).
    // Also hot-starts when consent flips mid-match (no rejoin required).
    this.ensureClipCapture();
    window.addEventListener(ShellEvents.CLIPS_CONSENT_CHANGED, this.onClipsConsentChanged);
    window.addEventListener(ShellEvents.CLIP_SAVE_NOW, this.onClipSaveNow);
    // Mobile lifecycle: iOS kills background sockets silently, and phones
    // sleep mid-match without a wake lock. pageshow catches bfcache resumes
    // that never fire visibilitychange.
    document.addEventListener("visibilitychange", this.onVisibilityResume);
    window.addEventListener("pageshow", this.onVisibilityResume);
    void this.acquireWakeLock();

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
    this.actionBar = new ActionBarSystem(this);
    this.roundBannerSystem = new RoundBanner(this);
    this.deathOverlay = new DeathOverlay();
    this.connectionOverlay = new ConnectionOverlay();

    // Status VFX driven by sim state (burnUntilTick / freezeUntilTick) plus
    // chain-hit SimEvents.
    this.statusVfx = new StatusVfxController(this, this.particlePool);
    // Self-light construct VFX (Syzygist entanglement tether, driven by sim
    // state — focusHexMark). Off-pool tether layer; occasional pooled bursts.
    this.constructVfx = new ConstructVfxController(this, this.particlePool);
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
          danceEnergy: info.danceEnergy,
          idleDanceMs: info.idleDanceMs,
          danceRaise: info.danceRaise,
          impact: info.impact,
          melee: info.melee,
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

    // The legend returns where its right-anchored column ends so the
    // clip-recording disclosure (Doors 0.7) can slot in directly below it
    // on a fresh profile, or take the legend's own start slot when the
    // legend has already been seen.
    this.setupClipDisclosure(this.setupFtueLegend());

    // Split the HUD onto its own 1:1 camera so the world can crop in
    // (DESKTOP_CAM_ZOOM) without dragging the edge-anchored HUD off-screen.
    // Installed last so the initial-partition pass sees the full HUD.
    installHudCamera(this);
  }

  /**
   * Per onboarding-ftue/SKILL.md recipe 3: show a controls legend in the first
   * match only, never again. Persists via localStorage. No modal, no skip
   * button — Mark Brown's rule "the only good tutorial is the one you can't
   * tell is a tutorial". STAGED reveal (the skill's progressive-disclosure
   * recipe: move → attack → defend, ~900ms apart) so five simultaneous lines
   * don't hit a brand-new player as a wall of text, and a longer life (9s vs
   * the old 3s — five lines in 3s wasn't readable while also, you know,
   * being shot at).
   *
   * Returns where the legend column ends (`nextLineY`) and when its last
   * group reveals (`nextLineDelayMs`) so one-shot FTUE siblings (the clip
   * disclosure below) can join the same staged column without overlap.
   * When the legend is skipped, callers get the column's base slot back.
   */
  private setupFtueLegend(): { nextLineY: number; nextLineDelayMs: number } {
    const FTUE_KEY = "jakesjam-ftue-controls-shown";
    const baseY = this.touchControls ? 112 : 48;
    try {
      if (localStorage.getItem(FTUE_KEY) === "1") {
        return { nextLineY: baseY, nextLineDelayMs: 0 };
      }
      localStorage.setItem(FTUE_KEY, "1");
    } catch {
      // localStorage unavailable (private mode, file://, …). Show every time.
    }
    // Grouped by concept, revealed one group at a time.
    const groups: string[][] = this.touchControls
      ? [
          ["LEFT STICK  move", "PUSH UP  jump"],
          ["RIGHT STICK  aim & fire"],
          ["SHIELD / DASH  buttons"],
        ]
      : [
          ["WASD  move", "SPACE  jump"],
          ["MOUSE  aim & fire"],
          // Shift = hold-to-shield (InputBit.Shield); right mouse (or C) = the
          // dash-bash shield power-slide (InputBit.Dash).
          ["SHIFT  shield", "RIGHT CLICK  shield dash"],
          // The QA tape caught the legend teaching shield/dash but never the
          // Emission or drafted actives (six-axes) — exactly the "no keyboard
          // shortcut for some things" confusion (Jake, 2026-07-17).
          ["E  emission (at full meter)", "1-3  drafted abilities"],
        ];
    const STAGE_GAP_MS = 900;
    const LEGEND_LIFE_MS = 9_000;
    // Desktop y=48: below the always-visible RTT pill (top-right, ~28px tall)
    // so the two don't overlap during the legend's life. Touch phones start
    // lower still — at 393px the score row + build pills reach into the
    // legend's right-anchored column (seen overlapping in portrait QA).
    let y = baseY;

    // clusterA-04 mobile-QA fix (2026-07-28): the touch legend's column
    // (right-anchored, y=112..~250 at 393px) and the round banner (centred,
    // ~0.32*uiHeight) previously painted on top of each other for this
    // legend's whole life — narrow-portrait "FIGHT!" is wide enough to reach
    // the legend's x range too. Desktop's legend starts much higher (y=48)
    // on a much wider viewport, so it was never at risk — scoped to touch.
    if (this.touchControls) {
      const legendBottomPx = 250; // 112 start + this file's own 58+40+40 group heights
      this.roundBannerSystem?.setLegendClearance(legendBottomPx + 40);
      this.time.delayedCall(LEGEND_LIFE_MS + 380, () => {
        this.roundBannerSystem?.setLegendClearance(0);
      });
    }
    for (const [i, lines] of groups.entries()) {
      const text = this.add
        .text(uiWidth(this) - 20, y, lines.join("\n"), {
          color: "#cffaff",
          fontFamily: "'Space Mono', 'Courier New', monospace",
          fontSize: "14px",
          align: "right",
          backgroundColor: "rgba(5,8,15,0.45)",
          padding: { left: 10, right: 10, top: 8, bottom: 8 },
        })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(2000)
        .setAlpha(0);
      y += lines.length * 18 + 22;
      this.time.delayedCall(i * STAGE_GAP_MS, () => {
        this.tweens.add({ targets: text, alpha: 1, duration: 260, ease: "Cubic.easeOut" });
      });
      this.time.delayedCall(LEGEND_LIFE_MS, () => {
        this.tweens.add({
          targets: text,
          alpha: 0,
          duration: 380,
          ease: "Cubic.easeIn",
          onComplete: () => text.destroy(),
        });
      });
    }
    return { nextLineY: y, nextLineDelayMs: groups.length * STAGE_GAP_MS };
  }

  /**
   * Doors 0.7 honest-copy: clip capture + upload is default-ON but was only
   * disclosed deep in Settings (clipConsent.ts:1-4). One FTUE-style line —
   * same staged right-anchored column, never a modal (ui-axioms bans modal
   * tutorials) — the first time a player enters a match that is actually
   * recorded (consent on; a consent-off first match doesn't burn the
   * one-shot, the line waits for the first recorded one). localStorage-gated
   * to once ever, mirroring setupFtueLegend's key discipline.
   */
  private setupClipDisclosure(slot: { nextLineY: number; nextLineDelayMs: number }): void {
    if (!isClipsEnabled()) return;
    const DISCLOSED_KEY = "jakesjam-ftue-clips-disclosed";
    try {
      if (localStorage.getItem(DISCLOSED_KEY) === "1") return;
      localStorage.setItem(DISCLOSED_KEY, "1");
    } catch {
      // localStorage unavailable — same call as the legend: keep showing.
    }
    // Two short lines, not one long one: at 393px a single line of this
    // copy (~52ch of 14px Space Mono) is wider than the viewport.
    const lines = ["MATCHES ARE RECORDED FOR HIGHLIGHTS", "TOGGLE IN SETTINGS"];
    const LIFE_MS = 9_000;
    const text = this.add
      .text(uiWidth(this) - 20, slot.nextLineY, lines.join("\n"), {
        color: "#cffaff",
        fontFamily: "'Space Mono', 'Courier New', monospace",
        fontSize: "14px",
        align: "right",
        backgroundColor: "rgba(5,8,15,0.45)",
        padding: { left: 10, right: 10, top: 8, bottom: 8 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000)
      .setAlpha(0);
    // Touch: this line can extend the FTUE column past the clearance the
    // legend reserved (250+40) — re-reserve to this line's own bottom edge
    // so the round banner never paints over it (clusterA-04 discipline).
    if (this.touchControls) {
      const bottomPx = slot.nextLineY + lines.length * 18 + 16;
      const assertClearance = () =>
        this.roundBannerSystem?.setLegendClearance(bottomPx + 40);
      assertClearance();
      // Fresh profile: the legend's own reset (its LEGEND_LIFE_MS + 380)
      // zeroes the clearance while this staggered line is still alive —
      // re-assert just after it so the banner keeps clearing the column.
      if (slot.nextLineDelayMs > 0) {
        this.time.delayedCall(LIFE_MS + 400, assertClearance);
      }
      this.time.delayedCall(slot.nextLineDelayMs + LIFE_MS + 380, () => {
        this.roundBannerSystem?.setLegendClearance(0);
      });
    }
    this.time.delayedCall(slot.nextLineDelayMs, () => {
      this.tweens.add({ targets: text, alpha: 1, duration: 260, ease: "Cubic.easeOut" });
    });
    this.time.delayedCall(slot.nextLineDelayMs + LIFE_MS, () => {
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

    // ---- Input FIRST, then pump sim, then sample render state ----
    // Old order (getRenderState → setLocalInput) left the visible frame on
    // the previous key sample and deferred prediction to setInterval —
    // up to ~1 RAF + ~STEP_MS of pure input lag. Same-frame pump makes
    // local movement feel immediate while still fixed-step deterministic.
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
    // Track P1 — the two funnel milestones that live in the input path.
    // Measured here rather than on a DOM listener so they mean "an input the
    // GAME accepted", not "a key the browser saw": the north-star gate is
    // URL -> first shot FIRED, and a keypress the sim ignores is not that.
    if (keys !== 0) {
      funnel("first_input");
      if ((keys & InputBit.Fire) !== 0) funnel("first_shot");
    }
    // Shield power-slide bash on RIGHT MOUSE (aimable — slides toward the
    // cursor, blocks on the way in, bashes on contact). C stays as a keyboard
    // alternate. The old timed parry (InputBit.Ability) is subsumed by the
    // dash-bash and is no longer bound.
    if (this.keys.dash.isDown || this.input.activePointer.rightButtonDown()) {
      keys |= InputBit.Dash;
    }
    // Emission cast (E) — the Ability bit is only SENT at full predicted
    // charge. Below full, the sim's Ability edge falls through to the
    // legacy tryStartParry (bot defense); gating here keeps that parry
    // human-unreachable per CLAUDE.md without the sim branching on
    // identity. Reads LAST frame's charge (updated in the HUD pass after
    // pump — same last-frame convention as lastTouchAim below; calling
    // getRenderState here, before pump, would advance the smoother twice).
    // One frame of staleness at worst, and the server re-validates anyway.
    if (this.keys.emission.isDown && this.lastKnownEmissionCharge >= EMISSION_CHARGE_MAX) {
      keys |= InputBit.Ability;
    }
    // Drafted actives (six-axes Layer 2): keys 1-3 press bar slots in pick
    // order — bits 10..12, raw edges (no client gate needed: the sim
    // validates slot existence + cooldown, and there's no fall-through
    // hazard like the Emission/parry bit share). Bit 13 (a would-be 4th
    // slot) is never sent — the rack is locked at exactly 3
    // (docs/classes-goal.md "Rotation system").
    if (this.keys.slot1.isDown) keys |= 1 << 10;
    if (this.keys.slot2.isDown) keys |= 1 << 11;
    if (this.keys.slot3.isDown) keys |= 1 << 12;
    // Any real input ends a slow-motion dip instantly — see SlowMotion.ts.
    this.slowMotion.update(keys);

    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    // getWorldPoint (screen→world through zoom), matching MatchScene. The
    // old `pointer + scroll` form ignored camera zoom, so shots skewed away
    // from the cursor off-centre — and the skew would have VARIED with
    // renderScale (pointer is backing px, scroll is world units).
    const aimWorld = cam.getWorldPoint(pointer.x, pointer.y, this.aimWorldScratch);
    let aimX = aimWorld.x;
    let aimY = aimWorld.y;

    // Mobile: touch controls REPLACE keyboard/mouse. Movement + fire/shield/
    // parry come from the bitfield; aim is the local player's position plus
    // the right-stick direction (kept from last aim when the thumb lifts, so
    // shots keep their heading). Use last-frame feet (updated after render)
    // so we don't call getRenderState before pump (that would advance the
    // smoother twice per frame).
    if (this.touchControls) {
      const t = this.touchControls.getState();
      keys = t.keys;
      if (t.aimDir) this.lastTouchAim = t.aimDir;
      const AIM_REACH = 420;
      const ox = this.lastLocalRenderX ?? aimX;
      const oy = this.lastLocalRenderY ?? aimY;
      // Soft cone assist (touch only — an input transform, server-validated
      // like any aim; see touchAimAssist.ts). Uses last frame's state:
      // getRenderState can't run before pump, and 16ms of staleness is
      // nothing against a thumb's precision.
      let dir: { x: number; y: number } = this.lastTouchAim;
      if (this.lastStateForAssist) {
        dir = assistTouchAim(
          this.lastStateForAssist,
          this.localPlayerId,
          { x: ox, y: oy },
          this.lastTouchAim,
        );
      }
      aimX = ox + dir.x * AIM_REACH;
      aimY = oy + dir.y * AIM_REACH;
      // DASH DIRECTION (mobile): the sim dashes toward AIM, and on touch
      // the aim is stale whenever the right thumb is on the DASH button
      // instead of the aim stick. While the dash bit is down, point the aim
      // where the dash gesture says: the mini-stick drag direction, or for
      // a plain tap the move-stick direction. An actively held aim stick
      // still wins (live intent beats fallback).
      if (keys & InputBit.Dash) {
        const dd = t.dashDir ?? (t.aimDir ? null : t.moveDir);
        if (dd) {
          aimX = ox + dd.x * AIM_REACH;
          aimY = oy + dd.y * AIM_REACH;
        }
      }
      // AUTO WALL-HOP (mobile only): pushing into a touched wall pulses
      // Jump — automatic wall climb, no thumb gymnastics (autoWallHop.ts).
      const meForHop = this.lastStateForAssist?.players[this.localPlayerId];
      if (meForHop) {
        keys = autoWallHopKeys(
          keys,
          meForHop.touchingWallDir ?? 0,
          performance.now(),
          this.autoHopState,
        );
      }
    }

    this.loop.setLocalInput({ keys, aimX, aimY });
    this.loop.pump(); // apply input to prediction this frame when due

    const state = this.loop.getRenderState();
    if (!state) return;

    // Bot autopilot (combat probe) after pump so it sees current prediction.
    // Re-pump once if it overrides keys so the step matches bot intent.
    {
      const bot = computeBotInput(state, this.localPlayerId);
      if (bot) {
        this.loop.setLocalInput({
          keys: bot.keys,
          aimX: bot.aimX,
          aimY: bot.aimY,
        });
        // Bot path is debug-only; no second pump (would double-step).
        // Keys take effect on the next pump/interval tick.
      }
    }

    const me = state.players[this.localPlayerId];
    if (me) {
      this.lastLocalRenderX = me.x;
      this.lastLocalRenderY = me.y;
    }

    const now = performance.now();
    const deltaMs = Math.max(1, Math.min(50, now - this.lastFrameMs));
    this.lastFrameMs = now;

    this.renderWorld(state, deltaMs, now);
    this.lastStateForAssist = state;
    this.followLocalPlayer(state, deltaMs);
    this.updateShieldAudio(state);
    this.updateHudSystem(state);
    this.maybeShowMatchResults(state);
    this.updateLocalMovementJuice(state);
    this.actionIntensity.update(deltaMs);
    this.actionIntensity.dispatchToMusic(deltaMs);
    // CameraHype's drive is the local player rig's OWN dance-energy read —
    // reusing the exact "circle the mouse" gesture detector the rig's
    // animation already computes, not a second implementation of it.
    const localRig = this.playerRigs.get(this.localPlayerId as string);
    this.cameraHype.update(deltaMs, localRig?.getDanceState().energy ?? 0);
    if (localRig) localRig.externalHypeBoost = this.cameraHype.get();
    // Peak treatment: per docs/ui-axioms.md's own doctrine ("almost total
    // void, one point of light earning its keep, never ambient glow") a
    // sustained screen-wide strobe would be a straight violation — the
    // reward for a real 20s of sustained dancing is ONE quiet acknowledgment
    // on the rising edge (a restrained Instrument-Ink-gold flash), not a
    // repeating effect. The sustained part of the payoff already lives in
    // the rig's own light (externalHypeBoost feeding danceGlowBoost, above).
    const hypePeakNow = this.cameraHype.isPeak();
    if (hypePeakNow && !this.cameraHypePeakPrev) {
      this.cameras.main.flash(180, 0x89, 0x7f, 0x69, false);
    }
    this.cameraHypePeakPrev = hypePeakNow;
    this.updateEnvironmentReactivity();

    const simEvents = this.pendingSimEvents;
    const resolvePos = (id: PlayerId): { x: number; y: number } | undefined => {
      const p = state.players[id];
      return p ? { x: p.x, y: p.y } : undefined;
    };
    if (this.statusVfx) {
      this.statusVfx.update(state, simEvents, deltaMs, resolvePos);
    }
    if (this.constructVfx) {
      // Same events the statusVfx reads (slash-started drives the melee
      // constructs); cleared once below after both consumers have run. The
      // hand resolver anchors a swung blade to the rig's live lead hand so the
      // slash reads as HELD, not a projectile sweeping around the feet.
      const resolveHand = (id: PlayerId, hand: 0 | 1): { x: number; y: number } | undefined =>
        this.playerRigs.get(id as string)?.getHandWorld(hand) ?? undefined;
      const triggerMeleePose = (
        id: PlayerId,
        style: "interstice" | "kindled",
        dir: number,
        verb: "blade" | "bash" | "stab" = "blade",
      ): void => {
        this.playerRigs.get(id as string)?.triggerMeleeSwing?.(style, dir, verb);
      };
      // Shock Ring's landing slam and Wall Bloom's wall-kick burst fire with
      // NO SimEvent (combat.ts/World.ts's own silent-payoff comments), so
      // SimEventRouter never sees them — they were landing with a visual
      // construct but zero camera shake/hit-stop (Jake, 2026-07-20: "every
      // single factor where game feel matters"). ConstructVfxController
      // already detects the exact tick each one fires (its own
      // consumedThisFrame check for the deferred AOE construct); this
      // callback is just the scene supplying the camera-side half, the same
      // dependency-injection split SimEventRouter's own `safeShake` uses.
      const onDeferredNovaImpact = (playerId: PlayerId, _kind: "shock-ring" | "wall-bloom"): void => {
        const budget = presentationBudget("heavy");
        this.renderTime.hold("hit-stop", 0, budget.hitStopMs);
        if (playerId === this.localPlayerId) {
          this.safeShake(budget.shakeDurationMs, budget.shakeIntensity);
        }
      };
      this.constructVfx.update(
        state,
        simEvents,
        deltaMs,
        resolvePos,
        classIdForArchetype,
        resolveHand,
        triggerMeleePose,
        onDeferredNovaImpact,
      );
    }
    if (simEvents.length > 0) simEvents.length = 0;

    if (this.statsVisible) {
      this.updateStatsHud();
    }
    this.updateRttBadge();
    this.updateDetOverlay(state);

    // Frame-time governor: game-wide since 2026-07-31 — one instance
    // attached at boot (main.ts → attachGlobalRenderGovernor) covers every
    // scene including this one; a per-scene copy would double-step it.
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

    const chips: HudChip[] = deriveHudChips(local, state.tick);

    // Outside the storm boundary right now? Reuses this frame's
    // stormZoneModel (produced earlier in renderWorld) — zero extra work,
    // and it's the exact geometry that's damaging the player.
    let outsideStorm = false;
    if (local && this.stormZoneModel.active) {
      const dx = local.x - this.stormZoneModel.centerX;
      const dy = local.y - this.stormZoneModel.centerY;
      outsideStorm = dx * dx + dy * dy > this.stormZoneModel.radius * this.stormZoneModel.radius;
    }

    const vitals: HudVitals = {
      health: local?.health ?? 0,
      maxHealth,
      chips,
      isDead: !local || local.health <= 0 || !local.alive,
      outsideStorm,
    };

    const scores = state.round.scores;

    const winnerLabel =
      state.round.phase === "round-over"
        ? (() => {
            const wid = state.round.winnerPlayerId;
            if (!wid) return "DRAW";
            if (wid === this.localPlayerId) return "YOU";
            // Same name the nameplates use — "TO VERA", never "TO 3F2A"
            // (venue-goal Pillar 0.4).
            return this.displayName(wid);
          })()
        : undefined;

    // Scoreboard row colors — same role scheme makePlayerRig assigns
    // (teal local / crimson remote / violet bot), so the badge next to a
    // name always matches that player's actual in-world rig color.
    const colors: Record<string, number> = {};
    for (const pid of Object.keys(scores)) {
      colors[pid] = isBotId(pid)
        ? BOT_RIG_COLOR
        : pid === this.localPlayerId
          ? LOCAL_PLAYER_FALLBACK_COLOR
          : REMOTE_PLAYER_FALLBACK_COLOR;
    }

    // Fused nameplate ring data (Jake, 2026-07-14: "give everyone the match
    // a nameplate" — every roster player's live health/shield, not just
    // local's). Each player has their own character (and thus maxHealth), so
    // this can't reuse the local `maxHealth` computed above.
    const healthByPlayer: Record<string, { ratio: number; shieldRatio?: number; isDead: boolean }> = {};
    for (const pid of Object.keys(scores)) {
      const p = state.players[pid as PlayerId];
      if (!p) {
        healthByPlayer[pid] = { ratio: 0, isDead: true };
        continue;
      }
      const pMaxHealth = this.getCharacter(p.characterId).maxHealth;
      const shMax = p.shieldMaxCharge ?? 0;
      healthByPlayer[pid] = {
        ratio: pMaxHealth > 0 ? Phaser.Math.Clamp(p.health / pMaxHealth, 0, 1) : 0,
        shieldRatio: shMax > 0 && p.shieldCharge !== undefined ? Phaser.Math.Clamp(p.shieldCharge / shMax, 0, 1) : undefined,
        isDead: p.health <= 0 || !p.alive,
      };
    }

    // Compact per-row status ticks (Jake, 2026-07-14: "lobby/party member
    // need... possibly status buffs and debuffs" — every player, reusing
    // the same descriptor table the local-only text chip strip reads —
    // see statusChips.ts. This is the actual "nameplate chip" surface
    // class-overhaul-workboard.md chunk 4.2 names: the only place a
    // window-buff is legible to anyone other than the buffed player.
    const statusByPlayer: Record<string, NameplateStatusTick[]> = {};
    for (const pid of Object.keys(scores)) {
      const p = state.players[pid as PlayerId];
      if (!p) continue;
      const ticks = deriveNameplateTicks(p, state.tick);
      if (ticks.length > 0) statusByPlayer[pid] = ticks;
    }

    // Per-row class tag (2026-07-20, "put what class everyone is...
    // including self" — the local "YOU" row above reads this same map, no
    // special-case needed since it's keyed by pid like every other field
    // here).
    const classByPlayer: Record<string, ReturnType<typeof classIdForArchetype>> = {};
    for (const pid of Object.keys(scores)) {
      const p = state.players[pid as PlayerId];
      if (p) classByPlayer[pid] = classIdForArchetype(p.characterId);
    }

    const round: HudRound = {
      phase: state.round.phase,
      countdownRemainingMs: state.round.countdownRemainingMs,
      roundIndex: state.round.roundIndex,
      scores,
      names: Object.fromEntries(this.rosterNames),
      colors,
      healthByPlayer,
      statusByPlayer,
      classByPlayer,
      winnerLabel,
    };

    this.hudSystem.update(vitals, round);

    // Diablo-style bottom-center hotkey bar (Jake, 2026-07-14) — resource
    // orbs use the same local player state as `vitals` above; separate call
    // since it's a structurally distinct screen region (bottom vs top-left).
    if (this.actionBar) {
      const shMax = local?.shieldMaxCharge ?? 0;
      // Last-frame charge for the input path's full-charge gate (see the
      // Emission block in the input assembly — reading render state there
      // would double-advance the smoother). Touch mirrors the same gate.
      this.lastKnownEmissionCharge = local?.abilityCharge ?? 0;
      this.touchControls?.setEmissionReady(
        this.lastKnownEmissionCharge >= EMISSION_CHARGE_MAX && !vitals.isDead,
      );
      const localActives = local ? activeSlotVitals(local, state.tick) : [];
      this.touchControls?.setActiveSlots(
        localActives.map((a) => ({ ready: a.readyFrac >= 1 && !vitals.isDead })),
      );
      // Chassis-verb name labels (2026-07-18 legibility pass; shared with
      // TouchControls 2026-07-29 wave 2 QA, clusterA-03) — one resolve, fed
      // to both the canvas HUD (actionBarVitals.classId below) and the DOM
      // Shield/Dash buttons, so they can never name the same ability two
      // different ways again.
      const localClassId = local ? classIdForArchetype(local.characterId) : undefined;
      this.touchControls?.setClassId(localClassId);
      const actionBarVitals: ActionBarVitals = {
        health: local?.health ?? 0,
        maxHealth,
        shieldCharge: local?.shieldCharge ?? 0,
        shieldMaxCharge: shMax,
        dashReadyFrac: local?.dashReadyFrac ?? 1,
        emissionChargeFrac: (local?.abilityCharge ?? 0) / EMISSION_CHARGE_MAX,
        // Card-granted capabilities claim the reserved diamonds in hand
        // order (Jake, 2026-07-16). resolvePlayerBuild + acquiredAbilities
        // are both identity-cached on the cards array — allocation-free
        // per frame until a draft pick swaps the hand.
        // Drafted actives claim the diamonds right after E, keyed 1-3
        // (six-axes Layer 2; rack locked at 3, docs/classes-goal.md) —
        // cooldown sweep + Tithe window derived from the same render state
        // as everything else in this pass.
        actives: localActives,
        acquired: local ? acquiredAbilities(resolvePlayerBuild(local)) : [],
        stolenFangsCharges: local?.pendingLockCharges ?? 0,
        isDead: vitals.isDead,
        // Drives the M2/Dash and shield-orb name text in ActionBarSystem
        // (see localClassId above — same resolve TouchControls gets).
        classId: localClassId,
      };
      this.actionBar.update(actionBarVitals, chips);
    }

    // Death overlay (teach tip ≤1 + optional share when clip URL known).
    // Two variants share the surface (Doors 1.4): a real death gets the
    // ELIMINATED treatment; a pending entrant who has never spawned gets
    // NEXT BELL spectate framing instead — never death copy, never the
    // eliminated/soul-reclaimed announcer.
    // The death variant is HELD BACK ~3s so the death rite (burst → shards
    // → soul returning to the motif) plays unobscured — the overlay was
    // hiding the best moment.
    // Gated by !matchHasEnded (mirrors the round-banner gate right below):
    // without it, a player who dies on the match-winning point keeps
    // ticking through the ~3s death rite reveal underneath the results
    // modal that already popped up, and could flash stale on the next hello.
    if (this.deathOverlay && !this.matchHasEnded) {
      if (vitals.isDead) {
        // Phase-honest wait: one "NEXT BELL" estimate of when the player
        // actually fights again, instead of the raw round clock silently
        // re-meaning itself across phases (venue-goal Pillar 0.2).
        const deadLocal = state.players[this.localPlayerId];
        const respawnSeconds =
          deadLocal?.respawnAtTick !== undefined && state.round.suddenDeathActive !== true
            ? Math.ceil(Math.max(0, (deadLocal.respawnAtTick as number) - state.tick) / 60)
            : null;
        // ONE decision for copy + timer + announcer entitlement (Doors
        // 1.4, unit-tested in deathOverlayPresentation.test.ts):
        // never-spawned → pending-entrant NEXT BELL framing; spawned-
        // then-dead → the classic ELIMINATED treatment.
        const pres = deathOverlayPresentation(
          this.localEverSpawned,
          state.round.phase,
          state.round.countdownRemainingMs,
          respawnSeconds,
        );
        // RoundBanner explicitly hides itself during "fighting" phase (the
        // exact window this overlay is up), and this overlay's own
        // full-viewport blur darkens the peripheral nameplate column behind
        // it — score context otherwise has nowhere to show while dead
        // (Jake, 2026-07-14 UI pass). Recomputed every frame since another
        // player can score while you're still waiting to respawn. For a
        // pending entrant this doubles as the spectate context: the score
        // line IS "who is fighting down there".
        const scoreLine = Object.entries(scores)
          .sort(([aId, a], [bId, b]) => b - a || aId.localeCompare(bId))
          .map(([pid, score]) => {
            const tag = pid === this.localPlayerId ? "YOU" : (round.names?.[pid] ?? this.displayName(pid));
            return `${tag} ${score}`;
          })
          .join("  ·  ");
        if (pres.variant === "pending-entrant") {
          // Admitted at the gate, parked spectating, never spawned: NOT a
          // death. No rite hold, no death tip, no share button — and the
          // eliminated/soul-reclaimed announcer calls live EXCLUSIVELY in
          // the eliminated branch below, so they can never fire here.
          this.localDeathAtMs = null;
          if (this.pendingSinceMs === null) this.pendingSinceMs = performance.now();
          if (this.deathOverlay.isOpen()) {
            this.deathOverlay.updateTimer(pres.wait);
            this.deathOverlay.updateScoreLine(scoreLine);
          } else if (performance.now() - this.pendingSinceMs >= PENDING_OVERLAY_GRACE_MS) {
            this.deathOverlay.show(pres.wait, {
              variant: "pending",
              title: pres.title,
              subtitle: pres.subtitle,
              scoreLine,
            });
          }
        } else {
          if (this.localDeathAtMs === null) {
            this.localDeathAtMs = performance.now();
            announce("eliminated");
            // The soul reaches the seal ~2.9s in — speak as it lands.
            this.time.delayedCall(2_900, () => {
              if (this.localDeathAtMs !== null) announce("soul-reclaimed");
            });
          }
          const riteDone = performance.now() - this.localDeathAtMs >= 3_000;
          if (this.deathOverlay.isOpen()) {
            this.deathOverlay.updateTimer(pres.wait);
            this.deathOverlay.updateScoreLine(scoreLine);
          } else if (riteDone) {
            if (this.deathTipLocked === undefined) {
              this.deathTipLocked = this.computeDeathTip(state);
            }
            this.deathOverlay.show(pres.wait, {
              tip: this.deathTipLocked,
              shareUrl: this.lastShareClipUrl,
              scoreLine,
            });
          }
        }
      } else {
        // Seen self alive: from here on a dead/absent local is a real
        // death, never the pending-entrant wait (Doors 1.4).
        this.localEverSpawned = true;
        this.pendingSinceMs = null;
        this.localDeathAtMs = null;
        if (this.deathOverlay.isOpen()) {
          this.deathOverlay.hide();
          this.deathTipLocked = undefined;
        }
      }
    }

    if (this.prevRoundPhase === "countdown" && state.round.phase === "fighting") {
      announce("fight");
    }
    this.prevRoundPhase = state.round.phase;
    if (!this.matchHasEnded) {
      this.roundBannerSystem.update({
        phase: state.round.phase,
        countdownRemainingMs: state.round.countdownRemainingMs,
        roundIndex: state.round.roundIndex,
        winnerLabel,
        scores,
        names: Object.fromEntries(this.rosterNames),
        localPlayerId: this.localPlayerId,
      });
    }
  }

  // ---------------- Net stats overlay ----------------

  private createStatsHud() {
    const panelWidth = 220;
    const panelHeight = 110;
    const x = uiWidth(this) - panelWidth - 12;
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
      .text(uiWidth(this) - 12, 12, "—ms", {
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
      .text(12, uiHeight(this) - 12, "", {
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
    const panelWidth = (this.statsBg.width as number) || 220;
    const x = uiWidth(this) - panelWidth - 12;
    const y = 12;
    this.statsBg.setPosition(x, y);
    this.statsText.setPosition(x + 8, y + 6);
    // RTT pill anchors to top-right regardless of stats panel state.
    this.rttBadge?.setPosition(uiWidth(this) - 12, this.statsVisible ? y + (this.statsBg.height as number) + 6 : 12);
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
    buf[0] = `FPS       ${Math.round(this.game.loop.actualFps)}`;
    buf[1] = `Frame Δ   ${stats.frameDtEmaMs.toFixed(1)} ms ema`;
    buf[2] = `RTT       ${stats.rttMs.toFixed(1)} ms`;
    buf[3] = `Snap rate ${stats.snapRateHz} Hz`;
    buf[4] = `Pending   ${stats.pendingInputs}`;
    buf[5] = `Δ pred    ${stats.lastPredictDeltaPx.toFixed(2)} px`;
    buf[6] = `Last tick ${stats.lastSnapshotTick}`;
    buf[7] = `Conn      ${stats.transportState}`;
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
      // The admission race (open-doors 1.3): a venue player who queued at
      // the bell pre-opened this exact socket while still standing in the
      // lobby (HangoutScene → arenaPreconnect). Adopt it — the server
      // already inserted them at the countdown edge; opening a FRESH
      // socket here is the handshake race this machinery kills. Null when
      // no usable pre-open exists (direct joins, private rooms, or the
      // warm socket died mid-handoff) → the ordinary fresh-connect path.
      const pre = data.mode === "world" ? takeArenaPreconnect(data.localPlayerId) : null;
      const wsUrl = pre ? pre.wsUrl : await this.resolveWsUrl(data);
      this.setStatus("Opening WebSocket...");
      const transport = pre ? pre.transport : new WsTransport({ url: wsUrl });
      this.loop = new ClientLoop({
        transport,
        matchId: data.matchId ?? "world",
        playerId: data.localPlayerId,
        // Arms the ReconnectSupervisor (venue-goal Pillar 0.5, audit seam
        // #16): without this the supervisor was constructed disabled and
        // the "Trying to reconnect…" overlay was a promise the code could
        // not keep — any WS drop meant a dead client until manual reload.
        // World tokens are stateless HMAC (no TTL, not one-time), so the
        // same URL re-auths; within the server's 10s grace the entity is
        // restored in place, beyond it the world re-adds us as a fresh
        // join — both are live outcomes, not a frozen screen.
        reconnectUrl: wsUrl,
        onAuthoritativeApplied: () => {
          this.setStatus(""); // hide status once we start receiving snapshots
          this.connectionOverlay?.hide();
        },
        onHello: (hello) => {
          // Roster names (chosen at the splash) drive plates + scoreboard.
          for (const p of hello.allPlayers) {
            this.rosterNames.set(p.playerId, p.name);
            if (p.cosmetics) this.rosterCosmetics.set(p.playerId, p.cosmetics);
          }
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
            // The rebuilt world decides our roster membership afresh — if
            // it parks us as a pending entrant, the first dead/absent
            // frames are a WAIT, not a death (Doors 1.4). Re-derived the
            // moment we're seen alive in the new world.
            this.localEverSpawned = false;
            this.pendingSinceMs = null;
          }
        },
        onEvents: (events) => this.handleSimEvents(events),
        onReconnectAttempt: (attempt, nextDelayMs) => {
          this.connectionOverlay?.show({ kind: "reconnecting", attempt, nextDelayMs });
          crumb("net", `reconnect attempt ${attempt} (in ${nextDelayMs}ms)`);
        },
        // Fires only when reconnect is genuinely over (terminal close
        // reason, or all backoff attempts exhausted) — the one honest
        // moment for "you're out". The old code hung a raw
        // transport.onClose here that declared "Connection lost" on EVERY
        // close (including ones the supervisor would have retried) and
        // only ever saw the FIRST transport — a replacement socket's later
        // drop showed nothing at all.
        onConnectionLost: (reason) => {
          this.setStatus(`Disconnected: ${reason}`);
          this.connectionOverlay?.show({
            kind: "terminal",
            reason: `${reason} — reload the page to rejoin`,
          });
          crumb("net", `connection lost (terminal): ${reason}`);
          record({
            kind: "net",
            sig: `ws-lost-${reason}`.slice(0, 32),
            message: `connection lost after reconnect abandoned: ${reason}`,
            crumbs: undefined,
          });
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      this.setStatus(`Connect failed: ${msg}`);
    }
  }

  private async resolveWsUrl(data: OnlineMatchSceneInit): Promise<string> {
    if (data.mode === "world") {
      this.setStatus("Joining the Arena...");
      // Re-sanitize at the join boundary too — localStorage is writable by
      // devtools/extensions, and the server re-checks anyway, but this
      // keeps every read site consistent with the one authoritative rule.
      const assignment = await fetchWorldAssignment(
        data.localPlayerId,
        sanitizePlayerName(localStorage.getItem("jakesjam.playerName") ?? ""),
        // Chassis pick (classes-goal.md P1): the venue station / private-room
        // dropdown both persist to this one key; the arena spawn honors it
        // (server whitelists — same authoritative-pass split as the name).
        sanitizeCharacterId(localStorage.getItem("jakesjam.playerCharacter")),
      );
      return assignment.wsUrl;
    }
    // Server-native private room: token or full wsUrl from lobby start.
    if (data.wsUrl) {
      this.setStatus("Joining private room...");
      return data.wsUrl;
    }
    if (data.matchId && data.matchToken) {
      this.setStatus("Joining private room...");
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const override = new URLSearchParams(window.location.search).get("server");
      const base = override ?? `${proto}//${host}`;
      const url = new URL("/ws", base.replace(/^http/i, "ws"));
      url.searchParams.set("matchId", data.matchId);
      url.searchParams.set("token", data.matchToken);
      return url.toString();
    }
    if (!data.matchId || !data.convexUrl) {
      throw new Error("room mode requires matchId + (matchToken or convexUrl)");
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
    // Soul-return death sequences: birth a soul per player-killed. Uses
    // last frame's state for the corpse position (dead players keep their
    // final position in state; 16ms of staleness is invisible).
    if (this.lastStateForAssist) {
      noteDeathEvents(this.lastStateForAssist, events, this.deathFxState);
    }
    // Death-tip evidence: only real sim signals (never fabricate diedToProjectile).
    const nowMs = performance.now();
    for (const e of events) {
      if (e.t === "parry-deflected" && e.playerId === this.localPlayerId) {
        this.lastLocalParryAtMs = nowMs;
      }
    }
    // Highlight capture — independent of audio readiness, consent-gated.
    // LOCAL-PLAYER highlights only: the recorder captures THIS client's
    // camera, so a bot's multi-kill across the map would clip footage of
    // the local player doing nothing (the pre-fix behavior — it produced
    // boring/false clips).
    if (this.highlightTracker && this.clipRecorder) {
      const highlights = this.highlightTracker.ingest(events, performance.now());
      for (const h of highlights) {
        if (h.playerId !== this.localPlayerId) continue;
        console.log(`[clips] highlight: ${h.label} (${h.playerId})`);
        this.clipRecorder.trigger();
      }
    }
    // C2b: per-event dispatch lives in SimEventRouter. The 120-line
    // switch was inline here. Visual presentation and evidence must still
    // dispatch when WebAudio is unavailable/autoplay-gated; the router's
    // SILENT_AUDIO fallback degrades only the sound channel.
    if (!this.simEventRouter) {
      this.simEventRouter = new SimEventRouter({
        scene: this,
        audio: this.audio ?? null,
        localPlayerId: this.localPlayerId,
        safeShake: (durationMs, intensity) => this.safeShake(durationMs, intensity),
        directionalKick: (dirX, dirY, kickPx, durMs, noisePx) =>
          this.cameraJuice.directionalKick(dirX, dirY, kickPx, durMs, noisePx),
        // K12 whiff kick (R1 row 10): the swing direction at slash-started
        // time, straight off the live render state.
        resolveAimDir: (pid) => {
          const p = this.loop?.getRenderState()?.players[pid];
          if (!p) return undefined;
          const dx = p.aimX - p.x;
          const dy = p.aimY - p.y;
          const len = Math.hypot(dx, dy);
          return len > 0.001 ? { x: dx / len, y: dy / len } : undefined;
        },
        renderTime: this.renderTime,
        spawnDamageNumber: (vid, dmg, headshot) => this.spawnDamageNumber(vid, dmg, headshot),
        spawnDamageNumberAt: (x, y, dmg) => this.spawnDamageNumberAt(x, y, dmg),
        spawnBlastAtPlayer: (pid, r, d, tier) => this.spawnBlastAtPlayer(pid, r, d, tier),
        spawnWardAbsorbFlash: (pid, isPeel) => this.spawnWardAbsorbFlash(pid as string, isPeel),
        spawnSyzygistWardAbsorbFlash: (pid, casterId, wardBroke) =>
          this.spawnSyzygistWardAbsorbFlash(
            pid as string,
            casterId as string,
            wardBroke,
          ),
        killCinematic: (vid) => this.killCinematic(vid),
        emissionCastFeel: (pid, x, y, element) =>
          this.emissionCastFeel(pid as string, x, y, element),
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
      if (event.t === "draft-resolved" && event.playerId === this.localPlayerId) {
        const card = crystalRoundsCards.find((candidate) => candidate.id === event.cardId);
        const player = this.lastStateForAssist?.players[this.localPlayerId];
        if (card) {
          const cardIds = player?.cards.includes(event.cardId)
            ? player.cards
            : [...(player?.cards ?? []), event.cardId];
          this.buildChangeToast?.show({
            card,
            cardIds,
            characterId: player?.characterId ?? "balanced",
            autoPicked: event.autoPicked,
          });
        }
      }
    }
    // Persistent player record (splash stats panel). After dispatch so the
    // router's killStreakCount already includes this event's kill.
    for (const event of events) {
      if (event.t !== "player-killed") continue;
      if (event.killerId === this.localPlayerId && event.victimId !== this.localPlayerId) {
        recordKill();
        // Doors 2.3 — remember whether this beat the stored best; the
        // cycle-end surface reads it. Kept as a field rather than
        // recomputed later because playerStats has ALREADY been updated
        // by then, so "did it beat the record" is unanswerable after the
        // fact.
        const streakNow = this.killStreakCount.get(this.localPlayerId) ?? 0;
        if (recordStreak(streakNow)) {
          this.cycleBeatStreak = true;
          this.cycleBestStreak = streakNow;
        }
        funnel("first_kill"); // Track P1 — the <60 s first-kill gate
      }
      if (event.victimId === this.localPlayerId) {
        recordDeath();
        funnel("first_death");
      }
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
    // Arm the overlay's timer bar with the server-authoritative remaining
    // draft time (venue-goal Pillar 0.3, audit seam #10): the old path
    // called show() → showWithTimer(..., 0), leaving the bar at width 0
    // forever while the hint promised "auto-selects when the timer
    // expires" — and the HUD's real countdown sat blurred out behind this
    // overlay's own backdrop.
    const round = this.loop?.getRenderState()?.round;
    const armMs = draftTimerArmMs(round?.phase ?? "drafting", round?.countdownRemainingMs ?? 0);
    this.cardDraftOverlay.showWithTimer(candidates, onPick, armMs);
  }

  /** Full juice stack for every card pick — color from card.visual. */
  private playLocalCardPickFeel(card: CardDefinition): void {
    const state = this.loop?.getRenderState();
    const local = state?.players[this.localPlayerId];
    const at = local
      ? { x: local.x, y: local.y }
      : { x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y };
    playCardPickFeel(card, {
      scene: this,
      pool: this.particlePool ?? null,
      at,
      addTrauma: (a) => this.cameraJuice?.addTrauma(a),
      playCardSfx: (rarity) => {
        // Rarity scales intensity via heavy flag for legendaries.
        this.audio?.play("card", {
          heavy: rarity === "legendary" || rarity === "rare",
          intensity: rarity === "legendary" ? 1 : rarity === "rare" ? 0.8 : 0.55,
        });
      },
      flashLocalRig: (_color) => {
        // Knock visual pulse on the local rig so the pick reads on-body.
        this.playerRigs.get(this.localPlayerId as string)?.triggerHit(0, -1);
      },
    });
  }

  private spawnDamageNumber(victimId: string, damage: number, headshot = false) {
    const state = this.loop?.getRenderState();
    if (!state) return;
    const victim = state.players[PlayerId(victimId)];
    if (!victim || damage < 1) return;
    // A2 (docs/footage-removal-list.md): a dead victim's render-state
    // position can already be the fresh spawn seal (fast respawn) — the
    // popup would float in empty air, orphaned from the fight. The death
    // FX owns the killing blow's read; numbers are for the living.
    if (!victim.alive) return;
    const isLocal = victimId === this.localPlayerId;
    spawnFloatingDamageNumber(this, victim.x, victim.y, damage, { headshot, isLocal });
  }

  /** The destructible counterpart to `spawnDamageNumber` above — no
   *  `PlayerId`/rig to look up (a destructible has neither), so the
   *  `destructible-hit` SimEvent carries its own `x`/`y` directly. Never a
   *  headshot, never "local" (a destructible has no team-relative read). */
  private spawnDamageNumberAt(x: number, y: number, damage: number) {
    if (damage < 1) return;
    spawnFloatingDamageNumber(this, x, y, damage, { headshot: false, isLocal: false });
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
  private spawnBlastAtPlayer(playerId: string, radius: number, damage: number, tier: "ambient" | "kill" = "ambient"): void {
    if (!this.renderLayer) return;
    const state = this.loop?.getRenderState();
    if (!state) return;
    const player = state.players[PlayerId(playerId)];
    if (!player) return;
    this.renderLayer.spawnExplosionBlast({ x: player.x, y: player.y }, radius, damage, tier);
  }

  /**
   * The real Kindled Ward absorb read (drawWardSlab's construct language) now
   * lives in `ConstructVfxController` — it scans the same `ward-absorbed` /
   * `team-peel-absorbed` events directly (its own established pattern, same
   * as slash-hit) and paints the impact bloom + shock ripple ON the actual
   * held slab, not a generic explosion decal. This method is kept as a no-op
   * visual passthrough because `SimEventRouter`'s dispatch still calls it
   * alongside its own (unrelated, still-live) local camera-shake — only the
   * old placeholder blast (`renderLayer.spawnExplosionBlastBig`, gold-tinted)
   * is removed; firing both here and in ConstructVfxController would double
   * up two different visual languages on the same hit.
   */
  private spawnWardAbsorbFlash(_playerId: string, _isPeel: boolean): void {
    // Intentionally empty — see doc comment above.
  }

  /** Syzygist wards are cool-white and relational: the protected vessel gets
   * the dominant barrier impact, while an ally caster gets a smaller source
   * pulse. A break expands the impact so depletion reads without relying on
   * colour or sound. */
  private spawnSyzygistWardAbsorbFlash(
    playerId: string,
    casterId: string,
    wardBroke: boolean,
  ): void {
    if (!this.renderLayer) return;
    const state = this.loop?.getRenderState();
    if (!state) return;
    const protectedPlayer = state.players[PlayerId(playerId)];
    if (!protectedPlayer) return;
    const SYZYGIST_WHITE = 0xdbeafe;
    this.renderLayer.spawnExplosionBlastBig(
      { x: protectedPlayer.x, y: protectedPlayer.y },
      wardBroke ? 48 : 30,
      SYZYGIST_WHITE,
    );
    if (casterId !== playerId) {
      const caster = state.players[PlayerId(casterId)];
      if (caster) {
        this.renderLayer.spawnExplosionBlastBig(
          { x: caster.x, y: caster.y },
          18,
          SYZYGIST_WHITE,
        );
      }
    }
  }

  /**
   * P3 (docs/vfx-spec.md) — cinematic KILL moment: camera flash + micro
   * zoom-punch + an additive bloom pop at the victim. Built on Phaser 4's
   * built-in camera FX (Phaser 4.1 dropped the PostFXPipeline API, so no
   * fragment-shader bloom — the additive-glow layer is the bloom). Gated by
   * `combatCinematics` so it's off on Canvas fallback or `?fx=off`.
   */
  /** Emission cast feel (emission-engine-goal P1/P2 UI contract): the
   *  caster's dominant Coptic seal flashes at the vessel — the seal
   *  grammar IS the casting grammar, no new iconography — plus the same
   *  punch-zoom family the kill moment uses, biased toward the cast.
   *  Element-tinted flash for the local caster only (a remote cast
   *  shouldn't strobe your screen). Render-only; tweened text object. */
  private emissionCastFeel(casterId: string, x: number, y: number, element: string): void {
    if (!this.combatCinematics) return;
    const cam = this.cameras.main;
    this.cameraJuice.punchZoom(cam.zoom * 0.05, 70, 220, x, y);
    if (casterId === this.localPlayerId) {
      const tint = ELEMENT_COLORS[element as keyof typeof ELEMENT_COLORS] ?? 0x3c79f0;
      cam.flash(110, (tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff, false);
    }
    // Dominant seal = the seal of the card that gave the hand its element
    // (last element-bucket card), else the hand's last card, else the
    // sphragis default the draft overlay already uses.
    const state = this.loop?.getRenderState();
    const caster = state?.players[PlayerId(casterId)];
    const hand = caster ? findCardsById(crystalRoundsCards, caster.cards) : [];
    const dominant =
      [...hand].reverse().find((c) => (c.buckets ?? []).includes("element")) ??
      hand[hand.length - 1];
    const seal = dominant ? sealForCard(dominant) : null;
    const sealText = seal ? seal.coptic : "ⲤⲪⲢⲀⲄⲒⲤ";
    const t = this.add
      .text(x, y - 64, sealText, {
        fontFamily: "'Segoe UI Historic', 'Noto Sans Coptic', 'Noto Sans', serif",
        fontSize: "22px",
        color: "#c9a84c",
        stroke: "#05080f",
        strokeThickness: 4,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(950)
      .setAlpha(0);
    this.tweens.add({
      targets: t,
      alpha: { from: 0, to: 1 },
      y: y - 92,
      duration: 180,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: t,
          alpha: 0,
          y: y - 116,
          duration: 420,
          ease: "Quad.easeIn",
          onComplete: () => t.destroy(),
        });
      },
    });
  }

  private killCinematic(victimId: string): void {
    if (!this.combatCinematics) return;
    const cam = this.cameras.main;
    // Brief warm flash — sells the "everything pops" beat over the hit-stop.
    cam.flash(90, 255, 240, 200, false);
    // Additive bloom pop at the victim.
    const state = this.loop?.getRenderState();
    const victim = state?.players[PlayerId(victimId)];
    // Zoom-punch: snap in ~4% then ease back, biased toward the actual
    // point of impact (the victim) rather than only ever punching in on
    // wherever the local player's own camera already happened to be.
    this.cameraJuice.punchZoom(cam.zoom * 0.04, 70, 200, victim?.x, victim?.y);
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
    // World-recycle re-hellos every socket; if this scene is stopped or
    // mid-shutdown the camera system is already gone and cam.setBounds
    // throws (real phone crash, telemetry sig 2026-07-11: "Cannot read
    // properties of undefined (reading 'setBounds')"). A hello for a dead
    // scene is stale — drop it.
    if (!this.cameras?.main || !this.scene.isActive()) {
      crumb("scene", `renderArena skipped — scene inactive (map=${mapId})`);
      return;
    }
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
    // CSS-px viewport (uiWidth/uiHeight) so world padding is renderScale-invariant.
    const padX = Math.round(uiWidth(this) / 6);
    const padY = Math.round(uiHeight(this) / 6);
    // Portrait mobile biases the player high on the tall screen (so the bottom
    // control band never covers them). That only works if the camera may drop
    // BELOW the arena floor — otherwise the bottom bound clamps the view and
    // the player slides down behind the controls. 0.5×height balances the
    // two failure modes: the old height/1.4 (~0.71) pad let the camera show a
    // huge raw-void gap between floor and band, while a band-sized 0.34 pad
    // clamped a floor-standing player right down to the band edge under the
    // thumbs. At 0.5 a player on the bottom floor rides at ~45% of the
    // screen and the band gradient covers most of the sub-floor void.
    const bottomPad = isPortraitMobile() ? Math.round(uiHeight(this) * 0.5) : padY;
    cam.setBounds(-padX, -padY, width + padX * 2, height + padY + bottomPad);
    // Round pixels stays OFF: this is a vector-art game and camera-level
    // rounding quantizes slow pans to whole-pixel steps (visible stutter on
    // drift). MSAA (GameConfig antialias:true) handles edge quality instead.
    cam.setRoundPixels(false);

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
    // Cool Forerunner void base under the skybox (not purple church night).
    g.fillStyle(0x0a101c, 1);
    g.fillRect(0, 0, width, height);
    g.fillGradientStyle(0x101a30, 0x101a30, 0x0a101c, 0x0a1420, 0.9, 0.9, 1, 1);
    g.fillRect(0, 0, width, height);
    g.fillStyle(0x0a3040, 0.2);
    g.fillEllipse(width * 0.35, height * 0.25, width * 0.9, height * 0.5);
    g.fillStyle(0x123850, 0.18);
    g.fillEllipse(width * 0.7, height * 0.4, width * 0.8, height * 0.45);
    // Quiet instrument grid
    const gridGold = typeof theme.gold === "number" ? theme.gold : PALETTE.hullGold;
    const gridStep = 96;
    g.lineStyle(1, gridGold, 0.03);
    for (let gx = 0; gx <= width; gx += gridStep) {
      g.lineBetween(gx, 0, gx, height);
    }
    for (let gy = 0; gy <= height; gy += gridStep) {
      g.lineBetween(0, gy, width, gy);
    }
    g.lineStyle(1, theme.wash, 0.06);
    g.lineBetween(0, height * 0.42, width, height * 0.42);
    g.fillStyle(0xffffff, 1);

    // Soft mid haze — more present than before
    const hazeColor = 0x1a3050;
    const hazeDefs: Array<{ rx: number; ry: number; ew: number; eh: number; a: number }> = [
      { rx: 0.25, ry: 0.35, ew: width * 0.75, eh: height * 0.35, a: 0.1 },
      { rx: 0.65, ry: 0.5, ew: width * 0.7, eh: height * 0.4, a: 0.08 },
      { rx: 0.5, ry: 0.25, ew: width * 0.55, eh: height * 0.28, a: 0.09 },
    ];
    this.hazeEllipses = [];
    // fxLevel 0: three large blended ellipses are fullscreen-class fill —
    // part of the Pi's measured 10→30fps gap (2026-07-10).
    const hazeWanted = getQualityProfile().fxLevel > 0;
    for (const hd of hazeWanted ? hazeDefs : []) {
      const ellipse = this.add
        .ellipse(width * hd.rx, height * hd.ry, hd.ew, hd.eh, hazeColor, hd.a)
        .setDepth(0.5);
      this.hazeEllipses.push({ ellipse, baseAlpha: hd.a });
    }

    if (theme.hasLightBeams) {
      if (!this.lightBeams) this.lightBeams = new LightBeamLayer(this);
      // Crystal projector shafts — cyan spark, not warm sun.
      this.lightBeams.spawn(
        [
          { x: width * 0.18, w: 70 },
          { x: width * 0.38, w: 90 },
          { x: width * 0.55, w: 110 },
          { x: width * 0.72, w: 85 },
          { x: width * 0.88, w: 65 },
        ],
        height,
        PALETTE.lightBeamCyan ?? 0x8ff8ff,
        0.09,
      );
    }

    if (!this.platformLayer) this.platformLayer = new PlatformLayer(this);
    this.platformLayer.repaint(map.platforms, theme, map.launchPads, map.slopes);

    // Cosmic death-arena vault — choir of angels, elemental orbs, rings
    // that pulse with live music amplitude + action intensity.
    if (!this.cosmicArena) this.cosmicArena = new CosmicArenaLayer(this);
    this.cosmicArena.spawn(width, height);
    // Souls fly to the seal at the arena's center (matches motifX/motifY —
    // world*0.5 — even on potato where the seal itself isn't drawn).
    setDeathFxTarget(this.deathFxState, width * 0.5, height * 0.5);

    // Theme-independent environment reaction (see updateEnvironmentReactivity).
    // renderArena can re-run on a map change, so replace any prior bloom.
    this.energyBloom?.destroy();
    const bloomCam = this.cameras.main;
    this.energyBloom = this.add
      .rectangle(bloomCam.width / 2, bloomCam.height / 2, bloomCam.width, bloomCam.height, 0xffc27a, 0)
      .setScrollFactor(0)
      .setDepth(1.5)
      .setBlendMode(Phaser.BlendModes.ADD);
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
    // Scratch collections + for-in: this runs every frame, and the old
    // `new Set()` + `Object.entries()` pair allocated on every call
    // (game-loop-perf: zero-alloc hot path).
    const seenPlayers = this.seenPlayersScratch;
    seenPlayers.clear();
    // Detect alive→dead transitions this frame for kill-streak callouts.
    const newlyDead = this.newlyDeadScratch;
    newlyDead.length = 0;
    this.retrofitRigDowngradeIfNeeded(state);
    for (const pid in state.players) {
      const player = state.players[PlayerId(pid)]!;
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
      // Clip focus is rebuilt once per frame after the player loop
      // (see updateClipFocusWorld) so it can envelope local + nearest enemy.
    }

    this.updateClipFocusWorld(state);

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
        // Announcer: YOUR kills only (Halo rule — the voice speaks to you).
        const tiers = ["kill", "double-kill", "triple-kill", "multi-kill"] as const;
        announce(tiers[Math.min(streak, tiers.length) - 1]!);
      }
    }

    for (const [pid, rig] of this.playerRigs) {
      if (!seenPlayers.has(pid)) {
        rig.destroy();
        this.playerRigs.delete(pid);
        this.crouchHalfByPid.delete(pid);
        this.buildCacheByPid.delete(pid);
      }
    }

    if (this.currentMap) {
      if (!this.stormZone) this.stormZone = this.add.graphics().setDepth(8);
      this.stormZone.clear();
      produceStormZone(state, this.currentMap.size, this.stormZoneModel);
      drawStormZone(this.stormZone, this.stormZoneModel, state.tick, getQualityProfile().fxLevel);
    }

    if (!this.presence) this.presence = this.add.graphics().setDepth(11.5);
    this.presence.clear();
    drawPlayerPresence(this.presence, state, this.localPlayerId, getQualityProfile().fxLevel);
    this.drawCombatFx(state);
    this.drawDeathFxLayer(state, deltaMs);

    this.entityRender?.update(state, deltaMs, nowMs);
  }

  /** Soul-return death sequences — contract producer + shared painter
   *  (same code path as ReplayScene, so clips show the identical rite). */
  private drawDeathFxLayer(state: WorldState, deltaMs: number): void {
    if (!this.deathFx) {
      this.deathFx = this.add
        .graphics()
        .setDepth(13)
        .setBlendMode(Phaser.BlendModes.ADD);
    }
    const g = this.deathFx;
    g.clear();
    const fx = getQualityProfile().fxLevel;
    const souls = produceDeathFx(state, deltaMs, this.deathFxState, this.deathFxModels);
    this.deathFxSoulCount = souls; // death-cam scans only LIVE models
    if (souls > 0) drawDeathFx(g, this.deathFxModels, souls, fx);
    const shards = produceDeathShards(state, deltaMs, this.deathFxState, this.deathShardModels);
    if (shards > 0) drawDeathShards(g, this.deathShardModels, shards, fx);
    const uploads = produceSpawnFx(state, deltaMs, this.deathFxState, this.spawnFxModels);
    if (uploads > 0) drawSpawnUploads(g, this.spawnFxModels, uploads, fx);
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
    // Contract producer owns the block-flash derivation (renderContract.ts);
    // this is now a pure painter over the models.
    const count = produceCombatFx(state, this.combatFxState, this.combatFxModels);
    for (let i = 0; i < count; i++) {
      const m = this.combatFxModels[i]!;
      if (m.shieldActive) {
        g.fillStyle(0x93c5fd, 0.08 + m.shieldFlash * 0.28);
        g.fillCircle(m.x, m.y, SHIELD_RADIUS);
        g.lineStyle(2 + m.shieldFlash * 3, 0x93c5fd, 0.62 + m.shieldFlash * 0.38);
        g.strokeCircle(m.x, m.y, SHIELD_RADIUS);
        // Expanding ripple ring on a block.
        if (m.shieldFlash > 0.02) {
          g.lineStyle(2, 0xdbeafe, m.shieldFlash * 0.75);
          g.strokeCircle(m.x, m.y, SHIELD_RADIUS + (1 - m.shieldFlash) * 24);
        }
      }
      if (m.parryActive) {
        g.fillStyle(0xf7fbff, 0.13);
        g.slice(m.x, m.y, PARRY_RANGE, m.parryFacing - PARRY_ARC / 2, m.parryFacing + PARRY_ARC / 2, false);
        g.fillPath();
        g.lineStyle(3, 0xf7fbff, 0.82);
        g.beginPath();
        g.arc(m.x, m.y, PARRY_RANGE, m.parryFacing - PARRY_ARC / 2, m.parryFacing + PARRY_ARC / 2, false);
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
    const label = killstreakLabel(streak);
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

  /** Shared by makePlayerRig and the retrofit sweep below — one resolution
   *  of "baked vs live" so the ?rig= override contract can't drift between
   *  the two call sites. */
  private resolveRigStyle(): "live" | "baked" {
    const rigOverride = new URLSearchParams(window.location.search).get("rig");
    if (rigOverride === "baked" || rigOverride === "live") return rigOverride;
    return getEffectiveRigStyle();
  }

  /** Perf audit R2 (2026-07-18): forceRigDowngrade() only affected rigs
   *  CONSTRUCTED after it fired — every rig already alive when the governor
   *  detected futility kept paying full ProceduralPlayerRig cost for the
   *  rest of its life (i.e. the rest of the match, for anyone who doesn't
   *  die). Swap any live rig over to the baked twin the instant the
   *  effective style flips, so the governor's own diagnosis actually
   *  relieves the session it fired for, not just future respawns. */
  /** Once every currently-known rig is confirmed baked, later frames can
   *  skip the sweep entirely — new joiners always resolve their style
   *  correctly at construction (makePlayerRig), and `runtimeRigDowngrade`
   *  never resets mid-session (qualityProfile.ts), so "baked" never flips
   *  back to "live" without a full reload. */
  private rigDowngradeFullySwept = false;

  private retrofitRigDowngradeIfNeeded(state: WorldState): void {
    if (this.rigDowngradeFullySwept) return;
    if (this.resolveRigStyle() !== "baked") return;
    let anyStillLive = false;
    for (const [pid, rig] of this.playerRigs) {
      if (rig instanceof BakedPlayerRig) continue;
      const player = state.players[PlayerId(pid)];
      if (!player) {
        anyStillLive = true;
        continue;
      }
      const replacement = this.makePlayerRig(player, pid === this.localPlayerId);
      rig.destroy();
      this.playerRigs.set(pid, replacement);
    }
    if (!anyStillLive) this.rigDowngradeFullySwept = true;
  }

  private makePlayerRig(player: PlayerEntity, isLocal: boolean): ProceduralPlayerRig {
    const character = this.getCharacter(player.characterId);
    const bot = isBotId(player.id);
    // Baked twin on the potato tier (or ?rig=baked / ?rig=live override for
    // A/B renders): SAME pose solve, textured-quad painters.
    const rigStyle = this.resolveRigStyle();
    const RigClass = rigStyle === "baked" ? BakedPlayerRig : ProceduralPlayerRig;
    // Real per-player cosmetics from the hello roster (Vessel Creator,
    // docs/vessel-creator-design.md) — bots never have any. A player who
    // never opened the creator has every channel undefined here, which
    // reproduces the exact pre-cosmetics look (see the per-field fallbacks
    // below), so this is zero-regression for the common case.
    const cosmetics = bot ? undefined : this.rosterCosmetics.get(player.id);
    // Chassis color register (docs/chassis-design-axioms.md CA2, arena-only
    // pass 2026-07-18). Priority, decided this session:
    //   1. The player's OWN Vessel Creator cosmetic pick (cosmetics?.xColor)
    //      — a paid/chosen personalization always wins.
    //   2. The class-derived default (classAccentColors.ts) — cyan for
    //      Geometrician/Interstice, gold for Kindled, cool-white for
    //      Syzygist. This REPLACES the old "local player defaults to gold
    //      (0xffd166), remote/bot defaults to the rig's built-in cyan"
    //      convention: that rule predates the class system and was a
    //      class-blind "this is YOUR hero" marker. Keeping it would now
    //      actively fight the class signal — e.g. a local Geometrician
    //      would render gold (wrong register) while a remote Geometrician
    //      renders correctly. Class now carries the "this matters" signal
    //      CA2 wants, so the old local/remote accent rule is retired here.
    //      Bots ARE class-aware for this glow (they have a real
    //      characterId/classId) — only their BODY tint stays hardcoded
    //      violet (below), which is a separate "unmistakable bot" signal,
    //      not a light-quality register CA2 governs.
    const classPalette = classAccentPalette(character.classId);
    return new RigClass(this, {
      // Bots render VIOLET with a "BOT · NAME" plate — unmistakable next
      // to the teal local / crimson remote rigs and the ochre terrain.
      // Deliberately NOT class-derived: this is a "who/what is this"
      // identity signal (friend/foe/bot at a glance), the same job the
      // local-gold/remote-crimson split below does for real players — CA1
      // ("black vessel-suit... nothing about the SILHOUETTE MATERIAL
      // changes between classes") already says the body plate itself
      // isn't a class-color surface; only the glow channels are.
      color: bot
        ? BOT_RIG_COLOR
        : isLocal
          ? LOCAL_PLAYER_FALLBACK_COLOR
          : REMOTE_PLAYER_FALLBACK_COLOR,
      accentColor: cosmetics?.accentColor
        ? colorToNumber(cosmetics.accentColor)
        : classPalette.accentColor,
      visorColor: cosmetics?.visorColor
        ? colorToNumber(cosmetics.visorColor)
        : classPalette.visorColor,
      palmColor: cosmetics?.palmColor ? colorToNumber(cosmetics.palmColor) : classPalette.palmColor,
      jointColor: cosmetics?.jointColor
        ? colorToNumber(cosmetics.jointColor)
        : classPalette.jointColor,
      auraColor: cosmetics?.auraColor ? colorToNumber(cosmetics.auraColor) : classPalette.auraColor,
      // Chosen name from the hello roster; id-suffix fallback. The old
      // "/ Balanced" archetype suffix was dev noise (Jake, 2026-07-11).
      name: bot ? botLabel(player.id) : (this.rosterNames.get(player.id) ?? player.id.slice(-4)),
      // The real connection id, not the display name — two players who
      // happen to pick the same name still get visually distinct sigils.
      identitySeed: player.id,
      scale: this.getVisualScale(character),
      // Chassis silhouette (CA3) — branches the head-crest/hood geometry.
      // Arena-only for this pass; MainMenuScene/TutorialScene/MatchScene/
      // HangoutScene are untouched and keep omitting classId, which
      // defaults the rig to "wizard" geometry (byte-identical to before).
      classId: character.classId,
      // Full juice for local; lite path for remotes/bots (fewer Graphics
      // ops). Potato tier runs EVERY rig lite — per-frame vector
      // tessellation is the tier's biggest CPU line item until the baked
      // rig backend lands (RENDER_OVERHAUL_PLAN Phase 2).
      detail: isLocal && getQualityProfile().tier !== "potato" ? "full" : "lite",
    });
  }

  /** Cache createWeaponBuild — was rebuilt every rig every frame. */
  private readonly buildCacheByPid = new Map<
    string,
    { ids: readonly string[]; maxHealthAdd: number; parryCover: number }
  >();

  /** Element-wise compare so the per-frame cache check allocates nothing —
   *  the old `cardIds.join(",")` built a string per player per frame. */
  private static cardIdsEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Reused every rig update — the rig consumes the pose synchronously
   *  (copies what it keeps), so one mutable scratch object replaces four
   *  small allocations per rig per frame. */
  private readonly rigPoseScratch = {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    aimTarget: { x: 0, y: 0 },
    grounded: true,
    crouching: false,
    health: 100,
    maxHealth: 100,
    touchingWallDir: 0,
    dashing: false,
    shieldArcScale: 1,
    platingGlow: 0,
    shieldHeld: false,
    cameraTopWorldY: undefined as number | undefined,
  };
  /** Cull margin (world px) beyond the camera's view — generous enough that
   *  a rig's trail/shield arc never visibly pops at the screen edge. */
  private static readonly RIG_CULL_MARGIN = 220;
  /** Ease sim crouch half-height (28↔19) so feet don't jump 9px on duck. */
  private static readonly CROUCH_HALF_TAU_MS = 55;
  private readonly crouchHalfByPid = new Map<string, number>();

  private updatePlayerRig(
    rig: ProceduralPlayerRig,
    player: PlayerEntity,
    deltaMs: number,
  ) {
    if (!player.alive) {
      // R1 row 4 fix (K7 tape, 2026-07-24): hiding the rig the instant
      // `alive` flips false swallowed the ENTIRE victim-side melee-kill
      // chord — the 1.5x kill hold (225ms Kindled), the 67ms full-white
      // kill flash and the squash all start on the death tick and had
      // never rendered a single live frame (the K7 trace showed every
      // killed victim's rig frozen at elapsedMs=0). At 12fps tape that is
      // literally "victim present one frame, gone the next" — Jake's
      // clip. A rig still speaking its impact chord keeps rendering
      // through it (the white, vibrating, squashed corpse IS the kill
      // presentation — the hold freezes it in place); it hides the frame
      // the chord finishes. Non-melee deaths (no chord) hide instantly,
      // exactly as before.
      if (!rig.isImpactSpeaking()) {
        rig.setVisible(false);
        this.crouchHalfByPid.delete(player.id as string);
        return;
      }
    }
    // Off-screen culling: an out-of-view rig still costs a full procedural
    // redraw (dozens of Graphics path ops) every frame. Skip it entirely —
    // matters increasingly as the world fills toward 16 players with the
    // action camera cropped in. The local player is always in view (the
    // camera follows them), so this can't cull "you".
    const view = this.cameras.main.worldView;
    const M = OnlineMatchScene.RIG_CULL_MARGIN;
    if (
      player.x < view.x - M ||
      player.x > view.right + M ||
      player.y < view.y - M ||
      player.y > view.bottom + M
    ) {
      rig.setVisible(false);
      return;
    }
    rig.setVisible(true);
    const halfTarget = player.crouching ? SIM_CROUCH_HALF_HEIGHT : SIM_BODY_HALF_HEIGHT;
    const pid = player.id as string;
    let halfHeight = this.crouchHalfByPid.get(pid) ?? halfTarget;
    if (deltaMs > 0) {
      const k = 1 - Math.exp(-deltaMs / OnlineMatchScene.CROUCH_HALF_TAU_MS);
      halfHeight += (halfTarget - halfHeight) * k;
      if (Math.abs(halfHeight - halfTarget) < 0.05) halfHeight = halfTarget;
    } else {
      halfHeight = halfTarget;
    }
    this.crouchHalfByPid.set(pid, halfHeight);
    const character = this.getCharacter(player.characterId);
    const pose = this.rigPoseScratch;
    pose.position.x = player.x;
    pose.position.y = player.y + halfHeight;
    pose.velocity.x = player.vx;
    pose.velocity.y = player.vy;
    pose.aimTarget.x = player.aimX;
    pose.aimTarget.y = player.aimY;
    // PlayerEntity.grounded is wire-encoded as of commit ef365c7 (P_HI
    // bit 4). Falls back to true if the snapshot omits it (older builds
    // or the brief window before the first snap arrives).
    pose.grounded = player.grounded ?? true;
    pose.crouching = player.crouching;
    pose.health = player.health;
    // Card-driven plating — cache by card-id list (no rebuild every frame).
    const cardIds = player.cards ?? [];
    let cached = this.buildCacheByPid.get(pid);
    if (!cached || !OnlineMatchScene.cardIdsEqual(cached.ids, cardIds)) {
      if (cardIds.length > 0) {
        const build = createWeaponBuild(
          starterWeapon,
          findCardsById(crystalRoundsCards, cardIds),
        );
        cached = {
          ids: cardIds.slice(),
          maxHealthAdd: build.maxHealthAdd ?? 0,
          parryCover: build.parryCoverMultiplier ?? 1,
        };
      } else {
        cached = { ids: cardIds.slice(), maxHealthAdd: 0, parryCover: 1 };
      }
      this.buildCacheByPid.set(pid, cached);
    }
    pose.maxHealth = character.maxHealth + cached.maxHealthAdd;
    pose.shieldArcScale = cached.parryCover;
    pose.platingGlow = Math.min(1, cached.maxHealthAdd / 40);
    // touchingWallDir/dashing wire-encoded per P_HI.wallDirNeg/wallDirPos/
    // dashing (same optional/additive pattern as grounded above).
    pose.touchingWallDir = player.touchingWallDir ?? 0;
    pose.dashing = player.dashing ?? false;
    // K11 ward brace: same snapshot boolean the ward slab VFX frame-diffs.
    pose.shieldHeld = player.shieldActive === true;
    // clip-goal wave-2 clusterA-06: keep the nameplate from hard-clipping
    // against the top of frame — `view` above is the same worldView this
    // function already reads for off-screen culling.
    pose.cameraTopWorldY = view.y;
    rig.update(deltaMs, pose);
  }

  /** id → definition, built once (characters.find per rig per frame was a
   *  linear scan + closure allocation in the render loop). */
  private static readonly characterById = new Map(
    characters.map((c) => [c.id as string, c]),
  );

  private getCharacter(
    characterId: CharacterId | string | undefined,
  ): CharacterDefinition {
    return (
      (characterId !== undefined
        ? OnlineMatchScene.characterById.get(characterId as string)
        : undefined) ?? characters[0]!
    );
  }

  private getVisualScale(character: CharacterDefinition): number {
    return PLAYER_VISUAL_SCALE * character.sizeScale;
  }

  /**
   * Vertical clip crop target in world space: midpoint of local player and
   * the nearest living enemy (envelope law). Dead local → null (crop falls
   * back to canvas centre = spectate action).
   */
  private updateClipFocusWorld(state: WorldState): void {
    const local = state.players[this.localPlayerId];
    this.aliveNonLocalScratch.length = 0;
    if (!local?.alive) {
      this.clipFocusWorld = null;
      this.clipFocusSubjects = [];
      return;
    }
    // Perf audit M4 (2026-07-18): shared with followLocalPlayer (runs right
    // after this, same frame — see renderWorld/update call order) so the
    // alive-non-local scan only happens once, not twice. Fresh {x,y}
    // literals each frame (not reused object instances) — stickyEnvelope
    // Subjects retains some of these across frames via this.clipFocusSubjects,
    // so mutating shared object instances in place next frame would corrupt
    // that hysteresis state.
    for (const [id, p] of Object.entries(state.players)) {
      if (id === (this.localPlayerId as string)) continue;
      if (p?.alive) this.aliveNonLocalScratch.push({ x: p.x, y: p.y });
    }
    const self = { x: local.x, y: local.y };
    // Sticky partner pick (enter 750px / exit 950px hysteresis) — keeps the
    // crop on the same duel partner instead of thrashing between foes.
    this.clipFocusSubjects = stickyEnvelopeSubjects(self, this.aliveNonLocalScratch, this.clipFocusSubjects, 1);
    const partner = this.clipFocusSubjects[0];
    this.clipFocusWorld = partner
      ? { x: (self.x + partner.x) / 2, y: (self.y + partner.y) / 2 }
      : self;
  }

  private followLocalPlayer(state: WorldState, deltaMs: number) {
    const local = state.players[this.localPlayerId];
    if (!local) return;

    // ROUND-START ALIGNMENT: CosmicArenaLayer bakes its seal/rings ONCE at
    // a fixed worldW*0.5, worldH*0.5 anchor (same point deathFx souls fly
    // to — see renderArena) and never redraws them. During "countdown",
    // players aren't "alive" fighters yet, so the extras-within-1100px
    // centroid below has nothing to track and the camera instead anchors
    // on the local player's raw spawn point — which visibly disagrees with
    // the seal's fixed center. Snap once on the countdown transition so
    // camera and backdrop agree for exactly the window they'd otherwise
    // briefly fight (this.prevRoundPhase is read here, before
    // updateHudSystem — called later this same frame — advances it).
    if (
      this.prevRoundPhase !== "countdown" &&
      state.round.phase === "countdown" &&
      this.currentMap
    ) {
      this.actionCamera.snap(this.currentMap.size.x * 0.5, this.currentMap.size.y * 0.5);
    }

    // Portrait mobile: bias the player above screen centre so the bottom
    // control band doesn't cover them (centre the camera BELOW the player).
    const yBias = isPortraitMobile() ? PORTRAIT_CAM_Y_BIAS : 0;

    // DEATH SPECTATE: while dead, anchoring on your own corpse position
    // parks the camera over empty map as the fight moves on (very visible
    // in a full world where the round outlives you by a while). Instead,
    // anchor on the alive player nearest the camera's current midpoint —
    // stable handoffs (no cross-map jumps when your anchor dies; the next-
    // closest fighter is usually right there), and the ActionCamera's own
    // snap threshold covers the rare far handoff.
    let anchor = local;
    // DEATH-CAM: while YOUR soul is in flight, the camera rides it home to
    // the motif — the rite is the anchor. The producer ran earlier this
    // frame, so deathFxModels holds current soul positions.
    let soulAnchor: { x: number; y: number } | null = null;
    if (!local.alive) {
      for (let i = 0; i < this.deathFxSoulCount; i++) {
        const m = this.deathFxModels[i]!;
        if (m.pid === this.localPlayerId && m.alpha > 0.05) {
          soulAnchor = m;
          break;
        }
      }
    }
    if (soulAnchor) {
      anchor = { ...local, x: soulAnchor.x, y: soulAnchor.y };
    } else if (!local.alive) {
      const mid = this.cameras.main.midPoint;
      let bestD2 = Number.POSITIVE_INFINITY;
      let best: PlayerEntity | null = null;
      for (const p of Object.values(state.players)) {
        if (!p.alive) continue;
        const dx = p.x - mid.x;
        const dy = p.y - mid.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = p;
        }
      }
      // Nobody alive (round resolving) — hold the last framing.
      if (!best) return;
      anchor = best;
    }

    // Nearest few within mid range — sticky pick still caps to 1 duel partner.
    // Perf audit M4: `anchor === local` exactly when local is alive (the
    // only reassignment happens inside `if (!local.alive)` above) — the
    // exact same condition updateClipFocusWorld used to populate
    // aliveNonLocalScratch this same frame (it runs first). Reuse that scan
    // instead of a second full Object.entries(state.players) pass.
    const extra: Array<{ x: number; y: number; d: number }> = [];
    const source: Iterable<{ x: number; y: number }> =
      anchor === local
        ? this.aliveNonLocalScratch
        : Object.values(state.players).filter((p) => p.id !== anchor.id && p.alive);
    for (const p of source) {
      const d = Math.hypot(p.x - anchor.x, p.y - anchor.y);
      if (d > 1100) continue;
      extra.push({ x: p.x, y: p.y, d });
    }
    extra.sort((a, b) => a.d - b.d);
    this.actionCamera.update(deltaMs, {
      x: anchor.x,
      y: anchor.y,
      vx: anchor.vx,
      vy: anchor.vy,
      aimX: anchor.aimX,
      aimY: anchor.aimY,
      extra: extra.slice(0, 3).map(({ x, y }) => ({ x, y })),
      yBias,
      hype: this.cameraHype.get(),
      peak: this.cameraHype.isPeak(),
      beatPulse: getMusicLevel().beat,
    });
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

    // Landing impact — a real thump scaled by fall speed (trauma shake).
    if (!this.prevLocalGrounded && local.grounded && this.prevLocalVy > 200) {
      const fallRatio = Phaser.Math.Clamp((this.prevLocalVy - 200) / 700, 0, 1);
      this.cameraJuice.addTrauma(0.18 + fallRatio * 0.4);
    }

    // Wall-jump / power-slide kick-off — GENTLE trauma only. The previous
    // zoom-punch here played badly (frequent action pulsing the whole frame).
    const wallDir = local.touchingWallDir ?? 0;
    if (this.prevLocalWallDir !== 0 && wallDir === 0 && !local.grounded) {
      const speedRatio = Phaser.Math.Clamp((Math.abs(local.vx) - 400) / 300, 0, 1);
      this.cameraJuice.addTrauma(0.12 + speedRatio * 0.1);
    }
    this.prevLocalWallDir = wallDir;

    // Dash burst — small trauma; the camera look-ahead sells the speed, no
    // zoom — plus the launch whoosh (render-side: prediction makes this land
    // the instant the local player slides, no server round-trip).
    const dashing = local.dashing ?? false;
    if (!this.prevLocalDashing && dashing) {
      this.cameraJuice.addTrauma(0.14);
      this.audio?.play("dash");
    }
    this.prevLocalDashing = dashing;

    this.prevLocalGrounded = local.grounded ?? true;
    this.prevLocalVy = local.vy;
  }

  /**
   * The environment reacting to action intensity — same score driving the
   * camera juice and music (see ActionIntensity). Combat contributes here
   * too (every safeShake bumps intensity), so a fight ramps the whole
   * scene's atmosphere. The light beams flaring (additive) is the legible
   * cue; the haze lift is a supporting glow (too faint alone).
   */
  private updateEnvironmentReactivity(): void {
    const intensity = this.actionIntensity.get();
    const music = getMusicLevel();
    const env = Math.min(1, intensity * 0.72 + music.pulse * 0.55 + music.beat * 0.25);
    for (const { ellipse, baseAlpha } of this.hazeEllipses) {
      ellipse.setAlpha(baseAlpha * (1 + env * 3));
    }
    this.lightBeams?.setReactiveBoost(env);
    // Warm bloom rides action + bass so the arena charges with the drop.
    this.energyBloom?.setAlpha(env * 0.16 + music.bass * 0.05);
    // Cosmic vault / angel choir — bass·mid·high pulse from epic-loop analyser.
    this.cosmicArena?.update(this.game.loop.delta, intensity);
  }

  /**
   * Apply the mobile camera zoom for the current orientation. Portrait frames
   * the arena height into the upper play-area; landscape/desktop use 1:1.
   * Called on create and whenever the viewport resizes (orientation change).
   */
  private applyMobileCamera(): void {
    // Explicitly re-sync the world camera's VIEWPORT to the current canvas
    // size on every resize — Jake, 2026-07-15, "sometimes when it just
    // downgrades [resolution]" bug report (governor rescale → black gap on
    // one side of the canvas). Root cause: this method only ever called
    // setZoom(), never setSize(); keeping cameras.main's viewport in sync
    // was left entirely to Phaser's own CameraManager.onResize, which only
    // auto-tracks a camera whose _width/_height exactly equalled the game's
    // size at the instant BEFORE this resize fired — any other code that
    // transiently touches camera state (ActionCamera's zoom-easing is the
    // prime suspect per the [diag:camera] log below) can desync that check
    // permanently, freezing the viewport at a stale size while the canvas
    // keeps moving. HudCamera.ts already sidesteps this the same way (see
    // its onResize) — the world camera should too, not depend on an
    // undocumented Phaser internal heuristic holding forever.
    this.cameras.main.setSize(this.scale.width, this.scale.height);

    // × renderScale: the backing store is scaled, so the camera zooms by the
    // same factor to keep the WORLD framing identical at every resolution
    // (rs=1 today ⇒ no-op; the dial is the quality ladder's master knob).
    const base = isPortraitMobile()
      ? PORTRAIT_CAM_ZOOM
      : isTouchPrimary()
        ? TOUCH_LANDSCAPE_CAM_ZOOM
        : DESKTOP_CAM_ZOOM;
    const zoom = base * getRenderScale();
    // DIAGNOSTIC (camera-skew investigation): every time this fires, with
    // the zoom it's about to apply and the camera/canvas state at that
    // instant — the ActionCamera only EASES toward baseZoom over time
    // (envelopeZoom lerp, see ActionCamera.setBaseZoom), so if this fires
    // again mid-transition (e.g. during a punch-zoom) there's a real
    // window for camera state and canvas size to be transiently out of
    // sync. Cheap — remove once root-caused.
    console.log(
      `[diag:camera] applyMobileCamera at t=${performance.now().toFixed(0)}ms — zoom→${zoom.toFixed(3)}, ` +
        `preset=${isPortraitMobile() ? "portrait" : isTouchPrimary() ? "touch-landscape" : "desktop"} ` +
        `(cached touchPrimary=${isTouchPrimary()}), ` +
        `canvas=${this.scale.width}x${this.scale.height}, cam=${this.cameras.main.width}x${this.cameras.main.height} ` +
        `scroll=(${this.cameras.main.scrollX.toFixed(0)},${this.cameras.main.scrollY.toFixed(0)}) ` +
        `currentZoom=${this.cameras.main.zoom.toFixed(3)}`,
    );
    // Route through the ActionCamera so its punch-zoom returns to this base.
    // Guarded because applyMobileCamera also fires once in create() before
    // the ActionCamera exists (resize listener); the direct setZoom covers
    // that first call.
    if (this.actionCamera) this.actionCamera.setBaseZoom(zoom);
    else this.cameras.main.setZoom(zoom);
  }

  // ---------------- Match results ----------------

  /**
   * Build death-tip signal from sim evidence only. Never fabricates
   * diedToProjectile; parry recency uses wall-clock of last local parry-deflected
   * plus active window vs current tick (not "field was ever set").
   */
  private computeDeathTip(state: WorldState): string | null {
    const local = state.players[this.localPlayerId];
    const nowMs = performance.now();
    let diedToProjectile = false;
    for (const e of this.pendingSimEvents) {
      if (e.t === "player-killed" && e.victimId === this.localPlayerId) {
        diedToProjectile = e.cause === "projectile" || e.cause === "explosion";
      }
    }
    const parryWindowOpen =
      typeof local?.parryActiveUntilTick === "number" &&
      local.parryActiveUntilTick > state.tick;
    const parryRecentlySucceeded =
      this.lastLocalParryAtMs > 0 && nowMs - this.lastLocalParryAtMs <= 2_000;
    const signal: DeathTipSignal = {
      diedToProjectile,
      parryAvailableRecently: parryWindowOpen || parryRecentlySucceeded,
    };
    return pickDeathTip(signal);
  }

  private maybeShowMatchResults(state: WorldState) {
    if (this.matchHasEnded) return;
    const { winnerPlayerId } = state.round;
    if (winnerPlayerId === null) return;
    const winnerScore = state.round.scores[winnerPlayerId] ?? 0;
    if (winnerScore < resolveModeConfig(state.chaosModifierIds).targetScore) return;
    this.matchHasEnded = true;
    // Persistent player record (splash stats panel) — one match, won or not.
    const won = winnerPlayerId === this.localPlayerId;
    const firsts = recordMatch(won);
    // Doors 2.3 — the "one more round" trigger, and the reason it is here
    // rather than on the win path: a personal best is the one thing a
    // last-place finisher can still truthfully be handed.
    showPersonalBests(
      cycleNotables({
        won,
        beatStreak: this.cycleBeatStreak,
        streak: this.cycleBestStreak,
        firstEver: firsts.firstEver,
        firstWin: firsts.firstWin,
      }),
    );
    // The round-over banner and death overlay are only gated from FUTURE
    // updates by matchHasEnded (see updateHudSystem) — neither is ever
    // explicitly cleared, so whatever they last drew ("TO YOU", or a
    // mid-reveal death rite) used to sit frozen underneath the results
    // modal indefinitely. Clear both explicitly the instant the match ends.
    this.roundBannerSystem?.hide();
    this.deathOverlay?.hide();
    this.showMatchResults(state);
  }

  /** One name source for every surface (venue-goal Pillar 0.4, audit seam
   *  #13): the roster name the player fought under all match, bot label
   *  for bots, id-tail tag only as the true last resort. Before this, the
   *  results screen renamed everyone to id tails — you fight "VERA" and
   *  the podium says "3F2A". */
  private displayName(pid: string): string {
    if (isBotId(pid)) return botLabel(pid);
    return this.rosterNames.get(pid) ?? playerTag(pid);
  }

  private showMatchResults(state: WorldState) {
    if (!this.matchResultsOverlay) return;
    const rows: MatchResultsRow[] = Object.entries(state.round.scores)
      .map(([pid_, score]) => {
        const pid = pid_ as PlayerId;
        const player = state.players[pid];
        return {
          playerId: pid,
          name: pid === this.localPlayerId ? "You" : this.displayName(pid),
          score,
          cardIds: player?.cards ?? [],
          characterId: player?.characterId,
          isLocal: pid === this.localPlayerId,
        };
      });
    // Doors 1.2 — the end-of-demo moment. Fired here rather than on
    // MATCH_ENDED (which means "walked out", the opposite of high intent)
    // so whatever wants the player's peak-interest instant — today the
    // email ask, later a play-again prompt — hangs off one honest signal
    // instead of inferring it from scene transitions.
    emitCycleCompleted();
    this.matchResultsOverlay.show(
      {
        winnerPlayerId: state.round.winnerPlayerId,
        targetScore: resolveModeConfig(state.chaosModifierIds).targetScore,
        rows,
        shareUrl: this.lastShareClipUrl ?? undefined,
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
            // Previously a no-op beyond hiding the overlay — the world
            // recycled on a flat, non-negotiable timer regardless of
            // whether Rematch was ever clicked (Jake, 2026-07-13: "it goes
            // too fast"). This actually signals readiness now: once every
            // connected player has clicked it, the server recycles early
            // instead of waiting out the full anti-stall ceiling.
            void postRematchReady(this.localPlayerId);
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
    // `.scene` goes undefined once the Text is destroyed — a truthy check
    // alone let late WebSocket callbacks setText() into a dead canvas
    // (telemetry sig ulnt5l: null.drawImage via updateText after leave).
    if (this.statusText?.scene) {
      this.statusText.setText(message);
      this.statusText.setVisible(message.length > 0);
    }
  }

  /**
   * Start capture if consent is on and not already running. Safe to call
   * mid-match when the player flips Auto-clip on (no leave/rejoin).
   */
  private ensureClipCapture(): void {
    if (this.clipRecorder || !isClipsEnabled()) return;
    // Potato tier NEVER encodes video of itself — measured on a real Pi 5
    // (2026-07-10): in-combat software encode dragged VideoCore from
    // playable to ~10fps. Pillar 4's whole design is that weak devices get
    // their highlights from the server-side replay renderer instead.
    const tier = getQualityProfile().tier;
    if (tier === "potato" || tier === "phone") {
      // Weak devices never encode: the HOST renders their highlights from
      // the deterministic replay (clipRenderQueue) at full quality — "the
      // host renders the clip and that is what gets used". Clips appear in
      // the Clips gallery (/clips/recent) after the match.
      console.log(`[clips] ${tier} tier — client capture off (host renders highlights)`);
      return;
    }
    this.highlightTracker = new HighlightTracker();
    // One upload per trigger — native landscape only, no vertical crop
    // (2026-07-15: dropped the 9:16 transcode, it was cutting real action
    // out of frame). Used to pair a vertical+original upload for one toast;
    // nothing to pair anymore, just toast on arrival.
    this.clipRecorder = new ClipRecorder(this.game.canvas, {
      getFocus: () => this.clipFocusScreenPos(),
      onUploaded: (url, kind) => {
        console.log(`[clips] uploaded (${kind}): ${url}`);
        this.lastShareClipUrl = url;
        emitClipUploaded({
          url,
          kind,
          pairId: `clip_${Date.now()}`,
          label: "Highlight",
        });
      },
      onError: (err) => console.warn("[clips] capture/upload failed:", err),
    });
    this.clipRecorder.start();
    // Drive capture from POST_RENDER: same task as the WebGL draw, so the
    // drawing buffer is still intact — this is what lets the game run with
    // preserveDrawingBuffer:false (see GameConfig). Recorder paces itself.
    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.onPostRenderClipCapture, this);
    (window as unknown as { __clipsTrigger?: () => void }).__clipsTrigger = () =>
      this.clipRecorder?.trigger();
    console.log("[clips] recorder started (segment buffer rolling)");
  }

  private onPostRenderClipCapture(): void {
    this.clipRecorder?.captureFrame();
  }

  private stopClipCapture(): void {
    this.game.events.off(Phaser.Core.Events.POST_RENDER, this.onPostRenderClipCapture, this);
    this.clipRecorder?.stop();
    this.clipRecorder = null;
    this.highlightTracker = null;
    delete (window as unknown as { __clipsTrigger?: () => void }).__clipsTrigger;
  }

  private teardown() {
    // Drop the status Text reference FIRST: late WebSocket/reconnect
    // callbacks route through setStatus, and the destroyed Text must not
    // be reachable (sig ulnt5l).
    this.statusText = null;
    this.scale.off("resize", this.repositionHud, this);
    this.scale.off("resize", this.applyMobileCamera, this);
    document.removeEventListener("visibilitychange", this.onVisibilityResume);
    window.removeEventListener("pageshow", this.onVisibilityResume);
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    window.removeEventListener(ShellEvents.CLIPS_CONSENT_CHANGED, this.onClipsConsentChanged);
    window.removeEventListener(ShellEvents.CLIP_SAVE_NOW, this.onClipSaveNow);
    this.stopClipCapture();
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
    // disconnect(), not stop(): scene teardown means the player is LEAVING —
    // close the socket now instead of leaving a frozen ghost in-world for
    // the ~30s liveness+grace window (venue-goal Pillar 0.6).
    this.loop?.disconnect("client-leave");
    this.loop = null;
    void this.convex?.close();
    this.convex = null;
    this.audio?.destroy();
    this.audio = undefined;
    this.cardDraftOverlay?.destroy();
    this.cardDraftOverlay = undefined;
    this.buildChangeToast?.destroy();
    this.buildChangeToast = undefined;
    this.matchResultsOverlay?.destroy();
    this.matchResultsOverlay = undefined;
    for (const rig of this.playerRigs.values()) rig.destroy();
    this.playerRigs.clear();
    this.entityRender?.destroy();
    this.entityRender = null;
    this.arenaGraphics?.destroy();
    this.arenaGraphics = null;
    this.cosmicArena?.destroy();
    this.cosmicArena = null;
    this.hudSystem?.destroy();
    this.hudSystem = null;
    this.actionBar?.destroy();
    this.actionBar = null;
    this.roundBannerSystem?.destroy();
    this.roundBannerSystem = null;
    this.deathOverlay?.destroy();
    this.deathOverlay = null;
    this.connectionOverlay?.destroy();
    this.connectionOverlay = null;
    this.statusVfx?.destroy();
    this.statusVfx = null;
    this.constructVfx?.destroy();
    this.constructVfx = null;
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

export function drawDestructible(
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
  if (obj.kind === "trainingDummy") {
    // Venue practice targets read as hostile mannequin figures, not pink
    // shipping crates. The collision body remains the same authoritative
    // 44px destructible; only its presentation extends into a vessel-like
    // head/torso silhouette so it belongs at the loadout table.
    const headY = obj.y - halfH - 5;
    graphics.fillStyle(color, alpha);
    graphics.fillCircle(obj.x, headY, 8);
    graphics.fillRoundedRect(obj.x - 11, headY + 9, 22, 29, 4);
    graphics.lineStyle(4, color, alpha);
    graphics.lineBetween(obj.x - 9, headY + 17, obj.x - 17, obj.y + halfH - 2);
    graphics.lineBetween(obj.x + 9, headY + 17, obj.x + 17, obj.y + halfH - 2);
    graphics.lineStyle(2, 0xf7fbff, flashing ? 1 : 0.7);
    graphics.strokeCircle(obj.x, headY, 8);
    graphics.strokeRoundedRect(obj.x - 11, headY + 9, 22, 29, 4);
    // Bullseye and plinth retain immediate "shoot this" readability.
    graphics.strokeCircle(obj.x, headY + 22, 5);
    graphics.fillStyle(0x07101c, 0.9);
    graphics.fillRect(obj.x - halfW, obj.y + halfH - 5, obj.width, 7);
    graphics.lineStyle(1.5, color, 0.9);
    graphics.strokeRect(obj.x - halfW, obj.y + halfH - 5, obj.width, 7);
    return;
  } else if (obj.kind === "barrel") {
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

export function drawFirePatch(
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

export function drawPickup(
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
