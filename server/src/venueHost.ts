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
import { characterOf, type WorldHost } from "./worldHost.ts";
import { msUntilNextBell } from "@sim/round.ts";
import { resolveVenueTotems } from "@sim/totem.ts";
import { resolveMap } from "@sim/data/maps.ts";
import { PlayerId, type DestructibleDefinition, type MapDefinition, type PlayerSpawnInfo } from "@sim/types.ts";
import type { MapId } from "@sim/data/maps.ts";
import { decodeMessage, encodeMessage, type ClientMessage, type VenueStatus } from "@net/protocol.ts";
import { sanitizeCharacterId } from "@net/playerCharacter.ts";
import { crystalRoundsCards, catalogForClass } from "@sim/data/cards.ts";
import { classIdForArchetype, MAX_ABILITY_SLOTS, type ClassId } from "@sim/data/cardTypes.ts";

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

/** One player's loadout-station progress. `picks` is the player's current
 *  rack — every id in it is a `catalogForClass` catalog card as of
 *  2026-07-18 (the universal random-offer-and-reroll flow that used to
 *  also land picks here, `rollStarterOffer`, was cut from the station
 *  entirely — see the `loadouts` field doc below and `routeLobby`'s
 *  `catalog-toggle`/`class-pick` handlers). Capped implicitly at
 *  MAX_ABILITY_SLOTS by `catalog-toggle`'s own gate rather than a hard
 *  length check here — the same "enforced at the point of adding, never by
 *  failing a pick" discipline round.ts's enterDrafting documents. */
