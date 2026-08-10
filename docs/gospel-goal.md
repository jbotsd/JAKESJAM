# THE GOSPEL — the one goal doc

**One engine, open doors, a native desktop at the end.**

Written 2026-08-05 ("GO ALL ZIG", ratified by Jake the same day).
**Consolidated 2026-08-09 into the single canonical goal**: this file now
contains Track D's full item detail (was `open-doors-goal.md`) and Track
N's full detail (was `native-desktop-goal.md`). Those two are stubs
pointing here. There is one goal doc. Adding another is a bug.

Run as an endless `/goal`: it never terminates — it re-aims. Every
completion condition is tool-satisfiable (L4).

**Ground truth:** this file's STATUS block (maintained commit-by-commit).
Reference docs that stay authoritative for their own contents, and are
NOT goals: `venue-goal.md` (Pillar 4/5/6 acceptance criteria),
`docs/adr/` (decision records), `design-axioms.md` / `ui-axioms.md` /
`chassis-design-axioms.md` (generative axioms), `RENDER_OVERHAUL_PLAN.md`
(baked vs live tier). Historical, closed, kept for receipts only:
`finish-line-goal.md` (2026-07-25, all tracks closed bar F2-blocked-on-
input and a Z4 flip since ratified), `convergence-goal.md` (2026-07-23,
superseded by finish-line), `cohesion-goal.md`.

---

## North star

> A stranger who clicks play.elyad.io on any device is **in a live fight
> in under 15 seconds**, understands what is happening, finishes a cycle
> with a ceremony, and chooses "again."

Numeric gates (published browser-game bars — Poki/CrazyGames):

| Gate | Target | Today (measured 2026-08-05) |
|---|---|---|
| Conversion-to-play (load → ≥1 min played) | ≥70% (80% = exceptional) | unmeasured; journey has 5 gates + ≥5 clicks before the lobby |
| URL → **in the world** | (precursor to the row below) | **~1.0 s median, first visit AND returning** (measured 2026-08-09, localhost) |
| URL → first shot fired | <15 s returning / <30 s first visit | front door now ~1 s; remaining distance is the BELL, not the boot — see note |
| Critical-path payload | <10 MB | **~1.4 MB over the wire** (origin measures 3.64 MB; Cloudflare brotli does the rest — was 12.12 MB) |
| First kill | <60 s | unguaranteed (default-class player vs mixed bots) |
| Play-again rate after first cycle | ≥50% | unmeasured; cycle ends in a modal |

## End state (the milestone the loop drives through, not where it stops)

1. **One sim.** The Zig core is the entire game simulation — authority on
   the server, prediction on the client, bit-identical replays
   everywhere. TypeScript is a presentation shell (DOM, render, netcode
   plumbing) that could be rewritten without touching game behavior.
2. **Open doors.** The north star above, with its numeric gates green in
   a stranger test.
3. **A native desktop build** — the same Zig core in a shell that owes
   TypeScript nothing — playable against bots offline (N2) and joining
   the public server as a first-class client (N3).

When all three are green the loop does not exit: it re-aims at the next
weakest thing against the "best game in the world" bar (footage first).

---

## THE LAWS (every session, every wave)

- **L1 · Zig-first.** Any change to game *behavior* (movement, combat,
  scoring, drafting, run records, bot policy, round flow) lands in the
  Zig core. TS may only implement what the sim cannot reach: DOM,
  render, audio playback, sockets, storage. If a behavior change is
  urgent while TS is still authoritative, it lands in BOTH sides with a
  parity test — never TS-only. After the flip (E2), behavior lands
  Zig-only with native tests; TS mirrors are retired, not extended.
- **L2 · Toolchain (locked 2026-08-05).** Zig pinned at **0.15.2**
  (`.tool-versions` + `minimum_zig_version`). Do NOT move to 0.16.x — a
  dead-end tag whose LLVM 21 ships with loop auto-vectorization DISABLED
  (persists through 0.17.x; 0.15.2's LLVM 20 still vectorizes, making it
  the fastest-runtime Zig today). Plan ONE deliberate jump to ≥0.17.1
  (or 0.18.x if release-perf matters by then), gated by: `zig build
  test` → TS parity suites (`client/src/sim/wasm/__tests__/`) →
  multi-seed divergence sweep → golden-replay determinism. Receipt: the
  whole gate ran against a 0.16.0-built sim.wasm on 2026-08-05 with zero
  source changes, artifact within 3 bytes — the jump is cheap and the
  harness provably catches what matters (0.17 changes `@bitCast`
  semantics — exactly that class of thing). Zig's canonical repo is
  Codeberg, not GitHub. **Footgun:** `/usr/bin/zig` on this box is
  0.16.0; only the repo's mise shim resolves 0.15.2. Build inside the
  repo or under `mise exec`, or you are silently on the wrong compiler.
- **L3 · Re-entry protocol.** Every session: (1) read this STATUS block;
  (2) footage/telemetry FIRST — newest replays/clips + warehouse funnel
  numbers; stationary >1 s = bug; (3) pick the weakest point by
  leverage, not by interest; (4) fix → verify → **commit small** →
  update STATUS. Never report "done" — report what is next-weakest.
- **L4 · Human gates are evidence rows, never blockers.** Every
  completion condition here is tool-satisfiable. Jake-owned decisions
  get built behind config flags with the recommended default DARK
  (current behavior preserved) so ratification is a one-line flip.
  Consent-class actions are NEVER auto-fired on silence: outreach sends,
  domain cutovers, PAX submission, announcer voice choice, flipping the
  email-gate position live. Parked ≠ blocking: no machine lane may wait
  on a human row.
- **L5 · Fan-out discipline.** Worktree-per-writer, branch
  `track-x/...`, merge `--no-edit`, delete after. Single-writer files:
  `world.zig`, `cards.ts`, `main.ts`, `style.css`, `sim/build.zig`,
  `sim/native/shell.zig`, **`docs/gospel-goal.md`** (added 2026-08-09
  after two agents wrote its STATUS on the same afternoon and got away
  with it only because their edits happened to land on different lines).
  Worktrees need node_modules symlinks (root + client + server).
  `sim.wasm` is gitignored — `zig build` after pulling Zig changes or
  wasm suites fail stale.
- **L5a · One goal, one runner.** This doc is an ENDLESS goal: "pick the
  next weakest thing" is its whole control flow. Two agents running it
  against the same checkout therefore race by construction — they pick
  from one queue, write one STATUS, rebuild one `dist`, and restart one
  host. Fan-out is still encouraged, but a second writer gets a SCOPED
  brief ("Doors 1.8 only, per this doc"), its own worktree, and its own
  branch; it does not run the goal and does not write STATUS. The
  session running the goal owns STATUS, merges, `dist` rebuilds and
  :8088 restarts. Evidence this is not theoretical: on 2026-08-09 a
  second session's in-flight `main.ts` edit broke the client bundle
  while the first was mid-verification, and both wrote the same doc.
- **L6 · Live-host discipline.** Server sim changes require a :8088
  restart to be live (check ops for humans first). The ops console is
  LAN-only :8089 — never route it through the public port. Client
  changes require a dist rebuild to be live.
- **L7 · Standing hard rules** (memory-enforced): Bun only; **no AI
  attribution in commits**; sizing-on-fleek (4 canonical viewports)
  before any UI change is "done"; no browser tabs in published footage;
  meme SFX are canonical recordings, never synthesized (the announcer
  VOICE layer is explicitly Decision 3, outside that rule); no
  triangle/eye symbolism — crystal/diamond grammar.
- **L8 · Honest meters.** Report parity/divergence/bench numbers as they
  land, including regressions. Silent scope cuts are recorded in the
  nearest section header, never dropped. A meter that flatters is a bug
  (see the warehouse signup-count finding, Track P).
- **L9 · The shell is not the sim.** Any shell — Phaser today, native
  tomorrow — contains zero game behavior: rendering, windowing, audio
  playback, input capture, sockets, asset IO only. Behavior found in a
  shell is a Track E bug. The test: headless and windowed builds produce
  identical hashes for identical input streams.
- **L10 · Hash-first determinism.** Native x86_64 float semantics must
  match wasm bit-for-bit: no FMA/`@mulAdd` contraction differences, the
  shared trig LUT everywhere (`lutCos`/`lutSin`/`lutAtan2`, never
  `Math.sin/cos/atan2`), no `Math.hypot` in sim code, no libm in sim
  paths. The N0 replay cross-check is permanent enforcement — it lives
  in `zig build test` forever, not once, and runs per-target.
- **L11 · Baked tier first.** New shells ship at the baked (Pi/phone)
  visual tier. Feel parity with the browser build is a footage-loop
  polish tail — tracked, never blocking a phase's acceptance.
- **L12 · Decisions are spiked, not vibed.** Technical picks are machine
  decisions with receipts, written as ADRs with alternatives and switch
  triggers recorded. Money/accounts/distribution (Steam, signing,
  storefronts) are Jake rows — built dark, never fired on silence.
- **L13 · This box bites.** Reproducible RTX 4080 / nvidia-open
  context-teardown hard-lock. Renderer work runs with sysrq enabled and
  `nvidia-persistenced` active, commits *before* first launch of a new
  spike build, and never while the public host has humans. A wedge must
  cost a reboot, not a lane.

---

## TRACK D — DOORS (the funnel; outranks everything)

**D-law:** sim-adjacent Doors items — run record (2.1), shared-draft
order (2.1), bot ramp (3.2), lobby presence floor (3.1), round-cap taper
(1.5), killfeed data (4.6) — are Track E features wearing Doors clothes:
they land in the Zig core per L1, ideally after E2 so they land once.
Pure shell items (gate position, fonts, preload, unfurl, overlays, copy)
proceed TS-side immediately.

**D-priority:** Phases 0–1 outrank everything in this doc. The funnel is
the reason the machine exists (~1 real signup, ~zero traffic).

"Publicly presentable" = every Phase 0–3 item DONE + Phase 5 shows the
gates green in a stranger test. Phase 4 is texture: it upgrades the
result, it does not gate it.

### Phase 0 — STOP THE BLEEDING · **COMPLETE 2026-08-05**

- [x] 0.1 Working tree committed — six lossless commits (a8a4eaa net
      identity escalation + tests · 10b359e CrazyGames removal · c3895ca
      global render governor · 5799ef5 Discord CTA/toast · 90f5bbe ops
      LAN listener + clip routes · 6d02055 marketing bank); worktree ==
      HEAD verified.
- [x] 0.2 Static-host unfurl fixed (09c5960) — `vercel-build.sh`
      substitutes PUBLIC_ORIGIN > VERCEL_PROJECT_PRODUCTION_URL >
      VERCEL_URL > play.elyad.io, build fails if `__ORIGIN__` survives.
- [x] 0.3 Brand font loaded (f926af4) — three families self-hosted
      (latin woff2 ~97 KB), first-paint preloads, googleapis dependency
      removed.
- [x] 0.4 Eager media preload killed (f926af4) — ~13.3 MB → ~0 at boot;
      music `preload="none"`, splash video 49 KB poster + metadata,
      starts on the click-to-initiate gesture.
- [x] 0.5 Splash CTA above the fold (e35112e) — 393×852 was already
      healthy; the real fail was short desktop (1280×700 clipped LOBBY +
      button row). Height-scoped media tier; all four viewports verified
      by screenshot.
- [x] 0.6 Doc-drift purge (merged d18641b) — every item fixed with a
      code-side receipt + a 7-hit CrazyGames/Poki sweep.
- [x] 0.7 Honest-copy fixes (merged 46843d2) — [T] DUO QUEUE hidden on
      touch; "Rematch" → "READY FOR NEXT CYCLE" (+ 393px wrap fix);
      one-shot clip-recording disclosure, localStorage-gated.
- [x] 0.8 Tree hygiene — ~84 MB of stubs, .bak files, __pycache__ and
      dead portal artifacts verified then deleted.

### Phase 1 — THE FRONT DOOR (URL → fighting; conversion)

The journey audit's blocker chain in one sentence: email gate → boot gate
→ 27.9 s ident → splash → callsign → walk → up to 100 s bell wait → 3 s
admission race that can park you as a spectator for a full round and then
tell you "ELIMINATED" before you ever spawned. Items 1.3/1.4/1.5a have
now cut the cruellest half of that chain.

- [x] 1.1 Lobby-first landing — DONE 2026-08-09 (7ed8198). Bare URL lands
      in the venue; ceremony promoted to opt-in (`?intro=1`); escape
      hatches `?splash=1` + `localStorage jakesjam.lobbyFirst=off`; kiosk
      keeps the full rite (there the ident IS the content). **Screenshotting
      the landing caught the real blocker**: the venue gates its own
      connect on the callsign, so lobby-first alone meant a stranger's
      whole first impression was a name box over an unconnected black
      void — `isSharedWorldInvite` now covers the bare URL, so you are in
      the room in ~2 s and rename later. Still one callsign prompt total
      (both surfaces write one localStorage key). e2e 4/4 including all
      four viewports.
      - **Findings for later, NOT regressions of 1.1** (from the landing
        screenshots, `tests/e2e/.artifacts/lobby-first/`): portrait
        framing shows mostly wall — the crowd and loadout table that make
        the room read ALIVE are off-camera on phone while short-desktop
        shows them; and short-desktop has a dead black band left of the
        room wall. Venue camera-fit work; sits with Phase 3.
- [x] 1.2 Email gate position — **BUILT DARK** 2026-08-09 (f267c73).
      End-of-demo pattern implemented; `DEFAULT_GATE_POSITION = "boot"`
      keeps today's behaviour, `"post-fight"` is the ratification — one
      line. "Maybe later" becomes persistent + timestamped in that mode
      instead of per-tab. Demoable without editing source via
      `?gate-position=post-fight`. ⚠ **DECISION 1 still Jake's** — L4
      forbids firing it on silence, so the row is machine-complete and
      consent-open.
- [x] 1.3 Admission race fixed (merged 7e5639c) — server-authoritative
      admission tickets (30 s TTL, late sockets insert at ANY phase) +
      client pre-open hold; venue tap reordered before the pending drain.
      8 new server tests, 5 verified-failing pre-fix.
- [x] 1.4 A never-spawned player is never told they died (merged
      baa2538) — real sites were OnlineMatchScene ~1198 + ~1343 (doc
      refs were stale); tested `deathOverlayPresentation` routes
      never-spawned to "YOU'RE IN" / NEXT BELL, no eliminated announcer
      keys, seal hidden.
- [x] 1.5a Bell wait survivable (merged b2f151b) — venue touch mounts
      full combat controls (dummies hittable on phones; aim-assist
      deliberately NOT mirrored — it would steer off PvP-immune lobby
      dummies) + persistent top-center NEXT BELL countdown from second
      zero (honest `--:--` until the first status frame).
      **Gap flagged:** venue KEYBOARD lacks the Emission/dash binds that
      touch now exposes.
- [x] 1.5b Bell taper — **BUILT DARK** 2026-08-09 (061fb28).
      `BELL_TAPER=on` shortens the bout in progress when a human queues;
      unset keeps today's cadence (a test pins the dark default so cadence
      cannot change live by accident). Mechanism reuses an existing sim
      input rather than adding one: `targetScore` is DERIVED from
      `state.chaosModifierIds`, so swapping the `target-score-N` id retunes
      the TS round machine and the Zig path in one mutation — no override
      field, no second source of truth, L1-clean. Steps 7→5→3 and REFUSES
      any taper landing at or below the leader's score (that would end the
      bout on the spot — worse for the people fighting than the wait is for
      the people queued). Fires on queue entry, the only moment the answer
      can change.
      ⚠ **DECISION 2 still Jake's**, and it now has a **hard prerequisite**:
      a replay records `chaosModifierIds` at match START, so a mid-flight
      taper re-sims against the original target score and diverges at the
      end. Ratifying requires a mid-match mode-change record alongside
      ReplayRecorder's `rosterEvents` (same pattern; the Zig `.jjr` reader
      already skips unknown top-level keys). Harmless while dark.
- [x] 1.6 `?fight` fast lane + `venueNames.ts` — DONE 2026-08-09
      (0aa1261 + 3b8bebd). Queueing is sim-event driven
      (`launch-requested` from the bell totem), so the fast lane adds a
      TRIGGER, not a second queue path: it routes through the same
      `toggleQueue`, so the callsign gate (a deep link must not be a way
      around S2.C.3) and the duo branch hold identically. `ensureQueued`
      guards on membership because toggleQueue is a TOGGLE — calling it
      blindly on attach would queue then UNqueue a reconnecting player,
      the same "silently dropped from the queue" class 1.3/1.4 just
      closed (pinned by a test). `?world=1` / `/world` alias per P6.3.
      Deliberately NOT fast-laned: `?venue=1` and the bare 1.1 default —
      committing a first-timer to a bout before anything taught them the
      bell is Phase 3 onboarding's call, not this item's. `venueNames.ts`
      owns the words (splash CTA, callsign kicker, arena feed line, both
      document titles, all four NEXT BELL captions); P6.1's grep half
      already passed — all 24 remaining "Hot Lobby" hits are comments
      plus one test name, zero user-visible. Deviation recorded (L8):
      BELL_COPY stays in `bellCountdown.ts` where its tests live.
      Gates: server 358/358 TS + 358/358 strict-wasm, client 1958/0,
      both typechecks clean.
- [x] 1.7 Refresh-mid-match recovery — DONE 2026-08-09 (b5adbe2 +
      2318025). The server grace and the stable player id both already
      existed; only boot's *intent* was missing. sessionStorage marker,
      2 s heartbeat + pagehide, checked before the URL branches;
      deliberate exits clear it. **e2e 3/3 in real Chromium against a
      real host**: reload in venue lands on a live surface, deliberate
      exit is not resumed, stale marker is not resumed.
