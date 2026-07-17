import type { ChaosModifierId, CharacterId, MatchId, RoomId, Vec2 } from "./game";
import type { VesselCosmetics } from "../../sim/types";

export type RoomStatus = "lobby" | "starting" | "in_match" | "complete";

export type RoomDoc = {
  _id: RoomId;
  code: string;
  hostPlayerId: string;
  status: RoomStatus;
  maxPlayers: number;
  chaosModifierIds?: ChaosModifierId[];
  /** Host's selected map id for the next match. Optional + additive. */
  selectedMapId?: string;
  createdAt: number;
  updatedAt: number;
  currentMatchId?: MatchId;
};

export type RoomPlayer = {
  _id: string;
  roomId: RoomId;
  playerId: string;
  name: string;
  color: string;
  characterId: CharacterId;
  cosmetics?: VesselCosmetics;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
};

export type RoomSnapshot = {
  room: RoomDoc;
  players: RoomPlayer[];
};

export type RoomHandle = {
  roomId: RoomId;
  code: string;
  playerId: string;
};

export type CreateRoomArgs = {
  playerId: string;
  name: string;
  color: string;
  characterId: CharacterId;
  chaosModifierIds: ChaosModifierId[];
  cosmetics?: VesselCosmetics;
};

export type JoinRoomArgs = {
  code: string;
  playerId: string;
  name: string;
  color: string;
  characterId: CharacterId;
  cosmetics?: VesselCosmetics;
};

export type MatchPlayerSnapshot = {
  _id?: string;
  matchId: MatchId;
  roomId: RoomId;
  playerId: string;
  position: Vec2;
  velocity: Vec2;
  aimAngle: number;
  health: number;
  alive: boolean;
  crouching: boolean;
  shieldActive?: boolean;
  shieldCharge?: number;
  shotSequence?: number;
  sequence: number;
  updatedAt: number;
};

