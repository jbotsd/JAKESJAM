// Minimal online match scene running on the new netcode path.
// Connects to the Bun game server through Convex matchmaker, runs ClientLoop
// for prediction/reconciliation, renders WorldState as colored circles.
//
// Activated by `?netcode=new` on the page URL. Without that flag, lobby start
// boots the existing full-featured MatchScene which still goes through the
// per-frame Convex sync path. The two coexist so we can A/B without breaking
// playable gameplay during the cutover.

import Phaser from "phaser";
import { ConvexReactClient } from "convex/react";
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

export type OnlineMatchSceneInit = {
  matchId: string;
  localPlayerId: string;
  convexUrl: string;
};

const PLAYER_RADIUS = 18;
const PROJECTILE_RADIUS_DEFAULT = 7;

export class OnlineMatchScene extends Phaser.Scene {
  private loop: ClientLoop | null = null;
  private convex: ConvexReactClient | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;
  private playerSprites = new Map<string, Phaser.GameObjects.Container>();
  private projectileSprites = new Map<number, Phaser.GameObjects.Arc>();
  private localPlayerId: string = "";
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

    this.renderWorld(state);
    this.followLocalPlayer(state);
  }

  private async connect(data: OnlineMatchSceneInit) {
    try {
      this.convex = new ConvexReactClient(data.convexUrl);
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

  private renderWorld(state: WorldState) {
    // Players
    const seenPlayers = new Set<string>();
    for (const [pid, player] of Object.entries(state.players)) {
      seenPlayers.add(pid);
      let container = this.playerSprites.get(pid);
      if (!container) {
        container = this.makePlayerContainer(player, pid === this.localPlayerId);
        this.playerSprites.set(pid, container);
      }
      container.setPosition(player.x, player.y);
      container.setAlpha(player.alive ? 1 : 0.25);
    }
    for (const [pid, container] of this.playerSprites) {
      if (!seenPlayers.has(pid)) {
        container.destroy();
        this.playerSprites.delete(pid);
      }
    }

    // Projectiles
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

  private makePlayerContainer(player: PlayerEntity, isLocal: boolean): Phaser.GameObjects.Container {
    const container = this.add.container(player.x, player.y);
    const body = this.add.circle(0, 0, PLAYER_RADIUS, isLocal ? 0x50e3c2 : 0xff88aa);
    body.setStrokeStyle(2, isLocal ? 0xffffff : 0x000000, 0.6);
    const label = this.add
      .text(0, -PLAYER_RADIUS - 14, player.id.slice(-4), {
        color: isLocal ? "#caffea" : "#ffd6e0",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "11px",
      })
      .setOrigin(0.5, 0.5);
    container.add([body, label]);
    return container;
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
    for (const sprite of this.playerSprites.values()) sprite.destroy();
    this.playerSprites.clear();
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
