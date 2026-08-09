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
import { lobbyAllyNpcId, LOBBY_PRACTICE_TEAM_ID } from "@sim/botId.ts";

export const VENUE_LOBBY_MATCH_ID = "lobby";

/** The lobby's fixed map. vessel-nexus is the one map with hand-tuned totem
 *  anchors today (totem.ts) — Pillar 2 gives the lobby its own space. */
const LOBBY_MAP_ID: MapId = "vessel-nexus";

/**
 * The lobby's map with its practice dummies injected (venue-sprint2-goal
 * S2.C.1, repositioned per docs/venue-lobby-tableau-goal.md Part 3,
 * 2026-07-18): three "bad" (hostile, damage-testing) target crates
 * flanking the loadout table symmetrically — was two nearly-stacked at
 * 0.30/0.35 plus one isolated at 0.65 with no relationship to anything;
 * now three, evenly spaced around the table at 0.25, matching the "good"
 * ally NPCs' flanking positions (see LOBBY_ALLY_NPC_FRACTIONS below) so the
 * whole practice band reads as one symmetric row, not scattered furniture.
 * Injected as a resolved MapDefinition (MatchHost accepts the object form)
 * so the DUMMY STATE arrives at clients via ordinary snapshots — the
 * client keeps resolving plain "vessel-nexus" for geometry and renders
 * destructibles from state, no client-side map fork.
 */
function venueLobbyMap(): MapDefinition {
  const base = resolveMap(LOBBY_MAP_ID);
  const groundY = base.size.y - 36; // vessel-nexus FLOOR_H → standing surface
  // Destructible x/y is the CENTER (centerToAABB) — a 44px box resting on
  // the ground has its center half a box above the standing surface.
  // kind "trainingDummy" (not "box"): the definition's own string `id`
  // ("dummy_0" etc.) does NOT survive into the runtime DestructibleEntity
  // (World.create reassigns a fresh sequential numeric EntityId — see its
  // own comment), so `kind` is the only field a data-driven client render
  // distinction can key off. Behaviorally identical to "box" (same health/
  // explosive/flammable semantics, destructible.ts never branches on this
  // kind) — purely a hostile-tint hook, OnlineMatchScene.ts's
  // destructibleColor().
  const dummy = (i: number, fx: number): DestructibleDefinition => ({
    id: `dummy_${i}`,
    kind: "trainingDummy",
    health: 60,
    position: { x: Math.round(base.size.x * fx), y: groundY - 22 },
    size: { x: 44, y: 44 },
    explosive: false,
    flammable: false,
  });
  return {
    ...base,
    destructibles: [
      dummy(0, LOBBY_TABLEAU_FRACTIONS.badOuterLeft),
      dummy(1, LOBBY_TABLEAU_FRACTIONS.badInnerRight),
      dummy(2, LOBBY_TABLEAU_FRACTIONS.badOuterRight),
      // Ability-showcase gauntlet (Part C, 2026-07-19 — Jake: "an area with
      // the right bots and freindlies to test this... an ability show case
      // room where we can exhaustveily test all and every single ability").
      // Same `dummy()` shape/kind/health as the tableau's three — purely
      // MORE of them, spread across the open ground between the tableau
      // (ends 0.35) and the bell's own clearance zone (0.75 ± totem radius
      // 80px ⇒ keep clear of x-fraction ~0.723–0.777), see
      // SHOWCASE_FRACTIONS' own doc for the exact placement math.
      dummy(3, SHOWCASE_FRACTIONS.isolatedA),
      dummy(4, SHOWCASE_FRACTIONS.isolatedB),
      dummy(5, SHOWCASE_FRACTIONS.clusterA),
      dummy(6, SHOWCASE_FRACTIONS.clusterB),
      dummy(7, SHOWCASE_FRACTIONS.clusterC),
    ],
  };
}

/**
 * The loadout table's symmetric flanking positions (docs/venue-lobby-
 * tableau-goal.md Part 3) — one shared source so the destructible dummies
 * (above) and the ally NPCs (spawnAllyNpc, below) agree on the same row.
 * Fractions of vessel-nexus's map width; "anchor" is the loadout table/
 * totem position itself (unchanged from pre-tableau LOADOUT_X, totem.ts).
 */
/** Ceiling on displaced bots idling in the venue. Six is the arena's own
 *  bot cap, so the antechamber can never hold more personas than the fight
 *  it feeds. */
const MAX_IDLE_LOBBY_BOTS = 6;

