# JAKESJAM Performance Audit (2026-07-18)

*Triggered by: "this map especially lags" (boxworks-tower) → expanded to "for the
whole game" per Jake's direction. Five parallel research passes (client render
loop, sim/collision, server netcode, map density, client memory/GC) plus a
direct mining of a week of real production telemetry (`server/.telemetry/`)
and a status check against the prior `docs/RENDER_OVERHAUL_PLAN.md` (2026-07-10).
Originally a research/planning document (findings only). `/goal fix all
including docs/performance-audit.md every issue iterate upon` (2026-07-18)
turned it into an executed fix pass — see the Fix Ledger at the bottom for
what actually shipped, what was deliberately skipped and why, and how each
fix was verified.*

---

## Part 0 — Real field evidence (not speculation)

`server/.telemetry/events-*.jsonl` holds a full week of `crumb`/`record` perf
signals from real sessions. Aggregated 2026-07-11 → 2026-07-18:

- **834 unique sessions** booted this week.
- **97 sessions (11.6%)** hit `RenderGovernor` at least once (it steps
  `renderScale` down when frame dt sustains above target).
- **89 of those 97 (92%)** were specifically `governor-futile` — the
  governor's own diagnosis that dropping resolution did **not** improve frame
  time, meaning the bottleneck is CPU-bound, not GPU-fill-bound
  (`render/renderGovernor.ts:85-125`). Only 8 sessions ever needed pure
  resolution relief; the overwhelming majority of real-world slowdowns are a
  compute problem, matching every finding below.
- **Severity when it fires**: median dt 32.1ms (≈31fps), p90 51.5ms (≈19fps),
  worst observed 199.6ms (≈5fps, a real freeze-frame).
- **Trend — sharply worsening, not stable**: governor-events as a fraction of
  that day's sessions: 07-11 23.6%, 07-12 2.3%, 07-13 6.4%, 07-14 22.9%,
  07-15 42.6%, 07-16 16.7%, **07-17 74.1%**, **07-18 (today) more governor
  events than boot sessions** (repeated firings within single sessions).
  This correlates tightly with the last two days' feature volume (classes/
  duo-queue, ActionBarSystem active slots + cooldown animator, loadout
  station, six-axes abilities, emission engine) — the regression is real and
  recent, not a longstanding baseline.
- Telemetry carries no `mapId` field, so no direct per-map correlation is
  possible from this data alone — but it proves the CPU-bound diagnosis is
  real and common, which every code-level finding below explains mechanically.

**This changes the framing.** Jake's report wasn't noise from one bad map —
it's the visible tip of a systemic, worsening, CPU-bound cost that governor
telemetry has been quietly recording all week.

---

## Part 1 — Why boxworks-tower specifically lags (the original question)

