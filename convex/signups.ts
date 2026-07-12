import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Devlog funnel: "drop your email and you're playing in ~8 seconds".
 * The Bun game server proxies POST /api/signup here (server/src/index.ts)
 * — the browser never talks to Convex directly for signups, so the same
 * rate-limiting + IP hygiene as every other public endpoint applies.
 *
 * Idempotent per email: re-signups bump lastSeenAt/visits instead of
 * duplicating. The list is THE asset — export via `listAll` from the
 * dashboard or a scheduled job when Fight Night emails go out.
 */
export const record = mutation({
  args: { email: v.string(), source: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false as const, reason: "invalid_email" };
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("signups")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        visits: existing.visits + 1,
      });
      return { ok: true as const, isNew: false };
    }
    await ctx.db.insert("signups", {
      email,
      source: args.source.slice(0, 32),
      createdAt: now,
      lastSeenAt: now,
      visits: 1,
    });
    return { ok: true as const, isNew: true };
  },
});

/** Full list, newest first — for Fight Night sends and dashboard export. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("signups").collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        email: r.email,
        source: r.source,
        createdAt: r.createdAt,
        visits: r.visits,
      }));
  },
});