const LOBBY_TABLEAU_FRACTIONS = {
  badOuterLeft: 0.19,
  goodInnerLeft: 0.22,
  anchor: 0.25,
  goodInnerRight: 0.28,
  badInnerRight: 0.31,
  badOuterRight: 0.35,
} as const;

/**
 * The ability-showcase gauntlet's own placements (Part C, 2026-07-19) — a
 * SEPARATE row from the tableau above (never modifies it, per docs/venue-
 * lobby-tableau-goal.md Part 1/3's lock on that composition), living in the
 * open ground between the tableau's right edge (0.35 ⇒ x=1050 on
 * vessel-nexus's 3000px width) and the bell totem's own clearance zone
 * (resolveVenueTotems' BELL_X=0.75 ⇒ x=2250, radius 80 ⇒ keep clear of
 * [2170, 2330]).
 *
 * Placement was checked against `vessel-nexus.ts`'s actual platform list,
 * not guessed: `ledge()` platforms (the t1/t2/lip/chimney/nest/perch/float
 * families) are thin floating shelves that never reach the ground, so they
 * never obstruct a ground-level dummy/NPC regardless of x. Only the five
 * `col()` "sightline cover" pylons touch the ground (their `baseY` is
 * literally `GROUND`): cover-a(480)/b(960)/c(1500)/d(2040)/e(2520), each
 * ~50–56px wide. In THIS x-range that's cover-c(1500) and cover-d(2040);
 * the "lip" low barriers (also `ledge()`, so technically non-blocking, but
 * close enough to the ground — GROUND-36 top — to visually clip a 44px
 * dummy) at lip-b(1260, w90) and lip-c(1740, w90) are avoided too, for a
 * clean unobstructed read on every dummy. Every fraction below keeps
 * ≥50px clearance from the nearest one of these.
 *
 * Honest limit (documented per this task's own "stop and say so" contract
 * rather than silently claiming a perfect result): vessel-nexus's cover
 * pylons are spaced every ~420–540px BY DESIGN (the map's own top-of-file
 * doc: "Sightline law: cover pylons break floor-band snipes (~≤480px
 * open)") — that cadence is a base-map invariant, not something this
 * gauntlet's placement can dissolve without editing core arena platform
 * geometry (out of scope: this task adds destructibles/NPCs via
 * `venueLobbyMap()`/`allyNpcSpawn()`, the same data-only surface the
 * tableau itself used, never touches `vessel-nexus.ts`'s platform list).
 * So: a movement ability's FULL travel distance (Paper Double's ~900px)
 * cannot play out with zero interruption ANYWHERE on this map's ground
 * floor, showcase gauntlet included — the honest win here is the *longest
 * achievable* open run on this map (tableau edge 1050 → bell clearance
 * edge 2170 ≈ 1120px total span, versus the old tableau-only band's 480px)
 * with only the map's own pre-existing short pylons/lips interrupting it,
 * not new clutter piled on top of them.
 */
const SHOWCASE_FRACTIONS = {
  /** Isolated single-target dummy — clean melee-arc/single-shot reads,
   *  nothing else in range to confuse an AOE-vs-single-target read. */
  isolatedA: 1150 / 3000,
  /** Second isolated single-target dummy, further along — a mid-gauntlet
   *  "did my projectile actually travel/pierce/bounce this far" waypoint. */
  isolatedB: 1385 / 3000,
  /** The showcase's near ally NPC — closer to the tableau's own two, so
   *  Rally Light/Haste Gift's aura radius has a "definitely in range" case
   *  right next to a "definitely out of range" case (the far ally below). */
  allyNear: 1600 / 3000,
  /** A tight 3-dummy cluster (50px apart) — the one deliberately CROWDED
   *  spot in the gauntlet, so AOE/pierce/bounce/split/chain-lightning
   *  abilities have multiple real targets worth hitting at once (the
   *  tableau's own 90px spacing was too tight to isolate this from single-
   *  target testing; this cluster is purpose-built for it instead). */
  clusterA: 1830 / 3000,
  clusterB: 1880 / 3000,
  clusterC: 1930 / 3000,
  /** The showcase's far ally NPC — ~530px from `allyNear`, well outside
   *  any drafted aura/buff radius in the catalog, so it's a clean "out of
   *  range" control target. */
  allyFar: 2130 / 3000,
} as const;

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
type LoadoutEntry = {
  picks: string[];
  classId: ClassId;
  /**
   * Catalog-cycle position (Part B, 2026-07-19) — which group of ≤
   * MAX_ABILITY_SLOTS actives, in `catalogForClass(classId)` order, the
   * `catalog-cycle` handler last swapped in. `undefined` until the first
   * cycle (equivalent to "before group 0"). Reset to `undefined` whenever
   * `classId` actually changes (`class-pick`'s own handler) — a group
   * index only means anything relative to the class it was computed
   * against; carrying it across a chassis switch would land on an
   * unrelated group of the NEW class's catalog.
   */
  cycleIndex?: number;
};

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

