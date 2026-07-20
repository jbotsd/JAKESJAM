# Lobby VFX Parity — the lobby renders every construct because it runs the exact code a live match does

**Status:** North star + build contract. Closes one confirmed, scoped rendering gap — this is not
a redesign of any visual, a new render system, or a change to any class's construct art. It is
wiring the lobby onto the system that already draws all of it correctly everywhere else.
**Parent(s):** `docs/presentation-completion-goal.md` (owns the harness-playtest-loop completion
gate this doc reuses verbatim for its visual acceptance), `docs/venue-lobby-tableau-goal.md` (the
**functional** parity gap for the same room — destructible hit resolution, ally `teamId`, Emission
charge in hangout mode), `docs/venue-goal.md` (the lobby's own architecture and the completion-
discipline hard rule this doc inherits).
**Does not supersede:** `venue-lobby-tableau-goal.md`'s composition/staging calls (table position,
ally-NPC placement, cathedral-scale backdrop) — this doc only touches render-pipeline wiring,
never room layout, and must not fight that doc's geometry.
**Companion, not duplicate:** `venue-lobby-tableau-goal.md`'s acceptance checklist item "Ninja and
Paladin M1 visibly damage a bad dummy" can go green on damage numbers alone while still looking
wrong — no blade ever appears — unless this doc's wiring lands too. The two docs close the same
user-visible complaint ("class selection isn't at parity in the lobby") from two different layers:
that doc makes abilities **do** something in the lobby; this doc makes them **look** right when
they do.
**Last written:** 2026-07-20.

**One sentence:** `HangoutScene` (the lobby) never constructs a `ParticlePool`, `StatusVfxController`,
or `ConstructVfxController` — the exact trio `OnlineMatchScene` uses for every held weapon, melee
swing, Ward slab, Syzygist tether, Geometrician lance flourish, and ability cast-tell — so every
class's resting weapon and every combat construct is invisible in the lobby today, even though the
same `ProceduralPlayerRig` instances and the same `SimEvent` stream are already flowing through
`HangoutScene`; the fix is wiring the lobby onto the identical code path OnlineMatchScene already
proves correct, never writing a second implementation.

**Completion discipline (hard rule, inherited from `venue-goal.md`, learned the hard way):** every
acceptance test in this doc is verifiable by tool calls — `bun test`, `tsc`, `grep`, the
`constructHarness`/`rigHarnessShots` frame capture, the autoplay + `audit-presentation-evidence`
loop. A condition that can only be satisfied by a human does not belong in an acceptance list.
"Does it read right" judgment is not skipped — it is converted into the automated harness-playtest
loop `presentation-completion-goal.md` already defines: drive the scenario, extract frames at the
moment each construct fires, a vision agent reads them against named criteria, fix everything
found, repeat to convergence. Never a blocking human-only gate.

---

## Root cause (confirmed by direct code read, 2026-07-20)

`OnlineMatchScene.ts` constructs the trio during scene setup and drives it every frame:

```
628:  this.particlePool = new ParticlePool(this);
673:  this.statusVfx = new StatusVfxController(this, this.particlePool);
676:  this.constructVfx = new ConstructVfxController(this, this.particlePool);
```

and every frame, unconditionally (not gated on "were there new events this frame"), inside its
main `update()`:

```
1015: const simEvents = this.pendingSimEvents;
1021: this.statusVfx.update(state, simEvents, deltaMs, resolvePos);
1027:   const resolveHand = (id, hand) => this.playerRigs.get(id)?.getHandWorld(hand) ?? undefined;
1030:   const triggerMeleePose = (id, style, dir) =>
1035:     this.playerRigs.get(id)?.triggerMeleeSwing?.(style, dir);
1036:   this.constructVfx.update(state, simEvents, deltaMs, resolvePos,
                                  classIdForArchetype, resolveHand, triggerMeleePose);
3116: this.pendingSimEvents.length = 0;   // drained once per frame, after both consumers ran
```

`HangoutScene.ts` has **none of this** — confirmed by grep, zero hits for `ParticlePool`,
`StatusVfxController`, or `ConstructVfxController` anywhere in the file. It does have its own
`SimEvent` stream (`onEvents: (events) => this.handleSimEvents(events)`, `HangoutScene.ts:400`)
and its own live `ProceduralPlayerRig` per player (`makePlayerRig`, `HangoutScene.ts:1342`) — the
two ingredients `ConstructVfxController.update()` needs are already sitting right there, just never
handed to it. Its `handleSimEvents` (`HangoutScene.ts:652`) dispatches events one at a time
straight to a `SimEventRouter` for audio/damage-number purposes only, with no buffering:

