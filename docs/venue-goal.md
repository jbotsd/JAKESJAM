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
| 3 | Starter draft for entrants | **OVERRULED BY JAKE 2026-07-17** ("seperate the card selector test room thing with the bell queue"): the one-pick-from-three offer stays, but as a walk-up LOADOUT STATION totem in the lobby (by the practice dummies), NOT attached to queueing/admission. The bell queue is a clean countdown; no pick = enter with none (never auto-picked at the lobby — auto-select stays a mid-run round-timer convention only). |
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
2. **Starter draft:** ~~admission delivers a one-shot 3-card offer~~
   **AMENDED per contested call #3's overrule (Jake 2026-07-17):** the
   3-card offer lives at the lobby's walk-up LOADOUT STATION (by the
   practice dummies — pick, then try it); a recorded pick rides the next
   admission (test: admitted player's entity carries exactly the picked
   card at spawn). Unpicked = spawn with none, covered by the next
   ordinary drafting phase — NO auto-pick at the bell, and the bell UI
   carries no draft.
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

**Pillar 0 — COMPLETE (2026-07-16, commits 0555738..f9697e1)**
1. PASSED — summary() splits humans/bots, combined `players` key deleted
   (asserted gone, not renamed); badge renders "N fighters · M bots" /
   "M bots warming up". matchHostSummary.test.ts (3 rosters) + updated
   worldHost eager-boot test. BOT_ID_PREFIX consolidated 4 copies → @sim/botId.
2. PASSED — deathWaitCountdown(): one "NEXT BELL" upper-bound estimate
   (only ever jumps down — monotonicity unit-tested) instead of the raw
   phase clock re-meaning itself; "~" marks estimates; grep: "respawning"
   only in the defensive countdown branch. phaseCountdown.test.ts (6).
3. PASSED — draftTimerArmMs() arms the bar with authoritative remaining
   time, structurally never 0. DOM-width assertion adapted: no DOM test
   infra in repo, so acceptance is one level down (computation unit-tested,
   4 cases incl. zero-arm regression) + the tutorial exercises the
   totalMs>0 render path.
4. PASSED — displayName(pid) single name source (results rows, round-over
   winner banner, death score-line fallback); playerTag survives only as
   displayName's last-resort interior. Grep clean.
5. PASSED — reconnectUrl wired (stateless HMAC tokens re-auth; 10s grace
   restores in place, later = fresh join); scene's raw onClose (fired
   "lost" on every close, watched only the first transport) replaced by
   terminal-only onConnectionLost with honest "reload to rejoin" copy.
   reconnectWiring.test.ts pins retry/terminal/opt-out contract.
6. PASSED — ClientLoop.disconnect() (supervisor.dispose() first → close
   "client-leave" → stop) on both scene teardowns; stop() untouched
   because it's the tab blur/focus pair and must never close the socket.
   Tests pin: reason carried, post-disconnect close event inert, stop()
   never touches socket. The ~30s ghost-leaver window is gone.
