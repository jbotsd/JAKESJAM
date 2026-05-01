import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assignGameServer } from "./matchmaker";

const MAX_PLAYERS = 10;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

const playerArgs = {
  playerId: v.string(),
  name: v.string(),
  color: v.string(),
  characterId: v.string(),
};

const roomSettingsArgs = {
  chaosModifierIds: v.array(v.string()),
};

export const create = mutation({
  args: {
    ...playerArgs,
    ...roomSettingsArgs,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const code = await generateUniqueRoomCode(ctx);
    const roomId = await ctx.db.insert("rooms", {
      code,
      hostPlayerId: args.playerId,
      status: "lobby",
      maxPlayers: MAX_PLAYERS,
      chaosModifierIds: cleanChaosModifierIds(args.chaosModifierIds),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("roomPlayers", {
      roomId,
      playerId: args.playerId,
      name: cleanName(args.name),
      color: args.color,
      characterId: args.characterId,
      ready: false,
      connected: true,
      joinedAt: now,
      lastSeenAt: now,
    });

    return { roomId, code, playerId: args.playerId };
  },
});

export const updateSettings = mutation({
  args: {
    roomId: v.id("rooms"),
    playerId: v.string(),
    ...roomSettingsArgs,
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.hostPlayerId !== args.playerId) {
      throw new Error("Only the host can change game modifiers.");
    }
    if (room.status !== "lobby") {
      throw new Error("Room settings are locked after match start.");
    }

    await ctx.db.patch(args.roomId, {
      chaosModifierIds: cleanChaosModifierIds(args.chaosModifierIds),
      updatedAt: Date.now(),
    });
  },
});

export const join = mutation({
  args: {
    code: v.string(),
    ...playerArgs,
  },
  handler: async (ctx, args) => {
    const room = await getRoomByCode(ctx, args.code);
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.status !== "lobby") {
      throw new Error("Room is not accepting new players.");
    }

    const now = Date.now();
    const existingPlayer = await getRoomPlayer(ctx, room._id, args.playerId);
    if (existingPlayer) {
      await ctx.db.patch(existingPlayer._id, {
        name: cleanName(args.name),
        color: args.color,
        characterId: args.characterId,
        connected: true,
        lastSeenAt: now,
      });
      return { roomId: room._id, code: room.code, playerId: args.playerId };
    }

    const players = await getPlayers(ctx, room._id);
    if (players.length >= room.maxPlayers) {
      throw new Error("Room is full.");
    }

    await ctx.db.insert("roomPlayers", {
      roomId: room._id,
      playerId: args.playerId,
      name: cleanName(args.name),
      color: args.color,
      characterId: args.characterId,
      ready: false,
      connected: true,
      joinedAt: now,
      lastSeenAt: now,
    });
    await ctx.db.patch(room._id, { updatedAt: now });

    return { roomId: room._id, code: room.code, playerId: args.playerId };
  },
});

export const getById = query({
  args: {
    roomId: v.id("rooms"),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) {
      return null;
    }
    const players = await getPlayers(ctx, args.roomId);
    return { room, players };
  },
});

export const getByCode = query({
  args: {
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const room = await getRoomByCode(ctx, args.code);
    if (!room) {
      return null;
    }
    const players = await getPlayers(ctx, room._id);
    return { room, players };
  },
});

export const setReady = mutation({
  args: {
    roomId: v.id("rooms"),
    playerId: v.string(),
    ready: v.boolean(),
  },
  handler: async (ctx, args) => {
    const player = await getRoomPlayer(ctx, args.roomId, args.playerId);
    if (!player) {
      throw new Error("Player is not in this room.");
    }
    await ctx.db.patch(player._id, {
      ready: args.ready,
      lastSeenAt: Date.now(),
    });
  },
});

export const heartbeat = mutation({
  args: {
    roomId: v.id("rooms"),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await getRoomPlayer(ctx, args.roomId, args.playerId);
    if (!player) {
      return;
    }
    await ctx.db.patch(player._id, {
      connected: true,
      lastSeenAt: Date.now(),
    });
  },
});

export const leave = mutation({
  args: {
    roomId: v.id("rooms"),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await getRoomPlayer(ctx, args.roomId, args.playerId);
    if (!player) {
      return;
    }
    await ctx.db.patch(player._id, {
      ready: false,
      connected: false,
      lastSeenAt: Date.now(),
    });
  },
});

export const startMatch = mutation({
  args: {
    roomId: v.id("rooms"),
    playerId: v.string(),
    region: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throw new Error("Room not found.");
    }
    if (room.hostPlayerId !== args.playerId) {
      throw new Error("Only the host can start the match.");
    }
    if (room.status !== "lobby") {
      throw new Error("Room has already moved out of lobby.");
    }

    const players = await getPlayers(ctx, args.roomId);
    if (players.length < 1) {
      throw new Error("Need at least one player.");
    }
    if (!players.every((player) => player.ready)) {
      throw new Error("Every player must be ready.");
    }

    const now = Date.now();
    const scores = Object.fromEntries(players.map((player) => [player.playerId, 0]));
    const matchId = await ctx.db.insert("matches", {
      roomId: args.roomId,
      status: "loading",
      mapId: "boxworks",
      targetScore: 3,
      roundIndex: 0,
      scores,
      startedAt: now,
    });

    await assignGameServer(ctx, matchId, args.region);

    await ctx.db.patch(args.roomId, {
      status: "in_match",
      currentMatchId: matchId,
      updatedAt: now,
    });

    return matchId;
  },
});

async function generateUniqueRoomCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generateRoomCode();
    const existing = await getRoomByCode(ctx, code);
    if (!existing) {
      return code;
    }
  }
  throw new Error("Could not allocate a room code.");
}

function generateRoomCode(): string {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const characterIndex = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[characterIndex];
  }
  return code;
}

async function getRoomByCode(
  ctx: QueryCtx | MutationCtx,
  rawCode: string,
): Promise<Doc<"rooms"> | null> {
  const code = normalizeCode(rawCode);
  return await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

async function getRoomPlayer(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  playerId: string,
): Promise<Doc<"roomPlayers"> | null> {
  return await ctx.db
    .query("roomPlayers")
    .withIndex("by_room_player", (q) => q.eq("roomId", roomId).eq("playerId", playerId))
    .unique();
}

async function getPlayers(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
): Promise<Doc<"roomPlayers">[]> {
  const players = await ctx.db
    .query("roomPlayers")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();

  return players.sort((a, b) => a.joinedAt - b.joinedAt);
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  return trimmed.slice(0, 24) || "Player";
}

function cleanChaosModifierIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
