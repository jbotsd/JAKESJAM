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
import { resolveHangoutTotems, type TotemDefinition } from "../../sim/totem.js";
import { PrivateRoomClient } from "../net/PrivateRoomClient";
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
import type { CharacterDefinition, CharacterId } from "../types/game";

export type HangoutSceneInit = {
  roomCode: string;
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

export class HangoutScene extends Phaser.Scene {
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

  constructor() {
    super(SceneKeys.Hangout);
  }

  init(data: HangoutSceneInit) {
    this.roomCode = data.roomCode;
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
      const client = new PrivateRoomClient();
      this.setStatus("Requesting hangout access...");
      const { matchId, token } = await client.hangoutToken(
        this.roomCode,
        this.localPlayerId as string,
      );
      this.setStatus("Opening WebSocket...");
      const wsUrl = client.buildWsUrl(matchId, token);
      const transport = new WsTransport({ url: wsUrl });
      this.loop = new ClientLoop({
        transport,
        matchId,
        playerId: this.localPlayerId as string,
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
    this.platformLayer.repaint(map.platforms, theme);

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
    this.totems = resolveHangoutTotems(map);

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

      const label = this.add
        .text(
          totem.x,
          totem.y - totem.radius - 26,
          totem.kind === "ready" ? "READY" : "LAUNCH",
          {
            color: totem.kind === "ready" ? "#aa9e7f" : "#6b98f4",
            fontFamily: "'Space Grotesk', Inter, Arial, sans-serif",
            fontSize: "16px",
            fontStyle: "bold",
          },
        )
        .setOrigin(0.5)
        .setDepth(2.1);
      this.totemLabels.push(label);
    }
  }

  /** Ready totem flash feedback — walking-into-it feel while no combat
   *  cinematic exists to carry the beat. Cheap sin pulse, no tween churn. */
  private updateTotemPulse(nowMs: number): void {
    if (!this.totemGraphics) return;
    const flashing = nowMs < this.readyFlashUntilMs;
    const readyTotem = this.totems.find((t) => t.kind === "ready");
    if (!readyTotem) return;
    const scale = flashing ? 1 + 0.12 * Math.sin(nowMs * 0.03) : 1;
    // Redraw is cheap at this scale (two rings + a fill per totem, once a
    // frame only while flashing would be ideal, but two totems total makes
    // an always-on subtle pulse cost-free here).
    const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0025);
    this.totemGraphics.clear();
    for (const totem of this.totems) {
      const isFlashingRing = flashing && totem.id === readyTotem.id;
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

  // ---------------- Update ----------------

  update() {
    if (!this.loop) return;

    let keys = 0;
    if (this.keys?.a.isDown) keys |= InputBit.Left;
    if (this.keys?.d.isDown) keys |= InputBit.Right;
    if (this.keys?.w.isDown || this.keys?.space.isDown) keys |= InputBit.Jump;

    // Aim is cosmetic-only in hangout mode (no weapon ever fires server-
    // side) — it just orients the rig. Mouse position on desktop, last
    // known local position on touch (touch aim stick still exists per the
    // combatButtons:false precedent, but nothing requires it here).
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
    this.followLocalPlayer(state, deltaMs);
    this.updateTotemPulse(now);
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
