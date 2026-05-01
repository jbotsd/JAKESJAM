import type { ChaosModifierId, CharacterId, MatchId, RoomId, Vec2 } from "./game";

export type RoomStatus = "lobby" | "starting" | "in_match" | "complete";

export type RoomDoc = {
  _id: RoomId;
  code: string;
  hostPlayerId: string;
  status: RoomStatus;
  maxPlayers: number;
  chaosModifierIds?: ChaosModifierId[];
  createdAt: number;
  updatedAt: number;
  currentMatchId?: string;
};

export type RoomPlayer = {
  _id: string;
  roomId: RoomId;
  playerId: string;
  name: string;
  color: string;
  characterId: CharacterId;
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
};

export type JoinRoomArgs = {
  code: string;
  playerId: string;
  name: string;
  color: string;
  characterId: CharacterId;
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
  sequence: number;
  updatedAt: number;
};

export type SubmitPlayerSnapshotArgs = {
  matchId: MatchId;
  roomId: RoomId;
  playerId: string;
  position: Vec2;
  velocity: Vec2;
  aimAngle: number;
  health: number;
  alive: boolean;
  crouching: boolean;
  shieldActive: boolean;
  shieldCharge: number;
  sequence: number;
};

export type ApplyPlayerDamageArgs = {
  matchId: MatchId;
  roomId: RoomId;
  attackerPlayerId: string;
  targetPlayerId: string;
  damage: number;
};
