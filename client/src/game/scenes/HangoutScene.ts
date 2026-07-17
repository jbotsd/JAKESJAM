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
import { ClientLoop, WsTransport, InputBit } from "../../net";
import { PlayerId, type PlayerEntity, type SimEvent, type WorldState } from "../../sim/types.js";
import type { MapDefinition } from "../../sim/types.js";
import { resolveMap } from "../../sim/data/maps.js";
import { resolveHangoutTotems, resolveVenueTotems, type TotemDefinition } from "../../sim/totem.js";
import { PrivateRoomClient } from "../net/PrivateRoomClient";
import { fetchVenueLobbyAssignment } from "../../net/worldClient";
import { sanitizePlayerName } from "../../net/playerName";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { colorToNumber } from "../render/colorToNumber.js";
import { ProceduralAudio } from "../systems/ProceduralAudio";
import { PlatformLayer } from "../render/PlatformPainter";
import { ActionCamera } from "../systems/ActionCamera.js";
import { SimEventRouter } from "../render/SimEventRouter";
import { TouchControls } from "../input/TouchControls";
import { isTouchPrimary, isPortraitMobile } from "../input/mobile";
import { getRenderScale } from "../render/renderResolution.js";
import { characters } from "../data/characters";
import { PALETTE, ARENA_THEMES } from "../ui/palette";
import { CardDraftOverlay } from "../ui/CardDraftOverlay";
import { crystalRoundsCards } from "../../sim/data/cards.js";
import { EntityRenderCoordinator } from "../render/EntityRenderCoordinator.js";
import {
  projectileColorByElement,
  drawDestructible,
  drawFirePatch,
  drawPickup,
} from "./OnlineMatchScene.js";
import type { CharacterDefinition, CharacterId } from "../types/game";

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
const LOADOUT_TITLE = "CHOOSE YOUR CARD";
const LOADOUT_HINT =
  "Pick one card — it rides with you into your next arena run. Try it on the dummies. Walk away any time.";

export class HangoutScene extends Phaser.Scene {
  private mode: "private" | "venue" = "private";
  private roomCode!: string;
  private localPlayerId!: PlayerId;
  private loop: ClientLoop | null = null;
  private audio?: ProceduralAudio;
  private touchControls: TouchControls | null = null;
  private keys!: Record<"a" | "d" | "w" | "space", Phaser.Input.Keyboard.Key>;
  private statusText: Phaser.GameObjects.Text | null = null;
  private actionCamera!: ActionCamera;
  private simEventRouter: SimEventRouter | null = null;

  private readonly playerRigs = new Map<string, ProceduralPlayerRig>();
  private readonly rosterNames = new Map<string, string>();
  private readonly rosterCharacterIds = new Map<string, string>();
  private readonly rosterCosmetics = new Map<string, import("../../sim/types.js").VesselCosmetics>();
  private readonly crouchHalfByPid = new Map<string, number>();
  private readonly seenPlayersScratch = new Set<string>();

  private platformLayer: PlatformLayer | null = null;
  private arenaGraphics: Phaser.GameObjects.Graphics | null = null;
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
  /** Latest offers pushed by the server (stable per station visit). */
  private loadoutOffers: string[] | null = null;
  /** The card id picked this lobby session — armed for the next admission
   *  (drives the station totem's steady "loadout armed" glow). */
  private loadoutPickId: string | null = null;
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

    // Movement-only twin-stick — same precedent as offline Practice
    // (MatchScene.ts, combatButtons:false): nothing here for Shield/Dash
    // buttons to react to, walking-only.
    if (isTouchPrimary()) {
      this.touchControls = new TouchControls(document.body, { combatButtons: false });
      this.touchControls.attach();
      this.touchControls.setVisible(true);
    }

