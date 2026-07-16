# The Venue — the exhaustive, elegant, complete goal

**Status:** North star + staged build contract. The *why* and the research
receipts live in `docs/venue-design.md` (design synthesis) and
`~/Documents/JAKESJAM_HotLobby_Research_20260716/` (8 sourced game studies +
the 23-seam audit of the current flow). This doc is what "done, done right"
looks like, structured so a goal-driven session can execute it pillar by
pillar and *prove* each one finished.

**One sentence:** the public mode becomes a VENUE — a walkable lobby you land
in within seconds, an always-on arena you enter only at the bell, a personal
run that is yours, and a ceremony that returns everyone to the lobby together
— with every claim below verified by a tool, not a vibe.

**Completion discipline (hard rule, learned the hard way):** every acceptance
test in this doc is verifiable by tool calls — `bun test`, `tsc`, `grep`,
`curl`, a Playwright screenshot, a replay render. Tests requiring Jake's eye
are labeled **AWAITING JAKE** and are *evidence to collect, never gates that
block the loop*. If a condition can only be satisfied by a human, it does not
belong in an acceptance list.

**Contested calls — defaults taken** (each reversible, each isolated behind
one constant or one module; Jake can overrule any without unwinding the rest):

| # | Call | Default taken |
|---|---|---|
| 1 | First-to-3 demoted from "the match" to "the cycle win line" | YES — run framing is the point |
| 2 | Round-boundary admission (no mid-fight spawns) | YES — the single highest-leverage rule |
| 3 | Starter draft for entrants | YES — one pick from three |
| 4 | Elastic persona bots, floor of 4 combatants | YES — boundaries only |
| 5 | Name | **THE ARENA** / button "ENTER THE ARENA" — one constant (`VENUE_NAME`), swap to THE SHARD is a one-line change |
| 6 | Lobby-first landing as default path | YES — menu becomes an overlay |

---

## Architecture (the elegant shape)

The whole overhaul adds **one new concept** (the Venue as a composition of
two always-on hosts) and **zero new categories of thing** — every mechanism
below is an existing pattern in this repo, repointed:

```
                    ┌────────────────────────────────────┐
                    │            VenueHost               │  server/src/venueHost.ts (new, thin)
                    │  composes, never simulates          │
                    ├──────────────────┬─────────────────┤
                    │   lobbyHost      │   arenaHost      │
                    │   MatchHost      │   MatchHost      │  ← the SAME class both times
                    │   mode:"hangout" │   (WorldHost's   │
                    │   id:"lobby"     │    current guts, │
                    │   never recycles │    id:"world")   │
                    └──────────────────┴─────────────────┘
                       ▲                      ▲
        /ws/lobby      │                      │   /ws/world (unchanged)
        (world token)  │                      │
                    ┌──┴──────────┐    ┌──────┴───────────┐
                    │ VenueLobby  │───▶│ OnlineMatchScene │   admission at the bell
                    │ Scene       │◀───│ (unchanged core) │   ceremony returns to lobby
                    └─────────────┘    └──────────────────┘
                    evolution of HangoutScene — not a fork
```

- **`VenueHost`** owns the pair and the *membrane* between them: the ready
  queue, bell admission, cycle-end lobby return, map votes, elastic bot
  placement. It contains no simulation — both worlds keep being ordinary
  `MatchHost`es. (This is the same "thin wrapper" discipline `WorldHost`
  already established; `WorldHost`'s logic migrates into the arena half.)
- **`VenueLobbyScene`** is `HangoutScene` generalized, not forked: one scene
  class, a `mode: "private" | "venue"` init param. Private rooms keep their
  exact current behavior; the venue variant adds the feed, dummies, and
  queue totem. The day these need different physics is the day something is
  wrong (practice-zone-goal.md §6 discipline).
- **The unit of meaning** moves into the sim via one new concept: the **run**
  (per-player: roundsSurvived, kills, streak, cardsDrafted, joinedAtRound) —
  a plain record on the player entity, mirrored in `player.zig` ONLY if it
  needs to cross the wasm ABI (it should not; runs are bookkeeping, not
  physics — keep them TS-side in World.ts).
- **Naming is one constant**: `client/src/venueNames.ts` exporting
  `VENUE_NAME = "THE ARENA"`, `VENUE_CTA = "ENTER THE ARENA"`,
  `LOBBY_NAME = "THE LOBBY"`, `BELL_COPY = (s: number) => ...` — every
  surface imports; zero hand-typed mode names anywhere (grep-enforced, P6
  below).

**What is deliberately NOT built:** Fight Night's show overlay (own goal doc
when its time comes); real spectate-video in the lobby feed (the feed is
live *state* — scores/phase/countdown — not streamed frames; a snapshot-relay
spectator is a stretch goal, not a dependency); any persistence beyond
localStorage + the existing replay store (no accounts, no DB — the "venue
remembers you" board is a server-side ring buffer, honest about its
process-lifetime).

