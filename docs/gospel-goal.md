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
| URL → first shot fired | <15 s returning / <30 s first visit | ~60–140 s worst case (median bell wait ~50 s); ~15 s best via `?world=1` |
| Critical-path payload | <10 MB | ~730 KB gzip JS (eager media killed — Phase 0.4) |
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
  `sim/native/shell.zig`. Worktrees need node_modules symlinks (root +
  client + server). `sim.wasm` is gitignored — `zig build` after pulling
  Zig changes or wasm suites fail stale.
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

- [ ] **1.1 Lobby-first landing** (venue-goal 6.2). Bare URL boots into
      the venue; splash/menu becomes an overlay surface; ident plays only
      from an explicit menu action. One callsign prompt total (the splash
      field and the HangoutScene prompt are two surfaces for one
      localStorage key).
- [ ] **1.2 Move the email gate to the highest-intent moment** — after
      the first fight, not before everything (end-of-demo-screen pattern;
      the Fight Night funnel keeps its ask, aimed at someone who now
      cares). "Maybe later" becomes localStorage with a cooldown, not
      per-tab. ⚠ **DECISION 1** — build flag-dark, Jake flips.
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
- [ ] **1.5b Round-cap taper when humans are queued.** ⚠ **DECISION 2**
      (cadence) — untouched by 1.5a on purpose; build flag-dark.
- [ ] **1.6 `?fight` fast lane + `venueNames.ts`** (venue-goal 6.3/6.1).
      Today's fastest path (`?world=1` slipping under the email gate) is
      an accident, not a design.
- [x] 1.7 Refresh-mid-match recovery — DONE 2026-08-09 (b5adbe2 +
      2318025). The server grace and the stable player id both already
      existed; only boot's *intent* was missing. sessionStorage marker,
      2 s heartbeat + pagehide, checked before the URL branches;
      deliberate exits clear it. **e2e 3/3 in real Chromium against a
      real host**: reload in venue lands on a live surface, deliberate
      exit is not resumed, stale marker is not resumed.
- [ ] **1.8 Class select in the front door.** A player who never finds
      the loadout table fights as "balanced" forever; the private-room
      picker is a bare `<select>` (`main.ts:547-552`) next to the rich
      draft-overlay class rows. One presentation, surfaced on the main
      path.

### Phase 2 — CLOSE THE LOOP (venue-goal Pillars 4 → 5, as written)

Acceptance criteria live in `venue-goal.md`; this sequences them. Build
order: 4 before 5 (the ceremony needs run data to celebrate). Per D-law,
the sim-side halves land in Zig.

- [ ] **2.1 Pillar 4** — sim-side run record, HUD run strip, death card
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
- [ ] **2.3 Personal-record surfacing every round-end** — best streak,
      new PB, "first win as Geometrician". Cheapest proven "one more
      round" trigger, and it works for losers. Feeds off 2.1 run data.
- [ ] **2.4 Pillar 2/3 residuals** — lobby presence floor (see 3.1),
      orphan-ceremony regression test, the unmeasured dummy-hit-<8 s
      half of venue 2.5, ready-totem linger debounce.

### Phase 3 — ALIVE AND UNDERSTANDABLE (empty room + onboarding)

The arena is genuinely alive (4 bots fighting before anyone arrives). The
lobby — the mandatory antechamber — is genuinely dead, and nothing
teaches the loop.

- [ ] **3.1 Lobby presence floor** — persona bots idle in the venue;
      displaced arena bots return here instead of vanishing
      (`worldHost.ts:353-354`). Plausible varied names (never
      Name+digits — the exact tell players catch), violet plates stay
      honest, one FAQ line owns the policy.
- [ ] **3.2 First-session bot ramp** (Smash Karts / Fortnite pattern) —
      a new player's first cycle is bots tuned to lose entertainingly;
      guarantee a first kill inside 60 s; blend humans in from cycle two.
      Keyed on localStorage next to the FTUE flags. **Lands in Zig via
      N-BOT** — do it once.
- [ ] **3.3 Onboarding by encounter** (ui-axioms bans modal tutorials) —
      the lobby teaches movement/fire via ghosted glyphs over the
      dummies; the FTUE legend becomes re-summonable (today: once ever
      per browser, `OnlineMatchScene.ts:763-766`) plus a persistent
      controls reference in Settings; first-storm and first-cycle-end get
      FTUE lines like the first-draft one. Class verbs taught on first
      pick of that class, not up front.
