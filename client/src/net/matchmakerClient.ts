// Thin wrapper over the Convex matchmaker.getMyMatchToken query. Returns the
// game server URL + per-player auth token. Use this once after the match doc
// reaches the "loading" status with a gameServerUrl assigned.
//
// Uses convex/browser (framework-free) instead of convex/react — this codebase
// is Phaser, not React, and convex/react would pull React in as a peer dep.

import type { ConvexClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export type MatchmakerAssignment = {
  gameServerUrl: string;
  region: string | null;
  token: string;
};

export async function fetchMatchAssignment(
  convex: ConvexClient,
  matchId: Id<"matches">,
  playerId: string,
): Promise<MatchmakerAssignment> {
  // VITE_GAME_SERVER_URL overrides the assigned URL (useful for local Bun dev).
  const override = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined) ?? null;
  const result = await convex.query(api.matchmaker.getMyMatchToken, {
    matchId,
    playerId,
  });
  return {
    gameServerUrl: override ?? result.gameServerUrl,
    region: result.region,
    token: result.token,
  };
}

export function buildGameServerWsUrl(assignment: MatchmakerAssignment, matchId: string): string {
  const url = new URL(assignment.gameServerUrl);
  url.searchParams.set("matchId", matchId);
  url.searchParams.set("token", assignment.token);
  return url.toString();
}
