import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { CHAOS_MODIFIER_IDS } from "./chaosIds";

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

// Validator derived from the shared list in convex/chaosIds.ts. A parity
// test in client/src/sim/__tests__/chaosIdsParity.test.ts asserts the
// convex copy stays in lockstep with the sim list. Adding a modifier here
// means appending to BOTH chaosIds.ts (this dir) AND
// client/src/sim/data/chaosModifiers.ts.
export const chaosModifierId = v.union(
  ...(CHAOS_MODIFIER_IDS.map((id) => v.literal(id)) as unknown as [
    ReturnType<typeof v.literal<string>>,
    ReturnType<typeof v.literal<string>>,
    ...ReturnType<typeof v.literal<string>>[],
  ]),
);

// Vessel Creator's 5 cosmetic channels (docs/vessel-creator-design.md §3) —
// shared between the roomPlayers table below and convex/rooms.ts's
// playerArgs so the wire shape only lives in one place.
export const cosmeticsValidator = v.optional(
  v.object({
    accentColor: v.optional(v.string()),
    visorColor: v.optional(v.string()),
    palmColor: v.optional(v.string()),
    jointColor: v.optional(v.string()),
    auraColor: v.optional(v.string()),
  }),
);

export default defineSchema({
  // Devlog funnel list (convex/signups.ts): email → play. One row per
  // email; re-signups bump lastSeenAt/visits.
  signups: defineTable({
    email: v.string(),
    source: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    visits: v.number(),
  }).index("by_email", ["email"]),

  rooms: defineTable({
    code: v.string(),
    hostPlayerId: v.string(),
    status: roomStatus,
    maxPlayers: v.number(),
    chaosModifierIds: v.optional(v.array(chaosModifierId)),
    /**
     * Host's selected map id for the next match. Optional + additive —
     * older rooms with no selection inherit the default at startMatch time.
     */
    selectedMapId: v.optional(v.string()),
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
    cosmetics: cosmeticsValidator,
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
    chaosModifierIds: v.optional(v.array(chaosModifierId)),
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
    /**
     * Storage ID of the replay blob (input log + RNG seed + protocol version)
     * uploaded by the game server at match-end. Per replay-spectator SKILL:
     * cold blob, never queried during the live sim. Use `getReplayUrl` to
     * generate a signed download URL when a viewer wants playback.
     */
    replayStorageId: v.optional(v.id("_storage")),
  }).index("by_room", ["roomId"]),

  matchResults: defineTable({
    matchId: v.id("matches"),
    roomId: v.id("rooms"),
    winnerPlayerId: v.string(),
    finalScores: v.record(v.string(), v.number()),
    roundsPlayed: v.number(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),
});
