# OPEN DOORS — the public-readiness overhaul

**Subsumed 2026-08-05 (same day) as Track D of `gospel-goal.md`** — that
doc adds the Zig-first law (its D-law amendment routes this doc's
sim-adjacent items through the Zig core) and owns cross-track priority;
THIS doc stays authoritative for item detail and in-track sequencing.

**Written 2026-08-05.** This is the live tracker for making JAKESJAM publicly
presentable with a complete core gameplay loop. It absorbs the untracked back
half of `venue-goal.md` (Pillars 4/5/6 — verified unbuilt today, and explicitly
NOT covered by `finish-line-goal.md` per its own Track D note) plus everything
surfaced by the 2026-08-05 four-way audit (player-journey trace, presentability
sweep, research-receipts distillation, outside genre research). Acceptance
criteria for Pillars 4/5/6 live in `venue-goal.md` — this doc sequences them,
it does not re-state them. `finish-line-goal.md` stays authoritative for its
own remaining Jake-gates.

**Ground-truth sources:** venue-goal.md Evidence Ledger · the 23-seam audit at
`/mnt/wd5t/Documents/JAKESJAM_HotLobby_Research_20260716/current_flow_map.md`
(NOTE: wd5t mount, not ~/Documents) · this doc's Status block.

---

## North star

> A stranger who clicks play.elyad.io on any device is **in a live fight in
> under 15 seconds**, understands what is happening, finishes a cycle with a
> ceremony, and chooses "again."

Numeric gates (from published browser-game bars — Poki/CrazyGames):

| Gate | Target | Today (measured 2026-08-05) |
|---|---|---|
| Conversion-to-play (load → ≥1 min played) | ≥70% (80% = exceptional) | unmeasured; journey has 5 gates + ≥5 clicks before the lobby |
| URL → first shot fired | <15 s returning / <30 s first visit | ~60–140 s worst case (median bell wait ~50 s); ~15 s best case via `?world=1` |
| Critical-path payload | <10 MB | ~730 KB gzip JS + **~13.3 MB eager media at boot** |
| First kill | <60 s | unguaranteed (default-class player vs mixed bots) |
| Play-again rate after first cycle | ≥50% | unmeasured; cycle ends in a modal |

"Publicly presentable" = every Phase 0–3 item DONE + the Phase 5 funnel shows
the gates green in a stranger test. Phases 4 is texture — it upgrades the
result but does not gate it.

---

## Phase 0 — STOP THE BLEEDING (hygiene + cheap blockers; no design decisions)

- [x] 0.1 **Commit the working tree.** DONE 2026-08-05 — six lossless
      commits, worktree==HEAD verified: a8a4eaa (net identity escalation
      + both test suites), 10b359e (CrazyGames removal), c3895ca (global
      governor), 5799ef5 (Discord CTA/toast), 90f5bbe (ops LAN listener +
      clip routes), 6d02055 (marketing bank).
      Original item: ~520 ins / 802 del across 20 files,
      uncommitted since 29 Jul: CrazyGames SDK removal, class-swap wire fix +
      tests, ops clip file/archive routes, email-gate changes, **the global
      governor attach** (`main.ts:668` — a checkout loses menu/lobby/tutorial
      governor coverage). Split into logical commits.
- [ ] 0.2 **Fix the static-host unfurl.** `client/dist/index.html:104,105,115`
      ships the literal `__ORIGIN__` token — every Discord/X paste of a
      statically-hosted landing URL unfurls broken. Substitute in
      `scripts/vercel-build.sh` (the Bun server already rewrites it;
      `server/src/index.ts:198-203`).
- [ ] 0.3 **Load the brand font.** `Noto Serif Display` is specified on the
      wordmark, "INTREPID DEVELOPMENT PRESENTS", "CLICK TO INITIATE", credits
      (`style.css:2115,2186,2296,2437,2778,2943`) and never loaded — the first
      three seconds render in fallback serif. Self-host via `@font-face`
      (kills the fonts.googleapis.com dependency at the same time).
- [ ] 0.4 **Kill the eager media preload.** `preload="auto"` on menu (2.7 MB),
      world (2.7 MB) and venue (3.9 MB) music at `main.ts:1257,1277,1288` plus
      the 4 MB splash video = ~13.3 MB before any gameplay. Load venue/world
      tracks on surface entry; `preload="metadata"` + poster for the video.
