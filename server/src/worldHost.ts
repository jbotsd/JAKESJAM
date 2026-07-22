// WorldHost — process-wide singleton MatchHost for io-style always-on play.
//
// One MatchHost serves every `/ws/world` connection. Players drift in
// and out continuously; the round timer keeps rolling regardless of
// who's connected. Reuses the existing MatchHost class wholesale —
// only the lifecycle differs (singleton vs per-room map).
//
// Why a thin wrapper instead of patching MatchHost itself:
//   - Keeps the room-flow path unmodified during the io rollout.
//   - Lets the architecture-deepening agent (parallel work) land its
//     MatchHost partition cleanly — we don't reach inside MatchHost,
//     just hold one instance of it.

import type { ServerWebSocket } from "bun";
import {
  MatchHost,
  type MatchSocketData,
} from "./matchHost.ts";
import { WorldBots } from "./worldBots.ts";
import { STEP_MS } from "@sim/index.ts";
import { isBotId } from "@sim/botId.ts";
import { PlayerId, type PlayerSpawnInfo } from "@sim/types.ts";
import { DEFAULT_MAP_ID, isMapId, resolveMap, type MapId } from "@sim/data/maps.ts";
import { convexClient, type ConvexId } from "./convexClient.ts";

const WORLD_MATCH_ID = "world";

/**
 * Map rotation pool. Two intentions:
 *   1. Once round-rotation lands (DEFER), the host steps through this list at
 *      round boundaries. For now `nextMapId()` always returns the head; flipping
 *      the constructor option `rotateMaps: true` enables round-rotation.
 *   2. Tested in __tests__/worldHost.test.ts to guard against a regression where
 *      a typo in `MapId` literal silently falls back to `DEFAULT_MAP_ID`.
 */
// Hot Lobby rotation: mega Vessel Nexus first, then vertical Spire Dock.
// Full multi-cell "boxworks" stays room-picker only.
const ROTATION_MAPS: readonly MapId[] = ["vessel-nexus", "boxworks-tower"];

/**
 * How many recycles between curated-map appearances. Slots that aren't
 * curated roll a seeded procgen arena ("gen:<seed>") — the seed rides in
 * the mapId, so clients expand the identical map deterministically. See
 * docs/map-design.md + client/src/sim/data/mapGen.ts (validator-gated).
 */
const GEN_SLOTS_PER_CURATED = 2;

const WORLD_COLOR_PALETTE = [
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
] as const;

/**
 * Perf audit G (2026-07-18): `botFloor` was a flat constant regardless of
 * map area, so boxworks-tower (the smaller of the two ROTATION_MAPS) ran
 * roughly 2x the elastic-bot population DENSITY of vessel-nexus for the
 * same floor setting — directly compounding the AOI/rig-cost findings
 * elsewhere in this audit on the exact map that reported the lag. Reference
 * area = the default/"a full room's worth of combatants" map, vessel-nexus;
 * smaller maps scale the effective floor down, never up.
 */
const REFERENCE_MAP_AREA = (() => {
  const m = resolveMap(DEFAULT_MAP_ID);
  return m.size.x * m.size.y;
})();

function pickColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return WORLD_COLOR_PALETTE[hash % WORLD_COLOR_PALETTE.length]!;
}

