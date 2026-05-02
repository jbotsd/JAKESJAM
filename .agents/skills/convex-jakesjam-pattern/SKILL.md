---
name: convex-jakesjam-pattern
description: >
  Concrete templates for adding Convex queries, mutations, and actions
  against JAKESJAM's actual schema (rooms, roomPlayers, matches,
  matchResults, chatMessages). Use when editing anything under
  convex/, when adding a new Convex function, when wiring a frontend
  Convex hook, or whenever the user says "lobby", "room", "match
  result", "chat", "matchmaker", "convex query".
version: 1.0.0
---

# Convex — JAKESJAM Pattern

## Why this skill exists

The general `convex-quickstart` skill teaches Convex broadly. This
skill is JAKESJAM-specific: real table names, real index names, real
constraints. Saves you from inventing tables that don't exist.

## The schema (single source of truth)

Read first: `convex/schema.ts`. Tables and their indices:

| Table | Key fields | Indices |
|---|---|---|
| `rooms` | `code`, `hostPlayerId`, `status` (lobby/starting/in_match/complete), `maxPlayers`, `chaosModifierIds[]`, `selectedMapId`, `currentMatchId?` | `by_code` |
| `roomPlayers` | `roomId`, `playerId`, `name`, `color`, `characterId`, `ready`, `connected`, `joinedAt`, `lastSeenAt` | `by_room`, `by_room_player` |
| `matches` | `roomId`, `status` (loading/active/draft/complete), `mapId`, `targetScore`, `roundIndex`, `scores` (record), `gameServerUrl?`, `region?` | `by_room` |
| `matchResults` | `matchId`, `roomId`, `winnerPlayerId`, `finalScores`, `roundsPlayed` | `by_room` |
| `chatMessages` | `roomId`, `playerId`, `message`, `createdAt` | `by_room` |

**Always use indices.** Never `db.query("rooms").collect()` — that
scans the whole table. Use `withIndex("by_code", q => q.eq("code", x))`.

## Query template

```ts
// convex/rooms.ts
import { v } from "convex/values";
import { query } from "./_generated/server";

export const getRoomByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    return await ctx.db
      .query("rooms")
      .withIndex("by_code", q => q.eq("code", code))
      .unique(); // throws if >1 — desired for unique codes
  },
});
```

Frontend (Convex React hook):

```ts
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const room = useQuery(api.rooms.getRoomByCode, { code });
// room is undefined while loading, null if not found
```

## Mutation template

```ts
// convex/rooms.ts
import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const setReady = mutation({
  args: {
    roomId: v.id("rooms"),
    playerId: v.string(),
    ready: v.boolean(),
  },
  handler: async (ctx, { roomId, playerId, ready }) => {
    const player = await ctx.db
      .query("roomPlayers")
      .withIndex("by_room_player", q => q.eq("roomId", roomId).eq("playerId", playerId))
      .unique();
    if (!player) throw new Error("player not in room");
    await ctx.db.patch(player._id, { ready, lastSeenAt: Date.now() });
  },
});
```

## Action template (for external HTTP, e.g. matchmaker → Fly URL)

```ts
// convex/matchmaker.ts
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";

export const assignServer = action({
  args: { matchId: v.id("matches"), region: v.union(v.literal("syd"), v.literal("sjc"), v.literal("fra")) },
  handler: async (ctx, { matchId, region }) => {
    const url = `https://jakesjam-srv-${region}.fly.dev`;
    await ctx.runMutation(internal.matches.setGameServerUrl, { matchId, url, region });
    return { url };
  },
});
```

Note: actions cannot read/write the DB directly — they call queries/
mutations via `ctx.runQuery` / `ctx.runMutation`.

## Idempotent writes (game results)

`recordMatchResult` is the canonical pattern: results may arrive twice
from the game server on retry. Always check before insert:

```ts
export const recordMatchResult = mutation({
  args: { matchId: v.id("matches"), winnerPlayerId: v.string(), finalScores: v.record(v.string(), v.number()), roundsPlayed: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("matchResults")
      .withIndex("by_room")
      .filter(q => q.eq(q.field("matchId"), args.matchId))
      .unique()
      .catch(() => null);
    if (existing) return { duplicate: true };
    const match = await ctx.db.get(args.matchId);
    if (!match) throw new Error("match not found");
    await ctx.db.insert("matchResults", { ...args, roomId: match.roomId });
    await ctx.db.patch(args.matchId, { status: "complete", completedAt: Date.now() });
    return { duplicate: false };
  },
});
```

## Validators (always-required)

Every public function MUST declare `args: v.object({...})`. No
unvalidated inputs. The `v.id("table")` validator narrows to that
table's ID type — use it for foreign keys.

## Branded IDs in shared code

The frontend uses branded IDs (per `ts-pocock`). When passing IDs from
React → Convex, the brand strips at the boundary. Convex's `Id<"rooms">`
is the source of truth on the backend; on the frontend treat it as a
nominal string.

## Common gotchas

- **`.unique()` throws** if 0 or >1 results. Use `.first()` for "or null".
- **Mutations are atomic per call but NOT across calls.** A
  read-modify-write that spans two `mutation` invocations races. Put
  the whole pattern inside one mutation.
- **Subscriptions amplify reads.** A `useQuery` that scans 5000 rows
  re-runs on every dependent write. Audit before shipping with
  `convex-performance-audit`.
- **Schema changes need migration plans** for existing data. Read
  `convex-migration-helper` before changing field types or removing
  fields.

## Verification after Convex changes

```bash
cd /mnt/pulsechain-sata/Projects/oddpromts/gamejam/thegame/JAKESJAM
npx convex dev --once
```

Validates schema and pushes functions to your dev deployment. Failures
print at type-check time.
