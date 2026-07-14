# JAKESJAM — Exhaustive Remediation Plan (2026-07-14)

Full solution set for every item in the 2026-07-14 deep-dive audit
(`docs/` planning history + client/server/sim grep sweep). Nothing from that
audit is dropped — every finding below has a concrete next step, even the ones
too design-heavy or playtest-dependent to automate. Items are tiered by how
safe they are to hand to an unsupervised overnight coding agent.

## Ground truth confirmed 2026-07-14 (re-verified before writing this plan)

- **The live production server is running RIGHT NOW from this exact checkout**
  (`bun --cwd server src/index.ts`, PID serving `$PWD/client/dist`, publicly
  reachable at `https://play.elyad.io`). Any automated work MUST happen in an
  isolated `git worktree` in a different directory — never edit files in this
  checkout directly, never run `bun run build` or restart the server here.
- **Jake has uncommitted WIP on `main` right now**: `client/src/main.ts`,
  `client/src/game/ui/CardDraftOverlay.ts`, `client/src/style.css`,
  `server/src/index.ts`, `vercel.json`, plus two new untracked files
  (`client/public/privacy.html`, `client/public/terms.html`). A fresh worktree
  won't see these (worktrees don't share uncommitted changes) — that's correct
  and safe, but it means the overnight branch is based on the last **commit**,
  not on Jake's in-progress edits. Do not touch, stash, or commit this WIP.
- **One finding from the original audit was WRONG and is corrected here**: the
  `/ws` "legacy room flow" is not dead — it's the live **Private Room**
  (invite-only) mode, distinct from the public Hot Lobby (`/ws/world`). Both
  are active features. The word "legacy" in the code comments is a naming
  problem, not a sign of dead code. Do not delete it.
- `build:standalone` is a real, wired `package.json` script, not orphaned
  tooling — don't delete without asking Jake if he still wants LAN-only builds.
- All confirmed-dead exports from the original audit (`boxworks.ts` legacy
  set, `envelopeSubjects`, `GEN_PREVIEW_MAP`, `gameConfig`,
  `game/data/maps.ts`) were re-grepped just now and are still zero-importer.
  `OnlineMatchScene.ts` is now 2798 LOC (grew since the audit an hour ago).

## Safety rails for any automated execution of this plan

1. **Isolated worktree only.** `git worktree add ../jakesjam-overnight -b
   overnight/remediation-2026-07-14` (or similar) off current `main` HEAD.
   Never touch the live checkout.
2. **Never run `bun run host:public`, never restart port 8088, never deploy.**
   The deliverable is a branch + a written summary for Jake to review in the
   morning, not a live change.
3. **Verify-before-delete protocol**: before removing ANY export, function, or
   file, re-grep for zero references — including dynamic `import()` calls,
   string-literal path references, and test files — not just static imports.
   If any reference turns up, downgrade that item to "flag only, don't touch"
   and note it in the summary instead of guessing.
4. **Test gate after every change**: `cd client && bun test`, `cd server &&
   bun test`, `cd sim && zig build test` (where applicable) must pass before
   a change is considered done. A failing test reverts that specific change,
   not the whole run.
5. **Determinism discipline** (already well-enforced in this codebase — don't
   regress it): no `Math.random`/`Date.now()`/`Math.hypot` in anything under
   `sim/`; use `lutSin/lutCos/lutAtan2`.
6. **Protected / do-not-touch list** (see below) — these look like bugs but
   are deliberate design decisions. "Fixing" them is itself the bug.

## Protected — deliberate, do NOT "fix" these

- **Ammo/magazine**: `magazineSize` is computed, `ammo: 0` set at spawn,
  never decremented anywhere in TS or Zig. This is intentional — firing is
  cooldown-gated only. Do not implement reload/enforcement.
- **Jetpack ABI fields** (`jetpack_fuel`, `jetpack_active` in `player.zig` /
  wire format): pinned dead values, kept only for wire-layout stability.
  Jetpack itself was removed. Do not resurrect it.
- **Void-element armor no-op** (`client/src/sim/World.ts:1043`): explicitly
  a documented no-op until an `armor` stat is designed. Leave the TODO in
  place — designing the stat is a Tier C item below, not a drive-by fix.
