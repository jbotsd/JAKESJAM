# Sprint 2 — The Lobby & The Bell (the exhaustive, elegant, complete goal)

**Parent:** `docs/venue-goal.md` (the Venue north star — Pillars 0 and 1
COMPLETE, see its evidence ledger). This sprint executes **Pillars 2 + 3**:
the player-facing heart of the overhaul. When this sprint is done, the
public flow IS the venue: you land in a walkable lobby, warm up, watch the
arena feed, touch the totem, and enter at the bell carrying a starter card
— and nobody ever spawns into a live fight again.

**One sentence:** make waiting play, and make entry dignified — a lobby
worth standing in, and a bell worth waiting three breaths for.

**Completion discipline (unchanged hard rule):** every acceptance test is
tool-verifiable (`bun test`, `tsc`, grep, curl, Playwright, a scripted WS
probe). Eye tests are labeled **AWAITING JAKE** and never block the loop.

**Out of scope (sprint 3+):** runs/streaks/death-card (P4), shared visible
draft with reverse-standings order (P4), the cycle ceremony + map vote
(P5), the rename + lobby-first front door + `?fight` deep link (P6), Fight
Night (own goal doc). The world's current instant-recycle behavior stays as
is this sprint; only ENTRY changes.

---

## Architecture (decided here, built once)

### A. One scene, two modes — VenueLobbyScene is HangoutScene generalized
`HangoutScene` gains `mode: "private" | "venue"` in its init data. No fork,
no second scene class (practice-zone-goal.md §6 discipline: new content
inside existing categories, never new categories).
- `private`: exactly today's behavior — room-scoped token via
  LobbyController, `/ws?matchId=hangout_<CODE>`, DOM lobby panel overlay.
  Its test suite is this sprint's regression firewall.
- `venue`: fetches `POST /venue-token`, connects `/ws/lobby`, no
  LobbyController coupling, no host gate. Adds the feed, the queue totem
  UI, dummies, and music — all gated on mode, none leaking into private.

### B. Scene flow (this sprint's slice)
`joinWorld()` (main.ts) starts VenueLobbyScene(mode:"venue") INSTEAD of
OnlineMatchScene. Admission (D) hands off lobby → OnlineMatchScene
(mode:"world", unchanged internals). Arena exit (Menu→Leave, match end
"Back to Lobby") returns to VenueLobbyScene, not the splash — basic
re-entry now, full ceremony in sprint 3. The splash menu remains the app
front door this sprint (P6 owns inverting that).

### C. The feed is PUSHED, never polled
`VenueHost` broadcasts a compact `venue-status` frame to every lobby socket
at 1Hz and immediately on arena phase edges: `{arenaPhase, roundIndex,
scores, humans, bots, nextBellMs, queued: PlayerId[]}`. Rides the existing
protocol's framing as a new server→client message type. The lobby client
renders it diegetically (the feed panel + totem countdown). No client
polling loop; MatchStatusBadge's HTTP polling stays for the splash only.

### D. The bell gate lives in the ARENA, not the client
`WorldHost.attach()` currently inserts a player in ANY phase. New
structural rule, enforced server-side so it is client-agnostic (old
clients, direct /ws/world connects, and future ?fight links all inherit
it):
- Attach during `countdown`: insert immediately (the bell is ringing).
- Attach during `fighting` / `round-over` / `drafting`: the socket gets
  hello + live snapshots — **spectator-pending** (present, watching, no
  entity) — and is queued in `pendingEntrants`.
- On the arena's `countdown`-entry edge, all pending entrants are inserted
  together (one `addPlayer` sweep), each with their starter card (E).
- Reconnect-grace re-attach (entity already exists) bypasses the gate —
  that's a resume, not an entry.
- Mechanism: `MatchHost` gains an `onRoundPhaseChange(prev, next)`
  constructor hook (same surface as onSimEvent/onMatchComplete);
  `WorldHost` threads it through every host it builds (recycles included)
  and drains its own queue on the edge. VenueHost taps the same hook for
  its status frames. No polling, no scattered phase checks.

### E. Starter draft happens IN THE LOBBY, rides the admission
While queued, the lobby client receives a one-shot 3-card offer (existing
draft machinery, single-player roll, served by VenueHost over the lobby
socket). The pick (or leftmost auto-pick at the bell) is stored on the
queue entry. `WorldHost` gains an optional `getEntrantCards(playerId)`
provider (constructor opt, supplied by VenueHost) consulted at insertion —
WorldHost stays venue-agnostic; a null provider means plain spawns (tests,
legacy). Directly-connected arena sockets (no lobby visit) get the offer
as their first drafting-phase participation instead — never a naked spawn
against drafted veterans either way.

### F. Elastic persona bots — one formula, one edge
At the same countdown-entry edge: bot count adjusts toward
`max(0, TARGET_COMBATANTS - humansFighting)` (TARGET_COMBATANTS = 4, env
override `WORLD_BOT_FLOOR`), clamped by the existing cap 6. Bots enter and
leave ONLY at the bell. Displaced bots don't idle in the lobby this sprint
(deferred with the ceremony work) — they simply sit out.