7. PASSED — two-step in-shell leave confirm (axiom B4 separation, state
   reset per open, venue vocabulary); grep: zero confirm( call sites.

Suites at pillar close: client 921 pass / server 172 pass; typecheck
clean both workspaces; deployed live same day.

**Pillar 1 — COMPLETE (2026-07-16, commit 06eb8ae)**
1. PASSED — GET /venue/summary live: `{"lobby":{"present":N},"arena":
   {...humans/bots, "nextBellMs"}}`; bell math verified against phase
   clock by hand on the live server (63716 fighting + 2500 + 15000 =
   81217 ✓) and by unit test against the shared @sim/round.ts
   msUntilNextBell (also refactored under the death overlay — one
   source).
2. PASSED — lobby survives arena recycle: object-identity test through a
   forced recycle (exercised the strongest case: full arena teardown with
   zero sockets); attached player + presence intact. Never disposes on
   empty (attach → detach → re-attach test).
3. PASSED — /venue-token mints the stateless world token, returns both
   ws paths; /ws/lobby verifies it. Live probe: token → WS open →
   server frames received → lobby.present 1 → close → 0.
4. PASSED at state level — two attached clients mutually present in the
   lobby sim (venueHost.test.ts). Scene-level (Phaser) connect explicitly
   deferred to Pillar 2's VenueLobbyScene work, where the client half
   concentrates.
5. PASSED — full private-room suite + all server tests green (178).
6. PASSED — resolveHangoutTotems: non-vessel maps snap onto a validated
   standable surface (lower-half preferred, width-dominant, edge margin)
   instead of the blind center guess; test sweeps all curated rotation
   maps + 3 gen seeds asserting every totem sits exactly at standing
   height on a real floor/platform span.

Suites at pillar close: server 178 / client 922, typechecks clean,
deployed + live-probed same day. Ops note: server restarts must WAIT
for the graceful-shutdown grace ("SIGTERM — beginning graceful
shutdown" → "shutdown grace expired") before rebinding :8088 — racing
it EADDRINUSEs the replacement and leaves the old code serving.

**Pillar 2 — MOSTLY COMPLETE, 2 items OPEN (2026-07-16, executed as
`docs/venue-sprint2-goal.md` S2.A/S2.B/S2.C — commits 6ad2cd0, b2ae6d1,
2f06689, 0b6e5cb; lobby tableau polish 2026-07-18, commit 413a371)**

Backfilled 2026-07-26 (Track D item 3) — every item below re-verified
against current code before marking, not transcribed on faith.

1. PASSED — the feed: `venue-status` protocol frame ({arenaPhase,
   roundIndex, scores, humans/bots, nextBellMs, queued}) pushed at 1Hz
   and on `MatchHost.onRoundPhaseChange` edges, threaded through every
   `WorldHost` rebuild/recycle so the tap survives cycle ends; rendered
   diegetically in `HangoutScene.ts` (`` `THE ARENA — ...NEXT BELL
   mm:ss` `` at HangoutScene.ts:1112). `venueHost.test.ts` + live probe
   (server/probe-s2c.ts) confirm frames flowing on a real /ws/lobby
   socket. (S2.B, commit b2ae6d1.)
2. PASSED — practice dummies: `venueLobbyMap()` injects 3 destructible
   dummies (60hp) as a resolved MapDefinition; the targets-only
   carve-out in World.ts lets projectiles damage dummies while ghosting
   through players — `hangoutMode.test.ts` (8 pass): fire live, target
   immune through a bystander in the line of fire, dummy breaks. 413a371
   additionally fixed Ninja/Paladin melee having ZERO destructible-hit
   path in hangout mode (only player-damage sites existed). (S2.C,
   commit 0b6e5cb + 413a371.)
3. PASSED — the queue totem: the bell totem (`totem-bell`, kind
   "launch") toggles the server-side `readyQueue` Set
   (server/src/venueHost.ts); `HangoutScene.ts` shows the live "NEXT
   BELL mm:ss" countdown plus a "· QUEUED" glow. Re-verified 2026-07-26:
   grep of venueHost.ts shows `readyQueue` is read only by the
   bell-drain and status-broadcast paths — never by movement/input
   processing — so queueing structurally cannot freeze the player.
   (S2.B.3; the totem itself split into loadout+bell stations 2026-07-17,
   see Pillar 3.2.)
4. PASSED — callsign at the door: the server refuses nameless queue
   entry (toggleQueue checks the socket's name); nameless spawns read
   "RECRUIT" (machine-name spawns unreachable); the client prompts
   before connecting via a DOM overlay so the name always rides
   /ws/lobby. `venueHost.test.ts` (11 pass) + live probe: nameless
   roster name RECRUIT confirmed on a real socket. (S2.C, commit
   0b6e5cb.)
5. OPEN (half-verified) — time-to-play: `tests/e2e/venueRoundTrip.spec.ts`
   measures and logs load→venue-lobby-scene at 1770ms (comfortably under
   the <3s input bar), but re-reading the spec 2026-07-26 finds no
   assertion anywhere for "load→dummy-hit-possible <8s/10s" — no
   dummy/hit timing metric is captured at all. The input-acceptance half
   is evidenced; the dummy-hit half is not — left OPEN rather than
   claimed PASSED on a metric that was never measured.
6. OPEN — presence floor: no lobby-side bot/persona system exists (grep
   for `lobbyBots`/`hangoutBots`/venue-side bot brains across server/src
   returns nothing — `WorldBots` only ever drives the arena roster).
   With zero humans connected, the venue lobby is a genuinely empty
   room, contradicting "the lobby is never an empty room." Real
   functionality gap, not a doc gap.
7. PASSED — the venue's music: `venue-lobby.mp3` plays via the existing
   fadeMusic/crossfade machinery, gated through `shell/musicMute.ts` (a
   compile-time-exhaustive `Record` over contexts, 4 tests) and loaded
   only via `getAudioUrl` (grep: no hardcoded path, no new audio
   category). (S2.C, commit 0b6e5cb.)

Suites at last pillar-2 touch (S2.C close): server 183 / client 925,
typechecks clean, deployed. Live probe (server/probe-s2c.ts) all green.

**Pillar 3 — MOSTLY COMPLETE, 1 item OPEN (2026-07-16/17, executed as
`docs/venue-sprint2-goal.md` S2.D/S2.E/S2.F — commits c47dccb, f1482a6,
73fc418; amended 2026-07-17 per Jake's loadout/bell-station overrule of
contested call #3)**

Backfilled 2026-07-26 (Track D item 3) — every item below re-verified
against current code before marking.

1. PASSED — no mid-fight spawns, structurally: `WorldHost.attach()`
   never calls `addPlayer` directly — a new player is parked in
   `pendingEntrants` (spectator-pending: hello + snapshots, no entity)
   and the ONLY insertion path is `drainPendingEntrants()`, fired on the
   real `onRoundPhaseChange` edge into countdown. A source-scan test
   pins exactly one `addPlayer` call site, inside the drain.
   `worldBellGate.test.ts` (8 pass): spectator-pending across all three
   non-countdown phases, immediate insertion at countdown attach,
   reconnect-grace bypass, pending-disconnect dequeue. Live probe
   (server/probe-s2d.ts): 2150 snapshots as a spectator through a full
   fighting phase, entity absent until the phase flipped, inserted at
   "countdown" after 106s. (S2.D, commit c47dccb.)
2. PASSED (amended) — starter draft, per contested call #3's overrule
   (Jake, 2026-07-17: "seperate the card selector test room thing with
   the bell queue"): the one-pick-from-three offer is now a walk-up
   LOADOUT STATION (`totem-loadout`, kind "ready", 0.25W, flanking the
   practice dummies) separate from the bell (`totem-bell`, kind
   "launch", 0.75W) — `resolveVenueTotems` places both.
   `VenueHost.loadouts` holds per-player {offers, pick}, rolled once at
   first station touch, re-pushed idempotently, consumed once at
   admission; NO auto-pick in the lobby — an unpicked rider is admitted
   plain and covered by the arena's ordinary next drafting phase
   (S2.E.2's late-joiner contract). Client: `CardDraftOverlay` opens on
   walking into the station / closes on walking out (proximity +
   hysteresis; modal-on-spawn structurally prevented). 413a371 also
   built the functional grand-hall tableau (crystal table, 3 dummies, 2
   stationary NPCs) the station physically lives in, and fixed the
   melee-vs-dummy hit-path bug (Pillar 2.2). Tests: `venueHost.test.ts`
   (station rolls once + re-pushes idempotently, pick lands, re-pick
   overwrites, bell admits no-pick queuers with nothing), `totem.test.ts`
   (station placement), `venueRoundTrip.spec.ts` rewritten for the
   two-walk flow. Suites at amendment: server 223 / client 1092. (S2.E
   commit f1482a6; amendment + 413a371.)
3. PASSED — the joiner is never confused: the lobby feed
   (`HangoutScene.ts`) renders the live "NEXT BELL mm:ss" + "· QUEUED"
   state continuously while queued, so no unexplained frozen state is
   reachable lobby-side; on the arena side a pending (direct-join)
   entrant gets hello + live snapshots, not a frozen screen — proven by
   `worldBellGate.test.ts`'s spectator-pending coverage (item 1). Grep
   confirms `readyQueue`/`loadouts` membership is read only by the
   status-broadcast and bell-drain paths — never gating movement or
   input — so a queued player keeps walking/firing by construction.
   Noted honestly: no single test carries this acceptance line's exact
   wording ("scene state across enqueue-during-draft") — the PASSED
   verdict rests on the combination above, not one dedicated test.
4. OPEN — no orphan ceremonies: not directly tested. The two-host
   separation (lobby clients on /ws/lobby, arena clients on /ws/world —
   Pillar 1) makes it structurally implausible for a lobby-only client
   to receive a MATCH WINNER/`MatchResultsOverlay` frame for a fight it
   wasn't in (no code path pushes arena WorldState to a lobby socket),
   but there is no dedicated regression test pinning this claim — marked
   OPEN rather than PASSED on architecture alone.
5. PASSED — elastic bots: bot count adjusts toward `max(0,
   WORLD_BOT_FLOOR − humansFighting)` (default 4, cap 6, env override)
   ONLY at the countdown-entry edge (`adjustElasticBots`) and on fresh
   builds (a recycle IS a bell edge); removal via
   `MatchHost.removeRosterPlayer` (mirrors grace-eviction, replay
   `noteLeave` included); displaced bot brains no-op when their entity
   is absent. `worldBellGate.test.ts` (14 pass) sweeps a 0→4-human
   bot-delta series across several bells, asserting deltas land
   exclusively on edges, cap 6 respected, floor-0 legacy mode intact.
   Live: `/venue/summary` showed bots:4 with 0 humans at boot (a fixed 2
   before). (S2.E, commit f1482a6.)

Suites at S2.F close: server 201 / client 925; the amendment brought it
to server 223 / client 1092. Typechecks clean, deployed, round-trip e2e
(`venueRoundTrip.spec.ts`) green against the live :8088. Jake
live-tested concurrently at S2.F close (server log shows his session
queueing, drafting, and being admitted).

**Pillar 4 — NOT STARTED (verified 2026-07-26, Track D item 3
backfill; the doc claim "Pillars 2-6 are functionally live" does NOT
hold for this pillar — a real functionality gap, not a doc gap)**

No commits implementing this pillar's outcome exist. Every item below
was checked directly against current source, not assumed:

1. OPEN — run record: no `roundsSurvived` / `joinedAtRound` /
   `bestStreak` / `cardsDrafted` fields exist anywhere in World.ts or
   elsewhere (grep across client/src, server/src for all four names:
   zero hits). What DOES exist is `client/src/shell/playerStats.ts` — a
   separate, localStorage-backed, PROCESS-lifetime "player record"
   (kills/deaths/bestStreak/matches/wins), shipped 2026-07-16 (commit
   0cbbf44) as the splash-badge replacement. That is Pillar 0/6
   badge-honesty work, not the sim-side per-run bookkeeping this item
   specifies — no `joinedAtRound`, no per-cycle scoping, nothing on the
   player entity.
2. OPEN — run strip: the HUD (`HudCompositor.ts`) has no rounds/kills/
   streak strip (grep for "streak"/"rounds" in that file: zero hits).
3. OPEN — death without lies or blindness (run facts on the death
   card): `DeathOverlay.ts` carries phase-honest countdown copy (Pillar
   0.2's `deathWaitCountdown()`) but no run facts — grep confirms no
   kills/streak/rounds content in the file.
4. OPEN — shared draft: `draft-resolved` events exist and DO carry
   `autoPicked` (pre-existing, per this doc's own note at the pillar's
   acceptance text) — but they only drive a `BuildChangeToast` for the
   LOCAL player (`OnlineMatchScene.ts:1654`, gated on
   `event.playerId === this.localPlayerId`), plus a shared "card" sound
   cue for everyone. There is no visible pick ticker/stage showing
   OTHER fighters' picks, and no reverse-standings pick order —
   `enterDrafting` (client/src/sim/round.ts) rolls every seat's offer in
   parallel, keyed by `Object.keys(players).sort()` (alphabetical/
   deterministic, not score order).
5. OPEN — cycle scoreboard honesty ("joined R4"): no `joinedAtRound`
   field exists (same grep as item 1); `MatchResultsOverlay` rows carry
   only `score` / `cardIds` / `characterId` — no join-round provenance.

**Pillar 5 — NOT STARTED (verified 2026-07-26, Track D item 3
backfill; real functionality gap, not a doc gap)**

1. OPEN — return, not modal: cycle end (round.winnerPlayerId reaching
   target score) still shows `MatchResultsOverlay` as a MODAL on top of
   `OnlineMatchScene` (`showMatchResults()`, OnlineMatchScene.ts:2962)
   with Rematch/Back-to-Lobby buttons — "Rematch" just hides the overlay
   and waits in place for the server's next round (world mode never
   force-transitions the scene); only clicking "Back to Lobby" manually
   dispatches `jakesjam:return-to-lobby`. There is no automatic
   client-side scene handoff to VenueLobbyScene at cycle end, and no
   podium/MVP/run-card rendering — grep for "podium"/"MVP" across
   client/server turns up exactly one hit, a code COMMENT using
   "podium" as a metaphor for the existing results screen, not an
   actual podium UI.
2. OPEN — map vote: no map-vote mechanism exists (grep for
   "mapVote"/"map vote"/"nominee" across client/src, server/src: zero
   hits).
3. OPEN — the arena never dies (through ceremony + vote): not
   applicable — there is no ceremony+vote phase for the arena to stay
   alive through.
4. OPEN — re-entry is two steps: the only re-entry path today is the
   manual "Back to Lobby" button → `joinWorld()`, one explicit action,
   not the two-step armed-totem re-queue this item describes; no
   ceremony precedes it.
5. OPEN — the board ("this week at the venue"): no such surface exists
   (grep for "this week at the venue"/"venueBoard" and a scan of every
   "ring buffer" hit in the repo: all belong to unrelated netcode/VFX
   interpolation buffers, none to a leaderboard).

**Pillar 6 — PARTIAL, mostly OPEN (verified 2026-07-26, Track D item 3
backfill; venue vocabulary landed piecemeal 2026-07-16/17 but the
pillar's structural acceptance tests do not pass)**

1. OPEN — one source of naming: no `client/src/venueNames.ts` exists
   (confirmed by `find`) and no `VENUE_NAME` / `VENUE_CTA` /
   `LOBBY_NAME` / `BELL_COPY` constants exist anywhere (grep: zero
   hits). The chosen COPY itself did land inline at multiple sites —
   the splash CTA literally reads "▶ ENTER THE ARENA · FIGHT NIGHT
   EVERY FRIDAY ◀" (main.ts:326) and the lobby feed reads "THE ARENA —
   ..." (HangoutScene.ts:1112), matching contested call #5's default —
   but it is hand-typed at each site, not sourced from one constant. And
   "Hot Lobby" is still very much alive in current source: `grep -in
   "hot lobby" client/src server/src` returns 26 hits (comments/
   identifiers in main.ts, OnlineMatchScene.ts, palette.ts, maps.ts,
   skyseam.ts, vessel-nexus.ts, tutorial-arena.ts, mapGen.ts, index.ts,
   worldHost.ts, botArenaNav.ts, worldBots.ts, clipSharePage.ts) — the
   acceptance bar ("ZERO hits outside historical docs/commit history")
   is not met.
2. OPEN — lobby-first landing: the default entry (bare load, no URL
   params) still starts MainMenu (the splash). The venue lobby is
   reached only via `?world=1`, `?venue=1`, a room/code link, or the
   CrazyGames instant-multiplayer flag (grep of the `urlParams` branch
   in main.ts, ~line 2225). *[2026-08-05: the CrazyGames flag is gone —
   removed with the SDK in 10b359e; entry today is `?world=1` /
   `?venue=1` / room/code links only.]* The splash's own "Lobby" button is one of
   five equal-weight buttons (Practice / Join room / Private room /
   Lobby) — not an overlay over a lobby-first landing.
3. OPEN — `?fight` fast path: no `?fight` handling exists anywhere in
   main.ts (grep: zero hits) — no such deep link, and consequently no
   `?world=1` alias-redirect TO it either (today's `?world=1`/`?venue=1`
   aliasing lands on `joinWorld()` itself, not on a `?fight` link).
4. PARTIAL — badge speaks venue: `client/src/shell/playerStats.ts`
   (commit 0cbbf44, 2026-07-16) replaced the old polling world-status
   badge with an honest, localStorage-backed kills/deaths/streak/
   matches/wins strip — satisfies the "honest counts" half (ties to
   Pillar 0.1) but was not audited here against every external surface
   (CrazyGames listing copy, share pages) for venue vocabulary.
5. PARTIAL — docs follow: `docs/ui-button-map.md` was updated (line 18:
   "Lobby (was 'Hot Lobby', renamed 2026-07-16)"). `docs/ui-axioms.md`,
   `docs/hosting-elyad-io.md`, and README show no stale "Hot Lobby" hits
   (grep clean) but also carry no explicit rename note the way
   ui-button-map.md does — not confirmed as a deliberate update.

Items flagged OPEN across Pillars 4-6 above are a real functionality
gap uncovered during this backfill, reported (not silently fixed) per
the Track D item 3 brief — see the session's itemsSkippedOrBlocked.