- **Vessel Creator temporary hardcoded demo colors**
  (`OnlineMatchScene.ts:1980-1995`): proves the cosmetics API works ahead of
  the real creator UI. Leave until `docs/vessel-creator-design.md` ships.
- **`cardIcons.ts` fallback icon**: functioning default art, not a bug. Only
  touch this if Jake wants better placeholder art (an art task, not code).

---

## Tier A — safe for full autonomous overnight execution

Mechanical, testable, reversible-in-a-branch. The agent may implement and
commit these fully, gated by the safety rails above.

1. **Delete confirmed-dead exports** (re-verify zero-importer per protocol
   first): `client/src/sim/data/boxworks.ts:430-483` (`seededUnit`,
   `seededRange`, `nudgeBoxOutOfShaft`, `nudgeCircleOutOfShaft`,
   `appendPlatformWithShaftGap`, `addTraversalConnectors`,
   `VERTICAL_SHAFT_WIDTH`); `client/src/game/systems/actionCameraMath.ts:97-110`
   (`envelopeSubjects`); `client/src/sim/data/maps.ts:151-156`
   (`GEN_PREVIEW_MAP` proxy); `client/src/game/GameConfig.ts:80-81`
   (deprecated `gameConfig`); the entire orphaned
   `client/src/game/data/maps.ts` file (196 lines, confirmed zero importers).
2. **`sim/src/types.zig`** — delete; confirmed never imported anywhere.
3. **`sim/src/root.zig`'s no-op `step` export** — re-verify zero callers
   (including any smoke test that boots via it) then delete; superseded by
   `step_world`.
4. **Remove debug `console.log("[clips] ...")` lines** in `ClipRecorder.ts`
   (4) and `OnlineMatchScene.ts` (6) — replace with a real gated debug logger
   or delete outright.
5. **Fix the `renderContract.ts` null-cast sentinel**: change
   `DestructibleRenderModel.entity` to `DestructibleEntity | null` instead of
   `null as unknown as DestructibleEntity`, and update the ~2-3 call sites
   that read `.entity` to null-check. Type-system-only change; tsc + tests
   will catch any miss.
6. **Rename "legacy room flow" → "private room flow"** throughout comments
   in `server/src/index.ts`, `server/src/auth.ts`,
   `server/src/matchRegistry.ts`, `client/src/game/scenes/OnlineMatchScene.ts`,
   `client/src/game/net/PrivateRoomClient.ts`. Comment/naming only, zero
   behavior change.
7. **Fix `sim/src/data/README.md`** to list the actual files
   (`cards_gen.zig`, `chaos.zig`, `map_gen.zig`, `weapons.zig`) and note
   pickups have no Zig file yet. Doc-only.
8. **Fix `sim/README.md`'s phase table** — Phase I (`step_world`) is shipped
   (opt-in, off by default), not "pending." Doc-only.
9. **Merge `client/src/game/render/` and `client/src/game/rendering/`** into
   one folder — move `BakedPlayerRig.ts`, `ProceduralPlayerRig.ts`,
   `spring.ts` into `render/`, update all import paths. tsc will fail loudly
   on any missed import.
10. **Matchmaker region fallback**: `convex/matchmaker.ts` currently falls
    back silently to `sin` region with no signal when an undeployed region is
    requested. Add an explicit health-check-or-known-deployed-set guard plus
    a log/telemetry event on fallback. Doesn't require deploying new regions.
11. **Player-identity tab collision**: `crypto.randomUUID()` stored in
    `localStorage` means two tabs on one machine collide as the same player.
    Switch the per-session identity key to `sessionStorage` (or add a tab
    nonce) so tabs stop colliding. Small, mechanical, testable.
12. **Server tick loop**: replace the drift-prone `setInterval` in
    `matchHost.ts` with an accumulator-based fixed-step loop. Well-known
    pattern; validate against existing sim determinism tests.
13. **Add a basic `/metrics` endpoint** to `server/src/index.ts` (active
    match count, connected player count, tick duration histogram). Additive,
    no behavior change to existing routes.
14. **Basic server-side input sanity checks** in `matchHost.ts` input
    ingestion (clamp `dt`, reject impossible fire-rate/teleport deltas) —
    conservative thresholds only, must not reject legitimate input; needs a
    test proving normal play isn't affected.
