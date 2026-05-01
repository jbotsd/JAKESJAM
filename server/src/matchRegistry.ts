// Tracks active MatchHost instances by matchId. A MatchHost is created lazily
// when the first authenticated client for that match connects. It tears down
// when the last client disconnects.

import type { ServerWebSocket } from "bun";
import type { PlayerSpawnInfo } from "@sim/types.ts";
import { MatchHost, type MatchSocketData } from "./matchHost.ts";

export class MatchRegistry {
  private readonly matches = new Map<string, MatchHost>();

  attach(ws: ServerWebSocket<MatchSocketData>): void {
    const { matchId, playerId } = ws.data;
    let host = this.matches.get(matchId);
    if (!host) {
      // For now spawn a 1-player placeholder roster on first connect. When the
      // server pulls the real match roster from Convex (next iteration), this
      // becomes a real lookup with all expected players preregistered.
      host = new MatchHost(matchId, [
        {
          playerId,
          characterId: "balanced",
          name: playerId,
          color: "#88ccff",
          weaponId: "starter-pistol",
        },
      ]);
      this.matches.set(matchId, host);
    } else {
      // Late-joining player: not yet preregistered. Until Convex roster fetch
      // is in, just decline so we don't desync the World's player set.
      // TODO: rejoin path that diffs roster from Convex.
    }
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
    if (!host.hasClients()) {
      this.matches.delete(ws.data.matchId);
    }
  }

  size(): number {
    return this.matches.size;
  }
}