---

## Pillar 0 — Honesty (the bugs that lie), shippable immediately

Seven standalone fixes from the audit, zero design risk, each its own commit.

**Acceptance tests**
1. **Badge honesty:** `MatchHost.summary()` returns `humans` and `bots`
   separately; the splash badge renders "N fighters" from humans only, bots
   as "· N bots warming up". *Verify:* unit test on `summary()` with a
   2-bot/1-human roster; grep shows no consumer of the old combined
   `players` count remains.
2. **Death overlay never lies:** the big number is labeled by phase — "NEXT
   BELL" during fighting, "DRAFT" during drafting — sourced from a
   `phaseCountdown` helper with a unit test over all four phases. Grep: the
   string "RESPAWNING" is gone or only rendered during countdown phase.
3. **Draft timer bar is real:** the online path arms
   `showWithTimer(..., DRAFT_WINDOW_MS)`; a unit test asserts the overlay's
   timer width is nonzero when armed. The "auto-selects" hint and the bar
   now tell the same story.
4. **Results keep names:** `MatchResultsOverlay` rows use the same roster
   name source as the HUD (one shared `displayName(pid)` helper; grep shows
   `playerTag(` has no remaining call site in results rendering).
5. **Reconnect is real or absent:** `OnlineMatchScene` passes `reconnectUrl`
   into `ClientLoop` (the supervisor already exists) — an integration test
   proves a dropped WS re-attaches within the 10s server grace; OR, if
   descoped, the ConnectionOverlay copy no longer promises reconnection.
   Either way: no dead "Attempt N" UI (grep).
6. **Leave means leave:** `ClientLoop.stop()` closes the transport; a unit
   test asserts the WS close frame fires on `leaveMatchToHome()`. The 30s
   ghost window (20s liveness + grace) can no longer be entered by the Menu
   path — server logs in a soak show zero liveness force-closes for
   deliberate leavers.
7. **No OS chrome:** the native `confirm()` on Leave is replaced by the
   shell's own confirm panel (grep: `confirm(` absent from `main.ts`).

## Pillar 1 — The public lobby host (the Venue exists)

**Outcome:** a singleton, always-on, world-token-authed lobby world that
survives arena recycles, server-side composed with the arena by `VenueHost`.

**Acceptance tests**
1. `GET /venue/summary` returns `{ lobby: {present}, arena: {humans, bots,
   phase, round, cycleMap, nextBellMs} }` — curl-verifiable on a dev server.
2. Lobby host never recycles: an integration test drives the arena through
   a full cycle end + rebuild and asserts the lobby host object identity and
   its connected sockets are undisturbed.
3. Auth: `POST /venue-token` (evolution of `/world-token`) grants BOTH
   `/ws/lobby` and `/ws/world` attach rights; private-room hangout auth is
   untouched (its tests still pass).
4. `VenueLobbyScene` with `mode:"venue"` connects, walks, and sees other
   connected players — proven by a two-headless-client integration test
   asserting mutual presence in snapshots.
5. Private rooms regress zero: the full existing private-lobby test suite +
   a scripted create→hangout→launch→match flow passes unchanged.
6. Totem placement works on every map in rotation (not just vessel-nexus):
   `totem.ts` gains per-map anchors or a validated fallback — a test walks
   all rotation maps and asserts totem positions land on standable ground
   (reuse the reachability validator).

## Pillar 2 — A lobby worth standing in (waiting is play)

**Outcome:** landing in the lobby IS the 8-second promise: input within 3s,
a hittable target one step away, the live arena visible with zero clicks.

**Acceptance tests**
1. **The feed:** a diegetic arena-feed surface in the lobby renders live
   arena state (phase, scores, round, `nextBellMs`) sourced from the venue
   summary over the lobby's own WS (no polling); an integration test
   asserts feed state matches arena state within one snapshot interval.
2. **Practice dummies:** ≥2 target crystals in the lobby take real weapon
   fire (hangout mode's combat no-op gains a targets-only carve-out — sim
   test proves projectiles damage dummies and NEVER players in lobby mode)
   and visibly break/respawn (existing destructible machinery, not new).
