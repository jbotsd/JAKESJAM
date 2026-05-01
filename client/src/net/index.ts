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
export { InterpolationBuffer } from "./interpolationBuffer.js";
