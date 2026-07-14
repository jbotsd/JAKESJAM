# JAKESJAM remediation — 2026-07-14 overnight run, completion summary

Companion to `docs/REMEDIATION-PLAN-2026-07-14.md` (that doc lives on a
separate small branch, `docs/overnight-remediation-plan-2026-07-14`, off
`main` in the live checkout — not merged, not pushed anywhere). This
summary lives on the actual work branches instead, so it travels with
the diffs it describes.

Executed live, in-session, in an isolated `git worktree`
(`../JAKESJAM-tierA`) branched off `main` — never touched the live
checkout (which has a production server running from it on :8088) or
Jake's own uncommitted WIP there. Cross-checked the live checkout's
`git status` repeatedly throughout and routed around every file under
active concurrent edit (Jake was live-iterating on Vessel Creator kill-fx
in `client/src/game/render/` and `rendering/ProceduralPlayerRig.ts`,
plus `main.ts` / `server/src/index.ts` / `vercel.json`).

## Branches produced (local only — nothing pushed anywhere)

- **`tierA/remediation-2026-07-14`** — 5 commits, all green across
  `client bun test` (830/0 fail), `client tsc --noEmit`, `server tsc
  --noEmit`, `server bun test` (169/0 fail), `sim zig build` + `zig
  build test`. Safe to merge as-is.
- **`tierB/accumulator-tickloop-2026-07-14`** — branches off tierA,
  adds one more commit (the fixed-timestep accumulator loop). Passes
  the same automated gates but explicitly needs a live multi-client
  playtest before merging — see that commit's message for why.

## What actually landed on tierA

1. Deleted confirmed-dead code: the `boxworks.ts` "legacy exports"
   block (7 symbols), the orphaned `client/src/game/data/maps.ts` file,
   `sim/src/types.zig`. Two near-misses caught by tests/tsc and fixed
   properly instead of blindly reverted: `envelopeSubjects` in
   `actionCameraMath.ts` and `GEN_PREVIEW_MAP` in `sim/data/maps.ts`
   both turned out to have live internal callers the original audit's
   "zero importers" grep missed (it only checked external files) —
   kept as a private helper / switched the caller to the real accessor,
   respectively.
2. Removed 8 leftover debug `console.log`s from the clips pipeline.
   Explicitly did NOT touch the 2 that looked identical but are
   actually tagged instrumentation for an active, still-open
   "camera-skew investigation" spanning 3 files — verified via grep
   before touching anything in that area.