### G. Lobby content is existing machinery, re-aimed
- **Dummies:** 2-3 destructible target crystals (existing destructible
  defs) placed near spawn; hangout mode's combat no-op gains a
  targets-only carve-out — projectiles damage DESTRUCTIBLES in hangout
  mode, never players. Firing is enabled in venue-mode lobby.
- **Music:** `venue-lobby.mp3` (staged, Pillar 2.7) via the existing
  fadeMusic/crossfade machinery and the existing music volume/mute
  settings. Lobby↔arena transitions crossfade.
- **Callsign at the door:** venue-mode lobby with no stored name prompts
  once (DOM overlay reusing the splash CALLSIGN input pattern) before the
  totem can queue you; `/ws/lobby` and admission both carry the sanitized
  name. Machine-name nameplates become unreachable on the venue path.

---

## Acceptance pillars

### S2.A — The lobby lands
1. `VenueLobbyScene` (HangoutScene mode:"venue") connects via
   /venue-token + /ws/lobby, walks, and renders other players — proven by
   a scripted two-client WS probe asserting mutual presence in the lobby
   snapshots BOTH sockets receive (upgrade of Pillar 1.4 from state-level
   to wire-level), plus a Playwright run that reaches the lobby scene.
2. Private rooms regress zero: full existing suite green; a scripted
   create→hangout→launch→match flow still passes; grep shows no
   venue-mode branch executes in private mode (mode checks explicit).
3. Playwright time-to-play on the venue path: load → input accepted
   < 3s, load → a dummy is hittable < 10s (CI margin), measured on a
   prod build.

### S2.B — The feed and the totem
1. `venue-status` frames arrive over the lobby WS at ~1Hz and within one
   frame interval of an arena phase edge — scripted probe: drive the
   arena's phase (or observe a live edge) and assert the pushed frame's
   phase/nextBellMs match /venue/summary within tolerance.
2. The lobby renders the feed diegetically (arena phase, scores,
   next-bell countdown) — screenshot evidence at desktop + compact
   widths (axiom S5).
3. The totem displays the live bell countdown and per-player queued glow;
   touching it queues/unqueues (server-side `readyQueue` reflected in the
   next venue-status frame — probe asserts round-trip) and does NOT
   freeze the player (probe: enqueue then move, position changes).

### S2.C — Worth standing in
1. Dummies take real projectile damage in venue-lobby mode and break/
   respawn; players take ZERO damage from any source in hangout mode —
   sim test covers both (targets-only carve-out).
2. `venue-lobby.mp3` plays in the lobby via getAudioUrl + fadeMusic,
   crossfades on lobby↔arena transitions, and obeys the existing music
   volume/mute settings (test: mute → track muted; grep: no hardcoded
   path, no new audio category).
3. Callsign gate: a nameless venue client cannot queue (probe: totem
   touch with no name → no queue entry); after the prompt, the name rides
   /ws/lobby and admission (probe asserts spawn name). Machine-name
   spawns are unreachable on the venue path.

### S2.D — The bell (structural, server-side)
1. Arena attach during fighting/round-over/drafting yields hello +
   snapshots but NO entity (spectator-pending); insertion happens exactly
   at the next countdown entry — WS-probe test across all three phases.
2. Attach during countdown inserts immediately.
3. Reconnect-grace re-attach bypasses the gate (probe: drop + reconnect
   within grace mid-fight → entity continuous, no re-queue).
4. Structurally no mid-fight spawns: grep + test prove the only
   `addPlayer` path for a NEW world player runs inside the
   countdown-entry drain (the old any-phase insert is unreachable for
   new entrants).
5. A pending spectator who disconnects before the bell is cleanly
   dequeued (no ghost entrants at the drain).

### S2.E — Dignity and elasticity
1. Queued lobby players receive a 3-card starter offer; the pick (or
   leftmost auto-pick) is applied at insertion — probe asserts the
   spawned entity carries exactly the picked card.
2. Direct arena joiners (no lobby) are never naked: they participate in
   the next drafting phase's offer roll (test).
3. Elastic bots: humansFighting 0→4+ sweeps adjust bot count toward the
   floor of 4, only at countdown entry, cap 6 respected — sim test
   drives joins/leaves across several bells and asserts bot deltas land
   exclusively on edges.
4. Elasticity honesty: /venue/summary + venue-status frames reflect bot
   changes on the same edge (no mid-round bot count drift).

### S2.F — The round trip
1. Full loop integration: lobby connect → queue → bell → admitted →
   OnlineMatchScene world connect → Menu→Leave → BACK in the lobby
   (scene handoff both directions), one scripted Playwright run, no page
   reload anywhere.
2. The handoff closes the lobby socket on admission and re-opens it on
   return (no double-presence: venue-status `queued`/`present` counts
   stay consistent through the loop — probe asserts).