- [ ] 0.5 **Splash CTA above the fold at 393×852.** Open since mobile wave 1
      (`docs/mobile-experience.md:199-205`); the uncommitted Discord row
      pushes it further down. Re-verify all four canonical viewports.
- [ ] 0.6 **Doc-drift purge:** finish-line F2 note (the 34-candidate slate at
      `~/Music/jakesjam-slash-audio/` does not exist on this machine — blocker
      is missing input, not "awaiting picks"); STATE-OF-PLAY still says
      "CrazyGames first" while the tree deletes the SDK; mobile-experience.md
      documents a removed orientation-hint; SimEventRouter.ts:612-617 carries
      a stale "no rig animation" comment (shipped in 2d14dcb).
- [ ] 0.7 **Small honest-copy fixes:** hide `[T] DUO QUEUE` on touch
      (`HangoutScene.ts:1172-1183`); rename "Rematch" to what it does
      ("READY FOR NEXT CYCLE"); clip-recording disclosure line in the first
      match (default-on upload is only disclosed deep in Settings —
      `clipConsent.ts:1-4`).
- [ ] 0.8 **Tree hygiene:** delete root `.clips/` stub files, empty
      `server/.clips-host/`, `stream-kit/obs/*.bak-*` ×9, `__pycache__/`,
      `splash-theme.m4a.bak` in dist, and the orphaned 83 MB of portal
      artifacts (`dist-portal/`, `jakesjam-portal-build.zip`) now that the
      portal strategy is dead.

## Phase 1 — THE FRONT DOOR (URL → fighting; conversion)

The journey audit's blocker chain, in one sentence: email gate → boot gate →
27.9 s ident → splash → callsign → walk → **up to 100 s bell wait** → 3 s
admission race that can park you as a spectator for a full round and then
tell you "ELIMINATED" before you ever spawned.

- [ ] 1.1 **Lobby-first landing** (venue-goal 6.2). Bare URL boots into the
      venue; splash/menu becomes an overlay surface; ident plays only from an
      explicit menu action. One callsign prompt total (splash field and
      HangoutScene prompt are two surfaces for one localStorage key).
- [ ] 1.2 **Move the email gate to the highest-intent moment** — after the
      first fight, not before everything (end-of-demo-screen pattern; the
      Fight Night funnel keeps its ask, aimed at someone who now cares).
      "Maybe later" becomes localStorage with a cooldown, not per-tab.
      ⚠ DECISION 1 — needs Jake's sign-off before build.
- [ ] 1.3 **Fix the admission race.** Pre-open the arena socket while queued
      (spectator-grade), so `venue-admitted` → insertion never loses the 3 s
      countdown window (`venueHost.ts:353-355`, `worldHost.ts:241-253`).
      Acceptance: an admitted player is ALWAYS inserted at the bell they were
      admitted for, on a cold cache, on a phone.
- [ ] 1.4 **A never-spawned player is never told they died.** Pending-entrant
      state gets its own overlay copy (NEXT BELL + spectate framing), never
      "ELIMINATED", never the eliminated/soul-reclaimed announcer calls
      (`OnlineMatchScene.ts:1118,1264-1313`).
- [ ] 1.5 **Make the bell wait survivable:** touch combat in the lobby
      (remove the walk-only mask, `HangoutScene.ts:1256-1259` — dummies are
      unhittable on the platform with the shortest attention span), and a
      visible next-bell countdown from second zero. Consider a round-cap
      taper when humans are queued. ⚠ DECISION 2 (cadence) — Jake.
- [ ] 1.6 **`?fight` fast lane + `venueNames.ts`** (venue-goal 6.3/6.1).
      Today's fastest path (`?world=1` slipping under the email gate) is an
      accident, not a design.
- [ ] 1.7 **Refresh-mid-match recovery.** A reload during a match currently
      lands on the splash and forfeits the run (10 s server grace is
      unreachable through the boot path). Store a resume token; bare reload
      inside grace rejoins the arena directly.
- [ ] 1.8 **Class select in the front door.** A player who never finds the
      loadout table fights as "balanced" forever; the private-room picker is
      a bare `<select>` (`main.ts:547-552`) next to the rich draft-overlay
      class rows. One presentation, surfaced on the main path.

