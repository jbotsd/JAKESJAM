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
import { crystalRoundsCards } from "@sim/data/cards.ts";
import { classIdForArchetype, MAX_ABILITY_SLOTS, type ClassId } from "@sim/data/cardTypes.ts";
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

/** One player's loadout-station progress (chunk 1.3). `picks` fills in
 *  visit order, capped implicitly by `rollStarterOffer`'s own gates (see
 *  below) rather than a hard length check here — the same "enforced at
 *  the offer roll, never by failing a pick" discipline round.ts's
 *  enterDrafting documents for MAX_ABILITY_SLOTS. */
type LoadoutEntry = { offers: string[]; picks: string[]; classId: ClassId };

/**
 * Roll a player's loadout-station offer (S2.E, extended chunk 1.3 — see
 * docs/class-overhaul-workboard.md § 1.3): DRAFT_OFFER_COUNT distinct
 * cards from the same crystal-rounds pool the arena drafts from, minus
 * whatever the player has ALREADY equipped this station visit
 * (`alreadyPicked`). Uniform server-side roll — this is lobby ceremony,
 * not sim state, so it doesn't ride the deterministic RNG stream.
 *
 * classId gate (docs/class-ability-catalogs-v1.md): mirrors round.ts
 * enterDrafting's offer-roll gate exactly — a classId-gated card (the
 * Geometrician catalog today) only ever appears for a player of that class.
 * `classId` omitted (character not yet resolved on the lobby's own
 * WorldState) falls back to "wizard" — the same default `spawnFor` uses
 * for an unpicked chassis, so a not-yet-spawned visitor sees exactly what
 * they'd see as the default chassis, never every class's catalog at once.
 *
 * `alreadyPicked` gating (chunk 1.3): SAME exclusion rules round.ts's
 * enterDrafting applies to an in-match hand — `unique` cards already held
 * don't reappear, `maxStacks` caps bind against copies already picked, and
 * once the picked hand already holds MAX_ABILITY_SLOTS actives (the rack
 * — docs/classes-goal.md "Rotation system", "Loadout station owns the 3
 * slots"), no further active-bearing (ability) card is offered — mirrors
 * the exact `heldActives >= MAX_ABILITY_SLOTS` gate round.ts's draft uses,
 * so the station and the between-round draft never disagree about what
 * "the rack is full" means. Non-active universal cards (weapon/stat
 * tradeoffs) stay eligible past that point — they aren't rack slots.
 */