export class WorldHost {
  /**
   * The singleton MatchHost instance. Lazily constructed on first
   * `attach()` so the bun server can boot before anyone connects.
   */
  private host: MatchHost | null = null;
  private readonly mapId: MapId;
  private readonly rotateMaps: boolean;
  /** Live sockets by player — maintained across host recycles so a
   *  completed match can migrate everyone into the replacement host. */
  private readonly sockets = new Map<PlayerId, ServerWebSocket<MatchSocketData>>();
  /** The bell gate's waiting room (S2.D): NEW players who attached mid-
   *  fight, keyed to their chosen name. Drained into the sim at the next
   *  countdown edge; disconnect dequeues. Spectator-pending in the
   *  meantime — attached (hello + snapshots) but no entity. */
  private readonly pendingEntrants = new Map<PlayerId, string | undefined>();
  /** Pending recycle timer (results-display hold). */
  private recycleTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long the final scoreboard stays up before the world rolls a new
   *  match — the ANTI-STALL CEILING for quiet/AFK lobbies, not the normal-
   *  case wait (see markRematchReady, which recycles early once every
   *  connected player has clicked Rematch). Overridable for tests. */
  private readonly resultsHoldMs: number;
  /** Players who've clicked "Rematch" during the current results hold.
   *  Cleared at the top of every recycle() — scoped to one match-end wait. */
  private readonly rematchReady = new Set<PlayerId>();
  /** Server-side AI duelists that keep the world alive. Count via the
   *  WORLD_BOTS env (host-public.sh default 2 — enough motion, not a gang). */
  private readonly botCount: number;
  /** Explicit package-evidence seam. Never enabled by product hosting: an
   * isolated evidence server may insert a browser into the authoritative
   * arena immediately instead of waiting for the public bell cadence. */
  private readonly forceImmediateJoin: boolean;
  private readonly bots = new WorldBots();
  private botTimer: ReturnType<typeof setInterval> | null = null;
  /** Index into ROTATION_MAPS used by `nextMapId`. Reset alongside host
   *  rebuild when the existing host is torn down for any reason. */
  private rotationCursor = 0;
  /** Venue tap on the arena's round-phase edges (set by VenueHost after
   *  construction — index.ts builds WorldHost first, then wraps it).
   *  Mutable on purpose; buildHost forwards through a closure so hosts
   *  built before the venue attaches still fire once it has. */
  onRoundPhaseChange?: (
    prev: "countdown" | "fighting" | "round-over" | "drafting",
    next: "countdown" | "fighting" | "round-over" | "drafting",
  ) => void;
  /** Starter-card provider (S2.E) — set by VenueHost after construction,
   *  same late-binding pattern as onRoundPhaseChange. Consulted once per
   *  entrant at insertion; undefined (or a null return) = plain spawn, so
   *  WorldHost stays venue-agnostic (tests, legacy, direct connects). */
  getEntrantCards?: (playerId: PlayerId) => string[] | undefined;
  /** Duos-queue team provider (classes-goal.md "Venue integration") — set
   *  by VenueHost after construction, same late-binding pattern as
   *  getEntrantCards. Consulted once per entrant at insertion; undefined =
   *  an ordinary FFA combatant, so WorldHost stays venue-agnostic (tests,
   *  legacy, direct connects never set this and never see any behavior
   *  change). */
  getEntrantTeamId?: (playerId: PlayerId) => string | undefined;
  /** Elastic-bot floor (S2.E): bot count adjusts toward
   *  `max(0, botFloor - humansFighting)` at bell edges ONLY, capped at 6.
   *  0 (default) disables elasticity — the legacy fixed `bots` count rules. */
  private readonly botFloor: number;
  /** Public-world mode rules, carried through every host recycle. */
  private readonly modeModifierIds: string[];
  /** Uniqueness counter for bot-only duo teamIds minted by
   *  `planBotTeams` — see its doc for the pairing rule. */
  private botTeamCounter = 0;
  /** Area (px²) of the map the live host is currently on — updated in
   *  `buildHost()` whenever a new map is resolved. Feeds `scaledBotFloor`
   *  (perf audit G). Defaults to the reference area so the very first
   *  boot (before any buildHost() call) scales as if on vessel-nexus. */
  private currentMapArea: number = REFERENCE_MAP_AREA;

