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
import { resolveVenueTotems } from "@sim/totem.ts";
import { resolveMap } from "@sim/data/maps.ts";
import { PlayerId, type DestructibleDefinition, type MapDefinition, type PlayerSpawnInfo } from "@sim/types.ts";
import type { MapId } from "@sim/data/maps.ts";
import { decodeMessage, encodeMessage, type ClientMessage, type VenueStatus } from "@net/protocol.ts";
import { crystalRoundsCards } from "@sim/data/cards.ts";
import { DRAFT_OFFER_COUNT } from "@sim/round.ts";

export const VENUE_LOBBY_MATCH_ID = "lobby";

/** The lobby's fixed map. vessel-nexus is the one map with hand-tuned totem
 *  anchors today (totem.ts) — Pillar 2 gives the lobby its own space. */
const LOBBY_MAP_ID: MapId = "vessel-nexus";

/**
 * The lobby's map with its practice dummies injected (venue-sprint2-goal
 * S2.C.1): three non-explosive target crates near the spawn band. Injected
 * as a resolved MapDefinition (MatchHost accepts the object form) so the
 * DUMMY STATE arrives at clients via ordinary snapshots — the client keeps
 * resolving plain "vessel-nexus" for geometry and renders destructibles
 * from state, no client-side map fork.
 */
function venueLobbyMap(): MapDefinition {
  const base = resolveMap(LOBBY_MAP_ID);
  const groundY = base.size.y - 36; // vessel-nexus FLOOR_H → standing surface
  // Destructible x/y is the CENTER (centerToAABB) — a 44px box resting on
  // the ground has its center half a box above the standing surface.
  const dummy = (i: number, fx: number): DestructibleDefinition => ({
    id: `dummy_${i}`,
    kind: "box",
    health: 60,
    position: { x: Math.round(base.size.x * fx), y: groundY - 22 },
    size: { x: 44, y: 44 },
    explosive: false,
    flammable: false,
  });
  return { ...base, destructibles: [dummy(0, 0.3), dummy(1, 0.35), dummy(2, 0.65)] };
}

/** How often the lobby checks whether its dummies need respawning. */
const DUMMY_RESPAWN_CHECK_MS = 8000;

/**
 * Roll a fresh player's one-shot starter offer (S2.E): DRAFT_OFFER_COUNT
 * distinct cards from the same crystal-rounds pool the arena drafts from.
 * A starter owns nothing, so every card is eligible (unique/maxStacks caps
 * bind against an empty hand). Uniform server-side roll — this is lobby
 * ceremony, not sim state, so it doesn't ride the deterministic RNG stream.
 */
