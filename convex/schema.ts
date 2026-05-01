import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const roomStatus = v.union(
  v.literal("lobby"),
  v.literal("starting"),
  v.literal("in_match"),
  v.literal("complete"),
);

const matchStatus = v.union(
  v.literal("loading"),
  v.literal("active"),
  v.literal("draft"),
  v.literal("complete"),
);

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    hostPlayerId: v.string(),
    status: roomStatus,
    maxPlayers: v.number(),
    chaosModifierIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
    currentMatchId: v.optional(v.id("matches")),
  }).index("by_code", ["code"]),

  roomPlayers: defineTable({
    roomId: v.id("rooms"),
    playerId: v.string(),
    name: v.string(),
    color: v.string(),
    characterId: v.string(),
    ready: v.boolean(),
    connected: v.boolean(),
    joinedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_player", ["roomId", "playerId"]),

  matches: defineTable({
    roomId: v.id("rooms"),
    status: matchStatus,
    mapId: v.string(),
    targetScore: v.number(),
    roundIndex: v.number(),
    scores: v.record(v.string(), v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    // Dedicated game server assignment — see docs/netcode-architecture.md.
    // Clients open a WebSocket to gameServerUrl, supplying a per-player token
    // fetched from matchmaker.getMyMatchToken. The Bun game server validates
    // the token (HMAC-SHA256 of matchId.playerId against GAME_SERVER_SECRET)
    // before upgrading the connection.
    gameServerUrl: v.optional(v.string()),
    region: v.optional(v.string()),
  }).index("by_room", ["roomId"]),

  matchPlayerSnapshots: defineTable({
    matchId: v.id("matches"),
    roomId: v.id("rooms"),
    playerId: v.string(),
    position: v.object({
      x: v.number(),
      y: v.number(),
    }),
    velocity: v.object({
      x: v.number(),
      y: v.number(),
    }),
    aimAngle: v.number(),
    health: v.number(),
    alive: v.boolean(),
    crouching: v.boolean(),
    shieldActive: v.optional(v.boolean()),
    shieldCharge: v.optional(v.number()),
    sequence: v.number(),
    updatedAt: v.number(),
  })
    .index("by_match", ["matchId"])
    .index("by_match_player", ["matchId", "playerId"]),

  matchResults: defineTable({
    matchId: v.id("matches"),
    roomId: v.id("rooms"),
    winnerPlayerId: v.string(),
    finalScores: v.record(v.string(), v.number()),
    roundsPlayed: v.number(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  chatMessages: defineTable({
    roomId: v.id("rooms"),
    playerId: v.string(),
    message: v.string(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),
});