  constructor(
    opts: {
      mapId?: MapId | string;
      rotateMaps?: boolean;
      resultsHoldMs?: number;
      bots?: number;
      botFloor?: number;
      forceImmediateJoin?: boolean;
      modeModifierIds?: readonly string[];
    } = {},
  ) {
    this.modeModifierIds = [...(opts.modeModifierIds ?? [])];
    this.botFloor = Math.max(0, Math.min(6, opts.botFloor ?? 0));
    // Was a flat 6000ms with no readiness gate — the "goes too fast into
    // the next game" complaint (Jake, 2026-07-13). Raised to 12000ms as the
    // fallback ceiling; markRematchReady() below recycles early once every
    // connected player has actually clicked Rematch, so this only matters
    // for a quiet/AFK lobby that never signals ready.
    this.resultsHoldMs = opts.resultsHoldMs ?? 12000;
    // Cap 6 — 4+ on mega docks felt like a firing squad for solo humans.
    this.botCount = Math.max(0, Math.min(6, opts.bots ?? 0));
    this.forceImmediateJoin = opts.forceImmediateJoin === true;
    if (this.botCount > 0 || this.botFloor > 0) {
      // Bot brains tick at sim rate; think() no-ops while the host loop
      // is stopped (empty world), so idle cost is a timer wakeup.
      this.botTimer = setInterval(() => {
        if (this.host) this.bots.think(this.host, Date.now());
      }, STEP_MS);
    }
    // Validate the constructor mapId at the boundary so a typo is loud,
    // not silent. Prior code passed the raw mapId straight into MatchHost,
    // which then `resolveMap()`d back to DEFAULT_MAP_ID on miss — producing a
    // running but wrong-arena world. Now we throw at boot.
    if (opts.mapId !== undefined && !isMapId(opts.mapId) && !opts.mapId.startsWith("gen:")) {
      throw new Error(
        `WorldHost: unknown mapId "${opts.mapId}". Known: vessel-nexus, skyseam, boxworks, boxworks-mini, boxworks-tower, gen:<seed>`,
      );
    }
    this.mapId = (opts.mapId as MapId | undefined) ?? DEFAULT_MAP_ID;
    this.rotateMaps = opts.rotateMaps ?? false;
    // Eager-boot when bots are configured: the always-on world should be
    // live (rounds advancing, drafting cycling) before the first human opens
    // the share link — otherwise /health shows world=null and visitors land
    // in a frozen arena.
    if (this.botCount > 0 || this.botFloor > 0) {
      // buildHost tops the roster up to the elastic target (botFloor) or
      // the legacy fixed count — an empty spawn list is fine either way.
      this.host = this.buildHost([]);
      this.host.ensureTickLoop();
    }
  }

  /**
   * Hand a fresh socket to the singleton host. Lazily boots the host
   * on first connect using the new player as the seed spawn (MatchHost
   * requires at least one PlayerSpawnInfo at construction).
   *
   * THE BELL GATE (venue-sprint2-goal S2.D): a NEW player only ever
   * enters the fight at a round boundary. Attaching mid-fight (fighting/
   * round-over/drafting) parks them as a spectator-pending entrant —
   * they get hello + snapshots (they can watch) but NO entity until the
   * next countdown entry drains the pending set. Attaching during
   * countdown drains immediately (countdown IS the entry edge). A
   * reconnect within RECONNECT_GRACE_MS bypasses the gate by
   * construction: their entity still exists, so `hasPlayer` short-
   * circuits to a pure socket re-attach — entity continuity, no re-queue.
   *
   * Race safety: JS is single-threaded so concurrent attach calls cannot
   * race the `if (!this.host)` check, BUT `MatchHost`'s constructor is
   * synchronous in current code — if it ever becomes async (e.g. if it
   * starts awaiting a Convex lookup for chaosModifiers), this would need
   * to gate with a Promise<MatchHost> sentinel. Comment so we remember.
   */
  attach(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    this.sockets.set(playerId, ws);
    const chosenName = (ws.data as { name?: string }).name;
    if (!this.host) {
      const spawn = this.spawnFor(ws.data.playerId, chosenName, characterOf(ws));
      // A fresh host boots into countdown — seeding the first player here
      // IS a countdown entry, not a gate exception.
      // WorldHost doesn't have a room to read chaos modifiers from, so we fall back
      // to the no-chaos baseline. Future workitem: add a lightweight Convex world token
      // endpoint that exposes a default/modifiable chaos set for the always-on world.
      this.host = this.buildHost([spawn]);
    } else if (!this.host.hasPlayer(playerId)) {
      if (this.forceImmediateJoin) {
        // Forced package harness only. This still creates a normal player in
        // the normal MatchHost; it bypasses admission cadence, not authority.
        this.insertEntrant(playerId, chosenName, ws);
      } else {
        // Production: countdown is the only insertion edge (S2.D.4).
        this.pendingEntrants.set(playerId, chosenName);
        if (this.host.summary().phase === "countdown") {
          this.drainPendingEntrants();
        }
      }
    }
    this.host.attachClient(ws);
  }