function rollStarterOffer(): string[] {
  const pool = [...crystalRoundsCards];
  const offers: string[] = [];
  while (offers.length < DRAFT_OFFER_COUNT && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    offers.push(pool.splice(idx, 1)[0]!.id);
  }
  return offers;
}

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
  /** Players queued at the bell totem, each with their one-shot starter
   *  offer (S2.E) — rolled at queue time, picked over the lobby socket,
   *  leftmost auto-picked at admission. Drained into the arena at the
   *  countdown-entry edge; until then it drives the totem UI. */
  private readonly readyQueue = new Map<PlayerId, { offers: string[]; pick: string | null }>();
  /** Admitted-but-not-yet-spawned picks (S2.F): the bell moves queue
   *  entries here so the client's lobby-close / arena-attach order can't
   *  race the card application. TTL'd — a client that never shows up at
   *  the arena forfeits the pick. */
  private readonly admittedCards = new Map<PlayerId, { cards: string[]; expiresAt: number }>();
  /** 1Hz status push (S2.B) — phase edges push immediately on top. */
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  /** S2.C: practice dummies come back after being broken. */
  private dummyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: { arena: WorldHost }) {
    this.arenaHost = opts.arena;
    this.lobbyHost = this.buildLobby();
    // Tap the arena's round-phase edges (threaded through every WorldHost
    // rebuild, recycles included) — an edge means the bell countdown just
    // re-based, so push a fresh frame immediately rather than waiting out
    // the 1Hz tick.
    this.arenaHost.onRoundPhaseChange = (_prev, next) => {
      // THE BELL (S2.F): the countdown-entry edge admits everyone queued —
      // picks move to the TTL'd admitted map, each socket gets its one-shot
      // venue-admitted frame, and the queue empties in the same breath.
      if (next === "countdown") this.admitQueue();
      this.broadcastStatus();
    };
    // Starter cards ride admission (S2.E): the arena consults this at every
    // entrant insertion. Admitted picks win; a still-queued player who
    // reaches the arena during a countdown some other way keeps their pick
    // too; everyone else spawns plain.
    this.arenaHost.getEntrantCards = (playerId) => {
      const admitted = this.admittedCards.get(playerId);
      if (admitted) {
        this.admittedCards.delete(playerId); // one spawn per admission
        if (admitted.expiresAt > Date.now()) return admitted.cards;
        return undefined;
      }
      const entry = this.readyQueue.get(playerId);
      if (!entry || entry.offers.length === 0) return undefined;
      return [entry.pick ?? entry.offers[0]!];
    };
    this.statusTimer = setInterval(() => this.broadcastStatus(), 1000);
    // Lobby never rebuilds (Pillar 1), so the direct reference stays valid.
    this.dummyTimer = setInterval(
      () => this.lobbyHost.respawnDestructibles(),
      DUMMY_RESPAWN_CHECK_MS,
    );
  }

  /** The arena half — index.ts keeps routing /ws/world here unchanged. */
  get arena(): WorldHost {
    return this.arenaHost;
  }

  private buildLobby(): MatchHost {
    const host = new MatchHost(VENUE_LOBBY_MATCH_ID, [], [], venueLobbyMap(), {
      mode: "hangout",
      // The venue lobby's single bell-portal totem replaces the room
      // hangout's READY/LAUNCH pair (resolveVenueTotems — shared pure
      // function, client renders identical coordinates).
      totems: resolveVenueTotems(resolveMap(LOBBY_MAP_ID)),
      // Totem SimEvents (same hook privateLobby uses): in venue semantics
      // BOTH event kinds mean "toggle my place in the bell queue" — one
      // totem, one meaning, no host gate, no room bookkeeping. The actual
      // arena admission drain is S2.D; queueing is immediately visible via
      // the pushed status frames either way.
      onSimEvent: (event) => {
        if (event.t === "ready-toggled" || event.t === "launch-requested") {
          this.toggleQueue(PlayerId(event.playerId));
        }
      },
    });
    host.ensureTickLoop();
    return host;
  }

  /** The bell's queue drain (S2.F): every queued player is admitted at
   *  once — pick banked in admittedCards (30s TTL), venue-admitted pushed
   *  to their lobby socket, queue entry removed. Runs on the arena's
   *  countdown-entry edge only. */
  private admitQueue(): void {
    if (this.readyQueue.size === 0) return;
    const expiresAt = Date.now() + 30_000;
    for (const [playerId, entry] of this.readyQueue) {
      if (entry.offers.length > 0) {
        this.admittedCards.set(playerId, {
          cards: [entry.pick ?? entry.offers[0]!],
          expiresAt,
        });
      }
      const ws = this.lobbySockets.get(playerId);
      if (ws) {
        try {
          ws.send(encodeMessage({ t: "venue-admitted", arenaWsPath: "/ws/world" }));
        } catch {
          /* dead socket — the TTL forfeits the pick */
        }
      }
    }
    this.readyQueue.clear();
    console.log(`[venue] the bell — admitted ${this.admittedCards.size} entrant(s) to the arena`);
  }

  private toggleQueue(playerId: PlayerId): void {
    if (this.readyQueue.has(playerId)) {
      this.readyQueue.delete(playerId);
    } else {
      // Callsign gate (S2.C.3): identity precedes commitment — a nameless
      // visitor can walk the room and break dummies, but cannot queue for
      // the arena. The client prompts before connecting; this is the
      // server-side truth a probe can't route around.
      const ws = this.lobbySockets.get(playerId);
      const name = (ws?.data as { name?: string } | undefined)?.name;
      if (!ws || !name) return;
      // Starter draft (S2.E): queueing rolls the one-shot 3-card offer and
      // pushes it immediately over the lobby socket. Re-queue re-rolls —
      // leaving the queue forfeits the old offer, same as walking away.
      const offers = rollStarterOffer();
      this.readyQueue.set(playerId, { offers, pick: null });
      try {
        ws.send(encodeMessage({ t: "venue-draft", offers }));
      } catch {
        /* dead socket — detach path will dequeue */
      }
      console.log(`[venue] ${playerId} queued at the bell — offer: ${offers.join(", ")}`);
    }
    this.broadcastStatus();
  }

  /** Compose + push the S2.B status frame to every connected lobby socket.
   *  Cheap by construction (a dozen scalar fields + one encode per second);
   *  arena summary is the same call /venue/summary makes. */
  private broadcastStatus(): void {
    if (this.lobbySockets.size === 0) return;
    const arena = this.arenaHost.summary();
    if (!arena) return;
    const frame: VenueStatus = {
      t: "venue-status",
      arenaPhase: arena.phase,
      roundIndex: arena.roundIndex,
      scores: arena.scores,
      humans: arena.humans,
      bots: arena.bots,
      nextBellMs: Math.round(msUntilNextBell(arena.phase, arena.countdownRemainingMs)),
      queued: [...this.readyQueue.keys()] as string[],
    };
    const encoded = encodeMessage(frame);
    for (const [playerId, ws] of this.lobbySockets) {
      try {
        ws.send(encoded);
      } catch {
        this.lobbySockets.delete(playerId);
      }
    }
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
    // Starter-draft picks (S2.E) are venue business, not lobby-sim business:
    // a queued player's card-pick lands on their queue entry (roundIndex is
    // meaningless here) and never reaches the hangout host's round state.
    const decoded = decodeMessage<ClientMessage>(
      raw instanceof Buffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : raw,
    );
    if (decoded?.message.t === "card-pick") {
      const playerId = PlayerId(ws.data.playerId);
      const entry = this.readyQueue.get(playerId);
      if (entry && entry.offers.includes(decoded.message.cardId)) {
        entry.pick = decoded.message.cardId;
      }
      return;
    }
    this.lobbyHost.routeMessage(ws, raw);
  }

  detachLobby(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (this.lobbySockets.get(playerId) === ws) this.lobbySockets.delete(playerId);
    // A departed player must not be drained into the arena at the next
    // bell — dequeue on disconnect (no ghost entrants).
    this.readyQueue.delete(playerId);
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

  /** Test surface: the bell queue's current membership. */
  queuedForTest(): PlayerId[] {
    return [...this.readyQueue.keys()];
  }

  /** Test surface: a queued player's rolled offer + recorded pick. */
  queueEntryForTest(playerId: PlayerId): { offers: string[]; pick: string | null } | undefined {
    return this.readyQueue.get(playerId);
  }

  dispose(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.dummyTimer) {
      clearInterval(this.dummyTimer);
      this.dummyTimer = null;
    }
    this.lobbyHost.dispose();
  }

  private spawnFor(playerIdRaw: string, chosenName?: string): PlayerSpawnInfo {
    return {
      playerId: PlayerId(playerIdRaw),
      characterId: "balanced",
      // Machine names are unreachable on the venue path (S2.C.3): a
      // nameless visitor reads as an anonymous recruit, never as their
      // opaque player id leaking into the room.
      name: chosenName ?? "RECRUIT",
      color: pickColor(playerIdRaw),
      weaponId: "starter-pistol",
    };
  }
}