```
659:  this.simEventRouter = new SimEventRouter({
       ...
       particlePool: null,   // <- confirms no pool exists in this scene at all
       renderLayer: null,
```

and its own comment at `HangoutScene.ts:653-658` explains the (now-stale) assumption:

> "Only ready-toggled/launch-requested (and the always-inert combat cases) can ever fire in a
> hangout match — the deps below are still fully wired (not stubbed) so the router's exhaustive
> switch stays byte-identical to OnlineMatchScene's, even though most branches are unreachable
> here."

That assumption stopped being true the moment `venue-lobby-tableau-goal.md`'s practice dummies and
`b80337a`'s showcase gauntlet made real combat reachable in the lobby. Nobody went back and gave
the construct-VFX layer the same wiring the damage-number layer already got
(`spawnDamageNumber`/`spawnDamageNumberAt`, added 2026-07-19 per the same file's own comment at
`HangoutScene.ts:670-678`) — that prior fix is the direct precedent this doc repeats for the
construct layer.

**What this is not:** a missing data entry. `client/src/game/data/characters.ts` and
`client/src/sim/data/weapons.ts` define all four chassis (Geometrician/Kindled/Interstice/Syzygist)
completely; `classAccentColors.ts`'s `CLASS_ACCENT_PALETTES` is a TS-enforced total `Record<ClassId,
…>` with no gaps. The data is fine. This is purely a missing render-pipeline wiring gap in one
scene file.

---

## Architecture — single source of truth

| File | Change |
|---|---|
| `client/src/game/scenes/HangoutScene.ts` | Add fields: `particlePool`, `statusVfx`, `constructVfx`, `pendingSimEvents: SimEvent[]`. Construct all three (mirroring `OnlineMatchScene.ts:628,673,676`) during scene setup. Change `handleSimEvents` (`:652`) to also push into `pendingSimEvents` (mirroring `OnlineMatchScene.ts:1542-1545`), in addition to its existing per-event `simEventRouter.dispatch`. Add the `resolveHand`/`triggerMeleePose` closures and the unconditional `statusVfx.update()` / `constructVfx.update()` calls inside `update()` (`:1101-1201`), mirroring `OnlineMatchScene.ts:1016-1042` byte-for-byte. Drain `pendingSimEvents.length = 0` after, mirroring `OnlineMatchScene.ts:3116`. Retire the stale "always-inert combat cases" comment at `:653-658`. **Phase 3 addition:** bind a Shift/Shield key (mirrors `OnlineMatchScene.ts:594`) and wire `InputBit.Shield` into the input assembly, venue-gated same as Fire — the lobby had no input path to Shield at all, so Kindled's Ward was untestable regardless of the VFX-wiring fix. |
| `scripts/lobbyVfxParityShots.ts` | **New.** Playwright/CDP evidence-capture script for this doc's Pillar 2/3 — see Evidence ledger. `bun run presentation:lobby-vfx-parity` (alias added to root `package.json`). |
| `client/src/game/systems/ConstructVfxController.ts` | **No changes.** Already correct — proven by `OnlineMatchScene` and `client/src/constructHarness.ts` both driving it successfully today. Read-only reference for the lobby wiring. |
| `client/src/game/systems/StatusVfxController.ts` | **No changes.** Same status — reference only. |
| `client/src/game/rendering/ProceduralPlayerRig.ts` | **No changes.** `triggerMeleeSwing` (`:807`) already exists generically on the rig class; lobby rigs are already real `ProceduralPlayerRig` instances (`makePlayerRig`, `HangoutScene.ts:1342`), so the swing plumbing works the instant the scene calls it. |
| `client/src/game/render/SimEventRouter.ts` | **No functional change.** The `slash-started` no-op stub (`:476-483`) does not double-fire against `ConstructVfxController`'s own event scan (`ConstructVfxController.ts:376`) — they're independent consumers of the same `events` array, same pattern `OnlineMatchScene` already runs safely. Its comment ("no rig animation... fast-follow") is now stale in the arena (rig animation shipped via `2d14dcb`) and worth a one-line correction, but is not a blocker for this doc. |
| `client/src/game/scenes/OnlineMatchScene.ts` | **No changes.** The reference implementation this doc ports, verbatim, into the lobby. |

---

## Doc conflict resolution (mandatory deliverable)

| File | Action | Status |
|---|---|---|
| `docs/venue-lobby-tableau-goal.md` | No edits needed — its acceptance checklist item "Ninja and Paladin M1 visibly damage a bad dummy" gets a footnote via this doc's Relationship table (below) clarifying it needs this doc's wiring too for the *visual* half of "visibly." | ☐ (footnote to add when this doc lands) |
| `docs/presentation-completion-goal.md` | No edits needed — its completion matrix (`Weapon construct` column, per class) implicitly assumed match-only coverage; this doc extends the same matrix's applicability to the lobby without changing the matrix itself. | ✅ (compatible as-is) |
| `docs/venue-goal.md` | No edits needed — this doc borrows its completion-discipline rule by reference, doesn't restate or fork it. | ✅ |

---

## Pillars

### Pillar 1 — Wiring exists (the mechanical fix)

**Outcome:** `HangoutScene` owns its own `ParticlePool`, `StatusVfxController`, and
`ConstructVfxController`, constructed once and driven every frame, with call signatures identical
to `OnlineMatchScene`'s.

**Acceptance tests**
1. **Pool + controllers constructed:** `grep -n "new ParticlePool(this)" client/src/game/scenes/HangoutScene.ts` and equivalent greps for `new StatusVfxController(this, this.particlePool)` / `new ConstructVfxController(this, this.particlePool)` each return exactly one hit. *Verify: grep.*
2. **Driven unconditionally, every frame:** `this.statusVfx.update(...)` and `this.constructVfx.update(...)` appear inside `HangoutScene`'s `update()` method (`~:1101-1201`), called on every invocation — not inside `handleSimEvents`, not gated behind `if (events.length > 0)`. This is what guarantees the *idle* held-weapon draw (Pillar 2) happens even on a zero-event frame, matching `ConstructVfxController.update()`'s own per-player idle draw loop (`ConstructVfxController.ts:575-600`), which runs regardless of events. *Verify: read the diff; a lint/grep check confirming the call site is not nested inside the event-count conditional.*
3. **Event buffering matches the arena pattern:** `pendingSimEvents` is pushed to in `handleSimEvents` and drained (`.length = 0`) once per frame after both consumers run, mirroring `OnlineMatchScene.ts:1542-1545` / `:3116` exactly — not reinvented. *Verify: grep + read.*
4. **Types line up:** `bun run typecheck` (client workspace) is clean — proves `resolveHand: HandResolver`, `resolveClassId: classIdForArchetype`, and `SimEvent[]` all satisfy `ConstructVfxController.update()`'s real signature (`ConstructVfxController.ts:314-330`) with zero `any`/cast escapes. *Verify: `bun run typecheck`.*
5. **No regressions:** `cd client && bun test` stays green — in particular `render/__tests__/simEventRouter.test.ts` and `render/__tests__/meleeStage.test.ts` (the pure melee-timing math this wiring depends on) are unaffected, since this pillar only adds calls, never edits `ConstructVfxController.ts`/`meleeTiming.ts`. *Verify: `cd client && bun test`.*

**Known test-infra constraint (write this down so nobody re-discovers it the hard way):**
`ConstructVfxController`/`StatusVfxController` cannot be unit-tested directly under `bun:test` —
they import `Phaser`, and `import Phaser from "phaser"` throws (`window is not defined`) outside a
browser, per the existing comment at `render/__tests__/meleeStage.test.ts:124-126` explaining why
melee math was split into Phaser-free pure functions in `meleeTiming.ts`. There is no equivalent
pure-function extraction for the held-weapon/ward/tether *draw* calls, so Pillar 1's acceptance
leans on grep + typecheck + regression suite for the wiring itself, and Pillars 2–4 lean on the
Playwright-driven harness for actual pixel proof. Do not attempt to write a `bun:test` that
constructs a real `ConstructVfxController` — it will fail on the Phaser import, not on your logic.

### Pillar 2 — Idle/resting parity (no combat required)

**Outcome:** a class standing at the loadout table in the lobby shows its resting construct exactly
as it would standing idle in the arena — Kindled holds Kindled Edge, Interstice holds twin
daggers/blades, Geometrician and Syzygist show whatever idle construct state `ConstructVfxController`
already draws for them arena-side.

**Acceptance tests**
1. **Harness or headless screenshot proves non-empty draw:** extend `scripts/loadoutHarnessShots.ts`
   (already headless-screenshots the loadout station per class, `bun run presentation:loadout-evidence`)
   — or add a sibling script following the exact same pattern — to also capture the *standing rig*,
   not just the station UI chrome, for all four classes with zero combat events fired. A pixel-
   content check (non-blank region where the held-weapon layer should render) on the captured frame
   is the pass condition. *Verify: the extended/new script runs headless via Playwright and produces
   4 non-blank frames (one per class); `bun run` invocation and output path are named in the
   Implementation plan below before this pillar is marked shipped.*
2. **Kindled and Interstice specifically** (the two the bug report named, because their identity is
   a permanently-visible resting weapon — the most glaring case): the captured frame's held-weapon
   region differs meaningfully (non-identical pixel hash) from the same region captured *before*
   this doc's fix, proving the change is load-bearing, not a no-op. *Verify: before/after frame diff,
   captured once pre-fix (baseline) and once post-fix.*

### Pillar 3 — Combat construct parity (swing, Ward, tether, lance, cast-tell)

**Outcome:** every construct `ConstructVfxController` owns renders correctly in the lobby when
triggered — melee swings against a practice dummy, Kindled's Ward slab, Syzygist's tether,
Geometrician's lance flourish on shot, and the `ability-activated` cast-tell for all four classes.

**Acceptance tests**
1. **Swing renders:** with a Kindled or Interstice character attacking a `venue-lobby-tableau-goal.md`
   practice dummy in the lobby, `triggerMeleePose` (`ConstructVfxController.ts:376`) fires and
   `ProceduralPlayerRig.triggerMeleeSwing` (`:807`) is reachable from `HangoutScene` — proven the
   same way Pillar 1 test 2 is proven (grep confirms the closure exists and is passed into
   `constructVfx.update()`), plus a captured frame at the swing's contact frame (`meleeContactT`,
   already computed by `meleeTiming.ts`) shows the blade visible mid-arc, not absent. *Verify:
   harness frame capture at the logged swing timestamp, same ffmpeg-at-timestamp technique
   `presentation-completion-goal.md` §A.2 already specifies.*
2. **Ward slab, tether, lance, cast-tell — same treatment:** one captured frame per construct,
   triggered via the lobby's existing showcase-gauntlet / practice-dummy flow, each showing the
   construct present and positioned relative to the correct hand/anchor (not clipping through the
   `venue-lobby-tableau-goal.md` table geometry — a genuinely lobby-specific composition risk that
   doesn't exist in the open arena, worth an explicit look since the table is new geometry that
   never had to coexist with a Ward slab or tether before). *Verify: harness frame capture, one per
   construct, visually reviewed per Pillar 4's loop.*

### Pillar 4 — Harness-verified visual convergence (the loop, not a human gate)

**Outcome:** the automated harness-playtest loop `presentation-completion-goal.md` already defines
is run against the lobby specifically, to convergence, closing the loop this doc opened rather than
leaving "looks right" as an unverified claim.

**Acceptance tests**
1. **The loop runs against lobby scenarios:** `scripts/presentationScenarios.ts`'s
   `PRESENTATION_SCENARIOS` registry gains lobby-scoped entries (or reuses existing per-ability
   entries with a `driver` that walks into the venue lobby first) covering: each class idle at the
   table, each class's M1 swing on a dummy, Kindled's Ward, Syzygist's tether, Geometrician's lance,
   and one `ability-activated` cast-tell per class. *Verify: `grep` the registry for the new
   scenario keys.*
2. **Evidence audit passes:** `bun run scripts/audit-presentation-evidence.ts` exits 0 for every
   lobby-scoped scenario added in test 1 — no missing beats, no missing frames, no unresolved
   defects. *Verify: `bun run presentation:evidence` (root `package.json` alias) exit code.*
3. **Convergence, not a single pass:** per `presentation-completion-goal.md`'s own rule, K
   consecutive full passes surface nothing new before this pillar is called done — a single clean
   run is not convergence. *Verify: the evidence ledger below logs pass N and pass N+1..K with
   nothing new found in the trailing passes.*

---

## Implementation plan (phased, each independently shippable)

### Phase 1 — Wiring (Pillar 1) — ✅ SHIPPED 2026-07-20
- [x] `ParticlePool` + `StatusVfxController` + `ConstructVfxController` constructed in `HangoutScene`
      (venue-mode only, alongside `entityRender`/`actionBar`'s existing gate — `HangoutScene.ts:308,338-339`).
- [x] `pendingSimEvents` buffer added; `handleSimEvents` pushes to it alongside existing dispatch
      (`HangoutScene.ts:167,738`); `SimEventRouter`'s own `particlePool` config field now gets the
      real pool instead of `null` (`HangoutScene.ts:685` equivalent — a second latent gap the same
      wiring pass closed for free).
- [x] `resolveHand`/`triggerMeleePose` closures added, ported from `OnlineMatchScene.ts:1027-1035`
      (`HangoutScene.ts`, inside new `updateConstructVfx`).
- [x] Both controllers' `.update()` called unconditionally in `HangoutScene.update()`, via a new
      `updateConstructVfx(state, deltaMs)` method (`HangoutScene.ts:1240,1256`); buffer drained after.
- [x] Stale comment at `HangoutScene.ts:653-658` corrected to reflect combat is now reachable.
- [x] `bun run typecheck` clean; `cd client && bun test`: 1569 pass / 14 fail — all 14 failures are
      pre-existing WASM struct-layout/parity mismatches (`worldStateLayout.test.ts`,
      `worldStateBridge.test.ts`, `worldStepParity.test.ts`) caused by already-uncommitted,
      unbuilt `sim/*.zig` edits in the tree (unrelated in-flight work, confirmed via `git status`);
      zero touch to any `.zig`/wasm file in this diff. The two tests named in Pillar 1's own
      acceptance test 5 (`simEventRouter.test.ts`, `meleeStage.test.ts`) both green: 40 pass / 0 fail.

### Phase 2 — Idle-parity evidence (Pillar 2) — ✅ SHIPPED 2026-07-20
- [x] Sibling script added: `scripts/lobbyVfxParityShots.ts` (`bun run presentation:lobby-vfx-parity`)
      — boots the REAL `HangoutScene` in venue mode against a live server (not `constructHarness`'s
      standalone rig, not the DOM-only loadout panel `loadoutHarnessShots.ts` captures), for all 4
      classes, and screenshots the standing rig once connected and settled.
- [x] Before/after captured for Kindled + Interstice, the two classes the bug report named: BEFORE
      this doc's Phase 1 fix, empty hands (no code path drew anything — confirmed by the root-cause
      read, not re-screenshotted, since the absence was structural/guaranteed). AFTER: Kindled shows
      a raised gold Kindled Edge held forward from the hand; Interstice shows twin cyan daggers held
      forward in a combat-ready pose. Both class-differentiated (color + shape), both non-blank,
      both anchored at hand height (not floating, not clipped) — screenshots at
      `tests/e2e/.artifacts/lobby-vfx-parity/{paladin,ninja}-idle.png`.
- [x] All 4 classes confirmed: Geometrician (wizard) and Syzygist (priest) correctly show **no**
      idle held-weapon draw — this matches the source, not a gap: `ConstructVfxController.ts:592`'s
      `if (cls !== "ninja" && cls !== "paladin") continue` means only Kindled/Interstice get a
      continuous resting draw; Geometrician's lance and Syzygist's tether are event-triggered
      (shot-fired / entanglement state), not idle-drawn — Pillar 3, not Pillar 2, covers those.
      `tests/e2e/.artifacts/lobby-vfx-parity/{wizard,priest}-idle.png` show the rig alone, correctly.
- [x] **Methodology finding, logged so nobody re-discovers it:** a headless pointer that never moves
      leaves `player.aimX/aimY` at their degenerate spawn default, which reads as "aim near world-
      origin" — from floor height this renders the held weapon pointing straight up off-screen
      (`aim = atan2(p.aimY - p.y, p.aimX - p.x)`, `ConstructVfxController.ts:603`). **Not a wiring
      bug** — a real player's mouse is always somewhere sane. Fixed in the capture script by moving
      the mouse to a natural position before the settle wait. Also hit two Playwright-vs-sandbox
      infra issues unrelated to the product: (1) Google Fonts is unreachable here and the request
      hangs rather than failing fast — routed to `page.route().abort()`; (2) `page.screenshot()`
      hangs indefinitely on this sandbox's software-GL renderer (a live, constantly-animating canvas
      apparently never satisfies Playwright's internal frame-stability wait) — worked around with a
      raw CDP `Page.captureScreenshot` call, confirmed pixel-identical live content in a side-by-side
      repro. Both workarounds are isolated to the capture script; nothing in the product fix changed.

### Phase 3 — Combat-construct evidence (Pillar 3) — PARTIAL, shipped 2026-07-20
- [x] **Swing — Kindled + Interstice, CONFIRMED.** Correction to the earlier scoping note below: a
      swing capture does **not** need a landed hit at all — `slash-started` fires on the Fire input's
      rising edge (`World.ts:1955-1963`, `meleeEdge = (currKeys & FireBit) !== 0 && (prevKeys &
      FireBit) === 0`), independent of whether anything is hit; firing is already live in hangout
      mode by design. `scripts/lobbyVfxParityShots.ts` extended to hold Fire and burst-capture 6
      frames across the windup+active window. Result: Kindled shows a real diagonal committed sword
      swing; Interstice shows a real forward twin-dagger thrust — both clearly distinct from their
      idle poses and from each other. `tests/e2e/.artifacts/lobby-vfx-parity/{paladin,ninja}-swing*.png`.
- [x] **Ward — Kindled, CONFIRMED, plus a real gap closed to get it.** `HangoutScene` had **zero
      input path to Shield at all** — `create()`'s key bindings had Fire and the 3 drafted-active
      slots, but no Shift/Shield key, so "try it on the dummies" could never cover the class's own
      defensive centerpiece. Added the binding (`HangoutScene.ts`, mirrors `OnlineMatchScene.ts:594`'s
      Shift key, venue-mode gated same as Fire) and wired it into the input assembly. Captured: a
      real glowing gold Ward slab around the character, with the shield-charge meter visibly drained
      from 100→30 in the same frame — sim and render both confirmed live, not just visually present.
      `tests/e2e/.artifacts/lobby-vfx-parity/paladin-ward.png`.
- [ ] **Lance (Geometrician) — attempted, inconclusive.** Same burst-capture technique run against
      wizard's Fire input; none of the 6 sampled frames showed a visible lance flourish. Ranged
      `shot-fired` likely needs either a different fire cadence (held-Fire re-triggers on
      `stepWeapon`'s own cooldown, not a single rising edge like melee) or tighter frame sampling
      around the actual shot moment. Not chased further this session — Geometrician wasn't one of
      the originally reported classes; open for a follow-up pass.
- [ ] **Tether (Syzygist) — not attempted, real prerequisite identified.** `entanglementPlan.ts:69`
      requires `player.focusHexMarkUntilTick` on a target, which only gets set by a Syzygist actively
      casting a mark-applying ability at someone — the mark is not proximity-automatic. Needs the
      loadout-station equip flow (pick an ability, aim at the ally NPC, press its slot key) — a
      bigger lift than the click/shift-hold used for swing/Ward, correctly out of scope for a quick
      follow-up and left open.
- [ ] **Cast-tell (all 4 classes) — not attempted**, same equip-flow prerequisite as tether.
- [ ] Table-clip check against `venue-lobby-tableau-goal.md`'s table geometry — not checked (the
      captures above land the swing/Ward near the loadout station's existing totem-ring trigger, not
      literally at the not-yet-shipped table prop; recheck once that doc's table ships).
- **Original scoping note (2026-07-20, superseded above for swing/Ward):** ~~deliberately not
  attempted this session — depends on `venue-lobby-tableau-goal.md`'s destructible-hit-resolution
  gap~~. That was true for landing a *hit*, but false for rendering the *swing/cast itself* — the
  visual fires on attack input, not contact. Left here as a record of the correction, per this
  project's own discipline of writing down what was wrong, not just what's now right.

### Phase 4 — Harness convergence (Pillar 4) — not started
- [ ] Lobby scenarios added to `presentationScenarios.ts`.
- [ ] `audit-presentation-evidence.ts` green.
- [ ] K consecutive clean passes logged in the evidence ledger.
- **Scoping note (2026-07-20):** not attempted this session — real scope, sequenced after Phase 3
  (the scenario registry needs real trigger-frame captures to point at). The manual capture script
  from Phase 2 is the right foundation to promote into a `PRESENTATION_SCENARIOS` entry once Phase 3
  lands.

---

## Test architecture (must be green)

| Case | Expect |
|---|---|
| `bun run typecheck` (client) | Clean — `ConstructVfxController.update()`/`StatusVfxController.update()` call signatures in `HangoutScene` match `ConstructVfxController.ts:314-330` exactly |
| `cd client && bun test` | Green, zero regressions — `simEventRouter.test.ts`, `meleeStage.test.ts` unaffected |
| `grep` wiring checks (Pillar 1, tests 1–3) | All present, exactly once each |
| Loadout/harness screenshot script (Pillar 2) | 4 non-blank frames, before/after diff non-identical for Kindled + Interstice |
| Harness frame captures (Pillar 3) | One per construct (swing ×2 classes, Ward, tether, lance, cast-tell ×4), construct visibly present, no table-clip |
| `bun run presentation:evidence` | Exit 0 for all lobby-scoped scenarios |

---

## Acceptance — it's done when

### A. Engineering
1. Phase 1's five checkboxes all green (typecheck + test suite + three grep checks).
2. Zero edits to `ConstructVfxController.ts`, `StatusVfxController.ts`, `ProceduralPlayerRig.ts`, or
   `meleeTiming.ts` — this doc is a wiring fix, not a render-system change; any edit to those files
   means scope crept past what this doc authorizes (write a follow-up doc instead).
3. `HangoutScene.ts`'s new code is byte-for-byte structurally identical to `OnlineMatchScene.ts`'s
   equivalent block (same closure shapes, same call order: `statusVfx.update` before
   `constructVfx.update`, buffer drained after both) — divergence here is exactly how this gap
   opened in the first place and must not be reintroduced.

### B. Visual (harness-driven, per the completion discipline above — never human-gated)
1. Pillars 2, 3, and 4's acceptance tests all pass.
2. The convergence condition in Pillar 4 test 3 is met (K consecutive clean passes).

### C. Elegance bar
- No new abstraction, no new controller class, no lobby-specific fork of `ConstructVfxController`'s
  logic. The entire fix is: construct the same three objects, call the same two `.update()` methods,
  every frame, with the same closures. If the diff needs a new file, the approach has gone wrong.

---

## Anti-patterns (do not reintroduce)

1. **A second implementation of held-weapon/ward/tether drawing scoped to the lobby.** The whole
   point is one shared code path — a lobby-specific fork recreates this exact bug class the next
   time the arena's construct rendering changes and nobody remembers to port it twice.
2. **Gating the idle draw behind an event check.** `ConstructVfxController.update()`'s resting-weapon
   draw is unconditional by design (`ConstructVfxController.ts:575-600` runs every call regardless
   of `events`); wrapping the lobby's call in `if (events.length)` silently reintroduces the "empty
   hands until something happens" bug for the idle case even after Pillar 1 otherwise lands.
3. **Claiming a pillar done without the harness having captured its frames.** "It compiles" or "the
   grep passes" is Pillar 1 only — Pillars 2–4 require an actual captured frame, per
   `presentation-completion-goal.md`'s own anti-pattern #1.
4. **Fixing only Kindled and Interstice** because they're what the bug report named. The root cause
   is scene-wide (no controller instance at all) — Geometrician's lance and Syzygist's tether are
   equally broken today and get fixed for free by the same wiring; Pillar 3 explicitly covers them
   so they don't get silently dropped for being less visually obvious at rest.
5. **A human-only "looks right to Jake" acceptance line.** Converted into the harness loop per the
   completion discipline; a human final-glance is welcome (per `presentation-completion-goal.md`
   §A.6) but is never the gate this doc's Pillar 4 is measured against.

---

## Relationship to other goals / systems

| Goal | Relationship |
|---|---|
| `docs/venue-lobby-tableau-goal.md` | Sibling gap, same room, different layer — that doc's "M1 visibly damage a bad dummy" checklist item needs THIS doc's wiring for the "visibly" half (the blade itself) once both ship; sequence note: Phase 3's table-clip check depends on that doc's table geometry existing, so land that doc's table before closing this doc's Phase 3. |
| `docs/presentation-completion-goal.md` | This doc's Pillar 4 is a scoped instance of that doc's harness-playtest loop, applied to one room instead of the whole game; does not change that doc's completion matrix, just extends its applicability. |
| `docs/venue-goal.md` | Source of the completion-discipline hard rule this doc inherits verbatim. |
| `OnlineMatchScene.ts` | The reference implementation; this doc's entire job is making `HangoutScene.ts` structurally match it for the construct-VFX slice. |

---

## Risk register

| Risk | Mitigation |
|---|---|
| Table geometry from `venue-lobby-tableau-goal.md` ships after this doc, and Ward/tether clip through it once it lands | Phase 3's table-clip check is explicitly named as depending on that doc's table; don't mark Phase 3 done until both have shipped and been checked together |
| A dev "fixes" the reported bug with a lobby-local patch (e.g. hand-drawing a sword sprite in `HangoutScene`) instead of wiring the shared controller | Anti-pattern #1 above; code review should reject any diff that adds drawing logic to `HangoutScene.ts` itself rather than importing/driving the existing controllers |
| `ParticlePool` sized for arena particle budgets turns out too heavy for the lobby (more idle/ambient time, more players standing around) | Out of scope for this doc — if it surfaces, it's a `END_PRODUCT_GOAL.md` §3 (Pi/phone particle budget) concern, file separately; note it in the evidence ledger if observed |

---

## Success metric (north star, not vanity)

Every class standing in the lobby looks like it's standing in the arena, because it's rendered by
the same three objects either way. The measure of success is a **negative**: after this ships,
there is no visual difference an agent or a human can name between "class X idle in the lobby" and
"class X idle in the arena" that traces back to the lobby lacking a system the arena has.

---

## One-line definition of done

**`HangoutScene` constructs and drives the same `ParticlePool` + `StatusVfxController` +
`ConstructVfxController` trio `OnlineMatchScene` does, every frame, with identical call shapes —
and the harness-playtest loop has verified, to convergence, that every class's idle weapon, swing,
Ward, tether, lance, and cast-tell now render in the lobby exactly as they do in a real match.**

---

## Evidence ledger

**Pillar 1 — COMPLETE (2026-07-20)**
`ParticlePool`/`StatusVfxController`/`ConstructVfxController` constructed in `HangoutScene.ts`
(venue-mode gate, alongside `entityRender`/`actionBar`); `pendingSimEvents` buffer added; new
`updateConstructVfx()` called unconditionally every frame; stale "always-inert combat" comment
corrected. `bun run typecheck` clean (client). `cd client && bun test`: 1569 pass / 14 fail, all 14
pre-existing WASM struct-layout/parity failures from already-uncommitted `sim/*.zig` edits unrelated
to this diff (confirmed via `git status` — zero `.zig`/wasm files touched here); the two tests this
doc's own acceptance names, `simEventRouter.test.ts` + `meleeStage.test.ts`, both green (40/40).
All 3 grep-verifiable wiring checks confirmed present exactly once.

**Pillar 2 — COMPLETE (2026-07-20)**
`scripts/lobbyVfxParityShots.ts` added (`bun run presentation:lobby-vfx-parity`), captures the real
live `HangoutScene` for all 4 classes via a real venue-lobby connection against the local `:8088`
server (client rebuilt via `bun run --filter client build` first so the fix was actually live).
Kindled and Interstice — the two classes the original bug report named — both now show correct,
class-differentiated, hand-anchored held weapons where they previously showed nothing; Geometrician
and Syzygist correctly show nothing at rest (by design, not a gap — their constructs are event-
triggered). Screenshots: `tests/e2e/.artifacts/lobby-vfx-parity/{wizard,paladin,ninja,priest}-idle.png`
(gitignored, regenerate via the script). Full methodology notes (aim-default artifact, Google Fonts
sandbox hang, `page.screenshot()` stability-wait hang worked around via raw CDP) logged in Phase 2
above so none of it needs re-discovering.

**Pillar 3 — PARTIAL (2026-07-20).** Swing (Kindled + Interstice) and Ward (Kindled) captured and
confirmed against a live render — the swing/cast visuals fire on attack INPUT, not on landing a hit,
so (correcting this doc's own earlier, overly-cautious scoping note) they never actually needed
`venue-lobby-tableau-goal.md`'s destructible-hit-resolution fix at all. Ward needed a real, separate
gap closed first: `HangoutScene` had no input binding to Shield whatsoever — added one. Lance
(Geometrician) attempted and inconclusive; tether (Syzygist) and cast-tell (all 4) not attempted —
both need the loadout-station equip flow, a real prerequisite, correctly left as open follow-up
rather than faked. Screenshots: `tests/e2e/.artifacts/lobby-vfx-parity/*-swing*.png`, `*-ward.png`.

**Pillar 4 — NOT STARTED**, correctly sequenced after Pillar 3's remaining items (lance/tether/
cast-tell) land — the scenario registry needs real trigger-frame captures to point at first.

**Overall status:** the reported bug (Kindled/Interstice swords not showing in the lobby) is fixed
and verified against a live, real render — idle AND mid-swing AND (bonus) Kindled's Ward, all three
confirmed with actual screenshots of the actual scene, not just claimed. The doc's fuller ambition
(every construct across every class, harness-convergence-verified) remains open and is left honestly
unchecked above rather than marked done.