## Phase 2 — CLOSE THE LOOP (venue-goal Pillars 4 → 5, as written)

Already acceptance-test-shaped in venue-goal.md; execute as specified there.
Build order: 4 before 5 (the ceremony needs run data to celebrate).

- [ ] 2.1 **Pillar 4** — sim-side run record, HUD run strip, death card with
      run facts + edge-vignette spectate (kill the full-screen blur wash,
      `DeathOverlay.ts:220-233`), shared draft (pick ticker, reverse-standings
      order — today it's alphabetical by playerId, `round.ts:343` — announced
      auto-picks), "joined R4" scoreboard honesty.
- [ ] 2.2 **Pillar 5** — cycle end returns EVERYONE to the venue together;
      podium + MVP ceremony in the lobby; 10 s map vote; arena reboots
      beneath; two-step re-entry. The `MatchResultsOverlay` modal dies.
      Ceremony discipline (Overwatch field-study lesson): it fills the recycle
      interval that already exists (12 s ceiling) and NEVER delays the next
      bell; any input skips.
- [ ] 2.3 **Personal-record surfacing every round-end** — best streak, new PB,
      "first win as Geometrician." Cheapest proven "one more round" trigger,
      and it works for losers. Feeds off Pillar 4 run data.
- [ ] 2.4 **Pillar 2/3 residuals** from the venue ledger: lobby presence floor
      (2.6 — see 3.1), orphan-ceremony regression test (3.4), the unmeasured
      dummy-hit-<8s half of 2.5, ready-totem linger debounce.

## Phase 3 — ALIVE AND UNDERSTANDABLE (empty room + onboarding)

The arena is genuinely alive (4 bots fighting before anyone arrives). The
lobby — the mandatory antechamber — is genuinely dead, and nothing teaches
the loop.

- [ ] 3.1 **Lobby presence floor:** persona bots idle in the venue; displaced
      arena bots return here instead of vanishing (`worldHost.ts:353-354`).
      Plausible varied names (never Name+digits — the exact tell players
      catch), violet plates stay honest, one FAQ line owns the policy.
- [ ] 3.2 **First-session bot ramp** (Smash Karts / Fortnite pattern): a new
      player's first cycle is bots tuned to lose entertainingly; guarantee a
      first kill inside 60 s; blend humans in from cycle two. Keyed on
      localStorage next to the FTUE flags.
- [ ] 3.3 **Onboarding by encounter** (ui-axioms bans modal tutorials): the
      lobby teaches movement/fire via ghosted glyphs over the dummies; the
      FTUE legend becomes re-summonable (today: shows exactly once ever per
      browser, `OnlineMatchScene.ts:763-766`) and gets a persistent controls
      reference in Settings; first-storm and first-cycle-end get FTUE lines
      like the first-draft one. Class verbs taught on first pick of that
      class, not up front.
- [ ] 3.4 **Seven-zeros splash fix:** the stats strip on a fresh browser is
      seven zeros as the front door's social proof. Show arena liveness
      honestly ("4 fighters warming up · AI") instead of zero-rows; never
      count bots as players.
- [ ] 3.5 **Silent-failure sweep:** callsign-gate no-op at the bell totem
      (`venueHost.ts:604-611`), 1 s blank venue feed, lobby disconnect with
      no retry affordance, venue visitors unable to reach the pause menu
      (`main.ts:1836`).

## Phase 4 — SOUND AND SPECTACLE (texture; upgrades but does not gate)

- [ ] 4.1 **Regenerate the slash-audio slate** (the F2 input artifact is
      gone). Canonical recordings via yt-dlp per the hard no-synthesis rule;
      rebuild CANDIDATES.md; Jake picks; wire `slash-started` (fully silent
      today) and a real `stab-landed` cue.
- [ ] 4.2 **Venue loop audio:** bell ring, ceremony/podium sting, draft tick,
      lobby ambience. Same sourcing pipeline as 4.1.
- [ ] 4.3 **Announcer:** 16 keys wired and 100% silent (no assets exist).
      ⚠ DECISION 3 (voice source: Jake records vs local Kokoro vs cut the
      layer) — the never-synthesize rule was written for meme SFX; a voice
      layer is Jake's call.
