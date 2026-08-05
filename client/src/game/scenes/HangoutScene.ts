// Party Hangout — walkable, real-networked pre-match space
// (graceful-gliding-flame plan, Phase A / A4-A5).
//
// A DRAMATICALLY simpler sibling of OnlineMatchScene: same connect/rig/
// snapshot pattern (real netcode, real prediction+reconciliation via
// ClientLoop), but walking-only — no weapon HUD, no card draft, no kill
// feed, no health bars. The hangout MatchHost (server/src/matchHost.ts)
// pins round phase to permanent "fighting" (so stepPlayer keeps running)
// and no-ops stepWeapon, so there is nothing combat-shaped for this scene
// to ever render.
//
// Ready/Launch totems are server-authoritative-only (client never sends a
// special input — walking into a totem's radius is enough, the server
// detects the overlap and reacts). This scene only renders totem markers
// at the same positions the server computes them (resolveHangoutTotems is
// the exact pure function the server also calls) and reacts to the
// `ready-toggled` SimEvent for local feedback.

import Phaser from "phaser";
import { SceneKeys } from "./SceneKeys";
import { ClientLoop, WsTransport, InputBit, encodeMessage } from "../../net";
import { PlayerId, type PlayerEntity, type SimEvent, type WorldState } from "../../sim/types.js";
import type { MapDefinition } from "../../sim/types.js";
import { resolveMap } from "../../sim/data/maps.js";
import { resolveHangoutTotems, resolveVenueTotems, type TotemDefinition } from "../../sim/totem.js";
import { PrivateRoomClient } from "../net/PrivateRoomClient";
import { fetchVenueLobbyAssignment } from "../../net/worldClient";
import { fallbackPlayerName, sanitizePlayerName } from "../../net/playerName";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { colorToNumber } from "../render/colorToNumber.js";
import { ProceduralAudio } from "../systems/ProceduralAudio";
import { PlatformLayer } from "../render/PlatformPainter";
import { ActionCamera } from "../systems/ActionCamera.js";
import { CameraHype } from "../systems/CameraHype.js";
import { getMusicLevel } from "../systems/MusicAmplitude";
import { SimEventRouter } from "../render/SimEventRouter";
import { ParticlePool } from "../systems/ParticlePool";
import { StatusVfxController } from "../systems/StatusVfxController";
import { ConstructVfxController } from "../systems/ConstructVfxController";
import { classIdForArchetype } from "../../sim/data/cardTypes";
import { spawnFloatingDamageNumber } from "../render/damageNumber.js";
import { TouchControls } from "../input/TouchControls";
import { hangoutTouchKeys } from "../input/hangoutTouchKeys";
import { isTouchPrimary, isPortraitMobile } from "../input/mobile";
import { getRenderScale, uiWidth } from "../render/renderResolution.js";
import { installHudCamera } from "../systems/HudCamera.js";
import { getQualityProfile } from "../render/qualityProfile.js";
import { characters } from "../data/characters";
import { PALETTE, ARENA_THEMES } from "../ui/palette";
import { classAccentPalette } from "../ui/classAccentColors";
import { CardDraftOverlay, type ClassRowConfig } from "../ui/CardDraftOverlay";
import { sanitizeCharacterId } from "../../net/playerCharacter.js";
import { crystalRoundsCards, catalogForClass } from "../../sim/data/cards.js";
import type { ClassId } from "../../sim/data/cardTypes.js";
import { EntityRenderCoordinator } from "../render/EntityRenderCoordinator.js";
import { ActionBarSystem, type ActionBarVitals } from "../ui/ActionBarSystem.js";
import { activeSlotVitals } from "../ui/activeSlots.js";
import { acquiredAbilities } from "../ui/acquiredAbilities.js";
import { deriveHudChips } from "../ui/statusChips.js";
import { resolvePlayerBuild } from "../../sim/weapon.js";
import { EMISSION_CHARGE_MAX } from "../../sim/constants.js";
import {
  projectileColorByElement,
  drawDestructible,
  drawFirePatch,
  drawPickup,
} from "./OnlineMatchScene.js";
import type { CharacterDefinition, CharacterId } from "../types/game";
import { setActiveLocalPlayerIdGetter, setActiveStateGetter } from "../../debug/wasmStateProbe.js";

export type HangoutSceneInit = {
  /**
   * "private" (default): a room's pre-match hangout — room-scoped token via
   * PrivateRoomClient, torn down when the room launches. Exactly the
   * original behavior; the private suite is the regression firewall.
   *
   * "venue": the public venue LOBBY (venue-sprint2-goal S2.A) — open world
   * token via /venue-token, connects /ws/lobby, no room, no
   * LobbyController coupling. One scene class, one mode param, no fork
   * (practice-zone-goal §6 discipline).
   */
  mode?: "private" | "venue";
  /** Required in private mode; unused in venue mode. */
  roomCode?: string;
  localPlayerId: string;
};

// Same visual scale OnlineMatchScene/MatchScene use — keeps a party member's
// vessel the same size here as it'll be once the real match starts.
const PLAYER_VISUAL_SCALE = 0.78;
const SIM_BODY_HALF_HEIGHT = 28;
const SIM_CROUCH_HALF_HEIGHT = 19;
const LOCAL_PLAYER_FALLBACK_COLOR = 0xfff3d6;
const REMOTE_PLAYER_FALLBACK_COLOR = 0xff4d5e;
const PORTRAIT_CAM_Y_BIAS = 150;

// Loadout-station copy (Jake 2026-07-17: the station is NOT "BETWEEN
// ROUNDS" — that header belongs to actual mid-run drafts only). When P6's
// venueNames.ts lands (one constant per name, grep-enforced), these move
// there with the rest of the venue vocabulary.
const LOADOUT_KICKER = "LOADOUT";
const LOADOUT_TITLE = "CHOOSE YOUR LOADOUT";
// Universal random-offer-and-reroll copy removed 2026-07-18 (Jake, live
// playtest: "delete this mechanic and gameplay and focus on the other
// things on this ui ... I mean in the load out picker") — the station is
// class row + class ability catalog only now (docs/classes-goal.md
// "Loadout station owns the 3 slots").
const LOADOUT_HINT =
  "Tap an ability below to equip it — up to 3 across your rack. Try it on the dummies. Walk away any time.";
// Class era P1 (docs/classes-goal.md): class select joins card select at
// the SAME station — the pre-arena identity moment. Plain UI label, no
// Coptic (naming protocol: lore names never in HUD-critical copy). Moves
// to venueNames.ts with the constants above when that file lands.
const CLASS_ROW_TITLE = "CHOOSE YOUR CLASS";
// Same persisted slot LobbyController's "Class" dropdown reads/writes
// (PLAYER_CHARACTER_KEY there) — the station class row and the private-room
// dropdown are two views of ONE selection. Same literal-key precedent as
// "jakesjam.playerName" below.
const PLAYER_CHARACTER_KEY = "jakesjam.playerCharacter";

export class HangoutScene extends Phaser.Scene {
  private mode: "private" | "venue" = "private";
  private roomCode!: string;
  private localPlayerId!: PlayerId;
  private loop: ClientLoop | null = null;
  private audio?: ProceduralAudio;
  private touchControls: TouchControls | null = null;
  private keys!: Record<
    "a" | "d" | "w" | "space" | "shift" | "slot1" | "slot2" | "slot3",
    Phaser.Input.Keyboard.Key
  >;
  // Duos queue (classes-goal.md "Venue integration" — venue-only, a lighter
  // touch than a DOM overlay: press [T] at the bell to toggle "queue as
  // duo" intent, same walk-up-and-toggle spirit as the totems themselves.
  // A raw transport reference (not routed through ClientLoop) keeps this
  // message off the predicted/reconciled input path entirely — it's venue
  // bookkeeping, not gameplay input.
  private lobbyTransport: WsTransport | null = null;
  private duoKey?: Phaser.Input.Keyboard.Key;
  /** Part B (2026-07-19): a bound key alongside the "NEXT SET" DOM button
   *  so cycling the catalog doesn't require reaching for the mouse while
   *  standing at the dummies mid-test — same "walk-up affordance, not a
   *  menu" precedent as `duoKey`. Only acts while `loadoutInZone` (station
   *  proximity), same zone-gate the overlay itself uses. */
  private catalogCycleKey?: Phaser.Input.Keyboard.Key;
  /** Optimistic local echo — the server is the actual source of truth
   *  (VenueHost's duoIntent Set), but there's no round-trip ack message
   *  for a toggle this cheap; a dropped packet would only desync the
   *  displayed state until the next press, never the server's behavior. */
  private duoIntentLocal = false;
  private duoHintText: Phaser.GameObjects.Text | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private actionCamera!: ActionCamera;
  private simEventRouter: SimEventRouter | null = null;
  /** Lobby VFX parity (docs/lobby-vfx-parity-goal.md): venue-mode only —
   *  same trio OnlineMatchScene drives for every held weapon, melee swing,
   *  Ward slab, tether, lance flourish, and ability cast-tell. Private
   *  hangouts carry no combat, so these stay null there (same gate as
   *  `entityRender`/`actionBar` below) and every consumer null-guards. */
  private particlePool: ParticlePool | null = null;
  private statusVfx: StatusVfxController | null = null;
  private constructVfx: ConstructVfxController | null = null;
  /** Buffered once per frame, drained after both VFX consumers run —
   *  mirrors OnlineMatchScene's `pendingSimEvents` byte-for-byte (this
   *  scene's own `handleSimEvents` used to dispatch straight to
   *  `simEventRouter` with no buffering, because nothing downstream ever
   *  needed the whole-frame batch before). */
  private pendingSimEvents: SimEvent[] = [];
  /** Loadout station live-fire (Fix 1, live playtest 2026-07-18 — Jake:
   *  "the abilities and load out should be active in this world"): the
   *  same bottom-center hotkey bar OnlineMatchScene renders, venue-mode
   *  only (private hangouts carry no loadout station — nothing on the
   *  rack to show). */
  private actionBar: ActionBarSystem | null = null;
  /** Dance camera (Fix 2, same live playtest — Jake: "as well as the
   *  dance camera"): identical ~20s sustained-action accumulator
   *  OnlineMatchScene drives its orbital "pop and lock" motion from,
   *  ported byte-for-byte (see `updateCameraHype`). */
  private readonly cameraHype = new CameraHype();
  private cameraHypePeakPrev = false;

