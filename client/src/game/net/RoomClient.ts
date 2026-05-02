import { ConvexClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

const rooms = api.rooms;
const matches = api.matches;
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
    return this.client.mutation(rooms.create, args) as Promise<RoomHandle>;
  }

  joinRoom(args: JoinRoomArgs): Promise<RoomHandle> {
    return this.client.mutation(rooms.join, args) as Promise<RoomHandle>;
  }

  setReady(roomId: RoomId, playerId: string, ready: boolean): Promise<void> {
    return this.client.mutation(rooms.setReady, { roomId, playerId, ready }) as unknown as Promise<void>;
  }

  updateSettings(
    roomId: RoomId,
    playerId: string,
    chaosModifierIds: ChaosModifierId[],
  ): Promise<void> {
    return this.client.mutation(rooms.updateSettings, {
      roomId,
      playerId,
      chaosModifierIds,
    }) as unknown as Promise<void>;
  }

  startMatch(roomId: RoomId, playerId: string, mapId?: string): Promise<string> {
    // Cast: `mapId` arg was added to startMatch in this PR; generated
    // api types lag `bunx convex codegen`. Drop after next deploy.
    const mutate = this.client.mutation as unknown as (
      ref: unknown,
      args: { roomId: RoomId; playerId: string; mapId?: string },
    ) => Promise<string>;
    return mutate(rooms.startMatch, {
      roomId,
      playerId,
      ...(mapId !== undefined ? { mapId } : {}),
    });
  }

  setMap(roomId: RoomId, playerId: string, mapId: string): Promise<void> {
    // Cast: the `setMap` mutation was added in this PR; the generated
    // `convex/_generated/api` types lag a `bunx convex codegen` (or
    // deploy) run. Once codegen catches up, drop the cast.
    const mutate = this.client.mutation as unknown as (
      ref: unknown,
      args: { roomId: RoomId; playerId: string; mapId: string },
    ) => Promise<void>;
    const setMapRef = (rooms as unknown as Record<string, unknown>).setMap;
    return mutate(setMapRef, { roomId, playerId, mapId });
  }

  submitPlayerSnapshot(args: SubmitPlayerSnapshotArgs): Promise<void> {
    return this.client.mutation(matches.submitPlayerSnapshot, args) as unknown as Promise<void>;
  }

  applyPlayerDamage(args: ApplyPlayerDamageArgs): Promise<void> {
    return this.client.mutation(matches.applyPlayerDamage, args) as unknown as Promise<void>;
  }

  heartbeat(roomId: RoomId, playerId: string): Promise<void> {
    return this.client.mutation(rooms.heartbeat, { roomId, playerId }) as unknown as Promise<void>;
  }

  leave(roomId: RoomId, playerId: string): Promise<void> {
    return this.client.mutation(rooms.leave, { roomId, playerId }) as unknown as Promise<void>;
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

  subscribeMatchPlayerSnapshots(
    matchId: MatchId,
    onUpdate: (snapshots: MatchPlayerSnapshot[]) => void,
    onError: (error: Error) => void,
  ): Unsubscribe {
    return this.client.onUpdate(
      matches.getPlayerSnapshots,
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