- [ ] 4.4 **Studio SFX pack:** `scripts/process-sfx.ts` + SFX_KIT brief are
      complete; `~/Music/binipe-sfx/` input doesn't exist. The `shoot` cue is
      heard ~1000×/session as synth fallback.
- [ ] 4.5 **Lobby VFX parity completion:** Geometrician lance inconclusive,
      Syzygist tether + all-4 cast-tells not attempted
      (`lobby-vfx-parity-goal.md:451-458`).
- [ ] 4.6 **Live killfeed** (small; the ceremony and clips both want it).
- [ ] 4.7 `100vh`→`100dvh` at `style.css:103,219,367,1324`; short-desktop
      added as a canonical QA viewport; write the sizing-on-fleek rule down
      in ui-axioms (it is enforced but exists nowhere as text).

## Phase 5 — PROVE IT (instrumentation + rituals; runs continuously)

- [ ] 5.1 **Funnel telemetry** into the data warehouse: page_load → playable →
      first_input → first_shot → first_kill → first_death → round_end_seen →
      played_again, plus quit points and wrong-input count in the first 30 s.
      Fix the largest absolute drop first; long-duration-then-quit = confusion.
- [ ] 5.2 **Footage-study cadence:** every phase ends with a re-render of the
      newest replays (3 from 2026-07-31 in `server/.replays/` right now) and
      an indexed frame critique vs this doc's north star. Standing rule:
      re-watch latest footage FIRST on every re-entry; stationary >1 s = bug.
- [ ] 5.3 **Stranger test (the exit gate):** 5–8 people, silent-8 protocol
      (observe, never help, second person takes notes), funnel from 5.1
      running. Gates: CTP ≥70%, first kill <60 s, play-again ≥50%.
- [ ] 5.4 **Soak + load:** headless bot-only overnight cycles through the NEW
      loop (ceremony/vote/return), and a join-path load test before any
      public moment.
- [ ] 5.5 **One taped Jake evening** clears the standing human gates in a
      single session: Z4 wasm flip, Six Axes playtest, chassis feel-check,
      F3 both-classes pass, STAB sanity, Kindled-vs-Interstice 83→41 eyeball,
      audio picks (4.1), voice-pass sign-off, Syzygist white ratify.

---

## Decisions Jake owns (build proceeds around them, not through them)

1. **Email gate position** — recommend: move to post-first-fight (1.2).
2. **Bell cadence** — recommend: round-cap taper when humans are queued (1.5).
3. **Announcer voice source** — record / Kokoro / cut (4.3).
4. **Persistence scope for the weekly venue board** — recommend: one
   bun:sqlite file on the host (warehouse pattern); a "weekly" board on a
   process-lifetime ring buffer dies at every restart, and restarts happen.
5. **Spectate depth** — recommend: keep the text/state feed through this
   overhaul; snapshot-relay spectate lands with Fight Night, not before.
6. **Track R activation** — recommend: only if Phase 5 telemetry shows
   low-end devices failing the governor's floor.
7. **PAX Aus via SAE, closes Sun 16 Aug** — submit or deliberately lapse.

## Explicitly parked (subtraction is the discipline)

Fight Night show overlay (Model B — needs its own goal doc AFTER Pillars 4/5
give it a substrate) · duos polish · per-class-capable bot policy for the
balance matrix (blocked instrument, separate task) · split-spawn Zig
orchestrator (finish-line Z5 leftover) · snapshot-relay spectate · portals
(CrazyGames/Poki dropped 2026-08-01) · all press/creator outreach (banked in
`marketing/`, ON HOLD by Jake's order).

---

## STATUS — ground truth, newest first

- 2026-08-05 (later) · Subsumed as gospel-goal.md Track D (Jake: "GO ALL
  ZIG", both programs merged). Phase 0.1 committed (hashes at the item).
  Zig toolchain question resolved — see gospel-goal L2 (pin stays
  0.15.2; jump target ≥0.17.1, harness-gated).
- 2026-08-05 · Doc created from the four-way audit (journey trace,
  presentability sweep, receipts distillation, outside research). All items
  OPEN. Venue Pillars 4/5/6 re-verified unbuilt against source today; only
  deltas since the 07-26 backfill: Lobby button promoted to primary CTA,
  CrazyGames SDK deleted in the working tree, two mobile QA waves inside the
  unbuilt flows. Working tree dirty since 29 Jul (Phase 0.1).
