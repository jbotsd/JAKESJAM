// Public entrypoint for the client netcode package.

export {
  ClientLoop,
  type ClientLoopOptions,
  type LocalInput,
  type NetStats,
  type SmoothingOptions,
  type ReconcileStats,
} from "./clientLoop.js";
export { WsTransport, type WsTransportOptions } from "./wsTransport.js";
export type { Transport, TransportState } from "./transport.js";
export { InputBit, PROTOCOL_VERSION, encodeMessage, decodeMessage } from "./protocol.js";
export type {
  ClientMessage,
  ServerMessage,
  Snapshot,
  Input,
  ServerHello,
  ClientHello,
  Ack,
  Ping,
  Pong,
  Disconnect,
  PlayerLobbyInfo,
} from "./protocol.js";
export {
  fetchMatchAssignment,
  buildGameServerWsUrl,
  type MatchmakerAssignment,
} from "./matchmakerClient.js";
export {
  fetchWorldAssignment,
  fetchWorldSummary,
  fetchMatchSummary,
  postRematchReady,
  type WorldAssignment,
} from "./worldClient.js";
export {
  armArenaPreconnect,
  disarmArenaPreconnect,
  takeArenaPreconnect,
  isArenaPreconnectArmed,
} from "./arenaPreconnect.js";
export { InterpolationBuffer } from "./interpolationBuffer.js";
export { sanitizePlayerName, stripDisallowedChars } from "./playerName.js";
export {
  sanitizeCharacterId,
  CHARACTER_ARCHETYPE_IDS,
  DEFAULT_CHARACTER_ID,
} from "./playerCharacter.js";
