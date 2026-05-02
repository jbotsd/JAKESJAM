// Tracks active MatchHost instances by matchId. A MatchHost is created lazily
// when the first authenticated client for that match connects. It tears down
// when the last client disconnects.

import type { ServerWebSocket } from "bun";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";
import {
  MatchHost,
  type MatchSocketData,
} from "./matchHost.ts";
import { convexClient, type ConvexId } from "./convexClient.ts";

export class MatchRegistry {
  private readonly matches = new Map<string, MatchHost>();

  async attach(ws: ServerWebSocket<MatchSocketData>): Promise<void> {
    const { matchId, playerId: rawPlayerId } = ws.data;
    const playerId = PlayerId(rawPlayerId);
    let host = this.matches.get(matchId);
    if (!host) {
      // Fetch the match summary from Convex to recover the room's chaos modifiers
      // and map selection. The matchId-only token from the WebSocket handshake
      // needs the roomId to look up the full match context.
      const summary =
        (await convexClient.getMatchSummary(matchId as ConvexId)) ?? null;
      const chaosModifierIds = summary?.chaosModifierIds ?? [];
      const mapId = summary?.mapId ?? undefined;
      host = new MatchHost(
        matchId,
        [
          {
            playerId,
            characterId: "balanced",
            name: rawPlayerId,
            color: "#88ccff",
            weaponId: "starter-pistol",
          },
        ],
        chaosModifierIds,
        mapId,
      );
      this.matches.set(matchId, host);
    } else if (!host.hasPlayer(playerId)) {
      // Brand-new player joining an existing match.
      host.addPlayer({
        playerId,
        characterId: "balanced",
        name: rawPlayerId,
        color: pickColor(rawPlayerId),
        weaponId: "starter-pistol",
      });
    }
    // Else: returning player, possibly mid-grace-window. attachClient handles
    // clearing the disconnect timer and resending hello + a fresh snapshot.
    host.attachClient(ws);
  }

  route(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    const host = this.matches.get(ws.data.matchId);
    if (!host) {
      ws.close(1011, "no match");
      return;
    }
    host.routeMessage(ws, raw);
  }

  detach(ws: ServerWebSocket<MatchSocketData>): void {
    const host = this.matches.get(ws.data.matchId);
    if (!host) return;
    host.detachClient(ws);
    // Keep the host alive while any player is in their reconnect grace
    // window — their entity is still in the world and they may yet come back.
    // Once both clients and pending-disconnects are zero, we can truly evict.
    if (!host.hasClients() && !host.hasPendingDisconnects()) {
      this.matches.delete(ws.data.matchId);
    }
  }

  size(): number {
    return this.matches.size;
  }

  /** Public summary list — surfaced through /health for the room status badge. */
  summaries(): ReturnType<MatchHost["summary"]>[] {
    return Array.from(this.matches.values()).map((host) => host.summary());
  }

  summaryFor(matchId: string): ReturnType<MatchHost["summary"]> | null {
    const host = this.matches.get(matchId);
    return host ? host.summary() : null;
  }
}

const COLOR_PALETTE = [
  "#88ccff",
  "#ff88aa",
  "#ffd166",
  "#9bf6ff",
  "#a0e7a0",
  "#caa7ff",
  "#ff9f6b",
  "#ffe39b",
  "#9affd1",
  "#ff7676",
];

function pickColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return COLOR_PALETTE[hash % COLOR_PALETTE.length]!;
}
