// VenueHost — the Venue's composer (docs/venue-design.md, venue-goal.md
// Pillar 1). Owns the pair of always-on worlds and the membrane between
// them; contains NO simulation of its own — both halves are ordinary
// MatchHosts, exactly the "thin wrapper" discipline WorldHost established:
//
//   lobby : MatchHost mode:"hangout", id "lobby" — the walkable antechamber.
//           Never recycles, never disposes on empty. Same hangout machinery
//           private rooms use (phase pinned to "fighting" so movement always
//           works, combat no-oped, totems resolved server-side).
//   arena : the existing WorldHost, untouched — always-on combat, recycles
//           per cycle, migrates sockets. Its lifecycle quirks stay its own.
//
// Auth: one world token (stateless HMAC, player-scoped — auth.ts) grants
// both halves; the lobby is exactly as open as the arena. This is the
// deliberate difference from private-room hangouts, whose tokens are
// room-membership-scoped (privateLobby.mintHangoutToken).
//
// Pillar 3 will teach this class the bell (ready queue drained at round
// boundaries); Pillar 1 is existence, honesty, and survival.

import type { ServerWebSocket } from "bun";
import { MatchHost, type MatchSocketData } from "./matchHost.ts";
import type { WorldHost } from "./worldHost.ts";
import { msUntilNextBell } from "@sim/round.ts";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";
import type { MapId } from "@sim/data/maps.ts";

export const VENUE_LOBBY_MATCH_ID = "lobby";

/** The lobby's fixed map. vessel-nexus is the one map with hand-tuned totem
 *  anchors today (totem.ts) — Pillar 2 gives the lobby its own space. */
const LOBBY_MAP_ID: MapId = "vessel-nexus";

const LOBBY_COLOR_PALETTE = [
  "#88ccff", "#ff88aa", "#ffd166", "#9bf6ff", "#a0e7a0",
  "#caa7ff", "#ff9f6b", "#ffe39b", "#9affd1", "#ff7676",
] as const;

function pickColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return LOBBY_COLOR_PALETTE[hash % LOBBY_COLOR_PALETTE.length]!;
}

export type VenueSummary = {
  lobby: {
    /** Connected lobby sockets — humans standing in the antechamber. */
    present: number;
  };
  arena: (ReturnType<MatchHost["summary"]> & { nextBellMs: number }) | null;
};

export class VenueHost {
  private readonly arenaHost: WorldHost;
  /** Eager-created: the venue's front door must never be a null world —
   *  an arriving avatar always lands somewhere (contrast WorldHost's
   *  lazy-boot, which predates the lobby-first landing). */
  private lobbyHost: MatchHost;
  /** Live lobby sockets by player — presence, honestly counted. */
  private readonly lobbySockets = new Map<PlayerId, ServerWebSocket<MatchSocketData>>();

  constructor(opts: { arena: WorldHost }) {
    this.arenaHost = opts.arena;
    this.lobbyHost = this.buildLobby();
  }

  /** The arena half — index.ts keeps routing /ws/world here unchanged. */
  get arena(): WorldHost {
    return this.arenaHost;
  }

  private buildLobby(): MatchHost {
    const host = new MatchHost(VENUE_LOBBY_MATCH_ID, [], [], LOBBY_MAP_ID, {
      mode: "hangout",
      // Totem SimEvents fire here (same hook privateLobby uses). The venue
      // lobby has no host-gate and no room bookkeeping — Pillar 3 maps
      // these to bell-queue enqueue/dequeue. Until then they're inert by
      // design, NOT an error: a walk-over does nothing yet.
      onSimEvent: () => {},
    });
    host.ensureTickLoop();
    return host;
  }

  // ── Lobby WS lifecycle (mirrors WorldHost.attach/route/detach shape so
  //    index.ts's handlers stay three symmetric branches) ────────────────

  attachLobby(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (!this.lobbyHost.hasPlayer(playerId)) {
      // Chosen name rides SocketData (index.ts adds it over MatchSocketData) —
      // same duck-read WorldHost.attach uses.
      const chosenName = (ws.data as { name?: string }).name;
      this.lobbyHost.addPlayer(this.spawnFor(ws.data.playerId, chosenName));
    }
    this.lobbySockets.set(playerId, ws);
    this.lobbyHost.attachClient(ws);
  }

  routeLobby(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    this.lobbyHost.routeMessage(ws, raw);
  }

  detachLobby(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (this.lobbySockets.get(playerId) === ws) this.lobbySockets.delete(playerId);
    this.lobbyHost.detachClient(ws);
    // Deliberately NO dispose-on-empty (the WorldHost discipline, applied
    // to the antechamber): the lobby is the venue's front room — it exists
    // whether or not anyone is standing in it, and it must survive every
    // arena recycle untouched (Pillar 1 acceptance #2).
  }

  /** Honest venue-wide summary — GET /venue/summary. Lobby presence is
   *  connected humans only; arena carries the human/bot split from Pillar
   *  0.1 plus the bell countdown (shared @sim/round.ts phase-sum math —
   *  the same numbers the death overlay shows). */
  summary(): VenueSummary {
    const arena = this.arenaHost.summary();
    return {
      lobby: { present: this.lobbySockets.size },
      arena: arena
        ? { ...arena, nextBellMs: Math.round(msUntilNextBell(arena.phase, arena.countdownRemainingMs)) }
        : null,
    };
  }

  /** Test/ops surface: object identity proves recycle-survival. */
  lobbyHostForTest(): MatchHost {
    return this.lobbyHost;
  }

  dispose(): void {
    this.lobbyHost.dispose();
  }

  private spawnFor(playerIdRaw: string, chosenName?: string): PlayerSpawnInfo {
    return {
      playerId: PlayerId(playerIdRaw),
      characterId: "balanced",
      name: chosenName ?? playerIdRaw,
      color: pickColor(playerIdRaw),
      weaponId: "starter-pistol",
    };
  }
}
