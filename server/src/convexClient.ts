// Thin wrapper around `ConvexHttpClient` (from `convex/browser`) so the Bun
// game server can write match-lifecycle events back to Convex without holding
// a reactive WebSocket open. See docs/netcode-architecture.md →
// "Convex Integration".
//
// Auth: if `CONVEX_DEPLOY_KEY` (or legacy `CONVEX_ADMIN_TOKEN`) is set we pass
// it as the bearer; otherwise we fall back to an unauthenticated client, which
// is fine for `npx convex dev --local`. Idempotency (don't double-post a
// result) is enforced *both* in `recordMatchResult` server-side AND by the
// per-match flag in `MatchHost`, but per-host throttling is the cheap first
// line of defense.

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { config } from "./config.ts";

// Convex Id<TableName> at runtime is just a string. The server only needs the
// string form to round-trip through HTTP — we deliberately don't import from
// `convex/_generated/dataModel` to avoid pulling the whole convex/ tree into
// the server's TypeScript graph (which has stricter compiler options than
// convex/tsconfig.json).
export type ConvexId = string & { __isConvexId?: never };

export type RecordMatchResultArgs = {
  matchId: ConvexId;
  roomId: ConvexId;
  winnerPlayerId: string | null;
  finalScores: Record<string, number>;
  roundsPlayed: number;
};

export type MatchSummary = {
  matchId: ConvexId;
  roomId: ConvexId;
  status: "loading" | "active" | "draft" | "complete";
  roundIndex: number;
  /** Map id chosen by the host at room start. Forwarded to MatchHost. */
  mapId?: string;
  /** Chaos modifier ids selected for this match. Optional / additive. */
  chaosModifierIds?: string[];
};

// Function references keyed by `"<module>:<exportName>"`. Schema for these is
// asserted via the typed args below; the canonical signatures live in
// `convex/matches.ts`.
const matchesGetSummaryRef = makeFunctionReference<
  "query",
  { matchId: ConvexId },
  MatchSummary | null
>("matches:getMatchSummary");

const matchesRecordMatchResultRef = makeFunctionReference<
  "mutation",
  RecordMatchResultArgs,
  { recorded: boolean; reason: string }
>("matches:recordMatchResult");

export class ConvexClient {
  private readonly client: ConvexHttpClient | null;
  private warnedMissingUrl = false;

  constructor(url: string | null, deployKey: string | null) {
    if (!url) {
      this.client = null;
      console.warn(
        "[convex] CONVEX_URL not set — match-lifecycle writes to Convex are disabled.",
      );
      this.warnedMissingUrl = true;
      return;
    }
    this.client = new ConvexHttpClient(url, {
      // Self-hosted / local-dev Convex backends use non-cloud URLs.
      skipConvexDeploymentUrlCheck: true,
    });
    if (deployKey) {
      this.client.setAuth(deployKey);
    } else {
      console.warn(
        "[convex] CONVEX_DEPLOY_KEY not set — calling mutations unauthenticated. OK for local dev.",
      );
    }
  }

  /**
   * Look up the `roomId` (and current status) for a given matchId. The Bun
   * server only learns matchId from the WS upgrade; we need roomId to call
   * `recordMatchResult`. Returns null on lookup failure or if Convex isn't
   * configured.
   */
  async getMatchSummary(matchId: ConvexId): Promise<MatchSummary | null> {
    if (!this.client) return null;
    try {
      const result = await this.client.query(matchesGetSummaryRef, {
        matchId,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[convex] getMatchSummary FAILED matchId=${matchId}: ${message}`,
      );
      return null;
    }
  }

  /**
   * Post the final match result and flip the match doc to `complete`. Safe to
   * call more than once: the underlying mutation is idempotent (see
   * `convex/matches.ts → recordMatchResult`). Errors are logged but never
   * thrown — the caller is on the sim hot loop.
   *
   * @returns true if the request resolved (regardless of `recorded` flag),
   *          false if it failed or was skipped because Convex isn't configured.
   */
  async recordMatchResult(args: RecordMatchResultArgs): Promise<boolean> {
    if (!this.client) {
      if (!this.warnedMissingUrl) {
        console.warn("[convex] skipping recordMatchResult — no CONVEX_URL");
        this.warnedMissingUrl = true;
      }
      return false;
    }
    try {
      const result = await this.client.mutation(matchesRecordMatchResultRef, {
        matchId: args.matchId,
        roomId: args.roomId,
        winnerPlayerId: args.winnerPlayerId,
        finalScores: args.finalScores,
        roundsPlayed: args.roundsPlayed,
      });
      console.log(
        `[convex] recordMatchResult ok matchId=${args.matchId} winner=${args.winnerPlayerId ?? "draw"} rounds=${args.roundsPlayed} result=${JSON.stringify(result)}`,
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[convex] recordMatchResult FAILED matchId=${args.matchId}: ${message}`,
      );
      return false;
    }
  }
}

// Module-level singleton — one HTTP client per server process is fine.
export const convexClient = new ConvexClient(
  config.convexUrl,
  config.convexDeployKey,
);