  private readonly playerRigs = new Map<string, ProceduralPlayerRig>();
  private readonly rosterNames = new Map<string, string>();
  private readonly rosterCharacterIds = new Map<string, string>();
  private readonly rosterCosmetics = new Map<string, import("../../sim/types.js").VesselCosmetics>();
  private readonly crouchHalfByPid = new Map<string, number>();
  private readonly seenPlayersScratch = new Set<string>();

  private platformLayer: PlatformLayer | null = null;
  private arenaGraphics: Phaser.GameObjects.Graphics | null = null;
  /** Venue-lobby-tableau (2026-07-18): grand-hall ribs/light-shaft + the
   *  loadout table prop — venue mode only, drawn once per arena load. */
  private tableauGraphics: Phaser.GameObjects.Graphics | null = null;
  private totemGraphics: Phaser.GameObjects.Graphics | null = null;
  private totemLabels: Phaser.GameObjects.Text[] = [];
  private totems: TotemDefinition[] = [];

  private lastFrameMs = 0;
  private readyFlashUntilMs = 0;

  // Venue mode (S2.B): latest pushed status frame + when it arrived, so the
  // bell countdown renders smoothly between 1Hz frames instead of jumping.
  private venueStatus: import("../../net/protocol.js").VenueStatus | null = null;
  private venueStatusAtMs = 0;
  private feedText: Phaser.GameObjects.Text | null = null;
  private bellLabel: Phaser.GameObjects.Text | null = null;
  /** Touch combat (Doors 1.5a) — same last-aim convention as
   *  OnlineMatchScene: shots keep their heading when the thumb lifts. */
  private lastTouchAim: { x: number; y: number } = { x: 1, y: 0 };
  /** Last-frame local feet (updated AFTER pump) so the touch aim origin
   *  never reads getRenderState before pump — that would advance the
   *  smoother twice per frame (OnlineMatchScene's own convention). */
  private lastLocalRenderX: number | null = null;
  private lastLocalRenderY: number | null = null;
  // Venue mode (S2.C): projectiles + practice dummies render through the
  // same coordinator the arena uses (pool null — no combat frame budget to
  // amortize here, straight Graphics is fine).
  private entityRender: EntityRenderCoordinator | null = null;
  // Venue mode (S2.C.3): DOM callsign prompt, alive only while awaiting a
  // name — must not outlive the scene.
  private callsignOverlay: HTMLElement | null = null;
  // Venue mode: the LOADOUT STATION (S2.E, separated from the bell queue
  // 2026-07-17 per Jake — "seperate the card selector test room thing with
  // the bell queue"). Same DOM overlay class the arena's between-round
  // draft uses, but with station copy, and opened/closed by walking into/
  // out of the loadout totem — never slammed at a joiner or a queuer.
  private draftOverlay: CardDraftOverlay | null = null;
  /** Server-authoritative FULL rack (classes-goal.md "Loadout station owns
   *  the 3 slots" — live playtest finding 2026-07-18): the same array
   *  `getEntrantCards` will hand the arena, mirrored to the client purely
   *  for rendering the class ability catalog's selected/equipped state and
   *  the shared 3-slot counter. As of 2026-07-18 every entry in here is a
   *  catalog pick — the universal random-offer-and-reroll flow that used
   *  to also land picks here was cut from the station entirely (Jake,
   *  live playtest: "delete this mechanic and gameplay ... I mean in the
   *  load out picker"). */
  private loadoutPicks: string[] = [];
  /** The chassis the server currently has this loadout entry locked to
   *  (venueHost.ts's `entry.classId`) — drives which catalog `setCatalog`
   *  renders. LIVE as of the class-pick fix (Bug 1, live playtest
   *  2026-07-18): a mid-visit class-row click sends `class-pick` over the
   *  lobby socket immediately, so this updates on the very next
   *  `venue-draft` push instead of waiting for a fresh station visit. */
  private loadoutClassId: ClassId | null = null;
  /** Local proximity state for the station zone (with exit hysteresis). */
  private loadoutInZone = false;
  /** Armed only after the player has been observed OUTSIDE the zone once —
   *  structurally prevents a modal-on-spawn if the spawn lattice ever
   *  lands someone inside the ring (the exact failure the station exists
   *  to kill). */
  private loadoutSeenOutside = false;
  /** Picked (or otherwise done) this visit — suppresses re-opens until the
   *  player walks out and back in. */
  private loadoutDismissed = false;

  constructor() {
    super(SceneKeys.Hangout);
  }

  init(data: HangoutSceneInit) {
    this.mode = data.mode ?? "private";
    this.roomCode = data.roomCode ?? "";
    this.localPlayerId = PlayerId(data.localPlayerId);
    void this.connect();
  }