    if (this.input.keyboard) {
      this.keys = {
        a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      };
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
        null,
      );
    }

    this.lastFrameMs = performance.now();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
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
          this.setStatus("");
          name = await this.promptForCallsign();
        }
        this.setStatus("Entering the lobby...");
        const assignment = await fetchVenueLobbyAssignment(this.localPlayerId as string, name);
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
        onVenueStatus: (status) => {
          this.venueStatus = status;
          this.venueStatusAtMs = performance.now();
        },
        // Loadout station (S2.E, separated 2026-07-17): offers arrive while
        // standing at the loadout totem (re-pushed on its retrigger
        // cadence with identical content — store, then let station
        // proximity decide visibility). The pick rides back as an ordinary
        // card-pick and lands on the venue loadout entry (roundIndex is
        // venue-ignored).
        onVenueDraft: (offers) => {
          this.loadoutOffers = offers;
          this.maybeShowLoadout();
        },
        // The bell (S2.F): admission crosses the membrane. main.ts owns the
        // scene handoff (stop Hangout → its teardown closes this socket →
        // start OnlineMatchScene mode:"world").
        onVenueAdmitted: () => {
          window.dispatchEvent(new CustomEvent("jakesjam:venue-admitted"));
        },
      });
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

  /** Loadout station (S2.E, separated 2026-07-17): open the card selector
   *  iff the player is standing at the station, hasn't already picked this
   *  visit, and the overlay isn't already up. Picking sends a card-pick
   *  over the lobby socket and arms the totem glow; not picking and
   *  walking away is fine — no nag, no auto-pick, the bell admits with
   *  none. */
  private maybeShowLoadout(): void {
    if (this.mode !== "venue") return;
    if (!this.loadoutInZone || !this.loadoutSeenOutside || this.loadoutDismissed) return;
    if (this.draftOverlay?.isOpen()) return;
    const cards = (this.loadoutOffers ?? [])
      .map((id) => crystalRoundsCards.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    if (cards.length === 0) return;
    if (!this.draftOverlay) {
      this.draftOverlay = new CardDraftOverlay(
        {},
        {
          kicker: LOADOUT_KICKER,
          title: LOADOUT_TITLE,
          hint: LOADOUT_HINT,
        },
      );
    }
    this.draftOverlay.show(cards, (card) => {
      this.loop?.sendCardPick(this.venueStatus?.roundIndex ?? 0, card.id);
      this.loadoutPickId = card.id;
      this.loadoutDismissed = true;
      this.draftOverlay?.hide();
    });
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
    if (!this.audio) return;
    if (!this.simEventRouter) {
      // Only ready-toggled/launch-requested (and the always-inert combat
      // cases) can ever fire in a hangout match — the deps below are still
      // fully wired (not stubbed) so the router's exhaustive switch stays
      // byte-identical to OnlineMatchScene's, even though most branches are
      // unreachable here.
      this.simEventRouter = new SimEventRouter({
        scene: this,
        audio: this.audio,
        localPlayerId: this.localPlayerId,
        safeShake: () => {},
        spawnDamageNumber: () => {},
        spawnBlastAtPlayer: () => {},
        killCinematic: () => {},
        spawnPlatformBlastTint: () => {},
        showCardDraft: () => {},
        hideCardDraft: () => {},
        playerRigs: this.playerRigs,
        particlePool: null,
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
      const ring = totem.kind === "ready" ? PALETTE.inkBright : PALETTE.sapphireSteady;
      g.lineStyle(4, ring, 0.85);
      g.strokeCircle(totem.x, totem.y, totem.radius);
      g.lineStyle(2, ring, 0.4);
      g.strokeCircle(totem.x, totem.y, totem.radius * 0.6);
      g.fillStyle(ring, 0.06);
      g.fillCircle(totem.x, totem.y, totem.radius);

      const isBell = totem.id === "totem-bell";
      const text =
        this.mode === "venue"
          ? isBell
            ? "THE BELL"
            : LOADOUT_KICKER
          : totem.kind === "ready"
            ? "READY"
            : "LAUNCH";
      const label = this.add
        .text(totem.x, totem.y - totem.radius - 26, text, {
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
      (this.venueStatus?.queued.includes(this.localPlayerId as string) ?? false);
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
        // Loadout armed (2026-07-17): a picked starter card holds the
        // station ring bright — state, not a flash (axiom H2), mirroring
        // the bell's queued glow.
        (this.loadoutPickId !== null && totem.id === "totem-loadout");
      const ring = totem.kind === "ready" ? PALETTE.inkBright : PALETTE.sapphireSteady;
      const r = isFlashingRing ? totem.radius * scale : totem.radius;
      const alpha = 0.55 + 0.3 * pulse;
      this.totemGraphics.lineStyle(4, ring, isFlashingRing ? 1 : 0.85);
      this.totemGraphics.strokeCircle(totem.x, totem.y, r);
      this.totemGraphics.lineStyle(2, ring, 0.4);
      this.totemGraphics.strokeCircle(totem.x, totem.y, r * 0.6);
      this.totemGraphics.fillStyle(ring, isFlashingRing ? 0.14 : 0.06 * alpha * 2);
      this.totemGraphics.fillCircle(totem.x, totem.y, r);
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
      this.feedText = this.add
        .text(this.scale.width / 2, 14, "", {
          color: "#7a8299",
          fontFamily: "'Space Mono', 'Courier New', monospace",
          fontSize: "13px",
          align: "center",
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(1000);
    }

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
    this.feedText.setPosition(this.scale.width / 2, 14);

    if (this.bellLabel) {
      const queuedCount = s.queued.length;
      const localQueued = s.queued.includes(this.localPlayerId as string);
      const suffix = localQueued
        ? " · QUEUED"
        : queuedCount > 0
          ? ` · ${queuedCount} QUEUED`
          : "";
      this.bellLabel.setText(`THE BELL · ${mm}:${ss}${suffix}`);
    }
  }

  // ---------------- Update ----------------

  update() {
    if (!this.loop) return;

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

    // Aim orients the rig — and in venue mode it aims live practice fire.
    // Mouse position on desktop, last known local position on touch (touch
    // aim stick still exists per the combatButtons:false precedent; touch
    // stays walk-only until the venue gets real touch combat controls).
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const aimWorld = cam.getWorldPoint(pointer.x, pointer.y);
    let aimX = aimWorld.x;
    let aimY = aimWorld.y;

    if (this.touchControls) {
      const t = this.touchControls.getState();
      keys = t.keys & (InputBit.Left | InputBit.Right | InputBit.Jump | InputBit.Down | InputBit.Crouch);
      const state = this.loop.getRenderState();
      const me = state?.players[this.localPlayerId];
      if (me && t.aimDir) {
        aimX = me.x + t.aimDir.x * 100;
        aimY = me.y + t.aimDir.y * 100;
      } else if (me) {
        aimX = me.x;
        aimY = me.y;
      }
    }

    this.loop.setLocalInput({ keys, aimX, aimY });
    this.loop.pump();

    const state = this.loop.getRenderState();
    if (!state) return;

    const now = performance.now();
    const deltaMs = Math.max(1, Math.min(50, now - this.lastFrameMs));
    this.lastFrameMs = now;

    this.renderWorld(state, deltaMs);
    this.entityRender?.update(state, deltaMs, now);
    this.followLocalPlayer(state, deltaMs);
    this.updateLoadoutZone(state);
    this.updateTotemPulse(now);
    this.updateVenueFeed(now);
  }

  private renderWorld(state: WorldState, deltaMs: number): void {
    const seen = this.seenPlayersScratch;
    seen.clear();
    for (const pid in state.players) {
      const player = state.players[PlayerId(pid)]!;
      seen.add(pid);
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
    return new ProceduralPlayerRig(this, {
      color: isLocal ? LOCAL_PLAYER_FALLBACK_COLOR : REMOTE_PLAYER_FALLBACK_COLOR,
      accentColor: cosmetics?.accentColor
        ? colorToNumber(cosmetics.accentColor)
        : isLocal
          ? 0xffd166
          : undefined,
      visorColor: cosmetics?.visorColor ? colorToNumber(cosmetics.visorColor) : undefined,
      palmColor: cosmetics?.palmColor ? colorToNumber(cosmetics.palmColor) : undefined,
      jointColor: cosmetics?.jointColor ? colorToNumber(cosmetics.jointColor) : undefined,
      auraColor: cosmetics?.auraColor ? colorToNumber(cosmetics.auraColor) : undefined,
      name: this.rosterNames.get(player.id as string) ?? (player.id as string).slice(-4),
      identitySeed: player.id as string,
      scale: this.getVisualScale(character),
      // No combat frame-budget to protect (that's the whole reason
      // OnlineMatchScene restricts "full" detail to the local player only)
      // — every hangout rig gets the full-juice treatment.
      detail: "full",
    });
  }

  private updatePlayerRig(rig: ProceduralPlayerRig, player: PlayerEntity, deltaMs: number): void {
    if (!player.alive) {
      rig.setVisible(false);
      this.crouchHalfByPid.delete(player.id as string);
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
      // No cards ever granted in hangout mode — plating/parry-cover stay
      // at their rest values.
      shieldArcScale: 1,
      platingGlow: 0,
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
    this.entityRender?.destroy();
    this.entityRender = null;
    this.callsignOverlay?.remove();
    this.callsignOverlay = null;
    this.draftOverlay?.destroy();
    this.draftOverlay = null;
    this.loadoutOffers = null;
    this.loadoutPickId = null;
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
    this.totemGraphics?.destroy();
    this.totemGraphics = null;
    for (const label of this.totemLabels) label.destroy();
    this.totemLabels = [];
    // PlatformLayer self-destroys on the scene's own SHUTDOWN event.
    this.platformLayer = null;
  }
}