- [ ] **3.4 Seven-zeros splash fix** — the stats strip on a fresh browser
      is seven zeros as the front door's social proof. Show arena
      liveness honestly ("4 fighters warming up · AI"); never count bots
      as players.
- [ ] **3.5 Silent-failure sweep** — callsign-gate no-op at the bell
      totem (`venueHost.ts:604-611`), 1 s blank venue feed, lobby
      disconnect with no retry affordance, venue visitors unable to reach
      the pause menu (`main.ts:1836`).

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
- [ ] **4.5 Lobby VFX parity completion** — Geometrician lance
      inconclusive, Syzygist tether + all-4 cast-tells not attempted
      (`lobby-vfx-parity-goal.md:451-458`).
- [ ] **4.6 Live killfeed** (small; the ceremony and clips both want it).
      Data side lands in Zig per D-law.
- [ ] **4.7** `100vh`→`100dvh` at `style.css:103,219,367,1324`;
      short-desktop added as a canonical QA viewport; write the
      sizing-on-fleek rule into ui-axioms (enforced, but exists nowhere
      as text).

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
  - `world.zig` homing-at-integration passes empty player arrays —
    homing never turns under wasm; reachable now via priest tendrils.
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
- [ ] **0.3 Headless stepper + hash stream.** Step from seed + inputs,
      emit the existing state hash every N ticks (default 60).
      Full-match step of the largest replay (21.9 MB) completes;
      wall-clock recorded as the first native bench number.
- [ ] **0.4 Cross-check gate.** Same hash cadence from the wasm path
      (reuse the parity harness); comparator runs both over every
      archived replay. **Bit-identical across all replays**, comparator
      lands in `zig build test` + the client parity suite. Any mismatch
      is an L10 float-semantics bug and blocks all N work until
      root-caused.
- [ ] **0.5 Native world-init.** `world_init(seed, map_id, roster)` in
      the core (exported to wasm too) so shells stop hand-packing initial
      state. The TS bridge keeps its packing path (parity-tested) until
      E3. Acceptance: the N0 harness can *create* a world natively and
      self-play bots without packed-state input.

### Interlock lanes (Track E work Track N needs; they land per L1, once)

- [ ] **N-BOT · Bot brain into the core.** Port `worldBots.ts` +
      `botArenaNav.ts` (~900 lines) to `sim/src/bot.zig` with parity
      tests against the TS brain (same seed, same decisions, N seeds × M
      ticks). Simultaneously Doors 3.2's landing site. Required for N2;
      also upgrades the E2 soak (sim-native bots = closer to shipped
      truth).
- [ ] **N-MAP · Map gen into the core.** Port seeded generation + named
      maps to `sim/src/map_gen.zig`; the server reads gen output through
      the bridge instead of generating in TS. Required for N2 offline;
      kills a class of "browser and desktop disagree about the arena"
      bugs before it exists.
- [ ] **N-AIM · E4 aim-intent substrate.** Mouse-exact dialect ships
      first; assisted/stick arrive with gamepad. Desktop input feeds the
      same aim contract as browser input or L9 is violated.

### N1 — SHELL: **DECIDED**, one confirmation spike (after E2)

**Shell lib = raylib. Fallback = SDL3.** Decision, full alternative
analysis (sokol, hand-rolled GL, webview wrapper — all rejected on the
record) and switch triggers: **`docs/adr/0008-native-shell-raylib.md`**.
Criteria that drove it: one dependency covering batched 2D + additive
blend + render-to-texture, TTF text, and ogg/mp3 decode of the 27 MB
canonical SFX bank; caller-owned frame loop; cheap Windows
cross-compile; on-box today (`extra/raylib 6.0`).

- [ ] **1.1 Confirmation spike** (one worktree lane, timeboxed). Bar:
      open a window; 500 moving additive-blended shapes at 60 Hz with
      frame p99 printed; HUD text from a TTF; one canonical meme SFX
      decoded from file; mouse + one gamepad. Built via `@cImport` on
      `raylib.h` (no third-party bindings) **inside the repo or under
      `mise exec`** (L2 footgun). A spike that fights the box (L13)
      records that as a finding — and as a live check against ADR-0008's
      GL-instability switch trigger.