  create() {
    this.cameras.main.setBackgroundColor("#05080f");
    this.input.mouse?.disableContextMenu();

    // Touch controls. VENUE: the lobby is a live-fire room (S2.C practice
    // dummies), so touch mounts the SAME combat verbs the touch MATCH has
    // (Doors 1.5a — the bell wait can reach ~100 s and phones couldn't
    // even hit the dummies while keyboard visitors could). PRIVATE: the
    // original movement-only contract stands — same precedent as offline
    // Practice (MatchScene.ts, combatButtons:false): nothing there for
    // Shield/Dash buttons to react to, walking-only.
    if (isTouchPrimary()) {
      this.touchControls = new TouchControls(document.body, {
        combatButtons: this.mode === "venue",
      });
      this.touchControls.attach();
      this.touchControls.setVisible(true);
    }

    if (this.input.keyboard) {
      this.keys = {
        a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        // Shield (docs/lobby-vfx-parity-goal.md Pillar 3): hold-to-shield,
        // same key OnlineMatchScene binds (`OnlineMatchScene.ts:594`) — the
        // lobby had Fire + drafted-active keys but no way to ever raise
        // Kindled's Ward at all, so "try it on the dummies" couldn't cover
        // the class's own centerpiece defense. Venue-only, same gate as Fire.
        shift: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
        // Drafted actives (loadout station catalog abilities) — same three
        // keys/bits OnlineMatchScene binds (see update()'s input assembly).
        slot1: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
        slot2: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
        slot3: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      };
      this.duoKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T);
      this.catalogCycleKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.N);
    }

    this.statusText = this.add
      .text(20, 20, "Connecting to hangout...", {
        color: "#9aa5b1",
        fontFamily: "'Space Mono', 'Courier New', monospace",
        fontSize: "14px",
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.audio = new ProceduralAudio();
    this.input.once("pointerdown", () => this.audio?.unlock());
    this.input.keyboard?.once("keydown", () => this.audio?.unlock());

    this.actionCamera = new ActionCamera(this.cameras.main);
    this.applyCameraZoom();
    this.scale.on("resize", this.applyCameraZoom, this);

    if (this.mode === "venue") {
      // Lobby VFX parity (docs/lobby-vfx-parity-goal.md Pillar 1): pool
      // BEFORE the entity coordinator, same order OnlineMatchScene.create()
      // uses, so anything that wants to draw from it during setup can.
      this.particlePool = new ParticlePool(this);

      // S2.C: the venue lobby is a live-fire room — projectiles and the
      // practice dummies are ordinary snapshot state, so the arena's own
      // painters render them (TutorialScene's cross-scene import precedent).
      this.entityRender = new EntityRenderCoordinator(
        this,
        {
          projectileColor: (element, ownerId) => projectileColorByElement(element, ownerId),
          drawDestructible: (g, obj, flashing) => drawDestructible(g, obj, flashing),
          drawFirePatch: (g, fire, nowMs) => drawFirePatch(g, fire, nowMs),
          drawPickup: (g, pickup, nowMs) => drawPickup(g, pickup, nowMs),
        },
        this.particlePool,
      );
      // Loadout station live-fire (Fix 1): the same hotkey bar the arena
      // renders, so cooldowns/glyphs for whatever's equipped are visible
      // while standing at a dummy — venue-only, mirroring entityRender's
      // gate immediately above (private hangouts have no loadout station).
      // The C4 mobile-QA gate (wave 2, 2026-07-29: `!isTouchPrimary()`)
      // is GONE with Doors 1.5a — its whole premise was "touch is
      // walk-only here so the bar's vitals can never move". Touch now
      // carries the full combat verbs (combatButtons above + update()'s
      // venue passthrough), and the bar's per-frame pass is ALSO what
      // arms the touch EMIT/slot buttons (updateActionBar mirrors
      // OnlineMatchScene's own bar→TouchControls coupling), so it's load-
      // bearing on touch, not dead weight.
      this.actionBar = new ActionBarSystem(this);

      // Lobby VFX parity (docs/lobby-vfx-parity-goal.md Pillar 1): the exact
      // trio OnlineMatchScene constructs (`OnlineMatchScene.ts:673,676`) —
      // every held weapon, melee swing, Ward slab, tether, lance flourish,
      // and ability cast-tell renders through these two controllers and
      // NOWHERE else in the client. Without them a class standing at the
      // loadout table has empty hands, and attacking a practice dummy swings
      // nothing visible — confirmed root cause of the reported "swords don't
      // show on Kindled/Interstice" gap, which turned out to affect every
      // class's construct, not just those two.
      this.statusVfx = new StatusVfxController(this, this.particlePool);
      this.constructVfx = new ConstructVfxController(this, this.particlePool);
    }

    this.lastFrameMs = performance.now();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    // Split the HUD onto its own 1:1 camera — SAME reason OnlineMatchScene
    // installs this (HudCamera.ts's own doc comment): the world camera here
    // ALSO zooms (applyCameraZoom's `base` is 1.1 desktop / 0.8 portrait,
    // never exactly 1), so every scrollFactor(0) HUD object (the action
    // bar, status/feed text) was rendering through that zoom factor with no
    // corrective camera — Phaser's scrollFactor(0) cancels camera PAN, not
    // camera ZOOM. That's the live playtest 2026-07-18 "ui wrong scale or
    // something" report: the action bar wasn't reliably pinned to the
    // bottom-center of the actual viewport, so it could visually read as
    // colliding with the world-space loadout totem's marker depending on
    // camera framing. Installed last, same placement rule as the arena's
    // own call, so the initial partition pass sees the full HUD (action bar
    // included, built above in the venue-mode branch).
    installHudCamera(this);
  }

  private applyCameraZoom(): void {
    this.cameras.main.setSize(this.scale.width, this.scale.height);
    // Wider/looser framing than combat — this is a "look around a room"
    // space, not a crop-in-on-the-fight camera.
    const base = isPortraitMobile() ? 0.8 : isTouchPrimary() ? 1.0 : 1.1;
    const zoom = base * getRenderScale();
    if (this.actionCamera) this.actionCamera.setBaseZoom(zoom);
    else this.cameras.main.setZoom(zoom);
  }

  // ---------------- Connect ----------------

  private async connect(): Promise<void> {
    try {
      let wsUrl: string;
      let matchId: string;
      if (this.mode === "venue") {
        // Public venue lobby: open world credential, no room membership
        // (venue-sprint2-goal S2.A / venue-goal Pillar 1.3).
        // Callsign gate (S2.C.3), prompt-before-connect: the name must ride
        // /ws/lobby, so a nameless visitor is asked HERE — the server
        // refuses nameless queue entry regardless.
        let name = sanitizePlayerName(localStorage.getItem("jakesjam.playerName") ?? "");
        if (!name) {
          if (isSharedWorldInvite()) {
            name = fallbackPlayerName(this.localPlayerId as string);
            localStorage.setItem("jakesjam.playerName", name);
          } else {
            this.setStatus("");
            name = await this.promptForCallsign();
          }
        }
        this.setStatus("Entering the lobby...");
        const assignment = await fetchVenueLobbyAssignment(
          this.localPlayerId as string,
          name,
          // Chassis rides the lobby socket too (classes-goal.md P1) so the
          // venue vessel spawns with the picked class's body. Server pass
          // is authoritative (net/playerCharacter.ts, same function).
          sanitizeCharacterId(localStorage.getItem(PLAYER_CHARACTER_KEY)),
        );
        wsUrl = assignment.wsUrl;
        matchId = "lobby";
      } else {
        const client = new PrivateRoomClient();
        this.setStatus("Requesting hangout access...");
        const grant = await client.hangoutToken(this.roomCode, this.localPlayerId as string);
        matchId = grant.matchId;
        wsUrl = client.buildWsUrl(grant.matchId, grant.token);
      }
      this.setStatus("Opening WebSocket...");
      const transport = new WsTransport({ url: wsUrl });
      // Held directly (not routed through ClientLoop) so the duo-toggle
      // send doesn't need any new surface on the shared netcode loop —
      // see the field's doc.
      this.lobbyTransport = transport;
      this.loop = new ClientLoop({
        transport,
        matchId,
        playerId: this.localPlayerId as string,
        // Lobby drops should self-heal like the arena's do (P0.5 pattern) —
        // same stateless token, same URL re-auths.
        reconnectUrl: wsUrl,
        onAuthoritativeApplied: () => {
          this.setStatus("");
        },
        onHello: (hello) => {
          for (const p of hello.allPlayers) {
            this.rosterNames.set(p.playerId, p.name);
            this.rosterCharacterIds.set(p.playerId, p.characterId);
            if (p.cosmetics) this.rosterCosmetics.set(p.playerId, p.cosmetics);
          }
          this.renderArena(hello.mapId);
        },
        onEvents: (events) => this.handleSimEvents(events),
        onReconnectAttempt: (attempt) => {
          this.setStatus(`Reconnecting (attempt ${attempt})...`);
        },
        // Pushed venue-status frames (S2.B) — only the venue lobby's host
        // ever sends these; private hangouts simply never fire it.
        //
        // Normalize ONCE here rather than at every read site: a long-lived
        // dev server process (Bun doesn't hot-reload) can still be running
        // pre-duoQueued venueHost.ts while a freshly-built client expects
        // the field unconditionally — caught live 2026-07-18, crashed
        // updateTotemPulse's `.duoQueued.includes(...)` on undefined. Any
        // future additive field on this frame gets the same protection by
        // defaulting it here instead of trusting the wire byte-for-byte.
        onVenueStatus: (status) => {
          this.venueStatus = { ...status, duoQueued: status.duoQueued ?? [] };
          this.venueStatusAtMs = performance.now();
        },
        // Loadout station (S2.E, separated 2026-07-17): state arrives while
        // standing at the loadout totem (re-pushed on its retrigger
        // cadence, and again after every catalog-toggle/class-pick — store,
        // then let station proximity decide visibility). `picks`/`classId`
        // are server-authoritative; the universal `offers` field this used
        // to also carry was removed from the wire 2026-07-18 (Jake, live
        // playtest — cut the random-offer-and-reroll section from the
        // station entirely).
        onVenueDraft: (picks, classId) => {
          this.loadoutPicks = picks;
          this.loadoutClassId = classId as ClassId;
          this.maybeShowLoadout();
          this.syncCatalog();
        },
        // The bell (S2.F): admission crosses the membrane. main.ts owns the
        // scene handoff (stop Hangout → its teardown closes this socket →
        // start OnlineMatchScene mode:"world").
        onVenueAdmitted: () => {
          window.dispatchEvent(new CustomEvent("jakesjam:venue-admitted"));
        },
      });
      // The shared-link golden-path probe needs the same honest sim view as
      // arena combat: it can prove state is live and a locally-owned shot
      // exists, instead of treating canvas visibility as "playable".
      setActiveStateGetter(() => this.loop?.getRenderState() ?? null);
      setActiveLocalPlayerIdGetter(() => this.localPlayerId as string);
      transport.onClose((reason) => {
        this.setStatus(`Disconnected: ${reason}`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      this.setStatus(`Connect failed: ${msg}`);
    }
  }

  private setStatus(message: string): void {
    this.statusText?.setText(message);
  }

  /**
   * Loadout station (S2.E, separated 2026-07-17; Task 2, live playtest
   * 2026-07-18): open the class + ability-catalog panel iff the player is
   * standing at the station and it isn't already up. The universal
   * random-offer-and-reroll flow this used to gate on (an `offers` array
   * arriving) is GONE — Jake, seeing the catalog grid AND the old
   * "UNIVERSAL OFFER" 3-card section together: "delete this mechanic and
   * gameplay and focus on the other things on this ui ... I mean in the
   * load out picker". The panel now holds ONLY the class row + whatever
   * `setCatalog` renders; there is no pick-from-a-list step here anymore,
   * so opening is a plain fade-in (`CardDraftOverlay.showStation()`), not
   * the sequenced reveal `show()` plays for an actual card offer — that
   * method (and the timer/card-grid DOM it drives) is still used, byte-
   * for-byte unchanged, by the in-match between-round draft
   * (OnlineMatchScene.ts / HudCompositor.ts's call sites, which never pass
   * a `classRow` so `CardDraftOverlay` never even builds the station-only
   * DOM this method drives).
   */
  private maybeShowLoadout(): void {
    if (this.mode !== "venue") return;
    if (!this.loadoutInZone || !this.loadoutSeenOutside || this.loadoutDismissed) return;
    if (!this.draftOverlay) {
      this.draftOverlay = new CardDraftOverlay(
        {},
        {
          kicker: LOADOUT_KICKER,
          title: LOADOUT_TITLE,
          hint: LOADOUT_HINT,
        },
        this.buildClassRowConfig(),
        // Part B (2026-07-19): "PREV SET"/"NEXT SET" buttons next to the
        // catalog heading — server owns the group index and re-pushes a
        // fresh `venue-draft`, same authoritative-push-only precedent as
        // class-pick/catalog-toggle; no local optimistic guess here since
        // the exact next group depends on server-side state this client
        // doesn't mirror.
        (direction) => this.loop?.sendCatalogCycle(direction),
      );
    }
    if (!this.draftOverlay.isOpen()) this.draftOverlay.showStation();
    this.syncCatalog();
  }

  /**
   * Class ability catalog sync (classes-goal.md "Loadout station owns the
   * 3 slots" — live playtest finding 2026-07-18, Jake: "this should show
   * all cards for that class when its selected not just three and this
   * should have the concept of selecting them"). Unlike `maybeShowLoadout`
   * (which gates on zone proximity + guards against re-opening a sequence
   * mid-reveal), this ALWAYS re-renders the catalog grid from the current
   * `loadoutPicks`/`loadoutClassId` — the grid isn't a one-shot reveal
   * sequence, it's a persistent toggle surface that must reflect the
   * latest server truth (or the optimistic local guess below) on every
   * call, whether the overlay just opened or was already sitting there.
   * No-op before the overlay exists (constructed lazily by
   * `maybeShowLoadout` once the universal offer arrives) or outside venue
   * mode.
   */
  private syncCatalog(): void {
    if (this.mode !== "venue" || !this.draftOverlay) return;
    const classId = this.loadoutClassId ?? "wizard";
    const catalog = catalogForClass(classId);
    const activesHeld = this.loadoutPicks.filter(
      (id) => crystalRoundsCards.find((c) => c.id === id)?.active !== undefined,
    ).length;
    this.draftOverlay.setCatalog(catalog, this.loadoutPicks, activesHeld, (card) => {
      this.loop?.sendCatalogToggle(card.id);
      // Optimistic local flip (no round-trip wait — same instant-feedback
      // spirit as the rest of the station) so the tile responds the
      // instant you click; the next authoritative `venue-draft` push
      // reconciles `loadoutPicks` and re-renders (idempotent if it agrees,
      // self-correcting if the server rejected the add — e.g. a rack-full
      // race between two rapid clicks).
      const idx = this.loadoutPicks.indexOf(card.id);
      if (idx !== -1) this.loadoutPicks = this.loadoutPicks.filter((id) => id !== card.id);
      else this.loadoutPicks = [...this.loadoutPicks, card.id];
      this.syncCatalog();
    });
  }

  /** Class-select row config (classes-goal.md P1): the four chassis from
   *  characters.ts, selected = the persisted value the private-room "Class"
   *  dropdown also reads. Picking persists locally and announces via
   *  `jakesjam:class-change` (LobbyController listens) — the pick ALSO
   *  rides the NEXT arena admission through the world-join `character`
   *  param (OnlineMatchScene → /ws/world → WorldHost.spawnFor).
   *
   *  ALSO sends `class-pick` over the live lobby socket (Bug 1 fix, live
   *  playtest 2026-07-18): the localStorage write + DOM event above only
   *  ever reached the private-room dropdown, never the server — a class
   *  switch mid-visit at the station left the server's loadout entry (and
   *  therefore the ability catalog grid below) locked to whatever class
   *  was picked at first totem touch. `sendClassPick` re-derives it live;
   *  the server's reply (`venue-draft`) re-renders the catalog via
   *  `onVenueDraft` → `syncCatalog()`, no totem re-entry required.
   *
   *  SINCE the Part A follow-up (2026-07-19, "when you switch loudouts and
   *  classes it SHOULD REALLY switch"): the SAME `class-pick` message ALSO
   *  live-swaps the lobby vessel's actual standing chassis server-side
   *  (`VenueHost`'s handler → `MatchHost.setPlayerCharacter`) — no longer
   *  "arms the future for the next socket," the visitor's rig visibly
   *  re-skins and their resources/cooldowns reset RIGHT NOW, standing at
   *  the dummies. `renderWorld`'s rig-rebuild-on-chassis-change handles the
   *  visual side; nothing here needs to change to get that for free. */
  private buildClassRowConfig(): ClassRowConfig {
    return {
      title: CLASS_ROW_TITLE,
      options: characters.map((c) => ({
        id: c.id as string,
        name: c.name,
        classId: c.classId,
        summary: c.kitSummary,
        kitComing: c.kitComing,
      })),
      selectedId: sanitizeCharacterId(localStorage.getItem(PLAYER_CHARACTER_KEY)),
      onSelect: (id) => {
        const characterId = sanitizeCharacterId(id);
        localStorage.setItem(PLAYER_CHARACTER_KEY, characterId);
        window.dispatchEvent(
          new CustomEvent("jakesjam:class-change", { detail: { characterId } }),
        );
        this.loop?.sendClassPick(characterId);
      },
    };
  }

  /** Station proximity (client-side UI arbitration only — offers and picks
   *  stay server-authoritative): enter opens, exit closes and re-arms.
   *  Enter radius matches the server overlap scan's reach (totem radius +
   *  player footprint); exit adds hysteresis so edge-standing doesn't
   *  flicker the overlay. */
  private updateLoadoutZone(state: WorldState): void {
    if (this.mode !== "venue") return;
    const totem = this.totems.find((t) => t.id === "totem-loadout");
    const me = state.players[this.localPlayerId];
    if (!totem || !me) return;
    const dist = Math.hypot(me.x - totem.x, me.y - totem.y);
    const enterR = totem.radius + 18; // PLAYER_FOOTPRINT_RADIUS (totem.ts)
    const exitR = enterR + 48;
    const inZone = this.loadoutInZone ? dist < exitR : dist < enterR;
    if (!inZone) {
      this.loadoutSeenOutside = true;
      if (this.loadoutInZone) {
        // Exit edge: walking away closes the selector without ceremony and
        // re-arms the next visit.
        this.draftOverlay?.hide();
        this.loadoutDismissed = false;
      }
    }
    const entered = inZone && !this.loadoutInZone;
    this.loadoutInZone = inZone;
    if (entered) this.maybeShowLoadout();
  }

  /** DOM overlay callsign prompt (S2.C.3) — splash-input language, scene-
   *  owned lifetime. Resolves only with a sanitized non-empty name; the
   *  overlay also persists it so the splash field shows the same callsign. */
  private promptForCallsign(): Promise<string> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "venue-callsign";
      overlay.innerHTML = `
        <p class="venue-callsign-kicker">THE VENUE ASKS YOUR NAME</p>
        <div class="splash-name">
          <label for="jj-venue-name" class="splash-name-label">CALLSIGN</label>
          <input id="jj-venue-name" type="text" maxlength="14"
            autocomplete="nickname" placeholder="choose your name" spellcheck="false" />
        </div>
        <div><button type="button" class="primary shell-cta-primary">ENTER</button></div>
      `;
      document.body.appendChild(overlay);
      this.callsignOverlay = overlay;
      const input = overlay.querySelector("input")!;
      const button = overlay.querySelector("button")!;
      const submit = () => {
        const name = sanitizePlayerName(input.value);
        if (!name) {
          input.focus();
          return;
        }
        localStorage.setItem("jakesjam.playerName", name);
        overlay.remove();
        this.callsignOverlay = null;
        resolve(name);
      };
      button.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      input.focus();
    });
  }

  // ---------------- Sim event -> audio ----------------

  private handleSimEvents(events: SimEvent[]): void {
    if (!this.simEventRouter) {
      // Combat IS reachable here (venue-lobby practice dummies + showcase
      // gauntlet, docs/venue-lobby-tableau-goal.md) — the deps below are
      // fully wired, not stubbed, so the router's exhaustive switch stays
      // byte-identical to OnlineMatchScene's AND every branch it dispatches
      // actually fires for real in venue mode. (Corrected 2026-07-20,
      // docs/lobby-vfx-parity-goal.md — the previous "always-inert combat
      // cases" comment here predated the practice dummies and was stale.)
      this.simEventRouter = new SimEventRouter({
        scene: this,
        // Lobby flashes/evidence are visual contracts, not conditional on
        // the browser granting a WebAudio context.
        audio: this.audio ?? null,
        localPlayerId: this.localPlayerId,
        safeShake: () => {},
        // Practice-range damage numbers (2026-07-19, venue-lobby ability
        // showcase — Jake: "we need an area with the right bots... to test
        // this"): the whole point of the showcase room is SEEING that an
        // ability worked. Was a literal no-op — every ability landed with
        // zero visible confirmation of damage dealt. `spawnDamageNumber`
        // covers player/ally-NPC victims (real PlayerIds, e.g.
        // `lobbyAllyNpcId` — resolvable via `state.players` exactly like
        // OnlineMatchScene's arena case); `spawnDamageNumberAt` covers
        // destructible (dummy) hits via the new `destructible-hit` SimEvent,
        // which carries the dummy's own x/y directly (no PlayerId to look
        // up for a destructible).
        spawnDamageNumber: (vid, dmg, headshot) => this.spawnDamageNumber(vid, dmg, headshot),
        spawnDamageNumberAt: (x, y, dmg) => this.spawnDamageNumberAt(x, y, dmg),
        spawnBlastAtPlayer: () => {},
        killCinematic: () => {},
        spawnPlatformBlastTint: () => {},
        showCardDraft: () => {},
        hideCardDraft: () => {},
        playerRigs: this.playerRigs,
        particlePool: this.particlePool,
        renderLayer: null,
        killStreakCount: new Map(),
        prevAlive: new Set(),
      });
    }
    for (const event of events) {
      if (event.t === "ready-toggled" && event.playerId === this.localPlayerId) {
        this.readyFlashUntilMs = performance.now() + 500;
      }
      this.simEventRouter.dispatch(event);
    }
    // Lobby VFX parity (docs/lobby-vfx-parity-goal.md Pillar 1): buffered
    // for statusVfx/constructVfx, which read the whole frame's batch once
    // per `update()` tick (not per-event) — same buffer-then-drain shape as
    // OnlineMatchScene's `pendingSimEvents` (`OnlineMatchScene.ts:1542-1545`).
    for (const event of events) this.pendingSimEvents.push(event);
  }

  /** Player/ally-NPC damage-number popup — mirrors OnlineMatchScene's own
   *  `spawnDamageNumber` byte-for-byte (shared tween/tier logic lives in
   *  `spawnFloatingDamageNumber`). Covers every REAL `PlayerId` victim in
   *  the lobby: the local player and the loadout table's two stationary
   *  ally NPCs (`lobbyAllyNpcId`) alike — both live in `state.players`
   *  exactly like an arena player does. */
  private spawnDamageNumber(victimId: string, damage: number, headshot = false): void {
    const state = this.loop?.getRenderState();
    if (!state) return;
    const victim = state.players[PlayerId(victimId)];
    if (!victim || damage < 1) return;
    if (!victim.alive) return;
    const isLocal = victimId === (this.localPlayerId as string);
    spawnFloatingDamageNumber(this, victim.x, victim.y, damage, { headshot, isLocal });
  }

  /** Destructible (training dummy) damage-number popup — the `destructible-
   *  hit` SimEvent carries the dummy's own `x`/`y` directly (a destructible
   *  has no `PlayerId`/rig to resolve a position from). This is the half
   *  that actually matters for the showcase room: every dummy hit now
   *  floats a number, not just player/ally-NPC hits. */
  private spawnDamageNumberAt(x: number, y: number, damage: number): void {
    if (damage < 1) return;
    spawnFloatingDamageNumber(this, x, y, damage, { headshot: false, isLocal: false });
  }

  // ---------------- Arena + totems ----------------

  private renderArena(mapId: string): void {
    if (!this.cameras?.main || !this.scene.isActive()) return;
    const map = resolveMap(mapId);
    const { x: width, y: height } = map.size;
    const themeKey = (map.arenaTheme ?? "voidVessel") as keyof typeof ARENA_THEMES;
    const theme = ARENA_THEMES[themeKey] as import("../ui/palette").ArenaTheme;

    const cam = this.cameras.main;
    const padX = Math.round(this.scale.width / 6);
    const padY = Math.round(this.scale.height / 6);
    const bottomPad = isPortraitMobile() ? Math.round(this.scale.height * 0.5) : padY;
    cam.setBounds(-padX, -padY, width + padX * 2, height + padY + bottomPad);
    cam.setRoundPixels(false);

    this.arenaGraphics?.destroy();
    const g = this.add.graphics().setDepth(-10);
    this.arenaGraphics = g;
    g.fillStyle(theme.bg, 1);
    g.fillRect(0, 0, width, height);
    g.fillGradientStyle(theme.hi, theme.hi, theme.bg, theme.shade ?? theme.bg, 0.8, 0.8, 1, 1);
    g.fillRect(0, 0, width, height);

    if (!this.platformLayer) this.platformLayer = new PlatformLayer(this);
    this.platformLayer.repaint(map.platforms, theme, map.launchPads, map.slopes);

    this.renderTotems(map);
    // Venue-lobby-tableau (docs/venue-lobby-tableau-goal.md, 2026-07-18) —
    // private hangouts keep today's plain look; the public venue gets the
    // grand-hall backdrop + literal loadout table.
    if (this.mode === "venue") this.renderTableau(map, theme);
  }

  /**
   * The "gnostic cathedral of sorts" pass (docs/venue-lobby-tableau-goal.md
   * Parts 3/3b) — cathedral SCALE, never cathedral ICONOGRAPHY: tall crystal
   * ribs + soft light shafts (vertical drama, no arches/pointed vaulting/
   * rose windows), and a literal long table at the loadout station's
   * position (replacing nothing functionally — `renderTotems`'s ring still
   * marks the real interaction trigger zone; this is a decorative prop
   * drawn beneath/around it). Drawn once per arena load, same static-graphics
   * discipline as the platform layer — never touched again per-frame.
   */
  private renderTableau(map: MapDefinition, theme: import("../ui/palette").ArenaTheme): void {
    this.tableauGraphics?.destroy();
    const g = this.add.graphics().setDepth(-9); // above the base gradient, below platforms/totems
    this.tableauGraphics = g;
    const { x: width, y: height } = map.size;
    const floorY = height - 36; // vessel-nexus FLOOR_H — matches venueLobbyMap's own ground math
    const hallTop = -Math.round(this.scale.height / 4); // reaches well above the camera's usual view — "vaulted," not just tall

    // ---- Crystal ribs: tall vertical structural members, evenly spaced
    //      across the WHOLE hall (not just the practice band) — the
    //      "vaulted ceiling" read comes from scale + repetition, never an
    //      arch shape. ----
    const ribSpacing = 340;
    const ribWidth = 18;
    for (let x = ribSpacing / 2; x < width; x += ribSpacing) {
      g.fillStyle(theme.bg === PALETTE.voidAbyss ? PALETTE.hullSlate : theme.bg, 0.55);
      g.fillRect(x - ribWidth / 2, hallTop, ribWidth, floorY - hallTop);
      // Seam of light down the rib's center — thin, dim (axiom H2: spark,
      // not flood — a hall full of bright verticals would scream, not awe).
      g.lineStyle(1.5, PALETTE.inkMid, 0.4);
      g.lineBetween(x, hallTop, x, floorY);
    }

    // ---- Light shaft over the table specifically — reinforces it as the
    //      compositional AND lighting anchor. A few shafts, not a wash. ----
    const loadoutTotem = this.totems.find((t) => t.id === "totem-loadout");
    if (loadoutTotem) {
      const cx = loadoutTotem.x;
      const shaftHalfW = 150;
      g.fillGradientStyle(
        PALETTE.lightBeamWarm,
        PALETTE.lightBeamWarm,
        theme.bg,
        theme.bg,
        0.13,
        0.13,
        0,
        0,
      );
      g.fillRect(cx - shaftHalfW, hallTop, shaftHalfW * 2, floorY - hallTop);

      // A broad, low wall composition gives the station a readable stage
      // even when the camera follows a player from one side. Three bays and
      // a continuous cornice borrow the strong horizontal perspective of a
      // banquet room without importing church shapes or sacred props.
      const stageHalfW = 460;
      const stageTop = floorY - 410;
      const stageBottom = floorY - 82;
      g.fillStyle(PALETTE.voidCharcoal, 0.72);
      g.fillRect(cx - stageHalfW, stageTop, stageHalfW * 2, stageBottom - stageTop);
      g.lineStyle(3, PALETTE.inkDim, 0.66);
      g.lineBetween(cx - stageHalfW, stageTop, cx + stageHalfW, stageTop);
      g.lineBetween(cx - stageHalfW, stageBottom, cx + stageHalfW, stageBottom);
      g.lineStyle(1.5, PALETTE.inkMid, 0.45);
      for (const bayX of [cx - 300, cx, cx + 300]) {
        const bayHalfW = bayX === cx ? 125 : 118;
        g.strokeRect(bayX - bayHalfW, stageTop + 28, bayHalfW * 2, stageBottom - stageTop - 56);
      }
      // The central place is deliberately brighter and empty: when the
      // visitor walks to the loadout trigger, their live rig completes the
      // composition instead of competing with a decorative "hero" statue.
      g.fillStyle(PALETTE.lightBeamWarm, 0.035);
      g.fillRect(cx - 122, stageTop + 30, 244, stageBottom - stageTop - 60);
      g.lineStyle(2, PALETTE.inkBright, 0.58);
      g.lineBetween(cx, stageTop + 22, cx, stageBottom - 12);

      const tableY = loadoutTotem.y + 8;

      // Twelve quiet house delegates, blocked as four groups of three with
      // an open central place. This is the Last-Supper read: count, rhythm,
      // grouped gesture and a shared eyeline — rendered as manufactured
      // vessel silhouettes, never robes/halos or held ritual objects.
      const delegateOffsets = [
        -370, -324, -280,
        -205, -159, -115,
        115, 159, 205,
        280, 324, 370,
      ];
      for (let i = 0; i < delegateOffsets.length; i += 1) {
        const x = cx + delegateOffsets[i]!;
        const towardCenter = x < cx ? 1 : -1;
        const headY = tableY - 78 - (i % 3 === 1 ? 5 : 0);
        const bodyColor = i % 3 === 1 ? PALETTE.hullSlateHi : PALETTE.hullSlate;
        // Seat back / chassis spine.
        g.fillStyle(PALETTE.voidEdge, 0.92);
        g.fillRoundedRect(x - 15, headY + 8, 30, 70, 6);
        // Faceted head and shoulder block.
        g.fillStyle(bodyColor, 0.98);
        g.fillCircle(x, headY, 9);
        g.fillRoundedRect(x - 14, headY + 11, 28, 42, 5);
        g.lineStyle(1.5, PALETTE.inkMid, 0.6);
        g.strokeCircle(x, headY, 9);
        g.lineBetween(x - 12, headY + 24, x + 12, headY + 24);
        // Alternating conversational gestures point inward and create the
        // grouped triangular rhythms missing from the previous straight row.
        const gestureLift = (i % 3 - 1) * 8;
        g.lineStyle(3, i % 3 === 1 ? PALETTE.inkBright : PALETTE.inkDim, 0.76);
        g.lineBetween(x + towardCenter * 8, headY + 25, x + towardCenter * 24, headY + 35 + gestureLift);
        g.lineBetween(x - towardCenter * 8, headY + 27, x - towardCenter * 18, headY + 43 - gestureLift * 0.4);
      }

      // ---- The table itself: a literal long, low, crystal-plated surface
      //      (docs/venue-lobby-tableau-goal.md Part 3) — replaces the
      //      totem's old bare-ring anchor. Hull-plate dark base + a bright
      //      instrument seam along the top edge (ShellFrame's own "sealed
      //      hull, thin filament seam" language), never a held ritual
      //      object or cloth. ----
      const tableHalfW = 425;
      const tableH = 48;
      g.fillStyle(PALETTE.voidCharcoal, 0.9);
      g.fillRoundedRect(cx - tableHalfW - 3, tableY - tableH / 2 - 3, tableHalfW * 2 + 6, tableH + 6, 5);
      g.fillStyle(PALETTE.hullSlate, 1);
      g.fillRoundedRect(cx - tableHalfW, tableY - tableH / 2, tableHalfW * 2, tableH, 3);
      g.lineStyle(3, PALETTE.inkBright, 0.82);
      g.lineBetween(cx - tableHalfW + 8, tableY - tableH / 2 + 3, cx + tableHalfW - 8, tableY - tableH / 2 + 3);
      // Front fascia panels turn a flat bar into a substantial shared table.
      g.lineStyle(1.5, PALETTE.sapphireDim, 0.62);
      for (let panel = -3; panel <= 3; panel += 1) {
        const panelX = cx + panel * 104;
        g.strokeRect(panelX - 44, tableY - 9, 88, 22);
      }
      // Thirteen instrument nodes: one per place, clearly tech controls
      // rather than food or ceremonial objects.
      g.fillStyle(PALETTE.sapphirePulse, 0.72);
      for (let node = -6; node <= 6; node += 1) {
        g.fillRect(cx + node * 61 - 3, tableY - tableH / 2 + 8, 6, 2);
      }
      // Table legs — spaced structural supports, same dark hull material.
      g.fillStyle(PALETTE.hullSlate, 0.85);
      for (const legX of [cx - 330, cx - 110, cx + 110, cx + 330]) {
        g.fillRect(legX - 7, tableY + tableH / 2, 14, floorY - (tableY + tableH / 2));
      }
    }
  }

  /** Simple glowing-ring markers — Phase A only, bespoke art is Phase B
   *  (docs/visual-language-gnostic-vessel.md). Ready = house/instrument
   *  register (Instrument Ink); Launch = live-spark register (Sapphire
   *  Conduit) — the same house-vs-combat split the palette already draws
   *  everywhere else, not a new convention invented for this. */
  private renderTotems(map: MapDefinition): void {
    this.totemGraphics?.destroy();
    for (const label of this.totemLabels) label.destroy();
    this.totemLabels = [];
    this.bellLabel = null;
    // Venue lobby: the LOADOUT station (card selector by the dummies) +
    // the bell portal (queue toggle) — separated stations, separated
    // meanings (2026-07-17); private hangout: the READY/LAUNCH pair. Same
    // pure functions the server places with.
    this.totems = this.mode === "venue" ? resolveVenueTotems(map) : resolveHangoutTotems(map);

    const g = this.add.graphics().setDepth(2);
    this.totemGraphics = g;
    for (const totem of this.totems) {
      this.drawTotemGlyph(g, totem, 1, false, 0.85);

      const isBell = totem.id === "totem-bell";
      const text =
        this.mode === "venue"
          ? isBell
            ? "THE BELL"
            : "LOADOUT TABLE"
          : totem.kind === "ready"
            ? "READY"
            : "LAUNCH";
      const isLoadoutTable = this.mode === "venue" && totem.id === "totem-loadout";
      const label = this.add
        .text(totem.x, totem.y - (isLoadoutTable ? 148 : totem.radius + 26), text, {
          color: totem.kind === "ready" ? "#aa9e7f" : "#6b98f4",
          fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
          fontSize: "16px",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setDepth(2.1);
      this.totemLabels.push(label);
      if (this.mode === "venue" && isBell) this.bellLabel = label;
    }
  }

  /** The bell remains a portal-ring. The loadout trigger becomes a quiet
   * floor pool beneath the table, so interaction state stays legible without
   * drawing a giant target over the scene's central composition. */
  private drawTotemGlyph(
    graphics: Phaser.GameObjects.Graphics,
    totem: TotemDefinition,
    scale: number,
    active: boolean,
    alpha: number,
  ): void {
    const ring = totem.kind === "ready" ? PALETTE.inkBright : PALETTE.sapphireSteady;
    if (this.mode === "venue" && totem.id === "totem-loadout") {
      const width = totem.radius * 3.1 * scale;
      const height = totem.radius * 0.52 * scale;
      const y = totem.y + totem.radius * 0.72;
      graphics.fillStyle(ring, active ? 0.12 : 0.035);
      graphics.fillEllipse(totem.x, y, width, height);
      graphics.lineStyle(active ? 3 : 2, ring, active ? 0.95 : alpha * 0.48);
      graphics.strokeEllipse(totem.x, y, width, height);
      graphics.lineStyle(1.5, ring, active ? 0.75 : 0.34);
      graphics.lineBetween(totem.x - width * 0.32, y, totem.x + width * 0.32, y);
      return;
    }
    const r = totem.radius * scale;
    graphics.lineStyle(4, ring, active ? 1 : alpha);
    graphics.strokeCircle(totem.x, totem.y, r);
    graphics.lineStyle(2, ring, 0.4);
    graphics.strokeCircle(totem.x, totem.y, r * 0.6);
    graphics.fillStyle(ring, active ? 0.14 : 0.06 * alpha * 2);
    graphics.fillCircle(totem.x, totem.y, r);
  }

  /** Ready totem flash feedback — walking-into-it feel while no combat
   *  cinematic exists to carry the beat. Cheap sin pulse, no tween churn.
   *  Venue mode adds a steady "queued" glow: while the local player is in
   *  the bell queue, the portal ring holds bright (state, not a flash —
   *  axiom H2: light is scarce and state-driven). */
  private updateTotemPulse(nowMs: number): void {
    if (!this.totemGraphics || this.totems.length === 0) return;
    const flashing = nowMs < this.readyFlashUntilMs;
    const readyTotem = this.totems.find((t) => t.kind === "ready");
    const localQueued =
      this.mode === "venue" &&
      ((this.venueStatus?.queued.includes(this.localPlayerId as string) ?? false) ||
        (this.venueStatus?.duoQueued.includes(this.localPlayerId as string) ?? false));
    const scale = flashing ? 1 + 0.12 * Math.sin(nowMs * 0.03) : 1;
    // Redraw is cheap at this scale (two rings + a fill per totem, once a
    // frame only while flashing would be ideal, but two totems total makes
    // an always-on subtle pulse cost-free here).
    const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0025);
    this.totemGraphics.clear();
    for (const totem of this.totems) {
      const isFlashingRing =
        (flashing && readyTotem !== undefined && totem.id === readyTotem.id) ||
        (localQueued && totem.id === "totem-bell") ||
        // Loadout armed (2026-07-17): at least one equipped catalog
        // ability holds the station ring bright — state, not a flash
        // (axiom H2), mirroring the bell's queued glow.
        (this.loadoutPicks.length > 0 && totem.id === "totem-loadout");
      const alpha = 0.55 + 0.3 * pulse;
      this.drawTotemGlyph(
        this.totemGraphics,
        totem,
        isFlashingRing ? scale : 1,
        isFlashingRing,
        alpha,
      );
    }
  }

  /** Venue feed + bell countdown (S2.B): renders the latest pushed
   *  venue-status frame — the arena's phase/scores top-center and the live
   *  bell countdown on the totem label. The countdown interpolates locally
   *  between 1Hz frames (nextBellMs minus elapsed-since-frame) so it ticks
   *  smoothly instead of jumping; estimates only ever jump DOWN on the next
   *  frame (same monotonicity contract as the death overlay's wait). */
  private updateVenueFeed(nowMs: number): void {
    if (this.mode !== "venue") return;
    const s = this.venueStatus;
    if (!s) return;

    if (!this.feedText) {
      // CSS px (uiWidth), not raw backing-store scale.width: this object is
      // scrollFactor(0), so installHudCamera reparents it into the HUD
      // root container, which is itself scaled by renderScale — a position
      // already pre-multiplied by renderScale (scale.width) would get
      // double-scaled and drift off-center. Same basis ActionBarSystem's
      // own layout() already uses.
      this.feedText = this.add
        .text(uiWidth(this) / 2, 14, "", {
          color: "#7a8299",
          fontFamily: "'Space Mono', 'Courier New', monospace",
          fontSize: "13px",
          align: "center",
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(1000);
    }

    // C1 mobile-QA fix (2026-07-28): this feed string ("THE ARENA —
    // FIGHTING · ROUND N · N FIGHTER(S) · N BOTS / NEXT BELL M:SS") had no
    // wordWrapWidth, no compact-width branching, and no truncation — at
    // 13px monospace it's comfortably wider than a 393px phone, so it
    // clipped off BOTH edges every frame in the venue (exactly the class of
    // bug HudSystem's compact mode already handles elsewhere in this same
    // file). Also nudges below the fixed top-right MENU/CLIPS ON pill
    // (match-chrome, ~44px tall on narrow widths per style.css) instead of
    // letting the centred block run underneath it.
    const uiW = uiWidth(this);
    const compact = uiW < 520;
    this.feedText.setFontSize(compact ? 11 : 13);
    this.feedText.setWordWrapWidth(Math.min(560, uiW - 32), true);
    this.feedText.setPosition(uiW / 2, compact ? 46 : 14);

    const bellMs = Math.max(0, s.nextBellMs - (nowMs - this.venueStatusAtMs));
    const bellSec = Math.ceil(bellMs / 1000);
    const mm = Math.floor(bellSec / 60);
    const ss = (bellSec % 60).toString().padStart(2, "0");
    const phaseLabel =
      s.arenaPhase === "fighting"
        ? "FIGHTING"
        : s.arenaPhase === "drafting"
          ? "DRAFTING"
          : s.arenaPhase === "round-over"
            ? "ROUND OVER"
            : "STARTING";
    const fighters = s.humans === 1 ? "1 FIGHTER" : `${s.humans} FIGHTERS`;
    const bots = s.bots > 0 ? ` · ${s.bots} BOT${s.bots === 1 ? "" : "S"}` : "";
    this.feedText.setText(
      `THE ARENA — ${phaseLabel} · ROUND ${s.roundIndex + 1} · ${fighters}${bots}\nNEXT BELL ${mm}:${ss}`,
    );

    // Wave-2 QA fix (2026-07-29): C1's fix moved feedText down to y=46 in
    // compact mode to clear the top-right MENU/CLIPS pill, but duoHintText
    // stayed pinned to a hard-coded y=44 regardless of width — at 393px the
    // two now sit almost exactly on top of each other (both fully opaque),
    // an illegible double-exposed collision C1's own reposition introduced.
    // Anchor off feedText's OWN measured displayHeight (which already
    // accounts for the real font size AND line count post-setText, above)
    // instead of a second fixed constant, so a future feedText height change
    // (a 3rd line, a bigger compact font, etc.) can't reopen this collision.
    const duoHintY = this.feedText.y + this.feedText.displayHeight + (compact ? 6 : 8);

    if (this.bellLabel) {
      const queuedCount = s.queued.length;
      const localQueued = s.queued.includes(this.localPlayerId as string);
      const localDuoQueued = s.duoQueued.includes(this.localPlayerId as string);
      const suffix = localQueued
        ? " · QUEUED"
        : localDuoQueued
          ? " · QUEUED (DUO)"
          : queuedCount > 0
            ? ` · ${queuedCount} QUEUED`
            : "";
      const duoCount = s.duoQueued.length > 0 ? ` · ${s.duoQueued.length} DUO` : "";
      this.bellLabel.setText(`THE BELL · ${mm}:${ss}${suffix}${duoCount}`);
    }

    // Duos-queue hint (classes-goal.md "Venue integration") — a persistent
    // corner label, not a modal: the toggle is meant to be set once before
    // ever walking to the bell, not negotiated in a dialog each visit.
    // Doors 0.7 honest-copy: [T] is a keyboard affordance — touch-primary
    // players have no T to press, so advertising it there is a dishonest
    // hint. Hide rather than skip-create (isTouchPrimary() re-reads on
    // genuine orientation/resize signals); desktop behavior is unchanged.
    if (isTouchPrimary()) {
      this.duoHintText?.setVisible(false);
    } else {
      if (!this.duoHintText) {
        this.duoHintText = this.add
          .text(20, duoHintY, "", {
            color: "#9aa5b1",
            fontFamily: "'Space Mono', 'Courier New', monospace",
            fontSize: "13px",
          })
          .setScrollFactor(0)
          .setDepth(1000);
      }
      this.duoHintText.setVisible(true);
      this.duoHintText.setPosition(20, duoHintY);
      this.duoHintText.setText(`[T] DUO QUEUE: ${this.duoIntentLocal ? "ON" : "OFF"}`);
    }
  }

  // ---------------- Update ----------------

  update() {
    if (!this.loop) return;

    // Duos queue toggle (classes-goal.md "Venue integration") — venue
    // lobby only, a walk-up-and-press affordance rather than a menu:
    // press [T] any time to flip "queue as duo" intent before touching
    // the bell totem. JustDown so a held key toggles once, not every frame.
    if (
      this.mode === "venue" &&
      this.duoKey &&
      Phaser.Input.Keyboard.JustDown(this.duoKey)
    ) {
      this.duoIntentLocal = !this.duoIntentLocal;
      this.lobbyTransport?.send(encodeMessage({ t: "duo-toggle" }));
    }

    // Part B catalog cycle (2026-07-19): press [N] while standing at the
    // loadout station to swap in the next ability group — the keyboard
    // twin of the overlay's "NEXT SET" button, for testers who'd rather
    // not leave the keyboard mid-test. Zone-gated (only while
    // `loadoutInZone`) so N does nothing walking around the rest of the
    // lobby.
    if (
      this.mode === "venue" &&
      this.loadoutInZone &&
      this.catalogCycleKey &&
      Phaser.Input.Keyboard.JustDown(this.catalogCycleKey)
    ) {
      this.loop?.sendCatalogCycle("next");
    }

    let keys = 0;
    if (this.keys?.a.isDown) keys |= InputBit.Left;
    if (this.keys?.d.isDown) keys |= InputBit.Right;
    if (this.keys?.w.isDown || this.keys?.space.isDown) keys |= InputBit.Jump;
    // Venue lobby only (S2.C): firing is live — players are immune (the
    // hangout sim carve-out), so shots exist to break the practice dummies.
    // Private hangouts stay walk-only, exactly the original contract.
    if (this.mode === "venue" && this.input.activePointer.leftButtonDown()) {
      keys |= InputBit.Fire;
    }
    // Shield (docs/lobby-vfx-parity-goal.md Pillar 3) — venue-only, same
    // gate as Fire above; see the key binding's own doc comment in create().
    if (this.mode === "venue" && this.keys?.shift.isDown) {
      keys |= InputBit.Shield;
    }
    // Drafted actives (loadout station catalog abilities, Fix 1 live
    // playtest 2026-07-18 — Jake: "the abilities and load out should be
    // active in this world"): keys 1-3 press bar slots in pick order —
    // bits 10..12, byte-identical to OnlineMatchScene's input assembly
    // (raw edges, no client gate: the sim validates slot existence +
    // cooldown). Venue-only — private hangouts carry no loadout station,
    // so there is nothing on the rack to trigger.
    if (this.mode === "venue") {
      if (this.keys?.slot1.isDown) keys |= 1 << 10;
      if (this.keys?.slot2.isDown) keys |= 1 << 11;
      if (this.keys?.slot3.isDown) keys |= 1 << 12;
    }

    // Aim orients the rig — and in venue mode it aims live practice fire.
    // Mouse position on desktop; on touch, last-frame feet + the aim
    // stick's kept heading (below).
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const aimWorld = cam.getWorldPoint(pointer.x, pointer.y);
    let aimX = aimWorld.x;
    let aimY = aimWorld.y;

    // Touch REPLACES the keyboard/mouse assembly above, same shape as
    // OnlineMatchScene's own touch branch (Doors 1.5a): venue mode passes
    // the FULL combat bitfield through (Fire/Shield/Dash/Emission/slots —
    // dummies are hittable on a phone at last); private hangouts keep the
    // original walk-only mask (hangoutTouchKeys owns both contracts).
    if (this.touchControls) {
      const t = this.touchControls.getState();
      keys = hangoutTouchKeys(t.keys, this.mode);
      // Kept heading (OnlineMatchScene convention): shots hold their
      // direction when the thumb lifts; origin is LAST-frame feet so we
      // never call getRenderState before pump (double-advances the
      // smoother — the exact thing the match's comment warns about; the
      // old walk-only branch here did it anyway because aim was inert).
      if (t.aimDir) this.lastTouchAim = t.aimDir;
      const AIM_REACH = 420;
      const ox = this.lastLocalRenderX ?? aimX;
      const oy = this.lastLocalRenderY ?? aimY;
      // Deliberately NO assistTouchAim here (a divergence from the match,
      // not an omission): the assist cone bends aim toward living PLAYERS
      // only, and everyone in the lobby is PvP-immune — in a room whose
      // real targets are destructible dummies it would steer shots OFF
      // the dummy toward an immune bystander. Raw stick + kept heading is
      // the honest lobby aim.
      aimX = ox + this.lastTouchAim.x * AIM_REACH;
      aimY = oy + this.lastTouchAim.y * AIM_REACH;
      // DASH DIRECTION (mirrors the match): the sim dashes toward AIM,
      // and on touch the aim is stale while the right thumb is on the
      // DASH button — point the aim where the dash gesture says (drag
      // direction, or the move stick for a plain tap); an actively held
      // aim stick still wins.
      if (keys & InputBit.Dash) {
        const dd = t.dashDir ?? (t.aimDir ? null : t.moveDir);
        if (dd) {
          aimX = ox + dd.x * AIM_REACH;
          aimY = oy + dd.y * AIM_REACH;
        }
      }
    }

    this.loop.setLocalInput({ keys, aimX, aimY });
    this.loop.pump();

    const state = this.loop.getRenderState();
    if (!state) return;

    // Last-frame feet for the touch aim origin (recorded AFTER pump —
    // same convention as OnlineMatchScene's lastLocalRenderX/Y).
    const me = state.players[this.localPlayerId];
    if (me) {
      this.lastLocalRenderX = me.x;
      this.lastLocalRenderY = me.y;
    }

    const now = performance.now();
    const deltaMs = Math.max(1, Math.min(50, now - this.lastFrameMs));
    this.lastFrameMs = now;

    this.renderWorld(state, deltaMs);
    this.entityRender?.update(state, deltaMs, now);
    this.followLocalPlayer(state, deltaMs);
    // Dance camera (Fix 2) — same relative order as OnlineMatchScene's
    // update() (cameraHype.update() runs AFTER the followLocalPlayer call
    // that reads it, so a peak's very first triggering frame reads last
    // frame's hype; matching upstream's exact order rather than
    // "fixing" a one-frame lag that isn't this port's job to change).
    this.updateCameraHype(deltaMs);
    this.updateConstructVfx(state, deltaMs);
    this.updateLoadoutZone(state);
    this.updateTotemPulse(now);
    this.updateVenueFeed(now);
    this.updateActionBar(state);
  }

  /** Lobby VFX parity (docs/lobby-vfx-parity-goal.md Pillar 1) — drives the
   *  exact two controllers OnlineMatchScene drives every frame
   *  (`OnlineMatchScene.ts:1016-1042`), unconditionally (never gated behind
   *  "were there events this frame"): `ConstructVfxController.update()`'s
   *  resting-weapon draw runs every call regardless of `events`, which is
   *  what makes a class's IDLE held weapon visible while just standing at
   *  the loadout table, not only mid-swing. `null` on both controllers in
   *  private-hangout mode (never constructed there) makes this a no-op —
   *  same guard shape OnlineMatchScene itself uses defensively. */
  private updateConstructVfx(state: WorldState, deltaMs: number): void {
    const simEvents = this.pendingSimEvents;
    const resolvePos = (id: PlayerId): { x: number; y: number } | undefined => {
      const p = state.players[id];
      return p ? { x: p.x, y: p.y } : undefined;
    };
    if (this.statusVfx) {
      this.statusVfx.update(state, simEvents, deltaMs, resolvePos);
    }
    if (this.constructVfx) {
      // Same hand-anchoring rationale as OnlineMatchScene's own comment
      // here: the blade pivots at the rig's live hand, not the feet.
      const resolveHand = (id: PlayerId, hand: 0 | 1): { x: number; y: number } | undefined =>
        this.playerRigs.get(id as string)?.getHandWorld(hand) ?? undefined;
      const triggerMeleePose = (
        id: PlayerId,
        style: "interstice" | "kindled",
        dir: number,
      ): void => {
        this.playerRigs.get(id as string)?.triggerMeleeSwing?.(style, dir);
      };
      this.constructVfx.update(
        state,
        simEvents,
        deltaMs,
        resolvePos,
        classIdForArchetype,
        resolveHand,
        triggerMeleePose,
      );
    }
    if (simEvents.length > 0) simEvents.length = 0;
  }

  /** Dance camera (Fix 2, live playtest 2026-07-18 — Jake: "as well as the
   *  dance camera"): identical ~20s sustained-action accumulator driving
   *  ActionCamera's orbital "pop and lock" motion, ported byte-for-byte
   *  from OnlineMatchScene's update() — same drive signal (the local
   *  player rig's own "circle the mouse" dance-energy read), same
   *  restrained rising-edge acknowledgment flash on reaching peak (axiom
   *  H2: one quiet flash, not a repeating strobe). Runs in every mode —
   *  ActionCamera silently no-ops idle hype (0 by default), so a private
   *  hangout visitor who never dances just never sees it, same as before. */
  private updateCameraHype(deltaMs: number): void {
    const localRig = this.playerRigs.get(this.localPlayerId as string);
    this.cameraHype.update(deltaMs, localRig?.getDanceState().energy ?? 0);
    if (localRig) localRig.externalHypeBoost = this.cameraHype.get();
    const hypePeakNow = this.cameraHype.isPeak();
    if (hypePeakNow && !this.cameraHypePeakPrev) {
      this.cameras.main.flash(180, 0x89, 0x7f, 0x69, false);
    }
    this.cameraHypePeakPrev = hypePeakNow;
  }

  /** Loadout station live-fire (Fix 1): renders the same bottom-center
   *  hotkey bar OnlineMatchScene does, from the local player's live
   *  resolved build — cooldowns/glyphs for the drafted actives on 1/2/3
   *  plus any acquired-capability diamonds, exactly what "try it on the
   *  dummies" promises. Venue-only, mirrors `actionBar`'s own
   *  construction gate in `create()`. */
  private updateActionBar(state: WorldState): void {
    if (this.mode !== "venue" || !this.actionBar) return;
    const local = state.players[this.localPlayerId];
    const character = this.getCharacter(local?.characterId);
    const chips = deriveHudChips(local, state.tick);
    const localActives = local ? activeSlotVitals(local, state.tick) : [];
    const isDead = local ? !local.alive : false;
    // Touch arming (Doors 1.5a) — the same per-frame calls the match's
    // action-bar pass makes (OnlineMatchScene.ts, `if (this.actionBar)`
    // block): EMIT arms only at full predicted charge (keeps the sim's
    // parry fall-through human-unreachable on touch — same client gate as
    // the match), slot buttons appear/arm from the same vitals the bar
    // draws, and the Shield/Dash button text shares one classId resolve
    // with the bar (clusterA-03: the DOM button and the canvas HUD can
    // never name the same ability two different ways).
    const localClassId = local ? classIdForArchetype(local.characterId) : undefined;
    this.touchControls?.setEmissionReady(
      (local?.abilityCharge ?? 0) >= EMISSION_CHARGE_MAX && !isDead,
    );
    this.touchControls?.setActiveSlots(
      localActives.map((a) => ({ ready: a.readyFrac >= 1 && !isDead })),
    );
    this.touchControls?.setClassId(localClassId);
    const vitals: ActionBarVitals = {
      health: local?.health ?? 0,
      maxHealth: character.maxHealth,
      shieldCharge: local?.shieldCharge ?? 0,
      shieldMaxCharge: local?.shieldMaxCharge ?? 0,
      dashReadyFrac: local?.dashReadyFrac ?? 1,
      emissionChargeFrac: (local?.abilityCharge ?? 0) / EMISSION_CHARGE_MAX,
      // Drafted actives claim the diamonds right after E, keyed 1-3 (same
      // resolvePlayerBuild-derived source the input assembly above reads
      // for prediction — one build per player.cards, no second source).
      actives: localActives,
      acquired: local ? acquiredAbilities(resolvePlayerBuild(local)) : [],
      stolenFangsCharges: local?.pendingLockCharges ?? 0,
      isDead,
      classId: localClassId,
    };
    this.actionBar.update(vitals, chips);
  }

  private renderWorld(state: WorldState, deltaMs: number): void {
    const seen = this.seenPlayersScratch;
    seen.clear();
    for (const pid in state.players) {
      const player = state.players[PlayerId(pid)]!;
      seen.add(pid);
      // Live chassis switch (Part A follow-up — loadout-station class-pick
      // now mutates the live PlayerEntity.characterId, matchHost.ts's
      // `setPlayerCharacter`): `rosterCharacterIds` was populated ONCE from
      // ServerHello and, before this fix, never updated again — every rig
      // read (`makePlayerRig`/`updatePlayerRig` below) prefers that STALE
      // cache over the live `player.characterId`, and `ProceduralPlayerRig`
      // bakes chassis silhouette/scale/classId in at construction, never on
      // `.update()`. So a class switch would be fully correct in the sim
      // (cooldowns/resources/health reset, weapon build recomputed) yet
      // silently invisible on screen — exactly the "theater, not a real
      // switch" complaint this whole fix line is about. Keep the roster
      // cache live-synced here, and force a rig rebuild the moment a
      // player's chassis actually changes underneath an existing rig.
      if (this.rosterCharacterIds.get(pid) !== player.characterId) {
        this.rosterCharacterIds.set(pid, player.characterId);
        const stale = this.playerRigs.get(pid);
        if (stale) {
          stale.destroy();
          this.playerRigs.delete(pid);
          this.crouchHalfByPid.delete(pid);
        }
      }
      let rig = this.playerRigs.get(pid);
      if (!rig) {
        rig = this.makePlayerRig(player, pid === (this.localPlayerId as string));
        this.playerRigs.set(pid, rig);
      }
      this.updatePlayerRig(rig, player, deltaMs);
    }
    for (const [pid, rig] of this.playerRigs) {
      if (!seen.has(pid)) {
        rig.destroy();
        this.playerRigs.delete(pid);
        this.crouchHalfByPid.delete(pid);
      }
    }
  }

  private followLocalPlayer(state: WorldState, deltaMs: number): void {
    const local = state.players[this.localPlayerId];
    if (!local) return;
    const yBias = isPortraitMobile() ? PORTRAIT_CAM_Y_BIAS : 0;
    this.actionCamera.update(deltaMs, {
      x: local.x,
      y: local.y,
      vx: local.vx,
      vy: local.vy,
      aimX: local.aimX,
      aimY: local.aimY,
      extra: [],
      yBias,
      // Dance camera (Fix 2) — same fields OnlineMatchScene's
      // followLocalPlayer feeds ActionCamera; the orbital "pop and lock"
      // motion (ActionCamera's hype^2-scaled orbit) needs only `hype`,
      // `peak`/`beatPulse` additionally gate the beat-cut cinematic (a
      // no-op without music playing, which the lobby doesn't loop today —
      // still passed for parity so it activates for free the moment it does).
      hype: this.cameraHype.get(),
      peak: this.cameraHype.isPeak(),
      beatPulse: getMusicLevel().beat,
    });
  }

  // ---------------- Player rig wiring (mirrors OnlineMatchScene, no combat
  // frame-budget pressure to protect against, so every rig is "full") -----

  private static readonly characterById = new Map(
    characters.map((c) => [c.id as string, c]),
  );

  private getCharacter(characterId: CharacterId | string | undefined): CharacterDefinition {
    return (
      (characterId !== undefined
        ? HangoutScene.characterById.get(characterId as string)
        : undefined) ?? characters[0]!
    );
  }

  private getVisualScale(character: CharacterDefinition): number {
    return PLAYER_VISUAL_SCALE * character.sizeScale;
  }

  private makePlayerRig(player: PlayerEntity, isLocal: boolean): ProceduralPlayerRig {
    const character = this.getCharacter(
      this.rosterCharacterIds.get(player.id as string) ?? player.characterId,
    );
    const cosmetics = this.rosterCosmetics.get(player.id as string);
    // Chassis color register (docs/chassis-design-axioms.md CA2), mirrored
    // from OnlineMatchScene.makePlayerRig's arena-only pass (2026-07-18):
    // cosmetic pick still wins; the class-derived default (classAccentColors.ts)
    // replaces the old local-gold/remote-undefined convention below.
    const classPalette = classAccentPalette(character.classId);
    return new ProceduralPlayerRig(this, {
      color: isLocal ? LOCAL_PLAYER_FALLBACK_COLOR : REMOTE_PLAYER_FALLBACK_COLOR,
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
      name: this.rosterNames.get(player.id as string) ?? (player.id as string).slice(-4),
      identitySeed: player.id as string,
      scale: this.getVisualScale(character),
      // Chassis silhouette (CA3) — mirrors OnlineMatchScene's arena pass.
      classId: character.classId,
      // No combat frame-budget to protect (that's the whole reason
      // OnlineMatchScene restricts "full" detail to the local player only)
      // — every hangout rig gets the full-juice treatment, EXCEPT potato
      // tier (perf audit R3, 2026-07-18): the venue lobby is the densest,
      // most player-populated scene in the game (bell queue + loadout
      // station clustering), so it's exactly where a potato-tier device
      // needs the same relief combat scenes already give it, not none.
      detail: getQualityProfile().tier !== "potato" ? "full" : "lite",
    });
  }

  /** Cull margin (world px) beyond the camera's view — mirrors
   *  OnlineMatchScene.RIG_CULL_MARGIN (perf audit R3, 2026-07-18): an
   *  out-of-view rig still cost a full procedural redraw every frame here,
   *  and the venue lobby is the densest scene in the game. */
  private static readonly RIG_CULL_MARGIN = 220;

  private updatePlayerRig(rig: ProceduralPlayerRig, player: PlayerEntity, deltaMs: number): void {
    if (!player.alive) {
      rig.setVisible(false);
      this.crouchHalfByPid.delete(player.id as string);
      return;
    }
    const view = this.cameras.main.worldView;
    const M = HangoutScene.RIG_CULL_MARGIN;
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
      const k = 1 - Math.exp(-deltaMs / 55);
      halfHeight += (halfTarget - halfHeight) * k;
      if (Math.abs(halfHeight - halfTarget) < 0.05) halfHeight = halfTarget;
    } else {
      halfHeight = halfTarget;
    }
    this.crouchHalfByPid.set(pid, halfHeight);
    const character = this.getCharacter(
      this.rosterCharacterIds.get(pid) ?? player.characterId,
    );
    rig.update(deltaMs, {
      position: { x: player.x, y: player.y + halfHeight },
      velocity: { x: player.vx, y: player.vy },
      aimTarget: { x: player.aimX, y: player.aimY },
      grounded: player.grounded ?? true,
      crouching: player.crouching,
      health: player.health,
      maxHealth: character.maxHealth,
      touchingWallDir: player.touchingWallDir ?? 0,
      dashing: player.dashing ?? false,
      // K11 ward brace: the held-Shield boolean drives the Kindled braced
      // BODY (knees bent, slab planted) — same snapshot field the ward
      // slab VFX already frame-diffs (ConstructVfxController).
      shieldHeld: player.shieldActive === true,
      // Venue mode (Fix 1, live playtest 2026-07-18): cards ARE now live on
      // the venue lobby player (VenueHost.pushLoadoutDraft → setPlayerCards)
      // — plating glow/parry-cover must track the resolved build here too,
      // same source `resolvePlayerBuild` the action bar and the input path
      // both read (one derivation, allocation-free after the first resolve
      // per cards-array identity). Private hangouts never grant cards
      // (no loadout station there), so `player.cards` stays empty and this
      // reads the same rest values (1 / 0) as before — byte-identical for
      // that mode.
      shieldArcScale: resolvePlayerBuild(player).parryCoverMultiplier,
      platingGlow: Math.min(1, resolvePlayerBuild(player).maxHealthAdd / 40),
      // clip-goal wave-2 clusterA-06: keep the nameplate from hard-clipping
      // against the top of frame — `view` above is the same worldView this
      // function already reads for off-screen culling.
      cameraTopWorldY: view.y,
    });
  }

  // ---------------- Teardown ----------------

  private teardown(): void {
    this.statusText = null;
    // Scene instances are reused across starts — stale venue state must not
    // leak into the next session (display objects die with the scene; the
    // references and the last frame must be cleared by hand).
    this.feedText = null;
    this.bellLabel = null;
    this.venueStatus = null;
    this.duoHintText = null;
    this.lastTouchAim = { x: 1, y: 0 };
    this.lastLocalRenderX = null;
    this.lastLocalRenderY = null;
    this.duoIntentLocal = false;
    this.lobbyTransport = null;
    this.entityRender?.destroy();
    this.entityRender = null;
    this.actionBar?.destroy();
    this.actionBar = null;
    // Lobby VFX parity (docs/lobby-vfx-parity-goal.md) — same teardown order
    // as OnlineMatchScene (`OnlineMatchScene.ts:3114-3115`): controllers
    // hold no disposable resources of their own, the pool does.
    this.statusVfx = null;
    this.constructVfx = null;
    this.particlePool?.destroy();
    this.particlePool = null;
    this.pendingSimEvents.length = 0;
    this.cameraHype.reset();
    this.cameraHypePeakPrev = false;
    this.callsignOverlay?.remove();
    this.callsignOverlay = null;
    this.draftOverlay?.destroy();
    this.draftOverlay = null;
    this.loadoutPicks = [];
    this.loadoutClassId = null;
    this.loadoutInZone = false;
    this.loadoutSeenOutside = false;
    this.loadoutDismissed = false;
    this.scale.off("resize", this.applyCameraZoom, this);
    this.touchControls?.destroy();
    this.touchControls = null;
    // disconnect(), not stop() — leaving the hangout should close the WS
    // immediately, not strand a ghost until the liveness sweep (same fix
    // as OnlineMatchScene teardown, venue-goal Pillar 0.6).
    this.loop?.disconnect("client-leave");
    this.loop = null;
    setActiveStateGetter(null);
    setActiveLocalPlayerIdGetter(null);
    this.audio?.destroy();
    this.audio = undefined;
    for (const rig of this.playerRigs.values()) rig.destroy();
    this.playerRigs.clear();
    this.rosterNames.clear();
    this.rosterCharacterIds.clear();
    this.rosterCosmetics.clear();
    this.crouchHalfByPid.clear();
    this.arenaGraphics?.destroy();
    this.arenaGraphics = null;
    this.tableauGraphics?.destroy();
    this.tableauGraphics = null;
    this.totemGraphics?.destroy();
    this.totemGraphics = null;
    for (const label of this.totemLabels) label.destroy();
    this.totemLabels = [];
    // PlatformLayer self-destroys on the scene's own SHUTDOWN event.
    this.platformLayer = null;
  }
}

/** Shared links promise immediate live play; the normal Lobby button still
 * owns the authored callsign prompt. Email and intro are shell-level surfaces
 * and remain untouched. */
function isSharedWorldInvite(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("world") === "1" || window.location.pathname === "/world";
}