- [x] 1.8 Class select on the main path — DONE 2026-08-09 (1557e46 +
      8dbbbbd). `game/ui/classPicker.ts` owns the element (extracted
      verbatim from CardDraftOverlay, which delegates), mounted in BOTH
      the private-room form (the bare `<select>` is gone) and **Settings**,
      two keystrokes from anywhere. Two views, ONE persisted key, kept in
      step by `jakesjam:class-change`. Writing the e2e is what proved the
      first attempt was only half the item: tiles in the room form gave
      one presentation but left the choice in a panel hidden by default,
      and the click failed "element is not visible".
      - **Latent bug found in EVERY shell layer, now fixed:**
        `.shell-layer` is `overflow: auto` with `align-items: center`, so
        once content exceeds the layer height, centring pushes the frame's
        TOP above the scroll origin and it is unreachable forever (scroll
        down works, up does not). A Class section made Settings cross that
        line at 1280×800 — first control visible, enabled, un-clickable.
        Fixed with `align-items: flex-start` + `margin: auto` on
        `.shell-frame`: centred while it fits, scrollable when it isn't.
        Repairs settings/clips/credits/pause. Precisely what L7 exists for.
      - Also un-staled two 1.7 e2e cases that asserted a splash from a
        bare URL — that stopped being a 1.7 statement once 1.1 made the
        venue the default landing; they use `?splash=1` now.
      Gates: client 1963/0 (+3 skip), tsc clean, classPicker e2e 6/6
      including all four canonical viewports, matchResume + lobbyFirst
      7/7 re-run green against the CSS change.

### Phase 2 — CLOSE THE LOOP (venue-goal Pillars 4 → 5, as written)

Acceptance criteria live in `venue-goal.md`; this sequences them. Build
order: 4 before 5 (the ceremony needs run data to celebrate). Per D-law,
the sim-side halves land in Zig.

- [ ] **2.1 Pillar 4** — sim-side run record, HUD run strip, death card
      **SCOPING NOTE 2026-08-10 on the draft-order sub-item, written after
      starting it and backing out:** the row points at `round.ts:343`
      (alphabetical by playerId) as the thing to make reverse-standings.
      Two corrections to that framing:
      - `draftingIds` at that line feeds only length/`every` checks, so its
        sort is determinism hygiene, not pick priority. The order a player
        actually SEES is the `draft-resolved` emission a few lines below.
      - more importantly, **`round.ts` does not run under the live
        authority at all.** matchHost:1119 — "Zig owns the draft on this
        backend" — so a TS-only reordering is dead code on wasm and would
        create an authority-dependent ticker order while looking done.
      Doing it properly means the ZIG side, which emits `draft_resolved` at
      pick time per player (`draft.zig:422`) rather than in a batch, so
      reverse-standings needs the emission buffered to end-of-window and
      sorted by score. That is the actual work; it is not a one-line sort.
      A TS-only patch was written, tested green, and reverted rather than
      shipped.
      with run facts + edge-vignette spectate (kill the full-screen blur
      wash, `DeathOverlay.ts:220-233`), shared draft (pick ticker,
      reverse-standings order — today alphabetical by playerId,
      `round.ts:343` — announced auto-picks), "joined R4" scoreboard
      honesty.
- [ ] **2.2 Pillar 5** — cycle end returns EVERYONE to the venue
      together; podium + MVP ceremony in the lobby; 10 s map vote; arena
      reboots beneath; two-step re-entry. `MatchResultsOverlay` dies.
      Ceremony discipline (Overwatch field-study lesson): it fills the
      recycle interval that already exists (12 s ceiling) and NEVER
      delays the next bell; any input skips.
