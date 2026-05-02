// Replay persistence — stores the input log + RNG seed bundle that the
// Bun game server's ReplayRecorder emits at match-end. Per
// .agents/skills/replay-spectator/SKILL.md: cold blob in Convex storage,
// not a live table; never queried from the 60Hz path.

import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Action invoked by the game server (Bun MatchHost.postMatchResult) to
 * upload the replay blob after a match ends. Writes to Convex storage,
 * then patches the match doc with the resulting storage id.
 */
export const saveReplay = action({
  args: {
    matchId: v.id("matches"),
    bytes: v.bytes(),
  },
  handler: async (ctx, { matchId, bytes }) => {
    const blob = new Blob([bytes]);
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.replays.recordReplayId, {
      matchId,
      storageId,
    });
    return { storageId };
  },
});

/** Internal — only called from the saveReplay action above. */
export const recordReplayId = internalMutation({
  args: {
    matchId: v.id("matches"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { matchId, storageId }) => {
    const match = await ctx.db.get(matchId);
    if (!match) return; // match was deleted between save and record — fine
    if (match.replayStorageId) {
      // Idempotency: if a replay was already recorded, drop the duplicate
      // bytes from storage to avoid orphans (the older one wins; reuploading
      // is not a supported workflow yet).
      await ctx.storage.delete(storageId);
      return;
    }
    await ctx.db.patch(matchId, { replayStorageId: storageId });
  },
});

/**
 * Public — returns a short-lived signed URL for downloading the replay
 * blob. Callers fetch the bytes themselves and feed them to the client
 * playReplay loader.
 */
export const getReplayUrl = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const match = await ctx.db.get(matchId);
    if (!match || !match.replayStorageId) return null;
    return await ctx.storage.getUrl(match.replayStorageId);
  },
});