type LoadoutEntry = { picks: string[]; classId: ClassId };

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
  /** Players queued at the bell totem — a clean countdown queue and
   *  NOTHING else (Jake 2026-07-17: "seperate the card selector test room
   *  thing with the bell queue" — the old design rolled the starter offer
   *  here, slamming a draft modal at whoever touched the bell). Drained
   *  into the arena at the countdown-entry edge. */
  private readonly readyQueue = new Set<PlayerId>();
  /**
   * Duos-queue intent (classes-goal.md "Venue integration": "Duos queue:
   * VenueHost bell admission gains a team variant (queue as pair / auto-
   * pair). FFA bell unchanged."). A per-lobby-connected-player toggle,
   * flipped by the `duo-toggle` client message (routeLobby below) — NOT a
   * queue membership by itself. Walking into the bell totem still does the
   * actual queueing (toggleQueue), reading whichever intent is current at
   * that moment: intent ON routes the totem-touch into `duoQueue` instead
   * of `readyQueue`. Cleared on disconnect (a fresh visit starts FFA).
   */
  private readonly duoIntent = new Set<PlayerId>();
  /**
   * The duo bell queue — same totem, same countdown-edge drain as
   * `readyQueue`, but admitted in PAIRS (`admitDuoQueue`) instead of
   * individually. Kept as a fully separate Set (not a flag on
   * `readyQueue`'s entries) so the FFA path above is untouched code,
   * provably byte-for-byte unchanged (venueHost.test.ts pins this).
   */
  private readonly duoQueue = new Set<PlayerId>();
  /**
   * Admitted duo team assignments, TTL'd exactly like `admittedCards` (same
   * race the comment there explains: the client's lobby-close / arena-
   * attach ordering can't be trusted to be atomic). Consumed one-shot by
   * `getEntrantTeamId` at WorldHost's gate-drain.
   */
  private readonly admittedTeams = new Map<PlayerId, { teamId: string; expiresAt: number }>();
  /** Uniqueness counter for freshly-minted duo teamIds. */
  private duoTeamCounter = 0;
  /** The LOADOUT STATION (the bell's separated other half): a walk-up
   *  class + ability-catalog selector by the practice dummies. First touch
   *  derives `classId` from the visitor's current chassis pick and opens
   *  an empty rack; each `catalog-toggle` lands over the lobby socket and
   *  adds/removes a catalog card from `picks` (docs/classes-goal.md
   *  "Loadout station owns the 3 slots" — up to MAX_ABILITY_SLOTS cards
   *  across as many toggles as the visitor makes). `picks` rides the
   *  player's NEXT admission and is consumed by it. No picks = spawn with
   *  none — never auto-picked (auto-select is a mid-run round-timer
   *  convention, not a lobby one).
   *
   *  `classId` LIVE-updates on a `class-pick` message (Bug fix, live
   *  playtest 2026-07-18 — Jake selected Interstice/ninja in the class row
   *  but the catalog grid kept showing Geometrician/wizard's abilities,
   *  because `classId` used to be captured once at first touch and never
   *  re-derived): switching class mid-visit re-derives `classId`
   *  immediately and drops any armed `picks` that no longer belong to the
   *  new class — no need to leave and re-enter the totem zone.
   *
   *  The UNIVERSAL random-offer-and-reroll flow this station used to also
   *  run (`rollStarterOffer`, resolved via `card-pick` over the lobby
   *  socket) is GONE as of 2026-07-18 (Jake, live playtest, seeing the
   *  catalog grid AND the old offer section together: "delete this
   *  mechanic and gameplay and focus on the other things on this ui ... I
   *  mean in the load out picker"). Universal cards are acquired ONLY
   *  through the in-match between-round draft now (round.ts's
   *  `enterDrafting`, matchHost.ts's `card-pick` handling — a completely
   *  separate code path, untouched by any of this). */
  private readonly loadouts = new Map<PlayerId, LoadoutEntry>();
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
      // admitQueue (FFA) is untouched by the duos feature; admitDuoQueue
      // runs the SAME edge for the separate duo queue (classes-goal.md
      // "Venue integration") — two queues, one bell, one edge.
      if (next === "countdown") {
        this.admitQueue();
        this.admitDuoQueue();
      }
      this.broadcastStatus();
    };
    // Starter cards ride admission (S2.E): the arena consults this at every
    // entrant insertion. Admitted picks win; a player with an un-banked
    // loadout pick who reaches the arena during a countdown some other way
    // keeps their pick too; everyone else — including a queued player who
    // never visited the loadout station — spawns plain (no auto-pick;
    // they draft with everyone else at the next drafting phase).
    this.arenaHost.getEntrantCards = (playerId) => {
      const admitted = this.admittedCards.get(playerId);
      if (admitted) {
        this.admittedCards.delete(playerId); // one spawn per admission
        if (admitted.expiresAt > Date.now()) return admitted.cards;
        return undefined;
      }
      const loadout = this.loadouts.get(playerId);
      if (!loadout || loadout.picks.length === 0) return undefined;
      this.loadouts.delete(playerId); // the picks ride exactly one run
      return [...loadout.picks];
    };
    // Duos-queue team assignment (classes-goal.md "Venue integration") —
    // same one-shot/TTL'd consult-at-insertion shape as getEntrantCards
    // above, on a fully separate map so the cards path is untouched.
    this.arenaHost.getEntrantTeamId = (playerId) => {
      const admitted = this.admittedTeams.get(playerId);
      if (!admitted) return undefined;
      this.admittedTeams.delete(playerId); // one spawn per admission
      return admitted.expiresAt > Date.now() ? admitted.teamId : undefined;
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
      // Totem SimEvents (same hook privateLobby uses), one meaning per
      // kind: `ready-toggled` = the LOADOUT STATION (walk-up card
      // selector), `launch-requested` = the bell-queue toggle. No host
      // gate, no room bookkeeping; queueing is immediately visible via
      // the pushed status frames.
      onSimEvent: (event) => {
        if (event.t === "ready-toggled") {
          this.touchLoadoutStation(PlayerId(event.playerId));
        } else if (event.t === "launch-requested") {
          this.toggleQueue(PlayerId(event.playerId));
        }
      },
    });
    host.ensureTickLoop();
    return host;
  }

  /** The bell's queue drain (S2.F): every queued player is admitted at
   *  once — their loadout-station pick (if they made one) banked in
   *  admittedCards (30s TTL), venue-admitted pushed to their lobby socket,
   *  queue entry removed. No pick = admitted with none; the arena's
   *  ordinary drafting phase covers them next round. Runs on the arena's
   *  countdown-entry edge only. */
  private admitQueue(): void {
    if (this.readyQueue.size === 0) return;
    const admittedCount = this.readyQueue.size;
    const expiresAt = Date.now() + 30_000;
    for (const playerId of this.readyQueue) {
      const loadout = this.loadouts.get(playerId);
      if (loadout && loadout.picks.length > 0) {
        this.admittedCards.set(playerId, { cards: [...loadout.picks], expiresAt });
        this.loadouts.delete(playerId); // the picks ride exactly one run
      }
      const ws = this.lobbySockets.get(playerId);
      if (ws) {
        try {
          ws.send(encodeMessage({ t: "venue-admitted", arenaWsPath: "/ws/world" }));
        } catch {
          /* dead socket — the TTL forfeits the picks */
        }
      }
    }
    this.readyQueue.clear();
    console.log(`[venue] the bell — admitted ${admittedCount} entrant(s) to the arena`);
  }

  /**
   * The duo bell's queue drain (classes-goal.md "Venue integration") —
   * same countdown-entry edge as `admitQueue`, same per-player admission
   * mechanics (loadout pick banked, one `venue-admitted` push, TTL'd),
   * but processes `duoQueue` instead and additionally assigns a shared
   * `teamId` per pair.
   *
   * Pairing rule (queue order — a Set iterates in insertion order, so
   * this is FIFO, "first two to queue are paired together"):
   *   - Two players queued as duo → paired, fresh `teamId`.
   *   - An odd one out (nobody left to pair with by the time the bell
   *     rings) → "auto-pair … with an elastic bot partner" (classes-
   *     goal.md contested call #1): given their OWN fresh `teamId` alone;
   *     WorldHost's elastic-bot fill (`planBotTeams`) sees a human team
   *     sitting at exactly 1 member and tops it up with an ally bot.
   *
   * Runs on the arena's countdown-entry edge only, immediately after
   * `admitQueue` — same edge, independent queues, independent state.
   */
  private admitDuoQueue(): void {
    if (this.duoQueue.size === 0) return;
    const admittedCount = this.duoQueue.size;
    const expiresAt = Date.now() + 30_000;
    const pending = [...this.duoQueue];
    for (let i = 0; i < pending.length; i += 2) {
      const teamId = `duo-${this.duoTeamCounter}`;
      this.duoTeamCounter += 1;
      const pair = pending[i + 1] !== undefined ? [pending[i]!, pending[i + 1]!] : [pending[i]!];
      for (const playerId of pair) {
        this.admittedTeams.set(playerId, { teamId, expiresAt });
        const loadout = this.loadouts.get(playerId);
        if (loadout && loadout.picks.length > 0) {
          this.admittedCards.set(playerId, { cards: [...loadout.picks], expiresAt });
          this.loadouts.delete(playerId);
        }
        const ws = this.lobbySockets.get(playerId);
        if (ws) {
          try {
            ws.send(encodeMessage({ t: "venue-admitted", arenaWsPath: "/ws/world" }));
          } catch {
            /* dead socket — the TTL forfeits the pick and the team slot */
          }
        }
      }
    }
    this.duoQueue.clear();
    console.log(`[venue] the bell — admitted ${admittedCount} duo entrant(s) to the arena`);
  }

  /** The LOADOUT STATION: walking into the station totem opens (or
   *  re-opens) the player's class + ability-catalog selector. First touch
   *  derives `classId` from the visitor's current chassis and opens an
   *  empty rack; the same state is re-pushed on the totem's retrigger
   *  cadence while they stand there (idempotent — the CLIENT arbitrates
   *  overlay visibility by station proximity, so re-pushes never re-slam a
   *  modal). Deliberately NO callsign gate: the station is practice
   *  furniture, commitment to the arena is the bell's business. */
  private touchLoadoutStation(playerId: PlayerId): void {
    const ws = this.lobbySockets.get(playerId);
    if (!ws) return;
    let entry = this.loadouts.get(playerId);
    if (!entry) {
      // Read the visitor's CURRENT chassis pick off the lobby's own live
      // WorldState (classes-goal.md P1 class-select — HangoutScene sends it
      // at lobby connect, spawnFor threads it into the lobby player's
      // characterId). The catalog must match the class they'll actually
      // arm at the station, same discipline as round.ts enterDrafting.
      const characterId = this.lobbyHost.getStateSnapshot().players[playerId]?.characterId;
      const classId = characterId ? classIdForArchetype(characterId) : "wizard";
      entry = { picks: [], classId };
      this.loadouts.set(playerId, entry);
      console.log(`[venue] ${playerId} at the loadout station (class: ${classId})`);
    }
    // Re-pushing an EXISTING entry is deliberately idempotent — same
    // `entry.picks`/`entry.classId` every retrigger — so standing there
    // deciding never reshuffles anything underneath the player. `picks`
    // only ever changes inside the catalog-toggle handler below; `classId`
    // only ever changes inside the class-pick handler.
    this.pushLoadoutDraft(playerId, entry);
  }

  /**
   * Push the loadout station's current wire state to one lobby socket
   * (venue-draft: `picks` for the player's FULL current rack, `classId`
   * for the locked chassis). Called on totem touch/retrigger and after
   * every catalog-toggle/class-pick — one send site, so the wire shape can
   * never drift between call sites.
   */
  private pushLoadoutDraft(playerId: PlayerId, entry: LoadoutEntry): void {
    // Live loadout sync (Fix 1, live playtest 2026-07-18 — Jake: "the
    // abilities and load out should be active in this world"): every
    // picks/classId change reaches the lobby player's LIVE PlayerEntity
    // here too, not just the wire push to the DOM overlay below — so an
    // ability equipped at the station is immediately usable if the
    // visitor is already standing on a dummy, no totem re-touch or
    // reconnect required. One call site (this method, called from
    // touchLoadoutStation/class-pick/catalog-toggle), same "one send site"
    // discipline the wire-push comment already applies. Idempotent when
    // `entry.picks` hasn't actually changed (touchLoadoutStation's
    // retrigger re-push). No-op if the player has already left the lobby
    // host's live WorldState (MatchHost.setPlayerCards no-ops on a missing
    // player), independent of whether their socket is still around.
    this.lobbyHost.setPlayerCards(playerId, entry.picks);
    const ws = this.lobbySockets.get(playerId);
    if (!ws) return;
    try {
      ws.send(
        encodeMessage({
          t: "venue-draft",
          picks: [...entry.picks],
          classId: entry.classId,
        }),
      );
    } catch {
      /* dead socket — detach path will clean up */
    }
  }

  /**
   * The bell totem's SimEvent handler. Branches ONCE, at the top, on
   * `duoIntent` (classes-goal.md "Venue integration") — the FFA branch
   * below is the exact pre-duos body, untouched, so a player who never
   * toggles duo mode gets byte-for-byte the original bell behavior
   * (venueHost.test.ts pins this with a regression test).
   */
  private toggleQueue(playerId: PlayerId): void {
    if (this.duoIntent.has(playerId)) {
      this.toggleDuoQueue(playerId);
      return;
    }
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
      // The queue is JUST a queue — the starter offer lives at the loadout
      // station, not here (Jake 2026-07-17).
      this.readyQueue.add(playerId);
      console.log(`[venue] ${playerId} queued at the bell`);
    }
    this.broadcastStatus();
  }

  /** The duo-mode mirror of the FFA branch above — same callsign gate,
   *  same toggle-on-touch shape, separate Set. */
  private toggleDuoQueue(playerId: PlayerId): void {
    if (this.duoQueue.has(playerId)) {
      this.duoQueue.delete(playerId);
    } else {
      const ws = this.lobbySockets.get(playerId);
      const name = (ws?.data as { name?: string } | undefined)?.name;
      if (!ws || !name) return;
      this.duoQueue.add(playerId);
      console.log(`[venue] ${playerId} queued at the bell (duo)`);
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
      queued: [...this.readyQueue] as string[],
      duoQueued: [...this.duoQueue] as string[],
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
      // Chosen name + chassis ride SocketData (index.ts adds them over
      // MatchSocketData) — same duck-reads WorldHost.attach uses.
      const chosenName = (ws.data as { name?: string }).name;
      this.lobbyHost.addPlayer(
        this.spawnFor(ws.data.playerId, chosenName, characterOf(ws)),
      );
    }
    this.lobbySockets.set(playerId, ws);
    this.lobbyHost.attachClient(ws);
  }

  routeLobby(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    // The loadout station's own messages (catalog-toggle, class-pick) and
    // the duos-queue intent toggle are venue business, not lobby-sim
    // business: they land on VenueHost's own state and never reach the
    // hangout host's round-message switch.
    //
    // `card-pick` used to be intercepted here too, for the station's
    // universal random-offer-and-reroll flow (`rollStarterOffer`) — CUT
    // 2026-07-18 (Jake, live playtest, seeing the class ability catalog
    // grid AND the old "UNIVERSAL OFFER" 3-card section together: "delete
    // this mechanic and gameplay and focus on the other things on this ui
    // ... I mean in the load out picker"). A `card-pick` arriving over the
    // LOBBY socket now simply falls through to `this.lobbyHost.routeMessage`
    // below — a guaranteed no-op there, since the hangout host's own
    // `applyCardPick` (matchHost.ts) is gated to `round.phase === "drafting"`
    // and the venue lobby's round phase is permanently pinned to "fighting"
    // (never drafting). `card-pick` itself is NOT removed from the wire —
    // it's the message type the completely separate in-match between-round
    // draft still uses, over the ARENA/world socket (matchHost.ts, untouched
    // by any of this).
    const decoded = decodeMessage<ClientMessage>(
      raw instanceof Buffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : raw,
    );
    // Duos-queue intent toggle (classes-goal.md "Venue integration") —
    // venue business, never reaches the hangout host's round-message
    // switch. Flips intent only; it does NOT touch either queue's current
    // membership (see toggleQueue's doc).
    if (decoded?.message.t === "duo-toggle") {
      const playerId = PlayerId(ws.data.playerId);
      if (this.duoIntent.has(playerId)) this.duoIntent.delete(playerId);
      else this.duoIntent.add(playerId);
      return;
    }
    // Loadout-station class switch (Bug fix, live playtest 2026-07-18 —
    // Jake selected Interstice/ninja in the class row but the catalog grid
    // below kept showing Geometrician/wizard's abilities: `classId` used
    // to be captured once at first totem touch and never re-derived on a
    // mid-visit class-row click). Same venue-business interception shape
    // as duo-toggle/catalog-toggle. `characterId` rides client-sanitized
    // but is re-sanitized here — the wire is never trusted. A pick before
    // ever touching the station simply creates a fresh entry locked to the
    // new class (empty picks); a pick mid-visit re-derives `classId` and
    // DROPS every armed catalog pick that no longer belongs to it (the
    // only thing that can be in `picks` post-2026-07-18 is a catalog pick
    // — the universal offer is gone, see the `loadouts` field doc above —
    // so in practice this resets `picks` to `[]` on an actual class
    // change; the `catalogForClass` filter below is what keeps this
    // correct in general, e.g. if a future class ever shared a catalog
    // card id with another).
    if (decoded?.message.t === "class-pick") {
      const playerId = PlayerId(ws.data.playerId);
      const characterId = sanitizeCharacterId(decoded.message.characterId);
      const classId = classIdForArchetype(characterId);
      let entry = this.loadouts.get(playerId);
      if (!entry) {
        entry = { picks: [], classId };
        this.loadouts.set(playerId, entry);
      } else if (entry.classId !== classId) {
        const validIds = new Set(catalogForClass(classId).map((c) => c.id));
        entry.classId = classId;
        entry.picks = entry.picks.filter((id) => validIds.has(id));
      }
      this.pushLoadoutDraft(playerId, entry);
      return;
    }
    // Class ability catalog toggle (docs/classes-goal.md "Loadout station
    // owns the 3 slots" — live playtest finding 2026-07-18: Jake saw a
    // random 3-card offer mixing a universal weapon card with a class
    // catalog card and asked for the full catalog + a select/deselect
    // concept instead). Same venue-business interception shape as
    // duo-toggle/class-pick. `cardId` must be a catalog card (`classId`
    // set) belonging to the player's currently-locked loadout classId — a
    // foreign/mistyped/universal id is silently ignored.
    if (decoded?.message.t === "catalog-toggle") {
      const playerId = PlayerId(ws.data.playerId);
      const entry = this.loadouts.get(playerId);
      if (!entry) return;
      const cardId = decoded.message.cardId;
      const card = catalogForClass(entry.classId).find((c) => c.id === cardId);
      if (!card) return;
      const alreadyIdx = entry.picks.indexOf(cardId);
      if (alreadyIdx !== -1) {
        // Deselect — always allowed, no cap to check on the way out.
        entry.picks.splice(alreadyIdx, 1);
      } else {
        // Rack cap is shared across every active catalog card already
        // armed (docs/classes-goal.md "Draft never creates a 4th slot"). A
        // full rack silently refuses the add — no error frame, the
        // client's own disabled-tile state already prevents the click in
        // the ordinary case; this is the authoritative backstop.
        const activesHeld = entry.picks.filter((id) =>
          crystalRoundsCards.some((c) => c.id === id && c.active !== undefined),
        ).length;
        if (activesHeld >= MAX_ABILITY_SLOTS) return;
        entry.picks.push(cardId);
      }
      this.pushLoadoutDraft(playerId, entry);
      return;
    }
    this.lobbyHost.routeMessage(ws, raw);
  }

  detachLobby(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (this.lobbySockets.get(playerId) === ws) this.lobbySockets.delete(playerId);
    // A departed player must not be drained into the arena at the next
    // bell — dequeue on disconnect (no ghost entrants). Their loadout
    // picks go with them: a fresh visit starts an empty rack.
    this.readyQueue.delete(playerId);
    this.duoQueue.delete(playerId);
    this.duoIntent.delete(playerId);
    this.loadouts.delete(playerId);
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
    return [...this.readyQueue];
  }

  /** Test surface: the duo bell queue's current membership. */
  duoQueuedForTest(): PlayerId[] {
    return [...this.duoQueue];
  }

  /** Test surface: whether a player currently has duo intent toggled on. */
  duoIntentForTest(playerId: PlayerId): boolean {
    return this.duoIntent.has(playerId);
  }

  /** Test surface: a player's admitted team assignment (pre-consume). */
  admittedTeamForTest(playerId: PlayerId): string | undefined {
    return this.admittedTeams.get(playerId)?.teamId;
  }

  /** Test surface: a player's loadout-station offer + recorded picks. */
  loadoutForTest(playerId: PlayerId): LoadoutEntry | undefined {
    return this.loadouts.get(playerId);
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

  private spawnFor(
    playerIdRaw: string,
    chosenName?: string,
    characterId?: PlayerSpawnInfo["characterId"],
  ): PlayerSpawnInfo {
    return {
      playerId: PlayerId(playerIdRaw),
      // Chassis pick (classes-goal.md P1) — upgrade-sanitized, default
      // chassis for old clients (same rule as WorldHost.spawnFor).
      characterId: characterId ?? "balanced",
      // Machine names are unreachable on the venue path (S2.C.3): a
      // nameless visitor reads as an anonymous recruit, never as their
      // opaque player id leaking into the room.
      name: chosenName ?? "RECRUIT",
      color: pickColor(playerIdRaw),
      weaponId: "starter-pistol",
      // Defensive completeness (Fix 1, live playtest 2026-07-18): in the
      // ordinary case `loadouts` has no entry yet at first connect (a
      // fresh visit starts an empty rack, and `detachLobby` deletes any
      // entry on disconnect), so this is normally `undefined` — spawnFor
      // only ever runs once per lobby socket (`attachLobby`'s
      // `!hasPlayer` gate). The LIVE sync that actually matters (equip at
      // the station → cards go live without leaving) happens in
      // `pushLoadoutDraft` below, via `MatchHost.setPlayerCards`. This
      // just makes spawnFor's own PlayerSpawnInfo honest rather than
      // silently always zero, for any future path that re-spawns without
      // going through the loadout station's live-sync call site.
      cards: this.loadouts.get(PlayerId(playerIdRaw))?.picks,
    };
  }
}