3. Fixed two rotted docs: `sim/src/data/README.md` (described 3 files
   that don't exist), `sim/README.md`'s phase table (said "pending" for
   a phase that's actually shipped, just opt-in-off-by-default).
4. Added mobile haptics (`navigator.vibrate`) on local hit + local kill,
   per `docs/mobile-experience.md`'s "not yet" list. Checked practice
   mode (`MatchScene.ts`) for the same hook points — doesn't have them,
   left it alone rather than inventing scope.
5. `convex/matchmaker.ts`: the "3 hardcoded regions" framing was
   already stale (only `sin` is in the array now) — added a log line
   for the one real remaining gap, a silent region-fallback.
6. Fixed `renderContract.ts`'s `null as unknown as DestructibleEntity`
   type-lie to be honestly nullable, after confirming it wasn't
   actually a live bug (the one real caller already respects the
   returned count) — hardens against a *future* misuse instead.

## What turned out to already be done — verified, not touched

- **Player-identity tab collision**: already fixed. `LobbyController.ts`
  uses `sessionStorage`, not `localStorage`, specifically so tabs don't
  collide — confirmed by its own comment.
- **Server input validation / anti-cheat**: already far more mature
  than `docs/perf-blockers.md` (stale) suggested — dt clamping, tick-
  window validation, keys-bitmask stripping, queue-depth bounds, and
  rate-limited warn logging all already exist in `matchHost.ts`'s
  `applyInput`.
- **refactor-followups.md D1** (copy-on-write for
  `state.projectiles`/`state.satellites`): projectiles already migrated
  to a real `CowRecord` class (its own file + test suite). Satellites
  were left on the plain eager-spread pattern — but the code comment
  right there explains why: `stepSatellites` always returns a freshly
  allocated record regardless, so CoW would save zero allocations.
  Not incomplete — a correct, already-reasoned decision. D1 is done.
- **refactor-followups.md E1** (RenderHost → MatchSession rename):
  moot. `RenderHost` doesn't exist anywhere in the current codebase —
  the doc predates a restructure of `client/src/net/`.
- **`sim/src/root.zig`'s no-op `step` export**: not dead — it's the
  deliberate target of `sim/test/smoke.zig`'s boot-sanity test. Left
  alone.

## Deferred — active concurrent-edit conflict risk (not attempted)

Files under live edit by Jake for the whole session:
`client/src/game/render/` (whole folder), `ProceduralPlayerRig.ts`,
`client/src/main.ts`, `server/src/index.ts`, `vercel.json`. Anything
touching these was skipped to avoid colliding with his in-progress work:

- render/ + rendering/ folder merge
- "legacy room flow" → "private room flow" comment rename (needs
  `server/src/index.ts`) — also worth noting this turned out to be a
  real *naming* problem, not dead code: `/ws` is the live Private Room
  mode, distinct from the public Hot Lobby (`/ws/world`). Don't delete
  it when you do get to this, just rename the comments.
- `/metrics` observability endpoint (also needs `index.ts`)

## Downgraded from Tier A to Tier B after reading the actual code

- **Accumulator tick loop**: `matchHost.ts`'s `tick()` is dense,
  gameplay-critical code with comments documenting subtle historical
  netcode bugs. Existing unit tests call `tick()` directly, never
  through the real timer, so green tests don't exercise the new
  accumulator path. Built it, verified `tick()` is fully synchronous
  (safe for a catch-up burst), sat it on its own branch pending a live
  playtest.

  **Update — live-playtested 2026-07-14, ~18:00.** Stood up an
  isolated server on :8089 (this branch's code, `WORLD_BOTS=0`,
  separate from the real :8088 process) to run the automated two-bot
  Playwright multiplayer spec against it. That spec failed — but on
  inspection the failure was the test fixture (`?world=1` doesn't
  match the actual client entry flow anymore, which routes through
  the Home → "HOT LOBBY" button), not the server. Confirmed this isn't
  a tierB regression by running the identical spec against a tierA
  control build (no accumulator change) — same failure there too, so
  it's a pre-existing test/product drift, unrelated to this change and
  out of scope for this remediation pass.

  Jake then played the actual :8089 server directly (2 OBS recordings,
  ~65s combined): joined Hot Lobby, played through a full countdown →
  fighting → round-over → drafting cycle (Blink Dash / Cluster Bomb /
  Stolen Fangs offered), picked an upgrade, round 2 started clean with
  the score correctly carried over, paused/resumed mid-session with no
  issues. Server log for that session: 156 lines, zero
  error/warn/exception/fatal/throw entries, clean `SIGTERM` graceful
  shutdown when the test server was torn down afterward. This is real
  evidence under real wall-clock jitter (the exact thing unit tests
  couldn't cover), not just "it typechecks."

  Given that, **this branch is now playtest-cleared** per the safety
  rail that gated it — ready to merge on your say-so, not doing it
  unilaterally since it's still touching the live game's authoritative
  tick loop.

## Corrected from Tier A to "needs Jake directly" after reading the doc

- **8×-throttle multi-death soak** (`SESSION_GOAL_DEATH_TELEMETRY.md`
  Test 4): this needs a real Chrome DevTools session with CPU
  throttling, watching live multi-death gameplay for allocation/hitch
  behavior. Not automatable headlessly — same category as Test 6
  ("AWAITING JAKE"), not a script to run.

## Not attempted this session

- GPU capture driver fix (gsr SIGSEGV): system package upgrade, not a
  code change, needs a real display session to verify the fix actually
  works (not just that the package installed). Out of scope for a
  code-worktree session.
- Skill rating system deletion-vs-build decision, wasm cutover
  finish-vs-abandon decision: both explicitly Tier C in the plan doc,
  correctly not touched.

## To merge

```
git merge tierA/remediation-2026-07-14   # safe, all green, review as one unit or commit-by-commit
# tierB/accumulator-tickloop-2026-07-14 — review separately, playtest first
```