  /**
   * Countdown-entry drain (S2.D): insert every pending entrant whose
   * socket is still live. Runs on the phase edge INTO countdown (wired in
   * buildHost) and synchronously from attach() when the world is already
   * in countdown. Disconnected pendings were already dequeued by detach();
   * the readyState check is belt-and-braces for a socket that died without
   * a close event yet.
   */
  private drainPendingEntrants(): void {
    if (!this.host) return;
    for (const [playerId, chosenName] of this.pendingEntrants) {
      const ws = this.sockets.get(playerId);
      if (!ws || ws.readyState !== 1) continue;
      this.insertEntrant(playerId, chosenName, ws);
    }
    this.pendingEntrants.clear();
    this.adjustElasticBots();
  }

  /** One authoritative human insertion implementation shared by the public
   * countdown edge and the opt-in isolated evidence seam. */
  private insertEntrant(
    playerId: PlayerId,
    chosenName: string | undefined,
    ws: ServerWebSocket<MatchSocketData>,
  ): void {
    if (!this.host || this.host.hasPlayer(playerId)) return;
    const cards = this.getEntrantCards?.(playerId);
    const teamId = this.getEntrantTeamId?.(playerId);
    this.host.addPlayer({
      ...this.spawnFor(playerId, chosenName, characterOf(ws)),
      ...(cards && cards.length > 0 ? { cards } : {}),
      ...(teamId ? { teamId } : {}),
    });
  }

  /**
   * Elastic persona bots (S2.E): one formula, one edge. Runs ONLY from the
   * countdown-entry drain above — bots enter and leave at the bell, never
   * mid-fight. Target = max(0, botFloor - humansFighting), cap 6; botFloor
   * 0 (default) disables the whole mechanism (fixed-bot worlds, tests).
   *
   * Team floors (classes-goal.md "Venue integration" — "Elastic bots
   * respect team floors"): the headcount formula above is UNCHANGED.
   *
   * FFA bell (nobody fighting carries a `teamId`): the EXACT pre-duos
   * add/remove-the-tail logic, untouched code path, byte-identical
   * behavior to before this feature existed.
   *
   * Team-mode bell (at least one human carries a `teamId` — stamped via
   * `getEntrantTeamId` in `drainPendingEntrants` above, readable off the
   * live roster via `MatchHost.rosterInfo`): the whole bot slate is
   * reconciled against `planBotTeams`'s plan rather than only patching
   * newly-added slots. Reason: the arena is always eager-booted to
   * `botFloor` teamless bots with 0 humans, so a duo admission is
   * ALWAYS a headcount *shrink* from that baseline (never a pure add) —
   * the "add-only" version of this method left survivors of the shrink
   * with whatever stale (usually teamless) assignment they already had,
   * which fails the acceptance case ("2 humans duo + floor 4 → the other
   * 2 bot-filled as an opposing duo") on the very first bell. Bots are
   * cheap, stateless-enough server citizens — `WorldBots.spawnInfosFor`
   * keeps each persona's identity (id/name) stable across this remove+
   * re-add regardless, so this only costs a position reset, not an
   * identity change. Skipped entirely when the live slate already
   * matches the plan, so a steady-state team-mode bell (nothing changed
   * since last time) causes zero churn.
   */
  /** Perf audit G (2026-07-18): scale the configured floor down for a map
   *  smaller than the reference (vessel-nexus) — never up for a bigger one,
   *  since `botFloor` is a ceiling/target, not a minimum. */
  private scaledBotFloor(): number {
    if (this.botFloor === 0) return 0;
    const ratio = Math.min(1, this.currentMapArea / REFERENCE_MAP_AREA);
    return Math.max(0, Math.min(this.botFloor, Math.round(this.botFloor * ratio)));
  }

