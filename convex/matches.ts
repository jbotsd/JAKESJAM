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
  shieldActive: v.optional(v.boolean()),
  shieldCharge: v.optional(v.number()),
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
      shieldActive: args.shieldActive ?? false,
      shieldCharge: args.shieldCharge ?? 0,
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

export const applyPlayerDamage = mutation({
  args: {
    matchId: v.id("matches"),
    roomId: v.id("rooms"),
    attackerPlayerId: v.string(),
    targetPlayerId: v.string(),
    damage: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.damage <= 0 || args.attackerPlayerId === args.targetPlayerId) {
      return;
    }

    const match = await ctx.db.get(args.matchId);
    if (!match || match.roomId !== args.roomId) {
      throw new Error("Match not found for this room.");
    }

    const [attacker, targetPlayer] = await Promise.all([
      ctx.db
        .query("roomPlayers")
        .withIndex("by_room_player", (q) => q.eq("roomId", args.roomId).eq("playerId", args.attackerPlayerId))
        .unique(),
      ctx.db
        .query("roomPlayers")
        .withIndex("by_room_player", (q) => q.eq("roomId", args.roomId).eq("playerId", args.targetPlayerId))
        .unique(),
    ]);

    if (!attacker || !targetPlayer) {
      throw new Error("Both players must be in this room.");
    }

    const snapshot = await ctx.db
      .query("matchPlayerSnapshots")
      .withIndex("by_match_player", (q) => q.eq("matchId", args.matchId).eq("playerId", args.targetPlayerId))
      .unique();

    if (!snapshot || !snapshot.alive) {
      return;
    }

    let health = snapshot.health;
    let shieldCharge = snapshot.shieldCharge ?? 0;
    const shieldActive = (snapshot.shieldActive ?? false) && shieldCharge > 0;

    if (shieldActive) {
      shieldCharge = Math.max(0, shieldCharge - args.damage * 1.8);
    } else {
      health = Math.max(0, health - args.damage);
    }

    await ctx.db.patch(snapshot._id, {
      health,
      shieldActive: shieldActive && shieldCharge > 0,
      shieldCharge,
      alive: health > 0,
      updatedAt: Date.now(),
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