- [~] **2.3 Personal-record surfacing** — client-side slice DONE
      2026-08-09. The item says it feeds off Pillar 4's sim run record,
      which does not exist and is frozen — but `playerStats` has tracked
      bests locally all along, so the trigger ships now and gets richer
      later. `recordStreak` was already computing "did this beat the
      best" and throwing it away; it returns it now, and `recordMatch`
      reports first-ever / first-win. A gold strip at cycle end
      (`pb-toast`, non-blocking, self-dismissing — ui-axioms bans modal
      celebration as hard as modal tutorials) rides the same
      CYCLE_COMPLETED signal Doors 1.2 added.
      - **The rule that matters: an unremarkable cycle says NOTHING.** A
        strip that fires every time is one nobody reads, and then the one
        that mattered goes unread too. Pinned by test.
      - **And it works for losers** — a personal best is the one thing a
        last-place finisher can still be truthfully handed, which is the
        entire reason the row exists.
      - Still open: per-ROUND surfacing (no client round-end signal
        exists yet) and class-scoped records ("first win as
        Geometrician") — both need 2.1's run record. Recorded, not faked.
- [~] **2.4 Pillar 2/3 residuals** — audited row by row 2026-08-09:
      - [x] orphan-ceremony regression test — DONE (f64661b).
      - [ ] lobby presence floor — genuinely open, see 3.1 (frozen path).
      - [x] the unmeasured dummy-hit-<8 s half of venue 2.5 — **MEASURED
            AND PASSING 2026-08-10: 3753 ms** against an 8 s bar (10 s
            asserted). Not a game bug; see the STATUS entry — the harness
            aimed 174 px high, and the spec now calibrates the
            screen→world map instead of assuming the camera centres the
            player. Superseded detail below.
      - [x] ~~the unmeasured dummy-hit-<8 s half of venue 2.5 — MEASURED
            2026-08-09, and the answer is that it does not happen at all:
            a visitor closes to 18px of a practice dummy, on the same
            floor, firing an 880px hitscan continuously, and no
            destructible ever loses health. Spec committed as
            `tests/e2e/timeToDummyHit.spec.ts`, marked `test.fail()` so
            the suite goes RED when it starts working. Ruled out:
            not-in-venue (lobby.present=1), not-firing (fireCooldownMs
            non-zero 133/162), range, ammo, and intended behaviour
            (World.ts:3018 says destructibles stay hittable in hangout).
            **UNCONFIRMED hypothesis:** the lobby is not in hangout mode —
            it defines 8 dummies and shows 1, and sits at phase
            "round-over" while the arena cycles to "fighting". Chasing it
            touches frozen paths, so it waits for the flip.
      - [ ] ready-totem linger debounce — open.

### Phase 3 — ALIVE AND UNDERSTANDABLE (empty room + onboarding)

The arena is genuinely alive (4 bots fighting before anyone arrives). The
lobby — the mandatory antechamber — is genuinely dead, and nothing
teaches the loop.

- [~] **3.1 Lobby presence floor** — naming half CLOSED 2026-08-09, the
      presence half still open.
      - [x] **Plausible varied names, never Name+digits.** Already true
            (12 machine-part names, no digits) and now pinned by a test.
      - [x] **Bot ids are unique over TIME** — a latent bug found while
            auditing the above, not a cosmetic one. The id is derived from
            the name (`bot_<name>`), `nameCursor` persists across bells,
            and the roster is 12 long, so a host up for days wraps the
            cursor onto a name still standing in the arena:
            `this.bots.set(id, ...)` then overwrote a LIVE bot and the same
            playerId went into a match roster twice. Now takes the first
            name not in use. Mutation-checked — reverting the fix yields 5
            distinct ids for a 6-bot roster.
      - [x] **Violet plates stay honest** — bots render `BOT · NAME` on a
            violet rig, unchanged and verified in the live killfeed
            evidence above.
      - [x] **Persona bots idle IN THE VENUE** — DONE 2026-08-10. Three
            named personas stand in the lobby whenever fewer than that
            have been displaced from the arena, so the QUIET case — the one
            a first visitor is most likely to walk into — is not an empty
            room. Displaced bots count toward the same budget, so a busy
            server tops up less and the two mechanisms cannot stack.
            Names are a pool DISJOINT from the arena roster (SHIM, GASKET,
            TAPPET, PINION): the two rooms name bots independently and
            neither coordinates, so a shared pool would eventually stand
            SPARK in both at once — a bug, not presence. Pinned by a test
            that reads the arena's actual ROSTER block.
            Violet accent, matching BOT_RIG_COLOR, because the Settings
            copy promises every bot is a violet body with a BOT plate and
            an idler in ally gold would make that sentence false.
            Capped so 4 allies + 6 idle leaves six of the sixteen player
            slots for actual humans.
      - [x] **Displaced arena bots return to the venue** — DONE
            2026-08-10. The old code said so itself ("displaced bots simply
            sit out — no lobby idling this sprint"), and the cost was a
            first impression: the antechamber emptied exactly when humans
            began arriving. `worldHost` now fires `onBotDisplaced` /
            `onBotRecalled`; VenueHost re-homes the persona in the lobby
            with its name and chassis intact, and retires it on recall so
            the same bot never stands in two rooms. Capped at 6 (the
            arena's own bot cap). Hooks are OPTIONAL — the arena still runs
            standalone with no venue attached, which most of the suite and
            every single-match server depend on.
            Tested against the REAL VenueHost handlers and a real lobby
            roster; deleting the handlers fails 5 of 6. A first draft
            tested a local re-implementation of the same rules and would
            have passed with production deleted — noted because that is
            the failure shape this repo keeps hitting.
      - [x] **One line owns the policy** — DONE 2026-08-10. Settings gains
            a BOTS section stating it as fact: bots fill fights when there
            are not enough people, they idle in the venue, they are always
            labelled (violet body, BOT plate), they are never counted as
            players in anything you are shown, and nobody is a person
            wearing a bot's name or the reverse. No FAQ page existed and
            one was not invented for a single paragraph — Settings is two
            keystrokes from anywhere and already owns the Controls
            reference.
            The CLAIMS are pinned by `botPolicyCopy.test.ts`: the label
            format, the rig hue (hue, not an exact hex — a tint tweak is
            harmless, a green bot is not), the humans/bots split staying
            two fields, and the id prefix being reserved. Copy that stops
            being true misleads every player and they cannot check it, so
            it gets the same treatment as an honest meter (L8).
            Verified on screen at 393px, not just asserted: sweep 5/5 and
            the section reads cleanly with 38px to spare.
- [ ] **3.2 First-session bot ramp** (Smash Karts / Fortnite pattern) —
      a new player's first cycle is bots tuned to lose entertainingly;
      guarantee a first kill inside 60 s; blend humans in from cycle two.
      Keyed on localStorage next to the FTUE flags. **Lands in Zig via
      N-BOT** — do it once.
- [~] **3.3 Onboarding by encounter** — first slice DONE 2026-08-09: the
      VENUE now teaches. The controls legend only ever existed in
      OnlineMatchScene, which was fine while the arena was where you
      arrived — Doors 1.1 made the venue the LANDING, so a newcomer stood
      in a room full of hittable dummies with no idea that hitting them
      was a thing, and stayed uninstructed until the bell. Staged
      three-group legend (move → aim/fire → shield + "the dummies are
      hittable — try it"), sharing `jakesjam-ftue-controls-shown` with the
      arena so a player is taught exactly ONCE, wherever they land first.
      Captured at desktop and phone; the first draft collided with the
      "[T] DUO QUEUE" hint and was moved below the whole top-left status
      band — caught in the capture, not in review.
      Second slice DONE the same day: **a persistent controls reference
      in Settings** (8 bindings, mono keycaps, two-column grid; stacks
      under 420px). The legend teaches once and is then gone forever,
      which is right for a legend and wrong as the only place the
      controls were ever written down — a player who blinked, switched
      device, or came back next week had nowhere to look. Settings is two
      keystrokes from anywhere. Verified rendering at desktop and phone.
      Third slice DONE: **ghosted glyphs over the dummy** — the form
      ui-axioms actually asks for. Walk within 300 px of the practice
      dummy and a faint world-anchored "HIT ME" appears ON it; hit
      anything once and it is gone forever. Its own localStorage key, not
      the legend's, because "that object is a target" is a different
      lesson from "here are the controls" and a shared key would let
      whichever fired first suppress the other. Verified end to end:
      glyph rendered over the dummy at 147 px, retire flag set after a
      real hit.
      - **Retirement watches destructible HEALTH, not an event.** The
        first version hooked `spawnDamageNumberAt` — the one callback
        that fires exactly when a dummy is hit — and it never ran:
        measured a dummy going 60 → 48 with the hint still up. Watching
        the health sum cannot miss a hit that actually happened.
      Fourth slice DONE: **the first-storm line**. "THE RING IS CLOSING /
      OUTSIDE IT YOU BURN", once ever, warm-toned rather than the
      legend's cyan because it is a warning and not a lesson. Fired on
      the ring becoming ACTIVE, not on the player being caught outside
      it — by the time it is hurting you an explanation is a post-mortem;
      the useful moment is while you still have somewhere to run.
      - **first-cycle-end is already covered** by 2.3's strip ("FIRST
        CYCLE — you finished one"), so that half of the row was closed by
        a different item rather than needing its own line.
      Fifth slice DONE — **class verbs on first pick**, which closes the
      row. Picking a chassis for the first time announces its kit using
      the SAME `kitSummary` string the picker shows (one source, so the
      two cannot drift, and characters.ts already enforces "name only
      abilities that are live today"). Once PER CLASS, not once ever —
      picking Kindled teaches nothing about Syzygist, and a single flag
      would have meant three of four chassis never explaining
      themselves. Hung off `jakesjam:class-change` rather than one
      picker's callback, so it fires from Settings AND the venue loadout
      station — the reason 1.8 made both announce their writes.
      Cyan-accented, not the personal-best gold: information, not earned.
      **3.3 is now complete** except a re-summonable legend, which is
      polish rather than a gap now that Settings carries the reference.
      Original item: onboarding by encounter (ui-axioms bans modal tutorials) —
      the lobby teaches movement/fire via ghosted glyphs over the
      dummies; the FTUE legend becomes re-summonable (today: once ever
      per browser, `OnlineMatchScene.ts:763-766`) plus a persistent
      controls reference in Settings; first-storm and first-cycle-end get
      FTUE lines like the first-draft one. Class verbs taught on first
      pick of that class, not up front.
- [x] 3.4 Seven-zeros splash fix — DONE 2026-08-09. A visitor with no
      history no longer sees five counters they could not have earned
      plus ONLINE 0 / IN MATCH 0; they see arena liveness instead.
      Measured before: seven zeros. After, newcomer with 4 bots live:
      `["4 FIGHTERS WARMING UP · AI"]`. Returning player is unchanged —
      `["12 KILLS","7 DEATHS","4 BEST STREAK","3 MATCHES","1 WINS",
      "4 FIGHTERS WARMING UP · AI"]`.
      - Honest in BOTH directions: bots never join a player count, they
        carry their own label saying what they are. Real humans, when
        present, lead the strip and bots demote to "AI SPARRING".
      - Bots come from `/health` (`world.bots`), not `/venue/summary`
        which has no bot count — deliberately avoided a server change so
        the E2 soak's freeze clock kept running.
- [~] **3.5 Silent-failure sweep** — audited item by item 2026-08-09
      rather than swept, because two of the four were already dead:
      - [x] **venue visitors unable to reach the pause menu** — ALREADY
        FIXED (the `matchMode !== "lobby"` guard, 2026-07-20); the row was
        stale. Verified empirically, not by reading the comment: Esc from
        the venue opens the pause panel (`pause:true`) and does NOT
        misroute to the private-room panel.
      - [x] **lobby disconnect with no retry affordance** — FIXED
        2026-08-09. It read `Disconnected: <reason>` and stopped: a dead
        end on what is now the LANDING (Doors 1.1), so a dropped socket
        was the last thing a first-time visitor saw. Now names the
        recovery, and the recovery is real — Doors 1.7 means a reload
        inside the 10 s grace re-attaches to the SAME entity. Verified by
        killing the host under a live browser: "Disconnected: code:1006 —
        reload to rejoin". Remaining polish: a clickable retry instead of
        instructing a reload.
      - [ ] **callsign-gate no-op at the bell totem**
        (`venueHost.ts:604-611`) — untouched: `server/src` is inside the
        E2 soak freeze. Note it may now be unreachable anyway, since
        `isSharedWorldInvite` auto-names bare-URL arrivals (Doors 1.1) —
        confirm before building.
      - [ ] **1 s blank venue feed** — not reproduced yet; the feed shows
        "Connecting to hangout…" then real status, which is honest. Needs
        a cold-cache repro before it is worth a fix.

### Phase 4 — SOUND AND SPECTACLE (texture; upgrades but does not gate)

- [ ] **4.1 Regenerate the slash-audio slate.** The F2 input artifact is
      gone (`~/Music/jakesjam-slash-audio/` does not exist on this
      machine — the blocker is missing input, not "awaiting picks").
      Canonical recordings via yt-dlp per L7; rebuild CANDIDATES.md; Jake
      picks; wire `slash-started` (fully silent today) and a real
      `stab-landed` cue.
- [ ] **4.2 Venue loop audio** — bell ring, ceremony/podium sting, draft
      tick, lobby ambience. Same sourcing pipeline as 4.1.
- [ ] **4.3 Announcer** — 16 keys wired, 100% silent (no assets exist).
      ⚠ **DECISION 3** (voice source: Jake records / local Kokoro / cut
      the layer). The never-synthesize rule was written for meme SFX; a
      voice layer is Jake's call.
- [ ] **4.4 Studio SFX pack** — `scripts/process-sfx.ts` + SFX_KIT brief
      are complete; `~/Music/binipe-sfx/` doesn't exist. The `shoot` cue
      is heard ~1000×/session as synth fallback.
      - Its visible symptom, chased and dismissed 2026-08-09: every page
        load logs `404 /audio/sfx/manifest.json`. That is CORRECT — the
        pack genuinely is not there, and `SampleEngine.loadAll` treats a
        missing manifest as "synth fallback everywhere" by design. Do not
        silence it with a HEAD request or an empty manifest; that would
        hide a true statement. It goes away when the pack lands.
- [~] **4.5 Lobby VFX parity** — swept 2026-08-09, and the blocker is
      gone. The open rows were gated on "the loadout-station equip flow,
      a real prerequisite" — Doors 1.8 made class ONE selection at
      `jakesjam.playerCharacter`, so `tools/lobby-vfx-capture.mjs` picks
      a chassis directly instead of walking a rig to a station. All four
      captured firing in the venue, frames in
      `tests/e2e/.artifacts/lobby-vfx/`:
      - [x] **Syzygist tether — RENDERS** (was "not attempted"). Visible
        looping construct beside the rig, HUD "Tethered Charge".
      - [x] **Kindled ward — RENDERS.** Golden shield construct, HUD
        "Kindled Ward", 125 HP.
      - [x] **Interstice blade — RENDERS.** Cyan blade, HUD "Slipstream",
        85 HP.
      - [ ] **Geometrician lance — DOES NOT RENDER, and it is the
        DEFAULT class.** Sharpened 2026-08-09: `balanced` → wizard →
        Geometrician is what every new player starts as, and it is
        hitscan (HARD class rule — never a projectile). Probing the venue
        while firing shows **zero projectile entities ever created**,
        which is correct for hitscan and is why a first-shot metric based
        on projectile count reads "never fired" for a default-class
        player. The dummy DOES take damage (measured 60 → 48), so the
        shot is real and the damage number appears — **but the beam
        itself draws nothing.** So a newcomer who reads the venue's own
        "the dummies are hittable — try it" prompt, clicks, and watches
        carefully sees a number appear out of thin air with no weapon
        effect between them. That is a first-impression bug on the
        landing surface, not just a VFX gap. Earlier detail: ten burst frames at ~45 ms across the whole cast,
        aimed at the practice dummy, with fire confirmed reaching the sim
        (the rig turns and the muzzle lights). Frame sizes vary <0.7%, so
        nothing was drawn. **Likely cause, and it is already on the
        board:** the lance is a raycast (HARD class rule — never a
        projectile), and the E1 residual list records "zero-damage
        cosmetic hit-confirm events dropped on the wasm hangout path".
        A beam whose VFX rides a hit-confirm would vanish in exactly the
        PvP-immune lobby. Fix sits in the hangout event path — inside the
        E2 freeze, so recorded rather than attempted.
      - [ ] cast-tells for all 4 — not separately isolated; the charge
        frames are captured (`*-charge.png`) but distinguishing a tell
        from the construct needs a per-class expectation the doc does not
        yet state.
- [x] **4.6 Live killfeed** — DONE 2026-08-09, verified LIVE in a real
      arena over a 300 s watch, and the full run covers more than the
      single line first reported:

      ```
      t+131s  BOT · SPARK eliminated BOT · PISTON     <- two OTHER players
      t+150s..t+210s  1 line up                        <- holds
      t+229s  BOT · SPARK eliminated Vessel-EVKFC4     <- the LOCAL player dies
      t+240s  0 lines up                               <- TTL swept it
      ```

      That covers three distinct paths, not one: a third-party kill, the
      local player's own death (the `ofLocal` branch), and expiry actually
      happening on a live clock rather than only in a unit test. `client/src/game/ui/killfeed.ts` is a pure model (10
      tests): unattributed deaths show the victim only, a suicide
      (killerId === victimId) collapses to the same form rather than
      rendering "Bram eliminated Bram", executes get their own verb, 5 s
      TTL, 4-line cap, injected time. Wired in OnlineMatchScene's
      `handleSimEvents` so it reflects EVENTS rather than whatever the
      renderer had a rig for, and cleared on round change.
      Not "data side in Zig" as the old row assumed: `player-killed` is
      already emitted by the sim, and a feed changes nothing about what
      happens — only what is shown. L1 puts BEHAVIOUR in the core; this is
      presentation over an existing event, so it stays client-side.
      Observability came first because it had to: a line lives ~5 s, so a
      screenshot can neither prove the feed works nor prove it does not —
      the first attempt produced exactly that ambiguous frame (arena,
      score 1-1-0, no feed, kills older than the TTL). Now
      `__killfeedLines()` returns null when no feed is registered and `[]`
      when one is showing nothing.
      Worth remembering for the next timing-bound feature: the first FOUR
      poll windows showed "registered, 0 lines" and would have read as
      "broken" to an impatient check. Kills between bots are ~1 per 40 s
      and most of a session is spent in the venue waiting for the bell, so
      a 150 s watch was simply too short — the failure was the observation
      window, not the feature.
- [x] 4.7 — DONE 2026-08-09. `dvh` pairs at all four viewport-sized rules
      (`.app-shell` plus the three panel caps; line numbers in the old
      item were stale). `html.kiosk` deliberately stays `vh` — fixed
      display, no retracting URL bar — annotated at the rule so a future
      grep does not read it as missed. The sizing rule is now written
      down: `ui-axioms.md` § "The canonical viewport pass".
      - **Writing it down immediately caught the drift it was meant to
        prevent**: ui-axioms already named a four-viewport set
        (390×844 / 844×390 / 820×1180 / 1440×900) that OMITTED short
        desktop — the one viewport that caught the Doors 0.5 fold bug —
        while the e2e specs used a different four that omitted phone
        LANDSCAPE. Reconciled to one canonical five, and
        `lobbyFirst.spec.ts` now loops that exact set (passing, and the
        newly-added landscape frame was looked at, not just asserted).

### Phase 5 — PROVE IT → see TRACK P (runs continuously)

---

## TRACK E — ENGINE TO GOSPEL

- **E1 · Completeness — COMPLETE 2026-08-05.** Split-spawn orchestrator
  in `world.zig`; classModifiers carried in the Zig codegen (both patch
  functions retired, true merge semantics + class starter bases); Paper
  Doubles + real `next_entity_id` through `worldStateBridge`; hangout
  flag in `step_world` (TS-only PvP-immunity pin lifted, both hosts).
- **E1-residual · new items surfaced by wave 2** (small, land with E2 or
  just after):
  - [x] homing-at-integration — **FIXED 2026-08-09 (1f3e204)**.
    `findHomingTargetIdx` mirrors `closestNonOwnerPlayer`; the turn
    applies before integration (TS's own ordering), so stepV2's own
    branch still finds nothing and cannot double-turn. zig 170/170,
    TS↔wasm parity 343/0 (48,754 asserts), server 363/0 under strict
    wasm. **Two named leftovers, recorded at the call site:** the Veil
    of Nought skip is a no-op only because the veil ACTIVE is itself
    unported (`.veil_of_nought => {}`) — whoever ports the veil MUST add
    the skip in the same commit or homing silently tracks through it;
    and Priest tendril platform avoidance still needs a static spatial
    grid inside `step_world` (`spatial.queryGrid` exists, nothing builds
    the grid on this path) reusing the SAME candidate order or the
    nearest-surface tie-break diverges. Tendrils now home but do not yet
    dodge terrain — a smaller, named divergence than not homing at all.
  - Hangout dummy melee/edge-arc alternates unported (per-swing dedupe
    is the blocker).
  - Zero-damage cosmetic hit-confirm events dropped on the wasm hangout
    path.
- **E2 · The flip.** Zig authority live on the public host
  (USE_WASM_STEP_WORLD=1 equivalent as default) with a kill-switch env.
  Direction RATIFIED 2026-08-05 — no consent gate remains; execution is
  evidence-gated only: full server suite green under wasm step →
  headless bot-only soak (≥2 h, zero divergence events, heap flat) →
  flip + observe + STATUS entry. **Prerequisite-free since 2026-08-05
  and verified NOT DONE on 2026-08-09** (`USE_WASM_STEP_WORLD` absent
  from the running :8088 server's environment). This is the cheapest
  unblock on the board: everything in Track N past N0 waits on it.
- **E3 · De-mirror.** After E2 is stable: the TS `World.ts` step path
  retires progressively (dead code deleted, not maintained); parity
  suites freeze as a regression archive keyed to the last mirrored
  commit; new behavior ships Zig-native with `sim/test/` coverage only.
  `client/src/sim/` is 34,726 lines that stop needing to exist.
- **E4 · Aim-intent substrate.** Input semantics (mouse exact / touch
  assisted / stick assisted+snap) become a sim-level input dialect so
  every platform shell feeds the same aim contract. Serves touch
  fairness today, gamepad/Steam-Deck tomorrow, desktop + console later.

---

## TRACK N — NATIVE DESKTOP (the end-state artifact)

**Scope of "no TS":** the *desktop artifact* contains zero TypeScript,
zero JS runtime, zero web view — one native binary plus assets. The
browser client and the Bun server keep existing; de-TS-ing *them* is E3.

### N gates (tool-satisfiable)

1. **N0 · Port passport.** A native (x86_64-linux first) CLI steps any
   archived `.jjr` replay headless and emits state hashes; for every
   replay in `server/.replays/` the native hash stream is bit-identical
   to the wasm path's, wired into `zig build` so it runs forever after.
2. **N2 · Playable offline.** Windowed ReleaseFast build: full round
   cycle (spawn → fight → bell → draft → emission → ceremony → again)
   against bots, 60 Hz sustained (frame p99 ≤ 16.6 ms over a 5-minute
   bot match), input-to-sim ≤ 1 frame, audio live, zero network.
3. **N3 · First-class client.** Native build joins the public :8088 host
   and completes a match in a lobby shared with a browser client — zero
   protocol errors server-side, zero divergence/resync events across
   ≥30 min.

### Verified starting position (measured 2026-08-09, not estimated)

- **The sim is done and portable:** 17,520 lines of Zig across 20
  modules; 142 native tests already compile and run the core natively.
  `build.zig` only *ships* wasm32 — portability is proven, not hoped.
- **Port/replace surface (TS-only today):** presentation shell
  `client/src/game/` **54,392 lines** of Phaser 4.2.1 (`OnlineMatchScene`
  3,506 · `ProceduralPlayerRig` 3,385 · `LightConstruct` 2,824 ·
  `HangoutScene` 1,835 · `StatusVfxController` 1,667 · `CardDraftOverlay`
  1,590 · `ProceduralAudio` 1,117 · `CosmicArenaLayer` 1,085 + tail) —
  mostly *procedural* shapes and shaders, which ports far better than an
  asset-heavy game would; bot brain `worldBots.ts` 706 + `botArenaNav.ts`
  208; map gen `maps.ts` 201 + `mapStore.ts` 285; netcode
  `client/src/net/` ~3.7k with the delta bit codec core only 177 lines.
- **World-init:** TS constructs initial state and packs it through
  `worldStateBridge`; the core has `world_state_set_spawn_points` but no
  full native constructor — shells currently *hand the sim a world*
  (hence N0.5).
- **Replay format is on our side, with one asterisk:** `.jjr` = header +
  protocol version + RNG seed + input stream, never WorldState — so a
  re-sim needs no *semantic* work. It IS raw msgpack with no magic bytes
  and no framing, so it needed a decoder (written 2026-08-09,
  `sim/src/native/msgpack.zig`). 10 archived files, 100 MB.
- **Assets:** `assets/sfx-memes/` 27 MB canonical recordings +
  `client/public/` 57 MB. Needs a packer and decoders, not new art.
- **The TS sim mirror does not need porting** — it retires under E3.

### N0 — PORT PASSPORT (**unblocked NOW**, exempt from the E2 wait)

- [x] **0.1 Native build target** — DONE 2026-08-09 (f7b5796).
      `zig build native` → `jjsim`; `zig build run-native -- <args>`.
- [x] **0.2 `.jjr` reader in Zig** — DONE 2026-08-09 (f7b5796).
      msgpack pull-decoder + header/inputs/rosterEvents reader; unknown
      formatVersion is a hard error; replays with
      `backendFallbackTicks > 0` are flagged unusable as passport
      fixtures. **10/10 archived replays parse, 0 failed.**
- [x] **0.3 Headless stepper + hash stream** — DONE 2026-08-09 (4aa8882).
      `jjsim replay-hash <file.jjr>` steps from the packed initial state and
      prints a hash of the state buffer every N ticks.
      **Sequencing win found 2026-08-09 — 0.3/0.4 do NOT have to wait for
      0.5 or for named maps.** The passport compares native vs wasm on the
      same input stream; it does not care who BUILT the starting world. The
      TS side already packs a full `WorldState` for the wasm path
      (`worldStateBridge.packWorldState`), so a small Bun tool can dump the
      initial packed state beside a `.jjr` and the native harness can load
      it and step from there. That makes the passport reachable for all 10
      archived replays now, and demotes 0.5 from a blocker to a cleanliness
      item (shells should not hand the sim a world — but the passport can
      prove bit-identity before that is true). Cost: the native harness
      must write per-tick inputs exactly as `serverWasmHost.step` does, so
      that path is the thing to get right, not world construction.
      **Init dumper DONE 2026-08-09 (7642134):**
      `bun server/tools/dump-replay-init.ts server/.replays/*.jjr` →
      11/11 replays, 99,200 bytes each, named maps included.
      **The input contract, read off `serverWasmHost.writeInputsIntoMemory`
      so N0.3 starts from facts instead of guesses:** players are ordered by
      SORTED player id; per player, `aimX` at byte 32, `aimY` at 40, `keys`
      (u32) at 268, `prevKeys` (u32) at 272, stride `PLAYER_ENTITY_SIZE`,
      base `statePtr + HEADER_SIZE + 8`. Natively none of that byte math is
      needed — the same `WorldState` struct is in scope, so write
      `state.players[i]` fields directly and let the compiler agree with the
      packer. The one genuinely unresolved question, and the divergence risk
      to settle FIRST: what the live host feeds a player who has no input
      frame on a given tick (`matchHost`'s per-tick assembly), because a
      wrong answer there diverges silently rather than loudly.
- [x] **0.4 Cross-check gate — PASSING** 2026-08-09 (4aa8882).
      `bun run passport` (scripts/passport.sh) steps every archived replay
      through BOTH the native build and sim.wasm and diffs the hash
      streams: **replays=12 agreed=12 skipped=0 diverged=0**. Native
      x86_64 and wasm are bit-identical — L10 is now measured, not assumed,
      and the native build is provably the same game.
      - Hash is over the raw 99,200-byte packed buffer, not a semantic
        per-entity digest: one shared layout means bytes are the strongest
        claim available and need no second implementation to drift from.
      - **DEVIATION recorded (L8):** the comparator cannot literally live in
        `zig build test` — it needs Bun to drive the wasm half and `zig
        build` cannot. It is `bun run passport`; the stepper's own unit
        tests DO run inside `zig build test` (172/172).
      - Default 3000 ticks/replay (crosses a round boundary + first draft);
        `--ticks 0` for full length before a toolchain jump.
- [~] **0.5 Native world-init.** THE MISSING HALF IS BUILT (2026-08-09).
      `world_init_player` + `world_init_roster` land the player-entity
      construction the scoping note identified as "the actual work":
      spawn placement (wrapping when the roster outruns the spawns), class
      chassis base health, alive flag, cleared buff windows, and a defined
      facing. Acceptance is met for generated arenas — smoke.zig builds a
      roster through the exports ALONE, with no packed state, and steps it
      30 ticks with gravity moving the rig, which is the "create and
      self-play without packed-state input" bar.
      Two things worth keeping from the build:
      - the first version set only the counters it knew about, and
        `step_world` panicked on `index 2863311530` (0xAAAAAAAA — Zig's
        undefined fill) from garbage destructible/pickup counters. An init
        that leaves ANY field undefined has not created a world, and the
        failure surfaces nowhere near its cause. It now zeroes the whole
        WorldState first.
      - `docs/zig-wasm-exports.md` has a sync test, and it caught the two
        undocumented exports immediately. Good instrument; left as found.
      ~~STILL OPEN: named maps are TS data, so native init reaches only
      the 5 `gen:N` replays~~ — CLEARED the same day by N-MAP below:
      `world_state_load_named_map` builds all six named maps natively, so
      the split the passport was told to report no longer exists.
      (original scoping note below)
- [ ] ~~**0.5 Native world-init.**~~ `world_init(seed, map_id, roster)` in
      the core (exported to wasm too) so shells stop hand-packing initial
      state. The TS bridge keeps its packing path (parity-tested) until
      E3. Acceptance: the N0 harness can *create* a world natively and
      self-play bots without packed-state input.
      **Scoped 2026-08-09 against the code — half of this already exists:**
      - EXISTS: `alloc_state`/`state_size`; `world_state_generate_arena`
        (writes statics + one_way + spawns + arena size + theme for a
        `gen:N` seed, i.e. the whole map half for generated arenas);
        `world_state_set_{arena_bounds,arena_size,spawn_points,statics,
        slopes,launch_pads,target_score,hangout_mode}`;
        `resolve_player_loadout` / `resolve_player_fire_config`; and class
        starter bases, which crossed with E1's codegen.
      - MISSING: the player-entity construction itself (place at spawn,
        apply class base health/chassis, attach the resolved loadout) —
        today that is TS's `World.create` packed through the bridge. This
        is the actual work of 0.5, and it is bounded.
      - **BLOCKER for 5 of the 10 archived replays:** named maps
        (boxworks-tower, vessel-nexus, skyseam) are TS data only, so
        native init cannot build them. 5 replays are `gen:N` seeds and are
        reachable now. Do the passport on those FIRST and record the split
        deliberately (L8) rather than reporting a whole-archive pass that
        silently skipped half — the named-map geometry is N-MAP's
        remainder, not 0.5's.

### Interlock lanes (Track E work Track N needs; they land per L1, once)

- [~] **N-BOT · Bot brain into the core.** FIRST SLICE DONE 2026-08-09 —
      the NAV half (`botArenaNav.ts`, 208 lines) is ported to
      `sim/src/bot_nav.zig` with a parity gate. Its own header said "PURE:
      no Math.random, no Date, no host", which is why it went first: every
      function is decidable from its arguments, so parity is a direct
      comparison instead of a lockstep sim.
      `botNavParity.test.ts` drives BOTH implementations over four real
      named maps with a position grid — 1724 assertions on LOS, cover
      flanks, hop targets, megaScale, dirTowardX and the compiled
      cover/ledge counts.
      Mutation-measured rather than assumed: inverting the flank side
      fails 3 tests. Scaling the flank score by 1.0001 does NOT — that is
      a property of the data (candidates never score within 0.05) rather
      than a hole, and it is written into the test header so nobody reads
      "mutation-tested" as "every mutation dies". Ranking between
      near-equal candidates stays weakly covered.
      **Also caught:** `pub const x = @import(...)` in root.zig is NOT
      enough to emit a module's `export fn`s — root has an explicit
      `comptime { _ = ...; }` block and a new module must be added to it or
      its exports silently vanish from sim.wasm while every Zig test still
      passes.
      **TARGETING half also DONE 2026-08-11** (`sim/src/bot_target.zig`):
      `nearestFoe`, `headingTowardMe`, `inboundThreat`. `nearestFoe` is
      the one that needed a real gate — four running bests resolved by the
      bot-on-bot preference (a bot within 1.55x of the nearest human wins)
      and the newcomer grace window, every comparison a strict `<`. Wrong
      by a little does not throw; it makes the gang dogpile the wrong
      player, or the first-timer the grace window exists to protect.
      `botTargetParity.test.ts` drives the REAL private methods (reached
      by cast — testing a copy would prove nothing) against the export:
      401 assertions including 300 seeded-random layouts, with a vacuity
      guard that more than one KIND of target got chosen. Mutation-checked
      by moving the factor 1.55 → 1.20, which fails 2.
      **MODE SELECTION also DONE 2026-08-11** (`sim/src/bot_mode.zig`):
      retreat / commit / cover / chase / hold, plus the anti-standoff
      commit timer and its human-vs-bot delay. 9 tests.
      The subtlety this slice is really about: the cover branch calls
      `rand()` in the MIDDLE of a short-circuited `||` chain, so whether
      the RNG is consumed depends on `dist` and on which earlier operands
      were true. Writing it the obvious way — hoist the draw, then
      evaluate — advances the stream on ticks the TS leaves alone, and
      every later bot decision diverges. Nothing crashes; the bots just
      stop matching the browser's. So the port takes a `rand` CALLBACK
      and the tests assert draw COUNTS (0 when a map-blind bot skips
      cover, 0 when `coverUntil` is already active, exactly 1 in the roll
      band, 0 outside it). Mutation-checked: the hoisted-draw refactor
      fails 8.
      **UNSTICK also DONE 2026-08-11** (`StuckWatch` in bot_mode.zig) —
      the first genuinely STATEFUL piece to cross, so its 6 tests drive
      SEQUENCES rather than snapshots. A bot pressed against a wall
      reports movement intent every tick and goes nowhere; without this it
      grinds there forever, which is the most visible way a bot looks
      broken. Hops at 3 stuck ticks, reverses at 48, re-arms at 54 rather
      than immediately (immediate clearing oscillates). Vertical movement
      is weighted 0.35 so sliding down a wall still counts as stuck.
      Mutation-checked: dropping the "only if it WANTED to move" guard
      fails 4 — a bot deliberately holding position must not be hopped.
      **BODY-THREAT REACTION also DONE 2026-08-11** (`BodyThreatWatch`):
      someone dashing at us, close and closing → after a 320 ms reaction
      delay, ONE draw picks shield / dash-away / jump. 8 tests asserting
      draw counts, not just outcomes.
      The subtle rule pinned here: a flat shield does NOTHING. The TS
      falls through to no action, and reading the chain as "shield, else
      dash" would quietly make low-shield bots more evasive than they
      are. Mutation-checked — adding that fallthrough fails 2.
      **Latent trap found and DOCUMENTED rather than silently fixed:**
      `bodyThreatSince === 0` uses zero as both the sentinel and a
      timestamp, so a threat beginning at exactly `now_ms == 0` starts its
      timer one tick late. Unreachable live (monotonic clock), reachable
      in any test or replay whose clock starts at zero — which is how it
      surfaced. Left matching the TS: diverging on a timer is how bots
      stop behaving identically. I also first wrote the trap down as
      "never fires", and the test corrected me to "loses one tick".
      **OFFENSIVE SLIDE + EMISSION CAST also DONE 2026-08-11.** Both are
      "should I press this" decisions with a rule that is easy to get
      subtly wrong:
      - the slide's `rand()` is LAST in its `&&` chain, so it is consumed
        only after every cheap condition passes. Tier 0 (the FTUE gate)
        and a fresh foe both reject before any draw — a newcomer's first
        fight does not even roll for a bot power-sliding into them.
      - the emission delay is drawn ONCE at arm time. Re-rolling per tick
        — the tidier-looking shape — collapses a uniform 1–3 s delay into
        a geometric one and bots would fire almost immediately.
        Mutation-checked: re-arming every tick fails 2.
      - out of range with a full meter KEEPS the timer; only spending the
        charge disarms. That is what lets a bot chase and cast on arrival
        rather than restarting its delay at the door.
      STILL OPEN: aim/fire output, the melee branch, the draft, and the
      remaining per-bot memory.
      (original row below)
- [ ] ~~**N-BOT · Bot brain into the core.**~~ Port `worldBots.ts` +
      `botArenaNav.ts` (~900 lines) to `sim/src/bot.zig` with parity
      tests against the TS brain (same seed, same decisions, N seeds × M
      ticks). Simultaneously Doors 3.2's landing site. Required for N2;
      also upgrades the E2 soak (sim-native bots = closer to shipped
      truth).
- [x] **N-MAP · Named-map data into the core.** DONE 2026-08-09. All six
      hand-authored maps (boxworks, -mini, -tower, -practice, vessel-nexus,
      skyseam — 118 platforms) now exist natively via
      `sim/src/data/maps_gen.zig`, generated by `bun run gen:maps` from the
      TS files, which stay the single source of truth. Codegen, not a
      hand-port, for the same reason `gen_card_data.ts` exists: a copied
      mirror drifts the first time someone nudges a platform.
      New exports: `world_state_load_named_map` (statics + one_way into the
      state, spawns into the SAME module table `world_init_roster` reads, so
      a native world places players correctly), `named_map_count`,
      `named_map_geometry` (parity dump).
      An unknown id loads NOTHING and returns 0 rather than substituting a
      default — swapping geometry silently turns a replay desync into a
      mystery instead of a clean failure.
      **The gate that makes this trustworthy** is `namedMapParity.test.ts`:
      every map's statics, one-way flags, spawns and size are compared
      against `buildStaticCache` — the structure the TS sim actually
      collides against, not a re-derivation written for the test. 269
      assertions. Mutation-checked: moving one vessel-nexus platform in the
      generated file fails it, so a stale codegen cannot pass.
      With N0.5, native world creation now reaches **every** arena the
      browser can build, generated and named alike — which removes the
      "5 of 10 replays" blocker that row recorded.
      (original re-scoping note kept below)
- [ ] ~~**N-MAP · Map gen into the core.**~~ **RE-SCOPED 2026-08-09: the
      generator is ALREADY in Zig.** `sim/src/data/map_gen.zig` (737 lines)
      has `generateArena(seed)`, `validate`, `world_state_generate_arena`
      and `gen_arena_geometry` — so every `gen:N` arena is core-native
      today and the "port the generator" framing was wrong.
      What actually remains: the NAMED maps (boxworks-tower, vessel-nexus,
      skyseam, boxworks-practice) are TS data (`client/src/sim/data/*.ts`),
      so nothing native can construct them. That is what blocks native
      world-init for 5 of the 10 archived replays and what N2 offline needs
      for its non-generated arenas. Treat this lane as "named-map data into
      the core", not "port the generator".
- [~] **N-AIM · E4 aim-intent substrate.** FIRST SLICE DONE 2026-08-10 —
      the dialect lives in the core (`sim/src/aim_dialect.zig`).
      `exact` (mouse) passes through untransformed; `assisted` (touch) is a
      port of `touchAimAssist.ts` — 20 deg cone, 900px, blend ramping to
      0.6; `snap` (gamepad) is NAMED but deliberately unimplemented and
      behaves as assisted, because guessing it now would be a second thing
      to keep in parity for no consumer.
      Ported rather than left in TS so the raylib shell shares ONE assist
      instead of growing a slightly-different second one — "slightly
      different" is the whole risk here: the target is chosen by a strict
      `>` on a cosine, so a reordered expression changes WHO a player is
      nudged toward and never crashes, it just "feels off on mobile".
      **THE CONTRACT, now written down:** a shell submits a WORLD-SPACE aim
      point; how it gets there is the shell's business and the sim never
      sees screen coordinates. That was implicit until venue 2.5 cost a
      night to an e2e that assumed the camera centres the player.
      `aimDialectParity.test.ts` compares the real TS against the wasm over
      a direction grid — 81 assertions, including the nearest-to-crosshair
      tiebreak and every boundary (dead, out of range, outside the cone,
      zero-length stick). Mutation-checked with the substitution count
      VERIFIED first (an earlier mutation this session silently failed to
      apply and looked like a passing test).
      STILL OPEN: the shells do not call it yet — the browser keeps its TS
      path until E3, and there is no native shell to wire. `snap` awaits
      gamepad.

### N1 — SHELL: **DECIDED**, one confirmation spike (after E2)

**Shell lib = raylib. Fallback = SDL3.** Decision, full alternative
analysis (sokol, hand-rolled GL, webview wrapper — all rejected on the
record) and switch triggers: **`docs/adr/0008-native-shell-raylib.md`**.
Criteria that drove it: one dependency covering batched 2D + additive
blend + render-to-texture, TTF text, and ogg/mp3 decode of the 27 MB
canonical SFX bank; caller-owned frame loop; cheap Windows
cross-compile; on-box today (`extra/raylib 6.0`).

- [x] **1.1 Confirmation spike** — PASSED 2026-08-10, full result in
      `docs/n1-spike-result.md`. Every item on the bar: window OK, 500
      additive shapes at **p99 1.48 ms** against a 16.67 ms budget (~11x
      headroom), HUD text from a TTF, the canonical `bruh.wav` decoded
      from file, mouse round-trip and gamepad 0 present. Built with
      `@cImport` on `raylib.h`, raylib 5.5 vendored and built IN-REPO —
      no system install on a daily driver whose nvidia stack moves every
      `-Syu`.
      **The first run lied and the fix matters more than the pass:**
      `SetTargetFPS(60)` makes raylib sleep to the cap, so p99 came back
      as exactly 16.67 ms with a cheerful "60 Hz HELD" — the meter
      reporting what it was asked for. `--uncapped` is the run that means
      anything, and the spike now prints which mode produced the number
      and refuses to say "held" on a capped run.
      **L13 findings the shell inherits:** (1) Zig 0.15.2 cannot link this
      box's `crt1.o` — GCC 16 emits `.sframe` with an `R_X86_64_PC64`
      relocation it does not handle; fixed by pinning `glibc_version` so
      Zig supplies its own start files, which then required an explicit
      `/usr/lib` path because that puts Zig in cross-compile mode. NOT a
      reason to move the toolchain pin. (2) the repo's brand fonts are
      `.woff2` and raylib needs TTF/OTF — a real asset gap for the native
      build. (3) GL 3.3 confirmed and stable over ~2500 frames, so
      ADR-0008's GL-instability switch trigger did not fire.
- [ ] ~~**1.1 Confirmation spike** (one worktree lane, timeboxed). Bar:~~
      open a window; 500 moving additive-blended shapes at 60 Hz with
      frame p99 printed; HUD text from a TTF; one canonical meme SFX
      decoded from file; mouse + one gamepad. Built via `@cImport` on
      `raylib.h` (no third-party bindings) **inside the repo or under
      `mise exec`** (L2 footgun). A spike that fights the box (L13)
      records that as a finding — and as a live check against ADR-0008's
      GL-instability switch trigger.
- [x] **1.2 Promote or fall back.** PROMOTED 2026-08-10. ADR-0008's Status
      block now reads **CONFIRMED** (was "spike-gated"), carries the
      spike's headline numbers, and records the two findings it produced —
      the `crt1.o`/`.sframe` link failure and the `.woff2` font gap. SDL3
      stays the named fallback; its triggers stay live, and the spike
      checked one directly (GL 3.3 stable across ~2500 frames, so the
      GL-instability trigger has NOT fired).
      `sim/src/native/shell.zig` is the skeleton — deliberately thin, and
      the doc comment says why: the shell owns pixels, sound and the OS
      and NO behaviour, because that is what keeps the port passport
      meaningful. A shell that starts deciding things is a second
      implementation wearing a renderer's clothes.
      The one piece with real logic is the fixed-timestep `StepClock`:
      5 tests covering sub-step accumulation, the spiral-of-death cap, a
      backwards clock, and a steady-60 Hz vacuity guard. Dropped steps are
      COUNTED, not swallowed — silently discarding sim time is what later
      reads as "the native build feels different". Mutation-checked (cap
      → 100000 fails 4 tests), substitution verified first.
      (original row below)
- [ ] ~~**1.2 Promote or fall back.** Bar met → promote to~~
      `sim/native/shell.zig` skeleton, ADR-0008 flips from spike-gated
      to confirmed. Bar missed → SDL3 per the ADR's triggers, follow-up
      ADR, no re-argument of the rejected candidates.
- **1.3 Netcode groundwork** (standing research verdict): plain threads
  + nonblocking sockets, **no** std.Io async, **no** Zig std TLS
  (0.15/0.16) for anything.

### N2 — PLAYABLE OFFLINE (the mountain, climbed at the baked tier)

- [~] **2.1 Frame loop + world render.** ACCEPTANCE MET 2026-08-10 —
      `jjplay` plays an archived match back windowed and the hashes match:

      ```
      headless : 30489 ticks, final hash 4775eef8
      rendered : 30489 ticks, final hash 4775eef8  (508 frames drawn)
      MATCH: rendering did not touch the simulation (L9)
      ```

      **The proof works because there is exactly ONE stepper.** `jjplay`
      does not re-implement the replay loop — it calls the same
      `stepper.run` `jjsim` uses and passes a per-tick draw hook that
      receives a CONST state. Two separate loops that happened to agree
      would prove nothing; one loop called by both is what makes the
      match evidence.
      Verified the check can fail: a hook that `@constCast`s and nudges a
      player by 0.5px reports `DIVERGED` with both hashes. That took three
      goes — the first mutation targeted a tick the renderer skips at
      `--speed 60`, so it compiled, never ran, and read as a pass. The
      mutation now announces itself, so "it ran" is observed.
      Also fixed en route: `stepper.Options.every = 0` panicked on
      `tick % 0`. Zero now means "final sample only", which is what anyone
      writing it means.
      **Camera: DONE.** Follows the living centroid (a replay has no
      "you"), smoothed because a centroid jumps hard on a death, and
      clamped inside the arena so a viewer never stares at void and
      wonders if the map is broken. `--fit` keeps the old whole-arena
      framing for checking geometry. Fitting vessel-nexus's 3000 units to
      1280 px was 0.43 px/unit — a player was a 7 px dot and the replay
      was unreadable.
      **Interpolation: DONE, and deliberately in a SEPARATE mode.**
      `--smooth` is the frame-driven loop the real shell needs: the frame
      owns the clock (`shell.StepClock` — its first real consumer), pulls
      however many fixed steps the elapsed time owes, and draws at a lerp
      between the last two sim states. Measured: 30489 ticks over 3812
      frames, 0 steps lost to the spiral cap.
      It is NOT the hash-proof path and says so at runtime, because the
      proof needs ONE stepper shared with jjsim — a matching hash from
      this loop would be two implementations agreeing rather than one
      being observed. Both modes share `stepper.findSlot` (made public
      rather than re-guessed) so "which player is this input for" has a
      single answer.
      Draws stay baked-tier procedural — rectangles and discs. Now
      covering arena, destructibles, projectiles, fire patches (at their
      REAL radius, since the size is why someone walked around it),
      players, nameplates, health pips and satellites. Satellites orbit
      their owner (angle + orbit_radius, never a world position), so the
      position is derived and the owner resolved through the SAME
      `stepper.findSlot` the replay path uses — a second id-matching rule
      would put a satellite on the wrong player exactly when it matters
      (recycled slot, mid-match joiner). Unresolvable owners are skipped
      rather than drawn at the origin.
      That plus a HUD line (tick / round / alive / projectiles) is the
      remaining scope on this row: it is a viewer, not the game.
      (original row below)
- [ ] ~~**2.1 Frame loop + world render.**~~ Fixed-tick sim (the server's
      tick) decoupled from render; interpolated presentation; camera.
      Arena, destructibles, satellites, projectiles, players as
      baked-tier procedural draws. Acceptance: an N0 replay *rendered* —
      watch an archived match play back windowed with hashes still
      matching (L9's proof-of-innocence for the shell).
- [~] **2.2 Input dialect (mouse-exact).** MAPPING DONE 2026-08-10 in
      `shell.mapInput` — pure, so it is testable without a window, and the
      raylib layer's only job is filling a `RawInput` struct. Every
      decision about what a key means lives where a test can reach it.
      Covers the control truth: WASD, SPACE/W jump (W is up AND jump, same
      as the browser), left-click fire, SHIFT shield, right-click OR C for
      the aegis slide (one verb, two bindings, neither doubling), E
      emission, 1-3 abilities. 6 tests.
      **The arm gate is reproduced and pinned:** E is inert unless the
      meter is full, because the browser gates it client-side and a native
      shell that sent the bit early would let a native player ask for
      something a browser player cannot. Mutation-checked — removing the
      gate fails 4 tests.
      **Latency, measured not asserted:** mean **6.0 ms**, worst
      **16.667 ms** over 3812 frames, where one step is 16.667 ms. So
      input→sim is ≤ 1 frame, and the worst case IS exactly one step —
      the bound holds by construction, not by luck. Honest scope: this
      measures poll→consuming-step inside the loop, not photon-to-photon;
      display and compositor latency are not in it.
      **Row correction:** it says "1-4 drafted actives"; the rack is
      locked at THREE (`MAX_ABILITY_SLOTS`) and the shipped Controls copy
      says 1-3. Three is implemented and a test asserts nothing maps to
      bit 13.
      STILL OPEN: nothing consumes the mapped input yet — `jjplay` polls
      and measures it but replays a recording, so there is no live local
      player to drive. That arrives with N2.4 (offline match vs bots).
      (original row below)
- [ ] ~~**2.2 Input dialect (mouse-exact).**~~ Per the control truth in
      CLAUDE.md: move, Shift shield, left-click alternating throws,
      right-click/C aegis slide, E emission at full charge, 1-4 drafted
      actives. Input→sim ≤ 1 frame, measured not asserted; the
      full-charge client-side arm gate reproduced exactly (humans can
      never reach the parry, same as browser).
- [ ] **2.3 Round cycle + draft UI.** Bell, round flow, universal
      round-end draft (winner drafts too; weights come from the core,
      not the shell), emission compose/cast, ceremony, "again". The
      draft overlay is the one genuinely new UI build — functional-ugly
      first per L11.
- [~] **2.4 Bots + offline match.** PLAYABLE SANDBOX DONE 2026-08-10 —
      the first time the game runs outside a browser.
      `jjplay --sandbox <map>` builds the world in the CORE
      (`world_state_load_named_map` + `world_init_roster`, no packed state
      from TS), the frame loop owns the clock, real device input drives
      player 0 through the tested dialect, and `step_world` is the same
      core the browser and server run. Verified on every named map:
      vessel-nexus 39 statics, skyseam 44, boxworks-tower 14, all with the
      player resting on geometry at full health.
      Two things it reports rather than assumes: whether the player FELL
      THROUGH THE WORLD (a run that "completed" while the rig fell forever
      would otherwise look like a pass), and the frame/tick ratio — which
      caught a busy-spin drawing **132,135 frames for 600 ticks**, ~220
      draws per tick burning a core. StepClock decouples the sim from the
      frame rate; it does not mean the frame rate should be infinite.
      Vsync now paces it: 753 frames for 600 ticks.
      Gotcha worth keeping: `world_init_roster` ZEROES the state, so the
      map has to be loaded AGAIN after the roster. Found by the arena
      rendering empty and the player falling forever.
      STILL OPEN: no bots (N-BOT's stateful half is not ported) and no
      round cycle, so it is a movement/shooting sandbox rather than a
      match. Bots are the rest of this row.
      (original row below)
- [ ] ~~**2.4 Bots + offline match.**~~ N-BOT brains fill the roster; full
      FFA cycle with all four classes present (chassis rule: the
      Geometrician stays raycast, in any shell, forever). Acceptance:
      the N2 gate numbers over a scripted 5-minute soak, logged per L8.
- [~] **2.5 Audio.** DECODE+PLAYBACK PATH DONE 2026-08-10, the CUE is
      unproven and the reason is a fixture gap, not the code.
      Proven: `jjplay` loads `sfx/damnson.wav` out of `assets.jjpk` via
      `LoadWaveFromMemory` — no filesystem access for audio at runtime, no
      synthesized substitute (standing rule), and the pack's hashes are
      verified before anything is decoded so a half-copied pack fails
      loudly instead of as a burst of noise. Silence is REPORTED: the
      viewer prints whether the pack was missing, present-but-unloadable,
      or loaded, because a silently-silent viewer is indistinguishable
      from a broken one.
      The DECISION is proven; the CUE is not, and those are now separate
      things. `shell.DeathWatch` holds the edge detection and is unit
      tested without a window — fires once on alive→dead and not every
      tick a corpse lies there, re-arms on respawn, never fires for a slot
      that started dead (a mid-match joiner's empty slot), keeps slots
      independent, and tolerates more players than it watches. 5 tests;
      mutation-checked by making it fire on STATE instead of transition,
      which fails 8.
      It lived inline in `play.zig` first, which links raylib and a window
      — so it could not be tested at all, and its only exercise was
      replays that happen to contain no deaths. Moving it was the fix.
      Still unexercised end-to-end: the archived corpus reports **0 ticks
      with a body down** across replays of 30489 and 47172 ticks (both
      arena maps, both 2-player, nobody dies), and a fresh 4-bot recording
      produced no kills either — bots barely fight without a human target.
      So the SOUND has never actually played. N2.4's live match is where
      that gets tested, and it is a fixture gap, not a code gap.
      STILL OPEN: the `ProceduralAudio` synth graph port, and the A/B
      event-aligned capture the row's acceptance asks for — which needs a
      replay containing deaths.
      (original row below)
- [ ] ~~**2.5 Audio.**~~ Canonical SFX decode+playback (never synthesized
      substitutes) + the `ProceduralAudio` synth graph ported to the
      native mixer. Acceptance: A/B capture of the same replay
      browser-vs-native, event-aligned; missing/extra cues listed.
- [~] **2.6 HUD + killfeed + nameplates.** NAMEPLATES DONE 2026-08-10 in
      `jjplay`: without them a replay is six identical dots and you cannot
      follow anyone, which is most of what watching one is for. Bots are
      labelled `BOT <NAME>` in violet, matching botIdentity's rule and the
      Settings copy that now states it as fact — an unlabelled bot in the
      native viewer would make that sentence false. Hash proof re-verified
      after the change. HUD and killfeed still open.
      (original row below)
- [ ] ~~**2.6 HUD + killfeed + nameplates.**~~ Baked-tier text; killfeed
      data from the core (Doors 4.6's landing site). Class-identity
      legibility per the chassis axioms (colour stays earned:
      cyan/gold/white).
- [x] **2.7 Asset pack.** DONE 2026-08-10. `bun run pack:assets` →
      `sim/assets.jjpk` (13 assets, 8.85 MB): SFX, music, and any TTF/OTF
      fonts. Read back by `sim/src/native/pack.zig` — index parse, slices
      into the caller's buffer, no allocation and no decoding, because
      raylib's loaders take bytes and the pack's job ends at "here are the
      right bytes". Nothing in the reader can fetch anything: offline
      means offline, which is the actual requirement.
      **Determinism is verified, not assumed:** entries sorted by name
      (readdir order is filesystem-dependent), padding explicitly zeroed,
      no timestamps or build-machine paths in the file. `--verify`
      rebuilds in memory and compares byte-for-byte: OK.
      Every entry carries an FNV-1a of its content and `verifyAll()`
      checks them, because a pack is exactly the artefact a bad deploy
      half-copies and "the SFX sounds wrong" is a miserable way to find
      out. A hash mismatch is a DISTINCT error from truncation — a short
      file is a bad copy, a changed file is something else.
      Checked against the real pack, not just synthetic ones: 13/13 hashes
      verify and `sfx/bruh.wav` comes back with a valid `RIFF` header, so
      the offsets are right rather than merely self-consistent.
      **The .woff2 fonts are deliberately NOT packed** (N1.1 finding:
      raylib cannot load them). A pack full of files the shell cannot open
      is worse than an empty one — it looks solved.
      (original row below)
- [ ] ~~**2.7 Asset pack.**~~ Deterministic packer (a Bun script is fine —
      it's a build tool, not the artifact): fonts + SFX + music manifest
      → one pack file with content hashes. No network fetch at runtime;
      offline means offline.
- [ ] **2.8 Polish tail** (post-acceptance, footage-driven): live-tier
      VFX (constructs, status effects, tethers — Interstice/Syzygist
      only), screen-shake/juice parity, announcer hooks. Normal L3
      footage loops; never blocks N2 "done".

### N3 — NETWORKED (first-class client)

- [ ] **3.1 Codec port.** `snapshotDeltaBits.ts` (177 lines) + the delta
      escalation rules (identityChanged self-healing included) to Zig,
      with a golden-vector suite: captured browser byte streams decode
      identically in both implementations. TS keeps a mirror until E3.
- [ ] **3.2 Transport. ⚠ OPEN DECISION ROW (machine, needs an ADR).**
      WebSocket client over plain threads + nonblocking sockets. Zig std
      TLS is disqualified by the standing verdict, so: (a) direct ws://
      — **cannot reach play.elyad.io at all**, since the Funnel is
      TLS-terminated, so this survives only as the LAN/dev path; (b)
      vendor a C TLS lib (mbedTLS 3.6.5 is installed on-box) and keep
      wss:// through the existing endpoint; (c) a dedicated non-TLS game
      port. **Recommendation on record: (b)** — zero server changes (the
      native client uses the same `srv.upgrade` path, same query params,
      same 30 s admission ticket as the browser, so one auth story), no
      new exposed port (a second public game port regresses the "only
      :8088 exposed" posture), and mbedTLS is marginal cost when the
      build already links C for the shell. Remaining work is RFC 6455
      client framing — masking, ping/pong — around the delta codec we
      already own.
- [ ] **3.3 Prediction + reconciliation.** The same predict/reconcile
      contract the browser runs, but both sides are now the same Zig
      core — divergence should be structurally impossible; the meter
      proves it (zero resyncs ≥30 min, logged).
- [ ] **3.4 Mixed-lobby acceptance.** The N3 gate, run for real: native
      + browser client in one public lobby, full match, server logs
      clean. A stranger on the browser build must not be able to tell
      which opponent was native. Admission tickets / pending-entrant
      flow honored identically — the native client is a client, not a
      special guest.

### N-PLATFORM — targets

x86_64-linux first (this box, fastest loop). **Keep x86_64-windows
compiling from day one** — Zig cross-compiles, raylib cross-builds
cheaply, the download audience skews Windows, and platform rot found at
N4 is expensive. macOS last: needs a Mac plus Apple signing and
notarization, so a Jake row. The L10 hash passport runs **per-target**,
or "bit-identical" quietly means "on one OS".

**First actual check, 2026-08-09 — both cross-compile clean, zero source
changes:**

| target | result |
|---|---|
| `x86_64-windows` | `jjsim.exe`, PE32+ console binary, 3.3 MB (+ .pdb) |
| `aarch64-linux` | ARM aarch64 ELF |

So the rule is currently satisfiable rather than aspirational, and the
sim's portability claim survived contact with a second and third target.
**What this does NOT show: execution.** A cross-compiled binary that
builds is not a binary that runs, and L10 wants the passport's hash
stream verified PER TARGET — that needs a Windows box or an emulator,
and until then "bit-identical" still means "on x86_64-linux". Recorded
as the gap it is.

Watch out: building a cross target overwrites `zig-out/bin/jjsim` with
the foreign binary, which silently breaks `scripts/passport.sh` until
`zig build native` is re-run for the host. Cost a confused minute here.

### N4 — DISTRIBUTION (parked)

Packaging, icons, Steam. Out of scope until N3 is real. Every N4 item
that costs money or creates accounts is a Jake row. Do not open this
section early because it is fun; it is fun, and it is parked.

---

## TRACK P — PROOF (runs continuously, never completes)

- [x] **P1 Funnel telemetry — INSTRUMENT LANDED** 2026-08-09 (70698be).
      All eight steps fire once per session with elapsed ms from page load,
      on the existing batched/capped telemetry queue; wrong-input count in
      the first 30 s is tallied locally and reported once. Report splits ALL
      sessions from EXTERNAL-only, because ~90% of sessions are Jake's own
      machine and an unsplit funnel measures the developer.
      Placement notes: `first_input`/`first_shot` come off the assembled
      input bitfield (an input the GAME accepted, not a key the browser
      saw — the gate is URL→shot FIRED); `played_again` counts a SECOND
      arena entry, so the Back-to-Lobby round trip counts too.
      Honesty rules with tests: milestones are monotonic and back-fill with
      `backfilled: true` so a missing call site reads as a wiring bug rather
      than a drop-off.
      **Still needs DATA to say anything** — a dist rebuild plus real
      visitors. The report prints that instead of printing zeros as
      findings. Fixing "the largest absolute drop" starts when there is one.
- [ ] **P2 Footage-study cadence.** Every phase ends with a re-render of
      the newest replays and an indexed frame critique against the north
      star. Standing rule: re-watch latest footage FIRST on every
      re-entry; stationary >1 s = bug. **Queue: 2 of the 3 2026-07-31
      replays remain un-studied.** No newer replays exist — no human has
      played since 07-31.
  - Findings from the studied one (docs/clip-sheets/study-2026-08-05-jul31-replay.md):
    **S1 FIXED 2026-08-09 (367f1cc)** · **S2 FIXED 2026-08-09 (4600eaf)** ·
    S3 HUD-less renders read countdowns as dead air (MED, open) · S4 render
    envelope documented (≤~45 s windows; upload 413 above; full-match
    encode wedges — documentation only, done).
    - **S1** (7.7 s statue bot): the no-foe path drew its idle direction
      from `[-1, 0, 1]` — 0 meaning STAND STILL — held 900–2300 ms, and
      consecutive zero rolls compounded (four ≈ 9 s, which is what was
      filmed). The unstick detector also sat AFTER that path's early
      return, so an idle bot leaning on geometry never reached it. Both
      fixed; 3 tests verified failing pre-fix. N-BOT must carry these
      across rather than porting the old shape.
    - **S2** (director dwells on stillness): `pairScore` weights speed but
      closeness (×1.6) + low HP clears the duel threshold at ZERO
      movement, and the existing dwell protected the MODE, not the
      SUBJECT — so after any cut the camera drifted straight back to the
      statue. Added a 1.5 s idle dwell cap (cut to the liveliest, else a
      wide shot that HOLDS) plus a rule never to trade a moving subject
      for a still one. Max stare 6–8 s → under 3.4 s.
      **Still open, deliberately:** full action-weighted SCORING so
      motion outranks a motionless pair without waiting for the cap —
      a pairScore rebalance with feel consequences. The study asked for
      scoring AND a cap; this is the cap.
    - Acting on the last study before rendering another was the call
      here: the loop exists to find the weakest thing, and the weakest
      thing was already found and un-fixed. The 2 un-studied replays stay
      queued.
- [ ] **P3 Stranger test (the exit gate).** 5–8 people, silent-8
      protocol (observe, never help, second person takes notes), funnel
      from P1 running. Gates: CTP ≥70%, first kill <60 s, play-again
      ≥50%.
- [~] **P4 Soak + load.** Soak half is live and hardened (see the E2
      rows; `scripts/wasm-authority-soak.sh`, run under systemd).
      **Join-path load test DONE 2026-08-09** —
      `tools/join-load-test.mjs` drives the real contract (POST
      /world-token → WS /ws/world → wait for the first SERVER FRAME,
      because an open socket is not the same as being in the world) and
      holds the sockets open.
      - **Measured: 16/16 joined, time-to-first-frame p50 1 ms / p95
        10 ms**, 14 sockets sustained through a 15 s hold, 4,738 frames.
        The join path itself is fast and does not fall over.
      - **`humans=0` during that hold is CORRECT, not a repeat of the
        join bug**: attaching mid-fight parks you as a spectator-pending
        entrant (bell gate S2.D) — you get hello + snapshots and no
        entity until the next countdown. A capacity answer needs a hold
        that spans a bell.
      - **RISK worth naming before any public moment: the join path is
        rate-limited PER IP — 20 token mints/min and 30 WS connects per
        5 min.** A second run of 6 clients returned 0/6 (2 mint 429s, 4
        ws errors) purely on leftover budget. That is fine for scattered
        home traffic and hostile for anything behind one NAT: a school,
        an office, or **a convention LAN — which is exactly the PAX
        scenario in Decision 7**. Nobody had flagged it. Raising the
        limits is a server change, so it is recorded rather than done
        (E2 freeze).
      - Corollary for whoever runs the real test: from one machine you
        measure the LIMITER, not the server. A genuine capacity number
        needs multiple source IPs.
- [x] **P5 Fix the lying meter (L8 violation, found 2026-08-09).** DONE
      2026-08-09. Report now reads "1 REAL email signup (20 test rows
      excluded of 21 captured)" and names it. The filter is guarded by
      probes GENERATED from the rule, not hand-written: the first guard
      was itself vacuous — a mutation adding a domain to the TS list but
      not the SQL passed 18/18 — and the generated version now fails on
      exactly that mutation. `data-warehouse` was not a workspace member,
      so the test would never have run; added. 30 pass / 0 fail.
- **Engine meters (continuous):** divergence sweep · bench · replay
  hashes · native-vs-wasm passport per-target · frame p50/p99 + input
  latency on the N2 soak · binary+pack size and cold-start-to-lobby
  (browser gate is <15 s; native should embarrass it — target <5 s).

---

## WHO CAN CLOSE WHAT (added 2026-08-10)

This doc is an ENDLESS goal (L5a) and its Stop-hook asks for "all complete
and done". That condition is **not tool-satisfiable**, and pretending
otherwise wastes a session re-deriving the same conclusion. Three
categories, and only the first can be closed by an agent working alone:

**A · Agent-closable.** Ordinary engineering with a machine-checkable
bar. Everything closed on 2026-08-09/10 was category A. What remains here
is large but tractable: N-BOT's stateful half (`worldBots.ts`, 765 lines),
N-AIM, the whole N1/N2 raylib shell, D 2.1/2.2/3.2, the rest of 3.1
(persona bots idling by default, the FAQ line).

**B · Jake-only, and an agent must NOT fire them (L4).** Consent-gated,
so silence is not approval:
  - the E2 ratification — flip `TRACKED_DEFAULT_AUTHORITY` to `"wasm"` in
    `server/src/simAuthority.ts` and delete the line from
    `server/.env.local`. One tracked, reviewable, revertable commit;
  - the stale-host deploy (the harness blocks outward-facing restarts);
  - **Decision 1** email-gate position, **Decision 2** bell taper — both
    built DARK, one line each;
  - Decision 3 announcer voice source, Decision 4 weekly-board persistence.

**C · Blocked on things that do not exist on this machine.** 4.1–4.4 need
audio assets; canonical recordings only, never synthesized (standing rule).

**So: a run of this goal terminates when category A is empty, not when the
doc is.** If you want a Stop-hook that can actually finish, point it at a
sub-goal drawn only from A. Recorded because this deadlock has now cost
two sessions.

## PRIORITY ALGEBRA (when lanes conflict)

D Phase 0–1 → **E2** → N0 (exempt, parallel-safe now) → D Phase 2–3 (sim
parts Zig-native via N-BOT/N-MAP) → E3/E4 → N1 → N2 → D Phase 4–5 polish
→ N3+. Parallelism is encouraged (L5); the algebra only settles conflicts
for the single most-senior lane.

**Today's two next-weakest:** E2's headless soak-and-flip (unblocks
everything) and N0.1–0.4 (unblocked, shell-agnostic, parallel-safe).

## DECISIONS JAKE OWNS (build proceeds around them, not through them)

1. **Email gate position** — recommend post-first-fight (D 1.2).
2. **Bell cadence** — recommend round-cap taper when humans are queued
   (D 1.5b).
3. **Announcer voice source** — record / Kokoro / cut (D 4.3).
4. **Persistence scope for the weekly venue board** — recommend one
   bun:sqlite file on the host (warehouse pattern); a "weekly" board on
   a process-lifetime ring buffer dies at every restart, and restarts
   happen.
5. **Spectate depth** — recommend keeping the text/state feed through
   this overhaul; snapshot-relay spectate lands with Fight Night.
6. **Track R activation** — only if P1 telemetry shows low-end devices
   failing the governor's floor.
7. **PAX Aus via SAE, closed Sun 16 Aug** — submit or deliberately lapse.
8. **N4 distribution** (Steam account, code signing, storefronts) — not
   live until N3 is real.

**Ratified, no longer open:** Z4/E2 direction ("GO ALL ZIG", 2026-08-05)
· toolchain pin (L2) · native shell lib (ADR-0008).

## PARKED / NON-GOALS (subtraction is the discipline)

Fight Night show overlay (Model B — needs its own doc AFTER Pillars 4/5
give it a substrate) · duos polish · per-class-capable bot policy for the
balance matrix · snapshot-relay spectate · portals (CrazyGames/Poki
dropped 2026-08-01) · all press/creator outreach (banked in `marketing/`,
ON HOLD by Jake's order) · web/wasm targets for the native shell code
(the browser client already exists) · mobile native · consoles (the aim
dialect keeps the door open, nothing more) · rewriting the Bun server in
Zig (that's E3's conversation) · Steam before N3.

---

## STATUS — ground truth, newest first

- 2026-08-10 · **VENUE 2.5 IS MEASURED AND PASSES: 3753 ms.** And it was
  never broken — the harness was aiming ~174 px over the dummy's head all
  night.

  The mouse was driven to "player screen-centre + world delta", which
  assumes the camera centres the player vertically. It does not. Every
  client-side probe I built was equally consistent with "the shot misses"
  and "the game ignores the shot", so none of them could discriminate —
  the harness knew where it had PUT the mouse, not where the game thought
  it was aiming.

  What finally cracked it was measuring at the server, in this order:
  1. `dummyHealth` total in `/venue/summary` — never moved, so the shot
     was not reaching the hit path (ruling out a display bug);
  2. `humanX` DID move while walking — so inputs reach the lobby host;
  3. a counter at the point of receipt — `fireInputsSeen` hit 83, so fire
     inputs arrive and are accepted;
  4. the aim carried on those inputs — **world y 868 when the dummy was at
     1042.** Aiming 174 px high, from the harness, all along.

  Fixed by CALIBRATING instead of assuming: the spec now takes two probe
  samples, reads back the world aim the sim actually received, solves the
  linear screen→world map, and aims. First run after that: hit in 98 ms
  from 96 px. `test.fail()` removed; the spec asserts the real budget.

  **Three of my own witnesses lied on the way** — `lastProcessedInputSeq`,
  `currentKeys` and the client's `fireCooldownMs` are all unmaintained or
  client-only on the lobby path, and each read 0 while the thing it
  claimed to measure was working. Two of them were deleted rather than
  left in `/venue/summary`, because a field that can only ever read 0 is a
  lying meter (L8), not an instrument. The lesson that generalises: to
  learn whether an input had an EFFECT, count it where it is RECEIVED, not
  where it is stored.

- 2026-08-09 (zzzzz) · **E2-b IS RETRACTED — wasm does NOT break the venue
  lobby. I was measuring an orphaned server.**

  The "TS says fighting, wasm says round-over" comparison was not a
  comparison of authorities. Port 8388 was still held by a process started
  at **19:10** by an earlier session, which survived my `systemctl stop`
  and silently answered every request — including the "server up" check
  that was supposed to prove my own instance had started. The TS side was
  a fresh build; the wasm side was 3.5 h old. So the split measured
  old-build vs new-build.

  Re-measured after killing the orphan, on current code under genuine
  wasm authority (`authority: wasm`, `wasmReady: true`):

  | authority | lobby phase (client, 90 s) | lobby phase (server) |
  |---|---|---|
  | TS | 44/45 fighting | fighting |
  | wasm | **44/45 fighting** | **fighting** |

  Identical. There is no hangout regression under wasm, and E2-b is not a
  blocker. **E2-a stands** — the `.env.local` and rollback findings were
  established by reading config and by reproduction, not by that server.

  What survives from the episode, and is worth keeping: `/venue/summary`
  now reports the LOBBY's own phase, which is what made the retraction
  checkable from outside the process at all.

  The lesson is narrower than "check your servers": a port answering
  `/health` proves *something* is listening, not that YOUR build is. Bind
  checks must compare process start time (or a build stamp) against the
  change under test — three separate conclusions today came from
  processes older than the code they were supposedly testing.

- [x] **E2-b Venue hangout parity under wasm.** RETRACTED — not a real
      defect; see above. The lobby-phase field added while chasing it is
      kept, and a soak that polls it is still worth having.

- 2026-08-09 (zzzz) · **WASM AUTHORITY BREAKS THE VENUE LOBBY'S HANGOUT
  MODE — and it is live right now.** Same client build, same map, two
  servers differing only in authority:

  | authority | venue lobby phase |
  |---|---|
  | TS (`USE_WASM_STEP_WORLD=0`) | **fighting** — correct |
  | wasm (`=1`, i.e. the live host) | **round-over** — impossible in hangout |

  Hangout mode is defined to start at "fighting" (World.ts:1676) and never
  run the round machine. Under wasm it runs one. Given the `.env.local`
  find above, the live host has been serving the venue this way for ~29 h.
  Suspect `world_state_set_hangout_mode` / `g_hangout_mode` not being set
  or not being honoured on the wasm path for the lobby host
  (matchHost.ts:487–507).

  This is a **blocker for ratifying E2**, and it is exactly the class of
  thing the soak could not see: the soak watched the ARENA world and
  counted fallback ticks, so a hangout-only behavioural divergence was
  outside its field of view. Zero fallback ticks and a correct venue are
  independent claims; only the first was measured.

- [x] **E2-b' Soak polls the LOBBY's phase too.** DONE 2026-08-09. New
      `lobby_phase` CSV column; a non-"fighting" reading aborts the run.
      An EMPTY reading deliberately does NOT abort — that means the server
      predates the field, which is a gap in observation rather than a
      defect, and failing on it would only teach people to ignore the
      check.

- 2026-08-09 (final) · **Closing gate at HEAD, all green** — zig
  **172/172** (9/9 steps), client **1983 pass / 3 skip / 0 fail**,
  data-warehouse **30/0**, server **369/0** under an explicit
  `USE_WASM_STEP_WORLD=0` AND **369/0** under `=1` + `WASM_STRICT=1`,
  port passport **PASS**. Working tree clean.

  One honest correction to an earlier row: the passport ran **9/9**
  today, not the 12/12 recorded this morning. Nothing regressed and
  nothing was skipped — `server/src/replayStore.ts` enforces a total-BYTE
  quota over `.replays/` and deletes oldest-first, so tonight's two
  investigation servers wrote 2 new `.jjr` files and evicted several
  older ones.

- [ ] **P6 Pin the passport corpus (L8).** "12/12 agreed" and "9/9
      agreed" read like the same strength of claim and are not — the
      determinism gate currently samples whatever survives a size-capped,
      self-evicting directory, so **running a server can delete the
      fixtures the gate depends on**, and coverage silently shrinks
      between runs. Copy a fixed, named set of replays somewhere the
      quota cannot reach and have the passport assert it ran the whole
      set, so the number means the same thing every time.

- 2026-08-09 (zzz) · **SOAK PASSED. E2's machine evidence is complete; the
  flip is now blocked only on E2-a and a deploy.**

  `soak-20260809-200855` — 7827 s (2 h 11 m), wasm authority, 4 bots, 259
  samples, 10 full match cycles:

  | metric | result |
  |---|---|
  | fallback ticks (max over run) | **0** |
  | rows with `wasmReady=false` | **0** |
  | divergence lines | **0** |
  | RSS | 100.5 MB → 134.8 MB |
  | VERDICT | **PASS** |

  Zero fallback ticks across 259 samples is the claim that matters, and
  it is only meaningful because the counter was added and proven this
  morning — the same soak shape reported green in the past while 294
  ticks ran on TS.

  On memory: "flat" would have been the wrong word. RSS grew 34 %, but by
  thirds the growth is **+23.9 / +9.9 / +1.6 MB** — decelerating to a
  plateau in the final 45 minutes, which is warm-up reaching steady
  state, not a leak. A linear 34 %/2 h would have been.

  Fixed after the run, having been deliberately deferred while it ran
  (editing a script bash is executing corrupts it by byte offset): the
  CSV's `tick_p99_ms` column was empty for all 259 rows because the
  extractor grepped `"p99"` and the field is `"p99Ms"`. So the soak's
  latency column never measured anything for the whole run — the p99
  figure of record stays the hand-measured 2.8 ms. The next soak's column
  will populate.

- 2026-08-09 (zz) · **E2 WAS ALREADY FLIPPED, AND THE KILL-SWITCH DOES NOT
  WORK.** Both verified, not inferred. This supersedes the "E2 is not
  flipped live" line below it.

  `server/.env.local` line 7 has held `USE_WASM_STEP_WORLD=1` since
  **2026-07-28**. Bun auto-loads `.env.local` from its cwd, and the live
  host runs `bun --cwd server src/index.ts` (pid 1947, cwd
  `.../JAKESJAM/server`, up since Aug 8 17:18). The Aug-5 code it is
  running reads that flag at matchHost.ts:80. So the live host has been
  stepping on **wasm authority for ~29 hours**, unobserved.

  The earlier "USE_WASM_STEP_WORLD is absent from the running server's
  environment" was an INSTRUMENT ERROR: it read `/proc/<pid>/environ`,
  which cannot see variables Bun injects from `.env.local` at runtime.
  `/proc` still reports the flag absent today. Proof by reproduction: a
  server launched the same way with no explicit flag reports
  `sim.authority: "wasm"`.

  Two consequences, both bad:

  1. **The rollback is a no-op.** `scripts/e2-flip.sh` strips
     `USE_WASM_STEP_WORLD` from the captured environment (line 84) and
     relaunches with `--cwd server` (line 106) — where Bun immediately
     re-reads `.env.local` and puts it back. `--rollback` would report
     success and leave the host on wasm. The kill-switch that the whole
     flip plan rests on has never worked.
  2. **It is machine-local.** `server/.env.local` is gitignored. This box
     runs wasm; a fresh clone or any other host runs TS. "What prod does"
     currently depends on an untracked file.

  Nothing here says wasm authority is *wrong* — the 2 h soak, the strict
  suites and the 12/12 passport all say it is fine, and ~29 h of live
  bot-only running is corroboration. What is wrong is that it happened
  without evidence and cannot be undone by the mechanism built to undo it.

- [~] **E2-a Make authority explicit and reversible.** MOSTLY DONE
      2026-08-09. Landed: `server/src/simAuthority.ts` resolves authority
      in ONE tracked place with a named `TRACKED_DEFAULT_AUTHORITY`;
      `/health` now reports `authoritySource` and
      `authorityFromUntrackedDotenv` alongside the value; the server warns
      once at boot when an untracked dotenv is supplying it; and
      `e2-flip.sh` sets the flag explicitly for BOTH modes and refuses to
      claim success unless `/health` agrees. Verified on this box: the
      effective authority is UNCHANGED (still wasm) and it now says so —
      `authorityFromUntrackedDotenv: true`. 9 resolver tests, server
      383/0 under both authorities.
      **What is left is a human decision, deliberately not taken:** flip
      `TRACKED_DEFAULT_AUTHORITY` from "ts" to "wasm" and delete the line
      from `server/.env.local`. That one-line tracked commit IS the E2
      ratification — reviewable and revertable, which the dotenv never
      was. Not fired on silence (L4); the machine evidence is complete but
      the decision is Jake's.

- [ ] ~~**E2-a (original) Make authority explicit and reversible (blocks the flip).**~~
      Fix the rollback so it actually rolls back (neutralise `.env.local`
      for the launch, or launch from a cwd without it, or have the script
      assert the resulting `/health` `sim.authority` matches the mode it
      claims — the last one is the honest-meter version and catches every
      future variant of this). Then decide authority in TRACKED config so
      it is the same on every machine. Until this lands, `e2-flip.sh`
      should not be run: its safety net is imaginary.

- 2026-08-09 (z) · **CONSOLIDATED GATE AT HEAD — everything green.** Run
  together rather than trusting the per-change runs, because "each change
  passed" and "the tree passes" are different claims:

  | gate | result |
  |---|---|
  | zig (`zig build test`) | **172/172** |
  | client (`bun test`) | **1983 pass / 3 skip / 0 fail** (128,156 asserts) |
  | server, TS authority (`USE_WASM_STEP_WORLD=0`) | **369 / 0 fail** |
  | server, `USE_WASM_STEP_WORLD=1 WASM_STRICT=1` | **369 / 0 fail** |
  | port passport, native vs wasm | **12/12 agreed, 0 diverged** (900 ticks each) |
  | five-viewport sweep | **5/5 clean** |
  | front-door e2e | **11/11** |
  | soak, wasm authority | **0 fallback ticks**, heap flat, p99 2.8 ms |

  Both authority modes at identical counts is the row that matters: the
  suite exercises the same behaviour whichever engine steps it, which is
  precisely what E2 is asking to be true before the flip.

  CORRECTED after the `.env.local` find: the "TS authority" row was first
  run by simply NOT setting the flag, which — via `server/.env.local` and
  Bun's dotenv loading — very likely ran wasm twice and compared it with
  itself. Re-run with an explicit `USE_WASM_STEP_WORLD=0`; still 369 / 0,
  so the conclusion stands, but it is now actually a two-engine
  comparison instead of one engine measured twice.

- 2026-08-09 (y) · **Correction to my own payload number: the real one is
  ~1.4 MB, not 3.64 MB.** The 3.64 MB was measured against the ORIGIN on
  localhost. Public traffic goes through Cloudflare, which compresses at
  the edge — measured on `play.elyad.io`: the JS bundle is **663 KB
  brotli** (2.29 MB at origin) and `sim.wasm` is **60 KB** (333 KB at
  origin). So a real visitor downloads roughly 1.4 MB, not 3.6 MB, and
  the gate has far more headroom than tonight's earlier entry claimed.
  - **The origin genuinely does not compress** — no `content-encoding`
    even when the request sends `Accept-Encoding: gzip, br`; gzip would
    take that bundle to 0.64 MB. That costs nothing for public players
    (Cloudflare fixes it downstream, and the origin hop is loopback) but
    it IS the number anyone on LAN or a direct IP pays, and it is why
    every local measurement tonight over-reported. Fix is in
    `server/src`, inside the freeze — recorded, not done.
  - **Both figures in the row now**, origin and wire, because measuring
    the origin and calling it "what a visitor downloads" is exactly the
    mistake the row already made once tonight with gzip-bundle prose.
  - Note the 8.5 MB media win from (u) is unaffected and real: media was
    not being compressed away, it was not being fetched at all.

- 2026-08-09 (x) · **Client frame budget on the landing, measured for the
  first time** (`tools/landing-fps.mjs`, rAF deltas in-page):

  | case | p50 | p95 | missed (>20 ms) |
  |---|---|---|---|
  | phone 393×852 auto | 16.7 ms | 16.7 ms | **0%** |
  | phone 393×852 potato | 16.7 ms | 16.7 ms | **0%** |
  | short-desktop 1280×700 | 16.7 ms | 33.4 ms | 44% |
  | desktop 1920×1080 | 33.3 ms | 50.0 ms | 100% |

  - **CAVEAT FIRST, because it decides what this means:** headless
    Chromium rasterises in SOFTWARE. The clean scaling with pixel count
    is what a fill-rate-bound software renderer looks like. This is a
    RELATIVE result — "the 1080p landing is by far the heaviest case,
    phones are comfortable" — not a claim about what a player with a GPU
    sees. A headful run is needed before anyone panics or relaxes.
  - My first pass reported "62% dropped" on a phone that was in fact
    locked at a perfect 60 Hz: the threshold was `>16.67 ms`, and at a
    60 Hz vsync deltas sit a hair above 16.67 BY DEFINITION. Moved to
    `>20 ms`, the first delta vsync jitter cannot explain. Recording it
    because a scary meaningless percentage in a status doc is worse than
    no number.
  - **Open question worth someone's time:** at 1080p the run sat pinned
    at exactly half-rate for 10 s straight. If the global render governor
    is meant to shed quality under sustained misses, either it did and
    30 Hz is its floor here, or it never engaged. Not chased — it needs
    the GPU measurement first to be worth interpreting.

- 2026-08-09 (w) · **Zig authority is FAST, and my soak was silently not
  recording it.** The soak CSV's `tick_p99_ms` column has been empty for
  every row of every run tonight: the script greps `"p99"` and the field
  is `"p99Ms"`. So the soak has been proving stability and fallback-free
  operation while capturing nothing at all about frame budget — a hole in
  my own instrument, found by asking what the empty column meant instead
  of scrolling past it.
  - **Sampled by hand instead** (soak host, 78 min into wasm authority,
    5 reads): **p50 0.26–0.28 ms · p95 1.80–1.96 ms · p99 2.76–2.95 ms ·
    max 12.2 ms**, fallbackTicks 0 throughout. Against a 16.67 ms budget
    at 60 Hz that is p99 at ~17% of frame and the worst spike still
    inside budget. **Zig authority is comfortably fast** — this is the
    perf half of the E2 case, which nothing had actually measured.
  - **NOT fixing the script yet, on purpose.** Bash reads a script
    incrementally by byte offset, so editing `wasm-authority-soak.sh`
    while a 2 h run is executing it can make the running shell execute
    garbage. The one-character fix waits until the soak ends; losing the
    run to a tidy-up would be the third dead soak today.

- 2026-08-09 (v) · **URL → in the world: ~1.0 s median** (3/3 first-visit
  0.9–1.2 s, 3/3 returning 1.1–1.2 s). `tools/time-to-world.mjs`, defined
  as "the local player has an entity in authoritative state" — not
  "canvas appeared" and not "socket opened", both of which happen while
  you are still nobody. Against a journey the doc last measured at
  "~60–140 s worst case", that is the ident, the splash, the callsign
  prompt and the walk all being gone.
  - **Two caveats, both load-bearing.** This is localhost, so it excludes
    the tunnel's latency — the honest claim is "the client and boot path
    are no longer the bottleneck", not "a stranger in Berlin sees this".
    The 3.64 MB payload makes a real-network figure plausible but
    unmeasured. And **"in the world" is the VENUE, not a fight**: you are
    standing in the room with an entity, hitting dummies. The distance to
    an actual bout is the bell wait, which is Decision 2's taper
    (1.5b, built dark), not a boot-path problem any more.
  - So the row splits: the front door is solved, the bell is not. Worth
    keeping separate on the board rather than averaging them into one
    number that hides which half is broken.

- 2026-08-09 (u) · **Landing payload 12.12 MB → 3.64 MB.** 8.5 MB, 70% of
  the critical path, removed — and the north-star row goes from
  unverified prose to a measured number inside its gate.
  - Cause: **Doors 0.4's rule leaking back in through a different door.**
    0.4 killed `preload="auto"` on the MARKUP audio, but `new Audio(url)`
    defaults to eager as well, so `menu-light.m4a` (3.80 MB) and
    `splash-theme.m4a` (0.77 MB) were still being pulled at boot — plus
    `splash-loop.mp4` (3.86 MB), which `preload="metadata"` did not spare.
    On the lobby-first path **none of the three is ever seen or heard**:
    you land in the venue, which starts its own track.
  - Scoped to `bootSkipsCeremony`, not applied globally. On the splash
    path the anthem IS the ident — the 27.93 s ceremony is cut to that
    track — so fetch-on-play there would risk desyncing the rite against
    its own audio. Eager where it is the content, lazy where it is never
    heard. `?splash=1` still measures 12.12 MB, deliberately.
  - Verified: client 1983/0, five-viewport sweep 5/5, front-door e2e
    11/11 (lobbyFirst + emailGatePosition + matchResume).
  - `tools/payload-probe.mjs` keeps the row honest from here — it names
    the >300 KB offenders, which is where the answer always is.

- 2026-08-09 (t) · **North-star payload row MEASURED — and the answer
  depends on a question the row never asked.** It read "~730 KB gzip JS
  (eager media killed — Phase 0.4)", which was a fact about the JS
  bundle, not about what a visitor downloads.
  - **Code-only critical path: 2.93 MB** (JS 2.29 MB + sim.wasm ×2 +
    fonts + CSS), comfortably inside the <10 MB gate. This is what the
    game needs to be playable.
  - **With media: 12.12 MB**, over the gate — `splash-loop.mp4` 3.86 MB,
    `menu-light.m4a` 3.80 MB, `splash-theme.m4a` 0.77 MB.
  - **NOT a lobby-first regression** — `?splash=1` measures byte-identical
    12.12 MB, so Doors 1.1 did not undo 0.4. Checked before reporting.
  - **The instrument is suspect and I am saying so rather than filing a
    bug.** Headless Chromium appears to fetch `preload="metadata"` media
    in full; the server is NOT at fault (verified: it answers Range with
    `206 Partial Content` and `accept-ranges: bytes`, on both the test
    host and live). A real Chrome may pull far less. Confirming that
    needs a headful measurement — until then the honest reading is "code
    path is fine, media path is unverified and worth a look", not "the
    gate is failing".
  - **`sim.wasm` is fetched TWICE** (0.33 MB each). Diagnosed rather than
    guessed, and it is NOT the cause the code expects: `loader.ts`'s
    `instantiate()` fetches once for `instantiateStreaming` and fetches
    AGAIN on any rejection, with a comment blaming a wrong MIME — but
    both hosts serve `Content-Type: application/wasm` correctly, so that
    fallback is not firing. The remaining likely cause is a SECOND module
    instance with its own `cached` singleton (a worker or a split chunk
    each loading their own copy), which no amount of caching inside one
    module can dedupe. Not "free to fix" as first written; the fix is in
    `client/src/sim/wasm/loader.ts`, inside the E2 freeze. Also note the
    host sends `Cache-Control: no-cache`, so the second fetch is not
    free even on a warm browser.

- 2026-08-09 (s) · **Composite L7 sweep — 5/5 viewports clean.** Every UI
  change tonight was checked in isolation and passed; that is not the
  same as checking them together. The Settings panel grew a Controls
  section, the venue grew a legend and an encounter glyph, the splash
  strip changed shape, and two transient strips now share the bottom of
  the screen. `tools/viewport-sweep.mjs` walks the canonical five over
  BOTH changed surfaces and fails on the two things a screenshot cannot
  tell you — a collapsed canvas and horizontal overflow — plus a
  page-error check and a count of the Controls rows. All five clean, and
  the tightest case (Settings at 393 px, where the new section lands) was
  looked at rather than only asserted.

- 2026-08-09 (r) · **THE LIVE HOST IS A DAY STALE, and that changes how
  the flip must be done.** `/health` on :8088 has no `sim` block, so the
  running process predates today's ENTIRE server lane — the input-routing
  fix, the index-space fix, the venue work, the /health instrument
  itself. Client changes ARE live (dist is served per request); the
  server process is not.
  - **Consequence: a flip restart would deploy a day of server code AND
    change authority in one action.** Worse, `e2-flip.sh --rollback`
    reverts AUTHORITY, not CODE — it relaunches from the working tree
    with the flag removed, so rolling back a combined change leaves new
    code running under old authority, a state nobody tested. Recorded in
    the script header.
  - **Sequence, revised: DEPLOY FIRST, FLIP SECOND.** Restart :8088 on
    current code with no flag, watch it, then flip when the soak lands.
    Two changes, one variable each, and a rollback that means what it
    says.
  - **The deploy needs Jake.** Restarting the public host is
    outward-facing and the harness gates it; the attempt was refused and
    NOT worked around. Everything up to that line is done and waiting:
    gates green, soak running clean, flip mechanised.

- 2026-08-09 (q) · **THE FLIP'S CLOCK IS RUNNING — clean soak started
  20:08:55 under systemd, and the freeze is the only thing that can break
  it now.** Two soaks failed for a reason that had nothing to do with the
  sim: one was killed 8 min short of target (94%, every row clean), the
  next died 30 s in to a SIGTERM nobody asked for. A 2 h run launched
  from an agent/terminal session keeps getting reaped. Fixed by giving it
  to systemd — `systemd-run --user --collect --unit=jj-soak` — so the run
  outlives whatever started it. Invocation is now in the script header;
  the unit is `active` and the CSV is filling.
  - **What has to hold: NOTHING may commit to `sim/src`, `server/src` or
    `client/src/sim` before ~22:19.** The gate compares soak START
    (20:08:55) against the newest commit in those paths (currently
    19:05, f64661b). One commit there and this run joins the other two.
  - If it survives, every E2 row is green against HEAD and the flip is
    one command: `scripts/e2-flip.sh` — observed, auto-reverting, and it
    refuses if any of the three conditions is not met.
  - Nothing else about E2 is outstanding: gate hardened, input-routing
    bug fixed, index-space bug fixed, join handoff verified, homing
    fixed, flip mechanised.

- 2026-08-09 (n) · **HEAD re-soak KILLED at 94% — E2 gate NOT re-met on
  HEAD.** The run reached 7298 s of 7800 (8 m 2 s short) and was stopped
  externally, so the script never wrote a verdict; one was written by hand
  and labelled INCOMPLETE rather than rounded up.
  - Every sampled row was clean: 242 samples, **0 fallback ticks, 0
    fallbacks logged**, authority wasm throughout, 8 match cycles, RSS
    band 66–109 MB starting at 94 and ending at 92 (sawtooth, no leak).
  - **Not claiming the gate on it.** The earlier full 2 h 10 m PASS
    (soak-20260809-154519) is the only completed run, and it predates the
    input-routing fix. So E2's soak row currently reads: "passed on
    pre-fix code, 94%-clean on post-fix code, no completed run on HEAD".
    A flip needs one more full soak — the harness is one command
    (`scripts/wasm-authority-soak.sh 7800`) and the evidence is durable.
  - Orphaned soak server on :8188 stopped by hand: the script's cleanup
    trap does not run when the script itself is killed, so it left the
    host it spawned behind. Worth fixing in the harness if this recurs.

- 2026-08-09 (p) · **P2: footage re-studied on POST-FIX code — no dead
  runs.** Sheet: `docs/clip-sheets/study-2026-08-09-post-fix.md`
  (clip-sheets are gitignored by convention, so the findings live here).
  Source is a replay recorded TODAY at 18:37 off HEAD (92,548 ticks,
  backend=wasm, fallback=0) rather than the remaining 07-31 tapes — only
  fresh footage can answer whether S1 still reproduces.
  - Two windows following `bot_spark`: **mean Δluma 8.14 / 8.74, ZERO
    dead runs**. The 08-05 tape had 7.7 s, 6.6 s and 6.8 s statue runs in
    one window. **Evidence for the S1 idle-floor fix in footage, not just
    in a test** — though honestly scoped: two windows, one subject,
    bots-only. The claim is "does not reproduce here", and re-asking is
    now cheap.
  - `tools/footage-study.mjs` is the reusable half — drives the host's
    own render URL, samples at the 2 Hz the "stationary >1 s" rule
    implies, writes full-res frames, reports dead runs.
  - **Four ways it lied before it was trustworthy**, all recorded in the
    sheet: no `gate=off` (every frame was the email gate — a flat 0.00
    "19-second dead run" that was a photo of a form); no `follow` (camera
    frames empty geometry — five phantom dead runs); sampling past the
    window (tail freeze); forcing `quality=potato` (rig renders as bare
    limbs, which read as a visual defect and was the flag). Chasing the
    first one is what found the real splash-over-replay bug (739b948).
  - The two un-studied 07-31 tapes are now historical: they predate the
    input-routing, index-space, homing, S1 and S2 fixes. Fresh capture
    beats them for finding what is weakest NOW.

- 2026-08-09 (m) · **P1 funnel instrument + "stationary > 1 s" as a
  machine-checked invariant** (70698be, 1ade76d).
  - **P1:** all eight funnel steps now fire once per session with elapsed ms
    from page load, on the existing batched/capped telemetry queue. The
    report splits ALL from EXTERNAL-only, because ~90% of sessions are
    Jake's own machine — an unsplit funnel measures the developer, the same
    mistake the signup count made. Needs a dist rebuild + real visitors
    before it says anything, and it prints that rather than printing zeros
    as findings.
  - **The invariant found that my own S1 fix was incomplete**, which is the
    point of promoting a footage finding to a gate. Three harness attempts
    produced confident WRONG reds first (bots got no input because the
    brains live on WorldHost's interval; then `think()` no-ops while the
    host loop is stopped; then every phase was sampled and it "found" the
    2.9 s round COUNTDOWN). Only after gating to the fighting phase did it
    measure the game.
  - **RESIDUAL, recorded not hidden (L8):** worst mid-fight stillness is now
    ~1.6 s, from a DIFFERENT path than the filmed bug — the ENGAGED branch
    lets `moveDir` be 0 while a bot holds its standoff range, and unstick
    only fires when the bot intended to move. The gate is set at 2 s to
    encode what actually holds; closing the last 0.6 s means a micro-strafe
    for held-position bots, which is a combat-feel change and a follow-up
    rather than something smuggled in behind a threshold. Measured
    improvement: 7.7 s → 1.6 s.
  - Not deployed: the funnel needs a dist rebuild and the bot/server fixes
    need a :8088 restart, both of which are held while the join-bug lane
    owns that host.

- 2026-08-09 (o) · **The flip is now one command — and mechanising it
  exposed why it keeps not happening.** `scripts/e2-flip.sh` (f3de8f8)
  captures the live host's exact environment, relaunches it identically
  plus `USE_WASM_STEP_WORLD=1`, verifies `/health` reports
  authority=wasm + wasmReady, observes, and **rolls back automatically**
  on the first fallback tick, a dark `/health`, or wasmReady going false.
  `--rollback` is immediate. It refuses on: humans in the world (L6), no
  PASSing soak verdict, or a soak that STARTED before the newest sim
  commit. It deliberately does not set `WASM_STRICT` (live, the fallback
  IS the kill-switch) and does not touch cloudflared (verified sibling
  process — a server restart does not drop play.elyad.io).
  - **THE REAL BLOCKER, stated plainly: the sim is changing faster than a
    soak can validate it.** The gate compares soak start against the last
    commit touching `sim/src` / `server/src` / `client/src/sim`. Right
    now: soak started 17:57, newest sim commit 18:50 — so this soak is
    already invalid too, exactly as the 15:45 one was. **A 2 h soak can
    never go green while sim surfaces are committed to every ~30 min.**
    The flip does not need more engineering; it needs a ~2 h FREEZE on
    those paths, one clean soak, then this script. That is a scheduling
    decision, not a machine one.
  - The first version of this script had the stale-evidence hole it was
    written to close: it compared the VERDICT's mtime, which is written
    2+ h after the run starts, so a mid-soak commit would have looked
    older than it and passed. Now it parses the start time from the
    filename.
- 2026-08-09 (n) · **THE JOIN BUG IS GONE — verified on HEAD, so the last
  non-evidence blocker on the E2 flip is cleared.** `bun
  tools/bell-probe.mjs` against an isolated HEAD host (worktree build,
  :8388, never the live one) drove a real headless browser through
  venue → bell → arena: `humans=1 bots=3 phase=fighting
  scene=OnlineMatchScene`, sustained ~30 s, **RESULT: PASS (handoff
  works)**. The failure it was written for — "ADMITTED" logged while
  `/health` held `humans=0`, then evicted after the 10 s grace — did not
  reproduce. **Remaining gate on the flip is now purely the HEAD re-soak**
  (running, 8188). Minor, unrelated: the probe logged 4× 404s for page
  resources; not chased here, noted so it is not rediscovered as new.
- 2026-08-09 (m) · **INDEPENDENT VERIFICATION of HEAD (367f1cc) by the
  goal runner — every claim below re-run rather than taken on trust,
  which is the point of one session owning STATUS (L5a).**
  - **Port passport: PASS, 12/12 replays, native ≡ wasm bit-identical**
    (`scripts/passport.sh --ticks 1500`; 0 diverged, 0 skipped). N0.4's
    central claim independently confirmed. The archive is 12 files now,
    not 10 — today's probe runs left three new ones.
  - zig **170/170** · server **366/0** under `USE_WASM_STEP_WORLD=1
    WASM_STRICT=1` · client **1963 pass / 3 skip / 0 fail** (128,114
    asserts).
  - **The client suite is RED in the shared working tree and GREEN at
    HEAD** — 2 failures in `spectatorDirector.test.ts` ("it cuts to
    whoever is actually moving", received `still_a`) come from a
    concurrent session's UNCOMMITTED S2 edit, not from committed code.
    Verified by running the suite in a clean checkout of 367f1cc in
    `.claude/worktrees/doors-lane`. Recorded because `bun test` in the
    shared tree measures whatever another agent happens to be
    mid-keystroke on, which is exactly the confusion L5a exists to stop.
  - **E2 flip evidence is still NOT satisfied for HEAD**, and the
    re-soak that would satisfy it is running (started 17:57, 8188). The
    2 h 10 m PASS from 15:45 tested a tree that predates the input-
    routing fix (5ad59c5), the index-space fix (9199f84) and homing
    (1f3e204). "Soak what you flip."
- 2026-08-09 (l) · **Both HIGH footage findings FIXED — S1 (367f1cc) and
  S2 (4600eaf).** The footage loop's purpose is to find the weakest thing,
  and the weakest thing had already been found on 08-05 and left un-fixed;
  acting on it beat rendering a third replay to find a fourth problem.
  - **S1, the 7.7 s statue bot.** Two causes on the no-foe path: the idle
    direction was drawn from `[-1, 0, 1]` — 0 meaning STAND STILL — held
    900-2300 ms, and consecutive zero rolls compounded (four ≈ 9 s, which
    is exactly what was filmed); and the unstick detector sits AFTER that
    path's early return, so an idle bot leaning on geometry never reached
    it. Both fixed, 3 tests **verified failing pre-fix**. The standing
    "stationary > 1 s = bug" rule now has a test at the one code path that
    could break it without the bot actually being stuck.
  - **S2, the director dwelling on stillness.** `pairScore` does weight
    speed, but closeness (×1.6) plus low HP clears the duel threshold at
    ZERO movement, and the existing dwell protected the MODE, not the
    SUBJECT — so the frame after any cut the camera drifted back to the
    statue. Added a 1.5 s idle cap (cut to the liveliest, else a wide shot
    that HOLDS) and a rule never to trade a moving subject for a still
    one. Max stare 6-8 s → under 3.4 s. Three wrong iterations recorded at
    the code, including one that turned the cap into a 1.5 s metronome —
    which is not better direction than a stare.
  - Still open from that study: S3 (HUD-less renders read countdowns as
    dead air, MED) and S2's scoring half.
  - **Honest note on the running soak:** it started at 17:57 and HEAD has
    since moved (bot policy, director). Neither touches the wasm authority
    path the soak is evidence about, so the verdict will still mean what
    it says — but the "soak what you flip" principle keeps eroding while
    development continues, and the flip should re-soak if anything lands
    in the authority path itself.

- 2026-08-09 (k) · **THE PORT PASSPORT PASSES — N0's first gate is met.**
  `bun run passport` steps every archived replay through the native build
  AND sim.wasm and diffs the hash streams: **replays=12 agreed=12
  skipped=0 diverged=0.** Native x86_64 and wasm are bit-identical, so L10
  is now measured rather than assumed and the native build is provably the
  same game. Commit 4aa8882; N0.1-N0.4 closed.
  - Sequencing is what made it reachable today: the passport never needed
    native world-init (N0.5) or named-map data in the core (N-MAP). It
    compares two backends over ONE input stream and does not care who BUILT
    the starting world, so dumping TS's own packed init (7642134) unblocked
    all 12 replays — including the named maps nothing native can construct.
  - The two contract details carry the whole risk, and both were read off
    the live host rather than guessed: slot order comes from the BUFFER
    (each PlayerEntity carries its own id_bytes, so there is no comparator
    to re-derive — the exact mistake that grew two index spaces), and every
    tick zeroes all keys before patching the players who have a frame
    (without it a silent player keeps last tick's input and the HARNESS
    invents a divergence).
  - Remaining in N0: only **0.5 native world-init**, and it is now honestly
    a cleanliness item ("shells should not hand the sim a world") rather
    than a blocker for anything.
  - DEVIATION recorded (L8): the comparator cannot live inside `zig build
    test` — it needs Bun for the wasm half. It is `bun run passport`; the
    stepper's own tests do run in `zig build test` (172/172).

- 2026-08-09 (j) · **Gate reconciled: the passing soak PREDATES the input
  fix, so HEAD is re-soaking.** Two sessions wrote this block on the same
  afternoon again (the entry below was labelled (f), colliding with (f)/(g)/
  (h) — relabelled (i), content untouched). Reconciliation, because "every
  row is green" needs one correction and one addition:
  - **Correction.** The soak it cites
    (`soak-20260809-154519`, VERDICT=PASS, 7803 s, 0 fallback ticks, 0
    divergence, 8 cycles, RSS 90→109 MB) started at 15:45, BEFORE the
    input-routing fix landed at ~17:20 (5ad59c5). It is honest evidence of
    process stability and nothing about input correctness. Stability is not
    what the fix changed — it is an index computation, not the fallback or
    memory path — but the gate says soak what you flip, so a second 2 h 10 m
    run on HEAD started 17:57 (`soak-20260809-175752`, wasm authority
    confirmed at boot). Not claiming the gate on stale code.
  - **Addition — the row the soak cannot supply.** A bot soak provably
    could not have caught the input bug (its bots submit every tick, so the
    buggy subset index always coincided). So the flip now also has a REAL
    CLIENT row: `tests/e2e/wasmAuthorityInput.spec.ts` (dac39ec) drives
    Chromium against a `USE_WASM_STEP_WORLD=1` host and asserts the local
    player moves on hold-D — passing, with the host reporting
    `wasmFallbackTicks: 0` afterwards.
  - **RETRACTED, same session (d6bc0a2): I claimed independent
    corroboration of the join bug and was wrong.** I read these on my own
    wasm host — `admitted 1 entrant(s)` followed by `[matchHost world]
    evicted … after 10000ms reconnect grace` and `match complete with no
    humans` — and wrote them up as a second sighting. They are the tail of
    my OTHER e2e runs, whose browsers closed at test end; an eviction 10 s
    after a client legitimately disconnects is the grace working. Log lines
    are not a repro. Built the actual repro instead
    (`tests/e2e/arenaJoin.spec.ts`, `test.fail()` first) and it **PASSED**:
    on :8388 under wasm authority the handoff holds — `/health` counts the
    human and still counts them 15 s after the bell, past the grace. Kept
    as a regression test, since nothing else covered venue→bell→arena
    end-to-end. Follows that the -1800 px jump was the arena's own spawn
    coordinates after all, not a dropped client.
    **This says nothing about the :8088 sighting** — that lane's evidence
    stands on its own and the flip stays held for it. It only removes a
    false second data point that would have pointed a bisect at the wasm
    path.

- 2026-08-09 (i) · **E2 EVIDENCE GATE FULLY SATISFIED — flip deliberately
  held, see below.** The 2 h 10 m headless bot-only soak under wasm
  authority returned **VERDICT=PASS**: ran 7803 s, **0 fallback ticks, 0
  divergence lines**, 8 full match cycles, RSS 90 MB → 109 MB (peak 143,
  settled back — flat, not a leak). Evidence file
  `.host-logs/soak-20260809-154519.{verdict,csv,log}`. With the suite row
  (353/353 under `WASM_STRICT=1`) and the 07-31 replays (real humans, 3
  matches, backend=wasm, 0 fallbacks), every row E2 asks for is green.
  **The flip itself is NOT done, on purpose.** A concurrent lane is
  isolating a join bug on that exact host — a client walking
  venue → bell → arena is logged "ADMITTED" while `/health` reports
  `humans=0`, then evicted after the 10 s reconnect grace. Restarting
  :8088 mid-investigation destroys its state and conflates two variables
  in a bisect; and E2's whole value is Zig authority *for real players*,
  which is moot while "can a real player enter at all" is open. Nothing
  is lost by waiting: the evidence is durable and the flip is one env var
  plus a restart. **Sequence: land the join fix → flip → observe →
  STATUS.**

- 2026-08-09 (h) · **E2 BLOCKER FOUND AND FIXED: input reached the wrong
  player under Zig authority** (5ad59c5). This is why the flip had not
  happened yet, and it was found by reading the input contract for N0.3 —
  not by any suite, and not by the soak.
  - `packWorldState` orders players by `id.localeCompare` and writes every
    player's `current_keys`/`prev_keys` as ZERO, leaving the caller to
    patch them between pack and `step_world`. Both patchers (server and
    client) indexed slot `i` by the i-th id of **this tick's input map**.
    Hosts skip players with no frame, so on any tick where one input is
    missing — jitter, a bot that didn't think, a mid-join — the subset
    index stops matching the slot index and one player's keys land in
    another player's entity.
  - **Measured, not inferred** (`wasmInputRouting.test.ts`, 400 ticks,
    inputs for `zzz_last` only): BEFORE — zzz_last moved 0.00 px while
    aaa_first, holding nothing, moved 1304.65 px. AFTER — exactly
    inverted (1304.65 / 48.00 idle drift).
  - wasm-path only; the TS step is keyed by id and does no index math.
    **Strong candidate for matchHost's own header note** — "live play kept
    surfacing symptoms under Zig authority that never reproduced under
    TS" — i.e. the reason the May 2026 flip was reverted. The client case
    is worse: prediction usually holds a frame for the LOCAL player only,
    so the local input was written into whichever player sorted first.
  - **The soak could not have caught it**: its bots submit input every
    tick, so the subset always equals the full roster and the indices
    coincide. Real play is precisely where they diverge. Recorded because
    it is a lesson about the gate, not just about the bug — a green soak
    is evidence of stability, not of correctness.
  - **Audited the whole patch-after-pack family and found the boundary had
    TWO player index spaces** (9199f84): the player array is packed with
    `id.localeCompare` and IS the space Zig sees, while the index encoders
    and the event decoder used a bare `.sort()`. They agree on today's ids
    and disagree where `_` meets letters. The bridge had already noticed —
    `playerIdBySlot`'s own doc says "pack uses localeCompare, the score
    loop uses default sort" — and worked around it in one place without
    fixing the rest. Now one exported `packedPlayerOrder()`, with
    `unpackWorldState` reading the slot ids it actually decoded instead of
    re-deriving a sort. Sites that would have misbehaved: round winner,
    first blood, event→player attribution (kills/killfeed/hit-confirms),
    and fire-config resolution (a player wearing another player's
    WEAPONS). **Latent, not live** — recorded that way rather than dressed
    up as a save.
  - **Consequence for the flip:** the 2 h soak now running was started
    before this fix, so it validated stability on code that differs from
    HEAD. Stability is not what changed (the fix is an index
    computation, not the fallback or memory path), but the gate says soak
    what you flip. Plan: record this run's verdict, then re-soak HEAD
    before flipping. NOT claiming the gate on stale code.
- 2026-08-09 (g) · **DOORS PHASE 1 COMPLETE — every row landed; the two
  Decisions are built DARK and waiting on Jake, not on machine work.**
  1.5b (061fb28) was the last: bell taper behind `BELL_TAPER=on`,
  retuning an EXISTING sim input (`target-score-N` on
  `state.chaosModifierIds`) so both the TS round machine and the Zig path
  follow one mutation — no override plumbing, L1-clean. It refuses any
  taper landing at or below the leader's score. 1.2 (f267c73, the other
  session) is likewise dark behind a one-line `DEFAULT_GATE_POSITION`.
  - **Ratifying 1.5b now has a recorded prerequisite:** a replay stores
    `chaosModifierIds` at match start, so a mid-flight taper re-sims
    against the original target and diverges at the end. Needs a
    mid-match mode-change record beside `rosterEvents` before the flag
    goes on. Written at the call site as well as here.
  - Per D-priority, Phase 1 was the lane that outranked everything; the
    algebra now points at **E2 → N0 → D Phase 2–3**.
  - Soak at 85/130 min: 0 fallback ticks throughout, and the heap
    question resolved honestly — RSS oscillates 109–137 MB and returns to
    a ~110 MB floor (sawtooth), so this is GC behaviour, not a leak.
- 2026-08-09 (f) · **Doors Phase 1 machine lanes CLOSED — 1.6 and 1.8
  done; only the two Jake decisions remain.** Commits 0aa1261 (fast
  lane), 3b8bebd (venueNames), 1557e46 (picker extract), 8dbbbbd (main
  path + the CSS fix). Phase 1 is now 1.1/1.3/1.4/1.5a/1.6/1.7/1.8 DONE,
  with 1.2 (email-gate position) and 1.5b (bell taper) the only open
  rows — both Decision-gated, to be built flag-dark per L4, never fired
  on silence.
  - **1.6** routes the fast lane through the SAME `toggleQueue` a totem
    touch uses, so it adds a trigger rather than a second queue path and
    the callsign gate still holds; `ensureQueued` guards the toggle
    against the queue/UNqueue flip a reconnect would otherwise cause.
  - **1.8 turned up a latent bug in every shell layer**, which is the
    session's second "the gate caught what the code hid": `.shell-layer`
    centred content inside an `overflow: auto` box, so any panel taller
    than the viewport lost its own top permanently. Settings crossed
    that line the moment it gained a Class section. Fixed for
    settings/clips/credits/pause together.
  - Two 1.7 e2e cases were quietly stale — they asserted a splash from a
    bare URL, which stopped meaning anything about 1.7 once 1.1 made the
    venue the default landing. Fixed to `?splash=1`.
  - **E2 soak at 76/130 min: 0 fallback ticks, wasmReady true
    throughout.** Honest caveat on the heap gate: RSS is 90 → 137 MB
    across 76 min of bot cycling, oscillating rather than monotonically
    climbing. "Flat" is a judgement call to be made against the whole
    curve when the run ends, not asserted now.
- 2026-08-09 (d) · **E2 gate hardened + N0.1/N0.2 landed.** Commits
  c05f5ca (gate), 5c51b3e (soak harness), f7b5796 (native harness).
  - **The E2 gate was hollow and is now real.** `USE_WASM_STEP_WORLD=1
    bun test` reported green while **294 ticks silently fell back to
    TS**: serverWasmHost is a process-wide singleton, `bun test` runs
    every file in one process, and serverWasmHost.test.ts's last case
    reset it without restoring. Fixed + backstopped; fallback ticks are
    now COUNTED and exported, `WASM_STRICT=1` turns the silent degrade
    into a throw for gate runs (never live — the fallback is the
    kill-switch), and `/health` carries
    `sim.{authority,wasmReady,wasmFallbackTicks}` so a flipped host
    shows the one failure mode the flip must not hide. Gates now:
    **353/353 under strict-wasm, wasm, and TS; 0 fallback ticks; tsc
    clean; zig 165/165.** Also: `server`'s test script ran 306 tests
    while the recorded gate ran 349 — script widened to match.
  - **CORRECTION to 2026-08-09 (a) and to the 08-05 (d) caveat: E2 has
    already been run live, with humans, and it held.** The three
    2026-07-31 replays record `simBackend: "wasm"` in their headers —
    which is the SERVER's `matchHost.simBackend`, i.e. the host had
    USE_WASM_STEP_WORLD set that day — with **0 backendFallbackTicks
    across all three**, 2–4 players each (bot-only matches skip replay
    persist, so these had real humans). The earlier "backend=wasm was
    only the client swap-module layer" reading was wrong. E2's risk is
    therefore materially lower than the doc assumed; the current host
    simply lost the flag on a later restart.
  - **2 h 10 m bot-only soak RUNNING** under wasm authority on
    :8188/:8189 (never the live ports). Healthy at 6 min: 0 fallback
    ticks, wasmReady true, RSS 90 → 108 MB early-fill.
  - **N0.1 DONE** — `zig build native` → `jjsim`, the same sim module
    the test step already compiled, running native.
  - **N0.2 DONE** — `.jjr` is raw msgpack with no framing, so the
    doc's "needs no format work" was wrong: it needed a decoder.
    Written (pull-based, no allocation for traversal), plus the replay
    reader. **10/10 archived replays parse, 0 failed** (the doc said 12
    files; there are 10, 100 MB).
  - **N-MAP is largely already done** — `sim/src/data/map_gen.zig` (737
    lines) already has `generateArena(seed)` + `world_state_generate_arena`
    / `gen_arena_geometry` exports. The remaining TS is named maps and
    the wrapper, not the generator. Re-scope the lane before working it.
- 2026-08-09 (c) · **CONSOLIDATED — one goal doc.** `open-doors-goal.md`
  (Track D detail) and `native-desktop-goal.md` (Track N detail) merged
  into this file and reduced to stubs; laws unified (the native NL1-NL6
  became L9-L13, NL5 folded into L5, NL0 deleted as redundant).
  Completed items compressed to one-line receipts with hashes — git
  holds the rest; every OPEN item keeps full detail. `finish-line-goal.md`
  and `convergence-goal.md` marked historical (all tracks closed bar
  F2-blocked-on-input, now Doors 4.1, and a Z4 flip since ratified).
  New rows added from this session's soak: D 1.5b split out as its own
  open item (Decision 2 was buried inside a DONE item), P5 (the lying
  signup meter), N-PLATFORM (target order + per-target passport), and
  N3.2 promoted to an explicit open decision row with a recommendation.
- 2026-08-09 (b) · **N1 shell DECIDED: raylib** (ADR-0008; SDL3 named
  fallback with switch triggers: Deck/Steam Input becomes real · GL
  instability costs lanes · VFX outgrow GL 3.3 · multi-window). Three
  spikes → one confirmation spike. Reverses a same-day SDL3
  recommendation; two premises against raylib withdrawn as wrong (it
  does NOT own the frame loop; its gamepad path rides GLFW's copy of the
  SDL controller mapping DB), and SDL_Render was found to supply no text
  and WAV-only audio — three C deps where raylib is one (its audio layer
  already IS miniaudio + dr_libs). Decisive: L9 + the N0 hash passport
  make the shell swap-able and *provably* behavior-neutral, so a
  reversible decision optimizes speed-to-playable, and N4 is parked.
  Costs on the record: OpenGL-only (no backend flip when the L13 lock
  bites), no Steam Input/gyro. On-box: `raylib 6.0-1`, `sdl3 3.4.14-1`,
  `mbedtls 3.6.5-1`. Committed 4b3cc44.
- 2026-08-09 · **Track N expanded + re-entry soak.** Verified: E2 still
  UNFLIPPED live (`USE_WASM_STEP_WORLD` absent from the running :8088
  server's env — the 07-31 replays' backend=wasm lines were the client
  swap-module layer; the 08-05 (d) caveat is resolved). Hosts healthy
  (:8088/:8089/:8090), bot-only since 07-31, zero commits since wave 2.
  Port surface measured (numbers in Track N above). L8 finding → P5.
- 2026-08-05 (e) · **Wave 2 merged — E1 COMPLETE, Doors 1.3/1.4/1.5a
  live.** Six lanes, one smoke.zig EOF-append conflict (resolved
  base+both-tails), full gates green post-merge: zig 142/142, client
  1949/0 (128k asserts), server 349/0 both authority modes, typechecks
  clean. **First live boot caught what every suite missed:** the lobby's
  trainingDummy wasn't in the codec enum → per-tick encode throw + TS
  fallback; fixed additive both sides + round-trip gate (05dfa0e); live
  log clean since. Host restarted twice (bot-only), dist + sim.wasm
  live. New E-items recorded (see E1-residual). E2 flip is
  prerequisite-free: next = headless bot soak under wasm authority, then
  flip with kill-switch.
- 2026-08-05 (d) · **Track P: 2026-07-31 replay STUDIED** (first of the
  queue) — 3 windows rendered via the host's own headless pipeline,
  motion-analyzed, full-res verified. S1–S4 findings recorded under P2.
- 2026-08-05 (c) · **Wave 1 merged — Doors Phase 0 COMPLETE, E1
  split-spawn (real-projectile half) CLOSED.** Three parallel worktree
  lanes (d18641b · 46843d2 · d6b1b9d, which also fixed four adjacent
  stepV2 lifecycle holes). Post-merge: zig 132/132, client 1909/0
  (110,676 asserts), server 338/0 plus 338/0 under USE_WASM_STEP_WORLD=1.
  Host restarted, new dist + sim.wasm live. Inline same day: 0.5
  short-desktop fold fix (e35112e, 4-viewport verified), 0.8 hygiene
  (~84 MB).
- 2026-08-05 (b) · Doors 0.2 (09c5960) + 0.3 + 0.4 DONE in f926af4;
  dist rebuilt and serving.
- 2026-08-05 · **Doc created; goal live.** Phase 0.1 DONE (six lossless
  commits, hashes at the item). **Toolchain locked 0.15.2** per L2 —
  research receipts: 0.16.0 current-stable-but-dead-end, LLVM-21
  vectorization disablement confirmed via release notes, async =
  API-shipped/not-complete (Io.Threaded only; evented can't socket),
  0.15.2→0.16 migration for the sim empirically ZERO source changes
  (125/125 native + 325 parity + divergence sweep green against a
  0.16-built sim.wasm; artifact 3 bytes apart, identical 157-export
  surface), MIPS-III/N64 codegen verified emitting correct delay-slot
  ELF.