3. Suites at sprint close: full client + server green, typechecks clean,
   deployed, and the live /venue/summary + a live lobby WS probe pass
   against play.elyad.io.

---

## Eye tests — AWAITING JAKE (evidence to collect; never blocking)

- Landing in the lobby feels like arriving somewhere (clip: load → walk →
  hit dummy → glance at feed → totem → bell → fight, one unbroken take).
- The bell moment: queue countdown hits 0 → admission → countdown → FIGHT
  (clip).
- "A Table Set" fits the room (in the same clip; volume slider respected).
- The totem glow + queue readout read at a glance on phone width
  (screenshot).

## What "elegant" means here, concretely

- **Zero new scene classes, zero new server concepts.** One mode param on
  an existing scene; two constructor hooks (onRoundPhaseChange,
  getEntrantCards) on existing classes; one new WS message type. The
  admission gate is ~one queue and one drain on one edge.
- **The gate is structural, not behavioral:** it lives where attach
  happens, so no client version, deep link, or future mode can reintroduce
  mid-fight spawns. The client merely *renders* states the server already
  enforces.
- **Every wait is either play or spectacle by construction:** queued
  players keep full movement/firing (lobby), and pending arena entrants
  receive live snapshots (spectating the round they're about to join) —
  no state in the whole flow renders a frozen unexplained world.
- **Private rooms as regression firewall, again:** their suite passing
  unchanged is an acceptance criterion of every pillar above.
- **Each pillar ships alone**, in order S2.A → S2.F; the game is
  releasable after any of them.

## Evidence ledger

*(append per pillar as work lands)*

**S2.A — COMPLETE (2026-07-16, commit 6ad2cd0)**
HangoutScene gains mode:"private"|"venue" (one param, no fork); venue mode
fetches /venue-token → /ws/lobby with callsign + reconnect armed. Reachable
via ?venue=1 dev entry; main world flow deliberately unflipped until S2.F.
Live-probed: canvas scene walking, lobby.present=1 while connected. Private
suite green (firewall). Note: the S2.A.3 Playwright time-to-play measurement
is deferred to S2.F when the venue path becomes the real flow (measuring the
dev entry now would measure scaffolding).

**S2.B — COMPLETE (2026-07-16, commit b2ae6d1)**
venue-status protocol frame pushed at 1Hz + on phase edges (MatchHost
onRoundPhaseChange hook, threaded through WorldHost rebuilds/recycles);
VenueHost bell queue toggled by totem events (single bell-portal totem via
resolveVenueTotems + MatchHost opts.totems override; disconnect dequeues);
summary() gains scores. Client: onVenueStatus → diegetic feed + bell label
with locally-interpolated countdown + queued glow. Live probe: 4 frames/
3.5s on a real /ws/lobby socket, phase match, 417ms bell drift (tol 1500);
feed screenshot in-scene. Suites server 180 / client 922. Deployed.
Ops note repeated the hard way: pgrep|head -1 killed a WRAPPER pid, not
the server — always verify via `ss -ltnp | grep 8088` before starting the
replacement.

**S2.C — COMPLETE (2026-07-16)**
Targets-only carve-out in World.ts: firing is LIVE in hangout mode but
players take zero damage from any source (projectile hit candidates empty →
shots ghost through players; dash-bash gated; belt-and-braces guards at
projectile-drain, destructible-splash, fire-patch drains). Practice dummies:
venueLobbyMap() injects 3 box dummies (60hp, center-coord on the ground
band) as a resolved MapDefinition — dummy state reaches clients via
ordinary snapshots, zero client map fork; MatchHost.respawnDestructibles()
(hangout-only) + VenueHost 8s timer restock the room. Client: HangoutScene
venue mode constructs EntityRenderCoordinator with OnlineMatchScene's
painters (TutorialScene precedent, pool null) + LMB fires venue-only
(private hangouts stay walk-only). Music: venue context in the shared
crossfade machinery; mute law extracted to shell/musicMute.ts (compile-time
exhaustive Record over contexts) + 4 tests; grep: venue-lobby.mp3 only via
getAudioUrl, no new audio category; HMR registry now includes venueMusic.
Callsign gate: server refuses nameless queue entry (toggleQueue checks the
socket's name), nameless spawns read "RECRUIT" (machine names unreachable),
client prompts-before-connect via DOM overlay so the name always rides
/ws/lobby. Tests: hangoutMode.test.ts rewritten for the new contract
(8 pass — fire live, target immune through a bystander in the line of
fire, dummy breaks), venueHost.test.ts 11 pass (dummies/respawn/no-dup,
gate refuse/allow, RECRUIT). Suites server 183 / client 925, typechecks
clean, built, deployed. Live probe (server/probe-s2c.ts): nameless roster
name RECRUIT, dummy state decoded on a real /ws/lobby socket (interest-
filtered to the near dummy, full count of 3 pinned by unit test),
venue-status flowing, named connect rides "VERAPROBE". public /health 200.
