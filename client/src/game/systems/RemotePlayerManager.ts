import type Phaser from "phaser";
import { ProceduralPlayerRig } from "../rendering/ProceduralPlayerRig";
import type { CharacterDefinition, Vec2 } from "../types/game";
import type { MatchPlayerSnapshot, RoomPlayer } from "../types/net";
import { smoothSnapshot } from "./remoteSnapshotInterpolation";

export { smoothSnapshot };

/**
 * Inputs the manager needs from the host scene to render rigs. Kept as a
 * narrow context object so the scene can pass live methods (room players /
 * character lookup) without exposing its full surface.
 */
export interface RemotePlayerContext {
  readonly localPlayerId: string;
  /** Spawns to fall back to when a player has no snapshot yet (used for index→spawn). */
  readonly spawns: ReadonlyArray<Vec2>;
  /** Visual scale for a given character. */
  visualScaleFor(character: CharacterDefinition): number;
  /** Body size for a given character. */
  bodySizeFor(character: CharacterDefinition): Vec2;
  /** Character lookup (the scene already has this; we forward to it). */
  characterFor(characterId: string | undefined): CharacterDefinition;
  /** Hex color → numeric color (matches scene's helper). */
  colorToNumber(hex: string): number;
}

export interface RemoteSyncRow {
  readonly playerId: string;
  readonly position: Vec2;
}

/**
 * Manages remote-player rigs, the latest interpolated snapshots, and
 * per-player shot sequences. Pure orchestration around a small set of
 * Phaser ProceduralPlayerRig instances — owns no game-logic state.
 *
 * Construction is split from rig creation so the scene controls when
 * `roomPlayers` is final (e.g. after init data is parsed).
 */
export class RemotePlayerManager {
  private readonly rigs = new Map<string, ProceduralPlayerRig>();
  private readonly snapshots = new Map<string, MatchPlayerSnapshot>();
  private readonly shotSequences = new Map<string, number>();

  private readonly scene: Phaser.Scene;
  private readonly ctx: RemotePlayerContext;

  constructor(scene: Phaser.Scene, ctx: RemotePlayerContext) {
    this.scene = scene;
    this.ctx = ctx;
  }

  /**
   * Spawn a rig per non-local room player and immediately do an idle sync so
   * rigs are positioned at their spawn points before the first frame.
   */
  initRigs(roomPlayers: ReadonlyArray<RoomPlayer>): void {
    for (const player of roomPlayers) {
      if (player.playerId === this.ctx.localPlayerId) {
        continue;
      }

      const character = this.ctx.characterFor(player.characterId);
      const rig = new ProceduralPlayerRig(this.scene, {
        color: this.ctx.colorToNumber(player.color),
        name: `${player.name} / ${character.name}`,
        scale: this.ctx.visualScaleFor(character),
      });
      this.rigs.set(player.playerId, rig);
    }
    this.syncVisuals(roomPlayers, 16);
  }

  /**
   * Drive every remote rig forward one frame. Returns the rendered position
   * per visible remote so callers (status VFX) can attach effects without
   * recomputing geometry.
   */
  syncVisuals(roomPlayers: ReadonlyArray<RoomPlayer>, deltaMs: number): RemoteSyncRow[] {
    const rendered: RemoteSyncRow[] = [];
    if (this.rigs.size === 0) {
      return rendered;
    }

    for (const [playerId, rig] of this.rigs) {
      const playerIndex = this.indexOf(roomPlayers, playerId);
      const spawn = this.ctx.spawns[playerIndex % Math.max(1, this.ctx.spawns.length)] ?? { x: 0, y: 0 };
      const room = this.findRoomPlayer(roomPlayers, playerId);
      const character = this.ctx.characterFor(room?.characterId);
      const snapshot = this.snapshots.get(playerId);
      if (snapshot?.alive === false) {
        rig.setVisible(false);
        continue;
      }

      rig.setVisible(true);
      const targetPosition = snapshot?.position ?? spawn;
      const bodySize = this.ctx.bodySizeFor(character);
      const footPosition = {
        x: targetPosition.x,
        y: targetPosition.y + bodySize.y / 2,
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
        health: snapshot?.health ?? character.maxHealth,
        maxHealth: Math.max(character.maxHealth, snapshot?.health ?? character.maxHealth),
      });

      rendered.push({ playerId, position: targetPosition });
    }

    return rendered;
  }

  /**
   * Apply a remote snapshot. Returns `{ previous, next }` where `next` is the
   * smoothed snapshot stored locally — callers can diff `shotSequence` etc.
   */
  ingestSnapshot(snapshot: MatchPlayerSnapshot): {
    previous: MatchPlayerSnapshot | undefined;
    next: MatchPlayerSnapshot;
  } {
    const previous = this.snapshots.get(snapshot.playerId);
    const next = previous ? smoothSnapshot(previous, snapshot) : snapshot;
    this.snapshots.set(snapshot.playerId, next);
    return { previous, next };
  }

  getSnapshot(playerId: string): MatchPlayerSnapshot | undefined {
    return this.snapshots.get(playerId);
  }

  /** Direct write — used when the scene applies damage to a remote and needs
   * the smoothed snapshot map to reflect the post-damage health/alive state. */
  setSnapshot(playerId: string, snapshot: MatchPlayerSnapshot): void {
    this.snapshots.set(playerId, snapshot);
  }

  /** Returns the snapshot map for read-only iteration (callers must not mutate). */
  snapshotEntries(): IterableIterator<[string, MatchPlayerSnapshot]> {
    return this.snapshots.entries();
  }

  setShotSequence(playerId: string, sequence: number): void {
    this.shotSequences.set(playerId, sequence);
  }

  getShotSequence(playerId: string): number | undefined {
    return this.shotSequences.get(playerId);
  }

  hasShotSequence(playerId: string): boolean {
    return this.shotSequences.has(playerId);
  }

  /** Reset everything (used by scene shutdown / restart paths). */
  reset(): void {
    for (const rig of this.rigs.values()) {
      rig.destroy();
    }
    this.rigs.clear();
    this.snapshots.clear();
    this.shotSequences.clear();
  }

  private indexOf(roomPlayers: ReadonlyArray<RoomPlayer>, playerId: string): number {
    const index = roomPlayers.findIndex((player) => player.playerId === playerId);
    return index >= 0 ? index : 0;
  }

  private findRoomPlayer(roomPlayers: ReadonlyArray<RoomPlayer>, playerId: string): RoomPlayer | undefined {
    return roomPlayers.find((player) => player.playerId === playerId);
  }
}