3. **The queue totem:** touching it enqueues (server-side `readyQueue`),
   shows "IN AT THE NEXT BELL — 0:23" with live countdown, glows per queued
   player, and does NOT freeze the player (they keep walking/firing while
   queued — integration test: enqueue then move, position changes).
4. **Callsign at the door:** a first-timer (no stored name) gets the roster
   board prompt before their first totem touch; the server rejects
   nameless arena admission from the venue path (test: nameless enqueue →
   admission carries a validated name or is refused). Machine-name
   nameplates (`player_x…`) are extinct on the venue path (integration
   assert on spawn name).
5. **Time-to-play:** a Playwright run against a prod build measures
   load→first-input-accepted < 3s and load→dummy-hit-possible < 8s on the
   venue path (scripted input; generous CI variance margin, asserted <10s).
6. **Presence floor:** with zero humans, idle persona bots stand in the
   lobby (wandering is enough) — screenshot evidence; the lobby is never an
   empty room.
7. **The venue's music:** the lobby plays its own track — Jake supplied it
   2026-07-16: `client/public/audio/venue-lobby.mp3` ("A Table Set", 2:58,
   already staged in assets). Crossfades with world music on lobby↔arena
   transitions using the existing `fadeMusic` machinery (no new audio
   category); respects the existing music volume/mute settings (test: mute
   music → lobby track muted; grep: track loaded via `getAudioUrl`, no
   hardcoded path).

## Pillar 3 — The bell (admission with dignity)

**Outcome:** nobody ever spawns into a live fight; entrants arrive at round
boundaries carrying a starter card; every waiting state explains itself.

**Acceptance tests**
1. **No mid-fight spawns, structurally:** human arena admission happens
   exclusively at the `fighting`-phase entry edge. Sim/integration test:
   enqueue during fighting/drafting/round-over → admitted exactly at next
   countdown, never sooner. The old instant-insert path remains ONLY for
   reconnect-grace re-attach (test covers that too).
2. **Starter draft:** admission delivers a one-shot 3-card offer (existing
   draft machinery, single-player roll) resolved before first spawn; test:
   admitted player's entity carries exactly one drafted card at spawn.
   Auto-pick on bell if unpicked (never delays the bell).
3. **The joiner is never confused:** between totem-touch and spawn, the
   client shows the queue state (countdown + "watching the arena" framing).
   The frozen-world-no-explanation state (audit seam #4) is structurally
   unreachable: a venue-path client is either in the lobby scene or spawned
   at a countdown — integration test asserts scene state across an
   enqueue-during-draft.
4. **No orphan ceremonies:** a venue-path client can never receive a
   MATCH WINNER overlay for a cycle it wasn't fighting in (the results
   surface renders only for players present in that cycle's roster — test).
5. **Elastic bots:** at each bell, bot combatants adjust toward
   `max(0, 4 - humansFighting)` — entering/exiting ONLY at boundaries (sim
   test across boundaries with 1→5 humans joining/leaving); displaced bots
   reappear in the lobby (venue summary reflects the move).

## Pillar 4 — The run and the draft (meaning belongs to the player)

**Outcome:** the arriving player's arc is first-class: a run strip in the
HUD, a run-aware death card with honest copy and clear spectate, and a
shared, visible draft with reverse-standings pick order.

**Acceptance tests**
1. **Run record:** World.ts tracks per-player run state (joinedAtRound,
   roundsSurvived, kills, bestStreak, cardsDrafted) — pure TS bookkeeping,
   no wasm ABI change (grep: player.zig untouched by this pillar); unit
   tests cover join-mid-cycle, death, cycle rollover.
2. **Run strip:** the HUD renders the local run (rounds · kills · streak) —
   screenshot evidence at desktop + compact widths (axiom S5 discipline).
3. **Death without lies or blindness:** the death card shows run facts and
   phase-honest countdown copy; spectate dim is edge-vignette only — the
   center of the frame at full brightness (screenshot diff: center
   luminance within 5% of pre-death render).
4. **Shared draft:** each fighter's pick is visible to all (existing
   `draft-resolved` events rendered as a pick ticker/stage); pick order is
   reverse standings (sim test: lowest score's offer resolves first);
   auto-picks are announced ("VERA auto-drafted …" — event carries
   `autoPicked`, already true today, now surfaced).
5. **Cycle scoreboard honesty:** a joiner's row shows "joined R4" rather
   than implied 0-losses (results model carries joinedAtRound — test).

## Pillar 5 — The ceremony (cycle end returns to the lobby)

**Outcome:** the cycle ends where the venue lives: everyone lands back in
the lobby together for podium + map vote; the arena reboots beneath; the
totem re-arms. The hard cut is dead.

**Acceptance tests**
1. **Return, not modal:** cycle end transitions every venue-path client
   from OnlineMatchScene back to VenueLobbyScene (integration test on scene
   handoff), where the ceremony renders (podium: winner, MVP, run cards
   with real names).
2. **Map vote:** a 10s vote among 3 candidates (next-rotation + 2 nominees)
   runs in the lobby (totem zones or keys — same SimEvent reaction pattern
   as ready totems); the arena's next cycle boots the winner (integration:
   scripted votes → assert arena mapId). Ties/no-votes fall back to
   rotation order (test).