/** Autogenes house gold (docs/visual-language-gnostic-vessel.md's dual-
 *  accent table) — the loadout table's two ally NPCs are permanent house
 *  fixtures, not combatants, so gold (not the arena's combat cyan) is the
 *  correct register per chassis-design-axioms.md CA2. */
const LOBBY_ALLY_ACCENT = "#c9a84c";

/**
 * The loadout table's two flanking "good" (ally) NPCs (index 1/2) PLUS the
 * showcase gauntlet's own two (index 3/4, Part C 2026-07-19) — stationary
 * forever (nothing ever calls `applyInput` for their ids), carrying
 * LOBBY_PRACTICE_TEAM_ID so `isAlly()` reads true against any visitor
 * (who gets the same teamId in `spawnFor` below), giving Aegis Share/Rally
 * Light/Borrowed Time/Glass Ward/Haste Gift a real ally target instead of
 * only their solo-fallback (docs/venue-lobby-tableau-goal.md Part 2).
 * `bot_`-prefixed id (`lobbyAllyNpcId`) so every existing "is this a real
 * human" check already excludes them for free — no new exclusion logic.
 */
function allyNpcSpawn(index: 1 | 2 | 3 | 4): PlayerSpawnInfo {
  return {
    playerId: PlayerId(lobbyAllyNpcId(index)),
    characterId: "balanced",
    name: "ALLY",
    color: LOBBY_ALLY_ACCENT,
    weaponId: "starter-pistol",
    cosmetics: { accentColor: LOBBY_ALLY_ACCENT },
    teamId: LOBBY_PRACTICE_TEAM_ID,
  };
}

export type VenueSummary = {
  lobby: {
    /** Connected lobby sockets — humans standing in the antechamber. */
    present: number;
    /** Total health across the lobby's practice dummies; -1 when the host
     *  has no snapshot yet. Falls when something damages one — the only
     *  server-side witness to venue 2.5. */
    dummyHealth: number;
    /** How many player entities the lobby world holds. */
    players: number;
    /** x of the first non-bot player in the lobby world, rounded; -1 if none. */
    humanX: number;
    /** Fire-bit inputs the LOBBY host has accepted, counted at receipt. */
    fireInputsSeen: number;
    /** [x, y] aim on the most recent accepted fire input. */
    lastFireAim: [number, number];
    /** The lobby world's own round phase. Hangout mode pins this to
     *  "fighting" forever; anything else means hangout semantics are not
     *  actually in force (gospel E2-b). `null` if the host has no summary
     *  yet. */
    phase: string | null;
  };
  arena: (ReturnType<MatchHost["summary"]> & { nextBellMs: number }) | null;
};