function rollStarterOffer(classId: ClassId = "wizard", alreadyPicked: readonly string[] = []): string[] {
  const copies = new Map<string, number>();
  for (const id of alreadyPicked) copies.set(id, (copies.get(id) ?? 0) + 1);
  const activesHeld = alreadyPicked.filter((id) =>
    crystalRoundsCards.some((c) => c.id === id && c.active !== undefined),
  ).length;
  const pool = crystalRoundsCards.filter((c) => {
    if (c.classId !== undefined && c.classId !== classId) return false;
    if (c.unique && (copies.get(c.id) ?? 0) > 0) return false;
    if (c.maxStacks !== undefined && (copies.get(c.id) ?? 0) >= c.maxStacks) return false;
    if (c.active && activesHeld >= MAX_ABILITY_SLOTS) return false;
    return true;
  });
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
   *  card selector by the practice dummies. First touch rolls the offer;
   *  each valid pick lands over the lobby socket, fills the NEXT open
   *  `picks` slot, and immediately rerolls `offers` for the following slot
   *  (chunk 1.3, docs/classes-goal.md "Loadout station owns the 3 slots" —
   *  the station equips up to MAX_ABILITY_SLOTS cards across as many picks
   *  as the visitor makes, not just one starter card). `picks` rides the
   *  player's NEXT admission (in pick order) and is consumed by it. No
   *  picks = spawn with none — never auto-picked (auto-select is a mid-run
   *  round-timer convention, not a lobby one). `classId` is captured at
   *  first touch so every reroll during the same visit stays gated to the
   *  chassis the player armed at, even if they flip the class row mid-
   *  visit (the NEXT fresh visit re-derives it). */
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
   *  re-opens) the player's card selector. First touch rolls the offer;
   *  the same offer is re-pushed on the totem's retrigger cadence while
   *  they stand there (idempotent content — the CLIENT arbitrates overlay
   *  visibility by station proximity, so re-pushes never re-slam a modal).
   *  Deliberately NO callsign gate: the station is practice furniture,
   *  commitment to the arena is the bell's business. */
  private touchLoadoutStation(playerId: PlayerId): void {
    const ws = this.lobbySockets.get(playerId);
    if (!ws) return;
    let entry = this.loadouts.get(playerId);
    if (!entry) {
      // Read the visitor's CURRENT chassis pick off the lobby's own live
      // WorldState (classes-goal.md P1 class-select — HangoutScene sends it
      // at lobby connect, spawnFor threads it into the lobby player's
      // characterId). Catalog offers must match the class they'll actually
      // arm at the station, same discipline as round.ts enterDrafting.
      const characterId = this.lobbyHost.getStateSnapshot().players[playerId]?.characterId;
      const classId = characterId ? classIdForArchetype(characterId) : "wizard";
      entry = { offers: rollStarterOffer(classId), picks: [], classId };
      this.loadouts.set(playerId, entry);
      console.log(`[venue] ${playerId} at the loadout station — offer: ${entry.offers.join(", ")}`);
    }
    // Re-pushing an EXISTING entry is deliberately idempotent — same
    // `entry.offers` every retrigger — so standing there deciding never
    // reshuffles the plates underneath the player. `entry.offers` only
    // ever changes inside the card-pick handler below (a fresh roll for
    // the next open slot, or `[]` once the rack is full).
    try {
      ws.send(encodeMessage({ t: "venue-draft", offers: entry.offers }));
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
    // Loadout-station picks (S2.E, separated 2026-07-17; multi-slot chunk
    // 1.3) are venue business, not lobby-sim business: the card-pick lands
    // on the player's loadout entry (roundIndex is meaningless here) and
    // never reaches the hangout host's round state. Each valid pick fills
    // the NEXT open rack slot (monotonic — this chunk does not add a
    // swap/undo affordance for an already-filled slot; see chunk 1.3's
    // report for why that's out of scope here) and immediately rerolls the
    // offer for whichever slot comes after it, so a single station visit
    // can walk all the way to a full MAX_ABILITY_SLOTS rack without
    // leaving and re-entering the totem zone.
    const decoded = decodeMessage<ClientMessage>(
      raw instanceof Buffer ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : raw,
    );
    if (decoded?.message.t === "card-pick") {
      const playerId = PlayerId(ws.data.playerId);
      const entry = this.loadouts.get(playerId);
      if (entry && entry.picks.length < MAX_ABILITY_SLOTS && entry.offers.includes(decoded.message.cardId)) {
        entry.picks.push(decoded.message.cardId);
        entry.offers =
          entry.picks.length < MAX_ABILITY_SLOTS
            ? rollStarterOffer(entry.classId, entry.picks)
            : [];
        try {
          ws.send(encodeMessage({ t: "venue-draft", offers: entry.offers }));
        } catch {
          /* dead socket — detach path will clean up */
        }
      }
      return;
    }
    // Duos-queue intent toggle (classes-goal.md "Venue integration") —
    // same interception shape as card-pick: venue business, never reaches
    // the hangout host's round-message switch. Flips intent only; it does
    // NOT touch either queue's current membership (see toggleQueue's doc).
    if (decoded?.message.t === "duo-toggle") {
      const playerId = PlayerId(ws.data.playerId);
      if (this.duoIntent.has(playerId)) this.duoIntent.delete(playerId);
      else this.duoIntent.add(playerId);
      return;
    }
    this.lobbyHost.routeMessage(ws, raw);
  }

  detachLobby(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (this.lobbySockets.get(playerId) === ws) this.lobbySockets.delete(playerId);
    // A departed player must not be drained into the arena at the next
    // bell — dequeue on disconnect (no ghost entrants). Their loadout
    // offer goes with them: a fresh visit rolls fresh cards.
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
    };
  }
}
