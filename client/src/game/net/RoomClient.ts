import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import type { ChaosModifierId, CharacterId, MatchId, RoomId } from "../types/game";
import type {
  ApplyPlayerDamageArgs,
  CreateRoomArgs,
  JoinRoomArgs,
  MatchPlayerSnapshot,
  RoomHandle,
  RoomSnapshot,
  SubmitPlayerSnapshotArgs,
} from "../types/net";

type Unsubscribe = () => void;

export class RoomClient {
  private readonly client: ConvexClient;

  constructor(url: string) {
    this.client = new ConvexClient(url);
  }

  createRoom(args: CreateRoomArgs): Promise<RoomHandle> {
    return this.client.mutation(anyApi.rooms.create, args) as Promise<RoomHandle>;
  }

  joinRoom(args: JoinRoomArgs): Promise<RoomHandle> {
    return this.client.mutation(anyApi.rooms.join, args) as Promise<RoomHandle>;
  }

  setReady(roomId: RoomId, playerId: string, ready: boolean): Promise<void> {
    return this.client.mutation(anyApi.rooms.setReady, { roomId, playerId, ready }) as Promise<void>;
  }

  updateSettings(
    roomId: RoomId,
    playerId: string,
    chaosModifierIds: ChaosModifierId[],
  ): Promise<void> {
    return this.client.mutation(anyApi.rooms.updateSettings, {
      roomId,
      playerId,
      chaosModifierIds,
    }) as Promise<void>;
  }

  startMatch(roomId: RoomId, playerId: string): Promise<string> {
    return this.client.mutation(anyApi.rooms.startMatch, { roomId, playerId }) as Promise<string>;
  }

  submitPlayerSnapshot(args: SubmitPlayerSnapshotArgs): Promise<void> {
    return this.client.mutation(anyApi.matches.submitPlayerSnapshot, args) as Promise<void>;
  }

  applyPlayerDamage(args: ApplyPlayerDamageArgs): Promise<void> {
    return this.client.mutation(anyApi.matches.applyPlayerDamage, args) as Promise<void>;
  }

  heartbeat(roomId: RoomId, playerId: string): Promise<void> {
    return this.client.mutation(anyApi.rooms.heartbeat, { roomId, playerId }) as Promise<void>;
  }

  leave(roomId: RoomId, playerId: string): Promise<void> {
    return this.client.mutation(anyApi.rooms.leave, { roomId, playerId }) as Promise<void>;
  }

  subscribeRoom(
    roomId: RoomId,
    onUpdate: (snapshot: RoomSnapshot | null) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    return this.client.onUpdate(
      anyApi.rooms.getById,
      { roomId },
      (snapshot) => onUpdate(snapshot as RoomSnapshot | null),
      onError,
    ) as Unsubscribe;
  }

  subscribeMatchPlayerSnapshots(
    matchId: MatchId,
    onUpdate: (snapshots: MatchPlayerSnapshot[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    return this.client.onUpdate(
      anyApi.matches.getPlayerSnapshots,
      { matchId },
      (snapshots) => onUpdate(snapshots as MatchPlayerSnapshot[]),
      onError,
    ) as Unsubscribe;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export function createRoomArgs(
  playerId: string,
  name: string,
  color: string,
  characterId: CharacterId,
  chaosModifierIds: ChaosModifierId[],
): CreateRoomArgs {
  return { playerId, name, color, characterId, chaosModifierIds };
}