export class VenueHost {
  private readonly arenaHost: WorldHost;
  /** Bots currently idling in the venue after being displaced from the
   *  arena (gospel 3.1). Tracked here rather than inferred from the lobby
   *  roster so the ally NPCs — which are also `bot_`-prefixed — are never
   *  mistaken for displaced arena personas and evicted. */
  private readonly idleBots = new Set<string>();
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
  /**
   * Admission tickets (open-doors 1.3, the admission race): EVERY player
   * the bell admits — FFA and duo alike, picks or no picks — gets a TTL'd
   * ticket here (value = expiry, same 30 s window as admittedCards). The
   * arena consults it two ways (late-bound hooks wired in the
   * constructor):
   *   - a pre-opened arena socket parked while its player was QUEUED is
   *     released from the hold and inserted at the bell drain;
   *   - an arena socket that arrives AFTER the countdown already ended
   *     (cold cache / slow phone — the fresh TCP+WS handshake lost the
   *     ~3 s race) still inserts immediately instead of spectating the
   *     full round it was admitted for.
   * Never consumed on use (hasPlayer guards double-insertion); expiry is
   * the only exit, swept at each bell edge so the map can't grow.
   */
  private readonly admittedEntrants = new Map<PlayerId, number>();
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
        this.pruneAdmissions();
        this.admitQueue();
        this.admitDuoQueue();
      }
      this.broadcastStatus();
    };
    // The admission race (open-doors 1.3) — the two venue-truth hooks the
    // arena consults, wired with the same late-binding pattern as
    // getEntrantCards below. holdEntrant: a lobby-connected player without
    // a live admission has only PRE-OPENED their arena socket (a warm
    // connection is not a queue commitment) — the arena keeps it parked
    // through bell drains and recycles. admittedRecently: the bell
    // admitted them within the ticket TTL — a socket arriving late (or a
    // held one, at the drain) inserts.
    // gospel 3.1 — a bot the arena displaces comes and stands in the venue
    // instead of evaporating, and goes back when the arena wants it. Cap
    // the idle population so a long series of bells cannot slowly fill the
    // antechamber with a crowd nobody asked for.
    this.arenaHost.onBotDisplaced = (playerId, name, characterId) => {
      if (this.idleBots.size >= MAX_IDLE_LOBBY_BOTS) return;
      if (this.idleBots.has(playerId as string)) return;
      this.idleBots.add(playerId as string);
      this.lobbyHost.addPlayer({
        playerId,
        characterId,
        name,
        color: LOBBY_ALLY_ACCENT,
        weaponId: "starter-pistol",
        cosmetics: { accentColor: LOBBY_ALLY_ACCENT },
        teamId: LOBBY_PRACTICE_TEAM_ID,
      });
    };
    this.arenaHost.onBotRecalled = (playerId) => {
      if (!this.idleBots.delete(playerId as string)) return;
      this.lobbyHost.removeRosterPlayer(playerId);
    };

    this.arenaHost.holdEntrant = (playerId) =>
      this.lobbySockets.has(playerId) && !this.hasAdmission(playerId);
    this.arenaHost.admittedRecently = (playerId) => this.hasAdmission(playerId);
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
    // The loadout table's two "good" ally NPCs (docs/venue-lobby-tableau-
    // goal.md Part 3) PLUS the showcase gauntlet's own two (index 3/4,
    // Part C 2026-07-19) — added once, at construction, permanent for the
    // lobby's whole (never-recycling) life. Pinned to exact flanking
    // positions via setPlayerPosition since the normal spawn-point
    // algorithm (farthest-from-occupants) has no way to express "land
    // exactly here."
    const map = resolveMap(LOBBY_MAP_ID);
    const groundY = map.size.y - 36; // vessel-nexus FLOOR_H → standing surface (matches venueLobbyMap's dummy math)
    const playerStandY = groundY - 28; // SIM_BODY_HALF_HEIGHT (HangoutScene.ts) — feet at the floor surface
    const allyFractionByIndex = {
      1: LOBBY_TABLEAU_FRACTIONS.goodInnerLeft,
      2: LOBBY_TABLEAU_FRACTIONS.goodInnerRight,
      3: SHOWCASE_FRACTIONS.allyNear,
      4: SHOWCASE_FRACTIONS.allyFar,
    } as const;
    for (const index of [1, 2, 3, 4] as const) {
      const npcId = PlayerId(lobbyAllyNpcId(index));
      host.addPlayer(allyNpcSpawn(index));
      host.setPlayerPosition(npcId, Math.round(map.size.x * allyFractionByIndex[index]), playerStandY);
    }
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
      // The admission ticket (open-doors 1.3) — minted for EVERY admitted
      // player, not just those with picks, so the arena can tell "admitted,
      // socket slow" from "never admitted" (see the field's doc).
      this.admittedEntrants.set(playerId, expiresAt);
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
        // Same admission ticket as the FFA bell (open-doors 1.3).
        this.admittedEntrants.set(playerId, expiresAt);
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

  /** A live (unexpired) admission ticket for this player (open-doors 1.3).
   *  Lazily deletes an expired entry on read; pruneAdmissions sweeps the
   *  rest at bell edges. */
  private hasAdmission(playerId: PlayerId): boolean {
    const expiresAt = this.admittedEntrants.get(playerId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      this.admittedEntrants.delete(playerId);
      return false;
    }
    return true;
  }

  /** Bell-edge sweep of expired admission tickets — keeps the map bounded
   *  by live admissions, never by all-time admissions. */
  private pruneAdmissions(): void {
    const now = Date.now();
    for (const [playerId, expiresAt] of this.admittedEntrants) {
      if (expiresAt <= now) this.admittedEntrants.delete(playerId);
    }
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
      // Doors 1.5b — the queue just gained a human, which is the only
      // moment the taper answer can change. Dark unless BELL_TAPER=on.
      this.maybeTaperForQueue();
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
      this.maybeTaperForQueue(); // Doors 1.5b, see the FFA branch above
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
    // Doors 1.6 — the `?fight` fast lane. The north-star gate is "URL →
    // first shot under 15 s", and landing in the venue and then WALKING to
    // the bell totem is most of that gap. A visitor who arrived through the
    // fast lane is queued on arrival instead.
    //
    // Routed through the same `toggleQueue` a totem touch uses, so the
    // callsign gate (a nameless visitor still cannot queue — S2.C.3) and
    // the duo branch hold identically: this adds a TRIGGER, not a second
    // queue path. Guarded on membership because toggleQueue is a toggle —
    // a reconnect inside the same bell would otherwise queue, then UNqueue,
    // which is precisely the "silently dropped from the queue" class of bug
    // Doors 1.3/1.4 just finished closing.
    if ((ws.data as { fastQueue?: boolean }).fastQueue) {
      this.ensureQueued(playerId);
    }
  }

  /** Queue this player unless they are already in a queue — an idempotent
   *  wrapper over the toggle, for arrival-time entry (Doors 1.6). */
  private ensureQueued(playerId: PlayerId): void {
    if (this.readyQueue.has(playerId) || this.duoQueue.has(playerId)) return;
    this.toggleQueue(playerId);
  }

  /**
   * Doors 1.5b — when a human is waiting at the bell, shorten the bout in
   * progress so they wait less. ⚠ DECISION 2 (cadence) is Jake's, so this
   * is DARK by default: `BELL_TAPER=on` to enable, and with it unset the
   * host behaves exactly as before (L4 — build it, flag it, never fire it
   * on silence).
   *
   * Called on queue entry rather than on a timer: the queue growing from
   * empty is the only moment the answer can change, and the arena host
   * itself refuses any taper that would end the bout on the spot.
   *
   * Recommended default if ratified: ON. The measured median bell wait is
   * ~50 s against a <15 s north-star gate, and this is the only lever that
   * shortens the wait without touching the fight's own pacing for players
   * who are already in it.
   */
  private maybeTaperForQueue(): void {
    if (process.env.BELL_TAPER !== "on") return;
    if (this.readyQueue.size === 0 && this.duoQueue.size === 0) return;
    this.arenaHost.taperForQueuedHumans();
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
        // A group index only means anything relative to the class it was
        // computed against (Part B) — a real class switch starts the
        // cycle fresh, same "no stale carry-over" call setPlayerCharacter
        // makes for the live entity's resources/cooldowns.
        entry.cycleIndex = undefined;
      }
      // Live chassis switch (Part A follow-up, Jake: "when you switch
      // loudouts and classes it SHOULD REALLY switch") — the lobby
      // visitor's actual standing PlayerEntity swaps chassis immediately
      // too, not just the catalog grid this handler already re-derives.
      // No-op (own guard) if `characterId` isn't actually changing (e.g.
      // the same-class no-op case just above). See
      // `MatchHost.setPlayerCharacter`'s own doc for exactly what resets.
      this.lobbyHost.setPlayerCharacter(playerId, characterId);
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
    // Loadout-station catalog CYCLE (Part B, 2026-07-19 — Jake: "an ability
    // show case room where we can exhaustveily test all and every single
    // ability"). Replaces the ENTIRE rack (not just actives — the
    // `c.active !== undefined` filter below is a generic defensive check,
    // not built for any specific class; every classId-gated catalog card
    // in the game is active-only as of the same-day Crater/Retort/Bastion
    // cut, docs/card-pool-v2.md #26-28) with the next
    // (or previous) group of ≤ MAX_ABILITY_SLOTS actives from
    // `catalogForClass(entry.classId)`, wrapping around, and live-applies
    // it exactly like `catalog-toggle` does. No-op if the station hasn't
    // been touched yet (no entry) or the class has zero active catalog
    // cards (shouldn't happen for any of the 4 classes today, but a
    // defensive no-op beats a divide-by-zero group count).
    if (decoded?.message.t === "catalog-cycle") {
      const playerId = PlayerId(ws.data.playerId);
      const entry = this.loadouts.get(playerId);
      if (!entry) return;
      const activeIds = catalogForClass(entry.classId)
        .filter((c) => c.active !== undefined)
        .map((c) => c.id);
      if (activeIds.length === 0) return;
      const groupCount = Math.ceil(activeIds.length / MAX_ABILITY_SLOTS);
      const direction = decoded.message.direction;
      // First-ever cycle: "next" starts at the first group, "prev" starts
      // at the last — both read as "the nearest group in that direction"
      // rather than an arbitrary always-group-0 landing regardless of
      // which button was pressed.
      const nextIndex =
        entry.cycleIndex === undefined
          ? direction === "prev"
            ? groupCount - 1
            : 0
          : (((entry.cycleIndex + (direction === "prev" ? -1 : 1)) % groupCount) + groupCount) %
            groupCount;
      entry.cycleIndex = nextIndex;
      const start = nextIndex * MAX_ABILITY_SLOTS;
      entry.picks = activeIds.slice(start, start + MAX_ABILITY_SLOTS);
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
  /** Sum of every destructible's health in the lobby world. */
  private lobbyDummyHealth(): number {
    const st = (
      this.lobbyHost as unknown as { getStateSnapshot?: () => { destructibles: Record<string, { health: number }> } }
    ).getStateSnapshot?.();
    if (!st) return -1;
    let total = 0;
    for (const id in st.destructibles) total += st.destructibles[id]!.health;
    return total;
  }

  private lobbyHumanX(): number {
    const st = (
      this.lobbyHost as unknown as {
        getStateSnapshot?: () => { players: Record<string, { x: number }> };
      }
    ).getStateSnapshot?.();
    if (!st) return -1;
    for (const id in st.players) {
      if (!id.startsWith("bot_")) return Math.round(st.players[id]!.x);
    }
    return -1;
  }

  private lobbyPlayerCount(): number {
    const st = (
      this.lobbyHost as unknown as { getStateSnapshot?: () => { players: Record<string, unknown> } }
    ).getStateSnapshot?.();
    return st ? Object.keys(st.players).length : -1;
  }

  summary(): VenueSummary {
    const arena = this.arenaHost.summary();
    // The LOBBY's own phase, not just the arena's (gospel E2-b). Hangout
    // mode is defined to hold "fighting" forever and never run a round
    // machine, so this field is a standing assertion about the venue: any
    // other value means hangout semantics are not in force. It was
    // unobservable from outside the process until now, which is why the
    // lobby could sit in the wrong phase live while every in-process test
    // said it could not.
    const lobbySummary = this.lobbyHost.summary();
    return {
      lobby: {
        present: this.lobbySockets.size,
        phase: lobbySummary?.phase ?? null,
        // venue 2.5 — the practice dummies' total health, server-side.
        // Every client-side probe so far agrees that a visitor firing at
        // point-blank range never damages one, and every client-side probe
        // is consistent with BOTH "the shot never reaches the server" and
        // "the server ignores it". This number discriminates: if it falls
        // while someone is shooting, the sim is fine and the bug is in the
        // client's rendering of it; if it never falls, the shot is not
        // reaching the hit path at all.
        dummyHealth: this.lobbyDummyHealth(),
        players: this.lobbyPlayerCount(),
        // Discriminator for the above: if lastProcessedInputSeq is simply
        // not maintained on this path, the server will still SEE the human
        // moving. If both are frozen, input genuinely is not arriving.
        humanX: this.lobbyHumanX(),
        fireInputsSeen: (this.lobbyHost as unknown as { fireInputsSeen: number }).fireInputsSeen,
        lastFireAim: [
          (this.lobbyHost as unknown as { lastFireAimX: number }).lastFireAimX,
          (this.lobbyHost as unknown as { lastFireAimY: number }).lastFireAimY,
        ],
      },
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

  /** Test surface: whether a live admission ticket exists (open-doors 1.3). */
  admissionForTest(playerId: PlayerId): boolean {
    return this.hasAdmission(playerId);
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
      // Loadout table ally NPCs (docs/venue-lobby-tableau-goal.md Part 2,
      // 2026-07-18): every lobby visitor shares LOBBY_PRACTICE_TEAM_ID with
      // the two stationary ally NPCs so `isAlly()` reads true and ally-
      // targeted abilities (Aegis Share, Rally Light, Borrowed Time, Glass
      // Ward, Haste Gift) can be tested for real, not just their solo-
      // fallback. Safe: the lobby has zero PvP/scoring, so "everyone's on
      // one team" here has no gameplay meaning beyond this.
      teamId: LOBBY_PRACTICE_TEAM_ID,
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