Three independent, map-specific effects compound on this one map — none of
them are "more platforms" (it's actually the *sparsest* curated map):

1. **The server's AOI/interest-grid optimization is a complete no-op on this
   map.** `InterestGrid.ts:33,39` uses a 5×5 cell neighborhood
   (`OBSERVE_RADIUS_CELLS=2` × `CELL_SIZE_PX=320`) = a **1600×1600px**
   observation window. boxworks-tower is **1440×1080**
   (`sim/data/boxworks-tower.ts:17`) — smaller than the window in both
   dimensions. Every client's per-tick area-of-interest filter therefore
   returns the *entire* entity set, every snapshot, same as no filtering at
   all. On vessel-nexus/skyseam (3000×1100) the same window prunes most of
   the map. **This is the single most concrete, literal explanation for
   "this map especially lags" from the netcode side** — bandwidth and
   per-client encode cost are unfiltered specifically here.
2. **Elastic bots create ~2.1× the population density for the same
   headcount.** `WORLD_BOT_FLOOR` defaults to 4 (`server/src/index.ts:137`,
   capped at 6, `worldHost.ts:140`) regardless of map size. boxworks-tower's
   area is 1,555,200 sq units vs vessel-nexus's 3,300,000 — the same 4-6 bots
   land in less than half the space, roughly doubling simultaneous
   entities-per-view for every other cost below.
3. **The map's own design forces sustained close-range combat.** Its
   bounding diagonal (~1800px) is close to weapon range, so engagements are
   close to constant rather than intermittent (unlike the bigger maps, where
   players spend real time out of range). That raises the average
   *simultaneous in-flight projectile count* — which lands directly on
   finding **S1** below, the one sim subsystem that's both O(N×M) with no
   broadphase AND never got a WASM speedup.

Ruled out explicitly (so this doesn't get re-investigated later):
platform/collision density (boxworks-tower is the *least* dense curated map,
and platform collision is spatially-hashed — `collision.ts:227-390` — so
density wouldn't matter even if it were higher); `mapGen.ts` procedural
generation (bounded, capped, and irrelevant to this specific curated map);
map resolution/caching (every map is parsed once at import and cached
identically — no per-map cost difference here). One non-perf anomaly worth
flagging while we're here: **the map's own header comment still describes
"jetpack fuel is the scarce resource," but the jetpack is fully dead code**
(`player.ts:600-603` unconditionally resets fuel to max every tick for every
player; `mapGen.ts:44-46` confirms it was removed) — stale design-doc drift,
zero performance impact, but worth a copy fix.

---

## Part 2 — Client render-loop findings (CPU-bound, matches 92% of telemetry)

**R1. `ProceduralPlayerRig` full per-frame redraw, no distance/count LOD —
the dominant systemic cost.** `rendering/ProceduralPlayerRig.ts:1262`'s
`draw()` calls `g.clear()` then unconditionally redraws the entire figure
every frame for every visible player: ~100-120 Graphics primitive ops at
`"lite"` detail (remotes/bots), ~150-170 at `"full"` (local player + every
rig in venue-mode HangoutScene) — matching `qualityProfile.ts:160`'s own
documented estimate. **There is no LOD lever at all** — not distance-based,
not player-count-based; the only switch is the binary `full`/`lite` flag.
This is confirmed as the governor's own diagnosed cause
(`qualityProfile.ts:151-166`, the 2026-07-11 incident) and matches the 92%
`governor-futile` telemetry rate exactly.

**R2. The runtime rig-downgrade lever only helps *future* rigs, not the ones
already struggling.** `renderGovernor.ts:112-115` / `qualityProfile.ts:181-183`:
`forceRigDowngrade()` only takes effect on the *next* rig construction
(respawn/match start) — a currently-alive rig pays full "live" cost through
the entire stall it's causing. The self-diagnosis exists; the fix doesn't
apply retroactively.

**R3. Scene-culling gap defeats itself specifically on small maps.** Only
`OnlineMatchScene` culls off-screen rigs at all (`RIG_CULL_MARGIN=220`,
`OnlineMatchScene.ts:2353-2385`). `HangoutScene` gives **every** connected
player `detail:"full"` with **zero culling**, by deliberate design comment
(`HangoutScene.ts:1073-1075`) — the venue lobby is always-on and could hold
many simultaneous visitors. `ReplayScene`/`MatchScene` have no culling either.
And on boxworks-tower specifically, the camera's envelope-fit zoom routinely
keeps most/all 16 spawns inside `worldView` at once in close-quarters
fights — so even `OnlineMatchScene`'s culling delivers near-zero savings on
*this* map, while it would matter a lot on a big sparse one. Small maps get
none of the mitigation and all of the cost.

**R4. `HudSystem`'s roster redraw is a second, fully unculled per-player
cost, redundant with each rig's own nameplate.**
`ui/HudSystem.ts:443-579`'s `updateScoreRows`, called every frame, loops
every roster entry with **zero culling of any kind** (worse than the rig,
which at least culls in one scene): portrait badge (~20 ops) + nameplate
ring (~20 ops) + real `setText()` calls (score/health/countdown strings that
genuinely change, not no-ops) per player, every frame — scaling directly
with total connected players regardless of map size or camera zoom.

**R5. `ActionBarSystem.update()` — full unconditional redraw every frame.**
`ui/ActionBarSystem.ts:358-365`: `g.clear()` + full rebuild of every
slot/orb/ring/beat every frame regardless of whether anything changed —
~150-200 Graphics primitives. Not player-scaled (single local HUD), so it's
a flat tax rather than something that gets worse on this map specifically,
but it's comparable in magnitude to a full player rig and runs
unconditionally at 60fps+.

**Ruled out (confirmed well-optimized, no action needed):**
- `CosmicArenaLayer.ts` — draws its 5 parallax layers **once** at load;
  `update()` only tweaks cached objects' alpha/rotation/scale with
  change-detection (`:191-227`). Zero per-frame Graphics redraws.
- `ParticlePool.ts` — genuinely pools (pre-allocated free-lists, no `new` in
  steady-state `acquire`/`release`); hard-capped, so no runaway CPU cost is
  possible. The only risk on a dense map is silent VFX *drops* under pool
  exhaustion — a fidelity bug, not a perf one.
- `ActionCamera.update()` — once per frame regardless of player count,
  "extras" list pre-capped to 3; not a suspect.
- Combat FX / storm zone / death FX / presence painters
  (`OnlineMatchScene.ts:2133-2199`) — all O(N) in player count, none O(N²);
  they compound with R1/R4 on a full-population map but aren't independently
  pathological.
- Nameplate `setText()` calls — Phaser short-circuits unchanged strings;
  ruled out despite running every frame.

---

## Part 3 — Sim/physics findings

**S1. Naive O(projectiles × players) hit-sweep, zero WASM coverage — the one
hot loop that gets worse specifically on close-range maps.**
`projectile.ts:342-400`: every projectile tests against every alive
non-owner player with no spatial partition (contrast platform collision,
which *is* grid-accelerated — see S3). `wasmRuntime.ts`/`sim/wasm/runtime.ts`
confirm only player-step, static-collision, and RNG got WASM backends in
production; `projectile.ts:184` says outright "today this seam is wired but
unused: production runs the native TS impl." This is exactly the subsystem
that scales with sustained close-range combat density (Part 1, point 3).

**S2. Homing/anti-homing projectiles rescan every alive player every single
tick, with no target caching.** `projectile.ts:296-314` /
`closestNonOwnerPlayer` (`:938-972`): O(homing-projectiles × players) at
60Hz, recomputed from scratch every tick rather than caching the target and
re-picking only periodically or on death/out-of-range. The priciest
per-entity-per-tick cost in the sim once any homing loadout is in play.

**S3. Platform collision is correctly spatially-hashed — ruled out as a
density concern.** `collision.ts:227-390` implements a real spatial hash grid
used by both player movement (`resolveMoveCached`) and projectile-vs-terrain
sweeps; the brute-force fallback was already deleted (`player.ts:373-376`).
Platform count/density genuinely does not matter here, on any map.

**S4. Destructibles/pickups/storm/totems are un-ported pure-TS nested loops
with zero WASM seam at all.** `destructible.ts:103-171` (naive
projectiles×destructibles nested loop), `pickup.ts`, `totem.ts:66-68` — all
100% TS in production, every tick, for every entity, with no swap point ever
installed. Lower absolute priority than S1/S2 for boxworks-tower specifically
(it defines zero destructibles/pickups), but a real portability gap for maps
that do (skyseam has 9 pickups).

**S5. Lag compensator's *core* rewind is cheap and NOT a concern — but see
N-series below for a diagnostic wrapper that is.** `LagCompensator.ts:122-173`
interpolates historical positions from a bounded ≤32-sample ring and shifts
state once per tick, capped at ~15 ticks/250ms lookback — O(players), no
state deep-clone, no per-tick collision replay. This part of the system is
correctly cheap regardless of map.

---

## Part 4 — Server/netcode findings

**N1. An unconditional second full world-step, every tick with any lookback
fire input — a debug-only cost paid by every match, every map, doubling sim
cost during active combat.** `matchHost.ts:1155,1162-1174` →
`logLagCompOutcomeChange` (`:1409-1443`): runs a **full second
`stepWithRuntime`** call plus a `snapshotRuntime()` clone of the runtime
(3 Maps) purely to log whether the lag-compensated outcome differed from a
naive replay — unconditional, not gated behind any env flag, despite the
code's own comment (`:1264-1271`) flagging it as something that "if this
becomes hot we can drop it behind a debug flag." In active combat over any
real network (i.e., almost always, for anyone actually playing) this is
close to **2× the authoritative sim cost, every tick**, independent of map
or player count. **This is the single highest-confidence, safest, easiest
fix in the entire audit** — it's diagnostic instrumentation with an admitted
TODO already sitting in the comment.

**N2. The AOI/interest-grid optimization is defeated specifically on small
maps (see Part 1) — `buildFilteredSnap`/`encodeDelta` become O(clients ×
total-entities) instead of O(clients × nearby-entities) there.**
(Full detail in Part 1, point 1; code at `matchHost.ts:1513-1560,1678-1733`,
`InterestGrid.ts:33,39`.) Notably, **players themselves are never
AOI-filtered at all, on any map** — `matchHost.ts:1670`'s own comment says
"v1: all players included" — so this specific cost is present everywhere,
just invisible on big maps where projectiles/pickups/destructibles still get
pruned.

**N3. `InterestGrid.rebuild` does a full clear-and-rebuild every snapshot,
with one confirmed wasted pass.** `InterestGrid.ts:90-145`: O(entities) full
rebuild 20×/sec (not incremental), and satellites are binned **twice** — an
orbit-angle approximation pass is built then immediately discarded
(`:97-133,137`) before a second owner-position pass replaces it. The first
pass is 100% wasted work every snapshot tick, on every map.

**N4. `WorldBots.think()` — N bots mean N independent, unshared scans, not a
shared pass.** `worldbots.ts:184-210`: each bot recomputes its own
nearest-foe/threat/line-of-sight pass from scratch every tick
(`botArenaNav.ts:102-195`) — O(bots × (players+projectiles+covers)). Cheap in
absolute terms at 4-6 bots, but redundant and would scale poorly if bot
counts ever grew.

**N5. Bot-only matches still pay full replay-serialize + disk-persist +
Convex round-trip when they complete, even with zero humans watching.**
`matchHost.ts:1450-1511`'s `postMatchResult()` fires on `onMatchComplete`
whenever any roster (bots included) hits target score — the always-on
`WorldHost` regularly completes bot-only rounds. `enqueueMatchHighlights` is
correctly gated on human kills (so the expensive headless-render path is
safe), but the serialize+persist+Convex-post cost is not similarly gated.

---

## Part 5 — Client memory / GC pressure findings

**M1. Reconciliation replay bursts a full `structuredClone` of the entire
world state plus N full sim-step replays, exactly when the network has
already hiccuped.** `net/clientLoop.ts:1030-1157`: `cloneState()`
(`:1240-1245`) is `structuredClone(state)` — a full deep clone of every
player/projectile/destructible/pickup/satellite/firePatch — called once per
incoming snapshot, then every queued pending input replays a **full**
`stepWithRuntime` (paying all of M2's allocation cost again) **plus four
extra array allocations that exist purely for a debug log**
(`Object.values`/`Object.keys` calls building `replaySteps`, unconditional in
production). `pendingInputs` has no hard cap — a real lag spike can queue
dozens of ticks. This is the most likely *visible stutter* source in the
whole audit: it's bursty, synchronous, and correlates exactly with the
moment a network hitch has already happened, compounding it into a render
stutter.

**M2. `stepWithRuntime` does two unconditional full-collection shallow
copies every tick, unlike projectiles which correctly use copy-on-write.**
`sim/World.ts:1399` (`nextSatellites = {...(state.satellites ?? {})}`) and
`:4923` (`nextFirePatches = {...state.firePatches}`) both eagerly copy the
whole record every single tick at 60Hz **even when nothing in either
collection changed** — exactly the pattern `CowRecord` (`cowRecord.ts`) was
built to avoid, applied correctly to `projectiles` but never extended to
these two. Steady-state pressure that scales with match duration and
satellite/firePatch activity, on every map.

**M3. `snapshotDelta.ts`'s decode path defeats its own purpose.**
`applyCollectionDelta` (`net/snapshotDelta.ts:497-502`) does a full
`{...base}` shallow copy of **every** entity collection (players,
projectiles, destructibles, firePatches, pickups, satellites) on every
incoming delta snapshot (~20-30Hz), even when the delta touched one field of
one entity. Six full-record copies per snapshot regardless of actual change
size.

**M4. Two per-frame O(N) allocation passes over the same player set, plus a
sort, in `OnlineMatchScene`'s camera-follow path.** `updateClipFocusWorld`
and `followLocalPlayer` (`OnlineMatchScene.ts:2473-2477,2557-2573`) each
independently iterate `Object.entries(state.players)` and push fresh
`{x,y}`/`{x,y,d}` objects into fresh arrays, every frame; `followLocalPlayer`
additionally `.sort()`s and `.slice(0,3).map(...)`s every frame. ~35-40 small
objects/frame at up to 144Hz — real, but the smallest of the memory findings.

**Ruled out (confirmed already fixed since the 2026-07-10 plan, or
inherently fine):**
- The per-rAF `new CustomEvent` allocation flagged in
  `RENDER_OVERHAUL_PLAN.md` — **fixed**; only one `CustomEvent` remains
  in `main.ts` and it's on the rare `MATCH_ENDED` event, not per-frame.
- `ParticlePool` and sibling `*Pool.ts` files — genuinely pool, no
  steady-state allocation.
- `EntityRenderCoordinator.ts`, `ProjectileVfx.ts`, `BakedPlayerRig.ts` — all
  carry comments proving a deliberate scratch-buffer fix already landed
  ("reused so the render loop allocates nothing — the old `new Set()` +
  `Object.entries()` pair churned every frame").
- `ProceduralPlayerRig.ts` — clean of per-frame allocation except one minor,
  low-frequency, explicitly-capped trail-position push; not a real concern.

---

## Part 6 — Status against the 2026-07-10 `RENDER_OVERHAUL_PLAN.md`

Worth stating explicitly so this doesn't re-litigate settled decisions:

**Shipped since that plan:** Phaser 4.1→4.2.1 upgrade; the config flip
(`antialias:true`, `pixelArt:false`, `roundPixels:false`,
`preserveDrawingBuffer:false` — confirmed live in `GameConfig.ts`); DPR-aware
`renderScale` + the full `QualityProfile`/`RenderGovernor` system (Phase 1,
confirmed in this audit); a real baked-rig alternative (`BakedPlayerRig.ts`,
partial Phase 2); the per-rAF `CustomEvent` fix and several scratch-buffer
allocation fixes (partial Phase 0 item 4); the WebCodecs capture pipeline and
the headless replay renderer (Phases 3 and 5 — both shipped **this session**,
see `docs/clip-goal.md`).

**Still open:** the *full* Phase 2 scope (texture-first retained renderer for
projectiles/destructibles/combat-FX, not just the rig) — R1/R4/R5 above are
exactly the remaining cost that phase was scoped to eliminate; Phase 0 item 4
was only partially done — the "gate HUD rebuild on change" half of that item
was never applied to `HudSystem`/`ActionBarSystem` (R4/R5 are that same gap,
still present); Phase 4 (phone client) untouched.

---

## Ranked priority (safety/effort-adjusted, not just raw cost)

1. **N1** — remove or flag-gate the lag-comp diagnostic double-step. Highest
   confidence, lowest risk (it's a debug log), universal benefit, roughly
   halves authoritative sim cost during any real combat on any map.
2. **R1/R2/R3** — the rig-cost cluster: this is the one thing telemetry
   *proves* is the dominant real-world cause (92% of governor fires). Highest
   total impact, but higher effort — this is exactly the Phase 2 work the
   prior plan already scoped.
3. **N2** — widen or adapt the AOI window for maps smaller than it (or shrink
   the window on small maps) so boxworks-tower stops being a literal
   unfiltered broadcast. Directly answers the originating report.
4. **M1** — cap `pendingInputs`/bound reconciliation replay cost, and strip
   the unconditional debug-array allocations from the replay loop. Second
   highest-confidence "safe, cheap, real" fix after N1.
5. **R4/R5, M2, M3** — the remaining unconditional-redraw/uncopy-on-write
   findings; each individually smaller than 1-4 but they all stack on the
   same frames as everything else.
6. **G (population density)** — consider scaling `WORLD_BOT_FLOOR` (or an
   equivalent) by map area rather than a flat constant, so small maps don't
   structurally run ~2× denser than big ones for the same setting.
7. **S1/S2** — WASM coverage for projectile hit-sweep and homing-target
   caching; real but map-dependent (matters most on close-range maps like
   boxworks-tower).
8. Everything else in Parts 3-5 not called out above — real, worth fixing
   opportunistically, none individually urgent.

*Superseded by the Fix Ledger below — this became an executed pass, not a
future plan, on 2026-07-18.*

---

## Fix Ledger (2026-07-18 execution pass)

Every item below was implemented, typechecked (both workspaces), covered by
a new or extended test proving the specific regression it fixes, verified
against the FULL existing suite (no regressions), and — for the two
server-side items — verified live against the running host after a full
restart. Server: 289/289 pass (server test count grew from 267 → 289 as
tests were added). Client: 1482/1482 pass (1443 → 1482). Both workspaces
typecheck clean throughout.

### Shipped

**N1 — lag-comp diagnostic double-step.** `server/src/config.ts` adds
`lagCompDiag` (env `JAKESJAM_LAG_COMP_DIAG`, default off).
`server/src/matchHost.ts`'s `logLagCompOutcomeChange` call + its
`snapshotRuntime` clone are now gated on it. **Caught while wiring the
gate:** the original diff coupled the diagnostic flag to the SAME `if` that
runs `unshiftAfterStep` — the real, authoritative rewind-undo, not a
diagnostic. Left as-is, that would have silently broken lag compensation
for every match by default. Split apart before landing. Test:
`server/src/__tests__/matchHostLagCompDiag.test.ts` — proves the
diagnostic is skipped by default AND that the authoritative unshift always
runs regardless of the flag (the exact regression above).

**M2 — CoW nextSatellites/nextFirePatches.** `client/src/sim/World.ts`:
both used to unconditionally `{ ...state.X }` copy the whole collection
every tick even though `stepSatellites`/`stepFirePatches` always return a
brand-new fully-populated record of their own — the copy was discarded on
every tick regardless of content. Both now default to the SAME reference
(zero allocation) and copy-on-write only at the rare mutation sites that
add an entry before the step consumes it. **Caught while implementing:** a
naive version would have let a later mutation site (chaos fire-hazard
spawn, well downstream of the first copy-on-write site) write into the
still-shared prior-tick object in place — added a `=== ` reference guard at
every mutation site, not just the first. Test:
`client/src/sim/__tests__/worldCowAliasing.test.ts` — drives a real
fire-hazard + orbiting-satellites match and asserts every previous tick's
state object reads back byte-identical after the next tick runs.

**M3 — snapshotDelta full-collection copy.** `client/src/net/snapshotDelta.ts`'s
`applyCollectionDelta` did a full `{ ...base }` shallow copy on every
delta apply even when that collection had zero adds/updates/removals
(destructibles/pickups/satellites, most snapshots). Now returns `base`
directly (same reference) when there's nothing to apply. Tests added to
`client/src/sim/__tests__/snapshotDelta.test.ts`: an untouched collection
comes back by reference; a touched one is still copied, never mutated in
place.

**M1 — reconciliation replay cost.** `client/src/net/clientLoop.ts`: the
reconcile-replay loop built two debug-only arrays
(`replayInputTicks`/`replaySteps`) and re-derived alive/total/hp via
`Object.values`/`Object.keys` on EVERY replayed input, every reconcile —
solely to populate `lastReplayDebug`, a `NetStats` field with zero
consumers anywhere in the client (confirmed via repo-wide grep; the stats
HUD never reads it). Removed entirely, along with the field itself. Also
added a hard cap (`PENDING_INPUTS_MAX_DEPTH = 240`, drop-oldest) — the
queue had no bound, so a sustained connection stall (ack stream stops
without a re-hello/epoch reset) let it grow unboundedly, and every
snapshot replays the ENTIRE queue. Tests:
`client/src/net/__tests__/clientLoopPendingInputsCap.test.ts` (cap holds
under a simulated 400-tick stall with correct drop-oldest semantics).

**R4 — HudSystem score-row redraw.** `client/src/game/ui/HudSystem.ts`'s
`updateScoreRows` did a full `Graphics.clear()`+redraw of every player's
badge/ring/underline/status-ticks on every render frame — driven mostly by
the health-ring's slow (~0.9s period) breathing pulse, which doesn't need
60Hz to read smoothly. Throttled to 20Hz (`SCORE_ROWS_THROTTLE_MS = 50`) —
still faster than the ~20-30Hz rate authoritative health/score data itself
arrives at over the wire. **R5 (ActionBarSystem) deliberately NOT
throttled** — see Deliberately skipped below.

**R3 — HangoutScene culling gap.** `client/src/game/scenes/HangoutScene.ts`
gave every player `detail: "full"` rig rendering unconditionally and
performed zero off-screen culling — the exact gaps OnlineMatchScene
already closed (`RIG_CULL_MARGIN`, potato-tier `detail` fallback), left
open here specifically because "no combat frame-budget to protect." That
premise doesn't hold in the venue lobby, which is the densest,
most-populated scene in the game (bell queue + loadout station
clustering) — exactly this audit's originating scenario. Added the same
camera-view cull margin (220px) and potato-tier `lite` detail fallback,
mirroring `OnlineMatchScene`'s already-shipped pattern exactly.

**R2 — retroactive rig downgrade.** `client/src/game/scenes/OnlineMatchScene.ts`:
`forceRigDowngrade()` only affected rigs constructed AFTER it fired —
every rig already alive when the governor detected CPU-bound futility
(92% of governor fires, per telemetry) kept paying full
`ProceduralPlayerRig` cost for the rest of the match. Added
`retrofitRigDowngradeIfNeeded()`, called once per frame: when the
effective style is "baked," sweeps any still-live (non-`BakedPlayerRig`)
rig and replaces it in place (destroy old, construct new via the same
`makePlayerRig` path, same position data). Self-terminating — stops
sweeping once every known rig is confirmed baked (`rigDowngradeFullySwept`),
since `runtimeRigDowngrade` never resets mid-session. Factored the
`?rig=` URL override + `getEffectiveRigStyle()` resolution into one shared
`resolveRigStyle()` so the retrofit sweep and initial construction can
never drift apart. Phaser-scene-coupled (no unit-test harness for this
class in the existing test conventions — verified via full suite +
reasoning about the `anchor === local` invariant, plus live restart
health checks).

**N2 — AOI window vs small maps.** `server/src/InterestGrid.ts` adds
`isFullCoverage(radius)`: true when a `radius`-cell Chebyshev neighbourhood
from ANY cell already spans the whole grid (boxworks-tower is 5×4 cells at
`CELL_SIZE_PX=320`; `OBSERVE_RADIUS_CELLS=2` spans 5×5 — a **provable**
no-op filter). `matchHost.ts` computes this once per match
(`aoiFullCoverage`, map size never changes mid-match) and skips
`grid.rebuild()` + the whole per-recipient filter pipeline entirely on
those maps, returning the state directly instead of reconstructing
"everything" through `cellsAround`/`observed`/`filterRecord`. This is the
literal, direct answer to "why does boxworks-tower especially lag."
Tests: `server/src/__tests__/interestGrid.test.ts` (`isFullCoverage` truth
table) + `server/src/__tests__/matchHostAoiFullCoverage.test.ts`
(end-to-end: small map → same-reference pass-through, large map → still
filters normally).

**N3 — InterestGrid wasted satellite pass.** Same file: `rebuild()` used
to bin satellites TWICE — an orbit-angle-only approximation (no owner
position, effectively binning near the origin) built and immediately
discarded, replaced by the correct owner-position pass right after.
Removed the first pass. Tests added to `interestGrid.test.ts`: a satellite
is binned by owner position + orbit offset (would fail under the old
double-pass's near-origin approximation), plus an orphaned-satellite
(`ownerId: null`) no-throw case.

**G — elastic bot floor vs map area.** `server/src/worldHost.ts`:
`botFloor` was a flat constant regardless of map size, so boxworks-tower
(1.56M px², 0.471× vessel-nexus) ran the same population target as
vessel-nexus (3.3M px², the reference/"full room" map) — roughly 2×
the density for the same setting, directly compounding the AOI and
rig-cost findings on the exact map that reported the lag.
`scaledBotFloor()` scales the configured floor down (never up) by
`min(1, currentMapArea / referenceMapArea)`; `currentMapArea` updates in
`buildHost()` whenever a new map is resolved. Tests added to
`worldBellGate.test.ts`: boxworks-mini (0.248×) floor 4→1,
boxworks-tower (0.471×) floor 4→2 (the audit's originating map, confirms
scaling relieves rather than eliminates), vessel-nexus (1.0×) unaffected,
`botFloor:0` (elasticity off) never scaled. **Six pre-existing tests in
the same file used `boxworks-mini` as an incidental fixture map for
UNRELATED mechanics** (bell-edge-only churn, team-floor pairing) — their
hardcoded exact-headcount assertions broke once area-scaling applied to
that map. Fixed by switching those six to `vessel-nexus` (ratio 1, ==
unscaled) rather than weakening the new scaling behavior — the tests were
never about map-size scaling, and now correctly isolate what they
actually test.

**N5 — bot-only match persist/Convex cost.** `server/src/matchHost.ts`
adds `hadHumanPlayer` (sticky for the match's whole life, set at initial
spawn AND at `addPlayer` mid-match joins). `postMatchResult()` now
short-circuits entirely — before the replay serialize, before the disk
persist, before the Convex round-trip — when no human ever joined. A
bot-only WorldHost recycle has nothing worth any of that for: no highlight
clips (`humanKillMoments` is already empty), no player-facing summary.
**Caught while testing:** the new regression test actually exercises
`persistReplay()` for the human-present case, which wrote a real junk
`.jjr` file into the production `server/.replays/` directory — the same
class of bug the `.clips` test-isolation fix addressed earlier this same
day. Fixed the root cause, not just the one test: `replayStore.ts`'s
`REPLAYS_DIR` now honors `JAKESJAM_REPLAYS_DIR`, wired to a fresh
`bunfig.toml` preload entry (`replaysDirIsolation.ts`, mirroring
`clipsDirIsolation.ts` exactly) so EVERY future test that reaches
`persistReplay` is isolated by construction, not by discipline. Stray file
from before the fix landed was deleted. Tests:
`matchHostBotOnlyPersistGate.test.ts` (flag tracking + gate behavior both
ways) + `replayStore.test.ts` (isolation canary, matching `clipStore.test.ts`'s
own pattern).

**M4 — camera-follow duplicate player-array builds.** `OnlineMatchScene.ts`:
`updateClipFocusWorld` and `followLocalPlayer` each independently rebuilt
an alive-non-local-players array from `Object.entries(state.players)`
every frame. Whenever local is alive (updateClipFocusWorld early-returns
entirely otherwise, and `followLocalPlayer`'s anchor is only ever
something other than local while local is dead — same condition, `anchor
=== local`), both wanted the exact same base set. Added
`aliveNonLocalScratch`, filled once by `updateClipFocusWorld` (which runs
first, same frame), consumed by `followLocalPlayer` instead of a second
full scan. Kept as fresh `{x,y}` object literals each frame (not reused
instances) — `stickyEnvelopeSubjects` retains some of these across frames
via `clipFocusSubjects`, so mutating shared instances in place next frame
would have corrupted that hysteresis state. Death-spectate fallback path
(rare) keeps its own independent scan.

**Docs — stale jetpack comment.** `client/src/sim/data/boxworks-tower.ts`'s
header described a "jetpack-focused" arena with "jetpack fuel [as] the
scarce resource" — the jetpack mechanic itself was removed from gameplay
before this session (`player.ts`: "Jetpack removed... walls are the
vertical [answer]"; fields kept only for wasm ABI stability). Corrected to
describe the actual current mechanic (wall-slide/wall-jump traversal).

### Deliberately skipped (with reasoning)

**S1 — WASM coverage for the projectile hit-sweep.** `sim/src/projectile.zig`
already has a substantial, carefully staged implementation
(`stepV2`/`ProjectileKinematicsV2` covering every pathing type including
homing/bounce/split, under an explicit ADR-0006/`docs/zig-wasm-migration.md`
phased-rollout discipline) — but `setStepProjectileBackend` is never
called in production, so none of it runs live. Finishing this properly
(the file's own header notes player collision/splits/sticky/impacts are
still TS-side for the orchestrator-level integration) is a multi-day
undertaking, not a bug fix, and this exact codebase has direct, recent
precedent for why flipping a WASM sim backend live without "real,
extensive human playtesting" is dangerous: `USE_WASM_STEP_WORLD` was
flipped on 2026-07-05, caused real live bugs that automated Playwright
checks repeatedly missed, and was flipped back off with a standing
instruction not to re-enable it without exactly that kind of testing
(see `matchHost.ts`'s own docblock on the flag). Wiring this now, inside
an unattended audit-fix pass, would repeat that exact mistake. Left
untouched; the seam and the Zig implementation are ready whenever a
dedicated, human-playtested rollout is scheduled.

**S2 — homing/anti-homing target caching.** `closestNonOwnerPlayer` in
`client/src/sim/projectile.ts` rescans all players every tick per homing
projectile with no caching, but the O(P log P) sort it needs
(`sortedPlayerIds`) is already computed ONCE per tick and shared across
every system (`sortedPlayerIdsForTick` in `World.ts`) — so the real
remaining cost is a bare O(P) linear distance scan per homing projectile,
genuinely cheap at this game's player-count scale (≤16-24). A real fix
(sticky target caching with re-pick-on-death/out-of-range) would change
observable homing behavior (real homing missiles sticky-track one target;
"always chase nearest every tick" is today's actual behavior) in
determinism-critical, replay/prediction-sensitive combat sim code, for a
marginal win the audit itself ranked lowest-priority. Not worth the risk
at current scale — revisit if player counts grow substantially or a
profiler shows this specific scan as a real bottleneck.

**N4 (bot AI redundant per-bot scans) and M4's tail (already covered
above).** N4 (`worldBots.ts`/`botArenaNav.ts` — N independent bot brains
each running their own nearest-foe/threat/LOS scan instead of one shared
pass) was not addressed this pass — lowest-priority item in the original
ranking, no telemetry signal pointing at it specifically, and sharing
scans across independently-thinking bot brains is a real architectural
change (shared per-tick spatial cache) rather than a local fix. Left for
a dedicated pass if bot-heavy scenes show up in future telemetry.
