import { ConvexClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

const rooms = api.rooms;
import type { ChaosModifierId, CharacterId, RoomId } from "../types/game";
import type {
  CreateRoomArgs,
  JoinRoomArgs,
  RoomHandle,
  RoomSnapshot,
} from "../types/net";

type Unsubscribe = () => void;

export class RoomClient {
  private readonly client: ConvexClient;

  constructor(url: string) {
    this.client = new ConvexClient(url);
  }

  createRoom(args: CreateRoomArgs): Promise<RoomHandle> {
    return this.client.mutation(rooms.create, args) as Promise<RoomHandle>;
  }

  joinRoom(args: JoinRoomArgs): Promise<RoomHandle> {
    return this.client.mutation(rooms.join, args) as Promise<RoomHandle>;
  }

  async setReady(roomId: RoomId, playerId: string, ready: boolean): Promise<void> {
    await this.client.mutation(rooms.setReady, { roomId, playerId, ready });
  }

  async updateSettings(
    roomId: RoomId,
    playerId: string,
    chaosModifierIds: ChaosModifierId[],
  ): Promise<void> {
    await this.client.mutation(rooms.updateSettings, {
      roomId,
      playerId,
      chaosModifierIds,
    });
  }

  startMatch(roomId: RoomId, playerId: string, mapId?: string): Promise<string> {
    return this.client.mutation(rooms.startMatch, {
      roomId,
      playerId,
      ...(mapId !== undefined ? { mapId } : {}),
    }) as Promise<string>;
  }

  async setMap(roomId: RoomId, playerId: string, mapId: string): Promise<void> {
    await this.client.mutation(rooms.setMap, { roomId, playerId, mapId });
  }

  async heartbeat(roomId: RoomId, playerId: string): Promise<void> {
    await this.client.mutation(rooms.heartbeat, { roomId, playerId });
  }

  async leave(roomId: RoomId, playerId: string): Promise<void> {
    await this.client.mutation(rooms.leave, { roomId, playerId });
  }

  subscribeRoom(
    roomId: RoomId,
    onUpdate: (snapshot: RoomSnapshot | null) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    return this.client.onUpdate(
      rooms.getById,
      { roomId },
      (snapshot) => onUpdate(snapshot as RoomSnapshot | null),
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
