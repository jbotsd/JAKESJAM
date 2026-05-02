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
  InputBit,
  type NetStats,
} from "../../net";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  ORBIT_RADIUS_PX,
  type DestructibleEntity,
  type DestructibleKind,
  type FireEntity,
  type PickupEntity,
  type PickupKind,
  type PlayerEntity,
  PlayerId,
  type SimEvent,
  type WorldState,
} from "../../sim";
import { characters } from "../data/characters";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import { GameAudioSystem } from "../systems/AudioSystem";
import {
  HudCompositor,
  type PendingCardOffer,
} from "../ui/HudCompositor";
import type {
  CharacterDefinition,
  CharacterId,
} from "../types/game";

export type OnlineMatchSceneInit = {
  matchId: string;
  localPlayerId: string;
  convexUrl: string;
};

const PROJECTILE_RADIUS_DEFAULT = 7;
// Mirrors MatchScene's PLAYER_VISUAL_SCALE so online and offline rigs match.
const PLAYER_VISUAL_SCALE = 0.78;
// Sim body heights (sim/player.ts: bodyHeight=56, crouchHeight=38).
// PlayerEntity (x, y) is the body center; rig wants foot position.
const SIM_BODY_HALF_HEIGHT = 28;
const SIM_CROUCH_HALF_HEIGHT = 19;
const LOCAL_PLAYER_FALLBACK_COLOR = 0x50e3c2;
const REMOTE_PLAYER_FALLBACK_COLOR = 0xff88aa;
const DAMAGE_FLASH_MS = 140;

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
function projectileColorByElement(element: string, ownerId: string): number {
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

function colorForOwner(ownerId: string): number {
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
  private playerRigs = new Map<string, ProceduralPlayerRig>();
  private projectileSprites = new Map<number, Phaser.GameObjects.Arc>();
  private satelliteSprites = new Map<number, Phaser.GameObjects.Arc>();
  private destructibleGraphics: Phaser.GameObjects.Graphics | null = null;
  private fireGraphics: Phaser.GameObjects.Graphics | null = null;
  private pickupGraphics: Phaser.GameObjects.Graphics | null = null;
  private localPlayerId: PlayerId = PlayerId("");
  private lastFrameMs = 0;
  private keys!: Record<"a" | "d" | "w" | "s" | "space" | "shift", Phaser.Input.Keyboard.Key>;
  private statsVisible = false;
  private statsText: Phaser.GameObjects.Text | null = null;
  private statsBg: Phaser.GameObjects.Rectangle | null = null;
  private statsToggleKey: Phaser.Input.Keyboard.Key | null = null;
  // Reused buffer so we don't allocate a new string-array each frame.
  private readonly statsLineBuf: string[] = ["", "", "", "", "", ""];

  // ---- HUD + overlays (collapsed into one compositor) ----
  private compositor: HudCompositor | null = null;
  private audio?: GameAudioSystem;
  // Track destructible health between frames for damage-flash effect.
  private prevDestructibleHealth = new Map<number, number>();
  private destructibleFlashUntilMs = new Map<number, number>();
  // Pending card-offer event to route to the compositor on the next update.
  private pendingCardOffer: PendingCardOffer | null = null;

  constructor() {
    super(SceneKeys.OnlineMatch);
  }

  init(data: OnlineMatchSceneInit) {
    this.localPlayerId = PlayerId(data.localPlayerId);
    void this.connect(data);
  }

  create() {
    this.cameras.main.setBackgroundColor("#0b0e14");
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
      };
      this.statsToggleKey = this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.BACKTICK,
      );
      this.statsToggleKey.on("down", () => this.toggleStats());
    }

    this.audio = new GameAudioSystem(this);

    // World-space graphics layers. Order matters: pickups under destructibles
    // under fire so the fire glow reads on top.
    this.pickupGraphics = this.add.graphics();
    this.pickupGraphics.setDepth(2);
    this.destructibleGraphics = this.add.graphics();
    this.destructibleGraphics.setDepth(3);
    this.fireGraphics = this.add.graphics();
    this.fireGraphics.setDepth(4);

    this.createStatsHud();
    this.compositor = new HudCompositor(this, this.localPlayerId, {
      onCardPick: (roundIndex, cardId) => {
        this.loop?.sendCardPick(roundIndex, cardId);
      },
      onRematch: () => {
        window.dispatchEvent(new CustomEvent("jakesjam:return-to-lobby"));
      },
      onReturnToLobby: () => {
        window.dispatchEvent(new CustomEvent("jakesjam:return-to-lobby"));
      },
    });

    this.lastFrameMs = performance.now();
    this.events.once("shutdown", () => this.teardown());
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

    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const aimX = pointer.x + cam.scrollX;
    const aimY = pointer.y + cam.scrollY;

    this.loop.setLocalInput({ keys, aimX, aimY });

    const now = performance.now();
    const deltaMs = Math.max(1, Math.min(50, now - this.lastFrameMs));
    this.lastFrameMs = now;

    this.renderWorld(state, deltaMs, now);
    this.followLocalPlayer(state);
    if (this.compositor) {
      const local = state.players[this.localPlayerId];
      const character = this.getCharacter(local?.characterId);
      this.pendingCardOffer = this.compositor.update(state, character, this.pendingCardOffer);
    }

    if (this.statsVisible) {
      this.updateStatsHud();
    }
  }

  // ---------------- HUD ----------------

  private repositionHud() {
    this.repositionStatsHud();
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
  }

  private repositionStatsHud() {
    if (!this.statsBg || !this.statsText) return;
    const cam = this.cameras.main;
    const panelWidth = (this.statsBg.width as number) || 220;
    const x = cam.width - panelWidth - 12;
    const y = 12;
    this.statsBg.setPosition(x, y);
    this.statsText.setPosition(x + 8, y + 6);
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

  // ---------------- Connect ----------------

  private async connect(data: OnlineMatchSceneInit) {
    try {
      this.convex = new ConvexClient(data.convexUrl);
      this.setStatus("Fetching match assignment from Convex...");
      const assignment = await fetchMatchAssignment(
        this.convex,
        data.matchId as Id<"matches">,
        data.localPlayerId,
      );
      const wsUrl = buildGameServerWsUrl(assignment, data.matchId);
      this.setStatus(`Opening WebSocket to ${assignment.region ?? "host"}...`);
      const transport = new WsTransport({ url: wsUrl });
      this.loop = new ClientLoop({
        transport,
        matchId: data.matchId,
        playerId: data.localPlayerId,
        onAuthoritativeApplied: () => {
          this.setStatus(""); // hide status once we start receiving snapshots
        },
        onEvents: (events) => this.handleSimEvents(events),
      });
      transport.onClose((reason) => {
        this.setStatus(`Disconnected: ${reason}`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      this.setStatus(`Connect failed: ${msg}`);
    }
  }

  // ---------------- Sim event → audio + overlays ----------------

  private handleSimEvents(events: SimEvent[]) {
    if (!this.audio) return;
    for (const event of events) {
      switch (event.t) {
        case "shot-fired":
          this.audio.play("shoot");
          if (event.playerId === this.localPlayerId) {
            // Tiny recoil shake on local-player fire.
            this.cameras.main.shake(40, 0.0015);
          }
          break;
        case "hit-confirmed":
          this.audio.play("hit");
          if (event.victimId === this.localPlayerId) {
            this.cameras.main.shake(80, 0.004);
          }
          this.spawnDamageNumber(event.victimId, event.damage);
          break;
        case "destructible-broken":
          this.audio.play("explosion");
          this.cameras.main.shake(60, 0.0025);
          break;
        case "pickup-taken":
          this.audio.play("pickup");
          break;
        case "parry-deflected":
          this.audio.play("hit");
          break;
        case "shield-popped":
          this.audio.play("explosion");
          break;
        case "round-end":
          // Soft cue. Reuse "card" as a "ding".
          this.audio.play("card");
          break;
        case "card-offered":
          if (event.playerId === this.localPlayerId) {
            const key = event.cardIds.join("|");
            this.pendingCardOffer = { cardIds: event.cardIds, key };
          }
          break;
        case "player-slowed":
          // Visual-only; no sound.
          break;
      }
    }
  }

  private spawnDamageNumber(victimId: string, damage: number) {
    const state = this.loop?.getRenderState();
    if (!state) return;
    const victim = state.players[PlayerId(victimId)];
    if (!victim || damage < 1) return;
    const isLocal = victimId === this.localPlayerId;
    const spread = (Math.random() - 0.5) * 22;
    const text = this.add
      .text(victim.x + spread, victim.y - 36, Math.round(damage).toString(), {
        color: isLocal ? "#fb7185" : "#fff7d6",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: damage >= 30 ? "18px" : "14px",
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

  // ---------------- World rendering ----------------

  private renderWorld(state: WorldState, deltaMs: number, nowMs: number) {
    // Players — procedurally rigged puppets, matching the offline MatchScene.
    const seenPlayers = new Set<string>();
    for (const [pid, player] of Object.entries(state.players)) {
      seenPlayers.add(pid);
      let rig = this.playerRigs.get(pid);
      if (!rig) {
        rig = this.makePlayerRig(player, pid === this.localPlayerId);
        this.playerRigs.set(pid, rig);
      }
      this.updatePlayerRig(rig, player, deltaMs);
    }
    for (const [pid, rig] of this.playerRigs) {
      if (!seenPlayers.has(pid)) {
        rig.destroy();
        this.playerRigs.delete(pid);
      }
    }

    this.renderProjectiles(state);
    this.renderDestructibles(state, nowMs);
    this.renderFirePatches(state, nowMs);
    this.renderPickups(state, nowMs);
    this.renderSatellites(state);
  }

  private renderProjectiles(state: WorldState) {
    const seen = new Set<number>();
    for (const [idStr, proj] of Object.entries(state.projectiles)) {
      const id = Number(idStr);
      seen.add(id);
      const color = projectileColorByElement(proj.element, proj.ownerId);
      let arc = this.projectileSprites.get(id);
      if (!arc) {
        arc = this.add.circle(
          proj.x,
          proj.y,
          proj.radius || PROJECTILE_RADIUS_DEFAULT,
          color,
        );
        arc.setDepth(6);
        this.projectileSprites.set(id, arc);
      }
      arc.setPosition(proj.x, proj.y);
      arc.setRadius(proj.radius || PROJECTILE_RADIUS_DEFAULT);
      arc.setFillStyle(color);
    }
    for (const [id, arc] of this.projectileSprites) {
      if (!seen.has(id)) {
        arc.destroy();
        this.projectileSprites.delete(id);
      }
    }
  }

  private renderDestructibles(state: WorldState, nowMs: number) {
    const graphics = this.destructibleGraphics;
    if (!graphics) return;
    graphics.clear();

    const seen = new Set<number>();
    for (const [idStr, obj] of Object.entries(state.destructibles)) {
      const id = Number(idStr);
      seen.add(id);

      // Damage-flash bookkeeping: when health drops between snapshots,
      // tint white briefly.
      const prev = this.prevDestructibleHealth.get(id);
      if (prev !== undefined && obj.health < prev) {
        this.destructibleFlashUntilMs.set(id, nowMs + DAMAGE_FLASH_MS);
      }
      this.prevDestructibleHealth.set(id, obj.health);
      const flashing = (this.destructibleFlashUntilMs.get(id) ?? 0) > nowMs;
      drawDestructible(graphics, obj, flashing);
    }
    for (const id of this.prevDestructibleHealth.keys()) {
      if (!seen.has(id)) {
        this.prevDestructibleHealth.delete(id);
        this.destructibleFlashUntilMs.delete(id);
      }
    }
  }

  private renderFirePatches(state: WorldState, nowMs: number) {
    const graphics = this.fireGraphics;
    if (!graphics) return;
    graphics.clear();
    for (const fire of Object.values(state.firePatches)) {
      drawFirePatch(graphics, fire, nowMs);
    }
  }

  private renderPickups(state: WorldState, nowMs: number) {
    const graphics = this.pickupGraphics;
    if (!graphics) return;
    graphics.clear();
    for (const pickup of Object.values(state.pickups)) {
      drawPickup(graphics, pickup, nowMs);
    }
  }

  private renderSatellites(state: WorldState) {
    const seen = new Set<number>();
    for (const [idStr, sat] of Object.entries(state.satellites)) {
      const id = Number(idStr);
      seen.add(id);
      const owner = state.players[sat.ownerId];
      if (!owner) continue;
      const x = owner.x + Math.cos(sat.angle) * sat.orbitRadius;
      const y = owner.y + Math.sin(sat.angle) * sat.orbitRadius;
      let arc = this.satelliteSprites.get(id);
      if (!arc) {
        arc = this.add.circle(x, y, 5, 0xfff7d6, 0.92);
        arc.setStrokeStyle(2, 0xffd166, 0.7);
        arc.setDepth(7);
        this.satelliteSprites.set(id, arc);
      }
      arc.setPosition(x, y);
    }
    for (const [id, arc] of this.satelliteSprites) {
      if (!seen.has(id)) {
        arc.destroy();
        this.satelliteSprites.delete(id);
      }
    }
    void ORBIT_RADIUS_PX; // Constant kept imported for future tuning hooks.
  }

  // ---------------- Player rig wiring ----------------

  private makePlayerRig(player: PlayerEntity, isLocal: boolean): ProceduralPlayerRig {
    const character = this.getCharacter(player.characterId);
    return new ProceduralPlayerRig(this, {
      color: isLocal ? LOCAL_PLAYER_FALLBACK_COLOR : REMOTE_PLAYER_FALLBACK_COLOR,
      // No room-roster lookup yet on the netcode path; fall back to the player
      // id suffix + character name so the nameplate is stable + identifiable.
      name: `${player.id.slice(-4)} / ${character.name}`,
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
      // The sim doesn't expose a grounded flag on PlayerEntity (it lives in the
      // per-tick movement memory). Treat players as grounded for posing — the
      // rig's bob effect is keyed off horizontal walk speed anyway.
      grounded: true,
      crouching: player.crouching,
      health: player.health,
      maxHealth: character.maxHealth,
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
    this.cameras.main.centerOn(local.x, local.y);
  }

  // ---------------- Status text ----------------

  private setStatus(message: string) {
    if (this.statusText) {
      this.statusText.setText(message);
      this.statusText.setVisible(message.length > 0);
    }
  }

  private teardown() {
    this.scale.off("resize", this.repositionHud, this);
    this.loop?.stop();
    this.loop = null;
    void this.convex?.close();
    this.convex = null;
    this.audio?.destroy();
    this.audio = undefined;
    this.compositor?.destroy();
    this.compositor = null;
    this.pendingCardOffer = null;
    for (const rig of this.playerRigs.values()) rig.destroy();
    this.playerRigs.clear();
    for (const sprite of this.projectileSprites.values()) sprite.destroy();
    this.projectileSprites.clear();
    for (const sprite of this.satelliteSprites.values()) sprite.destroy();
    this.satelliteSprites.clear();
    this.destructibleGraphics?.destroy();
    this.destructibleGraphics = null;
    this.fireGraphics?.destroy();
    this.fireGraphics = null;
    this.pickupGraphics?.destroy();
    this.pickupGraphics = null;
    this.statsText?.destroy();
    this.statsText = null;
    this.statsBg?.destroy();
    this.statsBg = null;
    this.statsToggleKey = null;
    this.prevDestructibleHealth.clear();
    this.destructibleFlashUntilMs.clear();
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