  private adjustElasticBots(): void {
    if (!this.host || this.botFloor === 0) return;
    const state = this.host.getStateSnapshot();
    const ids = Object.keys(state.players);
    const humans = ids.filter((id) => !isBotId(id)).length;
    const liveBots = ids.filter((id) => isBotId(id));
    const target = Math.max(0, Math.min(6, this.scaledBotFloor() - humans));
    const humanTeams = this.humanTeamCounts(ids);

    if (humanTeams.size === 0) {
      // Ordinary FFA bell — exact pre-duos body.
      if (liveBots.length < target) {
        // spawnInfosFor returns the full persona roster up to `target` —
        // existing brains keep their identity, new ones register on demand.
        for (const b of this.bots.spawnInfosFor(target)) {
          if (!this.host.hasPlayer(b.playerId)) {
            this.addBot(b.playerId, b.name, b.characterId);
          }
        }
      } else if (liveBots.length > target) {
        // Displaced bots simply sit out (no lobby idling this sprint) —
        // remove the roster tail so persona identities stay stable.
        for (const id of liveBots.sort().slice(target)) {
          this.host.removeRosterPlayer(PlayerId(id));
        }
      }
      return;
    }

    // Team mode: reconcile the whole bot slate against the plan.
    const desc = this.bots.spawnInfosFor(target);
    const teamPlan = this.planBotTeams(desc.length, humanTeams);
    const desiredIds = desc.map((b) => b.playerId as string).sort();
    const currentIds = liveBots.slice().sort();
    const idsMatch =
      currentIds.length === desiredIds.length &&
      currentIds.every((id, i) => id === desiredIds[i]);
    const currentTeams = currentIds
      .map((id) => this.host!.rosterInfo(PlayerId(id))?.teamId)
      .sort();
    const desiredTeams = [...teamPlan].sort();
    const teamsMatch = JSON.stringify(currentTeams) === JSON.stringify(desiredTeams);
    if (idsMatch && teamsMatch) return; // already correct — no churn

    for (const id of liveBots) this.host.removeRosterPlayer(PlayerId(id));
    desc.forEach((b, index) => this.addBot(b.playerId, b.name, b.characterId, teamPlan[index]));
  }

  /** The one bot-insertion call site (structural test S2.D.4 counts every
   *  roster-insertion call in this file) — both branches of
   *  `adjustElasticBots` funnel through here. */
  private addBot(
    playerId: PlayerId,
    name: string,
    characterId: PlayerSpawnInfo["characterId"],
    teamId?: string,
  ): void {
    this.host!.addPlayer(this.botSpawn(playerId, name, characterId, teamId));
  }