- [ ] **1.2 Promote or fall back.** Bar met → promote to
      `sim/native/shell.zig` skeleton, ADR-0008 flips from spike-gated
      to confirmed. Bar missed → SDL3 per the ADR's triggers, follow-up
      ADR, no re-argument of the rejected candidates.
- **1.3 Netcode groundwork** (standing research verdict): plain threads
  + nonblocking sockets, **no** std.Io async, **no** Zig std TLS
  (0.15/0.16) for anything.

### N2 — PLAYABLE OFFLINE (the mountain, climbed at the baked tier)

- [ ] **2.1 Frame loop + world render.** Fixed-tick sim (the server's
      tick) decoupled from render; interpolated presentation; camera.
      Arena, destructibles, satellites, projectiles, players as
      baked-tier procedural draws. Acceptance: an N0 replay *rendered* —
      watch an archived match play back windowed with hashes still
      matching (L9's proof-of-innocence for the shell).
- [ ] **2.2 Input dialect (mouse-exact).** Per the control truth in
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
- [ ] **2.4 Bots + offline match.** N-BOT brains fill the roster; full
      FFA cycle with all four classes present (chassis rule: the
      Geometrician stays raycast, in any shell, forever). Acceptance:
      the N2 gate numbers over a scripted 5-minute soak, logged per L8.
- [ ] **2.5 Audio.** Canonical SFX decode+playback (never synthesized
      substitutes) + the `ProceduralAudio` synth graph ported to the
      native mixer. Acceptance: A/B capture of the same replay
      browser-vs-native, event-aligned; missing/extra cues listed.
- [ ] **2.6 HUD + killfeed + nameplates.** Baked-tier text; killfeed
      data from the core (Doors 4.6's landing site). Class-identity
      legibility per the chassis axioms (colour stays earned:
      cyan/gold/white).
- [ ] **2.7 Asset pack.** Deterministic packer (a Bun script is fine —
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

### N4 — DISTRIBUTION (parked)

Packaging, icons, Steam. Out of scope until N3 is real. Every N4 item
that costs money or creates accounts is a Jake row. Do not open this
section early because it is fun; it is fun, and it is parked.

---

## TRACK P — PROOF (runs continuously, never completes)

- [ ] **P1 Funnel telemetry** into the data warehouse: page_load →
      playable → first_input → first_shot → first_kill → first_death →
      round_end_seen → played_again, plus quit points and wrong-input
      count in the first 30 s. Fix the largest absolute drop first;
      long-duration-then-quit = confusion.
- [ ] **P2 Footage-study cadence.** Every phase ends with a re-render of
      the newest replays and an indexed frame critique against the north
      star. Standing rule: re-watch latest footage FIRST on every
      re-entry; stationary >1 s = bug. **Queue: 2 of the 3 2026-07-31
      replays remain un-studied.** No newer replays exist — no human has
      played since 07-31.
  - Findings from the studied one (docs/clip-sheets/study-2026-08-05-jul31-replay.md):
    **S1** bot idle floor violated (7.7 s statue bot, HIGH) · **S2**
    spectator director dwells on idle subjects (HIGH) · S3 HUD-less
    renders read countdowns as dead air (MED) · S4 render envelope
    documented (≤~45 s windows; upload 413 above; full-match encode
    wedges). S1+S2 are open lane candidates.
- [ ] **P3 Stranger test (the exit gate).** 5–8 people, silent-8
      protocol (observe, never help, second person takes notes), funnel
      from P1 running. Gates: CTP ≥70%, first kill <60 s, play-again
      ≥50%.
- [ ] **P4 Soak + load.** Headless bot-only overnight cycles through the
      NEW loop (ceremony/vote/return), and a join-path load test before
      any public moment.
- [ ] **P5 Fix the lying meter (L8 violation, found 2026-08-09).**
      `data-warehouse/report.ts` reports "20 email signups captured";
      all 20 rows are `@example.com` UUID addresses from 2026-07-13/14
      test runs. Real signups ≈ 0–1. Filter test rows or the report will
      keep flattering the funnel it exists to measure.
- **Engine meters (continuous):** divergence sweep · bench · replay
  hashes · native-vs-wasm passport per-target · frame p50/p99 + input
  latency on the N2 soak · binary+pack size and cold-start-to-lobby
  (browser gate is <15 s; native should embarrass it — target <5 s).

---

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