15. **Mobile haptics**: add `navigator.vibrate()` calls on hit/kill events
    (iOS silently ignores it, Android gets it) per `docs/mobile-experience.md`
    — small additive, mechanical, testable in isolation.
16. **Run the existing 8×-throttle multi-death allocation soak test**
    referenced in `docs/SESSION_GOAL_DEATH_TELEMETRY.md` (Test 4) — the
    tooling already exists, it just hasn't been executed. Capture the
    evidence output into the run's summary. This is verification, not new
    code — zero risk.
17. **`refactor-followups.md` D1** (copy-on-write wrapper for
    `state.projectiles`/`state.satellites` instead of full spread-clone per
    tick) and **E1** (`RenderHost` → `MatchSession` rename + write the
    missing `docs/adr/0001-renderhost-stays.md`) — both fully specified in
    the existing doc; implement per that spec, gated by the sim determinism
    test suite (D1 is flagged "medium determinism risk" by the doc itself —
    respect that, don't skip the extra parity test it calls for).
18. **GPU capture driver bug** (`docs/RENDER_OVERHAUL_PLAN.md` Phase 3):
    `gpu-screen-recorder` 5.13.9 SIGSEGVs on EGL init against nvidia-open
    610.43.02 + Hyprland. Try upgrading to gsr 5.14.x first; if that doesn't
    resolve it, wire the `wf-recorder` fallback path. This is local system
    tooling, not game code — no live-game risk, easily reverted
    (uninstall/downgrade the package) if it goes wrong.

## Tier B — scaffold overnight, do NOT merge without Jake's review

Mechanically doable but touches gameplay-critical or subtle-desync-risk
surfaces where passing unit tests don't guarantee correctness. The agent
should build these on a clearly separate branch/commit range and flag them
explicitly in the morning summary — not fold them into the Tier A branch.

1. **`refactor-followups.md` E3** (`ClientLoop` split into `TickDriver` /
   `SnapshotApplier` / `ConnectionDriver`) — E3a/E3c are lower-risk splits,
   fine to scaffold fully; **E3b (the reconciliation keystone) is explicitly
   the doc's own highest-risk item** — build it, add the byte-equality unit
   test the doc calls for, but do not merge without a `?fakelag=120` manual
   playtest, which the agent cannot do.
2. **`refactor-followups.md` E4** (`MatchSceneBase` unification of
   `MatchScene.ts` / `OnlineMatchScene.ts`, currently 791 / 2798 LOC with
   hand-synced duplicate `renderArena()`/`updateEnvironmentReactivity()`
   logic) — the doc itself says "don't merge on a Friday." Scaffold the
   unified base class and port both scenes onto it on a dedicated branch;
   this is the single highest-value structural fix in the whole audit, but
   it needs Jake's eyes on an actual play session before landing, since
   subtle render/behavior drift between the two scenes won't necessarily
   show up in unit tests.
3. **Skill rating system** (`server/src/skillRatingTypes.ts`) — fully
   scaffolded, zero call sites, gated off by default. Two real options exist:
   (a) delete the dead scaffolding until ranked play is actually wanted, or
   (b) wire it up for real (needs `convex/ratings.ts` to be written, which
   doesn't exist yet — that part is Tier C, not overnight-safe). The agent
   should prepare the **deletion** branch only (safe, reversible) and present
   both options in the summary; don't attempt to build the Convex adaptor.
4. **Wasm/Zig "abandon the dormant orchestration" branch**: see the Tier C
   master decision below. If Jake decides to abandon the full-`step_world`
   cutover rather than finish it, this is what that cleanup looks like:
   remove the unused-in-production seams (`setStepWeaponBackend`,
   `setStepSatellitesBackend`, `step_projectile` v1 and its one parity test)
   and the dead `serverWasmHost` fallback path in `matchHost.ts`. The agent
   should prepare this as a separate, clearly-labeled branch — **do not
   merge it**, since it forecloses the alternative (finishing the cutover)
   and that's Jake's call, not an autonomous one.

## Tier C — needs Jake's design taste and/or live human playtesting

Full solutions are written out below so nothing is missing from the plan, but
none of this should be touched by an unsupervised overnight agent — attempting
it without a human in the loop is how you get a "beautiful and gnostic"-eyeball
feature nobody actually likes, or a netcode change that passes CI and desyncs
in real play anyway.

1. **The master decision: finish or abandon the full-Zig `step_world`
   cutover.** This gates several other items (round.zig drafting phase,
   H8c-e card/map/pickup data tables, pickup buff/respawn porting). The
   codebase's own guard comment (`matchHost.ts:69`) says not to re-enable it
   "without real, extensive human playtesting" — so the solution is exactly
   that: schedule a dedicated live session (2+ players, 30+ minutes) with
   `USE_WASM_STEP_WORLD=1` in a **non-production** environment first. If it
   holds up, follow `docs/zig-wasm-conversion-status.md`'s own remaining
   checklist (H8c-e data tables → I4 input drain → J1-J4 production cutover
   → K1-K4 TS shim deletion → L/M decommission). If it doesn't hold up,
   execute the Tier B "abandon" branch instead. Either way, this is a
   go/no-go Jake has to make after playing it, not something to guess at.
2. **Escalation Engine / universal draft policy**
   (`docs/escalation-engine-goal.md`) — the doc's own 5-phase plan is
   already the solution; Phase 3 explicitly requires a 5-stacked-round
   balance playtest before the "non-skippable live gate" in Phase 4. Execute
   the doc's phases in order, in a session where Jake actually plays it.
3. **Wall-slide/wall-jump controller** (`docs/character-controller-overhaul.md`)
   — resolve the doc's own open question first (keep jetpack as a hybrid vs.
   retire it, which cascades into bot AI + map rework), then follow its
   Phase 1 plan. This is a feel decision only Jake can make by playing it.
4. **Movement/shield augment cards** (`docs/movement-shield-augments.md`) —
   natural follow-on once the wall-jump work (above) stabilizes the movement
   ABI; batch as one `MovementAugments` param block per the doc's own
   recommendation.
5. **Render overhaul Phases 1, 2, 4, 5** (`docs/RENDER_OVERHAUL_PLAN.md`) —
   quality-governor settings UI, texture-first retained renderer (the "big
   one"), phone client, headless replay renderer. Follow the doc's existing
   phase plan; Phase 2 in particular needs Jake's eyeball on rig-bake
   identity preservation before it ships (the doc names this risk itself).
6. **UI shell overhaul** (`docs/ui-shell-goal.md`) — the doc's own unchecked
   Product + Engineering acceptance checklists are the solution; this is
   product/UX judgment work (single front door, HOME CTA, death-tip
   copy/tone) that needs Jake's product taste, not an autonomous pass.
7. **Mobile dedicated jump button** — per `docs/mobile-experience.md`,
   explicitly contingent on playtest signal showing up-tilt-to-jump is
   unintuitive. Don't add it speculatively; wait for the signal, then it's a
   Tier A-sized change.
8. **Standalone build tooling** (`tools/build-standalone.mjs`,
   `standalone/*.html`) — not actually dead (it's a wired script), but
   `docs/perf-blockers.md` suggests deleting it unless LAN-without-internet
   builds are still wanted. This is a five-second yes/no from Jake, not a
   design task — flagging here only because it needs his answer, not because
   it's hard.
9. **Void-element armor stat design** — the `World.ts:1043` no-op needs an
   actual `armor` stat design (value range, which cards grant it, UI
   surfacing) before the TODO can be resolved for real.
10. **"Jake's subjective eye-test"** (`docs/SESSION_GOAL_DEATH_TELEMETRY.md`
    Test 6) — literally requires Jake watching it and deciding if it's
    "beautiful and gnostic." No solution exists that isn't Jake playing it.

---

## What the overnight run should produce by morning

- One branch (`overnight/remediation-2026-07-14`) with all Tier A work
  committed in small, individually-revertable commits, each passing the full
  test gate.
- A separate, clearly-labeled branch for each Tier B item (not merged into
  the Tier A branch), so they're easy to review and diff independently.
- A written summary (this doc, updated in place, or a new dated file) listing:
  what landed, what test output looked like, anything the verify-before-delete
  protocol caused to be skipped (with why), and the two Tier B/C decisions
  that need Jake's yes/no before anything else proceeds (skill-rating
  delete-vs-build, wasm cutover finish-vs-abandon).
- **No changes to the live checkout, no deploy, no server restart.**
