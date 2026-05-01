// Minimal online match scene running on the new netcode path.
// Connects to the Bun game server through Convex matchmaker, runs ClientLoop
// for prediction/reconciliation, renders WorldState through the same
// ProceduralPlayerRig used by the offline MatchScene so online players look
// identical to offline ones.
//
// Activated by `?netcode=new` on the page URL. Without that flag, lobby start
// boots the existing full-featured MatchScene which still goes through the
// per-frame Convex sync path. The two coexist so we can A/B without breaking
// playable gameplay during the cutover.

import Phaser from "phaser";
import { ConvexClient } from "convex/browser";
import {
  ClientLoop,
  WsTransport,
  buildGameServerWsUrl,
  fetchMatchAssignment,
  InputBit,
} from "../../net";
import type { Id } from "../../../../convex/_generated/dataModel";
import type {
  PlayerEntity,
  ProjectileEntity,
  WorldState,
} from "../../sim/types";
import { characters } from "../data/characters";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import type { CharacterDefinition, CharacterId } from "../types/game";

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

export class OnlineMatchScene extends Phaser.Scene {
  private loop: ClientLoop | null = null;
  private convex: ConvexClient | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private playerRigs = new Map<string, ProceduralPlayerRig>();
  private projectileSprites = new Map<number, Phaser.GameObjects.Arc>();
  private localPlayerId: string = "";
  private lastFrameMs = 0;
  private keys!: Record<"a" | "d" | "w" | "s" | "space" | "shift", Phaser.Input.Keyboard.Key>;

  constructor() {
    super("OnlineMatchScene");
  }

  init(data: OnlineMatchSceneInit) {
    this.localPlayerId = data.localPlayerId;
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
      .setScrollFactor(0);

    if (this.input.keyboard) {
      this.keys = {
        a: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        d: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        w: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        s: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        space: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        shift: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      };
    }

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
    if (this.input.activePointer.isDown && !this.input.activePointer.rightButtonDown()) {
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

    this.renderWorld(state, deltaMs);
    this.followLocalPlayer(state);
  }

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
      });
      transport.onClose((reason) => {
        this.setStatus(`Disconnected: ${reason}`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      this.setStatus(`Connect failed: ${msg}`);
    }
  }

  private renderWorld(state: WorldState, deltaMs: number) {
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

    // Projectiles (placeholder coloured circles — out of scope for this pass).
    const seenProjectiles = new Set<number>();
    for (const [idStr, proj] of Object.entries(state.projectiles)) {
      const id = Number(idStr);
      seenProjectiles.add(id);
      let arc = this.projectileSprites.get(id);
      if (!arc) {
        arc = this.add.circle(
          proj.x,
          proj.y,
          proj.radius || PROJECTILE_RADIUS_DEFAULT,
          colorForOwner(proj),
        );
        this.projectileSprites.set(id, arc);
      }
      arc.setPosition(proj.x, proj.y);
    }
    for (const [id, arc] of this.projectileSprites) {
      if (!seenProjectiles.has(id)) {
        arc.destroy();
        this.projectileSprites.delete(id);
      }
    }
  }

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

  private getCharacter(characterId: CharacterId | string | undefined): CharacterDefinition {
    return (
      characters.find((character) => character.id === characterId) ?? characters[0]!
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

  private setStatus(message: string) {
    if (this.statusText) {
      this.statusText.setText(message);
      this.statusText.setVisible(message.length > 0);
    }
  }

  private teardown() {
    this.loop?.stop();
    this.loop = null;
    void this.convex?.close();
    this.convex = null;
    for (const rig of this.playerRigs.values()) rig.destroy();
    this.playerRigs.clear();
    for (const sprite of this.projectileSprites.values()) sprite.destroy();
    this.projectileSprites.clear();
  }
}

function colorForOwner(proj: ProjectileEntity): number {
  // Cheap deterministic owner-coloring based on owner id hash.
  let hash = 0;
  for (let i = 0; i < proj.ownerId.length; i += 1) {
    hash = (hash * 31 + proj.ownerId.charCodeAt(i)) >>> 0;
  }
  const palette = [0x50e3c2, 0xff88aa, 0xffd166, 0x9bf6ff, 0xa0e7a0, 0xcaa7ff];
  return palette[hash % palette.length]!;
}
