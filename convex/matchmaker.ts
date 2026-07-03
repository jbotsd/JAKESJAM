// Matchmaker — assigns a Bun game server URL to a match and mints per-player
// auth tokens. See docs/netcode-architecture.md "Convex Integration".
//
// Region picking is deliberately dumb for now: the match doc records whatever
// the host requests (or "sin" by default). Add latency-aware routing later.

import { v } from "convex/values";
import { query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Convex runtime exposes process.env for env vars set via `npx convex env set`.
// The @types/node package is not in this workspace, so declare the slim shape
// we actually use here.
declare const process: { env: Record<string, string | undefined> };

// Only `sin` is deployed today. `sjc` and `fra` are placeholders in the
// roadmap; re-add them here AND deploy the matching Fly apps in lockstep,
// otherwise pickGameServerUrl will hand clients dead URLs.
export const GAME_REGIONS = ["sin"] as const;
export type GameRegion = typeof GAME_REGIONS[number];

const GAME_SERVERS = {
  sin: "wss://jakesjam-srv-sin.fly.dev/ws",
} as const satisfies Record<GameRegion, string>;

const DEFAULT_REGION: GameRegion = "sin";

export function pickGameServerUrl(requestedRegion: string | undefined): {
  region: string;
  url: string;
} {
  // Self-hosted override: when GAME_SERVER_URL_OVERRIDE is set on this
  // deployment, ALL matches route to it regardless of requested region.
  // Used to host matches from a home PC (tunnel or port-forward) instead
  // of the Fly fleet:
  //   npx convex env set GAME_SERVER_URL_OVERRIDE wss://<public-host>/ws
  //   npx convex env remove GAME_SERVER_URL_OVERRIDE   # back to Fly
  // scripts/host-public.sh manages this automatically.
  const override = process.env.GAME_SERVER_URL_OVERRIDE;
  if (override) {
    return { region: "home", url: override };
  }
  const region: GameRegion =
    requestedRegion && (GAME_REGIONS as readonly string[]).includes(requestedRegion)
      ? (requestedRegion as GameRegion)
      : DEFAULT_REGION;
  return { region, url: GAME_SERVERS[region] ?? "" };
}

/**
 * Assign a game server to a match. Called from rooms.startMatch.
 * Patches the match document with gameServerUrl + region.
 */
export async function assignGameServer(
  ctx: MutationCtx,
  matchId: Id<"matches">,
  requestedRegion: string | undefined,
): Promise<{ region: string; url: string }> {
  const assignment = pickGameServerUrl(requestedRegion);
  await ctx.db.patch(matchId, {
    gameServerUrl: assignment.url,
    region: assignment.region,
  });
  return assignment;
}

/**
 * Per-player auth token for the WebSocket upgrade. The Bun server validates
 * this same HMAC with its copy of GAME_SERVER_SECRET to confirm the connector
 * was issued the right to join this match as this player.
 *
 * Token format: `${matchId}.${playerId}.${base64(HMAC-SHA256)}`
 */
export const getMyMatchToken = query({
  args: {
    matchId: v.id("matches"),
    playerId: v.string(),
  },
  handler: async (ctx, args) => {
    const match = await ctx.db.get(args.matchId);
    if (!match) {
      throw new Error("Match not found.");
    }
    // Confirm the player is in this match's room (cheap auth).
    const roomPlayer = await ctx.db
      .query("roomPlayers")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", match.roomId).eq("playerId", args.playerId),
      )
      .unique();
    if (!roomPlayer) {
      throw new Error("Player is not in this match's room.");
    }
    if (!match.gameServerUrl) {
      throw new Error("Match has not been assigned a game server yet.");
    }

    const token = await mintToken(args.matchId, args.playerId);
    return {
      gameServerUrl: match.gameServerUrl,
      region: match.region ?? null,
      token,
    };
  },
});

async function mintToken(matchId: string, playerId: string): Promise<string> {
  const secret = process.env.GAME_SERVER_SECRET ?? "dev-insecure-secret";
  const message = `${matchId}.${playerId}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  const sigBase64 = bytesToBase64(new Uint8Array(signature));
  return `${message}.${sigBase64}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}
