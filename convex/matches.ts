import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Tiny match summary lookup so the Bun game server can resolve the `roomId`
 * (and current status) for a given matchId. The WebSocket auth flow only
 * conveys the matchId; the server needs the roomId to call
 * `recordMatchResult`. Returns `null` if the match was deleted.
 */
export const getMatchSummary = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) return null;
    return {
      matchId: match._id,
      roomId: match.roomId,
      status: match.status,
      roundIndex: match.roundIndex,
      chaosModifierIds: match.chaosModifierIds ?? [],
    };
  },
});

/**
 * Record the final result of a match. Called from the Bun game server via the
 * Convex HTTP API once `sim/round.ts` signals `matchComplete`.
 *
 * Idempotent: if the match is already `complete` (or already has a result row
 * in `matchResults`) this is a no-op so retries from the server are safe.
 */
export const recordMatchResult = mutation({
  args: {
    matchId: v.id("matches"),
    roomId: v.id("rooms"),
    winnerPlayerId: v.union(v.string(), v.null()),
    finalScores: v.record(v.string(), v.number()),
    roundsPlayed: v.number(),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match || match.roomId !== args.roomId) {
      throw new Error("Match not found for this room.");
    }

    const existing = await ctx.db
      .query("matchResults")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    const alreadyRecorded = existing.some((row) => row.matchId === args.matchId);

    if (match.status === "complete" && alreadyRecorded) {
      return { recorded: false, reason: "already-complete" as const };
    }

    if (!alreadyRecorded) {
      await ctx.db.insert("matchResults", {
        matchId: args.matchId,
        roomId: args.roomId,
        // Schema requires a string winner; coerce a draw (null) to empty string.
        winnerPlayerId: args.winnerPlayerId ?? "",
        finalScores: args.finalScores,
        roundsPlayed: args.roundsPlayed,
        createdAt: Date.now(),
      });
    }

    if (match.status !== "complete") {
      await ctx.db.patch(args.matchId, {
        status: "complete",
        completedAt: Date.now(),
      });
    }

    // Reset the room so it can host another match. Without this, the room
    // stays in "in_match" with currentMatchId pointing at the dead match —
    // startMatch's idempotency guard then returns the dead matchId forever
    // and players have to leave-and-rejoin to play again.
    const room = await ctx.db.get(args.roomId);
    if (room && room.status === "in_match" && room.currentMatchId === args.matchId) {
      await ctx.db.patch(args.roomId, {
        status: "lobby",
        currentMatchId: undefined,
        updatedAt: Date.now(),
      });
      const players = await ctx.db
        .query("roomPlayers")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect();
      for (const p of players) {
        if (p.ready) await ctx.db.patch(p._id, { ready: false });
      }
    }

    return { recorded: !alreadyRecorded, reason: "ok" as const };
  },
});
