import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const snapshotArgs = {
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
  sequence: v.number(),
};

export const submitPlayerSnapshot = mutation({
  args: snapshotArgs,
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match || match.roomId !== args.roomId) {
      throw new Error("Match not found for this room.");
    }

    const roomPlayer = await ctx.db
      .query("roomPlayers")
      .withIndex("by_room_player", (q) => q.eq("roomId", args.roomId).eq("playerId", args.playerId))
      .unique();

    if (!roomPlayer) {
      throw new Error("Player is not in this room.");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("matchPlayerSnapshots")
      .withIndex("by_match_player", (q) => q.eq("matchId", args.matchId).eq("playerId", args.playerId))
      .unique();

    const snapshot = {
      roomId: args.roomId,
      playerId: args.playerId,
      position: args.position,
      velocity: args.velocity,
      aimAngle: args.aimAngle,
      health: args.health,
      alive: args.alive,
      crouching: args.crouching,
      sequence: args.sequence,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, snapshot);
      return;
    }

    await ctx.db.insert("matchPlayerSnapshots", {
      matchId: args.matchId,
      ...snapshot,
    });
  },
});

export const getPlayerSnapshots = query({
  args: {
    matchId: v.id("matches"),
  },
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query("matchPlayerSnapshots")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .collect();

    return snapshots.sort((a, b) => a.playerId.localeCompare(b.playerId));
  },
});