3. **The arena never dies:** during ceremony + vote, the arena host
   rebuilds and its bots resume — venue summary shows a live arena within
   Ns of cycle end (test with N generous, e.g. 20s).
4. **Re-entry is two steps:** post-ceremony, the totem is armed and a
   re-queue → next bell admission round-trips in one integration test
   (leave-arena → lobby → re-enter without any client reload).
5. **The board:** the lobby renders a process-lifetime "this week at the
   venue" board (top streaks/runs, ring buffer, no DB) — honest copy about
   its scope; survives arena recycles (test: board state persists across a
   cycle).

## Pillar 6 — The name and the front door

**Outcome:** "Hot Lobby" is extinct; the venue speaks one name from one
constant; the funnel lands in the lobby; the fast path auto-readies.

**Acceptance tests**
1. **One source of naming:** `venueNames.ts` exists; grep for "Hot Lobby"
   (case-insensitive) across client/, server/, docs/ returns ZERO hits
   outside historical docs/commit history; every CTA/copy surface imports
   the constants.
2. **Lobby-first landing:** the default entry (post-email-gate) lands in
   VenueLobbyScene; the splash menu is reachable as an overlay (Menu). The
   ident plays only from an explicit menu action (grep: no ident in the
   default path; Playwright: load → in-lobby without ident).
3. **`?fight` fast path:** deep link lands in-lobby already enqueued
   (Playwright: load with ?fight → queue state active without input);
   `?world=1` 301-redirects/aliases to it (existing links keep working —
   test).
4. **Badge speaks venue:** the (now-overlay) menu badge + any external
   surface uses venue vocabulary and honest counts (ties to Pillar 0.1).
5. **Docs follow:** ui-button-map.md and ui-axioms.md references to "Hot
   Lobby" updated; `docs/hosting-elyad-io.md` / README mode descriptions
   updated (grep-verified).

---

## Eye tests — AWAITING JAKE (evidence to collect; never blocking)

- The lobby *feels* like a venue, not a menu with legs (clip evidence:
  30s capture of land → dummy → totem → bell → fight).
- The bell moment lands (clip: queue countdown hitting 0 → admission).
- The ceremony feels like a ceremony (clip: cycle end → podium → vote →
  re-entry).
- The name reads right on the button (screenshot A/B: ENTER THE ARENA vs
  ENTER THE SHARD — one-constant swap makes this cheap to compare).

## What "elegant" means here, concretely

- **One new server concept** (`VenueHost`, a composer with no simulation),
  zero new scene categories (VenueLobbyScene is HangoutScene generalized),
  zero new physics, zero wasm ABI changes.
- **Every rule is one mechanism:** admission = one queue drained at one
  edge; dignity = one starter-draft call; elasticity = one bot-count
  formula at the same edge; ceremony = the existing recycle rerouted
  through the lobby. No scattered `if (venue)` flags — mode is decided at
  construction, behavior injected, exactly like MatchHost's existing
  `mode:"hangout"` precedent.
- **Honesty is grep-enforceable:** names from one constant; counts from one
  summary shape; no copy that promises what code can't do (reconnect,
  timers, "respawning").
- **Private rooms are a regression firewall:** their test suite passing
  unchanged is an acceptance test of EVERY pillar, not a hope.
- **Each pillar ships alone.** The game is releasable after any pillar;
  no pillar's acceptance depends on a later pillar's existence. Fight
  Night arrives later as a pure overlay on this substrate and gets its own
  goal doc.

## Evidence ledger

*(append per pillar as work lands — test names, grep outputs, screenshot/
clip URLs, soak results; the SESSION_GOAL_DEATH_TELEMETRY.md discipline)*