  /** Team composition of currently-known humans, keyed by teamId — feeds
   *  `planBotTeams`. Humans with no teamId (ordinary FFA combatants) are
   *  excluded, so a bell with zero duo admissions yields an empty map and
   *  `planBotTeams`'s short-circuit keeps every bot teamless (byte-
   *  identical to pre-duos behavior). */
  private humanTeamCounts(ids: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const id of ids) {
      if (isBotId(id)) continue;
      const teamId = this.host?.rosterInfo(PlayerId(id))?.teamId;
      if (teamId) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Team-floor pairing plan for `slotCount` bot slots (classes-goal.md
   * "Venue integration" — "Elastic bots respect team floors"): a duo-mode
   * match wants bots filling out TEAM SLOTS, not a raw headcount floor.
   *
   * Rule, applied once per bell edge, deterministic:
   *   1. `humanTeams.size === 0` (no duo admission this bell — the
   *      ordinary FFA case): every slot stays `undefined`. This is the
   *      branch that matters for regression safety — an FFA bell's bots
   *      are byte-identical to before this feature existed.
   *   2. Any human team sitting at exactly 1 member (a lone duo-mode
   *      queuer who reached the bell with no human partner — "auto-pair
   *      … with an elastic bot partner", classes-goal.md) is topped up:
   *      the next available slot gets that SAME teamId (an ally bot).
   *   3. Remaining slots pair up two at a time into fresh bot-only teams
   *      (`bot-duo-<n>`) — "the other 2 should be bot-filled as an
   *      opposing duo". A trailing odd slot (the floor doesn't divide
   *      evenly) stays teamless rather than crash or half-pair.
   *
   * TEAM_SIZE is fixed at 2 (duos) — classes-goal.md's roadmap is duos
   * first; nothing here assumes it can't grow to larger teams later.
   */
  private planBotTeams(
    slotCount: number,
    humanTeams: ReadonlyMap<string, number>,
  ): (string | undefined)[] {
    const plan: (string | undefined)[] = new Array(slotCount).fill(undefined);
    if (humanTeams.size === 0) return plan;
    let cursor = 0;
    for (const [teamId, count] of humanTeams) {
      if (count === 1 && cursor < slotCount) {
        plan[cursor] = teamId;
        cursor += 1;
      }
    }
    while (cursor + 1 < slotCount) {
      const teamId = `bot-duo-${this.botTeamCounter}`;
      this.botTeamCounter += 1;
      plan[cursor] = teamId;
      plan[cursor + 1] = teamId;
      cursor += 2;
    }
    return plan;
  }

  private buildHost(spawns: PlayerSpawnInfo[]): MatchHost {
    const mapId = this.nextMapId();
    // Resolved once, up front, so both the area-scaled bot floor (below)
    // and the nav-mesh bind (bindMap) use the SAME map object.
    const map = resolveMap(mapId);
    this.currentMapArea = map.size.x * map.size.y;
    // Bots ride along in every host build (including recycles). A fresh
    // build IS a bell edge, so with elasticity on (botFloor > 0) the count
    // sizes to the humans actually spawning; otherwise the legacy fixed
    // count rules.
    const humanSpawns = spawns.filter((sp) => !isBotId(sp.playerId)).length;
    const botTarget =
      this.botFloor > 0
        ? Math.max(0, Math.min(6, this.scaledBotFloor() - humanSpawns))
        : this.botCount;
    const botSpawns = this.bots
      .spawnInfosFor(botTarget)
      .filter((b) => !spawns.some((sp) => sp.playerId === b.playerId))
      .map((b) => this.botSpawn(b.playerId, b.name, b.characterId));
    // Map-aware brains: cover / hop / LOS for the arena they're actually on.
    this.bots.bindMap(map);
    return new MatchHost(WORLD_MATCH_ID, [...spawns, ...botSpawns], this.modeModifierIds, mapId, {
      onMatchComplete: () => this.scheduleRecycle(),
      // Threaded through EVERY host build (recycles included) so venue
      // status frames / the bell drain never silently detach after a
      // cycle end (venue-sprint2-goal S2.B/S2.D).
      onRoundPhaseChange: (prev, next) => {
        // The bell rings: entering countdown is THE entry edge — admit
        // everyone the gate parked during the last fight (S2.D).
        if (next === "countdown") this.drainPendingEntrants();
        this.onRoundPhaseChange?.(prev, next);
      },
    });
  }

  private botSpawn(
    playerId: PlayerId,
    name: string,
    characterId: PlayerSpawnInfo["characterId"],
    teamId?: string,
  ): PlayerSpawnInfo {
    return {
      playerId,
      characterId,
      name: `BOT · ${name}`,
      // Amber — the client also colors bot rigs by the bot_ id prefix, but
      // the roster color keeps room-mode consistent too.
      color: "#ffb454",
      weaponId: "starter-pistol",
      // Team-floor pairing (classes-goal.md "Venue integration") — see
      // planBotTeams. Omitted key when undefined, same object shape as
      // every FFA bell before this feature existed.
      ...(teamId ? { teamId } : {}),
    };
  }

  /**
   * A match just completed (someone reached the target score). The round
   * machine deliberately parks in round-over so the results UI can show —
   * in room mode the registry tears the host down, but the always-on world
   * must ROLL ON. After a short scoreboard hold, rebuild the host on the
   * next rotation map and migrate every live socket into it. Without this
   * the world stays parked in round-over forever (observed live 2026-07-03).
   */
  private scheduleRecycle(): void {
    if (this.recycleTimer) return;
    this.recycleTimer = setTimeout(() => {
      this.recycleTimer = null;
      this.recycle();
    }, this.resultsHoldMs);
  }

  /**
   * A player clicked "Rematch" on the results overlay. Once every currently
   * -connected socket has signaled ready, recycle right away instead of
   * waiting out the rest of the resultsHoldMs anti-stall ceiling — this is
   * what makes the Rematch button (previously a no-op `hide()`) actually do
   * something (Jake, 2026-07-13: "it goes too fast... the rematch score
   * screen and timing of it" — the fix is making the fast path opt-in and
   * player-driven instead of a forced timer either way).
   */
  markRematchReady(playerId: PlayerId): void {
    this.rematchReady.add(playerId);
    if (!this.recycleTimer) return; // no match-over hold pending right now
    const connected = [...this.sockets.values()].filter((ws) => ws.readyState === 1).length;
    if (connected > 0 && this.rematchReady.size >= connected) {
      clearTimeout(this.recycleTimer);
      this.recycleTimer = null;
      this.recycle();
    }
  }

  private recycle(): void {
    this.rematchReady.clear();
    const old = this.host;
    if (!old) return;
    // Drop sockets that closed while the scoreboard was up.
    for (const [pid, ws] of this.sockets) {
      if (ws.readyState !== 1) this.sockets.delete(pid);
    }
    if (this.sockets.size === 0) {
      if (this.botCount > 0 || this.botFloor > 0) {
        // ALWAYS-ON ARENA (venue-sprint2-goal S2.F): with the venue as the
        // front room, nobody direct-joins the arena anymore — if the world
        // lazily rebooted to null here, venue-status would go dark and the
        // bell could never ring (no phase edges → queued lobby players
        // deadlock). A bots-configured world rolls a fresh cycle instead.
        this.host = this.buildHost([]);
        old.dispose();
        this.host.ensureTickLoop();
        console.log(
          `[worldHost] match complete with no humans — bots roll the next cycle (map=${this.host.summary().mapId})`,
        );
        return;
      }
      // No bots configured — tear down and lazy-boot on the next attach.
      old.dispose();
      this.host = null;
      console.log("[worldHost] match complete with no players — world reset (lazy reboot)");
      return;
    }
    // A recycle IS a countdown entry (the fresh host boots into countdown):
    // every connected socket — including gate-parked pending entrants —
    // spawns into the new cycle. Chosen names ride the socket data (they
    // previously fell back to machine ids across recycles). Team
    // assignment (classes-goal.md "Venue integration") rides along too —
    // read off the OLD host's roster before it's disposed, so a duo mid-
    // cycle isn't shuffled apart by a match-complete rollover. Elastic
    // bots for the fresh cycle's FIRST round stay teamless regardless
    // (buildHost's own bot construction, not adjustElasticBots — see its
    // doc); they pick up the correct team pairing at the next round-
    // boundary bell within the new cycle.
    const spawns = [...this.sockets.entries()].map(([pid, ws]) => {
      const teamId = old.rosterInfo(PlayerId(pid))?.teamId;
      return {
        ...this.spawnFor(pid, (ws.data as { name?: string }).name, characterOf(ws)),
        ...(teamId ? { teamId } : {}),
      };
    });
    this.pendingEntrants.clear();
    this.host = this.buildHost(spawns);
    old.dispose();
    for (const ws of this.sockets.values()) {
      // attachClient sends a fresh ServerHello (new map + startTick); the
      // client re-renders the arena and resyncs off the first full snapshot.
      this.host.attachClient(ws);
    }
    console.log(
      `[worldHost] recycled world after match completion — map=${this.host.summary().mapId} players=${this.sockets.size}`,
    );
  }

  /**
   * Return the next mapId for a host construction. Rotation is opt-in via
   * `rotateMaps: true` in the constructor options; without it, every call
   * returns `this.mapId`. Wired here so a future "rotate at round-end"
   * feature can call this without further plumbing.
   */
  private nextMapId(): MapId | string {
    if (!this.rotateMaps) return this.mapId;
    const slot = this.rotationCursor;
    this.rotationCursor += 1;
    // Pattern with GEN_SLOTS_PER_CURATED=2: curated, gen, gen, curated, …
    // Curated slots walk ROTATION_MAPS; gen slots roll a fresh seed.
    // Seed choice is SERVER-side only (transmitted via mapId), so wall
    // clock is fine here — expansion from the seed is what must be pure.
    if (slot % (GEN_SLOTS_PER_CURATED + 1) === 0) {
      const idx = Math.floor(slot / (GEN_SLOTS_PER_CURATED + 1));
      return ROTATION_MAPS[idx % ROTATION_MAPS.length]!;
    }
    return `gen:${Math.floor(Date.now() / 1000) % 1_000_000}`;
  }

  route(ws: ServerWebSocket<MatchSocketData>, raw: Buffer | ArrayBuffer | Uint8Array): void {
    if (!this.host) {
      ws.close(1011, "no world");
      return;
    }
    this.host.routeMessage(ws, raw);
  }

  detach(ws: ServerWebSocket<MatchSocketData>): void {
    const playerId = PlayerId(ws.data.playerId);
    if (this.sockets.get(playerId) === ws) {
      this.sockets.delete(playerId);
      // A pending spectator who leaves before the bell is cleanly
      // dequeued — no ghost entrants at the drain (S2.D.5).
      this.pendingEntrants.delete(playerId);
    }
    if (!this.host) return;
    this.host.detachClient(ws);
    // Note: unlike MatchRegistry, we deliberately do NOT tear down the
    // host when client count hits zero. The world is always-on; an empty
    // room is still a room. Rounds keep rolling against whatever players
    // are present (or none, in which case stepWithRuntime sees an empty
    // players record and the round timer drifts toward time-out → null
    // winner → next round). When a player rejoins the existing host
    // welcomes them.
  }

  /** Diagnostic — reflected in /health. */
  size(): number {
    return this.host ? 1 : 0;
  }

  /**
   * Public summary surfaced through HTTP /health. `null` when the
   * world hasn't booted yet (no players have ever connected). The
   * client status badge polls this every few seconds.
   */
  summary(): ReturnType<MatchHost["summary"]> | null {
    return this.host ? this.host.summary() : null;
  }

  private spawnFor(
    playerIdRaw: string,
    chosenName?: string,
    characterId?: PlayerSpawnInfo["characterId"],
  ): PlayerSpawnInfo {
    return {
      playerId: PlayerId(playerIdRaw),
      // Chassis pick (classes-goal.md P1): sanitized at the ws upgrade
      // (index.ts, net/playerCharacter.ts whitelist) — fallback stays the
      // default chassis so old clients keep working.
      characterId: characterId ?? "balanced",
      // Player-chosen name (sanitized at the ws upgrade) — fallback stays
      // the id so old clients keep working.
      name: chosenName ?? playerIdRaw,
      color: pickColor(playerIdRaw),
      weaponId: "starter-pistol",
    };
  }
}

/** Duck-read the upgrade-sanitized chassis off SocketData — the same shape
 *  trick the `name` reads use (index.ts owns the widened type). Exported
 *  for VenueHost's lobby-side spawn (one read, one rule). */
export function characterOf(
  ws: ServerWebSocket<MatchSocketData>,
): PlayerSpawnInfo["characterId"] | undefined {
  return (ws.data as { character?: PlayerSpawnInfo["characterId"] }).character;
}

// Construction is now done in server/src/index.ts at boot time and the
// instance is passed explicitly to the WS handler closure. Removing the
// module-level singleton makes the host testable, swappable, and
// guarantees `index.ts` controls lifecycle ordering.
